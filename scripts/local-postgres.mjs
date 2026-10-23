/** Development-only real PostgreSQL; legacy SQLite is never read or changed. */
import EmbeddedPostgres from 'embedded-postgres';
import pgDriver from 'pg';
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(root, '.booking-data');
mkdirSync(dir, { recursive: true });
const credentialFile = resolve(dir, 'local-postgres.json');
let credentials;
if (existsSync(credentialFile)) credentials = JSON.parse(readFileSync(credentialFile, 'utf8'));
else {
  credentials = { password: randomBytes(24).toString('hex'), seedPassword: randomBytes(16).toString('base64url'), port: 55432 };
  writeFileSync(credentialFile, JSON.stringify(credentials), { mode: 0o600 });
}
if (!Number.isInteger(credentials.port) || credentials.port < 1024 || credentials.port > 65535) throw new Error('Invalid local PostgreSQL port');
if (typeof credentials.password !== 'string' || credentials.password.length < 20) throw new Error('Invalid local PostgreSQL credential file');

async function command(executable, args, cwd, extraEnv = {}) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true, shell: false,
      env: { ...process.env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', value => { output += value.toString('utf8'); });
    child.stderr.on('data', value => { output += value.toString('utf8'); });
    child.on('error', reject);
    // pg_ctl may leave inherited pipe handles in the running Windows server.
    // Its process exit, rather than pipe closure, determines command completion.
    child.on('exit', code => {
      child.stdout.destroy(); child.stderr.destroy();
      code === 0 ? resolveCommand(output) : reject(new Error(`PostgreSQL ${code}: ${output.trim()}`));
    });
  });
}

let server;
let dataDirectory;
if (process.platform === 'win32') {
  // Native Windows tools can interpret Chinese installation paths via a local
  // code page while initdb expects UTF-8. Keep native tools AND data under ASCII.
  const projectKey = createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0, 16);
  const cacheRoot = existsSync('D:/') ? 'D:/codex-storage' : join(process.env.ProgramData || 'C:/ProgramData', 'AndrewDental');
  const home = resolve(process.env.ANDREW_PG_HOME || join(cacheRoot, 'andrew-pg17', projectKey));
  if (!/^[\x20-\x7e]+$/.test(home)) throw new Error('ANDREW_PG_HOME must be an absolute ASCII path on Windows');
  const binaries = join(home, 'native-17.10.0');
  const temp = join(home, 'tmp');
  dataDirectory = join(home, 'data');
  mkdirSync(temp, { recursive: true });
  const source = join(root, 'node_modules', '@embedded-postgres', 'windows-x64', 'native');
  if (!existsSync(source)) throw new Error('Install the Windows x64 embedded-postgres npm dependency first');
  // Copy missing files only; existing clusters and node_modules are untouched.
  cpSync(source, binaries, { recursive: true, force: false, errorOnExist: false });
  const executable = name => join(binaries, 'bin', name + '.exe');
  const environment = { TMP: temp, TEMP: temp, LC_ALL: 'C', LANG: 'C',
    PATH: join(binaries, 'bin') + ';' + join(binaries, 'lib') + ';' + process.env.PATH };
  const run = (name, args) => command(executable(name), args, home, environment);
  if (!existsSync(join(dataDirectory, 'PG_VERSION'))) {
    const passwordFile = join(temp, `initdb-${randomBytes(8).toString('hex')}.txt`);
    writeFileSync(passwordFile, credentials.password + '\n', { mode: 0o600 });
    try {
      await run('initdb', ['-D', dataDirectory, '-U', 'postgres', '--encoding=UTF8', '--locale=C',
        '--auth-host=scram-sha-256', '--auth-local=scram-sha-256', '--pwfile=' + passwordFile]);
    } finally { if (existsSync(passwordFile)) unlinkSync(passwordFile); }
  }
  const control = args => run('pg_ctl', ['-D', dataDirectory, ...args]);
  const start = async () => {
    let running = false;
    try { await control(['status']); running = true; } catch { /* A stopped cluster is expected. */ }
    if (!running) await control(['start', '-w', '-t', '45', '-l', join(home, 'postgres.log'), '-o',
      `-p ${credentials.port} -h 127.0.0.1 -c password_encryption=scram-sha-256`]);
  };
  server = { start, stop: () => control(['stop', '-m', 'fast', '-w', '-t', '45']) };
} else {
  dataDirectory = resolve(dir, 'postgres');
  const embedded = new EmbeddedPostgres({ databaseDir: dataDirectory, user: 'postgres', password: credentials.password,
    port: credentials.port, persistent: true, authMethod: 'scram-sha-256', initdbFlags: ['--encoding=UTF8', '--locale=C'],
    postgresFlags: ['-c', 'listen_addresses=127.0.0.1'], onLog: () => {}, onError: () => {} });
  if (!existsSync(join(dataDirectory, 'PG_VERSION'))) await embedded.initialise();
  server = embedded;
}

if(process.argv.includes('--restart')){
  if(process.platform!=='win32')throw new Error('For native Linux/macOS stop and relaunch the PostgreSQL terminal, then run persistence after');
  await server.stop();await server.start();console.log(JSON.stringify({restarted:true,persistent:true}));process.exit(0);
}
await server.start();
const client = new pgDriver.Client({ user: 'postgres', password: credentials.password, host: '127.0.0.1', port: credentials.port, database: 'postgres' });
await client.connect();
if (!(await client.query("SELECT 1 FROM pg_database WHERE datname='andrew_booking_dev'")).rowCount) await client.query('CREATE DATABASE andrew_booking_dev');
const version = (await client.query('SHOW server_version')).rows[0].server_version;
await client.end();
const envFile = resolve(root, '.env.booking');
if (!existsSync(envFile)) writeFileSync(envFile, [
  `DATABASE_URL=postgresql://postgres:${encodeURIComponent(credentials.password)}@127.0.0.1:${credentials.port}/andrew_booking_dev`,
  'NODE_ENV=development', 'BOOKING_HOST=127.0.0.1', 'BOOKING_PORT=3310', 'ALLOW_DEMO_LOGIN=true',
  `SEED_PASSWORD=${credentials.seedPassword}`, 'HOLD_SECONDS=300', 'CANCELLATION_NOTICE_MINUTES=120', 'TRANSFER_BUFFER_MINUTES=30', '',
].join('\n'), { mode: 0o600 });
writeFileSync(resolve(dir, 'postgres-location.json'), JSON.stringify({ dataDirectory, port: credentials.port, platform: process.platform }, null, 2));
console.log(JSON.stringify({ postgres: version, host: '127.0.0.1', port: credentials.port, environment: '.env.booking', dataDirectory, persistent: true, ready: true }));
console.log('Keep this terminal open. Ctrl+C stops PostgreSQL safely; type restart then Enter to test persistence.');
let busy = false;
let stopping = false;
process.stdin.on('data', async chunk => {
  if (String(chunk).trim() === 'restart' && !busy && !stopping) {
    busy = true;
    try { await server.stop(); await server.start(); console.log(JSON.stringify({ restarted: true, persistent: true })); }
    catch (error) { console.error('Restart failed:', error.message); }
    finally { busy = false; }
  }
});
async function stop() {
  if (stopping) return;
  stopping = true;
  try { await server.stop(); process.exit(0); }
  catch (error) { console.error('PostgreSQL stop failed:', error.message); process.exit(1); }
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
setInterval(() => {}, 60000);
