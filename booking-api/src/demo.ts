import type pg from 'pg';
import type { PoolClient } from 'pg';
import type { PatientInput } from '@andrew/shared';
import { one,transaction } from './db.js';
import { audit } from './auth.js';
import { insertPatient,saveAllergies } from './repositories/catalog.js';
import { lockQualifications,qualified } from './services/resources.js';
import { referenceInputs } from './demo-reference-data.js';

type Kind='clinic'|'doctor'|'patient'|'service'|'qualification'|'treatment_reference';
type Marker={record_key:string;record_kind:Kind;record_id:string;enriched_at:Date|null};
const tables:Record<Kind,string>={clinic:'clinics',doctor:'staff',patient:'patients',service:'services',qualification:'qualifications',treatment_reference:'treatment_references'};
const baseKeys=['seed:clinic:a','seed:clinic:b','seed:doctor:a','seed:doctor:b','seed:patient:a','seed:patient:b','seed:service:initial','seed:service:consultation','seed:qualification'] as const;
const sourceLabel='用户提供的价格资料（未独立核验）';
const consultationNote='虚构演示设置的咨询预约费用估计，非治疗参考价；本系统不收取此费用，实际治疗需面诊另列清单。';
function ensure(value:unknown,message:string):asserts value {if(!value)throw new Error(message);}
async function marker(db:PoolClient,key:string,kind:Kind):Promise<Marker|undefined>{
 const row=await one<Marker>(db,'SELECT * FROM demo_seed_records WHERE record_key=$1',[key]);
 if(row){ensure(row.record_kind===kind,'Demo provenance kind mismatch');ensure(await one(db,`SELECT id FROM ${tables[kind]} WHERE id=$1`,[row.record_id]),'Demo provenance target is missing; no ordinary record was adopted');}
 return row;
}
async function register(db:PoolClient,key:string,kind:Kind,id:string,enriched=false){
 await db.query('INSERT INTO demo_seed_records(record_key,record_kind,record_id,enriched_at)VALUES($1,$2,$3,CASE WHEN $4 THEN clock_timestamp() ELSE NULL END)',[key,kind,id,enriched]);
}
async function obtain(db:PoolClient,key:string,kind:Kind,create:()=>Promise<string>):Promise<string>{
 const old=await marker(db,key,kind);if(old)return old.record_id;
 const id=await create();await register(db,key,kind,id,true);return id;
}

