import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function runtime() {
  const storage = new Map(), requests = [], pages = [], components = [], cache = new Map();
  let respond = options => options.fail({ errMsg: 'request:fail offline' });
  const context = vm.createContext({ console, Date, Math, Set, Map, Promise, Error, encodeURIComponent, setInterval, clearInterval, getCurrentPages: () => [],
    wx: { getStorageSync: key => storage.has(key) ? structuredClone(storage.get(key)) : '', setStorageSync: (key, value) => storage.set(key, structuredClone(value)), removeStorageSync: key => storage.delete(key), request(options) { requests.push(options); respond(options); }, navigateTo() {}, redirectTo() {}, switchTab() {}, showToast() {}, showModal: async () => ({ confirm: true }), stopPullDownRefresh() {} },
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
  return { load, requests, storage, pages, components, context, respond: fn => { respond = fn; }, success: data => { respond = options => options.success({ statusCode: 200, data: { data, requestId: 'test' } }); } };
}
const login = id => ({ token: 'test-token-' + id, expiresAt: new Date(Date.now() + 3600000).toISOString(), user: { id, username: id, patientId: 'patient-' + id, staffId: null, displayName: id, roles: ['patient'], assignments: [] } });
const body = { holdId: 'hold-fixture', holdVersion: 1, patientConfirmed: true, rulesAccepted: true };
test('native build includes all configured pages, assets and callable WXML handlers', () => {
  const app = JSON.parse(readFileSync(join(root, 'dist/app.json'), 'utf8'));
  assert.equal(app.pages.length, 7);
  const r = runtime();
  for (const page of app.pages) {
    for (const extension of ['.js', '.json', '.wxml', '.wxss']) assert.ok(existsSync(join(root, 'dist', page + extension)), page + extension);
    r.load(page); const options = r.pages.at(-1), template = readFileSync(join(root, 'dist', page + '.wxml'), 'utf8');
    assert.ok(options);
    for (const match of template.matchAll(/(?:bind|catch)(?:tap|input|change|submit)="([A-Za-z]\w*)"/g)) assert.equal(typeof options[match[1]], 'function', page + ' handler ' + match[1]);
    assert.doesNotMatch(template, /<\/?(?:br|div|span|img)\b/);
  }
  r.load('components/patient-form/index'); assert.equal(r.components.length, 1);
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
    page.onShow(); Object.assign(page.data, { items: [{ patientName: 'old-patient' }], total: 1, patient: { name: 'old-patient' }, profile: { name: 'old-patient' }, patientId: 'old-patient', rowVersion: 1, appointment: { patientName: 'old-patient' }, events: [{ id: 'old-event' }], patientConfirmed: true, rulesAccepted: true });
    auth.setSession(login('two')); page.onShow();
    assert.equal(page.data.ownerId, 'two');
    if (name === 'appointments') { assert.equal(page.data.items.length, 0); assert.equal(page.data.total, 0); }
    if (name === 'profile') { assert.equal(page.data.profile.name, ''); assert.equal(page.data.patientId, ''); assert.equal(page.data.rowVersion, 0); }
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
