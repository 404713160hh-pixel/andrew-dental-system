import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/views/ResourcesView.vue', import.meta.url), 'utf8');

test('five resource kinds share a named horizontal table region and responsive filters', () => {
  for (const kind of ['clinics', 'doctors', 'services', 'chairs', 'qualifications']) {
    assert.match(source, new RegExp(`resources-table--${kind}`));
  }
  assert.match(source, /role="region"[^>]*:aria-label="`\$\{names\[kind\]\}表格，可横向滚动`"[^>]*tabindex="0"/);
  assert.match(source, /\.resources-table-scroll\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(source, /@media\s*\(max-width:\s*760px\)/);
  assert.match(source, /\.resource-filters\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(source, /\.qualification-row\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/s);
});

test('resource view retains permission, conflict, integer-money and qualification safeguards', () => {
  assert.match(source, /function canEdit\(row: Resource\)/);
  assert.match(source, /const canCreate = computed\(/);
  assert.match(source, /if \(auth\.isHq\) return true/);
  assert.match(source, /if \(!auth\.canManage\) return false/);
  assert.match(source, /Number\.isInteger\(form\.priceCents\)/);
  assert.match(source, /expectedVersion = editing\.value\.rowVersion/);
  assert.match(source, /e\.status === 409/);
  assert.match(source, /失效日期不能早于生效日期/);
  assert.match(source, /家庭住址和联系邮箱仅供总部管理/);
  assert.match(source, /prop="phone"/);
  assert.match(source, /内部资质档案与有效期/);
});
