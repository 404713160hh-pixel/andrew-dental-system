import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/views/BookingView.vue', import.meta.url), 'utf8');

test('booking layout keeps patient verification, resource search and confirmation controls intact', () => {
  assert.match(source, /patientId\.value \|\| !clinicId\.value \|\| !serviceId\.value \|\| !date\.value/);
  assert.match(source, /patientConfirmed:\s*true/);
  assert.match(source, /rulesAccepted:\s*true/);
  assert.match(source, /holdVersion:\s*hold\.value\.rowVersion/);
  assert.match(source, /expectedVersion:\s*original\.value\.rowVersion/);
  assert.match(source, /!pending\.value/);
  assert.match(source, /readPending\(\)/);
  assert.match(source, /resolvePending\(pending\.value\)/);
  assert.match(source, /secondsLeft\.value > 0/);
  assert.match(source, /v-if="patientId"/);
  assert.match(source, /placeholder="输入姓名或联系电话"/);
  assert.match(source, /class="confirmation-checks"/);
  assert.match(source, /:disabled="!canConfirm"/);
});

test('booking visual treatment adapts search, slot choices and confirmation to narrow screens', () => {
  assert.match(source, /\.booking-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(300px, 350px\)/s);
  assert.match(source, /@media\s*\(max-width:\s*760px\)/);
  assert.match(source, /\.patient-search\s*\{\s*display:\s*grid/s);
  assert.match(source, /\.slot-grid\s*\{\s*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(source, /\.booking-summary\s*\{\s*position:\s*static/s);
  assert.match(source, /:focus-visible/);
  assert.match(source, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});
