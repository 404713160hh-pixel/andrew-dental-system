import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createDatabase, quarterOf } from '../server/db.js';
import { executeCommand, getState, getWorkspace } from '../server/domain.js';
import { start } from '../server/index.js';

function fixture(t) {
  const db=createDatabase(':memory:');t.after(()=>db.close());
  const users=Object.fromEntries(db.sql.prepare('SELECT username,data FROM users').all().map(row=>[row.username,JSON.parse(row.data)]));
  return{db,...users,run:(user,type,p)=>executeCommand(db,user,type,p)};
}
const denied=fn=>assert.throws(fn,error=>error.status===403&&error.code==='FORBIDDEN');

test('HQ sees the chain; managers read only assigned clinic records, costs, finance and public resource catalogues',t=>{
  const {db,hq,manager,run}=fixture(t),local=getState(db,manager),chain=getState(db,hq);
  assert.deepEqual(manager.clinicIds,['C001']);assert.deepEqual(local.clinics.map(c=>c.id),['C001']);
  for(const table of ['appointments','visits','settlements','costs'])assert.ok(local[table].length&&local[table].every(row=>row.clinicId==='C001'),table);
  assert.ok(!local.patients.some(p=>p.id==='P002'));assert.equal(local.audit.length,0);assert.equal(local.accounts.length,0);assert.equal(local.recoveryRequests.length,0);assert.equal(local.quarterReports.length,0);
  assert.equal(local.dentists.some(d=>'address' in d||'dob' in d||'qualificationDetails' in d),false);
  assert.deepEqual(chain.clinics.map(c=>c.id).sort(),['C001','C002']);assert.equal(chain.accounts.length,5);
  for(const page of ['accounts','audit','settings'])denied(()=>getWorkspace(db,manager,{page}));
  for(const page of ['appointments','settlements','finance'])assert.equal(getWorkspace(db,manager,{page,clinicId:'C002'}).pagination.total,0);
  const performance=getWorkspace(db,manager,{page:'performance'});assert.ok(performance.costs.every(c=>c.clinicId==='C001'));assert.equal(performance.quarterReports.length,0);assert.ok(performance.metrics.byClinic.every(c=>c.clinicId==='C001'));
  assert.deepEqual(getWorkspace(db,manager,{page:'resources',resource:'clinics'}).clinics.map(c=>c.id),['C001']);
  denied(()=>run(manager,'patient.save',db.get('patients','P002')));
  // Verified identity lookup shares the care profile without sharing another
  // clinic's visits, bills, costs or reconciliation records.
  const found=run(manager,'patient.lookup',{phone:'13800000002',dob:'1995-05-20'});assert.ok(found.accessClinicIds.includes('C001'));
  const shared=getState(db,manager);assert.ok(shared.patients.some(p=>p.id==='P002'));assert.ok(shared.visits.every(v=>v.clinicId==='C001'));assert.ok(shared.settlements.every(s=>s.clinicId==='C001'));
});

test('manager mutations enforce clinic scope and cannot escalate to HQ commands',t=>{
  const {db,manager,hq,run}=fixture(t);
  for(const command of ['clinic.save','dentist.save','qualification.save','treatment.save','settings.save','quarter.compute','quarter.approve','patient.merge','account.bindCustomer','account.create','account.assign','account.status','account.issueRecovery'])denied(()=>run(manager,command,{role:'hq',clinicIds:[],id:manager.id}));
  denied(()=>run(manager,'appointment.cancel',{id:'A003',version:1,reason:'越店修改'}));
  denied(()=>run(manager,'visit.save',{id:'V002',version:1,notes:'越店修改',lines:[]}));
  denied(()=>run(manager,'visit.complete',{id:'V002',version:1}));
  denied(()=>run(manager,'visit.addendum',{id:'V002',version:1,reason:'越店',content:'越店'}));
  denied(()=>run(manager,'cost.save',{...db.get('costs','COST002'),operations:1}));
  denied(()=>run(manager,'cost.review',{id:'COST002',version:1}));
  denied(()=>run(manager,'schedule.save',{clinicId:'C002',dentistId:'D001',start:new Date(Date.now()+864000000).toISOString(),end:new Date(Date.now()+867600000).toISOString(),capacity:1,active:true}));
  const cost=run(manager,'cost.save',{...db.get('costs','COST001'),supplies:5100});assert.equal(cost.status,'draft');
  assert.equal(run(manager,'cost.review',{id:cost.id,version:cost.version}).status,'reviewed');
  const note=run(manager,'visit.addendum',{id:'V001',version:1,reason:'本店复核补记',content:'保留原记录并追加说明'});assert.equal(note.recordedBy,manager.id);
  const visit=run(manager,'visit.save',{id:'V003',version:1,notes:'本店记录',lines:[{treatmentId:'T001',quantity:1}]});assert.equal(visit.clinicId,'C001');
  assert.equal(run(manager,'visit.complete',{id:visit.id,version:visit.version}).status,'completed');
  assert.equal(run(hq,'quarter.compute',{quarter:quarterOf(Date.now())}).scope,'chain');
});

