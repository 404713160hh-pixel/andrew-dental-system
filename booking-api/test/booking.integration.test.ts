import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, HTTPMethods, LightMyRequestResponse } from 'fastify';
import type { Pool } from 'pg';
import type { Appointment, BookingSlot, Clinic, Doctor, Hold, LoginResult, Patient, PatientInput, Service, Shift } from '../../shared/src/index.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { migrate, poolFor } from '../src/db.js';
import { seed } from '../src/seed.js';

// Integration tests create a new random database. Never truncate/drop a developer database.
const databaseName = `andrew_test_${randomBytes(10).toString('hex')}`;
const password = `Course-${randomBytes(16).toString('base64url')}!`;
let admin: Pool | undefined;
let db: Pool;
let app: FastifyInstance;
let testConfig: ReturnType<typeof loadConfig>;
let created = false;
const identities: Record<string, LoginResult> = {};
let clinics: Clinic[];
let doctors: Doctor[];
let services: Service[];
let shifts: Shift[];
const prefix = '/api/v1';

type Response = LightMyRequestResponse;
async function request(method: HTTPMethods, path: string, who?: string, payload?: object, key?: string): Promise<Response> {
  return requestAt(app, method, path, who, payload, key);
}
async function requestAt(target: FastifyInstance, method: HTTPMethods, path: string, who?: string, payload?: object, key?: string): Promise<Response> {
  return target.inject({ method, url: prefix + path, headers: {
    ...(who ? { authorization: `Bearer ${identities[who]!.token}` } : {}),
    ...(key ? { 'idempotency-key': key } : {}),
  }, ...(payload === undefined ? {} : { payload }) });
}
function data<T>(response: Response, statuses = [200, 201]): T {
  assert.ok(statuses.includes(response.statusCode), `${response.statusCode}: ${response.body}`);
  const json = response.json();
  assert.ok(json.requestId, 'Every response must carry a request ID');
  return json.data as T;
}
function rejected(response: Response, statuses: number[]): void {
  assert.ok(statuses.includes(response.statusCode), `Expected ${statuses}, received ${response.statusCode}: ${response.body}`);
  assert.ok(response.json().error?.code, 'Business rejection must use the error envelope');
  assert.ok(response.json().requestId);
}
function items<T>(value: T[] | { items: T[] }): T[] { return Array.isArray(value) ? value : value.items; }
function select(slot: BookingSlot) {
  return { clinicId: slot.clinicId, serviceId: slot.serviceId, doctorId: slot.doctorId,
    chairId: slot.chairId, shiftId: slot.shiftId, startsAt: slot.startsAt };
}
async function slots(criteria: { clinicId?: string; doctorId?: string; serviceId?: string; from?: string; to?: string } = {}): Promise<BookingSlot[]> {
  const first = shifts.map(x => x.startsAt).sort()[0]!;
  const start = new Date(first);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 8 * 86_400_000);
  const target=criteria.from?new Date(criteria.from):start;
  const query = new URLSearchParams({ clinicId: shifts[0]!.clinicId, serviceId: shifts[0]!.serviceIds[0]!,
    ...criteria, date: new Date(target.getTime()+8*3600000).toISOString().slice(0,10) });
  return data<BookingSlot[]>(await request('GET', `/booking-slots?${query}`));
}
async function firstSlot(criteria: Parameters<typeof slots>[0] = {}): Promise<BookingSlot> {
  const result = await slots(criteria);
  assert.ok(result.length > 0, `Expected available seed slot: ${JSON.stringify(criteria)}`);
  return result[0]!;
}
async function hold(who: string, slot: BookingSlot): Promise<Hold> {
  return data<Hold>(await request('POST', '/booking-holds', who, select(slot), randomUUID()));
}
async function confirm(who: string, selected: Hold, key = randomUUID()): Promise<Appointment> {
  return data<Appointment>(await request('POST', '/appointments/confirm', who,
    { holdId: selected.id, holdVersion: selected.rowVersion, patientConfirmed: true, rulesAccepted: true }, key));
}
async function book(who = 'patient.a'): Promise<Appointment> { return confirm(who, await hold(who, await firstSlot())); }
async function cancel(who: string, appointment: Appointment): Promise<Appointment> {
  return data<Appointment>(await request('POST', `/appointments/${appointment.id}/changes`, who,
    { intent: 'cancel', expectedVersion: appointment.rowVersion, reason: '自动化测试取消' }, randomUUID()));
}
function profile(extra: Partial<PatientInput> = {}): PatientInput {
  return { name: '合成测试患者', birthDate: '1998-07-21', phone: '13800009999', email: null,
    billingAddress: '合成数据地址', emergencyName: '合成联系人', emergencyPhone: '13900009999',
    allergyStatus: 'unknown', allergies: [], ...extra };
}

before(async () => {
  assert.match(databaseName, /^andrew_test_[0-9a-f]{20}$/);
  const base = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  assert.ok(base, 'Set TEST_DATABASE_URL or DATABASE_URL in .env.booking to a local PostgreSQL server; no mock fallback is used');
  const adminUrl = new URL(base);
  adminUrl.pathname = '/postgres';
  admin = poolFor(adminUrl.toString());
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  const targetUrl = new URL(base);
  targetUrl.pathname = '/' + databaseName;
  db = poolFor(targetUrl.toString());
  await migrate(db);
  await seed(db, password);
  testConfig = loadConfig({ NODE_ENV: 'test', DATABASE_URL: targetUrl.toString(), ALLOW_DEMO_LOGIN: 'false', CANCELLATION_NOTICE_MINUTES: 120 });
  app = await createApp(testConfig, db, false);
  await app.ready();
  for (const username of ['patient.a', 'patient.b', 'hq', 'front.a', 'manager.a', 'doctor.a']) {
    identities[username] = data<LoginResult>(await request('POST', '/auth/login', undefined,
      { username, password, portal: username.startsWith('patient.') ? 'patient' : 'staff' }));
  }
  clinics = data<Clinic[]>(await request('GET', '/clinics'));
  doctors = data<Doctor[]>(await request('GET', '/doctors'));
  services = data<Service[]>(await request('GET', '/services'));
  shifts = data<Shift[]>(await request('GET', '/shifts', 'hq'));
  assert.ok(clinics.length >= 2 && doctors.length >= 2 && services.length >= 1 && shifts.length >= 1);
}, { timeout: 120_000 });

