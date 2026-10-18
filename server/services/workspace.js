import { publicUser } from '../policies/permissions.js';
import { audit, fail, scoped, scopeFor, quarterInterval } from './shared.js';
const entities=['patients','clinics','dentists','qualifications','schedules','appointments','visits','treatments','settlements','costs','quarterReports'];
const pagesByRole={customer:['home','profile','booking','appointments','history','settlements'],front:['home','patients','booking','appointments','visits','settlements','resources','finance'],clinical:['home','visits','appointments','history'],manager:['home','booking','appointments','history','patients','visits','settlements','resources','performance','finance'],hq:['home','booking','appointments','history','patients','visits','settlements','resources','performance','audit','settings','accounts','finance']};
const safeDentist=(d,user)=>user.role==='hq'?d:{id:d.id,name:d.name,employeeNo:d.employeeNo,qualificationIds:d.qualificationIds,active:d.active,version:d.version};
const clinicWhere=(user,active=false)=>({...(['front','manager'].includes(user.role)?{id:{$in:user.clinicIds||[]}}:{}),...(active||user.role==='customer'?{active:true}:{})});
export function baseState(db,user){return {user:publicUser(user),now:new Date().toISOString(),...Object.fromEntries(entities.map(e=>[e,[]])),settings:db.get('settings','global'),audit:[],metrics:{}};}
export function metrics(db,user,quarter){
 const q=scopeFor(user,'appointments'),at=new Date().toISOString();
 const range=quarter?quarterInterval(quarter):null;
 const condition='end_at<=? AND ('+q.condition+')'+(range?' AND start_at>=? AND start_at<?':'');
 const params=[at,...q.params,...(range?range.map(value=>new Date(value).toISOString()):[])];
 const aggregate=`COUNT(*) AS elapsed,COALESCE(SUM(status='cancelled'),0) AS cancelled,COALESCE(SUM(status='no_show'),0) AS noShow,COALESCE(SUM(attended=1),0) AS attended,COALESCE(SUM(status='booked'),0) AS pending`;
 const normalize=r=>({...r,cancellationRate:r.elapsed?r.cancelled/r.elapsed:0,noShowRate:r.elapsed?r.noShow/r.elapsed:0});
 return {...normalize(db.sql.prepare('SELECT '+aggregate+' FROM appointments WHERE '+condition).get(...params)),denominator:'已到期预约次数（包括取消和改约原记录；不含未来预约）',window:quarter?quarter+'已到期记录':'全部已到期记录',byClinic:db.sql.prepare('SELECT clinic_id AS clinicId,'+aggregate+' FROM appointments WHERE '+condition+' GROUP BY clinic_id').all(...params).map(normalize)};
}
function decorate(db,state,user,quarter){
 const appointmentIds=[...new Set(state.visits.map(v=>v.appointmentId))],times=new Map(appointmentIds.length?db.sql.prepare('SELECT id,start_at,end_at FROM appointments WHERE id IN ('+appointmentIds.map(()=>'?')+')').all(...appointmentIds).map(a=>[a.id,a]):[]);
 for(const visit of state.visits){const row=times.get(visit.appointmentId);visit.appointmentStart=row?.start_at||null;visit.appointmentEnd=row?.end_at||null;}
 const ids=[...new Set(state.schedules.map(s=>s.id))];
 const counts=new Map(ids.length?db.sql.prepare(`SELECT schedule_id AS id,COUNT(*) AS count FROM appointments WHERE schedule_id IN (${ids.map(()=>'?')}) AND status IN ('booked','attended') GROUP BY schedule_id`).all(...ids).map(r=>[r.id,r.count]):[]);
 const active=new Set(ids.length?db.sql.prepare(`SELECT s.id FROM schedules s JOIN clinics c ON c.id=s.clinic_id JOIN dentists d ON d.id=s.dentist_id WHERE s.id IN (${ids.map(()=>'?')}) AND s.active=1 AND c.active=1 AND d.active=1 AND EXISTS(SELECT 1 FROM dentist_qualifications dq JOIN qualifications q ON q.id=dq.qualification_id WHERE dq.dentist_id=d.id AND q.active=1)`).all(...ids).map(r=>r.id):[]);
 state.schedules=state.schedules.map(s=>({...s,bookedCount:counts.get(s.id)||0,available:active.has(s.id)?Math.max(0,s.capacity-(counts.get(s.id)||0)):0}));
 state.dentists=state.dentists.map(d=>safeDentist(d,user));state.metrics=metrics(db,user,quarter);return state;
}
function recordRead(db,user,state){audit(db,user,'sensitive.read',state.page||'state',{purpose:'按当前账号授权范围读取工作台',patientCount:state.patients.length,visitCount:state.visits.length,patientIds:state.patients.map(p=>p.id),visitIds:state.visits.map(v=>v.id),settlementIds:state.settlements.map(s=>s.id)});}
export function getState(db,user){
 const state=baseState(db,user);state.patients=scoped(db,user,'patients','merged_into_id IS NULL AND COALESCE(active,1)=1');
 state.clinics=db.find('clinics',{where:clinicWhere(user)});state.dentists=db.find('dentists',{where:user.role==='customer'?{active:true}:{}});state.qualifications=db.find('qualifications');
 state.schedules=user.role==='customer'?db.query('schedules',"active=1 AND end_at>? AND EXISTS(SELECT 1 FROM clinics c WHERE c.id=schedules.clinic_id AND c.active=1) AND EXISTS(SELECT 1 FROM dentists d WHERE d.id=schedules.dentist_id AND d.active=1 AND EXISTS(SELECT 1 FROM dentist_qualifications dq JOIN qualifications q ON q.id=dq.qualification_id WHERE dq.dentist_id=d.id AND q.active=1))",[state.now]):scoped(db,user,'schedules');
 for(const table of ['appointments','visits','settlements'])state[table]=scoped(db,user,table);
 state.treatments=db.find('treatments');
 if(['manager','hq'].includes(user.role))state.costs=scoped(db,user,'costs');
 if(user.role==='hq'){state.quarterReports=db.find('quarterReports');state.audit=auditRows(db,500,0);}
 decorate(db,state,user);recordRead(db,user,state);return state;
}
function auditRows(db,limit,offset){return db.sql.prepare('SELECT * FROM audit ORDER BY at DESC,rowid DESC LIMIT ? OFFSET ?').all(limit,offset).map(r=>{const d=JSON.parse(r.detail);return {id:r.id,at:r.at,userId:r.user_id,userName:d.userName,type:r.type,targetId:r.target_id,detail:d};});}
function joinLookups(db,state,user){
 const sources=[...state.appointments,...state.visits,...state.settlements,...state.schedules,...state.costs,...state.patients];
 const specs={patients:['patientId'],clinics:['clinicId','createdClinicId'],dentists:['dentistId']};
 for(const [table,keys] of Object.entries(specs)){
  const ids=[...new Set(sources.flatMap(s=>keys.map(k=>s[k])).filter(Boolean))].filter(id=>!state[table].some(v=>v.id===id));
  if(ids.length){let rows=db.find(table,{where:{id:{$in:ids}}});if(table==='patients'){const allowed=scopeFor(user,'patients');rows=db.query('patients','id IN ('+ids.map(()=>'?')+') AND ('+allowed.condition+')',[...ids,...allowed.params]);}if(table==='clinics'&&['front','manager'].includes(user.role))rows=rows.filter(row=>user.clinicIds?.includes(row.id));state[table].push(...rows);}
 }
 const qids=[...new Set(state.dentists.flatMap(d=>d.qualificationIds||[]))];if(qids.length)state.qualifications=db.find('qualifications',{where:{id:{$in:qids}}});
 if(state.page==='visits')state.treatments=db.find('treatments',{where:{active:true},limit:100});
}
export function getWorkspace(db,user,options={}){
 const page=options.page||'home';if(!pagesByRole[user.role]?.includes(page))fail('无权读取该工作区',403,'FORBIDDEN');
 const limit=options.limit===undefined?25:Number(options.limit),offset=options.offset===undefined?0:Number(options.offset);
 if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0)fail('分页范围不正确');
 const state=baseState(db,user);state.page=page;state.pagination={entity:null,total:0,limit,offset};
 const reconciliationOffset=Number(options.reconciliationOffset||0),pendingOffset=Number(options.pendingOffset||0);
 if(!Number.isInteger(reconciliationOffset)||reconciliationOffset<0||!Number.isInteger(pendingOffset)||pendingOffset<0)fail('明细分页范围不正确');
 state.query={q:String(options.q||'').slice(0,100),accountRef:String(options.accountRef||'').slice(0,100),reconciliationOffset,pendingOffset};
 const load=(table,condition='1',params=[],orderBy,scope=true)=>{
  const q=scope?scopeFor(user,table):{condition:'1',params:[]};condition='('+condition+') AND ('+q.condition+')';params=[...params,...q.params];
  state[table]=db.query(table,condition,params,{limit,offset,orderBy});state.pagination={entity:table,total:db.countQuery(table,condition,params),limit,offset};return state[table];
 };
 const filters=table=>{
  const clauses=[],values=[];
  for(const [key,column]of [['clinicId','clinic_id'],['dentistId','dentist_id']])if(options[key]){clauses.push(column+'=?');values.push(String(options[key]));}
  if(options.status&&options.status!=='all'&&table==='appointments'){
   if(!['booked','cancelled','attended','no_show'].includes(options.status))fail('预约状态不正确');
   clauses.push('status=?');values.push(options.status);
  }
  const timeColumn=table==='settlements'?'date':'start_at';
  if(options.date){
   const start=Date.parse(`${options.date}T00:00:00+08:00`);
   if(!/^\d{4}-\d{2}-\d{2}$/.test(options.date)||!Number.isFinite(start)||new Date(start+8*3600000).toISOString().slice(0,10)!==options.date)fail('查询日期不正确');
   clauses.push(timeColumn+'>=?',timeColumn+'<?');values.push(new Date(start).toISOString(),new Date(start+86400000).toISOString());
  }
  if(options.from){if(!Number.isFinite(Date.parse(options.from)))fail('查询开始日期不正确');clauses.push(timeColumn+'>=?');values.push(new Date(options.from).toISOString());}
  if(options.to){if(!Number.isFinite(Date.parse(options.to)))fail('查询结束日期不正确');clauses.push(timeColumn+'<?');values.push(new Date(options.to).toISOString());}
  if(options.from&&options.to&&Date.parse(options.from)>=Date.parse(options.to))fail('查询开始时间必须早于结束时间');
  return [clauses.join(' AND ')||'1',values];
 };
 if(page==='home'){
  load('appointments',"end_at>=? AND status='booked'",[state.now],['start','asc']);
  state.visits=scoped(db,user,'visits',"status='open'",[],{limit:10});state.settlements=scoped(db,user,'settlements','1',[],{limit:10,orderBy:['date','desc']});
  const scopedCount=(table,condition='1',values=[])=>{const scope=scopeFor(user,table);return db.countQuery(table,'('+scope.condition+') AND ('+condition+')',[...scope.params,...values]);};
  const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10),start=Date.parse(`${today}T00:00:00+08:00`),end=start+86400000;
  state.stats={patients:scopedCount('patients','merged_into_id IS NULL AND COALESCE(active,1)=1'),appointments:scopedCount('appointments'),openVisits:scopedCount('visits',"status='open'"),todayAppointments:scopedCount('appointments','start_at>=? AND start_at<?',[new Date(start).toISOString(),new Date(end).toISOString()]),todayAttended:scopedCount('appointments','start_at>=? AND start_at<? AND attended=1',[new Date(start).toISOString(),new Date(end).toISOString()]),pendingSettlements:scopedCount('visits',"status='completed' AND NOT EXISTS(SELECT 1 FROM settlements s WHERE s.visit_id=visits.id)"),completedVisits:scopedCount('visits',"status='completed'"),settlementCount:scopedCount('settlements'),bookedAppointments:scopedCount('appointments',"status='booked' AND start_at>=?",[state.now])};
  const scope=scopeFor(user,'appointments'),days=db.sql.prepare("SELECT date(start_at,'+8 hours') AS date,COUNT(*) AS count FROM appointments WHERE start_at>=? AND start_at<? AND ("+scope.condition+") GROUP BY date(start_at,'+8 hours')").all(new Date(start-6*86400000).toISOString(),new Date(end).toISOString(),...scope.params);
  state.stats.last7Days=Array.from({length:7},(_,i)=>{const date=new Date(start-(6-i)*86400000+8*3600000).toISOString().slice(0,10);return{date,count:days.find(row=>row.date===date)?.count||0};});
  state.stats.todayBooked=scopedCount('appointments',"status='booked' AND start_at>=? AND start_at<?",[new Date(start).toISOString(),new Date(end).toISOString()]);
 }else if(page==='profile')load('patients','id=?',[user.patientId||''],undefined,true);
 else if(page==='patients'){const q=String(options.q||'').slice(0,100),extra=q?' AND (id LIKE ? OR name LIKE ? OR phone_normalized LIKE ?)':'';load('patients','merged_into_id IS NULL AND COALESCE(active,1)=1'+extra,q?['%'+q+'%','%'+q+'%','%'+q.replace(/[\s-]/g,'')+'%']:[],['name','asc']);}
 else if(page==='appointments'){const [c,p]=filters('appointments');load('appointments',c,p,['start','desc']);}
 else if(page==='booking'){
  const [c,p]=filters('schedules');load('schedules',"active=1 AND start_at>? AND "+c,[state.now,...p],['start','asc'],user.role!=='customer');
  state.clinics=db.find('clinics',{where:clinicWhere(user,true),limit:100});state.dentists=db.find('dentists',{where:{active:true},limit:100});
  state.patients=user.role==='customer'?db.find('patients',{where:{id:user.patientId}}):scoped(db,user,'patients','merged_into_id IS NULL AND COALESCE(active,1)=1'+(options.patientId?' AND id=?':''),options.patientId?[String(options.patientId)]:[],{limit:100});
  if(options.patientId&&user.role!=='customer'&&!state.patients.length)fail('无权访问该患者资料',403,'FORBIDDEN');
 }else if(page==='visits'||page==='history'){const cond=options.status?'status=?':'1';load('visits',cond,options.status?[String(options.status)]:[],['id','desc']);const ids=state.visits.map(v=>v.id);if(ids.length)state.settlements=scoped(db,user,'settlements','visit_id IN ('+ids.map(()=>'?')+')',ids);}
 else if(page==='settlements'||page==='finance'){
  const[c,p]=filters('settlements');load('settlements',c,p,['date','desc']);
  if(page==='settlements'&&['front','manager','hq'].includes(user.role)){
   const condition="status='completed' AND NOT EXISTS(SELECT 1 FROM settlements s WHERE s.visit_id=visits.id)",scope=scopeFor(user,'visits');
   state.visits=scoped(db,user,'visits',condition,[],{limit:25,offset:pendingOffset,orderBy:['id','desc']});
   state.pendingPagination={entity:'pendingVisits',total:db.countQuery('visits','('+scope.condition+') AND ('+condition+')',scope.params),limit:25,offset:pendingOffset};
  }
 }
 else if(page==='performance'){load('costs',options.quarter?'quarter=?':'1',options.quarter?[String(options.quarter)]:[],['quarter','desc']);if(user.role==='hq')state.quarterReports=db.find('quarterReports',{limit:25,orderBy:['createdAt','desc']});state.clinics=db.find('clinics',{where:clinicWhere(user),limit:100});state.dentists=db.find('dentists',{limit:100});}
 else if(page==='resources'){
  const table=options.resource||'schedules';if(!['clinics','dentists','qualifications','treatments','schedules'].includes(table)||user.role==='front'&&table!=='schedules')fail('无权读取该资源',403,'FORBIDDEN');
  if(table==='schedules'){const[c,p]=filters(table);load(table,c,p,['start','desc']);state.clinics=db.find('clinics',{where:clinicWhere(user),limit:100});state.dentists=db.find('dentists',{where:{active:true},limit:100});}
  else{const ids=user.clinicIds||[],condition=table==='clinics'&&user.role==='manager'?'id IN ('+(ids.map(()=>'?').join(',')||'NULL')+')':'1';load(table,condition,condition==='1'?[]:ids,['name','asc'],false);if(table==='dentists')state.qualifications=db.find('qualifications',{limit:100});}
 }else if(page==='audit'){state.audit=auditRows(db,limit,offset);state.pagination={entity:'audit',total:db.sql.prepare('SELECT COUNT(*) AS n FROM audit').get().n,limit,offset};}
 // Account rows are populated by the account service after workspace scoping.
 if(['appointments','settlements','finance','visits','history'].includes(page)){
  state.clinics=db.find('clinics',{where:clinicWhere(user),limit:100});
  state.dentists=db.find('dentists',{where:user.role==='clinical'?{id:user.dentistId}:{active:true},limit:100});
 }
 joinLookups(db,state,user);decorate(db,state,user,page==='performance'?options.quarter:undefined);recordRead(db,user,state);return state;
}
