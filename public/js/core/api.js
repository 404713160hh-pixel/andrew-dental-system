// core/api.js — one responsibility within the dental workspace.
import { root, dialog, csrfToken, busy, pendingRequests, setState, setUser, setCsrfToken, setPendingRequests } from './context.js';
import { renderAuth } from '../pages/auth.js';

export function requestLoading(active){
  setPendingRequests(Math.max(0,pendingRequests+(active?1:-1)));
  root.setAttribute('aria-busy',String(pendingRequests>0));
  if(pendingRequests&&!document.querySelector('.loading-strip')){
    const strip=document.createElement('div');strip.className='loading-strip';strip.setAttribute('aria-hidden','true');document.body.append(strip);
  }else if(!pendingRequests)document.querySelector('.loading-strip')?.remove();
}

export async function api(path, body, options={}){
  const controller=new AbortController();
  const opts={credentials:'same-origin',headers:{...(options.headers||{})},signal:controller.signal};
  if(body!==undefined){opts.method='POST';opts.headers['Content-Type']='application/json';opts.headers['X-CSRF-Token']=csrfToken||'';opts.body=JSON.stringify(body);}
  const timeout=setTimeout(()=>controller.abort(),20000);
  requestLoading(true);
  try{
    const r=await fetch(`/api/${path}`,opts);let data;
    try{data=await r.json();}catch{const error=new Error('服务响应不完整，请检查连接后核对最新状态。');error.code='RESPONSE_INVALID';error.uncertainWrite=body!==undefined;throw error;}
    if(!r.ok){if(r.status===401 && !['login','register','session'].includes(path)){setUser(null);setState(null);setCsrfToken(null);dialog.close();renderAuth();}const error=new Error(data.error||'操作未完成');error.code=data.code;throw error;}
    return data;
  }catch(error){
    if(error.name==='AbortError'||error instanceof TypeError){
      const failure=new Error(body!==undefined?'连接中断，提交结果尚未确认。请先核对最新状态。':error.name==='AbortError'?'读取超时，请检查连接后重新加载。':'无法连接服务，请检查网络或服务状态后重新加载。');
      failure.code=error.name==='AbortError'?'REQUEST_TIMEOUT':'NETWORK_ERROR';failure.uncertainWrite=body!==undefined;throw failure;
    }
    throw error;
  }finally{clearTimeout(timeout);requestLoading(false);}
}
