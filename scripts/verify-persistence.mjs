import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {config} from 'dotenv';
import pg from 'pg';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');config({path:resolve(root,'.env.booking'),quiet:true});
const base='http://127.0.0.1:3310/api/v1';const out=resolve(root,'docs/implementation/qa');mkdirSync(out,{recursive:true});
const stateFile=resolve(root,'.booking-data/persistence-before.json');
async function api(path,method='GET',body,token,key){
 const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const json=await r.json();assert.ok(r.ok,JSON.stringify(json));return json.data;
}
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
async function snapshot(){
 return (await pool.query(`SELECT pg_postmaster_start_time() AS started_at,
 (SELECT count(*)::int FROM patients) AS patients,
 (SELECT count(*)::int FROM appointments) AS appointments,
 (SELECT md5(coalesce(string_agg(a.id::text||a.status||a.row_version::text||r.starts_at::text,',' ORDER BY a.id),'')) FROM appointments a JOIN resource_reservations r ON r.id=a.reservation_id) AS appointment_hash`)).rows[0];
}
try {
 if(process.argv[2]==='before'){
  const staff=await api('/auth/demo','POST',{username:'hq',portal:'staff'});
  const patient=await api('/auth/demo','POST',{username:'patient.a',portal:'patient'});
  const shifts=(await api('/shifts','GET',undefined,staff.token)).filter(x=>x.status==='published'&&Date.parse(x.startsAt)>Date.now()).sort((a,b)=>a.startsAt.localeCompare(b.startsAt));
  let slot;
  for(const shift of shifts){const date=new Date(Date.parse(shift.startsAt)+8*3600000).toISOString().slice(0,10);const found=await api('/booking-slots?'+new URLSearchParams({clinicId:shift.clinicId,serviceId:shift.serviceIds[0],date}),'GET',undefined,patient.token);if(found.length){slot=found[0];break;}}
  assert.ok(slot,'Need available synthetic seed slot');
  const selection=Object.fromEntries(['clinicId','serviceId','doctorId','chairId','shiftId','startsAt'].map(k=>[k,slot[k]]));
  const hold=await api('/booking-holds','POST',selection,patient.token);
  const appointment=await api('/appointments/confirm','POST',{holdId:hold.id,holdVersion:hold.rowVersion,patientConfirmed:true,rulesAccepted:true},patient.token,randomUUID());
  const state={recordedAt:new Date().toISOString(),snapshot:await snapshot(),appointmentId:appointment.id,appointmentNo:appointment.appointmentNo};
  writeFileSync(stateFile,JSON.stringify(state,null,2));console.log(JSON.stringify({saved:true,appointmentId:appointment.id,patients:state.snapshot.patients,appointments:state.snapshot.appointments}));
 }else if(process.argv[2]==='after'){
  const before=JSON.parse(readFileSync(stateFile,'utf8'));const current=await snapshot();
  assert.notEqual(new Date(before.snapshot.started_at).getTime(),new Date(current.started_at).getTime(),'PostgreSQL postmaster must actually restart');
  for(const key of ['patients','appointments','appointment_hash'])assert.equal(before.snapshot[key],current[key],key+' must survive restart');
  const patient=await api('/auth/demo','POST',{username:'patient.a',portal:'patient'});
  const appointment=await api('/appointments/'+before.appointmentId,'GET',undefined,patient.token);
  assert.equal(appointment.appointmentNo,before.appointmentNo);assert.equal(appointment.status,'confirmed');
  await api('/appointments/'+appointment.id+'/changes','POST',{intent:'cancel',expectedVersion:appointment.rowVersion,reason:'数据库与API重启验证完成，释放合成预约'},patient.token,randomUUID());
  const report={status:'passed',verifiedAt:new Date().toISOString(),postgresBefore:before.snapshot.started_at,postgresAfter:current.started_at,patients:current.patients,appointments:current.appointments,appointmentId:appointment.id,dataHashMatched:true,apiAfterRestartReadSameAppointment:true,syntheticAppointmentCancelled:true};
  writeFileSync(resolve(out,'persistence.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 }else throw new Error('Run before, restart actual PostgreSQL and API, then run after');
}finally{await pool.end();}
