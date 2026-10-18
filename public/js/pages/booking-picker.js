import { dialog, state, user } from '../core/context.js';
import { esc, stamp, time, isoDay } from '../core/format.js';
import { customer } from '../core/selectors.js';
import { field, filterSelect, areaField, table, toast } from '../components/ui.js';
import { modal } from '../components/modal.js';
import { api } from '../core/api.js';
import { command } from '../core/store.js';
export async function showBookingPicker(patientId,appointment=null){
  if(!patientId){location.hash='patients';toast('请搜索患者，再从患者档案点击预约。');return;}
  let offset=0,filter={},sequence=0;
  modal(appointment?'查找改期时段':'为已核对患者查找时段',`<form id="slot-query" class="filter-bar">${field('接诊日期（选填）','date','','date',`min="${isoDay(state.now)}"`)}<div id="slot-clinic-filter"></div><div id="slot-dentist-filter"></div><button type="submit">查找时段</button></form><div id="slot-picker-results" aria-live="polite">正在查询可预约时段…</div>`);
  const form=dialog.querySelector('#slot-query');
  async function load(){
    const ticket=++sequence,body=dialog.querySelector('#slot-picker-results');if(!body)return;
    body.textContent='正在查询可预约时段…';
    const query=new URLSearchParams({page:'booking',patientId,limit:'10',offset:String(offset),...filter});
    if(filter.date){const start=new Date(filter.date+'T00:00:00+08:00');query.set('from',start.toISOString());query.set('to',new Date(start.getTime()+86400000).toISOString());query.delete('date');}
    try{
      const data=await api('workspace?'+query);if(ticket!==sequence||!body.isConnected)return;
      const patient=data.patients.find(p=>p.id===patientId);if(!patient)throw new Error('患者不在当前授权范围。');
      if(!form.querySelector('[name=clinicId]')){
        form.querySelector('#slot-clinic-filter').innerHTML=filterSelect('门诊','clinicId',data.clinics.map(c=>({value:c.id,label:c.name})));
        form.querySelector('#slot-dentist-filter').innerHTML=filterSelect('医生','dentistId',data.dentists.map(d=>({value:d.id,label:d.name})));
      }
      const name=(table,id)=>data[table].find(row=>row.id===id)?.name||id;
      body.innerHTML=`<p><strong>${esc(patient.name)}</strong> · ${esc(patient.id)}</p>${table(['时间','门诊 / 医生','余量','选择'],data.schedules.map(s=>[`${stamp(s.start)}–${time(s.end)}`,`${esc(name('clinics',s.clinicId))}<span class="cell-sub">${esc(name('dentists',s.dentistId))}</span>`,s.available,`<button type="button" class="small primary" data-picker-slot="${esc(s.id)}" ${s.available>0&&s.id!==appointment?.scheduleId?'':'disabled'}>选择</button>`]),'暂无匹配时段，请调整日期或联系前台。')}<nav class="filter-bar" aria-label="时段分页"><span class="hint">共 ${data.pagination.total} 个时段</span><button type="button" data-picker-page="prev" ${offset?'':'disabled'}>上一页</button><button type="button" data-picker-page="next" ${offset+10<data.pagination.total?'':'disabled'}>下一页</button></nav>`;
      body.querySelectorAll('[data-picker-page]').forEach(button=>button.addEventListener('click',()=>{offset=Math.max(0,offset+(button.dataset.pickerPage==='next'?10:-10));load();}));
      body.querySelectorAll('[data-picker-slot]').forEach(button=>button.addEventListener('click',()=>{const slot=data.schedules.find(s=>s.id===button.dataset.pickerSlot);dialog.close();confirmSlot(patient,slot,name,appointment);}));
    }catch(e){if(body.isConnected)body.textContent=e.message;}
  }
  form.addEventListener('submit',e=>{e.preventDefault();filter=Object.fromEntries([...new FormData(form)].filter(([,value])=>value));offset=0;load();});
  await load();
}
function confirmSlot(patient,slot,name,appointment){
 const details=`<div class="notice">${esc(patient.name)} · ${esc(patient.id)}<br>${esc(name('clinics',slot.clinicId))} · ${esc(name('dentists',slot.dentistId))}<br>${stamp(slot.start)}–${time(slot.end)}</div>`;
 if(appointment)modal('确认改期',details+`<p>原预约 ${stamp(appointment.start)}。改期失败时原预约保持有效。</p>${areaField('改期原因','reason','','required maxlength="500"')}`,'确认改期',f=>command('appointment.reschedule',{id:appointment.id,version:appointment.version,scheduleId:slot.id,reason:f.get('reason').trim()},'预约已调整'));
 else modal('确认预约',details+areaField('就诊问题','problem','','required maxlength="1000"')+areaField('特殊需求','specialNeeds','','maxlength="1000"'),'提交预约',f=>command('appointment.book',{patientId:patient.id,scheduleId:slot.id,problem:f.get('problem').trim(),specialNeeds:f.get('specialNeeds').trim()},'预约已确认'));
}
