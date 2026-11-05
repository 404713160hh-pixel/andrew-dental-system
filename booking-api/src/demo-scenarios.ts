import type pg from 'pg';
import type { Appointment, Principal } from '@andrew/shared';
import type { Config } from './config.js';
import { audit, principal } from './auth.js';
import { one, transaction } from './db.js';
import { PRIVACY_VERSION, recordConsent } from './privacy.js';
import { querySlots } from './repositories/booking.js';
import { getAppointment } from './repositories/catalog.js';
import { bookingPolicy, changeAppointment, confirmAppointment, createHold } from './services/booking.js';

const day = 86400000;
const patientKeys = ['seed:patient:a', 'seed:patient:b', ...Array.from({ length: 6 }, (_, i) => 'demo:patient:' + (i + 3))];
const doctorKeys = ['seed:doctor:a', 'seed:doctor:b', ...['c', 'd', 'e', 'f', 'g', 'h'].map(key => 'demo:doctor:' + key)];
const clinicKeys = ['seed:clinic:a', 'seed:clinic:b'];
const batchAction = 'demo.scenarios.batch.prepared';
const ensure: (condition: unknown, message: string) => asserts condition = (condition, message) => { if (!condition) throw new Error(message); };
type DemoPatient = { id: string; user_id: string | null; birth_date: string; is_demo: boolean };
type Dataset = { patients: DemoPatient[]; clinicIds: string[]; doctorIds: Set<string>; serviceId: string; actor: Principal };

async function verifiedDataset(pool: pg.Pool): Promise<Dataset> {
  const keys = [...patientKeys, ...doctorKeys, ...clinicKeys, 'seed:service:initial'];
  const rows = (await pool.query<{ record_key: string; record_kind: string; record_id: string }>(
    'SELECT record_key,record_kind,record_id FROM demo_seed_records WHERE record_key=ANY($1::text[])', [keys])).rows;
  const markers = new Map(rows.map(row => [row.record_key, row]));
  const id = (key: string, kind: string) => { const row = markers.get(key); ensure(row?.record_kind === kind, 'Complete synthetic provenance is required; run demo enrichment first'); return row.record_id; };
  const patients: DemoPatient[] = [];
  for (const key of patientKeys) {
    const patient = await one<DemoPatient>(pool, "SELECT id,user_id,to_char(birth_date,'YYYY-MM-DD') AS birth_date,is_demo FROM patients WHERE id=$1", [id(key, 'patient')]);
    ensure(patient?.is_demo, 'Only provenance-marked fictional patients can receive demo scenarios'); patients.push(patient);
  }
  for (const [index, username] of ['patient.a', 'patient.b'].entries()) {
    ensure(await one(pool, 'SELECT 1 FROM users WHERE id=$1 AND username=$2 AND active', [patients[index]!.user_id, username]), 'Synthetic patient account linkage is missing');
  }
  const clinicIds: string[] = [];
  for (const key of clinicKeys) {
    const clinic = await one<{ id: string; active: boolean; address: string; description: string | null }>(pool, 'SELECT id,active,address,description FROM clinics WHERE id=$1', [id(key, 'clinic')]);
    ensure(clinic?.active && /虚构|课程演示/.test(clinic.address + ' ' + (clinic.description || '')), 'Only active, explicitly synthetic demo clinics can be used'); clinicIds.push(clinic.id);
  }
  const doctorIds = new Set<string>();
  for (const key of doctorKeys) {
    const doctor = await one<{ id: string; is_demo: boolean }>(pool, 'SELECT id,is_demo FROM staff WHERE id=$1', [id(key, 'doctor')]);
    ensure(doctor?.is_demo, 'Only provenance-marked fictional doctors can be used'); doctorIds.add(doctor.id);
  }
  const serviceId = id('seed:service:initial', 'service');
  ensure(await one(pool, 'SELECT 1 FROM services WHERE id=$1 AND active', [serviceId]), 'The identified demo consultation service is unavailable');
  const hq = await one<{ id: string }>(pool, "SELECT id FROM users WHERE username='hq' AND active");
  const actor = hq && await principal(pool, hq.id);
  ensure(actor && actor.roles.includes('hq'), 'The original synthetic headquarters actor is unavailable');
  return { patients, clinicIds, doctorIds, serviceId, actor };
}

