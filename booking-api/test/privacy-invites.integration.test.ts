import assert from 'node:assert/strict';
import { after,before,test } from 'node:test';
import { randomBytes,randomUUID } from 'node:crypto';
import type { FastifyInstance,HTTPMethods } from 'fastify';
import type { Pool } from 'pg';
import type { Appointment,BookingSlot,Clinic,Hold,LoginResult,Patient,Shift } from '../../shared/src/index.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { migrate,poolFor } from '../src/db.js';
import { seed } from '../src/seed.js';
import { PRIVACY_VERSION } from '../src/privacy.js';

const databaseName=`andrew_test_${randomBytes(10).toString('hex')}`;
const password=`Test-${randomBytes(16).toString('base64url')}!`;
const adultConsent={policyVersion:PRIVACY_VERSION,noticeAccepted:true,sensitiveAccepted:true,guardian:null};
const adult={name:'合成核验患者',birthDate:'1998-07-21',phone:'13800009999',email:null,billingAddress:'合成地址',emergencyName:'合成联系人',emergencyPhone:'13900009999',allergyStatus:'known',allergies:['合成过敏原']};
let admin:Pool|undefined,db:Pool,app:FastifyInstance,created=false;
let hq:LoginResult,front:LoginResult,clinicId:string,otherClinicId:string;
async function req(method:HTTPMethods,path:string,who?:LoginResult,payload?:object,key?:string){
 return app.inject({method,url:'/api/v1'+path,headers:{...(who?{authorization:`Bearer ${who.token}`}:{ }),...(key?{'idempotency-key':key}:{})},...(payload===undefined?{}:{payload})});
}
function data<T>(response:Awaited<ReturnType<typeof req>>):T {assert.equal(response.statusCode,200,response.body);return response.json().data as T;}
async function login(username:string,portal:'staff'|'patient'='staff') {return data<LoginResult>(await req('POST','/auth/login',undefined,{username,password,portal}));}
async function intake(clinic:string,who=hq) {return data<Patient>(await req('POST','/staff/patients',who,{...adult,clinicId:clinic,consent:adultConsent}));}

before(async()=>{
 const base=process.env.TEST_DATABASE_URL||process.env.DATABASE_URL;assert.ok(base,'Dedicated PostgreSQL test server required');
 const url=new URL(base);url.pathname='/postgres';admin=poolFor(url.toString());
 await admin.query(`CREATE DATABASE "${databaseName}"`);created=true;
 url.pathname='/'+databaseName;db=poolFor(url.toString());await migrate(db);await seed(db,password);
 app=await createApp(loadConfig({NODE_ENV:'test',DATABASE_URL:url.toString(),ALLOW_DEMO_LOGIN:'false'}),db,false);await app.ready();
 hq=await login('hq');front=await login('front.a');clinicId=front.user.assignments.find(x=>x.role==='front')!.clinicId!;
 otherClinicId=data<Clinic[]>(await req('GET','/clinics')).find(x=>x.id!==clinicId)!.id;
},{timeout:120_000});
after(async()=>{
 if(app)await app.close();if(db)await db.end();
 if(admin){try{if(created){assert.match(databaseName,/^andrew_test_[0-9a-f]{20}$/);await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[databaseName]);await admin.query(`DROP DATABASE "${databaseName}"`);}}finally{await admin.end();}}
});

test('public doctor directory omits employee contact data while headquarters may manage it',async()=>{
 const doctors=data<Record<string,unknown>[]>(await req('GET','/doctors'));assert.ok(doctors.length);
 assert.ok(doctors.every(d=>!('phone' in d)&&!('employeeNo' in d)));
 const managed=data<Record<string,unknown>[]>(await req('GET','/doctors?includeInactive=true',hq));
 assert.ok(managed.some(d=>'phone' in d&&'employeeNo' in d));
});

