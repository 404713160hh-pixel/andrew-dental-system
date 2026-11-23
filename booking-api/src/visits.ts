import type { FastifyRequest, HTTPMethods } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import type { Principal, VisitDetail, VisitReportRow, VisitSummary } from '@andrew/shared';
import { audit, clinicAccess, hqOnly, scopeIds, staffOnly } from './auth.js';
import { one, transaction, type Db } from './db.js';
import { requireThat } from './errors.js';
import { date, uuid } from './validation.js';

type Request = FastifyRequest<{ Params: Record<string, string>; Querystring: Record<string, string>; Body: unknown }>;
type Route = (method: HTTPMethods, path: string, auth: 'required', handler: (req: Request, user: Principal | undefined) => Promise<unknown>) => void;
const officeRoles = ['hq', 'manager', 'front'] as const;
const paidMethods = ['cash', 'wechat', 'alipay', 'card', 'transfer'] as const;
const attendanceInput = z.discriminatedUnion('status', [
  z.object({ status: z.literal('arrived'), doctorId: uuid }).strict(),
  z.object({ status: z.literal('no_show') }).strict(),
]);
const treatmentInput = z.object({
  items: z.array(z.object({
    serviceId: uuid, quantity: z.number().int().min(1).max(99),
    unitPriceCents: z.number().int().min(0).max(100000000),
  }).strict()).min(1).max(30),
}).strict().refine(x => new Set(x.items.map(item => item.serviceId)).size === x.items.length, '同一个项目请合并数量');
const paymentInput = z.object({
  amountCents: z.number().int().positive().max(297000000000),
  method: z.enum(paidMethods),
  reference: z.string().trim().max(100),
  commandKey: uuid,
}).strict().refine(x => x.method === 'cash' || x.reference.length > 0, '非现金收款请填写凭证编号');
const summarySql = `SELECT r.doctor_id AS "bookedDoctorId", a.id AS "appointmentId", a.appointment_no AS "appointmentNo", p.name AS "patientName",
  c.id AS "clinicId", c.name AS "clinicName", booked.name AS "bookedDoctorName",
  r.starts_at AS "startsAt", r.ends_at AS "endsAt", r.service_id AS "scheduledServiceId",
  a.status AS "appointmentStatus", v.status, v.doctor_id AS "doctorId", actual.name AS "doctorName",
  v.arrived_at AS "arrivedAt", v.completed_at AS "completedAt",
  r.starts_at - interval '2 hours' AS "attendanceAllowedAt"
 FROM appointments a JOIN resource_reservations r ON r.id=a.reservation_id
 JOIN patients p ON p.id=a.patient_id JOIN clinics c ON c.id=r.clinic_id
 JOIN staff booked ON booked.id=r.doctor_id
 LEFT JOIN visits v ON v.appointment_id=a.id LEFT JOIN staff actual ON actual.id=v.doctor_id`;
type BaseVisit = Omit<VisitDetail, 'canManage' | 'canTreat' | 'treatments' | 'invoice'> & { bookedDoctorId: string };

function permissions(user: Principal, row: BaseVisit) {
  staffOnly(user);
  const canManage = user.assignments.some(a => officeRoles.some(role => role === a.role)
    && (a.role === 'hq' || a.clinicId === row.clinicId));
  const doctorAtClinic = user.assignments.some(a => a.role === 'doctor' && a.clinicId === row.clinicId);
  const canTreat = doctorAtClinic && !!user.staffId && user.staffId === row.doctorId;
  const canRead = canManage || canTreat || (doctorAtClinic && !row.doctorId && user.staffId === row.bookedDoctorId);
  requireThat(canRead, 403, 'VISIT_SCOPE_DENIED', '无权查看该就诊');
  return { canManage, canTreat };
}

async function findVisit(db: Db, id: string, user: Principal, lock = false) {
  if (lock) {
    // Share the same appointment lock as cancellation and rescheduling.
    await db.query('SELECT id FROM appointments WHERE id=$1 FOR UPDATE', [id]);
  }
  const row = await one<BaseVisit>(db, summarySql + ' WHERE a.id=$1', [id]);
  requireThat(row, 404, 'NOT_FOUND', '预约不存在');
  return { ...row, ...permissions(user, row) };
}

