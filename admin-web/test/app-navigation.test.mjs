/** Render the real App.vue SFC with Vue's in-memory renderer and role fixtures. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as vue from 'vue';
import { compileScript, parse } from 'vue/compiler-sfc';

const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8');
const descriptor = parse(appSource, { filename: 'App.vue' }).descriptor;
const compiled = compileScript(descriptor, { id: 'app-navigation-regression', inlineTemplate: true }).content;
const js = ts.transpileModule(compiled, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const icon = vue.defineComponent({ setup: () => () => vue.h('span', { 'aria-hidden': 'true' }) });

const modules = {
  vue,
  './components/SiteIcp.vue': vue.defineComponent({ setup: () => () => null }),
  'vue-router': { useRoute: () => activeRoute, useRouter: () => ({ replace: async () => {}, push: async () => {} }) },
  '@element-plus/icons-vue': { Calendar: icon, User: icon, Clock: icon, OfficeBuilding: icon, FirstAidKit: icon, Setting: icon, SwitchButton: icon, Plus: icon, ArrowRight: icon, Coin: icon },
  'element-plus': { ElMessage: { warning: () => {} } },
  './stores/auth': { useAuth: () => activeAuth },
  './stores/catalog': { useCatalog: () => ({ reset: () => {} }) },
  './stores/booking': { useBooking: () => ({ patient: null }) },
};
let activeRoute;
let activeAuth;
const windowStub = { addEventListener() {}, removeEventListener() {} };
const exports = {};
vm.runInNewContext(js, {
  exports,
  Promise,
  Set,
  window: windowStub,
  require(name) {
    assert.ok(name in modules, `Unexpected App.vue import: ${name}`);
    return modules[name];
  },
});
const component = exports.default;

function hostNode(tag, text = '') { return { tag, text, props: {}, children: [], parent: null }; }
const renderer = vue.createRenderer({
  createElement: tag => hostNode(tag),
  createText: text => hostNode('#text', text),
  createComment: text => hostNode('#comment', text),
  setText(node, text) { node.text = text; },
  setElementText(node, text) { node.children = text ? [hostNode('#text', text)] : []; },
  patchProp(node, key, _previous, next) { node.props[key] = next; },
  insert(node, parent, anchor = null) {
    if (node.parent) {
      const oldIndex = node.parent.children.indexOf(node);
      if (oldIndex >= 0) node.parent.children.splice(oldIndex, 1);
    }
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    if (index >= 0) parent.children.splice(index, 0, node);
    else parent.children.push(node);
    node.parent = parent;
  },
  remove(node) {
    if (!node.parent) return;
    const index = node.parent.children.indexOf(node);
    if (index >= 0) node.parent.children.splice(index, 1);
    node.parent = null;
  },
  parentNode: node => node.parent,
  nextSibling(node) {
    if (!node.parent) return null;
    return node.parent.children[node.parent.children.indexOf(node) + 1] || null;
  },
});

function textContent(node) { return node.tag === '#text' ? node.text : node.children.map(textContent).join(''); }
function snapshot(node) {
  const copy = hostNode(node.tag, node.text);
  copy.props = { ...node.props };
  copy.children = node.children.map(child => { const cloned = snapshot(child); cloned.parent = copy; return cloned; });
  return copy;
}
function descendants(node, predicate) {
  const found = predicate(node) ? [node] : [];
  for (const child of node.children) found.push(...descendants(child, predicate));
  return found;
}
function linkHrefs(root) { return descendants(root, node => node.tag === 'a').map(node => node.props.href); }
function navGroupText(root, id) {
  const heading = descendants(root, node => node.props.id === id)[0];
  assert.ok(heading, `Expected navigation heading ${id}`);
  return textContent(heading.parent);
}

const roles = [
  { name: 'HQ', roles: ['hq'], isHq: true, canManage: true, canBook: true },
  { name: 'manager', roles: ['manager'], isHq: false, canManage: true, canBook: true },
  { name: 'front desk', roles: ['front'], isHq: false, canManage: false, canBook: true },
  { name: 'doctor', roles: ['doctor'], isHq: false, canManage: false, canBook: false },
];

async function renderApp(role, path = '/appointments') {
  activeAuth = {
    user: { id: `fixture-${role.name}`, displayName: '测试员工', roles: role.roles, assignments: [] },
    roleLabel: role.name,
    isHq: role.isHq,
    canManage: role.canManage,
    canBook: role.canBook,
    logout: async () => {},
    invalidate: () => {},
  };
  const title = path === '/appointments' ? '预约总览' : path === '/shifts' ? '医生排班' : '员工账号与档案';
  activeRoute = { path, fullPath: path, meta: { title, public: false } };
  const root = hostNode('root');
  const app = renderer.createApp(component);
  const link = vue.defineComponent({
    inheritAttrs: false,
    props: { to: { type: [String, Object], required: true } },
    setup(props, { attrs, slots }) {
      return () => vue.h('a', { ...attrs, href: typeof props.to === 'string' ? props.to : String(props.to.path || '') }, slots.default?.());
    },
  });
  app.component('router-link', link);
  app.component('router-view', vue.defineComponent({ setup: () => () => null }));
  app.component('el-icon', vue.defineComponent({ setup: (_, { slots }) => () => vue.h('span', { 'aria-hidden': 'true' }, slots.default?.()) }));
  app.component('el-button', vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => vue.h('button', attrs, slots.default?.()) }));
  app.mount(root);
  const result = snapshot(root);
  app.unmount();
  return result;
}

test('App.vue navigation groups expose patient and institution tools only to matching staff roles', async () => {
  for (const role of roles) {
    const root = await renderApp(role);
    const hrefs = linkHrefs(root);
    assert.equal(hrefs.includes('/patients'), role.canBook, `${role.name}: patient archive permission`);
    assert.equal(hrefs.includes('/booking'), role.canBook, `${role.name}: booking permission`);
    for (const path of ['/resources/clinics', '/resources/doctors', '/resources/services', '/resources/chairs', '/resources/qualifications']) {
      assert.equal(hrefs.includes(path), role.canManage, `${role.name}: ${path} permission`);
    }
    assert.equal(hrefs.includes('/staff/accounts'), role.isHq, `${role.name}: staff account permission`);
    assert.ok(hrefs.includes('/appointments'), `${role.name}: appointment route remains available`);
    assert.ok(hrefs.includes('/shifts'), `${role.name}: shift route remains available`);
    assert.ok(hrefs.includes('/compensation'), `${role.name}: compensation route remains available`);
    assert.ok(hrefs.includes('/change-password'), `${role.name}: password route remains available`);
  }
});

test('doctor App.vue headings use personal appointment and shift titles', async () => {
  const doctor = roles.find(role => role.name === 'doctor');
  const appointments = await renderApp(doctor, '/appointments');
  assert.match(textContent(appointments), /我的预约/);
  const shifts = await renderApp(doctor, '/shifts');
  assert.match(textContent(shifts), /我的排班/);
});
