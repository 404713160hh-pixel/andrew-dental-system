import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, copyFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { start } from '../server/index.js';
import { createDatabase, verifyPassword } from '../server/db.js';
import { requiredTables } from '../server/migrations/manifest.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = mkdtempSync(join(tmpdir(), 'dental-maintenance-'));
const dbPath = join(temp, 'dental.sqlite'), snapshot = join(temp, 'snapshot.sqlite');
const env = { ...process.env, DENTAL_DB_PATH: dbPath };
const run = (script, args, extra = {}) => spawnSync(process.execPath, [resolve(root, script), ...args], { env: { ...env, ...extra }, encoding: 'utf8' });
let app;
const rejectedIncompleteTables = [];
try {
  app = await start({ dbPath, port: 0 });
  const login = await fetch(`http://127.0.0.1:${app.address.port}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'chen', password: 'Dental2026!', portal: 'customer' }) });
  assert.equal(login.status, 200);
  assert.equal(app.db.sql.prepare('SELECT count(*) AS count FROM sessions').get().count, 1);
  const initial = app.db.all('patients');
  let result = run('tools/database.mjs', ['backup', snapshot]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(snapshot));
  result = run('tools/database.mjs', ['restore', snapshot, '--offline']);
  assert.equal(result.status, 1, 'Running service restoration must fail');
  assert.match(result.stderr, /服务正在运行/);
  await app.close(); app = null;
  const changed = createDatabase(dbPath);
  changed.transaction(() => changed.put('patients', { ...initial[0], name: '维护测试变更', version: initial[0].version + 1 }));
  changed.close();
  const currentHash = createHash('sha256').update(readFileSync(dbPath)).digest('hex');
  // A healthy SQLite file can still be an incomplete application backup.
  // Each of these formerly unchecked tables is required by the real service.
  for (const table of ['schedules', 'treatments', 'qualifications', 'quarterReports', 'settings', 'audit']) {
    const incomplete = join(temp, `missing-${table}.sqlite`);
    copyFileSync(snapshot, incomplete);
    const broken = new DatabaseSync(incomplete, { enableForeignKeyConstraints: false });
    try {
      broken.exec(`DROP TABLE "${table}"`);
      assert.equal(broken.prepare('PRAGMA quick_check').get().quick_check, 'ok', 'Test fixture must be valid SQLite despite a missing application table');
    } finally { broken.close(); }
    result = run('tools/database.mjs', ['restore', incomplete, '--offline']);
    assert.equal(result.status, 1, `Restore must reject backup missing ${table}`);
    assert.match(result.stderr, /缺少必需表/);
    assert.ok(result.stderr.includes(table), `Failure must identify missing table ${table}`);
    assert.equal(createHash('sha256').update(readFileSync(dbPath)).digest('hex'), currentHash, 'Rejected restore must leave the current database byte-for-byte unchanged');
    const intact = new DatabaseSync(dbPath, { readOnly: true });
    try { assert.equal(intact.prepare('SELECT name FROM patients WHERE id=?').get(initial[0].id).name, '维护测试变更'); } finally { intact.close(); }
    rejectedIncompleteTables.push(table);
  }
  result = run('tools/database.mjs', ['restore', snapshot, '--offline']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).validatedTables, requiredTables.length, 'Restore must check every table declared across migrations');
  const restored = createDatabase(dbPath);
  assert.deepEqual(restored.all('patients'), initial);
  assert.equal(restored.sql.prepare('SELECT count(*) AS count FROM sessions').get().count, 0, 'Restored sessions must not reactivate old cookies');
  assert.equal(restored.sql.prepare('PRAGMA quick_check').get().quick_check, 'ok');
  restored.close();
  result = run('tools/accounts.mjs', ['set-password', 'manager'], { DENTAL_ACCOUNT_PASSWORD: 'Maintenance2026!' });
  assert.equal(result.status, 0, result.stderr);
  result = run('tools/accounts.mjs', ['create-staff', 'testfront', 'front', 'C001'], { DENTAL_ACCOUNT_PASSWORD: 'Maintenance2026!' });
  assert.equal(result.status, 0, result.stderr);
  const final = createDatabase(dbPath);
  assert.ok(verifyPassword('Maintenance2026!', final.sql.prepare('SELECT password_hash FROM users WHERE username=?').get('manager').password_hash));
  assert.equal(JSON.parse(final.sql.prepare('SELECT data FROM users WHERE username=?').get('testfront').data).role, 'front');
  assert.equal(final.sql.prepare('SELECT count(*) AS count FROM sessions').get().count, 0);
  final.close();
  result = run('tools/accounts.mjs', ['create-staff', 'testmanager', 'manager'], { DENTAL_ACCOUNT_PASSWORD: 'Maintenance2026!' });
  assert.equal(result.status, 0, result.stderr);
  const managerCheck = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const manager = JSON.parse(managerCheck.prepare('SELECT data FROM users WHERE username=?').get('testmanager').data);
    assert.equal(manager.role, 'manager');assert.deepEqual(manager.clinicIds, []);
  } finally { managerCheck.close(); }
  result = run('tools/accounts.mjs', ['create-staff', 'invalidhq', 'hq'], { DENTAL_ACCOUNT_PASSWORD: 'Maintenance2026!' });
  assert.equal(result.status, 1, 'Legacy HQ role must not be newly created');
  const emptyPath = join(temp, 'no-demo.sqlite');
  result = run('tools/accounts.mjs', ['list'], { DENTAL_DB_PATH: emptyPath, DENTAL_SEED_DEMO: '0' });
  assert.equal(result.status, 0, result.stderr);assert.deepEqual(JSON.parse(result.stdout), []);
  const emptyCheck = new DatabaseSync(emptyPath, { readOnly: true });
  try {
    assert.equal(emptyCheck.prepare('SELECT count(*) AS count FROM patients').get().count, 0);
    assert.equal(emptyCheck.prepare('SELECT cancellation_hours FROM settings WHERE id=?').get('global').cancellation_hours, 24);
  } finally { emptyCheck.close(); }
  console.log(JSON.stringify({ ok: true, requiredTablesChecked: requiredTables.length, checks: ['online snapshot integrity', 'restore blocked while server running', ...rejectedIncompleteTables.map(table => `restore rejects missing ${table}; current database unchanged`), 'offline restore contents match', 'restored sessions revoked', 'account password hash updated', 'front staff scope initialization', 'old sessions revoked', 'all-clinic manager initialization', 'legacy HQ creation rejected', 'environment disables demo seed'] }));
} finally {
  if (app) await app.close();
  const safeTemp = resolve(temp), tempRoot = resolve(tmpdir()) + sep;
  if (!safeTemp.startsWith(tempRoot) || !basename(safeTemp).startsWith('dental-maintenance-')) throw new Error('Unexpected temporary cleanup path');
  rmSync(safeTemp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
