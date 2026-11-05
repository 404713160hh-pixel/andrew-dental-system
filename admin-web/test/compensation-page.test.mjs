import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as vue from 'vue';

function compile(source, modules, expose = '') {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source + '\n' + expose, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Intl, Date, BigInt, Number, String, Set, Promise, Error, require(name) { assert.ok(name in modules, 'Unexpected import ' + name); return modules[name]; } });
  return exports;
}
const helpers = compile(readFileSync(new URL('../src/compensation-view.ts', import.meta.url), 'utf8'), {});
function fixture(roles = ['hq']) {
  const calls = [], messages = [], auth = { user: { id: 'author', staffId: 'staff-author', roles }, isHq: roles.includes('hq') };
  const context = { actor: { userId: 'author', staffId: 'staff-author', name: '制表人', employeeNo: 'HQ1' }, clinics: [{ id: 'clinic-a', name: '门诊A' }], doctors: [{ id: 'doctor-a', name: '医生A', employeeNo: 'D1' }] };
  const modules = {
    vue: { ...vue, onMounted() {}, onUnmounted() {} },
    'element-plus': { ElMessage: { success: text => messages.push(text), error: text => messages.push(text) }, ElMessageBox: { confirm: async () => true, prompt: async () => ({ value: '更正来源' }) } },
    '@element-plus/icons-vue': { Plus: {}, Refresh: {} },
    '../stores/auth': { useAuth: () => auth },
    '../utils': { money: cents => '¥' + (cents / 100).toFixed(2) },
    '../compensation-view': helpers,
    '../api': {
      errorText: error => error.message,
      query: input => '?' + Object.entries(input).filter(([, value]) => value).map(([key, value]) => key + '=' + value).join('&'),
      api: async (path, options = {}) => {
        calls.push({ path, options: JSON.parse(JSON.stringify(options)) });
        if (path === '/compensation/context') return context;
        if (path === '/compensation/me') return { staffId: 'staff-author', notice: null, allocations: [] };
        if (options.method) return { id: 'created-quarter' };
        return [];
      },
    },
  };
  const source = readFileSync(new URL('../src/views/CompensationView.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
  const page = compile(source, modules, 'export { load,context,monthForm,monthBody,openMonth,saveMonth,formError,monthReadOnly,paymentAllocation,paymentAmount,paymentReference,savePayment,resolving,resultStatus,resultReference,resolvePayment,canReview,detail,quarterAction };');
  page.context.value = context;
  return { page, calls, messages, auth, context };
}
const sourceRow = () => ({ doctorId: 'doctor-a', revenue: '120.09', material: '20.02', expense: '-1.00', revenueReference: 'REV1', materialReference: 'MAT1', expenseReference: 'EXP1' });

test('ordinary staff query only their own approved compensation, without requesting financial management data', async () => {
  const f = fixture(['front']); await f.page.load();
  assert.deepEqual(f.calls.map(item => item.path), ['/compensation/me']);
});

test('month draft validates every financial source and converts decimal entries to exact signed cents', () => {
  const f = fixture();
  Object.assign(f.page.monthForm, { clinicId: 'clinic-a', month: '2026-07', reference: 'MONTH1', noActivity: false, rows: [sourceRow()] });
  let body = f.page.monthBody();
  assert.equal(body.rows[0].revenueCents, 12009); assert.equal(body.rows[0].materialCostCents, 2002); assert.equal(body.rows[0].operatingExpenseCents, -100);
  f.page.monthForm.rows.push(sourceRow()); assert.throws(() => f.page.monthBody(), /重复/);
  f.page.monthForm.rows.pop(); f.page.monthForm.rows[0].revenueReference = ''; assert.throws(() => f.page.monthBody(), /来源编号/);
  f.page.monthForm.noActivity = true; body = f.page.monthBody(); assert.equal(body.rows.length, 0);
  f.page.monthForm.reference = ''; assert.throws(() => f.page.monthBody(), /底稿依据/);
});

test('only the draft author edits a month, and saving carries its optimistic version', async () => {
  const f = fixture();
  const month = { id: 'month-1', clinicId: 'clinic-a', month: '2026-07', reference: 'MONTH1', noActivity: false, rowVersion: 7, status: 'draft', createdBy: 'author', rows: [{ doctorId: 'doctor-a', revenueCents: 10000, materialCostCents: 2000, operatingExpenseCents: 3000, revenueReference: 'REV1', materialReference: 'MAT1', expenseReference: 'EXP1' }] };
  f.page.openMonth({ ...month, createdBy: 'other' }); assert.equal(f.page.monthReadOnly.value, true);
  f.page.openMonth(month); assert.equal(f.page.monthReadOnly.value, false); await f.page.saveMonth();
  const save = f.calls.find(item => item.options.method === 'PUT');
  assert.equal(save.path, '/compensation/months/month-1'); assert.equal(save.options.body.expectedVersion, 7);
  assert.equal(save.options.body.rows[0].revenueCents, 10000);
});

test('review controls use the server-linked employee identity and do not treat another account of the author as independent', () => {
  const f = fixture();
  const item = { createdBy: 'other-account', createdStaffId: 'staff-author' };
  assert.equal(f.page.canReview(item), false);
  item.createdStaffId = 'someone-else'; assert.equal(f.page.canReview(item), true);
  f.page.context.value.actor = null; assert.equal(f.page.canReview(item), false);
});

test('payment registration respects available balance, carries allocation version and remains pending until a separate result is entered', async () => {
  const f = fixture();
  f.page.paymentAllocation.value = { id: 'allocation-1', remainingCents: 10009, rowVersion: 4 };
  f.page.paymentAmount.value = '100.10'; f.page.paymentReference.value = 'BANK1'; await f.page.savePayment();
  assert.equal(f.calls.length, 0); assert.match(f.page.formError.value, /余额/);
  f.page.paymentAmount.value = '100.09'; await f.page.savePayment();
  const payment = f.calls.find(item => item.options.method === 'POST');
  assert.equal(payment.path, '/compensation/allocations/allocation-1/payments'); assert.equal(payment.options.body.amountCents, 10009);
  assert.equal(payment.options.body.expectedVersion, 4);
  assert.equal(f.calls.some(item => item.path.includes('/resolve')), false);
  assert.match(f.messages[0], /待确认/);
});

test('resolving a payment requires an explicit result and evidence, preserving the original payment version', async () => {
  const f = fixture();
  f.page.resolving.value = { id: 'payment-1', rowVersion: 6 };
  await f.page.resolvePayment(); assert.equal(f.calls.length, 0);
  f.page.resultStatus.value = 'failed'; f.page.resultReference.value = 'BANK-FAIL-1'; await f.page.resolvePayment();
  const result = f.calls.find(item => item.options.method === 'POST');
  assert.equal(result.path, '/compensation/payments/payment-1/resolve');
  assert.equal(result.options.body.status, 'failed'); assert.equal(result.options.body.expectedVersion, 6); assert.equal(result.options.body.reference, 'BANK-FAIL-1');
});

function staffFixture() {
  const calls = [], messages = [], navigation = [], auth = { user: { id: 'author', staffId: null, roles: ['hq'] } };
  const allProfiles = [
    { id: 'staff-hq', employeeNo: 'HQ1', name: '总部员工', phone: '020-12345678', isDentist: false, active: true, rowVersion: 5, birthDate: null, homeAddress: null, email: null, userId: 'author', username: 'hq', specialty: '' },
    { id: 'staff-doctor', employeeNo: 'D1', name: '医生', phone: '020-12345679', isDentist: true, active: true, rowVersion: 1, birthDate: null, homeAddress: null, email: null, userId: null, username: null, specialty: '' },
  ];
  const modules = {
    vue: { ...vue, onMounted() {} }, 'vue-router': { useRouter: () => ({ push: path => navigation.push(path) }) },
    'element-plus': { ElMessage: { success: value => messages.push(value), error: value => messages.push(value) }, ElMessageBox: { confirm: async () => true } },
    '../stores/auth': { useAuth: () => auth },
    '../utils': { calendarDate: value => value.slice(0, 10), today: () => '2026-11-05' },
    '../api': { query: () => '', errorText: error => error.message, api: async (path, options = {}) => {
      calls.push({ path, options: JSON.parse(JSON.stringify(options)) });
      if (options.method) return {};
      if (path === '/me') return { id: 'author', staffId: 'staff-hq', roles: ['hq'] };
      if (path === '/staff/profiles') return allProfiles;
      if (path.startsWith('/staff/accounts')) return { items: [{ id: 'author', username: 'hq', displayName: '总部员工', active: true, staffId: 'staff-hq', assignments: [{ role: 'hq', clinicId: null }] }], total: 1, page: 1, pageSize: 100 };
      if (path.startsWith('/clinics')) return [{ id: 'clinic-a', name: '门诊A', active: true }];
      throw new Error('Unexpected path ' + path);
    } },
  };
  const source = readFileSync(new URL('../src/views/StaffAccountsView.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
  const page = compile(source, modules, 'export { loadResources,profiles,form,save,openProfile,profileForm,profileEditing,saveProfile };');
  return { page, calls, messages, navigation, auth, allProfiles };
}

test('staff account linking includes non-doctor profiles and refuses a non-doctor identity for a doctor role', async () => {
  const f = staffFixture(); await f.page.loadResources();
  assert.equal(f.page.profiles.value.some(item => !item.isDentist), true);
  assert.equal(f.calls.some(item => item.path.startsWith('/doctors')), false);
  f.calls.length = 0;
  Object.assign(f.page.form.value, { displayName: '测试员工', assignments: [{ role: 'doctor', clinicId: 'clinic-a' }], staffId: 'staff-hq' });
  await f.page.save(); assert.equal(f.calls.length, 0); assert.match(f.messages[0], /医生档案/);
});

test('non-doctor profile editing sends private fields and version, then refreshes the current employee identity', async () => {
  const f = staffFixture(); f.page.openProfile(f.allProfiles[0]);
  Object.assign(f.page.profileForm, { birthDate: '1990-01-01', homeAddress: ' 员工家庭地址 ', email: 'staff@example.test' });
  await f.page.saveProfile();
  const write = f.calls.find(item => item.options.method === 'PUT');
  assert.equal(write.path, '/staff/profiles/staff-hq'); assert.equal(write.options.body.expectedVersion, 5);
  assert.equal(write.options.body.birthDate, '1990-01-01'); assert.equal(write.options.body.homeAddress, '员工家庭地址');
  assert.equal(write.options.body.email, 'staff@example.test'); assert.equal(f.auth.user.staffId, 'staff-hq');
});

test('unknown employee private fields remain null, and doctor profiles are routed to the doctor resource editor', async () => {
  const f = staffFixture(); f.page.openProfile(f.allProfiles[1]); assert.deepEqual(f.navigation, ['/resources/doctors']);
  f.page.openProfile(f.allProfiles[0]); Object.assign(f.page.profileForm, { birthDate: '', homeAddress: ' ', email: '' });
  await f.page.saveProfile();
  const body = f.calls.find(item => item.options.method === 'PUT').options.body;
  assert.equal(body.birthDate, null); assert.equal(body.homeAddress, null); assert.equal(body.email, null);
});
