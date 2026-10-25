/** Real, read-only WeChat simulator controls. No login, hold or booking command.
 * Start the prepared local IDE automation port, then run this script. It never
 * builds, synchronizes D, mocks wx, sets page data or calls application methods.
 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import vm from 'node:vm';
import { artifactHash } from '../miniprogram/scripts/artifact-hash.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(repository, 'docs/implementation/qa/reference-native-ui.json');
const namespace = 'NATIVE-REFERENCE-' + randomUUID().slice(0, 8);
const screenshots = resolve(repository, 'screenshots/booking', namespace);
const apiBase = (process.env.BOOKING_REFERENCE_API || 'http://127.0.0.1:3310/api/v1').replace(/\/$/, '');
const endpoint = process.env.WECHAT_AUTOMATOR_ENDPOINT || 'ws://127.0.0.1:9420';
const local = url => ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname);
const report = { schemaVersion: 1, namespace, status: 'running', startedAt: new Date().toISOString(),
  execution: 'Official miniprogram-automator SDK driving real WeChat DevTools rendered native controls; real read-only local API; not a physical device test',
  environment: { api: apiBase, automationEndpoint: endpoint }, checks: [], screenshots: [], queries: [], limitations: [],
  businessMutationsInvoked: false, credentialsRead: false };
let mini, page, compiledRoot;
const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');
function check(name, details = {}) { report.checks.push({ name, status: 'passed', ...details }); console.log('PASS ' + name); }
async function bounded(promise, label, milliseconds = 15000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Timed out: ' + label)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
const sdk = (label, operation) => bounded(Promise.resolve().then(operation), label);
async function wait(label, predicate, milliseconds = 25000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    const result = await bounded(Promise.resolve().then(predicate), label, Math.min(10000, deadline - Date.now()));
    if (result) return result;
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  throw new Error('UI did not settle: ' + label);
}
function shanghaiDate(value) {
  const instant = new Date(value);
  assert.ok(Number.isFinite(instant.getTime()), 'Calendar returned an invalid date');
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}
function dayAfter(date, count) { const day = new Date(date + 'T00:00:00Z'); day.setUTCDate(day.getUTCDate() + count); return day.toISOString().slice(0, 10); }
async function publicGet(path) {
  const response = await fetch(apiBase + path, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
  const body = await response.json();
  assert.ok(response.ok && body && 'data' in body, 'Local public preflight failed: ' + path);
  return body.data;
}
function verifyProject() {
  const projectPath = realpathSync(resolve(process.env.WECHAT_PROJECT_PATH || 'D:/AndrewDentalMiniProgram'));
  const config = JSON.parse(readFileSync(resolve(projectPath, 'project.config.json'), 'utf8'));
  assert.equal(config.compileType, 'miniprogram');
  assert.match(config.appid, /^wx[\da-f]{16}$/i, 'A real public AppID must be configured');
  assert.ok(typeof config.miniprogramRoot === 'string' && config.miniprogramRoot.trim());
  compiledRoot = realpathSync(resolve(projectPath, config.miniprogramRoot));
  const part = relative(projectPath, compiledRoot);
  assert.ok(part && part !== '..' && !part.startsWith('..' + sep) && !isAbsolute(part), 'Compiled root must stay inside the specified IDE project');
  const repositoryHash = artifactHash(resolve(repository, 'miniprogram/dist'));
  assert.equal(artifactHash(compiledRoot), repositoryHash, 'D project must be synchronized to current repository dist before acceptance');
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(resolve(compiledRoot, 'config.js'), 'utf8'), { module, exports: module.exports }, { timeout: 500 });
  assert.equal(module.exports.apiBaseUrl, apiBase);
  const packageRoot = resolve(repository, 'node_modules/@vant/weapp');
  const vant = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'));
  assert.equal(vant.version, '1.11.7');
  const componentFiles = ['calendar/index.js', 'calendar/index.wxml', 'calendar/calendar.wxml', 'calendar/components/month/index.js', 'button/index.wxml', 'empty/index.wxml'];
  for (const file of componentFiles) assert.equal(sha256(resolve(compiledRoot, 'vendor/vant', file)), sha256(resolve(packageRoot, 'dist', file)), 'Pinned Vant artifact differs: ' + file);
  const components = JSON.parse(readFileSync(resolve(compiledRoot, 'pages/booking/index.json'), 'utf8')).usingComponents;
  assert.equal(components['van-calendar'], '/vendor/vant/calendar/index');
  assert.equal(components['van-empty'], '/vendor/vant/empty/index');
  report.environment.projectPath = projectPath; report.environment.compiledRoot = compiledRoot;
  report.environment.appId = config.appid; report.environment.artifactSha256 = repositoryHash;
  report.environment.vantVersion = vant.version;
  check('真实D工程与仓库编译哈希、API地址、Vant 1.11.7组件一致');
}
async function dataWhere(label, predicate, allowError = false) {
  return wait(label, async () => {
    const data = await page.data();
    if (!allowError) assert.equal(data.error || '', '', label + ': ' + data.error);
    return predicate(data) ? data : null;
  });
}
const element = (owner, selector) => wait('render ' + selector, () => owner.$(selector));
async function shot(name) {
  await sdk('screenshot ' + name, () => mini.screenshot({ path: resolve(screenshots, name + '.png') }));
  report.screenshots.push({ path: `screenshots/booking/${namespace}/${name}.png`, surface: 'Real WeChat DevTools simulator viewport; not physical device' });
}
async function querySlots(label) {
  const before = await sdk('query selection snapshot', () => page.data());
  await sdk('tap original native query button', async () => (await element(page, 'button.primary')).tap());
  const data = await dataWhere(label, value => !value.searching && (value.queried || Boolean(value.error)), true);
  const entry = { label, date: data.date, clinicId: before.clinics[before.clinicIndex]?.id,
    serviceId: before.services[before.serviceIndex]?.id, outcome: data.error ? 'server-or-network-error' : data.slots.length ? 'available' : 'empty',
    slotCount: data.slots.length, ...(data.error ? { message: data.error } : {}) };
  report.queries.push(entry); return data;
}
async function verifyGroups(data, label) {
  const indices = data.slotGroups.flatMap(group => group.indices);
  assert.ok(indices.every(index => Number.isInteger(index) && index >= 0 && index < data.slots.length));
  assert.equal(new Set(indices).size, data.slots.length);
  assert.deepEqual([...indices].sort((a, b) => a - b), Array.from({ length: data.slots.length }, (_value, index) => index));
  for (const group of data.slotGroups) for (const index of group.indices) {
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false }).format(new Date(data.slots[index].startsAt)));
    assert.equal(group.key, hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening');
  }
  const buttons = await wait(label + ' rendered selection buttons', async () => {
    const found = await page.$$('button[data-index]'); return found.length === data.slots.length ? found : null;
  });
  const rendered = [];
  for (const button of buttons) rendered.push(Number(await sdk('read slot data-index', () => button.attribute('data-index'))));
  assert.deepEqual(rendered, indices, 'Rendered button ordering must follow original-index groups');
  assert.equal(new Set(rendered).size, rendered.length);
  check(label + '分组精确覆盖原号源索引且DOM按钮唯一', { slotCount: data.slots.length, groupCount: data.slotGroups.length });
}

try {
  assert.notEqual(process.env.NODE_ENV, 'production', 'Do not run against production');
  assert.ok(local(apiBase) && new URL(apiBase).port === '3310', 'Only local API port 3310 is allowed');
  assert.ok(local(endpoint), 'Only a local official SDK endpoint is allowed');
  const health = await publicGet('/health'); assert.equal(health.database, 'postgresql'); assert.equal(health.status, 'ok');
  // The existing public endpoint enables demo mode only outside production.
  // No credentials or account list are read from disk or included in evidence.
  const auth = await publicGet('/auth/config'); assert.equal(auth.demoLoginEnabled, true, 'A server-confirmed local non-production demo environment is required');
  check('本机3310数据库健康且服务端明确处于非生产演示环境');
  verifyProject();
  mkdirSync(screenshots, { recursive: true });
  const automator = (await import('miniprogram-automator')).default;
  mini = await bounded(automator.connect({ wsEndpoint: endpoint }), 'official SDK connect', 20000);
  const account = await sdk('read public AppID', () => mini.callWxMethod('getAccountInfoSync'));
  assert.equal(account?.miniProgram?.appId, report.environment.appId);
  const filter = new URLSearchParams();
  for (const [parameter, variable] of [['clinicId', 'REFERENCE_NATIVE_CLINIC_ID'], ['serviceId', 'REFERENCE_NATIVE_SERVICE_ID'], ['doctorId', 'REFERENCE_NATIVE_DOCTOR_ID']]) if (process.env[variable]) filter.set(parameter, process.env[variable]);
  page = await sdk('navigate real booking page', () => mini.navigateTo('/pages/booking/index' + (filter.size ? '?' + filter : '')));
  assert.equal(page?.path, 'pages/booking/index');
  let data = await dataWhere('booking catalog', value => !value.loading && value.clinics.length && value.services.length);
  assert.equal(data.catalogFailed, false); assert.equal(data.holding, false);
  const pickers = await wait('four original native pickers', async () => { const found = await page.$$('picker'); return found.length === 4 ? found : null; });
  const today = shanghaiDate(Date.now()), tomorrow = dayAfter(today, 1);
  const publicPolicy=await publicGet('/booking-policy');
  assert.equal(data.calendarEndDate,publicPolicy.queryWindow.toDate);
  assert.equal(await pickers[2].property('end'),publicPolicy.queryWindow.toDate);
  check('原生日期选择器与页面共享服务端查询窗口，没有本地固定天数');
  assert.equal(data.quickDates.length, 7);
  assert.deepEqual(data.quickDates.map(item => item.date), Array.from({ length: 7 }, (_value, index) => dayAfter(today, index)));
  await wait('seven rendered quick dates', async () => (await page.$$('.quick-date')).length === 7);
  check('原生预约页面目录成功、4个原生picker保留、7个快捷日真实渲染');

  await sdk('open real calendar button', async () => (await element(page, 'button.calendar-button')).tap());
  await dataWhere('calendar visible flag', value => value.calendarVisible);
  const calendar = await element(page, 'van-calendar');
  const day = await wait('calendar month and tomorrow cells', async () => {
    const months = await calendar.$$('month'); if (!months.length) return null;
    for (const month of months) {
      const days = await month.data('days');
      if (!Array.isArray(days)) continue;
      const index = days.findIndex(item => item.date && shanghaiDate(item.date) === tomorrow && item.type !== 'disabled');
      if (index < 0) continue;
      const cell = await month.$(`.van-calendar__day[data-index="${index}"]`);
      if (cell) return { cell, index, renderedMonths: months.length };
    }
    return null;
  });
  await sdk('tap actual tomorrow day cell', () => day.cell.tap());
  await wait('calendar selected tomorrow', async () => shanghaiDate(await calendar.data('currentDate')) === tomorrow);
  await shot('01-calendar-tomorrow-selected');
  // CustomElement.tap() does not fire Vant's click. Drive its native button.
  const vantButton = await element(calendar, 'van-button');
  const confirm = await element(vantButton, 'button');
  await wait('calendar native confirmation enabled', async () => (await confirm.property('disabled')) === false);
  await sdk('tap inner native calendar confirm button', () => confirm.tap());
  data = await dataWhere('calendar confirmed date', value => value.date === tomorrow && value.calendarVisible === false);
  check('真实Vant月份渲染、明日单元格与内层原生确认按钮完成选日', { selectedDate: tomorrow, monthCount: day.renderedMonths, dayIndex: day.index });

  data = await querySlots('tomorrow slot query');
  assert.equal(data.error, '', 'The normal-date real slot query must succeed');
  await verifyGroups(data, '明日实际号源');
  if (!data.slots.length) report.limitations.push('所选门诊与服务明日无号源，分组覆盖已检查为空；未验证非空号源卡片布局。可指定 REFERENCE_NATIVE_CLINIC_ID/SERVICE_ID 重新验证。');
  await sdk('scroll to real slot group results', () => mini.pageScrollTo(500));
  await shot('02-slot-groups');

  const quickDate = data.quickDates[2].date;
  await sdk('tap original quick-date view', async () => (await element(page, `.quick-date[data-date="${quickDate}"]`)).tap());
  data = await dataWhere('quick date invalidates old slots', value => value.date === quickDate && !value.queried && value.slots.length === 0 && value.slotGroups.length === 0);
  check('点击快捷日清除旧slots/slotGroups与queried，不执行占位');

  const distantDate = publicPolicy.queryWindow.toDate;
  await sdk('change native picker to server window endpoint', () => pickers[2].trigger('change', { value: distantDate }));
  await dataWhere('native picker selects server window endpoint', value => value.date === distantDate && !value.queried);
  data = await querySlots('distant native-picker query');
  const emptyComponents = await sdk('inspect actual empty component', () => page.$$('van-empty'));
  if (data.error) {
    assert.equal(data.queried, false); assert.equal(data.slots.length, 0); assert.equal(emptyComponents.length, 0);
    report.distantDate = { date: distantDate, outcome: 'server-or-network-error', displayedMessage: data.error, genuineEmptyStateVerified: false };
    report.limitations.push('远期查询返回了页面错误，未把服务器拒绝或网络失败冒充空号源；远期真实空态尚未验证。');
    check('服务端窗口边界查询失败明确展示错误而非伪造van-empty', { selectedDate: distantDate });
  } else if (!data.slots.length) {
    assert.equal(data.queried, true);
    const empty = await element(page, 'van-empty');
    await wait('genuine empty description', async () => (await empty.data('description')) === '当天暂无匹配时段');
    assert.equal(data.slotGroups.length, 0); assert.equal((await page.$$('button[data-index]')).length, 0);
    report.distantDate = { date: distantDate, outcome: 'empty', genuineEmptyStateVerified: true };
    check('服务端实际返回空号源并渲染Vant真实空态，无可选按钮', { selectedDate: distantDate });
  } else {
    await verifyGroups(data, '远期实际号源'); assert.equal(emptyComponents.length, 0);
    report.distantDate = { date: distantDate, outcome: 'available', slotCount: data.slots.length, genuineEmptyStateVerified: false };
    report.limitations.push('远期仍存在号源，已保留实际结果，没有伪造空态。');
  }
  await shot('03-distant-query-outcome');
  assert.equal((await sdk('final page state', () => page.data())).holding, false);
  assert.equal((await sdk('final current page', () => mini.currentPage())).path, 'pages/booking/index');
  assert.equal(artifactHash(compiledRoot), report.environment.artifactSha256);
  assert.equal(artifactHash(resolve(repository, 'miniprogram/dist')), report.environment.artifactSha256);
  check('全程停留预约查询页，无登录/占位/确认命令，真实编译产物保持一致');
  report.status = report.limitations.some(item => item.includes('未验证非空号源')) ? 'partial' : 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error.message; process.exitCode = 1;
  console.error('FAIL ' + error.message);
  if (mini) try { mkdirSync(screenshots, { recursive: true }); await shot('failure-native'); } catch {}
} finally {
  if (mini) try { await bounded(mini.disconnect(), 'SDK disconnect', 4000); } catch (error) { report.disconnectError = error.message; }
  report.finishedAt = new Date().toISOString();
  mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, namespace,
    slotQueries: report.queries.map(item => ({ date: item.date, outcome: item.outcome, slotCount: item.slotCount })),
    limitations: report.limitations.length, evidence: 'docs/implementation/qa/reference-native-ui.json' }));
}
