/** Real HTTP integration of generated native modules. This does NOT render WeChat UI. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { artifactHash } from './artifact-hash.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.MINIPROGRAM_SMOKE_API ?? 'http://127.0.0.1:3310/api/v1';
if (process.env.MINIPROGRAM_SMOKE_ALLOW_CREATE !== '1') throw new Error('此脚本会创建合成夹具。请指定隔离测试 API，并设置 MINIPROGRAM_SMOKE_ALLOW_CREATE=1。');
const namespace = 'MP-SMOKE-' + randomUUID().slice(0, 8);
const startedAt = new Date().toISOString(), checks = [], resources = [];
function check(label, test) { assert.ok(test, label); checks.push({ label, status: 'passed' }); }
function runtime(storage = new Map()) {
  const cache = new Map(), requests = [];
  let dropped = false;
  const context = vm.createContext({ console, Date, Math, Promise, Set, Map, Error, encodeURIComponent,
    wx: { getStorageSync: key => storage.has(key) ? structuredClone(storage.get(key)) : '', setStorageSync: (key, value) => storage.set(key, structuredClone(value)), removeStorageSync: key => storage.delete(key), redirectTo() {}, navigateTo() {},
      request(options) {
        const path = options.url.slice(base.length); requests.push({ path, method: options.method, key: options.header['Idempotency-Key'] });
        void fetch(options.url, { method: options.method, headers: options.header, ...(options.data !== undefined ? { body: JSON.stringify(options.data) } : {}), signal: AbortSignal.timeout(15000) }).then(async response => {
          const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
          if (dropped && path === '/appointments/confirm' && response.ok) { dropped = false; options.fail({ errMsg: 'simulated response loss after real server commit' }); }
          else options.success({ statusCode: response.status, data });
        }).catch(error => options.fail({ errMsg: error.message }));
      }
    }
  });
  function load(relative) {
    const path = resolve(root, 'dist', relative.endsWith('.js') ? relative : relative + '.js');
    if (!path.startsWith(resolve(root, 'dist') + sep)) throw new Error('Unexpected native module path');
    if (path === resolve(root, 'dist/config.js')) return { apiBaseUrl: base };
    if (cache.has(path)) return cache.get(path).exports;
    const module = { exports: {} }; cache.set(path, module);
    vm.runInContext('(function(require,module,exports){' + readFileSync(path, 'utf8') + '\n})', context, { filename: path })(id => { if (!id.startsWith('.')) throw new Error('Unexpected native npm dependency'); return load(resolve(dirname(path), id)); }, module, module.exports);
    return module.exports;
  }
  const api = load('utils/api').api, auth = load('utils/session'), booking = load('utils/booking'), format = load('utils/format');
  return { storage, requests, api, auth, booking, format, dropNextConfirmResponse() { dropped = true; } };
}
const evidence = { namespace, startedAt, api: base, artifactSha256: artifactHash(resolve(root, 'dist')), execution: 'Generated native CommonJS modules with wx.request-to-fetch adapter and real HTTP/PostgreSQL backend; no WeChat tool or device execution', checks, resources };
const clients = [], staff = runtime();
let shift, clinic, doctor, service, chair, qualification;
const save = (kind, payload) => staff.api('/staff/' + kind, 'POST', payload);
try {
  const health = await staff.api('/health'); check('real backend reports PostgreSQL', health.database === 'postgresql');
  const references = await staff.api('/treatment-references');
  check('public treatment references contain integer-cent ranges with explicit year, unit and unverified source', Array.isArray(references) && references.every(item => Number.isSafeInteger(item.priceMinCents) && Number.isSafeInteger(item.priceMaxCents) && item.priceMinCents >= 0 && item.priceMaxCents >= item.priceMinCents && item.referenceYear === 2026 && item.unit && item.sourceLabel === '用户提供的价格资料（未独立核验）' && !('patientId' in item)));
  if (process.env.MINIPROGRAM_SMOKE_EXPECT_DEMO_CATALOG === '1') {
    check('the requested price catalog is installed with prevention, treatment, restoration, implant and orthodontic groups', references.length >= 20 && new Set(references.map(item => item.category)).size >= 5);
    const publicDoctors = await staff.api('/doctors'), services = await staff.api('/services');
    check('six fictional doctor profiles are visibly labelled and include biography and focus areas', publicDoctors.filter(item => item.isDemo).length === 6 && publicDoctors.filter(item => item.isDemo).every(item => item.name.includes('虚构') && item.bio && item.focusAreas?.length && item.clinicIds?.length));
    check('reference prices link only to a separately priced assessment or consultation, never replacing booking fees', references.every(item => item.bookingServiceId === null || services.some(service => service.id === item.bookingServiceId && /咨询|评估|检查/.test(service.name))) && references.some(item => item.unit === '疗程' && item.priceMinCents > Math.max(...services.map(service => service.priceCents))));
    evidence.demoCatalog = { references: references.length, fictionalDoctors: publicDoctors.filter(item => item.isDemo).length, source: 'User supplied, not independently verified' };
  }
  const config = await staff.api('/auth/config');
  assert.ok(config.demoLoginEnabled, '隔离测试 API 必须开启开发演示账号');
  for (const account of config.demoAccounts.filter(item => item.portal === 'staff')) {
    const result = await staff.api('/auth/demo', 'POST', { username: account.username, portal: 'staff' });
    if (result.user.roles.includes('hq')) { staff.auth.setSession(result); break; }
  }
  assert.ok(staff.auth.session(), '需要隔离测试环境的总部合成账号');
  clinic = await save('clinics', { name: namespace, address: '课程合成测试地址', phone: '13800001234', email: '', timezone: 'Asia/Shanghai', active: true });
  qualification = await save('qualifications', { name: namespace + '资格', active: true });
  doctor = await save('doctors', { employeeNo: namespace, name: namespace + '医生', phone: '13800001234', specialty: '合成初诊检查', active: true, qualifications: [{ qualificationId: qualification.id, validFrom: '2020-01-01T00:00:00.000Z', validUntil: null }] });
  service = await save('services', { name: namespace + '检查', description: '仅用于自动化验证的合成项目', durationMinutes: 30, bufferMinutes: 10, priceCents: 10000, unit: '次', active: true, clinicIds: [clinic.id], qualificationIds: [qualification.id] });
  chair = await save('chairs', { clinicId: clinic.id, name: namespace + '牙椅', active: true });
  const day = new Date(Date.now() + 7 * 86400000 + 8 * 3600000).toISOString().slice(0, 10);
  shift = await staff.api('/staff/shifts', 'POST', { clinicId: clinic.id, doctorId: doctor.id, startsAt: day + 'T09:00:00+08:00', endsAt: day + 'T14:00:00+08:00', serviceIds: [service.id] });
  resources.push({ clinicId: clinic.id, doctorId: doctor.id, serviceId: service.id, chairId: chair.id, qualificationId: qualification.id, shiftId: shift.id });
  const notice = await staff.api('/privacy/notice');
  for (const index of [1, 2]) {
    const client = runtime();
    const result = await client.api('/auth/register', 'POST', { username: namespace.toLowerCase() + '-' + index, password: 'SyntheticOnly-' + randomUUID(), consent: { policyVersion: notice.policyVersion, noticeAccepted: true, sensitiveAccepted: true, guardian: null }, profile: { name: namespace + '患者' + index, birthDate: '1998-01-01', phone: '13800001234', email: null, billingAddress: '课程合成地址', emergencyName: '合成联系人', emergencyPhone: '13800001235', allergyStatus: index === 1 ? 'unknown' : 'none_reported', allergies: [] } });
    client.auth.setSession(result); clients.push(client);
  }
  const [a, b] = clients;
  const profileA = await a.api('/patients/me'), profileB = await b.api('/patients/me');
  check('different patients may share phone without sharing identity', profileA.id !== profileB.id && profileA.phone === profileB.phone);
  check('unknown allergy differs from declared none', profileA.allergyStatus === 'unknown' && profileB.allergyStatus === 'none_reported');
  const principal = await a.api('/me'); check('GET me matches current patient only', principal.patientId === profileA.id);
  const slotsPath = '/booking-slots?clinicId=' + clinic.id + '&serviceId=' + service.id + '&doctorId=' + doctor.id + '&date=' + day;
  const slots = await a.api(slotsPath); check('staff published shift is queryable through native client', slots.length >= 4 && slots.every(slot => slot.shiftId === shift.id));
  const selection = a.format.slotSelection(slots[0]);
  const races = await Promise.allSettled(clients.map(client => client.api('/booking-holds', 'POST', selection)));
  check('two patients race for same doctor/chair: exactly one hold succeeds', races.filter(result => result.status === 'fulfilled').length === 1);
  const winnerIndex = races.findIndex(result => result.status === 'fulfilled'), winner = clients[winnerIndex], loser = clients[1 - winnerIndex], hold = races[winnerIndex].value;
  const confirm = winner.booking.newCommand('/appointments/confirm', { holdId: hold.id, holdVersion: hold.rowVersion, patientConfirmed: true, rulesAccepted: true });
  winner.dropNextConfirmResponse(); await assert.rejects(winner.booking.sendCommand(confirm), error => error.uncertain);
  check('response loss after real commit persists original command key', winner.booking.pendingCommand().key === confirm.key);
  const reloaded = runtime(winner.storage), pending = reloaded.booking.pendingCommand();
  check('native client relaunch restores pending key from owned storage', pending.key === confirm.key);
  const confirmed = await reloaded.booking.sendCommand(pending);
  const receipt = await reloaded.api('/commands/' + confirm.key);
  check('same-key recovery returns original committed appointment', receipt.result.id === confirmed.id && confirmed.status === 'confirmed');
  const ownList = await reloaded.api('/appointments?page=1&pageSize=100');
  check('duplicate replay creates exactly one appointment', ownList.items.length === 1 && ownList.items[0].id === confirmed.id);
  const shared = await staff.api('/staff/appointments?clinicId=' + clinic.id + '&page=1&pageSize=100');
  check('staff workbench API sees same appointment', shared.items.some(item => item.id === confirmed.id));
  await assert.rejects(loser.api('/appointments/' + confirmed.id), error => error.statusCode === 404);
  check('another patient cannot read appointment detail', true);
  const cancel = reloaded.booking.newCommand('/appointments/' + confirmed.id + '/changes', { intent: 'cancel', expectedVersion: confirmed.rowVersion, reason: '原生客户端合成取消测试' });
  const cancelled = await reloaded.booking.sendCommand(cancel); check('cancel stores original record as cancelled', cancelled.id === confirmed.id && cancelled.status === 'cancelled');
  const released = await reloaded.api(slotsPath); check('cancel releases original slot', released.some(item => item.startsAt === selection.startsAt));
  const baseHold = await reloaded.api('/booking-holds', 'POST', reloaded.format.slotSelection(released.find(item => item.startsAt === selection.startsAt)));
  const original = await reloaded.booking.sendCommand(reloaded.booking.newCommand('/appointments/confirm', { holdId: baseHold.id, holdVersion: baseHold.rowVersion, patientConfirmed: true, rulesAccepted: true }));
  const alternatives = await reloaded.api(slotsPath), alternative = alternatives.find(item => Date.parse(item.startsAt) >= Date.parse(original.occupiedUntil)); assert.ok(alternative);
  const nextHold = await reloaded.api('/booking-holds', 'POST', reloaded.format.slotSelection(alternative));
  const change = { intent: 'reschedule', expectedVersion: original.rowVersion, reason: '原生客户端合成改期测试', holdId: nextHold.id, holdVersion: nextHold.rowVersion };
  await assert.rejects(reloaded.booking.sendCommand(reloaded.booking.newCommand('/appointments/' + original.id + '/changes', { ...change, expectedVersion: original.rowVersion + 1 })), error => error.code === 'VERSION_CONFLICT');
  const preserved = await reloaded.api('/appointments/' + original.id); check('failed reschedule preserves original confirmed appointment', preserved.status === 'confirmed' && preserved.rowVersion === original.rowVersion);
  const replacement = await reloaded.booking.sendCommand(reloaded.booking.newCommand('/appointments/' + original.id + '/changes', change));
  const old = await reloaded.api('/appointments/' + original.id); check('successful reschedule preserves traceable old/new linkage', replacement.supersedesAppointmentId === original.id && old.replacementAppointmentId === replacement.id && old.status === 'rescheduled');
  await reloaded.booking.sendCommand(reloaded.booking.newCommand('/appointments/' + replacement.id + '/changes', { intent: 'cancel', expectedVersion: replacement.rowVersion, reason: '自动化夹具收尾，释放资源' }));
  evidence.appointmentIds = [confirmed.id, original.id, replacement.id];
  evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed'; evidence.error = { message: error.message, code: error.code, statusCode: error.statusCode }; process.exitCode = 1;
} finally {
  // Keep auditable synthetic histories; hide successfully released synthetic resources.
  const cleanup = [];
  if (shift) { try { await staff.api('/staff/shifts/' + shift.id + '/cancel', 'POST', { expectedVersion: shift.rowVersion }); cleanup.push('合成班次已撤销'); } catch (error) { cleanup.push('班次保留用于排查：' + error.code); } }
  for (const [kind, resource, payload] of [
    ['chairs', chair, chair && { clinicId: chair.clinicId, name: chair.name, active: false }],
    ['services', service, service && { name: service.name, description: service.description, durationMinutes: service.durationMinutes, bufferMinutes: service.bufferMinutes, priceCents: service.priceCents, unit: service.unit, active: false, clinicIds: service.clinicIds, qualificationIds: service.qualificationIds }],
    ['doctors', doctor, doctor && { employeeNo: doctor.employeeNo, name: doctor.name, phone: doctor.phone, specialty: doctor.specialty, active: false, qualifications: doctor.qualifications.map(item => ({ qualificationId: item.qualificationId, validFrom: item.validFrom, validUntil: item.validUntil })) }],
    ['clinics', clinic, clinic && { name: clinic.name, address: clinic.address, phone: clinic.phone, email: clinic.email, timezone: clinic.timezone, active: false }],
    ['qualifications', qualification, qualification && { name: qualification.name, active: false }]
  ]) if (resource && payload) { try { await staff.api('/staff/' + kind + '/' + resource.id, 'PUT', { ...payload, expectedVersion: resource.rowVersion }); cleanup.push(kind + '已停用'); } catch (error) { cleanup.push(kind + '保留用于排查：' + error.code); } }
  evidence.cleanup = cleanup; evidence.finishedAt = new Date().toISOString();
  mkdirSync(resolve(root, 'qa'), { recursive: true }); writeFileSync(resolve(root, 'qa/native-api-smoke.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ status: evidence.status, checks: checks.length, namespace, evidence: 'miniprogram/qa/native-api-smoke.json', error: evidence.error, cleanup }, null, 2));
}
