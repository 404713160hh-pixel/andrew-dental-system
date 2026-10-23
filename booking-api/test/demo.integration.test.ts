import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import type { FastifyInstance, HTTPMethods, LightMyRequestResponse } from 'fastify';
import type { Appointment, BookingSlot, Doctor, Hold, LoginResult, Patient, PatientInput, Service, Shift, TreatmentReference } from '../../shared/src/index.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { migrate, poolFor } from '../src/db.js';
import { seed } from '../src/seed.js';
import { enrichDemoData } from '../src/demo.js';

// Every mutation in this file is confined to a database this fixture created.
const databaseName = 'andrew_test_' + randomBytes(10).toString('hex');
const password = 'Demo-test-' + randomBytes(18).toString('base64url');
const sourceLabel = '用户提供的价格资料（未独立核验）';
let admin: Pool | undefined, db: Pool, app: FastifyInstance, targetUrl: string;
let created = false;
const identities: Record<string, LoginResult> = {};
let ordinaryPatientId: string, ordinaryDoctorId: string, ordinaryServiceId: string;
let ordinaryBefore: unknown, appointmentBefore: unknown;
let firstResult: Awaited<ReturnType<typeof enrichDemoData>>;

async function request(method: HTTPMethods, path: string, who?: string, payload?: object, key?: string): Promise<LightMyRequestResponse> {
  return app.inject({ method, url: '/api/v1' + path, headers: {
    ...(who ? { authorization: 'Bearer ' + identities[who]!.token } : {}),
    ...(key ? { 'idempotency-key': key } : {}),
  }, ...(payload === undefined ? {} : { payload }) });
}
function data<T>(response: LightMyRequestResponse): T {
  assert.ok([200, 201].includes(response.statusCode), response.statusCode + ': ' + response.body);
  assert.ok(response.json().requestId); return response.json().data as T;
}
async function ordinarySnapshot() {
  return {
    patient: (await db.query('SELECT to_jsonb(p) AS row FROM patients p WHERE id=$1', [ordinaryPatientId])).rows[0].row,
    doctor: (await db.query('SELECT to_jsonb(s) AS row FROM staff s WHERE id=$1', [ordinaryDoctorId])).rows[0].row,
    service: (await db.query('SELECT to_jsonb(s) AS row FROM services s WHERE id=$1', [ordinaryServiceId])).rows[0].row,
  };
}
async function appointmentSnapshot() {
  const result: Record<string, unknown> = {};
  for (const table of ['appointments', 'resource_reservations', 'booking_holds', 'appointment_events']) {
    result[table] = (await db.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) AS rows FROM ${table} t`)).rows[0].rows;
  }
  return result;
}
async function counts() {
  const result: Record<string, number> = {};
  for (const table of ['users', 'staff', 'patients', 'services', 'qualifications', 'dentist_qualifications', 'doctor_shifts', 'doctor_shift_services', 'demo_seed_records', 'treatment_references', 'appointments']) {
    result[table] = Number((await db.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
  }
  return result;
}
async function withLegacySeed(work: (legacy: Pool) => Promise<void>) {
  assert.ok(admin);
  const name = 'andrew_test_' + randomBytes(10).toString('hex'); assert.match(name, /^andrew_test_[0-9a-f]{20}$/);
  const url = new URL(targetUrl); url.pathname = '/' + name;
  let made = false, legacy: Pool | undefined;
  try {
    await admin.query(`CREATE DATABASE "${name}"`); made = true; legacy = poolFor(url.toString());
    await migrate(legacy); await seed(legacy, password);
    // Mimic the pre-003 seed: same real relational records, no provenance registry.
    await legacy.query('DELETE FROM demo_seed_records'); await work(legacy);
  } finally {
    if (legacy) await legacy.end();
    if (made) { assert.match(name, /^andrew_test_[0-9a-f]{20}$/); await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [name]); await admin.query(`DROP DATABASE "${name}"`); }
  }
}
async function legacyFingerprint(legacy: Pool) {
  const result: Record<string, unknown> = {};
  for (const table of ['users', 'patients', 'staff', 'clinics', 'services', 'doctor_shifts', 'appointments', 'demo_seed_records', 'treatment_references']) {
    result[table] = (await legacy.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM ${table} t`)).rows[0].rows;
  }
  return result;
}
function inputOf(patient: Patient): PatientInput {
  return { name: patient.name, birthDate: patient.birthDate, phone: patient.phone, email: patient.email,
    billingAddress: patient.billingAddress, emergencyName: patient.emergencyName, emergencyPhone: patient.emergencyPhone,
    allergyStatus: patient.allergyStatus, allergies: patient.allergies };
}

