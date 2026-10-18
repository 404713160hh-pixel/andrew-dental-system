// pages/auth.js — one responsibility within the dental workspace.
import { root, ui, user, csrfToken, authMode, demoEnabled, pendingAuthConfirmation, authSubmitting, initializing, setState, setUser, setCsrfToken, setCurrentPage, setAuthMode, setDemoEnabled, setPendingAuthConfirmation, setAuthSubmitting, setInitializing } from '../core/context.js';
import { portals, portal, portalForRole, setPortalLocation } from '../core/portals.js';
import { esc, roleName } from '../core/format.js';
import { customer } from '../core/selectors.js';
import { icon, btn, field, toast } from '../components/ui.js';
import { api } from '../core/api.js';
import { refresh } from '../core/store.js';

export function authBrand(){return `<div class="brand"><div class="brand-mark">${icon('tooth')}</div><div><div class="brand-name">安德鲁牙科</div><div class="brand-sub">ANDREW'S DENTAL</div></div></div>`;}

export function portalLinks(){return `<details class="portal-links"><summary>${portal.role==='customer'?'员工入口':'其他岗位入口'} ${icon('chevron')}</summary><nav aria-label="选择登录入口">${Object.values(portals).filter(item=>item!==portal).map(item=>`<a href="${item.base}/login">${esc(item.name)}入口 ${icon('arrow')}</a>`).join('')}</nav></details>`;}

export function renderPortalMismatch(){
  const correct=portalForRole(user.role);
  document.title=`安德鲁牙科 · ${portal.name}入口`;
  root.innerHTML=`<main class="portal-notice portal-auth-${portal.role}" id="main"><a class="brand-link" href="${portal.base}/login">${authBrand()}</a><section class="portal-notice-card"><span class="portal-notice-icon">${icon('shield')}</span><p class="eyebrow">${esc(portal.eyebrow)}</p><h1>当前账户属于${esc(roleName(user.role))}工作区</h1><p>你已登录为 ${esc(user.name)}。这里是${esc(portal.name)}入口，请进入对应工作区，或退出后使用${esc(portal.name)}账号登录。</p><div class="quick-actions">${correct?`<a class="button primary" href="${correct.base}">进入${esc(correct.name)}工作区 ${icon('arrow')}</a>`:''}${btn('退出当前账户','logout')}</div><small>各岗位入口分别登录，业务操作由岗位与门诊授权控制。</small></section>${portalLinks()}</main>`;
}

export function renderConnectionIssue(message){
  document.title=`安德鲁牙科 · ${portal.name}入口`;
  root.innerHTML=`<main class="portal-notice portal-auth-${portal.role}" id="main">${authBrand()}<section class="portal-notice-card"><span class="portal-notice-icon">${icon('refresh')}</span><p class="eyebrow">${esc(portal.eyebrow)}</p><h1>暂时无法读取工作区</h1><p>${esc(message)}</p><div class="quick-actions">${btn('重新加载','retry-load','','primary')}${user?btn('退出登录','logout'):''}</div><small>重新加载只读取当前状态，不会重新提交业务操作。</small></section></main>`;
}

