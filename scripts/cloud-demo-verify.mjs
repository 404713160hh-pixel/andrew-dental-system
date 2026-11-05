import assert from 'node:assert/strict';

// Read-only business verification against the existing isolated Compose API.
// Authentication creates short-lived sessions, all revoked in the finally block.
assert.equal(process.env.ANDREW_DEMO_VERIFY, '1', 'Explicit demo verification opt-in required');
const database = new URL(process.env.DATABASE_URL);
assert.equal(database.hostname, 'postgres');
assert.equal(database.pathname, '/andrew_booking_preview');
const password = process.env.SEED_PASSWORD;
assert.ok(password?.length >= 12, 'Synthetic seed password is required');
const root = 'http://api:3310/api/v1', sessions = [];
async function request(path, token, method='GET', body) {
  const response = await fetch(root+path, {method, headers:{...(token?{authorization:'Bearer '+token}:{}),...(body?{'content-type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{}), signal:AbortSignal.timeout(15000)});
  const payload=await response.json();
  assert.ok(response.ok, `${method} ${path}: HTTP ${response.status} ${payload.error?.code || ''}`);
  return payload.data;
}
async function login(username,portal) {
  const result=await request('/auth/login',null,'POST',{username,password,portal});
  sessions.push(result.token);return result.token;
}
try {
  const hq=await login('hq','staff'), front=await login('front.a','staff');
  const patients=await request('/staff/patients?pageSize=100',hq);
  assert.ok(patients.items.filter(item=>item.isDemo).length>=8);
  const staffAppointments=await request('/appointments?pageSize=100',hq);
  const patientChecks=[];
  for(const username of ['patient.a','patient.b']) {
    const token=await login(username,'patient');
    const chart=await request('/patients/me',token);assert.equal(chart.isDemo,true);
    const list=await request('/appointments?pageSize=100',token);
    assert.ok(list.items.length>0,username+' has no demonstration appointments');
    assert.ok(list.items.every(item=>item.patientId===chart.id),'Patient received another chart');
    assert.ok(list.items.some(item=>item.status==='confirmed'&&Date.parse(item.startsAt)>Date.now()),username+' has no upcoming appointment');
    for(const appointment of list.items) {
      const same=staffAppointments.items.find(item=>item.id===appointment.id);
      assert.ok(same,'Staff view cannot see the same appointment');assert.equal(same.status,appointment.status);
    }
    patientChecks.push({username,fictional:true,ownChartOnly:true,appointments:list.items.length,upcoming:list.items.filter(item=>item.status==='confirmed'&&Date.parse(item.startsAt)>Date.now()).length});
    if(username==='patient.a') {
      const search=await request('/staff/patients?q='+encodeURIComponent(chart.name),front);
      assert.ok(search.items.some(item=>item.id===chart.id),'Front desk cannot find its authorized fictional chart');
    }
  }
  const clinics=await request('/clinics'), services=await request('/services');
  const service=services.find(item=>item.name==='初诊检查');assert.ok(service);
  const slotChecks=[];
  for(const clinic of clinics) {
    let found;
    for(let offset=0;offset<7&&!found;offset++) {
      const date=new Date(Date.now()+8*3600000+offset*86400000).toISOString().slice(0,10);
      const slots=await request('/booking-slots?'+new URLSearchParams({clinicId:clinic.id,serviceId:service.id,date}));
      if(slots.length)found={clinic:clinic.name,date,available:slots.length};
    }
    assert.ok(found,'No recent slots at '+clinic.name);slotChecks.push(found);
  }
  console.log(JSON.stringify({status:'passed',fictionalPatients:patients.items.filter(item=>item.isDemo).length,staffAppointments:staffAppointments.total,
    statuses:[...new Set(staffAppointments.items.map(item=>item.status))],patients:patientChecks,clinics:slotChecks,frontDeskChartSearch:true}));
} finally {
  for(const token of sessions)try{await request('/auth/logout',token,'POST',{});}catch{/* No session token is printed. */}
}
