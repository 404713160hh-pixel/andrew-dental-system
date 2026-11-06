import assert from 'node:assert/strict';
import { test } from 'node:test';
import type pg from 'pg';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

test('proxy addresses must be explicitly configured individual IPs', () => {
  for (const value of ['true', '0.0.0.0/0', '172.30.87.0/24', 'some-host', '1.2.3.4,']) {
    assert.throws(() => loadConfig({ DATABASE_URL: 'postgres://unused', TRUSTED_PROXY_IPS: value }));
  }
  assert.equal(loadConfig({ DATABASE_URL: 'postgres://unused', TRUSTED_PROXY_IPS: '172.30.87.10, ::1' }).TRUSTED_PROXY_IPS, '172.30.87.10, ::1');
});

test('untrusted peers cannot choose a client IP through forwarding headers', async () => {
  for (const trusted of ['', '172.30.87.10']) {
    const app = await createApp(loadConfig({ DATABASE_URL: 'postgres://unused', TRUSTED_PROXY_IPS: trusted }), {} as pg.Pool, false);
    app.get('/test-client-address', async request => ({ ip: request.ip }));
    await app.ready();
    try {
      const direct = await app.inject({ method: 'GET', url: '/test-client-address', remoteAddress: '192.0.2.10', headers: { 'x-forwarded-for': '203.0.113.80' } });
      assert.equal(direct.json().ip, '192.0.2.10');
      const fromWeb = await app.inject({ method: 'GET', url: '/test-client-address', remoteAddress: '172.30.87.10', headers: { 'x-forwarded-for': '198.51.100.66, 203.0.113.80' } });
      assert.equal(fromWeb.json().ip, trusted ? '203.0.113.80' : '172.30.87.10');
    } finally { await app.close(); }
  }
});

test('the real IP rate limit returns the 429 error contract and rejects spoofed forwarding headers', async () => {
  const app = await createApp(loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://unused', TRUSTED_PROXY_IPS: '' }), {} as pg.Pool, false);
  let handled = 0;
  app.get('/test-rate-limit', async () => { handled++; return { ok: true }; });
  await app.ready();
  try {
    for (let index = 0; index < 300; index++) {
      const accepted = await app.inject({ method: 'GET', url: '/test-rate-limit', remoteAddress: '192.0.2.10', headers: { 'x-forwarded-for': '203.0.113.' + (index % 254 + 1) } });
      assert.equal(accepted.statusCode, 200, accepted.body);
    }
    const limited = await app.inject({ method: 'GET', url: '/test-rate-limit', remoteAddress: '192.0.2.10', headers: { 'x-forwarded-for': '198.51.100.99' } });
    assert.equal(limited.statusCode, 429, limited.body);
    assert.equal(limited.json().error.code, 'RATE_LIMITED');
    assert.equal(limited.json().error.message, '操作频繁，请稍后重试');
    assert.match(limited.json().requestId, /^[0-9a-f-]{36}$/);
    assert.ok(Number(limited.headers['retry-after']) > 0);
    assert.equal(handled, 300, 'The throttled request must not enter the handler');
    const otherPeer = await app.inject({ method: 'GET', url: '/test-rate-limit', remoteAddress: '192.0.2.11' });
    assert.equal(otherPeer.statusCode, 200, otherPeer.body);
  } finally { await app.close(); }
});
