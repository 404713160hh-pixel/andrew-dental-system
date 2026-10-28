/** Real browser verification against a new local test database, never the demo database. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn,type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium,expect } from '@playwright/test';
import { loadConfig } from '../booking-api/src/config.js';
import { migrate,poolFor } from '../booking-api/src/db.js';
import { createApp } from '../booking-api/src/app.js';
import { seed } from '../booking-api/src/seed.js';

const name=`andrew_test_${randomBytes(10).toString('hex')}`;
const password=`OnlySynthetic-${randomBytes(20).toString('base64url')}`;
const base=process.env.TEST_DATABASE_URL||process.env.DATABASE_URL;assert.ok(base,'A local PostgreSQL test server is required');
const rootUrl=new URL(base);assert.ok(['localhost','127.0.0.1','[::1]'].includes(rootUrl.hostname),'Remote database forbidden');rootUrl.pathname='/postgres';
const testUrl=new URL(base);testUrl.pathname='/'+name;const admin=poolFor(rootUrl.toString());
const report={status:'running',startedAt:new Date().toISOString(),execution:'Real Chrome and Vue against an isolated PostgreSQL test database',checks:[] as string[],screenshots:[] as string[],limitations:[] as string[]};
let db:ReturnType<typeof poolFor>|undefined,app:Awaited<ReturnType<typeof createApp>>|undefined,browser:Awaited<ReturnType<typeof chromium.launch>>|undefined,vite:ChildProcess|undefined,created=false;
const port=()=>new Promise<number>((ok,fail)=>{const server=createServer();server.on('error',fail);server.listen(0,'127.0.0.1',()=>{const a=server.address();if(!a||typeof a==='string')return fail(new Error('No local port'));server.close(()=>ok(a.port));});});
try{
 assert.match(name,/^andrew_test_[a-f0-9]{20}$/);await admin.query(`CREATE DATABASE "${name}"`);created=true;
 db=poolFor(testUrl.toString());await migrate(db);await seed(db,password);
 const doctor=(await db.query<{id:string;name:string}>('SELECT id,name FROM staff WHERE is_dentist AND active ORDER BY name LIMIT 1')).rows[0];assert.ok(doctor);
 app=await createApp(loadConfig({NODE_ENV:'test',DATABASE_URL:testUrl.toString(),ALLOW_DEMO_LOGIN:'false'}),db,false);
 await app.listen({host:'127.0.0.1',port:0});const a=app.server.address();assert.ok(a&&typeof a!=='string');
 const apiUrl=`http://127.0.0.1:${a.port}`,webUrl=`http://127.0.0.1:${await port()}`;
 vite=spawn(process.execPath,[resolve('node_modules/vite/bin/vite.js'),'admin-web','--host','127.0.0.1','--port',new URL(webUrl).port,'--strictPort'],{cwd:process.cwd(),env:{...process.env,BOOKING_API_URL:apiUrl},stdio:'ignore',windowsHide:true});
 for(let i=0;i<80;i++){if(vite.exitCode!==null)throw new Error('Vite exited');try{if((await fetch(webUrl,{signal:AbortSignal.timeout(1000)})).ok)break;}catch{}if(i===79)throw new Error('Vite not ready');await delay(250);}
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000},locale:'zh-CN'});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(webUrl+'/login');await page.getByPlaceholder('请输入工作人员用户名').fill('hq');await page.getByPlaceholder('请输入密码').fill(password);await page.getByRole('button',{name:'登录工作台'}).click();await expect(page).toHaveURL(/\/appointments$/);
 await page.goto(webUrl+'/resources/doctors');const row=page.locator('tr').filter({hasText:doctor.name}).first();await expect(row).toBeVisible();await row.getByRole('button',{name:'公开资料'}).click();
 const dialog=page.getByRole('dialog',{name:`${doctor.name} · 医生公开资料`});await expect(dialog).toBeVisible();
 await dialog.locator('.el-form-item').filter({hasText:'医生简介'}).locator('textarea').fill('经机构核对的合成医生简介');
 await dialog.locator('.el-form-item').filter({hasText:'擅长方向'}).locator('textarea').fill('合成咨询\n合成复诊');
 const response=page.waitForResponse(r=>r.url().endsWith(`/staff/doctors/${doctor.id}/profile`)&&r.request().method()==='PUT');
 await dialog.getByRole('button',{name:'保存',exact:true}).click();const result=await response;assert.equal(result.status(),200,await result.text());await expect(dialog).toBeHidden();
 const stored=(await db.query<{bio:string;focus_areas:string[]}>('SELECT bio,focus_areas FROM staff WHERE id=$1',[doctor.id])).rows[0];assert.equal(stored!.bio,'经机构核对的合成医生简介');assert.deepEqual(stored!.focus_areas,['合成咨询','合成复诊']);
 const publicResponse=await fetch(apiUrl+'/api/v1/doctors');const publicDoctors=(await publicResponse.json()).data as {id:string;bio:string;phone?:string;employeeNo?:string}[];const visible=publicDoctors.find(x=>x.id===doctor.id)!;assert.equal(visible.bio,stored!.bio);assert.ok(!('phone' in visible)&&!('employeeNo' in visible));
 assert.deepEqual(errors,[]);report.checks.push('HQ uses the Vue dialog to update the doctor profile','Database and public doctor API return the updated non-sensitive data');
 const directory=resolve('screenshots','booking',`doctor-profile-${Date.now().toString(36)}`);mkdirSync(directory,{recursive:true});await page.screenshot({path:resolve(directory,'saved.png'),fullPage:true});report.screenshots.push(directory);report.status='passed';
}catch(e){report.status='failed';report.limitations.push(e instanceof Error?e.message:String(e));throw e;}
finally{
 if(browser)await browser.close();if(vite)vite.kill();if(app)await app.close();if(db)await db.end();
 try{if(created){assert.match(name,/^andrew_test_[a-f0-9]{20}$/);await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[name]);await admin.query(`DROP DATABASE "${name}"`);}}finally{await admin.end();}
 writeFileSync(resolve('docs/implementation/qa/doctor-profile-browser.json'),JSON.stringify({...report,finishedAt:new Date().toISOString()},null,2)+'\n');
}
