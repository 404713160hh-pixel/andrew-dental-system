import { randomBytes, createHash } from 'node:crypto';
import { publicUser, ApiError } from '../domain.js';
import { isAccountActive } from '../services/accounts.js';

const digest = value => createHash('sha256').update(value).digest('hex');
function cookie(req) {
  const value = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('dental_session='))?.slice(15);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

export function readSession(db, req) {
  const token = cookie(req);
  if (!token) return null;
  const session = db.sql.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?').get(digest(token), Date.now());
  if (!session) return null;
  const row = db.sql.prepare('SELECT data FROM users WHERE id=?').get(session.user_id);
  if (!row) return null;
  const user = JSON.parse(row.data);
  return isAccountActive(user) ? { user, session } : null;
}

export function issueSession(db, res, user) {
  const token = randomBytes(32).toString('hex');
  const csrf = randomBytes(24).toString('hex');
  db.sql.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
  db.sql.prepare('INSERT INTO sessions(token_hash,user_id,csrf,expires_at,created_at) VALUES(?,?,?,?,?)')
    .run(digest(token), user.id, csrf, Date.now() + 8 * 3600000, Date.now());
  res.setHeader('Set-Cookie', `dental_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}`);
  return { user: publicUser(user), csrfToken: csrf };
}

export function expireSessionCookie(res) {
  res.setHeader('Set-Cookie', `dental_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}`);
}

export function requireCsrf(req, auth) {
  if (!auth) throw new ApiError(401, '请先登录', 'UNAUTHORIZED');
  if (typeof req.headers['x-csrf-token'] !== 'string' || req.headers['x-csrf-token'] !== auth.session.csrf) {
    throw new ApiError(403, '安全令牌不正确，请刷新后重试', 'CSRF');
  }
}
