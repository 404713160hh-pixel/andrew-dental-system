import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/schedule-view.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports });
const { moveCalendarDate, calendarWeek, groupByDoctor, isDoctorOnly, collectAppointmentPages } = exports;
const row = index => ({ id: 'id-' + index, rowVersion: 1 });
const page = (number, total, items) => ({ page: number, pageSize: 100, total, items });

test('date-only navigation crosses leap days, months and years without timezone drift', () => {
  assert.equal(moveCalendarDate('2028-03-01', -1), '2028-02-29');
  assert.equal(moveCalendarDate('2026-12-31', 1), '2027-01-01');
  assert.equal(moveCalendarDate('2026-01-01', -1), '2025-12-31');
  assert.throws(() => moveCalendarDate('2026-02-30', 1));
  const week = calendarWeek('2026-11-01', '2026-10-31');
  assert.equal(week.length, 7);
  assert.equal(week[0].date, '2026-10-26');
  assert.equal(week[6].date, '2026-11-01');
  assert.equal(week[6].selected, true);
  assert.equal(week[5].today, true);
  assert.ok(calendarWeek('', '2026-10-31').every(day => !day.selected));
});

test('doctor grouping uses identity rather than display name and preserves source items', () => {
  const rows = [
    { id: 'b2', doctorId: 'B', doctorName: '同名医生', startsAt: '2026-10-25T03:00:00Z', status: 'cancelled' },
    { id: 'a1', doctorId: 'A', doctorName: '同名医生', startsAt: '2026-10-25T01:00:00Z', status: 'confirmed' },
    { id: 'b1', doctorId: 'B', doctorName: '同名医生', startsAt: '2026-10-25T01:00:00Z', status: 'rescheduled' },
  ];
  const groups = groupByDoctor(rows);
  assert.equal(groups.length, 2);
  const b = groups.find(group => group.doctorId === 'B');
  assert.equal(b.items.map(item => item.id).join(','), 'b1,b2');
  assert.equal(b.items[0].status, 'rescheduled');
  assert.equal(rows[0].id, 'b2', 'Rendering must not reorder the source list');
  assert.equal(isDoctorOnly(['doctor']), true);
  for (const role of ['front', 'manager', 'hq']) assert.equal(isDoctorOnly(['doctor', role]), false);
  assert.equal(isDoctorOnly(['front']), false);
});

test('full-day collection reads every page and rechecks the head before declaring complete', async () => {
  const rows = Array.from({ length: 205 }, (_, index) => row(index));
  const calls = [];
  const result = await collectAppointmentPages(async (number, size) => {
    calls.push([number, size]);
    return page(number, rows.length, rows.slice((number - 1) * size, number * size));
  });
  assert.equal(JSON.stringify(calls), '[[1,100],[2,100],[3,100],[1,100]]');
  assert.equal(result.items.length, 205);
  assert.equal(result.complete, true);
});

test('changing totals, duplicate rows and a changed head version produce an explicit incomplete result', async () => {
  const first = Array.from({ length: 100 }, (_, index) => row(index));
  const changedTotal = await collectAppointmentPages(async number => number === 1 ? page(1, 101, first) : page(2, 102, [row(100), row(101)]));
  assert.equal(changedTotal.complete, false);
  assert.equal(changedTotal.reason, 'changed');
  const duplicate = await collectAppointmentPages(async number => page(number, 101, number === 1 ? first : [row(0)]));
  assert.equal(duplicate.complete, false);
  assert.equal(duplicate.items.length, 100);
  let calls = 0;
  const changedVersion = await collectAppointmentPages(async number => {
    calls++;
    return page(number, 101, number === 2 ? [row(100)] : calls === 1 ? first : [{ ...row(0), rowVersion: 2 }, ...first.slice(1)]);
  });
  assert.equal(changedVersion.complete, false);
  assert.equal(changedVersion.reason, 'changed');
});

test('invalid metadata and a display query limit never masquerade as the entire day', async () => {
  const invalid = await collectAppointmentPages(async () => ({ page: 2, pageSize: 20, total: 1, items: [row(0)] }));
  assert.equal(invalid.reason, 'invalid');
  const limited = await collectAppointmentPages(async number => page(number, 101, Array.from({ length: 100 }, (_, index) => row(index))), () => true, 1);
  assert.equal(limited.items.length, 100);
  assert.equal(limited.complete, false);
  assert.equal(limited.reason, 'limit');
});

