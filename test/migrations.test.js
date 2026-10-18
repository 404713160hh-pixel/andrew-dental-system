import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase, tables } from '../server/db.js';
import { getWorkspace } from '../server/domain.js';

function fixture(t){const directory=mkdtempSync(join(tmpdir(),'dental-migration-'));t.after(()=>rmSync(directory,{recursive:true,force:true,maxRetries:3}));return {directory,path:join(directory,'old.sqlite')};}
function legacy(path,invalid=false){
 const source=createDatabase(':memory:');const objects=Object.fromEntries(tables.map(table=>[table,source.all(table)]));
 const users=source.sql.prepare('SELECT id,username,password_hash,data FROM users').all();source.close();
 const sql=new DatabaseSync(path);sql.exec('CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT UNIQUE,password_hash TEXT NOT NULL,data TEXT NOT NULL); CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),csrf TEXT,expires_at INTEGER,created_at INTEGER); CREATE TABLE audit(id TEXT PRIMARY KEY,at TEXT,user_id TEXT,type TEXT,target_id TEXT,detail TEXT);');
 for(const table of tables){sql.exec(`CREATE TABLE ${table}(id TEXT PRIMARY KEY,data TEXT NOT NULL,version INTEGER NOT NULL)`);for(const object of objects[table]){if(invalid&&table==='patients'&&object.id==='P001')object.createdClinicId='missing-clinic';sql.prepare(`INSERT INTO ${table} VALUES(?,?,?)`).run(object.id,JSON.stringify(object),object.version);}}
 for(const u of users)sql.prepare('INSERT INTO users VALUES(?,?,?,?)').run(u.id,u.username,u.password_hash,u.data);
 sql.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run('customer-session','U001','csrf',Date.now()+99999,Date.now());
 sql.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run('hq-session','U004','csrf',Date.now()+99999,Date.now());
 sql.exec("INSERT INTO metadata VALUES('seedVersion','2'); INSERT INTO metadata VALUES('roleModelVersion','4-portal-v1'); INSERT INTO audit VALUES('old-audit','2026-01-01T00:00:00.000Z','U001','patient.save','P001','{}');");
 sql.close();return {objects,users};
}
test('legacy JSON migration snapshots, preserves records and children, checks foreign keys and reapplies idempotently',t=>{
 const f=fixture(t),original=legacy(f.path);let db=createDatabase(f.path);
 assert.equal(db.migration.version,3);assert.ok(db.migration.backup);assert.equal(readdirSync(f.directory).filter(n=>n.includes('pre-migration')).length,1);
 assert.equal(db.sql.prepare('PRAGMA foreign_key_check').all().length,0);
 for(const table of tables){assert.equal(db.all(table).length,original.objects[table].length);assert.equal(db.sql.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name==='data'),false);}
 assert.deepEqual(db.get('patients','P002').allergies,original.objects.patients.find(p=>p.id==='P002').allergies);
 assert.deepEqual(db.get('visits','V001').lines,original.objects.visits.find(v=>v.id==='V001').lines);
 assert.equal(db.get('settlements','INV-V001').total,28000);assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM audit').get().n,1);
 assert.equal(db.sql.prepare('SELECT password_hash FROM users WHERE id=?').get('U001').password_hash,original.users.find(u=>u.id==='U001').password_hash);
 assert.ok(db.sql.prepare('SELECT 1 FROM sessions WHERE token_hash=?').get('customer-session'));assert.equal(db.sql.prepare('SELECT 1 FROM sessions WHERE token_hash=?').get('hq-session'),undefined);
 db.close();db=createDatabase(f.path);assert.equal(db.migration.backup,null);assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM schema_migrations').get().n,3);db.close();
});
test('migration refuses a live service PID without changing the old layout',t=>{
 const f=fixture(t);legacy(f.path);const before=readFileSync(f.path);writeFileSync(f.path+'.server.lock',JSON.stringify({pid:process.pid}));assert.throws(()=>createDatabase(f.path),/正在运行/);
 const sql=new DatabaseSync(f.path);assert.ok(sql.prepare('PRAGMA table_info(patients)').all().some(c=>c.name==='data'));sql.close();
 // SQLite may initialize WAL mode before refusing migration; content stays intact.
 const check=new DatabaseSync(f.path);assert.equal(check.prepare('SELECT COUNT(*) n FROM patients').get().n,3);check.close();assert.ok(before.length>0);
});
test('invalid legacy foreign keys roll back all structure changes and retain a recoverable snapshot',t=>{
 const f=fixture(t);legacy(f.path,true);assert.throws(()=>createDatabase(f.path),/关联检查失败/);const sql=new DatabaseSync(f.path);
 assert.ok(sql.prepare('PRAGMA table_info(patients)').all().some(c=>c.name==='data'));assert.equal(JSON.parse(sql.prepare('SELECT data FROM patients WHERE id=?').get('P001').data).createdClinicId,'missing-clinic');assert.equal(sql.prepare("SELECT 1 FROM sqlite_master WHERE name='schema_migrations'").get(),undefined);sql.close();assert.equal(readdirSync(f.directory).filter(n=>n.includes('pre-migration')).length,1);
});
test('migration checksum detects edited history and nested transactions isolate savepoint failures',t=>{
 const f=fixture(t);let db=createDatabase(f.path);db.transaction(()=>{const original=db.get('settings','global');try{db.transaction(()=>{db.put('settings',{...original,cancellationHours:2,version:2});throw new Error('inner');});}catch(error){assert.equal(error.message,'inner');}assert.equal(db.get('settings','global').cancellationHours,24);db.put('settings',{...original,cancellationHours:12,version:2});});assert.equal(db.get('settings','global').cancellationHours,12);
 db.sql.prepare('UPDATE schema_migrations SET checksum=? WHERE version=1').run('tampered');db.close();assert.throws(()=>createDatabase(f.path),/校验失败/);
});
test('workspace SQL pagination is bounded and cannot broaden patient authorization',()=>{
 const db=createDatabase(':memory:');try{const hq=JSON.parse(db.sql.prepare("SELECT data FROM users WHERE username='hq'").get().data),customer=JSON.parse(db.sql.prepare("SELECT data FROM users WHERE username='chen'").get().data);
 const first=getWorkspace(db,hq,{page:'appointments',limit:2,offset:0}),second=getWorkspace(db,hq,{page:'appointments',limit:2,offset:2});assert.equal(first.pagination.total,6);assert.equal(first.appointments.length,2);assert.equal(new Set([...first.appointments,...second.appointments].map(a=>a.id)).size,4);assert.throws(()=>getWorkspace(db,hq,{page:'patients',limit:101}),/分页/);
 const own=getWorkspace(db,customer,{page:'appointments',limit:100});assert.ok(own.appointments.every(a=>a.patientId==='P001'));assert.ok(own.patients.every(p=>p.id==='P001'));assert.throws(()=>getWorkspace(db,customer,{page:'patients'}),/无权/);
 }finally{db.close();}
});
