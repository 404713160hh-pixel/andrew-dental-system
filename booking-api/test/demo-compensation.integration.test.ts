import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { before, after, test } from 'node:test';
import type { Pool } from 'pg';
import { migrate, poolFor } from '../src/db.js';
import { loadConfig, type Config } from '../src/config.js';
import { seed } from '../src/seed.js';
import { enrichDemoData } from '../src/demo.js';
import { prepareDemoCompensation } from '../src/demo-compensation.js';
import { login, verifyPassword } from '../src/auth.js';
import { createApp } from '../src/app.js';

const name = 'andrew_test_' + randomBytes(10).toString('hex');
const password = 'Synthetic-quarter-' + randomBytes(16).toString('hex');
let admin: Pool, db: Pool, config: Config, created = false, originalPasswords: unknown;
async function counts() {
  const result: Record<string, number> = {};
  for (const table of ['users', 'staff', 'demo_seed_records', 'incentive_months', 'doctor_financial_sources', 'incentive_pools', 'incentive_pool_sources', 'doctor_quarter_results', 'incentive_allocations', 'incentive_payments', 'audit_events'])
    result[table] = Number((await db.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
  return result;
}
before(async () => {
  const base = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  assert.ok(base, 'Real isolated PostgreSQL is required');
  const root = new URL(base); root.pathname = '/postgres'; admin = poolFor(root.href);
  await admin.query(`CREATE DATABASE "${name}"`); created = true;
  root.pathname = '/' + name; db = poolFor(root.href);
  config = loadConfig({ DATABASE_URL: root.href, NODE_ENV: 'development', ALLOW_DEMO_LOGIN: 'false' });
  await migrate(db); await seed(db, password); await enrichDemoData(db, 'development', config.TRANSFER_BUFFER_MINUTES);
  originalPasswords = (await db.query('SELECT id,password_hash FROM users ORDER BY id')).rows;
}, { timeout: 120000 });
after(async () => {
  if (db) await db.end();
  if (admin) try { if (created) { assert.match(name, /^andrew_test_[a-f0-9]{20}$/); await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [name]); await admin.query(`DROP DATABASE "${name}"`); } } finally { await admin.end(); }
});
test('quarterly demo requires explicit opt-in, development and a course database allowlist without writes', async () => {
  const before = await counts();
  await assert.rejects(prepareDemoCompensation(db, config), /ANDREW_DEMO_COMPENSATION/);
  for (const mode of ['production', 'test'] as const) await assert.rejects(prepareDemoCompensation(db, { ...config, NODE_ENV: mode }, { enabled: true }), /development/);
  const url = new URL(config.DATABASE_URL); url.pathname = '/ordinary_clinic';
  await assert.rejects(prepareDemoCompensation(db, { ...config, DATABASE_URL: url.href }, { enabled: true }), /preview\/test/);
  assert.deepEqual(await counts(), before);
});
test('existing ordinary monthly data blocks maintenance before any profiles, users or financial changes', async () => {
  const clinic = (await db.query("SELECT record_id FROM demo_seed_records WHERE record_key='seed:clinic:a'")).rows[0].record_id;
  const user = (await db.query("SELECT id FROM users WHERE username='hq'")).rows[0].id;
  const staff = (await db.query("SELECT id FROM staff WHERE employee_no='D001'")).rows[0].id;
  const row = (await db.query("INSERT INTO incentive_months(clinic_id,month,reference,no_activity,created_by,created_staff_id,updated_by)VALUES($1,'2026-07-01','普通账证，不可覆盖',true,$2,$3,$2)RETURNING id", [clinic, user, staff])).rows[0];
  const before = await counts();
  await assert.rejects(prepareDemoCompensation(db, config, { enabled: true }), /ordinary monthly/);
  assert.deepEqual(await counts(), before);
  await db.query('DELETE FROM incentive_months WHERE id=$1', [row.id]);
});
test('domain workflow creates six closed worksheets, independent approval and an exact 10 percent fictional fund', async () => {
  const result = await prepareDemoCompensation(db, config, { enabled: true });
  assert.equal(result.monthsAdded, 6); assert.equal(result.quarterAdded, true); assert.equal(result.doctors, 8);
  assert.equal(result.netProfitCents, 2250000); assert.equal(result.fundCents, 225000); assert.equal(result.doctorAllocationCents, 158824);
  const quarter = (await db.query("SELECT * FROM incentive_pools WHERE quarter='2026-Q3'")).rows[0];
  assert.equal(quarter.status, 'approved'); assert.notEqual(quarter.created_by, quarter.approved_by); assert.notEqual(quarter.created_staff_id, quarter.approved_staff_id);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM incentive_months WHERE status='closed' AND created_by<>closed_by AND created_staff_id<>closed_staff_id")).rows[0].n, 6);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM doctor_financial_sources')).rows[0].n, 48);
  assert.deepEqual((await db.query('SELECT amount_cents::int AS amount FROM incentive_allocations ORDER BY employee_no')).rows.map(r => r.amount), [158824, 66176, 0, 0, 0, 0, 0, 0]);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM incentive_payments')).rows[0].n, 0);
});
test('replay is additive and idempotent; six original passwords remain unchanged and the audit actor cannot log in', async () => {
  const before = await counts(); const result = await prepareDemoCompensation(db, config, { enabled: true });
  assert.equal(result.monthsAdded, 0); assert.equal(result.quarterAdded, false); assert.deepEqual(await counts(), before);
  assert.deepEqual((await db.query("SELECT id,password_hash FROM users WHERE username<>'demo.incentive.audit' ORDER BY id")).rows, originalPasswords);
  const audit = (await db.query("SELECT password_hash FROM users WHERE username='demo.incentive.audit'")).rows[0];
  assert.equal(await verifyPassword('admin123', audit.password_hash), false);
  await assert.rejects(login(db, config, { username: 'demo.incentive.audit', password, portal: 'staff' }), /账号或密码/);
});
test('doctor reads only their approved personal allocation through the actual API', async () => {
  const app = await createApp(config, db, false);
  try {
    const auth = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'doctor.a', password, portal: 'staff' } });
    assert.equal(auth.statusCode, 200, auth.body);
    const response = await app.inject({ method: 'GET', url: '/api/v1/compensation/me', headers: { authorization: 'Bearer ' + auth.json().data.token } });
    assert.equal(response.statusCode, 200, response.body); const own = response.json().data;
    assert.equal(own.allocations.length, 1); assert.equal(own.allocations[0].amountCents, 158824); assert.equal(own.allocations[0].quarter, '2026-Q3');
  } finally { await app.close(); }
});