after(async () => {
  if (app) await app.close();
  if (db) await db.end();
  if (admin) {
    try {
      if (created) {
        assert.match(databaseName, /^andrew_test_[0-9a-f]{20}$/);
        await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [databaseName]);
        await admin.query(`DROP DATABASE "${databaseName}"`);
      }
    } finally { await admin.end(); }
  }
});

test('versioned migrations are repeatable and the test database is isolated', async () => {
  assert.equal((await db.query('SELECT current_database() AS name')).rows[0].name, databaseName);
  assert.deepEqual(await migrate(db), []);
  assert.ok((await db.query('SELECT version,checksum FROM schema_migrations')).rows.every(x => /^[0-9a-f]{64}$/.test(x.checksum)));
  const constraints = (await db.query("SELECT contype FROM pg_constraint WHERE conrelid='resource_reservations'::regclass")).rows;
  assert.equal(constraints.filter(x => x.contype === 'x').length, 3, 'Patient, doctor and chair must each have an exclusion constraint');
});

test('authentication is on the server, demo login is gated, logout revokes its session', async () => {
  rejected(await request('GET', '/me'), [401]);
  rejected(await request('POST', '/auth/login', undefined, { username: 'patient.a', password: 'wrong-password', portal: 'patient' }), [401]);
  rejected(await request('POST', '/auth/demo', undefined, { username: 'patient.a', portal: 'patient' }), [403, 404]);
  const username = `integration.${randomBytes(5).toString('hex')}`;
  const login = data<LoginResult>(await request('POST', '/auth/register', undefined, { username, password, profile: profile() }));
  identities[username] = login;
  assert.equal(data<LoginResult['user']>(await request('GET', '/me', username)).id, login.user.id);
  data(await request('POST', '/auth/logout', username));
  rejected(await request('GET', '/me', username), [401]);
});

test('patient identity is not a unique phone number and registration has real PostgreSQL rows', async () => {
  const registered: LoginResult[] = [];
  for (const name of ['合成家庭成员甲', '合成家庭成员乙']) {
    registered.push(data<LoginResult>(await request('POST', '/auth/register', undefined,
      { username: `family.${randomBytes(5).toString('hex')}`, password, profile: profile({ name }) })));
  }
  assert.notEqual(registered[0]!.user.patientId, registered[1]!.user.patientId);
  const rows = (await db.query('SELECT id FROM patients WHERE phone=$1', ['13800009999'])).rows;
  assert.ok(rows.length >= 2);
});

test('patient can read self, cannot read or edit another patient, anonymous writes fail', async () => {
  const own = identities['patient.a']!.user.patientId!;
  const other = identities['patient.b']!.user.patientId!;
  assert.equal(data<Patient>(await request('GET', '/patients/me', 'patient.a')).id, own);
  rejected(await request('GET', `/patients/${other}`, 'patient.a'), [403, 404]);
  rejected(await request('PUT', `/patients/${other}`, 'patient.a', { ...profile(), expectedVersion: 1 }), [403, 404]);
  rejected(await request('GET', '/patients/me'), [401]);
});

test('allergy unknown, explicit none and known items stay distinct; stale profile versions are rejected', async () => {
  const patientId = identities['patient.a']!.user.patientId!;
  let current = data<Patient>(await request('GET', '/patients/me', 'patient.a'));
  const initial = current.rowVersion;
  for (const [allergyStatus, allergies] of [['unknown', []], ['none_reported', []], ['known', ['乳胶', '树脂']]] as const) {
    current = data<Patient>(await request('PUT', '/patients/me', 'patient.a',
      { ...profile({ name: current.name, allergyStatus, allergies: [...allergies] }), expectedVersion: current.rowVersion }));
    assert.equal(current.allergyStatus, allergyStatus);
    assert.deepEqual([...current.allergies].sort(), [...allergies].sort());
  }
  rejected(await request('PUT', '/patients/me', 'patient.a',
    { ...profile({ allergyStatus: 'known', allergies: [] }), expectedVersion: current.rowVersion }), [400, 409, 422]);
  rejected(await request('PUT', '/patients/me', 'patient.a', { ...profile(), expectedVersion: initial }), [409]);
  current = data<Patient>(await request('PUT', '/patients/me', 'patient.a', { ...profile(), expectedVersion: current.rowVersion }));
  assert.equal(current.allergyStatus, 'unknown');
});

test('staff role permissions and clinic scope are enforced by the API', async () => {
  rejected(await request('GET', '/staff/patients', 'patient.a'), [403]);
  rejected(await request('GET', '/staff/appointments', 'patient.a'), [403]);
  const body = { name: '合成越权门诊', address: '测试地址', phone: '02000000000', email: 'synthetic@example.invalid', active: true };
  rejected(await request('POST', '/staff/clinics', 'front.a', body), [403]);
  const foreignClinic = clinics.find(c => !identities['front.a']!.user.assignments.some(a => a.clinicId === c.id));
  assert.ok(foreignClinic);
  rejected(await request('GET', `/staff/appointments?clinicId=${foreignClinic.id}`, 'front.a'), [403]);
});

test('a doctor assignment without a linked staff profile cannot bypass list ownership filters', async () => {
  const username = `orphan.doctor.${randomBytes(5).toString('hex')}`;
  const clinicId = identities['doctor.a']!.user.assignments[0]!.clinicId!;
  const userId = (await db.query('INSERT INTO users(username,password_hash,display_name) SELECT $1,password_hash,$2 FROM users WHERE username=$3 RETURNING id',
    [username, '无员工关联的合成医生账号', 'doctor.a'])).rows[0].id;
  await db.query("INSERT INTO role_assignments(user_id,role,clinic_id)VALUES($1,'doctor',$2)", [userId, clinicId]);
  identities[username] = data<LoginResult>(await request('POST', '/auth/login', undefined, { username, password, portal: 'staff' }));
  assert.equal(identities[username]!.user.staffId, null);
  assert.deepEqual(identities[username]!.user.roles, ['doctor']);
  for (const path of ['/shifts', `/shifts?clinicId=${clinicId}`, '/staff/appointments', `/staff/appointments?clinicId=${clinicId}`]) {
    const response = await request('GET', path, username);
    rejected(response, [403]);
    assert.equal(response.json().error.code, 'DOCTOR_PROFILE_REQUIRED');
  }
});

