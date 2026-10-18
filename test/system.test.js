import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, basename, sep } from 'node:path';
import { request as httpRequest } from 'node:http';
import { createHash } from 'node:crypto';
import { start } from '../server/index.js';
import { createDatabase, hashPassword, quarterOf } from '../server/db.js';
import { requiredTables } from '../server/migrations/manifest.js';

const removeFixture=directory=>{
  const target=resolve(directory),tempRoot=resolve(tmpdir())+sep;
  if(!target.startsWith(tempRoot)||!basename(target).startsWith('andrew-test-'))throw new Error('Unexpected temporary cleanup path');
  rmSync(target,{recursive:true,force:true,maxRetries:3,retryDelay:100});
};

test('persistent dental HTTP integration: authentication, scope, atomic business workflows',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'andrew-test-'));
  const dbPath=join(directory,'test.sqlite');
  let app=await start({dbPath,port:0});
  let base=`http://127.0.0.1:${app.address.port}`;
  t.after(async()=>{await app.close();removeFixture(directory);});
  const request=async(path,options={},session)=>{
    const headers={'Content-Type':'application/json',...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrfToken}:{}),...options.headers};
    const res=await fetch(base+path,{...options,headers});
    const data=await res.json();return{status:res.status,data,headers:res.headers};
  };
  const login=async(username,portal={chen:'customer',front:'front',doctor:'clinical',hq:'hq'}[username])=>{
    const res=await request('/api/login',{method:'POST',body:JSON.stringify({username,password:'Dental2026!',portal})});assert.equal(res.status,200,JSON.stringify(res.data));
    return{...res.data,cookie:res.headers.get('set-cookie').split(';')[0]};
  };
  const command=async(session,type,payload,status=200)=>{
    const res=await request('/api/command',{method:'POST',body:JSON.stringify({type,payload})},session);
    assert.equal(res.status,status,JSON.stringify(res.data));return res.data.result||res.data;
  };
  const state=async(session)=>(await request('/api/state',{},session)).data;
  const chen=await login('chen'),front=await login('front'),doctor=await login('doctor'),hq=await login('hq');
  let registered, booked, invoice, report;
  await t.test('five portal login contracts reject wrong identities and expose independent entry paths',async()=>{
    const accounts=[['chen','customer','/customer'],['front','front','/frontdesk'],['doctor','clinical','/doctor'],['manager','manager','/manager'],['hq','hq','/hq']];
    assert.equal(app.db.sql.prepare('SELECT count(*) AS count FROM users').get().count,5);
    assert.equal(app.db.sql.prepare('SELECT count(*) AS count FROM users WHERE username=?').get('admin').count,0);
    for(const [username,portal,path] of accounts) {
      const invalid=await request('/api/login',{method:'POST',body:JSON.stringify({username,password:'Dental2026!'})});
      assert.equal(invalid.status,400);assert.equal(invalid.data.code,'PORTAL_INVALID');
      for(const method of ['GET','HEAD']) {
        const res=await fetch(base+path+'/login',{method});assert.equal(res.status,200);assert.match(res.headers.get('content-type'),/text\/html/);
      }
      for(const [,otherPortal] of accounts.filter(([,p])=>p!==portal)) {
        const denied=await request('/api/login',{method:'POST',body:JSON.stringify({username,password:'Dental2026!',portal:otherPortal})});
        assert.equal(denied.status,401);assert.equal(denied.data.code,'LOGIN_FAILED');assert.equal(denied.headers.get('set-cookie'),null);
      }
      const session=await login(username,portal);assert.equal(session.user.role,portal);
      const workspace=await fetch(base+path);assert.equal(workspace.status,200);
    }
    for(const portal of ['admin','frontdesk','doctor']) {
      const invalid=await request('/api/login',{method:'POST',body:JSON.stringify({username:'chen',password:'Dental2026!',portal})});
      assert.equal(invalid.status,400);assert.equal(invalid.data.code,'PORTAL_INVALID');
    }
    const invalidRegistration=await request('/api/register',{method:'POST',body:JSON.stringify({username:'wrongportal',password:'StrongPass2026',name:'测试患者',phone:'13812345678',portal:'hq'})});
    assert.equal(invalidRegistration.status,400);assert.equal(invalidRegistration.data.code,'PORTAL_INVALID');
    const config=await request('/api/portal-config');assert.equal(config.status,200);assert.equal(config.data.demoEnabled,true);assert.equal('password' in config.data,false);
  });
  await t.test('real sessions, cookie flags, CSRF and same-origin checks',async()=>{
    assert.equal((await request('/api/state')).status,401);
    const res=await request('/api/login',{method:'POST',body:JSON.stringify({username:'chen',password:'Dental2026!',portal:'customer'})});
    assert.match(res.headers.get('set-cookie'),/HttpOnly/);assert.match(res.headers.get('set-cookie'),/SameSite=Lax/);
    assert.equal((await request('/api/command',{method:'POST',headers:{Cookie:chen.cookie},body:JSON.stringify({type:'patient.save',payload:{}})})).status,403);
    assert.equal((await request('/api/command',{method:'POST',headers:{Origin:'https://foreign.example'},body:JSON.stringify({type:'settings.save',payload:{cancellationHours:2}})},hq)).status,403);
    assert.equal((await request('/api/login',{method:'POST',body:JSON.stringify({username:'chen',password:'incorrectpassword1',portal:'customer'})})).status,401);
    const foreignHostStatus=await new Promise((resolve,reject)=>{const req=httpRequest(base+'/api/health',{headers:{Host:'foreign.example'}},res=>{res.resume();res.once('end',()=>resolve(res.statusCode));});req.once('error',reject);req.end();});
    assert.equal(foreignHostStatus,403);
  });
  await t.test('server scope prevents IDOR and hides private staff records',async()=>{
    const customerState=await state(chen);
    assert.deepEqual(customerState.patients.map(p=>p.id),['P001']);assert.equal(customerState.audit.length,0);assert.equal(customerState.costs.length,0);
    assert.equal('address' in customerState.dentists[0],false);assert.equal('dob' in customerState.dentists[0],false);
    const other=(await state(hq)).patients.find(p=>p.id==='P002');
    await command(chen,'patient.save',{...other},403);
    await command(front,'appointment.cancel',{id:'A003',version:1,reason:'越权测试'},403);
    await command(doctor,'settlement.create',{visitId:'V001'},403);
    assert.equal((await request('/api/backup',{},front)).status,403);
    await command(front,'cost.review',{id:'COST001',version:1},403);
    await command(doctor,'clinic.save',{},403);
    await command(chen,'quarter.compute',{quarter:quarterOf(Date.now())},403);
    const managerState=await state(hq),doctorState=await state(doctor);
    assert.deepEqual(managerState.patients.map(p=>p.id).sort(),app.db.all('patients').map(p=>p.id).sort());
    assert.deepEqual(managerState.schedules.map(s=>s.id).sort(),app.db.all('schedules').map(s=>s.id).sort());
    assert.ok(doctorState.appointments.every(a=>a.dentistId==='D001'));
    assert.ok(hq.user.permissions.includes('cost.review'));assert.ok(hq.user.permissions.includes('quarter.approve'));
    const crossClinic=managerState.clinics.find(c=>c.id==='C002');
    const savedClinic=await command(hq,'clinic.save',{...crossClinic,phone:crossClinic.phone});assert.equal(savedClinic.id,'C002');
  });
  await t.test('registration, multi-allergy profile and stale edit guard',async()=>{
    const res=await request('/api/register',{method:'POST',body:JSON.stringify({username:'newpatient',password:'StrongPass2026',name:'测试新患者',phone:'13812345678',portal:'customer'})});
    assert.equal(res.status,201);registered={...res.data,cookie:res.headers.get('set-cookie').split(';')[0]};
    const initial=(await state(registered)).patients[0];
    const slot=(await state(registered)).schedules.find(s=>s.available===1);
    await command(registered,'appointment.book',{patientId:initial.id,scheduleId:slot.id,problem:'检查'},409);
    const payload={...initial,dob:'1998-01-01',address:'长沙示范地址',emergencyName:'测试家属',emergencyPhone:'13912345678',allergyStatus:'known',allergies:[{name:'青霉素',reaction:'皮疹',note:'本人自述'},{name:'乳胶',reaction:'红斑',note:''}]};
    const saved=await command(registered,'patient.save',payload);assert.equal(saved.allergies.length,2);assert.notEqual(saved.allergies[0].id,saved.allergies[1].id);assert.equal(saved.allergyVerifiedAt,null);
    await command(registered,'patient.save',payload,409);
  });
  await t.test('competing booking is atomic, and failed reschedule restores original',async()=>{
    const s=(await state(chen)).schedules.find(s=>s.available===1&&Date.parse(s.start)>Date.now()+48*3600000);
    const first={type:'appointment.book',payload:{patientId:'P001',scheduleId:s.id,problem:'并发测试',specialNeeds:'',previousId:'A003'}};
    const second={type:'appointment.book',payload:{patientId:registered.user.patientId,scheduleId:s.id,problem:'并发测试',specialNeeds:''}};
    const results=await Promise.all([request('/api/command',{method:'POST',body:JSON.stringify(first)},chen),request('/api/command',{method:'POST',body:JSON.stringify(second)},registered)]);
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    booked=results.find(r=>r.status===200).data.result;
    assert.equal('previousId' in booked,false);
    assert.equal(app.db.all('appointments').filter(a=>a.scheduleId===s.id&&a.status==='booked').length,1);
    const existing=app.db.get('appointments','A006');
    await command(chen,'appointment.reschedule',{id:existing.id,version:existing.version,scheduleId:s.id,reason:'失败改约'},409);
    assert.equal(app.db.get('appointments','A006').status,'booked');
    await command(chen,'appointment.cancel',{id:'A001',version:1,reason:'过期客户取消'},409);
  });
  await t.test('explicit unknown allergy declaration allows booking and stays unverified',async()=>{
    const patient=(await state(registered)).patients[0];
    const saved=await command(registered,'patient.save',{...patient,allergyStatus:'unknown',allergies:[]});
    assert.ok(saved.allergyDeclaredAt);assert.equal(saved.allergyStatus,'unknown');assert.equal(saved.allergyVerifiedAt,null);assert.equal(saved.allergyVerifiedBy,null);
    const slot=(await state(registered)).schedules.find(s=>s.dentistId==='D002'&&s.available===1&&Date.parse(s.start)>Date.now()+6*86400000);
    const appointment=await command(registered,'appointment.book',{patientId:saved.id,scheduleId:slot.id,problem:'过敏状态待核实，就诊前与门诊核对',specialNeeds:''});
    assert.equal(appointment.status,'booked');
    const persisted=(await state(registered)).patients[0];assert.equal(persisted.allergyStatus,'unknown');assert.equal(persisted.allergyVerifiedAt,null);assert.deepEqual(persisted.allergies,[]);
  });
  await t.test('global dentist schedule conflicts and attendance time guards',async()=>{
    const slot=(await state(hq)).schedules.find(s=>s.clinicId==='C001'&&Date.parse(s.start)>Date.now());
    await command(hq,'schedule.save',{clinicId:'C002',dentistId:'D001',start:slot.start,end:slot.end,capacity:1,active:true},409);
    await command(hq,'schedule.save',{clinicId:'C002',dentistId:'D001',start:slot.start,end:slot.end,capacity:2,active:true},400);
    await command(front,'appointment.status',{id:'A006',version:1,status:'attended'},400);
    const attended=await command(front,'appointment.status',{id:'A001',version:1,status:'attended',reason:'核对身份后到诊'});assert.equal(attended.attended,true);
    assert.equal(app.db.all('visits').filter(v=>v.appointmentId==='A001').length,1);
    await command(front,'appointment.status',{id:'A001',version:attended.version,status:'booked',reason:'不可撤销'},409);
  });
  await t.test('verified cross-clinic lookup grants care access without duplicate records',async()=>{
    assert.equal((await state(front)).patients.some(p=>p.id==='P002'),false);
    await command(front,'patient.lookup',{phone:'13800000002',dob:'1990-01-01'},404);
    const patient=await command(front,'patient.lookup',{phone:'13800000002',dob:'1995-05-20'});
    assert.equal(patient.id,'P002');assert.ok(patient.accessClinicIds.includes('C001'));
    assert.equal((await state(front)).patients.some(p=>p.id==='P002'),true);
    await command(chen,'patient.lookup',{phone:'13800000002',dob:'1995-05-20'},403);
    assert.equal(app.db.all('patients').length,4);
  });
  await t.test('required settings version, qualification guard and malformed item rejection',async()=>{
    const settings=(await state(hq)).settings;
    await command(hq,'quarter.compute',{quarter:['2026-Q4']},400);
    await command(hq,'settings.save',{cancellationHours:2},409);
    await command(hq,'settings.save',{cancellationHours:2,version:settings.version});
    await command(hq,'settings.save',{cancellationHours:4,version:settings.version},409);
    const patient=app.db.get('patients','P001');await command(chen,'patient.save',{...patient,allergyStatus:'known',allergies:[null]},400);
    const dentist=app.db.get('dentists','D001');await command(hq,'dentist.save',{...dentist,qualificationDetails:[null]},400);
    await command(doctor,'visit.save',{id:'V003',version:1,notes:'test',lines:[null]},400);
    await command(front,'appointment.cancel',{id:{invalid:true},version:1,reason:'test'},400);
    const q2=app.db.get('qualifications','Q002');await command(hq,'qualification.save',{...q2,active:false});
    const q1=app.db.get('qualifications','Q001');await command(hq,'qualification.save',{...q1,active:false},409);
    const original=app.db.get('dentists','D001');app.db.put('dentists',{...original,qualificationIds:[]});
    assert.equal((await state(chen)).schedules.some(s=>s.dentistId==='D001'),false);
    const slot=app.db.all('schedules').find(s=>s.dentistId==='D001'&&Date.parse(s.start)>Date.now());
    await command(chen,'appointment.book',{patientId:'P001',scheduleId:slot.id,problem:'资格失效'},409);
    app.db.put('dentists',original);
  });
  await t.test('live server PID lock prevents second service on the same database',async()=>{
    await assert.rejects(start({dbPath,port:0}),/已有服务运行/);
    assert.equal((await request('/api/health')).status,200);
  });
  await t.test('front attendance, doctor treatment, front settlement and customer detail share one care chain',async()=>{
    const initial=app.db.all('visits').find(v=>v.appointmentId==='A001');assert.ok(initial);assert.equal(initial.patientId,chen.user.patientId);
    let visit=await command(doctor,'visit.save',{id:initial.id,version:initial.version,notes:'实际治疗记录',lines:[{treatmentId:'T001',quantity:3},{treatmentId:'T002',quantity:1}]});
    const treatment=app.db.get('treatments','T001');await command(hq,'treatment.save',{...treatment,unitPrice:99999});
    visit=await command(doctor,'visit.save',{id:visit.id,version:visit.version,notes:'追加治疗',lines:[{treatmentId:'T001',quantity:3},{treatmentId:'T002',quantity:1}]});
    assert.equal(visit.lines[0].unitPrice,8000);
    visit=await command(doctor,'visit.complete',{id:visit.id,version:visit.version});
    invoice=await command(front,'settlement.create',{visitId:visit.id});assert.equal(invoice.total,44000);
    const repeated=await command(front,'settlement.create',{visitId:visit.id});assert.equal(repeated.id,invoice.id);assert.equal(repeated.number,invoice.number);
    assert.equal(app.db.all('settlements').filter(s=>s.visitId===visit.id).length,1);
    await command(doctor,'visit.save',{id:visit.id,version:visit.version,notes:'改写',lines:[]},409);
    const customer=await state(chen),managerView=await state(hq);
    assert.equal(customer.settlements.find(s=>s.id===invoice.id).total,44000);
    assert.equal(managerView.settlements.find(s=>s.id===invoice.id).visitId,initial.id);
  });
  await t.test('cost completeness, approved fund and revision invalidates old source',async()=>{
    const q=quarterOf(Date.now());
    report=await command(hq,'quarter.compute',{quarter:q});
    assert.equal(report.revenue,132000);assert.equal(report.netProfit,98000);assert.equal(report.fund,9800);
    report=await command(hq,'quarter.approve',{id:report.id,version:report.version});assert.equal(report.status,'approved');
    const cost=app.db.get('costs','COST001');const updated=await command(hq,'cost.save',{...cost,supplies:6000});
    assert.equal(updated.status,'draft');assert.equal(updated.reviewHistory.at(-1).action,'修订，审核失效');
    assert.equal(app.db.get('quarterReports',report.id).status,'draft');
    await command(hq,'quarter.compute',{quarter:q},409);
    await command(hq,'quarter.approve',{id:report.id,version:app.db.get('quarterReports',report.id).version},409);
    await command(hq,'cost.review',{id:updated.id,version:updated.version});
    const next=await command(hq,'quarter.compute',{quarter:q});assert.equal(next.fund,9700);
    const exportResult=await request('/api/backup',{},hq);assert.equal(exportResult.status,200);
    const exported=JSON.stringify(exportResult.data);assert.equal(exported.includes('password_hash'),false);assert.equal(exported.includes('token_hash'),false);assert.equal(exported.includes('StrongPass2026'),false);
  });
  await t.test('customer/staff shared state and durable records survive server restart',async()=>{
    const before=await state(hq);assert.ok(before.audit.some(a=>a.type==='settlement.create'));
    assert.ok(before.audit.some(a=>a.type==='patient.lookup'&&a.detail.after?.id==='P002'));
    assert.ok(before.audit.some(a=>a.type==='sensitive.read'));
    assert.throws(()=>app.db.sql.prepare('UPDATE audit SET type=?').run('forged'),/append only/);
    assert.throws(()=>app.db.sql.prepare('DELETE FROM audit').run(),/append only/);
    const own=await state(chen);assert.ok(own.settlements.some(s=>s.id==='INV-V001'));assert.ok(own.metrics.elapsed>0);
    await app.close();app=await start({dbPath,port:0});base=`http://127.0.0.1:${app.address.port}`;
    const newManager=await login('hq');const after=await state(newManager);
    assert.ok(after.settlements.some(s=>s.id===invoice.id));assert.ok(after.appointments.some(a=>a.id===booked.id));
    assert.equal(after.patients.length,4);assert.ok(after.audit.length>=before.audit.length);
    const oldUserSession=await request('/api/session',{},registered);assert.equal(oldUserSession.status,200);
    await request('/api/logout',{method:'POST',body:'{}'},registered);assert.equal((await request('/api/session',{},registered)).status,401);
  });
});

