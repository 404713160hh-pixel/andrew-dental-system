import assert from 'node:assert/strict';
import { before,after,test } from 'node:test';
import { randomBytes,createHash } from 'node:crypto';
import { readdir,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance,HTTPMethods } from 'fastify';
import type { Pool } from 'pg';
import type { LoginResult,StaffProfile,IncentiveMonth,IncentiveQuarterDetail,IncentivePayment,FinancialSourceInput,MyCompensation,Doctor } from '../../shared/src/index.js';
import { createApp } from '../src/app.js';
import { poolFor,migrate,transaction } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import { seed } from '../src/seed.js';
import { projectRoot } from '../src/paths.js';
import { allocateIncentive } from '../src/compensation.js';

const dbName=`andrew_test_${randomBytes(10).toString('hex')}`;
const password=`Synthetic-${randomBytes(16).toString('base64url')}!`;
let admin:Pool,db:Pool,app:FastifyInstance,created=false;
let maker:LoginResult,reviewer:LoginResult,manager:LoginResult,front:LoginResult,doctor:LoginResult,patient:LoginResult;
let clinics:{id:string;name:string}[],doctors:{id:string;employee_no:string;name:string}[];
let profiles:StaffProfile[],pool:IncentiveQuarterDetail;
let originalStaff:unknown,originalAppointments:unknown;
const suffix=randomBytes(5).toString('hex');
async function req(method:HTTPMethods,path:string,token?:string,payload?:unknown){return app.inject({method,url:'/api/v1'+path,headers:token?{authorization:'Bearer '+token}:{},...(payload===undefined?{}:{payload:payload as object})});}
function ok<T>(r:Awaited<ReturnType<typeof req>>):T{assert.equal(r.statusCode,200,r.body);return r.json().data as T;}
async function login(username:string,portal='staff'){return ok<LoginResult>(await req('POST','/auth/login',undefined,{username,password,portal}));}
async function profileFor(user:LoginResult,no:string){return ok<StaffProfile>(await req('POST','/staff/profiles',maker.token,{employeeNo:no,name:'合成员工 '+no,phone:'020-00000000',specialty:'合成测试',active:true,userId:user.user.id,birthDate:null,homeAddress:null,email:null}));}
const financial=(doctorId:string,revenueCents:number,materialCostCents=0,operatingExpenseCents=0):FinancialSourceInput=>({doctorId,revenueCents,materialCostCents,operatingExpenseCents,revenueReference:'合成收入凭据 '+suffix,materialReference:'合成用品凭据 '+suffix,expenseReference:'合成费用凭据 '+suffix});
async function createMonth(month:string,clinicId:string,rows:FinancialSourceInput[]=[],token=maker.token){return ok<IncentiveMonth>(await req('POST','/compensation/months',token,{clinicId,month,reference:'合成账证核对 '+suffix,noActivity:rows.length===0,rows}));}
async function closeMonth(month:IncentiveMonth,token=reviewer.token){return ok<IncentiveMonth>(await req('POST',`/compensation/months/${month.id}/close`,token,{expectedVersion:month.rowVersion}));}
async function createQuarter(quarter:string,rowFactory:(clinicIndex:number,monthIndex:number)=>FinancialSourceInput[]){
 const q=Number(quarter.at(-1)),year=quarter.slice(0,4);for(let ci=0;ci<clinics.length;ci++)for(let mi=0;mi<3;mi++){const month=`${year}-${String((q-1)*3+mi+1).padStart(2,'0')}`;await closeMonth(await createMonth(month,clinics[ci]!.id,rowFactory(ci,mi)));}
 return ok<IncentiveQuarterDetail>(await req('POST','/compensation/quarters',maker.token,{quarter,reference:'合成季度账证 '+suffix}));
}
async function latestPool(){return ok<IncentiveQuarterDetail>(await req('GET',`/compensation/quarters/${pool.id}`,maker.token));}

