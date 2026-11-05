import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const exports = {};
const source = readFileSync(new URL('../src/compensation-view.ts', import.meta.url), 'utf8');
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, BigInt, Number, String, Error, Date, Intl });
const { yuanToCents, centsToYuan, previousQuarter, quarterMonths, independentReviewer } = exports;

test('yuan entry preserves exact cents including negative adjustments and rejects ambiguous precision', () => {
  assert.equal(yuanToCents('19.99'), 1999);
  assert.equal(yuanToCents('-0.01'), -1);
  assert.equal(yuanToCents(' 120 '), 12000);
  assert.equal(centsToYuan(-1999), '-19.99');
  assert.equal(centsToYuan(0), '0.00');
  for (const input of ['', '1.001', 'NaN', '1e4', '1,000', '9007199254740992']) assert.throws(() => yuanToCents(input));
});

test('quarter defaults use China timezone and roll back to the prior completed quarter', () => {
  assert.equal(previousQuarter(new Date('2026-12-31T16:00:00Z')), '2026-Q4');
  assert.equal(previousQuarter(new Date('2026-09-30T15:59:00Z')), '2026-Q2');
  assert.equal(previousQuarter(new Date('2026-09-30T16:00:00Z')), '2026-Q3');
  assert.deepEqual(Array.from(quarterMonths('2026-Q3')), ['2026-07', '2026-08', '2026-09']);
  assert.deepEqual(Array.from(quarterMonths('2026-Q5')), []);
});

test('review actions require a different account and a different linked employee identity', () => {
  assert.equal(independentReviewer({ id: 'reviewer', staffId: 'person-b' }, 'author', 'person-a'), true);
  assert.equal(independentReviewer({ id: 'reviewer', staffId: 'person-a' }, 'author', 'person-a'), false);
  assert.equal(independentReviewer({ id: 'author', staffId: 'person-b' }, 'author', 'person-a'), false);
  assert.equal(independentReviewer({ id: 'reviewer', staffId: null }, 'author', 'person-a'), false);
});