test('patient edits cannot rewrite clinic provenance or submit new access grants',t=>{
  const {db,manager,chen,run}=fixture(t);
  const patient={...db.get('patients','P003'),id:'P-SELF-SERVICE',createdClinicId:null,accessClinicIds:['C001']};db.put('patients',patient);
  const saved=run(manager,'patient.save',{...patient,clinicId:'C002',createdClinicId:'C002',accessClinicIds:['C001','C002']});
  assert.equal(saved.createdClinicId,null);assert.deepEqual(saved.accessClinicIds,['C001']);
  const existing=db.get('patients','P001'),own=run(chen,'patient.save',{...existing,clinicId:'C002',createdClinicId:'C002',accessClinicIds:['C002']});
  assert.equal(own.createdClinicId,'C001');assert.deepEqual(own.accessClinicIds,existing.accessClinicIds);
  denied(()=>run(manager,'patient.save',{...patient,id:undefined,clinicId:'C002'}));
});

test('manager refunds, voids and daily reconciliations remain local and append only',t=>{
  const {db,hq,manager,run}=fixture(t),businessDate=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  const foreign=run(hq,'payment.record',{settlementId:'INV-V002',amount:1000,method:'cash',reference:'总部核验',idempotencyKey:'hq-foreign-payment'});
  denied(()=>run(manager,'payment.record',{settlementId:'INV-V002',amount:1,method:'cash',reference:'越店',idempotencyKey:'manager-foreign-payment'}));
  denied(()=>run(manager,'payment.refund',{paymentId:foreign.id,amount:1,reference:'越店',reason:'越店',idempotencyKey:'manager-foreign-refund'}));
  denied(()=>run(manager,'settlement.void',{id:'INV-V002',version:1,reason:'越店'}));
  denied(()=>run(manager,'reconciliation.preview',{clinicId:'C002',businessDate}));
  denied(()=>run(manager,'reconciliation.record',{clinicId:'C002',businessDate,observedCash:0,observedBank:0,observedPos:0,reference:'越店'}));
  const paid=run(manager,'payment.record',{settlementId:'INV-V001',amount:1000,method:'cash',reference:'本店核验',idempotencyKey:'manager-local-payment'});
  run(manager,'payment.refund',{paymentId:paid.id,amount:1000,reference:'本店核验退款',reason:'更正本店开单',idempotencyKey:'manager-local-refund'});
  assert.equal(run(manager,'settlement.void',{id:'INV-V001',version:1,reason:'本店全额退回后冲销'}).amount,28000);
  const summary=run(manager,'reconciliation.preview',{clinicId:'C001',businessDate});assert.equal(summary.expectedCash,0);
  run(manager,'reconciliation.record',{clinicId:'C001',businessDate,observedCash:0,observedBank:0,observedPos:0,reference:'本店现金盘点'});
  const finance=getState(db,manager);assert.ok(finance.reconciliations.every(r=>r.clinicId==='C001'));assert.equal(finance.payments.some(p=>p.id===foreign.id),false);
  assert.throws(()=>db.sql.prepare('DELETE FROM refunds').run(),/append only/);
});

