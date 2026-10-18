import { createHash } from 'node:crypto';
import { id, quarterOf } from '../db.js';
import { fail, text, optionalText, money, version, requireObject, ensureClinic, invalidateReports, authorizationScope } from './shared.js';

const now=()=>new Date().toISOString();
export const camel=row=>row&&Object.fromEntries(Object.entries(row).map(([key,value])=>[key.replace(/_([a-z])/g,(_,letter)=>letter.toUpperCase()),value]));
const amount=(value,label)=>{money(value,label);if(value===0)fail(`${label}必须大于零`);return value;};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function financeSummary(db,settlement) {
  const paid=db.sql.prepare('SELECT coalesce(sum(amount),0) amount FROM payments WHERE settlement_id=?').get(settlement.id).amount;
  const refunded=db.sql.prepare('SELECT coalesce(sum(r.amount),0) amount FROM refunds r JOIN payments p ON p.id=r.payment_id WHERE p.settlement_id=?').get(settlement.id).amount;
  const voided=db.sql.prepare('SELECT coalesce(sum(amount),0) amount FROM invoice_adjustments WHERE settlement_id=?').get(settlement.id).amount;
  const netPaid=paid-refunded,receivable=settlement.total-voided;
  return {settlementId:settlement.id,total:settlement.total,voided,receivable,paid,refunded,netPaid,balance:receivable-netPaid,status:voided?'void':netPaid===receivable?'paid':netPaid?'partial':'unpaid'};
}
export function financeSummaries(db,settlements) {
  const sums=new Map(settlements.map(s=>[s.id,{paid:0,refunded:0,voided:0}]));
  for(let i=0;i<settlements.length;i+=500) {
    const ids=settlements.slice(i,i+500).map(s=>s.id),marks=ids.map(()=>'?').join(',');
    const queries=[['paid',`SELECT settlement_id id,sum(amount) amount FROM payments WHERE settlement_id IN (${marks}) GROUP BY settlement_id`],['refunded',`SELECT p.settlement_id id,sum(r.amount) amount FROM refunds r JOIN payments p ON p.id=r.payment_id WHERE p.settlement_id IN (${marks}) GROUP BY p.settlement_id`],['voided',`SELECT settlement_id id,sum(amount) amount FROM invoice_adjustments WHERE settlement_id IN (${marks}) GROUP BY settlement_id`]];
    for(const [field,query]of queries)for(const row of db.sql.prepare(query).all(...ids))sums.get(row.id)[field]=row.amount;
  }
  return settlements.map(s=>{const values=sums.get(s.id),netPaid=values.paid-values.refunded,receivable=s.total-values.voided;return{settlementId:s.id,total:s.total,...values,receivable,netPaid,balance:receivable-netPaid,status:values.voided?'void':netPaid===receivable?'paid':netPaid?'partial':'unpaid'};});
}
function idempotent(db,user,type,p,work) {
  const key=`finance:${text(p.idempotencyKey,'操作唯一标识',100)}`, requestHash=digest({type,payload:{...p,idempotencyKey:undefined},scope:authorizationScope(user)});
  const old=db.sql.prepare('SELECT request_hash,response FROM idempotency_requests WHERE user_id=? AND key=?').get(user.id,key);
  if(old){if(old.request_hash!==requestHash)fail('相同操作标识不能用于不同金额或业务',409,'IDEMPOTENCY_CONFLICT');return JSON.parse(old.response);}
  const result=work();
  db.sql.prepare('INSERT INTO idempotency_requests(user_id,key,request_hash,response,created_at) VALUES(?,?,?,?,?)').run(user.id,key,requestHash,JSON.stringify(result),Date.now());
  return result;
}
function invoice(db,user,invoiceId) {const s=requireObject(db,'settlements',invoiceId);ensureClinic(user,s.clinicId);return s;}
function dailyEntries(db,clinicId,businessDate) {
  const start=new Date(`${businessDate}T00:00:00+08:00`).toISOString(),end=new Date(Date.parse(start)+86400000).toISOString();
  const payments=db.sql.prepare('SELECT p.* FROM payments p JOIN settlements s ON s.id=p.settlement_id WHERE s.clinic_id=? AND p.recorded_at>=? AND p.recorded_at<? ORDER BY p.id').all(clinicId,start,end);
  const refunds=db.sql.prepare('SELECT r.*,p.method FROM refunds r JOIN payments p ON p.id=r.payment_id JOIN settlements s ON s.id=p.settlement_id WHERE s.clinic_id=? AND r.recorded_at>=? AND r.recorded_at<? ORDER BY r.id').all(clinicId,start,end);
  const expected={cash:0,bank:0,pos:0};for(const p of payments)expected[p.method]+=p.amount;for(const r of refunds)expected[r.method]-=r.amount;
  return{payments,refunds,expected,sourceSignature:digest({payments,refunds})};
}
const day=value=>{const d=text(value,'营业日期',10);if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d)fail('营业日期格式不正确');if(d>new Date(Date.now()+8*3600000).toISOString().slice(0,10))fail('不能核对未来营业日');return d;};
const signedMoney=(value,label)=>{if(!Number.isSafeInteger(value)||Math.abs(value)>100000000000)fail(`${label}应为有符号整数分`);return value;};
export function reconciliationState(db,row) {const entry=camel(row),daily=dailyEntries(db,entry.clinicId,entry.businessDate);return{...entry,stale:daily.sourceSignature!==entry.sourceSignature,difference:entry.observedCash+entry.observedBank+entry.observedPos-entry.expectedCash-entry.expectedBank-entry.expectedPos};}
export const financeCommands={
  'reconciliation.preview':(db,user,p)=>{
    const clinic=requireObject(db,'clinics',p.clinicId);ensureClinic(user,clinic.id);const businessDate=day(p.businessDate),daily=dailyEntries(db,clinic.id,businessDate);
    return{clinicId:clinic.id,businessDate,expectedCash:daily.expected.cash,expectedBank:daily.expected.bank,expectedPos:daily.expected.pos,paymentCount:daily.payments.length,refundCount:daily.refunds.length,sourceSignature:daily.sourceSignature};
  },
  'payment.record':(db,user,p)=>idempotent(db,user,'payment.record',p,()=>{
    const s=invoice(db,user,p.settlementId),summary=financeSummary(db,s),value=amount(p.amount,'收款金额');
    if(summary.status==='void')fail('已冲销账单不能收款',409,'INVOICE_VOID');
    if(value>summary.balance)fail('收款超过当前欠款，请刷新账单',409,'OVERPAYMENT');
    if(!['cash','bank','pos'].includes(p.method))fail('请选择现金、银行或 POS');
    const result={id:id('PAY'),settlementId:s.id,amount:value,method:p.method,reference:text(p.reference,'核对凭证',200),reason:optionalText(p.reason,'备注',1000),recordedAt:now(),recordedBy:user.id,recordingBasis:'staff-verified-manual'};
    db.sql.prepare('INSERT INTO payments(id,settlement_id,amount,method,reference,reason,recorded_at,recorded_by) VALUES(?,?,?,?,?,?,?,?)').run(result.id,s.id,value,p.method,result.reference,result.reason,result.recordedAt,user.id);
    return result;
  }),
  'payment.refund':(db,user,p)=>idempotent(db,user,'payment.refund',p,()=>{
    const payment=db.sql.prepare('SELECT * FROM payments WHERE id=?').get(text(p.paymentId,'原收款编号',100));if(!payment)fail('原收款不存在',404,'NOT_FOUND');
    invoice(db,user,payment.settlement_id);const refunded=db.sql.prepare('SELECT coalesce(sum(amount),0) amount FROM refunds WHERE payment_id=?').get(payment.id).amount;
    const value=amount(p.amount,'退款金额');if(value>payment.amount-refunded)fail('退款不能超过原款剩余可退金额',409,'REFUND_EXCEEDED');
    const result={id:id('REFUND'),paymentId:payment.id,amount:value,reference:text(p.reference,'退款核对凭证',200),reason:text(p.reason,'退款原因',1000),recordedAt:now(),recordedBy:user.id};
    db.sql.prepare('INSERT INTO refunds(id,payment_id,amount,reference,reason,recorded_at,recorded_by) VALUES(?,?,?,?,?,?,?)').run(result.id,payment.id,value,result.reference,result.reason,result.recordedAt,user.id);return result;
  }),
  'settlement.void':(db,user,p)=>{
    const s=invoice(db,user,p.id);version(s,p);const summary=financeSummary(db,s);
    if(summary.voided)fail('此账单已经冲销',409,'INVOICE_VOID');
    if(summary.netPaid!==0)fail('请先完整退回已收款，再冲销账单',409,'PAYMENT_REMAINS');
    if(!s.total)fail('零金额账单无需冲销');
    const result={id:id('VOID'),settlementId:s.id,type:'void',amount:s.total,reason:text(p.reason,'冲销原因',1000),recordedAt:now(),recordedBy:user.id};
    db.sql.prepare("INSERT INTO invoice_adjustments(id,settlement_id,type,amount,reason,recorded_at,recorded_by) VALUES(?,?,'void',?,?,?,?)").run(result.id,s.id,s.total,result.reason,result.recordedAt,user.id);
    invalidateReports(db,quarterOf(s.date),'结算单冲销，需重新核算');return result;
  },
  'reconciliation.record':(db,user,p)=>{
    const clinic=requireObject(db,'clinics',p.clinicId);ensureClinic(user,clinic.id);const businessDate=day(p.businessDate),daily=dailyEntries(db,clinic.id,businessDate);
    const observedCash=signedMoney(p.observedCash,'实核现金'),observedBank=signedMoney(p.observedBank,'实核银行金额'),observedPos=signedMoney(p.observedPos,'实核 POS 金额');
    const reason=optionalText(p.reason,'差额或修订原因',1000),previous=db.sql.prepare('SELECT * FROM reconciliations WHERE clinic_id=? AND business_date=? ORDER BY revision DESC LIMIT 1').get(clinic.id,businessDate);
    if((observedCash!==daily.expected.cash||observedBank!==daily.expected.bank||observedPos!==daily.expected.pos||previous)&&!reason)fail('存在差额或修订日结时必须填写原因');
    const result={id:id('DAY'),clinicId:clinic.id,businessDate,revision:(previous?.revision||0)+1,expectedCash:daily.expected.cash,expectedBank:daily.expected.bank,expectedPos:daily.expected.pos,observedCash,observedBank,observedPos,sourceSignature:daily.sourceSignature,reference:text(p.reference,'核对依据',500),reason,recordedAt:now(),recordedBy:user.id};
    db.sql.prepare('INSERT INTO reconciliations(id,clinic_id,business_date,revision,expected_cash,expected_bank,expected_pos,observed_cash,observed_bank,observed_pos,source_signature,reference,reason,recorded_at,recorded_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(result.id,result.clinicId,businessDate,result.revision,result.expectedCash,result.expectedBank,result.expectedPos,observedCash,observedBank,observedPos,result.sourceSignature,result.reference,reason,result.recordedAt,user.id);return{...result,stale:false,difference:observedCash+observedBank+observedPos-result.expectedCash-result.expectedBank-result.expectedPos};
  }
};
