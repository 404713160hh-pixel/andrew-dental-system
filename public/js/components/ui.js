// components/ui.js — one responsibility within the dental workspace.
import { toastBox, user, toastTimer, setToastTimer } from '../core/context.js';
import { esc, statusName } from '../core/format.js';

export const icons = {
  refresh:'M20 7v5h-5M4 17v-5h5M6.1 6a8 8 0 0 1 13.6 4M4.3 14a8 8 0 0 0 13.6 4',chevron:'m8 10 4 4 4-4',left:'M20 12H4m6-6-6 6 6 6',down:'M12 4v16m-6-6 6 6 6-6',
  tooth:'M7 3c-2.2 0-4 1.6-4 4 0 4 2.1 4.6 2.4 8 .2 3.3 1 6 2.6 6 1.3 0 1.4-5 4-5s2.7 5 4 5c1.6 0 2.4-2.7 2.6-6C18.9 11.6 21 11 21 7c0-2.4-1.8-4-4-4-1.8 0-3 1.2-5 1.2S8.8 3 7 3Z',
  home:'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9',calendar:'M4 5h16v16H4zM8 3v4M16 3v4M4 10h16M8 14h2M14 14h2M8 17h2',
  user:'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21v-2a8 8 0 0 1 16 0v2',users:'M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21v-2a7 7 0 0 1 14 0v2M17 4a4 4 0 0 1 0 8M20 21v-2a7 7 0 0 0-3-6',
  file:'M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6',clinic:'M4 21V5h16v16M2 21h20M9 21v-5h6v5M10 8h4M12 6v4',chart:'M4 3v18h17M8 16v-5M13 16V7M18 16v-8',
  settings:'m12 3 2 3 3-.2.5 3 2.5 2-2.5 2-.5 3-3-.2-2 3-2-3-3 .2-.5-3L4 11l2.5-2 .5-3 3 .2 2-3ZM12 8a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  check:'m5 12 4 4L19 6',plus:'M12 4v16M4 12h16',arrow:'M4 12h16m-6-6 6 6-6 6',menu:'M4 6h16M4 12h16M4 18h16',close:'m6 6 12 12M18 6 6 18',shield:'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Zm-4 9 3 3 5-6',search:'M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm5 11 6 6',logout:'M10 4H4v16h6M9 12h12m-4-4 4 4-4 4',
  wallet:'M3 6h18v15H3zM3 6l14-3v3M15 11h6v5h-6z',clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l3 2',download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',print:'M6 9V3h12v6M6 17H3V9h18v8h-3M6 14h12v7H6z',
};

export const icon = name => `<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="${icons[name]||icons.file}"/></svg>`;

export const btn = (label, action, id='', cls='', extra='') => `<button type="button" class="${cls}" data-action="${action}" data-id="${esc(id)}" ${extra}>${label}</button>`;

export const badge = s => `<span class="badge ${{booked:'blue',cancelled:'red',attended:'teal',no_show:'gold',open:'gold',completed:'green',draft:'gold',reviewed:'teal',approved:'green'}[s]||''}">${esc(statusName(s))}</span>`;

export const empty = (text, action='') => `<div class="empty">${icon('file')}<p>${esc(text)}</p>${action}</div>`;

export const header = (title, subtitle, actions='') => `<div class="page-header"><div><h1>${title}</h1><p>${subtitle}</p></div><div class="page-actions">${actions}</div></div>`;

export const field = (label, name, value='', type='text', attrs='', full=false) => `<div class="field ${full?'full':''}"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="${type}" value="${esc(value)}" ${attrs}></div>`;

export const selectField = (label,name,options,value='',attrs='',full=false) => `<div class="field ${full?'full':''}"><label for="f-${name}">${label}</label><select id="f-${name}" name="${name}" ${attrs}>${options.map(o=>`<option value="${esc(o.value)}" ${String(o.value)===String(value)?'selected':''}>${esc(o.label)}</option>`).join('')}</select></div>`;

export const areaField = (label,name,value='',attrs='',full=true) => `<div class="field ${full?'full':''}"><label for="f-${name}">${label}</label><textarea id="f-${name}" name="${name}" ${attrs}>${esc(value)}</textarea></div>`;

export function filterSelect(label,name,opts,value=''){return selectField(label,name,[{value:'',label:'全部'},...opts],value);}

export const table = (heads, rows, noData='暂无记录') => rows.length ? `<div class="table-wrap"><table><thead><tr>${heads.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : empty(noData);

export function toast(text, error=false){clearTimeout(toastTimer);toastBox.textContent=text;toastBox.className=`show ${error?'error':''}`;setToastTimer(setTimeout(()=>toastBox.className='',4500));}

export function stats(items){return `<div class="stats">${items.map(([label,value,desc,i])=>`<div class="stat reveal"><div class="stat-top"><span>${esc(label)}</span>${icon(i)}</div><strong ${typeof value==='number'?`data-count="${value}"`:''}>${esc(value)}</strong><small>${esc(desc)}</small></div>`).join('')}</div>`;}
