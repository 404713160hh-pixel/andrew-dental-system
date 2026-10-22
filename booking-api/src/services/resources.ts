import type pg from 'pg';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { Principal,Shift } from '@andrew/shared';
import { one,transaction,iso } from '../db.js';
import { AppError,requireThat } from '../errors.js';
import { audit,clinicAccess,hqOnly } from '../auth.js';
import { clinicInput,doctorInput,serviceInput,chairInput,qualificationInput,shiftInput } from '../validation.js';
import { clinicSelect,doctorSelect,serviceSelect,chairSelect,qualificationSelect,shiftSelect } from '../repositories/catalog.js';
import type { Config } from '../config.js';
type Resource='clinics'|'doctors'|'services'|'chairs'|'qualifications';
type Payload=Record<string,unknown>;
const schemas={clinics:clinicInput,doctors:doctorInput,services:serviceInput,chairs:chairInput,qualifications:qualificationInput};
const tables={clinics:'clinics',doctors:'staff',services:'services',chairs:'chairs',qualifications:'qualifications'};
const reads={clinics:clinicSelect,doctors:doctorSelect,services:serviceSelect,chairs:chairSelect,qualifications:qualificationSelect};
const fields:Record<Resource,Record<string,string>>={
 clinics:{name:'name',address:'address',phone:'phone',email:'email',active:'active',timezone:'timezone'},
 doctors:{employeeNo:'employee_no',name:'name',phone:'phone',specialty:'specialty',active:'active'},
 services:{name:'name',description:'description',durationMinutes:'duration_minutes',bufferMinutes:'buffer_minutes',priceCents:'price_cents',unit:'unit',active:'active'},
 chairs:{clinicId:'clinic_id',name:'name',active:'active'},qualifications:{name:'name',active:'active'}
};
async function futureUse(db:PoolClient,resource:Resource,id:string){
 const predicate:Record<Resource,string>={clinics:'r.clinic_id=$1',doctors:'r.doctor_id=$1',services:'r.service_id=$1',chairs:'r.chair_id=$1',qualifications:'EXISTS(SELECT 1 FROM service_qualifications sq WHERE sq.service_id=r.service_id AND sq.qualification_id=$1)'};
 const result=await one<{used:boolean}>(db,`SELECT EXISTS(SELECT 1 FROM resource_reservations r WHERE ${predicate[resource]} AND r.starts_at>now() AND (r.status='booked' OR r.status='held' AND r.expires_at>now())) AS used`,[id]);
 return result?.used;
}
export async function saveResource(pool:pg.Pool,user:Principal,kind:Resource,raw:unknown,id:string|undefined,requestId:string){
 const data=schemas[kind].parse(raw) as Payload;
 if(kind==='chairs')clinicAccess(user,String(data.clinicId),['hq','manager']);
 else if(kind==='clinics'&&id)clinicAccess(user,id,['hq','manager']);
 else hqOnly(user);
 return transaction(pool,async db=>{
  const table=tables[kind];
  if(id){
   const old=await one<{row_version:number;clinic_id?:string}>(db,`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`,[id]);
   requireThat(old,404,'NOT_FOUND','资料不存在');
   if(kind==='chairs')clinicAccess(user,old.clinic_id!,['hq','manager']);
   requireThat(data.expectedVersion===old.row_version,409,'VERSION_CONFLICT','资料已变更，请刷新后重试');
   // Published bookings keep the exact service, skill and resource conditions.
   const structural=kind!=='clinics'||data.active===false;
   requireThat(!structural||!await futureUse(db,kind,id),409,'FUTURE_BOOKINGS_EXIST','已有有效预约或占位，请先处理后再调整该资源');
  }
  const entries=Object.entries(fields[kind]);const values=entries.map(([key])=>data[key]);
  let result:{id:string}|undefined;
  if(id){values.push(id);result=await one(db,`UPDATE ${table} SET ${entries.map(([,column],i)=>`${column}=$${i+1}`).join(',')},row_version=row_version+1 WHERE id=$${values.length} RETURNING id`,values);}
  else result=await one(db,`INSERT INTO ${table}(${entries.map(([,column])=>column).join(',')}) VALUES(${values.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING id`,values);
  requireThat(result,500,'WRITE_FAILED','资料保存失败');const savedId=result.id;
  if(kind==='doctors'){
   const qualifications=(data.qualifications as z.infer<typeof doctorInput>['qualifications']);
   requireThat(new Set(qualifications.map(x=>x.qualificationId)).size===qualifications.length,400,'DUPLICATE_QUALIFICATION','专业资格不能重复');
   await db.query('DELETE FROM dentist_qualifications WHERE dentist_id=$1',[savedId]);
   for(const q of qualifications)await db.query('INSERT INTO dentist_qualifications(dentist_id,qualification_id,valid_from,valid_until)VALUES($1,$2,$3,$4)',[savedId,q.qualificationId,q.validFrom,q.validUntil]);
  }
  if(kind==='services'){
   const v=data as unknown as z.infer<typeof serviceInput>;
   requireThat(new Set(v.clinicIds).size===v.clinicIds.length&&new Set(v.qualificationIds).size===v.qualificationIds.length,400,'DUPLICATE_LINK','关联项目不能重复');
   await db.query('DELETE FROM clinic_services WHERE service_id=$1',[savedId]);await db.query('DELETE FROM service_qualifications WHERE service_id=$1',[savedId]);
   for(const clinicId of v.clinicIds)await db.query('INSERT INTO clinic_services(clinic_id,service_id)VALUES($1,$2)',[clinicId,savedId]);
   for(const q of v.qualificationIds)await db.query('INSERT INTO service_qualifications(service_id,qualification_id)VALUES($1,$2)',[savedId,q]);
  }
  await audit(db,user.id,kind+(id?'.updated':'.created'),savedId,requestId);
  const alias=kind==='doctors'?'s.':kind==='services'?'v.':'';
  return (await db.query(reads[kind]+` WHERE ${alias}id=$1`,[savedId])).rows[0];
 });
}
export async function qualified(db:PoolClient,doctorId:string,serviceId:string,start:string,end:string):Promise<boolean>{
 const row=await one<{ok:boolean}>(db,`SELECT NOT EXISTS(SELECT 1 FROM service_qualifications sq WHERE sq.service_id=$2 AND NOT EXISTS(
 SELECT 1 FROM dentist_qualifications dq JOIN qualifications q ON q.id=dq.qualification_id WHERE dq.dentist_id=$1 AND dq.qualification_id=sq.qualification_id
 AND q.active AND dq.valid_from<=$3::timestamptz AND (dq.valid_until IS NULL OR dq.valid_until>=$4::timestamptz))) AS ok`,[doctorId,serviceId,start,end]);return !!row?.ok;
}
export async function lockQualifications(db:PoolClient,serviceId:string){
 await db.query('SELECT q.id FROM qualifications q JOIN service_qualifications sq ON sq.qualification_id=q.id WHERE sq.service_id=$1 ORDER BY q.id FOR SHARE OF q',[serviceId]);
}
export async function publishShift(pool:pg.Pool,config:Config,user:Principal,raw:unknown,requestId:string){
 const input=shiftInput.parse(raw);clinicAccess(user,input.clinicId,['hq','manager']);
 requireThat(Date.parse(input.startsAt)>Date.now(),400,'PAST_SHIFT','只能发布未来的班次');
 return transaction(pool,async db=>{
  const doctor=await one<{active:boolean;is_dentist:boolean}>(db,'SELECT active,is_dentist FROM staff WHERE id=$1 FOR UPDATE',[input.doctorId]);
  requireThat(doctor?.active&&doctor.is_dentist,400,'DOCTOR_UNAVAILABLE','医生已停用或不存在');
  const clinic=await one<{active:boolean}>(db,'SELECT active FROM clinics WHERE id=$1 FOR SHARE',[input.clinicId]);requireThat(clinic?.active,400,'CLINIC_UNAVAILABLE','门诊不可用');
  requireThat(new Set(input.serviceIds).size===input.serviceIds.length,400,'DUPLICATE_SERVICE','班次项目不能重复');
  const conflict=await one(db,`SELECT id FROM doctor_shifts WHERE doctor_id=$1 AND status='published'
   AND starts_at<$3::timestamptz+CASE WHEN clinic_id<>$4 THEN $5::int*interval '1 minute' ELSE interval '0' END
   AND ends_at>$2::timestamptz-CASE WHEN clinic_id<>$4 THEN $5::int*interval '1 minute' ELSE interval '0' END LIMIT 1`,[input.doctorId,input.startsAt,input.endsAt,input.clinicId,config.TRANSFER_BUFFER_MINUTES]);
  requireThat(!conflict,409,'SHIFT_CONFLICT','医生已有重叠班次，或跨店转场时间不足');
  for(const serviceId of [...input.serviceIds].sort()){
   const s=await one<{active:boolean;minutes:number}>(db,`SELECT active,duration_minutes+buffer_minutes AS minutes FROM services WHERE id=$1 FOR SHARE`,[serviceId]);
   requireThat(s?.active,400,'SERVICE_UNAVAILABLE','服务项目不可用');
   await lockQualifications(db,serviceId);
   requireThat(Date.parse(input.endsAt)-Date.parse(input.startsAt)>=s.minutes*60000,400,'SHIFT_TOO_SHORT','班次不足以完成服务及缓冲');
   requireThat(await one(db,'SELECT 1 FROM clinic_services WHERE clinic_id=$1 AND service_id=$2',[input.clinicId,serviceId]),400,'SERVICE_NOT_OFFERED','门诊未提供该项目');
   requireThat(await qualified(db,input.doctorId,serviceId,input.startsAt,input.endsAt),409,'QUALIFICATION_REQUIRED','医生资格不覆盖该班次项目');
  }
  const row=await one<{id:string}>(db,'INSERT INTO doctor_shifts(clinic_id,doctor_id,starts_at,ends_at,created_by)VALUES($1,$2,$3,$4,$5)RETURNING id',[input.clinicId,input.doctorId,input.startsAt,input.endsAt,user.id]);
  for(const serviceId of input.serviceIds)await db.query('INSERT INTO doctor_shift_services(shift_id,service_id)VALUES($1,$2)',[row!.id,serviceId]);
  await audit(db,user.id,'shift.published',row!.id,requestId);
  const result=(await one<Shift>(db,shiftSelect+' WHERE ds.id=$1',[row!.id]))!;
  return {...result,startsAt:iso(result.startsAt),endsAt:iso(result.endsAt)};
 });
}
export async function cancelShift(pool:pg.Pool,user:Principal,id:string,expectedVersion:number,requestId:string){
 return transaction(pool,async db=>{
  const hint=await one<{doctor_id:string}>(db,'SELECT doctor_id FROM doctor_shifts WHERE id=$1',[id]);requireThat(hint,404,'NOT_FOUND','班次不存在');
  await db.query('SELECT id FROM staff WHERE id=$1 FOR UPDATE',[hint.doctor_id]);
  const shift=await one<{clinic_id:string;row_version:number;status:string}>(db,'SELECT * FROM doctor_shifts WHERE id=$1 FOR UPDATE',[id]);requireThat(shift,404,'NOT_FOUND','班次不存在');
  clinicAccess(user,shift.clinic_id,['hq','manager']);requireThat(shift.row_version===expectedVersion,409,'VERSION_CONFLICT','班次已变更');
  requireThat(shift.status==='published',409,'SHIFT_NOT_PUBLISHED','班次已撤销');
  requireThat(!await one(db,"SELECT 1 FROM resource_reservations WHERE shift_id=$1 AND (status='booked' OR status='held' AND expires_at>now()) LIMIT 1",[id]),409,'FUTURE_BOOKINGS_EXIST','班次存在预约或有效占位，不能撤销');
  await db.query("UPDATE doctor_shifts SET status='cancelled',row_version=row_version+1 WHERE id=$1",[id]);
  await audit(db,user.id,'shift.cancelled',id,requestId);return {id,status:'cancelled',rowVersion:expectedVersion+1};
 });
}
