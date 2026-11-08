import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/views/CompensationView.vue', import.meta.url), 'utf8');

test('compensation tables expose independent horizontal scroll regions on compact screens', () => {
  assert.equal((source.match(/class="compensation-table-scroll"/g) || []).length, 5);
  assert.match(source, /\.compensation-table-scroll\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(source, /role="region" aria-label="月度账证表格，可横向滚动" tabindex="0"/);
  assert.match(source, /role="region" aria-label="季度核算表格，可横向滚动" tabindex="0"/);
  assert.match(source, /@media\s*\(max-width:\s*760px\)/);
  assert.match(source, /\.compensation-filters :deep\(\.el-form\) \{ display: grid/s);
  assert.match(source, /\.quarter-metrics \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(source, /\.personal-totals \{ grid-template-columns: repeat\(2,minmax\(0,1fr\)\)/s);
});

test('visual layout retains independent review, balance and synthetic-data safeguards', () => {
  assert.match(source, /independentReviewer\(/);
  assert.match(source, /canReview\(row\.source\)/);
  assert.match(source, /10% 激励基金/);
  assert.match(source, /yuanToCents\(paymentAmount\.value\)/);
  assert.match(source, /amountCents > allocation\.remainingCents/);
  assert.match(source, /expectedVersion: allocation\.rowVersion/);
  assert.match(source, /expectedVersion: payment\.rowVersion/);
  assert.match(source, /虚构演示.*仅供课程演示/);
});
