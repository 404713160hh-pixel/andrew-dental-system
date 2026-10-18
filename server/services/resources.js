import { id, quarterOf } from '../db.js';
import { fail, text, optionalText, money, version, requireObject, itemObject, dateTime, quarter, phone, email, dob, clinicAllowed, ensureClinic, eligiblePatientIds, ensurePatient, ensureAppointment, audit, save, profileComplete, quarterInterval, relevantPairs, sourceSignature, invalidateReports } from './shared.js';

export function command(db,user,type,p) {
  if(type==='clinic.save') {
    const old=p.id?requireObject(db,'clinics',p.id):null;
    if(old){ensureClinic(user,old.id);version(old,p);}else if(user.role!=='hq')fail('只有总部可新增门诊',403,'FORBIDDEN');
    if(typeof p.active!=='boolean'||!Number.isFinite(p.area)||p.area<=0||p.area>100000)fail('门诊状态及面积不正确');
    if(!p.active&&old&&db.count('appointments',{where:{clinicId:old.id,status:'booked',end:{$gt:new Date().toISOString()}}})>0)fail('门诊有未来有效预约，不能停用',409,'ACTIVE_BOOKINGS');
    return save(db,'clinics',old,{id:old?.id,name:text(p.name,'门诊名称',100),address:text(p.address,'地址',300),supervisor:text(p.supervisor,'主管',60),phone:phone(p.phone,'门诊电话'),email:email(p.email),area:p.area,active:p.active});
  }
  if(type==='qualification.save') {
    const old=p.id?requireObject(db,'qualifications',p.id):null;if(old)version(old,p);
    if(typeof p.active!=='boolean')fail('资格状态不正确');
    if(!p.active&&old) {
      const affected=db.sql.prepare('SELECT d.id FROM dentists d JOIN dentist_qualifications dq ON dq.dentist_id=d.id WHERE dq.qualification_id=? AND NOT EXISTS(SELECT 1 FROM dentist_qualifications other JOIN qualifications q ON q.id=other.qualification_id WHERE other.dentist_id=d.id AND q.active=1 AND q.id<>?)').all(old.id,old.id).map(d=>d.id);
      if(db.count('appointments',{where:{dentistId:{$in:affected},status:'booked',end:{$gt:new Date().toISOString()}}})>0)fail('资格停用将使未来预约牙医失去有效资格，请先协调预约',409,'ACTIVE_BOOKINGS');
    }
    return save(db,'qualifications',old,{id:old?.id,name:text(p.name,'资格名称',100),issuer:text(p.issuer,'颁发机构',150),description:optionalText(p.description,'说明',1000),active:p.active});
  }
  if(type==='dentist.save') {
    const old=p.id?requireObject(db,'dentists',p.id):null;if(old)version(old,p);
    const employeeNo=text(p.employeeNo,'员工编号',50);
    if(db.sql.prepare('SELECT 1 FROM dentists WHERE employee_no=? COLLATE NOCASE AND id<>?').get(employeeNo,old?.id||''))fail('员工编号已存在',409,'DUPLICATE');
    if(typeof p.active!=='boolean'||!Array.isArray(p.qualificationIds)||p.qualificationIds.length>30)fail('牙医状态或资格不正确');
    const qualificationIds=[...new Set(p.qualificationIds)];for(const q of qualificationIds)requireObject(db,'qualifications',q);
    if(p.active&&!qualificationIds.some(q=>db.get('qualifications',q)?.active))fail('在岗牙医至少需要一项有效资格');
    if(!p.active&&old&&db.count('appointments',{where:{dentistId:old.id,status:'booked',end:{$gt:new Date().toISOString()}}})>0)fail('牙医有未来有效预约，不能停用',409,'ACTIVE_BOOKINGS');
    const details=p.qualificationDetails===undefined?old?.qualificationDetails||[]:p.qualificationDetails;
    if(!Array.isArray(details)||details.length>30)fail('资格核验资料格式错误');
    for(const detail of details)itemObject(detail,'资格核验资料');
    const qualificationDetails=details.filter(d=>qualificationIds.includes(d.qualificationId)).map(d=>{const verifiedAt=d.verifiedAt?dateTime(d.verifiedAt,'核验时间'):'';if(verifiedAt&&Date.parse(verifiedAt)>Date.now())fail('资格核验时间不能在未来');return{qualificationId:d.qualificationId,certificateNo:optionalText(d.certificateNo,'证书编号',100),verifiedAt,verifiedBy:verifiedAt?user.id:null,note:optionalText(d.note,'核验备注',500)};});
    const birth=dob(p.dob||old?.dob||'');if(p.active&&!birth)fail('在岗牙医必须填写出生日期');
    return save(db,'dentists',old,{id:old?.id,employeeNo,name:text(p.name,'牙医姓名',60),dob:birth,phone:phone(p.phone,'电话'),email:email(p.email),address:text(p.address,'个人联系地址',300),qualificationIds,qualificationDetails,active:p.active});
  }
  if(type==='schedule.save') {
    const old=p.id?requireObject(db,'schedules',p.id):null;if(old){ensureClinic(user,old.clinicId);version(old,p);}ensureClinic(user,p.clinicId);
    const clinic=requireObject(db,'clinics',p.clinicId), dentist=requireObject(db,'dentists',p.dentistId);
    if(p.active&&(!clinic.active||!dentist.active))fail('停用门诊或牙医不可发布排班');
    if(p.active&&!dentist.qualificationIds.some(q=>db.get('qualifications',q)?.active))fail('牙医缺少有效资格');
    const start=dateTime(p.start,'开始时间'),end=dateTime(p.end,'结束时间');
    if(Date.parse(start)>=Date.parse(end)||Date.parse(end)-Date.parse(start)>12*3600000)fail('排班时间应为正且不超过 12 小时');
    if(p.capacity!==1||typeof p.active!=='boolean')fail('单牙医时段容量必须为 1，且需选择状态');
    if(old&&db.count('appointments',{where:{scheduleId:old.id,status:{$ne:'cancelled'}}})>0)fail('已有预约的时段不能修改；请改约后新增时段',409,'ACTIVE_BOOKINGS');
    if(Date.parse(start)<Date.now())fail('新建或调整排班必须在未来');
    if(p.active&&db.count('schedules',{where:{id:{$ne:old?.id||''},active:true,dentistId:p.dentistId,start:{$lt:end},end:{$gt:start}}})>0)fail('同一牙医跨门诊排班时间重叠',409,'SCHEDULE_CONFLICT');
    const result=save(db,'schedules',old,{id:old?.id,clinicId:p.clinicId,dentistId:p.dentistId,start,end,capacity:p.capacity,active:p.active});
    invalidateReports(db,quarterOf(start),'接诊资源范围变更，需重新核算');
    if(old&&quarterOf(old.start)!==quarterOf(start))invalidateReports(db,quarterOf(old.start),'接诊资源移出季度，需重新核算');return result;
  }
  if(type==='treatment.save') {
    const old=p.id?requireObject(db,'treatments',p.id):null;if(old)version(old,p);
    if(typeof p.active!=='boolean')fail('治疗项目状态不正确');
    return save(db,'treatments',old,{id:old?.id,name:text(p.name,'治疗名称',100),unit:text(p.unit,'计价单位',30),unitPrice:money(p.unitPrice,'单价'),active:p.active});
  }
}
