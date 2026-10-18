import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, renameSync, copyFileSync, statSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase } from '../server/db.js';
import { requiredTables, legacyTables } from '../server/migrations/manifest.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = resolve(process.env.DENTAL_DB_PATH || resolve(root, 'server/data/dental.sqlite'));
const mode = process.argv[2];
const input = process.argv[3];
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const quote = value => "'" + value.replaceAll("'", "''") + "'";

try {
  if (mode === 'backup') {
    if (!existsSync(dbPath)) throw new Error('数据库尚未创建，请先启动系统。');
    const target = resolve(input || resolve(root, `backups/dental-${stamp}.sqlite`));
    if (target === dbPath || existsSync(target)) throw new Error('备份路径须为一个新的文件。');
    mkdirSync(dirname(target), { recursive: true });
    const db = new DatabaseSync(dbPath);
    db.exec(`VACUUM INTO ${quote(target)}`);
    db.close();
    const check = new DatabaseSync(target, { readOnly: true });
    const result = check.prepare('PRAGMA quick_check').get();
    check.close();
    if (Object.values(result)[0] !== 'ok') throw new Error('备份完整性检查失败。');
    console.log(JSON.stringify({ ok: true, backup: target, bytes: statSync(target).size }));
  } else if (mode === 'restore') {
    if (!input) throw new Error('用法：node tools/database.mjs restore <备份路径>。先停止服务。');
    const source = resolve(input);
    if (!existsSync(source) || source === dbPath) throw new Error('无效的备份路径。');
    if (!process.argv.includes('--offline')) throw new Error('恢复需要服务已停止，确认后加 --offline。');
    const lockPath = `${dbPath}.server.lock`;
    if (existsSync(lockPath)) {
      const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
      let running = true;
      try { process.kill(lock.pid, 0); } catch (error) { if (error.code === 'ESRCH') running = false; }
      if (running) throw new Error('系统服务正在运行，请停止服务后恢复。');
    }
    const check = new DatabaseSync(source, { readOnly: true });
    let result, tables, legacy;
    try {
      result = check.prepare('PRAGMA quick_check').get();
      tables = check.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x => x.name);
      legacy = tables.includes('patients') && check.prepare('PRAGMA table_info(patients)').all().some(column => column.name === 'data');
    } finally { check.close(); }
    const missing = (legacy ? legacyTables : requiredTables).filter(table => !tables.includes(table));
    if (!requiredTables.length || Object.values(result)[0] !== 'ok' || missing.length) throw new Error(`备份不是完整的牙科系统数据库。${missing.length ? '缺少必需表：' + missing.join('、') : ''}`);
    // The server's PID lock detects idle connections too; the database lock
    // additionally detects active writers before preserving the old file.
    if (existsSync(dbPath)) {
      const old = new DatabaseSync(dbPath);
      old.exec('PRAGMA busy_timeout=0');
      const wal = old.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
      if (wal.busy) { old.close(); throw new Error('数据库忙，请先停止服务。'); }
      old.exec('BEGIN EXCLUSIVE');
      old.exec('COMMIT');
      old.close();
    }
    mkdirSync(dirname(dbPath), { recursive: true });
    const temp = `${dbPath}.restore-${stamp}`;
    copyFileSync(source, temp);
    // Upgrade only the disposable copy, before replacing the current database.
    const restored = createDatabase(temp, {seed:false});
    try {
      const restoredTables = restored.sql.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name);
      const missingUpgraded = requiredTables.filter(table=>!restoredTables.includes(table));
      if (missingUpgraded.length || restored.sql.prepare('PRAGMA foreign_key_check').all().length) throw new Error('恢复副本关联或结构校验失败，原数据库保持不变');
      restored.sql.exec('DELETE FROM sessions; DELETE FROM password_reset_tokens; DELETE FROM idempotency_requests; DELETE FROM rate_limits');
    } finally { restored.close(); }
    const preserved = existsSync(dbPath) ? `${dbPath}.before-restore-${stamp}` : null;
    if (preserved) renameSync(dbPath, preserved);
    try { renameSync(temp, dbPath); }
    catch (error) { if (preserved && !existsSync(dbPath)) renameSync(preserved, dbPath); throw error; }
    console.log(JSON.stringify({ ok: true, restored: dbPath, previous: preserved, validatedTables: requiredTables.length, upgradedFromLegacy:legacy }));
  } else {
    throw new Error('用法：node tools/database.mjs backup [输出路径] 或 restore <备份路径> --offline。');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