test('v2 chain managers migrate to HQ without losing data, and only affected sessions are revoked',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'andrew-test-legacy-')),dbPath=join(directory,'legacy.sqlite');
  let db=createDatabase(dbPath),app;
  t.after(async()=>{if(app)await app.close();if(db)db.close();removeFixture(directory);});
  const managerRow=db.sql.prepare('SELECT * FROM users WHERE username=?').get('manager');
  const manager=JSON.parse(managerRow.data),customerRow=db.sql.prepare('SELECT * FROM users WHERE username=?').get('chen');
  const legacyHQ={...manager,id:'LEGACY-HQ',username:'oldhq',name:'旧总部账号',role:'hq',clinicIds:[]};
  const legacyManager={...manager,clinicIds:[]};
  db.sql.prepare('UPDATE users SET data=? WHERE id=?').run(JSON.stringify(legacyManager),manager.id);
  db.sql.prepare('INSERT INTO users(id,username,password_hash,data) VALUES(?,?,?,?)').run(legacyHQ.id,legacyHQ.username,managerRow.password_hash,JSON.stringify(legacyHQ));
  db.sql.prepare('DELETE FROM schema_migrations WHERE version=3').run();
  db.sql.prepare("UPDATE metadata SET value='4-portal-v1' WHERE key='roleModelVersion'").run();
  const tokens={hq:'a'.repeat(64),manager:'b'.repeat(64),customer:'c'.repeat(64)},hash=value=>createHash('sha256').update(value).digest('hex');
  for(const [key,userId] of [['hq',legacyHQ.id],['manager',manager.id],['customer',customerRow.id]]) {
    db.sql.prepare('INSERT INTO sessions(token_hash,user_id,csrf,expires_at,created_at) VALUES(?,?,?,?,?)').run(hash(tokens[key]),userId,'legacy-test-csrf',Date.now()+3600000,Date.now());
  }
  const before=Object.fromEntries(['patients','appointments','visits','settlements','costs','quarterReports'].map(table=>[table,db.all(table)]));
  db.close();db=null;app=await start({dbPath,port:0});
  for(const id of [legacyHQ.id,manager.id]) {
    const row=app.db.sql.prepare('SELECT * FROM users WHERE id=?').get(id),user=JSON.parse(row.data);
    assert.equal(user.id,id);assert.equal(user.role,'hq');assert.deepEqual(user.clinicIds,[]);assert.equal(row.password_hash,managerRow.password_hash);
    assert.equal(app.db.sql.prepare('SELECT count(*) AS count FROM sessions WHERE user_id=?').get(id).count,0);
  }
  for(const [table,values] of Object.entries(before))assert.deepEqual(app.db.all(table),values,table+' must survive role migration');
  assert.equal(app.db.sql.prepare("SELECT value FROM metadata WHERE key='roleModelVersion'").get().value,'5-portal-v1');
  const base=`http://127.0.0.1:${app.address.port}`;
  for(const key of ['hq','manager'])assert.equal((await fetch(base+'/api/session',{headers:{Cookie:`dental_session=${tokens[key]}`}})).status,401);
  assert.equal((await fetch(base+'/api/session',{headers:{Cookie:`dental_session=${tokens.customer}`}})).status,200);
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'oldhq',password:'Dental2026!',portal:'hq'})});
  assert.equal(login.status,200);const migrated=await login.json();assert.equal(migrated.user.role,'hq');assert.ok(migrated.user.permissions.includes('quarter.approve'));
  const count=app.db.sql.prepare('SELECT count(*) AS count FROM sessions WHERE user_id=?').get(legacyHQ.id).count;
  await app.close();app=null;db=createDatabase(dbPath);assert.equal(db.sql.prepare('SELECT count(*) AS count FROM sessions WHERE user_id=?').get(legacyHQ.id).count,count);
});

