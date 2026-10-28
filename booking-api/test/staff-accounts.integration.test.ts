import assert from 'node:assert/strict';
import { after,before,test } from 'node:test';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance,HTTPMethods } from 'fastify';
import type { Pool } from 'pg';
import type { Clinic,LoginResult } from '../../shared/src/index.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { migrate,poolFor } from '../src/db.js';
import { seed } from '../src/seed.js';

const dbName=`andrew_test_${randomBytes(10).toString('hex')}`;
const seedPassword=`Seed-${randomBytes(16).toString('base64url')}!`;
const temporary=`Temporary-${randomBytes(12).toString('base64url')}!`;
const permanent=`Personal-${randomBytes(12).toString('base64url')}!`;
let admin:Pool|undefined,db:Pool,app:FastifyInstance,created=false;
let hqToken:string,frontToken:string,clinic:Clinic;
interface Account {id:string;username:string;displayName:string;active:boolean;accountVersion:number;mustChangePassword:boolean;staffId:string|null;assignments:{role:'hq'|'front'|'manager'|'doctor';clinicId:string|null}[]}
async function req(method:HTTPMethods,path:string,token?:string,payload?:object){
 return app.inject({method,url:'/api/v1'+path,headers:token?{authorization:`Bearer ${token}`}:{},...(payload?{payload}:{})});
}
function success<T>(response:Awaited<ReturnType<typeof req>>):T{assert.equal(response.statusCode,200,response.body);return response.json().data as T;}
async function login(username:string,password:string){return success<LoginResult>(await req('POST','/auth/login',undefined,{username,password,portal:'staff'}));}
async function accountById(id:string){const page=success<{items:Account[]}>(await req('GET','/staff/accounts?page=1&pageSize=100',hqToken));return page.items.find(a=>a.id===id)!;}

before(async()=>{
 const base=process.env.TEST_DATABASE_URL||process.env.DATABASE_URL;assert.ok(base,'Dedicated test database server required');
 const root=new URL(base);root.pathname='/postgres';admin=poolFor(root.toString());
 await admin.query(`CREATE DATABASE "${dbName}"`);created=true;
 const target=new URL(base);target.pathname='/'+dbName;db=poolFor(target.toString());await migrate(db);await seed(db,seedPassword);
 app=await createApp(loadConfig({NODE_ENV:'test',DATABASE_URL:target.toString(),ALLOW_DEMO_LOGIN:'false'}),db,false);await app.ready();
 hqToken=(await login('hq',seedPassword)).token;frontToken=(await login('front.a',seedPassword)).token;
 clinic=success<Clinic[]>(await req('GET','/clinics'))[0]!;
},{timeout:120_000});
after(async()=>{
 if(app)await app.close();if(db)await db.end();
 if(admin){try{if(created){assert.match(dbName,/^andrew_test_[0-9a-f]{20}$/);await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[dbName]);await admin.query(`DROP DATABASE "${dbName}"`);}}finally{await admin.end();}}
});

test('HQ creates scoped staff; temporary password gates business access until safely changed',async()=>{
 assert.equal((await req('GET','/staff/accounts',frontToken)).statusCode,403);
 assert.equal((await req('POST','/staff/accounts',frontToken,{})).statusCode,403);
 const account=success<Account>(await req('POST','/staff/accounts',hqToken,{username:'front.new',displayName:'测试前台',temporaryPassword:temporary,staffId:null,assignments:[{role:'front',clinicId:clinic.id}]}));
 assert.equal(account.mustChangePassword,true);assert.equal(account.accountVersion,1);
 assert.equal(JSON.stringify(account).includes(temporary),false);
 const initial=await login('front.new',temporary);assert.equal(initial.user.mustChangePassword,true);
 assert.equal((await req('GET','/appointments',initial.token)).json().error.code,'PASSWORD_CHANGE_REQUIRED');
 assert.equal((await req('POST','/auth/change-password',initial.token,{currentPassword:'incorrect-password',newPassword:permanent})).json().error.code,'INVALID_CURRENT_PASSWORD');
 success(await req('POST','/auth/change-password',initial.token,{currentPassword:temporary,newPassword:permanent}));
 assert.equal(success<LoginResult['user']>(await req('GET','/me',initial.token)).mustChangePassword,false);
 assert.equal((await req('GET','/shifts',initial.token)).statusCode,200);
 const current=await accountById(account.id);assert.equal(current.accountVersion,2);
 const changed=success<Account>(await req('PUT',`/staff/accounts/${account.id}`,hqToken,{displayName:'测试店长',staffId:null,active:true,assignments:[{role:'manager',clinicId:clinic.id}],expectedVersion:current.accountVersion}));
 assert.equal(changed.accountVersion,3);assert.equal((await req('GET','/me',initial.token)).statusCode,401);
 assert.equal((await req('PUT',`/staff/accounts/${account.id}`,hqToken,{displayName:'旧版本',staffId:null,active:true,assignments:[{role:'front',clinicId:clinic.id}],expectedVersion:current.accountVersion})).json().error.code,'VERSION_CONFLICT');
 const manager=await login('front.new',permanent);assert.ok(manager.user.roles.includes('manager'));
 const reset=success<Account>(await req('POST',`/staff/accounts/${account.id}/reset-password`,hqToken,{temporaryPassword:temporary,expectedVersion:changed.accountVersion}));
 assert.equal(reset.mustChangePassword,true);assert.equal((await req('GET','/me',manager.token)).statusCode,401);
 assert.equal((await req('POST','/auth/login',undefined,{username:'front.new',password:permanent,portal:'staff'})).statusCode,401);
 const afterReset=await login('front.new',temporary);assert.equal((await req('GET','/shifts',afterReset.token)).statusCode,403);
 const disabled=success<Account>(await req('PUT',`/staff/accounts/${account.id}`,hqToken,{displayName:'测试店长',staffId:null,active:false,assignments:[{role:'manager',clinicId:clinic.id}],expectedVersion:reset.accountVersion}));
 assert.equal(disabled.active,false);assert.equal((await req('GET','/me',afterReset.token)).statusCode,401);
 assert.equal((await req('POST','/auth/login',undefined,{username:'front.new',password:temporary,portal:'staff'})).statusCode,401);
 const events=await db.query("SELECT action,detail::text FROM audit_events WHERE target_id=$1 AND action LIKE 'staff.account.%' ORDER BY occurred_at",[account.id]);
 assert.deepEqual(events.rows.map(x=>x.action),['staff.account.created','staff.account.updated','staff.account.password_reset','staff.account.updated']);
 assert.ok(events.rows.every(x=>!x.detail.includes(temporary)&&!x.detail.includes(permanent)));
});