test('avatar persists for its patient, supports replacement and removal, and requires current consent',async()=>{
 const first=data<LoginResult>(await req('POST','/auth/register',undefined,{username:'avatar.first',password,profile:adult,consent:adultConsent}));
 const second=data<LoginResult>(await req('POST','/auth/register',undefined,{username:'avatar.second',password,profile:adult,consent:adultConsent}));
 const path='/patients/me/avatar';
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBFsAAAAASUVORK5CYII=';
 assert.equal((await req('GET',path)).statusCode,401);
 assert.equal((await req('PUT',path,hq,{base64:png})).statusCode,403);
 assert.equal((await req('PUT',path,first,{base64:Buffer.from('<svg>invalid avatar</svg>').toString('base64')})).statusCode,400);
 assert.equal(data(await req('GET',path,first)),null);
 assert.deepEqual(data(await req('PUT',path,first,{base64:png})),{mimeType:'image/png'});
 const reauthenticated=await login('avatar.first','patient');
 const image=await req('GET',path,reauthenticated);
 assert.equal(image.headers['cache-control'],'no-store');
 assert.deepEqual(data(image),{mimeType:'image/png',base64:png});
 assert.equal(data(await req('GET',path,second)),null);
 assert.ok(!('avatar' in (data<object>(await req('GET','/patients/me',first)))));
 assert.deepEqual(data(await req('PUT',path,first,{base64:null})),{mimeType:null});
 assert.equal(data(await req('GET',path,first)),null);
 data(await req('PUT',path,first,{base64:png}));
 data(await req('POST','/privacy/withdraw',first,{confirm:true}));
 assert.equal((await req('GET',path,first)).statusCode,403);
});

test('current chain notice permits exact reception identity lookup while medical details stay restricted',async()=>{
 const own=await intake(clinicId,front),other=await intake(otherClinicId);
 const list=data<{items:Record<string,unknown>[]}>(await req('GET','/staff/patients?q='+encodeURIComponent(adult.name),front));
 assert.ok(list.items.some(p=>p.id===own.id));assert.ok(list.items.some(p=>p.id===other.id));
 for(const p of list.items){assert.ok(!('allergies' in p)&&!('billingAddress' in p)&&!('emergencyPhone' in p));assert.match(String(p.phone),/\*\*\*\*/);}
 assert.equal((await req('GET','/staff/patients',front)).statusCode,400);
 assert.equal(data<{items:unknown[]}>(await req('GET','/staff/patients?q='+encodeURIComponent(adult.name.slice(0,2)),front)).items.length,0);
 assert.equal((await req('GET',`/patients/${other.id}`,front)).statusCode,404);
 assert.equal((await req('POST',`/staff/patients/${other.id}/invitations`,front,{identityVerified:true})).statusCode,200);
 const legacy=await intake(otherClinicId);await db.query("UPDATE patient_privacy_consents SET policy_version='2026-10-27-v1' WHERE patient_id=$1",[legacy.id]);
 const legacySearch=data<{items:{id:string}[]}>(await req('GET','/staff/patients?q='+encodeURIComponent(adult.name),front));
 assert.ok(!legacySearch.items.some(p=>p.id===legacy.id));
 assert.equal((await req('POST',`/staff/patients/${legacy.id}/invitations`,front,{identityVerified:true})).statusCode,404);
 assert.equal((await req('POST',`/staff/patients/${own.id}/invitations`,front,{identityVerified:false})).statusCode,400);
 const audit=await db.query("SELECT detail::text FROM audit_events WHERE action='patient.search' ORDER BY occurred_at DESC LIMIT 1");
 assert.ok(audit.rows.length);assert.ok(!audit.rows[0].detail.includes(adult.name)&&!audit.rows[0].detail.includes(adult.phone));
});