before(async()=>{
 const base=process.env.TEST_DATABASE_URL||process.env.DATABASE_URL;assert.ok(base,'Isolated PostgreSQL test URL required');
 const root=new URL(base);root.pathname='/postgres';admin=poolFor(root.toString());await admin.query(`CREATE DATABASE "${dbName}"`);created=true;
 const url=new URL(base);url.pathname='/'+dbName;db=poolFor(url.toString());
 // Exercise a real upgrade from the seven existing migrations, preserving data.
 await db.query('CREATE TABLE schema_migrations(version text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
 const dir=join(projectRoot,'database','migrations');for(const file of (await readdir(dir)).filter(f=>f.endsWith('.sql')&&f<'008_').sort()){const sql=await readFile(join(dir,file),'utf8');await db.query(sql);await db.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)',[file,createHash('sha256').update(sql).digest('hex')]);}
 await seed(db,password);
 await transaction(db,async tx=>{
  const r=(await tx.query(`SELECT ds.id AS shift,ds.clinic_id,ds.doctor_id,ds.starts_at,c.id AS chair,p.id AS patient,u.id AS actor,v.id AS service FROM doctor_shifts ds JOIN chairs c ON c.clinic_id=ds.clinic_id CROSS JOIN patients p CROSS JOIN users u CROSS JOIN services v WHERE ds.status='published' AND u.username='hq' ORDER BY ds.starts_at LIMIT 1`)).rows[0]!;
  const rid=(await tx.query(`INSERT INTO resource_reservations(patient_id,clinic_id,service_id,doctor_id,chair_id,shift_id,starts_at,ends_at,occupied_until,status) VALUES($1,$2,$3,$4,$5,$6,$7,$7::timestamptz+interval '30 min',$7::timestamptz+interval '40 min','booked') RETURNING id`,[r.patient,r.clinic_id,r.service,r.doctor_id,r.chair,r.shift,r.starts_at])).rows[0].id;
  const hold=(await tx.query(`INSERT INTO booking_holds(reservation_id,created_by,expires_at,consumed_at) VALUES($1,$2,now()+interval '5 minutes',now()) RETURNING id`,[rid,r.actor])).rows[0].id;
  await tx.query(`INSERT INTO appointments(appointment_no,patient_id,reservation_id,hold_id,service_name,price_cents,created_by) VALUES($1,$2,$3,$4,'合成升级前预约',5000,$5)`,['MIGRATION-'+suffix,r.patient,rid,hold,r.actor]);
 });
 originalStaff=(await db.query('SELECT to_jsonb(s) AS value FROM staff s ORDER BY id')).rows;
 originalAppointments=(await db.query('SELECT to_jsonb(a) AS value FROM appointments a ORDER BY id')).rows;
 assert.deepEqual(await migrate(db),['008_staff_compensation.sql','009_patient_avatars.sql']);
 app=await createApp(loadConfig({NODE_ENV:'test',DATABASE_URL:url.toString(),ALLOW_DEMO_LOGIN:'false'}),db);await app.ready();
 maker=await login('hq');manager=await login('manager.a');front=await login('front.a');doctor=await login('doctor.a');patient=await login('patient.a','patient');
 clinics=(await db.query('SELECT id,name FROM clinics ORDER BY id')).rows;doctors=(await db.query('SELECT id,employee_no,name FROM staff WHERE is_dentist ORDER BY employee_no')).rows;
 const createdReviewer=ok<{id:string}>(await req('POST','/staff/accounts',maker.token,{username:'reviewer.'+suffix,displayName:'合成复核人',temporaryPassword:password,staffId:null,assignments:[{role:'hq',clinicId:null}]}));
 reviewer=ok<LoginResult>(await req('POST','/auth/login',undefined,{username:'reviewer.'+suffix,password,portal:'staff'}));
 // Temporary credentials gate all non-account endpoints until changed.
 const permanent=password+'changed';ok(await req('POST','/auth/change-password',reviewer.token,{currentPassword:password,newPassword:permanent}));
 reviewer.user.id=createdReviewer.id;
 profiles=[await profileFor(maker,'H001'),await profileFor(reviewer,'H002'),await profileFor(manager,'M001')];
},{timeout:120000});
after(async()=>{if(app)await app.close();if(db)await db.end();if(admin){try{if(created){assert.match(dbName,/^andrew_test_[0-9a-f]{20}$/);await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[dbName]);await admin.query(`DROP DATABASE "${dbName}"`);}}finally{await admin.end();}}});

