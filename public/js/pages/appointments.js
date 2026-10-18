// pages/appointments.js — one responsibility within the dental workspace.
import { dialog, ui, state, user } from '../core/context.js';
import { esc, dateFmt, day, time, stamp, isoDay, statusName } from '../core/format.js';
import { nameOf, get, can, customer, options, profileComplete } from '../core/selectors.js';
import { icon, btn, badge, empty, header, field, selectField, areaField, filterSelect, table, toast } from '../components/ui.js';
import { command, refresh } from '../core/store.js';
import { modal } from '../components/modal.js';
import { patientDetails } from './patients.js';

export function availableSlots(){const now=new Date(state.now).getTime();return state.schedules.filter(s=>s.active&&new Date(s.start).getTime()>now&&(!ui.bookingClinic||s.clinicId===ui.bookingClinic)&&(!ui.bookingDentist||s.dentistId===ui.bookingDentist)&&(!ui.bookingDate||isoDay(s.start)===ui.bookingDate)).sort((a,b)=>a.start.localeCompare(b.start));}

export function slotCount(s){return s.bookedCount ?? state.appointments.filter(a=>a.scheduleId===s.id&&['booked','attended'].includes(a.status)).length;}

export function bookingFilters(){return `<form id="booking-filters" class="filter-bar">${filterSelect('就诊诊所','clinicId',options('clinics',c=>c.active),ui.bookingClinic)}${filterSelect('接诊牙医','dentistId',options('dentists',d=>d.active),ui.bookingDentist)}${field('就诊日期','date',ui.bookingDate,'date',`min="${isoDay(state.now)}"`)}<button type="submit" class="primary">${icon('search')}查找时段</button>${btn('清除','clear-booking-filter')}</form>`;}

export function slotCards(action='book-slot'){const slots=availableSlots();return slots.length?`<div class="slot-grid">${slots.map(s=>{const remaining=s.available ?? Math.max(0,s.capacity-slotCount(s));return `<article class="slot ${remaining?'':'full-slot'}"><span class="hint">${day(s.start)}</span><strong>${time(s.start)}–${time(s.end)}</strong><p>${esc(nameOf('clinics',s.clinicId))}</p><p>${esc(nameOf('dentists',s.dentistId))} · ${remaining?'可预约':'名额已满'}</p>${btn(remaining?'选择时段':'暂不可约',action,s.id,remaining?'primary':'',remaining?'':'disabled')}</article>`;}).join('')}</div>`:empty('没有符合条件的未来接诊时段。请更换日期，或联系诊所前台。');}

export function bookingDates(){
  const dates=[...new Set(state.schedules.filter(s=>s.active&&new Date(s.start)>new Date(state.now)&&(!ui.bookingClinic||s.clinicId===ui.bookingClinic)&&(!ui.bookingDentist||s.dentistId===ui.bookingDentist)).map(s=>isoDay(s.start)))].sort();
  const selectedIndex=dates.indexOf(ui.bookingDate),start=Math.max(0,selectedIndex-3);
  return `<div class="booking-date-strip" aria-label="快速选择就诊日期">${dates.slice(start,start+7).map(d=>{const count=state.schedules.filter(s=>s.active&&isoDay(s.start)===d&&new Date(s.start)>new Date(state.now)&&(!ui.bookingClinic||s.clinicId===ui.bookingClinic)&&(!ui.bookingDentist||s.dentistId===ui.bookingDentist)&&(s.available??s.capacity-slotCount(s))>0).length;return btn(`<span>${dateFmt(d+'T12:00:00+08:00',{weekday:'short'})}</span><strong>${dateFmt(d+'T12:00:00+08:00',{month:'numeric',day:'numeric'})}</strong><small>${count} 个可用时段</small>`,'booking-day',d,`date-choice ${d===ui.bookingDate?'active':''}`,`aria-pressed="${d===ui.bookingDate}"`);}).join('')}</div>`;
}

