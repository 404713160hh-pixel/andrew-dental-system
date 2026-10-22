import pg from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { projectRoot } from './paths.js';
export type Db=pg.Pool | PoolClient;
export const poolFor=(url:string)=>{
 const pool=new pg.Pool({connectionString:url,max:12,connectionTimeoutMillis:5000,statement_timeout:15000,options:'-c timezone=UTC'});
 // Restarting PostgreSQL closes idle pooled sockets. Handle that event while
 // allowing subsequent requests to establish fresh connections.
 pool.on('error',(error:Error)=>{process.stderr.write(JSON.stringify({event:'postgres_idle_connection_closed',code:(error as {code?:string}).code})+'\n');});
 return pool;
};
export async function one<T extends QueryResultRow>(db:Db,sql:string,values:unknown[]=[]):Promise<T|undefined>{return (await db.query<T>(sql,values)).rows[0];}
export async function transaction<T>(pool:pg.Pool,work:(db:PoolClient)=>Promise<T>):Promise<T>{
 for(let attempt=0;;attempt++){
  const db=await pool.connect();
  try {await db.query('BEGIN');const result=await work(db);await db.query('COMMIT');return result;}
  catch(error){await db.query('ROLLBACK');if(attempt<2&&['40P01','40001'].includes((error as {code:string}).code))continue;throw error;}
  finally{db.release();}
 }
}
export async function migrate(pool:pg.Pool):Promise<string[]>{
 const dir=join(projectRoot,'database','migrations');
 return transaction(pool,async db=>{
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended('andrew.booking.migrations',0))");
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
  const applied:string[]=[];
  for(const file of (await readdir(dir)).filter(x=>x.endsWith('.sql')).sort()){
   const sql=await readFile(join(dir,file),'utf8');const checksum=createHash('sha256').update(sql).digest('hex');
   const old=await one<{checksum:string}>(db,'SELECT checksum FROM schema_migrations WHERE version=$1',[file]);
   if(old){if(old.checksum!==checksum)throw new Error('Migration checksum changed: '+file);continue;}
   await db.query(sql);await db.query('INSERT INTO schema_migrations(version,checksum)VALUES($1,$2)',[file,checksum]);applied.push(file);
  }return applied;
 });
}
export const iso=(value:Date|string)=>new Date(value).toISOString();
export const utcDay=(value:string)=>new Date(value).toISOString().slice(0,10);
