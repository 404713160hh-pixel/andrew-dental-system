import type pg from 'pg';
import type { FastifyRequest, HTTPMethods } from 'fastify';
import type { Principal } from '@andrew/shared';
import { z } from 'zod';
import { audit, hqOnly } from './auth.js';
import { one, transaction } from './db.js';
import { requireThat } from './errors.js';
import { doctorSelect } from './repositories/catalog.js';
import { uuid, version } from './validation.js';

type Shape={Params:Record<string,string>;Querystring:Record<string,string>;Body:unknown};
type Request=FastifyRequest<Shape>;
type Route=(method:HTTPMethods,path:string,auth:'none'|'required'|'optional',handler:(req:Request,user:Principal|undefined)=>Promise<unknown>)=>void;
const input=z.object({
 expectedVersion:version,
 bio:z.string().trim().max(2000),
 focusAreas:z.array(z.string().trim().min(1).max(80)).max(20)
}).strict().refine(v=>new Set(v.focusAreas).size===v.focusAreas.length,'擅长方向不能重复');

/** Public-facing text can be amended without modifying clinical qualifications or live shifts. */
export function registerDoctorProfileRoutes(route:Route,pool:pg.Pool) {
 route('PUT','/staff/doctors/:id/profile','required',async(req,user)=>{
  hqOnly(user!); const doctorId=uuid.parse(req.params.id),data=input.parse(req.body);
  return transaction(pool,async db=>{
   // Serialize with changes to this actor's account and recheck current authority.
   const actor=await one(db,"SELECT u.id FROM users u JOIN role_assignments r ON r.user_id=u.id AND r.role='hq' WHERE u.id=$1 AND u.active FOR SHARE OF u",[user!.id]);
   requireThat(actor,403,'FORBIDDEN','总部权限已失效');
   const old=await one<{row_version:number}>(db,'SELECT row_version FROM staff WHERE id=$1 AND is_dentist FOR UPDATE',[doctorId]);
   requireThat(old,404,'NOT_FOUND','医生档案不存在');
   requireThat(old!.row_version===data.expectedVersion,409,'VERSION_CONFLICT','医生资料已变更，请刷新后重试');
   await db.query('UPDATE staff SET bio=$2,focus_areas=$3,row_version=row_version+1 WHERE id=$1',[doctorId,data.bio,data.focusAreas]);
   await audit(db,user!.id,'doctor.public_profile.updated',doctorId,req.id,{fields:['bio','focusAreas']});
   return (await db.query(doctorSelect+' WHERE s.id=$1',[doctorId])).rows[0];
  });
 });
}