export function bookingPage(){
  ui.bookingDateInitialized=true;
  const p=get('patients',user.patientId);
  return header('留一点时间，照顾你的微笑。','先选择诊所、牙医与接诊日期，再挑选适合你的时段。')+(!profileComplete(p)?`<div class="notice warning">预约前请先完善本人就诊资料。<a href="#profile">去完善资料 ${icon('arrow')}</a></div>`:'')+(profileComplete(p)&&p.allergyStatus==='unknown'?'<div class="notice warning">本人过敏申报为“尚未核实”。可提交预约，到诊后请与工作人员核实，系统不会将其视为无过敏。</div>':'')+`<div class="booking-layout"><section class="card booking-main"><div class="card-head"><div><p class="section-kicker">FIND YOUR TIME</p><h2>选择接诊时段</h2></div>${icon('calendar')}</div>${bookingFilters()}${bookingDates()}<div class="card-head"><h3>${ui.bookingDate?day(ui.bookingDate+'T12:00:00+08:00')+' 的接诊安排':'可预约时段'}</h3><span class="hint">按接诊时间排列</span></div>${slotCards()}</section><aside class="booking-aside"><div class="booking-guide"><img src="/assets/clinic-interior.png" alt="诊疗空间示意" loading="lazy"><div><p class="section-kicker">WE'RE HERE FOR YOU</p><h2>提前了解，从容就诊。</h2><p>选择时段后，填写本次就诊问题与特殊需求。预约成功后可在“我的预约”中查看。</p><details><summary>需要调整预约？</summary><p>自助改期或取消通常需提前 ${esc(state.settings.cancellationHours)} 小时。临近就诊请联系诊所前台。</p></details><details><summary>就诊前需要准备什么？</summary><p>请核对本人联系方式、过敏申报与紧急联系人。尚未核实的过敏信息需在到诊时进一步核实。</p></details><details><summary>费用明细在哪里查看？</summary><p>治疗完成并生成结算单后，可在“就诊与结算”中查看和打印。结算单不代表已完成付款。</p></details></div></div></aside></div>`;
}

export function appointmentActions(a,includeDetail=true){
  let actions=includeDetail?btn('详情','appointment-detail',a.id,'small'):'';
  if(a.status==='booked'&&(customer()||can('appointment.cancel')))actions+=btn('改期','reschedule',a.id,'small')+btn('取消','cancel-appointment',a.id,'small danger');
  if(can('appointment.status')){
    if(a.status==='booked')actions+=btn('登记到诊','status-attended',a.id,'small primary',new Date(a.start)>new Date(state.now)?'disabled title="尚未到接诊时间"':'')+btn('未出席','status-no_show',a.id,'small',new Date(a.end)>new Date(state.now)?'disabled title="接诊时段尚未结束"':'');
    if(a.status==='no_show')actions+=btn('修正状态','status-booked',a.id,'small');
  }
  return actions?`<div class="table-actions">${actions}</div>`:'';
}

export function appointmentRow(a){return [customer()?esc(nameOf('clinics',a.clinicId)):`<strong>${esc(nameOf('patients',a.patientId))}</strong><span class="cell-sub">${esc(a.patientId)}</span>`,`<strong>${stamp(a.start)}</strong><span class="cell-sub">${time(a.start)}–${time(a.end)}</span>`,`${esc(nameOf('dentists',a.dentistId))}<span class="cell-sub">${esc(nameOf('clinics',a.clinicId))}</span>`,badge(a.status),`<span title="${esc(a.problem)}">${esc(a.problem?.slice(0,22))}</span>`,appointmentActions(a)];}

export function appointmentsPage(){
  const calendarItems=state.appointments.filter(a=>(ui.appointmentStatus==='all'||a.status===ui.appointmentStatus)&&(!ui.appointmentClinic||a.clinicId===ui.appointmentClinic)&&(!ui.appointmentDentist||a.dentistId===ui.appointmentDentist)).sort((a,b)=>b.start.localeCompare(a.start));
  const items=calendarItems.filter(a=>!ui.appointmentDate||isoDay(a.start)===ui.appointmentDate);
  const calendar=window.DentalCalendar;
  const calendarHtml=calendar?.render({appointments:calendarItems,dentists:state.dentists,clinics:state.clinics,now:state.now,patientName:id=>nameOf('patients',id),customer:customer(),escape:esc,onChange:()=>{ui.appointmentDate=calendar.view==='day'?calendar.getDate():'';refresh({reset:true}).catch(error=>toast(error.message,true));}})||'';
  const showList=!calendar||calendar.view==='list';
  return header(customer()?'我的预约':'预约与接诊日程',customer()?'每一次就诊，时间与安排都清晰可见。':'从日历查看安排，点击预约卡片核对详情。',customer()?'<a class="button primary" href="#booking">'+icon('plus')+'预约就诊</a>':can('appointment.book')?btn(icon('plus')+'代办预约','phone-book','','primary'):'')+`<section class="card appointment-view-card"><form id="appointment-filters" class="filter-bar">${filterSelect('接诊诊所','clinicId',options('clinics'),ui.appointmentClinic)}${filterSelect('接诊牙医','dentistId',options('dentists'),ui.appointmentDentist)}${selectField('预约状态','status',[{value:'all',label:'全部状态'},...['booked','attended','cancelled','no_show'].map(s=>({value:s,label:statusName(s)}))],ui.appointmentStatus)}${field('就诊日期','date',ui.appointmentDate,'date')}<button type="submit">${icon('search')}筛选</button>${btn('清除','clear-appointment-filter')}</form>${calendarHtml}${showList?table([customer()?'诊所':'患者','接诊时间','接诊安排','状态','就诊问题','操作'],items.map(appointmentRow),'暂无符合条件的预约'):''}</section>`;
}

