/** Real Chrome + real HTTP + PostgreSQL acceptance. No mocked business responses.
 * The single fault injection drops a successful confirmation response after the
 * real API commits, so the browser must recover the original command receipt.
 * Run only against an explicitly enabled local development/test environment.
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import pg from 'pg';
import { chromium, expect } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: resolve(root, '.env.booking'), quiet: true });
const base =
  (process.env.BOOKING_API_TEST_URL || 'http://127.0.0.1:3310').replace(/\/$/, '') + '/api/v1';
const admin = (process.env.BOOKING_ADMIN_TEST_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');
for (const address of [base, admin]) {
  assert.ok(
    ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(address).hostname),
    'This creates synthetic fixtures: local hosts only',
  );
}
assert.notEqual(process.env.NODE_ENV, 'production', 'Never run browser fixtures in production');
assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is needed for exact synthetic-account cleanup');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const namespace = `UIQA${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const screenshots = resolve(root, 'screenshots', 'booking', namespace);
const output = resolve(root, 'docs', 'implementation', 'qa');
mkdirSync(screenshots, { recursive: true });
mkdirSync(output, { recursive: true });
const report = {
  namespace,
  startedAt: new Date().toISOString(),
  status: 'running',
  environment: { api: base, admin, browser: process.env.CHROME_CHANNEL || 'chrome' },
  checks: [],
  screenshots: [],
  fixture: {},
  cleanup: {},
};
const fixture = {};
let browser;
let hq;
const pageErrors = [];
function check(name, detail = {}) {
  report.checks.push({ name, status: 'passed', ...detail });
  console.log(`PASS ${name}`);
}
function day(offset) {
  return new Date(Date.now() + (offset * 24 + 8) * 3600000).toISOString().slice(0, 10);
}
const bookingDate = day(16);

async function api(path, { method = 'GET', body, token, key } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  const payload = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(payload)}`);
  assert.ok(payload && 'data' in payload && typeof payload.requestId === 'string');
  return payload.data;
}
const post = (path, body, token, key) => api(path, { method: 'POST', body, token, key });
const put = (path, body, token) => api(path, { method: 'PUT', body, token });
function selection(slot) {
  return Object.fromEntries(
    ['clinicId', 'serviceId', 'doctorId', 'chairId', 'shiftId', 'startsAt'].map((key) => [
      key,
      slot[key],
    ]),
  );
}
function slotQuery() {
  return (
    '/booking-slots?' +
    new URLSearchParams({
      clinicId: fixture.clinic.id,
      serviceId: fixture.service.id,
      doctorId: fixture.doctor.id,
      date: bookingDate,
    })
  );
}
async function shot(page, name) {
  await page.screenshot({ path: resolve(screenshots, `${name}.png`), fullPage: true });
  report.screenshots.push(`screenshots/booking/${namespace}/${name}.png`);
}
async function pageFor(account) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(admin + '/login');
  await expect(page.getByRole('heading', { name: '登录预约工作台' })).toBeVisible();
  await page.locator('.demo-login .el-select').click();
  await page
    .getByRole('option', { name: `${account.displayName} · ${account.username}`, exact: true })
    .click();
  await page.getByRole('button', { name: '进入开发工作台', exact: true }).click();
  await expect(page).toHaveURL(/\/appointments$/);
  await expect(page.locator('.account')).toContainText(account.displayName);
  return page;
}
function item(container, label) {
  return container.locator('.el-form-item').filter({ hasText: label }).first();
}
async function choose(page, field, label) {
  await field.locator('.el-select').click();
  await page.getByRole('option', { name: label, exact: true }).click();
}
async function inputDate(field, value) {
  const input = field.locator('.el-date-editor input');
  await input.fill(value);
  await input.press('Tab');
}
function responseFor(page, path, method = 'POST') {
  return page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/v1' + path &&
      response.request().method() === method,
  );
}
async function assertResponse(response) {
  const payload = await response.json();
  assert.equal(response.status(), 200, JSON.stringify(payload));
  return payload.data;
}
async function filterAppointments(page) {
  await page.goto(admin + '/appointments');
  const dateItem = item(page.locator('.filter-bar'), '日期');
  const response = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/v1/staff/appointments' &&
      new URL(response.url()).searchParams.get('date') === bookingDate,
  );
  await inputDate(dateItem, bookingDate);
  await assertResponse(await response);
}
async function startBooking(page, appointmentId) {
  await page.goto(admin + (appointmentId ? `/booking?appointmentId=${appointmentId}` : '/booking'));
  await expect(
    page.getByRole('heading', { name: appointmentId ? '为患者改期' : '患者代约', exact: true }),
  ).toBeVisible();
  if (!appointmentId) {
    await page.getByPlaceholder('输入姓名或联系电话', { exact: true }).fill(fixture.patient.name);
    const response = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/v1/staff/patients',
    );
    await page.getByRole('button', { name: '查找患者', exact: true }).click();
    const patients = await assertResponse(await response);
    assert.equal(patients.items.length, 1);
    await page.locator('.patient-result').filter({ hasText: fixture.patient.name }).click();
    await choose(page, item(page, '就诊门诊'), fixture.clinic.name);
    await choose(
      page,
      item(page, '预约服务'),
      `${fixture.service.name} · ${fixture.service.durationMinutes} 分钟`,
    );
    await inputDate(item(page, '就诊日期'), bookingDate);
  } else {
    await expect(page.locator('.selected-patient')).toContainText(fixture.patient.name);
  }
  const slotsResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/v1/booking-slots',
  );
  await page.getByRole('button', { name: '查询可预约时段', exact: true }).click();
  const slots = await assertResponse(await slotsResponse);
  assert.ok(slots.length > 0);
  return slots;
}
async function chooseTime(page, hhmm) {
  const response = responseFor(page, '/booking-holds');
  await page
    .locator('.slot-button')
    .filter({ has: page.locator('strong').filter({ hasText: new RegExp(`^${hhmm} `) }) })
    .first()
    .click();
  const hold = await assertResponse(await response);
  assert.equal(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(hold.slot.startsAt)),
    hhmm,
  );
  await expect(page.locator('.countdown')).toContainText('时段保留');
  return hold;
}
async function accept(page) {
  for (const label of ['已向患者核对门诊、医生和时段', '患者已知晓并接受预约规则']) {
    const checkbox = page.locator('.confirmation-checks .el-checkbox').filter({ hasText: label });
    await checkbox.click();
    await expect(checkbox.locator('input[type="checkbox"]')).toBeChecked();
  }
}
async function cleanup() {
  const errors = [];
  // Match exact IDs created in this invocation; never update/delete by prefix alone.
  if (hq && fixture.patient && fixture.doctor && fixture.service) {
    try {
      const matches = await pool.query(
        `SELECT a.id FROM appointments a JOIN resource_reservations r ON r.id=a.reservation_id WHERE a.patient_id=$1 AND r.doctor_id=$2 AND r.service_id=$3`,
        [fixture.patient.id, fixture.doctor.id, fixture.service.id],
      );
      let cancelled = 0;
      for (const { id } of matches.rows) {
        const appointment = await api(`/appointments/${id}`, { token: hq.token });
        if (appointment.status === 'confirmed') {
          await post(
            `/appointments/${id}/changes`,
            {
              intent: 'cancel',
              expectedVersion: appointment.rowVersion,
              reason: `${namespace} 浏览器验收收尾`,
            },
            hq.token,
            randomUUID(),
          );
          cancelled++;
        }
      }
      report.cleanup.additionalAppointmentsCancelled = cancelled;
      // Release only still-held reservations for the exact synthetic patient +
      // exact new doctor + exact new service, e.g. when an assertion stops early.
      const expired = await pool.query(
        `UPDATE resource_reservations SET status='expired',expires_at=least(expires_at,clock_timestamp()) WHERE status='held' AND patient_id=$1 AND doctor_id=$2 AND service_id=$3 RETURNING id`,
        [fixture.patient.id, fixture.doctor.id, fixture.service.id],
      );
      report.cleanup.unconsumedSyntheticHoldsExpired = expired.rowCount;
    } catch (error) {
      errors.push(`appointments: ${error.message}`);
    }
  }
  if (hq && fixture.shift) {
    try {
      const shifts = await api(
        '/shifts?' + new URLSearchParams({ clinicId: fixture.clinic.id, date: bookingDate }),
        { token: hq.token },
      );
      const shift = shifts.find((value) => value.id === fixture.shift.id);
      if (shift?.status === 'published')
        await post(
          `/staff/shifts/${shift.id}/cancel`,
          { expectedVersion: shift.rowVersion },
          hq.token,
        );
      report.cleanup.shiftCancelled = true;
    } catch (error) {
      errors.push(`shift: ${error.message}`);
    }
  }
  if (hq) {
    for (const [kind, key] of [
      ['services', 'service'],
      ['doctors', 'doctor'],
      ['chairs', 'chair'],
      ['qualifications', 'qualification'],
    ]) {
      const saved = fixture[key];
      if (!saved) continue;
      try {
        const body = { ...saved.input, active: false, expectedVersion: saved.rowVersion };
        await put(`/staff/${kind}/${saved.id}`, body, hq.token);
        report.cleanup[`${key}Inactive`] = true;
      } catch (error) {
        errors.push(`${key}: ${error.message}`);
      }
    }
  }
  if (fixture.account) {
    try {
      const connection = await pool.connect();
      try {
        await connection.query('BEGIN');
        const rows = await connection.query(
          'SELECT id,username FROM users WHERE id=$1 FOR UPDATE',
          [fixture.account.id],
        );
        assert.equal(rows.rowCount, 1);
        assert.equal(rows.rows[0].username, fixture.account.username);
        assert.ok(fixture.account.username.startsWith(namespace.toLowerCase() + '.'));
        await connection.query('UPDATE users SET active=false WHERE id=$1 AND username=$2', [
          fixture.account.id,
          fixture.account.username,
        ]);
        await connection.query('DELETE FROM sessions WHERE user_id=$1', [fixture.account.id]);
        await connection.query('COMMIT');
        report.cleanup.syntheticAccountInactive = true;
      } catch (error) {
        await connection.query('ROLLBACK');
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      errors.push(`account: ${error.message}`);
    }
  }
  report.cleanup.errors = errors;
  if (errors.length) throw new Error('Cleanup incomplete: ' + errors.join('; '));
}

try {
  assert.equal((await api('/health')).database, 'postgresql');
  report.environment.postgresqlVersion = (
    await pool.query('SHOW server_version')
  ).rows[0].server_version;
  const authConfig = await api('/auth/config');
  assert.equal(
    authConfig.demoLoginEnabled,
    true,
    'Enable ALLOW_DEMO_LOGIN for isolated local acceptance',
  );
  const staff = [];
  for (const account of authConfig.demoAccounts.filter((value) => value.portal === 'staff')) {
    const result = await post('/auth/demo', { username: account.username, portal: 'staff' });
    staff.push({ account, ...result });
  }
  hq = staff.find((value) => value.user.roles.includes('hq'));
  const front = staff.find((value) => value.user.roles.includes('front'));
  const manager = staff.find((value) => value.user.roles.includes('manager'));
  const doctor = staff.find((value) => value.user.roles.includes('doctor'));
  assert.ok(hq && front && manager && doctor, 'Need server-provided staff demo roles');
  const clinics = await api('/clinics?includeInactive=true', { token: hq.token });
  fixture.clinic = clinics.find(
    (value) =>
      value.active && front.user.assignments.some((assignment) => assignment.clinicId === value.id),
  );
  assert.ok(fixture.clinic, 'Need an active front-desk authorized clinic');
  const makeResource = async (kind, key, input) => {
    const value = await post(`/staff/${kind}`, input, hq.token);
    fixture[key] = { ...value, input };
    return value;
  };
  const qualification = await makeResource('qualifications', 'qualification', {
    name: `${namespace}专用资格`,
    active: true,
  });
  const doctorInput = {
    employeeNo: `${namespace}-D`,
    name: `${namespace}医生`,
    phone: '020-88889991',
    specialty: '浏览器合成验收',
    active: true,
    qualifications: [
      {
        qualificationId: qualification.id,
        validFrom: `${day(-1)}T00:00:00+08:00`,
        validUntil: null,
      },
    ],
  };
  await makeResource('doctors', 'doctor', doctorInput);
  await makeResource('services', 'service', {
    name: `${namespace}预约检查`,
    description: '自动化验收合成服务，无临床诊断。',
    durationMinutes: 30,
    bufferMinutes: 10,
    priceCents: 9900,
    unit: '次',
    active: true,
    clinicIds: [fixture.clinic.id],
    qualificationIds: [qualification.id],
  });
  await makeResource('chairs', 'chair', {
    clinicId: fixture.clinic.id,
    name: `${namespace}-椅`,
    active: true,
  });
  const username = `${namespace.toLowerCase()}.patient`;
  const profile = {
    name: `${namespace}顾客`,
    birthDate: '1998-08-08',
    phone: `199${String(Date.now()).slice(-8)}`,
    email: null,
    billingAddress: '自动化验收合成地址',
    emergencyName: '合成联系人',
    emergencyPhone: '19900000000',
    allergyStatus: 'unknown',
    allergies: [],
  };
  const patientSession = await post('/auth/register', {
    username,
    password: randomBytes(24).toString('base64url'),
    profile,
  });
  fixture.account = { id: patientSession.user.id, username };
  fixture.patient = await api('/patients/me', { token: patientSession.token });
  report.fixture = {
    clinicId: fixture.clinic.id,
    qualificationId: fixture.qualification.id,
    doctorId: fixture.doctor.id,
    serviceId: fixture.service.id,
    chairId: fixture.chair.id,
    patientId: fixture.patient.id,
    userId: fixture.account.id,
    date: bookingDate,
  };
  check('独立合成夹具与真实PostgreSQL连接', { namespace, date: bookingDate });

  browser = await chromium.launch({
    headless: true,
    channel: process.env.CHROME_CHANNEL || 'chrome',
  });
  report.environment.browserVersion = browser.version();
  const hqPage = await pageFor(hq.account);
  check('总部通过真实浏览器登录');
  await shot(hqPage, '01-overview-desktop');
  await hqPage.goto(admin + '/shifts');
  await hqPage.getByRole('button', { name: '发布班次', exact: true }).click();
  const dialog = hqPage.getByRole('dialog', { name: '发布医生班次' });
  await choose(hqPage, item(dialog, '开展门诊'), fixture.clinic.name);
  await choose(
    hqPage,
    item(dialog, '出诊医生'),
    `${fixture.doctor.name} · ${fixture.doctor.specialty}`,
  );
  await inputDate(item(dialog, '开始时间'), `${bookingDate} 09:00`);
  await inputDate(item(dialog, '结束时间'), `${bookingDate} 13:00`);
  await choose(hqPage, item(dialog, '本班次开展服务'), fixture.service.name);
  await dialog.getByText('发布医生班次', { exact: true }).click();
  await shot(hqPage, '02-publish-shift');
  const shiftResponse = responseFor(hqPage, '/staff/shifts');
  await dialog.getByRole('button', { name: '校验并发布', exact: true }).click();
  fixture.shift = await assertResponse(await shiftResponse);
  assert.equal(fixture.shift.doctorId, fixture.doctor.id);
  await expect(dialog).not.toBeVisible();
  const slots = await api(slotQuery(), { token: patientSession.token });
  assert.ok(slots.length >= 2 && slots.every((value) => value.doctorId === fixture.doctor.id));
  check('UI发布未来班次，真实HTTP查询到对应号源', {
    shiftId: fixture.shift.id,
    slotCount: slots.length,
  });
  const datePicker = hqPage.locator('.filter-bar .el-date-editor');
  await datePicker.hover();
  const allShiftsResponse = hqPage.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/v1/shifts' &&
      !new URL(response.url()).searchParams.has('date'),
  );
  await datePicker.locator('.el-input__suffix .clear-icon').click();
  assert.ok(
    (await assertResponse(await allShiftsResponse)).some((value) => value.id === fixture.shift.id),
  );
  check('排班日期清空后查询全部授权日期，不发送null字符串');

  const initialSlot = slots.find((value) => value.startsAt.endsWith('02:00:00.000Z')) || slots[0];
  const hold = await post('/booking-holds', selection(initialSlot), patientSession.token);
  const initial = await post(
    '/appointments/confirm',
    { holdId: hold.id, holdVersion: hold.rowVersion, patientConfirmed: true, rulesAccepted: true },
    patientSession.token,
    randomUUID(),
  );
  assert.equal(initial.status, 'confirmed');
  report.fixture.patientAppointmentId = initial.id;
  check('患者API实际预约成功', { appointmentId: initial.id });

  const frontPage = await pageFor(front.account);
  await filterAppointments(frontPage);
  let row = frontPage.locator('.el-table__row').filter({ hasText: fixture.patient.name });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(fixture.service.name);
  await row.click();
  const drawer = frontPage.locator('.el-drawer');
  await expect(drawer).toContainText(initial.appointmentNo);
  check('前台UI看到患者API创建的同一笔预约', { appointmentNo: initial.appointmentNo });
  await shot(frontPage, '03-shared-appointment-detail');
  await drawer.getByRole('button', { name: '取消预约', exact: true }).click();
  const prompt = frontPage.locator('.el-message-box');
  await prompt.locator('.el-message-box__input input').fill(`${namespace}患者确认取消`);
  const cancelledResponse = responseFor(frontPage, `/appointments/${initial.id}/changes`);
  await prompt.getByRole('button', { name: '确认取消', exact: true }).click();
  assert.equal((await assertResponse(await cancelledResponse)).status, 'cancelled');
  assert.equal(
    (await api(`/appointments/${initial.id}`, { token: patientSession.token })).status,
    'cancelled',
  );
  const released = await api(slotQuery(), { token: patientSession.token });
  assert.ok(
    released.some(
      (value) => value.startsAt === initialSlot.startsAt && value.doctorId === initialSlot.doctorId,
    ),
    'Same doctor/time becomes available after UI cancellation',
  );
  check('UI取消与资源释放在患者端同源可见');

  await startBooking(frontPage);
  await chooseTime(frontPage, '10:00');
  const confirmButton = frontPage.getByRole('button', { name: '确认预约', exact: true });
  await expect(confirmButton).toBeDisabled();
  await accept(frontPage);
  await expect(confirmButton).toBeEnabled();
  await shot(frontPage, '04-assisted-booking-confirmation');
  let committed;
  const lostResponse = new Promise((resolveLost, rejectLost) => {
    frontPage
      .route(
        '**/api/v1/appointments/confirm',
        async (route) => {
          try {
            const response = await route.fetch();
            committed = await assertResponse(response);
            resolveLost(committed);
            await route.abort('connectionreset');
          } catch (error) {
            rejectLost(error);
            await route.abort('failed');
          }
        },
        { times: 1 },
      )
      .catch(rejectLost);
  });
  await confirmButton.click();
  await lostResponse;
  assert.equal(committed.status, 'confirmed');
  await expect(
    frontPage.getByText('有一笔提交结果待确认。请查询后继续，避免重复预约。', { exact: true }),
  ).toBeVisible();
  await expect(frontPage).toHaveURL(/\/booking$/);
  await shot(frontPage, '05-network-result-unknown');
  const ownerPending = await frontPage.evaluate(() =>
    Object.keys(sessionStorage).filter((key) => key.startsWith('andrew.staff.pending-command.')),
  );
  assert.ok(ownerPending.length === 1 && ownerPending[0].endsWith(front.user.id));
  await frontPage.reload();
  await expect(frontPage.getByRole('button', { name: '查询操作结果', exact: true })).toBeVisible();
  await frontPage.getByRole('button', { name: '查询操作结果', exact: true }).click();
  await expect(frontPage).toHaveURL(/\/appointments$/);
  const list = await api(
    '/staff/appointments?' +
      new URLSearchParams({
        clinicId: fixture.clinic.id,
        date: bookingDate,
        status: 'confirmed',
        pageSize: '100',
      }),
    { token: hq.token },
  );
  const same = list.items.filter(
    (value) => value.patientId === fixture.patient.id && value.serviceId === fixture.service.id,
  );
  assert.equal(same.length, 1);
  assert.equal(same[0].id, committed.id);
  assert.equal(
    await frontPage.evaluate(() =>
      Object.keys(sessionStorage).some((key) => key.startsWith('andrew.staff.pending-command.')),
    ),
    false,
  );
  check('前台UI完整代约、双确认、响应丢失后刷新恢复同一笔回执', {
    appointmentId: committed.id,
    noDuplicate: true,
  });
  report.fixture.staffAppointmentId = committed.id;

  await startBooking(frontPage, committed.id);
  await chooseTime(frontPage, '11:00');
  await frontPage
    .getByPlaceholder('请填写改期原因（至少 2 字）', { exact: true })
    .fill(`${namespace}患者申请改期`);
  await accept(frontPage);
  const changedResponse = responseFor(frontPage, `/appointments/${committed.id}/changes`);
  await frontPage.getByRole('button', { name: '确认改期', exact: true }).click();
  const replacement = await assertResponse(await changedResponse);
  assert.equal(replacement.supersedesAppointmentId, committed.id);
  const previous = await api(`/appointments/${committed.id}`, { token: patientSession.token });
  assert.equal(previous.status, 'rescheduled');
  assert.equal(previous.replacementAppointmentId, replacement.id);
  const availableAgain = await api(slotQuery(), { token: patientSession.token });
  assert.ok(
    availableAgain.some((value) => value.startsAt === committed.startsAt),
    'Original doctor/time released after successful atomic reschedule',
  );
  check('UI原子改期保留替代链并释放原时段', {
    previousId: committed.id,
    replacementId: replacement.id,
  });
  report.fixture.replacementAppointmentId = replacement.id;

  await filterAppointments(frontPage);
  await frontPage.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await frontPage.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    'Mobile viewport must not overflow horizontally',
  );
  await shot(frontPage, '06-overview-mobile');
  check('390px工作台布局无页面横向溢出');

  const managerPage = await pageFor(manager.account);
  await managerPage.goto(admin + '/resources/services');
  await expect(
    managerPage.getByText('共享资源由总部统一维护，当前岗位可查看资料。', { exact: true }),
  ).toBeVisible();
  assert.equal(await managerPage.getByRole('button', { name: '新增服务', exact: true }).count(), 0);
  await managerPage.goto(admin + '/resources/clinics');
  assert.equal(await managerPage.getByRole('button', { name: '新增门诊', exact: true }).count(), 0);
  const doctorPage = await pageFor(doctor.account);
  assert.equal(await doctorPage.locator('nav a[href="/booking"]').count(), 0);
  assert.equal(await doctorPage.locator('nav a[href="/patients"]').count(), 0);
  await doctorPage.goto(admin + '/booking');
  await expect(doctorPage).toHaveURL(/\/appointments$/);
  check('店长共享资料只读、医生无代约入口且直接路由受控');
  assert.deepEqual(pageErrors, []);
  check('所有验收页面无未捕获浏览器异常');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = error.stack || error.message;
  console.error(error.stack || error.message);
  if (browser)
    for (const [index, context] of browser.contexts().entries())
      for (const [pageIndex, page] of context.pages().entries()) {
        try {
          await shot(page, `failure-${index}-${pageIndex}`);
        } catch {}
      }
  process.exitCode = 1;
} finally {
  try {
    await cleanup();
  } catch (error) {
    report.status = 'failed';
    report.cleanupError = error.message;
    console.error(error.message);
    process.exitCode = 1;
  }
  if (browser) await browser.close();
  await pool.end();
  report.finishedAt = new Date().toISOString();
  writeFileSync(resolve(output, 'browser.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({
      status: report.status,
      checks: report.checks.length,
      namespace,
      report: 'docs/implementation/qa/browser.json',
    }),
  );
}
