import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance, HTTPMethods } from 'fastify';
import type { Config } from '../src/config.js';
import type { Appointment, LoginResult } from '../../shared/src/index.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { principal } from '../src/auth.js';
import { migrate, poolFor } from '../src/db.js';
import { seed } from '../src/seed.js';
import { enrichDemoData } from '../src/demo.js';
import { prepareDemoScenarios } from '../src/demo-scenarios.js';
import { insertPatient } from '../src/repositories/catalog.js';
import { querySlots } from '../src/repositories/booking.js';
import { bookingPolicy, confirmAppointment, createHold } from '../src/services/booking.js';
import { cancelShift } from '../src/services/resources.js';
import { PRIVACY_VERSION } from '../src/privacy.js';

const databaseName = 'andrew_test_' + randomBytes(10).toString('hex');
const password = 'Synthetic-scenarios-' + randomBytes(18).toString('base64url');
let admin: Pool | undefined, db: Pool, config: Config, app: FastifyInstance | undefined, created = false;
let ordinaryPatientId: string, ordinaryDoctorId: string, ordinaryAppointmentId: string, ordinaryBefore: unknown;
let result: Awaited<ReturnType<typeof prepareDemoScenarios>>;
const tokens: Record<string, string> = {};

async function ordinarySnapshot() {
  return {
    patient: (await db.query('SELECT to_jsonb(p) AS row FROM patients p WHERE id=$1', [ordinaryPatientId])).rows[0].row,
    doctor: (await db.query('SELECT to_jsonb(s) AS row FROM staff s WHERE id=$1', [ordinaryDoctorId])).rows[0].row,
    clinicAccess: (await db.query('SELECT * FROM patient_clinic_access WHERE patient_id=$1', [ordinaryPatientId])).rows,
    consents: (await db.query('SELECT * FROM patient_privacy_consents WHERE patient_id=$1', [ordinaryPatientId])).rows,
    appointment: (await db.query('SELECT to_jsonb(a) AS row FROM appointments a WHERE id=$1', [ordinaryAppointmentId])).rows[0].row,
    reservation: (await db.query('SELECT to_jsonb(r) AS row FROM resource_reservations r JOIN appointments a ON a.reservation_id=r.id WHERE a.id=$1', [ordinaryAppointmentId])).rows[0].row,
    events: (await db.query('SELECT * FROM appointment_events WHERE appointment_id=$1 ORDER BY occurred_at,id', [ordinaryAppointmentId])).rows,
  };
}
async function snapshotCounts() {
  const counts: Record<string, number> = {};
  for (const table of ['patients', 'staff', 'users', 'appointments', 'resource_reservations', 'booking_holds', 'appointment_events', 'patient_clinic_access', 'patient_privacy_consents', 'command_receipts', 'audit_events']) {
    counts[table] = Number((await db.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
  }
  return counts;
}
async function request(method: HTTPMethods, path: string, username?: string, payload?: object) {
  assert.ok(app);
  return app.inject({ method, url: '/api/v1' + path, headers: username ? { authorization: 'Bearer ' + tokens[username] } : {}, ...(payload ? { payload } : {}) });
}
async function loginAs(username: string, portal: 'staff' | 'patient') {
  const response = await request('POST', '/auth/login', undefined, { username, password, portal });
  assert.equal(response.statusCode, 200, response.body); const login = response.json().data as LoginResult; tokens[username] = login.token; return login.user;
}

before(async () => {
  const base = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  assert.ok(base, 'A real local PostgreSQL connection is required; this test does not use a mock fallback.');
  assert.match(databaseName, /^andrew_test_[0-9a-f]{20}$/);
  const adminUrl = new URL(base); adminUrl.pathname = '/postgres'; admin = poolFor(adminUrl.toString());
  await admin.query(`CREATE DATABASE "${databaseName}"`); created = true;
  const target = new URL(base); target.pathname = '/' + databaseName; db = poolFor(target.toString());
  config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: target.toString(), ALLOW_DEMO_LOGIN: 'false' });
  await migrate(db); await seed(db, password); await enrichDemoData(db, 'test', config.TRANSFER_BUFFER_MINUTES);
  ordinaryPatientId = (await insertPatient(db, { name: '林晓（虚构患者）', birthDate: '1990-01-01', phone: '00000009999', email: 'ordinary-test@example.invalid',
    billingAddress: '普通测试资料，不归演示维护命令所有', emergencyName: '测试联系人', emergencyPhone: '00000009998', allergyStatus: 'none_reported', allergies: [] })).id;
  ordinaryDoctorId = (await db.query("INSERT INTO staff(employee_no,name,phone,specialty)VALUES($1,'陈知远（虚构医生）','00000009997','普通测试医生，不属于演示来源')RETURNING id", ['TEST-ORDINARY-' + randomBytes(5).toString('hex')])).rows[0].id;
  const actorId = (await db.query("SELECT id FROM users WHERE username='hq'")).rows[0].id;
  const actor = await principal(db, actorId); assert.ok(actor);
  const clinicId = (await db.query("SELECT record_id FROM demo_seed_records WHERE record_key='seed:clinic:a'")).rows[0].record_id;
  const serviceId = (await db.query("SELECT record_id FROM demo_seed_records WHERE record_key='seed:service:initial'")).rows[0].record_id;
  const shift = (await db.query("SELECT to_char(starts_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS date FROM doctor_shifts WHERE clinic_id=$1 AND status='published' AND starts_at>clock_timestamp()+interval '15 days' ORDER BY starts_at LIMIT 1", [clinicId])).rows[0]; assert.ok(shift);
  const slot = (await querySlots(db, { clinicId, serviceId, date: shift.date, patientId: ordinaryPatientId }, bookingPolicy(config)))[0]; assert.ok(slot);
  const hold = await createHold(db, config, actor, { clinicId: slot.clinicId, serviceId: slot.serviceId, doctorId: slot.doctorId, chairId: slot.chairId, shiftId: slot.shiftId, startsAt: slot.startsAt, patientId: ordinaryPatientId }, 'ordinary-fixture');
  const appointment = await confirmAppointment(db, config, actor, { patientId: ordinaryPatientId, holdId: hold.id, holdVersion: hold.rowVersion, patientConfirmed: true, rulesAccepted: true }, randomUUID(), 'ordinary-fixture');
  ordinaryAppointmentId = appointment.id; ordinaryBefore = await ordinarySnapshot();
  app = await createApp(loadConfig({ ...config, NODE_ENV: 'production', PRIVACY_CONTROLLER_NAME: 'Synthetic integration test', PRIVACY_CONTACT: 'test@example.invalid', PRIVACY_RETENTION: 'Temporary isolated test database only' }), db, false); await app.ready();
}, { timeout: 120_000 });