test('one explicit chain notice supports a new follow-up at another chosen clinic and its normal changes',async()=>{
 const notice=data<{policyVersion:string;purpose:string}>(await req('GET','/privacy/notice'));
 assert.equal(notice.policyVersion,PRIVACY_VERSION);assert.match(notice.purpose,/连锁门诊预约和接诊/);
 const registered=data<LoginResult>(await req('POST','/auth/register',undefined,{username:'followup.patient',password,profile:{...adult,name:'合成复诊患者'},consent:adultConsent}));
 const patientId=registered.user.patientId!;
 const consentCount=async()=>Number((await db.query('SELECT count(*) AS n FROM patient_privacy_consents WHERE patient_id=$1',[patientId])).rows[0].n);
 const slots=async(clinic:string)=>{
  const shift=data<Shift[]>(await req('GET',`/shifts?clinicId=${clinic}`,hq)).find(s=>s.status==='published')!;
  const day=new Date(Date.parse(shift.startsAt)+8*3600000).toISOString().slice(0,10);
  return data<BookingSlot[]>(await req('GET','/booking-slots?'+new URLSearchParams({clinicId:clinic,serviceId:shift.serviceIds[0]!,doctorId:shift.doctorId,date:day}),registered));
 };
 const select=(s:BookingSlot)=>({clinicId:s.clinicId,serviceId:s.serviceId,doctorId:s.doctorId,chairId:s.chairId,shiftId:s.shiftId,startsAt:s.startsAt});
 const book=async(s:BookingSlot)=>{const hold=data<Hold>(await req('POST','/booking-holds',registered,select(s)));return data<Appointment>(await req('POST','/appointments/confirm',registered,{holdId:hold.id,holdVersion:hold.rowVersion,patientConfirmed:true,rulesAccepted:true},randomUUID()));};
 const first=await book((await slots(otherClinicId))[0]!);
 const second=await book((await slots(clinicId)).at(-1)!);
 assert.equal(second.patientId,first.patientId);assert.notEqual(first.clinicId,second.clinicId);
 assert.equal(second.supersedesAppointmentId,null);assert.equal(data<Appointment>(await req('GET',`/appointments/${first.id}`,registered)).status,'confirmed');
 const replacementHold=data<Hold>(await req('POST','/booking-holds',registered,select((await slots(clinicId))[0]!)));
 const changed=data<Appointment>(await req('POST',`/appointments/${second.id}/changes`,registered,{intent:'reschedule',expectedVersion:second.rowVersion,reason:'合成复诊改期',holdId:replacementHold.id,holdVersion:replacementHold.rowVersion},randomUUID()));
 assert.equal(changed.supersedesAppointmentId,second.id);assert.equal(changed.patientId,patientId);
 const staffView=data<{items:Appointment[]}>(await req('GET',`/staff/appointments?clinicId=${clinicId}`,front));assert.ok(staffView.items.some(a=>a.id===changed.id));
 assert.equal((await req('GET',`/appointments/${first.id}`,front)).statusCode,403);
 const cancelled=data<Appointment>(await req('POST',`/appointments/${changed.id}/changes`,registered,{intent:'cancel',expectedVersion:changed.rowVersion,reason:'合成复诊取消'},randomUUID()));assert.equal(cancelled.status,'cancelled');
 assert.equal(await consentCount(),1);
 assert.equal(data<{accepted:boolean}>(await req('GET','/privacy/status',registered)).accepted,true);
 const selected=(await slots(clinicId))[0]!;
 const receptionPatient=data<LoginResult>(await req('POST','/auth/register',undefined,{username:'reception.chain.patient',password,profile:{...adult,name:'合成连锁接诊患者'},consent:adultConsent}));
 const receptionHold=data<Hold>(await req('POST','/booking-holds',front,{...select(selected),patientId:receptionPatient.user.patientId!}));
 assert.ok(receptionHold.id,'a chosen reception clinic can use the existing identity without another clinic-consent step');
 const denied=await req('POST','/booking-holds',front,{...select((await slots(otherClinicId)).at(-1)!),patientId:receptionPatient.user.patientId!});assert.equal(denied.statusCode,403);
});

