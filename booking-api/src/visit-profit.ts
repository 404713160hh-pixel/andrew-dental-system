import type { Db } from './db.js';
import { one } from './db.js';
import type { OperatingExpense, VisitProfitMonth, VisitProfitRow } from '@andrew/shared';

export const operationalSource = '系统汇总：就诊、耗材和门诊运营费用';
export const chinaMonth = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7);

export function allocateExpenses(amount: number, doctors: { doctorId: string; revenueCents: number; visits: number }[]) {
  const revenue = doctors.reduce((sum, row) => sum + BigInt(row.revenueCents), 0n);
  const weights = doctors.map(row => ({ doctorId: row.doctorId, weight: BigInt(revenue > 0n ? row.revenueCents : row.visits) }));
  const denominator = weights.reduce((sum, row) => sum + row.weight, 0n);
  if (!denominator) return { allocations: new Map<string, number>(), unallocatedCents: amount };
  const rows = weights.map(row => {
    const product = BigInt(amount) * row.weight;
    return { ...row, cents: product / denominator, remainder: product % denominator };
  });
  rows.sort((a,b) => a.remainder === b.remainder ? a.doctorId.localeCompare(b.doctorId) : (a.remainder > b.remainder ? -1 : 1));
  const remainder = Number(BigInt(amount) - rows.reduce((sum, row) => sum + row.cents, 0n));
  return { allocations: new Map(rows.map((row, index) => [row.doctorId, Number(row.cents) + (index < remainder ? 1 : 0)])), unallocatedCents: 0 };
}

export async function visitProfitMonth(db: Db, clinic: { id: string; name: string }, month: string, reportAllDoctors = false): Promise<VisitProfitMonth> {
  const sheet = await one<{ items: OperatingExpense[] }>(db, 'SELECT items FROM clinic_monthly_expenses WHERE clinic_id=$1 AND month=$2', [clinic.id,month+'-01']);
  const expenseCents = sheet?.items.reduce((sum, row) => sum + row.amountCents, 0) ?? 0;
  const rows = (await db.query<Omit<VisitProfitRow,'expenseCents'|'netProfitCents'> & { missingMaterials:number; unbilled:number; demoVisits:number }>(`WITH bounds AS (
    SELECT $2::date::timestamp AT TIME ZONE 'Asia/Shanghai' AS start_at, ($2::date+interval '1 month') AT TIME ZONE 'Asia/Shanghai' AS end_at
  ), completed AS (
    SELECT v.appointment_id,v.doctor_id,v.materials_recorded,i.id IS NULL AS unbilled,
      coalesce(i.total_cents,0) AS revenue,
      coalesce((SELECT sum(m.cost_cents) FROM visit_materials m WHERE m.appointment_id=v.appointment_id),0) AS material,
      a.appointment_no LIKE 'DEMO-VISIT-%' AS demo
    FROM visits v JOIN appointments a ON a.id=v.appointment_id JOIN resource_reservations r ON r.id=a.reservation_id
    LEFT JOIN visit_invoices i ON i.appointment_id=v.appointment_id CROSS JOIN bounds b
    WHERE r.clinic_id=$1 AND v.completed_at>=b.start_at AND v.completed_at<b.end_at
  ), planned AS (
    SELECT DISTINCT ds.doctor_id FROM doctor_shifts ds CROSS JOIN bounds b
    WHERE $3::boolean AND ds.clinic_id=$1 AND ds.status='published' AND ds.starts_at<b.end_at AND ds.ends_at>b.start_at
  ), doctors AS (SELECT doctor_id FROM completed UNION SELECT doctor_id FROM planned)
  SELECT s.id AS "doctorId",s.name AS "doctorName",s.employee_no AS "employeeNo",
    count(c.appointment_id)::integer AS visits,coalesce(sum(c.revenue),0)::float8 AS "revenueCents",
    coalesce(sum(c.material),0)::float8 AS "materialCostCents",
    count(*) FILTER (WHERE NOT c.materials_recorded)::integer AS "missingMaterials",
    count(*) FILTER (WHERE c.unbilled)::integer AS unbilled,count(*) FILTER (WHERE c.demo)::integer AS "demoVisits"
  FROM doctors d JOIN staff s ON s.id=d.doctor_id LEFT JOIN completed c ON c.doctor_id=s.id
  GROUP BY s.id ORDER BY s.name,s.id`, [clinic.id,month+'-01',reportAllDoctors])).rows;
  const { allocations, unallocatedCents } = allocateExpenses(expenseCents, rows);
  return {
    clinicId:clinic.id,clinicName:clinic.name,month,expensesRecorded:!!sheet,expenseCents,unallocatedCents,
    missingMaterials:rows.reduce((sum,r)=>sum+r.missingMaterials,0),unbilled:rows.reduce((sum,r)=>sum+r.unbilled,0),
    demoVisits:rows.reduce((sum,r)=>sum+r.demoVisits,0),
    rows:rows.map(({ missingMaterials:_,unbilled:__,demoVisits:___,...row })=>{
      const expenseCents=allocations.get(row.doctorId)??0;
      return {...row,expenseCents,netProfitCents:row.revenueCents-row.materialCostCents-expenseCents};
    }),
  };
}
