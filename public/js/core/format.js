// core/format.js — one responsibility within the dental workspace.
import { state } from './context.js';

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export const money = n => '¥' + ((Number(n)||0)/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});

export const dateFmt = (value, options={}) => value ? new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',...options}).format(new Date(value)) : '—';

export const day = value => dateFmt(value,{year:'numeric',month:'2-digit',day:'2-digit'});

export const time = value => dateFmt(value,{hour:'2-digit',minute:'2-digit',hour12:false});

export const stamp = value => value ? `${day(value)} ${time(value)}` : '—';

export const isoDay = value => {const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));return `${parts.find(p=>p.type==='year').value}-${parts.find(p=>p.type==='month').value}-${parts.find(p=>p.type==='day').value}`;};

export const localInput = value => value ? `${isoDay(value)}T${time(value)}` : '';

export const quarterNow = () => {const d=isoDay(state?.now||new Date().toISOString());return `${d.slice(0,4)}-Q${Math.ceil(Number(d.slice(5,7))/3)}`;};

export const roleName = role => ({customer:'顾客',front:'前台',clinical:'医生',manager:'店长'}[role]||role);

export const statusName = s => ({booked:'已预约',cancelled:'已取消',attended:'已到诊',no_show:'未出席',open:'诊疗中',completed:'已完成',draft:'待审核',reviewed:'已审核',approved:'已批准'}[s]||s);

export function dateOffset(value,offset){return isoDay(new Date(new Date(`${isoDay(value)}T12:00:00+08:00`).getTime()+offset*86400000));}

export function quarterOf(value){const d=isoDay(value);return `${d.slice(0,4)}-Q${Math.ceil(Number(d.slice(5,7))/3)}`;}
