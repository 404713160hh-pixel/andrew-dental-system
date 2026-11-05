/** Run from the repository root after building @andrew/booking-api.
 * Uses the single compiled maintenance implementation; never run against ordinary databases.
 * Supports file execution and `docker exec -i ... node --input-type=module < this-file`.
 * For stdin execution use ANDREW_DEMO_PASSWORDS=1; file execution also accepts --enable.
 */
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

let pool;
try {
  const enabled = process.env.ANDREW_DEMO_PASSWORDS === '1' || process.argv.includes('--enable');
  if (!enabled) throw new Error('Explicit demo password maintenance opt-in is required');
  if (!['development', 'test'].includes(process.env.NODE_ENV)) throw new Error('Explicit non-production NODE_ENV is required');
  if (!process.env.DATABASE_URL) throw new Error('Explicit DATABASE_URL is required');
  const directory = resolve(process.env.ANDREW_DEMO_PASSWORD_MODULE_ROOT || 'booking-api/dist/booking-api/src');
  const { setDemoPasswords } = await import(pathToFileURL(join(directory, 'demo-passwords.js')).href);
  const { poolFor } = await import(pathToFileURL(join(directory, 'db.js')).href);
  pool = poolFor(process.env.DATABASE_URL);
  const result = await setDemoPasswords(pool, { NODE_ENV: process.env.NODE_ENV, DATABASE_URL: process.env.DATABASE_URL }, { enabled });
  console.log(JSON.stringify({ event: 'demo_password_maintenance_completed', ...result }));
} catch (error) {
  // Connection errors may contain infrastructure details; only emit our known guard messages.
  const message = error instanceof Error ? error.message : '';
  const guard = /^(Explicit |Demo password |Connected database |All six |The original |Complete original |Demo clinic |Only explicitly |The fictional )/.test(message);
  console.error(JSON.stringify({ event: 'demo_password_maintenance_failed', ...(guard ? { message } : { code: typeof error?.code === 'string' ? error.code : 'MAINTENANCE_FAILED' }) }));
  process.exitCode = 1;
} finally { if (pool) await pool.end(); }
