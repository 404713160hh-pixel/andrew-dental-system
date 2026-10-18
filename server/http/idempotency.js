import { createHash } from 'node:crypto';
import { ApiError } from '../domain.js';

// Keep the business mutation and its replay record in the same transaction.
export function runIdempotent(db, user, key, input, operation) {
  if (key === undefined) return operation();
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) {
    throw new ApiError(400, '操作标识格式不正确，请重新打开表单', 'IDEMPOTENCY_INVALID');
  }
  const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return db.transaction(() => {
    const existing = db.sql.prepare('SELECT request_hash,response FROM idempotency_requests WHERE user_id=? AND key=?').get(user.id, key);
    if (existing) {
      if (existing.request_hash !== hash) throw new ApiError(409, '同一操作标识不能用于不同内容', 'IDEMPOTENCY_CONFLICT');
      if (input.type === 'account.issueRecovery') throw new ApiError(409, '恢复凭证仅显示一次，请重新核验并签发新凭证', 'RECOVERY_REISSUE_REQUIRED');
      return JSON.parse(existing.response);
    }
    const result = operation();
    db.sql.prepare('INSERT INTO idempotency_requests(user_id,key,request_hash,response,created_at) VALUES(?,?,?,?,?)')
      .run(user.id, key, hash, JSON.stringify(input.type === 'account.issueRecovery' ? { deliveredOnce: true } : result), Date.now());
    return result;
  });
}