/** Fail closed when upgrading a pre-003 seed: names alone are not provenance. */
async function recogniseOriginalSeed(db:PoolClient){
 const existing=await db.query('SELECT record_key FROM demo_seed_records WHERE record_key=ANY($1::text[])',[baseKeys]);
 if(existing.rows.length){ensure(existing.rows.length===baseKeys.length,'Incomplete original demo provenance; no data was changed');return;}
 const usernames=['hq','front.a','manager.a','doctor.a','patient.a','patient.b'];
 const users=(await db.query<{id:string;username:string;password_hash:string;created_at:Date}>('SELECT id,username,password_hash,created_at FROM users WHERE username=ANY($1::text[])',[usernames])).rows;
 ensure(users.length===6,'No complete original synthetic seed found; run db:migrate and db:seed in a separate development database first');
 const byName=new Map(users.map(u=>[u.username,u]));const hq=byName.get('hq')!;
 ensure(users.every(u=>u.password_hash===hq.password_hash&&u.created_at.getTime()===hq.created_at.getTime()),'Existing names do not prove original seed ownership; no data was changed');
 ensure(await one(db,"SELECT 1 FROM role_assignments WHERE user_id=$1 AND role='hq' AND clinic_id IS NULL",[hq.id]),'Original seed headquarters identity is not established');
 const clinicA=(await db.query<{id:string}>(`SELECT c.id FROM clinics c JOIN role_assignments ra ON ra.clinic_id=c.id
 WHERE ra.user_id=$1 AND ra.role='front' AND c.name='安德鲁牙科·越秀门诊' AND c.address='广州市越秀区·课程演示地址'
 AND c.phone='020-88880001' AND c.email='yuexiu@example.test'`,[byName.get('front.a')!.id])).rows;
 const clinicB=(await db.query<{id:string}>(`SELECT c.id FROM clinics c JOIN role_assignments ra ON ra.clinic_id=c.id
 WHERE ra.user_id=$1 AND ra.role='doctor' AND c.name='安德鲁牙科·天河门诊' AND c.address='广州市天河区·课程演示地址'
 AND c.phone='020-88880002' AND c.email='tianhe@example.test'`,[byName.get('doctor.a')!.id])).rows;
 ensure(clinicA.length===1&&clinicB.length===1,'Original seed clinic links could not be verified');
 const ca=clinicA[0]!.id;const cb=clinicB[0]!.id;
 ensure(await one(db,"SELECT 1 FROM role_assignments WHERE user_id=$1 AND role='manager' AND clinic_id=$2",[byName.get('manager.a')!.id,ca]),'Original manager clinic link could not be verified');
 const staff=(await db.query<{id:string;user_id:string|null;employee_no:string;name:string;phone:string;specialty:string}>('SELECT id,user_id,employee_no,name,phone,specialty FROM staff WHERE employee_no=ANY($1::text[])',[['D001','D002']])).rows;
 ensure(staff.length===2,'Original doctor identities could not be verified');
 const da=staff.find(s=>s.employee_no==='D001')!;const dbb=staff.find(s=>s.employee_no==='D002')!;
 ensure(da.user_id===byName.get('doctor.a')!.id&&dbb.user_id===null,'Original doctor account links could not be verified');
 ensure(da.name==='陈医生'&&da.phone==='020-88881001'&&da.specialty==='初诊检查与口腔咨询'
  &&dbb.name==='李医生'&&dbb.phone==='020-88881002'&&dbb.specialty==='初诊检查与预防咨询','Original doctor resource fingerprints could not be verified; no same-name employee was adopted');
 const patients=(await db.query<{id:string;username:string;created_at:Date}>(`SELECT p.id,u.username,p.created_at FROM patients p JOIN users u ON u.id=p.user_id WHERE u.username=ANY($1::text[])`,[['patient.a','patient.b']])).rows;
 ensure(patients.length===2&&patients.every(p=>p.created_at.getTime()===hq.created_at.getTime()),'Original patient account links could not be verified');
 const q=(await db.query<{id:string}>("SELECT id FROM qualifications WHERE name='口腔执业资格（演示）'")).rows;
 ensure(q.length===1,'Original simulation qualification could not be verified');
 const services=(await db.query<{id:string;name:string}>(`SELECT id,name FROM services WHERE
 (name='初诊检查' AND duration_minutes=30 AND buffer_minutes=10 AND price_cents=6000)
 OR (name='普通咨询' AND duration_minutes=20 AND buffer_minutes=10 AND price_cents=3000)`)).rows;
 ensure(services.length===2&&new Set(services.map(s=>s.name)).size===2,'Original service identities are ambiguous; no ordinary service was adopted');
 for(const service of services){
  const links=await db.query('SELECT 1 FROM clinic_services WHERE service_id=$1 AND clinic_id=ANY($2::uuid[])',[service.id,[ca,cb]]);
  ensure(links.rows.length===2&&await one(db,'SELECT 1 FROM service_qualifications WHERE service_id=$1 AND qualification_id=$2',[service.id,q[0]!.id]),'Original service links could not be verified');
 }
 for(const [doctor,clinic] of [[da,ca],[dbb,cb]] as const){
  ensure(await one(db,'SELECT 1 FROM dentist_qualifications WHERE dentist_id=$1 AND qualification_id=$2',[doctor.id,q[0]!.id]),'Original doctor qualification links could not be verified');
  ensure(await one(db,'SELECT 1 FROM doctor_shifts ds JOIN doctor_shift_services dss ON dss.shift_id=ds.id WHERE ds.doctor_id=$1 AND ds.clinic_id=$2 AND dss.service_id=ANY($3::uuid[])',[doctor.id,clinic,services.map(s=>s.id)]),'Original doctor clinic and service schedule links could not be verified');
 }
 const values:[string,Kind,string][]=[['seed:clinic:a','clinic',ca],['seed:clinic:b','clinic',cb],['seed:doctor:a','doctor',da.id],['seed:doctor:b','doctor',dbb.id],
  ['seed:patient:a','patient',patients.find(p=>p.username==='patient.a')!.id],['seed:patient:b','patient',patients.find(p=>p.username==='patient.b')!.id],
  ['seed:service:initial','service',services.find(s=>s.name==='初诊检查')!.id],['seed:service:consultation','service',services.find(s=>s.name==='普通咨询')!.id],['seed:qualification','qualification',q[0]!.id]];
 for(const [key,kind,id] of values)await register(db,key,kind,id);
}

