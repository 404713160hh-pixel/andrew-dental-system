import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../src/config.js';
import type { LoginResult } from '../../shared/src/index.js';
import { createApp } from '../src/app.js';
import { authenticate, hashPassword, login } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { migrate, poolFor } from '../src/db.js';
import { seed } from '../src/seed.js';
import { enrichDemoData } from '../src/demo.js';
import { setDemoPasswords } from '../src/demo-passwords.js';

const databaseName = 'andrew_test_' + randomBytes(10).toString('hex');
const oldPassword = 'Demo-password-test-' + randomBytes(18).toString('base64url');
const names = ['hq', 'manager.a', 'front.a', 'doctor.a', 'patient.a', 'patient.b'];
let admin: Pool | undefined, db: Pool, config: Config, app: FastifyInstance | undefined, created = false;
let ordinaryId: string, ordinaryToken: string;
const oldTokens: string[] = [];

async function mutationSnapshot() {
  const result: Record<string, unknown> = {};
  for (const table of ['users', 'sessions', 'audit_events']) {
    result[table] = (await db.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM ${table} t`)).rows[0].rows;
  }
  return result;
}
async function assertRefused(message: RegExp, input: Pick<Config, 'NODE_ENV' | 'DATABASE_URL'> = config, options?: { enabled?: boolean }) {
  const before = await mutationSnapshot();
  await assert.rejects(setDemoPasswords(db, input, options ?? { enabled: true }), message);
  assert.deepEqual(await mutationSnapshot(), before);
}

before(async () => {
  const base = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  assert.ok(base, 'A real local PostgreSQL connection is required; there is no mock fallback.');
  assert.match(databaseName, /^andrew_test_[0-9a-f]{20}$/);
  const adminUrl = new URL(base); adminUrl.pathname = '/postgres'; admin = poolFor(adminUrl.toString());
  await admin.query(`CREATE DATABASE "${databaseName}"`); created = true;
  const target = new URL(base); target.pathname = '/' + databaseName; db = poolFor(target.toString());
  config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: target.toString(), ALLOW_DEMO_LOGIN: 'false' });
  await migrate(db); await seed(db, oldPassword); await enrichDemoData(db, 'test', config.TRANSFER_BUFFER_MINUTES);
  const hash = await hashPassword(oldPassword);
  ordinaryId = (await db.query("INSERT INTO users(username,password_hash,display_name,must_change_password) VALUES('ordinary.test',$1,'普通测试账号，不属于演示来源',true) RETURNING id", [hash])).rows[0].id;
  await db.query("INSERT INTO role_assignments(user_id,role,clinic_id) VALUES($1,'hq',NULL)", [ordinaryId]);
  ordinaryToken = (await login(db, config, { username: 'ordinary.test', password: oldPassword, portal: 'staff' })).token;
  await db.query('UPDATE users SET must_change_password=true WHERE username=ANY($1::text[])', [names]);
  for (const username of names) oldTokens.push((await login(db, config, { username, password: oldPassword, portal: username.startsWith('patient.') ? 'patient' : 'staff' })).token);
  app = await createApp(config, db, false); await app.ready();
}, { timeout: 120_000 });

after(async () => {
  if (app) await app.close(); if (db) await db.end();
  if (admin) try {
    if (created) {
      assert.match(databaseName, /^andrew_test_[0-9a-f]{20}$/);
      await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [databaseName]);
      await admin.query(`DROP DATABASE "${databaseName}"`);
    }
  } finally { await admin.end(); }
});

test('demo password maintenance rejects missing opt-in, production, ordinary database names and a mismatched live connection', async () => {
  await assertRefused(/opt-in/, config, {});
  await assertRefused(/opt-in/, config, { enabled: false });
  await assertRefused(/disabled in production/, { ...config, NODE_ENV: 'production' });
  for (const name of ['andrew_booking_dev', 'andrew_booking', 'andrew_test_ordinary']) {
    const url = new URL(config.DATABASE_URL); url.pathname = '/' + name;
    await assertRefused(/isolated preview or test database/, { ...config, DATABASE_URL: url.toString() });
  }
  const preview = new URL(config.DATABASE_URL); preview.pathname = '/andrew_booking_preview';
  await assertRefused(/Connected database does not match/, { ...config, DATABASE_URL: preview.toString() });
});

test('every required seed marker must exist; a missing marker leaves all accounts, sessions and audits unchanged', async () => {
  for (const key of ['seed:clinic:a', 'seed:clinic:b', 'seed:doctor:a', 'seed:patient:a', 'seed:patient:b']) {
    const marker = (await db.query('DELETE FROM demo_seed_records WHERE record_key=$1 RETURNING *', [key])).rows[0];
    try { await assertRefused(/Complete original demo provenance/); }
    finally {
      await db.query('INSERT INTO demo_seed_records(record_key,record_kind,record_id,enriched_at,created_at) VALUES($1,$2,$3,$4,$5)',
        [marker.record_key, marker.record_kind, marker.record_id, marker.enriched_at, marker.created_at]);
    }
  }
});

test('ordinary profiles, altered patient linkage, and unexpected privileges cannot be adopted as demo accounts', async () => {
  const doctorId = (await db.query("SELECT record_id FROM demo_seed_records WHERE record_key='seed:doctor:a'")).rows[0].record_id;
  await db.query('UPDATE staff SET is_demo=false WHERE id=$1', [doctorId]);
  try { await assertRefused(/fictional doctor account linkage/); }
  finally { await db.query('UPDATE staff SET is_demo=true WHERE id=$1', [doctorId]); }
  const patient = (await db.query("SELECT p.id,p.user_id FROM patients p JOIN users u ON u.id=p.user_id WHERE u.username='patient.a'")).rows[0];
  await db.query('UPDATE patients SET is_demo=false WHERE id=$1', [patient.id]);
  try { await assertRefused(/fictional patient profiles/); }
  finally { await db.query('UPDATE patients SET is_demo=true WHERE id=$1', [patient.id]); }
  await db.query('UPDATE patients SET user_id=$2 WHERE id=$1', [patient.id, ordinaryId]);
  try { await assertRefused(/fictional patient account linkage/); }
  finally { await db.query('UPDATE patients SET user_id=$2 WHERE id=$1', [patient.id, patient.user_id]); }
  const extra = (await db.query("INSERT INTO role_assignments(user_id,role,clinic_id) SELECT id,'hq',NULL FROM users WHERE username='patient.a' RETURNING id")).rows[0].id;
  try { await assertRefused(/original demo role assignments/); }
  finally { await db.query('DELETE FROM role_assignments WHERE id=$1', [extra]); }
});

test('failure during the final per-account audit rolls back earlier hashes, account versions, session revocations and audit writes', async () => {
  await db.query(`CREATE FUNCTION reject_last_demo_password_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action='demo.account.password_reset' AND NEW.detail->>'username'='patient.b' THEN
      RAISE EXCEPTION 'intentional integration audit failure'; END IF; RETURN NEW; END $$`);
  await db.query('CREATE TRIGGER reject_last_demo_password_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_last_demo_password_audit()');
  try { await assertRefused(/intentional integration audit failure/); }
  finally {
    await db.query('DROP TRIGGER reject_last_demo_password_audit ON audit_events');
    await db.query('DROP FUNCTION reject_last_demo_password_audit()');
  }
});

test('only the six original fictional accounts receive independent admin123 hashes, cleared change flags, version increments, revoked sessions and audits', async () => {
  assert.ok(app);
  const beforeUsers = (await db.query('SELECT id,username,account_version,password_hash FROM users ORDER BY username')).rows;
  const ordinaryBefore = (await db.query('SELECT to_jsonb(u) AS row FROM users u WHERE id=$1', [ordinaryId])).rows[0].row;
  const ordinarySessions = (await db.query('SELECT * FROM sessions WHERE user_id=$1 ORDER BY token_hash', [ordinaryId])).rows;
  const result = await setDemoPasswords(db, config, { enabled: true });
  assert.equal(result.changed, 6); assert.equal(result.sessionsRevoked, 6); assert.deepEqual(result.usernames, names);
  const afterUsers = (await db.query('SELECT id,username,account_version,password_hash,must_change_password FROM users ORDER BY username')).rows;
  assert.equal(afterUsers.length, beforeUsers.length, 'No account may be created by maintenance');
  const targets = afterUsers.filter(user => names.includes(user.username));
  assert.equal(new Set(targets.map(user => user.password_hash)).size, 6, 'Each hash requires a distinct salt');
  for (const user of targets) {
    assert.match(user.password_hash, /^scrypt:[0-9a-f]{48}:[0-9a-f]{128}$/);
    assert.equal(user.must_change_password, false);
    assert.equal(user.account_version, beforeUsers.find(before => before.id === user.id)!.account_version + 1);
    assert.notEqual(user.password_hash, beforeUsers.find(before => before.id === user.id)!.password_hash);
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: user.username, password: 'admin123', portal: user.username.startsWith('patient.') ? 'patient' : 'staff' } });
    assert.equal(response.statusCode, 200, user.username + ': ' + response.body);
    const authenticated = response.json().data as LoginResult;
    assert.equal(authenticated.user.id, user.id); assert.equal(authenticated.user.mustChangePassword, false);
    await assert.rejects(login(db, config, { username: user.username, password: oldPassword, portal: user.username.startsWith('patient.') ? 'patient' : 'staff' }), /账号或密码不正确/);
  }
  for (const token of oldTokens) await assert.rejects(authenticate(db, 'Bearer ' + token), /登录已失效/);
  assert.equal((await authenticate(db, 'Bearer ' + ordinaryToken)).id, ordinaryId);
  assert.deepEqual((await db.query('SELECT to_jsonb(u) AS row FROM users u WHERE id=$1', [ordinaryId])).rows[0].row, ordinaryBefore);
  assert.deepEqual((await db.query('SELECT * FROM sessions WHERE user_id=$1 ORDER BY token_hash', [ordinaryId])).rows, ordinarySessions);
  await assert.rejects(login(db, config, { username: 'ordinary.test', password: 'admin123', portal: 'staff' }), /账号或密码不正确/);
  const audits = (await db.query("SELECT actor_id,target_id,request_id,detail FROM audit_events WHERE action='demo.account.password_reset' ORDER BY target_id")).rows;
  assert.equal(audits.length, 6); assert.deepEqual(audits.map(audit => audit.target_id).sort(), targets.map(user => user.id).sort());
  for (const audit of audits) {
    assert.equal(audit.actor_id, null); assert.equal(audit.request_id, result.requestId); assert.equal(audit.detail.synthetic, true);
    assert.doesNotMatch(JSON.stringify(audit), /admin123|scrypt:|password_hash/);
  }
}, { timeout: 30_000 });

test('ordinary users still require a twelve-character new password', async () => {
  assert.ok(app);
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/change-password', headers: { authorization: 'Bearer ' + ordinaryToken }, payload: { currentPassword: oldPassword, newPassword: 'admin123' } });
  assert.equal(response.statusCode, 400);
  assert.equal((await authenticate(db, 'Bearer ' + ordinaryToken)).id, ordinaryId);
  assert.ok(await login(db, config, { username: 'ordinary.test', password: oldPassword, portal: 'staff' }));
});