/** Explicit maintenance command for the isolated demo dataset; never used by an HTTP route. */
export async function prepareDemoScenarios(pool: pg.Pool, config: Config, options: { enabled?: boolean } = {}) {
  ensure(config.NODE_ENV !== 'production', 'Synthetic demo scenarios are disabled in production');
  ensure(options.enabled === true, 'Set ANDREW_DEMO_SCENARIOS=1 to explicitly prepare synthetic scenarios');
  const lock = await pool.connect();
  let locked = false;
  try {
    await lock.query("SELECT pg_advisory_lock(hashtextextended('andrew.booking.demo.scenarios.v1',0))"); locked = true;
    const dataset = await verifiedDataset(pool), policy = bookingPolicy(config);
    const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    const last = await one<{ detail: { batchDate?: string; refreshAfter?: string } }>(pool,
      'SELECT detail FROM audit_events WHERE action=$1 ORDER BY occurred_at DESC,id DESC LIMIT 1', [batchAction]);
    // A process may stop after a normal booking transaction but before its batch
    // audit record. Recover that batch even if the retry crosses China midnight.
    const partial = await one<{ stamp: string }>(pool, `SELECT substring(c.command_key from '^demo_v1_([0-9]{8})_') AS stamp
      FROM command_receipts c JOIN appointments a ON a.id=(c.result->>'id')::uuid
      JOIN resource_reservations r ON r.id=a.reservation_id JOIN patients p ON p.id=a.patient_id AND p.is_demo
      WHERE c.user_id=$1 AND c.command_key ~ '^demo_v1_[0-9]{8}_(ready_[0-3]|cancel_original|reschedule_original)$'
      AND r.starts_at>clock_timestamp()+$2::int*interval '1 minute'
      AND NOT EXISTS(SELECT 1 FROM audit_events e WHERE e.action=$3 AND e.request_id=left(c.command_key,17)||'batch')
      ORDER BY c.created_at,c.command_key LIMIT 1`, [dataset.actor.id, config.CANCELLATION_NOTICE_MINUTES, batchAction]);
    const partialDate = partial ? partial.stamp.slice(0, 4) + '-' + partial.stamp.slice(4, 6) + '-' + partial.stamp.slice(6, 8) : undefined;
    const batchDate = partialDate || (last?.detail.batchDate && /^\d{4}-\d{2}-\d{2}$/.test(last.detail.batchDate)
      && Date.parse(last.detail.refreshAfter || '') > Date.now() ? last.detail.batchDate : today);
    const prefix = 'demo_v1_' + batchDate.replaceAll('-', '') + '_';
    const baseDay = Math.max(2, Math.ceil(config.CANCELLATION_NOTICE_MINUTES / 1440) + 1);
    const dateAt = (offset: number) => new Date(Date.parse(batchDate + 'T00:00:00Z') + offset * day).toISOString().slice(0, 10);
    let patientClinicLinksAdded = 0, syntheticConsentsAdded = 0, appointmentsAdded = 0;
    const blockedPatients: string[] = [];
    const enabledPatients = new Set<string>();
    // Do not renew revoked or outdated consent records. Only new, entirely
    // synthetic charts receive a synthetic fixture assertion, with explicit audit provenance.
    await transaction(pool, async db => {
      for (const [index, patient] of dataset.patients.entries()) {
        const linked = await db.query('INSERT INTO patient_clinic_access(patient_id,clinic_id,created_by)VALUES($1,$2,$3)ON CONFLICT DO NOTHING RETURNING patient_id',
          [patient.id, dataset.clinicIds[index % 2], dataset.actor.id]);
        if (linked.rowCount) {
          patientClinicLinksAdded++;
          await audit(db, dataset.actor.id, 'demo.synthetic.clinic_access', patient.id, prefix + 'intake_' + index, { synthetic: true, clinicId: dataset.clinicIds[index % 2], source: patientKeys[index] });
        }
        const consent = await one<{ any: boolean; active: boolean }>(db, `SELECT
          EXISTS(SELECT 1 FROM patient_privacy_consents WHERE patient_id=$1) AS any,
          EXISTS(SELECT 1 FROM patient_privacy_consents WHERE patient_id=$1 AND policy_version=$2 AND revoked_at IS NULL
            AND ($3::uuid IS NULL OR actor_id=$3)) AS active`, [patient.id, PRIVACY_VERSION, patient.user_id]);
        if (consent?.active) enabledPatients.add(patient.id);
        else if (!consent?.any) {
          const actorId = patient.user_id || dataset.actor.id;
          await recordConsent(db, actorId, patient.id, patient.birth_date, { policyVersion: PRIVACY_VERSION, noticeAccepted: true, sensitiveAccepted: true, guardian: null }, prefix + 'synthetic_consent_' + index);
          await audit(db, actorId, 'demo.synthetic.consent_fixture', patient.id, prefix + 'synthetic_consent_' + index, { synthetic: true, source: patientKeys[index], purpose: 'isolated course demonstration; not a real patient authorization' });
          syntheticConsentsAdded++; enabledPatients.add(patient.id);
        } else blockedPatients.push(patientKeys[index]!);
      }
    });
    const appointmentIds = new Set<string>(), readyStarts: string[] = [];
    const validateAppointment = (appointment: Appointment | undefined, patientId: string) => {
      ensure(appointment && appointment.patientId === patientId && appointment.patientIsDemo && appointment.doctorIsDemo
        && dataset.clinicIds.includes(appointment.clinicId) && dataset.doctorIds.has(appointment.doctorId), 'A scenario receipt does not refer to the identified fictional dataset');
      appointmentIds.add(appointment.id); return appointment;
    };
    const receipt = async (key: string, patientId: string) => {
      const row = await one<{ result: Appointment }>(pool, 'SELECT result FROM command_receipts WHERE user_id=$1 AND command_key=$2', [dataset.actor.id, key]);
      return row ? validateAppointment(await getAppointment(pool, row.result.id, policy), patientId) : undefined;
    };
    const holdFor = async (patientId: string, clinicIndex: number, offset: number) => {
      for (let candidate = offset; candidate <= Math.min(28, offset + 6); candidate++) {
        const slots = await querySlots(pool, { clinicId: dataset.clinicIds[clinicIndex]!, serviceId: dataset.serviceId, date: dateAt(candidate), patientId }, policy);
        const slot = slots.find(item => dataset.doctorIds.has(item.doctorId));
        if (slot) return createHold(pool, config, dataset.actor, { patientId, clinicId: slot.clinicId, serviceId: slot.serviceId, doctorId: slot.doctorId, chairId: slot.chairId, shiftId: slot.shiftId, startsAt: slot.startsAt }, prefix + 'synthetic_hold');
      }
      throw new Error('No eligible future demo slot remains within seven days; refresh demo shifts before preparing scenarios');
    };
    const confirm = async (key: string, patientId: string, clinicIndex: number, offset: number) => {
      const existing = await receipt(key, patientId); if (existing) return existing;
      const hold = await holdFor(patientId, clinicIndex, offset);
      const result = await confirmAppointment(pool, config, dataset.actor, { patientId, holdId: hold.id, holdVersion: hold.rowVersion, patientConfirmed: true, rulesAccepted: true }, key, prefix + 'synthetic_confirm');
      appointmentsAdded++; return validateAppointment(result, patientId);
    };
    for (let index = 0; index < 4; index++) {
      const patient = dataset.patients[index]!; if (!enabledPatients.has(patient.id)) continue;
      const result = await confirm(prefix + 'ready_' + index, patient.id, index % 2, baseDay + index);
      readyStarts.push(result.startsAt);
    }
    const first = dataset.patients[0]!;
    if (enabledPatients.has(first.id)) {
      const original = await confirm(prefix + 'cancel_original', first.id, 0, baseDay + 4);
      const changed = await receipt(prefix + 'cancel_change', first.id);
      if (!changed && original.status === 'confirmed') validateAppointment(await changeAppointment(pool, config, dataset.actor, original.id,
        { intent: 'cancel', expectedVersion: original.rowVersion, reason: '虚构演示：患者取消预约' }, prefix + 'cancel_change', prefix + 'synthetic_cancel'), first.id);
    }
    const second = dataset.patients[1]!;
    if (enabledPatients.has(second.id)) {
      const original = await confirm(prefix + 'reschedule_original', second.id, 1, baseDay + 5);
      const changed = await receipt(prefix + 'reschedule_change', second.id);
      if (!changed && original.status === 'confirmed') {
        const hold = await holdFor(second.id, 1, baseDay + 6);
        validateAppointment(await changeAppointment(pool, config, dataset.actor, original.id,
          { intent: 'reschedule', expectedVersion: original.rowVersion, holdId: hold.id, holdVersion: hold.rowVersion, reason: '虚构演示：调整就诊日期' },
          prefix + 'reschedule_change', prefix + 'synthetic_reschedule'), second.id); appointmentsAdded++;
      }
    }
    const refreshAfter = readyStarts.length ? new Date(Math.min(...readyStarts.map(Date.parse)) - (config.CANCELLATION_NOTICE_MINUTES + 60) * 60000).toISOString() : null;
    const existingMarker = await one(pool, 'SELECT 1 FROM audit_events WHERE action=$1 AND request_id=$2 LIMIT 1', [batchAction, prefix + 'batch']);
    if (!existingMarker) await audit(pool, dataset.actor.id, batchAction, null, prefix + 'batch', { synthetic: true, batchDate, refreshAfter, appointmentIds: [...appointmentIds], blockedPatients });
    const statuses = appointmentIds.size ? (await pool.query<{ status: string; count: string }>('SELECT status,count(*)::text AS count FROM appointments WHERE id=ANY($1::uuid[])GROUP BY status', [[...appointmentIds]])).rows : [];
    return { fictional: true, batchDate, appointmentsAdded, patientClinicLinksAdded, syntheticConsentsAdded, patients: dataset.patients.length,
      appointmentIds: [...appointmentIds], statuses: Object.fromEntries(statuses.map(item => [item.status, Number(item.count)])), blockedPatients, refreshAfter };
  } finally {
    try { if (locked) await lock.query("SELECT pg_advisory_unlock(hashtextextended('andrew.booking.demo.scenarios.v1',0))"); } finally { lock.release(); }
  }
}
