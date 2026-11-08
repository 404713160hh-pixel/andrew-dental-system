import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/views/StaffAccountsView.vue', import.meta.url), 'utf8');

test('staff account and profile tables have accessible local scrolling at narrow widths', () => {
  assert.match(source, /role="region" aria-label="登录账号与岗位表格，可横向滚动" tabindex="0"/);
  assert.match(source, /role="region" aria-label="员工档案表格，可横向滚动" tabindex="0"/);
  assert.match(source, /\.staff-table-scroll\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(source, /\.staff-accounts-table \{ min-width:920px; \}/);
  assert.match(source, /\.staff-profiles-table \{ min-width:1040px; \}/);
  assert.match(source, /@media\(max-width:760px\)/);
  assert.match(source, /\.staff-assignment-row \{ display:grid/s);
});

test('staff layout retains HQ route boundary, doctor linking, temporary password and version safeguards', () => {
  assert.match(source, /form\.value\.temporaryPassword\.length<12/);
  assert.match(source, /resetPassword\.value\.length<12/);
  assert.match(source, /expectedVersion:editing\.value\.accountVersion/);
  assert.match(source, /expectedVersion:resetting\.value\.accountVersion/);
  assert.match(source, /expectedVersion:profileEditing\.value\.rowVersion/);
  assert.match(source, /必须关联医生档案/);
  assert.match(source, /if\(profile\?\.isDentist\).*resources\/doctors/);
  assert.match(source, /医生资料请通过“医生档案”维护/);
  assert.match(source, /router\.push\('\/resources\/doctors'\)/);
});
