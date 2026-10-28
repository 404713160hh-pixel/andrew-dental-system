import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Pool, PoolClient } from 'pg';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config.js';
import { migrate, poolFor } from '../src/db.js';
import { createApp } from '../src/app.js';
import { seed } from '../src/seed.js';
import { projectRoot } from '../src/paths.js';
import { join } from 'node:path';

const suffix = randomBytes(10).toString('hex');
const databaseName = 'andrew_test_' + suffix;
const roleName = 'andrew_test_' + suffix;
const runtimePassword = randomBytes(24).toString('hex');
const seedPassword = 'Test-' + randomBytes(18).toString('base64url');
let admin: Pool | undefined, migration: Pool | undefined, runtime: Pool | undefined, app: FastifyInstance | undefined;
let databaseCreated = false, roleCreated = false;

async function provision(client: PoolClient, script: string) {
  await client.query("SELECT set_config('andrew.runtime_user',$1,false),set_config('andrew.runtime_password',$2,false),set_config('andrew.bootstrap_password',$3,false)", [roleName, runtimePassword, randomBytes(24).toString('hex')]);
  try { await client.query(script); } catch (error) { await client.query('ROLLBACK'); throw error; }
}

before(async () => {
  assert.match(databaseName, /^andrew_test_[0-9a-f]{20}$/);
  const base = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  assert.ok(base, 'A real local PostgreSQL test server is required');
  const adminUrl = new URL(base); adminUrl.pathname = '/postgres';
  admin = poolFor(adminUrl.toString());
  await admin.query(`CREATE DATABASE "${databaseName}"`); databaseCreated = true;
  const migrationUrl = new URL(base); migrationUrl.pathname = '/' + databaseName;
  migration = poolFor(migrationUrl.toString());
  await migrate(migration); await seed(migration, seedPassword);
  const psql = await readFile(join(projectRoot, 'deploy/booking/provision-runtime.sql'), 'utf8');
  const start = psql.indexOf('BEGIN;'); assert.ok(start > 0);
  const sql = psql.slice(start);
  const connection = await migration.connect();
  try {
    await provision(connection, sql); roleCreated = true;
    await provision(connection, sql); // rerunning on upgrades is safe
  } finally { connection.release(); }
  const runtimeUrl = new URL(migrationUrl); runtimeUrl.username = roleName; runtimeUrl.password = runtimePassword;
  runtime = poolFor(runtimeUrl.toString());
  app = await createApp(loadConfig({ NODE_ENV: 'test', DATABASE_URL: runtimeUrl.toString(), ALLOW_DEMO_LOGIN: 'false' }), runtime, false);
  await app.ready();
}, { timeout: 120_000 });

after(async () => {
  if (app) await app.close();
  if (runtime) await runtime.end();
  if (migration) await migration.end();
  if (admin) {
    try {
      if (databaseCreated) {
        assert.match(databaseName, /^andrew_test_[0-9a-f]{20}$/);
        await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [databaseName]);
        await admin.query(`DROP DATABASE "${databaseName}"`);
      }
      if (roleCreated) {
        assert.match(roleName, /^andrew_test_[0-9a-f]{20}$/);
        await admin.query(`DROP ROLE "${roleName}"`);
      }
    } finally { await admin.end(); }
  }
});

