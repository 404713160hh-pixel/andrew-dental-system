import type pg from 'pg';
import { one,transaction } from './db.js';
import { hashPassword } from './auth.js';
import { insertPatient } from './repositories/catalog.js';
export async function seed(pool:pg.Pool,password:string){
 if(password.length<12)throw new Error('SEED_PASSWORD must contain at least 12 characters');
 const hash=await hashPassword(password);
 return transaction(pool,async db=>{
  if(await one(db,"SELECT 1 FROM users WHERE username='hq'"))return {alreadySeeded:true};
  const createUser=async(username:string,name:string)=>(await one<{id:string}>(db,'INSERT INTO users(username,password_hash,display_name)VALUES($1,$2,$3) RETURNING id',[username,hash,name]))!.id;
  const hq=await createUser('hq','总部管理员');const front=await createUser('front.a','越秀门诊前台');const manager=await createUser('manager.a','越秀门诊店长');
  const doctorUser=await createUser('doctor.a','陈医生');
  const ca=(await one<{id:string}>(db,"INSERT INTO clinics(name,address,phone,email)VALUES('安德鲁牙科·越秀门诊','广州市越秀区·课程演示地址','020-88880001','yuexiu@example.test')RETURNING id"))!.id;
  const cb=(await one<{id:string}>(db,"INSERT INTO clinics(name,address,phone,email)VALUES('安德鲁牙科·天河门诊','广州市天河区·课程演示地址','020-88880002','tianhe@example.test')RETURNING id"))!.id;
  await db.query("INSERT INTO role_assignments(user_id,role,clinic_id)VALUES($1,'hq',NULL),($2,'front',$4),($3,'manager',$4),($5,'doctor',$4),($5,'doctor',$6)",[hq,front,manager,ca,doctorUser,cb]);
  const da=(await one<{id:string}>(db,"INSERT INTO staff(user_id,employee_no,name,phone,specialty)VALUES($1,'D001','陈医生','020-88881001','初诊检查与口腔咨询')RETURNING id",[doctorUser]))!.id;
  const dbid=(await one<{id:string}>(db,"INSERT INTO staff(employee_no,name,phone,specialty)VALUES('D002','李医生','020-88881002','初诊检查与预防咨询')RETURNING id"))!.id;
  const q=(await one<{id:string}>(db,"INSERT INTO qualifications(name)VALUES('口腔执业资格（演示）')RETURNING id"))!.id;
  for(const doctor of [da,dbid])await db.query("INSERT INTO dentist_qualifications(dentist_id,qualification_id,valid_from)VALUES($1,$2,'2020-01-01T00:00:00+08:00')",[doctor,q]);
  const initial=(await one<{id:string}>(db,"INSERT INTO services(name,description,duration_minutes,buffer_minutes,price_cents)VALUES('初诊检查','医生进行基础检查并说明后续就诊建议；预约项目不代表诊断。',30,10,6000)RETURNING id"))!.id;
  const consultation=(await one<{id:string}>(db,"INSERT INTO services(name,description,duration_minutes,buffer_minutes,price_cents)VALUES('普通咨询','提供口腔健康咨询，具体治疗由医生面诊后决定。',20,10,3000)RETURNING id"))!.id;
  for(const service of [initial,consultation]){
   await db.query('INSERT INTO service_qualifications(service_id,qualification_id)VALUES($1,$2)',[service,q]);
   for(const clinic of [ca,cb])await db.query('INSERT INTO clinic_services(clinic_id,service_id)VALUES($1,$2)',[clinic,service]);
  }
  for(const clinic of [ca,cb])for(const name of ['A01','A02'])await db.query('INSERT INTO chairs(clinic_id,name)VALUES($1,$2)',[clinic,name]);
  for(const [username,name,phone] of [['patient.a','林晓','13800001001'],['patient.b','周宁','13800001002']]){
   const userId=await createUser(username!,name!);
   await insertPatient(db,{name:name!,birthDate:'2002-03-16',phone:phone!,email:null,billingAddress:'广州·合成演示档案',emergencyName:'家属（演示）',emergencyPhone:'13800001999',allergyStatus:'unknown',allergies:[]},userId);
  }
  const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  for(let day=2;day<9;day++){
   const date=new Date(Date.parse(today+'T00:00:00Z')+day*86400000).toISOString().slice(0,10);
   for(const [doctor,clinic] of [[da,ca],[dbid,cb]]){
    const shift=(await one<{id:string}>(db,'INSERT INTO doctor_shifts(clinic_id,doctor_id,starts_at,ends_at,created_by)VALUES($1,$2,$3,$4,$5)RETURNING id',[clinic,doctor,date+'T09:00:00+08:00',date+'T17:00:00+08:00',hq]))!.id;
    for(const service of [initial,consultation])await db.query('INSERT INTO doctor_shift_services(shift_id,service_id)VALUES($1,$2)',[shift,service]);
   }
  }
  return {alreadySeeded:false,clinicIds:[ca,cb],doctorIds:[da,dbid],serviceIds:[initial,consultation]};
 });
}
