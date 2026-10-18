import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, hashPassword, verifyPassword, quarterOf } from '../server/db.js';
import { executeCommand, getState } from '../server/domain.js';
import { financeSummary } from '../server/services/finance.js';
import { assertRegistrationUnique, isAccountActive, requestPasswordRecovery, consumePasswordRecovery } from '../server/services/accounts.js';

function fixture(t) {
  const db=createDatabase(':memory:');t.after(()=>db.close());
  const users=Object.fromEntries(db.sql.prepare('SELECT username,data FROM users').all().map(row=>[row.username,JSON.parse(row.data)]));
  return{db,...users,run:(user,type,p)=>executeCommand(db,user,type,p)};
}
const fails=(fn,code)=>assert.throws(fn,error=>error.code===code);
const key=(suffix)=>`business-test-${suffix}`;
const today=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10);

test('manual receipt ledger: integer cents, authorization, idempotency and balance',t=>{
  const {db,front,chen,run}=fixture(t),invoice=db.get('settlements','INV-V001');
  fails(()=>run(chen,'payment.record',{settlementId:invoice.id,amount:1,method:'cash',reference:'x',idempotencyKey:key('denied')}),'FORBIDDEN');
  fails(()=>run(front,'payment.record',{settlementId:'INV-V002',amount:1,method:'cash',reference:'x',idempotencyKey:key('scope')}),'FORBIDDEN');
  fails(()=>run(front,'payment.record',{settlementId:invoice.id,amount:1.1,method:'cash',reference:'x',idempotencyKey:key('float')}),'VALIDATION');
  const payload={settlementId:invoice.id,amount:10000,method:'cash',reference:'人工核对现金收据001',idempotencyKey:key('receipt')};
  const payment=run(front,'payment.record',payload);assert.equal(payment.recordingBasis,'staff-verified-manual');
  assert.deepEqual(run(front,'payment.record',payload),payment);assert.equal(db.sql.prepare('SELECT count(*) n FROM payments').get().n,1);
  fails(()=>run(front,'payment.record',{...payload,amount:11000}),'IDEMPOTENCY_CONFLICT');
  fails(()=>run(front,'payment.record',{...payload,idempotencyKey:key('overpay'),amount:invoice.total}),'OVERPAYMENT');
  assert.equal(financeSummary(db,invoice).balance,invoice.total-10000);
  assert.throws(()=>db.sql.prepare('UPDATE payments SET amount=1').run(),/append only/);
  assert.throws(()=>db.sql.prepare('DELETE FROM payments').run(),/append only/);
});

test('refund caps, complete refund before void, immutable invoice and quarterly adjustment',t=>{
  const {db,front,hq,run}=fixture(t),invoice=db.get('settlements','INV-V001'),original=JSON.stringify(invoice);
  const payment=run(front,'payment.record',{settlementId:invoice.id,amount:invoice.total,method:'bank',reference:'机构核对转账01',idempotencyKey:key('pay')});
  fails(()=>run(hq,'settlement.void',{id:invoice.id,version:1,reason:'取消收费'}),'PAYMENT_REMAINS');
  fails(()=>run(front,'payment.refund',{paymentId:payment.id,amount:1,reference:'x',reason:'x',idempotencyKey:key('front-refund')}),'FORBIDDEN');
  fails(()=>run(hq,'payment.refund',{paymentId:payment.id,amount:invoice.total+1,reference:'x',reason:'x',idempotencyKey:key('overrefund')}),'REFUND_EXCEEDED');
  const p={paymentId:payment.id,amount:invoice.total,reference:'核对退款流水01',reason:'收费项目撤销',idempotencyKey:key('refund')};
  const refund=run(hq,'payment.refund',p);assert.deepEqual(run(hq,'payment.refund',p),refund);
  assert.equal(financeSummary(db,invoice).balance,invoice.total);
  const report=run(hq,'quarter.compute',{quarter:quarterOf(Date.now())});
  const adjustment=run(hq,'settlement.void',{id:invoice.id,version:1,reason:'已核对全额退回，冲销错误开单'});assert.equal(adjustment.amount,invoice.total);
  assert.equal(JSON.stringify(db.get('settlements',invoice.id)),original);assert.equal(financeSummary(db,invoice).balance,0);assert.equal(financeSummary(db,invoice).status,'void');
  assert.equal(db.get('quarterReports',report.id).status,'draft');assert.ok(db.get('quarterReports',report.id).invalidatedAt);
  const updated=run(hq,'quarter.compute',{quarter:quarterOf(Date.now())});assert.equal(updated.revenue,report.revenue-invoice.total);
  fails(()=>run(front,'payment.record',{settlementId:invoice.id,amount:1,method:'cash',reference:'x',idempotencyKey:key('voidpay')}),'INVOICE_VOID');
  assert.throws(()=>db.sql.prepare('DELETE FROM refunds').run(),/append only/);assert.throws(()=>db.sql.prepare('DELETE FROM invoice_adjustments').run(),/append only/);
});