test('account management validates doctor linkage and clinic scope',async()=>{
 const missingDoctor=await req('POST','/staff/accounts',hqToken,{username:'doctor.no.profile',displayName:'测试医生',temporaryPassword:temporary,staffId:null,assignments:[{role:'doctor',clinicId:clinic.id}]});
 assert.equal(missingDoctor.statusCode,400);assert.equal(missingDoctor.json().error.code,'DOCTOR_PROFILE_REQUIRED');
 const invalidScope=await req('POST','/staff/accounts',hqToken,{username:'front.bad.scope',displayName:'测试前台',temporaryPassword:temporary,staffId:null,assignments:[{role:'front',clinicId:'00000000-0000-4000-8000-000000000001'}]});
 assert.equal(invalidScope.statusCode,400);assert.equal(invalidScope.json().error.code,'INVALID_CLINIC');
 const duplicate=await req('POST','/staff/accounts',hqToken,{username:'front.bad.duplicate',displayName:'测试前台',temporaryPassword:temporary,staffId:null,assignments:[{role:'front',clinicId:clinic.id},{role:'front',clinicId:clinic.id}]});
 assert.equal(duplicate.statusCode,400);
});

test('new doctor login is linked to its own existing doctor record and sees only its shifts',async()=>{
 const doctor=(await db.query<{id:string;clinic_id:string}>(`SELECT s.id,ds.clinic_id FROM staff s JOIN doctor_shifts ds ON ds.doctor_id=s.id WHERE s.employee_no='D002' LIMIT 1`)).rows[0]!;
 const alreadyLinked=(await db.query<{id:string}>("SELECT id FROM staff WHERE employee_no='D001'")).rows[0]!;
 const linked=await req('POST','/staff/accounts',hqToken,{username:'doctor.linked',displayName:'测试医生',temporaryPassword:temporary,staffId:alreadyLinked.id,assignments:[{role:'doctor',clinicId:doctor.clinic_id}]});
 assert.equal(linked.statusCode,409);assert.equal(linked.json().error.code,'STAFF_ALREADY_LINKED');
 const account=success<Account>(await req('POST','/staff/accounts',hqToken,{username:'doctor.new',displayName:'测试医生',temporaryPassword:temporary,staffId:doctor.id,assignments:[{role:'doctor',clinicId:doctor.clinic_id}]}));
 assert.equal(account.staffId,doctor.id);
 const loginResult=await login('doctor.new',temporary);
 success(await req('POST','/auth/change-password',loginResult.token,{currentPassword:temporary,newPassword:permanent}));
 const shifts=success<{doctorId:string}[]>(await req('GET','/shifts',loginResult.token));
 assert.ok(shifts.length>0);assert.ok(shifts.every(x=>x.doctorId===doctor.id));
 assert.equal((await req('GET','/staff/accounts',loginResult.token)).statusCode,403);
});

test('concurrent headquarters revocations cannot remove the last active HQ account',async()=>{
 const second=success<Account>(await req('POST','/staff/accounts',hqToken,{username:'hq.second',displayName:'第二总部',temporaryPassword:temporary,staffId:null,assignments:[{role:'hq',clinicId:null}]}));
 const secondLogin=await login('hq.second',temporary);success(await req('POST','/auth/change-password',secondLogin.token,{currentPassword:temporary,newPassword:permanent}));
 const first=success<{items:Account[]}>(await req('GET','/staff/accounts?page=1&pageSize=100',hqToken)).items.find(a=>a.username==='hq')!;
 const secondUpdated=await accountById(second.id);
 const asBody=(a:Account)=>({displayName:a.displayName,staffId:a.staffId,active:false,assignments:a.assignments,expectedVersion:a.accountVersion});
 const results=await Promise.all([req('PUT',`/staff/accounts/${second.id}`,hqToken,asBody(secondUpdated)),req('PUT',`/staff/accounts/${first.id}`,secondLogin.token,asBody(first))]);
 assert.equal(results.filter(r=>r.statusCode===200).length,1,results.map(r=>r.body).join('\n'));
 assert.ok(results.some(r=>[401,403,409].includes(r.statusCode)));
 const count=await db.query("SELECT count(*)::int AS n FROM users u JOIN role_assignments r ON r.user_id=u.id WHERE u.active AND r.role='hq'");
 assert.equal(count.rows[0].n,1);
});
