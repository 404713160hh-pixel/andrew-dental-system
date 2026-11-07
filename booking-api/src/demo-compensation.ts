import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import type { FastifyRequest } from 'fastify';
import type { FinancialSourceInput, IncentiveMonth, IncentiveQuarterDetail, Principal } from '@andrew/shared';
import type { Config } from './config.js';
import { audit, principal } from './auth.js';
import { one, transaction } from './db.js';
import { registerCompensationRoutes } from './compensation.js';

const tag = '虚构演示-季度激励-v1';
const months = ['2026-07', '2026-08', '2026-09'];
const doctorKeys = ['seed:doctor:a', 'seed:doctor:b', ...['c', 'd', 'e', 'f', 'g', 'h'].map(x => 'demo:doctor:' + x)];
const ensure: (condition: unknown, message: string) => asserts condition = (condition, message) => { if (!condition) throw new Error(message); };

/** Explicit course-preview maintenance only. Never called by seed/start/migrate. */
export async function prepareDemoCompensation(pool: pg.Pool, config: Config, options: { enabled?: boolean } = {}) {
  ensure(options.enabled, 'Set ANDREW_DEMO_COMPENSATION=1 explicitly');
  ensure(config.NODE_ENV === 'development', 'Quarterly demo requires development mode');
  const configured = decodeURIComponent(new URL(config.DATABASE_URL).pathname.slice(1));
  ensure(configured === 'andrew_booking_preview' || /^andrew_test_[a-z0-9_]+$/.test(configured), 'Quarterly demo requires a named course preview/test database');
  return transaction(pool, async db => {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended('andrew.demo.compensation',0))");
    ensure((await one<{ name: string }>(db, 'SELECT current_database() AS name'))?.name === configured, 'Configured and connected databases differ');
    const markers = (await db.query<{ record_key: string; record_kind: string; record_id: string }>('SELECT record_key,record_kind,record_id FROM demo_seed_records')).rows;
    const byKey = new Map(markers.map(r => [r.record_key, r]));
    const marked = (key: string, kind: string) => { const m = byKey.get(key); ensure(m?.record_kind === kind, 'Complete demo provenance required; run demo enrichment first'); return m.record_id; };
    const clinicIds = ['seed:clinic:a', 'seed:clinic:b'].map(key => marked(key, 'clinic'));
    const registered = (await db.query<{ id: string }>('SELECT id FROM clinics ORDER BY id')).rows.map(r => r.id);
    ensure(registered.length === 2 && registered.every(id => clinicIds.includes(id)), 'Exactly the two provenance-marked course clinics are required');
    const doctorIds = doctorKeys.map(key => marked(key, 'doctor'));
    const doctors = (await db.query<{ id: string; employee_no: string }>('SELECT id,employee_no FROM staff WHERE id=ANY($1::uuid[]) AND is_demo AND is_dentist AND active', [doctorIds])).rows;
    ensure(doctors.length === 8, 'Eight active fictional doctors are required');
    const users = (await db.query<{ id: string; username: string; created_at: string }>("SELECT id,username,created_at::text FROM users WHERE username=ANY($1::text[]) AND active", [['hq', 'manager.a', 'front.a', 'doctor.a', 'patient.a', 'patient.b']])).rows;
    ensure(users.length === 6 && users.every(u => u.created_at === users[0]!.created_at), 'Original six course accounts must be present');
    const byName = new Map(users.map(u => [u.username, u]));
    ensure(await one(db, 'SELECT 1 FROM staff WHERE id=$1 AND user_id=$2', [doctorIds[0], byName.get('doctor.a')!.id]), 'Original fictional doctor linkage required');
    const existingMonths = (await db.query<{ id: string; reference: string; clinic_id: string; period: string; status: string }>("SELECT id,reference,clinic_id,to_char(month,'YYYY-MM') AS period,status FROM incentive_months WHERE to_char(month,'YYYY-MM')=ANY($1::text[])", [months])).rows;
    const existingQuarters = (await db.query<{ id: string; reference: string; status: string }>("SELECT id,reference,status FROM incentive_pools WHERE quarter='2026-Q3'")).rows;
    ensure(existingMonths.every(m => m.reference === `${tag}-${m.clinic_id}-${m.period}`), 'Existing ordinary monthly records must not be changed or adopted');
    ensure(existingQuarters.every(q => q.reference === tag && q.status !== 'voided') && existingQuarters.length <= 1, 'Existing ordinary/voided quarterly records must not be changed or adopted');

    // Invoke the exact registered domain handlers. Their nested transactions use
    // savepoints so a failed maintenance run rolls back every additive write.
    let sequence = 0;
    const domainPool = {
      query: db.query.bind(db),
      connect: async () => {
        const savepoint = 'demo_compensation_' + (++sequence);
        return { release() {}, query: async (sql: string, values?: unknown[]) => {
          if (sql === 'BEGIN') return db.query('SAVEPOINT ' + savepoint);
          if (sql === 'COMMIT') return db.query('RELEASE SAVEPOINT ' + savepoint);
          if (sql === 'ROLLBACK') { await db.query('ROLLBACK TO SAVEPOINT ' + savepoint); return db.query('RELEASE SAVEPOINT ' + savepoint); }
          return db.query(sql, values);
        } };
      },
    } as unknown as pg.Pool;
    const handlers = new Map<string, (req: FastifyRequest, user: Principal | undefined) => Promise<unknown>>();
    registerCompensationRoutes((method, path, _auth, handler) => { handlers.set(method + ' ' + path, handler as unknown as (req: FastifyRequest, user: Principal | undefined) => Promise<unknown>); }, domainPool);
    const invoke = async <T>(method: string, path: string, user: Principal, body: unknown = {}, params: Record<string, string> = {}) => {
      const handler = handlers.get(method + ' ' + path); ensure(handler, 'Compensation domain handler missing');
      return await handler({ id: tag, body, params, query: {} } as unknown as FastifyRequest, user) as T;
    };

    for (const [username, no, name] of [['hq', 'DEMO-HQ-001', '总部制表人员（虚构）'], ['manager.a', 'DEMO-MGR-001', '门诊店长（虚构）'], ['front.a', 'DEMO-FRONT-001', '门诊前台（虚构）']]) {
      const user = byName.get(username!)!;
      const old = await one<{ id: string; is_demo: boolean; is_dentist: boolean }>(db, 'SELECT id,is_demo,is_dentist FROM staff WHERE user_id=$1', [user.id]);
      if (old) { ensure(old.is_demo && !old.is_dentist && await one(db, "SELECT 1 FROM audit_events WHERE action='demo.compensation.staff.created' AND target_id=$1 AND detail->>'username'=$2", [old.id, username]), 'Existing ordinary employee profiles must not be adopted'); continue; }
      const staff = await one<{ id: string }>(db, `INSERT INTO staff(user_id,employee_no,name,phone,specialty,is_dentist,is_demo,birth_date,home_address,email) VALUES($1,$2,$3,'00000001000','课程虚构员工',false,true,'1990-02-16','虚构员工地址，仅作课程演示',$4) RETURNING id`, [user.id, no, name, username + '@example.test']);
      await audit(db, user.id, 'demo.compensation.staff.created', staff!.id, tag, { username, fictional: true });
    }
    let reviewerId = (await one<{ id: string }>(db, "SELECT target_id AS id FROM audit_events WHERE action='demo.compensation.reviewer.created' AND detail->>'batch'=$1", [tag]))?.id;
    if (reviewerId) {
      ensure(await one(db, "SELECT 1 FROM users u JOIN staff s ON s.user_id=u.id WHERE u.id=$1 AND u.active AND s.active AND s.is_demo AND NOT s.is_dentist AND u.password_hash LIKE 'disabled-demo-incentive-%'", [reviewerId]), 'Demo reviewer provenance or login-disable marker changed');
    } else {
      ensure(!await one(db, "SELECT 1 FROM users WHERE username='demo.incentive.audit'"), 'Unowned demo reviewer username exists');
      reviewerId = (await one<{ id: string }>(db, "INSERT INTO users(username,password_hash,display_name)VALUES('demo.incentive.audit',$1,'季度演示复核（禁登录）') RETURNING id", ['disabled-demo-incentive-' + randomBytes(32).toString('hex')]))!.id;
      await db.query("INSERT INTO role_assignments(user_id,role)VALUES($1,'hq')", [reviewerId]);
      await db.query("INSERT INTO staff(user_id,employee_no,name,phone,specialty,is_dentist,is_demo)VALUES($1,'DEMO-AUDIT-001','季度演示复核人员（虚构）','00000001000','仅内部演示审计；禁登录',false,true)", [reviewerId]);
      await audit(db, byName.get('hq')!.id, 'demo.compensation.reviewer.created', reviewerId, tag, { batch: tag, fictional: true, loginDisabled: true });
    }
    const maker = await principal(db, byName.get('hq')!.id), reviewer = await principal(db, reviewerId);
    ensure(maker && reviewer, 'Both demo employees must exist');
    ensure(maker.roles.includes('hq') && reviewer.roles.includes('hq') && maker.staffId && reviewer.staffId && maker.staffId !== reviewer.staffId, 'Independent HQ employee identities required');
    const row = (doctorId: string, ci: number, month: string): FinancialSourceInput => {
      const di = doctorIds.indexOf(doctorId);
      return { doctorId, revenueCents: ci === 0 && di === 0 ? 1000000 : ci === 1 && di === 1 ? 500000 : 0,
        materialCostCents: (ci === 0 && di === 0) || (ci === 1 && di === 1) ? 200000 : 0,
        operatingExpenseCents: (ci === 0 && di === 0) || (ci === 1 && (di === 0 || di === 2)) ? 100000 : ci === 1 && di === 1 ? 50000 : 0,
        revenueReference: `${tag}-收入-${ci}-${month}-${di}`, materialReference: `${tag}-用品-${ci}-${month}-${di}`, expenseReference: `${tag}-运营-${ci}-${month}-${di}` };
    };
    let addedMonths = 0;
    for (const [ci, clinicId] of clinicIds.entries()) for (const month of months) {
      const old = existingMonths.find(m => m.clinic_id === clinicId && m.period === month);
      const expectedRows = doctorIds.map(id => row(id, ci, month));
      let worksheet = old ? (await invoke<IncentiveMonth[]>('GET', '/compensation/months', maker)).find(m => m.id === old.id)! : await invoke<IncentiveMonth>('POST', '/compensation/months', maker, { clinicId, month, reference: `${tag}-${clinicId}-${month}`, noActivity: false, rows: expectedRows });
      ensure(worksheet && !worksheet.noActivity && worksheet.rows.length === 8 && expectedRows.every(e => worksheet.rows.some(r => r.doctorId === e.doctorId && r.revenueCents === e.revenueCents && r.materialCostCents === e.materialCostCents && r.operatingExpenseCents === e.operatingExpenseCents && r.revenueReference === e.revenueReference && r.materialReference === e.materialReference && r.expenseReference === e.expenseReference)), 'Existing demo worksheet differs; refusing to overwrite');
      if (!old) addedMonths++;
      if (worksheet.status === 'draft') worksheet = await invoke<IncentiveMonth>('POST', '/compensation/months/:id/close', reviewer, { expectedVersion: worksheet.rowVersion }, { id: worksheet.id });
    }
    let quarter = existingQuarters[0] ? await invoke<IncentiveQuarterDetail>('GET', '/compensation/quarters/:id', maker, {}, { id: existingQuarters[0].id }) : await invoke<IncentiveQuarterDetail>('POST', '/compensation/quarters', maker, { quarter: '2026-Q3', reference: tag });
    ensure(quarter.netProfitCents === 2250000 && quarter.fundCents === 225000 && quarter.allocations.length === 8 && quarter.allocations.reduce((n, a) => n + a.amountCents, 0) === 225000 && quarter.allocations.find(a => a.doctorId === doctorIds[0])?.amountCents === 158824 && quarter.allocations.find(a => a.doctorId === doctorIds[1])?.amountCents === 66176, 'Synthetic calculation differs; refusing to approve');
    if (quarter.status === 'draft') quarter = await invoke<IncentiveQuarterDetail>('POST', '/compensation/quarters/:id/submit', maker, { expectedVersion: quarter.rowVersion }, { id: quarter.id });
    if (quarter.status === 'submitted') quarter = await invoke<IncentiveQuarterDetail>('POST', '/compensation/quarters/:id/approve', reviewer, { expectedVersion: quarter.rowVersion }, { id: quarter.id });
    ensure(quarter.status === 'approved', 'Demo quarter must be approved');
    return { fictional: true, quarter: quarter.quarter, reference: tag, monthsAdded: addedMonths, quarterAdded: existingQuarters.length === 0, clinics: 2, doctors: 8, netProfitCents: quarter.netProfitCents, fundCents: quarter.fundCents, doctorAllocationCents: quarter.allocations.find(a => a.doctorId === doctorIds[0])!.amountCents, reviewerLoginDisabled: true };
  });
}
