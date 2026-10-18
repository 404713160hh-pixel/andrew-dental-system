import { btn } from './ui.js';
export function pagination(value,action='page-offset'){
  if(!value?.entity)return '';
  const {total,limit,offset}=value;
  return `<nav class="pagination filter-bar" data-testid="pagination" aria-label="记录分页"><span class="hint">共 ${total} 条 · ${total?offset+1:0}–${Math.min(total,offset+limit)} 条</span>${btn('上一页',action,Math.max(0,offset-limit),'small',offset?'':'disabled')}${btn('下一页',action,offset+limit,'small',offset+limit<total?'':'disabled')}</nav>`;
}
