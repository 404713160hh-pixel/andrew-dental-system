import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from '../server/index.js';
import { createDatabase } from '../server/db.js';

test('HTTP engineering contracts use isolated storage: pages, replay protection, account lifecycle and recovery',async t=>{
  const db=createDatabase(':memory:'),app=await start({db,port:0}),base=`http://127.0.0.1:${app.address.port}`;
  t.after(async()=>{await app.close();db.close();});
  const request=async(path,{method='GET',payload,session,key}={})=>{
    const headers={'Content-Type':'application/json',...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrfToken}:{}),...(key?{'Idempotency-Key':key}:{})};
    const response=await fetch(base+path,{method,headers,...(payload?{body:JSON.stringify(payload)}:{})});
    return{status:response.status,data:await response.json(),headers:response.headers};
  };
  const login=async(username,portal,password='Dental2026!')=>{
    const response=await request('/api/login',{method:'POST',payload:{username,password,portal}});assert.equal(response.status,200,JSON.stringify(response.data));
    return{...response.data,cookie:response.headers.get('set-cookie').split(';')[0]};
  };
  const command=(session,type,payload,key)=>request('/api/command',{method:'POST',session,key,payload:{type,payload}});
  const customer=await login('chen','customer'),front=await login('front','front'),hq=await login('hq','hq');

  await t.test('workspace is authorized, bounded, page specific and includes business extensions',async()=>{
    const first=await request('/api/workspace?page=patients&limit=1&offset=0',{session:hq}),second=await request('/api/workspace?page=patients&limit=1&offset=1',{session:hq});
    assert.equal(first.status,200);assert.equal(first.data.patients.length,1);assert.equal(first.data.pagination.total,3);assert.notEqual(first.data.patients[0].id,second.data.patients[0].id);assert.equal(first.data.visits.length,0);
    assert.equal((await request('/api/workspace?page=patients&limit=101',{session:hq})).status,400);
    assert.equal((await request('/api/workspace?page=patients',{session:customer})).status,403);
    const customerInvoices=await request('/api/workspace?page=settlements&patientId=P002',{session:customer});assert.equal(customerInvoices.status,200);assert.ok(customerInvoices.data.settlements.every(s=>s.patientId==='P001'));assert.equal(customerInvoices.data.financeSummaries[0].settlementId,'INV-V001');
    const accounts=await request('/api/workspace?page=accounts&limit=1',{session:hq});assert.equal(accounts.status,200);assert.equal(accounts.data.accounts.length,1);assert.equal(accounts.data.pagination.entity,'accounts');assert.ok(accounts.data.clinics.length);assert.equal(JSON.stringify(accounts.data).includes('password_hash'),false);
    assert.equal((await request('/api/workspace?page=accounts',{session:front})).status,403);
    assert.match(accounts.headers.get('x-request-id'),/^[a-f0-9-]{36}$/);
  });

  await t.test('same HTTP and finance key replays one receipt; changed payload conflicts and failed attempt rolls back',async()=>{
    const key='http-engineering-same-key-0001',payload={settlementId:'INV-V001',amount:1000,method:'cash',reference:'人工核验现金收据 HTTP-001',idempotencyKey:key};
    const first=await command(front,'payment.record',payload,key);assert.equal(first.status,200,JSON.stringify(first.data));
    const replay=await command(front,'payment.record',payload,key);assert.equal(replay.status,200);assert.deepEqual(replay.data,first.data);assert.equal(db.sql.prepare('SELECT count(*) n FROM payments').get().n,1);
    const conflict=await command(front,'payment.record',{...payload,amount:1001},key);assert.equal(conflict.status,409);assert.equal(conflict.data.code,'IDEMPOTENCY_CONFLICT');
    const failedKey='http-engineering-failed-0002',bad={...payload,amount:999999,idempotencyKey:failedKey};
    const failed=await command(front,'payment.record',bad,failedKey);assert.equal(failed.status,409);assert.equal(db.sql.prepare('SELECT count(*) n FROM payments').get().n,1);assert.equal(db.sql.prepare('SELECT count(*) n FROM idempotency_requests WHERE key IN (?,?)').get(failedKey,`finance:${failedKey}`).n,0);
    const corrected=await command(front,'payment.record',{...bad,amount:2000},failedKey);assert.equal(corrected.status,200);assert.equal(db.sql.prepare('SELECT count(*) n FROM payments').get().n,2);
  });

  await t.test('existing-patient phone registration cannot silently claim or duplicate an identity',async()=>{
    const response=await request('/api/register',{method:'POST',payload:{username:'phoneclaim',name:'陈晨',password:'NewAccount2026',phone:'138 0000-0000',portal:'customer'}});assert.equal(response.status,409);assert.equal(response.data.code,'PATIENT_EXISTS');
    assert.equal(db.sql.prepare('SELECT count(*) n FROM patients').get().n,3);assert.equal(db.sql.prepare('SELECT count(*) n FROM users').get().n,5);
  });

  await t.test('staff disabling immediately revokes cookie and login; hq cannot remove own final account',async()=>{
    const created=await command(hq,'account.create',{username:'httpstaff',name:'隔离测试员工',password:'StaffPassword2026',role:'front',clinicIds:['C001']},'http-engineering-create-staff');assert.equal(created.status,200);
    const employee=created.data.result,session=await login('httpstaff','front','StaffPassword2026');
    const disabled=await command(hq,'account.status',{id:employee.id,version:employee.version,status:'disabled',reason:'测试岗位离开'},'http-engineering-disable-staff');assert.equal(disabled.status,200);
    assert.equal((await request('/api/session',{session})).status,401);assert.equal((await request('/api/login',{method:'POST',payload:{username:'httpstaff',password:'StaffPassword2026',portal:'front'}})).status,401);
    const self=await command(hq,'account.status',{id:hq.user.id,version:hq.user.version||1,status:'departed',reason:'禁止移除最后店长'},'http-engineering-disable-self');assert.equal(self.status,409);assert.equal(self.data.code,'SELF_DISABLE');assert.equal((await request('/api/session',{session:hq})).status,200);
  });

  await t.test('recovery response is generic, issued secret is not cached, and consuming is single use',async()=>{
    const known=await request('/api/password-recovery/request',{method:'POST',payload:{username:'chen',portal:'customer'}}),unknown=await request('/api/password-recovery/request',{method:'POST',payload:{username:'notanaccount',portal:'customer'}});assert.equal(known.status,200);assert.deepEqual(known.data,unknown.data);
    const key='http-engineering-issue-recovery',payload={id:customer.user.id,version:customer.user.version||1,identityEvidence:'当面核对本人身份与机构原登记资料',reason:'本人申请忘记密码恢复'};
    const issued=await command(hq,'account.issueRecovery',payload,key);assert.equal(issued.status,200,JSON.stringify(issued.data));const recovery=issued.data.result;
    assert.match(recovery.token,/^[a-f0-9]{64}$/);const stored=db.sql.prepare('SELECT response FROM idempotency_requests WHERE user_id=? AND key=?').get(hq.user.id,key);assert.equal(stored.response.includes(recovery.token),false);
    const replay=await command(hq,'account.issueRecovery',payload,key);assert.equal(replay.status,409);assert.equal(replay.data.code,'RECOVERY_REISSUE_REQUIRED');assert.equal(JSON.stringify(replay.data).includes(recovery.token),false);
    const consumed=await request('/api/password-recovery/consume',{method:'POST',payload:{token:recovery.token,newPassword:'RecoveryPassword2026'}});assert.equal(consumed.status,200);assert.equal(consumed.data.loginRequired,true);assert.match(consumed.headers.get('set-cookie'),/Max-Age=0/);
    assert.equal((await request('/api/session',{session:customer})).status,401);assert.equal((await request('/api/password-recovery/consume',{method:'POST',payload:{token:recovery.token,newPassword:'OtherPassword2026'}})).status,400);
    await login('chen','customer','RecoveryPassword2026');const audit=db.sql.prepare('SELECT detail FROM audit').all().map(r=>r.detail).join('');assert.equal(audit.includes(recovery.token),false);assert.equal(audit.includes('RecoveryPassword2026'),false);
  });
});
