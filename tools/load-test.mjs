import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { createDatabase } from '../server/db.js';
import { start } from '../server/index.js';
const db=createDatabase(':memory:');
const count=1000,requests=100,concurrency=10;
db.transaction(()=>{
 const p=db.get('patients','P001'),a=db.get('appointments','A001');
 for(let i=0;i<count;i++){
  const id=`LOAD-${String(i).padStart(5,'0')}`;
  db.put('patients',{...p,id,name:`容量样例${i}`,phone:`139${String(i).padStart(8,'0')}`,allergies:[],allergyStatus:'none',version:1});
  db.put('appointments',{...a,id:`LOAD-APPT-${i}`,patientId:id,status:'cancelled',attended:false,version:1});
 }
});
const app=await start({db,port:0});
try {
 const base=`http://127.0.0.1:${app.address.port}`;
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'hq',password:'Dental2026!',portal:'hq'})});assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie').split(';')[0],times=[];let cursor=0;
 const started=performance.now();
 await Promise.all(Array.from({length:concurrency},async()=>{while(cursor<requests){const index=cursor++;const at=performance.now();const response=await fetch(`${base}/api/workspace?page=patients&limit=25&offset=${(index%20)*25}`,{headers:{Cookie:cookie}});assert.equal(response.status,200);const body=await response.json();assert.equal(body.patients.length,25);assert.ok(body.pagination.total>=count);times.push(performance.now()-at);}}));
 times.sort((a,b)=>a-b);
 console.log(JSON.stringify({ok:true,scope:'local synthetic read workload only',patientRows:count,appointmentRows:count,requests,concurrency,elapsedMs:Math.round(performance.now()-started),p50Ms:Math.round(times[Math.floor(times.length*.5)]),p95Ms:Math.round(times[Math.floor(times.length*.95)]),productionCapacityVerified:false}));
}finally{await app.close();db.close();}