after(async () => {
  if (app) await app.close(); if (db) await db.end();
  if (admin) try {
    if (created) { assert.match(databaseName, /^andrew_test_[0-9a-f]{20}$/); await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [databaseName]); await admin.query(`DROP DATABASE "${databaseName}"`); }
  } finally { await admin.end(); }
});

test('scenario maintenance requires explicit opt-in and remains forbidden in production', async () => {
  const before = await snapshotCounts();
  await assert.rejects(prepareDemoScenarios(db, config), /ANDREW_DEMO_SCENARIOS/);
  await assert.rejects(prepareDemoScenarios(db, { ...config, NODE_ENV: 'production' }, { enabled: true }), /disabled in production/);
  assert.deepEqual(await snapshotCounts(), before);
});

test('synthetic scenarios create usable future bookings plus valid cancellation and reschedule history without editing ordinary records', async () => {
  const requested = new Date(Date.parse(new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10) + 'T00:00:00Z') + 2 * 86400000).toISOString().slice(0, 10);
  const clinicId = (await db.query("SELECT record_id FROM demo_seed_records WHERE record_key='seed:clinic:a'")).rows[0].record_id;
  const actor = await principal(db, (await db.query("SELECT id FROM users WHERE username='hq'")).rows[0].id); assert.ok(actor);
  const shifts = (await db.query("SELECT id,row_version FROM doctor_shifts WHERE clinic_id=$1 AND status='published' AND (starts_at AT TIME ZONE 'Asia/Shanghai')::date=$2::date", [clinicId, requested])).rows;
  for (const shift of shifts) await cancelShift(db, actor, shift.id, shift.row_version, 'closed-fixture-day');
  result = await prepareDemoScenarios(db, config, { enabled: true });
  assert.equal(result.fictional, true); assert.equal(result.patients, 8); assert.equal(result.appointmentsAdded, 7);
  assert.equal(result.patientClinicLinksAdded, 8); assert.equal(result.syntheticConsentsAdded, 8); assert.deepEqual(result.blockedPatients, []);
  assert.equal(result.appointmentIds.length, 7); assert.deepEqual(result.statuses, { confirmed: 5, cancelled: 1, rescheduled: 1 });
  const readyA = (await db.query("SELECT r.starts_at FROM command_receipts c JOIN appointments a ON a.id=(c.result->>'id')::uuid JOIN resource_reservations r ON r.id=a.reservation_id WHERE c.command_key=$1", ['demo_v1_' + result.batchDate.replaceAll('-', '') + '_ready_0'])).rows[0];
  const actualDay = new Date(readyA.starts_at.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  assert.ok(actualDay > requested && Date.parse(actualDay) <= Date.parse(requested) + 6 * 86400000, 'A closed preferred day must select a later real published shift');
  const appointments = (await db.query(`SELECT a.id,a.status,a.supersedes_appointment_id,r.starts_at,r.status AS reservation_status,p.is_demo AS patient_demo,d.is_demo AS doctor_demo
    FROM appointments a JOIN resource_reservations r ON r.id=a.reservation_id JOIN patients p ON p.id=a.patient_id JOIN staff d ON d.id=r.doctor_id WHERE a.id=ANY($1::uuid[])`, [result.appointmentIds])).rows;
  assert.ok(appointments.every(row => row.patient_demo && row.doctor_demo && row.starts_at.getTime() > Date.now()));
  assert.ok(appointments.every(row => row.reservation_status === (row.status === 'confirmed' ? 'booked' : 'released')));
  const original = appointments.find(row => row.status === 'rescheduled')!;
  assert.ok(appointments.find(row => row.status === 'confirmed' && row.supersedes_appointment_id === original.id));
  const events = (await db.query('SELECT kind FROM appointment_events WHERE appointment_id=ANY($1::uuid[])', [result.appointmentIds])).rows.map(row => row.kind);
  for (const kind of ['confirmed', 'cancelled', 'rescheduled', 'replacement_confirmed']) assert.ok(events.includes(kind));
  assert.deepEqual(await ordinarySnapshot(), ordinaryBefore);
});

