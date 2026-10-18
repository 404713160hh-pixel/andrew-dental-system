import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const files=['README.md','ARCHITECTURE.md','API-CONTRACT.md','DEPLOYMENT.md','REFACTOR-ACCEPTANCE.md'];
const escape=text=>text.replace(/[&<>"']/g,value=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[value]));
const sections=[];
for(const file of files){
  try{sections.push({file,text:readFileSync(resolve(root,file),'utf8')});}
  catch(error){if(error.code!=='ENOENT')throw error;}
}
const target=resolve(root,'docs/site');mkdirSync(target,{recursive:true});
writeFileSync(resolve(target,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>安德鲁牙科 · 使用与部署文档</title><style>body{font:16px/1.8 system-ui,"Microsoft YaHei",sans-serif;background:#f7f8fb;color:#273345;margin:0}header,main{max-width:1060px;margin:auto;padding:28px}a{color:#4b51b8}nav{display:flex;gap:16px;flex-wrap:wrap}section{margin:24px 0;padding:24px;background:white;border:1px solid #e4e7ee;border-radius:12px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.85 ui-monospace,monospace}h1{font-size:27px}small{color:#677487}</style><header><h1>安德鲁牙科 · 使用与部署文档</h1><p>当前发布包随附的源码说明、接口和运维步骤。</p><nav><a href="/customer/login">顾客入口</a><a href="/frontdesk/login">前台入口</a><a href="/doctor/login">医生入口</a><a href="/manager/login">店长入口</a></nav><small>数据范围与外部联调状态以验收记录为准。</small></header><main>${sections.map(({file,text})=>`<section id="${escape(file)}"><h2>${escape(file)}</h2><pre>${escape(text)}</pre></section>`).join('')}</main></html>`);
console.log(JSON.stringify({ok:true,documents:sections.map(item=>item.file),directory:target}));