export function showBook(s, patientId=''){const selected=patientId||user.patientId||state.patients[0]?.id;modal('确认预约',`<div class="notice">${esc(nameOf('clinics',s.clinicId))} · ${esc(nameOf('dentists',s.dentistId))}<br><strong>${stamp(s.start)}–${time(s.end)}</strong></div><div class="form-grid">${customer()?`<div class="field full"><label>就诊顾客</label><strong>${esc(nameOf('patients',user.patientId))}</strong></div>`:selectField('就诊患者 *','patientId',options('patients'),selected,'required',true)}${areaField('就诊问题 *','problem','','required maxlength="1000" placeholder="请简要描述本次希望解决的口腔问题。"')}${areaField('特殊需求（选填）','specialNeeds','','maxlength="1000" placeholder="如沟通、行动协助等需要提前安排的事项。"')}</div><p class="hint">提交成功后时段会被占用。预约前资料须完整并保存过敏申报。尚未核实的过敏信息会提示工作人员到诊核实。</p>`,'提交预约',f=>command('appointment.book',{patientId:customer()?user.patientId:f.get('patientId'),scheduleId:s.id,problem:f.get('problem').trim(),specialNeeds:f.get('specialNeeds').trim()},'预约已确认'));}


export function showAppointment(a){const p=get('patients',a.patientId);modal('预约详情',`<div class="card-head"><strong>${esc(nameOf('patients',a.patientId))} · ${esc(a.id)}</strong>${badge(a.status)}</div><div class="readonly-grid">${[['接诊诊所',nameOf('clinics',a.clinicId)],['接诊牙医',nameOf('dentists',a.dentistId)],['预约时间',`${stamp(a.start)}–${time(a.end)}`],['出席状态',a.attended?'已到诊':'尚未到诊']].map(([label,value])=>`<div><span>${label}</span><strong>${esc(value)}</strong></div>`).join('')}</div><div class="appointment-dialog-actions">${appointmentActions(a,false)}</div><h3>就诊问题</h3><p>${esc(a.problem)}</p><h3>特殊需求</h3><p>${esc(a.specialNeeds||'无')}</p>${a.cancelReason?`<h3>取消 / 改期原因</h3><p>${esc(a.cancelReason)}</p>`:''}${a.previousId?`<p class="hint">由原预约 ${esc(a.previousId)} 改期而来。</p>`:''}${p?`<hr style="border:0;border-top:1px solid var(--line);margin:20px 0"><h3>就诊资料核对</h3>${patientDetails(p)}`:''}`);}

export function showCancel(a){modal('取消预约',`<p>${esc(nameOf('clinics',a.clinicId))} · ${stamp(a.start)}</p><div class="notice warning">取消后释放该接诊时段。此记录和取消原因仍会保留。</div>${areaField('取消原因 *','reason','','required maxlength="500"')}`,'确认取消',f=>command('appointment.cancel',{id:a.id,reason:f.get('reason').trim(),version:a.version},'预约已取消'));}


export function showStatus(a,status){const label={attended:'登记到诊',no_show:'登记未出席',booked:'修正为已预约'}[status];modal(label,`<p><strong>${esc(nameOf('patients',a.patientId))}</strong> · ${stamp(a.start)} · ${esc(nameOf('dentists',a.dentistId))}</p><div class="notice">${status==='attended'?'到诊后建立就诊记录，交由接诊牙医填写治疗。':status==='no_show'?'未出席与取消预约分开记录。请核对患者实际到诊情况。':'修正用于纠正登记错误，请保留具体原因。'}</div>${areaField('登记原因 *','reason','','required maxlength="500"')}`,'确认登记',f=>command('appointment.status',{id:a.id,status,reason:f.get('reason').trim(),version:a.version},'出席状态已更新'));}
