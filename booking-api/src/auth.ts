import { randomBytes, scrypt as rawScrypt, timingSafeEqual,createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { Principal, LoginResult, Assignment } from '@andrew/shared';
import type { Db } from './db.js';
import { one } from './db.js';
import { AppError,requireThat } from './errors.js';
import type { Config } from './config.js';
const scrypt=promisify(rawScrypt);
export const tokenHash=(token:string)=>createHash('sha256').update(token).digest('hex');
export async function hashPassword(password:string):Promise<string>{
 const salt=randomBytes(24).toString('hex');const hash=await scrypt(password,salt,64) as Buffer;
 return `scrypt:${salt}:${hash.toString('hex')}`;
}
async function verifyPassword(password:string,hash:string):Promise<boolean>{
 const [,salt,stored]=hash.split(':');if(!salt||!stored)return false;
 const actual=await scrypt(password,salt,64) as Buffer;const expected=Buffer.from(stored,'hex');
 return expected.length===actual.length&&timingSafeEqual(actual,expected);
}
export async function principal(db:Db,userId:string):Promise<Principal|undefined>{
 const user=await one<Principal>(db,`SELECT u.id,u.username,u.display_name AS "displayName",p.id AS "patientId",s.id AS "staffId",
 coalesce((SELECT jsonb_agg(jsonb_build_object('role',ra.role,'clinicId',ra.clinic_id)) FROM role_assignments ra WHERE ra.user_id=u.id),'[]') AS assignments
 FROM users u LEFT JOIN patients p ON p.user_id=u.id LEFT JOIN staff s ON s.user_id=u.id WHERE u.id=$1 AND u.active`,[userId]);
 if(!user)return undefined;
 user.roles=[...new Set([...(user.patientId?['patient' as const]:[]),...user.assignments.map(a=>a.role)])];
 return user;
}
export async function authenticate(db:Db,authorization:string|undefined):Promise<Principal>{
 requireThat(authorization?.startsWith('Bearer '),401,'UNAUTHENTICATED','请先登录');
 const session=await one<{user_id:string}>(db,'SELECT user_id FROM sessions WHERE token_hash=$1 AND expires_at>clock_timestamp()',[tokenHash(authorization!.slice(7))]);
 const user=session&&await principal(db,session.user_id);requireThat(user,401,'SESSION_EXPIRED','登录已失效，请重新登录');return user;
}
export async function login(db:Db,config:Config,input:{username:string;password?:string;portal:'patient'|'staff'},demo=false):Promise<LoginResult>{
 const record=await one<{id:string;password_hash:string}>(db,'SELECT id,password_hash FROM users WHERE username=$1 AND active',[input.username.toLowerCase()]);
 // A non-existent account still pays the hashing cost, avoiding a cheap timing oracle.
 const valid=demo||await verifyPassword(input.password??'',record?.password_hash??'scrypt:unavailable:'+ '00'.repeat(64));
 requireThat(record&&valid,401,'INVALID_CREDENTIALS','账号或密码不正确');
 const user=await principal(db,record.id);requireThat(user,401,'INVALID_CREDENTIALS','账号不可用');
 requireThat(input.portal==='patient'?!!user.patientId:user.assignments.length>0,403,'WRONG_PORTAL','当前账号不属于这个登录入口');
 const token=randomBytes(36).toString('base64url');const expiresAt=new Date(Date.now()+config.SESSION_HOURS*3600000).toISOString();
 await db.query('INSERT INTO sessions(token_hash,user_id,expires_at)VALUES($1,$2,$3)',[tokenHash(token),user.id,expiresAt]);
 return {token,expiresAt,user};
}
export function isHq(user:Principal){return user.roles.includes('hq');}
export function staffOnly(user:Principal){requireThat(user.assignments.length>0,403,'FORBIDDEN','需要员工权限');}
export function clinicAccess(user:Principal,clinicId:string,roles:Assignment['role'][]=['hq','manager','front','doctor']){
 requireThat(user.assignments.some(a=>roles.includes(a.role)&&(a.role==='hq'||a.clinicId===clinicId)),403,'CLINIC_SCOPE_DENIED','无权访问该门诊');
}
export function hqOnly(user:Principal){requireThat(isHq(user),403,'FORBIDDEN','此项共享资料仅由总部维护');}
export function scopeIds(user:Principal,roles:Assignment['role'][]=['hq','manager','front','doctor']):string[]|null{
 if(isHq(user)&&roles.includes('hq'))return null;
 return [...new Set(user.assignments.filter(a=>roles.includes(a.role)).flatMap(a=>a.clinicId?[a.clinicId]:[]))];
}
export function patientAccess(user:Principal,patientId:string){requireThat(user.patientId===patientId,404,'NOT_FOUND','未找到该患者资料');}
export const demoUsers=[['patient.a','演示患者·林晓','patient'],['patient.b','演示患者·周宁','patient'],['hq','总部管理员','staff'],['front.a','越秀门诊前台','staff'],['manager.a','越秀门诊店长','staff'],['doctor.a','陈医生','staff']] as const;
export async function audit(db:Db,actor:string|null,action:string,target:string|null,requestId:string,detail:unknown={}){
 await db.query('INSERT INTO audit_events(actor_id,action,target_id,request_id,detail)VALUES($1,$2,$3,$4,$5)',[actor,action,target,requestId,JSON.stringify(detail)]);
}
