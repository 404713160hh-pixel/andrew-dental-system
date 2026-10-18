import { randomBytes, createHash } from 'node:crypto';
import { id, hashPassword, verifyPassword } from '../db.js';
import { fail, text, optionalText, version, requireObject } from './shared.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
export function isAccountActive(user) {return Boolean(user)&&user.active!==false&&user.active!==0&&!['disabled','departed'].includes(user.status);}
export function passwordPolicy(value) {if(typeof value!=='string'||value.length<10||value.length>128||!/[A-Za-z]/.test(value)||!/\d/.test(value))fail('密码需 10 至 128 位，并包含字母和数字',400,'PASSWORD_INVALID');return value;}
const username=value=>{const s=text(value,'账号',30);if(!/^[A-Za-z][A-Za-z0-9_]{2,29}$/.test(s))fail('账号须为 3 至 30 位，以字母开头，可包含数字和下划线',400,'USERNAME_INVALID');return s.toLowerCase();};
export function safeAccount(user) {return {...user,version:user.version||1,active:isAccountActive(user),status:user.status||(isAccountActive(user)?'active':'disabled')};}
const account=(db,key)=>{const row=db.sql.prepare('SELECT * FROM users WHERE id=?').get(text(key,'账号编号',100));if(!row)fail('账号不存在',404,'NOT_FOUND');return{row,user:safeAccount(JSON.parse(row.data))};};
const update=(db,user)=>{db.sql.prepare('UPDATE users SET data=? WHERE id=?').run(JSON.stringify(user),user.id);return safeAccount(user);};
const unique=(db,name)=>{if(db.sql.prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE').get(name))fail('账号已存在',409,'USERNAME_TAKEN');};
const patientAccounts=(db,patientId)=>db.sql.prepare("SELECT data FROM users WHERE role='customer' AND patient_id=?").all(patientId).map(r=>safeAccount(JSON.parse(r.data)));
const normalizePhone=value=>String(value||'').replace(/[\s-]/g,'');
export function assertRegistrationUnique(db,p) {
  if(db.sql.prepare("SELECT id FROM patients WHERE phone_normalized=? LIMIT 1").get(normalizePhone(p.phone)))fail('该联系电话已有患者档案，请到门诊核验后绑定账号；请勿重复建档',409,'PATIENT_EXISTS');
}
function insert(db,p,role,extra={}) {
  const name=username(p.username);unique(db,name);passwordPolicy(p.password);
  const user={id:id('USER'),username:name,name:text(p.name,'姓名',60),role,clinicIds:[],active:true,status:'active',version:1,createdAt:new Date().toISOString(),...extra};
  db.sql.prepare('INSERT INTO users(id,username,password_hash,data) VALUES(?,?,?,?)').run(user.id,name,hashPassword(p.password),JSON.stringify(user));return safeAccount(user);
}
export const accountCommands={
  'account.create':(db,user,p)=>{
    if(!['front','clinical','manager','hq'].includes(p.role))fail('员工岗位应为前台、医生、店长或总部');
    let clinicIds=[],dentistId;
    if(['front','manager'].includes(p.role)) {
      if(!Array.isArray(p.clinicIds)||p.clinicIds.length<1||p.clinicIds.length>100||new Set(p.clinicIds).size!==p.clinicIds.length)fail('前台或店长应分配至少一个门诊，且不能重复');
      clinicIds=p.clinicIds.map(key=>{const clinic=requireObject(db,'clinics',key);if(!clinic.active)fail('不能分配停用门诊');return clinic.id;});
    }
    if(p.role==='clinical') {
      const dentist=requireObject(db,'dentists',p.dentistId);if(!dentist.active)fail('不能绑定停用医生');dentistId=dentist.id;
      const users=db.sql.prepare('SELECT data FROM users WHERE dentist_id=?').all(dentist.id).map(r=>JSON.parse(r.data));
      if(users.some(isAccountActive))fail('该医生已有有效员工账号',409,'DENTIST_ACCOUNT_EXISTS');
    }
    return insert(db,p,p.role,{clinicIds,...(dentistId?{dentistId}:{}),createdBy:user.id});
  },
  'account.bindCustomer':(db,user,p)=>{
    const patient=requireObject(db,'patients',p.patientId);version(patient,p);
    if(patient.active===false||patient.mergedIntoId)fail('归并或停用档案不能绑定账号',409,'PATIENT_INACTIVE');
    if(patientAccounts(db,patient.id).length)fail('患者已有账号，请使用账号恢复流程',409,'PATIENT_ACCOUNT_EXISTS');
    const identityEvidence=text(p.identityEvidence,'机构身份核验依据',1000),reason=text(p.reason,'绑定原因',1000);
    return insert(db,{...p,name:patient.name},'customer',{patientId:patient.id,createdBy:user.id,identityVerifiedAt:new Date().toISOString(),identityEvidence,reason});
  },
  'account.assign':(db,user,p)=>{
    const {user:old}=account(db,p.id);version(old,p);
    if(!['front','clinical','manager'].includes(old.role))fail('只有前台、店长和医生账号需要门诊或医师归属');
    const reason=text(p.reason,'调岗或归属调整原因',1000);let changes;
    if(['front','manager'].includes(old.role)) {
      if(!Array.isArray(p.clinicIds)||!p.clinicIds.length||p.clinicIds.length>100||new Set(p.clinicIds).size!==p.clinicIds.length)fail('前台或店长必须分配至少一个有效门诊');
      const clinicIds=p.clinicIds.map(key=>{const clinic=requireObject(db,'clinics',key);if(!clinic.active)fail('不能分配停用门诊');return clinic.id;});changes={clinicIds};
    }else{
      const dentist=requireObject(db,'dentists',p.dentistId);if(!dentist.active)fail('不能绑定停用医生');
      if(db.sql.prepare('SELECT data FROM users WHERE dentist_id=? AND id<>? AND active=1').all(dentist.id,old.id).some(r=>isAccountActive(JSON.parse(r.data))))fail('该医生已有其他有效账号',409,'DENTIST_ACCOUNT_EXISTS');changes={dentistId:dentist.id,clinicIds:[]};
    }
    const result=update(db,{...old,...changes,assignmentReason:reason,assignmentChangedAt:new Date().toISOString(),assignmentChangedBy:user.id,version:old.version+1});
    db.sql.prepare('DELETE FROM sessions WHERE user_id=?').run(old.id);return result;
  },
  'account.status':(db,user,p)=>{
    const {user:old}=account(db,p.id);version(old,p);
    if(!['active','disabled','departed'].includes(p.status))fail('账号状态不正确');
    if(old.status==='departed'&&p.status==='active')fail('离职账号不能重新启用，请建立新账号',409,'ACCOUNT_DEPARTED');
    if(old.id===user.id&&p.status!=='active')fail('不能停用当前登录账号',409,'SELF_DISABLE');
    if(old.role==='hq'&&isAccountActive(old)&&p.status!=='active') {
      const active=db.sql.prepare("SELECT data FROM users WHERE role='hq' AND active=1").all().map(r=>JSON.parse(r.data)).filter(isAccountActive);
      if(active.length<=1)fail('必须保留至少一个有效总部账号',409,'LAST_HQ');
    }
    if(p.status==='active'&&old.role==='customer'&&patientAccounts(db,old.patientId).some(x=>x.id!==old.id&&isAccountActive(x)))fail('患者已有其他有效顾客账号',409,'PATIENT_ACCOUNT_EXISTS');
    if(p.status==='active'&&old.role==='clinical') {
      const dentist=requireObject(db,'dentists',old.dentistId);if(!dentist.active)fail('医生档案已停用');
      if(db.sql.prepare('SELECT data FROM users WHERE dentist_id=? AND id<>?').all(old.dentistId,old.id).some(r=>isAccountActive(JSON.parse(r.data))))fail('医生已有其他有效账号',409,'DENTIST_ACCOUNT_EXISTS');
    }
    const result=update(db,{...old,status:p.status,active:p.status==='active',statusReason:text(p.reason,'状态变更原因',1000),statusChangedAt:new Date().toISOString(),statusChangedBy:user.id,version:old.version+1});
    db.sql.prepare('DELETE FROM sessions WHERE user_id=?').run(old.id);db.sql.prepare('UPDATE password_reset_tokens SET consumed_at=? WHERE user_id=? AND consumed_at IS NULL').run(Date.now(),old.id);return result;
  },
  'password.change':(db,user,p)=>{
    const {row,user:old}=account(db,user.id);passwordPolicy(p.newPassword);
    if(typeof p.currentPassword!=='string'||p.currentPassword.length>128||!verifyPassword(p.currentPassword,row.password_hash))fail('当前密码不正确',403,'PASSWORD_MISMATCH');
    if(p.currentPassword===p.newPassword)fail('新密码不能与当前密码相同');
    db.sql.prepare('UPDATE users SET password_hash=?,data=? WHERE id=?').run(hashPassword(p.newPassword),JSON.stringify({...old,version:old.version+1,passwordChangedAt:new Date().toISOString()}),user.id);
    db.sql.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);db.sql.prepare('UPDATE password_reset_tokens SET consumed_at=? WHERE user_id=? AND consumed_at IS NULL').run(Date.now(),user.id);
    return{id:user.id,sessionsRevoked:true,loginRequired:true};
  },
  'account.issueRecovery':(db,user,p)=>{
    const {user:old}=account(db,p.id);version(old,p);if(!isAccountActive(old))fail('停用或离职账号不能恢复密码',409,'ACCOUNT_INACTIVE');
    const identityEvidence=text(p.identityEvidence,'身份核验依据',1000),reason=text(p.reason,'恢复原因',1000),token=randomBytes(32).toString('hex'),createdAt=Date.now(),expiresAt=createdAt+10*60000,tokenId=id('RESET');
    db.sql.prepare('UPDATE password_reset_tokens SET consumed_at=? WHERE user_id=? AND consumed_at IS NULL').run(createdAt,old.id);
    db.sql.prepare('INSERT INTO password_reset_tokens(id,user_id,token_hash,created_at,expires_at,issued_by,identity_evidence,reason) VALUES(?,?,?,?,?,?,?,?)').run(tokenId,old.id,hash(token),createdAt,expiresAt,user.id,identityEvidence,reason);
    db.sql.prepare("UPDATE account_recovery_requests SET status='issued',resolved_at=? WHERE user_id=? AND status='pending'").run(new Date().toISOString(),old.id);
    return{id:tokenId,userId:old.id,username:old.username,token,expiresAt,delivery:'机构核验后由总部管理员当面交付；本系统未发送短信或邮件'};
  }
};
export function requestPasswordRecovery(db,p) {
  // The response deliberately does not reveal whether the supplied account exists.
  const name=typeof p.username==='string'?p.username.trim().toLowerCase():'',portal=p.portal;
  if(name.length>30||!['customer','front','clinical','manager','hq'].includes(portal))fail('恢复入口或账号格式不正确');
  const row=db.sql.prepare('SELECT data FROM users WHERE username=? COLLATE NOCASE').get(name),user=row&&JSON.parse(row.data);
  if(user&&user.role===portal&&isAccountActive(user))db.sql.prepare("INSERT OR IGNORE INTO account_recovery_requests(id,user_id,requested_at,status) VALUES(?,?,?,'pending')").run(id('RECOVERY'),user.id,new Date().toISOString());
  return{ok:true,message:'如账号有效，恢复申请已登记。请携带身份凭证联系机构，由总部管理员核验并签发一次性恢复码。'};
}
export function consumePasswordRecovery(db,p) {
  const token=typeof p.token==='string'?p.token:'';passwordPolicy(p.newPassword);
  if(!/^[a-f0-9]{64}$/.test(token))fail('恢复码无效或已过期',400,'RECOVERY_INVALID');
  const reset=db.sql.prepare('SELECT * FROM password_reset_tokens WHERE token_hash=? AND consumed_at IS NULL AND expires_at>?').get(hash(token),Date.now());
  if(!reset)fail('恢复码无效或已过期',400,'RECOVERY_INVALID');
  const {user}=account(db,reset.user_id);if(!isAccountActive(user))fail('恢复码无效或已过期',400,'RECOVERY_INVALID');
  const used=db.sql.prepare('UPDATE password_reset_tokens SET consumed_at=? WHERE id=? AND consumed_at IS NULL').run(Date.now(),reset.id);if(used.changes!==1)fail('恢复码已经使用',409,'RECOVERY_INVALID');
  db.sql.prepare('UPDATE users SET password_hash=?,data=? WHERE id=?').run(hashPassword(p.newPassword),JSON.stringify({...user,version:user.version+1,passwordChangedAt:new Date().toISOString()}),user.id);
  db.sql.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
  db.sql.prepare("UPDATE account_recovery_requests SET status='resolved',resolved_at=? WHERE user_id=? AND status IN ('pending','issued')").run(new Date().toISOString(),user.id);
  // Keep the recovery audit free of clear tokens and passwords.
  db.sql.prepare('INSERT INTO audit(id,at,user_id,type,target_id,detail) VALUES(?,?,?,?,?,?)').run(id('LOG'),new Date().toISOString(),user.id,'password.recovered',user.id,JSON.stringify({tokenId:reset.id,sessionsRevoked:true}));
  return{ok:true,loginRequired:true};
}
