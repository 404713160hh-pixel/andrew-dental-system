import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
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
test('native build includes all configured pages, assets and callable WXML handlers', () => {
  const app = JSON.parse(readFileSync(join(root, 'dist/app.json'), 'utf8'));
  assert.deepEqual([...app.pages].sort(), ['home', 'login', 'booking', 'confirm', 'appointments', 'detail', 'profile', 'doctors', 'doctor-detail', 'prices'].map(name => 'pages/' + name + '/index').sort());
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
  await page.save(); const update = r.requests.find(item => item.method === 'PUT'); assert.ok(update);
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
    else if (url.pathname.endsWith('/booking-policy')) data = { timezone: 'Asia/Shanghai' };
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
