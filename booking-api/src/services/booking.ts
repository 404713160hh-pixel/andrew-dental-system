import type pg from 'pg';
import type { PoolClient } from 'pg';
import { randomUUID,createHash } from 'node:crypto';
import type { Principal,BookingPolicy,SlotSelection,Hold,Appointment,BookingSlot } from '@andrew/shared';
import type { Config } from '../config.js';
import { one,transaction,iso } from '../db.js';
import { AppError,requireThat } from '../errors.js';
import { audit,clinicAccess } from '../auth.js';
import { requirePatientInClinic } from '../patient-access.js';
import { PRIVACY_VERSION } from '../privacy.js';
import { holdInput,confirmInput,changeInput } from '../validation.js';
import { querySlots } from '../repositories/booking.js';
import { getPatient,getAppointment } from '../repositories/catalog.js';
import { lockQualifications } from './resources.js';
export function bookingPolicy(config:Config):BookingPolicy{return {holdSeconds:config.HOLD_SECONDS,cancellationNoticeMinutes:config.CANCELLATION_NOTICE_MINUTES,transferBufferMinutes:config.TRANSFER_BUFFER_MINUTES,slotStepMinutes:config.SLOT_STEP_MINUTES,timezone:'Asia/Shanghai'};}
function localDate(instant:string){return new Date(Date.parse(instant)+8*3600000).toISOString().slice(0,10);}
function actualPatient(user:Principal,requested?:string){
 if(user.patientId){requireThat(!requested||requested===user.patientId,403,'PATIENT_SCOPE_DENIED','只能为当前账号本人预约');return user.patientId;}
 requireThat(requested,400,'PATIENT_REQUIRED','请先核对实际就诊人');return requested;
}
export function appointmentAccess(user:Principal,appointment:Appointment,write=false){
 if(user.patientId){requireThat(user.patientId===appointment.patientId,404,'NOT_FOUND','预约不存在');return;}
 clinicAccess(user,appointment.clinicId,write?['hq','manager','front']:['hq','manager','front','doctor']);
 const onlyDoctor=!user.roles.some(r=>r==='hq'||r==='manager'||r==='front');
 requireThat(!onlyDoctor||user.staffId===appointment.doctorId,404,'NOT_FOUND','预约不存在');
}
async function lockPeopleAndChair(db:PoolClient,patient:string,doctors:string[],chairs:string[]){
 requireThat(await one(db,'SELECT id FROM patients WHERE id=$1 FOR UPDATE',[patient]),404,'NOT_FOUND','患者档案不存在');
 for(const id of [...new Set(doctors)].sort())await db.query('SELECT id FROM staff WHERE id=$1 FOR UPDATE',[id]);
 for(const id of [...new Set(chairs)].sort())await db.query('SELECT id FROM chairs WHERE id=$1 FOR UPDATE',[id]);
}
async function expire(db:PoolClient){
 // No volatile now() index predicate. Expiration is a persisted state transition.
 await db.query("UPDATE resource_reservations SET status='expired' WHERE status='held' AND expires_at<=clock_timestamp()");
}
async function exactSlot(db:PoolClient,selection:SlotSelection,patientId:string,policy:BookingPolicy,ignoreReservationId?:string):Promise<BookingSlot>{
 await lockQualifications(db,selection.serviceId);
 const slots=await querySlots(db,{...selection,date:localDate(selection.startsAt),patientId,ignoreReservationId},policy);
 const slot=slots.find(s=>s.shiftId===selection.shiftId&&s.chairId===selection.chairId&&s.startsAt===iso(selection.startsAt));
 requireThat(slot,409,'SLOT_UNAVAILABLE','时段已不可用，或资格、班次、牙椅条件已变化，请重新选择');return slot;
}
type HoldRow={id:string;reservation_id:string;created_by:string;expires_at:Date;row_version:number;consumed_at:Date|null;patient_id:string;clinic_id:string;service_id:string;doctor_id:string;chair_id:string;shift_id:string;starts_at:Date;status:string;policy_snapshot:BookingPolicy};
async function holdRow(db:PoolClient,id:string){return one<HoldRow>(db,`SELECT h.*,r.patient_id,r.clinic_id,r.service_id,r.doctor_id,r.chair_id,r.shift_id,r.starts_at,r.status
 FROM booking_holds h JOIN resource_reservations r ON r.id=h.reservation_id WHERE h.id=$1`,[id]);}
