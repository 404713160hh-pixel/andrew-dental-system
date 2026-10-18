import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDatabase, serverDirectory, hashPassword, verifyPassword, id, tables } from './db.js';
import { ApiError, getState, getWorkspace, publicUser, executeCommand, auditEvent } from './domain.js';
import { isAccountActive, assertRegistrationUnique, requestPasswordRecovery, consumePasswordRecovery } from './services/accounts.js';
import { readSession, issueSession, expireSessionCookie, requireCsrf } from './http/sessions.js';
import { runIdempotent } from './http/idempotency.js';
import { checkRateLimit, clearRateLimit } from './http/rate-limit.js';
import { validateDeployment } from './http/configuration.js';
import { camel } from './services/finance.js';

const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.avif':'image/avif','.pdf':'application/pdf','.json':'application/json; charset=utf-8','.ico':'image/x-icon'};
const portalRoles=new Set(['customer','front','clinical','manager','hq']);
const portalEntryPaths=new Set(['/customer','/customer/login','/frontdesk','/frontdesk/login','/doctor','/doctor/login','/manager','/manager/login','/hq','/hq/login']);
function json(res,status,data,headers={}) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data));
}
async function body(req) {
  if(!req.headers['content-type']?.startsWith('application/json'))throw new ApiError(415,'请使用 JSON 格式','CONTENT_TYPE');
  let data='',bytes=0;
  for await(const chunk of req) {bytes+=chunk.length;if(bytes>2*1024*1024)throw new ApiError(413,'请求过大','BODY_TOO_LARGE');data+=chunk;}
  try {const result=JSON.parse(data);if(!result||typeof result!=='object'||Array.isArray(result))throw new Error();return result;}catch {throw new ApiError(400,'JSON 格式错误','INVALID_JSON');}
}
function passwordValid(password) {
  if(typeof password!=='string'||password.length<10||password.length>128||!/[a-zA-Z]/.test(password)||!/[0-9]/.test(password))throw new ApiError(400,'密码需 10 至 128 位，并包含字母和数字','PASSWORD_INVALID');
}
export function createApp(options={}) {
  validateDeployment(options);
  const db=options.db||createDatabase(options.dbPath, {seed:options.seed});
  const demoEnabled=options.seed!==false&&process.env.DENTAL_SEED_DEMO!=='0';
  const publicRoot=resolve(serverDirectory,'../public');
  const documentationRoot=resolve(serverDirectory,'../docs/site');
  const allowedOrigins=options.allowedOrigins||(process.env.PUBLIC_ORIGIN?process.env.PUBLIC_ORIGIN.split(',').map(s=>s.trim()):[]);
  const allowedHostnames=new Set(['127.0.0.1','localhost','[::1]',...allowedOrigins.map(origin=>new URL(origin).hostname)]);
  const lockPath=db.path===':memory:'?null:`${db.path}.server.lock`;
  let ownsLock=false;
  function releaseLock() {
    if(!ownsLock||!lockPath)return;
    try {if(JSON.parse(readFileSync(lockPath,'utf8')).pid===process.pid)unlinkSync(lockPath);}catch(error){if(error.code!=='ENOENT')console.error('Could not release database server lock:',error.message);}
    ownsLock=false;
  }
  function acquireLock(port) {
    if(!lockPath)return;
    for(let retry=0;retry<3;retry++) {
      try{writeFileSync(lockPath,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString(),port}),{flag:'wx'});ownsLock=true;return;}catch(error){
        if(error.code!=='EEXIST')throw error;
        let existing;try{existing=JSON.parse(readFileSync(lockPath,'utf8'));}catch {throw new Error('数据库运行锁损坏，请确认服务已停止后检查 .server.lock 文件');}
        let alive=false;
        if(Number.isInteger(existing.pid)&&existing.pid>0)try{process.kill(existing.pid,0);alive=true;}catch(killError){alive=killError.code==='EPERM';}
        if(alive)throw new Error(`此数据库已有服务运行（PID ${existing.pid}），请先停止原服务`);
        try{unlinkSync(lockPath);}catch(unlinkError){if(unlinkError.code!=='ENOENT')throw unlinkError;}
      }
    }
    throw new Error('无法取得数据库运行锁，请重试');
  }
  const csrfRequired=requireCsrf;
  const setSession=(res,user)=>issueSession(db,res,user);
  const handler=async(req,res)=>{
    const requestId=randomUUID();
    res.setHeader('X-Request-Id',requestId);
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    try {
      let hostUrl;try{hostUrl=new URL(`http://${req.headers.host||''}`);}catch{throw new ApiError(400,'请求主机格式不正确','HOST');}
      if(!allowedHostnames.has(hostUrl.hostname))throw new ApiError(403,'请求主机不在允许列表中','HOST');
      const url=new URL(req.url,'http://localhost');
      if(req.method==='POST') {
        const origin=req.headers.origin;
        const expected=`http://${req.headers.host}`;
        if((origin&&origin!==expected&&!allowedOrigins.includes(origin))||req.headers['sec-fetch-site']==='cross-site')throw new ApiError(403,'不接受跨站请求','ORIGIN');
      }
      if(url.pathname==='/api/health'&&req.method==='GET') {
        db.sql.prepare('SELECT 1').get();
        return json(res,200,{ok:true,service:'andrew-dental',version:'3.1.0',storage:'SQLite',now:new Date().toISOString()});
      }
      if(url.pathname==='/api/portal-config'&&req.method==='GET')return json(res,200,{demoEnabled});
      if(url.pathname==='/api/login'&&req.method==='POST') {
        const p=await body(req), username=typeof p.username==='string'?p.username.trim().toLowerCase():'';
        if(!portalRoles.has(p.portal))throw new ApiError(400,'请选择有效的登录入口','PORTAL_INVALID');
        const attemptKey=checkRateLimit(db,req,'login',username,8);
        const row=db.sql.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE').get(username);
        const user=row?JSON.parse(row.data):null;
        const valid=typeof p.password==='string'&&p.password.length<=128&&row&&verifyPassword(p.password,row.password_hash)&&isAccountActive(user)&&user.role===p.portal;
        if(!valid)throw new ApiError(401,'账号或密码不正确','LOGIN_FAILED');
        clearRateLimit(db,attemptKey);
        const result=setSession(res,user);auditEvent(db,user,'session.login',user.id,{});return json(res,200,result);
      }
      if(url.pathname==='/api/register'&&req.method==='POST') {
        const p=await body(req);
        checkRateLimit(db,req,'register','',10);
        if(p.portal!=='customer')throw new ApiError(400,'请从顾客入口注册','PORTAL_INVALID');
        if(typeof p.username!=='string'||!/^[A-Za-z][A-Za-z0-9_]{2,29}$/.test(p.username))throw new ApiError(400,'账号须为 3 至 30 位，以字母开头，可包含数字和下划线','USERNAME_INVALID');
        passwordValid(p.password);
        if(typeof p.name!=='string'||!p.name.trim()||p.name.length>60)throw new ApiError(400,'请输入有效姓名','NAME_INVALID');
        if(typeof p.phone!=='string'||!/^[+\d][\d\s-]{5,28}$/.test(p.phone))throw new ApiError(400,'请输入有效电话','PHONE_INVALID');
        const username=p.username.toLowerCase();
        if(db.sql.prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE').get(username))throw new ApiError(409,'账号已存在','USERNAME_TAKEN');
        const user=db.transaction(()=>{
          assertRegistrationUnique(db,p);
          const patientId=id('PATIENT'),user={id:id('USER'),username,name:p.name.trim(),role:'customer',patientId,clinicIds:[]};
          db.put('patients',{id:patientId,name:user.name,phone:p.phone,dob:'',email:'',address:'',emergencyName:'',emergencyPhone:'',allergyStatus:'unknown',allergies:[],createdAt:new Date().toISOString(),version:1});
          db.sql.prepare('INSERT INTO users(id,username,password_hash,data) VALUES(?,?,?,?)').run(user.id,username,hashPassword(p.password),JSON.stringify(user));
          auditEvent(db,user,'account.register',patientId,{});return user;
        });
        return json(res,201,setSession(res,user));
      }
      if(url.pathname==='/api/password-recovery/request'&&req.method==='POST') {
        checkRateLimit(db,req,'password-recovery-request','',5);
        const p=await body(req);
        return json(res,200,db.transaction(()=>requestPasswordRecovery(db,p)));
      }
      if(url.pathname==='/api/password-recovery/consume'&&req.method==='POST') {
        checkRateLimit(db,req,'password-recovery-consume','',8);
        const p=await body(req);
        const result=db.transaction(()=>consumePasswordRecovery(db,p));
        expireSessionCookie(res);
        return json(res,200,result);
      }
      if(url.pathname.startsWith('/api/')) {
        const auth=readSession(db,req);
        if(!auth)throw new ApiError(401,'请先登录','UNAUTHORIZED');
        if(url.pathname==='/api/session'&&req.method==='GET')return json(res,200,{user:publicUser(auth.user),csrfToken:auth.session.csrf});
        if(url.pathname==='/api/state'&&req.method==='GET')return json(res,200,getState(db,auth.user));
        if(url.pathname==='/api/workspace'&&req.method==='GET')return json(res,200,getWorkspace(db,auth.user,Object.fromEntries(url.searchParams)));
        if(url.pathname==='/api/logout'&&req.method==='POST') {
          csrfRequired(req,auth);db.sql.prepare('DELETE FROM sessions WHERE token_hash=?').run(auth.session.token_hash);
          expireSessionCookie(res);return json(res,200,{ok:true});
        }
        if(url.pathname==='/api/command'&&req.method==='POST') {
          csrfRequired(req,auth);const p=await body(req);if(typeof p.type!=='string')throw new ApiError(400,'操作类型不正确','COMMAND_INVALID');
          const result=runIdempotent(db,auth.user,req.headers['idempotency-key'],p,()=>executeCommand(db,auth.user,p.type,p.payload));
          if(p.type==='password.change')expireSessionCookie(res);
          return json(res,200,{ok:true,result});
        }
        if(url.pathname==='/api/backup'&&req.method==='GET') {
          if(auth.user.role!=='hq')throw new ApiError(403,'仅总部可导出备份','FORBIDDEN');
          const data={format:'andrew-domain-export-v3',exportedAt:new Date().toISOString(),note:'业务留存导出，不含账号口令、恢复凭证和会话；完整恢复使用 SQLite 快照。',data:{}};
          for(const table of tables)data.data[table]=db.all(table);
          for(const table of ['payments','refunds','invoice_adjustments','reconciliations','visit_addenda','patient_aliases'])data.data[table]=db.sql.prepare(`SELECT * FROM ${table} ORDER BY recorded_at,id`).all().map(camel);
          data.data.audit=db.sql.prepare('SELECT * FROM audit ORDER BY at').all().map(row=>({id:row.id,at:row.at,userId:row.user_id,type:row.type,targetId:row.target_id,detail:JSON.parse(row.detail)}));
          auditEvent(db,auth.user,'data.export','business-data',{});
          return json(res,200,data,{'Content-Disposition':`attachment; filename="andrew-domain-${new Date().toISOString().slice(0,10)}.json"`});
        }
        throw new ApiError(404,'接口不存在','NOT_FOUND');
      }
      if(req.method!=='GET'&&req.method!=='HEAD')throw new ApiError(405,'不支持该方法','METHOD_NOT_ALLOWED');
      const docs=url.pathname==='/docs'||url.pathname.startsWith('/docs/');
      const root=docs?documentationRoot:publicRoot;
      let pathname;try{pathname=decodeURIComponent(docs?url.pathname.slice(5):url.pathname);}catch{throw new ApiError(400,'页面地址格式不正确','PATH');}
      if(!docs&&portalEntryPaths.has(pathname.replace(/\/$/,'')))pathname='/index.html';
      if(pathname===''||pathname==='/')pathname='/index.html';
      const file=resolve(root,`.${pathname}`);
      if(file!==root&&!file.startsWith(root+sep))throw new ApiError(403,'无权读取该文件','FORBIDDEN');
      if(!mime[extname(file)])throw new ApiError(404,'页面不存在','NOT_FOUND');
      const info=await stat(file);if(!info.isFile())throw new ApiError(404,'页面不存在','NOT_FOUND');
      if(docs)res.setHeader('Content-Security-Policy',"default-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'");
      res.writeHead(200,{'Content-Type':mime[extname(file)],'Cache-Control':'no-cache','Content-Length':info.size});
      return res.end(req.method==='HEAD'?undefined:await readFile(file));
    }catch(error) {
      if(res.headersSent){res.destroy();return;}
      if(error.code==='ENOENT'||error.code==='ENOTDIR')return json(res,404,{error:'页面不存在',code:'NOT_FOUND'});
      if(error instanceof ApiError)return json(res,error.status,{error:error.message,code:error.code});
      // Never return SQL text, filesystem paths, passwords, or stack traces to clients.
      console.error(JSON.stringify({level:'error',event:'request.failed',requestId,errorType:error.name}));
      return json(res,500,{error:'服务器处理失败，请重试或联系管理员',code:'SERVER_ERROR',requestId});
    }
  };
  const server=http.createServer(handler);
  server.requestTimeout=15000;server.headersTimeout=10000;
  return{server,db,handler,async listen(port=Number(process.env.PORT||3210),host=process.env.HOST||'127.0.0.1'){
    acquireLock(port);
    try {await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});if(lockPath)writeFileSync(lockPath,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString(),port:server.address().port}));return server.address();}catch(error){releaseLock();throw error;}
  },async close(){await new Promise(resolve=>server.close(resolve));server.closeAllConnections();if(!options.db)db.close();releaseLock();}};
}
export async function start(options={}) {const app=createApp(options);try{const address=await app.listen(options.port??Number(process.env.PORT||3210),options.host||process.env.HOST||'127.0.0.1');return{...app,address};}catch(error){await app.close();throw error;}}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  start().then(app=>{
    console.log(`安德鲁牙科系统：http://${app.address.address}:${app.address.port}`);
    console.log(`数据库：${app.db.path}`);
    const shutdown=()=>app.close().then(()=>process.exit(0));process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
  }).catch(error=>{console.error(error.message);process.exitCode=1;});
}
