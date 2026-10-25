import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isQueryDateAllowed,queryWindow } from '../src/query-window.js';
const DAY=86400000;
const move=(date:string,days:number)=>new Date(Date.parse(date+'T00:00:00Z')+days*DAY).toISOString().slice(0,10);
test('published inclusive query window matches the original China-midnight rule across day and leap boundaries',()=>{
 for(const instant of ['2026-10-25T00:00:00+08:00','2026-10-25T00:00:00.001+08:00','2026-10-25T07:59:59+08:00','2026-10-25T08:00:00+08:00','2026-10-25T23:59:59.999+08:00','2028-02-29T22:00:00+08:00','2026-12-31T23:59:59+08:00']) {
  const now=Date.parse(instant),window=queryWindow(now);
  for(let offset=-2;offset<=93;offset++) {
   const date=move(window.fromDate,offset),difference=(Date.parse(date+'T00:00:00+08:00')-now)/DAY;
   const oldRule=difference>=-1&&difference<=90;
   assert.equal(isQueryDateAllowed(date,now),oldRule,instant+' '+date);
   assert.equal(date>=window.fromDate&&date<=window.toDate,oldRule,instant+' window '+date);
  }
  assert.equal(isQueryDateAllowed(move(window.fromDate,-1),now),false);
  assert.equal(isQueryDateAllowed(window.fromDate,now),true);
  assert.equal(isQueryDateAllowed(window.toDate,now),true);
  assert.equal(isQueryDateAllowed(move(window.toDate,1),now),false);
 }
});