function selectionOf(h:HoldRow):SlotSelection{return {clinicId:h.clinic_id,doctorId:h.doctor_id,chairId:h.chair_id,serviceId:h.service_id,shiftId:h.shift_id,startsAt:iso(h.starts_at)};}
function validHold(h:HoldRow|undefined,user:Principal,version:number,patientId?:string):asserts h is HoldRow{
 requireThat(h&&h.created_by===user.id,404,'HOLD_NOT_FOUND','占位不存在');
 requireThat(h.row_version===version,409,'VERSION_CONFLICT','占位版本已变化');
 requireThat(!h.consumed_at&&h.status==='held'&&h.expires_at.getTime()>Date.now(),409,'HOLD_EXPIRED','占位已失效，请重新查询');
 if(patientId)requireThat(h.patient_id===patientId,403,'PATIENT_SCOPE_DENIED','占位与就诊人不匹配');
 if(!user.patientId)clinicAccess(user,h.clinic_id,['hq','manager','front']);
 else requireThat(h.patient_id===user.patientId,404,'HOLD_NOT_FOUND','占位不存在');
}
export async function createHold(pool:pg.Pool,config:Config,user:Principal,raw:unknown,requestId:string):Promise<Hold>{
 const input=holdInput.parse(raw);const patientId=actualPatient(user,input.patientId);const policy=bookingPolicy(config);
 if(!user.patientId)clinicAccess(user,input.clinicId,['hq','manager','front']);
 return transaction(pool,async db=>{
  await lockPeopleAndChair(db,patientId,[input.doctorId],[input.chairId]);await expire(db);
  if(!user.patientId){
   await requirePatientInClinic(db,user,patientId,input.clinicId);
   // An existing appointment may still be cancelled after withdrawal, but
   // it does not authorize the creation of new reservations.
   const consent=await one<{has_any:boolean;has_active:boolean}>(db,`SELECT
    EXISTS(SELECT 1 FROM patient_privacy_consents WHERE patient_id=$1) AS has_any,
    EXISTS(SELECT 1 FROM patient_privacy_consents WHERE patient_id=$1 AND policy_version=$2 AND revoked_at IS NULL) AS has_active`,[patientId,PRIVACY_VERSION]);
   requireThat(consent?.has_active || (config.NODE_ENV!=='production'&&!consent?.has_any),403,'PRIVACY_CONSENT_REQUIRED','患者已撤回同意或尚未完成告知，请先完成隐私确认');
  }
  // Serialize catalog edits against final validation, not just browser queries.
  await db.query('SELECT id FROM clinics WHERE id=$1 FOR SHARE',[input.clinicId]);
  await db.query('SELECT id FROM services WHERE id=$1 FOR SHARE',[input.serviceId]);
  await db.query('SELECT id FROM doctor_shifts WHERE id=$1 FOR SHARE',[input.shiftId]);
  const patient=await getPatient(db,patientId);requireThat(patient?.phone&&patient.name,400,'PROFILE_INCOMPLETE','请先完善就诊人与联系方式');
  const slot=await exactSlot(db,input,patientId,policy);
  const r=await one<{id:string;expires_at:Date}>(db,`INSERT INTO resource_reservations(patient_id,clinic_id,service_id,doctor_id,chair_id,shift_id,starts_at,ends_at,occupied_until,status,expires_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'held',clock_timestamp()+$10::int*interval '1 second')RETURNING id,expires_at`,[patientId,input.clinicId,input.serviceId,input.doctorId,input.chairId,input.shiftId,slot.startsAt,slot.endsAt,slot.occupiedUntil,config.HOLD_SECONDS]);
  const h=await one<{id:string;row_version:number}>(db,'INSERT INTO booking_holds(reservation_id,created_by,expires_at,policy_snapshot) SELECT id,$2,expires_at,$3 FROM resource_reservations WHERE id=$1 RETURNING id,row_version',[r!.id,user.id,JSON.stringify(policy)]);
  await audit(db,user.id,'booking.hold.created',h!.id,requestId,{patientId,clinicId:slot.clinicId});
  return {id:h!.id,expiresAt:iso(r!.expires_at),rowVersion:h!.row_version,slot,policy};
 });
}
function canonical(value:unknown):string{
 if(value===null||typeof value!=='object')return JSON.stringify(value)??'null';
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
}
async function idempotent<T extends Appointment>(pool:pg.Pool,user:Principal,key:string|undefined,operation:string,input:unknown,run:(db:PoolClient)=>Promise<T>):Promise<T>{
 requireThat(key&&/^[A-Za-z0-9_-]{8,128}$/.test(key),400,'IDEMPOTENCY_KEY_REQUIRED','请提供稳定的 Idempotency-Key');
 const hash=createHash('sha256').update(canonical({operation,input})).digest('hex');
 return transaction(pool,async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user.id+':'+key]);
  const old=await one<{request_hash:string;result:T}>(db,'SELECT request_hash,result FROM command_receipts WHERE user_id=$1 AND command_key=$2',[user.id,key]);
  if(old){requireThat(old.request_hash===hash,409,'REQUEST_KEY_REUSED','同一操作编号不能用于不同请求');appointmentAccess(user,old.result,true);return old.result;}
  const result=await run(db);
  await db.query('INSERT INTO command_receipts(user_id,command_key,request_hash,result)VALUES($1,$2,$3,$4)',[user.id,key,hash,JSON.stringify(result)]);return result;
 });
}
async function consume(db:PoolClient,h:HoldRow,slot:BookingSlot,user:Principal,requestId:string,supersedes?:string):Promise<Appointment>{
 const policyId=randomUUID();
 const appointmentNo='AD'+new Date().toISOString().slice(0,10).replaceAll('-','')+randomUUID().replaceAll('-','').slice(0,10).toUpperCase();
 const changed=await db.query("UPDATE resource_reservations SET status='booked' WHERE id=$1 AND status='held' AND expires_at>clock_timestamp()",[h.reservation_id]);
 requireThat(changed.rowCount===1,409,'HOLD_EXPIRED','占位已到期，请重新选择');
 await db.query('UPDATE booking_holds SET consumed_at=clock_timestamp(),row_version=row_version+1 WHERE id=$1',[h.id]);
 await db.query(`INSERT INTO appointments(id,appointment_no,patient_id,reservation_id,hold_id,service_name,price_cents,created_by,supersedes_appointment_id,policy_snapshot)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[policyId,appointmentNo,h.patient_id,h.reservation_id,h.id,slot.serviceName,slot.priceCents,user.id,supersedes??null,JSON.stringify(h.policy_snapshot)]);
 await db.query('INSERT INTO appointment_events(appointment_id,actor_id,kind)VALUES($1,$2,$3)',[policyId,user.id,supersedes?'replacement_confirmed':'confirmed']);
 await audit(db,user.id,'appointment.confirmed',policyId,requestId,{clinicId:slot.clinicId,supersedes:supersedes??null});
 return (await getAppointment(db,policyId,{holdSeconds:0,cancellationNoticeMinutes:0,transferBufferMinutes:0,slotStepMinutes:0,timezone:'Asia/Shanghai'}))!;
}
export async function confirmAppointment(pool:pg.Pool,config:Config,user:Principal,raw:unknown,key:string|undefined,requestId:string):Promise<Appointment>{
 const input=confirmInput.parse(raw);const policy=bookingPolicy(config);
 return idempotent(pool,user,key,'confirm',input,async db=>{
  const hint=await holdRow(db,input.holdId);requireThat(hint,404,'HOLD_NOT_FOUND','占位不存在');
  await lockPeopleAndChair(db,hint.patient_id,[hint.doctor_id],[hint.chair_id]);await expire(db);
  await db.query('SELECT id FROM booking_holds WHERE id=$1 FOR UPDATE',[hint.id]);
  const h=await holdRow(db,hint.id);validHold(h,user,input.holdVersion,input.patientId);
  await db.query('SELECT id FROM clinics WHERE id=$1 FOR SHARE',[h.clinic_id]);await db.query('SELECT id FROM services WHERE id=$1 FOR SHARE',[h.service_id]);await db.query('SELECT id FROM doctor_shifts WHERE id=$1 FOR SHARE',[h.shift_id]);
  const slot=await exactSlot(db,selectionOf(h),h.patient_id,policy,h.reservation_id);
  return consume(db,h,slot,user,requestId);
 });
}
export async function changeAppointment(pool:pg.Pool,config:Config,user:Principal,id:string,raw:unknown,key:string|undefined,requestId:string):Promise<Appointment>{
 const input=changeInput.parse(raw);const policy=bookingPolicy(config);
 return idempotent(pool,user,key,'change:'+id,input,async db=>{
  const before=await getAppointment(db,id,policy);requireThat(before,404,'NOT_FOUND','预约不存在');appointmentAccess(user,before,true);
  const target=input.intent==='reschedule'?await holdRow(db,input.holdId!):undefined;
  await lockPeopleAndChair(db,before.patientId,[before.doctorId,...(target?[target.doctor_id]:[])],[before.chairId,...(target?[target.chair_id]:[])]);await expire(db);
  await db.query('SELECT id FROM appointments WHERE id=$1 FOR UPDATE',[id]);const original=(await getAppointment(db,id,policy))!;
  requireThat(original.rowVersion===input.expectedVersion,409,'VERSION_CONFLICT','预约已变化，请刷新后重试');
  requireThat(original.status==='confirmed',409,'APPOINTMENT_NOT_ACTIVE','只能变更有效预约');
  requireThat(Date.parse(original.startsAt)-Date.now()>=original.policy.cancellationNoticeMinutes*60000,409,'CANCELLATION_WINDOW_CLOSED','已超过自助取消或改期时限，请联系门诊');
  if(target)await db.query('SELECT id FROM booking_holds WHERE id=$1 FOR UPDATE',[target.id]);
  const h=input.intent==='reschedule'?await holdRow(db,input.holdId!):undefined;
  if(input.intent==='reschedule')validHold(h,user,input.holdVersion!,before.patientId);
  const oldReservation=await one<{reservation_id:string}>(db,'SELECT reservation_id FROM appointments WHERE id=$1',[id]);
  await db.query("UPDATE resource_reservations SET status='released' WHERE id=$1",[oldReservation!.reservation_id]);
  const newStatus=input.intent==='cancel'?'cancelled':'rescheduled';
  await db.query('UPDATE appointments SET status=$2,cancellation_reason=$3,row_version=row_version+1 WHERE id=$1',[id,newStatus,input.reason]);
  await db.query('INSERT INTO appointment_events(appointment_id,actor_id,kind,reason)VALUES($1,$2,$3,$4)',[id,user.id,newStatus,input.reason]);
  await audit(db,user.id,'appointment.'+newStatus,id,requestId,{reason:input.reason});
  if(h){
   await db.query('SELECT id FROM clinics WHERE id=$1 FOR SHARE',[h.clinic_id]);await db.query('SELECT id FROM services WHERE id=$1 FOR SHARE',[h.service_id]);await db.query('SELECT id FROM doctor_shifts WHERE id=$1 FOR SHARE',[h.shift_id]);
   if(!user.patientId)clinicAccess(user,h.clinic_id,['hq','manager','front']);
   const slot=await exactSlot(db,selectionOf(h),before.patientId,policy,h.reservation_id);
   return consume(db,h,slot,user,requestId,id);
  }
  return (await getAppointment(db,id,policy))!;
 });
}
