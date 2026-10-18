import { id, quarterOf } from '../db.js';
import { fail, text, optionalText, money, version, requireObject, itemObject, dateTime, quarter, phone, email, dob, clinicAllowed, ensureClinic, eligiblePatientIds, ensurePatient, ensureAppointment, audit, save, profileComplete, quarterInterval, relevantPairs, sourceSignature, invalidateReports } from './shared.js';

export function command(db,user,type,p) {
  if(type==='cost.save') {
    const old=p.id?requireObject(db,'costs',p.id):null;if(old){ensureClinic(user,old.clinicId);version(old,p);}ensureClinic(user,p.clinicId);
    requireObject(db,'clinics',p.clinicId);requireObject(db,'dentists',p.dentistId);
    const q=quarter(p.quarter);if(q>quarterOf(Date.now()))fail('不能录入未来季度成本');
    if(db.count('costs',{where:{id:{$ne:old?.id||''},quarter:q,clinicId:p.clinicId,dentistId:p.dentistId}})>0)fail('此季度、门诊与牙医的成本已存在，请修改原记录',409,'DUPLICATE');
    if(old&&(old.quarter!==q||old.clinicId!==p.clinicId||old.dentistId!==p.dentistId))fail('成本归属不可改写，请修正原归属金额后另建记录');
    const result=save(db,'costs',old,{id:old?.id,quarter:q,clinicId:p.clinicId,dentistId:p.dentistId,supplies:money(p.supplies,'用品成本'),operations:money(p.operations,'运营费用'),evidence:text(p.evidence,'凭据与归属依据',2000),note:optionalText(p.note,'备注',1000),status:'draft',reviewHistory:[...(old?.reviewHistory||[]),{at:new Date().toISOString(),userId:user.id,action:old?'修订，审核失效':'新增',version:(old?.version||0)+1}]});
    invalidateReports(db,q,'成本新增或修订，原审核和基金测算失效');return result;
  }
  if(type==='cost.review') {
    const old=requireObject(db,'costs',p.id);ensureClinic(user,old.clinicId);version(old,p);if(old.status!=='draft')fail('成本已审核',409,'STATUS_CONFLICT');
    const result=save(db,'costs',old,{...old,status:'reviewed',reviewedBy:user.id,reviewedAt:new Date().toISOString(),reviewHistory:[...(old.reviewHistory||[]),{at:new Date().toISOString(),userId:user.id,action:'审核通过',version:old.version+1}]});
    invalidateReports(db,old.quarter,'成本审核版本变更，需重新核算');return result;
  }
  if(type==='quarter.compute') {
    const q=quarter(p.quarter);if(q>quarterOf(Date.now()))fail('不能核算未来季度');
    const clinicIds=null;
    const pairs=relevantPairs(db,q,clinicIds);if(!pairs.length)fail('此季度没有接诊资源或结算数据');
    const settlements=db.find('settlements',{where:{date:{$gte:new Date(quarterInterval(q)[0]).toISOString(),$lt:new Date(quarterInterval(q)[1]).toISOString()}}}).map(s=>({...s,total:s.total-(db.sql.prepare('SELECT COALESCE(SUM(amount),0) AS value FROM invoice_adjustments WHERE settlement_id=?').get(s.id).value)}));
    const costs=db.find('costs',{where:{quarter:q}});
    const rows=pairs.map(pair=>{
      const cost=costs.find(c=>c.clinicId===pair.clinicId&&c.dentistId===pair.dentistId);
      if(!cost||cost.status!=='reviewed')fail(`门诊 ${pair.clinicId} / 牙医 ${pair.dentistId} 成本缺失或未审核，不能按零确认`,409,'COST_INCOMPLETE');
      const revenue=settlements.filter(s=>s.clinicId===pair.clinicId&&s.dentistId===pair.dentistId).reduce((n,s)=>n+s.total,0);
      return{...pair,revenue,supplies:cost.supplies,operations:cost.operations,netProfit:revenue-cost.supplies-cost.operations,costId:cost.id,costVersion:cost.version,settlementIds:settlements.filter(s=>s.clinicId===pair.clinicId&&s.dentistId===pair.dentistId).map(s=>s.id)};
    });
    const revenue=rows.reduce((n,r)=>n+r.revenue,0),supplies=rows.reduce((n,r)=>n+r.supplies,0),operations=rows.reduce((n,r)=>n+r.operations,0),netProfit=revenue-supplies-operations;
    return save(db,'quarterReports',null,{quarter:q,rows,revenue,supplies,operations,netProfit,fund:Math.round(Math.max(0,netProfit)*0.1),fundRate:0.1,negativeProfitPolicy:'负净利润时基金测算为零，不进行个人分配',revenueBasis:'有效结算开单金额，非实际收款',status:'draft',createdAt:new Date().toISOString(),clinicIds:clinicIds||db.sql.prepare('SELECT id FROM clinics ORDER BY id').all().map(c=>c.id),scope:'chain',sourceSignature:sourceSignature(db,q,clinicIds),history:[]});
  }
  if(type==='quarter.approve') {
    const old=requireObject(db,'quarterReports',p.id);version(old,p);
    if(old.scope!=='chain')fail('旧门诊预览不能替代全连锁审批',409,'REPORT_SCOPE');
    if(old.status==='approved')fail('报告已确认',409,'STATUS_CONFLICT');
    if(old.sourceSignature!==sourceSignature(db,old.quarter,null))fail('来源已发生变更，请重新核算',409,'STALE_REPORT');
    return save(db,'quarterReports',old,{...old,status:'approved',approvedBy:user.id,approvedAt:new Date().toISOString(),history:[...(old.history||[]),{at:new Date().toISOString(),action:'总部确认',userId:user.id,version:old.version+1}]});
  }
  if(type==='settings.save') {
    if(!Number.isInteger(p.cancellationHours)||p.cancellationHours<0||p.cancellationHours>168)fail('取消截止时间应为 0 至 168 小时');
    const old=db.get('settings','global');version(old,p);
    return save(db,'settings',old,{...old,cancellationHours:p.cancellationHours});
  }
}