const doctorProfiles=[
 {key:'seed:doctor:a',employeeNo:'D001',name:'陈知远（虚构医生）',bio:'在演示场景中侧重初诊信息核对，协助整理就诊问题与需要向面诊医生说明的情况。',focus:['初诊检查','口腔咨询'],services:['initial','consultation']},
 {key:'seed:doctor:b',employeeNo:'D002',name:'李若宁（虚构医生）',bio:'在演示场景中围绕清洁方式与预防面诊事项沟通，帮助就诊人列出需要现场确认的问题。',focus:['洁牙前评估','预防咨询'],services:['initial','consultation']},
 {key:'demo:doctor:c',employeeNo:'DEMO-ADC-2026-D03',name:'苏予安（虚构医生）',bio:'在演示场景中用易懂的语言向家庭说明儿童口腔评估环节，整理家长关注的预约与沟通事项。',focus:['儿童口腔咨询','家庭护理沟通'],services:['initial','consultation','child']},
 {key:'demo:doctor:d',employeeNo:'DEMO-ADC-2026-D04',name:'顾清和（虚构医生）',bio:'在演示场景中围绕根管后修复与材料选择的面诊沟通，整理方案范围和分项费用需要核对的内容。',focus:['修复治疗评估','根管与牙冠咨询'],services:['initial','consultation','restoration']},
 {key:'demo:doctor:e',employeeNo:'DEMO-ADC-2026-D05',name:'周沐辰（虚构医生）',bio:'在演示场景中整理缺牙修复评估时的沟通问题，提醒就诊人向面诊医生逐项核对检查安排与费用清单。',focus:['缺牙修复评估','种植方案咨询'],services:['initial','consultation','implant']},
 {key:'demo:doctor:f',employeeNo:'DEMO-ADC-2026-D06',name:'许知夏（虚构医生）',bio:'在演示场景中围绕矫治评估与复诊安排沟通，帮助就诊人整理方案解释、时间安排及费用范围的问题。',focus:['正畸初筛','矫治方案咨询'],services:['initial','consultation','orthodontic']},
] as const;
const newServiceProfiles=[
 {key:'child',name:'儿童口腔咨询（演示）',duration:30,price:5000},
 {key:'restoration',name:'修复治疗评估（演示）',duration:40,price:6000},
 {key:'implant',name:'种植方案咨询（演示）',duration:45,price:8000},
 {key:'orthodontic',name:'正畸方案咨询（演示）',duration:45,price:8000},
] as const;
const patientNames=['林晓','周宁','叶知秋','沈星禾','温予宁','宋晚晴','陆时安','江清越'];
function patientProfile(index:number):PatientInput{
 const known=index===3||index===6;
 return {name:patientNames[index]+'（虚构患者）',birthDate:['2002-03-16','2002-03-16','1994-06-12','1988-11-08','1999-05-21','1982-07-04','1996-10-10','1975-01-19'][index]!,
  phone:'0000000100'+(index+1),email:`fictional-patient-${index+1}@example.invalid`,billingAddress:'虚构地址：仅用于课程预约演示，不对应真实住址',
  emergencyName:'虚构联系人（演示）',emergencyPhone:'00000001999',allergyStatus:known?'known':index%2===0?'unknown':'none_reported',
  allergies:known?[index===3?'乳胶（虚构声明）':'树脂（虚构声明）']:[]};
}

