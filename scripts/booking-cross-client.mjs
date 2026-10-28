/** Cross-client acceptance with real Vue/Chrome, the official WeChat simulator
 * SDK and the same HTTP/PostgreSQL service. Synthetic local fixtures only.
 * Run: $env:CROSS_CLIENT_ALLOW_FIXTURES='1'; node scripts/booking-cross-client.mjs
 * Optional CROSS_CLIENT_MODE=compiled-native is explicitly an HTTP adapter,
 * not WeChat rendering. Default wechat connects an already prepared SDK port.
 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { config } from 'dotenv';
import pg from 'pg';
import { chromium, expect } from '@playwright/test';
import { artifactHash } from '../miniprogram/scripts/artifact-hash.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: resolve(root, '.env.booking'), quiet: true });
assert.equal(process.env.CROSS_CLIENT_ALLOW_FIXTURES, '1', 'Set CROSS_CLIENT_ALLOW_FIXTURES=1 to explicitly allow local synthetic fixtures');
assert.ok(['development', 'test'].includes(process.env.NODE_ENV), 'Only an explicit development/test environment is allowed');
const apiOrigin = (process.env.BOOKING_API_TEST_URL || 'http://127.0.0.1:3310').replace(/\/$/, '');
const base = apiOrigin + '/api/v1';
const admin = (process.env.BOOKING_ADMIN_TEST_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');
const local = address => ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(address).hostname);
assert.ok(local(base) && local(admin), 'External API/admin hosts are forbidden');
assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required for exact fixture checks and cleanup');
const databaseUrl = new URL(process.env.DATABASE_URL);
assert.ok(local(databaseUrl.href), 'External databases are forbidden');
assert.ok(!['', '/', '/postgres', '/template0', '/template1'].includes(databaseUrl.pathname), 'Use a dedicated development/test database');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const namespace = `XCLIENT${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const date = new Date(Date.now() + (16 * 24 + 8) * 3600000).toISOString().slice(0, 10);
const output = resolve(root, process.env.CROSS_CLIENT_REPORT_PATH || 'docs/implementation/qa/cross-client.json');
assert.ok(output.startsWith(resolve(root, 'docs/implementation/qa') + sep), 'Acceptance report must stay in docs/implementation/qa');
const screenshotDirectory = resolve(root, 'screenshots/booking', namespace);
mkdirSync(dirname(output), { recursive: true });
mkdirSync(screenshotDirectory, { recursive: true });
const dist = resolve(root, 'miniprogram/dist');
const mode = process.env.CROSS_CLIENT_MODE || 'wechat';
assert.ok(['wechat', 'compiled-native'].includes(mode), 'Unknown CROSS_CLIENT_MODE');
const sdkEndpoint = process.env.WECHAT_AUTOMATOR_ENDPOINT || 'ws://127.0.0.1:9420';
assert.ok(local(sdkEndpoint), 'External WeChat SDK endpoints are forbidden');
const wechatProjectPath = resolve(process.env.WECHAT_PROJECT_PATH || 'D:/AndrewDentalMiniProgram');
let wechatProject;
const report = {
  namespace, startedAt: new Date().toISOString(), status: 'running',
  mode,
  execution: mode === 'wechat' ? 'Real Vue browser + official miniprogram-automator SDK driving real WeChat DevTools simulator controls and rendered native pages + shared real HTTP/PostgreSQL; NOT physical device execution' : 'Real Vue browser + compiled-native-modules with wx.request-to-fetch HTTP adapter + real shared PostgreSQL; NOT WeChat rendering, DevTools or device execution',
  environment: { api: base, admin, browser: process.env.CHROME_CHANNEL || 'chrome' },
  nativeArtifactSha256: artifactHash(dist),
  checks: [], screenshots: [], fixture: {}, cleanup: {}, nativeRequests: [], vueListResponses: [], automaticVueSync: [],
};
const fixture = {};
const browserErrors = [];
let browser, hq, native, mini;
let vueList;
let vueListRequestUrl;
const vueObservers = new Set();
function check(name, details = {}) {
  report.checks.push({ name, status: 'passed', ...details });
  console.log(`PASS ${name}`);
}
function verifyWechatProject() {
  const projectPath = realpathSync(wechatProjectPath);
  const configPath = resolve(projectPath, 'project.config.json');
  const projectConfig = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(projectConfig.compileType, 'miniprogram', 'Expected a native mini-program project');
  assert.ok(typeof projectConfig.appid === 'string' && /^wx[\da-f]{16}$/i.test(projectConfig.appid), 'Configure a real public AppID; touristappid is not valid for this acceptance');
  assert.ok(typeof projectConfig.miniprogramRoot === 'string' && projectConfig.miniprogramRoot.trim(), 'project.config.json must declare miniprogramRoot');
  const miniprogramRoot = realpathSync(resolve(projectPath, projectConfig.miniprogramRoot));
  const relativeRoot = relative(projectPath, miniprogramRoot);
  assert.ok(relativeRoot !== '..' && !relativeRoot.startsWith('..' + sep) && !isAbsolute(relativeRoot), 'miniprogramRoot must stay inside the intended WeChat project');
  const compiledSha256 = artifactHash(miniprogramRoot);
  wechatProject = { projectPath, configPath, appId: projectConfig.appid, miniprogramRoot, compiledSha256, repositoryCompiledSha256: report.nativeArtifactSha256 };
  report.environment.wechatProject = wechatProject;
  assert.equal(compiledSha256, report.nativeArtifactSha256, 'The opened WeChat project has stale/different compiled files. Synchronize its miniprogramRoot with repository miniprogram/dist before acceptance');
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(resolve(miniprogramRoot, 'config.js'), 'utf8'), { module, exports: module.exports }, { filename: resolve(miniprogramRoot, 'config.js'), timeout: 500 });
  assert.equal(module.exports.apiBaseUrl, base, 'The real WeChat project must use the exact same API as Vue/SQL acceptance');
  check('真实微信工程路径、非游客AppID、编译目录哈希及同源API配置预检一致', { projectPath, miniprogramRoot, compiledSha256 });
}
async function api(path, { method = 'GET', body, token, key } = {}) {
  const response = await fetch(base + path, {
    method, headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000),
  });
  const payload = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(payload)}`);
  assert.ok(payload && 'data' in payload && typeof payload.requestId === 'string');
  return payload.data;
}
const post = (path, body, token, key) => api(path, { method: 'POST', body, token, key });
async function until(test, message, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (test()) return;
    await new Promise(resolveWait => setTimeout(resolveWait, 40));
  }
  throw new Error(message);
}

// Platform-only adapter: actual generated application code owns validation,
// session storage, hold selection, versioning and idempotent command creation.
function nativeRuntime() {
  const storage = new Map(), modules = new Map(), definitions = new Map();
  const pages = [], navigations = [], timers = new Set();
  let registering, action = 'initialization';
  const navigation = kind => options => navigations.push({ kind, url: options?.url || '' });
  const context = vm.createContext({
    console, Date, Math, Promise, Set, Map, Error, encodeURIComponent,
    setInterval(fn, interval) { const timer = setInterval(fn, interval); timers.add(timer); return timer; },
    clearInterval(timer) { clearInterval(timer); timers.delete(timer); },
    getCurrentPages: () => pages,
    Page(definition) { assert.ok(registering, 'Page registered outside its generated module'); definitions.set(registering, definition); },
    wx: {
      getStorageSync: key => storage.has(key) ? structuredClone(storage.get(key)) : '',
      setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
      removeStorageSync: key => storage.delete(key),
      navigateTo: navigation('navigateTo'), redirectTo: navigation('redirectTo'),
      switchTab: navigation('switchTab'), navigateBack: navigation('navigateBack'),
      showToast() {}, stopPullDownRefresh() {},
      showModal(options) { throw new Error(`Unexpected native modal: ${options.title}: ${options.content}`); },
      request(options) {
        assert.ok(options.url.startsWith(base + '/'), 'Native request must target the same local API');
        const entry = { action, path: options.url.slice(base.length), method: options.method, ...(options.header['Idempotency-Key'] ? { key: options.header['Idempotency-Key'] } : {}) };
        report.nativeRequests.push(entry);
        void fetch(options.url, { method: options.method, headers: options.header,
          ...(options.data === undefined ? {} : { body: JSON.stringify(options.data) }), signal: AbortSignal.timeout(15000) })
          .then(async response => {
            entry.statusCode = response.status;
            const text = await response.text(); let data;
            try { data = JSON.parse(text); } catch { data = text; }
            options.success({ statusCode: response.status, data });
          }).catch(error => { entry.networkFailure = true; options.fail({ errMsg: error.message }); });
      },
    },
  });
  function load(relative) {
    const path = resolve(dist, relative.endsWith('.js') ? relative : relative + '.js');
    assert.ok(path.startsWith(dist + sep), 'Unexpected native module path');
    if (path === resolve(dist, 'config.js')) return { apiBaseUrl: base };
    if (modules.has(path)) return modules.get(path).exports;
    const module = { exports: {} }; modules.set(path, module);
    vm.runInContext('(function(require,module,exports){' + readFileSync(path, 'utf8') + '\n})', context, { filename: path })(id => {
      assert.ok(id.startsWith('.'), 'Unexpected generated npm dependency');
      return load(resolve(dirname(path), id));
    }, module, module.exports);
    return module.exports;
  }
  function mount(name) {
    const path = `pages/${name}/index`;
    registering = name; load(path); registering = undefined;
    const definition = definitions.get(name);
    assert.ok(definition, `Actual generated Page definition not found: ${name}`);
    const page = { data: structuredClone(definition.data), setData(patch) {
      for (const [key, value] of Object.entries(patch)) {
        assert.ok(!key.includes('.') && !key.includes('['), `Adapter needs explicit support for ${key}`);
        this.data[key] = value;
      }
    } };
    for (const [name, value] of Object.entries(definition)) if (typeof value === 'function') page[name] = value.bind(page);
    pages.push(page); return page;
  }
  return {
    mount, load, navigations,
    async act(label, callback) { action = label; return await callback(); },
    lastNavigation(path) { const last = navigations.at(-1); assert.ok(last?.url.startsWith(path), `Expected native navigation to ${path}, got ${JSON.stringify(last)}`); return new URL(last.url, 'http://native.local'); },
    dispose() { for (const page of pages) page.onUnload?.(); for (const timer of timers) clearInterval(timer); },
  };
}
function noNativeError(page, label) { assert.equal(page.data.error, '', `${label}: ${page.data.error}`); }
async function loadNativeDetail(id) {
  const page = native.mount('detail');
  await native.act('detail.onLoad/onShow', async () => {
    page.onLoad({ id }); page.onShow();
    await until(() => !page.data.loading, 'Native appointment detail timed out');
  });
  noNativeError(page, 'detail'); assert.equal(page.data.appointment?.id, id);
  return page;
}
async function compiledNativeBooking(options, earliest) {
  const page = native.mount('booking');
  await native.act('booking.onLoad/load', async () => {
    page.onLoad(options); page.onShow();
    await until(() => !page.data.loading, 'Native catalog load timed out');
  });
  noNativeError(page, 'booking catalogs');
  assert.equal(page.data.clinics[page.data.clinicIndex].id, fixture.clinic.id);
  assert.equal(page.data.services[page.data.serviceIndex].id, fixture.service.id);
  assert.equal(page.data.doctors[page.data.doctorIndex - 1].id, fixture.doctor.id);
  await native.act('booking.dateChange/search', async () => {
    page.dateChange({ detail: { value: date } }); await page.search();
  });
  noNativeError(page, 'booking search');
  const index = page.data.slots.findIndex(slot => !earliest || Date.parse(slot.startsAt) >= Date.parse(earliest));
  assert.ok(index >= 0, 'Native search must expose a nonoverlapping available slot');
  const selected = structuredClone(page.data.slots[index]);
  await native.act('booking.choose', () => page.choose({ currentTarget: { dataset: { index } } }));
  noNativeError(page, 'booking hold'); native.lastNavigation('/pages/confirm/index');
  const confirmation = native.mount('confirm');
  await native.act('confirm.onShow/loadPatient', async () => {
    confirmation.onShow(); await until(() => !confirmation.data.loading, 'Native confirmation profile timed out');
  });
  noNativeError(confirmation, 'confirmation');
  assert.equal(confirmation.data.patient.id, fixture.patient.id);
  assert.equal(confirmation.data.context.hold.slot.startsAt, selected.startsAt);
  assert.equal(confirmation.data.expired, false);
  // Exercise the real page's acceptance guard before checking the controls.
  await native.act('confirm.submit without checks', () => confirmation.submit());
  assert.ok(confirmation.data.error.includes('核对实际就诊人'));
  await native.act('confirm.checks/reasonInput/submit', async () => {
    confirmation.checks({ detail: { value: ['patient', 'rules'] } });
    if (options.appointmentId) confirmation.reasonInput({ detail: { value: namespace + '本人申请改期' } });
    await confirmation.submit();
  });
  noNativeError(confirmation, 'confirmation submit');
  const id = native.lastNavigation('/pages/detail/index').searchParams.get('id');
  confirmation.onHide(); confirmation.onUnload();
  assert.ok(id); return { detail: await loadNativeDetail(id), selected };
}

async function sdkUntil(callback, message, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await callback(); if (result) return result;
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  throw new Error(message);
}
async function currentWechat(path) {
  return sdkUntil(async () => { const page = await mini.currentPage(); return page?.path === path ? page : null; }, 'WeChat did not navigate to ' + path);
}
async function wechatData(page, condition, label) {
  return sdkUntil(async () => {
    const data = await page.data();
    assert.equal(data.error || '', '', `${label}: ${data.error}`);
    return condition(data) ? data : null;
  }, 'WeChat page not ready: ' + label);
}
async function element(page, selector) { return sdkUntil(() => page.$(selector), 'Missing rendered WeChat element: ' + selector); }
async function buttonText(page, text) {
  return sdkUntil(async () => {
    const buttons = await page.$$('button');
    for (const button of buttons) if ((await button.text()).trim() === text) return button;
    return null;
  }, 'Missing rendered WeChat button: ' + text);
}
async function picker(page, index) {
  return sdkUntil(async () => { const pickers = await page.$$('picker'); return pickers[index] || null; }, 'Missing rendered WeChat picker index: ' + index);
}
async function nativeShot(name) {
  await mini.screenshot({ path: resolve(screenshotDirectory, name + '.png') });
  report.screenshots.push({ path: `screenshots/booking/${namespace}/${name}.png`, surface: 'Real WeChat DevTools simulator via official SDK; not physical device' });
}
async function wechatLogin(authConfig) {
  const automator = (await import('miniprogram-automator')).default;
  mini = await automator.connect({ wsEndpoint: sdkEndpoint });
  report.environment.wechatEndpoint = sdkEndpoint;
  report.environment.wechatSDKVersion = JSON.parse(readFileSync(resolve(root, 'node_modules/miniprogram-automator/package.json'), 'utf8')).version;
  const opened = await mini.currentPage(); assert.ok(opened);
  const accountInfo = await mini.callWxMethod('getAccountInfoSync');
  assert.equal(accountInfo?.miniProgram?.appId, wechatProject.appId, 'SDK simulator AppID does not match the explicitly verified WeChat project');
  report.environment.wechatProject.observedSimulatorAppId = accountInfo.miniProgram.appId;
  check('官方SDK连接真实微信开发者工具模拟器且运行AppID与指定工程一致', { initiallyOpenedPage: opened.path });
  const existing = await mini.switchTab('/pages/appointments/index');
  assert.ok(existing);
  const before = await sdkUntil(async () => {
    const data = await existing.data();
    // A stale token can legitimately fail the pre-login list request. Read the
    // page's pending snapshot before doing anything that switches accounts.
    assert.notEqual(data.pending, true, 'Resolve the current account pending operation before running this test');
    if (data.loading) return null;
    assert.equal(data.pending, false, 'The existing page must expose a known, empty pending state');
    const message = data.error || '';
    if (message) {
      const knownAuthenticationErrors = ['请先登录', '登录已失效，请重新登录'];
      assert.ok(data.signedIn === false && knownAuthenticationErrors.includes(message), `Unexpected pre-login page error: ${message}`);
    }
    return data;
  }, 'WeChat existing pending/authentication state did not settle');
  report.environment.wechatLoginPrecheck = { signedIn: before.signedIn, recognizedAuthenticationError: Boolean(before.error), pending: before.pending };
  const account = authConfig.demoAccounts.find(item => item.portal === 'patient' && item.username === 'patient.a');
  assert.ok(account, 'Need server-published patient.a demo account');
  const login = await mini.navigateTo('/pages/login/index'); assert.ok(login);
  await wechatData(login, data => !data.loading && data.config?.demoLoginEnabled, 'demo login configuration');
  await (await element(login, `button[data-username="${account.username}"]`)).tap();
  const list = await currentWechat('pages/appointments/index');
  const listData = await wechatData(list, data => data.signedIn && !data.loading, 'patient demo login');
  assert.equal(listData.pending, false, 'Demo account has an unresolved operation; never overwrite it');
  const profile = await mini.switchTab('/pages/profile/index'); assert.ok(profile);
  const data = await wechatData(profile, state => !state.loading && state.rowVersion > 0, 'demo profile');
  assert.equal(data.isDemo, true, 'Only an explicitly fictional patient may be used');
  assert.equal(data.hasHold, false, 'An existing active demo hold must be resumed or allowed to expire before this test; acceptance never clears or overwrites it');
  fixture.patient = { ...data.profile, id: data.patientId, isDemo: data.isDemo };
  const rows = await pool.query('SELECT p.user_id,u.username FROM patients p JOIN users u ON u.id=p.user_id WHERE p.id=$1 AND p.is_demo=true', [fixture.patient.id]);
  assert.equal(rows.rowCount, 1); assert.equal(rows.rows[0].username, account.username);
  fixture.existingDemoUserId = rows.rows[0].user_id;
  check('官方SDK通过真实演示登录按钮进入虚构患者账号，无未决操作或现存占位', { patientId: fixture.patient.id });
  await nativeShot('00-wechat-fictional-profile');
}
async function wechatBooking(options, earliest) {
  let page;
  if (options.appointmentId) {
    page = await currentWechat('pages/booking/index');
    assert.equal((await page.data()).oldAppointmentId, options.appointmentId);
  } else { page = await mini.navigateTo('/pages/booking/index'); assert.ok(page); }
  let data = await wechatData(page, state => !state.loading && state.clinics.length && state.services.length, 'booking catalogs');
  const clinicIndex = data.clinics.findIndex(item => item.id === fixture.clinic.id); assert.ok(clinicIndex >= 0);
  if (data.clinicIndex !== clinicIndex) {
    await (await picker(page, 0)).trigger('change', { value: String(clinicIndex) });
    data = await wechatData(page, state => !state.loading && state.clinicIndex === clinicIndex && state.services.length, 'clinic picker');
  }
  const serviceIndex = data.services.findIndex(item => item.id === fixture.service.id); assert.ok(serviceIndex >= 0);
  if (data.serviceIndex !== serviceIndex) {
    await (await picker(page, 1)).trigger('change', { value: String(serviceIndex) });
    data = await wechatData(page, state => !state.loading && state.serviceIndex === serviceIndex && state.doctors.some(item => item.id === fixture.doctor.id), 'service picker');
  }
  const doctorIndex = data.doctors.findIndex(item => item.id === fixture.doctor.id) + 1; assert.ok(doctorIndex > 0);
  await (await picker(page, 3)).trigger('change', { value: String(doctorIndex) });
  await (await picker(page, 2)).trigger('change', { value: date });
  data = await wechatData(page, state => state.date === date && state.doctorIndex === doctorIndex, 'date/doctor pickers');
  assert.equal(data.serviceUnavailable, false); assert.equal(data.doctorUnavailable, false);
  await (await buttonText(page, '查询可预约时段')).tap();
  data = await wechatData(page, state => state.queried && !state.searching, 'slot query');
  const index = data.slots.findIndex(slot => !earliest || Date.parse(slot.startsAt) >= Date.parse(earliest));
  assert.ok(index >= 0, 'Real WeChat query must expose an available nonoverlapping slot');
  const selected = structuredClone(data.slots[index]);
  await nativeShot(options.appointmentId ? '06-wechat-reschedule-slots' : '01-wechat-available-slots');
  await (await element(page, `button[data-index="${index}"]`)).tap();
  const confirmation = await currentWechat('pages/confirm/index');
  const confirmationData = await wechatData(confirmation, state => !state.loading && state.patient && state.context, 'confirmation');
  assert.equal(confirmationData.patient.id, fixture.patient.id); assert.equal(confirmationData.expired, false);
  assert.equal(confirmationData.context.hold.slot.startsAt, selected.startsAt);
  assert.equal(confirmationData.patientConfirmed, false); assert.equal(confirmationData.rulesAccepted, false);
  const submit = await element(confirmation, 'button.primary');
  assert.equal(await submit.property('disabled'), true, 'Real confirmation control must require both checks');
  if (options.appointmentId) {
    const reason = namespace + '本人申请改期';
    await (await element(confirmation, 'textarea')).input(reason);
    await wechatData(confirmation, state => state.reason === reason, 'reschedule reason input');
  }
  // Official SDK dispatches the real rendered control's change event; all page
  // handlers, API calls, hold/version checks and navigation execute unchanged.
  await (await element(confirmation, 'checkbox-group')).trigger('change', { value: ['patient', 'rules'] });
  await wechatData(confirmation, state => state.patientConfirmed && state.rulesAccepted, 'both confirmation controls');
  await sdkUntil(async () => (await submit.property('disabled')) === false, 'Confirmation button has not rendered its enabled state');
  await nativeShot(options.appointmentId ? '07-wechat-reschedule-confirm' : '02-wechat-confirm-controls');
  await submit.tap();
  const detail = await currentWechat('pages/detail/index');
  const detailData = await wechatData(detail, state => !state.loading && state.appointment?.serviceId === fixture.service.id, 'confirmed appointment detail');
  assert.equal(detailData.appointment.status, 'confirmed');
  await nativeShot(options.appointmentId ? '08-wechat-rescheduled-detail' : '03-wechat-confirmed-detail');
  return { detail, selected, appointment: structuredClone(detailData.appointment) };
}
const patientBooking = (options, earliest) => mode === 'wechat' ? wechatBooking(options, earliest) : compiledNativeBooking(options, earliest);
async function patientAppointment(result) { return mode === 'wechat' ? structuredClone((await result.detail.data()).appointment) : structuredClone(result.detail.data.appointment); }

function item(container, label) { return container.locator('.el-form-item').filter({ hasText: label }).first(); }
async function choose(page, field, label) { await field.locator('.el-select').click(); await page.getByRole('option', { name: label, exact: true }).click(); }
async function inputDate(field, value) { const input = field.locator('.el-date-editor input'); await input.fill(value); await input.press('Tab'); }
function responseFor(page, path, method = 'POST') {
  return page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1' + path && response.request().method() === method);
}
async function responseData(response) { const value = await response.json(); assert.equal(response.status(), 200, JSON.stringify(value)); return value.data; }
async function shot(page, name) {
  await page.screenshot({ path: resolve(screenshotDirectory, name + '.png'), fullPage: true });
  report.screenshots.push({ path: `screenshots/booking/${namespace}/${name}.png`, surface: 'Real Vue browser only; no mini-program rendering' });
}
async function staffPage(account) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  const page = await context.newPage(); page.on('pageerror', error => browserErrors.push(error.message));
  await page.goto(admin + '/login');
  await expect(page.getByRole('heading', { name: '登录预约工作台' })).toBeVisible();
  await page.locator('.demo-login .el-select').click();
  await page.getByRole('option', { name: `${account.displayName} · ${account.username}`, exact: true }).click();
  await page.getByRole('button', { name: '进入开发工作台', exact: true }).click();
  await expect(page).toHaveURL(/\/appointments$/); return page;
}
async function rememberVueList(response, source) {
  const data = await responseData(response);
  const url = new URL(response.url());
  report.vueListResponses.push({ source, receivedAt: new Date().toISOString(),
    query: Object.fromEntries(url.searchParams), total: data.total, page: data.page, pageSize: data.pageSize,
    // Persist only this run's synthetic service, not a patient roster.
    syntheticAppointments: data.items.filter(item => item.serviceId === fixture.service.id).map(item => ({ id: item.id, appointmentNo: item.appointmentNo, status: item.status, rowVersion: item.rowVersion })),
  });
  return { data, url: url.href, receivedAt: new Date().toISOString() };
}
function observeAutomaticVueSync(page, operation) {
  assert.ok(vueListRequestUrl, 'Load the real Vue list before observing automatic synchronization');
  const expectedQuery = new URL(vueListRequestUrl);
  assert.equal(expectedQuery.searchParams.get('date'), date);
  const openedUrl = page.url(), startedAt = new Date().toISOString();
  const observations = [];
  let failure;
  let navigationOccurred = false;
  const onNavigation = frame => { if (frame === page.mainFrame()) navigationOccurred = true; };
  const onResponse = response => {
    const url = new URL(response.url());
    if (response.request().method() !== 'GET' || url.origin !== expectedQuery.origin || url.pathname !== '/api/v1/staff/appointments') return;
    if (!['date', 'clinicId', 'status', 'page', 'pageSize'].every(key => (url.searchParams.get(key) || '') === (expectedQuery.searchParams.get(key) || ''))) return;
    void rememberVueList(response, 'automatic-' + operation).then(snapshot => observations.push(snapshot)).catch(error => { failure = error; });
  };
  page.on('response', onResponse); page.on('framenavigated', onNavigation);
  const observer = {
    stop() { page.off('response', onResponse); page.off('framenavigated', onNavigation); vueObservers.delete(observer); },
    async untilStates(expectedStates) {
      try {
        const snapshot = await sdkUntil(async () => {
          if (failure) throw failure;
          assert.equal(navigationOccurred, false, 'Vue must remain on the already-open document during native changes');
          assert.equal(page.url(), openedUrl, 'Vue route must remain unchanged during native changes');
          return [...observations].reverse().find(item => Object.entries(expectedStates).every(([id, status]) => item.data.items.some(appointment => appointment.id === id && appointment.status === status))) || null;
        }, `Vue automatic ${operation} synchronization did not return the expected states`, 45000);
        vueList = snapshot.data; vueListRequestUrl = snapshot.url;
        report.automaticVueSync.push({ operation, startedAt, observedAt: snapshot.receivedAt,
          query: Object.fromEntries(expectedQuery.searchParams), expectedStates,
          observedMatchingResponses: observations.length, noManualNavigation: true, noManualRefresh: true });
      } finally { observer.stop(); }
    },
  };
  vueObservers.add(observer); return observer;
}
async function loadVueAppointments(page) {
  await page.goto(admin + '/appointments');
  const response = page.waitForResponse(value => new URL(value.url()).pathname === '/api/v1/staff/appointments' && new URL(value.url()).searchParams.get('date') === date);
  await inputDate(item(page.locator('.filter-bar'), '日期'), date);
  const observed = await rememberVueList(await response, 'initial-date-filter');
  vueList = observed.data; vueListRequestUrl = observed.url;
}
async function vueAppointment(page, appointment, status, image) {
  // The same fictional patient is reused. Earlier auditable runs may occupy
  // other pages; identify this run's unique service and drive real pagination.
  if (!vueList.items.some(item => item.id === appointment.id)) {
    while (vueList.page > 1) {
      const response = responseFor(page, '/staff/appointments', 'GET');
      await page.locator('.pagination .btn-prev').click();
      const observed = await rememberVueList(await response, 'manual-pagination'); vueList = observed.data; vueListRequestUrl = observed.url;
    }
    while (!vueList.items.some(item => item.id === appointment.id) && vueList.page * vueList.pageSize < vueList.total) {
      const response = responseFor(page, '/staff/appointments', 'GET');
      await page.locator('.pagination .btn-next').click();
      const observed = await rememberVueList(await response, 'manual-pagination'); vueList = observed.data; vueListRequestUrl = observed.url;
    }
  }
  assert.ok(vueList.items.some(item => item.id === appointment.id), 'The actual Vue list never returned this appointment ID');
  const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(appointment.startsAt));
  const row = page.locator('.el-table__row').filter({ hasText: fixture.patient.name }).filter({ hasText: fixture.service.name }).filter({ has: page.locator('strong').filter({ hasText: new RegExp(`^${hhmm}$`) }) });
  await expect(row).toHaveCount(1); await expect(row).toContainText(status); await expect(row).toContainText(fixture.service.name);
  const response = responseFor(page, `/appointments/${appointment.id}`, 'GET');
  await row.click(); const actual = await responseData(await response);
  assert.equal(actual.id, appointment.id); assert.equal(actual.appointmentNo, appointment.appointmentNo);
  const drawer = page.locator('.el-drawer');
  await expect(drawer.locator('.detail-title')).toContainText(appointment.appointmentNo);
  await expect(drawer.locator('.detail-title')).toContainText(status);
  await shot(page, image); await drawer.locator('.el-drawer__close-btn').click();
  await expect(drawer).not.toBeVisible();
}
async function sqlAppointment(appointment, expectedStatus, expectedResourceStatus) {
  const result = await pool.query(`SELECT a.id,a.appointment_no,a.patient_id,a.status,a.supersedes_appointment_id,
    (SELECT newer.id FROM appointments newer WHERE newer.supersedes_appointment_id=a.id) AS replacement_appointment_id,
    r.id AS reservation_id,r.status AS resource_status,r.doctor_id,r.service_id,r.shift_id,r.clinic_id,r.chair_id,r.starts_at
    FROM appointments a JOIN resource_reservations r ON r.id=a.reservation_id WHERE a.id=$1`, [appointment.id]);
  assert.equal(result.rowCount, 1); const row = result.rows[0];
  assert.equal(row.appointment_no, appointment.appointmentNo); assert.equal(row.patient_id, fixture.patient.id);
  assert.equal(row.doctor_id, fixture.doctor.id); assert.equal(row.service_id, fixture.service.id);
  assert.equal(row.shift_id, fixture.shift.id); assert.equal(row.clinic_id, fixture.clinic.id);
  assert.equal(row.chair_id, appointment.chairId); assert.equal(row.starts_at.toISOString(), appointment.startsAt);
  assert.equal(row.status, expectedStatus); assert.equal(row.resource_status, expectedResourceStatus);
  return row;
}
async function cleanup() {
  const errors = [];
  if (hq && fixture.patient && fixture.doctor && fixture.service) try {
    const appointments = await pool.query('SELECT a.id FROM appointments a JOIN resource_reservations r ON r.id=a.reservation_id WHERE a.patient_id=$1 AND r.doctor_id=$2 AND r.service_id=$3', [fixture.patient.id, fixture.doctor.id, fixture.service.id]);
    let count = 0;
    for (const { id } of appointments.rows) {
      const current = await api('/appointments/' + id, { token: hq.token });
      if (current.status === 'confirmed') { await post(`/appointments/${id}/changes`, { intent: 'cancel', expectedVersion: current.rowVersion, reason: namespace + '合成验收收尾' }, hq.token, randomUUID()); count++; }
    }
    report.cleanup.additionalAppointmentsCancelled = count;
    const expired = await pool.query("UPDATE resource_reservations SET status='expired',expires_at=least(expires_at,clock_timestamp()) WHERE status='held' AND patient_id=$1 AND doctor_id=$2 AND service_id=$3 RETURNING id", [fixture.patient.id, fixture.doctor.id, fixture.service.id]);
    report.cleanup.unconsumedSyntheticHoldsExpired = expired.rowCount;
  } catch (error) { errors.push('appointments: ' + error.message); }
  if (hq && fixture.shift) try {
    const shifts = await api('/shifts?' + new URLSearchParams({ clinicId: fixture.clinic.id, date }), { token: hq.token });
    const shift = shifts.find(item => item.id === fixture.shift.id);
    if (shift?.status === 'published') await post(`/staff/shifts/${shift.id}/cancel`, { expectedVersion: shift.rowVersion }, hq.token);
    report.cleanup.shiftCancelled = true;
  } catch (error) { errors.push('shift: ' + error.message); }
  if (hq) for (const [kind, key] of [['services', 'service'], ['doctors', 'doctor'], ['chairs', 'chair'], ['qualifications', 'qualification']]) {
    const resource = fixture[key]; if (!resource) continue;
    try {
      await api(`/staff/${kind}/${resource.id}`, { method: 'PUT', token: hq.token, body: { ...resource.input, active: false, expectedVersion: resource.rowVersion } });
      report.cleanup[key + 'Inactive'] = true;
    } catch (error) { errors.push(key + ': ' + error.message); }
  }
  if (fixture.account) {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const result = await db.query('SELECT id,username FROM users WHERE id=$1 FOR UPDATE', [fixture.account.id]);
      assert.equal(result.rowCount, 1); assert.equal(result.rows[0].username, fixture.account.username);
      assert.ok(fixture.account.username.startsWith(namespace.toLowerCase() + '.'));
      await db.query('UPDATE users SET active=false WHERE id=$1 AND username=$2', [fixture.account.id, fixture.account.username]);
      await db.query('DELETE FROM sessions WHERE user_id=$1', [fixture.account.id]);
      await db.query('COMMIT'); report.cleanup.syntheticAccountInactive = true;
    } catch (error) { await db.query('ROLLBACK'); errors.push('account: ' + error.message); } finally { db.release(); }
  }
  report.cleanup.existingClinicUnmodified = true;
  report.cleanup.auditableSyntheticHistoryRetained = true;
  report.cleanup.errors = errors;
  if (errors.length) throw new Error('Cleanup incomplete: ' + errors.join('; '));
}

try {
  if (mode === 'wechat') verifyWechatProject();
  assert.equal((await api('/health')).database, 'postgresql');
  report.environment.postgresqlVersion = (await pool.query('SHOW server_version')).rows[0].server_version;
  const auth = await api('/auth/config'); assert.equal(auth.demoLoginEnabled, true);
  for (const account of auth.demoAccounts.filter(item => item.portal === 'staff')) {
    const value = await post('/auth/demo', { username: account.username, portal: 'staff' });
    if (value.user.roles.includes('hq')) { hq = { ...value, account }; break; }
  }
  assert.ok(hq, 'Need a server-provided local HQ demo account');
  fixture.clinic = (await api('/clinics', { token: hq.token })).find(item => item.active);
  assert.ok(fixture.clinic, 'Need an existing active clinic');
  async function resource(kind, key, input) {
    const value = await post('/staff/' + kind, input, hq.token); fixture[key] = { ...value, input }; return value;
  }
  const qualification = await resource('qualifications', 'qualification', { name: namespace + '专用资格', active: true });
  await resource('doctors', 'doctor', { employeeNo: namespace + '-D', name: namespace + '虚构医生', phone: '020-88889991', specialty: '跨端合成验收', active: true,
    qualifications: [{ qualificationId: qualification.id, validFrom: '2020-01-01T00:00:00.000Z', validUntil: null }] });
  await resource('services', 'service', { name: namespace + '合成咨询', description: '跨端自动验收专用虚构项目，无临床诊断。', durationMinutes: 30, bufferMinutes: 10, priceCents: 9900, unit: '次', active: true, clinicIds: [fixture.clinic.id], qualificationIds: [qualification.id] });
  await resource('chairs', 'chair', { clinicId: fixture.clinic.id, name: namespace + '-合成椅', active: true });
  check('显式允许的本机专用环境、真实PostgreSQL与唯一命名夹具');

  if (mode === 'wechat') await wechatLogin(auth);
  else {
    native = nativeRuntime();
    const login = native.mount('login');
    const username = namespace.toLowerCase() + '.patient';
    await native.act('login input/profileChange/submit register', async () => {
      login.onLoad();
      await until(() => !login.data.loading && !!login.data.notice, 'Native privacy notice timed out');
      login.mode({ currentTarget: { dataset: { mode: 'register' } } });
      for (const [field, value] of Object.entries({ username, password: 'SyntheticOnly-' + randomUUID() })) login.input({ currentTarget: { dataset: { field } }, detail: { value } });
      login.profileChange({ detail: { name: namespace + '虚构患者', birthDate: '1998-08-08', phone: '19900001111', email: null, billingAddress: '跨端自动验收合成地址', emergencyName: '合成联系人', emergencyPhone: '19900002222', allergyStatus: 'unknown', allergies: [] } });
      login.consentChange({ detail: { value: ['notice', 'sensitive'] } });
      await login.submit();
    });
    noNativeError(login, 'registration');
    const patientSession = native.load('utils/session').session(); assert.ok(patientSession);
    fixture.account = { id: patientSession.user.id, username };
    fixture.patient = await native.load('utils/api').api('/patients/me');
    assert.equal(fixture.patient.id, patientSession.user.patientId);
    check('实际编译原生登录Page完成本人注册并保存真实会话', { patientId: fixture.patient.id });
  }

  browser = await chromium.launch({ headless: true, channel: process.env.CHROME_CHANNEL || 'chrome' });
  report.environment.browserVersion = browser.version();
  const page = await staffPage(hq.account);
  await page.goto(admin + '/shifts'); await page.getByRole('button', { name: '发布班次', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '发布医生班次' });
  await choose(page, item(dialog, '开展门诊'), fixture.clinic.name);
  await choose(page, item(dialog, '出诊医生'), fixture.doctor.name + ' · ' + fixture.doctor.specialty);
  await inputDate(item(dialog, '开始时间'), date + ' 09:00'); await inputDate(item(dialog, '结束时间'), date + ' 13:00');
  await choose(page, item(dialog, '本班次开展服务'), fixture.service.name);
  await dialog.getByText('发布医生班次', { exact: true }).click();
  await shot(page, '01-vue-publish-shift');
  const shiftResponse = responseFor(page, '/staff/shifts');
  await dialog.getByRole('button', { name: '校验并发布', exact: true }).click(); fixture.shift = await responseData(await shiftResponse);
  await expect(dialog).not.toBeVisible();
  const shiftRows = await pool.query('SELECT id,doctor_id,clinic_id,status FROM doctor_shifts WHERE id=$1', [fixture.shift.id]);
  assert.equal(shiftRows.rowCount, 1); assert.equal(shiftRows.rows[0].doctor_id, fixture.doctor.id); assert.equal(shiftRows.rows[0].clinic_id, fixture.clinic.id); assert.equal(shiftRows.rows[0].status, 'published');
  check('Vue真实页面发布班次，SQL确认相同班次ID/医生/门诊', { shiftId: fixture.shift.id });

  const initial = await patientBooking({ clinicId: fixture.clinic.id, serviceId: fixture.service.id, doctorId: fixture.doctor.id });
  const original = await patientAppointment(initial);
  assert.equal(original.status, 'confirmed'); await sqlAppointment(original, 'confirmed', 'booked');
  check('原生预约/确认/详情Page完成真实占位与双确认预约，SQL同ID已占用', { appointmentId: original.id, appointmentNo: original.appointmentNo });
  await loadVueAppointments(page); await vueAppointment(page, original, '已确认', '02-vue-native-confirmed');
  check('Vue真实页面看到原生Page创建的同一预约编号和已确认状态', { appointmentNo: original.appointmentNo });

  // Begin listening before any mini-program action. No goto, reload, refresh
  // button, filter edit, or list request is issued by this observer.
  const rescheduleSync = observeAutomaticVueSync(page, 'reschedule');
  let changeOptions;
  if (mode === 'wechat') {
    const detailData = await initial.detail.data(); assert.equal(detailData.changeAllowed, true);
    await (await buttonText(initial.detail, '修改时间')).tap();
    const next = await currentWechat('pages/booking/index');
    const data = await wechatData(next, state => !state.loading && state.oldAppointmentId === original.id, 'reschedule route');
    changeOptions = { appointmentId: data.oldAppointmentId, version: String(data.oldVersion), clinicId: fixture.clinic.id, serviceId: fixture.service.id, doctorId: fixture.doctor.id };
  } else {
    await native.act('detail.reschedule', () => initial.detail.reschedule());
    changeOptions = Object.fromEntries(native.lastNavigation('/pages/booking/index').searchParams);
  }
  assert.equal(changeOptions.appointmentId, original.id);
  const changed = await patientBooking(changeOptions, original.occupiedUntil);
  const replacement = await patientAppointment(changed);
  assert.equal(replacement.status, 'confirmed'); assert.equal(replacement.supersedesAppointmentId, original.id);
  const oldSql = await sqlAppointment(original, 'rescheduled', 'released');
  const newSql = await sqlAppointment(replacement, 'confirmed', 'booked');
  assert.equal(oldSql.replacement_appointment_id, replacement.id); assert.equal(newSql.supersedes_appointment_id, original.id);
  check('原生详情改期入口和预约确认Page完成原子改期，SQL替代链一致且旧资源释放', { oldId: original.id, newId: replacement.id, newAppointmentNo: replacement.appointmentNo });
  await rescheduleSync.untilStates({ [original.id]: 'rescheduled', [replacement.id]: 'confirmed' });
  check('已打开的Vue页面自动轮询收到小程序改期状态，无手动刷新或导航');
  await vueAppointment(page, original, '已改期', '03-vue-old-rescheduled');
  await vueAppointment(page, replacement, '已确认', '04-vue-replacement-confirmed');
  check('Vue真实清单及详情同时显示旧预约已改期、新预约已确认');

  const cancellationSync = observeAutomaticVueSync(page, 'cancel');
  if (mode === 'wechat') {
    await (await buttonText(changed.detail, '取消预约')).tap();
    await wechatData(changed.detail, data => data.cancelling, 'cancellation reason form');
    const reason = namespace + '本人申请取消';
    await (await element(changed.detail, 'textarea')).input(reason);
    await wechatData(changed.detail, data => data.reason === reason, 'cancellation reason input');
    const cancelButton = await buttonText(changed.detail, '确认取消并释放时段');
    await sdkUntil(async () => (await cancelButton.property('disabled')) === false, 'Cancellation button has not rendered its enabled state');
    await nativeShot('09-wechat-cancel-controls'); await cancelButton.tap();
    await wechatData(changed.detail, data => !data.busy && !data.loading && data.appointment?.status === 'cancelled', 'cancelled appointment');
    await nativeShot('10-wechat-cancelled-detail');
  } else {
    await native.act('detail.toggleCancel/reasonInput/cancel', async () => {
      changed.detail.toggleCancel(); changed.detail.reasonInput({ detail: { value: namespace + '本人申请取消' } }); await changed.detail.cancel();
    });
    noNativeError(changed.detail, 'native cancellation'); assert.equal(changed.detail.data.appointment.status, 'cancelled');
  }
  await sqlAppointment(replacement, 'cancelled', 'released');
  check('原生详情Page实际取消预约，SQL保留同ID并释放新资源', { appointmentId: replacement.id });
  await cancellationSync.untilStates({ [replacement.id]: 'cancelled' });
  check('已打开的Vue页面自动轮询收到小程序取消状态，无手动刷新或导航');
  await vueAppointment(page, replacement, '已取消', '05-vue-native-cancelled');
  check('Vue真实页面显示同一替代预约编号已取消', { appointmentNo: replacement.appointmentNo });

  let releasedSlots;
  if (mode === 'wechat') {
    const query = new URLSearchParams({ clinicId: fixture.clinic.id, serviceId: fixture.service.id, doctorId: fixture.doctor.id });
    const search = await mini.navigateTo('/pages/booking/index?' + query); assert.ok(search);
    await wechatData(search, data => !data.loading && data.services.length && data.doctors.length, 'released resources catalogs');
    await (await picker(search, 2)).trigger('change', { value: date });
    await wechatData(search, data => data.date === date, 'released resources date picker');
    await (await buttonText(search, '查询可预约时段')).tap();
    const data = await wechatData(search, state => state.queried && !state.searching, 'released resources query');
    releasedSlots = data.slots; await nativeShot('11-wechat-released-slots');
  } else {
    const search = native.mount('booking');
    await native.act('booking after cancel resource query', async () => {
      search.onLoad({ clinicId: fixture.clinic.id, serviceId: fixture.service.id, doctorId: fixture.doctor.id }); search.onShow();
      await until(() => !search.data.loading, 'Final native catalog timed out'); search.dateChange({ detail: { value: date } }); await search.search();
    });
    noNativeError(search, 'final resource release query'); releasedSlots = search.data.slots;
  }
  assert.ok(releasedSlots.some(slot => slot.startsAt === original.startsAt));
  assert.ok(releasedSlots.some(slot => slot.startsAt === replacement.startsAt));
  const busy = await pool.query("SELECT count(*)::int AS count FROM resource_reservations WHERE patient_id=$1 AND doctor_id=$2 AND service_id=$3 AND status IN ('held','booked')", [fixture.patient.id, fixture.doctor.id, fixture.service.id]);
  assert.equal(busy.rows[0].count, 0);
  check('原生Page重新查询同时看到原时段及改期时段，SQL确认无残留活动占位');
  const receipts = await pool.query("SELECT command_key,result->>'id' AS appointment_id,result->>'status' AS status FROM command_receipts WHERE user_id=$1 AND result->>'id'=ANY($2::text[]) ORDER BY created_at", [fixture.existingDemoUserId || fixture.account.id, [original.id, replacement.id]]);
  assert.equal(receipts.rowCount, 3); assert.equal(new Set(receipts.rows.map(receipt => receipt.command_key)).size, 3);
  assert.deepEqual(receipts.rows.map(receipt => receipt.status), ['confirmed', 'confirmed', 'cancelled']);
  report.commandReceipts = receipts.rows;
  if (mode === 'compiled-native') {
    const commands = report.nativeRequests.filter(request => request.key);
    assert.equal(commands.length, 3); assert.equal(new Set(commands.map(command => command.key)).size, 3);
    assert.ok(commands.every(command => command.statusCode === 200));
  }
  assert.deepEqual(browserErrors, []);
  assert.equal(artifactHash(dist), report.nativeArtifactSha256, 'Generated native artifacts changed during acceptance; rerun against a stable build');
  if (mode === 'wechat') assert.equal(artifactHash(wechatProject.miniprogramRoot), report.nativeArtifactSha256, 'The driven WeChat project artifacts changed during acceptance');
  check('SQL确认三次原生写命令独立幂等回执，Vue无未捕获异常且编译产物稳定');
  report.fixture = { clinicId: fixture.clinic.id, qualificationId: qualification.id, doctorId: fixture.doctor.id, serviceId: fixture.service.id, chairId: fixture.chair.id, shiftId: fixture.shift.id, patientId: fixture.patient.id, userId: fixture.existingDemoUserId || fixture.account.id, existingFictionalPatientReused: mode === 'wechat', date, originalAppointmentId: original.id, originalAppointmentNo: original.appointmentNo, replacementAppointmentId: replacement.id, replacementAppointmentNo: replacement.appointmentNo };
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error.stack || error.message; process.exitCode = 1; console.error(report.error);
  if (browser) for (const context of browser.contexts()) for (const page of context.pages()) try { await shot(page, 'failure-vue'); } catch {}
  if (mini) try { await nativeShot('failure-wechat'); } catch {}
} finally {
  for (const observer of [...vueObservers]) observer.stop();
  native?.dispose();
  try { await cleanup(); } catch (error) { report.status = 'failed'; report.cleanupError = error.message; process.exitCode = 1; console.error(error.message); }
  try { if (browser) await browser.close(); } catch (error) { report.browserCloseError = error.message; }
  await pool.end();
  try { if (mini) await mini.disconnect(); } catch (error) { report.sdkDisconnectError = error.message; }
  for (const key of ['clinic', 'qualification', 'doctor', 'service', 'chair', 'shift', 'patient']) if (fixture[key]?.id) report.fixture[key + 'Id'] = fixture[key].id;
  report.fixture.date = date;
  report.finishedAt = new Date().toISOString(); writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, namespace, report: relative(root, output).replaceAll('\\', '/') }));
}
