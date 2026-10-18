import { dialog, ui, state, user, busy, currentPage, pendingWriteConfirmation, setState, setUser, setBusy, setPendingWriteConfirmation, setCsrfToken } from './context.js';
import { esc, quarterNow, isoDay } from './format.js';
import { btn, toast } from '../components/ui.js';
import { api } from './api.js';
import { render, menu } from '../components/shell.js';
import { renderAuth } from '../pages/auth.js';
let requestSequence=0, unconfirmed=null;
export function workspaceQuery(){
  const page=menu().some(item=>item[0]===currentPage)?currentPage:'home';
  const q=new URLSearchParams({page,limit:String(ui.limit),offset:String(ui.offset)});
  if(page==='finance')q.set('reconciliationOffset',String(ui.reconciliationOffset||0));if(page==='settlements')q.set('pendingOffset',String(ui.pendingOffset||0));
  if(page==='patients'&&ui.patientSearch)q.set('q',ui.patientSearch);if(page==='accounts'&&ui.accountSearch)q.set('q',ui.accountSearch);
  if(page==='resources'){if(user.role==='front')ui.resourceTab='schedules';q.set('resource',ui.resourceTab);}
  if(page==='performance')q.set('quarter',ui.quarter||quarterNow());
  if(page==='booking'||page==='appointments'){
    const booking=page==='booking',clinic=booking?ui.bookingClinic:ui.appointmentClinic,dentist=booking?ui.bookingDentist:ui.appointmentDentist,date=booking?ui.bookingDate:ui.appointmentDate;
    if(clinic)q.set('clinicId',clinic);if(dentist)q.set('dentistId',dentist);
    if(!booking&&ui.appointmentStatus!=='all')q.set('status',ui.appointmentStatus);
    if(date){const start=new Date(date+'T00:00:00+08:00');q.set('from',start.toISOString());q.set('to',new Date(start.getTime()+86400000).toISOString());}
  }
  if(page==='appointments'&&window.DentalCalendar?.view!=='list'){
    const calendar=window.DentalCalendar,anchor=calendar.getDate()||isoDay(state?.now||new Date().toISOString());
    const dayStart=new Date(anchor+'T00:00:00+08:00'),weekday=new Date(anchor+'T00:00:00Z').getUTCDay();
    const from=new Date(dayStart.getTime()-(calendar.view==='week'?((weekday+6)%7)*86400000:0));
    q.set('from',from.toISOString());q.set('to',new Date(from.getTime()+(calendar.view==='week'?7:1)*86400000).toISOString());q.set('limit','100');q.set('offset','0');
  }
  return q;
}
export async function refresh({reset=false}={}){
  if(reset)ui.offset=0;
  const sequence=++requestSequence,query=workspaceQuery();
  const next=await api('workspace?'+query);
  if(query.get('page')==='appointments'&&window.DentalCalendar?.view!=='list'){
    const total=next.pagination.total;
    // Calendar queries load only the selected day/week; every server page in that range is merged.
    for(let offset=100;offset<total;offset+=400){
      const requests=[];for(let j=offset;j<Math.min(total,offset+400);j+=100){const part=new URLSearchParams(query);part.set('offset',String(j));requests.push(api('workspace?'+part));}
      for(const part of await Promise.all(requests))for(const key of ['appointments','patients','clinics','dentists','qualifications']){const rows=new Map(next[key].map(x=>[x.id,x]));for(const item of part[key])rows.set(item.id,item);next[key]=[...rows.values()];}
      if(sequence!==requestSequence)return;
    }
    next.calendarTotal=total;next.pagination=null;
  }
  if(sequence!==requestSequence)return;
  if(next.pagination?.total&&next.pagination.offset>=next.pagination.total){ui.offset=Math.floor((next.pagination.total-1)/ui.limit)*ui.limit;return refresh();}
  setState(next);setUser(next.user||user);ui.quarter ||= quarterNow();render();
}
export async function command(type,payload,success='已保存',retry=false){
  if(busy)return;
  if(pendingWriteConfirmation&&!retry){toast('上次提交结果尚未确认，请先核对或重试原操作。',true);return;}
  const operation=retry?unconfirmed:{type,payload:{...payload},success,key:crypto.randomUUID()};
  if(!operation)return;
  if(['payment.record','payment.refund'].includes(operation.type))operation.payload.idempotencyKey ||= operation.key;
  setBusy(true);const submit=dialog.querySelector('[type=submit]');if(submit)submit.disabled=true;
  try{
    const r=await api('command',{type:operation.type,payload:operation.payload},{headers:{'Idempotency-Key':operation.key}});
    setPendingWriteConfirmation(false);unconfirmed=null;dialog.close();
    if(r.result?.loginRequired){setUser(null);setState(null);setCsrfToken(null);renderAuth();toast('密码已更新，请重新登录。');return r.result;}
    try{await refresh();toast(operation.success);}catch(error){toast(`${operation.success}，但最新记录读取失败。请点击刷新核对。`,true);}
    return r.result;
  }catch(error){
    setPendingWriteConfirmation(Boolean(error.uncertainWrite));if(error.uncertainWrite)unconfirmed=operation;
    const errorBox=dialog.open?dialog.querySelector('.error-box'):null;
    const message=`<p>${esc(error.message)}</p>${pendingWriteConfirmation?`<p>请先核对最新记录。重试会使用同一操作标识和原始内容，避免重复登记。</p>${btn('核对最新记录','verify-command','','small')}${operation.type==='account.issueRecovery'?'':btn('重试原操作','retry-command','','small')}`:''}`;
    if(errorBox){errorBox.innerHTML=message;errorBox.scrollIntoView({block:'nearest'});}else toast(error.message,true);
  }finally{setBusy(false);if(submit)submit.disabled=pendingWriteConfirmation;}
}
export async function retryCommand(){if(unconfirmed)return command(unconfirmed.type,unconfirmed.payload,unconfirmed.success,true);}
export async function verifyLatestRecords(){await refresh();setPendingWriteConfirmation(false);unconfirmed=null;dialog.close();toast('已获取最新记录，请核对原操作是否已经完成。');}
export async function dialogWorkspace(page,extra={}){
  const q=new URLSearchParams({page,limit:'100',offset:'0',...extra});return api('workspace?'+q);
}
