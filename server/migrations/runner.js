import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRepositories, tables } from '../repositories/entities.js';
export function ensureMigrationOffline(path) {
  if(path===':memory:')return;
  let lock;
  try { lock=JSON.parse(readFileSync(`${path}.server.lock`,'utf8')); }
  catch(error) { if(error.code==='ENOENT')return; throw new Error('数据库升级前请停止服务并检查运行锁'); }
  if(!Number.isInteger(lock.pid)||lock.pid<=0)throw new Error('数据库运行锁无效，请先检查服务状态');
  let alive=false;
  try { process.kill(lock.pid,0); alive=true; } catch(error) { alive=error.code!=='ESRCH'; }
  if(alive)throw new Error('旧数据库服务正在运行，请停止服务后升级数据库');
}
export function migrate(sql,path,directory) {
  const versions=[{version:1,name:'normalized-domain',source:readFileSync(resolve(directory,'schema.sql'),'utf8')},{version:2,name:'business-ledgers',source:readFileSync(resolve(directory,'migrations/extensions.sql'),'utf8')}];
  for(const step of versions)step.checksum=createHash('sha256').update(step.source).digest('hex');
  const exists=name=>Boolean(sql.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
  const legacy=exists('patients')&&sql.prepare('PRAGMA table_info(patients)').all().some(c=>c.name==='data');
  const applied=exists('schema_migrations')?sql.prepare('SELECT * FROM schema_migrations ORDER BY version').all():[];
  for(const row of applied){const step=versions.find(s=>s.version===row.version);if(!step||step.checksum!==row.checksum)throw new Error(`数据库迁移 ${row.version} 校验失败，禁止修改已发布的迁移`);}
  const pending=versions.filter(s=>!applied.some(a=>a.version===s.version));
  const needsRoles=exists('metadata')&&sql.prepare("SELECT value FROM metadata WHERE key='roleModelVersion'").get()?.value!=='4-portal-v1';
  if(!pending.length&&!needsRoles)return {version:versions.at(-1).version,backup:null};
  ensureMigrationOffline(path);
  let backup=null;
  if(path!==':memory:'&&(exists('patients')||exists('users'))){backup=`${path}.pre-migration-${Date.now()}.sqlite`;sql.prepare('VACUUM INTO ?').run(backup);}
  const old={};
  if(legacy)for(const table of tables)old[table]=sql.prepare(`SELECT data FROM ${table} ORDER BY rowid`).all().map(r=>JSON.parse(r.data));
  sql.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
  try {
    if(legacy)for(const table of [...tables].reverse())sql.exec(`DROP TABLE ${table}`);
    if(exists('users')){
      const columns=new Set(sql.prepare('PRAGMA table_info(users)').all().map(c=>c.name));
      for(const [name,type] of [['role','TEXT'],['name','TEXT'],['patient_id','TEXT'],['dentist_id','TEXT'],['active','INTEGER NOT NULL DEFAULT 1']])if(!columns.has(name))sql.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
    }
    for(const step of pending){
      sql.exec(step.source);
      if(step.version===1&&legacy){
        const repo=createRepositories(sql);
        for(const table of ['clinics','qualifications','dentists','treatments','patients','schedules','appointments','visits','settlements','costs','quarterReports','settings'])for(const object of old[table])repo.put(table,object);
      }
      sql.prepare('INSERT INTO schema_migrations(version,name,checksum,applied_at) VALUES(?,?,?,?)').run(step.version,step.name,step.checksum,new Date().toISOString());
    }
    sql.exec('UPDATE users SET data=data');
    for(const row of sql.prepare('SELECT id,data FROM users').all()){
      const user=JSON.parse(row.data);
      if(user.role==='hq'||user.role==='manager'){
        sql.prepare('UPDATE users SET data=? WHERE id=?').run(JSON.stringify({...user,role:'manager',clinicIds:[]}),row.id);
        sql.prepare('DELETE FROM sessions WHERE user_id=?').run(row.id);
      }
    }
    sql.prepare("INSERT INTO metadata(key,value) VALUES('roleModelVersion','4-portal-v1') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
    if(sql.prepare('PRAGMA foreign_key_check').all().length)throw new Error('数据库升级关联检查失败，原库保持不变');
    sql.exec('COMMIT');
  }catch(error){sql.exec('ROLLBACK');throw error;}
  finally{sql.exec('PRAGMA foreign_keys=ON');}
  return {version:versions.at(-1).version,backup};
}