test('HQ assigns explicit manager scopes and new managers remain scoped on database reopen',t=>{
  const directory=mkdtempSync(join(tmpdir(),'dental-hq-scope-')),path=join(directory,'data.sqlite');
  t.after(()=>{const absolute=resolve(directory);if(!absolute.startsWith(resolve(tmpdir())+sep))throw new Error('Unsafe fixture');rmSync(absolute,{recursive:true,force:true,maxRetries:3});});
  let db=createDatabase(path);try{
    const hq=JSON.parse(db.sql.prepare("SELECT data FROM users WHERE username='hq'").get().data);
    for(const clinicIds of [undefined,[],['missing'],['C001','C001']])assert.throws(()=>executeCommand(db,hq,'account.create',{username:'scopedmanager',name:'门店管理',role:'manager',password:'ManagerPass2026',clinicIds}));
    const manager=executeCommand(db,hq,'account.create',{username:'scopedmanager',name:'门店管理',role:'manager',password:'ManagerPass2026',clinicIds:['C002']});
    db.sql.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run('new-manager-session',manager.id,'csrf',Date.now()+60000,Date.now());
    db.close();db=createDatabase(path);assert.equal(db.migration.backup,null);
    const reopened=JSON.parse(db.sql.prepare('SELECT data FROM users WHERE id=?').get(manager.id).data);assert.equal(reopened.role,'manager');assert.deepEqual(reopened.clinicIds,['C002']);assert.ok(db.sql.prepare("SELECT 1 FROM sessions WHERE token_hash='new-manager-session'").get());
    assert.throws(()=>executeCommand(db,hq,'account.assign',{id:manager.id,version:1,clinicIds:[],reason:'无归属'}));
    const assigned=executeCommand(db,hq,'account.assign',{id:manager.id,version:1,clinicIds:['C001'],reason:'总部确认调店'});assert.deepEqual(assigned.clinicIds,['C001']);assert.equal(db.sql.prepare('SELECT count(*) n FROM sessions WHERE user_id=?').get(manager.id).n,0);
  }finally{db.close();}
});

test('manager reassignment invalidates cookies and binds HTTP and finance replay to the current authorization scope',async t=>{
  const db=createDatabase(':memory:'),app=await start({db,port:0});t.after(async()=>{await app.close();db.close();});const base=`http://127.0.0.1:${app.address.port}`;
  const request=async(path,session,payload,key)=>{const res=await fetch(base+path,{method:payload?'POST':'GET',headers:{'Content-Type':'application/json',...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrfToken}:{}),...(key?{'Idempotency-Key':key}:{})},...(payload?{body:JSON.stringify(payload)}:{})});return{status:res.status,data:await res.json(),headers:res.headers};};
  const login=async(username,portal)=>{const response=await request('/api/login',null,{username,password:'Dental2026!',portal});assert.equal(response.status,200);return{...response.data,cookie:response.headers.get('set-cookie').split(';')[0]};};
  const hq=await login('hq','hq'),manager=await login('manager','manager'),key='manager-scope-replay-0001';
  const input={type:'payment.record',payload:{settlementId:'INV-V001',amount:1000,method:'cash',reference:'本店收据',idempotencyKey:key}};
  assert.equal((await request('/api/command',manager,input,key)).status,200);
  const change=await request('/api/command',hq,{type:'account.assign',payload:{id:manager.user.id,version:1,clinicIds:['C002'],reason:'总部调店授权'}});assert.equal(change.status,200);
  assert.equal((await request('/api/session',manager)).status,401);const moved=await login('manager','manager');
  assert.equal((await request('/api/command',moved,input,key)).data.code,'IDEMPOTENCY_CONFLICT');
  assert.equal((await request('/api/command',moved,input,'manager-scope-replay-0002')).data.code,'IDEMPOTENCY_CONFLICT');
  assert.equal((await request('/api/command',moved,{...input,payload:{...input.payload,idempotencyKey:'manager-scope-replay-0003'}},'manager-scope-replay-0003')).status,403);
  assert.equal(db.sql.prepare('SELECT count(*) n FROM payments').get().n,1);
  const state=await request('/api/state',moved);assert.ok(state.data.settlements.every(s=>s.clinicId==='C002'));
  assert.equal((await request('/api/workspace?page=accounts',moved)).status,403);assert.equal((await request('/api/backup',moved)).status,403);
  assert.equal((await request('/api/login',null,{username:'manager',password:'Dental2026!',portal:'hq'})).status,401);
});
