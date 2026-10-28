import type pg from 'pg';
import type { FastifyRequest, HTTPMethods } from 'fastify';
import { z } from 'zod';
import type { Principal } from '@andrew/shared';
import { audit, hashPassword, hqOnly, tokenHash, verifyPassword } from './auth.js';
import { one, transaction, type Db } from './db.js';
import { requireThat } from './errors.js';
import { uuid, version, pageInput } from './validation.js';

type Shape = { Params: Record<string,string>; Querystring: Record<string,string>; Body: unknown };
type Request = FastifyRequest<Shape>;
type Route = (method:HTTPMethods,path:string,auth:'none'|'required'|'optional',handler:(req:Request,user:Principal|undefined)=>Promise<unknown>)=>void;
const name = z.string().trim().min(1).max(100);
const password = z.string().min(12).max(128);
const assignment = z.object({role:z.enum(['hq','manager','front','doctor']),clinicId:uuid.nullable()}).strict().superRefine((a,c)=>{
 if ((a.role==='hq') !== (a.clinicId===null)) c.addIssue({code:'custom',message:'总部无门诊范围，其他岗位必须指定门诊'});
});
const assignments = z.array(assignment).min(1).max(100).superRefine((rows,c)=>{
 const keys=rows.map(a=>`${a.role}:${a.clinicId??''}`);
 if(new Set(keys).size!==keys.length)c.addIssue({code:'custom',message:'岗位和门诊不能重复'});
});
const base = z.object({displayName:name,staffId:uuid.nullable(),assignments}).strict();
const createInput = base.extend({username:z.string().trim().regex(/^[a-zA-Z0-9._-]{3,80}$/),temporaryPassword:password}).strict();
const updateInput = base.extend({active:z.boolean(),expectedVersion:version}).strict();
const resetInput = z.object({temporaryPassword:password,expectedVersion:version}).strict();
const changePasswordInput = z.object({currentPassword:z.string().min(1).max(128),newPassword:password}).strict().refine(x=>x.currentPassword!==x.newPassword,{message:'新密码不能与原密码相同',path:['newPassword']});
type AccountSettings=z.infer<typeof base>;
const accountSelect=`SELECT u.id,u.username,u.display_name AS "displayName",u.active,u.account_version AS "accountVersion",
 u.must_change_password AS "mustChangePassword",s.id AS "staffId",
 coalesce((SELECT jsonb_agg(jsonb_build_object('role',ra.role,'clinicId',ra.clinic_id) ORDER BY ra.role,ra.clinic_id) FROM role_assignments ra WHERE ra.user_id=u.id),'[]') AS assignments
 FROM users u LEFT JOIN staff s ON s.user_id=u.id WHERE NOT EXISTS(SELECT 1 FROM patients p WHERE p.user_id=u.id)
 AND (s.id IS NOT NULL OR EXISTS(SELECT 1 FROM role_assignments ra WHERE ra.user_id=u.id))`;
async function getAccount(db:Db,id:string){return one(db,accountSelect+' AND u.id=$1',[id]);}
async function lockAccounts(db:Db){await db.query("SELECT pg_advisory_xact_lock(hashtextextended('andrew.booking.staff-accounts',0))");}
async function checkActorHq(db:Db,id:string){
 const actor=await one(db,"SELECT u.id FROM users u JOIN role_assignments r ON r.user_id=u.id AND r.role='hq' WHERE u.id=$1 AND u.active FOR SHARE OF u",[id]);
 requireThat(actor,403,'FORBIDDEN','总部权限已失效');
}
async function validateSettings(db:Db,input:AccountSettings,userId?:string,allowInactive=false){
 const clinicIds=[...new Set(input.assignments.flatMap(a=>a.clinicId?[a.clinicId]:[]))];
 if(clinicIds.length){const result=await db.query('SELECT id FROM clinics WHERE (active OR $2::boolean) AND id=ANY($1::uuid[]) FOR SHARE',[clinicIds,allowInactive]);requireThat(result.rowCount===clinicIds.length,400,'INVALID_CLINIC','岗位必须分配有效门诊');}
 const hasDoctor=input.assignments.some(a=>a.role==='doctor');
 requireThat(!hasDoctor||input.staffId,400,'DOCTOR_PROFILE_REQUIRED','医生岗位必须关联有效医生档案');
 if(input.staffId){
  const staff=await one<{user_id:string|null;active:boolean;is_dentist:boolean}>(db,'SELECT user_id,active,is_dentist FROM staff WHERE id=$1 FOR UPDATE',[input.staffId]);
  requireThat(staff&&(staff.active||allowInactive)&&(!hasDoctor||staff.is_dentist),400,'INVALID_STAFF','关联人员不存在、已停用或不是医生');
  requireThat(!staff!.user_id||staff!.user_id===userId,409,'STAFF_ALREADY_LINKED','该人员已关联其他账号');
 }
}
async function replaceSettings(db:Db,userId:string,input:AccountSettings){
 await db.query('UPDATE staff SET user_id=NULL WHERE user_id=$1 AND id IS DISTINCT FROM $2::uuid',[userId,input.staffId]);
 if(input.staffId)await db.query('UPDATE staff SET user_id=$1 WHERE id=$2',[userId,input.staffId]);
 await db.query('DELETE FROM role_assignments WHERE user_id=$1',[userId]);
 for(const row of input.assignments)await db.query('INSERT INTO role_assignments(user_id,role,clinic_id) VALUES($1,$2,$3)',[userId,row.role,row.clinicId]);
}
async function lockTarget(db:Db,id:string,expectedVersion:number){
 const account=await one<{active:boolean;account_version:number}>(db,`SELECT u.active,u.account_version FROM users u WHERE u.id=$1
 AND NOT EXISTS(SELECT 1 FROM patients p WHERE p.user_id=u.id)
 AND (EXISTS(SELECT 1 FROM staff s WHERE s.user_id=u.id) OR EXISTS(SELECT 1 FROM role_assignments ra WHERE ra.user_id=u.id)) FOR UPDATE`,[id]);
 requireThat(account,404,'NOT_FOUND','员工账号不存在');
 requireThat(account!.account_version===expectedVersion,409,'VERSION_CONFLICT','账号已变更，请刷新后重试');
 return account!;
}
async function preserveLastHq(db:Db,targetId:string,newActive:boolean,newAssignments:AccountSettings['assignments']){
 const old=await one<{n:string}>(db,"SELECT count(*) AS n FROM role_assignments WHERE user_id=$1 AND role='hq'",[targetId]);
 if(!Number(old!.n) || newActive&&newAssignments.some(a=>a.role==='hq'))return;
 const other=await one<{n:string}>(db,"SELECT count(*) AS n FROM users u JOIN role_assignments r ON r.user_id=u.id WHERE u.active AND r.role='hq' AND u.id<>$1",[targetId]);
 requireThat(Number(other!.n)>0,409,'LAST_HQ_ACCOUNT','不能停用或撤销最后一个有效总部账号');
}