test('invitation replaces older codes, checks date, binds once and records consent without storing the code',async()=>{
 const p=await intake(clinicId,front);
 const first=data<{code:string}>(await req('POST',`/staff/patients/${p.id}/invitations`,front,{identityVerified:true}));
 const second=data<{code:string}>(await req('POST',`/staff/patients/${p.id}/invitations`,front,{identityVerified:true}));
 assert.notEqual(first.code,second.code);
 const input={username:'invite.patient',password,birthDate:adult.birthDate,consent:adultConsent};
 assert.equal((await req('POST','/auth/register-linked',undefined,{...input,code:first.code})).statusCode,400);
 assert.equal((await req('POST','/auth/register-linked',undefined,{...input,birthDate:'1998-07-20',code:second.code})).statusCode,400);
 const linked=data<LoginResult>(await req('POST','/auth/register-linked',undefined,{...input,code:second.code}));assert.equal(linked.user.patientId,p.id);
 assert.equal((await req('POST','/auth/register-linked',undefined,{...input,username:'invite.replay',code:second.code})).statusCode,400);
 assert.equal((await req('POST',`/staff/patients/${p.id}/invitations`,front,{identityVerified:true})).statusCode,409);
 const stored=await db.query('SELECT code_hash FROM patient_registration_invites WHERE patient_id=$1',[p.id]);
 assert.ok(stored.rows.every(row=>row.code_hash!==first.code&&row.code_hash!==second.code));
 const consent=await db.query('SELECT actor_id,policy_version FROM patient_privacy_consents WHERE patient_id=$1 AND actor_id=$2',[p.id,linked.user.id]);
 assert.equal(consent.rows.length,1);assert.equal(consent.rows[0].policy_version,PRIVACY_VERSION);
 assert.equal((await req('POST','/privacy/withdraw',linked,{confirm:true})).statusCode,200);
 assert.equal((await req('GET','/patients/me',linked)).json().error.code,'PRIVACY_CONSENT_REQUIRED');
 assert.equal((await req('GET','/appointments',linked)).json().error.code,'PRIVACY_CONSENT_REQUIRED');
 const publicAfterWithdrawal=data<Record<string,unknown>[]>(await req('GET','/doctors',linked));
 assert.ok(publicAfterWithdrawal.length>0&&publicAfterWithdrawal.every(d=>!('phone' in d)&&!('employeeNo' in d)));
 assert.equal((await req('GET','/services',linked)).statusCode,200);
 const shift=data<Shift[]>(await req('GET',`/shifts?clinicId=${clinicId}`,front)).find(s=>s.status==='published')!;
 const day=new Date(Date.parse(shift.startsAt)+8*3600000).toISOString().slice(0,10);
 const slot=data<BookingSlot[]>(await req('GET','/booking-slots?'+new URLSearchParams({clinicId,serviceId:shift.serviceIds[0]!,doctorId:shift.doctorId,date:day})))[0]!;
 assert.ok(slot);
 const hold={patientId:p.id,clinicId:slot.clinicId,serviceId:slot.serviceId,doctorId:slot.doctorId,chairId:slot.chairId,shiftId:slot.shiftId,startsAt:slot.startsAt};
 assert.equal((await req('POST','/booking-holds',front,hold)).json().error.code,'PRIVACY_CONSENT_REQUIRED');
 assert.equal((await req('POST','/privacy/consent',linked,adultConsent)).statusCode,200);
 assert.equal((await req('GET','/patients/me',linked)).statusCode,200);
 assert.equal((await req('POST','/booking-holds',front,hold)).statusCode,200);
});

test('concurrent redemption binds only one account and a minor requires guardian consent',async()=>{
 const p=await intake(clinicId,front);
 const invitation=data<{code:string}>(await req('POST',`/staff/patients/${p.id}/invitations`,front,{identityVerified:true}));
 const args={password,birthDate:adult.birthDate,consent:adultConsent,code:invitation.code};
 const attempts=await Promise.all([req('POST','/auth/register-linked',undefined,{...args,username:'race.patient.a'}),req('POST','/auth/register-linked',undefined,{...args,username:'race.patient.b'})]);
 assert.equal(attempts.filter(x=>x.statusCode===200).length,1,attempts.map(x=>x.body).join('\n'));
 const child={...adult,name:'合成儿童患者',birthDate:'2020-01-01',phone:'13800008888'};
 const refused=await req('POST','/auth/register',undefined,{username:'child.patient',password,profile:child,consent:adultConsent});
 assert.equal(refused.json().error.code,'GUARDIAN_CONSENT_REQUIRED');
 const accepted=await req('POST','/auth/register',undefined,{username:'child.patient',password,profile:child,consent:{...adultConsent,guardian:{name:'合成监护人',relationship:'父母',accepted:true}}});
 assert.equal(accepted.statusCode,200,accepted.body);
});

test('staff booking requires an active consent for the current policy version',async()=>{
 const patient=await intake(clinicId,front);
 // Simulate a previously accepted version when the policy has since changed.
 await db.query('UPDATE patient_privacy_consents SET policy_version=$2 WHERE patient_id=$1',[patient.id,'synthetic-previous-version']);
 const shift=data<Shift[]>(await req('GET',`/shifts?clinicId=${clinicId}`,front)).find(s=>s.status==='published')!;
 const day=new Date(Date.parse(shift.startsAt)+8*3600000).toISOString().slice(0,10);
 const slot=data<BookingSlot[]>(await req('GET','/booking-slots?'+new URLSearchParams({clinicId,serviceId:shift.serviceIds[0]!,doctorId:shift.doctorId,date:day})))[0]!;
 assert.ok(slot);
 const selection={patientId:patient.id,clinicId:slot.clinicId,serviceId:slot.serviceId,doctorId:slot.doctorId,chairId:slot.chairId,shiftId:slot.shiftId,startsAt:slot.startsAt};
 const denied=await req('POST','/booking-holds',front,selection);
 assert.equal(denied.statusCode,403);assert.equal(denied.json().error.code,'PRIVACY_CONSENT_REQUIRED');
 const invite=data<{code:string}>(await req('POST',`/staff/patients/${patient.id}/invitations`,front,{identityVerified:true}));
 data<LoginResult>(await req('POST','/auth/register-linked',undefined,{username:'current.policy.patient',password,birthDate:adult.birthDate,consent:adultConsent,code:invite.code}));
 const allowed=await req('POST','/booking-holds',front,selection);assert.equal(allowed.statusCode,200,allowed.body);
});