test('demo disabled startup creates schema without synthetic accounts or clinical data',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'andrew-test-empty-')),dbPath=join(directory,'empty.sqlite');
  const app=await start({dbPath,port:0,seed:false});
  t.after(async()=>{await app.close();removeFixture(directory);});
  const base=`http://127.0.0.1:${app.address.port}`,config=await fetch(base+'/api/portal-config');
  assert.equal(config.status,200);assert.deepEqual(await config.json(),{demoEnabled:false});
  assert.equal(app.db.sql.prepare('SELECT count(*) AS count FROM users').get().count,0);assert.equal(app.db.all('patients').length,0);assert.equal(app.db.all('appointments').length,0);
  assert.equal(app.db.sql.prepare("SELECT value FROM metadata WHERE key='seedVersion'").get(),undefined);
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'hq',password:'Dental2026!',portal:'hq'})});assert.equal(login.status,401);
  const tables=app.db.sql.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name);for(const name of requiredTables)assert.ok(tables.includes(name),`Missing required table ${name}`);
  const policy=app.db.get('settings','global');assert.equal(policy.cancellationHours,24);assert.equal(policy.version,1);
  const hq={id:'USER-INITIAL-MANAGER',username:'initialmanager',name:'初始店长',role:'hq',clinicIds:[]};
  app.db.sql.prepare('INSERT INTO users(id,username,password_hash,data) VALUES(?,?,?,?)').run(hq.id,hq.username,hashPassword('InitialManager2026!'),JSON.stringify(hq));
  const authenticated=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:hq.username,password:'InitialManager2026!',portal:'hq'})});assert.equal(authenticated.status,200);
  const auth=await authenticated.json(),cookie=authenticated.headers.get('set-cookie').split(';')[0];
  const stateResponse=await fetch(base+'/api/state',{headers:{Cookie:cookie}});assert.equal(stateResponse.status,200);const state=await stateResponse.json();assert.equal(state.settings.cancellationHours,24);assert.deepEqual(state.patients,[]);
  const update=await fetch(base+'/api/command',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':auth.csrfToken},body:JSON.stringify({type:'settings.save',payload:{cancellationHours:12,version:state.settings.version}})});assert.equal(update.status,200);assert.equal((await update.json()).result.cancellationHours,12);
});