before(async () => {
  assert.match(databaseName, /^andrew_test_[0-9a-f]{20}$/);
  const base = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  assert.ok(base, 'Real local PostgreSQL is required. Set TEST_DATABASE_URL or DATABASE_URL; there is no mock fallback.');
  const adminUrl = new URL(base); adminUrl.pathname = '/postgres'; admin = poolFor(adminUrl.toString());
  await admin.query(`CREATE DATABASE "${databaseName}"`); created = true;
  const url = new URL(base); url.pathname = '/' + databaseName; targetUrl = url.toString(); db = poolFor(targetUrl);
  await migrate(db); await seed(db, password);
  app = await createApp(loadConfig({ NODE_ENV: 'test', DATABASE_URL: targetUrl, ALLOW_DEMO_LOGIN: 'false' }), db, false); await app.ready();
  for (const username of ['hq', 'patient.a', 'patient.b']) identities[username] = data<LoginResult>(await request('POST', '/auth/login', undefined, { username, password, portal: username === 'hq' ? 'staff' : 'patient' }));

  // Ordinary same-name/contact records must never be adopted as synthetic data.
  const ordinary = data<LoginResult>(await request('POST', '/auth/register', undefined, { username: 'ordinary.' + randomBytes(5).toString('hex'), password,
    profile: { name: '林晓（虚构患者）', birthDate: '2002-03-16', phone: '00000001001', email: 'ordinary@example.invalid', billingAddress: '普通测试记录，不得被演示脚本修改', emergencyName: '普通联系人', emergencyPhone: '00000001999', allergyStatus: 'none_reported', allergies: [] } }));
  ordinaryPatientId = ordinary.user.patientId!;
  ordinaryDoctorId = (await db.query("INSERT INTO staff(employee_no,name,phone,specialty)VALUES($1,'陈知远（虚构医生）','00000002001','普通档案，禁止认领')RETURNING id", ['ORDINARY-' + randomBytes(5).toString('hex')])).rows[0].id;
  ordinaryServiceId = (await db.query("INSERT INTO services(name,description,duration_minutes,buffer_minutes,price_cents)VALUES('儿童口腔咨询（演示）','普通项目，不属于演示脚本',25,5,12345)RETURNING id")).rows[0].id;
  ordinaryBefore = await ordinarySnapshot();

  // A real already-confirmed appointment exists before enrichment.
  const shifts = data<Shift[]>(await request('GET', '/shifts', 'hq'));
  const initial = data<Service[]>(await request('GET', '/services')).find(service => service.name === '初诊检查')!;
  const shift = shifts.find(item => item.serviceIds.includes(initial.id))!;
  const date = new Date(Date.parse(shift.startsAt) + 8 * 3600000).toISOString().slice(0, 10);
  const slot = data<BookingSlot[]>(await request('GET', '/booking-slots?' + new URLSearchParams({ clinicId: shift.clinicId, serviceId: initial.id, doctorId: shift.doctorId, date })))[0]!;
  assert.ok(slot);
  const hold = data<Hold>(await request('POST', '/booking-holds', 'patient.a', { clinicId: slot.clinicId, serviceId: slot.serviceId, doctorId: slot.doctorId, chairId: slot.chairId, shiftId: slot.shiftId, startsAt: slot.startsAt }));
  const appointment = data<Appointment>(await request('POST', '/appointments/confirm', 'patient.a', { holdId: hold.id, holdVersion: hold.rowVersion, patientConfirmed: true, rulesAccepted: true }, randomUUID()));
  assert.equal(appointment.status, 'confirmed'); appointmentBefore = await appointmentSnapshot();
}, { timeout: 120_000 });

after(async () => {
  if (app) await app.close(); if (db) await db.end();
  if (admin) try {
    if (created) { assert.match(databaseName, /^andrew_test_[0-9a-f]{20}$/); await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [databaseName]); await admin.query(`DROP DATABASE "${databaseName}"`); }
  } finally { await admin.end(); }
});

test('demo migration creates schema only and production command cannot populate or mutate it', async () => {
  assert.equal((await db.query('SELECT current_database() AS name')).rows[0].name, databaseName);
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM treatment_references')).rows[0].n), 0);
  const before = await counts();
  await assert.rejects(enrichDemoData(db, 'production'), /disabled in production/i);
  const cli = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'demo'], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 30000,
    env: { ...process.env, NODE_ENV: 'production', ALLOW_DEMO_LOGIN: 'false', DATABASE_URL: targetUrl } });
  assert.notEqual(cli.status, 0); assert.match(cli.stderr + cli.stdout, /production|disabled/i);
  assert.deepEqual(await counts(), before);
});

