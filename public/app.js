// Browser entry: initialize the workspace and install event delegation once.
import { dialog, user, setCurrentPage } from './js/core/context.js';
import { toast } from './js/components/ui.js';
import { initialize } from './js/pages/auth.js';
import { syncSidebar } from './js/components/shell.js';
import { refresh } from './js/core/store.js';
import { handleAction } from './js/core/events.js';

document.addEventListener('click',e=>{
  if(e.target.closest('a[href="#care-section"]')){
    e.preventDefault();document.querySelector('#care-section')?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});return;
  }
  if(e.target.closest('.skip')){
    e.preventDefault();const main=document.querySelector('#main');
    if(main){main.setAttribute('tabindex','-1');main.focus({preventScroll:true});main.scrollIntoView({behavior:'instant'});}
    return;
  }
  if(!e.target.closest('.user-menu'))document.querySelectorAll('.user-menu[open]').forEach(menu=>{menu.open=false;});
  const button=e.target.closest('[data-action]');if(button&&!button.disabled){handleAction(button).catch(error=>toast(error.message,true));}
});
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.user-menu[open]').forEach(menu=>{menu.open=false;});});
window.addEventListener('resize',syncSidebar);
window.matchMedia?.('(max-width:850px)').addEventListener?.('change',syncSidebar);
window.addEventListener('hashchange',()=>{const value=location.hash.slice(1);if(value==='care-section'){setCurrentPage('home');if(user)refresh({reset:true}).catch(error=>toast(error.message,true));document.querySelector('#care-section')?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});return;}setCurrentPage(value||'home');if(user){refresh({reset:true}).catch(error=>toast(error.message,true));window.scrollTo({top:0,behavior:'instant'});}});
dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});

initialize();
