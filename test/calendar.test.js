import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/calendar.js', import.meta.url), 'utf8');
function calendar() {
  const sandbox = {};
  vm.runInNewContext(source, sandbox);
  return sandbox.DentalCalendar;
}
const base = {
  now: '2026-10-13T02:15:00.000Z',
  dentists: [{ id: 'D1', name: '王医生' }, { id: 'D2', name: '李医生' }],
  clinics: [{ id: 'C1', name: '安德鲁诊所' }],
  patientName: id => ({ P1: '张女士', P2: '陈先生', P3: '赵先生' }[id]),
};
const appointment = (id, start, end, more = {}) => ({
  id, patientId: 'P1', dentistId: 'D1', clinicId: 'C1', status: 'booked',
  start: `2026-10-13T${start}:00+08:00`, end: `2026-10-13T${end}:00+08:00`,
  problem: '检查与清洁', ...more,
});
const eventTag = (html, id) => html.match(new RegExp(`<button[^>]*data-id="${id}"[^>]*>`))?.[0];

test('calendar uses Shanghai date, a Monday week, and an honest empty state', () => {
  const cal = calendar();
  const html = cal.render({ ...base, now: '2026-10-12T23:35:00Z', appointments: [] });
  assert.equal(cal.getDate(), '2026-10-13');
  assert.ok(html.includes('2026年10月12日 — 18日'));
  assert.ok(html.includes('这一周暂无接诊预约'));
  assert.ok(html.includes('--cal-hours:12'));
  assert.ok(!html.includes('data-action="appointment-detail"'));
});

test('overlapping appointments use separate lanes without reducing later independent appointments', () => {
  const cal = calendar();
  const html = cal.render({ ...base, appointments: [
    appointment('A1', '09:00', '10:00'),
    appointment('A2', '09:30', '10:30', { patientId: 'P2', dentistId: 'D2' }),
    appointment('A3', '10:30', '11:00', { patientId: 'P3' }),
  ] });
  assert.ok(eventTag(html, 'A1').includes('data-cal-lane="0" data-cal-lanes="2"'));
  assert.ok(eventTag(html, 'A2').includes('data-cal-lane="1" data-cal-lanes="2"'));
  assert.ok(eventTag(html, 'A3').includes('data-cal-lane="0" data-cal-lanes="1"'));
  assert.ok(html.includes('张女士') && html.includes('陈先生') && html.includes('李医生'));
});

test('adjacent appointments share a lane, while short visible blocks still avoid a collision', () => {
  const cal = calendar();
  let html = cal.render({ ...base, appointments: [appointment('A1', '09:00', '10:00'), appointment('A2', '10:00', '10:30')] });
  assert.ok(eventTag(html, 'A1').includes('data-cal-lanes="1"'));
  assert.ok(eventTag(html, 'A2').includes('data-cal-lanes="1"'));
  html = cal.render({ ...base, appointments: [appointment('A1', '09:00', '09:05'), appointment('A2', '09:10', '09:15')] });
  assert.ok(eventTag(html, 'A1').includes('data-cal-lanes="2"'));
  assert.ok(eventTag(html, 'A2').includes('data-cal-lanes="2"'));
});

test('overnight appointments slice on Shanghai midnight and count once', () => {
  const cal = calendar();
  const html = cal.render({ ...base, appointments: [appointment('A1', '23:30', '00:30', { end: '2026-10-14T00:30:00+08:00' })] });
  assert.equal((html.match(/data-id="A1"/g) || []).length, 2);
  assert.ok(html.includes('data-cal-event-date="2026-10-13"'));
  assert.ok(html.includes('data-cal-event-date="2026-10-14"'));
  assert.ok(html.includes('23:30–24:00'));
  assert.ok(html.includes('00:00–00:30'));
  assert.ok(html.includes('本周 1 个接诊预约'));
  assert.ok(html.includes('--cal-hours:24'));
});

test('cancelled appointments do not consume a slot; invalid times do not become invented events', () => {
  const cal = calendar();
  const html = cal.render({ ...base, appointments: [
    appointment('A1', '09:00', '10:00', { status: 'cancelled' }),
    appointment('A2', '10:00', '09:00'),
    appointment('A3', '11:00', '11:30', { start: 'invalid' }),
  ] });
  assert.ok(!html.includes('data-action="appointment-detail"'));
  assert.ok(html.includes('另有 1 个已取消预约'));
  assert.ok(html.includes('2 条时间不完整的记录未排入日历'));
});

test('date navigation and list switch preserve clear state and invoke one callback', () => {
  const cal = calendar();
  const changes = [];
  cal.render({ ...base, appointments: [], onChange: change => changes.push(change) });
  assert.equal(cal.handleAction('prev'), true);
  assert.equal(cal.getDate(), '2026-10-06');
  cal.handleAction('day');
  cal.handleAction('next');
  assert.equal(cal.getDate(), '2026-10-07');
  cal.handleAction('today');
  assert.equal(cal.getDate(), '2026-10-13');
  assert.equal(cal.handleAction('date', '2026-10-15'), true);
  assert.equal(cal.view, 'day');
  assert.equal(cal.getDate(), '2026-10-15');
  cal.handleAction('list');
  const html = cal.render(base);
  assert.ok(html.includes('预约列表'));
  assert.ok(html.includes('data-cal-action="week"'));
  assert.ok(!html.includes('class="cal-scroll"'));
  assert.ok(!html.includes('data-cal-action="prev"'));
  assert.equal(changes.length, 6);
  assert.equal(cal.handleAction('date', '2026-02-30'), false);
  assert.equal(cal.setDate('2026-02-30'), false);
});

test('rendered names, appointment IDs and problems are escaped', () => {
  const cal = calendar();
  const html = cal.render({ ...base, patientName: () => '<img src=x onerror=alert(1)>', appointments: [
    appointment('A1" onclick="alert(1)', '09:00', '10:00', { problem: '<script>alert(1)</script>' }),
  ] });
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('data-id="A1&quot; onclick=&quot;alert(1)"'));
});

test('weeks and navigation remain correct across the year boundary', () => {
  const cal = calendar();
  const html = cal.render({ ...base, initialDate: '2026-12-31', appointments: [] });
  assert.ok(html.includes('2026年12月28日 — 2027年1月3日'));
  cal.handleAction('next');
  assert.equal(cal.getDate(), '2027-01-07');
  const next = cal.render(base);
  assert.ok(next.includes('2027年1月4日 — 10日'));
});