test('rerunning scenario maintenance preserves rows and does not duplicate accounts, appointments, consents or audit fixtures', async () => {
  const before = await snapshotCounts();
  const second = await prepareDemoScenarios(db, config, { enabled: true });
  assert.equal(second.batchDate, result.batchDate); assert.equal(second.appointmentsAdded, 0); assert.equal(second.patientClinicLinksAdded, 0); assert.equal(second.syntheticConsentsAdded, 0);
  assert.deepEqual([...second.appointmentIds].sort(), [...result.appointmentIds].sort()); assert.deepEqual(await snapshotCounts(), before);
  assert.deepEqual(await ordinarySnapshot(), ordinaryBefore);
});

test('production routes show the same scenario records to the owning patient and authorized clinic staff only', async () => {
  await loginAs('hq', 'staff'); await loginAs('front.a', 'staff');
  const owner = await loginAs('patient.a', 'patient');
  const mine = await request('GET', '/appointments', 'patient.a'); assert.equal(mine.statusCode, 200, mine.body);
  const myItems = mine.json().data.items as Appointment[]; assert.equal(myItems.length, 2); assert.ok(myItems.every(item => item.patientId === owner.patientId));
  assert.ok(myItems.some(item => item.status === 'confirmed')); assert.ok(myItems.some(item => item.status === 'cancelled'));
  const staff = await request('GET', '/staff/appointments', 'hq'); assert.equal(staff.statusCode, 200, staff.body);
  assert.ok(myItems.every(item => staff.json().data.items.some((row: Appointment) => row.id === item.id)));
  const localName = (await db.query("SELECT p.name FROM patients p JOIN demo_seed_records d ON d.record_id=p.id WHERE d.record_key='demo:patient:3'")).rows[0].name;
  const otherName = (await db.query("SELECT p.name FROM patients p JOIN demo_seed_records d ON d.record_id=p.id WHERE d.record_key='demo:patient:4'")).rows[0].name;
  const local = await request('GET', '/staff/patients?q=' + encodeURIComponent(localName), 'front.a'); assert.equal(local.statusCode, 200, local.body); assert.equal(local.json().data.total, 1);
  const other = await request('GET', '/staff/patients?q=' + encodeURIComponent(otherName), 'front.a'); assert.equal(other.statusCode, 200, other.body); assert.equal(other.json().data.total, 0);
  assert.equal((await request('GET', '/staff/patients', 'patient.a')).statusCode, 403);
});

