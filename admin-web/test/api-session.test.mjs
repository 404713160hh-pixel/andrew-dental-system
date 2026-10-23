/** Isolated client tests with controlled transport timing, not real HTTP tests. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function client() {
  const storage = new Map();
  const events = [];
  const requests = [];
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    AbortController,
    Event,
    URLSearchParams,
    sessionStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
    },
    window: {
      setTimeout: () => 1,
      clearTimeout: () => {},
      dispatchEvent: event => { events.push(event.type); return true; },
    },
    fetch: (url, options) => new Promise(resolve => requests.push({ url, options, resolve })),
  }, { filename: 'admin-web/src/api.ts' });
  return { api: exports, storage, events, requests };
}

function respond(request, status, payload) {
  request.resolve({ status, ok: status >= 200 && status < 300, json: async () => payload });
}
const unauthorized = { error: { code: 'SESSION_EXPIRED', message: '登录已失效' }, requestId: 'unit-401' };
const command = key => ({ key, path: '/appointments/confirm', body: { holdId: key }, createdAt: '2026-10-23T00:00:00Z' });

test('late 401 from account A preserves newly logged-in account B', async () => {
  const fixture = client();
  fixture.api.tokenStorage.set('token-A', 'owner-A');
  const requestA = fixture.api.api('/me');
  assert.equal(fixture.requests[0].options.headers.Authorization, 'Bearer token-A');
  fixture.api.tokenStorage.set('token-B', 'owner-B');
  respond(fixture.requests[0], 401, unauthorized);
  await assert.rejects(requestA, error => error.status === 401);
  assert.equal(fixture.api.tokenStorage.get(), 'token-B');
  assert.deepEqual(fixture.events, []);
});

test('401 for the current token clears it and emits the unauthorized event', async () => {
  const fixture = client();
  fixture.api.tokenStorage.set('token-current', 'owner-current');
  const current = fixture.api.api('/me');
  respond(fixture.requests[0], 401, unauthorized);
  await assert.rejects(current, error => error.status === 401);
  assert.equal(fixture.api.tokenStorage.get(), null);
  assert.deepEqual(fixture.events, ['andrew:unauthorized']);
});

test('late success clears only captured owner A pending command, keeping B pending', async () => {
  const fixture = client();
  fixture.api.tokenStorage.set('token-A', 'owner-A');
  const requestA = fixture.api.submitCommand(command('command-A'));
  assert.ok(fixture.storage.has('andrew.staff.pending-command.owner-A'));
  fixture.api.tokenStorage.set('token-B', 'owner-B');
  fixture.api.savePending(command('command-B'));
  respond(fixture.requests[0], 200, {
    data: { id: 'appointment-A', appointmentNo: 'unit-A', status: 'confirmed' },
    requestId: 'unit-success',
  });
  assert.equal((await requestA).id, 'appointment-A');
  assert.equal(fixture.storage.has('andrew.staff.pending-command.owner-A'), false);
  assert.equal(fixture.api.readPending().key, 'command-B');
  assert.equal(fixture.api.tokenStorage.get(), 'token-B');
});

test('late A unauthorized confirmation preserves both owners pending commands', async () => {
  const fixture = client();
  fixture.api.tokenStorage.set('token-A', 'owner-A');
  const requestA = fixture.api.submitCommand(command('command-A'));
  fixture.api.tokenStorage.set('token-B', 'owner-B');
  fixture.api.savePending(command('command-B'));
  respond(fixture.requests[0], 401, unauthorized);
  await assert.rejects(requestA, error => error.status === 401);
  assert.equal(JSON.parse(fixture.storage.get('andrew.staff.pending-command.owner-A')).key, 'command-A');
  assert.equal(fixture.api.readPending().key, 'command-B');
  assert.equal(fixture.api.tokenStorage.get(), 'token-B');
  assert.deepEqual(fixture.events, []);
});
