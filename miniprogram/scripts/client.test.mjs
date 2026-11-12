import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function runtime() {
  const storage = new Map(), requests = [], pages = [], components = [], cache = new Map(), navigations = [];
  let respond = options => options.fail({ errMsg: 'request:fail offline' });
  const context = vm.createContext({ console, Date, Math, Set, Map, Promise, Error, encodeURIComponent, setInterval, clearInterval, getCurrentPages: () => [],
    wx: { getStorageSync: key => storage.has(key) ? structuredClone(storage.get(key)) : '', setStorageSync: (key, value) => storage.set(key, structuredClone(value)), removeStorageSync: key => storage.delete(key), request(options) { requests.push(options); respond(options); }, navigateTo(options) { navigations.push(options); }, redirectTo(options) { navigations.push(options); }, switchTab(options) { navigations.push(options); }, showToast() {}, showModal: async () => ({ confirm: true }), stopPullDownRefresh() {} },
    Page: options => pages.push(options), Component: options => components.push(options), App() {}
  });
  function load(relative) {
    const path = resolve(root, 'dist', relative.endsWith('.js') ? relative : relative + '.js');
    if (!path.startsWith(resolve(root, 'dist') + '\\') && !path.startsWith(resolve(root, 'dist') + '/')) throw new Error('Unexpected module path');
    if (cache.has(path)) return cache.get(path).exports;
    const module = { exports: {} }; cache.set(path, module);
    const wrapped = vm.runInContext('(function(require,module,exports){' + readFileSync(path, 'utf8') + '\n})', context, { filename: path });
    wrapped(id => { if (!id.startsWith('.')) throw new Error('Native bundle must not need npm runtime: ' + id); const target = resolve(dirname(path), id); return load(target); }, module, module.exports);
    return module.exports;
  }
  return { load, requests, storage, pages, components, context, navigations, respond: fn => { respond = fn; }, success: data => { respond = options => options.success({ statusCode: 200, data: { data, requestId: 'test' } }); } };
}
const login = id => ({ token: 'test-token-' + id, expiresAt: new Date(Date.now() + 3600000).toISOString(), user: { id, username: id, patientId: 'patient-' + id, staffId: null, displayName: id, roles: ['patient'], assignments: [] } });
const body = { holdId: 'hold-fixture', holdVersion: 1, patientConfirmed: true, rulesAccepted: true };
const queryPolicyFixture = () => ({ holdSeconds: 300, cancellationNoticeMinutes: 120, transferBufferMinutes: 30, slotStepMinutes: 15, timezone: 'Asia/Shanghai', queryWindow: { fromDate: '2000-01-01', toDate: '2099-12-31' } });
function patientPage(r, name) {
  r.load('pages/' + name + '/index'); const options = r.pages.at(-1);
  return { ...options, data: structuredClone(options.data), setData(update) { Object.assign(this.data, update); } };
}
test('expired in-memory session is removed even when the app never restarted', () => {
  const r = runtime(), auth = r.load('utils/session');
  auth.setSession({ ...login('one'), expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal(auth.session(), null); assert.equal(r.storage.has('andrew.session.v1'), false);
});
test('logout immediately clears patient state, preserves pending operation and reports unconfirmed revocation', async () => {
  const r = runtime(), auth = r.load('utils/session'), booking = r.load('utils/booking'); auth.setSession(login('one'));
  const pending = booking.newCommand('/appointments/confirm', body); await assert.rejects(booking.sendCommand(pending));
  const page = patientPage(r, 'profile'); Object.assign(page.data, { ownerId: 'one', signedIn: true, displayName: 'fictional patient', profile: { name: 'fictional patient' }, patientId: 'patient-one', rowVersion: 1, isDemo: true, hasHold: true });
  let revoke; r.respond(options => { revoke = options; });
  const promise = page.logout(); await new Promise(resolve => setImmediate(resolve));
  assert.ok(revoke); assert.equal(revoke.header.Authorization, 'Bearer test-token-one');
  assert.equal(auth.session(), null); assert.equal(page.data.signedIn, false); assert.equal(page.data.displayName, ''); assert.equal(page.data.profile.name, ''); assert.equal(page.data.patientId, ''); assert.equal(page.data.hasHold, false);
  revoke.fail({ errMsg: 'request:fail offline' }); await promise;
  assert.match(page.data.logoutNotice, /撤销未确认/); auth.setSession(login('one')); assert.equal(booking.pendingCommand().key, pending.key);
});
test('late logout response cannot clear a newer session even for the same user', async () => {
  const r = runtime(), auth = r.load('utils/session'); auth.setSession(login('one'));
  const page = patientPage(r, 'profile'); Object.assign(page.data, { ownerId: 'one', signedIn: true, displayName: 'old' });
  let revoke; r.respond(options => { revoke = options; }); const promise = page.logout(); await new Promise(resolve => setImmediate(resolve));
  auth.setSession({ ...login('one'), token: 'new-token' }); Object.assign(page.data, { ownerId: 'one', signedIn: true, displayName: 'new' });
  revoke.success({ statusCode: 401, data: { error: { code: 'SESSION_EXPIRED' } } }); await promise;
  assert.equal(auth.session().token, 'new-token'); assert.equal(page.data.signedIn, true); assert.equal(page.data.displayName, 'new');
});
test('booking page permits anonymous catalog browsing but refuses to create a hold', async () => {
  const r = runtime(), page = patientPage(r, 'booking');
  page.onShow(); assert.equal(page.data.signedIn, false);
  page.data.slots = [{ startsAt: '2099-01-01T00:00:00Z' }];
  await page.choose({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(r.requests.length, 0); assert.equal(r.navigations.at(-1).url, '/pages/login/index');
});
test('expired patient profile session clears displayed name and sensitive details after 401', async () => {
  const r = runtime(), auth = r.load('utils/session'); auth.setSession(login('one'));
  const page = patientPage(r, 'profile'); Object.assign(page.data, { ownerId: 'one', signedIn: true, displayName: 'old patient', profile: { name: 'old patient' }, patientId: 'patient-one', rowVersion: 1, isDemo: true, hasHold: true });
  r.respond(options => options.success({ statusCode: 401, data: { error: { code: 'SESSION_EXPIRED', message: '请重新登录' } } }));
  await page.load(); assert.equal(auth.session(), null); assert.equal(page.data.signedIn, false); assert.equal(page.data.displayName, ''); assert.equal(page.data.profile.name, ''); assert.equal(page.data.patientId, ''); assert.equal(page.data.hasHold, false);
});
function loginPage(r) {
  r.load('pages/login/index'); const options = r.pages.at(-1);
  return { ...options, data: structuredClone(options.data), setData(update) { Object.assign(this.data, update); } };
}

test('patient demo password is disclosed once inside the login-only account presets', () => {
  const template=readFileSync(join(root,'src/pages/login/index.wxml'),'utf8');
  const presets=template.match(/<view wx:if="\{\{mode === 'login'\}\}" class="patient-account-presets">[\s\S]*?<view class="preset-help">([\s\S]*?)<\/view>/)?.[1];
  assert.ok(presets);assert.match(presets,/演示密码：admin123/);assert.match(presets,/手动输入密码/);
  assert.equal(template.match(/演示密码：admin123/g)?.length,1);
});

test('patient account presets fill only a known patient username and never authenticate by themselves', () => {
  const r=runtime(), page=loginPage(r), pick=username=>page.selectPatient({currentTarget:{dataset:{username}}});
  assert.deepEqual(Array.from(page.data.patientAccounts,item=>item.username),['patient.a','patient.b']);
  Object.assign(page.data,{password:'old-account-password',error:'old error'});
  pick('patient.a');assert.equal(page.data.username,'patient.a');assert.equal(page.data.password,'');assert.equal(page.data.error,'');
  page.data.password='same-account-password';pick('patient.a');assert.equal(page.data.password,'same-account-password');
  pick('patient.b');assert.equal(page.data.username,'patient.b');assert.equal(page.data.password,'');
  pick('hq');assert.equal(page.data.username,'patient.b');
  page.data.busy=true;pick('patient.a');assert.equal(page.data.username,'patient.b');
  assert.equal(r.requests.length,0);assert.equal(r.load('utils/session').session(),null);
});

test('patient presets follow manual account entry and cannot populate a registration mode', () => {
  const r=runtime(),page=loginPage(r);
  page.selectPatient({currentTarget:{dataset:{username:'patient.a'}}});
  page.input({currentTarget:{dataset:{field:'username'}},detail:{value:'my.patient'}});assert.equal(page.data.selectedPatientAccount,'');
  page.input({currentTarget:{dataset:{field:'username'}},detail:{value:'patient.b'}});assert.equal(page.data.selectedPatientAccount,'patient.b');
  page.mode({currentTarget:{dataset:{mode:'register'}}});assert.equal(page.data.username,'');assert.equal(page.data.selectedPatientAccount,'');
  page.selectPatient({currentTarget:{dataset:{username:'patient.a'}}});assert.equal(page.data.username,'');assert.equal(r.requests.length,0);
});

test('patient preset sign-in still submits an ordinary patient password login with demo login disabled', async () => {
  const r=runtime(),page=loginPage(r);page.data.config={demoLoginEnabled:false,demoAccounts:[],wechatLoginEnabled:false};
  page.selectPatient({currentTarget:{dataset:{username:'patient.a'}}});page.data.password='admin123';
  r.respond(options=>options.success({statusCode:200,data:{data:options.url.endsWith('/auth/login')?login('patient.a'):{accepted:true,minor:false,policyVersion:'v1'}}}));
  await page.submit();assert.match(r.requests[0].url,/\/auth\/login$/);assert.equal(r.requests[0].data.username,'patient.a');assert.equal(r.requests[0].data.portal,'patient');
  assert.equal(r.requests[0].data.password,'admin123');assert.ok(r.requests.every(request=>!request.url.endsWith('/auth/demo')));
});
test('linked registration refuses minor consent without a guardian and makes no request', async () => {
  const r = runtime(), page = loginPage(r);
  Object.assign(page.data, { mode: 'linked', username: 'patient.one', password: 'LongSyntheticPassword', code: 'one-time-code', linkedBirthDate: '2022-01-01', minor: true, notice: { policyVersion: 'v1' }, acceptedNotice: true, acceptedSensitive: true });
  await page.submit(); assert.match(page.data.error, /监护人/); assert.equal(r.requests.length, 0); assert.equal(r.navigations.length, 0);
});
test('linked registration sends verified consent and only binds an existing patient', async () => {
  const r = runtime(), page = loginPage(r);
  Object.assign(page.data, { mode: 'linked', username: 'patient.one', password: 'LongSyntheticPassword', code: ' one-time-code ', linkedBirthDate: '1990-01-01', notice: { policyVersion: 'v1' }, acceptedNotice: true, acceptedSensitive: true });
  r.respond(options => options.success({ statusCode: 200, data: { data: options.url.endsWith('/privacy/status') ? { accepted: true, minor: false, policyVersion: 'v1' } : login('one') } }));
  await page.submit(); assert.match(r.requests[0].url, /\/auth\/register-linked$/); assert.equal(r.requests[0].data.code, 'one-time-code');
  assert.equal(r.requests[0].data.birthDate, '1990-01-01'); assert.equal(r.requests[0].data.consent.policyVersion, 'v1'); assert.equal(r.requests[0].data.consent.guardian, null);
  assert.equal(Object.hasOwn(r.requests[0].data, 'profile'), false); assert.equal(r.load('utils/session').session().user.id, 'one'); assert.equal(r.navigations.at(-1).url, '/pages/home/index');
});
test('existing account must accept privacy notice before entering patient pages', async () => {
  const r = runtime(), page = loginPage(r);
  Object.assign(page.data, { username: 'patient.one', password: 'LongSyntheticPassword', notice: { policyVersion: 'v1' } });
  r.respond(options => options.success({ statusCode: 200, data: { data: options.url.endsWith('/auth/login') ? login('one') : options.url.endsWith('/privacy/status') ? { accepted: false, minor: false, policyVersion: 'v1' } : {} } }));
  await page.submit(); assert.equal(page.data.mode, 'consent'); assert.equal(r.navigations.length, 0);
  await page.submit(); assert.match(page.data.error, /隐私告知/); assert.equal(r.requests.length, 2);
  Object.assign(page.data, { acceptedNotice: true, acceptedSensitive: true }); await page.submit();
  assert.match(r.requests.at(-1).url, /\/privacy\/consent$/); assert.equal(r.requests.at(-1).data.policyVersion, 'v1'); assert.equal(r.navigations.at(-1).url, '/pages/home/index');
});
test('native build includes all configured pages, assets and callable WXML handlers', () => {
  const app = JSON.parse(readFileSync(join(root, 'dist/app.json'), 'utf8'));
  assert.deepEqual([...app.pages].sort(), ['home', 'login', 'booking', 'confirm', 'appointments', 'detail', 'profile', 'doctors', 'doctor-detail', 'prices', 'clinics', 'privacy', 'education'].map(name => 'pages/' + name + '/index').sort());
  const r = runtime();
  for (const page of app.pages) {
    for (const extension of ['.js', '.json', '.wxml', '.wxss']) assert.ok(existsSync(join(root, 'dist', page + extension)), page + extension);
    r.load(page); const options = r.pages.at(-1), template = readFileSync(join(root, 'dist', page + '.wxml'), 'utf8');
    assert.ok(options);
    for (const match of template.matchAll(/(?:bind|catch):?(?:tap|input|change|submit|click|confirm|close)="([A-Za-z]\w*)"/g)) assert.equal(typeof options[match[1]], 'function', page + ' handler ' + match[1]);
    assert.doesNotMatch(template, /<\/?(?:br|div|span|img)\b/);
  }
  r.load('components/patient-form/index'); assert.equal(r.components.length, 1);
});

test('home appointment entry requires login while the clinic tab remains public', () => {
  const r = runtime(), page = patientPage(r, 'home');
  page.startBooking(); assert.equal(r.navigations.at(-1).url, '/pages/login/index');
  page.clinics(); assert.equal(r.navigations.at(-1).url, '/pages/clinics/index');
  r.load('utils/session').setSession(login('home-patient'));
  page.startBooking(); assert.equal(r.navigations.at(-1).url, '/pages/booking/index');
  assert.equal(r.requests.length, 0, 'Navigation must not reserve an appointment');
});

test('clinic locations use shared records, copy exact addresses and never dial demo or missing phone numbers', async () => {
  const r = runtime(), page = patientPage(r, 'clinics'), copied = [], called = [];
  r.context.wx.setClipboardData = options => copied.push(options.data);
  r.context.wx.makePhoneCall = options => called.push(options.phoneNumber);
  r.success([
    { id: 'demo', name: '安德鲁牙科·越秀门诊', address: '虚构演示地址', phone: '020-00000000', description: '课程演示' },
    { id: 'real', name: '已核对的测试记录', address: '测试地址', phone: '020-12345678' },
    { id: 'incomplete', name: '未公布地址电话', address: '', phone: '' },
  ]);
  await page.load(); assert.match(r.requests[0].url, /\/api\/v1\/clinics$/);
  const event = id => ({ currentTarget: { dataset: { id } } });
  page.copyAddress(event('demo')); assert.deepEqual(copied, ['虚构演示地址']);
  page.copyAddress(event('incomplete')); page.copyAddress(event('unknown')); assert.equal(copied.length, 1);
  page.call(event('demo')); page.call(event('incomplete')); page.call(event('unknown')); assert.equal(called.length, 0);
  page.call(event('real')); assert.deepEqual(called, ['020-12345678']);
  page.book(event('demo')); assert.equal(r.navigations.at(-1).url, '/pages/booking/index?clinicId=demo');
  page.doctors(event('real')); assert.equal(r.navigations.at(-1).url, '/pages/doctors/index?clinicId=real');
  const count = r.navigations.length; page.book(event('unknown')); page.doctors(event('unknown')); assert.equal(r.navigations.length, count);
  assert.equal(r.requests.filter(request => request.method === 'POST').length, 0);
});

test('clinic reload ignores stale responses and can recover from a network failure', async () => {
  const r = runtime(), page = patientPage(r, 'clinics'), pending = [];
  r.respond(options => pending.push(options));
  const first = page.load(), second = page.load();
  pending[1].success({ statusCode: 200, data: { data: [{ id: 'fresh', name: '新资料', address: '', phone: '' }] } });
  await second;
  pending[0].success({ statusCode: 200, data: { data: [{ id: 'stale', name: '旧资料', address: '', phone: '' }] } });
  await first; assert.equal(page.data.clinics[0].id, 'fresh');
  const failure = page.load(); pending[2].fail({ errMsg: 'request:fail offline' }); await failure;
  assert.ok(page.data.error); assert.equal(page.data.loading, false);
  r.success([]); await page.load(); assert.equal(page.data.error, ''); assert.equal(page.data.clinics.length, 0);
});
test('uncertain confirmation persists original key and content; only same operation is retried', async () => {
  const r = runtime(), auth = r.load('utils/session'), booking = r.load('utils/booking'); auth.setSession(login('one'));
  const command = booking.newCommand('/appointments/confirm', body);
  await assert.rejects(booking.sendCommand(command), error => error.uncertain === true);
  assert.equal(booking.pendingCommand().key, command.key);
  assert.throws(() => booking.newCommand('/appointments/confirm', body), /待确认/);
  r.success({ id: 'confirmed-fixture' }); await booking.sendCommand(booking.pendingCommand());
  assert.equal(r.requests[0].header['Idempotency-Key'], r.requests[1].header['Idempotency-Key']);
  assert.equal(JSON.stringify(r.requests[0].data), JSON.stringify(r.requests[1].data));
  assert.equal(booking.pendingCommand(), null);
});
test('command not_found retains original key; completed clears only the owner operation', async () => {
  const r = runtime(), auth = r.load('utils/session'), booking = r.load('utils/booking'); auth.setSession(login('one'));
  const command = booking.newCommand('/appointments/confirm', body); await assert.rejects(booking.sendCommand(command));
  r.success({ status: 'not_found' }); assert.equal(await booking.inspectCommand(), null); assert.equal(booking.pendingCommand().key, command.key);
  r.success({ status: 'completed', result: { id: 'confirmed-fixture' } }); assert.equal((await booking.inspectCommand()).id, 'confirmed-fixture'); assert.equal(booking.pendingCommand(), null);
});
test('switching account cannot read, overwrite or submit another account pending command', async () => {
  const r = runtime(), auth = r.load('utils/session'), booking = r.load('utils/booking'); auth.setSession(login('one'));
  const one = booking.newCommand('/appointments/confirm', body); await assert.rejects(booking.sendCommand(one));
  auth.setSession(login('two')); assert.equal(booking.pendingCommand(), null); await assert.rejects(booking.sendCommand(one), /原账号/);
  const two = booking.newCommand('/appointments/confirm', body); await assert.rejects(booking.sendCommand(two)); assert.equal(booking.pendingCommand().key, two.key);
  auth.setSession(login('one')); assert.equal(booking.pendingCommand().key, one.key);
});
test('malformed successful response remains uncertain; definitive validation rejection permits correction', async () => {
  const r = runtime(), auth = r.load('utils/session'), booking = r.load('utils/booking'); auth.setSession(login('one'));
  const command = booking.newCommand('/appointments/confirm', body);
  r.respond(options => options.success({ statusCode: 200, data: 'interrupted payload' })); await assert.rejects(booking.sendCommand(command), error => error.uncertain); assert.equal(booking.pendingCommand().key, command.key);
  r.respond(options => options.success({ statusCode: 409, data: { error: { code: 'HOLD_EXPIRED', message: '占位已到期' } } })); await assert.rejects(booking.sendCommand(command), /占位已到期/); assert.equal(booking.pendingCommand(), null);
});
test('401 clears token and preserves pending command for the same account after login', async () => {
  const r = runtime(), auth = r.load('utils/session'), booking = r.load('utils/booking'); auth.setSession(login('one'));
  const command = booking.newCommand('/appointments/confirm', body);
  r.respond(options => options.success({ statusCode: 401, data: { error: { code: 'SESSION_EXPIRED', message: '登录已失效' } } })); await assert.rejects(booking.sendCommand(command)); assert.equal(auth.session(), null);
  auth.setSession(login('one')); assert.equal(booking.pendingCommand().key, command.key);
});
test('allergy unknown differs from none_reported and multiple-line editing preserves the next line', () => {
  const r = runtime(); r.load('components/patient-form/index'); const component = r.components[0];
  const value = { name: 'fixture', allergyStatus: 'known', allergies: ['过敏项一'] };
  const instance = { properties: { value }, data: { allergyText: '过敏项一\n', allergyIndex: 2 }, setData(update) { Object.assign(this.data, update); } };
  component.observers.value.call(instance, value); assert.equal(instance.data.allergyText, '过敏项一\n');
  const format = r.load('utils/format'); assert.notEqual(format.allergyLabels.unknown, format.allergyLabels.none_reported);
});
test('cached patient pages clear previous account data before showing a new account', () => {
  const r = runtime(), auth = r.load('utils/session');
  for (const name of ['appointments', 'profile', 'detail', 'confirm']) {
    auth.setSession(login('one')); r.load('pages/' + name + '/index'); const options = r.pages.at(-1);
    const page = { ...options, data: structuredClone(options.data), setData(update) { Object.assign(this.data, update); }, async load() {}, async loadPatient() {} };
    page.onShow(); Object.assign(page.data, { items: [{ patientName: 'old-patient' }], total: 1, patient: { name: 'old-patient' }, profile: { name: 'old-patient' }, patientId: 'old-patient', rowVersion: 1, isDemo: true, appointment: { patientName: 'old-patient' }, events: [{ id: 'old-event' }], patientConfirmed: true, rulesAccepted: true });
    auth.setSession(login('two')); page.onShow();
    assert.equal(page.data.ownerId, 'two');
    if (name === 'appointments') { assert.equal(page.data.items.length, 0); assert.equal(page.data.total, 0); }
    if (name === 'profile') { assert.equal(page.data.profile.name, ''); assert.equal(page.data.patientId, ''); assert.equal(page.data.rowVersion, 0); assert.equal(page.data.isDemo, false); }
    if (name === 'detail') { assert.equal(page.data.appointment, null); assert.equal(page.data.events.length, 0); }
    if (name === 'confirm') { assert.equal(page.data.patient, null); assert.equal(page.data.patientConfirmed, false); assert.equal(page.data.rulesAccepted, false); }
  }
});
test('late profile response from previous account cannot populate current account form', async () => {
  const r = runtime(), auth = r.load('utils/session'); r.load('pages/profile/index'); const options = r.pages.at(-1);
  const page = { ...options, data: structuredClone(options.data), setData(update) { Object.assign(this.data, update); } };
  auth.setSession(login('one')); page.data.ownerId = 'one'; const responses = []; r.respond(options => responses.push(options));
  const pending = page.load(); auth.setSession(login('two')); page.data.ownerId = 'two'; page.data.profile = { name: 'current-patient' };
  responses[0].success({ statusCode: 200, data: { data: { patientId: 'patient-one' } } });
  responses[1].success({ statusCode: 200, data: { data: { id: 'patient-one', rowVersion: 1, name: 'previous-patient' } } });
  await pending; assert.equal(page.data.profile.name, 'current-patient');
});
test('late 401 response from previous account cannot revoke the current account session', async () => {
  const r = runtime(), auth = r.load('utils/session'), { api } = r.load('utils/api'); auth.setSession(login('one')); let response;
  r.respond(options => { response = options; }); const pending = api('/patients/me'); auth.setSession(login('two'));
  response.success({ statusCode: 401, data: { error: { code: 'SESSION_EXPIRED', message: '旧会话已过期' } } });
  await assert.rejects(pending); assert.equal(auth.session().user.id, 'two');
});
test('late command success after account switch cannot return old patient data or clear new account hold', async () => {
  const r = runtime(), auth = r.load('utils/session'), booking = r.load('utils/booking'); auth.setSession(login('one'));
  const command = booking.newCommand('/appointments/confirm', body); let response; r.respond(options => { response = options; }); const pending = booking.sendCommand(command);
  auth.setSession(login('two')); booking.saveHold({ hold: { id: 'new-account-hold' } });
  response.success({ statusCode: 200, data: { data: { id: 'old-account-appointment' } } });
  await assert.rejects(pending, error => error.code === 'ACCOUNT_CHANGED'); assert.equal(booking.getHold().hold.id, 'new-account-hold'); assert.equal(auth.session().user.id, 'two');
});

test('reference ranges preserve integer cents, units and source without becoming appointment fees', () => {
  const r = runtime(), catalog = r.load('utils/catalog');
  assert.equal(catalog.priceRange(3990, 38800), '39.9–388');
  assert.equal(catalog.priceRange(2990, 9900), '29.9–99');
  assert.equal(catalog.priceRange(0, 0), '0');
  assert.equal(catalog.priceRange(16999, 16999), '169.99');
  assert.equal(catalog.priceRange(5000000, 6000000), '50000–60000');
  for (const pair of [[-1, 100], [1.5, 100], [200, 100], [NaN, 100]]) assert.equal(catalog.priceRange(...pair), '待核对');
  const value = catalog.referenceView({ id: 'ref', category: '正畸', name: '合成参考资料', priceMinCents: 1500000, priceMaxCents: 3800000, unit: '疗程', referenceYear: 2026, sourceLabel: '用户提供的价格资料（未独立核验）', description: '资料中的疗程区间', bookingServiceId: 'consult-only' });
  assert.equal(value.priceLabel, '15000–38000'); assert.equal(value.unit, '疗程'); assert.equal(value.sourceLabel, '用户提供的价格资料（未独立核验）');
  assert.equal(value.bookingServiceId, 'consult-only'); assert.equal(value.priceCents, undefined);
});

test('doctor cards disclose fictional credentials and safely handle an ordinary doctor without demo metadata', () => {
  const r = runtime(), { doctorView } = r.load('utils/catalog');
  const doctor = { id: 'doc', name: '合成医生', specialty: '一般咨询', qualifications: [{ qualificationId: 'q', qualificationName: '合成资格', validFrom: '2020-01-01T00:00:00Z', validUntil: null }], serviceIds: [] };
  const real = doctorView(doctor); assert.equal(real.isDemo, false); assert.equal(real.bioLabel, '一般咨询');
  assert.equal(real.qualificationRows[0].name, '合成资格');
  const demo = doctorView({ ...doctor, isDemo: true, bio: '仅用于课程演示', focusAreas: ['预防咨询'], clinicIds: ['clinic-a'] });
  assert.equal(demo.isDemo, true); assert.equal(demo.bioLabel, '仅用于课程演示');
  assert.match(demo.qualificationRows[0].validityLabel, /虚构.*不对应真实执照/);
  assert.equal(JSON.stringify(demo.focusLabels), JSON.stringify(['预防咨询']));
});

test('read-only patient demo metadata stays visible and is never submitted as editable profile input', async () => {
  const r = runtime(), auth = r.load('utils/session'); auth.setSession(login('one'));
  r.load('pages/profile/index'); const options = r.pages.at(-1);
  const page = { ...options, data: structuredClone(options.data), setData(update) { Object.assign(this.data, update); } };
  page.data.ownerId = 'one';
  const patient = { id: 'patient-one', rowVersion: 1, name: '合成患者', birthDate: '2000-01-01', phone: '01000000000', email: null, billingAddress: '虚构地址', emergencyName: '合成联系人', emergencyPhone: '01000000001', allergyStatus: 'unknown', allergies: [], isDemo: true };
  r.respond(options => options.success({ statusCode: 200, data: { data: options.url.endsWith('/me') && !options.url.endsWith('/patients/me') ? login('one').user : { ...patient, rowVersion: options.method === 'PUT' ? 2 : 1 } } }));
  await page.load(); assert.equal(page.data.isDemo, true); assert.equal(Object.hasOwn(page.data.profile, 'isDemo'), false);
  await page.save(); assert.ok(!r.requests.some(item => item.method === 'PUT'));
  page.beginEdit(); assert.equal(page.data.editing, true);
  await page.save(); assert.equal(page.data.editing, false); const update = r.requests.find(item => item.method === 'PUT'); assert.ok(update);
  assert.equal(Object.hasOwn(update.data, 'isDemo'), false); assert.equal(Object.hasOwn(update.data, 'id'), false); assert.equal(Object.hasOwn(update.data, 'rowVersion'), false);
  assert.equal(update.data.expectedVersion, 1); assert.equal(page.data.rowVersion, 2); assert.equal(page.data.isDemo, true); assert.equal(page.data.saved, true);
});

test('price browsing combines category and search and passes only the linked consultation to booking', async () => {
  const r = runtime(); r.load('pages/prices/index'); const options = r.pages.at(-1);
  const page = { ...options, data: structuredClone(options.data), setData(update) { Object.assign(this.data, update); } };
  r.success([
    { id: 'clean', category: '预防', name: '洁牙', priceMinCents: 3990, priceMaxCents: 38800, unit: '次', referenceYear: 2026, sourceLabel: '用户提供的价格资料（未独立核验）', description: '方式另行确认', bookingServiceId: 'consult-general' },
    { id: 'ortho', category: '正畸', name: '金属矫治', priceMinCents: 600000, priceMaxCents: 1800000, unit: '疗程', referenceYear: 2026, sourceLabel: '用户提供的价格资料（未独立核验）', description: '复诊清单', bookingServiceId: 'consult-ortho' },
    { id: 'info-only', category: '资料', name: '未开放咨询', priceMinCents: 0, priceMaxCents: 0, unit: '次', referenceYear: 2026, sourceLabel: '用户提供的价格资料（未独立核验）', description: '', bookingServiceId: null },
  ]);
  await page.load(); assert.equal(page.data.filteredItems.length, 3);
  page.categoryTap({ currentTarget: { dataset: { category: '正畸' } } }); assert.equal(page.data.filteredItems.length, 1);
  page.searchInput({ detail: { value: '  复诊  ' } }); assert.equal(page.data.filteredItems[0].id, 'ortho');
  page.searchInput({ detail: { value: '洁牙' } }); assert.equal(page.data.filteredItems.length, 0);
  page.consult({ currentTarget: { dataset: { id: 'ortho' } } });
  assert.equal(r.navigations.at(-1).url, '/pages/booking/index?serviceId=consult-ortho');
  assert.equal(r.requests.length, 1, 'Reference browsing must not create holds or reservations');
  const count = r.navigations.length; page.consult({ currentTarget: { dataset: { id: 'info-only' } } }); assert.equal(r.navigations.length, count);
});

test('doctor detail limits booking to doctor qualifications and the selected clinic', async () => {
  const r = runtime(); r.load('pages/doctor-detail/index'); const options = r.pages.at(-1);
  const page = { ...options, data: structuredClone(options.data), setData(update) { Object.assign(this.data, update); } };
  page.data.doctorId = 'doc-a';
  const doctors = [{ id: 'doc-a', name: '合成医生（虚构）', specialty: '评估', isDemo: true, qualifications: [], clinicIds: ['clinic-a', 'clinic-b'], serviceIds: ['consult-a', 'consult-b'] }];
  const clinics = [{ id: 'clinic-a', name: '合成门诊甲' }, { id: 'clinic-b', name: '合成门诊乙' }];
  const services = [
    { id: 'consult-a', name: '评估甲', priceCents: 6000, clinicIds: ['clinic-a'] },
    { id: 'consult-b', name: '评估乙', priceCents: 8000, clinicIds: ['clinic-b'] },
    { id: 'unqualified', name: '未匹配', priceCents: 9000, clinicIds: ['clinic-a'] },
  ];
  r.respond(options => options.success({ statusCode: 200, data: { data: options.url.endsWith('/doctors') ? doctors : options.url.endsWith('/clinics') ? clinics : services } }));
  await page.load(); assert.equal(page.data.doctor.isDemo, true); assert.equal(page.data.services.length, 1); assert.equal(page.data.services[0].id, 'consult-a');
  page.book(); const first = new URL(r.navigations.at(-1).url, 'https://test.invalid');
  assert.equal(first.searchParams.get('clinicId'), 'clinic-a'); assert.equal(first.searchParams.get('doctorId'), 'doc-a'); assert.equal(first.searchParams.get('serviceId'), 'consult-a');
  page.clinicChange({ detail: { value: '1' } }); assert.equal(page.data.services.length, 1); assert.equal(page.data.services[0].id, 'consult-b');
  page.book(); assert.match(r.navigations.at(-1).url, /serviceId=consult-b/);
  page.data.services = [services[2]]; const count = r.navigations.length; page.book(); assert.equal(r.navigations.length, count); assert.match(page.data.error, /匹配/);
});

test('booking deep links select the offering clinic and doctor; unavailable choices are never silently substituted', async () => {
  const r = runtime(); r.load('pages/booking/index'); const options = r.pages.at(-1);
  const page = { ...options, data: structuredClone(options.data), setData(update) { Object.assign(this.data, update); } };
  Object.assign(page.data, { preferredServiceId: 'consult-b', preferredDoctorId: 'doc-b' });
  const clinics = [{ id: 'clinic-a', name: '合成门诊甲' }, { id: 'clinic-b', name: '合成门诊乙' }];
  const services = [{ id: 'consult-a', name: '普通咨询', priceCents: 3000, clinicIds: ['clinic-a'] }, { id: 'consult-b', name: '专项评估', priceCents: 8000, clinicIds: ['clinic-b'] }];
  const doctor = { id: 'doc-b', name: '合成医生（虚构）', isDemo: true, specialty: '专项评估', qualifications: [], serviceIds: ['consult-b'], clinicIds: ['clinic-b'] };
  r.respond(options => {
    const url = new URL(options.url); let data;
    if (url.pathname.endsWith('/clinics')) data = clinics;
    else if (url.pathname.endsWith('/booking-policy')) data = queryPolicyFixture();
    else if (url.pathname.endsWith('/services')) data = url.searchParams.has('clinicId') ? services.filter(item => item.clinicIds.includes(url.searchParams.get('clinicId'))) : services;
    else if (url.pathname.endsWith('/doctors')) data = url.searchParams.get('serviceId') === 'consult-b' ? [doctor] : [];
    else if (url.pathname.endsWith('/booking-slots')) data = [];
    else throw new Error('Unexpected API path: ' + url.pathname);
    options.success({ statusCode: 200, data: { data } });
  });
  await page.load(); assert.equal(page.data.clinicIndex, 1); assert.equal(page.data.services[page.data.serviceIndex].id, 'consult-b'); assert.equal(page.data.doctorIndex, 1);
  await page.search(); const query = new URL(r.requests.at(-1).url); assert.equal(query.searchParams.get('doctorId'), 'doc-b'); assert.equal(query.searchParams.get('serviceId'), 'consult-b');
  assert.equal(page.data.services[0].priceLabel, '80.00', 'Booking fee comes from consultation, not the price-reference lower bound');
  await page.clinicChange({ detail: { value: '0' } }); const before = r.requests.length; await page.search();
  assert.equal(r.requests.length, before); assert.match(page.data.error, /不能自动替换/);
  await page.serviceChange({ detail: { value: '0' } }); const after = r.requests.length; await page.search();
  assert.equal(r.requests.length, after); assert.match(page.data.error, /所选医生/);
  page.doctorChange({ detail: { value: '0' } }); await page.search(); assert.ok(r.requests.length > after); assert.equal(new URL(r.requests.at(-1).url).searchParams.has('doctorId'), false);
});

function bookingAvailabilityFixture(r) {
  r.load('utils/session').setSession(login('availability-patient'));
  r.load('pages/booking/index');
  const options = r.pages.at(-1);
  const page = { ...options, data: structuredClone(options.data), setData(update) { Object.assign(this.data, update); } };
  const slot = {
    clinicId: 'clinic-old', clinicName: '原门诊', serviceId: 'service-old', serviceName: '原咨询',
    doctorId: 'doctor-old', doctorName: '原医生', chairId: 'chair-old', shiftId: 'shift-old',
    startsAt: '2099-01-02T01:00:00Z', endsAt: '2099-01-02T01:30:00Z', occupiedUntil: '2099-01-02T01:40:00Z',
    durationMinutes: 30, bufferMinutes: 10, priceCents: 6000, doctorIsDemo: false,
    key: '0', startLabel: '09:00', endLabel: '09:30', priceLabel: '60.00',
  };
  const oldService = { id: 'service-old', name: '原咨询', clinicIds: ['clinic-old'], priceCents: 6000 };
  const newService = { id: 'service-new', name: '新咨询', clinicIds: ['clinic-new', 'clinic-old'], priceCents: 8000 };
  Object.assign(page.data, {
    clinics: [{ id: 'clinic-old', name: '原门诊' }, { id: 'clinic-new', name: '新门诊' }],
    services: [oldService, newService], clinicIndex: 0, serviceIndex: 0,
    doctors: [{ id: 'doctor-old', name: '原医生', qualifications: [], serviceIds: ['service-old'] }],
    doctorNames: ['不限医生', '原医生'], doctorIndex: 1, slots: [slot], queried: true,
    policy: queryPolicyFixture(), calendarEndDate: '2099-12-31',
  });
  const patient = {
    id: 'patient-availability-patient', name: '本人患者', birthDate: '2000-01-01', phone: '00000000001',
    email: null, billingAddress: '合成地址', emergencyName: '合成联系人', emergencyPhone: '00000000002',
    allergyStatus: 'unknown', allergies: [], rowVersion: 1,
  };
  const reply = (request, data) => request.success({ statusCode: 200, data: { data, requestId: 'availability-test' } });
  const replyToBooking = request => {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/patients/me')) reply(request, patient);
    else if (path.endsWith('/booking-holds')) reply(request, { id: 'hold-new', expiresAt: '2099-01-02T00:00:00Z', rowVersion: 1, slot: { ...slot, ...request.data }, policy: {} });
    else throw new Error('Unexpected request: ' + request.url);
  };
  return { page, slot, oldService, newService, reply, replyToBooking };
}

test('changing clinic removes old selectable candidates during a slow request and after failure; recovery can book only the new clinic', async () => {
  const r = runtime();
  const { page, slot, newService, reply, replyToBooking } = bookingAvailabilityFixture(r);
  let delayed;
  r.respond(request => {
    if (new URL(request.url).pathname.endsWith('/services')) delayed = request;
    else replyToBooking(request);
  });
  const switching = page.clinicChange({ detail: { value: '1' } });
  assert.equal(new URL(delayed.url).searchParams.get('clinicId'), 'clinic-new');
  await page.choose({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(r.requests.filter(request => request.method === 'POST').length, 0, 'A click while the new clinic catalog is pending must not reserve the old clinic');
  assert.equal(r.navigations.length, 0);
  assert.equal(page.data.slots.length, 0); assert.equal(page.data.queried, false);
  assert.equal(page.data.services.length, 0); assert.equal(page.data.doctors.length, 0);
  delayed.fail({ errMsg: 'request:fail timed out' });
  await switching;
  assert.equal(page.data.loading, false); assert.match(page.data.error, /网络|连接/);
  await page.choose({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(r.requests.filter(request => request.method === 'POST').length, 0, 'A failed clinic request must not resurrect the previous candidates');
  assert.equal(page.data.slots.length, 0); assert.equal(page.data.services.length, 0);

  const newSlot = { ...slot, clinicId: 'clinic-new', clinicName: '新门诊', serviceId: 'service-new', serviceName: '新咨询', doctorId: 'doctor-new' };
  r.respond(request => {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/services')) reply(request, [newService]);
    else if (path.endsWith('/doctors')) reply(request, [{ id: 'doctor-new', name: '新医生', specialty: '咨询', qualifications: [], serviceIds: ['service-new'] }]);
    else if (path.endsWith('/booking-slots')) reply(request, [newSlot]);
    else replyToBooking(request);
  });
  await page.clinicChange({ detail: { value: '1' } });
  await page.search();
  await page.choose({ currentTarget: { dataset: { index: 0 } } });
  const holds = r.requests.filter(request => request.url.endsWith('/booking-holds'));
  assert.equal(holds.length, 1);
  assert.equal(holds[0].data.clinicId, 'clinic-new'); assert.equal(holds[0].data.serviceId, 'service-new');
  assert.equal(holds[0].data.doctorId, 'doctor-new');
  assert.equal(r.navigations.at(-1).url, '/pages/confirm/index');
});

test('changing service invalidates old doctor and time candidates before a delayed or failed doctor lookup', async () => {
  const r = runtime();
  const { page, replyToBooking } = bookingAvailabilityFixture(r);
  page.data.preferredDoctorId = 'doctor-old';
  let delayed;
  r.respond(request => {
    if (new URL(request.url).pathname.endsWith('/doctors')) delayed = request;
    else replyToBooking(request);
  });
  const switching = page.serviceChange({ detail: { value: '1' } });
  assert.equal(new URL(delayed.url).searchParams.get('serviceId'), 'service-new');
  await page.choose({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(r.requests.filter(request => request.method === 'POST').length, 0);
  assert.equal(page.data.slots.length, 0); assert.equal(page.data.doctors.length, 0); assert.equal(page.data.queried, false);
  delayed.fail({ errMsg: 'request:fail offline' });
  await switching;
  assert.equal(page.data.loading, false); assert.match(page.data.error, /网络|连接/);
  await page.choose({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(r.navigations.length, 0); assert.equal(r.requests.filter(request => request.method === 'POST').length, 0);
  const count = r.requests.length;
  await page.search();
  assert.equal(r.requests.length, count, 'A failed lookup must not silently discard the requested doctor');
  assert.match(page.data.error, /所选医生/);
});

test('late slot clicks cannot create a hold while loading or searching, but an idle valid candidate still can', async () => {
  for (const flag of ['loading', 'searching']) {
    const r = runtime();
    const { page, replyToBooking } = bookingAvailabilityFixture(r);
    r.respond(replyToBooking);
    page.data[flag] = true;
    // Keep an old rendered node/candidate to exercise the event guard itself,
    // independently of invalidating the page's candidate array.
    await page.choose({ currentTarget: { dataset: { index: 0 } } });
    assert.equal(r.requests.length, 0, flag + ' must block even a late event from an old slot node');
    assert.equal(r.navigations.length, 0);
    page.data[flag] = false;
    await page.choose({ currentTarget: { dataset: { index: 0 } } });
    assert.equal(r.requests.filter(request => request.url.endsWith('/booking-holds')).length, 1);
    assert.equal(r.navigations.at(-1).url, '/pages/confirm/index');
  }
});

function resultFixture(overrides = {}) {
  return {
    id: 'confirmed-feedback', appointmentNo: 'FB-2026-0001', patientId: 'patient-one', patientName: '反馈测试患者',
    clinicId: 'clinic-feedback', clinicName: '反馈测试门诊', clinicAddress: '合成地址', doctorId: 'doctor-feedback',
    doctorName: '反馈测试医生', serviceId: 'service-feedback', serviceName: '初诊咨询', chairId: 'chair-feedback',
    startsAt: '2099-01-02T01:00:00Z', endsAt: '2099-01-02T01:30:00Z', occupiedUntil: '2099-01-02T01:40:00Z',
    status: 'confirmed', attendance: 'not_recorded', rowVersion: 1, supersedesAppointmentId: null,
    replacementAppointmentId: null, cancellationReason: null, createdAt: '2026-01-01T00:00:00Z',
    policy: { holdSeconds: 180, cancellationNoticeMinutes: 120, transferBufferMinutes: 30, slotStepMinutes: 15, timezone: 'Asia/Shanghai' },
    events: [], ...overrides,
  };
}
function detailPage(r, id, query = {}) {
  r.load('pages/detail/index');
  const options = r.pages.find(page => typeof page.showCompleted === 'function');
  const page = { ...options, data: structuredClone(options.data), setData(update) { Object.assign(this.data, update); } };
  const load = page.load;
  page.load = function () { this.lastLoad = load.call(this); return this.lastLoad; };
  page.onLoad({ id, ...query });
  return page;
}
test('follow-up entry reuses the previous clinic and doctor as preferences and creates a new booking', async () => {
  const r=runtime(),auth=r.load('utils/session');auth.setSession(login('one'));
  const original=resultFixture({startsAt:'2020-01-02T01:00:00Z',endsAt:'2020-01-02T01:30:00Z'});r.success(original);
  const detail=detailPage(r,original.id);detail.onShow();await detail.lastLoad;
  assert.equal(detail.data.changeAllowed,false,'a past appointment cannot be rescheduled');detail.followup();
  const destination=new URL(r.navigations.at(-1).url,'https://test.invalid');
  assert.equal(destination.searchParams.get('followup'),'1');assert.equal(destination.searchParams.get('clinicId'),original.clinicId);
  assert.equal(destination.searchParams.get('doctorId'),original.doctorId);assert.equal(destination.searchParams.get('serviceId'),original.serviceId);
  assert.equal(destination.searchParams.has('appointmentId'),false);assert.equal(destination.searchParams.has('version'),false);
  const count=r.navigations.length;detail.data.pending=true;detail.followup();assert.equal(r.navigations.length,count);
  detail.data.pending=false;detail.data.appointment.status='cancelled';detail.followup();assert.equal(r.navigations.length,count);
  detail.data.appointment.status='confirmed';auth.setSession(login('two'));detail.followup();assert.equal(r.navigations.length,count);
});

test('follow-up context uses normal holds and confirmation without rescheduling or clinic consent requests', async () => {
  const r=runtime();r.load('utils/session').setSession(login('one'));
  const {page,replyToBooking}=bookingAvailabilityFixture(r);page.setData({isFollowup:true});r.respond(replyToBooking);
  await page.choose({currentTarget:{dataset:{index:0}}});
  const booking=r.load('utils/booking'),context=booking.getHold();assert.equal(context.isFollowup,true);assert.equal(context.oldAppointmentId,undefined);
  const confirm=patientPage(r,'confirm');Object.assign(confirm.data,{ownerId:'one',patientConfirmed:true,rulesAccepted:true,patient:{
    id:'patient-one',rowVersion:1,name:'合成患者',birthDate:'2000-01-01',phone:'13800009999',email:null,billingAddress:'合成地址',emergencyName:'合成联系人',emergencyPhone:'13900009999',allergyStatus:'unknown',allergies:[]
  }});
  r.respond(request=>request.success({statusCode:200,data:{data:resultFixture()}}));await confirm.submit();
  assert.equal(confirm.data.error,'');const posts=r.requests.filter(request=>request.method==='POST');
  assert.equal(posts.length,2);assert.match(posts[0].url,/\/booking-holds$/);assert.match(posts[1].url,/\/appointments\/confirm$/);
  assert.equal(Object.hasOwn(posts[1].data,'intent'),false);assert.ok(r.requests.every(request=>!request.url.includes('/privacy/consent')));
});

test('current privacy consent stays valid on returning patient login and health consent is never inferred from profile edits', async () => {
  const r=runtime(),page=loginPage(r);Object.assign(page.data,{username:'my.patient',password:'LongSyntheticPassword',notice:{policyVersion:'current'}});
  page.profileChange({detail:{birthDate:'1990-01-01',name:'合成姓名'}});assert.equal(page.data.acceptedNotice,false);assert.equal(page.data.acceptedSensitive,false);
  r.respond(request=>request.success({statusCode:200,data:{data:request.url.endsWith('/auth/login')?login('one'):{accepted:true,minor:false,policyVersion:'current'}}}));
  await page.submit();assert.equal(r.requests.length,2);assert.ok(r.requests.every(request=>!request.url.includes('/privacy/consent')));
  assert.equal(r.navigations.at(-1).url,'/pages/home/index');
});

async function submitFeedbackFixture(r, appointment, reschedule = false) {
  const booking = r.load('utils/booking');
  const hold = { id: 'feedback-hold', rowVersion: 1, expiresAt: '2099-01-01T00:00:00Z', policy: appointment.policy, slot: {
    ...appointment, shiftId: 'shift-feedback', priceCents: 6000, durationMinutes: 30, bufferMinutes: 10,
  } };
  booking.saveHold({ hold, ...(reschedule ? { oldAppointmentId: 'before-feedback', oldVersion: 1 } : {}) });
  r.load('pages/confirm/index');
  const options = r.pages.find(page => typeof page.loadPatient === 'function');
  const page = { ...options, data: structuredClone(options.data), setData(update) { Object.assign(this.data, update); } };
  Object.assign(page.data, { ownerId: 'one', patientConfirmed: true, rulesAccepted: true, reason: reschedule ? '需要调整就诊时间' : '', patient: {
    id: 'patient-one', rowVersion: 1, name: '反馈测试患者', birthDate: '2000-01-01', phone: '00000000001', email: null,
    billingAddress: '合成地址', emergencyName: '合成联系人', emergencyPhone: '00000000002', allergyStatus: 'unknown', allergies: [],
  } });
  r.respond(request => {
    assert.equal(request.method, 'POST');
    assert.equal(new URL(request.url).pathname.endsWith(reschedule ? '/before-feedback/changes' : '/appointments/confirm'), true);
    request.success({ statusCode: 200, data: { data: appointment, requestId: 'feedback-result' } });
  });
  await page.submit();
  assert.equal(page.data.error, '');
  return booking;
}

test('confirmed command remains visibly successful when the subsequent detail GET fails; URL flags and reopening cannot forge success', async () => {
  const r = runtime(), auth = r.load('utils/session'); auth.setSession(login('one'));
  const result = resultFixture();
  await submitFeedbackFixture(r, result);
  const destination = new URL(r.navigations.at(-1).url, 'https://test.invalid');
  assert.equal(destination.searchParams.get('id'), result.id);
  assert.equal(destination.searchParams.has('success'), false);
  r.respond(request => request.fail({ errMsg: 'request:fail after committed confirmation' }));
  const page = detailPage(r, result.id); page.onShow(); await page.lastLoad;
  assert.equal(page.data.success, true); assert.equal(page.data.successTitle, '预约已确认');
  assert.equal(page.data.appointment.appointmentNo, result.appointmentNo);
  assert.equal(page.data.appointment.status, 'confirmed'); assert.match(page.data.error, /连接|网络/);
  assert.equal(page.data.changeAllowed, false, 'A saved snapshot must not enable changes before the latest detail can be read');
  const before = r.requests.length; page.reschedule(); await page.cancel();
  assert.equal(r.requests.length, before); assert.equal(r.navigations.length, 1);
  r.success({ ...result, rowVersion: 2 }); await page.load();
  assert.equal(page.data.error, ''); assert.equal(page.data.appointment.rowVersion, 2); assert.equal(page.data.changeAllowed, true);
  const reopened = detailPage(r, result.id, { success: '1' }); reopened.onShow(); await reopened.lastLoad;
  assert.equal(reopened.data.appointment.status, 'confirmed'); assert.equal(reopened.data.success, false);
  assert.equal(reopened.data.successTitle, '');
});

test('reschedule command shows the new confirmed arrangement and an explicit reschedule result while detail is offline', async () => {
  const r = runtime(); r.load('utils/session').setSession(login('one'));
  const result = resultFixture({ id: 'replacement-feedback', supersedesAppointmentId: 'before-feedback', startsAt: '2099-01-02T03:00:00Z', endsAt: '2099-01-02T03:30:00Z' });
  await submitFeedbackFixture(r, result, true);
  assert.equal(r.requests[0].data.intent, 'reschedule');
  r.respond(request => request.fail({ errMsg: 'request:fail after committed reschedule' }));
  const page = detailPage(r, result.id); page.onShow(); await page.lastLoad;
  assert.equal(page.data.successTitle, '预约改期成功'); assert.equal(page.data.success, true);
  assert.equal(page.data.appointment.id, result.id); assert.equal(page.data.appointment.supersedesAppointmentId, 'before-feedback');
  assert.equal(page.data.appointment.startsAt, result.startsAt); assert.match(page.data.error, /连接|网络/);
});

test('cancel command keeps an explicit cancelled result and the API snapshot when detail refresh fails', async () => {
  const r = runtime(); r.load('utils/session').setSession(login('one'));
  const original = resultFixture(); r.success(original);
  const page = detailPage(r, original.id); page.onShow(); await page.lastLoad;
  assert.equal(page.data.success, false); assert.equal(page.data.changeAllowed, true);
  page.data.reason = '行程变化需要取消';
  const cancelled = { ...original, status: 'cancelled', rowVersion: 2, cancellationReason: page.data.reason };
  r.respond(request => {
    if (request.method === 'POST') request.success({ statusCode: 200, data: { data: cancelled } });
    else request.fail({ errMsg: 'request:fail after committed cancellation' });
  });
  await page.cancel();
  assert.equal(page.data.success, true); assert.equal(page.data.successTitle, '预约已取消');
  assert.equal(page.data.appointment.status, 'cancelled'); assert.equal(page.data.appointment.rowVersion, 2);
  assert.equal(page.data.appointment.cancellationReason, cancelled.cancellationReason);
  assert.match(page.data.error, /连接|网络/); assert.equal(page.data.pending, false);
});

test('uncertain or rejected operations cannot claim success; a completed command lookup can recover a trustworthy result', async () => {
  const r = runtime(), auth = r.load('utils/session'), booking = r.load('utils/booking'); auth.setSession(login('one'));
  const command = booking.newCommand('/appointments/confirm', body);
  await assert.rejects(booking.sendCommand(command), error => error.uncertain);
  assert.equal(booking.consumeCompletedOperation('confirmed-feedback'), null);
  const page = detailPage(r, 'confirmed-feedback', { success: '1' }); page.onShow(); await page.lastLoad;
  assert.equal(page.data.success, false); assert.equal(page.data.appointment, null); assert.equal(page.data.pending, true);
  const result = resultFixture();
  r.respond(request => {
    if (new URL(request.url).pathname.includes('/commands/')) request.success({ statusCode: 200, data: { data: { status: 'completed', result } } });
    else request.fail({ errMsg: 'request:fail reading latest details' });
  });
  await page.inspect();
  assert.equal(page.data.success, true); assert.equal(page.data.successTitle, '预约已确认');
  assert.equal(page.data.appointment.id, result.id); assert.equal(page.data.pending, false);
  const rejected = booking.newCommand('/appointments/confirm', body);
  r.respond(request => request.success({ statusCode: 409, data: { error: { code: 'HOLD_EXPIRED', message: '占位已到期' } } }));
  await assert.rejects(booking.sendCommand(rejected), /占位已到期/);
  assert.equal(booking.consumeCompletedOperation(result.id), null);
});

test('completion handoff is bound to both account and login session and is not restored after app restart', async () => {
  for (const change of ['account', 'session', 'restart']) {
    const r = runtime(), auth = r.load('utils/session'), booking = r.load('utils/booking'); auth.setSession(login('one'));
    const result = resultFixture(); r.success(result);
    await booking.sendCommand(booking.newCommand('/appointments/confirm', body));
    if (change === 'account') auth.setSession(login('two'));
    if (change === 'session') auth.setSession({ ...login('one'), token: 'a-new-login-session' });
    const target = change === 'restart' ? runtime() : r;
    if (change === 'restart') {
      for (const [key, value] of r.storage) target.storage.set(key, structuredClone(value));
    }
    target.respond(request => request.fail({ errMsg: 'request:fail offline' }));
    const page = detailPage(target, result.id, { success: '1' }); page.onShow(); await page.lastLoad;
    assert.equal(page.data.success, false, change + ' must not reuse an old completion');
    assert.equal(page.data.appointment, null, change + ' must not expose the previous API result');
  }
});

test('a newer authoritative status replaces an earlier operation success banner', async () => {
  const r = runtime(), auth = r.load('utils/session'), booking = r.load('utils/booking'); auth.setSession(login('one'));
  const result = resultFixture(); r.success(result);
  await booking.sendCommand(booking.newCommand('/appointments/confirm', body));
  r.success({ ...result, status: 'cancelled', rowVersion: 2, cancellationReason: '门诊后续取消' });
  const page = detailPage(r, result.id); page.onShow(); await page.lastLoad;
  assert.equal(page.data.appointment.status, 'cancelled'); assert.equal(page.data.success, false);
  assert.equal(page.data.successTitle, '');
});

test('Vant components are self-contained build output with their license and stay below the package size budget', () => {
  const app = JSON.parse(readFileSync(join(root, 'dist/app.json'), 'utf8'));
  assert.equal(app.style, undefined, 'Vant officially requires removing the v2 base component style');
  const config = JSON.parse(readFileSync(join(root, 'dist/pages/booking/index.json'), 'utf8'));
  assert.deepEqual(Object.keys(config.usingComponents).sort(), ['van-calendar', 'van-empty', 'van-loading', 'van-steps']);
  for (const component of Object.values(config.usingComponents)) {
    assert.match(component, /^\/vendor\/vant\//);
    for (const extension of ['.js', '.json', '.wxml', '.wxss']) assert.ok(existsSync(join(root, 'dist', component + extension)));
  }
  assert.ok(existsSync(join(root, 'dist/vendor/vant/calendar/components/month/index.wxs')));
  assert.ok(existsSync(join(root, 'dist/vendor/vant/wxs/utils.wxs')));
  assert.match(readFileSync(join(root, 'dist/vendor/vant/LICENSE'), 'utf8'), /MIT/);
  const bytes = directory => readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => total + (entry.isDirectory() ? bytes(join(directory, entry.name)) : statSync(join(directory, entry.name)).size), 0);
  assert.ok(bytes(join(root, 'dist')) < 2 * 1024 * 1024);
  const template = readFileSync(join(root, 'dist/pages/booking/index.wxml'), 'utf8');
  assert.equal([...template.matchAll(/<picker\b/g)].length, 4, 'Existing native picker order must remain available to the actual WeChat acceptance flow');
  assert.match(template.match(/<picker\s+mode="date"[^>]+>/)?.[0] ?? '', /end="{{calendarEndDate}}"/, 'Native picker and calendar share the server-provided query window');
  assert.match(template, /data-index="{{slotIndex}}"/);
});

test('calendar days round-trip without UTC truncation and quick choices cover exactly seven calendar days across a year boundary', () => {
  const r = runtime(), dates = r.load('utils/availability');
  for (const day of ['2026-10-25', '2026-12-31', '2028-02-29']) assert.equal(dates.calendarDateText(dates.calendarTimestamp(day)), day);
  assert.equal(dates.calendarDateText(NaN), '');
  assert.equal(dates.dayAfter('2028-02-28', 1), '2028-02-29');
  const choices = dates.quickDateChoices('2026-12-29');
  assert.equal(choices.length, 7); assert.equal(new Set(choices.map(item => item.date)).size, 7);
  assert.equal(choices[0].label, '今天'); assert.equal(choices[1].label, '明天');
  assert.equal(choices.at(-1).date, '2027-01-04');
  assert.equal(choices.some(item => Object.hasOwn(item, 'available')), false, 'A calendar date is not evidence of a published available slot');
});

test('morning, afternoon and evening use China time and grouped selection reserves exactly the original returned slot', async () => {
  const r = runtime(), { page, slot, reply, replyToBooking } = bookingAvailabilityFixture(r);
  const returned = [
    { ...slot, doctorId: 'doctor-evening', chairId: 'chair-evening', startsAt: '2099-01-02T10:00:00Z', endsAt: '2099-01-02T10:30:00Z' },
    { ...slot, doctorId: 'doctor-morning', chairId: 'chair-morning', startsAt: '2099-01-02T03:59:00Z', endsAt: '2099-01-02T04:29:00Z' },
    { ...slot, doctorId: 'doctor-afternoon', chairId: 'chair-afternoon', startsAt: '2099-01-02T04:00:00Z', endsAt: '2099-01-02T04:30:00Z' },
  ];
  r.respond(request => new URL(request.url).pathname.endsWith('/booking-slots') ? reply(request, returned) : replyToBooking(request));
  await page.search();
  assert.equal(JSON.stringify(page.data.slotGroups.map(group => [group.key, [...group.indices]])), JSON.stringify([['morning', [1]], ['afternoon', [2]], ['evening', [0]]]));
  assert.equal(JSON.stringify(page.data.slots.map(item => item.doctorId)), JSON.stringify(returned.map(item => item.doctorId)), 'Grouping must not reorder the source slot array');
  const indices = page.data.slotGroups.flatMap(group => [...group.indices]);
  assert.equal(new Set(indices).size, returned.length); assert.equal(indices.length, returned.length);
  await page.choose({ currentTarget: { dataset: { index: page.data.slotGroups[0].indices[0] } } });
  const writes = r.requests.filter(request => request.method === 'POST');
  assert.equal(writes.length, 1); assert.equal(writes[0].data.doctorId, 'doctor-morning');
  assert.equal(writes[0].data.chairId, 'chair-morning'); assert.equal(writes[0].data.startsAt, returned[1].startsAt);
});

test('all date controls and doctor events ignore busy clicks; choosing an idle date invalidates old groups without querying or reserving', async () => {
  for (const flag of ['loading', 'searching', 'holding']) {
    const r = runtime(), { page } = bookingAvailabilityFixture(r);
    const date = r.load('utils/format').dateToday(), nextDate = r.load('utils/availability').dayAfter(date, 1);
    Object.assign(page.data, { date, slotGroups: [{ key: 'morning', title: '上午', indices: [0] }], [flag]: true });
    page.quickDate({ currentTarget: { dataset: { date: nextDate } } });
    page.dateChange({ detail: { value: nextDate } });
    page.calendarConfirm({ detail: r.load('utils/availability').calendarTimestamp(nextDate) });
    page.doctorChange({ detail: { value: '0' } });
    page.openCalendar(); await page.choose({ currentTarget: { dataset: { index: 0 } } });
    assert.equal(page.data.date, date); assert.equal(page.data.doctorIndex, 1); assert.equal(page.data.calendarVisible, false);
    assert.equal(r.requests.length, 0); assert.equal(r.navigations.length, 0);
    page.data[flag] = false;
    page.quickDate({ currentTarget: { dataset: { date: nextDate } } });
    assert.equal(page.data.date, nextDate); assert.equal(page.data.slots.length, 0); assert.equal(page.data.slotGroups.length, 0); assert.equal(page.data.queried, false);
    assert.equal(r.requests.length, 0, 'Selecting a date must not create an implicit hold or claim availability');
    page.openCalendar(); assert.equal(page.data.calendarVisible, true);
    page.calendarConfirm({ detail: r.load('utils/availability').calendarTimestamp(date) });
    assert.equal(page.data.date, date); assert.equal(page.data.calendarVisible, false);
  }
});

test('calendar and native picker follow a changed server window without a hardcoded booking horizon', async () => {
  const r = runtime(), { page, reply } = bookingAvailabilityFixture(r);
  const dates = r.load('utils/availability');
  const window = dates.queryWindowLimits({ fromDate: '2099-01-01', toDate: '2099-01-05' }, '2099-01-01');
  Object.assign(page.data, { minDate: window.minDate, calendarEndDate: window.maxDate, date: '2099-01-01', calendarMax: dates.calendarTimestamp(window.maxDate), policy: { ...queryPolicyFixture(), queryWindow: { fromDate: window.minDate, toDate: window.maxDate } } });
  page.dateChange({ detail: { value: '2099-01-06' } });
  assert.equal(page.data.date, '2099-01-01'); assert.match(page.data.error, /2099-01-05/);
  const date = '2099-01-05'; page.dateChange({ detail: { value: date } });
  assert.equal(page.data.date, date); assert.equal(page.data.error, ''); page.openCalendar();
  assert.equal(page.data.calendarDate, dates.calendarTimestamp(date));
  r.respond(request => reply(request, [])); await page.search();
  assert.equal(new URL(r.requests.at(-1).url).searchParams.get('date'), date);
  assert.equal(page.data.queried, true); assert.equal(page.data.slots.length, 0);
});

test('catalog connection failure remains a retryable failure and is distinct from a successfully returned empty clinic catalog', async () => {
  const r = runtime(); r.load('pages/booking/index'); const options = r.pages.at(-1);
  const page = { ...options, data: structuredClone(options.data), setData(update) { Object.assign(this.data, update); } };
  const load = page.load; page.load = function () { this.lastLoad = load.call(this); return this.lastLoad; };
  r.respond(request => request.fail({ errMsg: 'request:fail initial catalog offline' }));
  await page.load();
  assert.equal(page.data.catalogFailed, true); assert.match(page.data.error, /连接|网络/);
  assert.equal(page.data.queried, false); assert.equal(page.data.slots.length, 0);
  r.respond(request => request.success({ statusCode: 200, data: { data: new URL(request.url).pathname.endsWith('/clinics') ? [] : queryPolicyFixture() } }));
  page.retryLoad(); await page.lastLoad;
  assert.equal(page.data.catalogFailed, false); assert.equal(page.data.error, ''); assert.equal(page.data.clinics.length, 0);
  assert.equal(page.data.queried, false, 'An empty clinic catalog is not an empty slot-query result');
  assert.equal(r.requests.filter(request => new URL(request.url).pathname.endsWith('/booking-slots')).length, 0);
});

test('superseded catalog responses and late slot responses after page unload cannot resurrect old availability', async () => {
  const r = runtime(); r.load('pages/booking/index'); const options = r.pages.at(-1);
  const page = { ...options, data: structuredClone(options.data), setData(update) { Object.assign(this.data, update); } };
  const responses = [];
  r.respond(request => {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/clinics') || path.endsWith('/booking-policy')) responses.push(request);
    else request.success({ statusCode: 200, data: { data: path.endsWith('/services') ? [{ id: 'new-service', name: '新咨询', clinicIds: ['new-clinic'], priceCents: 6000 }] : [] } });
  });
  const oldLoad = page.load(), newLoad = page.load();
  responses[2].success({ statusCode: 200, data: { data: [{ id: 'new-clinic', name: '新门诊' }] } });
  responses[3].success({ statusCode: 200, data: { data: queryPolicyFixture() } });
  await newLoad; assert.equal(page.data.clinics[0].id, 'new-clinic');
  responses[0].success({ statusCode: 200, data: { data: [{ id: 'old-clinic', name: '旧门诊' }] } });
  responses[1].success({ statusCode: 200, data: { data: queryPolicyFixture() } });
  await oldLoad; assert.equal(page.data.clinics[0].id, 'new-clinic'); assert.equal(page.data.services[0].id, 'new-service');
  const q = runtime(), { page: bookingPage, slot, reply } = bookingAvailabilityFixture(q); let delayed;
  q.respond(request => { delayed = request; }); const search = bookingPage.search();
  bookingPage.onUnload(); reply(delayed, [slot]); await search;
  assert.equal(bookingPage.data.slots.length, 0); assert.equal(bookingPage.data.slotGroups.length, 0); assert.equal(bookingPage.data.queried, false);
});

test('missing or invalid server query window stays a retryable catalog failure and cannot open a calendar or query slots', async () => {
  const r = runtime(); r.load('pages/booking/index'); const options = r.pages.at(-1);
  const page = { ...options, data: structuredClone(options.data), setData(update) { Object.assign(this.data, update); } };
  r.respond(request => request.success({ statusCode: 200, data: { data: new URL(request.url).pathname.endsWith('/clinics') ? [] : { timezone: 'Asia/Shanghai' } } }));
  await page.load(); assert.equal(page.data.catalogFailed, true); assert.match(page.data.error, /日期范围/);
  page.openCalendar(); assert.equal(page.data.calendarVisible, false);
  assert.equal(r.requests.filter(request => new URL(request.url).pathname.endsWith('/booking-slots')).length, 0);
  const dates = r.load('utils/availability');
  for (const window of [null, {}, {fromDate:'2026-02-30',toDate:'2026-03-31'}, {fromDate:'2026-10-05',toDate:'2026-10-01'}]) assert.throws(() => dates.queryWindowLimits(window,'2026-10-01'),/日期范围/);
});

test('fictional portrait positions are distinct and unknown or real doctors do not receive a fake portrait', () => {
  const { doctorView, clinicView } = runtime().load('utils/catalog');
  const names=['李若宁','陈知远','苏予安','顾清和','许知夏','周沐辰','唐书禾','林亦岚'];
  const base={specialty:'演示',qualifications:[],serviceIds:[]};
  const people=names.map(name=>doctorView({...base,isDemo:true,name:name+'（虚构医生）'}));
  assert.equal(people.filter(x=>x.hasPortrait).length,8);
  assert.equal(new Set(people.map(x=>x.portraitCol+','+x.portraitRow)).size,8);
  assert.equal(doctorView({...base,isDemo:false,name:'李若宁（虚构医生）'}).hasPortrait,false);
  assert.equal(doctorView({...base,isDemo:true,name:'其他演示医生'}).hasPortrait,false);
  assert.notEqual(clinicView({name:'安德鲁牙科·越秀门诊'}).demoImage,clinicView({name:'安德鲁牙科·天河门诊'}).demoImage);
  assert.equal(clinicView({name:'其他门诊'}).demoImage,'');
});
