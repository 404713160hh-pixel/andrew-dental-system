// components/shell.js — one responsibility within the dental workspace.
import { root, state, user, currentPage, demoEnabled, setCurrentPage } from '../core/context.js';
import { portal, setPortalLocation } from '../core/portals.js';
import { esc, roleName } from '../core/format.js';
import { nameOf, can, customer } from '../core/selectors.js';
import { icon, btn } from './ui.js';
import { authBrand, renderPortalMismatch, renderAuth } from '../pages/auth.js';
import { homePage } from '../pages/home.js';
import { profilePage, patientsPage } from '../pages/patients.js';
import { bookingPage, appointmentsPage } from '../pages/appointments.js';
import { historyPage, visitsPage } from '../pages/clinical.js';
import { settlementsPage } from '../pages/billing.js';
import { resourcesPage } from '../pages/resources.js';
import { performancePage } from '../pages/reports.js';
import { auditPage, settingsPage } from '../pages/settings.js';
import { financePage } from '../pages/finance.js';
import { accountsPage } from '../pages/accounts.js';
import { pagination } from './pagination.js';
import { attachPageHandlers } from '../core/events.js';

export const pageNames={home:'工作概览',profile:'本人资料',booking:'预约就诊',appointments:'预约管理',history:'就诊与结算',patients:'患者档案',visits:'诊疗记录',settlements:'费用结算',resources:'诊所与资源',performance:'成本与业绩',audit:'操作记录',settings:'系统设置',finance:'收款与日结',accounts:'账号与权限'};

export function menu(){const items=[['home','home','工作概览']];if(customer())items.push(['booking','calendar','预约就诊'],['appointments','clock','我的预约'],['profile','user','本人资料'],['history','file','就诊与结算']);else{items.push(['appointments','calendar','预约管理']);if(can('patient.save'))items.push(['patients','users','患者档案']);items.push(['visits','tooth','诊疗记录']);if(can('settlement.create'))items.push(['settlements','wallet','费用结算']);if(can('payment.record'))items.push(['finance','wallet','收款与日结']);if(can('account.create'))items.push(['accounts','users','账号与权限']);if(['schedule.save','clinic.save','dentist.save','treatment.save'].some(can))items.push(['resources','clinic','诊所与资源']);if(can('cost.save')||can('quarter.compute'))items.push(['performance','chart',can('quarter.compute')?'季度业绩':'门店成本']);if(user.role==='hq')items.push(['audit','shield','操作记录']);if(can('settings.save'))items.push(['settings','settings','系统设置']);}return items;}

