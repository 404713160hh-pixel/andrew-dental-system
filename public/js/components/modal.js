// components/modal.js — one responsibility within the dental workspace.
import { dialog } from '../core/context.js';
import { esc } from '../core/format.js';
import { icon, btn } from './ui.js';
import { command } from '../core/store.js';

export function modal(title,body,submitLabel='',submit){dialog.innerHTML=`<div class="dialog-head"><h2 id="dialog-title">${esc(title)}</h2>${btn(icon('close'),'close','','','aria-label="关闭窗口"')}</div>${submitLabel?'<form id="dialog-form">':''}<div class="dialog-body">${body}<div class="error-box" role="alert"></div></div><div class="dialog-footer">${btn(submitLabel?'取消':'关闭','close')}${submitLabel?`<button type="submit" class="primary">${esc(submitLabel)}</button>`:''}</div>${submitLabel?'</form>':''}`;dialog.showModal();if(submit)dialog.querySelector('form').addEventListener('submit',e=>{e.preventDefault();submit(new FormData(e.target),e.target);});}

export function confirmCommand(title,body,type,payload,label='确认',success='操作已完成'){modal(title,body,label,()=>command(type,payload,success));}
