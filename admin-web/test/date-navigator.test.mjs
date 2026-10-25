/** Actual component script with measured horizontal geometry; no browser or business writes. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function component() {
  const source = readFileSync(new URL('../src/components/DateNavigator.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
  const exports = {};
  const mounted = [];
  const changed = [];
  const props = { date: '2026-10-25', today: '2026-10-25' };
  const scrolls = [];
  let item = { left: 396, right: 450, width: 54 };
  let selected = true;
  let resolveTick;
  const container = {
    clientWidth: 358, scrollWidth: 446, scrollLeft: 0,
    getBoundingClientRect: () => ({ left: 16, right: 374 }),
    querySelector: selector => { assert.equal(selector, '[aria-pressed="true"]'); return selected ? { getBoundingClientRect: () => item } : null; },
    scrollTo: options => { scrolls.push(options); container.scrollLeft = options.left; },
  };
  const modules = {
    vue: { computed: getter => ({ get value() { return getter(); } }), ref: value => ({ value }),
      nextTick: () => new Promise(resolve => { resolveTick = resolve; }),
      onMounted: callback => mounted.push(callback), watch: (_getter, callback) => changed.push(callback) },
    '../schedule-view': {},
  };
  vm.runInNewContext(ts.transpileModule(source + '\nexport const exposed = { strip, revealSelectedDay };', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, defineProps: () => props, defineEmits: () => () => {},
    require: name => { assert.ok(name in modules, name); return modules[name]; },
  });
  exports.exposed.strip.value = container;
  return { ...exports.exposed, mounted, changed, scrolls, container, props,
    tick: () => resolveTick(), setItem: value => { item = value; }, noSelection: () => { selected = false; } };
}

test('on a 390px page the selected Sunday is revealed by scrolling only its date strip after nextTick', async () => {
  const view = component();
  const mounting = view.mounted[0]();
  assert.equal(view.scrolls.length, 0, 'Wait for the rendered selected button before measuring');
  view.tick(); await mounting;
  assert.equal(view.scrolls.length, 1);
  assert.equal(view.scrolls[0].left, 88, 'Clamp the right edge to the strip scroll range');
  assert.equal(view.scrolls[0].behavior, 'auto');
});

test('changing to an offscreen earlier day scrolls the container back without moving the page', async () => {
  const view = component();
  view.container.scrollLeft = 88;
  view.props.date = '2026-10-19';
  view.setItem({ left: -56, right: -2, width: 54 });
  const changing = view.changed[0](); view.tick(); await changing;
  assert.equal(view.scrolls[0].left, 0);
});

test('an already visible selection preserves manual horizontal position; an empty date or unmount does nothing', async () => {
  const view = component();
  view.container.scrollLeft = 40;
  view.setItem({ left: 180, right: 234, width: 54 });
  let change = view.revealSelectedDay(); view.tick(); await change;
  assert.equal(view.scrolls.length, 0);
  assert.equal(view.container.scrollLeft, 40);
  view.noSelection();
  change = view.revealSelectedDay(); view.tick(); await change;
  assert.equal(view.scrolls.length, 0);
  view.strip.value = null;
  change = view.revealSelectedDay(); view.tick(); await change;
  assert.equal(view.scrolls.length, 0);
});
