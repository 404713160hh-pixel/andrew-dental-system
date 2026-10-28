/** Exercise current compiled mini-program modules and real Vue against a disposable local database. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn,spawnSync,type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { config as dotenv } from 'dotenv';
import { poolFor,migrate } from '../booking-api/src/db.js';
import { loadConfig } from '../booking-api/src/config.js';
import { createApp } from '../booking-api/src/app.js';
import { seed } from '../booking-api/src/seed.js';

dotenv({path:resolve('.env.booking'),quiet:true});
const base=process.env.TEST_DATABASE_URL||process.env.DATABASE_URL;
assert.ok(base,'A local PostgreSQL test server is required');
const baseUrl=new URL(base);
assert.ok(['localhost','127.0.0.1','[::1]'].includes(baseUrl.hostname),'Refusing a remote PostgreSQL server');
const name=`andrew_test_${randomBytes(10).toString('hex')}`;
const adminUrl=new URL(base);adminUrl.pathname='/postgres';
const testUrl=new URL(base);testUrl.pathname='/'+name;
const admin=poolFor(adminUrl.toString());
let db:ReturnType<typeof poolFor>|undefined,app:Awaited<ReturnType<typeof createApp>>|undefined,vite:ChildProcess|undefined,created=false;
const port=()=>new Promise<number>((ok,fail)=>{const server=createServer();server.once('error',fail);server.listen(0,'127.0.0.1',()=>{const address=server.address();if(!address||typeof address==='string')return fail(new Error('No local port'));server.close(()=>ok(address.port));});});
try {
 assert.match(name,/^andrew_test_[a-f0-9]{20}$/);
 const build=spawnSync(process.execPath,[resolve('miniprogram/scripts/build.mjs')],{cwd:process.cwd(),stdio:'inherit',env:{...process.env,ANDREW_MINI_BUILD:'development'}});
 assert.equal(build.status,0,'Native build failed');
 await admin.query(`CREATE DATABASE "${name}"`);created=true;
 db=poolFor(testUrl.toString());await migrate(db);await seed(db,`OnlySynthetic-${randomBytes(24).toString('base64url')}`);
 app=await createApp(loadConfig({NODE_ENV:'test',DATABASE_URL:testUrl.toString(),ALLOW_DEMO_LOGIN:'true'}),db,false);
 await app.listen({host:'127.0.0.1',port:0});
 const address=app.server.address();assert.ok(address&&typeof address!=='string');
 const apiUrl=`http://127.0.0.1:${address.port}`,adminPort=await port(),adminUrl=`http://127.0.0.1:${adminPort}`;
 vite=spawn(process.execPath,[resolve('node_modules/vite/bin/vite.js'),'admin-web','--host','127.0.0.1','--port',String(adminPort),'--strictPort'],{cwd:process.cwd(),windowsHide:true,stdio:'ignore',env:{...process.env,BOOKING_API_URL:apiUrl,NODE_ENV:'development'}});
 for(let attempt=0;attempt<80;attempt++){
  if(vite.exitCode!==null)throw new Error('Temporary Vite server exited');
  try {if((await fetch(adminUrl,{signal:AbortSignal.timeout(1000)})).ok)break;}catch{}
  if(attempt===79)throw new Error('Temporary Vite server did not start');await delay(250);
 }
 const result=await new Promise<number>((done,fail)=>{
  const child=spawn(process.execPath,[resolve('scripts/booking-cross-client.mjs')],{cwd:process.cwd(),windowsHide:true,stdio:'inherit',env:{...process.env,DATABASE_URL:testUrl.toString(),NODE_ENV:'test',CROSS_CLIENT_ALLOW_FIXTURES:'1',CROSS_CLIENT_MODE:'compiled-native',BOOKING_API_TEST_URL:apiUrl,BOOKING_ADMIN_TEST_URL:adminUrl,CROSS_CLIENT_REPORT_PATH:'docs/implementation/qa/cross-client-isolated.json'}});
  child.once('error',fail);child.once('exit',code=>done(code??1));
 });
 assert.equal(result,0,'Cross-client acceptance failed');
} finally {
 if(vite)vite.kill();if(app)await app.close();if(db)await db.end();
 try {
  if(created){assert.match(name,/^andrew_test_[a-f0-9]{20}$/);await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[name]);await admin.query(`DROP DATABASE "${name}"`);console.log('Temporary cross-client test database removed');}
 } finally {await admin.end();}
}
