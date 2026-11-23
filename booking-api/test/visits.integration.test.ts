import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { migrate, one, poolFor, transaction } from '../src/db.js';
import { seed } from '../src/seed.js';

test('staff check-in, actual doctor, itemized bill, offline receipts and headquarters totals', async () => {
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
    const [hq, front, doctor, patient] = await Promise.all([
      signIn('hq'), signIn('front.a'), signIn('doctor.a'), signIn('patient.a', 'patient'),
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
    assert.equal((await call('PUT', path + '/treatments', doctor, { items })).status, 'completed');
    await call('PUT', path + '/treatments', doctor, { items }, 200);
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
  } finally {
    await app?.close();
    await pool.end();
  }
});
