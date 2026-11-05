import type pg from 'pg';
import type { FastifyRequest, HTTPMethods } from 'fastify';
import type { Principal, StaffProfile } from '@andrew/shared';
import { z } from 'zod';
import { audit, hqOnly } from './auth.js';
import { one, transaction, type Db } from './db.js';
import { requireThat } from './errors.js';
import { uuid, version, phone, staffPrivateFields } from './validation.js';

type Shape={Params:Record<string,string>;Querystring:Record<string,string>;Body:unknown};
type Route=(method:HTTPMethods,path:string,auth:'none'|'required'|'optional',handler:(req:FastifyRequest<Shape>,user:Principal|undefined)=>Promise<unknown>)=>void;
const base=z.object({employeeNo:z.string().trim().min(1).max(50),name:z.string().trim().min(1).max(100),phone,...staffPrivateFields,specialty:z.string().trim().max(500).default(''),active:z.boolean(),userId:uuid.nullable()}).strict();
export const staffProfileSelect=`SELECT s.id,s.employee_no AS "employeeNo",s.name,s.phone,to_char(s.birth_date,'YYYY-MM-DD') AS "birthDate",s.home_address AS "homeAddress",s.email,s.specialty,s.is_dentist AS "isDentist",s.active,s.row_version AS "rowVersion",s.user_id AS "userId",u.username,s.is_demo AS "isDemo" FROM staff s LEFT JOIN users u ON u.id=s.user_id`;
async function lockHq(db:Db,userId:string){
 const actor=await one(db,"SELECT u.id FROM users u WHERE u.id=$1 AND u.active AND EXISTS(SELECT 1 FROM role_assignments r WHERE r.user_id=u.id AND r.role='hq') FOR SHARE",[userId]);
 requireThat(actor,403,'FORBIDDEN','总部权限已失效');
}
export function registerStaffProfileRoutes(route:Route,pool:pg.Pool){
 route('GET','/staff/profiles','required',async(_req,user)=>{hqOnly(user!);return (await pool.query<StaffProfile>(staffProfileSelect+' ORDER BY s.employee_no,s.id')).rows;});
 async function save(user:Principal,body:unknown,id:string|undefined,requestId:string){
  hqOnly(user);const input=(id?base.extend({expectedVersion:version}).strict():base).parse(body);
  return transaction(pool,async db=>{
   await db.query("SELECT pg_advisory_xact_lock(hashtextextended('andrew.booking.staff-accounts',0))");await lockHq(db,user.id);
   const old=id?await one<{is_dentist:boolean;row_version:number;user_id:string|null;birth_date:string|null;home_address:string|null;email:string|null}>(db,'SELECT is_dentist,row_version,user_id,birth_date,home_address,email FROM staff WHERE id=$1 FOR UPDATE',[id]):undefined;
   if(id){requireThat(old,404,'NOT_FOUND','员工档案不存在');requireThat(!old.is_dentist,400,'DOCTOR_RESOURCE_REQUIRED','医生档案请在医生资料入口维护');requireThat(old.row_version===('expectedVersion' in input?input.expectedVersion:0),409,'VERSION_CONFLICT','员工资料已变更，请刷新');}
   if(input.userId){
    const account=await one(db,`SELECT u.id FROM users u WHERE u.id=$1 AND u.active AND NOT EXISTS(SELECT 1 FROM patients p WHERE p.user_id=u.id)
     AND EXISTS(SELECT 1 FROM role_assignments r WHERE r.user_id=u.id) FOR UPDATE`,[input.userId]);
    requireThat(account,400,'INVALID_STAFF_ACCOUNT','只能关联有效员工账号');
    const linked=await one(db,'SELECT id FROM staff WHERE user_id=$1 AND id IS DISTINCT FROM $2::uuid FOR UPDATE',[input.userId,id??null]);
    requireThat(!linked,409,'STAFF_ALREADY_LINKED','该账号已关联其他员工身份');
    const doctorRole=await one(db,"SELECT 1 FROM role_assignments WHERE user_id=$1 AND role='doctor'",[input.userId]);
    requireThat(!doctorRole,400,'DOCTOR_PROFILE_REQUIRED','医生账号须关联医生档案');
   }
   const privateValues=[input.birthDate===undefined?old?.birth_date??null:input.birthDate,input.homeAddress===undefined?old?.home_address??null:input.homeAddress,input.email===undefined?old?.email??null:input.email];
   const saved=id?await one<{id:string}>(db,`UPDATE staff SET employee_no=$2,name=$3,phone=$4,specialty=$5,active=$6,user_id=$7,birth_date=$8,home_address=$9,email=$10,row_version=row_version+1 WHERE id=$1 RETURNING id`,[id,input.employeeNo,input.name,input.phone,input.specialty,input.active,input.userId,...privateValues]):
    await one<{id:string}>(db,`INSERT INTO staff(employee_no,name,phone,specialty,active,user_id,birth_date,home_address,email,is_dentist) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,false) RETURNING id`,[input.employeeNo,input.name,input.phone,input.specialty,input.active,input.userId,...privateValues]);
   await audit(db,user.id,id?'staff.profile.updated':'staff.profile.created',saved!.id,requestId,{linkedAccount:input.userId,active:input.active});
   return (await one<StaffProfile>(db,staffProfileSelect+' WHERE s.id=$1',[saved!.id]))!;
  });
 }
 route('POST','/staff/profiles','required',async(req,user)=>save(user!,req.body,undefined,req.id));
 route('PUT','/staff/profiles/:id','required',async(req,user)=>save(user!,req.body,uuid.parse(req.params.id),req.id));
}
