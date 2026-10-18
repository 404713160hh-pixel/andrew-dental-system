import { showBookingPicker } from '../pages/booking-picker.js';
import { financePage, showPayment, showPaymentDetail, showRefund, showVoid, showReconciliation } from '../pages/finance.js';
import { showAccountCreate, showAccountAssign, showAccountStatus, showAccountRecovery, showPasswordChange, showBindCustomer } from '../pages/accounts.js';
import { showMergePatient } from '../pages/identity.js';
import { showRecoveryRequest, showRecoveryConsume } from '../pages/recovery.js';
// core/events.js — one responsibility within the dental workspace.
import { dialog, ui, state, demoEnabled, pendingWriteConfirmation, pendingAuthConfirmation, authSubmitting, setState, setUser, setCsrfToken, setCurrentPage, setAuthMode, setPendingWriteConfirmation, setPendingAuthConfirmation } from './context.js';
import { portal } from './portals.js';
import { esc, money, day, quarterNow } from './format.js';
import { nameOf, get, customer } from './selectors.js';
import { toast } from '../components/ui.js';
import { api } from './api.js';
import { refresh, command, verifyLatestRecords, retryCommand } from './store.js';
import { modal, confirmCommand } from '../components/modal.js';
import { renderAuth, initialize } from '../pages/auth.js';
import { syncSidebar } from '../components/shell.js';
import { patientDetails, showPatientForm, allergyRow, showPatientLookup } from '../pages/patients.js';
import { showBook, showAppointment, showCancel, showStatus } from '../pages/appointments.js';
import { visitDetails, treatmentRow, showVisitEdit, showAddendum } from '../pages/clinical.js';
import { invoiceHtml, showInvoice } from '../pages/billing.js';
import { showResource } from '../pages/resources.js';
import { reportCard, showCost } from '../pages/reports.js';

export function attachPageHandlers(){document.querySelector('#account-search')?.addEventListener('submit',e=>{e.preventDefault();ui.accountSearch=new FormData(e.target).get('q').trim();refresh({reset:true}).catch(error=>toast(error.message,true));});document.querySelector('#booking-filters')?.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.target);ui.bookingClinic=f.get('clinicId');ui.bookingDentist=f.get('dentistId');ui.bookingDate=f.get('date');ui.bookingDateInitialized=true;ui.bookingLimit=25;refresh({reset:true}).catch(error=>toast(error.message,true));});document.querySelector('#appointment-filters')?.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.target);ui.appointmentStatus=f.get('status');ui.appointmentDate=f.get('date');ui.appointmentClinic=f.get('clinicId');ui.appointmentDentist=f.get('dentistId');if(ui.appointmentDate){window.DentalCalendar?.setDate(ui.appointmentDate);window.DentalCalendar?.setView('day');}if(ui.appointmentStatus==='cancelled')window.DentalCalendar?.setView('list');refresh({reset:true}).catch(error=>toast(error.message,true));});document.querySelector('#patient-search')?.addEventListener('submit',e=>{e.preventDefault();ui.patientSearch=new FormData(e.target).get('query').trim();refresh({reset:true}).catch(error=>toast(error.message,true));});document.querySelector('#quarter-filter')?.addEventListener('submit',e=>{e.preventDefault();ui.quarter=new FormData(e.target).get('quarter');refresh({reset:true}).catch(error=>toast(error.message,true));});document.querySelector('#settings-form')?.addEventListener('submit',e=>{e.preventDefault();command('settings.save',{cancellationHours:Number(new FormData(e.target).get('cancellationHours')),version:state.settings.version},'预约规则已更新');});}