export function render(){
  if(user&&user.role!==portal.role){renderPortalMismatch();return;}
  if(!state||!user){renderAuth();return;}
  setPortalLocation(true);document.title=`安德鲁牙科 · ${portal.name}工作区`;
  const items=menu();if(!items.some(x=>x[0]===currentPage))setCurrentPage('home');
  const page={home:homePage,profile:profilePage,booking:bookingPage,appointments:appointmentsPage,history:historyPage,patients:patientsPage,visits:visitsPage,settlements:settlementsPage,resources:resourcesPage,performance:performancePage,audit:auditPage,settings:settingsPage,finance:financePage,accounts:accountsPage}[currentPage];
  const navigation=items.map(([id,i,n])=>`<a href="#${id}" class="${id===currentPage?'active':''}" ${id===currentPage?'aria-current="page"':''}>${icon(i)}${id==='home'&&customer()?'我的主页':n}</a>`).join('');
  const account=`<details class="user-menu"><summary><span class="avatar">${esc(user.name?.slice(0,1)||'A')}</span><span>${esc(user.name)}<small>${esc(roleName(user.role))}</small></span>${icon('chevron')}</summary><div>${customer()?'<a href="#profile">本人资料</a>':''}${btn('修改密码','password-change','','text-button')}${btn(icon('logout')+'退出登录','logout','','text-button','aria-label="退出登录"')}</div></details>`;
  const content=page()+pagination(state.pagination);
  const existing=root.querySelector('.shell');
  if(existing&&root.dataset.accountId===user.id){
    const main=root.querySelector('#main');main.innerHTML=content;main.dataset.testid='workspace-main';
    existing.querySelectorAll('nav a[href^="#"]').forEach(a=>{const active=a.getAttribute('href')==='#'+currentPage;a.classList.toggle('active',active);if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
    const crumb=existing.querySelector('.breadcrumb strong');if(crumb)crumb.textContent=pageNames[currentPage];
    attachPageHandlers();syncSidebar();window.DentalMotion?.mount(main);return;
  }
  root.dataset.accountId=user.id;
  if(customer()){
    root.innerHTML=`<div class="shell customer-shell"><header class="customer-header"><a class="brand-link" href="#home" aria-label="安德鲁牙科个人主页">${authBrand()}</a><nav class="customer-nav" aria-label="顾客导航">${navigation}</nav><div class="customer-header-actions">${btn(icon('refresh'),'refresh','','text-button','aria-label="刷新资料" title="刷新资料"')}${account}</div></header><main class="content customer-content" id="main" data-testid="workspace-main">${content}</main><footer class="customer-footer"><div>${authBrand()}<p>每一份关怀，连接每一次微笑。</p></div><div><a href="/docs/index.html" target="_blank" rel="noopener">调研与系统设计文档</a><p>中南大学 · 系统分析与设计课程演示</p><small>${demoEnabled?'就诊与结算资料为合成示例 · ':''}人物与空间配图为 AI 生成示意</small></div></footer></div>`;
  }else{
    const scope=user.role==='hq'?'全部门诊':user.clinicIds?.length?user.clinicIds.map(id=>nameOf('clinics',id)).join('、'):user.role==='clinical'?nameOf('dentists',user.dentistId):'授权门诊';
    root.innerHTML=`<div class="shell admin-shell"><aside class="sidebar" id="sidebar">${authBrand()}${btn(icon('close'),'mobile-menu','','sidebar-close','aria-label="关闭导航"')}<div class="clinic-switcher">${icon('clinic')}<div><strong>${esc(scope)}</strong><span>${esc(roleName(user.role))}工作区</span></div></div><div class="nav-label">诊所工作区</div><nav class="nav" aria-label="主要导航">${navigation}</nav><div class="side-footer"><a class="side-support" href="/docs/index.html" target="_blank" rel="noopener">${icon('file')}<span>系统设计文档<small>业务流程与使用说明</small></span>${icon('arrow')}</a><p>中南大学 · 系统分析与设计</p></div></aside><div class="workspace"><header class="topbar">${btn(icon('menu'),'mobile-menu','','mobile-menu','aria-label="打开导航" aria-controls="sidebar" aria-expanded="false"')}<div class="breadcrumb">工作区 <span>/</span><strong>${esc(pageNames[currentPage])}</strong></div><div class="top-actions"><a class="top-search" href="#${can('patient.save')?'patients':'appointments'}">${icon('search')}<span>${can('patient.save')?'查找患者':'查找预约'}</span></a>${btn(icon('refresh'),'refresh','','text-button','aria-label="刷新记录" title="刷新记录"')}${account}</div></header><main class="content" id="main" data-testid="workspace-main">${content}<div class="footer-note">安德鲁牙科 · 授权范围内的业务记录 · 结算金额不代表已收款</div></main></div></div>`;
  }
  attachPageHandlers();syncSidebar();window.DentalMotion?.mount(root);
}

export function syncSidebar(){const aside=document.querySelector('#sidebar');if(!aside)return;const mobile=window.matchMedia?.('(max-width:850px)').matches||false;const closed=mobile&&!aside.classList.contains('open');aside.inert=closed;aside.setAttribute('aria-hidden',String(closed));const control=document.querySelector('.mobile-menu');if(control){control.setAttribute('aria-expanded',String(!closed));control.setAttribute('aria-label',closed?'打开导航':'关闭导航');}}