test('development enrichment creates six fictional doctors and eight fictional patients without adopting ordinary names', async () => {
  firstResult = await enrichDemoData(db, 'test');
  assert.equal(firstResult.fictional, true); assert.equal(firstResult.doctors, 6); assert.equal(firstResult.patients, 8);
  assert.equal(firstResult.consultationServices, 6); assert.equal(firstResult.treatmentReferences, 24); assert.equal(firstResult.referencesAdded, 24);
  assert.equal(firstResult.referenceYear, 2026); assert.equal(firstResult.sourceLabel, sourceLabel);
  const doctors = (await db.query('SELECT * FROM staff WHERE is_demo ORDER BY id')).rows;
  const patients = (await db.query('SELECT * FROM patients WHERE is_demo ORDER BY id')).rows;
  assert.equal(doctors.length, 6); assert.equal(patients.length, 8);
  assert.ok(doctors.every(item => item.name.includes('虚构医生') && item.bio.includes('虚构') && item.focus_areas.length));
  assert.ok(patients.every(item => item.name.includes('虚构患者') && item.email.endsWith('@example.invalid')));
  assert.deepEqual(await ordinarySnapshot(), ordinaryBefore);
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM demo_seed_records WHERE record_id=ANY($1::uuid[])', [[ordinaryPatientId, ordinaryDoctorId, ordinaryServiceId]])).rows[0].n), 0);
});

test('all 24 informational prices retain exact integer cents, units and unverified source; consultation fees are separate', async () => {
  const refs = data<TreatmentReference[]>(await request('GET', '/treatment-references'));
  assert.equal(refs.length, 24);
  assert.ok(refs.every(item => Number.isSafeInteger(item.priceMinCents) && Number.isSafeInteger(item.priceMaxCents) && item.priceMinCents >= 0 && item.priceMaxCents >= item.priceMinCents && item.referenceYear === 2026 && item.sourceLabel === sourceLabel && ['次', '颗', '疗程'].includes(item.unit)));
  const expected: [string, number, number, string][] = [
    ['洁牙', 3990, 38800, '次'], ['儿童涂氟', 2990, 9900, '次'], ['窝沟封闭', 3990, 12800, '颗'], ['补牙', 16900, 59900, '颗'],
    ['前牙根管治疗', 50000, 80000, '颗'], ['前磨牙根管治疗', 80000, 120000, '颗'], ['磨牙根管治疗', 120000, 200000, '颗'],
    ['全瓷冠', 99900, 450000, '颗'], ['瓷贴面', 99900, 450000, '颗'], ['经济型种植参考', 200000, 500000, '颗'], ['韩系种植参考', 300000, 700000, '颗'], ['高价区间种植参考', 800000, 2500000, '颗'],
    ['传统金属矫治', 600000, 1800000, '疗程'], ['自锁托槽矫治', 800000, 2500000, '疗程'], ['陶瓷托槽矫治', 1000000, 2800000, '疗程'], ['国产隐形矫治参考', 1500000, 3800000, '疗程'], ['进口隐形矫治参考', 2800000, 5000000, '疗程'], ['儿童早期干预', 300000, 2200000, '疗程'],
  ];
  for (const [name, min, max, unit] of expected) { const row = refs.find(item => item.name === name); assert.ok(row, name); assert.deepEqual([row.priceMinCents, row.priceMaxCents, row.unit], [min, max, unit]); }
  assert.ok(!refs.some(item => /舌侧|半口|全口/.test(item.name)), 'Unbounded or ambiguous prices must not become artificial capped ranges');
  const services = data<Service[]>(await request('GET', '/services'));
  for (const ref of refs) { assert.ok(ref.bookingServiceId); const service = services.find(item => item.id === ref.bookingServiceId)!; assert.ok(service); assert.match(service.description, /咨询/); assert.notEqual(service.priceCents, ref.priceMinCents); }
  assert.equal(services.find(item => item.name === '初诊检查')!.priceCents, 6000);
  assert.equal(services.find(item => item.name === '普通咨询')!.priceCents, 3000);
});

test('existing confirmed appointments and reservations remain byte-equivalent after enrichment', async () => {
  assert.deepEqual(await appointmentSnapshot(), appointmentBefore);
  assert.deepEqual(await ordinarySnapshot(), ordinaryBefore);
});

