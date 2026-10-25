/** Actual Pinia store and Vue script with controlled GET timing; no HTTP or data writes. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as vue from 'vue';
import * as pinia from 'pinia';

function compile(source, modules) {
  const exports = {};
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(compiled, { exports, Date, Promise, Set, Map, Intl, URLSearchParams,
    window: { setInterval: () => 1, clearInterval() {} },
    require(name) { assert.ok(name in modules, 'Unexpected import ' + name); return modules[name]; },
  });
  return exports;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const catalogSource = readFileSync(new URL('../src/stores/catalog.ts', import.meta.url), 'utf8');
const resourceSource = readFileSync(new URL('../src/views/ResourcesView.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
const scope = compile(readFileSync(new URL('../src/visible-refresh.ts', import.meta.url), 'utf8'), {});
function fixture() {
  const auth = vue.reactive({ user: { id: 'owner-A' }, isHq: true, canManage: true, clinicIds: new Set(['clinic-A', 'clinic-B']) });
  const requests = [];
  const apiModule = { api(path) { const request = { path, ...deferred() }; requests.push(request); return request.promise; },
    errorText: error => error.message, query: values => '?' + new URLSearchParams(values) };
  const modules = { vue, pinia, '../api': apiModule, './auth': { useAuth: () => auth } };
  const useCatalog = compile(catalogSource, modules).useCatalog;
  const instance = pinia.createPinia();
  const store = useCatalog(instance);
  return { store, auth, requests, apiModule, instance };
}
const clinic = id => ({ id, name: id, active: true });
const chair = (id, clinicId) => ({ id, name: id, clinicId, active: true, rowVersion: 1 });
function directories(fixture, offset, label) {
  fixture.requests[offset].resolve([clinic('clinic-A'), clinic('clinic-B')]);
  fixture.requests[offset + 1].resolve([{ id: 'service-' + label, name: label, active: true }]);
  fixture.requests[offset + 2].resolve([{ id: 'doctor-' + label, name: label, active: true }]);
  fixture.requests[offset + 3].resolve([{ id: 'qualification-' + label, name: label, active: true }]);
}

test('actual catalog accepts clinic B and ignores the later clinic A chair response', async () => {
  const f = fixture();
  const a = f.store.loadChairs('clinic-A');
  const b = f.store.loadChairs('clinic-B');
  f.requests[1].resolve([chair('B-chair', 'clinic-B')]);
  assert.equal(await b, true);
  f.requests[0].resolve([chair('A-chair', 'clinic-A')]);
  assert.equal(await a, false);
  assert.equal(f.store.chairsClinicId, 'clinic-B');
  assert.equal(f.store.chairs[0].id, 'B-chair');
  assert.equal(f.store.chairsLoading, false);
});

test('a stale chair error cannot clear the newer clinic result or introduce an error', async () => {
  const f = fixture();
  const a = f.store.loadChairs('clinic-A');
  const b = f.store.loadChairs('clinic-B');
  f.requests[1].resolve([chair('B-chair', 'clinic-B')]); await b;
  f.requests[0].reject(new Error('old A failure'));
  assert.equal(await a, false);
  assert.equal(f.store.chairs[0].id, 'B-chair');
  assert.equal(f.store.chairsError, '');
});

test('failed current chair lookup clears prior chairs and can be retried normally', async () => {
  const f = fixture();
  const a = f.store.loadChairs('clinic-A'); f.requests[0].resolve([chair('A-chair', 'clinic-A')]); await a;
  const b = f.store.loadChairs('clinic-B');
  assert.equal(f.store.chairs.length, 0);
  assert.equal(f.store.chairsClinicId, '');
  f.requests[1].reject(new Error('B temporarily unavailable'));
  await assert.rejects(b, /B temporarily unavailable/);
  assert.equal(f.store.chairs.length, 0); assert.equal(f.store.chairsLoading, false);
  assert.equal(f.store.chairsError, 'B temporarily unavailable');
  const retry = f.store.loadChairs('clinic-B'); f.requests[2].resolve([chair('B-chair', 'clinic-B')]);
  await retry; assert.equal(f.store.chairsError, ''); assert.equal(f.store.chairsClinicId, 'clinic-B');
});

test('directory batches accept only the latest load, even when the earlier batch finishes last', async () => {
  const f = fixture();
  const first = f.store.load();
  const second = f.store.load();
  directories(f, 4, 'latest'); await second;
  directories(f, 0, 'old');
  assert.equal(await first, false);
  assert.equal(f.store.services[0].id, 'service-latest');
  assert.equal(f.store.loaded, true); assert.equal(f.store.loading, false);
});

test('current directory failure removes stale success data and a successful retry restores it', async () => {
  const f = fixture();
  const first = f.store.load(); directories(f, 0, 'first'); await first;
  const failure = f.store.load();
  assert.equal(f.store.loaded, false); assert.equal(f.store.doctors.length, 0);
  f.requests[5].reject(new Error('directory unavailable'));
  await assert.rejects(failure, /directory unavailable/);
  assert.equal(f.store.loaded, false); assert.equal(f.store.loadError, 'directory unavailable');
  const retry = f.store.load(); directories(f, 8, 'retry'); await retry;
  assert.equal(f.store.loaded, true); assert.equal(f.store.loadError, '');
  assert.equal(f.store.services[0].id, 'service-retry');
});

test('account A to B to A invalidates original pending directory and chair responses', async () => {
  const f = fixture();
  const directoryA = f.store.load();
  const chairsA = f.store.loadChairs('clinic-A');
  f.auth.user = { id: 'owner-B' };
  f.auth.user = { id: 'owner-A' };
  directories(f, 0, 'private-A');
  f.requests[4].resolve([chair('private-A-chair', 'clinic-A')]);
  assert.equal(await directoryA, false); assert.equal(await chairsA, false);
  assert.equal(f.store.doctors.length, 0); assert.equal(f.store.chairs.length, 0); assert.equal(f.store.loaded, false);
});

test('reset invalidates in-flight work without changing the public load interface', async () => {
  const f = fixture();
  const pending = f.store.load(); f.store.reset();
  directories(f, 0, 'ignored');
  assert.equal(await pending, false); assert.equal(f.store.loaded, false); assert.equal(f.store.loading, false);
});

function resourceView(f = fixture()) {
  f.store.clinics = [clinic('clinic-A'), clinic('clinic-B')]; f.store.loaded = true;
  const mounted = [], unmounted = [];
  const route = vue.reactive({ params: { kind: 'chairs' } });
  class ApiError extends Error {}
  const source = resourceSource + '\nexport const exposed = { load, ready, allRows, rows, enabledCount, scopeLabel, emptyText, loading, error, clinicId, q, clock, qualificationState, qualificationPeriod, canEdit, canCreate };';
  const modules = {
    vue: { ...vue, onMounted: fn => mounted.push(fn), onUnmounted: fn => unmounted.push(fn) },
    'vue-router': { useRoute: () => route }, 'element-plus': { ElMessage: {} }, '@element-plus/icons-vue': {},
    '../api': { ...f.apiModule, ApiError }, '../stores/auth': { useAuth: () => f.auth }, '../stores/catalog': { useCatalog: () => f.store },
    '../utils': { instant: value => value, money: value => String(value), today: () => '2026-10-25' }, '../visible-refresh': scope,
  };
  return { ...compile(source, modules).exposed, ...f, mounted, unmounted, route };
}

test('actual resource view keeps the current clinic label, rows and counts after reversed chair responses', async () => {
  const page = resourceView();
  page.clinicId.value = 'clinic-A'; const a = page.load(false);
  page.clinicId.value = 'clinic-B'; const b = page.load(false);
  page.requests[1].resolve([chair('B-chair', 'clinic-B')]); await b;
  page.requests[0].resolve([chair('A-chair', 'clinic-A')]); await a;
  assert.equal(page.scopeLabel.value, 'clinic-B'); assert.equal(page.rows.value[0].id, 'B-chair');
  assert.equal(page.ready.value, true); assert.equal(page.loading.value, false);
});

test('actual resource view distinguishes a failed current filter from a successful empty list', async () => {
  const page = resourceView();
  page.clinicId.value = 'clinic-A'; const initial = page.load(false);
  page.requests[0].resolve([chair('A-chair', 'clinic-A')]); await initial;
  page.clinicId.value = 'clinic-B'; const failure = page.load(false);
  assert.equal(page.allRows.value.length, 0); assert.equal(page.ready.value, false);
  page.requests[1].reject(new Error('B lookup failed')); await failure;
  assert.equal(page.ready.value, false); assert.equal(page.error.value, 'B lookup failed');
  assert.equal(page.allRows.value.length, 0); assert.match(page.emptyText.value, /加载失败/);
  const retry = page.load(false); page.requests[2].resolve([]); await retry;
  assert.equal(page.ready.value, true); assert.equal(page.error.value, ''); assert.equal(page.rows.value.length, 0);
  assert.match(page.emptyText.value, /暂无资源/);
});

test('actual resource view shows matching versus total without fetching again for a name filter', async () => {
  const page = resourceView(); page.clinicId.value = 'clinic-A';
  const request = page.load(false);
  page.requests[0].resolve([chair('Alpha', 'clinic-A'), { ...chair('Beta', 'clinic-A'), active: false }]); await request;
  page.q.value = 'beta';
  assert.equal(page.rows.value.length, 1); assert.equal(page.allRows.value.length, 2);
  assert.equal(page.enabledCount.value, 1); assert.equal(page.requests.length, 1);
});

test('qualification display includes the full period and labels future, current and expired grants', () => {
  const page = resourceView(); page.clock.value = Date.parse('2026-10-25T04:00:00Z');
  const future = { validFrom: '2026-11-01T00:00:00Z', validUntil: null };
  const active = { validFrom: '2026-10-01T00:00:00Z', validUntil: '2026-11-01T00:00:00Z' };
  const expired = { validFrom: '2026-01-01T00:00:00Z', validUntil: '2026-10-25T04:00:00Z' };
  assert.equal(page.qualificationState(future).label, '未生效');
  assert.equal(page.qualificationState(active).label, '生效中');
  assert.equal(page.qualificationState(expired).label, '已过期');
  assert.match(page.qualificationPeriod(future), /2026-11-01 08:00:00 至 长期/);
  assert.match(page.qualificationPeriod(active), /2026-10-01 08:00:00 至 2026-11-01 08:00:00/);
});

test('resource permissions remain HQ editable and manager restricted to assigned clinics/chairs', () => {
  const page = resourceView();
  assert.equal(page.canEdit(chair('other', 'unassigned')), true);
  page.auth.isHq = false;
  assert.equal(page.canEdit(chair('assigned', 'clinic-A')), true);
  assert.equal(page.canEdit(chair('other', 'unassigned')), false);
  page.auth.canManage = false;
  assert.equal(page.canCreate.value, false); assert.equal(page.canEdit(chair('assigned', 'clinic-A')), false);
});
