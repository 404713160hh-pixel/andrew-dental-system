import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function scrollFixture({ reduced = false } = {}) {
  let options;
  let mounted = false;
  const target = { id: 'about' };
  const modules = {
    vue: { nextTick: async () => { mounted = true; } },
    'vue-router': { createWebHistory: () => ({}), createRouter: value => { options = value; return { beforeEach() {} }; } },
    './stores/auth': { useAuth: () => ({}) },
  };
  const output = ts.transpileModule(readFileSync(new URL('../src/router.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(output, {
    exports: {},
    require: name => modules[name],
    document: { getElementById: id => mounted && id === 'about' ? target : null },
    window: { matchMedia: () => ({ matches: reduced }) },
  });
  return { scroll: options.scrollBehavior, target, mounted: () => mounted };
}
test('public hash navigation waits for the new route target and scrolls below the sticky bar', async () => {
  const fixture = scrollFixture();
  const result = await fixture.scroll({ path: '/', hash: '#about' }, { path: '/explore/doctors' });
  assert.equal(fixture.mounted(), true);
  assert.equal(result.el, fixture.target);
  assert.equal(result.top, 100);
  assert.equal(result.behavior, 'smooth');
});
test('reduced motion uses immediate anchor navigation', async () => {
  const fixture = scrollFixture({ reduced: true });
  const result = await fixture.scroll({ path: '/', hash: '#about' }, { path: '/' });
  assert.equal(result.behavior, 'auto');
});
test('history scroll positions remain exact and same-page state changes do not reset scrolling', async () => {
  const fixture = scrollFixture();
  const saved = { left: 0, top: 437 };
  assert.equal(await fixture.scroll({ path: '/', hash: '#about' }, { path: '/' }, saved), saved);
  assert.equal(fixture.mounted(), false);
  assert.equal(await fixture.scroll({ path: '/', hash: '' }, { path: '/' }), false);
});