test('second enrichment is additive-idempotent and never duplicates resources or references', async () => {
  const before = await counts(); const markerIds = (await db.query('SELECT record_key,record_kind,record_id,enriched_at FROM demo_seed_records ORDER BY record_key')).rows;
  const result = await enrichDemoData(db, 'test');
  assert.equal(result.referencesAdded, 0); assert.equal(result.addedShifts, 0); assert.deepEqual(await counts(), before);
  assert.deepEqual((await db.query('SELECT record_key,record_kind,record_id,enriched_at FROM demo_seed_records ORDER BY record_key')).rows, markerIds);
  assert.deepEqual(await ordinarySnapshot(), ordinaryBefore); assert.deepEqual(await appointmentSnapshot(), appointmentBefore);
});

test('public catalogs contain no patient records and private patient routes reject anonymous callers', async () => {
  const patients = (await db.query('SELECT id,name,email,billing_address FROM patients')).rows;
  const privateKeys = new Set(['patientId', 'patientName', 'allergyStatus', 'allergies', 'billingAddress', 'emergencyName', 'emergencyPhone']);
  function checkKeys(value: unknown): void { if (Array.isArray(value)) value.forEach(checkKeys); else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) { assert.ok(!privateKeys.has(key), 'Public field ' + key); checkKeys(item); } }
  for (const path of ['/clinics', '/doctors', '/services', '/treatment-references', '/auth/config']) {
    const payload = data<unknown>(await request('GET', path)); checkKeys(payload); const serialized = JSON.stringify(payload);
    for (const patient of patients) {
      assert.ok(!serialized.includes(patient.id));
      if (typeof patient.email === 'string' && patient.email) assert.ok(!serialized.includes(patient.email));
      if (typeof patient.billing_address === 'string' && patient.billing_address) assert.ok(!serialized.includes(patient.billing_address));
    }
  }
  assert.equal((await request('GET', '/staff/patients')).statusCode, 401); assert.equal((await request('GET', '/patients/me')).statusCode, 401);
});

test('demo account picker uses the same current display name returned by authenticated login', async () => {
  assert.deepEqual(data<{demoAccounts:unknown[]}>(await request('GET', '/auth/config')).demoAccounts, []);
  const enabled = await createApp(loadConfig({ NODE_ENV:'test', DATABASE_URL:targetUrl, ALLOW_DEMO_LOGIN:'true' }), db, false);
  try {
    await enabled.ready();
    const config = data<{demoAccounts:{username:string;displayName:string;portal:string}[]}>(await enabled.inject({ method:'GET', url:'/api/v1/auth/config' }));
    const account = config.demoAccounts.find(item => item.username === 'doctor.a'); assert.ok(account);
    const loggedIn = data<LoginResult>(await enabled.inject({ method:'POST', url:'/api/v1/auth/demo', payload:{username:account.username,portal:account.portal} }));
    assert.equal(account.displayName, loggedIn.user.displayName); assert.match(account.displayName, /虚构/);
    assert.equal(config.demoAccounts.length, 6);
  } finally { await enabled.close(); }
});

test('patient profile rejects readonly demo marker and accepts a correctly selected PatientInput', async () => {
  const patient = data<Patient>(await request('GET', '/patients/me', 'patient.a')); assert.equal(patient.isDemo, true);
  const invalid = await request('PUT', '/patients/me', 'patient.a', { ...inputOf(patient), expectedVersion: patient.rowVersion, isDemo: false });
  assert.equal(invalid.statusCode, 400); assert.equal(data<Patient>(await request('GET', '/patients/me', 'patient.a')).isDemo, true);
  const valid = data<Patient>(await request('PUT', '/patients/me', 'patient.a', { ...inputOf(patient), phone: '00000007777', expectedVersion: patient.rowVersion }));
  assert.equal(valid.phone, '00000007777'); assert.equal(valid.isDemo, true);
  await enrichDemoData(db, 'test');
  const preserved = data<Patient>(await request('GET', '/patients/me', 'patient.a')); assert.equal(preserved.phone, valid.phone); assert.equal(preserved.rowVersion, valid.rowVersion);
});

test('specialist consultations require the matching demo skill in addition to the base qualification', async () => {
  const doctors = data<Doctor[]>(await request('GET', '/doctors')).filter(item => item.isDemo);
  const services = data<Service[]>(await request('GET', '/services'));
  const implant = services.find(item => item.name === '种植方案咨询（演示）')!, orthodontic = services.find(item => item.name === '正畸方案咨询（演示）')!;
  const implantationDoctor = doctors.find(item => item.name.includes('周沐辰'))!, orthodonticDoctor = doctors.find(item => item.name.includes('许知夏'))!;
  assert.ok(implantationDoctor.serviceIds.includes(implant.id)); assert.ok(!implantationDoctor.serviceIds.includes(orthodontic.id));
  assert.ok(orthodonticDoctor.serviceIds.includes(orthodontic.id)); assert.ok(!orthodonticDoctor.serviceIds.includes(implant.id));
  assert.ok(doctors.every(item => item.serviceIds.length < 6));
  const requirement = (await db.query('SELECT qualification_id FROM service_qualifications WHERE service_id=$1', [implant.id])).rows;
  assert.equal(requirement.length, 2);
});

