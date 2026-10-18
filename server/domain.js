import { id } from './db.js';
import { permissionsByRole, publicUser } from './policies/permissions.js';
import { fail, audit, ApiError } from './services/shared.js';
import { command as patients } from './services/patients.js';
import { command as resources } from './services/resources.js';
import { command as appointments } from './services/appointments.js';
import { command as clinical } from './services/clinical.js';
import { command as reports } from './services/reports.js';
import { commands as businessCommands, extendState } from './services/business.js';
import { getState as readState, getWorkspace as readWorkspace } from './services/workspace.js';
export { ApiError, permissionsByRole, publicUser };
export function auditEvent(db,user,type,targetId,detail){audit(db,user,type,targetId,detail);}
export function getState(db,user){return extendState(db,user,readState(db,user));}
export function getWorkspace(db,user,options={}){return extendState(db,user,readWorkspace(db,user,options));}
const handlers={patient:patients,clinic:resources,dentist:resources,qualification:resources,schedule:resources,treatment:resources,appointment:appointments,visit:clinical,settlement:clinical,cost:reports,quarter:reports,settings:reports};
const entityTables={patient:'patients',clinic:'clinics',dentist:'dentists',qualification:'qualifications',schedule:'schedules',treatment:'treatments',appointment:'appointments',visit:'visits',cost:'costs',quarter:'quarterReports',settings:'settings'};
function redact(value){if(Array.isArray(value))return value.map(redact);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!/(password|token|csrf|secret)/i.test(key)).map(([key,v])=>[key,redact(v)]));return value;}
export function executeCommand(db,user,type,payload){
 if(!permissionsByRole[user.role]?.includes(type))fail('当前岗位无此操作权限',403,'FORBIDDEN');
 if(!payload||typeof payload!=='object'||Array.isArray(payload))fail('操作数据格式错误');
 if(payload.id!==undefined&&(typeof payload.id!=='string'||!payload.id||payload.id.length>100))fail('记录编号格式不正确');
 return db.transaction(()=>{
  const entityTable=entityTables[type.split('.')[0]],before=entityTable?(typeof payload.id==='string'?db.get(entityTable,payload.id):type==='settings.save'?db.get('settings','global'):null):null;
  const handler=businessCommands[type]||handlers[type.split('.')[0]];
  if(!handler)fail('未知操作',400,'UNKNOWN_COMMAND');
  const result=businessCommands[type]?handler(db,user,payload):handler(db,user,type,payload);
  if(result===undefined)fail('未知操作',400,'UNKNOWN_COMMAND');
  const record=Array.isArray(result)?null:result;
  audit(db,user,type,record?.id||payload.id||'',redact({clinicId:record?.clinicId||payload.clinicId||record?.createdClinicId||user.clinicIds?.[0],version:record?.version,before,after:record}));
  return result;
 });
}
