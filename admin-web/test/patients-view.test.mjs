import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function compile(source, exports, modules = {}) {
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports,
    require: name => { assert.ok(name in modules, name); return modules[name]; },
    URLSearchParams,
  });
}

function patientsView({ isHq = true, userId = 'staff-A' } = {}) {
  const requests = [];
  const pushes = [];
  const booking = { patient: null };
  const auth = { isHq, user: { id: userId } };
  const catalog = { loaded: true, loading: false, load: async () => true };
  const visibleExports = {};
  compile(readFileSync(new URL('../src/visible-refresh.ts', import.meta.url), 'utf8'), visibleExports);
  const modules = {
    vue: { ref: value => ({ value }), onMounted: () => {}, onUnmounted: callback => { modules.unmounted = callback; } },
    'vue-router': { useRouter: () => ({ push: value => pushes.push(value) }) },
    '@element-plus/icons-vue': {},
    '../api': {
      api: path => new Promise((resolve, reject) => requests.push({ path, resolve, reject })),
      errorText: error => error.message,
      query: values => '?' + new URLSearchParams(values),
    },
    '../stores/booking': { useBooking: () => booking },
    '../stores/auth': { useAuth: () => auth },
    '../stores/catalog': { useCatalog: () => catalog },
    '../components/PatientEditor.vue': {},
    '../components/PatientInvite.vue': {},
    '../visible-refresh': visibleExports,
  };
  const source = readFileSync(new URL('../src/views/PatientsView.vue', import.meta.url), 'utf8')
    .match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
  const viewExports = {};
  compile(source + '\nexport const exposed = { load, search, rows, total, page, loading, error, q, reserve, created };', viewExports, modules);
  return { ...viewExports.exposed, requests, pushes, booking, auth, modules };
}

test('patient search keeps only the latest response when queries complete out of order', async () => {
  const view = patientsView();
  view.q.value = '张三';
  const first = view.load();
  view.q.value = '李四';
  const second = view.search();
  assert.match(view.requests[0].path, /q=%E5%BC%A0%E4%B8%89/);
  assert.match(view.requests[1].path, /q=%E6%9D%8E%E5%9B%9B/);
  view.requests[1].resolve({ items: [{ id: 'latest', phone: '138****0000' }], total: 1 });
  await second;
  view.requests[0].resolve({ items: [{ id: 'stale', phone: '139****0000' }], total: 1 });
  await first;
  assert.equal(view.rows.value[0].id, 'latest');
  assert.equal(view.total.value, 1);
  assert.equal(view.loading.value, false);
});

test('failed patient search clears previous records and a short query invalidates in-flight results', async () => {
  const view = patientsView({ isHq: false });
  view.q.value = '王医生';
  const first = view.load();
  view.requests[0].resolve({ items: [{ id: 'previous' }], total: 4 });
  await first;
  const failed = view.search();
  assert.deepEqual([...view.rows.value], []);
  assert.equal(view.total.value, 4, 'keep the pagination total stable until the current response settles');
  view.requests[1].reject(new Error('network failure'));
  await failed;
  assert.equal(view.error.value, 'network failure');
  assert.equal(view.total.value, 0, 'drop the total after a confirmed failure');
  const inFlight = view.search();
  view.q.value = '王';
  await view.load();
  view.requests[2].resolve({ items: [{ id: 'stale-after-short-query' }], total: 1 });
  await inFlight;
  assert.deepEqual([...view.rows.value], []);
  assert.equal(view.total.value, 0);
  assert.match(view.error.value, /至少两个字/);
});

test('newly created patient phone is masked before booking state and redirect are set', () => {
  const view = patientsView();
  view.created({ id: 'synthetic-patient', name: '合成患者', phone: '00000000000', birthDate: '1990-01-01', isDemo: true });
  assert.equal(view.booking.patient.phone, '000****0000');
  assert.equal(view.pushes[0].path, '/booking');
  assert.equal(view.pushes[0].query.patientId, 'synthetic-patient');
  assert.equal(view.booking.patient.phone.includes('1234'), false);
});

test('loading another patient page retains the total so pagination does not reset before the response', async () => {
  const view = patientsView();
  view.total.value = 45;
  view.page.value = 2;
  const pending = view.load();
  assert.equal(view.page.value, 2);
  assert.equal(view.total.value, 45);
  assert.match(view.requests[0].path, /page=2/);
  view.requests[0].resolve({ items: [{ id: 'page-two-row' }], total: 45 });
  await pending;
  assert.equal(view.page.value, 2);
  assert.equal(view.rows.value[0].id, 'page-two-row');
});

test('patient list keeps fixed action column and narrow-screen table scrolling', () => {
  const source = readFileSync(new URL('../src/views/PatientsView.vue', import.meta.url), 'utf8');
  assert.match(source, /prop="phone" label="联系电话"/);
  assert.match(source, /fixed="right"/);
  assert.match(source, /@media\s*\(max-width:\s*680px\)/);
  assert.match(source, /class="patients-table-scroll"[^>]*role="region"[^>]*tabindex="0"/);
  assert.match(source, /\.patients-table-scroll\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(source, /:deep\(\.patients-table\)\s*\{[^}]*min-width:\s*600px/s);
});
