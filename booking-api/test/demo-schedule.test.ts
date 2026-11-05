import test from 'node:test';
import assert from 'node:assert/strict';
import { demoShiftHours } from '../src/demo.js';

test('fictional clinic schedules follow opening times and weekly closing days',()=>{
 const now=Date.parse('2026-11-05T08:00:00+08:00');
 assert.equal(demoShiftHours('2026-11-08',0,now),null);
 assert.equal(demoShiftHours('2026-11-09',1,now),null);
 const yuexiu=demoShiftHours('2026-11-05',0,now)!;
 const tianhe=demoShiftHours('2026-11-05',1,now)!;
 assert.equal(Date.parse(yuexiu.start),Date.parse('2026-11-05T09:00:00+08:00'));
 assert.equal(Date.parse(yuexiu.end),Date.parse('2026-11-05T18:00:00+08:00'));
 assert.equal(Date.parse(tianhe.start),Date.parse('2026-11-05T09:30:00+08:00'));
 assert.equal(Date.parse(tianhe.end),Date.parse('2026-11-05T18:30:00+08:00'));
});

test('same-day demo shifts start in the future and are skipped near closing',()=>{
 const now=Date.parse('2026-11-05T12:07:00+08:00');
 const shift=demoShiftHours('2026-11-05',0,now)!;
 assert.equal(Date.parse(shift.start),Date.parse('2026-11-05T12:45:00+08:00'));
 assert.ok(Date.parse(shift.start)>now);
 assert.equal(demoShiftHours('2026-11-05',0,Date.parse('2026-11-05T17:00:00+08:00')),null);
 assert.equal(demoShiftHours('2026-11-04',0,now),null);
});