/** The application's standard route wrapper owns authentication and response envelopes. */
export function registerStaffAccountRoutes(route:Route,pool:pg.Pool){
 route('GET','/staff/accounts','required',async(req,user)=>{
  hqOnly(user!);const {page,pageSize}=pageInput.parse(req.query);
  const total=Number((await one<{n:string}>(pool,`SELECT count(*) AS n FROM (${accountSelect}) accounts`))!.n);
  const result=await pool.query(accountSelect+' ORDER BY u.username LIMIT $1 OFFSET $2',[pageSize,(page-1)*pageSize]);
  return {items:result.rows,total,page,pageSize};
 });
 route('POST','/staff/accounts','required',async(req,user)=>{
  hqOnly(user!);const input=createInput.parse(req.body);const hashed=await hashPassword(input.temporaryPassword);
  return transaction(pool,async db=>{
   await lockAccounts(db);await checkActorHq(db,user!.id);await validateSettings(db,input);
   const row=await one<{id:string}>(db,'INSERT INTO users(username,password_hash,display_name,must_change_password) VALUES($1,$2,$3,true) RETURNING id',[input.username.toLowerCase(),hashed,input.displayName]);
   await replaceSettings(db,row!.id,input);await audit(db,user!.id,'staff.account.created',row!.id,req.id,{assignments:input.assignments,staffId:input.staffId});
   return getAccount(db,row!.id);
  });
 });
 route('PUT','/staff/accounts/:id','required',async(req,user)=>{
  hqOnly(user!);const id=uuid.parse(req.params.id),input=updateInput.parse(req.body);
  requireThat(id!==user!.id,403,'SELF_ACCOUNT_CHANGE_DENIED','不能修改自己的岗位或停用自己的账号');
  return transaction(pool,async db=>{
   await lockAccounts(db);await checkActorHq(db,user!.id);await lockTarget(db,id,input.expectedVersion);await validateSettings(db,input,id,!input.active);
   await preserveLastHq(db,id,input.active,input.assignments);
   await db.query('UPDATE users SET display_name=$2,active=$3,account_version=account_version+1 WHERE id=$1',[id,input.displayName,input.active]);
   await replaceSettings(db,id,input);await db.query('DELETE FROM sessions WHERE user_id=$1',[id]);
   await audit(db,user!.id,'staff.account.updated',id,req.id,{active:input.active,assignments:input.assignments,staffId:input.staffId});return getAccount(db,id);
  });
 });
 route('POST','/staff/accounts/:id/reset-password','required',async(req,user)=>{
  hqOnly(user!);const id=uuid.parse(req.params.id),input=resetInput.parse(req.body);
  requireThat(id!==user!.id,403,'SELF_RESET_DENIED','请使用本人修改密码功能');
  const hashed=await hashPassword(input.temporaryPassword);
  return transaction(pool,async db=>{
   await lockAccounts(db);await checkActorHq(db,user!.id);await lockTarget(db,id,input.expectedVersion);
   await db.query('UPDATE users SET password_hash=$2,must_change_password=true,account_version=account_version+1 WHERE id=$1',[id,hashed]);
   await db.query('DELETE FROM sessions WHERE user_id=$1',[id]);await audit(db,user!.id,'staff.account.password_reset',id,req.id);return getAccount(db,id);
  });
 });
 route('POST','/auth/change-password','required',async(req,user)=>{
  const input=changePasswordInput.parse(req.body),hashed=await hashPassword(input.newPassword);
  return transaction(pool,async db=>{
   const old=await one<{password_hash:string}>(db,'SELECT password_hash FROM users WHERE id=$1 AND active FOR UPDATE',[user!.id]);
   requireThat(old&&await verifyPassword(input.currentPassword,old.password_hash),400,'INVALID_CURRENT_PASSWORD','原密码不正确');
   await db.query('UPDATE users SET password_hash=$2,must_change_password=false,account_version=account_version+1 WHERE id=$1',[user!.id,hashed]);
   await db.query('DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2',[user!.id,tokenHash(req.headers.authorization!.slice(7))]);
   await audit(db,user!.id,'auth.password_changed',user!.id,req.id);return {changed:true};
  });
 });
}
