/** Real Chrome read-only doctor view acceptance. Only doctor.a login/logout may write sessions. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = (process.env.BOOKING_API_TEST_URL || 'http://127.0.0.1:3310').replace(/\/$/, '') + '/api/v1';
const admin = (process.env.BOOKING_ADMIN_TEST_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');
for (const address of [base, admin]) {
  const url = new URL(address);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Local API and Vue only');
  assert.equal(url.protocol, 'http:', 'This check is for the local development environment');
}
assert.notEqual(process.env.NODE_ENV, 'production', 'Do not run demo acceptance in production');
const namespace = 'doctor-view-' + Date.now().toString(36);
const screenshots = resolve(root, 'screenshots', 'booking', namespace);
const output = resolve(root, 'docs', 'implementation', 'qa', 'doctor-view.json');
mkdirSync(screenshots, { recursive: true });
mkdirSync(dirname(output), { recursive: true });
const sourcePaths = ['scripts/booking-doctor-view.mjs', 'booking-api/src/app.ts', 'booking-api/src/auth.ts',
  'booking-api/src/services/booking.ts', 'admin-web/src/router.ts', 'admin-web/src/stores/auth.ts',
  'admin-web/src/views/ShiftsView.vue', 'admin-web/src/views/AppointmentsView.vue', 'admin-web/src/visible-refresh.ts'];
const hashes = () => sourcePaths.map(path => ({ path, sha256: createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex') }));
const report = {
  status: 'running', startedAt: new Date().toISOString(), command: 'node scripts/booking-doctor-view.mjs',
  execution: 'Real installed Google Chrome, rendered Vue UI and real HTTP; existing doctor.a data only',
  environment: { api: base, admin, browser: 'chrome', headless: true, timezone: 'Asia/Shanghai' },
  sourceFiles: hashes(), sourceHashesAreWorkspaceSnapshot: true,
  checks: [], screenshots: [], blockedMutations: [], pageErrors: [],
  businessDataWritten: false, allowedSessionWrites: [], limitations: [],
};
let browser, context, token;
const check = (name, detail = {}) => { report.checks.push({ name, status: 'passed', ...detail }); console.log('PASS ' + name); };
const day = value => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
async function read(path) {
  const response = await fetch(base + path, { headers: { Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, signal: AbortSignal.timeout(20000), redirect: 'error' });
  const payload = await response.json();
  assert.equal(response.status, 200, `${path}: ${response.status}`);
  assert.ok(payload && 'data' in payload && payload.requestId);
  return payload.data;
}
async function responseData(response) {
  assert.equal(response.status(), 200, new URL(response.url()).pathname);
  const result = await response.json();
  assert.ok(result && 'data' in result && result.requestId);
  return result.data;
}
async function shot(page, filename) {
  await page.screenshot({ path: resolve(screenshots, filename + '.png'), fullPage: true });
  report.screenshots.push(`screenshots/booking/${namespace}/${filename}.png`);
}
async function selectDate(page, pathname, date) {
  const input = page.locator('.filter-bar .el-form-item').filter({ hasText: '日期' }).first().locator('.el-date-editor input');
  const response = page.waitForResponse(value => {
    const url = new URL(value.url());
    return url.pathname === '/api/v1' + pathname && url.searchParams.get('date') === date && value.request().method() === 'GET';
  });
  if (await input.inputValue() === date) await page.getByRole('button', { name: pathname === '/shifts' ? '刷新' : '刷新数据', exact: true }).click();
  else { await input.fill(date); await input.press('Tab'); }
  return responseData(await response);
}
async function noManagementEntries(page) {
  assert.equal(await page.locator('nav a[href^="/resources/"]').count(), 0);
  assert.equal(await page.locator('nav a[href="/booking"]').count(), 0);
  assert.equal(await page.locator('nav a[href="/patients"]').count(), 0);
  assert.equal(await page.getByRole('button', { name: '新建预约', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '为患者预约', exact: true }).count(), 0);
}

try {
  assert.equal((await read('/health')).database, 'postgresql');
  const config = await read('/auth/config');
  assert.equal(config.demoLoginEnabled, true, 'Explicitly enabled local demo login required');
  const account = config.demoAccounts.find(value => value.username === 'doctor.a' && value.portal === 'staff');
  assert.ok(account, 'Use only the known doctor.a synthetic account');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  report.environment.browserVersion = browser.version();
  context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  await context.route('**/api/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.continue();
    if (request.method() === 'POST' && path === '/api/v1/auth/demo') {
      const input = request.postDataJSON();
      if (input.username === 'doctor.a' && input.portal === 'staff') {
        report.allowedSessionWrites.push({ method: 'POST', path, username: 'doctor.a' });
        return route.continue();
      }
    }
    report.blockedMutations.push({ method: request.method(), path });
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.goto(admin + '/login');
  await expect(page.getByRole('heading', { name: '登录预约工作台', exact: true })).toBeVisible();
  await page.locator('.demo-login .el-select').click();
  await page.getByRole('option', { name: `${account.displayName} · doctor.a`, exact: true }).click();
  const loginResponse = page.waitForResponse(value => new URL(value.url()).pathname === '/api/v1/auth/demo' && value.request().method() === 'POST');
  await page.getByRole('button', { name: '进入开发工作台', exact: true }).click();
  const login = await responseData(await loginResponse);
  token = login.token;
  await expect(page).toHaveURL(admin + '/appointments');
  const me = await read('/me');
  assert.equal(me.username, 'doctor.a');
  assert.deepEqual(me.roles, ['doctor']);
  assert.ok(me.staffId, 'The real account must have a linked staff record');
  assert.equal(me.staffId, login.user.staffId);
  const proxyMe = await page.request.get(admin + '/api/v1/me', { headers: { Authorization: 'Bearer ' + token } });
  const proxyPrincipal = await responseData(proxyMe);
  assert.equal(proxyPrincipal.id, me.id);
  assert.equal(proxyPrincipal.staffId, me.staffId);
  report.principal = { id: me.id, staffId: me.staffId, roles: me.roles, clinicIds: me.assignments.map(value => value.clinicId) };
  check('真实Chrome通过医生演示入口登录，两API入口返回同一当前医生');

  const allShifts = await read('/shifts');
  assert.ok(allShifts.length > 0, 'An empty response cannot prove doctor ownership');
  assert.ok(allShifts.every(shift => shift.doctorId === me.staffId));
  const future = allShifts.filter(shift => shift.status === 'published' && Date.parse(shift.endsAt) > Date.now()).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  assert.ok(future.length > 0, 'Use an existing future shift; never create one for this read-only check');
  const shiftDate = day(future[0].startsAt);
  await page.goto(admin + '/shifts');
  await expect(page.getByRole('heading', { name: '医生排班', exact: true })).toBeVisible();
  const visibleShifts = await selectDate(page, '/shifts', shiftDate);
  assert.ok(visibleShifts.length > 0);
  assert.ok(visibleShifts.every(shift => shift.doctorId === me.staffId));
  await expect(page.locator('.el-table__row')).toHaveCount(visibleShifts.length);
  assert.equal(await page.getByRole('button', { name: '发布班次', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '撤销班次', exact: true }).count(), 0);
  await noManagementEntries(page);
  check('真实排班页显示非空本人班次，后端每条doctorId等于当前staffId', { date: shiftDate, queriedRows: allShifts.length, renderedRows: visibleShifts.length, shiftIds: visibleShifts.map(value => value.id) });
  check('医生排班页无发布和撤销按钮，导航无资源维护、代约与患者管理入口');
  await shot(page, '01-own-shifts-readonly');

  const allAppointments = await read('/staff/appointments?pageSize=100');
  assert.ok(allAppointments.items.every(appointment => appointment.doctorId === me.staffId));
  const appointmentDate = allAppointments.items.length ? day(allAppointments.items[0].startsAt) : shiftDate;
  await page.goto(admin + '/appointments');
  await expect(page.getByRole('heading', { name: /今日预约|预约总览/ })).toBeVisible();
  const visibleAppointments = await selectDate(page, '/staff/appointments', appointmentDate);
  assert.ok(visibleAppointments.items.every(appointment => appointment.doctorId === me.staffId));
  await expect(page.locator('.el-table__row')).toHaveCount(visibleAppointments.items.length);
  await noManagementEntries(page);
  if (allAppointments.items.length) {
    assert.ok(visibleAppointments.items.length > 0);
    check('真实预约页返回并显示非空本人预约', { date: appointmentDate, totalAcrossDates: allAppointments.total, renderedRows: visibleAppointments.items.length, appointmentIds: visibleAppointments.items.map(value => value.id) });
    const detailResponse = page.waitForResponse(value => /^\/api\/v1\/appointments\/[^/]+$/.test(new URL(value.url()).pathname) && value.request().method() === 'GET');
    await page.getByRole('button', { name: '查看', exact: true }).first().click();
    const detail = await responseData(await detailResponse);
    assert.equal(detail.doctorId, me.staffId);
    await expect(page.getByRole('heading', { name: '预约详情', exact: true })).toBeVisible();
    assert.equal(await page.getByRole('button', { name: '为患者改期', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '取消预约', exact: true }).count(), 0);
    check('医生能打开本人预约详情，详情无取消或改期按钮', { appointmentId: detail.id });
  } else {
    report.limitations.push('当前医生没有既有预约，预约空列表只证明正常查询与只读入口；不能以空列表单独证明预约所有权。未创建任何预约补造证据。');
    report.appointmentOwnershipEvidence = 'inconclusive_empty_existing_data';
  }
  await shot(page, '02-own-appointments-readonly');
  for (const path of ['/booking', '/patients', '/resources/clinics', '/resources/doctors', '/resources/services', '/resources/chairs', '/resources/qualifications']) {
    await page.goto(admin + path);
    await expect(page).toHaveURL(admin + '/appointments');
    await noManagementEntries(page);
  }
  check('医生直接访问代约、患者管理及五类资源维护URL均回预约列表');
  assert.deepEqual(report.blockedMutations, []);
  assert.deepEqual(report.pageErrors, []);
  check('整个检查无业务写请求、无未捕获页面错误');
  report.sourceUnchangedDuringRun = JSON.stringify(hashes()) === JSON.stringify(report.sourceFiles);
  assert.equal(report.sourceUnchangedDuringRun, true);
  report.status = report.limitations.length ? 'passed_with_limitations' : 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = error.message;
  process.exitCode = 1;
} finally {
  await context?.close();
  await browser?.close();
  if (token) {
    try {
      const response = await fetch(base + '/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(15000), redirect: 'error' });
      assert.equal(response.status, 200);
      report.allowedSessionWrites.push({ method: 'POST', path: '/api/v1/auth/logout' });
      report.sessionRevoked = true;
    } catch (error) { report.sessionCleanupError = error.message; process.exitCode = 1; report.status = 'failed'; }
  }
  report.finishedAt = new Date().toISOString();
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, evidence: 'docs/implementation/qa/doctor-view.json' }));
}
