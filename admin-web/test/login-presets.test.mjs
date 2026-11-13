import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as vue from 'vue';

const source = readFileSync(new URL('../src/views/LoginView.vue', import.meta.url), 'utf8');
const script = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'LoginView script is present');

function fixture({ config = null, next = undefined, loginError = null, dev = true } = {}) {
  const requests = [], navigation = [], exports = {};
  const auth = {
    config,
    loadConfig: async () => {},
    login: async (...args) => {
      requests.push(args);
      if (loginError) throw loginError;
    },
  };
  const compiled = ts.transpileModule(
    script.replaceAll('import.meta.env.DEV', String(dev)) + '\nexport {staffDemoAccounts,demoUsername,username,password,busy,error,login};',
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const modules = {
    vue: { ...vue, onMounted: () => {} },
    'vue-router': {
      useRoute: () => ({ query: { next } }),
      useRouter: () => ({ replace: async (path) => navigation.push(path) }),
    },
    '../components/CourseDemoLogin.vue': {},
    '../components/SiteIcp.vue': {},
    '@element-plus/icons-vue': {},
    '../stores/auth': { useAuth: () => auth },
    '../api': { errorText: (error) => error.message },
  };
  vm.runInNewContext(compiled, {
    exports,
    require(name) { assert.ok(name in modules, name); return modules[name]; },
  });
  return { page: exports, requests, navigation };
}

test('login view contains no fixed demo usernames or disclosed password', () => {
  assert.doesNotMatch(source, /admin123|manager\.a|front\.a|doctor\.a|\bhq\b/);
  assert.doesNotMatch(source, /roleAccounts|role-presets|演示密码/);
  assert.match(source, /router-link class="login-back-link" to="\/"/);
  assert.match(source, /autocomplete="username"/);
  assert.match(source, /autocomplete="current-password"/);
  assert.match(source, /@submit\.prevent="login\(\)"/);
  assert.match(source, /:loading="busy"/);
});

test('failed password login keeps its error visible and releases the loading state', async () => {
  const { page, requests } = fixture({ loginError: new Error('账号或密码错误') });
  page.username.value = 'staff.entered.by.user';
  page.password.value = 'incorrect-password';
  await page.login();
  assert.deepEqual(requests, [['staff.entered.by.user', 'incorrect-password', false]]);
  assert.equal(page.error.value, '账号或密码错误');
  assert.equal(page.busy.value, false);
});

test('demo login is unavailable when the server disables it', async () => {
  const { page, requests } = fixture({ config: { demoLoginEnabled: false, demoAccounts: [], wechatLoginEnabled: false } });
  assert.equal(page.staffDemoAccounts.value.length, 0);
  page.demoUsername.value = 'server-account';
  await page.login(true);
  assert.equal(requests.length, 0);
  assert.match(page.error.value, /未提供可用的开发演示账号/);
});

test('demo login stays hidden in production builds even if the server flag is accidentally enabled', async () => {
  const { page, requests } = fixture({
    dev: false,
    config: {
      demoLoginEnabled: true,
      demoAccounts: [{ username: 'staff.from.server', displayName: '演示员工', portal: 'staff' }],
      wechatLoginEnabled: false,
    },
  });
  assert.equal(page.staffDemoAccounts.value.length, 0);
  page.demoUsername.value = 'staff.from.server';
  await page.login(true);
  assert.equal(requests.length, 0);
  assert.match(page.error.value, /未提供可用的开发演示账号/);
  assert.match(source, /isDevelopmentBuild && auth\.config\?\.demoLoginEnabled && staffDemoAccounts\.length/);
});

test('demo options are limited to dynamically supplied staff accounts', async () => {
  const config = {
    demoLoginEnabled: true,
    demoAccounts: [
      { username: 'patient.from.server', displayName: '演示顾客', portal: 'patient' },
      { username: 'staff.from.server', displayName: '演示员工', portal: 'staff' },
    ],
    wechatLoginEnabled: false,
  };
  const { page, requests, navigation } = fixture({ config, next: '/appointments?view=week' });
  assert.deepEqual(Array.from(page.staffDemoAccounts.value, (account) => account.username), ['staff.from.server']);
  assert.match(source, /v-for="account in staffDemoAccounts"/);
  assert.match(source, /auth\.config\?\.demoLoginEnabled && staffDemoAccounts\.length/);
  page.demoUsername.value = 'staff.from.server';
  await page.login(true);
  assert.deepEqual(requests, [['staff.from.server', '', true]]);
  assert.deepEqual(navigation, ['/appointments?view=week']);
});

test('ordinary password login validates required fields and preserves only local next paths', async () => {
  const { page, requests, navigation } = fixture({ next: '//outside.example' });
  await page.login();
  assert.equal(requests.length, 0);
  assert.match(page.error.value, /请输入用户名和密码/);

  page.username.value = 'employee.entered.by.user';
  page.password.value = 'user-entered-secret';
  await page.login();
  assert.deepEqual(requests, [['employee.entered.by.user', 'user-entered-secret', false]]);
  assert.deepEqual(navigation, ['/appointments']);
});