export function renderAuth(){
  if(user&&user.role!==portal.role){renderPortalMismatch();return;}
  const isCustomer=portal.role==='customer';
  if(!isCustomer)setAuthMode('login');
  setPortalLocation();document.title=`安德鲁牙科 · ${portal.name}${authMode==='register'?'注册':'登录'}`;
  const previous = document.querySelector('#auth-form');
  const username = previous?.querySelector('[name=username]')?.value || '';
  root.innerHTML = `<main class="auth portal-auth-${portal.role} ${isCustomer?'':'staff-auth'}" id="main">
    <section class="auth-intro">
      ${isCustomer?'<div class="auth-photo"><img src="/assets/dental-editorial.png" alt="温暖诊疗空间中的微笑人物示意" fetchpriority="high"></div>':'<div class="staff-auth-orbit" aria-hidden="true"><span></span><span></span><span></span></div>'}
      <div class="auth-topline">${authBrand()}<span>${esc(portal.name)}专属入口</span></div>
      <div class="auth-story"><p class="eyebrow">${esc(portal.eyebrow)}</p><h1>${portal.title}</h1><p>${portal.description}</p>${isCustomer?'<div class="auth-caption"><span>01 / ANDREW DENTAL CARE</span><span>预约 · 诊疗 · 关怀</span></div>':`<div class="staff-auth-features">${portal.features.map(([name,title,description])=>`<article>${icon(name)}<div><h2>${esc(title)}</h2><p>${esc(description)}</p></div></article>`).join('')}</div>`}</div>
      ${isCustomer?'':`<p class="staff-auth-scope">${icon('shield')}${portal.role==='manager'?'管理范围：全部门诊':'仅开放当前岗位与门诊授权范围内的业务'}</p>`}
    </section>
    <section class="auth-main"><div class="auth-card">
      <p class="eyebrow">${isCustomer?"WELCOME TO ANDREW'S":esc(portal.eyebrow)}</p><h2 class="auth-title">${authMode==='login'?esc(portal.loginTitle):'开启你的照护档案'}</h2>
      <p class="muted">${authMode==='login'?esc(portal.loginDescription):'建立个人账户，轻松预约与查看就诊记录。'}</p>
      ${isCustomer?`<div class="auth-tabs" role="group" aria-label="顾客账户操作">${btn('账号登录','auth-tab','login',authMode==='login'?'active':'',`aria-pressed="${authMode==='login'}"`)}${btn('顾客注册','auth-tab','register',authMode==='register'?'active':'',`aria-pressed="${authMode==='register'}"`)}</div>`:`<div class="staff-account-notice">${icon('shield')}<span>${esc(portal.name)}账号由机构分配，无公开注册入口。</span></div>`}
      <form id="auth-form" class="auth-form" data-testid="login-form">
        ${field(isCustomer?'用户名':portal.name+'账号','username',username,'text','required autocomplete="username" minlength="3" maxlength="30" placeholder="输入你的账号"')}
        ${authMode==='register'?field('本人姓名','name','','text','required maxlength="80" autocomplete="name" placeholder="填写本人姓名"')+field('联系电话','phone','','tel','required maxlength="30" autocomplete="tel" placeholder="方便诊所联系你"'):''}
        ${field('密码','password','','password',`required minlength="${authMode==='register'?10:1}" maxlength="128" autocomplete="${authMode==='register'?'new-password':'current-password'}" placeholder="输入账户密码"`)}
        ${authMode==='register'?'<p class="hint">密码至少 10 位，请包含字母和数字。</p>':''}
        <div id="auth-error" class="error-box" role="alert"></div>
        <button type="submit" class="primary" ${pendingAuthConfirmation?'disabled':''}>${authMode==='login'?'进入'+portal.name+'工作区':'创建顾客账号'}${icon('arrow')}</button>
      </form>
      <div class="quick-actions">${btn('忘记密码','recovery-request','','text-button')}${btn('使用恢复码','recovery-consume','','text-button')}</div>
      ${demoEnabled?`<details class="demo-box"><summary>演示体验 <span>合成示例数据</span></summary><p>本入口仅体验${esc(portal.name)}工作区。演示账号 <strong>${esc(portal.demo)}</strong>，密码 <strong>Dental2026!</strong>。</p><div class="demo-grid">${btn('填入'+portal.name+'演示账号','demo-login',portal.demo)}</div><p>演示就诊资料为合成示例，请勿输入真实个人或医疗信息。</p></details>`:''}
      ${portalLinks()}
      <div class="auth-footer"><a href="/docs/index.html" target="_blank" rel="noopener">调研与系统设计 ${icon('arrow')}</a><span>中南大学 · 系统分析与设计</span></div>
      ${isCustomer?'<p class="hint auth-image-note">人物与空间配图为 AI 生成示意</p>':''}
    </div></section>
  </main>`;
  if(pendingAuthConfirmation)document.querySelector('#auth-error').innerHTML=`<p>上次提交结果尚未确认，请先检查登录状态。</p>${btn('检查登录状态','verify-session','','small')}`;
  window.DentalMotion?.mount(root);
  document.querySelector('#auth-form').addEventListener('submit',async e=>{
    e.preventDefault();if(authSubmitting||pendingAuthConfirmation)return;
    const form=e.target,button=form.querySelector('[type=submit]');button.disabled=true;setAuthSubmitting(true);
    const mode=authMode,values={...Object.fromEntries(new FormData(form)),portal:portal.role};
    try{
      const r=await api(mode,values);setUser(r.user);setCsrfToken(r.csrfToken);setPendingAuthConfirmation(false);
      if(user.role!==portal.role){renderPortalMismatch();return;}
      ui.bookingDateInitialized=false;ui.bookingLimit=24;window.DentalCalendar?.reset();if(customer())window.DentalCalendar?.setView('list');setCurrentPage('home');history.replaceState(null,'',portal.base+'#home');
      try{await refresh();toast(mode==='register'?'账号已创建，请完善就诊资料。':'登录成功');}catch(error){if(user)renderConnectionIssue(error.message);}
    }catch(error){
      setPendingAuthConfirmation(Boolean(error.uncertainWrite));const errorBox=document.querySelector('#auth-error');
      if(errorBox)errorBox.innerHTML=`<p>${esc(error.message)}</p>${pendingAuthConfirmation?btn('检查登录状态','verify-session','','small'):''}`;
    }finally{setAuthSubmitting(false);if(button.isConnected)button.disabled=pendingAuthConfirmation;}
  });
}

export async function initialize(){
  if(initializing)return;setInitializing(true);
  try{
    const [configResult,sessionResult]=await Promise.allSettled([api('portal-config'),api('session')]);
    setDemoEnabled(configResult.status==='fulfilled'&&configResult.value.demoEnabled===true);
    if(sessionResult.status==='rejected'){
      const error=sessionResult.reason;
      if(error.code==='UNAUTHORIZED'){
        const wasUnconfirmed=pendingAuthConfirmation;setUser(null);setState(null);setCsrfToken(null);setPendingAuthConfirmation(false);renderAuth();
        if(wasUnconfirmed)document.querySelector('#auth-error').textContent='当前未检测到已登录会话。若刚才正在注册，请先尝试账号登录；不要重复创建账号。';
      }else renderConnectionIssue(error.message);
      return;
    }
    setUser(sessionResult.value.user);setCsrfToken(sessionResult.value.csrfToken);setPendingAuthConfirmation(false);
    if(user.role!==portal.role){setState(null);renderPortalMismatch();return;}
    if(customer())window.DentalCalendar?.setView('list');setCurrentPage(location.hash.slice(1)||'home');setPortalLocation(true);
    try{await refresh();}catch(error){if(user)renderConnectionIssue(error.message);}
  }finally{setInitializing(false);}
}