test('Shanghai daily reconciliation records differences, immutable revisions and stale source',t=>{
  const {db,front,hq,run}=fixture(t),businessDate=today();
  const preview=run(front,'reconciliation.preview',{clinicId:'C001',businessDate});assert.deepEqual([preview.expectedCash,preview.expectedBank,preview.expectedPos],[0,0,0]);
  fails(()=>run(front,'reconciliation.record',{clinicId:'C001',businessDate,observedCash:100,observedBank:0,observedPos:0,reference:'现金盘点表'}),'VALIDATION');
  const first=run(front,'reconciliation.record',{clinicId:'C001',businessDate,observedCash:0,observedBank:0,observedPos:0,reference:'盘点表01'});assert.equal(first.revision,1);
  run(front,'payment.record',{settlementId:'INV-V001',amount:1000,method:'pos',reference:'POS小票核对',idempotencyKey:key('stale')});
  const state=getState(db,hq);assert.equal(state.reconciliations.find(r=>r.id===first.id).stale,true);
  const second=run(front,'reconciliation.record',{clinicId:'C001',businessDate,observedCash:0,observedBank:0,observedPos:990,reference:'盘点表02',reason:'POS差额10分，待门店复核'});assert.equal(second.revision,2);assert.equal(second.expectedPos,1000);assert.equal(second.difference,-10);
  assert.throws(()=>db.sql.prepare('DELETE FROM reconciliations').run(),/append only/);
  fails(()=>run(front,'reconciliation.preview',{clinicId:'C002',businessDate}),'FORBIDDEN');
});

test('completed clinical record accepts immutable attributed addenda only from treating doctor or hq',t=>{
  const {db,doctor,chen,hq,run}=fixture(t),original=JSON.stringify(db.get('visits','V001'));
  fails(()=>run(chen,'visit.addendum',{id:'V001',version:1,reason:'x',content:'x'}),'FORBIDDEN');
  fails(()=>run({...doctor,dentistId:'D002'},'visit.addendum',{id:'V001',version:1,reason:'x',content:'x'}),'FORBIDDEN');
  fails(()=>run(doctor,'visit.addendum',{id:'V001',version:99,reason:'x',content:'x'}),'VERSION_CONFLICT');
  const addendum=run(doctor,'visit.addendum',{id:'V001',version:1,reason:'补充原记录遗漏',content:'补充患者自述，保留原记录。'});assert.equal(addendum.recordedBy,doctor.id);assert.equal(addendum.authorName,doctor.name);
  assert.equal(JSON.stringify(db.get('visits','V001')),original);assert.equal(getState(db,hq).visitAddenda[0].id,addendum.id);
  assert.throws(()=>db.sql.prepare('UPDATE visit_addenda SET content=?').run('改写'),/append only/);
  fails(()=>run(doctor,'visit.addendum',{id:'V003',version:1,reason:'x',content:'x'}),'VISIT_INCOMPLETE');
});

