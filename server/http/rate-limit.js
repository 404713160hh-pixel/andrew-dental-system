import { isIP } from 'node:net';
import { createHash } from 'node:crypto';
import { ApiError } from '../domain.js';

const normalize = value => value?.replace(/^::ffff:/, '') || '';
export function requestAddress(req) {
  const address = normalize(req.socket.remoteAddress);
  const trusted = new Set((process.env.DENTAL_TRUSTED_PROXIES || '').split(',').map(value => normalize(value.trim())).filter(Boolean));
  if (!trusted.has(address)) return address;
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map(value => normalize(value.trim()));
  if (forwarded.length > 10 || forwarded.some(value => !isIP(value))) return address;
  for (const value of [...forwarded, address].reverse()) if (!trusted.has(value)) return value;
  return forwarded[0] || address;
}

// Persist a bounded-window counter so restarting the application cannot reset it.
export function checkRateLimit(db, req, category, identity = '', maximum = 30, windowMs = 900000) {
  const key = createHash('sha256').update(`${category}:${requestAddress(req)}:${identity}`).digest('hex');
  const now = Date.now();
  db.sql.prepare('DELETE FROM rate_limits WHERE expires_at<?').run(now);
  const existing = db.sql.prepare('SELECT count,expires_at FROM rate_limits WHERE key=?').get(key);
  if (existing && existing.expires_at > now && existing.count >= maximum) throw new ApiError(429, '请求过于频繁，请稍后再试', 'RATE_LIMIT');
  db.sql.prepare('INSERT INTO rate_limits(key,count,expires_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,expires_at=excluded.expires_at')
    .run(key, existing ? existing.count + 1 : 1, existing?.expires_at || now + windowMs);
  return key;
}

export function clearRateLimit(db, key) {
  db.sql.prepare('DELETE FROM rate_limits WHERE key=?').run(key);
}
