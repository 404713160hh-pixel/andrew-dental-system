import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import type { FastifyRequest, HTTPMethods } from 'fastify';
import { z } from 'zod';
import type { Principal } from '@andrew/shared';
import type { Config } from './config.js';
import { hashPassword,login,audit,staffOnly } from './auth.js';
import { one,transaction } from './db.js';
import { requireThat } from './errors.js';
import { requirePatientVisible } from './patient-access.js';
import { privacyInput,recordConsent } from './privacy.js';
import { date,uuid } from './validation.js';

type Shape={Params:Record<string,string>;Querystring:Record<string,string>;Body:unknown};
type Request=FastifyRequest<Shape>;
type Route=(method:HTTPMethods,path:string,auth:'none'|'required'|'optional',handler:(req:Request,user:Principal|undefined)=>Promise<unknown>)=>void;
const digest=(code:string)=>createHash('sha256').update(code).digest('hex');
const linkedRegistration=z.object({
 username:z.string().trim().regex(/^[a-zA-Z0-9._-]{3,80}$/),password:z.string().min(12).max(128),
 code:z.string().regex(/^[A-Za-z0-9_-]{24}$/),birthDate:date,consent:privacyInput
}).strict();

export function registerPatientInviteRoutes(route:Route,pool:pg.Pool,config:Config) {
 route('POST','/staff/patients/:id/invitations','required',async(req,user)=>{
  staffOnly(user!);
  requireThat(user!.roles.some(r=>['hq','manager','front'].includes(r)),403,'FORBIDDEN','该岗位不能办理档案关联');
  z.object({identityVerified:z.literal(true)}).strict().parse(req.body);
  const patientId=uuid.parse(req.params.id),code=randomBytes(18).toString('base64url');
  return transaction(pool,async db=>{
   await requirePatientVisible(db,user!,patientId);
   const patient=await one<{user_id:string|null}>(db,'SELECT user_id FROM patients WHERE id=$1 FOR UPDATE',[patientId]);
   requireThat(patient,404,'NOT_FOUND','患者档案不存在');
   requireThat(!patient!.user_id,409,'PATIENT_ALREADY_LINKED','该档案已有登录账号');
   await db.query('UPDATE patient_registration_invites SET revoked_at=clock_timestamp() WHERE patient_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL',[patientId]);
   const row=await one<{expires_at:Date}>(db,`INSERT INTO patient_registration_invites(patient_id,code_hash,issued_by,expires_at)
    VALUES($1,$2,$3,clock_timestamp()+interval '10 minutes') RETURNING expires_at`,[patientId,digest(code),user!.id]);
   await audit(db,user!.id,'patient.invitation.issued',patientId,req.id,{identityVerified:true});
   return {code,expiresAt:new Date(row!.expires_at).toISOString()};
  });
 });
 route('POST','/auth/register-linked','none',async req=>{
  const input=linkedRegistration.parse(req.body),hash=digest(input.code),passwordHash=await hashPassword(input.password);
  return transaction(pool,async db=>{
   const hint=await one<{patient_id:string}>(db,'SELECT patient_id FROM patient_registration_invites WHERE code_hash=$1',[hash]);
   requireThat(hint,400,'INVITATION_INVALID','凭证无效或已过期，请联系前台重新核验');
   const patient=await one<{user_id:string|null;birth_date:string;name:string}>(db,"SELECT user_id,to_char(birth_date,'YYYY-MM-DD') AS birth_date,name FROM patients WHERE id=$1 FOR UPDATE",[hint!.patient_id]);
   const invitation=await one<{id:string}>(db,`SELECT id FROM patient_registration_invites WHERE code_hash=$1 AND patient_id=$2
    AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE`,[hash,hint!.patient_id]);
   requireThat(invitation&&patient&&!patient.user_id&&patient.birth_date===input.birthDate,400,'INVITATION_INVALID','凭证无效或资料不符，请联系前台重新核验');
   const account=await one<{id:string}>(db,'INSERT INTO users(username,password_hash,display_name) VALUES($1,$2,$3) RETURNING id',[input.username.toLowerCase(),passwordHash,patient!.name]);
   await db.query('UPDATE patients SET user_id=$2,row_version=row_version+1 WHERE id=$1',[hint!.patient_id,account!.id]);
   await recordConsent(db,account!.id,hint!.patient_id,patient!.birth_date,input.consent,req.id);
   await db.query('UPDATE patient_registration_invites SET consumed_at=clock_timestamp() WHERE id=$1',[invitation!.id]);
   await audit(db,account!.id,'patient.registered_with_invitation',hint!.patient_id,req.id);
   return login(db,config,{username:input.username,password:input.password,portal:'patient'});
  });
 });
}