test('patient identity merge transfers references, preserves alias and revokes moved customer sessions',t=>{
  const {db,hq,chen,run}=fixture(t),source=db.get('patients','P001');
  db.put('patients',{...source,id:'P-DUP',phone:'138 0000-0000',version:1});
  db.sql.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run('merge-session',chen.id,'csrf',Date.now()+60000,Date.now());
  fails(()=>run(hq,'patient.merge',{sourceId:'P001',targetId:'P-DUP',sourceVersion:8,targetVersion:1,reason:'重复档案',identityEvidence:'机构人工核验'}),'VERSION_CONFLICT');
  const result=run(hq,'patient.merge',{sourceId:'P001',targetId:'P-DUP',sourceVersion:1,targetVersion:1,reason:'重复档案经本人确认',identityEvidence:'门诊核对原始登记资料与本人身份凭证'});
  assert.equal(result.transferred.appointments,3);assert.equal(db.get('patients','P001').active,false);assert.equal(db.get('patients','P001').mergedIntoId,'P-DUP');
  assert.equal(db.get('visits','V001').patientId,'P-DUP');assert.equal(db.get('settlements','INV-V001').patientId,'P-DUP');assert.equal(db.get('appointments','A006').patientId,'P-DUP');
  assert.equal(JSON.parse(db.sql.prepare('SELECT data FROM users WHERE id=?').get(chen.id).data).patientId,'P-DUP');assert.equal(db.sql.prepare('SELECT count(*) n FROM sessions WHERE user_id=?').get(chen.id).n,0);
  assert.equal(db.sql.prepare('SELECT count(*) n FROM patient_aliases').get().n,1);assert.throws(()=>db.sql.prepare('DELETE FROM patient_aliases').run(),/append only/);
});

test('patient identity merge refuses conflicting identities and two active customer accounts',t=>{
  const {db,hq,run}=fixture(t);fails(()=>run(hq,'patient.merge',{sourceId:'P001',targetId:'P002',sourceVersion:1,targetVersion:1,reason:'x',identityEvidence:'x'}),'IDENTITY_CONFLICT');
  db.put('patients',{...db.get('patients','P001'),id:'P-DUP',version:1});
  db.sql.prepare('INSERT INTO users(id,username,password_hash,data) VALUES(?,?,?,?)').run('U-DUP','duplicate',hashPassword('TestPass2026'),JSON.stringify({id:'U-DUP',username:'duplicate',name:'陈晨',role:'customer',patientId:'P-DUP',version:1,active:true}));
  fails(()=>run(hq,'patient.merge',{sourceId:'P001',targetId:'P-DUP',sourceVersion:1,targetVersion:1,reason:'x',identityEvidence:'x'}),'ACTIVE_ACCOUNT_CONFLICT');assert.equal(db.get('patients','P001').version,1);assert.equal(db.sql.prepare('SELECT count(*) n FROM patient_aliases').get().n,0);
  fails(()=>assertRegistrationUnique(db,{phone:'138 0000-0000'}),'PATIENT_EXISTS');
});

test('staff lifecycle enforces scopes, versions, session revocation and self/last-hq protection',t=>{
  const {db,hq,front,run}=fixture(t);
  fails(()=>run(front,'account.create',{username:'staffbad',name:'测试',role:'front',clinicIds:['C001'],password:'StrongPass2026'}),'FORBIDDEN');
  fails(()=>run(hq,'account.create',{username:'staffbad',name:'测试',role:'front',clinicIds:[],password:'StrongPass2026'}),'VALIDATION');
  const staff=run(hq,'account.create',{username:'staffnew',name:'新前台',role:'front',clinicIds:['C002'],password:'StrongPass2026'});assert.deepEqual(staff.clinicIds,['C002']);assert.equal('password' in staff,false);
  const assigned=run(hq,'account.assign',{id:staff.id,version:1,clinicIds:['C001','C002'],reason:'跨店支援排班'});assert.deepEqual(assigned.clinicIds,['C001','C002']);
  db.sql.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run('staff-session',staff.id,'csrf',Date.now()+60000,Date.now());
  const disabled=run(hq,'account.status',{id:staff.id,version:assigned.version,status:'disabled',reason:'暂停工作权限'});assert.equal(isAccountActive(disabled),false);assert.equal(db.sql.prepare('SELECT count(*) n FROM sessions WHERE user_id=?').get(staff.id).n,0);
  fails(()=>run(hq,'account.status',{id:staff.id,version:1,status:'active',reason:'错误旧版本'}),'VERSION_CONFLICT');
  fails(()=>run(hq,'account.status',{id:hq.id,version:1,status:'departed',reason:'自停用'}),'SELF_DISABLE');
  const second=run(hq,'account.create',{username:'manager2',name:'第二店长',role:'hq',password:'StrongPass2026'});
  run(second,'account.status',{id:hq.id,version:1,status:'disabled',reason:'权限交接'});
  // Archiving an already inactive HQ account does not remove the remaining
  // active HQ account and must not trigger last-HQ protection.
  const departed=run(second,'account.status',{id:hq.id,version:2,status:'departed',reason:'完成原总部账号离职归档'});assert.equal(departed.status,'departed');
  fails(()=>run(hq,'account.status',{id:second.id,version:1,status:'disabled',reason:'不得移除最后总部'}),'LAST_HQ');
});

