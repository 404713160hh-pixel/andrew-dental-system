import { id, quarterOf } from '../db.js';
import { fail, text, optionalText, money, version, requireObject, itemObject, dateTime, quarter, phone, email, dob, clinicAllowed, ensureClinic, eligiblePatientIds, ensurePatient, ensureAppointment, audit, save, profileComplete, quarterInterval, relevantPairs, sourceSignature, invalidateReports } from './shared.js';

export function command(db,user,type,p) {
  if(type==='appointment.book')return book(db,user,{patientId:p.patientId,scheduleId:p.scheduleId,problem:p.problem,specialNeeds:p.specialNeeds});
  if(type==='appointment.cancel'||type==='appointment.reschedule') {
    const old=requireObject(db,'appointments',p.id);ensureAppointment(user,old);version(old,p);
    if(old.status!=='booked')fail('仅有效预约可取消或改约',409,'STATUS_CONFLICT');
    if(user.role==='customer'&&Date.parse(old.start)-Date.now()<db.get('settings','global').cancellationHours*3600000)fail('已超过自助取消或改约截止时间，请联系门诊',409,'DEADLINE');
    const reason=text(p.reason,'取消或改约原因',500);
    const cancelled=save(db,'appointments',old,{...old,status:'cancelled',cancelReason:reason,cancelledAt:new Date().toISOString()});
    if(type==='appointment.cancel')return cancelled;
    const next=book(db,user,{patientId:old.patientId,scheduleId:p.scheduleId,problem:old.problem,specialNeeds:old.specialNeeds,previousId:old.id});
    audit(db,user,'appointment.cancel',old.id,{clinicId:old.clinicId,reason:'改约旧预约',nextId:next.id});return next;
  }
  if(type==='appointment.status') {
    const old=requireObject(db,'appointments',p.id);ensureAppointment(user,old);version(old,p);
    const reason=optionalText(p.reason,'状态变更原因',500);
    if(old.status==='no_show'&&p.status==='booked') {
      if(!reason)fail('爽约更正必须填写原因');
      if(db.count('appointments',{where:{scheduleId:old.scheduleId,id:{$ne:old.id},status:{$in:['booked','attended']}}})>=requireObject(db,'schedules',old.scheduleId).capacity)fail('时段已满，不能恢复预约',409,'SLOT_FULL');
      return save(db,'appointments',old,{...old,status:'booked',attended:false,statusReason:reason});
    }
    if(old.status!=='booked'||!['attended','no_show'].includes(p.status))fail('不支持该状态变更',409,'STATUS_CONFLICT');
    if(p.status==='attended'&&Date.now()<Date.parse(old.start))fail('预约时间未到，不能登记到诊');
    if(p.status==='no_show'&&Date.now()<Date.parse(old.end))fail('预约尚未结束，不能登记爽约');
    const result=save(db,'appointments',old,{...old,status:p.status,attended:p.status==='attended',statusReason:reason,statusChangedAt:new Date().toISOString()});
    if(p.status==='attended')save(db,'visits',null,{appointmentId:old.id,patientId:old.patientId,clinicId:old.clinicId,dentistId:old.dentistId,problem:old.problem,specialNeeds:old.specialNeeds,notes:'',status:'open',lines:[]});
    return result;
  }
}
function book(db,user,p) {
  const patient=requireObject(db,'patients',p.patientId);
  if(user.role==='customer'&&patient.id!==user.patientId)fail('只能预约本人就诊',403,'FORBIDDEN');
  if(user.role!=='customer')ensurePatient(db,user,patient.id);
  if(patient.active===false||patient.mergedIntoId)fail('该档案已合并或停用',409,'PATIENT_MERGED');
  if(!profileComplete(patient))fail('请补全出生日期、地址、紧急联系人，并提交过敏声明；不确定时可选择待核实',409,'PROFILE_INCOMPLETE');
  const schedule=requireObject(db,'schedules',p.scheduleId);
  if(user.role!=='customer')ensureClinic(user,schedule.clinicId);
  if(!schedule.active||!db.get('clinics',schedule.clinicId)?.active||!db.get('dentists',schedule.dentistId)?.active)fail('该时段资源已停用',409,'RESOURCE_INACTIVE');
  const dentist=db.get('dentists',schedule.dentistId);
  if(!dentist.qualificationIds.some(q=>db.get('qualifications',q)?.active))fail('牙医目前缺少有效资格，请联系门诊',409,'RESOURCE_INACTIVE');
  if(Date.parse(schedule.start)<=Date.now())fail('预约时段已开始，请选择未来时段',409,'PAST_SLOT');
  const conflict={status:{$in:['booked','attended']},start:{$lt:schedule.end},end:{$gt:schedule.start}};
  if(db.count('appointments',{where:{...conflict,dentistId:schedule.dentistId}})>0)fail('牙医该时段已有有效预约',409,'DENTIST_CONFLICT');
  if(db.count('appointments',{where:{scheduleId:schedule.id,status:{$in:['booked','attended']}}})>=schedule.capacity)fail('时段已约满，请刷新后重选',409,'SLOT_FULL');
  if(db.count('appointments',{where:{...conflict,patientId:patient.id}})>0)fail('患者已有重叠预约',409,'PATIENT_CONFLICT');
  return save(db,'appointments',null,{patientId:patient.id,clinicId:schedule.clinicId,dentistId:schedule.dentistId,scheduleId:schedule.id,start:schedule.start,end:schedule.end,problem:text(p.problem,'就诊问题',1000),specialNeeds:optionalText(p.specialNeeds,'特殊需求',1000),status:'booked',attended:false,...(p.previousId?{previousId:p.previousId}:{}),createdAt:new Date().toISOString()});
}