test('staff intake and published shift share the same patient booking, reschedule and cancellation',async()=>{
 const patient=await intake(clinicId,front);
 const invitation=data<{code:string}>(await req('POST',`/staff/patients/${patient.id}/invitations`,front,{identityVerified:true}));
 const linked=data<LoginResult>(await req('POST','/auth/register-linked',undefined,{username:'shared.patient',password,birthDate:adult.birthDate,consent:adultConsent,code:invitation.code}));
 assert.equal(linked.user.patientId,patient.id);
 const seedShift=data<Shift[]>(await req('GET',`/shifts?clinicId=${clinicId}`,hq)).find(s=>s.status==='published')!;
 const chinaToday=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
 const day=new Date(Date.parse(chinaToday+'T00:00:00Z')+11*86400000).toISOString().slice(0,10);
 const shift=data<Shift>(await req('POST','/staff/shifts',hq,{clinicId,doctorId:seedShift.doctorId,serviceIds:[seedShift.serviceIds[0]!],startsAt:day+'T09:00:00+08:00',endsAt:day+'T12:00:00+08:00'}));
 const params=new URLSearchParams({clinicId,serviceId:shift.serviceIds[0]!,doctorId:shift.doctorId,date:day});
 const available=()=>req('GET','/booking-slots?'+params,linked).then(r=>data<BookingSlot[]>(r).filter(s=>s.shiftId===shift.id));
 const select=(slot:BookingSlot)=>({clinicId:slot.clinicId,serviceId:slot.serviceId,doctorId:slot.doctorId,chairId:slot.chairId,shiftId:slot.shiftId,startsAt:slot.startsAt});
 const slots=await available();assert.ok(slots.length>=3);
 const first=data<Hold>(await req('POST','/booking-holds',linked,select(slots[0]!)));
 const appointment=data<Appointment>(await req('POST','/appointments/confirm',linked,{holdId:first.id,holdVersion:first.rowVersion,patientConfirmed:true,rulesAccepted:true},randomUUID()));
 assert.equal(appointment.patientId,patient.id);
 const staffList=async()=>data<{items:Appointment[]}>(await req('GET','/staff/appointments?'+new URLSearchParams({clinicId,date:day,pageSize:'100'}),front)).items;
 assert.equal((await staffList()).find(a=>a.id===appointment.id)?.status,'confirmed');
 const replacementSlot=(await available()).at(-1)!;const newHold=data<Hold>(await req('POST','/booking-holds',linked,select(replacementSlot)));
 const replacement=data<Appointment>(await req('POST',`/appointments/${appointment.id}/changes`,linked,{intent:'reschedule',expectedVersion:appointment.rowVersion,reason:'合成改期',holdId:newHold.id,holdVersion:newHold.rowVersion},randomUUID()));
 const afterChange=await staffList();assert.equal(afterChange.find(a=>a.id===appointment.id)?.status,'rescheduled');assert.equal(afterChange.find(a=>a.id===replacement.id)?.status,'confirmed');
 data<Appointment>(await req('POST',`/appointments/${replacement.id}/changes`,linked,{intent:'cancel',expectedVersion:replacement.rowVersion,reason:'合成取消'},randomUUID()));
 assert.equal((await staffList()).find(a=>a.id===replacement.id)?.status,'cancelled');
 const rows=await db.query('SELECT status FROM appointments WHERE patient_id=$1 ORDER BY created_at',[patient.id]);
 assert.deepEqual(rows.rows.map(x=>x.status),['rescheduled','cancelled']);
});