test('institution-verified customer binding prevents duplicate account claiming',t=>{
  const {db,hq,run}=fixture(t);
  fails(()=>run(hq,'account.bindCustomer',{patientId:'P001',version:1,username:'claim',password:'StrongPass2026',identityEvidence:'核验',reason:'绑定'}),'PATIENT_ACCOUNT_EXISTS');
  const bound=run(hq,'account.bindCustomer',{patientId:'P003',version:1,username:'li_customer',password:'StrongPass2026',identityEvidence:'门诊当面核验身份证件及原登记联系电话',reason:'已有档案开通本人账号'});assert.equal(bound.role,'customer');assert.equal(bound.patientId,'P003');assert.equal(bound.name,db.get('patients','P003').name);
});

test('password change and verified single-use recovery revoke sessions and redact audit secrets',t=>{
  const {db,hq,front,run}=fixture(t);
  db.sql.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run('front-session',front.id,'csrf',Date.now()+60000,Date.now());
  fails(()=>run(front,'password.change',{currentPassword:'wrong',newPassword:'NewPassword2026'}),'PASSWORD_MISMATCH');
  run(front,'password.change',{currentPassword:'Dental2026!',newPassword:'NewPassword2026'});assert.equal(db.sql.prepare('SELECT count(*) n FROM sessions WHERE user_id=?').get(front.id).n,0);
  assert.equal(verifyPassword('NewPassword2026',db.sql.prepare('SELECT password_hash FROM users WHERE id=?').get(front.id).password_hash),true);
  const known=db.transaction(()=>requestPasswordRecovery(db,{username:'front',portal:'front'})),unknown=db.transaction(()=>requestPasswordRecovery(db,{username:'notexists',portal:'front'}));assert.deepEqual(known,unknown);
  db.transaction(()=>requestPasswordRecovery(db,{username:'front',portal:'front'}));assert.equal(db.sql.prepare('SELECT count(*) n FROM account_recovery_requests').get().n,1);
  const user=JSON.parse(db.sql.prepare('SELECT data FROM users WHERE id=?').get(front.id).data);
  const recovery=run(hq,'account.issueRecovery',{id:front.id,version:user.version,identityEvidence:'门诊店长核验员工档案及本人证件',reason:'忘记密码'});assert.match(recovery.token,/^[a-f0-9]{64}$/);assert.equal(recovery.expiresAt>Date.now(),true);
  assert.notEqual(db.sql.prepare('SELECT token_hash FROM password_reset_tokens WHERE id=?').get(recovery.id).token_hash,recovery.token);
  const audit=JSON.stringify(db.sql.prepare('SELECT detail FROM audit').all());assert.equal(audit.includes(recovery.token),false);assert.equal(audit.includes('NewPassword2026'),false);
  const second=run(hq,'account.issueRecovery',{id:front.id,version:user.version,identityEvidence:'复核原员工资料',reason:'原恢复码作废重签'});
  fails(()=>db.transaction(()=>consumePasswordRecovery(db,{token:recovery.token,newPassword:'ResetPassword2026'})),'RECOVERY_INVALID');
  db.transaction(()=>consumePasswordRecovery(db,{token:second.token,newPassword:'ResetPassword2026'}));fails(()=>db.transaction(()=>consumePasswordRecovery(db,{token:second.token,newPassword:'AnotherPass2026'})),'RECOVERY_INVALID');
  assert.equal(verifyPassword('ResetPassword2026',db.sql.prepare('SELECT password_hash FROM users WHERE id=?').get(front.id).password_hash),true);
});