test('superseded full-day reads stop without requesting another page', async () => {
  let current = true;
  let calls = 0;
  const result = await collectAppointmentPages(async number => {
    calls++; current = false;
    return page(number, 101, Array.from({ length: 100 }, (_, index) => row(index)));
  }, () => current);
  assert.equal(calls, 1);
  assert.equal(result.reason, 'superseded');
});

function shiftView() {
  const requests = [];
  const unmounted = [];
  const auth = { user: { id: 'owner-A', roles: ['doctor'] }, isHq: false, canManage: false, clinicIds: new Set(['clinic-A']) };
  const schedulerExports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/visible-refresh.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: schedulerExports });
  const modules = {
    vue: { ref: value => ({ value }), reactive: value => value, computed: getter => ({ get value() { return getter(); } }),
      watch: () => {}, onMounted: () => {}, onUnmounted: callback => unmounted.push(callback) },
    'element-plus': { ElMessage: {}, ElMessageBox: {} },
    '@element-plus/icons-vue': {},
    '../api': { api: path => new Promise((resolve, reject) => requests.push({ path, resolve, reject })), query: values => '?' + new URLSearchParams(values), errorText: error => error.message },
    '../stores/auth': { useAuth: () => auth },
    '../stores/catalog': { useCatalog: () => ({ clinics: [], services: [], loaded: true }) },
    '../utils': { today: () => '2026-10-25' },
    '../visible-refresh': schedulerExports,
    '../schedule-view': exports,
  };
  const source = readFileSync(new URL('../src/views/ShiftsView.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
  const viewExports = {};
  vm.runInNewContext(ts.transpileModule(source + '\nexport const exposed = { load, search, selectDate, rows, date, error, loading, doctorOnly, canCancel };', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: viewExports, require: name => { assert.ok(name in modules, name); return modules[name]; }, URLSearchParams });
  return { ...viewExports.exposed, auth, requests, unmounted };
}

test('the actual shifts view keeps the newer date response and ignores the old error', async () => {
  const view = shiftView();
  const old = view.load();
  const latest = view.selectDate('2026-10-26');
  assert.ok(view.requests[1].path.includes('date=2026-10-26'));
  view.requests[1].resolve([{ id: 'new-shift' }]); await latest;
  view.requests[0].reject(new Error('late old request failure')); await old;
  assert.equal(view.rows.value[0].id, 'new-shift');
  assert.equal(view.error.value, '');
  assert.equal(view.loading.value, false);
});

test('a failed shifts query clears stale records and a later refresh recovers', async () => {
  const view = shiftView();
  const first = view.load(); view.requests[0].resolve([{ id: 'old' }]); await first;
  const failed = view.selectDate('2026-10-26');
  assert.equal(view.rows.value.length, 0);
  view.requests[1].reject(new Error('network failure')); await failed;
  assert.equal(view.rows.value.length, 0);
  assert.equal(view.error.value, 'network failure');
  const retry = view.load(); view.requests[2].resolve([{ id: 'recovered' }]); await retry;
  assert.equal(view.rows.value[0].id, 'recovered');
  assert.equal(view.error.value, '');
});

test('the shifts view enforces read-only doctor actions and ignores responses after account change or unmount', async () => {
  const view = shiftView();
  assert.equal(view.doctorOnly.value, true);
  assert.equal(view.canCancel({ clinicId: 'clinic-A' }), false);
  const oldOwner = view.load();
  view.auth.user = { id: 'owner-B', roles: ['doctor', 'manager'] };
  view.auth.canManage = true;
  view.requests[0].resolve([{ id: 'private-A' }]); await oldOwner;
  assert.equal(view.rows.value.length, 0);
  assert.equal(view.doctorOnly.value, false);
  assert.equal(view.canCancel({ clinicId: 'clinic-A' }), true);
  assert.equal(view.canCancel({ clinicId: 'clinic-B' }), false);
  const disposing = view.load(); view.unmounted[0]();
  view.requests[1].resolve([{ id: 'after-disposal' }]); await disposing;
  assert.equal(view.rows.value.length, 0);
});
