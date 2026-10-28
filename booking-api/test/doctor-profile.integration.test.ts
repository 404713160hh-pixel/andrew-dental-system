import assert from 'node:assert/strict';
import { after,before,test } from 'node:test';
import { randomBytes,randomUUID } from 'node:crypto';
import type { FastifyInstance,HTTPMethods } from 'fastify';
import type { Pool } from 'pg';
import type { BookingSlot,Doctor,Hold,LoginResult,Shift } from '../../shared/src/index.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { migrate,poolFor } from '../src/db.js';
import { seed } from '../src/seed.js';

const dbName=`andrew_test_${randomBytes(10).toString('hex')}`;
const password=`OnlySynthetic-${randomBytes(20).toString('base64url')}`;
let admin:Pool|undefined,db:Pool,app:FastifyInstance,production:FastifyInstance,created=false;
let hq:string,front:string,patient:string,doctor:Doctor;
async function req(target:FastifyInstance,method:HTTPMethods,path:string,token?:string,payload?:object,key?:string){
 return target.inject({method,url:'/api/v1'+path,headers:{...(token?{authorization:`Bearer ${token}`} : {}),...(key?{'idempotency-key':key}:{})},...(payload?{payload}:{})});
}
function data<T>(r:Awaited<ReturnType<typeof req>>):T{assert.equal(r.statusCode,200,r.body);return r.json().data as T;}
before(async()=>{
 const base=process.env.TEST_DATABASE_URL||process.env.DATABASE_URL;assert.ok(base,'A local PostgreSQL test server is required');
 const root=new URL(base);assert.ok(['localhost','127.0.0.1','[::1]'].includes(root.hostname),'Remote test database forbidden');
 root.pathname='/postgres';admin=poolFor(root.toString());await admin.query(`CREATE DATABASE "${dbName}"`);created=true;
 const target=new URL(base);target.pathname='/'+dbName;db=poolFor(target.toString());await migrate(db);await seed(db,password);
 app=await createApp(loadConfig({NODE_ENV:'test',DATABASE_URL:target.toString(),ALLOW_DEMO_LOGIN:'false'}),db,false);await app.ready();
 production=await createApp(loadConfig({NODE_ENV:'production',DATABASE_URL:target.toString(),ALLOW_DEMO_LOGIN:'false',PRIVACY_CONTROLLER_NAME:'合成测试机构',PRIVACY_CONTACT:'合成测试联系方式',PRIVACY_RETENTION:'测试环境'}),db,false);await production.ready();
 for(const [name,portal] of [['hq','staff'],['front.a','staff'],['patient.a','patient']] as const){
  const login=data<LoginResult>(await req(app,'POST','/auth/login',undefined,{username:name,password,portal}));
  if(name==='hq')hq=login.token;else if(name==='front.a')front=login.token;else patient=login.token;
 }
 const shifts=data<Shift[]>(await req(app,'GET','/shifts',hq));
 const shift=shifts.find(s=>s.status==='published'&&s.serviceIds.length)!;assert.ok(shift);
 doctor=data<Doctor[]>(await req(app,'GET','/doctors?includeInactive=true',hq)).find(d=>d.id===shift.doctorId)!;assert.ok(doctor);
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(shift.startsAt));
 const qs=new URLSearchParams({clinicId:shift.clinicId,serviceId:shift.serviceIds[0]!,doctorId:shift.doctorId,date});
 const slot=data<BookingSlot[]>(await req(app,'GET','/booking-slots?'+qs)).find(s=>s.shiftId===shift.id);assert.ok(slot,'seed shift must expose a real slot');
 const hold=data<Hold>(await req(app,'POST','/booking-holds',patient,{clinicId:slot.clinicId,serviceId:slot.serviceId,doctorId:slot.doctorId,chairId:slot.chairId,shiftId:slot.shiftId,startsAt:slot.startsAt}));
 data(await req(app,'POST','/appointments/confirm',patient,{holdId:hold.id,holdVersion:hold.rowVersion,patientConfirmed:true,rulesAccepted:true},randomUUID()));
}, {timeout:120000});
after(async()=>{
 if(production)await production.close();if(app)await app.close();if(db)await db.end();
 if(admin){try{if(created){assert.match(dbName,/^andrew_test_[a-f0-9]{20}$/);await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[dbName]);await admin.query(`DROP DATABASE "${dbName}"`);}}finally{await admin.end();}}
});

test('only HQ updates the public profile, even when an appointment already exists; updates are versioned and audited',async()=>{
 const path=`/staff/doctors/${doctor.id}/profile`,body={expectedVersion:doctor.rowVersion,bio:'经机构核对的测试简介',focusAreas:['合成项目 A','合成项目 B']};
 assert.equal((await req(app,'PUT',path,undefined,body)).statusCode,401);
 assert.equal((await req(app,'PUT',path,front,body)).statusCode,403);
 assert.equal((await req(app,'PUT',path,patient,body)).statusCode,403);
 const saved=data<Doctor>(await req(app,'PUT',path,hq,body));
 assert.equal(saved.rowVersion,doctor.rowVersion+1);assert.equal(saved.bio,body.bio);assert.deepEqual(saved.focusAreas,body.focusAreas);
 const outdated=await req(app,'PUT',path,hq,body);assert.equal(outdated.statusCode,409);assert.equal(outdated.json().error.code,'VERSION_CONFLICT');
 const duplicate=await req(app,'PUT',path,hq,{...body,expectedVersion:saved.rowVersion,focusAreas:['重复','重复']});assert.equal(duplicate.statusCode,400);
 const publicDoctors=data<Record<string,unknown>[]>(await req(app,'GET','/doctors'));
 const visible=publicDoctors.find(row=>row.id===doctor.id)!;assert.equal(visible.bio,body.bio);assert.ok(!('phone' in visible));assert.ok(!('employeeNo' in visible));
 const log=await db.query("SELECT action,detail FROM audit_events WHERE target_id=$1 AND action='doctor.public_profile.updated'",[doctor.id]);
 assert.equal(log.rowCount,1);assert.deepEqual(log.rows[0].detail.fields,['bio','focusAreas']);
});

test('unverified price references are hidden in production and remain available to the demo environment',async()=>{
 await db.query(`INSERT INTO treatment_references(reference_code,category,name,price_min_cents,price_max_cents,unit,reference_year,source_label,description,sort_order)
  VALUES('test-unverified','合成','参考示例',100,200,'次',2026,'用户提供，未核验','仅用于测试',1)`);
 const demo=data<unknown[]>(await req(app,'GET','/treatment-references'));assert.equal(demo.length,1);
 const published=data<unknown[]>(await req(production,'GET','/treatment-references'));assert.deepEqual(published,[]);
});
