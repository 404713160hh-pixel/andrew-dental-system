import { id } from '../db.js';
import { fail, requireObject, version, text, save } from './shared.js';
import { isAccountActive, safeAccount } from './accounts.js';

const normalized=value=>String(value||'').replace(/[\s-]/g,'').toLowerCase();
export const identityCommands={
  'patient.merge':(db,user,p)=>{
    const source=requireObject(db,'patients',p.sourceId),target=requireObject(db,'patients',p.targetId);
    version(source,{version:p.sourceVersion});version(target,{version:p.targetVersion});
    if(source.id===target.id)fail('不能归并同一份档案');
    if(source.active===false||source.mergedIntoId||target.active===false||target.mergedIntoId)fail('只能归并两个有效主档案',409,'PATIENT_INACTIVE');
    if(!source.dob||!target.dob||source.dob!==target.dob||normalized(source.phone)!==normalized(target.phone)||source.name.trim()!==target.name.trim())fail('姓名、出生日期与标准化电话须一致，请先完成机构核验并更正身份资料',409,'IDENTITY_CONFLICT');
    const reason=text(p.reason,'归并原因',1000),identityEvidence=text(p.identityEvidence,'身份核验依据',1000);
    const users=db.sql.prepare("SELECT id,data FROM users WHERE role='customer' AND patient_id IN (?,?)").all(source.id,target.id).map(r=>({id:r.id,data:JSON.parse(r.data)}));
    if(users.filter(r=>isAccountActive(r.data)).length>1)fail('两个档案都有有效顾客账号，请先核对并停用重复账号',409,'ACTIVE_ACCOUNT_CONFLICT');
    const future=db.sql.prepare("SELECT id,patient_id,start_at,end_at FROM appointments WHERE patient_id IN (?,?) AND status IN ('booked','attended') AND end_at>? ORDER BY start_at").all(source.id,target.id,new Date().toISOString());
    for(let i=0;i<future.length;i++)for(let j=i+1;j<future.length;j++)if(future[i].patient_id!==future[j].patient_id&&future[i].start_at<future[j].end_at&&future[i].end_at>future[j].start_at)fail('两个档案存在重叠的有效预约，请先取消重复预约',409,'MERGE_APPOINTMENT_CONFLICT');
    // Conflicting allergy declarations are retained conservatively and require a new clinical check.
    const allergies=[...(target.allergies||[])];for(const allergy of source.allergies||[])if(!allergies.some(a=>a.name===allergy.name&&a.reaction===allergy.reaction))allergies.push({...allergy,id:id('ALLERGY')});
    const allergyStatus=allergies.length?'known':source.allergyStatus==='unknown'||target.allergyStatus==='unknown'?'unknown':'none';
    const accessClinicIds=[...new Set([...(target.accessClinicIds||[]),...(source.accessClinicIds||[]),source.createdClinicId].filter(Boolean))].filter(key=>key!==target.createdClinicId);
    const retained=save(db,'patients',target,{...target,allergies,allergyStatus,allergyVerifiedBy:null,allergyVerifiedAt:null,allergySource:'档案归并保留双方声明，待临床重新核对',accessClinicIds,active:true});
    const transferred={};
    for(const table of ['appointments','visits','settlements']) {
      const records=db.find?db.find(table,{where:{patientId:source.id}}):db.all(table).filter(record=>record.patientId===source.id);
      transferred[table]=records.length;for(const record of records)save(db,table,record,{...record,patientId:target.id});
    }
    for(const row of users)if(row.data.patientId===source.id){const account=safeAccount(row.data);db.sql.prepare('UPDATE users SET data=? WHERE id=?').run(JSON.stringify({...account,patientId:target.id,version:account.version+1}),row.id);db.sql.prepare('DELETE FROM sessions WHERE user_id=?').run(row.id);}
    save(db,'patients',source,{...source,active:false,mergedIntoId:target.id});
    const result={id:id('MERGE'),sourceId:source.id,targetId:target.id,reason,identityEvidence,recordedAt:new Date().toISOString(),recordedBy:user.id,transferred,targetVersion:retained.version};
    db.sql.prepare('INSERT INTO patient_aliases(id,source_id,target_id,reason,identity_evidence,recorded_at,recorded_by) VALUES(?,?,?,?,?,?,?)').run(result.id,source.id,target.id,reason,identityEvidence,result.recordedAt,user.id);return result;
  }
};