export async function enrichDemoData(pool:pg.Pool,environment:'development'|'test'|'production',transferBufferMinutes=30){
 // Guard is inside the exported function as well as the CLI, before any query.
 ensure(environment!=='production','Synthetic demo enrichment is disabled in production');
 ensure(Number.isInteger(transferBufferMinutes)&&transferBufferMinutes>=0&&transferBufferMinutes<=240,'Invalid demo transfer-buffer policy');
 return transaction(pool,async db=>{
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended('andrew.booking.demo.2026',0))");
  await recogniseOriginalSeed(db);
  const get=async(key:string,kind:Kind)=>{const row=await marker(db,key,kind);ensure(row,'Required original demo provenance is missing');return row.record_id;};
  const clinicIds=[await get('seed:clinic:a','clinic'),await get('seed:clinic:b','clinic')];
  const qualificationId=await get('seed:qualification','qualification');
  const hq=await one<{id:string}>(db,"SELECT id FROM users WHERE username='hq'");ensure(hq,'Synthetic headquarters account is missing');
  const serviceIds:Record<string,string>={initial:await get('seed:service:initial','service'),consultation:await get('seed:service:consultation','service')};
  const specializationIds:Record<string,string>={};
  for(const entry of newServiceProfiles){
   specializationIds[entry.key]=await obtain(db,'demo:qualification:'+entry.key,'qualification',async()=>{
    const row=await one<{id:string}>(db,'INSERT INTO qualifications(name)VALUES($1)RETURNING id',[entry.name.replace('（演示）','')+'能力（虚构演示，不作真实执业资质）']);return row!.id;
   });
   serviceIds[entry.key]=await obtain(db,'demo:service:'+entry.key,'service',async()=>{
    const row=await one<{id:string}>(db,'INSERT INTO services(name,description,duration_minutes,buffer_minutes,price_cents)VALUES($1,$2,$3,10,$4)RETURNING id',[entry.name,consultationNote,entry.duration,entry.price]);return row!.id;
   });
   for(const clinic of clinicIds)await db.query('INSERT INTO clinic_services(clinic_id,service_id)VALUES($1,$2)ON CONFLICT DO NOTHING',[clinic,serviceIds[entry.key]]);
   await db.query('INSERT INTO service_qualifications(service_id,qualification_id)VALUES($1,$2)ON CONFLICT DO NOTHING',[serviceIds[entry.key],qualificationId]);
   await db.query('INSERT INTO service_qualifications(service_id,qualification_id)VALUES($1,$2)ON CONFLICT DO NOTHING',[serviceIds[entry.key],specializationIds[entry.key]]);
  }
  for(const key of ['seed:service:initial','seed:service:consultation']){
   const row=(await marker(db,key,'service'))!;
   if(!row.enriched_at){await db.query('UPDATE services SET description=description||$2,row_version=row_version+1 WHERE id=$1',[row.record_id,' '+consultationNote]);await db.query('UPDATE demo_seed_records SET enriched_at=clock_timestamp()WHERE record_key=$1',[key]);}
  }
  const doctorIds:string[]=[];
  for(let i=0;i<doctorProfiles.length;i++){
   const profile=doctorProfiles[i]!;const biography=`${profile.bio} ${profile.name}是课程演示中的虚构人物，以上内容不代表真实执照、学历、任职或治疗履历，也不构成具体诊疗建议。`;
   let row=await marker(db,profile.key,'doctor');
   if(!row){
    ensure(!await one(db,'SELECT 1 FROM staff WHERE employee_no=$1',[profile.employeeNo]),'A non-demo employee uses a reserved demo code; no existing employee was overwritten');
    const doctor=await one<{id:string}>(db,'INSERT INTO staff(employee_no,name,phone,specialty,is_demo,bio,focus_areas)VALUES($1,$2,$3,$4,true,$5,$6)RETURNING id',
     [profile.employeeNo,profile.name,'0000000200'+(i+1),profile.focus.join('、'),biography,[...profile.focus]]);
    await register(db,profile.key,'doctor',doctor!.id,true);row=(await marker(db,profile.key,'doctor'))!;
   }else if(!row.enriched_at){
    await db.query('UPDATE staff SET name=$2,phone=$3,specialty=$4,is_demo=true,bio=$5,focus_areas=$6,row_version=row_version+1 WHERE id=$1',
     [row.record_id,profile.name,'0000000200'+(i+1),profile.focus.join('、'),biography,[...profile.focus]]);
    await db.query('UPDATE demo_seed_records SET enriched_at=clock_timestamp()WHERE record_key=$1',[profile.key]);
   }
   doctorIds.push(row.record_id);
   await db.query('INSERT INTO dentist_qualifications(dentist_id,qualification_id,valid_from)VALUES($1,$2,date_trunc(\'day\',clock_timestamp())-interval \'1 day\')ON CONFLICT DO NOTHING',[row.record_id,qualificationId]);
   if(i>=2)await db.query('INSERT INTO dentist_qualifications(dentist_id,qualification_id,valid_from)VALUES($1,$2,date_trunc(\'day\',clock_timestamp())-interval \'1 day\')ON CONFLICT DO NOTHING',[row.record_id,specializationIds[newServiceProfiles[i-2]!.key]]);
  }
  const patientIds:string[]=[];
  for(let i=0;i<8;i++){
   const key=i<2?'seed:patient:'+(i===0?'a':'b'):'demo:patient:'+(i+1);const profile=patientProfile(i);
   let row=await marker(db,key,'patient');
   if(!row){
    const patient=await insertPatient(db,profile);await db.query('UPDATE patients SET is_demo=true WHERE id=$1',[patient.id]);
    await register(db,key,'patient',patient.id,true);row=(await marker(db,key,'patient'))!;
   }else if(!row.enriched_at){
    await db.query('UPDATE patients SET name=$2,birth_date=$3,phone=$4,email=$5,billing_address=$6,emergency_name=$7,emergency_phone=$8,allergy_status=$9,is_demo=true,row_version=row_version+1 WHERE id=$1',
     [row.record_id,profile.name,profile.birthDate,profile.phone,profile.email,profile.billingAddress,profile.emergencyName,profile.emergencyPhone,profile.allergyStatus]);
    await saveAllergies(db,row.record_id,profile.allergies);
    await db.query('UPDATE demo_seed_records SET enriched_at=clock_timestamp()WHERE record_key=$1',[key]);
   }
   patientIds.push(row.record_id);
  }
  // Only the known initial display names are enriched; subsequent personal edits
  // and every ordinary account/record are preserved.
  await db.query("UPDATE users u SET display_name=$1 FROM staff s WHERE s.id=$2 AND s.user_id=u.id AND u.display_name='陈医生'",[doctorProfiles[0]!.name,doctorIds[0]]);
  await db.query("UPDATE users u SET display_name=$1 FROM patients p WHERE p.id=$2 AND p.user_id=u.id AND u.display_name='林晓'",[patientProfile(0).name,patientIds[0]]);
  await db.query("UPDATE users u SET display_name=$1 FROM patients p WHERE p.id=$2 AND p.user_id=u.id AND u.display_name='周宁'",[patientProfile(1).name,patientIds[1]]);
  let referencesAdded=0;
  for(const input of referenceInputs){
   const serviceKey=input.code==='fluoride'||input.code==='sealant'?'child':input.category==='种植修复'?'implant':input.category==='正畸评估'?'orthodontic':input.category==='补牙与根管'||input.category==='牙冠与贴面'?'restoration':'initial';
   const key='demo:reference:'+input.code;
   if(!await marker(db,key,'treatment_reference')){
    const ref=await one<{id:string}>(db,`INSERT INTO treatment_references(reference_code,category,name,price_min_cents,price_max_cents,unit,reference_year,source_label,description,booking_service_id,sort_order)
     VALUES($1,$2,$3,$4,$5,$6,2026,$7,$8,$9,$10)ON CONFLICT(reference_code)DO NOTHING RETURNING id`,
     ['adc-demo-2026:'+input.code,input.category,input.name,input.priceMinCents,input.priceMaxCents,input.unit,sourceLabel,input.description,serviceIds[serviceKey],input.sortOrder]);
    ensure(ref,'A non-demo reference uses the reserved reference code; no reference was overwritten');await register(db,key,'treatment_reference',ref.id,true);referencesAdded++;
   }
  }
  for(const doctorId of [...doctorIds].sort())await db.query('SELECT id FROM staff WHERE id=$1 FOR UPDATE',[doctorId]);
  const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);let addedShifts=0;let keptExistingShifts=0;
  for(let day=1;day<=14;day++){
   const date=new Date(Date.parse(today+'T00:00:00Z')+day*86400000).toISOString().slice(0,10);
   const start=date+'T09:00:00+08:00';const end=date+'T17:00:00+08:00';
   for(let i=0;i<doctorIds.length;i++){
    const doctorId=doctorIds[i]!;const clinicId=clinicIds[i<2?i:(i+day)%2]!;
    const doctor=await one<{active:boolean}>(db,'SELECT active FROM staff WHERE id=$1',[doctorId]);
    const clinic=await one<{active:boolean}>(db,'SELECT active FROM clinics WHERE id=$1 FOR SHARE',[clinicId]);
    if(!doctor?.active||!clinic?.active||!await one(db,'SELECT 1 FROM chairs WHERE clinic_id=$1 AND active LIMIT 1',[clinicId]))continue;
    const overlap=await one(db,`SELECT 1 FROM doctor_shifts WHERE doctor_id=$1 AND (
      (status='published' AND starts_at<$3::timestamptz+CASE WHEN clinic_id<>$4 THEN $5::int*interval '1 minute' ELSE interval '0' END
      AND ends_at>$2::timestamptz-CASE WHEN clinic_id<>$4 THEN $5::int*interval '1 minute' ELSE interval '0' END)
      OR (status='cancelled' AND tstzrange(starts_at,ends_at,'[)')&&tstzrange($2::timestamptz,$3::timestamptz,'[)')))
      LIMIT 1`,[doctorId,start,end,clinicId,transferBufferMinutes]);
    if(overlap){keptExistingShifts++;continue;}
    const available:string[]=[];
    for(const key of [...doctorProfiles[i]!.services].sort()){
     const serviceId=serviceIds[key]!;
     if(!await one(db,'SELECT 1 FROM services WHERE id=$1 AND active FOR SHARE',[serviceId]))continue;
     await lockQualifications(db,serviceId);if(await qualified(db,doctorId,serviceId,start,end))available.push(serviceId);
    }
    if(!available.length)continue;
    const shift=await one<{id:string}>(db,'INSERT INTO doctor_shifts(clinic_id,doctor_id,starts_at,ends_at,created_by)VALUES($1,$2,$3,$4,$5)RETURNING id',[clinicId,doctorId,start,end,hq.id]);
    for(const serviceId of available)await db.query('INSERT INTO doctor_shift_services(shift_id,service_id)VALUES($1,$2)',[shift!.id,serviceId]);addedShifts++;
   }
  }
  await audit(db,hq.id,'demo.dataset.enriched',null,'development-demo-2026',{doctors:doctorIds.length,patients:patientIds.length,consultationServices:Object.keys(serviceIds).length,treatmentReferences:referenceInputs.length,addedShifts});
  return {fictional:true,doctors:doctorIds.length,patients:patientIds.length,clinics:clinicIds.length,consultationServices:Object.keys(serviceIds).length,treatmentReferences:referenceInputs.length,referencesAdded,addedShifts,keptExistingShifts,referenceYear:2026,sourceLabel};
 });
}
