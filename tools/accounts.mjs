import { createDatabase, hashPassword, id } from '../server/db.js';

const [mode, username, role, scope] = process.argv.slice(2);
const db = createDatabase(undefined, {seed:false});
try {
  if (mode === 'list') {
    console.log(JSON.stringify(db.sql.prepare('SELECT data FROM users ORDER BY username').all().map(row => {
      const user = JSON.parse(row.data);
      return { username: user.username, name: user.name, role: user.role, clinicIds: user.clinicIds, dentistId: user.dentistId };
    }), null, 2));
  } else {
    const password = process.env.DENTAL_ACCOUNT_PASSWORD;
    if (!password || password.length < 10 || password.length > 128 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) throw new Error('请用 DENTAL_ACCOUNT_PASSWORD 环境变量提供包含字母数字的10至128位密码。');
    if (!username || !/^[A-Za-z][A-Za-z0-9_]{2,29}$/.test(username)) throw new Error('账号须以字母开头，3至30位字母、数字或下划线。');
    if (mode === 'set-password') {
      const row = db.sql.prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE').get(username);
      if (!row) throw new Error('账号不存在。');
      db.transaction(() => {
        db.sql.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password), row.id);
        db.sql.prepare('DELETE FROM sessions WHERE user_id=?').run(row.id);
      });
      console.log('密码已更新，原会话已失效。');
    } else if (mode === 'create-staff') {
      if (!['front', 'clinical', 'manager'].includes(role)) throw new Error('岗位应为 front、clinical 或 manager。');
      const user = { id: id('USER'), username: username.toLowerCase(), name: process.env.DENTAL_ACCOUNT_NAME || username, role, clinicIds: [] };
      if (role === 'clinical') {
        if (!db.get('dentists', scope)) throw new Error('请提供有效牙医编号。');
        user.dentistId = scope;
      } else if (role !== 'manager') {
        const clinics = (scope || '').split(',').filter(Boolean);
        if (!clinics.length || clinics.some(clinicId => !db.get('clinics', clinicId))) throw new Error('请提供有效诊所编号，多个编号用逗号分隔。');
        user.clinicIds = [...new Set(clinics)];
      }
      db.sql.prepare('INSERT INTO users(id,username,password_hash,data) VALUES(?,?,?,?)').run(user.id, user.username, hashPassword(password), JSON.stringify(user));
      console.log(`已创建员工账号 ${user.username}，岗位 ${role}。`);
    } else throw new Error('用法：list | set-password <账号> | create-staff <账号> <岗位> [诊所编号或牙医编号]');
  }
} catch (error) {
  console.error(error.code?.startsWith('SQLITE_CONSTRAINT') ? '账号重复或关联资料无效。' : error.message);
  process.exitCode = 1;
} finally { db.close(); }
