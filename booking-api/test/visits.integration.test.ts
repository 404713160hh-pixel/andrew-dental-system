import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { migrate, one, poolFor, transaction } from '../src/db.js';
import { seed } from '../src/seed.js';
import { allocateExpenses } from '../src/visit-profit.js';

test('expense allocation reconciles the last cent, and uses visit counts when there is no revenue', () => {
  const a = {doctorId:'a',revenueCents:100,visits:1};
  const b = {doctorId:'b',revenueCents:200,visits:2};
  const c = {doctorId:'c',revenueCents:0,visits:3};
  assert.deepEqual(Object.fromEntries(allocateExpenses(100,[c,b,a]).allocations),{a:33,b:67,c:0});
  assert.deepEqual(Object.fromEntries(allocateExpenses(100,[a,b,c].map(row=>({...row,revenueCents:0}))).allocations),{a:17,b:33,c:50});
  assert.equal(allocateExpenses(100,[]).unallocatedCents,100);
});
test('staff visit, costs, monthly close, quarterly incentive and headquarters permissions', async () => {
  const url = process.env.VISITS_TEST_DATABASE_URL;
  assert.ok(url, 'Set VISITS_TEST_DATABASE_URL to an empty disposable PostgreSQL database');
  const database = new URL(url);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(database.hostname), 'Use a local test database');
  const pool = poolFor(url);
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url, CANCELLATION_NOTICE_MINUTES: 0 });
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  const password = 'Local visit test only 3281';
  try {
    const existing = await one(pool, "SELECT 1 FROM information_schema.tables WHERE table_schema='public' LIMIT 1");
    assert.equal(existing, undefined, 'Test database must be empty');
    await migrate(pool);
    await seed(pool, password);
    await pool.query(`INSERT INTO staff(user_id,employee_no,name,phone,is_dentist,is_demo)
      SELECT id,'TEST-'||username,display_name,'00000001000',false,true FROM users WHERE username IN ('hq','manager.a')`);
    app = await createApp(config, pool);
    async function call(method: 'GET' | 'POST' | 'PUT', url: string, token?: string, payload?: object, status = 200, key?: string) {
      const reply = await app!.inject({ method, url: '/api/v1' + url, payload, headers: {
        ...(token ? { authorization: 'Bearer ' + token } : {}),
        ...(key ? { 'idempotency-key': key } : {}),
      } });
      assert.equal(reply.statusCode, status, method + ' ' + url + ' ' + reply.body);
      return reply.json().data;
    }
    const signIn = async (username: string, portal = 'staff') => (await call('POST', '/auth/login', undefined, { username, portal, password })).token as string;
    const [hq, front, doctor, patient, manager] = await Promise.all([
      signIn('hq'), signIn('front.a'), signIn('doctor.a'), signIn('patient.a', 'patient'), signIn('manager.a'),
    ]);
    const staff = (await pool.query<{ id: string; employee_no: string }>("SELECT id,employee_no FROM staff WHERE employee_no IN ('D001','D002') ORDER BY employee_no")).rows;
    const actual = staff[0]!.id;
    const booked = staff[1]!.id;
    const clinic = (await one<{ record_id: string }>(pool, "SELECT record_id FROM demo_seed_records WHERE record_key='seed:clinic:a'"))!.record_id;
    const other = (await one<{ record_id: string }>(pool, "SELECT record_id FROM demo_seed_records WHERE record_key='seed:clinic:b'"))!.record_id;
    const chair = (await one<{ id: string }>(pool, 'SELECT id FROM chairs WHERE clinic_id=$1 LIMIT 1', [clinic]))!.id;
    const patientId = (await one<{ record_id: string }>(pool, "SELECT record_id FROM demo_seed_records WHERE record_key='seed:patient:a'"))!.record_id;
    const services = (await pool.query<{ id: string }>('SELECT id FROM services ORDER BY price_cents DESC')).rows;
    const serviceId = services[0]!.id;
    const otherService = services[1]!.id;
    const actor = (await one<{ id: string }>(pool, "SELECT id FROM users WHERE username='hq'"))!.id;
    const from = Date.now();
    const at = (minutes: number) => new Date(from + minutes * 60000).toISOString();
    const day = new Date(from + 8 * 3600000).toISOString().slice(0, 10);
    const shift = (await one<{ id: string }>(pool, 'INSERT INTO doctor_shifts(clinic_id,doctor_id,starts_at,ends_at,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [clinic, booked, at(-180), at(140), actor]))!.id;
    await pool.query('INSERT INTO doctor_shift_services VALUES($1,$2)', [shift, serviceId]);

    const fixture = (start: number) => transaction(pool, async db => {
      const reservation = (await one<{ id: string }>(db, `INSERT INTO resource_reservations
        (patient_id,clinic_id,service_id,doctor_id,chair_id,shift_id,starts_at,ends_at,occupied_until,status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'booked') RETURNING id`,
      [patientId, clinic, serviceId, booked, chair, shift, at(start), at(start + 30), at(start + 40)]))!.id;
      const hold = (await one<{ id: string }>(db, `INSERT INTO booking_holds(reservation_id,created_by,expires_at,consumed_at)
        VALUES($1,$2,now(),now()) RETURNING id`, [reservation, actor]))!.id;
      return (await one<{ id: string }>(db, `INSERT INTO appointments
        (appointment_no,patient_id,reservation_id,hold_id,service_name,price_cents,created_by)
        VALUES($1,$2,$3,$4,'初诊检查',6000,$5) RETURNING id`, ['TEST-' + randomUUID(), patientId, reservation, hold, actor]))!.id;
    });
    const missedId = await fixture(-120);
    const id = await fixture(40);
    const path = '/staff/visits/' + id;
    await call('GET', path, undefined, undefined, 401);
    await call('GET', path, patient, undefined, 403);
    await call('GET', path, doctor, undefined, 403);
    await call('PUT', path + '/attendance', front, { status: 'no_show' }, 409);
    assert.equal((await call('PUT', '/staff/visits/' + missedId + '/attendance', front, { status: 'no_show' })).status, 'no_show');
    await call('POST', path + '/invoice', front, undefined, 409);
    await call('PUT', path + '/attendance', front, { status: 'arrived', doctorId: booked }, 400);
    assert.ok((await call('GET', path + '/eligible-doctors', front)).some((row: { id: string }) => row.id === actual));
    assert.equal((await call('PUT', path + '/attendance', front, { status: 'arrived', doctorId: actual })).doctorId, actual);
    await call('POST', '/appointments/' + id + '/changes', front, { intent: 'cancel', expectedVersion: 1, reason: '测试取消' }, 409, randomUUID());
    const queue = await call('GET', '/staff/visits?date=' + day, doctor);
    assert.ok(queue.some((v: { appointmentId: string }) => v.appointmentId === id));
    const items = [{ serviceId, quantity: 1, unitPriceCents: 5000 }, { serviceId: otherService, quantity: 2, unitPriceCents: 1000 }];
    await call('PUT', path + '/treatments', front, { items }, 403);
    await call('PUT', path + '/treatments', doctor, { items: [items[0], { ...items[1], serviceId: randomUUID() }] }, 400);
    assert.equal((await call('GET', path, doctor)).treatments.length, 0, 'Invalid second line must roll back the first');
    const materials = [{ name:'测试耗材', unit:'克', quantityMilli:1250, unitCostCents:501 }];
    const treatment = await call('PUT', path + '/treatments', doctor, { items, materials });
    assert.equal(treatment.status, 'completed');
    assert.equal(treatment.materials[0].costCents,626);
    assert.equal(treatment.materialsRecorded,true);
    await call('PUT', path + '/treatments', doctor, { items, materials }, 200);
    await call('PUT', path + '/materials', doctor, { materials }, 200);
    await call('PUT', path + '/materials', doctor, { materials:[] }, 409);
    await call('PUT', path + '/attendance', front, { status: 'arrived', doctorId: actual }, 409);
    const issued = await call('POST', path + '/invoice', front);
    assert.equal(issued.invoice.totalCents, 7000);
    assert.equal((await call('POST', path + '/invoice', front)).invoice.id, issued.invoice.id);
    assert.equal((await call('GET', path, doctor)).invoice, null);

    const cash = { amountCents: 3000, method: 'cash', reference: '', commandKey: randomUUID() };
    const first = await Promise.all([call('POST', path + '/payments', front, cash), call('POST', path + '/payments', front, cash)]);
    assert.ok(first.every(x => x.invoice.payments.length === 1));
    await call('POST', path + '/payments', front, { ...cash, amountCents: 2000 }, 409);
    await call('POST', path + '/payments', front, { ...cash, amountCents: 4001, commandKey: randomUUID() }, 409);
    await call('POST', path + '/payments', front, { ...cash, method: 'wechat', commandKey: randomUUID() }, 400);
    const settled = await call('POST', path + '/payments', front, { amountCents: 4000, method: 'wechat', reference: 'test-receipt', commandKey: randomUUID() });
    assert.deepEqual(settled.invoice.payments.map((p: { amountCents: number }) => p.amountCents), [3000, 4000]);
    const report = '/staff/visit-report?from=' + day + '&to=' + day;
    await call('GET', report, front, undefined, 403);
    const summary = await call('GET', report, hq);
    assert.equal(summary.length, 1);
    assert.deepEqual([summary[0].clinicId, summary[0].doctorId, summary[0].completed, summary[0].billedCents, summary[0].collectedCents],
      [clinic, actual, 1, 7000, 7000]);
    assert.deepEqual(await call('GET', report + '&clinicId=' + other, hq), []);
    assert.deepEqual(await call('GET', report + '&doctorId=' + booked, hq), []);

    const today = new Date(day+'T00:00:00Z');
    const quarterStart = new Date(Date.UTC(today.getUTCFullYear(),Math.floor(today.getUTCMonth()/3)*3-3,1));
    const quarter = quarterStart.getUTCFullYear()+'-Q'+(Math.floor(quarterStart.getUTCMonth()/3)+1);
    const period = Array.from({length:3},(_,i)=>new Date(Date.UTC(quarterStart.getUTCFullYear(),quarterStart.getUTCMonth()+i,1)).toISOString().slice(0,7));
    await pool.query('UPDATE visits SET arrived_at=$2,completed_at=$2 WHERE appointment_id=$1',[id,period[0]+'-12T10:00:00+08:00']);
    const expenses = (clinicId:string,month:string) => '/compensation/operating-expenses?clinicId='+clinicId+'&month='+month;
    const expense = [{ label:'测试水电',amountCents:1001,reference:'TEST-BILL-1' }];
    await call('PUT',expenses(other,period[0]!),manager,{items:[],expectedVersion:0},403);
    await call('PUT',expenses(clinic,period[0]!),front,{items:[],expectedVersion:0},403);
    await call('PUT',expenses(clinic,period[0]!),manager,{items:expense,expectedVersion:0});
    await call('PUT',expenses(clinic,period[0]!),manager,{items:expense,expectedVersion:0},409);
    const auto = '/compensation/visit-profit?quarter='+quarter;
    const calculated = await call('GET',auto,hq);
    assert.deepEqual([calculated.revenueCents,calculated.materialCostCents,calculated.expenseCents,calculated.netProfitCents,calculated.fundCents],
      [7000,626,1001,5373,537]);
    assert.equal(calculated.doctors[0].estimatedAwardCents,537);
    const local = await call('GET',auto,manager);
    assert.equal(local.fundCents,0);
    await call('GET',auto,doctor,undefined,403);

    const input = {clinicId:clinic,month:period[0]};
    const initial = await call('POST','/compensation/months/from-visits',manager,input);
    assert.equal(initial.rows[0].materialCostCents,626);
    await call('PUT',expenses(clinic,period[0]!),manager,{items:[{...expense[0],amountCents:1101}],expectedVersion:1});
    const close = (sheet: { id:string; rowVersion:number },token:string,status=200) =>
      call('POST','/compensation/months/'+sheet.id+'/close',token,{expectedVersion:sheet.rowVersion},status);
    await close(initial,hq,409);
    const updated = await call('POST','/compensation/months/from-visits',manager,input);
    await close(updated,hq);
    await call('PUT',expenses(clinic,period[0]!),manager,{items:expense,expectedVersion:2},409);
    for (const clinicId of [clinic,other]) for (const month of period) {
      if (clinicId===clinic && month===period[0]) continue;
      await call('PUT',expenses(clinicId,month),hq,{items:[],expectedVersion:0});
    }
    const maker=(await one<{ id:string; password_hash:string }>(pool,"SELECT id,password_hash FROM users WHERE username='hq'"))!;
    const reviewer=(await one<{ id:string }>(pool,`INSERT INTO users(username,password_hash,display_name)
      VALUES('test.reviewer',$1,'测试复核人') RETURNING id`,[maker.password_hash]))!.id;
    await pool.query("INSERT INTO role_assignments(user_id,role) VALUES($1,'hq')",[reviewer]);
    await pool.query("INSERT INTO staff(user_id,employee_no,name,phone,is_dentist) VALUES($1,'TEST-REVIEWER','测试复核人','00000001000',false)",[reviewer]);
    const reviewerToken=await signIn('test.reviewer');
    for (const clinicId of [clinic,other]) for (const month of period) {
      if (clinicId===clinic && month===period[0]) continue;
      const sheet = await call('POST','/compensation/months/from-visits',hq,{clinicId,month});
      await close(sheet,reviewerToken);
    }
    const quarterResult=await call('POST','/compensation/quarters',hq,{quarter,reference:'测试自动汇总'});
    assert.deepEqual([quarterResult.netProfitCents,quarterResult.fundCents],[5273,527]);
    const submitted=await call('POST','/compensation/quarters/'+quarterResult.id+'/submit',hq,{expectedVersion:quarterResult.rowVersion});
    const approved=await call('POST','/compensation/quarters/'+quarterResult.id+'/approve',reviewerToken,{expectedVersion:submitted.rowVersion});
    assert.equal(approved.status,'approved');
    const mine=await call('GET','/compensation/me',doctor);
    assert.equal(mine.allocations[0].amountCents,527);

  } finally {
    await app?.close();
    await pool.end();
  }
});
