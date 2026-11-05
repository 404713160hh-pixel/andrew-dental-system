import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { Config } from './config.js';
import { audit, hashPassword } from './auth.js';
import { one, transaction } from './db.js';

const usernames = ['hq', 'manager.a', 'front.a', 'doctor.a', 'patient.a', 'patient.b'] as const;
const markerKinds = {
  'seed:clinic:a': 'clinic', 'seed:clinic:b': 'clinic', 'seed:doctor:a': 'doctor',
  'seed:patient:a': 'patient', 'seed:patient:b': 'patient',
} as const;
const allowedDatabase = (name: string) => name === 'andrew_booking_preview' || /^andrew_test_[0-9a-f]+$/.test(name);
function ensure(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

/** Deliberately separate from password-policy APIs: only the original six fictional accounts. */
export async function setDemoPasswords(pool: pg.Pool, config: Pick<Config, 'NODE_ENV' | 'DATABASE_URL'>, options: { enabled?: boolean } = {}) {
  ensure(config.NODE_ENV === 'development' || config.NODE_ENV === 'test', 'Demo password maintenance is disabled in production');
  ensure(options.enabled === true, 'Explicit demo password maintenance opt-in is required');
  const databaseName = decodeURIComponent(new URL(config.DATABASE_URL).pathname.slice(1));
  ensure(allowedDatabase(databaseName), 'Demo password maintenance requires the isolated preview or test database');
  return transaction(pool, async db => {
    const actual = await one<{ name: string }>(db, 'SELECT current_database() AS name');
    ensure(actual?.name === databaseName && allowedDatabase(actual.name), 'Connected database does not match the allowed demo database');
    // Coordinate with account administration, then lock all six targets before validating or writing.
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended('andrew.booking.staff-accounts',0))");
    const users = (await db.query<{ id: string; username: string; active: boolean; created_at: string; account_version: number }>(
      'SELECT id,username,active,created_at::text,account_version FROM users WHERE username=ANY($1::text[]) ORDER BY id FOR UPDATE', [usernames])).rows;
    ensure(users.length === usernames.length && users.every(user => user.active), 'All six original active demo accounts are required; no account was created');
    const byName = new Map(users.map(user => [user.username, user]));
    // Seed creates these users in one transaction. A later ordinary replacement must fail closed.
    ensure(users.every(user => user.created_at === byName.get('doctor.a')!.created_at), 'The original demo account batch could not be verified');
    const markers = (await db.query<{ record_key: string; record_kind: string; record_id: string }>(
      'SELECT record_key,record_kind,record_id FROM demo_seed_records WHERE record_key=ANY($1::text[]) ORDER BY record_key FOR SHARE', [Object.keys(markerKinds)])).rows;
    const markerMap = new Map(markers.map(marker => [marker.record_key, marker]));
    const id = (key: keyof typeof markerKinds) => {
      const marker = markerMap.get(key);
      ensure(marker?.record_kind === markerKinds[key], 'Complete original demo provenance is required; no account was changed');
      return marker.record_id;
    };
    const clinicA = id('seed:clinic:a'), clinicB = id('seed:clinic:b');
    ensure(clinicA !== clinicB, 'Demo clinic provenance must identify two distinct clinics');
    const clinics = (await db.query<{ active: boolean; address: string; description: string }>(
      'SELECT active,address,description FROM clinics WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE', [[clinicA, clinicB]])).rows;
    ensure(clinics.length === 2 && clinics.every(clinic => clinic.active && /虚构|课程演示/.test(clinic.address + ' ' + clinic.description)), 'Only explicitly fictional demo clinics may be used');
    const staff = (await db.query<{ id: string; user_id: string; active: boolean; is_demo: boolean; is_dentist: boolean }>(
      'SELECT id,user_id,active,is_demo,is_dentist FROM staff WHERE user_id=ANY($1::uuid[]) OR id=$2 ORDER BY id FOR SHARE', [users.map(user => user.id), id('seed:doctor:a')])).rows;
    ensure(staff.length === 1 && staff[0]!.id === id('seed:doctor:a') && staff[0]!.user_id === byName.get('doctor.a')!.id
      && staff[0]!.active && staff[0]!.is_demo && staff[0]!.is_dentist, 'The fictional doctor account linkage could not be verified');
    const patients = (await db.query<{ id: string; user_id: string; is_demo: boolean; created_at: string }>(
      'SELECT id,user_id,is_demo,created_at::text FROM patients WHERE user_id=ANY($1::uuid[]) OR id=ANY($2::uuid[]) ORDER BY id FOR SHARE',
      [users.map(user => user.id), [id('seed:patient:a'), id('seed:patient:b')]])).rows;
    ensure(patients.length === 2 && patients.every(patient => patient.is_demo && patient.created_at === byName.get('doctor.a')!.created_at), 'The original fictional patient profiles could not be verified');
    for (const [username, key] of [['patient.a', 'seed:patient:a'], ['patient.b', 'seed:patient:b']] as const) {
      ensure(patients.some(patient => patient.id === id(key) && patient.user_id === byName.get(username)!.id), 'The fictional patient account linkage could not be verified');
    }
    const roles = (await db.query<{ user_id: string; role: string; clinic_id: string | null }>(
      'SELECT user_id,role,clinic_id FROM role_assignments WHERE user_id=ANY($1::uuid[]) ORDER BY id FOR SHARE', [users.map(user => user.id)])).rows;
    const expected: Record<typeof usernames[number], string[]> = {
      hq: ['hq:'], 'manager.a': ['manager:' + clinicA], 'front.a': ['front:' + clinicA],
      'doctor.a': ['doctor:' + clinicA, 'doctor:' + clinicB], 'patient.a': [], 'patient.b': [],
    };
    for (const username of usernames) {
      const assigned = roles.filter(role => role.user_id === byName.get(username)!.id).map(role => role.role + ':' + (role.clinic_id ?? '')).sort();
      ensure(JSON.stringify(assigned) === JSON.stringify(expected[username].sort()), 'The original demo role assignments could not be verified');
    }
    const requestId = 'demo-passwords-' + randomUUID();
    let sessionsRevoked = 0;
    for (const username of usernames) {
      const user = byName.get(username)!;
      // Each account receives an independently salted scrypt hash.
      const hash = await hashPassword('admin123');
      await db.query('UPDATE users SET password_hash=$2,must_change_password=false,account_version=account_version+1 WHERE id=$1', [user.id, hash]);
      const revoked = await db.query('DELETE FROM sessions WHERE user_id=$1', [user.id]);
      sessionsRevoked += revoked.rowCount ?? 0;
      await audit(db, null, 'demo.account.password_reset', user.id, requestId, { synthetic: true, username, accountVersion: user.account_version + 1, sessionsRevoked: revoked.rowCount ?? 0 });
    }
    return { changed: usernames.length, usernames: [...usernames], sessionsRevoked, requestId };
  });
}
