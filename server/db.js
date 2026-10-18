import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedDatabase } from './seed.js';
import { createRepositories, tables } from './repositories/entities.js';
import { migrate } from './migrations/runner.js';
export { tables };
export const serverDirectory=dirname(fileURLToPath(import.meta.url));
export const defaultDatabasePath=resolve(serverDirectory,'data/dental.sqlite');
export const id=prefix=>`${prefix}-${randomBytes(8).toString('hex')}`;
export const hashPassword=password=>{const salt=randomBytes(16).toString('hex');return `${salt}:${scryptSync(password,salt,64).toString('hex')}`;};
export function verifyPassword(password,stored){if(typeof stored!=='string')return false;const [salt,digest]=stored.split(':');if(!salt||!digest)return false;const candidate=scryptSync(password,salt,64),expected=Buffer.from(digest,'hex');return candidate.length===expected.length&&timingSafeEqual(candidate,expected);}
export function createDatabase(path=process.env.DENTAL_DB_PATH||defaultDatabasePath,options={}){
  if(path!==':memory:'){path=resolve(path);mkdirSync(dirname(path),{recursive:true});}
  const sql=new DatabaseSync(path);
  try{
    sql.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000');
    const migration=migrate(sql,path,serverDirectory),repo=createRepositories(sql);
    let depth=0,serial=0;
    const api={sql,path,migration,...repo,
      transaction(fn){const outer=depth===0,savepoint=`dental_${++serial}`;sql.exec(outer?'BEGIN IMMEDIATE':`SAVEPOINT ${savepoint}`);depth++;try{const result=fn();if(result&&typeof result.then==='function')throw new Error('Database transactions must be synchronous');sql.exec(outer?'COMMIT':`RELEASE ${savepoint}`);return result;}catch(error){sql.exec(outer?'ROLLBACK':`ROLLBACK TO ${savepoint}`);if(!outer)sql.exec(`RELEASE ${savepoint}`);throw error;}finally{depth--; }},
      close(){sql.close();}
    };
    api.put=(table,object)=>depth?repo.put(table,object):api.transaction(()=>repo.put(table,object));
    if(!sql.prepare("SELECT value FROM metadata WHERE key='seedVersion'").get()&&options.seed!==false&&process.env.DENTAL_SEED_DEMO!=='0')api.transaction(()=>seedDatabase(api));
    if(!api.get('settings','global'))api.put('settings',{id:'global',cancellationHours:24,fundRate:0.1,version:1});
    return api;
  }catch(error){sql.close();throw error;}
}
export function quarterOf(timestamp){const date=new Date(new Date(timestamp).getTime()+8*3600000);return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth()/3)+1}`;}