test('runtime role can serve real API login without migration privileges', async () => {
  assert.ok(runtime && app);
  const health = await app.inject({ method: 'GET', url: '/api/v1/health' });
  assert.equal(health.statusCode, 200);
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'hq', password: seedPassword, portal: 'staff' } });
  assert.equal(login.statusCode, 200, login.body);
  assert.ok(login.json().data.token);
  const staffToken = login.json().data.token as string;
  const patientLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'patient.a', password: seedPassword, portal: 'patient' } });
  assert.equal(patientLogin.statusCode, 200, patientLogin.body);
  const patientToken = patientLogin.json().data.token as string;
  const shiftResponse = await app.inject({ method: 'GET', url: '/api/v1/shifts', headers: { authorization: 'Bearer ' + staffToken } });
  assert.equal(shiftResponse.statusCode, 200, shiftResponse.body);
  const shift = shiftResponse.json().data[0]; assert.ok(shift);
  const date = new Date(Date.parse(shift.startsAt) + 8 * 3600000).toISOString().slice(0, 10);
  const query = new URLSearchParams({ clinicId: shift.clinicId, serviceId: shift.serviceIds[0], doctorId: shift.doctorId, date });
  const available = await app.inject({ method: 'GET', url: '/api/v1/booking-slots?' + query });
  assert.equal(available.statusCode, 200, available.body);
  const slot = available.json().data[0]; assert.ok(slot);
  const hold = await app.inject({ method: 'POST', url: '/api/v1/booking-holds', headers: { authorization: 'Bearer ' + patientToken }, payload: {
    clinicId: slot.clinicId, serviceId: slot.serviceId, doctorId: slot.doctorId, chairId: slot.chairId, shiftId: slot.shiftId, startsAt: slot.startsAt,
  } });
  assert.equal(hold.statusCode, 200, hold.body);
  const held = hold.json().data;
  const confirmed = await app.inject({ method: 'POST', url: '/api/v1/appointments/confirm', headers: { authorization: 'Bearer ' + patientToken, 'idempotency-key': randomUUID() }, payload: {
    holdId: held.id, holdVersion: held.rowVersion, patientConfirmed: true, rulesAccepted: true,
  } });
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  assert.equal(confirmed.json().data.status, 'confirmed');
  const createdAccount = await app.inject({ method:'POST',url:'/api/v1/staff/accounts',headers:{authorization:'Bearer '+staffToken},payload:{
    username:'runtime.test',displayName:'隔离测试前台',temporaryPassword:seedPassword,staffId:null,assignments:[{role:'front',clinicId:shift.clinicId}],
  }});
  assert.equal(createdAccount.statusCode,200,createdAccount.body);
  const account=createdAccount.json().data;
  const updatedAccount = await app.inject({ method:'PUT',url:'/api/v1/staff/accounts/'+account.id,headers:{authorization:'Bearer '+staffToken},payload:{
    displayName:'隔离测试店长',staffId:null,active:true,assignments:[{role:'manager',clinicId:shift.clinicId}],expectedVersion:account.accountVersion,
  }});
  assert.equal(updatedAccount.statusCode,200,updatedAccount.body);
  for (const table of ['sessions','patient_allergies','role_assignments','dentist_qualifications','clinic_services','service_qualifications']) {
    await runtime.query('DELETE FROM '+table+' WHERE false');
  }
  assert.ok((await runtime.query('SELECT version FROM schema_migrations LIMIT 1')).rows.length);
  const noPermission = (error: unknown) => (error as { code?: string }).code === '42501';
  await assert.rejects(runtime.query('CREATE TABLE runtime_forbidden(id integer)'), noPermission);
  await assert.rejects(runtime.query('CREATE TEMP TABLE runtime_forbidden(id integer)'), noPermission);
  await assert.rejects(runtime.query("UPDATE schema_migrations SET checksum='forbidden'"), noPermission);
  await assert.rejects(runtime.query('DELETE FROM audit_events'), noPermission);
  await assert.rejects(runtime.query('DELETE FROM patients WHERE id IS NULL'), noPermission);
  const patient = patientLogin.json().data.user;
  const consent = await runtime.query(`INSERT INTO patient_privacy_consents(patient_id,actor_id,policy_version,notice_accepted,sensitive_accepted)
    VALUES($1,$2,'test',true,true) RETURNING id`,[patient.patientId,patient.id]);
  const consentId = consent.rows[0].id;
  await runtime.query('UPDATE patient_privacy_consents SET revoked_at=clock_timestamp() WHERE id=$1',[consentId]);
  await assert.rejects(runtime.query('UPDATE patient_privacy_consents SET policy_version=$2 WHERE id=$1',[consentId,'forbidden']), noPermission);
  await assert.rejects(runtime.query('DELETE FROM patient_privacy_consents WHERE id=$1',[consentId]), noPermission);
});
