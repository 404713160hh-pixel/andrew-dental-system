/** Real Chrome staff account workflow against an isolated disposable PostgreSQL database. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn,type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium,expect,type Page } from '@playwright/test';
import { loadConfig } from '../booking-api/src/config.js';
import { migrate,poolFor } from '../booking-api/src/db.js';
import { createApp } from '../booking-api/src/app.js';
import { seed } from '../booking-api/src/seed.js';

const dbName=`andrew_test_${randomBytes(10).toString('hex')}`;
const password=`Seed-${randomBytes(18).toString('base64url')}!`;
const temporary=`Temporary-${randomBytes(18).toString('base64url')}!`;
const permanent=`Permanent-${randomBytes(18).toString('base64url')}!`;
const namespace=`staff-accounts-${Date.now().toString(36)}`;
const shotDir=resolve('screenshots','booking',namespace);mkdirSync(shotDir,{recursive:true});
const report={status:'running',startedAt:new Date().toISOString(),execution:'Real Chrome and Vue against isolated PostgreSQL and API on local ephemeral ports',checks:[] as string[],screenshots:[] as string[],limitations:[] as string[]};
const pass=(name:string)=>{report.checks.push(name);console.log('PASS',name);};
const screenshot=async(page:Page,name:string)=>{await page.screenshot({path:resolve(shotDir,name+'.png'),fullPage:true});report.screenshots.push(`screenshots/booking/${namespace}/${name}.png`);};
const freePort=async()=>new Promise<number>((done,reject)=>{const s=createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const address=s.address();if(!address||typeof address==='string')return reject(new Error('No local port'));s.close(()=>done(address.port));});});
const base=process.env.TEST_DATABASE_URL||process.env.DATABASE_URL;
assert.ok(base,'TEST_DATABASE_URL or DATABASE_URL must point to a PostgreSQL test server');
const adminUrl=new URL(base);adminUrl.pathname='/postgres';const admin=poolFor(adminUrl.toString());
const dbUrl=new URL(base);dbUrl.pathname='/'+dbName;let created=false;
let db:ReturnType<typeof poolFor>|undefined,app:Awaited<ReturnType<typeof createApp>>|undefined,vite:ChildProcess|undefined,browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
try{
 assert.match(dbName,/^andrew_test_[0-9a-f]{20}$/);await admin.query(`CREATE DATABASE "${dbName}"`);created=true;
 db=poolFor(dbUrl.toString());await migrate(db);await seed(db,password);
 app=await createApp(loadConfig({NODE_ENV:'test',DATABASE_URL:dbUrl.toString(),ALLOW_DEMO_LOGIN:'false'}),db,false);
 await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();assert.ok(address&&typeof address!=='string');
 const apiUrl=`http://127.0.0.1:${address.port}`,port=await freePort(),webUrl=`http://127.0.0.1:${port}`;
 vite=spawn(process.execPath,[resolve('node_modules/vite/bin/vite.js'),'admin-web','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:process.cwd(),env:{...process.env,BOOKING_API_URL:apiUrl},stdio:'ignore',windowsHide:true});
 for(let attempt=0;attempt<80;attempt++){
  if(vite.exitCode!==null)throw new Error('Vite exited before startup');
  try{if((await fetch(webUrl,{signal:AbortSignal.timeout(1000)})).ok)break;}catch{}
  if(attempt===79)throw new Error('Vite did not start');await delay(250);
 }
 const clinic=(await db.query<{name:string}>('SELECT name FROM clinics WHERE active ORDER BY name LIMIT 1')).rows[0]!;
 browser=await chromium.launch({channel:'chrome',headless:true});
 const hq=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN'}),page=await hq.newPage();
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(webUrl+'/login');await page.getByPlaceholder('请输入工作人员用户名').fill('hq');await page.getByPlaceholder('请输入密码').fill(password);
 await page.getByRole('button',{name:'登录工作台'}).click();await expect(page).toHaveURL(/\/appointments$/);
 await page.getByRole('link',{name:'员工账号'}).click();await expect(page.getByRole('heading',{name:'员工账号与岗位'})).toBeVisible();
 await page.getByRole('button',{name:'新建账号'}).click();let modal=page.locator('.el-dialog:visible');
 const input=async(label:string,value:string)=>modal.locator('.el-form-item').filter({hasText:label}).locator('input').first().fill(value);
 await input('用户名','front.e2e');await input('显示姓名','员工流程验收');await input('初始密码',temporary);
 await modal.locator('.el-form-item').filter({hasText:'岗位与门诊'}).locator('.el-select').nth(1).click();await page.locator('.el-select-dropdown:visible').getByText(clinic.name,{exact:true}).click();
 await modal.getByRole('button',{name:'保存'}).click();await expect(modal).toBeHidden();
 const row=page.locator('tr').filter({hasText:'front.e2e'});await expect(row).toBeVisible();await expect(row).toContainText('等待修改密码');
 await screenshot(page,'01-created');pass('HQ creates a scoped employee account');
 const employee=await browser.newContext({viewport:{width:1000,height:900},locale:'zh-CN'}),worker=await employee.newPage();
 worker.on('pageerror',e=>errors.push(e.message));await worker.goto(webUrl+'/login');await worker.getByPlaceholder('请输入工作人员用户名').fill('front.e2e');
 await worker.getByPlaceholder('请输入密码').fill(temporary);await worker.getByRole('button',{name:'登录工作台'}).click();await expect(worker).toHaveURL(/\/change-password$/);
 await screenshot(worker,'02-forced-password');
 for(const [label,value] of [['当前密码',temporary],['新密码',permanent],['再次输入新密码',permanent]]){
  const item=worker.locator('.el-form-item').filter({hasText:label}).first();await item.locator('input').fill(value);
 }
 await worker.getByRole('button',{name:'更新密码'}).click();await expect(worker).toHaveURL(/\/appointments$/);pass('employee must change temporary password before entering workbench');
 await page.reload();await expect(row).toBeVisible();await row.getByRole('button',{name:'管理'}).click();modal=page.locator('.el-dialog:visible');
 await modal.locator('.el-form-item').filter({hasText:'岗位与门诊'}).locator('.el-select').first().click();
 await page.locator('.el-select-dropdown:visible').getByText('店长',{exact:true}).click();await modal.getByRole('button',{name:'保存'}).click();await expect(modal).toBeHidden();
 await expect(row).toContainText('店长');await screenshot(page,'03-role-changed');
 const sessionValid=await worker.evaluate(async()=>{const token=sessionStorage.getItem('andrew.staff.token');const r=await fetch('/api/v1/me',{headers:{Authorization:'Bearer '+token}});return r.status;});
 assert.equal(sessionValid,401);pass('role change revokes the existing employee session');
 await row.getByRole('button',{name:'管理'}).click();modal=page.locator('.el-dialog:visible');
 await modal.locator('.el-form-item').filter({hasText:'账号状态'}).locator('.el-switch').click();await modal.getByRole('button',{name:'保存'}).click();
 await page.getByRole('button',{name:'确认停用'}).click();await expect(modal).toBeHidden();await expect(row).toContainText('停用');await screenshot(page,'04-disabled');
 const result=await fetch(apiUrl+'/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'front.e2e',password:permanent,portal:'staff'})});
 assert.equal(result.status,401);pass('disabled employee cannot log in');assert.deepEqual(errors,[]);
 const audit=await db.query("SELECT action FROM audit_events WHERE target_id=(SELECT id FROM users WHERE username='front.e2e') AND action LIKE 'staff.account.%' ORDER BY occurred_at");
 assert.deepEqual(audit.rows.map(x=>x.action),['staff.account.created','staff.account.updated','staff.account.updated']);pass('mutations use the isolated backend and are audited');
 await hq.close();await employee.close();report.status='passed';
}catch(error){report.status='failed';report.limitations.push(error instanceof Error?error.message:String(error));throw error;}
finally{
 if(browser)await browser.close();if(vite)vite.kill();if(app)await app.close();if(db)await db.end();
 try{if(created){assert.match(dbName,/^andrew_test_[0-9a-f]{20}$/);await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[dbName]);await admin.query(`DROP DATABASE "${dbName}"`);}}finally{await admin.end();}
 writeFileSync(resolve('docs/implementation/qa/staff-accounts-browser.json'),JSON.stringify({...report,finishedAt:new Date().toISOString()},null,2)+'\n');
}
