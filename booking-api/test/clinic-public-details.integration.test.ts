import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { migrate, poolFor } from '../src/db.js';
import { projectRoot } from '../src/paths.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { seed } from '../src/seed.js';

test('upgrade preserves existing clinics and old staff edits preserve new public details', {timeout:120000}, async () => {
 const base=process.env.TEST_DATABASE_URL||process.env.DATABASE_URL; assert.ok(base, 'A local test PostgreSQL server is required');
 const root=new URL(base); assert.ok(['localhost','127.0.0.1','[::1]'].includes(root.hostname), 'Remote database forbidden');
 root.pathname='/postgres'; const admin=poolFor(root.toString()); const name='andrew_test_'+randomBytes(10).toString('hex');
 const target=new URL(base); target.pathname='/'+name; let db:ReturnType<typeof poolFor>|undefined; let app:Awaited<ReturnType<typeof createApp>>|undefined; let created=false;
 try {
  await admin.query(`CREATE DATABASE "${name}"`); created=true; db=poolFor(target.toString());
  await db.query('CREATE TABLE schema_migrations(version text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
  const dir=join(projectRoot,'database','migrations');
  for(const file of (await readdir(dir)).filter(x=>x.endsWith('.sql')&&x<'007_').sort()){
   const sql=await readFile(join(dir,file),'utf8'); await db.query(sql);
   await db.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)',[file,createHash('sha256').update(sql).digest('hex')]);
  }
  const password='OnlySynthetic-'+randomBytes(20).toString('hex'); await seed(db,password);
  const before=(await db.query('SELECT id,name,row_version FROM clinics ORDER BY name')).rows;
  const applied=await migrate(db);
  assert.equal(applied[0],'007_clinic_public_details.sql');
  assert.deepEqual(await migrate(db),[]);
  const after=(await db.query('SELECT id,name,row_version,description,opening_hours FROM clinics ORDER BY name')).rows;
  assert.deepEqual(after.map(({id,name,row_version})=>({id,name,row_version})),before); assert.ok(after.every(x=>x.description===null&&x.opening_hours===null));
  const id=after[0].id; await db.query('UPDATE clinics SET description=$1,opening_hours=$2 WHERE id=$3',['合成简介','周一至周五 09:00–18:00',id]);
  app=await createApp(loadConfig({NODE_ENV:'test',DATABASE_URL:target.toString(),ALLOW_DEMO_LOGIN:'false'}),db,false); await app.ready();
  const get=await app.inject({method:'GET',url:'/api/v1/clinics'}); assert.equal(get.statusCode,200);
  const clinic=get.json().data.find((x:{id:string})=>x.id===id); assert.equal(clinic.description,'合成简介'); assert.equal(clinic.openingHours,'周一至周五 09:00–18:00');
  const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{username:'hq',password,portal:'staff'}}); assert.equal(login.statusCode,200,login.body);
  const token=login.json().data.token;
  const edit=await app.inject({method:'PUT',url:'/api/v1/staff/clinics/'+id,headers:{authorization:'Bearer '+token},payload:{name:clinic.name,address:clinic.address,phone:clinic.phone,email:clinic.email,timezone:clinic.timezone,active:clinic.active,expectedVersion:clinic.rowVersion}});
  assert.equal(edit.statusCode,200,edit.body); assert.equal(edit.json().data.description,'合成简介'); assert.equal(edit.json().data.openingHours,'周一至周五 09:00–18:00');
  const oldBody={name:clinic.name,address:clinic.address,phone:clinic.phone,email:clinic.email,timezone:clinic.timezone,active:clinic.active};
  const editPath='/api/v1/staff/clinics/'+id;
  const update=await app.inject({method:'PUT',url:editPath,headers:{authorization:'Bearer '+token},payload:{...oldBody,expectedVersion:edit.json().data.rowVersion,description:'  更新简介  ',openingHours:' 周末 10:00–17:00 '}});
  assert.equal(update.statusCode,200,update.body); assert.equal(update.json().data.description,'更新简介'); assert.equal(update.json().data.openingHours,'周末 10:00–17:00');
  const publicAgain=await app.inject({method:'GET',url:'/api/v1/clinics'}); const visible=publicAgain.json().data.find((x:{id:string})=>x.id===id);
  assert.equal(visible.description,'更新简介');assert.equal(visible.openingHours,'周末 10:00–17:00');
  const invalid=await app.inject({method:'PUT',url:editPath,headers:{authorization:'Bearer '+token},payload:{...oldBody,expectedVersion:update.json().data.rowVersion,description:'x'.repeat(2001)}});assert.equal(invalid.statusCode,400);
  const tooLong=await app.inject({method:'PUT',url:editPath,headers:{authorization:'Bearer '+token},payload:{...oldBody,expectedVersion:update.json().data.rowVersion,openingHours:'x'.repeat(301)}});assert.equal(tooLong.statusCode,400);
  const stale=await app.inject({method:'PUT',url:editPath,headers:{authorization:'Bearer '+token},payload:{...oldBody,expectedVersion:edit.json().data.rowVersion,openingHours:'过期修改'}});assert.equal(stale.statusCode,409);
  for(const [user,portal] of [['front.a','staff'],['patient.a','patient']] as const){
   const auth=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{username:user,password,portal}});assert.equal(auth.statusCode,200,auth.body);
   const denied=await app.inject({method:'PUT',url:editPath,headers:{authorization:'Bearer '+auth.json().data.token},payload:{...oldBody,expectedVersion:update.json().data.rowVersion,description:'不允许'}});assert.equal(denied.statusCode,403);
  }
  const managerLogin=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{username:'manager.a',password,portal:'staff'}});assert.equal(managerLogin.statusCode,200,managerLogin.body);
  const manager=managerLogin.json().data.token;
  const scope=(await db.query(`SELECT ra.clinic_id FROM role_assignments ra JOIN users u ON u.id=ra.user_id WHERE u.username='manager.a' AND ra.role='manager'`)).rows[0].clinic_id;
  const scoped=after.find(x=>x.id===scope); const outside=after.find(x=>x.id!==scope); assert.ok(scoped&&outside);
  const list=await app.inject({method:'GET',url:'/api/v1/clinics?includeInactive=true',headers:{authorization:'Bearer '+manager}}); const scopedClinic=list.json().data.find((x:{id:string})=>x.id===scope);assert.ok(scopedClinic);
  const scopedBody={name:scopedClinic.name,address:scopedClinic.address,phone:scopedClinic.phone,email:scopedClinic.email,timezone:scopedClinic.timezone,active:scopedClinic.active,expectedVersion:scopedClinic.rowVersion,description:'门店授权修改'};
  const allowed=await app.inject({method:'PUT',url:'/api/v1/staff/clinics/'+scope,headers:{authorization:'Bearer '+manager},payload:scopedBody});assert.equal(allowed.statusCode,200,allowed.body);
  const forbidden=await app.inject({method:'PUT',url:'/api/v1/staff/clinics/'+outside.id,headers:{authorization:'Bearer '+manager},payload:scopedBody});assert.equal(forbidden.statusCode,403);
  const clear=await app.inject({method:'PUT',url:editPath,headers:{authorization:'Bearer '+token},payload:{...oldBody,expectedVersion:(scope===id?allowed:update).json().data.rowVersion,description:null,openingHours:null}});
  assert.equal(clear.statusCode,200,clear.body);assert.equal(clear.json().data.description,null);assert.equal(clear.json().data.openingHours,null);
 } finally {
  if(app)await app.close(); if(db)await db.end();
  if(created){assert.match(name,/^andrew_test_[a-f0-9]{20}$/);await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[name]);await admin.query(`DROP DATABASE "${name}"`);} await admin.end();
 }
});
