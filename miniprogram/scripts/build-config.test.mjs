import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { miniBuildConfig, developmentApiUrl } from './build-config.mjs';

test('development build keeps the local default and supports a LAN address', () => {
  assert.equal(miniBuildConfig({}).apiUrl, developmentApiUrl);
  assert.equal(miniBuildConfig({ ANDREW_MINI_API_URL: 'http://192.168.1.9:3310/api/v1' }).apiUrl, 'http://192.168.1.9:3310/api/v1');
});
test('production build requires a clean HTTPS domain', () => {
  assert.equal(miniBuildConfig({ ANDREW_MINI_BUILD: 'production', ANDREW_MINI_API_URL: 'https://booking.example.com/api/v1' }).apiUrl, 'https://booking.example.com/api/v1');
  for (const value of ['', 'http://booking.example.com/api/v1', 'https://127.0.0.1/api/v1', 'https://localhost/api/v1', 'https://[::1]/api/v1', 'https://user:password@example.com/api/v1', 'https://example.com/api/v1?key=value', 'https://example.com/not-api']) {
    assert.throws(() => miniBuildConfig({ ANDREW_MINI_BUILD: 'production', ANDREW_MINI_API_URL: value }));
  }
});