test('a withdrawn synthetic consent is never reaccepted and ordinary same-name records remain untouched', async () => {
  const patientId = (await db.query("SELECT record_id FROM demo_seed_records WHERE record_key='seed:patient:a'")).rows[0].record_id;
  await db.query('UPDATE patient_privacy_consents SET revoked_at=clock_timestamp() WHERE patient_id=$1', [patientId]);
  const before = (await db.query('SELECT * FROM patient_privacy_consents WHERE patient_id=$1 ORDER BY id', [patientId])).rows;
  const rerun = await prepareDemoScenarios(db, config, { enabled: true });
  assert.ok(rerun.blockedPatients.includes('seed:patient:a')); assert.equal(rerun.syntheticConsentsAdded, 0); assert.equal(rerun.appointmentsAdded, 0);
  assert.deepEqual((await db.query('SELECT * FROM patient_privacy_consents WHERE patient_id=$1 ORDER BY id', [patientId])).rows, before);
  assert.deepEqual(await ordinarySnapshot(), ordinaryBefore);
});

test('another actors consent does not unlock a linked patient account', async () => {
  const patientId = (await db.query("SELECT record_id FROM demo_seed_records WHERE record_key='seed:patient:b'")).rows[0].record_id;
  const actorId = (await db.query("SELECT id FROM users WHERE username='hq'")).rows[0].id;
  await db.query('UPDATE patient_privacy_consents SET revoked_at=clock_timestamp() WHERE patient_id=$1', [patientId]);
  await db.query(`INSERT INTO patient_privacy_consents(patient_id,actor_id,policy_version,notice_accepted,sensitive_accepted,guardian_accepted)
    VALUES($1,$2,$3,true,true,false)`,[patientId,actorId,PRIVACY_VERSION]);
  const before = (await db.query('SELECT * FROM patient_privacy_consents WHERE patient_id=$1 ORDER BY id', [patientId])).rows;
  const rerun = await prepareDemoScenarios(db, config, {enabled:true});
  assert.ok(rerun.blockedPatients.includes('seed:patient:b')); assert.equal(rerun.syntheticConsentsAdded,0);
  assert.deepEqual((await db.query('SELECT * FROM patient_privacy_consents WHERE patient_id=$1 ORDER BY id', [patientId])).rows,before);
});
