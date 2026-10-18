import { financeCommands, financeSummaries, reconciliationState, camel } from './finance.js';
import { clinicalCommands } from './clinical-addenda.js';
import { identityCommands } from './patient-merge.js';
import { accountCommands, safeAccount } from './accounts.js';

export const commands={...financeCommands,...clinicalCommands,...identityCommands,...accountCommands};
export const permissions={
  customer:['password.change'],
  front:['payment.record','reconciliation.preview','reconciliation.record','password.change'],
  clinical:['visit.addendum','password.change'],
  manager:Object.keys(commands)
};
function rowsFor(db,table,column,ids) {
  if(!ids.length)return[];
  const rows=[];for(let i=0;i<ids.length;i+=500){const batch=ids.slice(i,i+500);rows.push(...db.sql.prepare(`SELECT * FROM ${table} WHERE ${column} IN (${batch.map(()=>'?').join(',')}) ORDER BY recorded_at,id`).all(...batch));}return rows.map(camel);
}
export function extendState(db,user,state={}) {
  const settlements=user.role==='clinical'?[]:(state.settlements||[]),settlementIds=settlements.map(s=>s.id),visitIds=(state.visits||[]).map(v=>v.id);
  state.financeSummaries=financeSummaries(db,settlements);
  state.payments=rowsFor(db,'payments','settlement_id',settlementIds);
  state.refunds=rowsFor(db,'refunds','payment_id',state.payments.map(p=>p.id));
  state.invoiceAdjustments=rowsFor(db,'invoice_adjustments','settlement_id',settlementIds);
  state.visitAddenda=rowsFor(db,'visit_addenda','visit_id',visitIds);
  state.reconciliations=[];state.accounts=[];state.recoveryRequests=[];state.patientAliases=[];
  if(['front','manager'].includes(user.role)&&(!state.page||state.page==='finance')) {
    if(state.page==='finance')state.clinics=db.find('clinics',{where:user.role==='front'?{id:{$in:user.clinicIds||[]}}:{},limit:100});
    const clinicIds=(state.clinics||[]).filter(c=>user.role==='manager'||user.clinicIds?.includes(c.id)).map(c=>c.id);
    if(clinicIds.length) {
      const marks=clinicIds.map(()=>'?').join(','),limit=25,offset=state.query?.reconciliationOffset||0;
      state.reconciliations=db.sql.prepare(`SELECT * FROM reconciliations WHERE clinic_id IN (${marks}) ORDER BY business_date DESC,revision DESC LIMIT ? OFFSET ?`).all(...clinicIds,limit,offset).map(row=>reconciliationState(db,row));
      state.reconciliationsPagination={total:db.sql.prepare(`SELECT count(*) count FROM reconciliations WHERE clinic_id IN (${marks})`).get(...clinicIds).count,limit,offset};
    }
  }
  if(user.role==='manager') {
    const limit=Math.min(100,Math.max(1,Number(state.pagination?.limit)||25)),offset=Math.max(0,Number(state.pagination?.offset)||0);
    if(!state.page||['accounts','staff','dashboard'].includes(state.page)) {
      const query=String(state.query?.q||'').slice(0,100),accountRef=String(state.query?.accountRef||'').slice(0,100);
      const condition=accountRef?'id=?':query?'(username LIKE ? OR name LIKE ? OR id=?)':'1';
      const values=accountRef?[accountRef]:query?['%'+query+'%','%'+query+'%',query]:[];
      state.accounts=db.sql.prepare('SELECT data FROM users WHERE '+condition+' ORDER BY username COLLATE NOCASE LIMIT ? OFFSET ?').all(...values,limit,offset).map(row=>safeAccount(JSON.parse(row.data)));
      state.accountsPagination={total:db.sql.prepare('SELECT count(*) count FROM users WHERE '+condition).get(...values).count,limit,offset};
      if(state.page==='accounts') {
        state.pagination={entity:'accounts',...state.accountsPagination};
        state.clinics=db.find('clinics',{where:{active:true},limit:100});state.dentists=db.find('dentists',{where:{active:true},limit:100});
      }
      state.recoveryRequests=db.sql.prepare("SELECT r.*,u.username,u.name,u.role FROM account_recovery_requests r JOIN users u ON u.id=r.user_id WHERE r.status IN ('pending','issued') ORDER BY r.requested_at DESC LIMIT 100").all().map(camel);
    }
    if(!state.page||['patients','patient','dashboard'].includes(state.page))state.patientAliases=db.sql.prepare('SELECT * FROM patient_aliases ORDER BY recorded_at DESC LIMIT 100').all().map(camel);
  }
  return state;
}
