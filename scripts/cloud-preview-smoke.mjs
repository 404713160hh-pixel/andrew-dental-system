import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const apiRoot = 'http://api:3310/api/v1';
assert.equal(process.env.ANDREW_PREVIEW_SMOKE, '1', 'Set ANDREW_PREVIEW_SMOKE=1 to explicitly opt in');
assert.equal(process.env.NODE_ENV, 'development', 'NODE_ENV must be development');
assert.equal(apiRoot, 'http://api:3310/api/v1', 'Smoke checks are restricted to the isolated Compose API');
assert.equal(new URL(apiRoot).hostname, 'api');
assert.equal(new URL(apiRoot).port, '3310');
const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, 'Set DATABASE_URL for the isolated preview database');
let database;
try { database = new URL(databaseUrl); }
catch { assert.fail('DATABASE_URL must be a valid PostgreSQL URL'); }
assert.equal(database.protocol, 'postgresql:', 'DATABASE_URL must use PostgreSQL');
assert.equal(database.hostname, 'postgres', 'DATABASE_URL must use the preview Compose PostgreSQL service');
assert.equal(database.port, '5432', 'DATABASE_URL must use the preview PostgreSQL port');
assert.equal(decodeURIComponent(database.pathname.replace(/^\//, '')), 'andrew_booking_preview',
  'DATABASE_URL must target the andrew_booking_preview database');
const password = process.env.SEED_PASSWORD;
assert.ok(password && password.length >= 12, 'Set SEED_PASSWORD to the synthetic seed password (12+ characters)');

async function request(path, { token, method = 'GET', body, idempotencyKey } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  const response = await fetch(`${apiRoot}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; }
  catch { throw new Error(`${method} ${path}: HTTP ${response.status}, invalid JSON response`); }
  assert.ok(response.ok, `${method} ${path}: HTTP ${response.status}: ${JSON.stringify(payload.error ?? payload)}`);
  assert.ok(payload.requestId, `${method} ${path}: missing requestId`);
  return payload.data;
}

async function login(username, portal) {
  const result = await request('/auth/login', {
    method: 'POST', body: { username, password, portal },
  });
  assert.ok(result.token, `Login for ${username} did not return a session token`);
  return result.token;
}

function shanghaiDate(instant) {
  return new Date(Date.parse(instant) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function slotsForShift(shift, serviceId, token) {
  const query = new URLSearchParams({
    clinicId: shift.clinicId,
    serviceId,
    doctorId: shift.doctorId,
    date: shanghaiDate(shift.startsAt),
  });
  const slots = await request(`/booking-slots?${query}`, { token });
  return slots
    .filter(slot => slot.shiftId === shift.id)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

async function holdSlot(slot, token) {
  return request('/booking-holds', {
    token,
    method: 'POST',
    body: {
      clinicId: slot.clinicId,
      serviceId: slot.serviceId,
      doctorId: slot.doctorId,
      chairId: slot.chairId,
      shiftId: slot.shiftId,
      startsAt: slot.startsAt,
    },
  });
}

async function main() {
  const hqToken = await login('hq', 'staff');
  const patientToken = await login('patient.a', 'patient');

  const shifts = await request('/shifts', { token: hqToken });
  assert.ok(Array.isArray(shifts) && shifts.length, 'HQ account returned no shifts');

  const privacy = await request('/privacy/status', { token: patientToken });
  if (!privacy.accepted) {
    const notice = await request('/privacy/notice');
    const guardian = privacy.minor
      ? { name: '演示监护人（验收）', relationship: '监护人', accepted: true }
      : null;
    await request('/privacy/consent', {
      token: patientToken,
      method: 'POST',
      body: {
        policyVersion: notice.policyVersion,
        noticeAccepted: true,
        sensitiveAccepted: true,
        guardian,
      },
    });
  }

  const policy = await request('/booking-policy');
  const earliestAllowed = Date.now() + (policy.cancellationNoticeMinutes + 15) * 60_000;
  const template = shifts.find(shift => shift.status === 'published' && shift.serviceIds?.length);
  assert.ok(template, 'HQ returned no published shift with a service to reuse');
  const serviceId = template.serviceIds[0];
  const today = shanghaiDate(new Date().toISOString());
  const latestDate = policy.queryWindow?.toDate;
  assert.ok(latestDate, 'Booking policy did not return the query-window end date');
  let newShift;
  for (let offset = 30; ; offset++) {
    const date = addDays(today, offset);
    if (date > latestDate) break;
    const startsAt = `${date}T09:00:00+08:00`;
    const endsAt = `${date}T17:00:00+08:00`;
    const adjacentShifts = [
      ...shifts,
      ...(await request(`/shifts?date=${addDays(date, -1)}`, { token: hqToken })),
      ...(await request(`/shifts?date=${date}`, { token: hqToken })),
    ];
    const conflict = adjacentShifts.some(shift => {
      if (shift.status !== 'published' || shift.doctorId !== template.doctorId) return false;
      const transferMs = shift.clinicId === template.clinicId ? 0 : policy.transferBufferMinutes * 60_000;
      return Date.parse(shift.startsAt) < Date.parse(endsAt) + transferMs
        && Date.parse(shift.endsAt) > Date.parse(startsAt) - transferMs;
    });
    if (conflict) continue;
    newShift = await request('/staff/shifts', {
      token: hqToken,
      method: 'POST',
      body: { clinicId: template.clinicId, doctorId: template.doctorId, serviceIds: [serviceId], startsAt, endsAt },
    });
    break;
  }
  assert.ok(newShift, 'No conflict-free future date was available for a synthetic shift');

  const initialSlots = (await slotsForShift(newShift, serviceId, patientToken))
    .filter(slot => Date.parse(slot.startsAt) >= earliestAllowed);
  assert.ok(initialSlots.length >= 2, 'New synthetic shift did not produce two available slots');
  const initialSlot = initialSlots[0];
  const initialHold = await holdSlot(initialSlot, patientToken);
  const appointment = await request('/appointments/confirm', {
    token: patientToken,
    method: 'POST',
    idempotencyKey: randomUUID(),
    body: {
      holdId: initialHold.id,
      holdVersion: initialHold.rowVersion,
      patientConfirmed: true,
      rulesAccepted: true,
    },
  });
  assert.equal(appointment.status, 'confirmed', 'Patient confirmation did not create a confirmed appointment');

  const rescheduleSlot = (await slotsForShift(newShift, serviceId, patientToken))
    .find(slot => slot.startsAt !== initialSlot.startsAt && Date.parse(slot.startsAt) >= earliestAllowed);
  assert.ok(rescheduleSlot, 'New synthetic shift has no second available time for rescheduling');
  const rescheduleHold = await holdSlot(rescheduleSlot, patientToken);
  const replacement = await request(`/appointments/${appointment.id}/changes`, {
    token: patientToken,
    method: 'POST',
    idempotencyKey: randomUUID(),
    body: {
      intent: 'reschedule',
      expectedVersion: appointment.rowVersion,
      reason: '本地服务器验收合成改期',
      holdId: rescheduleHold.id,
      holdVersion: rescheduleHold.rowVersion,
    },
  });
  assert.equal(replacement.status, 'confirmed', 'Patient rescheduling did not create a confirmed replacement');
  assert.equal(replacement.supersedesAppointmentId, appointment.id, 'Replacement does not link to the old appointment');

  const staffPath = `/staff/appointments?${new URLSearchParams({
    clinicId: newShift.clinicId,
    date: shanghaiDate(newShift.startsAt),
    pageSize: '100',
  })}`;
  const staffAfterReschedule = await request(staffPath, { token: hqToken });
  assert.ok(staffAfterReschedule.items.some(item => item.id === appointment.id && item.status === 'rescheduled'),
    'HQ schedule did not show the old appointment as rescheduled');
  assert.ok(staffAfterReschedule.items.some(item => item.id === replacement.id && item.status === 'confirmed'),
    'HQ schedule did not show the replacement appointment as confirmed');

  const cancelled = await request(`/appointments/${replacement.id}/changes`, {
    token: patientToken,
    method: 'POST',
    idempotencyKey: randomUUID(),
    body: {
      intent: 'cancel',
      expectedVersion: replacement.rowVersion,
      reason: '本地服务器验收合成取消',
    },
  });
  assert.equal(cancelled.status, 'cancelled', 'Patient cancellation did not return cancelled status');
  const staffAfter = await request(staffPath, { token: hqToken });
  assert.ok(staffAfter.items.some(item => item.id === appointment.id && item.status === 'rescheduled'),
    'HQ schedule did not preserve the old appointment as rescheduled');
  assert.ok(staffAfter.items.some(item => item.id === replacement.id && item.status === 'cancelled'),
    'HQ schedule did not show the cancelled replacement appointment');

  console.log(JSON.stringify({
    status: 'passed',
    checks: ['hq-shifts', 'hq-publishes-conflict-free-shift', 'patient-privacy-consent', 'patient-books-new-shift', 'patient-reschedules-to-second-slot', 'hq-sees-old-and-new-status', 'patient-cancels-replacement', 'hq-sees-final-status'],
    syntheticShiftDate: shanghaiDate(newShift.startsAt),
    oldAppointmentStatus: 'rescheduled',
    replacementAppointmentStatus: cancelled.status,
    requestOnlySyntheticAccounts: ['hq', 'patient.a'],
    dataCleanup: 'none; only a synthetic demo appointment was created and cancelled',
  }, null, 2));
}

main().catch(error => {
  console.error(`Server smoke check failed: ${error.message}`);
  process.exitCode = 1;
});
