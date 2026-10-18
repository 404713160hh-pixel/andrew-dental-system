import { id, quarterOf } from '../db.js';
import { fail, text, optionalText, money, version, requireObject, itemObject, dateTime, quarter, phone, email, dob, clinicAllowed, ensureClinic, eligiblePatientIds, ensurePatient, ensureAppointment, audit, save, profileComplete, quarterInterval, relevantPairs, sourceSignature, invalidateReports } from './shared.js';

export function command(db,user,type,p) {
  if(type==='patient.lookup') {
    const normalized=value=>value.replace(/[\s-]/g,'');
    const contact=phone(p.phone,'联系电话'),birth=dob(p.dob);
    if(!birth)fail('跨门诊档案检索需要出生日期');
    const matches=db.query('patients','phone_normalized=? AND dob=? AND merged_into_id IS NULL AND COALESCE(active,1)=1',[normalized(contact),birth]);
    if(matches.length!==1)fail(matches.length?'发现重复档案，请店长核对后处理':'未找到匹配档案，请确认电话与出生日期',matches.length?409:404,matches.length?'DUPLICATE_PATIENT':'NOT_FOUND');
    const patient=matches[0];
    const accessClinicIds=[...new Set([...(patient.accessClinicIds||[]),...(user.role==='hq'?[]:user.clinicIds||[])])];
    if(JSON.stringify(accessClinicIds)!==JSON.stringify(patient.accessClinicIds||[]))return save(db,'patients',patient,{...patient,accessClinicIds});
    return patient;
  }
  if(type==='patient.save') {
    const old=p.id?requireObject(db,'patients',p.id):null;
    if(old){ensurePatient(db,user,old.id);version(old,p);if(old.mergedIntoId||old.active===false)fail('已合并档案不可改写',409,'PATIENT_MERGED');}else if(user.role==='customer')fail('客户只能维护本人档案',403,'FORBIDDEN');
    // Creation provenance is immutable, including an unassigned self-service
    // profile. A later editor must not assign it to a different clinic.
    const createdClinicId=old?(old.createdClinicId||null):(p.clinicId||user.clinicIds?.[0]||db.find('clinics',{where:{active:true},limit:1})[0]?.id);
    if(!old&&user.role!=='hq')ensureClinic(user,createdClinicId);
    if(createdClinicId)requireObject(db,'clinics',createdClinicId);
    const name=text(p.name,'姓名',60), birth=dob(p.dob||''), mobile=phone(p.phone,'联系电话');
    const address=optionalText(p.address,'账单地址',300), emergencyName=optionalText(p.emergencyName,'紧急联系人',60), emergencyPhone=p.emergencyPhone?phone(p.emergencyPhone,'紧急联系电话'):'';
    if(!['unknown','none','known'].includes(p.allergyStatus))fail('请选择过敏状态');
    if(!Array.isArray(p.allergies)||p.allergies.length>30)fail('过敏记录应为最多 30 项');
    const allergies=p.allergies.map(a=>{itemObject(a,'过敏记录');return{id:typeof a.id==='string'&&old?.allergies?.some(x=>x.id===a.id)?a.id:id('ALLERGY'),name:text(a.name,'过敏项',100),reaction:optionalText(a.reaction,'过敏反应',300),note:optionalText(a.note,'过敏备注',500)};});
    if(p.allergyStatus==='known'&&!allergies.length)fail('已知过敏请至少填写一项');
    if(p.allergyStatus!=='known'&&allergies.length)fail('非已知过敏状态不能保留过敏项目');
    const verified=user.role!=='customer'&&p.allergyStatus!=='unknown';
    return save(db,'patients',old,{id:old?.id,name,dob:birth,phone:mobile,email:email(p.email),address,emergencyName,emergencyPhone,allergyStatus:p.allergyStatus,allergies,allergyDeclaredAt:new Date().toISOString(),allergyVerifiedBy:verified?user.id:null,allergyVerifiedAt:verified?new Date().toISOString():null,allergySource:user.role==='customer'?'患者自述':p.allergyStatus==='unknown'?'工作人员记录待核实':'工作人员核对',createdClinicId,accessClinicIds:old?.accessClinicIds||[],createdAt:old?.createdAt||new Date().toISOString()});
  }
}
