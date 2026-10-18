import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createDatabase } from '../server/db.js';
import { getWorkspace } from '../server/domain.js';
import { validateDeployment } from '../server/http/configuration.js';
import { DatabaseSync } from 'node:sqlite';
import { tables } from '../server/db.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');

test('backup scheduling retains verified snapshots and respects unrelated files',t=>{
 const directory=mkdtempSync(join(tmpdir(),'dental-operations-'));t.after(()=>{const target=resolve(directory);if(!target.startsWith(resolve(tmpdir())+sep)||!basename(target).startsWith('dental-operations-'))throw new Error('Unsafe fixture');rmSync(target,{recursive:true,force:true,maxRetries:3});});
 const path=join(directory,'database.sqlite'),backups=join(directory,'backups');const db=createDatabase(path);db.close();mkdirSync(backups);
 for(const name of ['dental-2020-01-01T00-00-00-000Z.sqlite','dental-2020-01-02T00-00-00-000Z.sqlite','manual-preserved.sqlite'])copyFileSync(path,join(backups,name));
 const result=spawnSync(process.execPath,[resolve(root,'tools/backup-daemon.mjs'),'--once'],{encoding:'utf8',env:{...process.env,DENTAL_DB_PATH:path,DENTAL_BACKUP_DIR:backups,DENTAL_BACKUP_KEEP:'2'}});
 assert.equal(result.status,0,result.stderr);const files=readdirSync(backups);assert.ok(files.includes('manual-preserved.sqlite'));assert.equal(files.filter(name=>name.startsWith('dental-')).length,2);assert.ok(!files.includes('dental-2020-01-01T00-00-00-000Z.sqlite'));
});

test('production configuration rejects insecure or accidental demo deployment before opening storage',()=>{
 const keys=['NODE_ENV','PUBLIC_ORIGIN','COOKIE_SECURE','DENTAL_SEED_DEMO','DENTAL_PUBLIC_DEMO'],prior=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 try{process.env.NODE_ENV='production';delete process.env.PUBLIC_ORIGIN;assert.throws(()=>validateDeployment(),/HTTPS/);process.env.PUBLIC_ORIGIN='https://dental.example.com';process.env.COOKIE_SECURE='0';assert.throws(()=>validateDeployment(),/COOKIE_SECURE/);process.env.COOKIE_SECURE='1';process.env.DENTAL_SEED_DEMO='1';delete process.env.DENTAL_PUBLIC_DEMO;assert.throws(()=>validateDeployment(),/演示/);process.env.DENTAL_SEED_DEMO='0';assert.doesNotThrow(()=>validateDeployment());}
 finally{for(const key of keys)if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];}
});

test('workspace date and secondary pagers are validated and identity search remains scoped',()=>{
 const db=createDatabase(':memory:');try{
  const manager=JSON.parse(db.sql.prepare('SELECT data FROM users WHERE username=?').get('manager').data);
  const front=JSON.parse(db.sql.prepare('SELECT data FROM users WHERE username=?').get('front').data);
  assert.equal(getWorkspace(db,manager,{page:'patients',q:'P001'}).patients[0].id,'P001');
  assert.equal(getWorkspace(db,manager,{page:'accounts',q:'doctor'}).accounts.length,1);
  assert.equal(getWorkspace(db,manager,{page:'accounts',accountRef:'U002'}).accounts[0].username,'front');
  const state=getWorkspace(db,front,{page:'settlements',pendingOffset:25});assert.equal(state.pendingPagination.offset,25);assert.equal(state.pendingPagination.limit,25);
  assert.throws(()=>getWorkspace(db,manager,{page:'finance',reconciliationOffset:-1}),/分页/);
  assert.throws(()=>getWorkspace(db,manager,{page:'appointments',date:'2026-02-30'}),/日期/);
  const stats=getWorkspace(db,manager,{page:'home'}).stats;assert.equal(stats.last7Days.length,7);assert.ok(Number.isInteger(stats.todayBooked));
  const quarter=getWorkspace(db,manager,{page:'performance',quarter:'2026-Q1'});assert.equal(quarter.metrics.window,'2026-Q1已到期记录');
 }finally{db.close();}
});

test('offline restore upgrades a legacy sixteen-table snapshot on a copy and revokes sessions',t=>{
 const directory=mkdtempSync(join(tmpdir(),'dental-operations-'));t.after(()=>{const target=resolve(directory);if(!target.startsWith(resolve(tmpdir())+sep)||!basename(target).startsWith('dental-operations-'))throw new Error('Unsafe fixture');rmSync(target,{recursive:true,force:true,maxRetries:3});});
 const target=join(directory,'current.sqlite'),snapshot=join(directory,'legacy.sqlite'),seed=createDatabase(':memory:');
 const old=new DatabaseSync(snapshot);
 old.exec('CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT UNIQUE,password_hash TEXT,data TEXT); CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT,csrf TEXT,expires_at INTEGER,created_at INTEGER); CREATE TABLE audit(id TEXT PRIMARY KEY,at TEXT,user_id TEXT,type TEXT,target_id TEXT,detail TEXT);');
 for(const table of tables){old.exec(`CREATE TABLE ${table}(id TEXT PRIMARY KEY,data TEXT,version INTEGER)`);for(const object of seed.all(table))old.prepare(`INSERT INTO ${table} VALUES(?,?,?)`).run(object.id,JSON.stringify(object),object.version);}
 for(const row of seed.sql.prepare('SELECT id,username,password_hash,data FROM users').all())old.prepare('INSERT INTO users VALUES(?,?,?,?)').run(row.id,row.username,row.password_hash,row.data);
 old.exec("INSERT INTO metadata VALUES('seedVersion','2'); INSERT INTO metadata VALUES('roleModelVersion','4-portal-v1'); INSERT INTO sessions VALUES('old-cookie','U001','csrf',9999999999999,0)");old.close();seed.close();
 const current=createDatabase(target);current.put('patients',{...current.get('patients','P001'),name:'恢复前记录'});current.close();
 const result=spawnSync(process.execPath,[resolve(root,'tools/database.mjs'),'restore',snapshot,'--offline'],{encoding:'utf8',env:{...process.env,DENTAL_DB_PATH:target,DENTAL_SEED_DEMO:'0'}});
 assert.equal(result.status,0,result.stderr);const details=JSON.parse(result.stdout);assert.equal(details.upgradedFromLegacy,true);assert.equal(details.validatedTables,38);
 const restored=createDatabase(target,{seed:false});try{assert.equal(restored.get('patients','P001').name,'陈晨');assert.equal(restored.sql.prepare('SELECT count(*) n FROM sessions').get().n,0);assert.equal(restored.sql.prepare('PRAGMA foreign_key_check').all().length,0);}finally{restored.close();}
});