test('a linked doctor reads only own shifts and appointments even across multiple authorized clinics', async () => {
  const doctor = identities['doctor.a']!.user;
  assert.ok(doctor.staffId);
  const ownShift = shifts.find(shift => shift.doctorId === doctor.staffId)!;
  const otherShift = shifts.find(shift => shift.doctorId !== doctor.staffId && doctor.assignments.some(grant => grant.clinicId === shift.clinicId))!;
  assert.ok(ownShift && otherShift, 'Both own and another doctor shifts must exist inside the authorized clinic scope');
  const own = await confirm('patient.a', await hold('patient.a', await firstSlot({ clinicId: ownShift.clinicId, doctorId: ownShift.doctorId, serviceId: ownShift.serviceIds[0]! })));
  const other = await confirm('patient.b', await hold('patient.b', await firstSlot({ clinicId: otherShift.clinicId, doctorId: otherShift.doctorId, serviceId: otherShift.serviceIds[0]! })));
  try {
    const doctorShifts = data<Shift[]>(await request('GET', '/shifts', 'doctor.a'));
    assert.ok(doctorShifts.some(shift => shift.id === ownShift.id));
    assert.ok(doctorShifts.every(shift => shift.doctorId === doctor.staffId));
    assert.ok(!doctorShifts.some(shift => shift.id === otherShift.id));
    const appointments = data<{ items: Appointment[]; total: number }>(await request('GET', '/staff/appointments?pageSize=100', 'doctor.a'));
    assert.equal(appointments.total, 1);
    assert.deepEqual(appointments.items.map(appointment => appointment.id), [own.id]);
    assert.ok(appointments.items.every(appointment => appointment.doctorId === doctor.staffId));
    assert.equal(data<Appointment>(await request('GET', `/appointments/${own.id}`, 'doctor.a')).id, own.id);
    rejected(await request('GET', `/appointments/${other.id}`, 'doctor.a'), [404]);
    rejected(await request('POST', `/appointments/${own.id}/changes`, 'doctor.a',
      { intent: 'cancel', expectedVersion: own.rowVersion, reason: '医生不能代为取消' }, randomUUID()), [403]);
  } finally {
    await cancel('patient.a', own);
    await cancel('patient.b', other);
  }
});

test('staff publishes a new shift and public API reads the same new PostgreSQL capacity', async () => {
  const baseShift = shifts[0]!;
  const start = new Date(new Date(baseShift.startsAt).getTime() + 10 * 86_400_000);
  const end = new Date(start.getTime() + 3 * 3_600_000);
  const createdShift = data<Shift>(await request('POST', '/staff/shifts', 'hq', {
    clinicId: baseShift.clinicId, doctorId: baseShift.doctorId, startsAt: start.toISOString(), endsAt: end.toISOString(), serviceIds: baseShift.serviceIds,
  }));
  assert.equal(createdShift.status, 'published');
  const result = await slots({ clinicId: baseShift.clinicId, serviceId: baseShift.serviceIds[0]!, doctorId: baseShift.doctorId,
    from: start.toISOString(), to: end.toISOString() });
  assert.ok(result.some(x => x.shiftId === createdShift.id));
  assert.equal((await db.query('SELECT status FROM doctor_shifts WHERE id=$1', [createdShift.id])).rows[0].status, 'published');
});

test('public slot DTO does not disclose other patients and query alone never writes occupancy', async () => {
  const count = Number((await db.query('SELECT count(*) AS n FROM resource_reservations')).rows[0].n);
  const available = await slots();
  assert.ok(available.length);
  for (const slot of available) {
    const text = JSON.stringify(slot);
    assert.ok(!('patientId' in slot) && !('patientName' in slot));
    assert.ok(!text.includes(identities['patient.a']!.user.patientId!));
    assert.ok(!text.includes(identities['patient.b']!.user.patientId!));
    assert.ok(new Date(slot.occupiedUntil).getTime() >= new Date(slot.endsAt).getTime());
  }
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM resource_reservations')).rows[0].n), count);
});

test('an overnight shift lists starts by Shanghai date without truncating service at midnight', async () => {
  const reference=shifts[0]!;
  const day=new Date(Date.parse(reference.startsAt)+30*86400000+8*3600000).toISOString().slice(0,10);
  const nextDay=new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  const shift=data<Shift>(await request('POST','/staff/shifts','hq',{clinicId:reference.clinicId,doctorId:reference.doctorId,serviceIds:reference.serviceIds,startsAt:day+'T23:30:00+08:00',endsAt:nextDay+'T01:00:00+08:00'}));
  const base=new URLSearchParams({clinicId:shift.clinicId,serviceId:shift.serviceIds[0]!,doctorId:shift.doctorId});
  const first=data<BookingSlot[]>(await request('GET',`/booking-slots?${base}&date=${day}`));
  const crossMidnight=first.find(s=>Date.parse(s.endsAt)+8*3600000>=Date.parse(nextDay+'T00:00:00Z'));
  assert.ok(crossMidnight,'A start on the requested day may finish on the following day');
  assert.ok(first.every(s=>new Date(Date.parse(s.startsAt)+8*3600000).toISOString().slice(0,10)===day));
  const second=data<BookingSlot[]>(await request('GET',`/booking-slots?${base}&date=${nextDay}`));
  assert.ok(second.length>0&&second.every(s=>new Date(Date.parse(s.startsAt)+8*3600000).toISOString().slice(0,10)===nextDay));
  const appointment=await confirm('patient.a',await hold('patient.a',crossMidnight));
  await cancel('patient.a',appointment);
  data(await request('POST',`/staff/shifts/${shift.id}/cancel`,'hq',{expectedVersion:shift.rowVersion}));
});

test('confirmation commits an appointment visible to both patient and authorized staff', async () => {
  const appointment = await book();
  assert.equal(appointment.status, 'confirmed');
  assert.equal(appointment.attendance, 'not_recorded');
  assert.ok(appointment.appointmentNo);
  const stored = (await db.query('SELECT a.status,r.status AS reservation_status,a.patient_id FROM appointments a JOIN resource_reservations r ON r.id=a.reservation_id WHERE a.id=$1', [appointment.id])).rows[0];
  assert.equal(stored.status, 'confirmed');
  assert.equal(stored.reservation_status, 'booked');
  assert.equal(stored.patient_id, identities['patient.a']!.user.patientId);
  assert.equal(data<Appointment>(await request('GET', `/appointments/${appointment.id}`, 'patient.a')).id, appointment.id);
  const staffRows = items(data<Appointment[] | { items: Appointment[] }>(await request('GET', `/staff/appointments?clinicId=${appointment.clinicId}`, 'hq')));
  assert.ok(staffRows.some(x => x.id === appointment.id));
  rejected(await request('GET', `/appointments/${appointment.id}`, 'patient.b'), [403, 404]);
  rejected(await request('POST', `/appointments/${appointment.id}/changes`, 'patient.b',
    { intent: 'cancel', expectedVersion: appointment.rowVersion, reason: '越权尝试' }, randomUUID()), [403, 404]);
  await cancel('patient.a', appointment);
});

