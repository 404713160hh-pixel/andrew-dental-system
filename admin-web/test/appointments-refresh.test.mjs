/** Controlled async responses and visibility; these tests do not write business data. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function compile(source, require = () => { throw new Error('Unexpected import'); }) {
  const exports = {};
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, { exports, require, Promise, window: globalThis }, { filename: 'appointments-refresh-test' });
  return exports;
}
const scheduler = compile(readFileSync(new URL('../src/visible-refresh.ts', import.meta.url), 'utf8'));
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function visibility(visible = true) {
  let serial = 0;
  const timers = new Map();
  const listeners = new Set();
  return {
    timers, listeners,
    host: {
      isVisible: () => visible,
      subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
      schedule: (callback, delay) => { const id = ++serial; timers.set(id, { callback, delay }); return id; },
      cancel: id => timers.delete(id),
    },
    change(value) { visible = value; for (const listener of listeners) listener(); },
    tick() { const callbacks = [...timers.values()]; timers.clear(); for (const timer of callbacks) timer.callback(); },
  };
}

test('visible refresh waits for each request, pauses hidden tabs and refreshes immediately on return', async () => {
  const visible = visibility();
  const requests = [];
  const stop = scheduler.startVisibleRefresh(() => { const request = deferred(); requests.push(request); return request.promise; }, visible.host);
  assert.equal([...visible.timers.values()][0].delay, 5000);
  visible.tick();
  assert.equal(requests.length, 1);
  assert.equal(visible.timers.size, 0, 'A slow request must not accumulate timer requests');
  visible.change(false);
  requests[0].resolve(); await flush();
  assert.equal(visible.timers.size, 0);
  visible.change(true);
  assert.equal(requests.length, 2, 'Returning to the tab refreshes without waiting for a timer');
  requests[1].resolve(); await flush();
  assert.equal(visible.timers.size, 1);
  stop();
  assert.equal(visible.timers.size, 0);
  assert.equal(visible.listeners.size, 0);
});

test('visibility recovery queues one refresh while busy, and stopping prevents all later scheduling', async () => {
  const visible = visibility();
  const requests = [];
  const stop = scheduler.startVisibleRefresh(() => { const request = deferred(); requests.push(request); return request.promise; }, visible.host);
  visible.tick();
  visible.change(false); visible.change(true); visible.change(true);
  assert.equal(requests.length, 1);
  requests[0].resolve(); await flush();
  assert.equal(requests.length, 2, 'Only one recovery request is queued');
  stop();
  requests[1].resolve(); await flush();
  visible.change(true); visible.tick();
  assert.equal(requests.length, 2);
  assert.equal(visible.timers.size, 0);
});

test('a failed automatic refresh can recover on its next interval without an unhandled rejection', async () => {
  const visible = visibility();
  let count = 0;
  const stop = scheduler.startVisibleRefresh(async () => { count++; if (count === 1) throw new Error('temporary network loss'); }, visible.host);
  visible.tick(); await flush();
  assert.equal(visible.timers.size, 1);
  visible.tick(); await flush();
  assert.equal(count, 2);
  stop();
});

test('latest-request acceptance rejects old results, changed accounts and disposed views', () => {
  let owner = 'account-A';
  const scope = scheduler.createLatestRequest(() => owner);
  const old = scope.begin();
  const latest = scope.begin();
  assert.equal(old(), false);
  assert.equal(latest(), true);
  owner = 'account-B';
  assert.equal(latest(), false);
  const current = scope.begin();
  scope.stop();
  assert.equal(current(), false);
});

function view() {
  const requests = [];
  const mounted = [];
  const unmounted = [];
  const messages = [];
  const prompts = [];
  const visible = visibility();
  const auth = { user: { id: 'owner-A' }, canBook: true };
  class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
  const api = path => { const request = { ...deferred(), path }; requests.push(request); return request.promise; };
  const modules = {
    vue: {
      ref: value => ({ value }),
      computed: getter => ({ get value() { return getter(); } }),
      watch: () => {},
      onMounted: callback => mounted.push(callback),
      onUnmounted: callback => unmounted.push(callback),
    },
    'vue-router': { useRouter: () => ({ push: () => {} }) },
    '@element-plus/icons-vue': {},
    'element-plus': {
      ElMessage: { error: value => messages.push(value), success: value => messages.push(value), warning: value => messages.push(value) },
      ElMessageBox: { prompt: (...args) => { const prompt = { ...deferred(), args, draft: '' }; prompts.push(prompt); return prompt.promise; } },
    },
    '../api': { api, ApiError, errorText: error => error.message, query: values => '?' + new URLSearchParams(values), readPending: () => null },
    '../stores/auth': { useAuth: () => auth },
    '../stores/catalog': { useCatalog: () => ({ loaded: true }) },
    '../utils': { today: () => '2026-10-24', time: value => value, statusLabels: {} },
    '../visible-refresh': scheduler,
  };
  const source = readFileSync(new URL('../src/views/AppointmentsView.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
  const exports = {};
  const compiled = ts.transpileModule(source + '\nexport const exposed = { load, detail, refreshVisible, cancel, rows, total, loading, selected, drawer, date };', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports,
    require: name => { assert.ok(name in modules, name); return modules[name]; },
    URLSearchParams,
    Promise,
    window: { setTimeout: visible.host.schedule, clearTimeout: visible.host.cancel },
    document: {
      visibilityState: 'visible',
      addEventListener: (_event, callback) => visible.listeners.add(callback),
      removeEventListener: (_event, callback) => visible.listeners.delete(callback),
    },
  });
  return { ...exports.exposed, requests, mounted, unmounted, messages, prompts, auth, visible };
}
const appointment = (id, status = 'confirmed') => ({ id, status, rowVersion: 1, patientName: '合成患者', startsAt: '2026-11-01T01:00:00Z', events: [] });
function listResult(request, id) { request.resolve({ items: [appointment(id)], total: 1 }); }

test('actual appointments view keeps the newest filter result when older requests complete last', async () => {
  const page = view();
  const old = page.load();
  page.date.value = '2026-10-25';
  const latest = page.load();
  listResult(page.requests[1], 'new'); await latest;
  listResult(page.requests[0], 'old'); await old;
  assert.equal(page.rows.value[0].id, 'new');
  assert.equal(page.loading.value, false);
});

test('actual view ignores a previous account response and the older of two detail selections', async () => {
  const page = view();
  const oldList = page.load();
  page.auth.user = { id: 'owner-B' };
  listResult(page.requests[0], 'private-A'); await oldList;
  assert.equal(page.rows.value.length, 0);
  const first = page.detail(appointment('first'));
  const second = page.detail(appointment('second'));
  page.requests[2].resolve(appointment('second')); await second;
  page.requests[1].resolve(appointment('first')); await first;
  assert.equal(page.selected.value.id, 'second');
});

test('automatic refresh updates both the current list and the opened detail from the API', async () => {
  const page = view();
  const open = page.detail(appointment('same'));
  page.requests[0].resolve(appointment('same')); await open;
  const refresh = page.refreshVisible();
  listResult(page.requests[1], 'same');
  page.requests[2].resolve({ ...appointment('same', 'cancelled'), rowVersion: 2 });
  await refresh;
  assert.equal(page.selected.value.status, 'cancelled');
  assert.equal(page.selected.value.rowVersion, 2);
  assert.equal(page.requests[2].path, '/appointments/same');
});

test('opening detail B keeps priority over polling the still-open detail A', async () => {
  const page = view();
  const openA = page.detail(appointment('A'));
  page.requests[0].resolve(appointment('A')); await openA;
  const openB = page.detail(appointment('B'));
  const refreshing = page.refreshVisible();
  assert.equal(page.requests.length, 3, 'Polling may load the list but must not start another A detail request while B is opening');
  assert.equal(page.requests[1].path, '/appointments/B');
  listResult(page.requests[2], 'B'); await refreshing;
  page.requests[1].resolve(appointment('B')); await openB;
  assert.equal(page.selected.value.id, 'B');
  assert.equal(page.drawer.value, true);
  const nextRefresh = page.refreshVisible();
  assert.equal(page.requests[4].path, '/appointments/B', 'Once B opens, background detail updates must follow B');
  listResult(page.requests[3], 'B');
  page.requests[4].resolve({ ...appointment('B'), rowVersion: 2 });
  await nextRefresh;
  assert.equal(page.selected.value.id, 'B');
  assert.equal(page.selected.value.rowVersion, 2);
});

test('a cancellation draft survives automatic refresh, including a response already in flight', async () => {
  const page = view();
  const open = page.detail(appointment('same'));
  page.requests[0].resolve(appointment('same')); await open;
  const refreshing = page.refreshVisible();
  const cancelling = page.cancel(page.selected.value);
  page.prompts[0].draft = '尚未提交的取消原因';
  listResult(page.requests[1], 'same');
  page.requests[2].resolve(appointment('same', 'cancelled'));
  await refreshing;
  assert.equal(page.selected.value.status, 'confirmed', 'A late background detail must not replace the active editing context');
  const count = page.requests.length;
  await page.refreshVisible();
  assert.equal(page.requests.length, count, 'No background request runs while the prompt is open');
  assert.equal(page.prompts[0].draft, '尚未提交的取消原因');
  assert.equal(page.prompts.length, 1);
  page.prompts[0].reject('cancel'); await cancelling;
});

test('unmount removes visibility timers and rejects in-flight list responses', async () => {
  const page = view();
  const mounting = page.mounted[0]();
  listResult(page.requests[0], 'initial'); await mounting;
  assert.equal(page.visible.timers.size, 1);
  const pending = page.load();
  page.unmounted[0]();
  assert.equal(page.visible.timers.size, 0);
  assert.equal(page.visible.listeners.size, 0);
  listResult(page.requests[1], 'after-unmount'); await pending;
  assert.equal(page.rows.value[0].id, 'initial');
});
