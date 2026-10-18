import { id, quarterOf } from '../db.js';
import { fail, text, optionalText, money, version, requireObject, itemObject, dateTime, quarter, phone, email, dob, clinicAllowed, ensureClinic, eligiblePatientIds, ensurePatient, ensureAppointment, audit, save, profileComplete, quarterInterval, relevantPairs, sourceSignature, invalidateReports } from './shared.js';

export function command(db,user,type,p) {
  if(type==='visit.save'||type==='visit.complete') {
    const old=requireObject(db,'visits',p.id);if(user.role!=='manager'&&old.dentistId!==user.dentistId)fail('只能维护本人接诊记录',403,'FORBIDDEN');version(old,p);
    if(old.status==='completed'||db.count('settlements',{where:{visitId:old.id}})>0)fail('已完成或已结算就诊不可改写',409,'LOCKED');
    if(type==='visit.complete') {if(!old.lines.length)fail('至少录入一项治疗后才能完成');return save(db,'visits',old,{...old,status:'completed',completedAt:new Date().toISOString()});}
    if(!Array.isArray(p.lines)||p.lines.length>50)fail('治疗记录应为最多 50 行');
    const lines=p.lines.map((line,i)=>{
      itemObject(line,'治疗明细');
      const treatment=requireObject(db,'treatments',line.treatmentId);
      if(!treatment.active)fail('不能新增停用治疗项目');
      if(!Number.isInteger(line.quantity)||line.quantity<1||line.quantity>1000)fail('治疗数量应为 1 至 1000 的整数');
      const previous=old.lines.find(l=>l.treatmentId===line.treatmentId);
      return{id:previous?.id||id('LINE'),treatmentId:treatment.id,name:previous?.name||treatment.name,quantity:line.quantity,unitPrice:previous?.unitPrice??treatment.unitPrice};
    });
    if(new Set(lines.map(l=>l.treatmentId)).size!==lines.length)fail('同一治疗项目请合并数量');
    return save(db,'visits',old,{...old,notes:optionalText(p.notes,'诊疗备注',5000),lines});
  }
  if(type==='settlement.create') {
    const visit=requireObject(db,'visits',p.visitId);ensureClinic(user,visit.clinicId);
    const existing=db.find('settlements',{where:{visitId:visit.id},limit:1})[0];if(existing)return existing;
    if(visit.status!=='completed'||!visit.lines.length)fail('完成治疗记录后才可生成结算单',409,'VISIT_INCOMPLETE');
    const lines=visit.lines.map(l=>({id:l.id,treatmentId:l.treatmentId,name:l.name,quantity:l.quantity,unitPrice:l.unitPrice,subtotal:l.quantity*l.unitPrice}));
    const total=lines.reduce((n,l)=>n+l.subtotal,0);if(!Number.isSafeInteger(total))fail('金额超出安全范围');
    const result=save(db,'settlements',null,{number:`ADC-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${id('N').slice(2).toUpperCase()}`,visitId:visit.id,patientId:visit.patientId,clinicId:visit.clinicId,dentistId:visit.dentistId,date:new Date().toISOString(),lines,total});
    invalidateReports(db,quarterOf(result.date),'新增结算单，需重新核算');return result;
  }
}