test('an explicitly cancelled demo shift is not recreated or reactivated by repeated enrichment', async () => {
  const doctor = (await db.query("SELECT record_id FROM demo_seed_records WHERE record_key='demo:doctor:c'")).rows[0].record_id;
  const shift = (await db.query("SELECT id,row_version,starts_at,ends_at FROM doctor_shifts WHERE doctor_id=$1 AND status='published' ORDER BY starts_at LIMIT 1", [doctor])).rows[0];
  assert.ok(shift);
  data(await request('POST', '/staff/shifts/' + shift.id + '/cancel', 'hq', { expectedVersion: shift.row_version }));
  const before = await counts(); await enrichDemoData(db, 'test'); assert.deepEqual(await counts(), before);
  const overlapping = (await db.query('SELECT id,status FROM doctor_shifts WHERE doctor_id=$1 AND starts_at<$3 AND ends_at>$2', [doctor, shift.starts_at, shift.ends_at])).rows;
  assert.deepEqual(overlapping, [{ id: shift.id, status: 'cancelled' }]);
});

test('manual edits to enriched demo doctors and services are preserved on rerun', async () => {
  const doctor = (await db.query("SELECT record_id FROM demo_seed_records WHERE record_key='demo:doctor:d'")).rows[0].record_id;
  const service = (await db.query("SELECT record_id FROM demo_seed_records WHERE record_key='demo:service:restoration'")).rows[0].record_id;
  await db.query("UPDATE staff SET bio='人工调整的演示简介',row_version=row_version+1 WHERE id=$1", [doctor]);
  await db.query('UPDATE services SET price_cents=7654,row_version=row_version+1 WHERE id=$1', [service]);
  const beforeDoctor = (await db.query('SELECT to_jsonb(s) AS row FROM staff s WHERE id=$1', [doctor])).rows[0].row;
  const beforeService = (await db.query('SELECT to_jsonb(s) AS row FROM services s WHERE id=$1', [service])).rows[0].row;
  await enrichDemoData(db, 'test');
  assert.deepEqual((await db.query('SELECT to_jsonb(s) AS row FROM staff s WHERE id=$1', [doctor])).rows[0].row, beforeDoctor);
  assert.deepEqual((await db.query('SELECT to_jsonb(s) AS row FROM services s WHERE id=$1', [service])).rows[0].row, beforeService);
  assert.deepEqual(await appointmentSnapshot(), appointmentBefore);
});

test('pre-003 synthetic seed without provenance is recognised by its complete relational fingerprint', { timeout: 120_000 }, async () => {
  await withLegacySeed(async legacy => {
    assert.equal(Number((await legacy.query('SELECT count(*) AS n FROM demo_seed_records')).rows[0].n), 0);
    const originalPatients = (await legacy.query('SELECT id FROM patients ORDER BY id')).rows.map(row => row.id);
    const result = await enrichDemoData(legacy, 'test');
    assert.equal(result.doctors, 6); assert.equal(result.patients, 8); assert.equal(result.referencesAdded, 24);
    assert.equal(Number((await legacy.query("SELECT count(*) AS n FROM demo_seed_records WHERE record_key LIKE 'seed:%'")).rows[0].n), 9);
    for (const id of originalPatients) assert.equal((await legacy.query('SELECT is_demo FROM patients WHERE id=$1', [id])).rows[0].is_demo, true);
    const second = await enrichDemoData(legacy, 'test'); assert.equal(second.referencesAdded, 0); assert.equal(second.addedShifts, 0);
  });
});

test('provenance-less same-name identities with a changed creation fingerprint fail closed without any writes', { timeout: 120_000 }, async () => {
  await withLegacySeed(async legacy => {
    await legacy.query("UPDATE users SET created_at=created_at+interval '1 second' WHERE username='patient.b'");
    const before = await legacyFingerprint(legacy);
    await assert.rejects(enrichDemoData(legacy, 'test'), /ownership|identity|seed/i);
    assert.deepEqual(await legacyFingerprint(legacy), before);
  });
});
