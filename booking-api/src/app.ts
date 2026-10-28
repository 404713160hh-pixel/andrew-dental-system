import Fastify from 'fastify';
import type { FastifyRequest,HTTPMethods } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Principal,Clinic,Doctor,Service,Chair,Qualification,Shift,Appointment,Patient,Page,TreatmentReference } from '@andrew/shared';
import type { Config } from './config.js';
import { one,transaction,iso } from './db.js';
import { AppError,requireThat,databaseError } from './errors.js';
import { authenticate,principal,login,hashPassword,tokenHash,audit,demoUsers,staffOnly,isHq,scopeIds,clinicAccess } from './auth.js';
import { uuid,text,date,profile,loginInput,version,pageInput,instant } from './validation.js';
import { patientSelect,getPatient,insertPatient,saveAllergies,clinicSelect,doctorSelect,serviceSelect,chairSelect,qualificationSelect,shiftSelect,appointmentSelect,getAppointment,events } from './repositories/catalog.js';
import { querySlots } from './repositories/booking.js';
import { bookingPolicy,createHold,confirmAppointment,changeAppointment,appointmentAccess } from './services/booking.js';
import { saveResource,publishShift,cancelShift } from './services/resources.js';
import { isQueryDateAllowed,queryWindow,QUERY_MAX_DAYS } from './query-window.js';
import { registerStaffAccountRoutes } from './staff-accounts.js';
import { registerPatientInviteRoutes } from './patient-invites.js';
import { registerDoctorProfileRoutes } from './doctor-profile.js';
import { PRIVACY_VERSION,privacyInput,recordConsent,hasCurrentConsent } from './privacy.js';
type Shape={Params:Record<string,string>;Querystring:Record<string,string>;Body:unknown};
type Request=FastifyRequest<Shape>;
type Handler=(request:Request,user:Principal|undefined)=>Promise<unknown>;
const id=(req:Request)=>uuid.parse(req.params.id);
export async function createApp(config:Config,pool:pg.Pool,logging=false){
 const app=Fastify({logger:logging?{redact:['req.headers.authorization','req.url','password','password_hash','token']}:false,bodyLimit:131072,requestTimeout:30000,connectionTimeout:10000,genReqId:()=>randomUUID(),trustProxy:config.TRUSTED_PROXY_IPS.trim()?config.TRUSTED_PROXY_IPS.split(',').map(ip=>ip.trim()):false});
 await app.register(cors,{origin:config.CORS_ORIGINS.split(',').map(s=>s.trim()),methods:['GET','POST','PUT','OPTIONS'],allowedHeaders:['Content-Type','Authorization','Idempotency-Key']});
 await app.register(rateLimit,{max:300,timeWindow:'1 minute',errorResponseBuilder:request=>({error:{code:'RATE_LIMITED',message:'操作频繁，请稍后重试'},requestId:request.id})});
 app.setErrorHandler((error,req,reply)=>{
  let known:AppError;
  if(error instanceof AppError)known=error;
  else if(error instanceof z.ZodError)known=new AppError(400,'VALIDATION_ERROR','请求格式或字段不正确',error.issues.map(i=>({path:i.path,message:i.message})));
  else known=databaseError(error)??new AppError((error as {statusCode?:number}).statusCode===400?400:500,'INTERNAL_ERROR','服务暂时不可用，请保留操作编号后重试');
  if(known.status>=500)req.log.error({code:(error as {code?:string}).code,requestId:req.id},'Request failed');
  reply.code(known.status).send({error:{code:known.code,message:known.message,...(known.details?{details:known.details}:{})},requestId:req.id});
 });
 app.setNotFoundHandler((req,reply)=>reply.code(404).send({error:{code:'NOT_FOUND',message:'接口不存在'},requestId:req.id}));
 function route(method:HTTPMethods,path:string,auth:'none'|'required'|'optional',handler:Handler){
  app.route<Shape>({method,url:'/api/v1'+path,config:path.startsWith('/auth/')?{rateLimit:{max:config.NODE_ENV==='test'?1000:30,timeWindow:'1 minute'}}:{},handler:async req=>{
   let user=auth==='required'||auth==='optional'&&req.headers.authorization?await authenticate(pool,req.headers.authorization):undefined;
   requireThat(!user?.mustChangePassword || ['/me','/auth/change-password','/auth/logout'].includes(path),403,'PASSWORD_CHANGE_REQUIRED','请先修改临时密码');
   const demoPatient=config.NODE_ENV!=='production'&&demoUsers.some(([name,,portal])=>portal==='patient'&&name===user?.username);
   if(user?.patientId && !demoPatient && !['/me','/auth/logout','/privacy/status','/privacy/consent','/privacy/withdraw'].includes(path)) {
    const consented=await hasCurrentConsent(pool,user.patientId,user.id);
    if(!consented && auth==='optional') user=undefined;
    else requireThat(consented,403,'PRIVACY_CONSENT_REQUIRED','请先阅读隐私告知并确认同意');
   }
   const data=await handler(req,user);return {data,requestId:req.id};
  }});
 }
 registerStaffAccountRoutes(route,pool);
 registerPatientInviteRoutes(route,pool,config);
 registerDoctorProfileRoutes(route,pool);
 route('GET','/health','none',async()=>{await pool.query('SELECT 1');return {status:'ok',database:'postgresql'};});
 route('GET','/auth/config','none',async()=>{
  const enabled=config.NODE_ENV!=='production'&&config.ALLOW_DEMO_LOGIN==='true';
  if(!enabled)return {demoLoginEnabled:false,demoAccounts:[],wechatLoginEnabled:false};
  const accounts=(await pool.query<{username:string;displayName:string}>('SELECT username,display_name AS "displayName" FROM users WHERE active AND username=ANY($1::text[])',[demoUsers.map(([username])=>username)])).rows;
  return {demoLoginEnabled:true,demoAccounts:demoUsers.flatMap(([username,,portal])=>{
   const account=accounts.find(item=>item.username===username);return account?[{...account,portal}]:[];
  }),wechatLoginEnabled:false};
 });
 route('POST','/auth/login','none',async(req)=>{
  const input=loginInput.parse(req.body);return transaction(pool,async db=>{const result=await login(db,config,input);await audit(db,result.user.id,'auth.login',result.user.id,req.id);return result;});
 });
 route('POST','/auth/demo','none',async(req)=>{
  requireThat(config.NODE_ENV!=='production'&&config.ALLOW_DEMO_LOGIN==='true',403,'DEMO_LOGIN_DISABLED','当前环境未开启演示登录');
  const input=z.object({username:text,portal:z.enum(['patient','staff'])}).strict().parse(req.body);
  requireThat(demoUsers.some(([name,,portal])=>name===input.username&&portal===input.portal),403,'DEMO_ACCOUNT_ONLY','仅允许内置合成演示账号');
  return transaction(pool,async db=>{const result=await login(db,config,input,true);await audit(db,result.user.id,'auth.demo',result.user.id,req.id);return result;});
 });
 route('POST','/auth/register','none',async req=>{
  const input=z.object({username:z.string().trim().regex(/^[a-zA-Z0-9._-]{3,80}$/),password:z.string().min(12).max(128),profile,consent:privacyInput}).strict().parse(req.body);
  const hashed=await hashPassword(input.password);
  return transaction(pool,async db=>{
   const user=await one<{id:string}>(db,'INSERT INTO users(username,password_hash,display_name)VALUES($1,$2,$3)RETURNING id',[input.username.toLowerCase(),hashed,input.profile.name]);
   const patient=await insertPatient(db,input.profile,user!.id);await recordConsent(db,user!.id,patient.id,input.profile.birthDate,input.consent,req.id);await audit(db,user!.id,'patient.registered',user!.id,req.id);
   return login(db,config,{username:input.username,password:input.password,portal:'patient'});
  });
 });
 route('POST','/auth/wechat','none',async()=>{throw new AppError(501,'WECHAT_NOT_CONFIGURED','微信授权登录尚未配置，请使用账号登录');});
 route('GET','/privacy/notice','none',async()=>({policyVersion:PRIVACY_VERSION,controller:config.PRIVACY_CONTROLLER_NAME||'演示环境（非真实机构）',contact:config.PRIVACY_CONTACT||'演示环境无正式联系方式',retention:config.PRIVACY_RETENTION||'演示数据仅供本地测试，由演示环境管理者清理'}));
 route('GET','/privacy/status','required',async(_req,user)=>{requireThat(user!.patientId,403,'PATIENT_ONLY','此入口仅用于患者');
  const patient=await one<{minor:boolean}>(pool,"SELECT (birth_date + interval '14 years') > (clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::date AS minor FROM patients WHERE id=$1",[user!.patientId]);
  return {policyVersion:PRIVACY_VERSION,accepted:await hasCurrentConsent(pool,user!.patientId!,user!.id),minor:!!patient?.minor};});
 route('POST','/privacy/consent','required',async(req,user)=>{
  requireThat(user!.patientId,403,'PATIENT_ONLY','此入口仅用于患者');const consent=privacyInput.parse(req.body);
  return transaction(pool,async db=>{const patient=await getPatient(db,user!.patientId!);requireThat(patient,404,'NOT_FOUND','患者不存在');await recordConsent(db,user!.id,patient!.id,patient!.birthDate,consent,req.id);return {accepted:true,policyVersion:PRIVACY_VERSION};});
 });
 route('POST','/privacy/withdraw','required',async(req,user)=>{
  requireThat(user!.patientId,403,'PATIENT_ONLY','此入口仅用于患者');z.object({confirm:z.literal(true)}).strict().parse(req.body);
  return transaction(pool,async db=>{await db.query('UPDATE patient_privacy_consents SET revoked_at=clock_timestamp() WHERE patient_id=$1 AND revoked_at IS NULL',[user!.patientId]);
   await audit(db,user!.id,'patient.privacy.withdrawn',user!.patientId,req.id);return {withdrawn:true};});
 });
 route('GET','/me','required',async(_req,user)=>user);
 route('POST','/auth/logout','required',async(req,user)=>transaction(pool,async db=>{
  await db.query('DELETE FROM sessions WHERE token_hash=$1',[tokenHash(req.headers.authorization!.slice(7))]);await audit(db,user!.id,'auth.logout',user!.id,req.id);return {loggedOut:true};
 }));
 route('GET','/patients/me','required',async(_req,user)=>{requireThat(user!.patientId,403,'PATIENT_ONLY','此入口仅用于患者');return getPatient(pool,user!.patientId);});
 route('PUT','/patients/me','required',async(req,user)=>{
  const patientId=user!.patientId;requireThat(patientId,403,'PATIENT_ONLY','此入口仅用于患者');
  const {expectedVersion,...raw}=z.record(z.string(),z.unknown()).parse(req.body);const expected=version.parse(expectedVersion);const input=profile.parse(raw);
  return transaction(pool,async db=>{
   const old=await one<{row_version:number}>(db,'SELECT row_version FROM patients WHERE id=$1 FOR UPDATE',[patientId]);
   requireThat(old?.row_version===expected,409,'VERSION_CONFLICT','资料已变更，请刷新后重试');
   await db.query('UPDATE patients SET name=$2,birth_date=$3,phone=$4,email=$5,billing_address=$6,emergency_name=$7,emergency_phone=$8,allergy_status=$9,row_version=row_version+1 WHERE id=$1',[user!.patientId,input.name,input.birthDate,input.phone,input.email||null,input.billingAddress,input.emergencyName,input.emergencyPhone,input.allergyStatus]);
   await saveAllergies(db,patientId,input.allergies);await audit(db,user!.id,'patient.profile.updated',patientId,req.id);return getPatient(db,patientId);
  });
 });
 route('GET','/booking-policy','none',async()=>({...bookingPolicy(config),queryWindow:queryWindow()}));
 route('GET','/treatment-references','none',async()=>{
  if(config.NODE_ENV==='production')return [];
  // This public projection contains no patient/account data. A consultation fee
  // remains in services.price_cents; treatment ranges never price a booking.
  return (await pool.query<TreatmentReference>(`SELECT tr.id,tr.category,tr.name,tr.price_min_cents AS "priceMinCents",
   tr.price_max_cents AS "priceMaxCents",tr.unit,tr.reference_year AS "referenceYear",tr.source_label AS "sourceLabel",tr.description,
   CASE WHEN s.active THEN tr.booking_service_id ELSE NULL END AS "bookingServiceId"
   FROM treatment_references tr LEFT JOIN services s ON s.id=tr.booking_service_id ORDER BY tr.sort_order,tr.id`)).rows;
 });
 // Catalog queries never return patient or account data. Inactive management
 // views are authenticated and scoped independently of these public views.
 route('GET','/clinics','optional',async(req,user)=>{
  const inactive=req.query.includeInactive==='true';if(inactive){requireThat(user,401,'UNAUTHENTICATED','请先登录');staffOnly(user);}
  const scopes=inactive?scopeIds(user!):null;
  return (await pool.query<Clinic>(clinicSelect+` WHERE ($1::boolean OR active) AND ($2::uuid[] IS NULL OR id=ANY($2)) ORDER BY name`,[inactive,scopes])).rows;
 });
 route('GET','/services','optional',async(req,user)=>{
  const inactive=req.query.includeInactive==='true';if(inactive){requireThat(user,401,'UNAUTHENTICATED','请先登录');staffOnly(user);}
  const clinic=req.query.clinicId?uuid.parse(req.query.clinicId):null;const scopes=inactive?scopeIds(user!):null;
  return (await pool.query<Service>(serviceSelect+` WHERE ($1::boolean OR v.active) AND ($2::uuid IS NULL OR EXISTS(SELECT 1 FROM clinic_services cs WHERE cs.service_id=v.id AND cs.clinic_id=$2))
   AND ($3::uuid[] IS NULL OR EXISTS(SELECT 1 FROM clinic_services cs WHERE cs.service_id=v.id AND cs.clinic_id=ANY($3))) ORDER BY v.name`,[inactive,clinic,scopes])).rows;
 });
 route('GET','/doctors','optional',async(req,user)=>{
  const inactive=req.query.includeInactive==='true';if(inactive){requireThat(user,401,'UNAUTHENTICATED','请先登录');staffOnly(user);}
  const clinic=req.query.clinicId?uuid.parse(req.query.clinicId):null;const service=req.query.serviceId?uuid.parse(req.query.serviceId):null;const scopes=inactive?scopeIds(user!):null;
  const doctors=(await pool.query<Doctor>(doctorSelect+` WHERE s.is_dentist AND ($1::boolean OR s.active) AND ($2::uuid IS NULL OR EXISTS(SELECT 1 FROM doctor_shifts ds JOIN clinics c ON c.id=ds.clinic_id AND c.active WHERE ds.doctor_id=s.id AND ds.clinic_id=$2 AND ds.status='published' AND ds.ends_at>clock_timestamp()))
   AND ($3::uuid IS NULL OR NOT EXISTS(SELECT 1 FROM service_qualifications sq WHERE sq.service_id=$3 AND NOT EXISTS(SELECT 1 FROM dentist_qualifications dq JOIN qualifications q ON q.id=dq.qualification_id WHERE dq.dentist_id=s.id AND dq.qualification_id=sq.qualification_id AND q.active AND dq.valid_from<=now() AND (dq.valid_until IS NULL OR dq.valid_until>now()))))
   AND ($4::uuid[] IS NULL OR s.active OR EXISTS(SELECT 1 FROM doctor_shifts ds WHERE ds.doctor_id=s.id AND ds.clinic_id=ANY($4))) ORDER BY s.name`,[inactive,clinic,service,scopes])).rows;
  if(user&&isHq(user))return doctors;
  return doctors.map(({employeeNo:_employeeNo,phone:_phone,...visible})=>visible);
 });
 route('GET','/qualifications','optional',async(req,user)=>{
  const inactive=req.query.includeInactive==='true';if(inactive){requireThat(user,401,'UNAUTHENTICATED','请先登录');staffOnly(user);}
  return (await pool.query<Qualification>(qualificationSelect+' WHERE ($1::boolean OR active) ORDER BY name',[inactive])).rows;
 });
 route('GET','/chairs','optional',async(req,user)=>{
  const inactive=req.query.includeInactive==='true';if(inactive){requireThat(user,401,'UNAUTHENTICATED','请先登录');staffOnly(user);}
  const clinic=req.query.clinicId?uuid.parse(req.query.clinicId):null;const scopes=inactive?scopeIds(user!):null;
  return (await pool.query<Chair>(chairSelect+' WHERE ($1::boolean OR active) AND ($2::uuid IS NULL OR clinic_id=$2) AND ($3::uuid[] IS NULL OR clinic_id=ANY($3)) ORDER BY name',[inactive,clinic,scopes])).rows;
 });
 route('GET','/shifts','required',async(req,user)=>{
  staffOnly(user!);const clinic=req.query.clinicId?uuid.parse(req.query.clinicId):null;const day=req.query.date?date.parse(req.query.date):null;
  if(clinic)clinicAccess(user!,clinic);
  const scopes=scopeIds(user!);const doctorOnly=!user!.roles.some(r=>['hq','manager','front'].includes(r));
  requireThat(!doctorOnly||user!.staffId,403,'DOCTOR_PROFILE_REQUIRED','医生账号尚未关联员工档案，请联系管理员');
  return (await pool.query<Shift>(shiftSelect+` WHERE ($1::uuid IS NULL OR ds.clinic_id=$1) AND ($2::date IS NULL OR (ds.starts_at AT TIME ZONE 'Asia/Shanghai')::date=$2)
   AND ($3::uuid[] IS NULL OR ds.clinic_id=ANY($3)) AND ($4::uuid IS NULL OR ds.doctor_id=$4) ORDER BY ds.starts_at DESC LIMIT 500`,[clinic,day,scopes,doctorOnly?user!.staffId:null])).rows.map(s=>({...s,startsAt:iso(s.startsAt),endsAt:iso(s.endsAt)}));
 });
 for(const kind of ['clinics','doctors','services','chairs','qualifications'] as const){
  route('POST','/staff/'+kind,'required',async(req,user)=>saveResource(pool,user!,kind,req.body,undefined,req.id));
  route('PUT','/staff/'+kind+'/:id','required',async(req,user)=>saveResource(pool,user!,kind,req.body,id(req),req.id));
 }
 route('POST','/staff/shifts','required',async(req,user)=>publishShift(pool,config,user!,req.body,req.id));
 route('POST','/staff/shifts/:id/cancel','required',async(req,user)=>cancelShift(pool,user!,id(req),z.object({expectedVersion:version}).strict().parse(req.body).expectedVersion,req.id));
 route('POST','/staff/chair-blocks','required',async(req,user)=>{
  const input=z.object({chairId:uuid,startsAt:instant,endsAt:instant,reason:text}).strict().parse(req.body);requireThat(Date.parse(input.endsAt)>Date.parse(input.startsAt),400,'INVALID_INTERVAL','停用区间不正确');
  return transaction(pool,async db=>{
   const chair=await one<{clinic_id:string}>(db,'SELECT clinic_id FROM chairs WHERE id=$1 FOR UPDATE',[input.chairId]);requireThat(chair,404,'NOT_FOUND','牙椅不存在');clinicAccess(user!,chair.clinic_id,['hq','manager']);
   const collision=await one(db,"SELECT 1 FROM resource_reservations WHERE chair_id=$1 AND (status='booked' OR status='held' AND expires_at>clock_timestamp()) AND tstzrange(starts_at,occupied_until,'[)')&&tstzrange($2,$3,'[)')",[input.chairId,input.startsAt,input.endsAt]);
   requireThat(!collision,409,'FUTURE_BOOKINGS_EXIST','停用时段仍有有效预约或占位');
   const result=await one(db,'INSERT INTO chair_blocks(chair_id,starts_at,ends_at,reason,created_by)VALUES($1,$2,$3,$4,$5) RETURNING id',[input.chairId,input.startsAt,input.endsAt,input.reason,user!.id]);await audit(db,user!.id,'chair.blocked',input.chairId,req.id);return result;
  });
 });
 route('GET','/staff/patients','required',async(req,user)=>{
  staffOnly(user!);requireThat(user!.roles.some(r=>['hq','manager','front'].includes(r)),403,'FORBIDDEN','该岗位没有患者检索权限');
  const {page,pageSize}=pageInput.parse(req.query);const q=z.string().trim().max(100).parse(req.query.q??'');
  // First-visit contact lookup is explicit; ordinary staff cannot enumerate the chain.
  requireThat(isHq(user!)||q.length>=2,400,'PATIENT_SEARCH_REQUIRED','请输入至少两个字的姓名或联系电话核对患者');
  const match='%'+q.replace(/[\\%_]/g,'\\$&')+'%';const hq=isHq(user!);const scopes=scopeIds(user!,['hq','manager','front']);
  const where=` WHERE (($2::boolean AND (p.name ILIKE $1 ESCAPE '\\' OR p.phone ILIKE $1 ESCAPE '\\')) OR (NOT $2::boolean AND (p.name=$3 OR p.phone=$3)))
   AND ($2::boolean OR EXISTS(SELECT 1 FROM patient_clinic_access x WHERE x.patient_id=p.id AND x.clinic_id=ANY($4::uuid[]))
    OR EXISTS(SELECT 1 FROM appointments a JOIN resource_reservations r ON r.id=a.reservation_id WHERE a.patient_id=p.id AND r.clinic_id=ANY($4::uuid[])))`;
  return transaction(pool,async db=>{
   const values=[match,hq,q,scopes];const total=Number((await one<{n:string}>(db,'SELECT count(*) AS n FROM patients p'+where,values))!.n);
   const items=(await db.query(`SELECT p.id,p.name,CASE WHEN length(p.phone)>7 THEN left(p.phone,3)||'****'||right(p.phone,4) ELSE '***' END AS phone,
    to_char(p.birth_date,'YYYY') AS "birthYear",(p.user_id IS NOT NULL) AS "hasAccount",p.is_demo AS "isDemo" FROM patients p`+where+' ORDER BY p.created_at DESC LIMIT $5 OFFSET $6',[...values,pageSize,(page-1)*pageSize])).rows;
   await audit(db,user!.id,'patient.search',null,req.id,{returned:items.length});return {items,total,page,pageSize};
  });
 });
 route('POST','/staff/patients','required',async(req,user)=>{
  staffOnly(user!);requireThat(user!.roles.some(r=>['hq','manager','front'].includes(r)),403,'FORBIDDEN','该岗位没有患者建档权限');
  const raw=z.record(z.string(),z.unknown()).parse(req.body);const {clinicId:clinicRaw,consent:consentRaw,...rest}=raw;
  const clinicId=uuid.parse(clinicRaw);clinicAccess(user!,clinicId,['hq','manager','front']);const input=profile.parse(rest);const consent=privacyInput.parse(consentRaw);
  return transaction(pool,async db=>{const p=await insertPatient(db,input);await db.query('INSERT INTO patient_clinic_access(patient_id,clinic_id,created_by) VALUES($1,$2,$3)',[p.id,clinicId,user!.id]);
   await recordConsent(db,user!.id,p.id,input.birthDate,consent,req.id);await audit(db,user!.id,'patient.created',p.id,req.id,{clinicId});return p;});
 });
 route('GET','/booking-slots','optional',async(req,user)=>{
  const input=z.object({clinicId:uuid,serviceId:uuid,date,doctorId:uuid.optional()}).parse(req.query);
  requireThat(isQueryDateAllowed(input.date),400,'DATE_OUT_OF_RANGE',`请选择未来${QUERY_MAX_DAYS}天内的日期`);
  return querySlots(pool,{...input,...(user?.patientId?{patientId:user.patientId}:{})},bookingPolicy(config));
 });
 route('POST','/booking-holds','required',async(req,user)=>createHold(pool,config,user!,req.body,req.id));
 route('POST','/appointments/confirm','required',async(req,user)=>confirmAppointment(pool,config,user!,req.body,req.headers['idempotency-key'] as string|undefined,req.id));
 const listAppointments=async(req:Request,user:Principal,staff:boolean):Promise<Page<Appointment>>=>{
  if(staff)staffOnly(user);else requireThat(user.patientId,403,'PATIENT_ONLY','此入口仅用于患者');
  const {page,pageSize}=pageInput.parse(req.query);const clinic=req.query.clinicId?uuid.parse(req.query.clinicId):null;const day=req.query.date?date.parse(req.query.date):null;
  const status=req.query.status?z.enum(['confirmed','cancelled','rescheduled']).parse(req.query.status):null;
  if(staff&&clinic)clinicAccess(user,clinic);
  const scopes=staff?scopeIds(user):null;const doctorOnly=staff&&!user.roles.some(r=>['hq','manager','front'].includes(r));
  requireThat(!doctorOnly||user.staffId,403,'DOCTOR_PROFILE_REQUIRED','医生账号尚未关联员工档案，请联系管理员');
  const where=` WHERE ($1::uuid IS NULL OR a.patient_id=$1) AND ($2::uuid IS NULL OR r.clinic_id=$2) AND ($3::date IS NULL OR (r.starts_at AT TIME ZONE 'Asia/Shanghai')::date=$3)
   AND ($4::text IS NULL OR a.status=$4) AND ($5::uuid[] IS NULL OR r.clinic_id=ANY($5)) AND ($6::uuid IS NULL OR r.doctor_id=$6)`;
  const values=[staff?null:user.patientId,clinic,day,status,scopes,doctorOnly?user.staffId:null];
  const total=Number((await one<{n:string}>(pool,'SELECT count(*) AS n FROM appointments a JOIN resource_reservations r ON r.id=a.reservation_id'+where,values))!.n);
  const items=(await pool.query<Appointment>(appointmentSelect+where+' ORDER BY r.starts_at DESC,a.id LIMIT $7 OFFSET $8',[...values,pageSize,(page-1)*pageSize])).rows.map(a=>({...a,startsAt:iso(a.startsAt),endsAt:iso(a.endsAt),occupiedUntil:iso(a.occupiedUntil),createdAt:iso(a.createdAt),policy:'cancellationNoticeMinutes' in a.policy?a.policy:bookingPolicy(config)}));
  return {items,total,page,pageSize};
 };
 route('GET','/appointments','required',async(req,user)=>listAppointments(req,user!,false));
 route('GET','/staff/appointments','required',async(req,user)=>listAppointments(req,user!,true));
 route('GET','/appointments/:id','required',async(req,user)=>{
  const a=await getAppointment(pool,id(req),bookingPolicy(config));requireThat(a,404,'NOT_FOUND','预约不存在');appointmentAccess(user!,a);a.events=await events(pool,a.id);return a;
 });
 route('POST','/appointments/:id/changes','required',async(req,user)=>changeAppointment(pool,config,user!,id(req),req.body,req.headers['idempotency-key'] as string|undefined,req.id));
 route('GET','/commands/:key','required',async(req,user)=>{
  const key=z.string().regex(/^[A-Za-z0-9_-]{8,128}$/).parse(req.params.key);
  const receipt=await one<{result:Appointment}>(pool,'SELECT result FROM command_receipts WHERE user_id=$1 AND command_key=$2',[user!.id,key]);
  if(receipt)appointmentAccess(user!,receipt.result);
  return receipt?{status:'completed',result:receipt.result}:{status:'not_found'};
 });
 return app;
}
