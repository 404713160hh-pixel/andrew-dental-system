import { isIP } from 'node:net';

export const developmentApiUrl = 'http://127.0.0.1:3310/api/v1';

/** Resolve one explicitly selected build target; never infer production from a domain name. */
export function miniBuildConfig(env = process.env) {
  const mode = env.ANDREW_MINI_BUILD || 'development';
  if (!['development', 'production'].includes(mode)) throw new Error('ANDREW_MINI_BUILD 必须为 development 或 production。');
  const raw = env.ANDREW_MINI_API_URL?.trim();
  if (mode === 'production' && !raw) throw new Error('正式构建必须设置 ANDREW_MINI_API_URL。');
  const value = raw || developmentApiUrl;
  let url;
  try { url = new URL(value); } catch { throw new Error('小程序 API 地址必须是完整 URL。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/api/v1') {
    throw new Error('小程序 API 地址必须是无凭据和参数、以 /api/v1 结尾的 HTTP(S) URL。');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (mode === 'production' && (url.protocol !== 'https:' || isIP(host) || host === 'localhost' || host.endsWith('.localhost'))) {
    throw new Error('正式构建必须使用 HTTPS 域名，不能使用本地地址或 IP。');
  }
  return { mode, apiUrl: url.toString().replace(/\/$/, '') };
}
