import { createHash } from 'node:crypto';
import { id, quarterOf } from '../db.js';
export class ApiError extends Error {
  constructor(status, message, code='VALIDATION') { super(message); this.status=status; this.code=code; }
}
const fail=(message,status=400,code='VALIDATION')=>{throw new ApiError(status,message,code);};
const text=(value,label,max=500,required=true)=>{
  if(typeof value!=='string' || value.length>max || (required&&!value.trim())) fail(`${label}不能为空且不得超过 ${max} 字符`);
  return value.trim();
};
const optionalText=(value,label,max=500)=>value===undefined||value===null?'':text(value,label,max,false);
const money=(value,label)=>{if(!Number.isSafeInteger(value)||value<0||value>100000000000)fail(`${label}必须是非负整数分，最大 10 亿元`);return value;};
const version=(old,payload)=>{if(!Number.isInteger(payload.version)||old.version!==payload.version)fail('数据已经更新，请刷新后重试',409,'VERSION_CONFLICT');};
const requireObject=(db,table,key)=>{if(typeof key!=='string'||!key||key.length>100)fail('记录编号格式不正确');return db.get(table,key)||fail('记录不存在',404,'NOT_FOUND');};
const itemObject=(item,label)=>{if(!item||typeof item!=='object'||Array.isArray(item))fail(`${label}格式不正确`);return item;};
const dateTime=(value,label)=>{if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))fail(`${label}不是有效时间`);return new Date(value).toISOString();};
const quarter=(value)=>{if(typeof value!=='string'||!/^\d{4}-Q[1-4]$/.test(value))fail('季度格式应为 YYYY-Q1 至 YYYY-Q4');return value;};
const phone=(value,label)=>{const s=text(value,label,30);if(!/^[+\d][\d\s-]{5,28}$/.test(s))fail(`${label}格式不正确`);return s;};
const email=value=>{const s=optionalText(value,'邮箱',120);if(s&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))fail('邮箱格式不正确');return s;};
const dob=value=>{if(value==='')return '';if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value||new Date(value)>new Date())fail('出生日期不正确');return value;};
function clinicAllowed(user,clinicId) { return user.role==='hq'||user.clinicIds?.includes(clinicId); }
function ensureClinic(user,clinicId) { if(!clinicAllowed(user,clinicId))fail('无权操作该门诊',403,'FORBIDDEN'); }
export function authorizationScope(user) {return {role:user.role,clinicIds:[...new Set(user.clinicIds||[])].sort(),dentistId:user.dentistId||null,patientId:user.patientId||null};}
export function scopeFor(user,table,alias=table) {
 const col=name=>alias+'.'+name;
 if(user.role==='hq')return {condition:'1',params:[]};
 if(table==='patients') {
  if(user.role==='customer')return {condition:col('id')+'=?',params:[user.patientId]};
  if(user.role==='clinical')return {condition:'EXISTS(SELECT 1 FROM appointments scope_a WHERE scope_a.patient_id='+col('id')+' AND scope_a.dentist_id=?)',params:[user.dentistId]};
  const ids=user.clinicIds||[], marks=ids.map(()=>'?').join(',')||'NULL';
  return {condition:'('+col('created_clinic_id')+' IN ('+marks+') OR EXISTS(SELECT 1 FROM patient_clinic_access access WHERE access.patient_id='+col('id')+' AND access.clinic_id IN ('+marks+')) OR EXISTS(SELECT 1 FROM appointments scope_a WHERE scope_a.patient_id='+col('id')+' AND scope_a.clinic_id IN ('+marks+')))',params:[...ids,...ids,...ids]};
 }
 if(user.role==='customer')return {condition:col('patient_id')+'=?',params:[user.patientId]};
 if(user.role==='clinical')return ['visits','settlements'].includes(table)?{condition:'EXISTS(SELECT 1 FROM appointments history_scope WHERE history_scope.patient_id='+col('patient_id')+' AND history_scope.dentist_id=?)',params:[user.dentistId]}:{condition:col('dentist_id')+'=?',params:[user.dentistId]};
 const ids=user.clinicIds||[];return {condition:col('clinic_id')+' IN ('+(ids.map(()=>'?').join(',')||'NULL')+')',params:ids};
}
export function scoped(db,user,table,extra='1',params=[],options={}) {const q=scopeFor(user,table);return db.query(table,'('+q.condition+') AND ('+extra+')',[...q.params,...params],options);}
function eligiblePatientIds(db,user) {const q=scopeFor(user,'patients');return new Set(db.sql.prepare('SELECT id FROM patients WHERE ('+q.condition+') AND merged_into_id IS NULL AND COALESCE(active,1)=1').all(...q.params).map(p=>p.id));}
function ensurePatient(db,user,patientId) {const q=scopeFor(user,'patients');if(!db.sql.prepare('SELECT 1 FROM patients WHERE id=? AND ('+q.condition+') AND merged_into_id IS NULL AND COALESCE(active,1)=1').get(patientId,...q.params))fail('无权访问该患者资料',403,'FORBIDDEN');}
function ensureAppointment(user,appointment) {
  if(user.role==='customer') { if(appointment.patientId!==user.patientId)fail('无权操作其他患者预约',403,'FORBIDDEN'); }
  else ensureClinic(user,appointment.clinicId);
}
function audit(db,user,type,targetId,detail={}) {
  const record={id:id('LOG'),at:new Date().toISOString(),userId:user.id,userName:user.name,type,targetId,detail};
  db.sql.prepare('INSERT INTO audit(id,at,user_id,type,target_id,detail) VALUES(?,?,?,?,?,?)').run(record.id,record.at,user.id,type,targetId,JSON.stringify({userName:user.name,...detail}));
}
export function auditEvent(db,user,type,targetId,detail) {audit(db,user,type,targetId,detail);}
function save(db,table,old,object) {return db.put(table,{...object,id:old?.id||object.id||id(table.toUpperCase()),version:old?old.version+1:1});}
function profileComplete(p) {
  return p.name&&p.dob&&p.phone&&p.address&&p.emergencyName&&p.emergencyPhone&&['unknown','none','known'].includes(p.allergyStatus)&&(p.allergyStatus!=='known'||p.allergies.length>0)&&(p.allergyStatus!=='unknown'||Boolean(p.allergyDeclaredAt));
}
function quarterInterval(value) {
  const [year,q]=quarter(value).split('-Q').map(Number);
  return [Date.UTC(year,(q-1)*3,1)-8*3600000,Date.UTC(year,q*3,1)-8*3600000];
}
function pairKey(c,d) {return `${c}:${d}`;}
function relevantPairs(db,q,clinicIds) {
 const [start,end]=quarterInterval(q), params=[new Date(end).toISOString(),new Date(start).toISOString(),new Date(start).toISOString(),new Date(end).toISOString()];
 let filter='';if(clinicIds){filter=' WHERE clinicId IN ('+(clinicIds.map(()=>'?').join(',')||'NULL')+')';params.push(...clinicIds);}
 return db.sql.prepare('SELECT DISTINCT clinicId,dentistId FROM (SELECT clinic_id AS clinicId,dentist_id AS dentistId FROM schedules WHERE active=1 AND start_at<? AND end_at>? UNION SELECT clinic_id,dentist_id FROM settlements WHERE date>=? AND date<?)'+filter+' ORDER BY clinicId,dentistId').all(...params);
}
function sourceSignature(db,q,clinicIds) {
 const [start,end]=quarterInterval(q), dates=[new Date(start).toISOString(),new Date(end).toISOString()];
 const filter=clinicIds?' AND clinic_id IN ('+(clinicIds.map(()=>'?').join(',')||'NULL')+')':'';
 const settlements=db.query('settlements','date>=? AND date<?'+filter,[...dates,...(clinicIds||[])]);
 const costs=db.query('costs','quarter=?'+filter,[q,...(clinicIds||[])]);
 const adjustments=db.sql.prepare('SELECT a.* FROM invoice_adjustments a JOIN settlements s ON s.id=a.settlement_id WHERE s.date>=? AND s.date<?'+filter.replaceAll('clinic_id','s.clinic_id')+' ORDER BY a.id').all(...dates,...(clinicIds||[]));
 return createHash('sha256').update(JSON.stringify({settlements,costs,pairs:relevantPairs(db,q,clinicIds),adjustments})).digest('hex');
}
function invalidateReports(db,q,reason) {
 for(const r of db.find('quarterReports',{where:{quarter:q}}))db.put('quarterReports',{...r,status:'draft',invalidatedAt:new Date().toISOString(),invalidatedReason:reason,version:r.version+1,history:[...(r.history||[]),{at:new Date().toISOString(),action:reason,priorStatus:r.status,priorVersion:r.version}]});
}

export { fail, text, optionalText, money, version, requireObject, itemObject, dateTime, quarter, phone, email, dob, clinicAllowed, ensureClinic, eligiblePatientIds, ensurePatient, ensureAppointment, audit, save, profileComplete, quarterInterval, relevantPairs, sourceSignature, invalidateReports };