test('migration preserves existing staff identity and confirmed appointments; new private fields start unknown',async()=>{
 assert.deepEqual((await db.query("SELECT to_jsonb(s)-'birth_date'-'home_address'-'email' AS value FROM staff s WHERE employee_no IN ('D001','D002') ORDER BY id")).rows,originalStaff);
 assert.deepEqual((await db.query('SELECT to_jsonb(a) AS value FROM appointments a ORDER BY id')).rows,originalAppointments);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM staff WHERE is_dentist AND (birth_date IS NOT NULL OR home_address IS NOT NULL OR email IS NOT NULL)')).rows[0].n,0);
 assert.deepEqual(await migrate(db),[]);
});
test('staff profiles support non-doctor identity, protect patient accounts and duplicate account linkage',async()=>{
 assert.equal((await req('GET','/staff/profiles',front.token)).statusCode,403);
 const self=ok<StaffProfile[]>(await req('GET','/staff/profiles',maker.token)).find(p=>p.userId===maker.user.id)!;assert.equal(self.isDentist,false);
 assert.equal(ok<LoginResult['user']>(await req('GET','/me',maker.token)).staffId,self.id);
 for(const [target,code] of [[patient.user.id,'INVALID_STAFF_ACCOUNT'],[maker.user.id,'STAFF_ALREADY_LINKED']] as const){const r=await req('POST','/staff/profiles',maker.token,{employeeNo:'X'+target,name:'合成非法关联',phone:'020-00000000',specialty:'',active:true,userId:target});assert.equal(r.json().error.code,code,r.body);}
 const changed=ok<StaffProfile>(await req('PUT','/staff/profiles/'+self.id,maker.token,{employeeNo:self.employeeNo,name:self.name,phone:self.phone,specialty:self.specialty,active:true,userId:self.userId,expectedVersion:self.rowVersion,birthDate:'1990-01-01',homeAddress:'合成家庭地址',email:'synthetic@example.invalid'}));
 const preserved=ok<StaffProfile>(await req('PUT','/staff/profiles/'+self.id,maker.token,{employeeNo:self.employeeNo,name:self.name,phone:self.phone,specialty:self.specialty,active:true,userId:self.userId,expectedVersion:changed.rowVersion}));assert.equal(preserved.birthDate,'1990-01-01');assert.equal(preserved.homeAddress,'合成家庭地址');
 assert.equal((await req('PUT','/staff/profiles/'+doctors[0]!.id,maker.token,{employeeNo:'D001',name:'医生',phone:'020-00000000',specialty:'',active:true,userId:null,expectedVersion:1})).json().error.code,'DOCTOR_RESOURCE_REQUIRED');
});
test('doctors with future bookings can maintain private fields and internal qualifications while remaining active',async()=>{
 const existing=(await db.query('SELECT r.doctor_id FROM appointments a JOIN resource_reservations r ON r.id=a.reservation_id LIMIT 1')).rows[0]!;
 const record=ok<Doctor[]>(await req('GET','/doctors?includeInactive=true',maker.token)).find(d=>d.id===existing.doctor_id)!;
 const body={employeeNo:record.employeeNo,name:record.name,phone:record.phone,specialty:record.specialty,active:record.active,qualifications:record.qualifications.map(q=>({qualificationId:q.qualificationId,validFrom:q.validFrom,validUntil:q.validUntil})),expectedVersion:record.rowVersion,birthDate:'1988-03-14',homeAddress:'合成医生家庭住址',email:'doctor-private@example.invalid'};
 const updated=ok<Doctor>(await req('PUT','/staff/doctors/'+record.id,maker.token,body));assert.equal(updated.birthDate,'1988-03-14');assert.equal(updated.homeAddress,'合成医生家庭住址');
 assert.equal((await req('PUT','/staff/doctors/'+record.id,maker.token,{...body,expectedVersion:updated.rowVersion,active:false})).json().error.code,'FUTURE_BOOKINGS_EXIST');
 const archived=ok<Doctor>(await req('PUT','/staff/doctors/'+record.id,maker.token,{...body,expectedVersion:updated.rowVersion,qualifications:[]}));assert.deepEqual(archived.qualifications,[]);assert.equal(archived.active,true);
 for(const token of [undefined,manager.token,doctor.token]){const publicRows=ok<Record<string,unknown>[]>(await req('GET','/doctors',token));assert.ok(publicRows.length);assert.ok(publicRows.every(d=>!['employeeNo','phone','birthDate','homeAddress','email'].some(key=>key in d)));}
});
test('month sources require past periods, independent employee review, creator ownership and scoped access',async()=>{
 const month=await createMonth('2024-01',clinics[0]!.id,[financial(doctors[0]!.id,100)]);
 assert.equal((await req('POST',`/compensation/months/${month.id}/close`,maker.token,{expectedVersion:1})).json().error.code,'INDEPENDENT_REVIEW_REQUIRED');
 const input={clinicId:month.clinicId,month:month.month,reference:'修改来源',noActivity:false,rows:[financial(doctors[0]!.id,200)],expectedVersion:1};
 assert.equal((await req('PUT','/compensation/months/'+month.id,reviewer.token,input)).json().error.code,'DRAFT_OWNER_REQUIRED');
 const updated=ok<IncentiveMonth>(await req('PUT','/compensation/months/'+month.id,maker.token,input));assert.equal(updated.sourceRevision,2);assert.equal((await db.query('SELECT count(*)::int AS n FROM doctor_financial_sources WHERE month_id=$1',[month.id])).rows[0].n,2);
 const closed=await closeMonth(updated);assert.equal(closed.status,'closed');
 assert.equal((await req('PUT','/compensation/months/'+month.id,maker.token,{...input,expectedVersion:closed.rowVersion})).json().error.code,'MONTH_CLOSED');
 const nowMonth=new Date(Date.now()+8*3600000).toISOString().slice(0,7);
 assert.equal((await req('POST','/compensation/months',maker.token,{...input,month:nowMonth,expectedVersion:undefined})).json().error.code,'PERIOD_NOT_ENDED');
 const managerScope=manager.user.assignments.find(a=>a.role==='manager')!.clinicId!;const foreign=clinics.find(c=>c.id!==managerScope)!;
 assert.equal((await req('GET','/compensation/months?clinicId='+foreign.id,manager.token)).statusCode,403);assert.equal((await req('GET','/compensation/context',front.token)).statusCode,403);assert.equal((await req('GET','/compensation/me',patient.token)).statusCode,403);
 await assert.rejects(db.query('UPDATE doctor_financial_sources SET revenue_cents=0 WHERE month_id=$1',[month.id]),/Append-only/);
});
test('month close cannot silently omit a dentist who had a published shift',async()=>{
 const shift=(await db.query('SELECT * FROM doctor_shifts ORDER BY starts_at LIMIT 1')).rows[0]!;
 await db.query(`INSERT INTO doctor_shifts(clinic_id,doctor_id,starts_at,ends_at,created_by) VALUES($1,$2,'2024-02-10T09:00:00+08:00','2024-02-10T10:00:00+08:00',$3)`,[clinics[0]!.id,shift.doctor_id,maker.user.id]);
 const m=await createMonth('2024-02',clinics[0]!.id,[]);const r=await req('POST',`/compensation/months/${m.id}/close`,reviewer.token,{expectedVersion:m.rowVersion});assert.equal(r.json().error.code,'DOCTOR_SOURCE_INCOMPLETE');
 const amended=ok<IncentiveMonth>(await req('PUT','/compensation/months/'+m.id,maker.token,{clinicId:m.clinicId,month:m.month,reference:'明确无收入及成本的账证',noActivity:false,rows:[financial(shift.doctor_id,0)],expectedVersion:m.rowVersion}));assert.equal((await closeMonth(amended)).status,'closed');
});
test('moving the same employee to a new account cannot bypass independent review',async()=>{
 const username='same.person.'+suffix;
 const account=ok<{id:string}>(await req('POST','/staff/accounts',maker.token,{username,displayName:'合成同一员工新账号',temporaryPassword:password,staffId:null,assignments:[{role:'hq',clinicId:null}]}));
 const next=ok<LoginResult>(await req('POST','/auth/login',undefined,{username,password,portal:'staff'}));ok(await req('POST','/auth/change-password',next.token,{currentPassword:password,newPassword:password+'next'}));
 assert.equal((await req('POST','/compensation/months',next.token,{clinicId:clinics[0]!.id,month:'2024-03',reference:'尚未关联员工',noActivity:true,rows:[]})).json().error.code,'STAFF_IDENTITY_REQUIRED');
 const m=await createMonth('2024-03',clinics[0]!.id);
 let old=ok<StaffProfile[]>(await req('GET','/staff/profiles',maker.token)).find(p=>p.userId===maker.user.id)!;
 const body=(p:StaffProfile,userId:string)=>({employeeNo:p.employeeNo,name:p.name,phone:p.phone,specialty:p.specialty,active:true,userId,expectedVersion:p.rowVersion});
 old=ok<StaffProfile>(await req('PUT','/staff/profiles/'+old.id,reviewer.token,body(old,account.id)));
 assert.equal((await req('POST','/compensation/months/'+m.id+'/close',next.token,{expectedVersion:m.rowVersion})).json().error.code,'INDEPENDENT_REVIEW_REQUIRED');
 ok(await req('PUT','/staff/profiles/'+old.id,reviewer.token,body(old,maker.user.id)));
 assert.equal((await closeMonth(m)).status,'closed');
});
test('quarter requires every registered clinic month; merges losses before the ten-percent fund and positive weights',async()=>{
 const now=new Date(Date.now()+8*3600000);const currentQuarter=now.getUTCFullYear()+'-Q'+(Math.floor(now.getUTCMonth()/3)+1);
 assert.equal((await req('POST','/compensation/quarters',maker.token,{quarter:currentQuarter,reference:'季度未结束'})).json().error.code,'PERIOD_NOT_ENDED');
 assert.equal((await req('POST','/compensation/quarters',maker.token,{quarter:'2025-Q1',reference:'来源未全'})).json().error.code,'MONTHS_INCOMPLETE');
 pool=await createQuarter('2025-Q1',(ci,mi)=>mi!==0?[]:ci===0?[financial(doctors[0]!.id,12000),financial(doctors[1]!.id,10000)]:[financial(doctors[0]!.id,-15000)]);
 assert.equal(pool.netProfitCents,7000);assert.equal(pool.fundCents,700);assert.equal(pool.months.length,clinics.length*3);
 const loser=pool.allocations.find(a=>a.doctorId===doctors[0]!.id)!;assert.equal(loser.contributionCents,-3000);assert.equal(loser.weightCents,0);assert.equal(loser.amountCents,0);
 assert.equal(pool.allocations.find(a=>a.doctorId===doctors[1]!.id)!.amountCents,700);
 assert.equal((await req('POST','/compensation/quarters',maker.token,{quarter:'2025-Q1',reference:'重复季度'})).statusCode,409);
 assert.equal((await req('POST','/compensation/months/'+pool.months[0]!.monthId+'/reopen',maker.token,{expectedVersion:2,reason:'不能改冻结来源'})).json().error.code,'MONTH_SNAPSHOT_LOCKED');
 assert.equal((await req('GET','/compensation/quarters/'+pool.id,manager.token)).statusCode,403);
 pool=ok<IncentiveQuarterDetail>(await req('POST','/compensation/quarters/'+pool.id+'/submit',maker.token,{expectedVersion:pool.rowVersion}));
 assert.equal((await req('POST','/compensation/quarters/'+pool.id+'/approve',maker.token,{expectedVersion:pool.rowVersion})).json().error.code,'INDEPENDENT_REVIEW_REQUIRED');
 pool=ok<IncentiveQuarterDetail>(await req('POST','/compensation/quarters/'+pool.id+'/approve',reviewer.token,{expectedVersion:pool.rowVersion}));assert.equal(pool.status,'approved');
 assert.equal((await req('POST','/compensation/quarters/'+pool.id+'/void',maker.token,{expectedVersion:pool.rowVersion,reason:'已批准不能覆盖'})).json().error.code,'STATUS_CONFLICT');
});
test('largest remainder is deterministic at one cent and loss-making quarters allocate zero',async()=>{
 const tied=allocateIncentive([{doctorId:'b',doctorName:'乙',employeeNo:'D002',contribution:5n},{doctorId:'a',doctorName:'甲',employeeNo:'D001',contribution:5n}]);assert.equal(tied.fund,1n);assert.equal(tied.rows.find(r=>r.doctorId==='a')!.amount,1n);assert.equal(tied.rows.reduce((n,r)=>n+r.amount,0n),tied.fund);
 const loss=allocateIncentive([{doctorId:'b',doctorName:'乙',employeeNo:'D002',contribution:100n},{doctorId:'a',doctorName:'甲',employeeNo:'D001',contribution:-200n}]);assert.equal(loss.fund,0n);assert.equal(loss.rows.reduce((n,r)=>n+r.amount,0n),0n);
 const huge=allocateIncentive([{doctorId:'x',doctorName:'丙',employeeNo:'D003',contribution:999999999999n},{doctorId:'y',doctorName:'丁',employeeNo:'D004',contribution:777777777777n}]);assert.equal(huge.rows.reduce((n,r)=>n+r.amount,0n),huge.fund);
});
test('pending payments reserve approved allowance; replay, concurrency, terminal results and globally unique evidence are safe',async()=>{
 let share=pool.allocations.find(a=>a.doctorId===doctors[1]!.id)!;
 const input={expectedVersion:share.rowVersion,amountCents:500,reference:'PAY-INITIAL-'+suffix};const first=ok<IncentivePayment>(await req('POST',`/compensation/allocations/${share.id}/payments`,maker.token,input));
 assert.equal(first.status,'pending');assert.equal(ok<IncentivePayment>(await req('POST',`/compensation/allocations/${share.id}/payments`,maker.token,input)).id,first.id);
 share=(await latestPool()).allocations.find(a=>a.id===share.id)!;
 const attempts=await Promise.all(['A','B'].map(tag=>req('POST',`/compensation/allocations/${share.id}/payments`,maker.token,{expectedVersion:share.rowVersion,amountCents:200,reference:'PAY-RACE-'+tag+suffix})));assert.equal(attempts.filter(r=>r.statusCode===200).length,1,attempts.map(r=>r.body).join('\n'));
 let current=await latestPool();share=current.allocations.find(a=>a.id===share.id)!;assert.equal(share.pendingCents,700);assert.equal(share.remainingCents,0);
 assert.equal((await req('POST',`/compensation/allocations/${share.id}/payments`,maker.token,{expectedVersion:share.rowVersion,amountCents:1,reference:'PAY-EXCESS-'+suffix})).json().error.code,'ALLOCATION_EXCEEDED');
 const failed=ok<IncentivePayment>(await req('POST',`/compensation/payments/${first.id}/resolve`,maker.token,{expectedVersion:first.rowVersion,status:'failed',reference:'BANK-FAILED-'+suffix}));assert.equal(failed.status,'failed');
 assert.equal(ok<IncentivePayment>(await req('POST',`/compensation/payments/${first.id}/resolve`,maker.token,{expectedVersion:first.rowVersion,status:'failed',reference:'BANK-FAILED-'+suffix})).id,first.id);
 assert.equal((await req('POST',`/compensation/payments/${first.id}/resolve`,maker.token,{expectedVersion:failed.rowVersion,status:'succeeded',reference:'BANK-OTHER-'+suffix})).json().error.code,'PAYMENT_FINAL');
 current=await latestPool();share=current.allocations.find(a=>a.id===share.id)!;assert.equal(share.remainingCents,500);
 assert.equal((await req('POST',`/compensation/allocations/${share.id}/payments`,maker.token,{expectedVersion:share.rowVersion,amountCents:100,reference:'BANK-FAILED-'+suffix})).json().error.code,'PAYMENT_REFERENCE_CONFLICT');
 const second=ok<IncentivePayment>(await req('POST',`/compensation/allocations/${share.id}/payments`,maker.token,{expectedVersion:share.rowVersion,amountCents:400,reference:'PAY-SECOND-'+suffix}));
 const pending=(await latestPool()).payments.find(p=>p.status==='pending'&&p.id!==second.id)!;
 assert.equal((await req('POST',`/compensation/payments/${second.id}/resolve`,maker.token,{expectedVersion:1,status:'succeeded',reference:pending.reference})).statusCode,409);
 ok(await req('POST',`/compensation/payments/${pending.id}/resolve`,maker.token,{expectedVersion:pending.rowVersion,status:'succeeded',reference:'BANK-SUCCEEDED-'+suffix}));
 current=await latestPool();share=current.allocations.find(a=>a.id===share.id)!;assert.equal(share.paidCents,200);assert.equal(share.pendingCents,400);assert.equal(share.remainingCents,100);
 const sum=(await db.query("SELECT coalesce(sum(amount_cents),0)::text AS n FROM incentive_payments WHERE allocation_id=$1 AND status IN ('pending','succeeded')",[share.id])).rows[0].n;assert.equal(sum,'600');
});
test('only approved own allocations appear to employees; drafts and other doctors remain private',async()=>{
 const me=ok<MyCompensation>(await req('GET','/compensation/me',doctor.token));assert.ok(me.allocations.length>0);assert.ok(me.allocations.every(a=>a.doctorId===doctor.user.staffId));assert.equal(me.allocations.find(a=>a.poolId===pool.id)!.amountCents,0);
 assert.equal((await req('GET','/compensation/quarters',doctor.token)).statusCode,403);assert.equal((await req('POST',`/compensation/allocations/${pool.allocations[0]!.id}/payments`,doctor.token,{expectedVersion:1,amountCents:1,reference:'DENIED'})).statusCode,403);
 const unlinked=ok<MyCompensation>(await req('GET','/compensation/me',front.token));assert.equal(unlinked.staffId,null);assert.ok(unlinked.notice);assert.deepEqual(unlinked.allocations,[]);
});
test('voiding an unapproved snapshot preserves historical financial rows and permits an auditable correction',async()=>{
 const draft=await createQuarter('2025-Q2',(ci,mi)=>ci===0&&mi===0?[financial(doctors[0]!.id,25)]:[]);
 const first=draft.months.find(m=>m.rows.length)!;assert.equal(first.rows[0]!.revenueCents,25);
 const voided=ok<IncentiveQuarterDetail>(await req('POST','/compensation/quarters/'+draft.id+'/void',maker.token,{expectedVersion:draft.rowVersion,reason:'合成账证更正'}));assert.equal(voided.status,'voided');
 const current=ok<IncentiveMonth[]>(await req('GET','/compensation/months?quarter=2025-Q2',maker.token)).find(m=>m.id===first.monthId)!;
 const reopened=ok<IncentiveMonth>(await req('POST','/compensation/months/'+current.id+'/reopen',maker.token,{expectedVersion:current.rowVersion,reason:'合成重开'}));
 const amended=ok<IncentiveMonth>(await req('PUT','/compensation/months/'+current.id,maker.token,{clinicId:current.clinicId,month:current.month,reference:'修订后的合成账证',noActivity:false,rows:[financial(doctors[0]!.id,100)],expectedVersion:reopened.rowVersion}));assert.equal(amended.sourceRevision,2);
 const old=ok<IncentiveQuarterDetail>(await req('GET','/compensation/quarters/'+draft.id,maker.token));assert.equal(old.months.find(m=>m.monthId===first.monthId)!.rows[0]!.revenueCents,25);
 await closeMonth(amended);const replacement=ok<IncentiveQuarterDetail>(await req('POST','/compensation/quarters',maker.token,{quarter:'2025-Q2',reference:'合成替代快照'}));assert.notEqual(replacement.id,draft.id);assert.equal(replacement.netProfitCents,100);assert.equal(replacement.fundCents,10);
});