export async function handleAction(button){const action=button.dataset.action,id=button.dataset.id;switch(action){
  case 'recovery-request':showRecoveryRequest();break;
  case 'recovery-consume':showRecoveryConsume();break;
  case 'password-change':showPasswordChange();break;
  case 'payment-record':showPayment(get('settlements',id));break;
  case 'payment-detail':showPaymentDetail(get('settlements',id));break;
  case 'payment-refund':showRefund(get('payments',id));break;
  case 'settlement-void':showVoid(get('settlements',id));break;
  case 'reconciliation-new':showReconciliation();break;
  case 'visit-addendum':showAddendum(get('visits',id));break;
  case 'patient-merge':showMergePatient(get('patients',id));break;
  case 'customer-bind':showBindCustomer(get('patients',id));break;
  case 'account-new':showAccountCreate();break;
  case 'account-assign':showAccountAssign(get('accounts',id));break;
  case 'account-status':showAccountStatus(get('accounts',id));break;
  case 'account-recovery':showAccountRecovery(get('accounts',id));break;
  case 'account-locate':ui.accountSearch=id;await refresh({reset:true});break;
  case 'reconciliation-offset':ui.reconciliationOffset=Number(id);await refresh();break;
  case 'pending-offset':ui.pendingOffset=Number(id);await refresh();break;
  case 'page-offset':ui.offset=Number(id);await refresh();document.querySelector('#main')?.scrollIntoView({block:'start'});break;
  case 'retry-command':await retryCommand();break;
  case 'merge-target':break;
  case 'close':dialog.close();break;
  case 'auth-tab':if(portal.role==='customer'&&!authSubmitting&&!pendingAuthConfirmation&&['login','register'].includes(id)){setAuthMode(id);renderAuth();}break;
  case 'demo-login':if(demoEnabled&&id===portal.demo&&!pendingAuthConfirmation&&!authSubmitting){setAuthMode('login');renderAuth();document.querySelector('[name=username]').value=id;document.querySelector('[name=password]').value='Dental2026!';document.querySelector('[type=submit]').focus();}break;
  case 'logout':button.disabled=true;try{await api('logout',{});window.DentalCalendar?.reset();setUser(null);setState(null);setCsrfToken(null);setPendingWriteConfirmation(false);setPendingAuthConfirmation(false);renderAuth();toast('已退出登录');}catch(e){toast(e.uncertainWrite?'退出结果尚未确认，请重新加载检查登录状态。':e.message,true);}finally{if(button.isConnected)button.disabled=false;}break;
  case 'retry-load':case 'verify-session':button.disabled=true;try{await initialize();}finally{if(button.isConnected)button.disabled=false;}break;
  case 'verify-command':button.disabled=true;try{await verifyLatestRecords();}finally{if(button.isConnected)button.disabled=false;}break;
  case 'refresh':button.disabled=true;try{if(pendingWriteConfirmation)await verifyLatestRecords();else{await refresh();toast('已获取最新记录');}}catch(e){toast(e.message,true);}finally{if(button.isConnected)button.disabled=false;}break;
  case 'mobile-menu':document.querySelector('#sidebar').classList.toggle('open');syncSidebar();break;
  case 'patient-new':showPatientForm();break;
  case 'patient-lookup':showPatientLookup();break;
  case 'patient-edit':showPatientForm(get('patients',id));break;
  case 'patient-detail':{const p=get('patients',id);modal('患者档案',`<h3>${esc(p.name)} · ${esc(p.id)}</h3>${patientDetails(p)}`);break;}
  case 'allergy-add':dialog.querySelector('#allergy-rows').insertAdjacentHTML('beforeend',allergyRow());break;
  case 'treatment-add':dialog.querySelector('#treatment-rows').insertAdjacentHTML('beforeend',treatmentRow());break;
  case 'remove-row':button.parentElement.remove();break;
  case 'clear-booking-filter':ui.bookingClinic='';ui.bookingDentist='';ui.bookingDate='';ui.bookingDateInitialized=true;ui.bookingLimit=25;refresh({reset:true}).catch(error=>toast(error.message,true));break;
  case 'more-slots':ui.offset+=ui.limit;await refresh();break;
  case 'clear-appointment-filter':ui.appointmentStatus='all';ui.appointmentDate='';ui.appointmentClinic='';ui.appointmentDentist='';await refresh({reset:true});break;
  case 'clear-patient-search':ui.patientSearch='';await refresh({reset:true});break;
  case 'booking-day':ui.bookingDate=id;ui.bookingDateInitialized=true;ui.bookingLimit=25;refresh({reset:true}).catch(error=>toast(error.message,true));requestAnimationFrame(()=>{const selected=document.querySelector(`[data-action="booking-day"][data-id="${CSS.escape(id)}"]`);selected?.focus({preventScroll:true});selected?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});});break;
  case 'choose-clinic':ui.bookingClinic=id;ui.bookingDentist='';ui.bookingDateInitialized=false;setCurrentPage('booking');if(location.hash==='#booking')await refresh({reset:true});else location.hash='booking';break;
  case 'clinic-scroll':{const carousel=document.querySelector('#clinic-carousel');if(carousel)carousel.scrollBy({left:Number(id)*carousel.clientWidth*.8,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});break;}
  case 'book-slot':showBook(get('schedules',id));break;
  case 'phone-book':await showBookingPicker(id);break;
  case 'appointment-detail':showAppointment(get('appointments',id));break;
  case 'cancel-appointment':showCancel(get('appointments',id));break;
  case 'reschedule':{const appointment=get('appointments',id);await showBookingPicker(appointment.patientId,appointment);}break;
  case 'status-attended':case 'status-no_show':case 'status-booked':showStatus(get('appointments',id),action.slice(7));break;
  case 'visit-detail':modal('就诊详情',visitDetails(get('visits',id)));break;
  case 'visit-edit':showVisitEdit(get('visits',id));break;
  case 'visit-complete':{const v=get('visits',id);confirmCommand('完成本次诊疗',`<p>请核对实际治疗和诊疗记录。完成后将保留当前版本，不再直接编辑。</p>${visitDetails(v)}`,'visit.complete',{id,version:v.version},'确认完成','诊疗已完成，可生成结算单');break;}
  case 'settlement-new':{const v=get('visits',id);confirmCommand('核对结算明细',visitDetails(v),'settlement.create',{visitId:id},'生成结算单','结算单已生成');break;}
  case 'invoice':showInvoice(get('settlements',id));break;
  case 'print-invoice':document.querySelector('#print-area').innerHTML=invoiceHtml(get('settlements',id));window.print();break;
  case 'resource-tab':ui.resourceTab=id;await refresh({reset:true});break;
  case 'resource-new':showResource(id);break;
  case 'resource-edit':{const type=button.dataset.type;showResource(type,get({clinic:'clinics',dentist:'dentists',qualification:'qualifications',treatment:'treatments',schedule:'schedules'}[type],id));break;}
  case 'cost-new':showCost();break;
  case 'cost-edit':showCost(get('costs',id));break;
  case 'cost-review':{const c=get('costs',id);confirmCommand('审核季度成本',`<p>${esc(c.quarter)} · ${esc(nameOf('clinics',c.clinicId))} · ${esc(nameOf('dentists',c.dentistId))}</p><p>用品成本 ${money(c.supplies)}；运营费用 ${money(c.operations)}</p><h3>凭据 / 归属依据</h3><p>${esc(c.evidence)}</p>`,'cost.review',{id,version:c.version},'确认审核','成本已审核');break;}
  case 'quarter-compute':confirmCommand('核算季度业绩',`<p>核算季度：<strong>${esc(ui.quarter||quarterNow())}</strong></p><div class="notice">系统按有效结算单汇总收入，检查各诊所与牙医成本完整性。所有相关成本须经过审核。</div>`,'quarter.compute',{quarter:ui.quarter||quarterNow()},'核算报告','季度报告已生成');break;
  case 'quarter-approve':{const r=get('quarterReports',id);confirmCommand('批准季度报告',reportCard(r,false)+'<p class="hint">批准前请核对收入、成本凭据及基金范围。此步骤不执行个人奖金发放。</p>','quarter.approve',{id,version:r.version},'确认批准','季度报告已批准');break;}
}}