async function details(db: Db, id: string, user: Principal): Promise<VisitDetail> {
  const { bookedDoctorId: _, ...visit } = await findVisit(db, id, user);
  const treatments = (await db.query<VisitDetail['treatments'][number]>(`SELECT service_id AS "serviceId",
    service_name AS "serviceName", unit, quantity, unit_price_cents AS "unitPriceCents"
    FROM visit_treatments WHERE appointment_id=$1 ORDER BY service_name,service_id`, [id])).rows;
  const invoice = visit.canManage ? await one<Omit<NonNullable<VisitDetail['invoice']>, 'payments'>>(db, `SELECT id,
    total_cents::float8 AS "totalCents", issued_at AS "issuedAt" FROM visit_invoices WHERE appointment_id=$1`, [id]) : undefined;
  const payments = invoice ? (await db.query<NonNullable<VisitDetail['invoice']>['payments'][number]>(`SELECT id,
    amount_cents::float8 AS "amountCents", method, reference, received_at AS "receivedAt"
    FROM visit_payments WHERE invoice_id=$1 ORDER BY received_at,id`, [invoice.id])).rows : [];
  return { ...visit, treatments, invoice: invoice ? { ...invoice, payments } : null };
}

export function registerVisitRoutes(route: Route, pool: pg.Pool) {
  route('GET', '/staff/visits', 'required', async (req, user) => {
    staffOnly(user!);
    const day = date.parse(req.query.date);
    const scope = scopeIds(user!, [...officeRoles]);
    const doctorScopes = scopeIds(user!, ['doctor']);
    return (await pool.query<VisitSummary>(summarySql + ` WHERE
      (v.arrived_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Shanghai') AND v.arrived_at < (($1::date+1)::timestamp AT TIME ZONE 'Asia/Shanghai')
       OR v.status='no_show' AND r.starts_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Shanghai') AND r.starts_at < (($1::date+1)::timestamp AT TIME ZONE 'Asia/Shanghai'))
      AND ($2::uuid[] IS NULL OR c.id=ANY($2) OR (v.doctor_id=$3 AND c.id=ANY($4)))
      ORDER BY coalesce(v.arrived_at,r.starts_at) DESC,a.id LIMIT 200`, [day, scope, user!.staffId, doctorScopes])).rows;
  });
  route('GET', '/staff/visits/:id', 'required', (req, user) => details(pool, uuid.parse(req.params.id), user!));
  route('GET', '/staff/visits/:id/eligible-doctors', 'required', async (req, user) => {
    const visit = await findVisit(pool, uuid.parse(req.params.id), user!);
    clinicAccess(user!, visit.clinicId, [...officeRoles]);
    return (await pool.query<{ id: string; name: string }>(`SELECT s.id,s.name FROM staff s
      JOIN users u ON u.id=s.user_id AND u.active
      WHERE s.active AND s.is_dentist AND EXISTS(SELECT 1 FROM role_assignments a
        WHERE a.user_id=u.id AND a.role='doctor' AND a.clinic_id=$1)
      ORDER BY s.name,s.id`, [visit.clinicId])).rows;
  });
  route('PUT', '/staff/visits/:id/attendance', 'required', async (req, user) => {
    const id = uuid.parse(req.params.id);
    const input = attendanceInput.parse(req.body);
    return transaction(pool, async db => {
      const visit = await findVisit(db, id, user!, true);
      clinicAccess(user!, visit.clinicId, [...officeRoles]);
      requireThat(visit.appointmentStatus === 'confirmed', 409, 'APPOINTMENT_NOT_ACTIVE', '只有有效预约可以登记到诊');
      requireThat(visit.status !== 'completed', 409, 'VISIT_COMPLETED', '治疗已确认，不能改动到诊记录');
      if (input.status === 'no_show') {
        requireThat(!visit.arrivedAt && Date.now() >= Date.parse(visit.endsAt), 409, 'NO_SHOW_NOT_ALLOWED', '预约结束后才可登记未到，已到诊记录不可改为未到');
        if (visit.status === 'no_show') return details(db, id, user!);
        await db.query("INSERT INTO visits(appointment_id,status) VALUES($1,'no_show')", [id]);
      } else {
        requireThat(Date.now() >= Date.parse(visit.attendanceAllowedAt), 409, 'TOO_EARLY_TO_CHECK_IN', '预约开始前两小时内可登记到诊');
        const doctor = await one(db, `SELECT s.id FROM staff s JOIN users u ON u.id=s.user_id AND u.active
          WHERE s.id=$1 AND s.active AND s.is_dentist AND EXISTS(SELECT 1 FROM role_assignments a
            WHERE a.user_id=u.id AND a.role='doctor' AND a.clinic_id=$2)`, [input.doctorId, visit.clinicId]);
        requireThat(doctor, 400, 'INVALID_VISIT_DOCTOR', '请选择有本门诊权限的在岗医生');
        if (visit.status === 'arrived' && visit.doctorId === input.doctorId) return details(db, id, user!);
        await db.query(`INSERT INTO visits(appointment_id,status,doctor_id,arrived_at) VALUES($1,'arrived',$2,clock_timestamp())
          ON CONFLICT(appointment_id) DO UPDATE SET status='arrived',doctor_id=excluded.doctor_id,
          arrived_at=coalesce(visits.arrived_at,excluded.arrived_at)`, [id, input.doctorId]);
      }
      await audit(db, user!.id, 'visit.' + input.status, id, req.id, { doctorId: input.status === 'arrived' ? input.doctorId : null });
      return details(db, id, user!);
    });
  });
  route('PUT', '/staff/visits/:id/treatments', 'required', async (req, user) => {
    const id = uuid.parse(req.params.id);
    const { items } = treatmentInput.parse(req.body);
    return transaction(pool, async db => {
      const visit = await findVisit(db, id, user!, true);
      requireThat(visit.canTreat, 403, 'TREATMENT_FORBIDDEN', '只有实际接诊医生可以确认治疗');
      if (visit.status === 'completed') {
        const existing = await details(db, id, user!);
        requireThat(existing.treatments.length === items.length && items.every(item => existing.treatments.some(saved =>
          saved.serviceId === item.serviceId && saved.quantity === item.quantity && saved.unitPriceCents === item.unitPriceCents)),
        409, 'VISIT_COMPLETED', '治疗记录已确认');
        return existing;
      }
      requireThat(visit.status === 'arrived', 409, 'VISIT_NOT_ARRIVED', '请先登记到诊');
      for (const item of items) {
        const result = await db.query(`INSERT INTO visit_treatments(appointment_id,service_id,service_name,unit,quantity,unit_price_cents)
          SELECT $1,s.id,s.name,s.unit,$4,$5 FROM services s JOIN clinic_services cs ON cs.service_id=s.id
          WHERE s.id=$2 AND cs.clinic_id=$3 AND s.active`, [id, item.serviceId, visit.clinicId, item.quantity, item.unitPriceCents]);
        requireThat(result.rowCount === 1, 400, 'INVALID_TREATMENT_SERVICE', '治疗项目必须属于就诊门诊');
      }
      await db.query("UPDATE visits SET status='completed',completed_at=clock_timestamp() WHERE appointment_id=$1", [id]);
      await audit(db, user!.id, 'visit.treatment_completed', id, req.id, { items: items.length });
      return details(db, id, user!);
    });
  });
  route('POST', '/staff/visits/:id/invoice', 'required', async (req, user) => {
    const id = uuid.parse(req.params.id);
    return transaction(pool, async db => {
      const visit = await findVisit(db, id, user!, true);
      clinicAccess(user!, visit.clinicId, [...officeRoles]);
      requireThat(visit.status === 'completed', 409, 'TREATMENTS_NOT_CONFIRMED', '请先由接诊医生确认治疗项目');
      const inserted = await db.query(`INSERT INTO visit_invoices(appointment_id,total_cents,issued_by)
        SELECT $1,sum(quantity::bigint*unit_price_cents),$2 FROM visit_treatments WHERE appointment_id=$1
        HAVING count(*)>0 ON CONFLICT(appointment_id) DO NOTHING`, [id, user!.id]);
      if (inserted.rowCount) await audit(db, user!.id, 'visit.invoice_issued', id, req.id);
      return details(db, id, user!);
    });
  });
  route('POST', '/staff/visits/:id/payments', 'required', async (req, user) => {
    const id = uuid.parse(req.params.id);
    const input = paymentInput.parse(req.body);
    return transaction(pool, async db => {
      const visit = await findVisit(db, id, user!, true);
      clinicAccess(user!, visit.clinicId, [...officeRoles]);
      const invoice = await one<{ id: string; total_cents: string }>(db, 'SELECT id,total_cents FROM visit_invoices WHERE appointment_id=$1', [id]);
      requireThat(invoice, 409, 'INVOICE_REQUIRED', '请先出结算单');
      const previous = await one<{ invoice_id: string; amount_cents: string; method: string; reference: string }>(db,
        'SELECT invoice_id,amount_cents,method,reference FROM visit_payments WHERE command_key=$1', [input.commandKey]);
      if (previous) {
        requireThat(previous.invoice_id === invoice.id && Number(previous.amount_cents) === input.amountCents
          && previous.method === input.method && previous.reference === input.reference, 409, 'PAYMENT_KEY_REUSED', '收款操作编号已使用');
        return details(db, id, user!);
      }
      const paid = await one<{ total: string }>(db, 'SELECT coalesce(sum(amount_cents),0) AS total FROM visit_payments WHERE invoice_id=$1', [invoice.id]);
      requireThat(input.amountCents <= Number(invoice.total_cents) - Number(paid!.total), 409, 'PAYMENT_EXCEEDS_BALANCE', '登记金额不能超过结算单的未收款');
      await db.query(`INSERT INTO visit_payments(invoice_id,amount_cents,method,reference,recorded_by,command_key)
        VALUES($1,$2,$3,$4,$5,$6)`, [invoice.id, input.amountCents, input.method, input.reference, user!.id, input.commandKey]);
      await audit(db, user!.id, 'visit.payment_recorded', id, req.id, { invoiceId: invoice.id, amountCents: input.amountCents, method: input.method });
      return details(db, id, user!);
    });
  });
  route('GET', '/staff/visit-report', 'required', async (req, user) => {
    hqOnly(user!);
    const from = date.parse(req.query.from);
    const to = date.parse(req.query.to);
    requireThat(from <= to && Date.parse(to) - Date.parse(from) <= 365 * 86400000, 400, 'INVALID_REPORT_RANGE', '请选择一年内的有效日期范围');
    const clinic = uuid.optional().parse(req.query.clinicId);
    const doctor = uuid.optional().parse(req.query.doctorId);
    const rows = (await pool.query<VisitReportRow>(`WITH bounds AS (
      SELECT $1::date::timestamp AT TIME ZONE 'Asia/Shanghai' AS from_ts, ($2::date+1)::timestamp AT TIME ZONE 'Asia/Shanghai' AS to_ts
    ), facts AS (
      SELECT v.appointment_id,1 AS completed,0::bigint AS billed,0::bigint AS collected FROM visits v,bounds b
      WHERE v.completed_at>=b.from_ts AND v.completed_at<b.to_ts
      UNION ALL SELECT i.appointment_id,0,i.total_cents,0 FROM visit_invoices i,bounds b
      WHERE i.issued_at>=b.from_ts AND i.issued_at<b.to_ts
      UNION ALL SELECT i.appointment_id,0,0,p.amount_cents FROM visit_payments p JOIN visit_invoices i ON i.id=p.invoice_id CROSS JOIN bounds b
      WHERE p.received_at>=b.from_ts AND p.received_at<b.to_ts
    )
    SELECT c.id AS "clinicId",c.name AS "clinicName",s.id AS "doctorId",s.name AS "doctorName",
      sum(f.completed)::float8 AS completed,sum(f.billed)::float8 AS "billedCents",sum(f.collected)::float8 AS "collectedCents"
    FROM facts f JOIN visits v ON v.appointment_id=f.appointment_id JOIN appointments a ON a.id=f.appointment_id
    JOIN resource_reservations r ON r.id=a.reservation_id JOIN clinics c ON c.id=r.clinic_id JOIN staff s ON s.id=v.doctor_id
    WHERE ($3::uuid IS NULL OR c.id=$3) AND ($4::uuid IS NULL OR s.id=$4)
    GROUP BY c.id,s.id ORDER BY c.name,s.name,c.id,s.id`, [from, to, clinic ?? null, doctor ?? null])).rows;
    return rows;
  });
}