test('two patients competing concurrently for one resource can produce at most one appointment', async () => {
  const selected = await firstSlot();
  const contenders = await Promise.all(['patient.a', 'patient.b'].map(async who => ({ who,
    response: await request('POST', '/booking-holds', who, select(selected), randomUUID()) })));
  const winners = contenders.filter(x => [200, 201].includes(x.response.statusCode));
  assert.equal(winners.length, 1, contenders.map(x => x.response.body).join('\n'));
  for (const loser of contenders.filter(x => x !== winners[0])) rejected(loser.response, [409]);
  const winner = winners[0]!;
  const appointment = await confirm(winner.who, data<Hold>(winner.response));
  const rows = (await db.query("SELECT a.id FROM appointments a JOIN resource_reservations r ON r.id=a.reservation_id WHERE r.doctor_id=$1 AND r.starts_at=$2 AND a.status='confirmed'", [selected.doctorId, selected.startsAt])).rows;
  assert.equal(rows.length, 1);
  await cancel(winner.who, appointment);
});

test('concurrent same-key submissions return one appointment; different body cannot reuse the key', async () => {
  const selected = await hold('patient.a', await firstSlot());
  const key = randomUUID();
  const body = { holdId: selected.id, holdVersion: selected.rowVersion, patientConfirmed: true, rulesAccepted: true };
  const responses = await Promise.all(Array.from({ length: 10 }, () => request('POST', '/appointments/confirm', 'patient.a', body, key)));
  const confirmed = responses.map(x => data<Appointment>(x));
  assert.equal(new Set(confirmed.map(x => x.id)).size, 1);
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM appointments WHERE hold_id=$1', [selected.id])).rows[0].n), 1);
  rejected(await request('POST', '/appointments/confirm', 'patient.a', { ...body, holdVersion: selected.rowVersion + 1 }, key), [409]);
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM command_receipts WHERE user_id=$1 AND command_key=$2', [identities['patient.a']!.user.id, key])).rows[0].n), 1);
  await cancel('patient.a', confirmed[0]!);
});

test('cancellation keeps history, releases capacity and duplicate cancellation produces one event', async () => {
  const appointment = await book();
  const key = randomUUID();
  const body = { intent: 'cancel', expectedVersion: appointment.rowVersion, reason: '测试资源释放' };
  const results = await Promise.all([request('POST', `/appointments/${appointment.id}/changes`, 'patient.a', body, key),
    request('POST', `/appointments/${appointment.id}/changes`, 'patient.a', body, key)]);
  results.forEach(x => assert.equal(data<Appointment>(x).status, 'cancelled'));
  assert.equal(Number((await db.query("SELECT count(*) AS n FROM appointment_events WHERE appointment_id=$1 AND kind='cancelled'", [appointment.id])).rows[0].n), 1);
  assert.equal((await db.query('SELECT status,cancellation_reason FROM appointments WHERE id=$1', [appointment.id])).rows[0].cancellation_reason, body.reason);
  assert.ok((await slots({ clinicId: appointment.clinicId, doctorId: appointment.doctorId, serviceId: appointment.serviceId })).some(x => x.startsAt === appointment.startsAt));
});

test('a stale appointment version cannot cancel or overwrite a confirmed booking', async () => {
  const appointment = await book();
  rejected(await request('POST', `/appointments/${appointment.id}/changes`, 'patient.a',
    { intent: 'cancel', expectedVersion: appointment.rowVersion + 1, reason: '过期版本' }, randomUUID()), [409]);
  const current = data<Appointment>(await request('GET', `/appointments/${appointment.id}`, 'patient.a'));
  assert.equal(current.status, 'confirmed');
  assert.equal(current.rowVersion, appointment.rowVersion);
  await cancel('patient.a', current);
});

test('a failed reschedule retains the original appointment, resources and version', async () => {
  const appointment = await book();
  rejected(await request('POST', `/appointments/${appointment.id}/changes`, 'patient.a',
    { intent: 'reschedule', expectedVersion: appointment.rowVersion, reason: '目标不存在', holdId: randomUUID(), holdVersion: 1 }, randomUUID()), [400, 403, 404, 409]);
  const current = data<Appointment>(await request('GET', `/appointments/${appointment.id}`, 'patient.a'));
  assert.equal(current.status, 'confirmed');
  assert.equal(current.rowVersion, appointment.rowVersion);
  const reservation = (await db.query('SELECT r.status FROM appointments a JOIN resource_reservations r ON r.id=a.reservation_id WHERE a.id=$1', [appointment.id])).rows[0];
  assert.equal(reservation.status, 'booked');
  await cancel('patient.a', current);
});

test('successful reschedule atomically preserves linked old/new records and exactly one booking', async () => {
  const appointment = await book();
  const candidates = await slots({ clinicId: appointment.clinicId, serviceId: appointment.serviceId });
  const target = candidates.find(x => new Date(x.startsAt).getTime() >= new Date(appointment.occupiedUntil).getTime());
  assert.ok(target);
  const selected = await hold('patient.a', target);
  const replacement = data<Appointment>(await request('POST', `/appointments/${appointment.id}/changes`, 'patient.a',
    { intent: 'reschedule', expectedVersion: appointment.rowVersion, reason: '测试追溯链', holdId: selected.id, holdVersion: selected.rowVersion }, randomUUID()));
  assert.notEqual(replacement.id, appointment.id);
  assert.equal(replacement.supersedesAppointmentId, appointment.id);
  assert.equal(replacement.status, 'confirmed');
  const old = data<Appointment>(await request('GET', `/appointments/${appointment.id}`, 'patient.a'));
  assert.equal(old.status, 'rescheduled');
  assert.equal(old.replacementAppointmentId, replacement.id);
  assert.equal((await db.query('SELECT r.status FROM appointments a JOIN resource_reservations r ON r.id=a.reservation_id WHERE a.id=$1', [appointment.id])).rows[0].status, 'released');
  await cancel('patient.a', replacement);
});

