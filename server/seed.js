import { hashPassword, quarterOf } from './db.js';

export function seedDatabase(db) {
  const put=(table,obj)=>db.put(table,{...obj,version:1});
  const now=Date.now();
  const date=(offsetHours)=>new Date(now+offsetHours*3600000).toISOString();
  const quarter=quarterOf(now);
  put('settings',{id:'global',cancellationHours:24,fundRate:0.1});
  for(const [id,name,address,area] of [['C001','安德鲁·湘江门诊','长沙市岳麓区示范路 18 号（模拟）',420],['C002','安德鲁·芙蓉门诊','长沙市芙蓉区示范路 28 号（模拟）',360]]) {
    put('clinics',{id,name,address,supervisor:id==='C001'?'李敏':'周平',phone:'0731-88880000',email:'clinic@example.test',area,active:true});
  }
  put('qualifications',{id:'Q001',name:'口腔执业医师',issuer:'模拟资格资料',description:'演示资格，非真实医疗资质',active:true});
  put('qualifications',{id:'Q002',name:'牙周诊疗培训',issuer:'模拟培训机构',description:'演示培训资格',active:true});
  for(const [id,employeeNo,name] of [['D001','ADC-001','王晓医生'],['D002','ADC-002','刘宁医生']]) {
    put('dentists',{id,employeeNo,name,dob:'1985-06-15',phone:'13800000001',email:'dentist@example.test',address:'演示联系地址',qualificationIds:id==='D001'?['Q001','Q002']:['Q001'],qualificationDetails:[{qualificationId:'Q001',certificateNo:`SIM-${id}`,verifiedAt:new Date(now).toISOString(),note:'模拟资格，仅供演示'}],active:true});
  }
  const patient=(id,name,phone)=>({id,name,dob:'1995-05-20',phone,email:'patient@example.test',address:'长沙市模拟地址',emergencyName:'陈家属',emergencyPhone:'13900000000',allergyStatus:'none',allergies:[],createdClinicId:'C001'});
  put('patients',patient('P001','陈晨','13800000000'));
  put('patients',{...patient('P002','张悦','13800000002'),createdClinicId:'C002',allergyStatus:'known',allergies:[{id:'AL-P002-1',name:'青霉素',reaction:'皮疹',note:'演示患者自述，临床仍需核对'}]});
  put('patients',patient('P003','李新','13800000003'));
  for(const row of [
    ['T001','口腔检查','次',8000],['T002','洁牙','次',20000],['T003','树脂充填','牙',30000],['T004','牙周治疗','单位',12000]
  ]) put('treatments',{id:row[0],name:row[1],unit:row[2],unitPrice:row[3],active:true});
  const schedule=(id,clinicId,dentistId,start,end)=>put('schedules',{id,clinicId,dentistId,start,end,capacity:1,active:true});
  // Relative date seeds are created once; subsequent starts preserve actual records.
  const pasts=[['S-PAST-1','C001','D001',-4,-3],['S-PAST-2','C001','D001',-50,-49],['S-PAST-3','C002','D002',-30,-29],['S-PAST-4','C001','D001',-8,-7],['S-PAST-5','C001','D001',-12,-11]];
  for(const [id,c,d,s,e] of pasts) schedule(id,c,d,date(s),date(e));
  const appointments=[
    ['A001','P001','S-PAST-1','booked'],['A002','P001','S-PAST-2','attended'],['A003','P002','S-PAST-3','attended'],['A004','P003','S-PAST-4','no_show'],['A005','P003','S-PAST-5','attended']
  ];
  for(const [id,patientId,scheduleId,status] of appointments) {
    const s=db.get('schedules',scheduleId);
    put('appointments',{id,patientId,scheduleId,clinicId:s.clinicId,dentistId:s.dentistId,start:s.start,end:s.end,problem:'演示：牙齿检查与清洁',specialNeeds:'无',status,attended:status==='attended',createdAt:date(-100)});
  }
  for(const [id,a,status,lines] of [
    ['V001','A002','completed',[{id:'L001',treatmentId:'T001',name:'口腔检查',quantity:1,unitPrice:8000},{id:'L002',treatmentId:'T002',name:'洁牙',quantity:1,unitPrice:20000}]],
    ['V002','A003','completed',[{id:'L003',treatmentId:'T003',name:'树脂充填',quantity:2,unitPrice:30000}]],
    ['V003','A005','open',[]]
  ]) {
    const ap=db.get('appointments',a);
    put('visits',{id,appointmentId:a,patientId:ap.patientId,clinicId:ap.clinicId,dentistId:ap.dentistId,problem:ap.problem,specialNeeds:ap.specialNeeds,notes:'演示就诊记录，非真实医疗数据',status,lines});
    if(status==='completed') {
      const settlementLines=lines.map(l=>({...l,subtotal:l.quantity*l.unitPrice}));
      put('settlements',{id:`INV-${id}`,number:`ADC-SIM-${id}`,visitId:id,patientId:ap.patientId,clinicId:ap.clinicId,dentistId:ap.dentistId,date:ap.end,lines:settlementLines,total:settlementLines.reduce((n,l)=>n+l.subtotal,0)});
    }
  }
  const localNow=new Date(now+8*3600000);
  const day=Date.UTC(localNow.getUTCFullYear(),localNow.getUTCMonth(),localNow.getUTCDate())-8*3600000;
  for(let d=1;d<=14;d++) for(const [clinicId,dentistId] of [['C001','D001'],['C002','D002']]) for(const hour of [9,10,14,15]) {
    const start=new Date(day+d*86400000+hour*3600000).toISOString();
    schedule(`S-${clinicId}-${d}-${hour}`,clinicId,dentistId,start,new Date(new Date(start).getTime()+3600000).toISOString());
  }
  // Existing future appointment makes the customer cancellation/rescheduling path discoverable.
  const next=db.get('schedules','S-C001-3-9');
  put('appointments',{id:'A006',patientId:'P001',scheduleId:next.id,clinicId:next.clinicId,dentistId:next.dentistId,start:next.start,end:next.end,problem:'演示预约：复诊',specialNeeds:'无',status:'booked',attended:false,createdAt:new Date(now).toISOString()});
  for(const [id,c,d,s,o] of [['COST001','C001','D001',5000,7000],['COST002','C002','D002',10000,12000]]) put('costs',{id,quarter,clinicId:c,dentistId:d,supplies:s,operations:o,evidence:'模拟成本凭据 SIM-2026（无真实医院数据）',note:'演示用品与运营费用，非财务事实',status:'reviewed',reviewedBy:'U004',reviewedAt:new Date(now).toISOString(),reviewHistory:[{at:new Date(now).toISOString(),userId:'U004',action:'模拟初始化审核',version:1}]});
  const users=[
    {id:'U001',username:'chen',name:'陈晨',role:'customer',patientId:'P001',clinicIds:[]},
    {id:'U002',username:'front',name:'前台·李敏',role:'front',clinicIds:['C001']},
    {id:'U003',username:'doctor',name:'王晓医生',role:'clinical',dentistId:'D001',clinicIds:[]},
    {id:'U004',username:'manager',name:'湘江门诊店长',role:'manager',clinicIds:['C001']},
    {id:'U005',username:'hq',name:'连锁总部管理员',role:'hq',clinicIds:[]}
  ];
  for(const user of users) db.sql.prepare('INSERT INTO users(id,username,password_hash,data) VALUES(?,?,?,?)').run(user.id,user.username,hashPassword('Dental2026!'),JSON.stringify(user));
  db.sql.prepare('INSERT INTO metadata(key,value) VALUES(?,?)').run('seedVersion','2');
  db.sql.prepare('INSERT INTO metadata(key,value) VALUES(?,?)').run('createdAt',new Date(now).toISOString());
}