test('overlapping cross-clinic shifts cannot be published for the same doctor', async () => {
  const existing = shifts[0]!;
  const other = clinics.find(x => x.id !== existing.clinicId)!;
  rejected(await request('POST', '/staff/shifts', 'hq', { clinicId: other.id, doctorId: existing.doctorId,
    startsAt: existing.startsAt, endsAt: existing.endsAt, serviceIds: existing.serviceIds }), [400, 403, 409]);
  assert.equal((await db.query('SELECT status FROM doctor_shifts WHERE id=$1', [existing.id])).rows[0].status, 'published');
});

test('expired holds cannot confirm and their resource becomes available without a cleanup timer', async () => {
  const selected = await hold('patient.a', await firstSlot());
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("UPDATE resource_reservations SET expires_at=now()-interval '1 second' WHERE id=(SELECT reservation_id FROM booking_holds WHERE id=$1)", [selected.id]);
    await client.query("UPDATE booking_holds SET expires_at=now()-interval '1 second' WHERE id=$1", [selected.id]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  rejected(await request('POST', '/appointments/confirm', 'patient.a', { holdId: selected.id, holdVersion: selected.rowVersion,
    patientConfirmed: true, rulesAccepted: true }, randomUUID()), [409]);
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM appointments WHERE hold_id=$1', [selected.id])).rows[0].n), 0);
  const available = await slots({ clinicId: selected.slot.clinicId, doctorId: selected.slot.doctorId, serviceId: selected.slot.serviceId });
  assert.ok(available.some(x => x.startsAt === selected.slot.startsAt && x.chairId === selected.slot.chairId));
});

test('the unified PostgreSQL ledger rejects cross-doctor chair conflicts and patient conflicts, while half-open adjacent slots are valid', async () => {
  // Direct SQL, like the application write transaction, must persist expiry
  // before attempting a new occupancy; now() cannot be an index predicate.
  await db.query("UPDATE resource_reservations SET status='expired' WHERE status='held' AND expires_at<=clock_timestamp()");
  const selected = await firstSlot();
  const client = await db.connect();
  let reservationId: string | undefined;
  let adjacentId: string | undefined;
  const patientA = identities['patient.a']!.user.patientId!;
  const patientB = identities['patient.b']!.user.patientId!;
  const expiry = new Date(Date.now() + 600_000).toISOString();
  try {
    await client.query('BEGIN');
    const doctorId = (await client.query('INSERT INTO staff(employee_no,name,phone)VALUES($1,$2,$3)RETURNING id',
      ['TEST-' + randomBytes(5).toString('hex'), '合成约束医生', '13800008888'])).rows[0].id;
    const shiftId = (await client.query('INSERT INTO doctor_shifts(clinic_id,doctor_id,starts_at,ends_at,created_by)SELECT clinic_id,$2,starts_at,ends_at,$3 FROM doctor_shifts WHERE id=$1 RETURNING id',
      [selected.shiftId, doctorId, identities.hq!.user.id])).rows[0].id;
    const otherChairId = (await client.query('INSERT INTO chairs(clinic_id,name)VALUES($1,$2)RETURNING id',
      [selected.clinicId, '合成约束牙椅-' + randomBytes(4).toString('hex')])).rows[0].id;
    const insert = `INSERT INTO resource_reservations(patient_id,clinic_id,service_id,doctor_id,chair_id,shift_id,starts_at,ends_at,occupied_until,status,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'held',$10) RETURNING id`;
    const base = [patientA, selected.clinicId, selected.serviceId, selected.doctorId, selected.chairId,
      selected.shiftId, selected.startsAt, selected.endsAt, selected.occupiedUntil, expiry];
    reservationId = (await client.query(insert, base)).rows[0].id;
    await client.query('INSERT INTO booking_holds(reservation_id,created_by,expires_at)VALUES($1,$2,$3)',
      [reservationId, identities['patient.a']!.user.id, expiry]);
    await client.query('COMMIT');
    // The doctor and patient differ: this rejection specifically requires the chair constraint.
    await assert.rejects(db.query(insert, [patientB, selected.clinicId, selected.serviceId, doctorId, selected.chairId,
      shiftId, selected.startsAt, selected.endsAt, selected.occupiedUntil, expiry]),
    (error: unknown) => (error as { code?: string }).code === '23P01');
    // The doctor and chair differ: this rejection specifically requires the patient constraint.
    await assert.rejects(db.query(insert, [patientA, selected.clinicId, selected.serviceId, doctorId, otherChairId,
      shiftId, selected.startsAt, selected.endsAt, selected.occupiedUntil, expiry]),
    (error: unknown) => (error as { code?: string }).code === '23P01');
    // Starting exactly at occupied_until is legal under [start,end), including service buffer.
    const duration = new Date(selected.endsAt).getTime() - new Date(selected.startsAt).getTime();
    const occupiedDuration = new Date(selected.occupiedUntil).getTime() - new Date(selected.startsAt).getTime();
    const adjacentStart = new Date(selected.occupiedUntil).getTime();
    await client.query('BEGIN');
    adjacentId = (await client.query(insert, [patientA, selected.clinicId, selected.serviceId, selected.doctorId, selected.chairId,
      selected.shiftId, new Date(adjacentStart).toISOString(), new Date(adjacentStart + duration).toISOString(),
      new Date(adjacentStart + occupiedDuration).toISOString(), expiry])).rows[0].id;
    await client.query('INSERT INTO booking_holds(reservation_id,created_by,expires_at)VALUES($1,$2,$3)',
      [adjacentId, identities['patient.a']!.user.id, expiry]);
    await client.query('COMMIT');
    assert.ok(adjacentId);
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally {
    for (const id of [reservationId, adjacentId].filter(Boolean)) {
      await client.query("UPDATE resource_reservations SET status='released' WHERE id=$1", [id]);
    }
    client.release();
  }
});

test('a committed command can be recovered using the original key without granting another patient access', async () => {
  const selected = await hold('patient.a', await firstSlot());
  const key = randomUUID();
  const appointment = await confirm('patient.a', selected, key);
  const recovered = data<{ status: string; result?: Appointment }>(await request('GET', `/commands/${key}`, 'patient.a'));
  assert.equal(recovered.status, 'completed');
  assert.equal(recovered.result?.id, appointment.id);
  const other = data<{ status: string; result?: Appointment }>(await request('GET', `/commands/${key}`, 'patient.b'));
  assert.equal(other.status, 'not_found');
  assert.equal(other.result, undefined);
  await cancel('patient.a', appointment);
});

test('chair block removes affected slots even when the doctor is available', async () => {
  const selected = await firstSlot();
  const inserted = (await db.query('INSERT INTO chair_blocks(chair_id,starts_at,ends_at,reason,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id',
    [selected.chairId, selected.startsAt, selected.occupiedUntil, '合成维护停用', identities.hq!.user.id])).rows[0];
  try {
    const available = await slots({ clinicId: selected.clinicId, doctorId: selected.doctorId, serviceId: selected.serviceId });
    assert.ok(!available.some(x => x.chairId === selected.chairId && x.startsAt === selected.startsAt));
    rejected(await request('POST', '/booking-holds', 'patient.a', select(selected), randomUUID()), [409]);
  } finally { await db.query('DELETE FROM chair_blocks WHERE id=$1', [inserted.id]); }
});

test('service qualification requirements are AND conditions and must cover the entire service interval', async () => {
  const selected = await firstSlot();
  const extra = (await db.query("INSERT INTO qualifications(name)VALUES($1)RETURNING id", [`合成额外资格-${randomUUID()}`])).rows[0].id;
  await db.query('INSERT INTO service_qualifications(service_id,qualification_id)VALUES($1,$2)', [selected.serviceId, extra]);
  try {
    const unavailable = await slots({ clinicId: selected.clinicId, doctorId: selected.doctorId, serviceId: selected.serviceId });
    assert.equal(unavailable.length, 0, 'A doctor missing one required qualification must not be advertised');
    rejected(await request('POST', '/booking-holds', 'patient.a', select(selected), randomUUID()), [400, 409]);
    await db.query('INSERT INTO dentist_qualifications(dentist_id,qualification_id,valid_from,valid_until)VALUES($1,$2,$3,$4)',
      [selected.doctorId, extra, new Date(new Date(selected.startsAt).getTime() - 86_400_000).toISOString(), new Date(new Date(selected.startsAt).getTime() + 60_000).toISOString()]);
    const available = await slots({ clinicId: selected.clinicId, doctorId: selected.doctorId, serviceId: selected.serviceId });
    assert.ok(!available.some(x => x.startsAt === selected.startsAt), 'Expiring one minute after the start does not cover the service');
  } finally {
    await db.query('DELETE FROM dentist_qualifications WHERE qualification_id=$1', [extra]);
    await db.query('DELETE FROM service_qualifications WHERE qualification_id=$1', [extra]);
    await db.query('DELETE FROM qualifications WHERE id=$1', [extra]);
  }
});

test('SQL-looking credentials cannot bypass authentication or destroy application tables', async () => {
  rejected(await request('POST', '/auth/login', undefined, { username: "' OR 1=1 --", password, portal: 'patient' }), [400, 401]);
  rejected(await request('GET', `/appointments/${encodeURIComponent("';DROP TABLE patients;--")}`, 'patient.a'), [400, 404]);
  assert.ok(Number((await db.query('SELECT count(*) AS n FROM patients')).rows[0].n) >= 2);
});

test('appointment and audit events are append-only in PostgreSQL', async () => {
  const appointment = await book();
  await assert.rejects(db.query("UPDATE appointment_events SET reason='rewrite' WHERE appointment_id=$1", [appointment.id]),
    (error: unknown) => (error as { code?: string }).code === '23514');
  const audit = (await db.query('SELECT id FROM audit_events ORDER BY occurred_at DESC LIMIT 1')).rows[0];
  assert.ok(audit);
  await assert.rejects(db.query('DELETE FROM audit_events WHERE id=$1', [audit.id]),
    (error: unknown) => (error as { code?: string }).code === '23514');
  await cancel('patient.a', appointment);
});

test('confirmation rechecks resource status and qualifications after the hold was created', async () => {
  const changes = [
    { table: 'staff', id: (s: BookingSlot) => s.doctorId, field: 'active', invalid: false, valid: true },
    { table: 'chairs', id: (s: BookingSlot) => s.chairId, field: 'active', invalid: false, valid: true },
    { table: 'clinics', id: (s: BookingSlot) => s.clinicId, field: 'active', invalid: false, valid: true },
    { table: 'services', id: (s: BookingSlot) => s.serviceId, field: 'active', invalid: false, valid: true },
    { table: 'doctor_shifts', id: (s: BookingSlot) => s.shiftId, field: 'status', invalid: 'cancelled', valid: 'published' },
  ];
  for (const change of changes) {
    const selected = await hold('patient.a', await firstSlot());
    const id = change.id(selected.slot);
    // Only the isolated test database is altered, simulating a changed external
    // operating condition after a legitimate hold and before final confirmation.
    await db.query(`UPDATE ${change.table} SET ${change.field}=$2 WHERE id=$1`, [id, change.invalid]);
    try {
      rejected(await request('POST', '/appointments/confirm', 'patient.a',
        { holdId: selected.id, holdVersion: selected.rowVersion, patientConfirmed: true, rulesAccepted: true }, randomUUID()), [409]);
      assert.equal(Number((await db.query('SELECT count(*) AS n FROM appointments WHERE hold_id=$1', [selected.id])).rows[0].n), 0);
    } finally {
      await db.query(`UPDATE ${change.table} SET ${change.field}=$2 WHERE id=$1`, [id, change.valid]);
      await db.query("UPDATE resource_reservations SET status='released' WHERE id=(SELECT reservation_id FROM booking_holds WHERE id=$1)", [selected.id]);
    }
  }
  for (const invalidation of ['disabled', 'expires_during_service'] as const) {
    const selected = await hold('patient.a', await firstSlot());
    const required = (await db.query('SELECT q.id,dq.valid_until FROM service_qualifications sq JOIN qualifications q ON q.id=sq.qualification_id JOIN dentist_qualifications dq ON dq.qualification_id=q.id AND dq.dentist_id=$2 WHERE sq.service_id=$1 LIMIT 1',
      [selected.slot.serviceId, selected.slot.doctorId])).rows[0];
    assert.ok(required);
    if (invalidation === 'disabled') await db.query('UPDATE qualifications SET active=false WHERE id=$1', [required.id]);
    else await db.query('UPDATE dentist_qualifications SET valid_until=$3 WHERE dentist_id=$1 AND qualification_id=$2',
      [selected.slot.doctorId, required.id, new Date(Date.parse(selected.slot.startsAt) + 60_000).toISOString()]);
    try {
      rejected(await request('POST', '/appointments/confirm', 'patient.a',
        { holdId: selected.id, holdVersion: selected.rowVersion, patientConfirmed: true, rulesAccepted: true }, randomUUID()), [409]);
      assert.equal(Number((await db.query('SELECT count(*) AS n FROM appointments WHERE hold_id=$1', [selected.id])).rows[0].n), 0);
    } finally {
      await db.query('UPDATE qualifications SET active=true WHERE id=$1', [required.id]);
      await db.query('UPDATE dentist_qualifications SET valid_until=$3 WHERE dentist_id=$1 AND qualification_id=$2',
        [selected.slot.doctorId, required.id, required.valid_until]);
      await db.query("UPDATE resource_reservations SET status='released' WHERE id=(SELECT reservation_id FROM booking_holds WHERE id=$1)", [selected.id]);
    }
  }
});

test('a target becoming unavailable after a valid reschedule hold rolls back original state and events', async () => {
  const original = await book();
  const target = (await slots({ clinicId: original.clinicId, serviceId: original.serviceId }))
    .find(s => Date.parse(s.startsAt) >= Date.parse(original.occupiedUntil));
  assert.ok(target);
  const selected = await hold('patient.a', target);
  const block = (await db.query('INSERT INTO chair_blocks(chair_id,starts_at,ends_at,reason,created_by)VALUES($1,$2,$3,$4,$5)RETURNING id',
    [target.chairId, target.startsAt, target.occupiedUntil, '合成改期最终复核失败', identities.hq!.user.id])).rows[0].id;
  try {
    rejected(await request('POST', `/appointments/${original.id}/changes`, 'patient.a',
      { intent: 'reschedule', expectedVersion: original.rowVersion, reason: '最终资源条件改变', holdId: selected.id, holdVersion: selected.rowVersion }, randomUUID()), [409]);
    const current = data<Appointment>(await request('GET', `/appointments/${original.id}`, 'patient.a'));
    assert.equal(current.status, 'confirmed');
    assert.equal(current.rowVersion, original.rowVersion);
    assert.equal(current.replacementAppointmentId, null);
    assert.equal((await db.query('SELECT r.status FROM appointments a JOIN resource_reservations r ON r.id=a.reservation_id WHERE a.id=$1', [original.id])).rows[0].status, 'booked');
    assert.equal(Number((await db.query("SELECT count(*) AS n FROM appointment_events WHERE appointment_id=$1 AND kind='rescheduled'", [original.id])).rows[0].n), 0);
    assert.equal(Number((await db.query('SELECT count(*) AS n FROM appointments WHERE hold_id=$1', [selected.id])).rows[0].n), 0);
  } finally {
    await db.query('DELETE FROM chair_blocks WHERE id=$1', [block]);
    await db.query("UPDATE resource_reservations SET status='released' WHERE id=(SELECT reservation_id FROM booking_holds WHERE id=$1)", [selected.id]);
    await cancel('patient.a', original);
  }
});

test('a real PostgreSQL failure after old-resource release rolls back the entire reschedule', async () => {
  const original = await book();
  const target = (await slots({ clinicId: original.clinicId, serviceId: original.serviceId }))
    .find(s => Date.parse(s.startsAt) >= Date.parse(original.occupiedUntil));
  assert.ok(target);
  const selected = await hold('patient.a', target);
  const key = randomUUID();
  // A test-only PostgreSQL trigger verifies that execution has ALREADY changed
  // the original booking and released its ledger row, then rejects the new row.
  // This is a database fault, not a mocked Repository or an early invalid hold.
  await db.query(`CREATE FUNCTION test_reject_replacement_after_release() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.supersedes_appointment_id IS NOT NULL THEN
        IF NOT EXISTS(SELECT 1 FROM appointments prior JOIN resource_reservations r ON r.id=prior.reservation_id
          WHERE prior.id=NEW.supersedes_appointment_id AND prior.status='rescheduled' AND r.status='released') THEN
          RAISE EXCEPTION 'Test did not reach old-resource release' USING ERRCODE='P0001';
        END IF;
        RAISE EXCEPTION 'Synthetic downstream persistence failure after release' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER test_reject_replacement BEFORE INSERT ON appointments FOR EACH ROW EXECUTE FUNCTION test_reject_replacement_after_release()`);
  try {
    const response = await request('POST', `/appointments/${original.id}/changes`, 'patient.a',
      { intent: 'reschedule', expectedVersion: original.rowVersion, reason: '测试下游持久化失败', holdId: selected.id, holdVersion: selected.rowVersion }, key);
    rejected(response, [409]);
    assert.equal(response.json().error.code, 'BUSINESS_CONSTRAINT');
    const current = data<Appointment>(await request('GET', `/appointments/${original.id}`, 'patient.a'));
    assert.equal(current.status, 'confirmed');
    assert.equal(current.rowVersion, original.rowVersion);
    assert.equal(current.replacementAppointmentId, null);
    assert.equal((await db.query('SELECT r.status FROM appointments a JOIN resource_reservations r ON r.id=a.reservation_id WHERE a.id=$1', [original.id])).rows[0].status, 'booked');
    const holdState = (await db.query('SELECT h.consumed_at,h.row_version,r.status FROM booking_holds h JOIN resource_reservations r ON r.id=h.reservation_id WHERE h.id=$1', [selected.id])).rows[0];
    assert.equal(holdState.status, 'held');
    assert.equal(holdState.consumed_at, null);
    assert.equal(holdState.row_version, selected.rowVersion);
    assert.equal(Number((await db.query('SELECT count(*) AS n FROM appointments WHERE hold_id=$1', [selected.id])).rows[0].n), 0);
    assert.equal(Number((await db.query("SELECT count(*) AS n FROM appointment_events WHERE appointment_id=$1 AND kind='rescheduled'", [original.id])).rows[0].n), 0);
    assert.equal(Number((await db.query("SELECT count(*) AS n FROM audit_events WHERE target_id=$1 AND action='appointment.rescheduled'", [original.id])).rows[0].n), 0);
    assert.equal(Number((await db.query('SELECT count(*) AS n FROM command_receipts WHERE user_id=$1 AND command_key=$2', [identities['patient.a']!.user.id, key])).rows[0].n), 0);
  } finally {
    await db.query('DROP TRIGGER test_reject_replacement ON appointments; DROP FUNCTION test_reject_replacement_after_release()');
    await db.query("UPDATE resource_reservations SET status='released' WHERE id=(SELECT reservation_id FROM booking_holds WHERE id=$1)", [selected.id]);
    await cancel('patient.a', original);
  }
});

test('staff role revocation also blocks old idempotency receipts and command-result recovery', async () => {
  const front = identities['front.a']!;
  const clinicId = front.user.assignments[0]!.clinicId!;
  const target = await firstSlot({ clinicId });
  const selected = data<Hold>(await request('POST', '/booking-holds', 'front.a', { ...select(target), patientId: identities['patient.a']!.user.patientId }, randomUUID()));
  const key = randomUUID();
  const body = { holdId: selected.id, holdVersion: selected.rowVersion, patientId: identities['patient.a']!.user.patientId,
    patientConfirmed: true, rulesAccepted: true };
  const appointment = data<Appointment>(await request('POST', '/appointments/confirm', 'front.a', body, key));
  const grants = (await db.query('DELETE FROM role_assignments WHERE user_id=$1 RETURNING id,user_id,role,clinic_id', [front.user.id])).rows;
  try {
    rejected(await request('GET', `/commands/${key}`, 'front.a'), [403, 404]);
    rejected(await request('POST', '/appointments/confirm', 'front.a', body, key), [403, 404]);
    rejected(await request('GET', `/appointments/${appointment.id}`, 'front.a'), [403, 404]);
  } finally {
    for (const grant of grants) await db.query('INSERT INTO role_assignments(id,user_id,role,clinic_id)VALUES($1,$2,$3,$4)',
      [grant.id, grant.user_id, grant.role, grant.clinic_id]);
    await cancel('patient.a', appointment);
  }
});

test('cancellation policy is snapshotted at the hold and a later configuration cannot change the accepted rule', async () => {
  const strict = await createApp({ ...testConfig, CANCELLATION_NOTICE_MINUTES: 10080 }, db, false);
  await strict.ready();
  try {
    const oldHold = await hold('patient.a', await firstSlot());
    assert.equal(oldHold.policy.cancellationNoticeMinutes, 120);
    const oldAppointment = data<Appointment>(await requestAt(strict, 'POST', '/appointments/confirm', 'patient.a',
      { holdId: oldHold.id, holdVersion: oldHold.rowVersion, patientConfirmed: true, rulesAccepted: true }, randomUUID()));
    assert.equal(oldAppointment.policy.cancellationNoticeMinutes, 120, 'Confirmation preserves the policy displayed when the hold was created');
    const detail = data<Appointment>(await requestAt(strict, 'GET', `/appointments/${oldAppointment.id}`, 'patient.a'));
    assert.equal(detail.policy.cancellationNoticeMinutes, 120);
    const cancelled = data<Appointment>(await requestAt(strict, 'POST', `/appointments/${oldAppointment.id}/changes`, 'patient.a',
      { intent: 'cancel', expectedVersion: oldAppointment.rowVersion, reason: '原接受规则允许取消' }, randomUUID()));
    assert.equal(cancelled.status, 'cancelled', 'A new seven-day rule must not retroactively block an old two-hour booking');

    const newHold = data<Hold>(await requestAt(strict, 'POST', '/booking-holds', 'patient.a', select(await firstSlot()), randomUUID()));
    const newAppointment = data<Appointment>(await requestAt(strict, 'POST', '/appointments/confirm', 'patient.a',
      { holdId: newHold.id, holdVersion: newHold.rowVersion, patientConfirmed: true, rulesAccepted: true }, randomUUID()));
    assert.equal(newAppointment.policy.cancellationNoticeMinutes, 10080);
    const remaining = Date.parse(newAppointment.startsAt) - Date.now();
    assert.ok(remaining > 120 * 60_000 && remaining < 10080 * 60_000, 'Fixture must be inside seven days and outside two hours');
    const blocked = await request('POST', `/appointments/${newAppointment.id}/changes`, 'patient.a',
      { intent: 'cancel', expectedVersion: newAppointment.rowVersion, reason: '不能借旧服务的较短默认窗口绕过新规则' }, randomUUID());
    rejected(blocked, [409]);
    assert.equal(blocked.json().error.code, 'CANCELLATION_WINDOW_CLOSED');
    assert.equal(data<Appointment>(await request('GET', `/appointments/${newAppointment.id}`, 'patient.a')).status, 'confirmed');
  } finally { await strict.close(); }
});

test('confirmation waits for a concurrent qualification change and rechecks its committed state', async () => {
  const selected = await hold('patient.a', await firstSlot());
  const required = (await db.query('SELECT qualification_id AS id FROM service_qualifications WHERE service_id=$1 LIMIT 1', [selected.slot.serviceId])).rows[0];
  assert.ok(required);
  const writer = await db.connect();
  let pending: Promise<Response> | undefined;
  let completed: Response | undefined;
  try {
    await writer.query('BEGIN');
    await writer.query('UPDATE qualifications SET active=false WHERE id=$1', [required.id]);
    pending = request('POST', '/appointments/confirm', 'patient.a',
      { holdId: selected.id, holdVersion: selected.rowVersion, patientConfirmed: true, rulesAccepted: true }, randomUUID());
    let observedWait = false;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const waiting = await db.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FOR SHARE OF q%' LIMIT 1");
      if (waiting.rowCount) { observedWait = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    await writer.query('COMMIT');
    completed = await pending;
    assert.ok(observedWait, 'The confirmation must actually wait on the shared qualification row lock');
    rejected(completed, [409]);
    assert.equal(Number((await db.query('SELECT count(*) AS n FROM appointments WHERE hold_id=$1', [selected.id])).rows[0].n), 0);
  } finally {
    await writer.query('ROLLBACK');
    writer.release();
    if (pending && !completed) completed = await pending;
    await db.query('UPDATE qualifications SET active=true WHERE id=$1', [required.id]);
    if (completed && [200, 201].includes(completed.statusCode)) await cancel('patient.a', data<Appointment>(completed));
    else await db.query("UPDATE resource_reservations SET status='released' WHERE id=(SELECT reservation_id FROM booking_holds WHERE id=$1)", [selected.id]);
  }
});
