import type pg from 'pg';
import type { FastifyRequest, HTTPMethods } from 'fastify';
import type { Principal, CompensationActor, FinancialSourceInput, IncentiveAllocation, IncentivePayment } from '@andrew/shared';
import { z } from 'zod';
import { audit, hqOnly, isHq, scopeIds, staffOnly } from './auth.js';
import { one, transaction, type Db } from './db.js';
import { requireThat } from './errors.js';
import { uuid, version } from './validation.js';

type Shape={Params:Record<string,string>;Querystring:Record<string,string>;Body:unknown};
type Route=(method:HTTPMethods,path:string,auth:'none'|'required'|'optional',handler:(req:FastifyRequest<Shape>,user:Principal|undefined)=>Promise<unknown>)=>void;
export const INCENTIVE_RULE_VERSION='quarterly-positive-contribution-v1';
const reference=z.string().trim().min(1).max(500);
const monthSchema=z.string().regex(/^(20[0-9]{2}|21[0-9]{2})-(0[1-9]|1[0-2])$/);
const quarterSchema=z.string().regex(/^(20[0-9]{2}|21[0-9]{2})-Q[1-4]$/);
const money=z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000);
const sourceInput=z.object({doctorId:uuid,revenueCents:money,materialCostCents:money,operatingExpenseCents:money,revenueReference:reference,materialReference:reference,expenseReference:reference}).strict();
const monthInput=z.object({clinicId:uuid,month:monthSchema,reference,noActivity:z.boolean(),rows:z.array(sourceInput).max(500)}).strict().superRefine((x,c)=>{
 if(x.noActivity?x.rows.length!==0:x.rows.length===0)c.addIssue({code:'custom',message:'零业务月份不填医生明细；其他月份至少一位医生，零金额也需明确列示'});
 if(new Set(x.rows.map(v=>v.doctorId)).size!==x.rows.length)c.addIssue({code:'custom',message:'同一医生不能重复'});
});
const expected=z.object({expectedVersion:version}).strict();
const withReason=expected.extend({reason:reference}).strict();
const sourceSelect=`SELECT f.id,f.doctor_id AS "doctorId",f.doctor_name AS "doctorName",f.employee_no AS "employeeNo",f.revenue_cents AS "revenueCents",f.material_cost_cents AS "materialCostCents",f.operating_expense_cents AS "operatingExpenseCents",f.revenue_reference AS "revenueReference",f.material_reference AS "materialReference",f.expense_reference AS "expenseReference" FROM doctor_financial_sources f`;
const monthSelect=`SELECT m.id,m.clinic_id AS "clinicId",c.name AS "clinicName",to_char(m.month,'YYYY-MM') AS month,m.reference,m.no_activity AS "noActivity",m.status,m.row_version AS "rowVersion",m.source_revision AS "sourceRevision",m.created_by AS "createdBy",m.created_staff_id AS "createdStaffId",maker.name AS "createdByName",m.closed_by AS "closedBy",m.closed_staff_id AS "closedStaffId",reviewer.name AS "closedByName",m.closed_at AS "closedAt",m.created_at AS "createdAt",m.updated_at AS "updatedAt" FROM incentive_months m JOIN clinics c ON c.id=m.clinic_id JOIN staff maker ON maker.id=m.created_staff_id LEFT JOIN staff reviewer ON reviewer.id=m.closed_staff_id`;
const quarterSelect=`SELECT p.id,p.quarter,p.reference,p.status,p.row_version AS "rowVersion",p.rule_version AS "ruleVersion",p.total_revenue_cents AS "totalRevenueCents",p.total_material_cost_cents AS "totalMaterialCostCents",p.total_operating_expense_cents AS "totalOperatingExpenseCents",p.net_profit_cents AS "netProfitCents",p.fund_cents AS "fundCents",p.clinic_count AS "clinicCount",p.doctor_count AS "doctorCount",p.created_by AS "createdBy",p.created_staff_id AS "createdStaffId",maker.name AS "createdByName",p.submitted_at AS "submittedAt",p.approved_by AS "approvedBy",p.approved_staff_id AS "approvedStaffId",reviewer.name AS "approvedByName",p.approved_at AS "approvedAt",p.void_reason AS "voidReason",p.created_at AS "createdAt" FROM incentive_pools p JOIN staff maker ON maker.id=p.created_staff_id LEFT JOIN staff reviewer ON reviewer.id=p.approved_staff_id`;
const paymentSelect=`SELECT id,allocation_id AS "allocationId",amount_cents AS "amountCents",reference,status,result_reference AS "resultReference",row_version AS "rowVersion",created_by AS "createdBy",created_at AS "createdAt",resolved_by AS "resolvedBy",resolved_at AS "resolvedAt" FROM incentive_payments`;
function safe(value:bigint|string|number):number{const n=Number(value);requireThat(Number.isSafeInteger(n),409,'AMOUNT_RANGE','汇总金额超出安全展示范围，请核对账证');return n;}
function wire<T=Record<string,unknown>>(row:Record<string,unknown>):T{
 return Object.fromEntries(Object.entries(row).map(([k,v])=>[k,k.endsWith('Cents')&&v!==null?safe(v as string):v instanceof Date?v.toISOString():v])) as T;
}
const chinaMonth=()=>new Date(Date.now()+8*3_600_000).toISOString().slice(0,7);
function nextMonth(month:string){const [y,m]=month.split('-').map(Number);return `${m===12?y!+1:y}-${String(m===12?1:m!+1).padStart(2,'0')}`;}
function monthRange(month:string){return [month+'-01T00:00:00+08:00',nextMonth(month)+'-01T00:00:00+08:00'];}
function quarterMonths(quarter:string){const year=quarter.slice(0,4),first=(Number(quarter.at(-1))-1)*3+1;return [first,first+1,first+2].map(m=>`${year}-${String(m).padStart(2,'0')}`);}
function completedMonth(month:string){requireThat(month<chinaMonth(),400,'PERIOD_NOT_ENDED','只能核算已结束的自然月');}
function completedQuarter(quarter:string){requireThat(nextMonth(quarterMonths(quarter)[2]!)<=chinaMonth(),400,'PERIOD_NOT_ENDED','只能核算已结束的自然季度');}
function managementScopes(user:Principal):string[]|null{requireThat(isHq(user)||user.roles.includes('manager'),403,'FORBIDDEN','仅总部或门诊店长可查看核算底稿');return scopeIds(user,['hq','manager']);}
async function serialize(db:Db){await db.query("SELECT pg_advisory_xact_lock(hashtextextended('andrew.compensation.periods',0))");}
async function actor(db:Db,user:Principal,clinicId?:string):Promise<CompensationActor>{
 const row=await one<CompensationActor>(db,`SELECT u.id AS "userId",s.id AS "staffId",s.employee_no AS "employeeNo",s.name FROM users u JOIN staff s ON s.user_id=u.id
  WHERE u.id=$1 AND u.active AND s.active AND EXISTS(SELECT 1 FROM role_assignments r WHERE r.user_id=u.id AND (r.role='hq' OR ($2::uuid IS NOT NULL AND r.role='manager' AND r.clinic_id=$2))) FOR SHARE OF u,s`,[user.id,clinicId??null]);
 requireThat(row,403,'STAFF_IDENTITY_REQUIRED','请先关联有效员工档案并确认核算岗位范围');return row;
}
async function sourceRows(db:Db,monthId:string,revision:number){return (await db.query(sourceSelect+' WHERE f.month_id=$1 AND f.source_revision=$2 ORDER BY f.employee_no,f.doctor_id',[monthId,revision])).rows.map(r=>wire(r));}
async function sourceRowsBatch(db:Db,periods:{id:string;revision:number}[]){
 const grouped=new Map<string,Record<string,unknown>[]>();if(!periods.length)return grouped;
 const sql=sourceSelect.replace('SELECT f.id','SELECT f.month_id AS "monthId",f.source_revision AS revision,f.id')+' JOIN unnest($1::uuid[],$2::int[]) selected(month_id,revision) ON selected.month_id=f.month_id AND selected.revision=f.source_revision ORDER BY f.employee_no,f.doctor_id';
 for(const raw of (await db.query(sql,[periods.map(p=>p.id),periods.map(p=>p.revision)])).rows){const {monthId,revision,...r}=raw;const key=monthId+':'+revision;const rows=grouped.get(key)??[];rows.push(wire(r));grouped.set(key,rows);}return grouped;
}
async function getMonth(db:Db,id:string){const m=await one(db,monthSelect+' WHERE m.id=$1',[id]);requireThat(m,404,'NOT_FOUND','月份底稿不存在');return {...wire(m),rows:await sourceRows(db,id,m.sourceRevision as number)};}
async function checkDoctors(db:Db,rows:FinancialSourceInput[]){
 const ids=rows.map(r=>r.doctorId);if(!ids.length)return;
 const result=await db.query('SELECT id FROM staff WHERE id=ANY($1::uuid[]) AND is_dentist ORDER BY id FOR SHARE',[ids]);
 requireThat(result.rowCount===ids.length,400,'INVALID_DOCTOR','明细必须对应有效的医生身份，离职医生历史资料可保留');
}
async function appendSources(db:Db,monthId:string,revision:number,rows:FinancialSourceInput[],userId:string){
 await checkDoctors(db,rows);
 for(const r of rows)await db.query(`INSERT INTO doctor_financial_sources(month_id,source_revision,doctor_id,doctor_name,employee_no,revenue_cents,material_cost_cents,operating_expense_cents,revenue_reference,material_reference,expense_reference,created_by)
  SELECT $1,$2,s.id,s.name,s.employee_no,$4,$5,$6,$7,$8,$9,$10 FROM staff s WHERE s.id=$3`,[monthId,revision,r.doctorId,r.revenueCents,r.materialCostCents,r.operatingExpenseCents,r.revenueReference,r.materialReference,r.expenseReference,userId]);
}
async function unreferenced(db:Db,monthId:string){requireThat(!await one(db,"SELECT 1 FROM incentive_pool_sources s JOIN incentive_pools p ON p.id=s.pool_id WHERE s.month_id=$1 AND p.status<>'voided' LIMIT 1",[monthId]),409,'MONTH_SNAPSHOT_LOCKED','该月已被有效季度快照引用，需先作废尚未批准的快照；已批准期间使用后续调整');}
interface Contribution {doctorId:string;employeeNo:string;doctorName:string;contribution:bigint}
export function allocateIncentive(contributions:Contribution[]){
 const total=contributions.reduce((n,r)=>n+r.contribution,0n);const fund=((total>0n?total:0n)+5n)/10n;
 const weight=contributions.reduce((n,r)=>n+(r.contribution>0n?r.contribution:0n),0n);
 const rows=contributions.map(r=>{const w=r.contribution>0n?r.contribution:0n;return {...r,weight:w,amount:weight?fund*w/weight:0n,remainder:weight?fund*w%weight:0n};});
 const order=[...rows].sort((a,b)=>a.remainder!==b.remainder?(a.remainder>b.remainder?-1:1):a.employeeNo!==b.employeeNo?(a.employeeNo<b.employeeNo?-1:1):a.doctorId<b.doctorId?-1:a.doctorId>b.doctorId?1:0);
 const remaining=fund-rows.reduce((n,r)=>n+r.amount,0n);for(let i=0;i<Number(remaining);i++)order[i]!.amount+=1n;
 return {total,fund,rows};
}
async function allocations(db:Db,poolId?:string,doctorId?:string):Promise<IncentiveAllocation[]>{
 const rows=(await db.query(`SELECT a.id,a.pool_id AS "poolId",a.doctor_id AS "doctorId",a.doctor_name AS "doctorName",a.employee_no AS "employeeNo",p.quarter,a.contribution_cents AS "contributionCents",a.weight_cents AS "weightCents",a.amount_cents AS "amountCents",a.row_version AS "rowVersion",
  coalesce((SELECT sum(x.amount_cents) FROM incentive_payments x WHERE x.allocation_id=a.id AND x.status='succeeded'),0) AS "paidCents",
  coalesce((SELECT sum(x.amount_cents) FROM incentive_payments x WHERE x.allocation_id=a.id AND x.status='pending'),0) AS "pendingCents"
  FROM incentive_allocations a JOIN incentive_pools p ON p.id=a.pool_id WHERE ($1::uuid IS NULL OR a.pool_id=$1) AND ($2::uuid IS NULL OR (a.doctor_id=$2 AND p.status='approved')) ORDER BY p.quarter DESC,a.employee_no,a.doctor_id`,[poolId??null,doctorId??null])).rows;
 if(!rows.length)return [];
 const payments=(await db.query(paymentSelect+' WHERE allocation_id=ANY($1::uuid[]) ORDER BY created_at,id',[rows.map(r=>r.id)])).rows.map(r=>wire<IncentivePayment>(r));
 return rows.map(r=>{const a=wire<Omit<IncentiveAllocation,'remainingCents'|'payments'>>(r);return {...a,remainingCents:safe(BigInt(a.amountCents)-BigInt(a.paidCents)-BigInt(a.pendingCents)),payments:payments.filter(p=>p.allocationId===a.id)};});
}
async function getQuarter(db:Db,id:string){
 const p=await one(db,quarterSelect+' WHERE p.id=$1',[id]);requireThat(p,404,'NOT_FOUND','季度快照不存在');
 const rawMonths=(await db.query(`SELECT month_id AS "monthId",clinic_id AS "clinicId",clinic_name AS "clinicName",to_char(month,'YYYY-MM') AS month,reference,no_activity AS "noActivity",source_revision AS "sourceRevision",closed_by AS "closedBy",closed_staff_id AS "closedStaffId",closed_at AS "closedAt" FROM incentive_pool_sources WHERE pool_id=$1 ORDER BY clinic_name,month`,[id])).rows;
 const financial=await sourceRowsBatch(db,rawMonths.map(m=>({id:m.monthId,revision:m.sourceRevision})));
 const months=rawMonths.map(m=>({...wire(m),rows:financial.get(m.monthId+':'+m.sourceRevision)??[]}));
 const results=(await db.query(`SELECT id,doctor_id AS "doctorId",doctor_name AS "doctorName",employee_no AS "employeeNo",clinic_id AS "clinicId",clinic_name AS "clinicName",revenue_cents AS "revenueCents",material_cost_cents AS "materialCostCents",operating_expense_cents AS "operatingExpenseCents",net_profit_cents AS "netProfitCents" FROM doctor_quarter_results WHERE pool_id=$1 ORDER BY employee_no,doctor_id,clinic_name`,[id])).rows.map(r=>wire(r));
 const shares=await allocations(db,id);return {...wire(p),months,results,allocations:shares,payments:shares.flatMap(a=>a.payments)};
}
export function registerCompensationRoutes(route:Route,pool:pg.Pool){
 route('GET','/compensation/context','required',async(_req,user)=>{
  const scopes=managementScopes(user!);
  const clinics=(await pool.query('SELECT id,name,active FROM clinics WHERE $1::uuid[] IS NULL OR id=ANY($1) ORDER BY name,id',[scopes])).rows;
  const doctors=(await pool.query('SELECT id,employee_no AS "employeeNo",name,active FROM staff WHERE is_dentist ORDER BY employee_no,id')).rows;
  const identity=await one<CompensationActor>(pool,'SELECT user_id AS "userId",id AS "staffId",employee_no AS "employeeNo",name FROM staff WHERE user_id=$1 AND active',[user!.id]);
  return {clinics,doctors,actor:identity??null,rules:{version:INCENTIVE_RULE_VERSION,fundRatePercent:10,allocationMethod:'positive_contribution_largest_remainder',currency:'CNY',scope:'all_registered_clinics'}};
 });
 route('GET','/compensation/months','required',async(req,user)=>{
  const scopes=managementScopes(user!);const clinic=req.query.clinicId?uuid.parse(req.query.clinicId):null;
  if(clinic&&scopes)requireThat(scopes.includes(clinic),403,'CLINIC_SCOPE_DENIED','无权访问该门诊');
  const months=req.query.quarter?quarterMonths(quarterSchema.parse(req.query.quarter)):null;
  const rows=(await pool.query(monthSelect+` WHERE ($1::uuid[] IS NULL OR m.clinic_id=ANY($1)) AND ($2::uuid IS NULL OR m.clinic_id=$2) AND ($3::text[] IS NULL OR to_char(m.month,'YYYY-MM')=ANY($3)) ORDER BY m.month DESC,c.name`,[scopes,clinic,months])).rows;
  const financial=await sourceRowsBatch(pool,rows.map(m=>({id:m.id,revision:m.sourceRevision})));return rows.map(m=>({...wire(m),rows:financial.get(m.id+':'+m.sourceRevision)??[]}));
 });
 route('POST','/compensation/months','required',async(req,user)=>{
  managementScopes(user!);const input=monthInput.parse(req.body);completedMonth(input.month);
  return transaction(pool,async db=>{await serialize(db);const a=await actor(db,user!,input.clinicId);
   requireThat(await one(db,'SELECT id FROM clinics WHERE id=$1 FOR SHARE',[input.clinicId]),400,'INVALID_CLINIC','门诊不存在');
   const m=await one<{id:string}>(db,`INSERT INTO incentive_months(clinic_id,month,reference,no_activity,created_by,created_staff_id,updated_by) VALUES($1,$2,$3,$4,$5,$6,$5) RETURNING id`,[input.clinicId,input.month+'-01',input.reference,input.noActivity,a.userId,a.staffId]);
   await appendSources(db,m!.id,1,input.rows,user!.id);await audit(db,user!.id,'incentive.month.created',m!.id,req.id,{staffId:a.staffId,month:input.month,clinicId:input.clinicId});return getMonth(db,m!.id);
  });
 });
 route('PUT','/compensation/months/:id','required',async(req,user)=>{
  managementScopes(user!);const id=uuid.parse(req.params.id);const body=z.record(z.string(),z.unknown()).parse(req.body);const v=version.parse(body.expectedVersion);const {expectedVersion:_v,...raw}=body;const input=monthInput.parse(raw);completedMonth(input.month);
  return transaction(pool,async db=>{await serialize(db);const a=await actor(db,user!,input.clinicId);const m=await one(db,"SELECT *,to_char(month,'YYYY-MM') AS period FROM incentive_months WHERE id=$1 FOR UPDATE",[id]);requireThat(m,404,'NOT_FOUND','月份底稿不存在');
   requireThat(m.clinic_id===input.clinicId&&m.period===input.month,400,'PERIOD_IDENTITY_IMMUTABLE','门诊及月份不能改写');
   requireThat(m.row_version===v,409,'VERSION_CONFLICT','月份底稿已变更');requireThat(m.status==='draft',409,'MONTH_CLOSED','关闭月份须先重开');requireThat(m.created_by===a.userId&&m.created_staff_id===a.staffId,403,'DRAFT_OWNER_REQUIRED','只能修改本人制表的草稿');await unreferenced(db,id);
   const revision=Number(m.source_revision)+1;await appendSources(db,id,revision,input.rows,user!.id);
   await db.query('UPDATE incentive_months SET reference=$2,no_activity=$3,source_revision=$4,row_version=row_version+1,updated_by=$5,updated_at=now() WHERE id=$1',[id,input.reference,input.noActivity,revision,user!.id]);await audit(db,user!.id,'incentive.month.revised',id,req.id,{sourceRevision:revision});return getMonth(db,id);
  });
 });
 route('POST','/compensation/months/:id/close','required',async(req,user)=>{
  managementScopes(user!);const id=uuid.parse(req.params.id),input=expected.parse(req.body);
  return transaction(pool,async db=>{await serialize(db);const m=await one(db,'SELECT *,to_char(month,\'YYYY-MM\') AS period FROM incentive_months WHERE id=$1 FOR UPDATE',[id]);requireThat(m,404,'NOT_FOUND','月份底稿不存在');const a=await actor(db,user!,m.clinic_id as string);completedMonth(m.period as string);
   requireThat(m.row_version===input.expectedVersion,409,'VERSION_CONFLICT','月份底稿已变更');requireThat(m.status==='draft',409,'STATUS_CONFLICT','该月已关闭');requireThat(a.userId!==m.created_by&&a.staffId!==m.created_staff_id,403,'INDEPENDENT_REVIEW_REQUIRED','复核人与制表人须为不同账号及不同员工');
   const rows=await sourceRows(db,id,m.source_revision as number);requireThat(m.no_activity?rows.length===0:rows.length>0,409,'SOURCE_INCOMPLETE','财务明细与零业务声明不一致');
   const range=monthRange(m.period as string);const doctors=(await db.query<{doctor_id:string}>("SELECT DISTINCT doctor_id FROM doctor_shifts WHERE clinic_id=$1 AND status='published' AND starts_at<$3::timestamptz AND ends_at>$2::timestamptz",[m.clinic_id,...range])).rows;
   const ids=new Set(rows.map(r=>r.doctorId));requireThat(doctors.every(d=>ids.has(d.doctor_id)),409,'DOCTOR_SOURCE_INCOMPLETE','已发布出诊的医生须逐人列明财务数据；零收入也须填写三类零金额依据');
   await db.query("UPDATE incentive_months SET status='closed',closed_by=$2,closed_staff_id=$3,closed_at=now(),row_version=row_version+1,updated_by=$2,updated_at=now() WHERE id=$1",[id,a.userId,a.staffId]);await audit(db,user!.id,'incentive.month.closed',id,req.id,{reviewerStaffId:a.staffId});return getMonth(db,id);
  });
 });
 route('POST','/compensation/months/:id/reopen','required',async(req,user)=>{
  hqOnly(user!);const id=uuid.parse(req.params.id),input=withReason.parse(req.body);
  return transaction(pool,async db=>{await serialize(db);const a=await actor(db,user!);const m=await one(db,'SELECT * FROM incentive_months WHERE id=$1 FOR UPDATE',[id]);requireThat(m,404,'NOT_FOUND','月份底稿不存在');requireThat(m.row_version===input.expectedVersion,409,'VERSION_CONFLICT','月份底稿已变更');requireThat(m.status==='closed',409,'STATUS_CONFLICT','该月未关闭');await unreferenced(db,id);
   await db.query("UPDATE incentive_months SET status='draft',closed_by=NULL,closed_staff_id=NULL,closed_at=NULL,row_version=row_version+1,updated_by=$2,updated_at=now() WHERE id=$1",[id,user!.id]);await audit(db,user!.id,'incentive.month.reopened',id,req.id,{reason:input.reason,staffId:a.staffId});return getMonth(db,id);
  });
 });
 route('GET','/compensation/quarters','required',async(req,user)=>{hqOnly(user!);const q=req.query.quarter?quarterSchema.parse(req.query.quarter):null;return (await pool.query(quarterSelect+' WHERE ($1::text IS NULL OR p.quarter=$1) ORDER BY p.quarter DESC,p.created_at DESC',[q])).rows.map(r=>wire(r));});
 route('GET','/compensation/quarters/:id','required',async(req,user)=>{hqOnly(user!);return getQuarter(pool,uuid.parse(req.params.id));});
 route('POST','/compensation/quarters','required',async(req,user)=>{
  hqOnly(user!);const input=z.object({quarter:quarterSchema,reference}).strict().parse(req.body);completedQuarter(input.quarter);
  return transaction(pool,async db=>{await serialize(db);const a=await actor(db,user!);const months=quarterMonths(input.quarter);
   const clinics=(await db.query<{id:string;name:string}>('SELECT id,name FROM clinics ORDER BY id FOR SHARE')).rows;requireThat(clinics.length,409,'CLINIC_SCOPE_EMPTY','没有可核算门诊');
   const drafts=(await db.query(`SELECT m.*,to_char(m.month,'YYYY-MM') AS period FROM incentive_months m WHERE clinic_id=ANY($1::uuid[]) AND to_char(month,'YYYY-MM')=ANY($2::text[]) ORDER BY clinic_id,month FOR SHARE`,[clinics.map(c=>c.id),months])).rows;
   requireThat(drafts.length===clinics.length*3&&drafts.every(m=>m.status==='closed'),409,'MONTHS_INCOMPLETE','全部已登记门诊的三个自然月都须独立复核关闭，停用及零业务月份也须明确登记依据');
   const financial=(await db.query(`SELECT f.*,m.clinic_id,c.name AS clinic_name,s.name AS current_name,s.employee_no AS current_employee_no FROM doctor_financial_sources f JOIN incentive_months m ON m.id=f.month_id AND m.source_revision=f.source_revision JOIN clinics c ON c.id=m.clinic_id JOIN staff s ON s.id=f.doctor_id WHERE m.id=ANY($1::uuid[]) ORDER BY m.clinic_id,f.doctor_id,f.id`,[drafts.map(m=>m.id)])).rows;
   const perClinic=new Map<string,{clinicId:string;clinicName:string;doctorId:string;doctorName:string;employeeNo:string;revenue:bigint;material:bigint;expense:bigint}>();
   for(const r of financial){const key=r.clinic_id+':'+r.doctor_id;let sum=perClinic.get(key);if(!sum){sum={clinicId:r.clinic_id,clinicName:r.clinic_name,doctorId:r.doctor_id,doctorName:r.current_name,employeeNo:r.current_employee_no,revenue:0n,material:0n,expense:0n};perClinic.set(key,sum);}sum.revenue+=BigInt(r.revenue_cents);sum.material+=BigInt(r.material_cost_cents);sum.expense+=BigInt(r.operating_expense_cents);}
   const people=new Map<string,Contribution>();let revenue=0n,material=0n,expense=0n;
   for(const r of perClinic.values()){revenue+=r.revenue;material+=r.material;expense+=r.expense;const net=r.revenue-r.material-r.expense;const person=people.get(r.doctorId);if(person)person.contribution+=net;else people.set(r.doctorId,{doctorId:r.doctorId,doctorName:r.doctorName,employeeNo:r.employeeNo,contribution:net});}
   const calculation=allocateIncentive([...people.values()]);for(const value of [revenue,material,expense,calculation.total,calculation.fund])safe(value);
   const p=await one<{id:string}>(db,`INSERT INTO incentive_pools(quarter,reference,rule_version,total_revenue_cents,total_material_cost_cents,total_operating_expense_cents,net_profit_cents,fund_cents,clinic_count,doctor_count,created_by,created_staff_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,[input.quarter,input.reference,INCENTIVE_RULE_VERSION,revenue.toString(),material.toString(),expense.toString(),calculation.total.toString(),calculation.fund.toString(),clinics.length,people.size,a.userId,a.staffId]);
   for(const m of drafts)await db.query(`INSERT INTO incentive_pool_sources(pool_id,month_id,source_revision,clinic_id,clinic_name,month,reference,no_activity,closed_by,closed_staff_id,closed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[p!.id,m.id,m.source_revision,m.clinic_id,clinics.find(c=>c.id===m.clinic_id)!.name,m.month,m.reference,m.no_activity,m.closed_by,m.closed_staff_id,m.closed_at]);
   for(const r of perClinic.values())await db.query(`INSERT INTO doctor_quarter_results(pool_id,clinic_id,clinic_name,doctor_id,doctor_name,employee_no,revenue_cents,material_cost_cents,operating_expense_cents,net_profit_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[p!.id,r.clinicId,r.clinicName,r.doctorId,r.doctorName,r.employeeNo,r.revenue.toString(),r.material.toString(),r.expense.toString(),(r.revenue-r.material-r.expense).toString()]);
   for(const r of calculation.rows){safe(r.contribution);safe(r.amount);safe(r.weight);await db.query(`INSERT INTO incentive_allocations(pool_id,doctor_id,doctor_name,employee_no,contribution_cents,weight_cents,amount_cents) VALUES($1,$2,$3,$4,$5,$6,$7)`,[p!.id,r.doctorId,r.doctorName,r.employeeNo,r.contribution.toString(),r.weight.toString(),r.amount.toString()]);}
   await audit(db,user!.id,'incentive.quarter.created',p!.id,req.id,{quarter:input.quarter,ruleVersion:INCENTIVE_RULE_VERSION,sourceMonths:drafts.length,staffId:a.staffId});return getQuarter(db,p!.id);
  });
 });
 for(const action of ['submit','approve','void'] as const)route('POST',`/compensation/quarters/:id/${action}`,'required',async(req,user)=>{
  hqOnly(user!);const id=uuid.parse(req.params.id);const input=(action==='void'?withReason:expected).parse(req.body);
  return transaction(pool,async db=>{await serialize(db);const a=await actor(db,user!);const p=await one(db,'SELECT * FROM incentive_pools WHERE id=$1 FOR UPDATE',[id]);requireThat(p,404,'NOT_FOUND','季度快照不存在');requireThat(p.row_version===input.expectedVersion,409,'VERSION_CONFLICT','季度快照已变更');
   if(action==='submit'){requireThat(p.status==='draft',409,'STATUS_CONFLICT','只能提交草稿');requireThat(p.created_by===a.userId&&p.created_staff_id===a.staffId,403,'DRAFT_OWNER_REQUIRED','请由制表人提交');await db.query("UPDATE incentive_pools SET status='submitted',submitted_at=now(),row_version=row_version+1 WHERE id=$1",[id]);}
   if(action==='approve'){
    requireThat(p.status==='submitted',409,'STATUS_CONFLICT','请先提交季度快照');requireThat(p.created_by!==a.userId&&p.created_staff_id!==a.staffId,403,'INDEPENDENT_REVIEW_REQUIRED','批准人与制表人须为不同账号及不同员工');
    const stale=await one(db,`SELECT 1 FROM incentive_pool_sources s JOIN incentive_months m ON m.id=s.month_id WHERE s.pool_id=$1 AND (m.status<>'closed' OR m.source_revision<>s.source_revision) LIMIT 1`,[id]);requireThat(!stale,409,'STALE_SNAPSHOT','月度来源已变更，请作废后重新生成');
    const total=await one<{amount:string}>(db,'SELECT coalesce(sum(amount_cents),0)::text AS amount FROM incentive_allocations WHERE pool_id=$1',[id]);requireThat(BigInt(total!.amount)===BigInt(p.fund_cents as string),409,'ALLOCATION_MISMATCH','分配总额与基金不一致');
    await db.query("UPDATE incentive_pools SET status='approved',approved_by=$2,approved_staff_id=$3,approved_at=now(),row_version=row_version+1 WHERE id=$1",[id,a.userId,a.staffId]);
   }
   if(action==='void'){requireThat(['draft','submitted'].includes(p.status as string),409,'STATUS_CONFLICT','只能作废尚未批准的快照');await db.query("UPDATE incentive_pools SET status='voided',void_reason=$2,voided_by=$3,voided_at=now(),row_version=row_version+1 WHERE id=$1",[id,('reason' in input?input.reason:''),a.userId]);}
   await audit(db,user!.id,`incentive.quarter.${action}`,id,req.id,{staffId:a.staffId,...('reason' in input?{reason:input.reason}:{})});return getQuarter(db,id);
  });
 });
 route('POST','/compensation/allocations/:id/payments','required',async(req,user)=>{
  hqOnly(user!);const id=uuid.parse(req.params.id);const input=z.object({expectedVersion:version,amountCents:money.positive(),reference}).strict().parse(req.body);
  return transaction(pool,async db=>{const a=await actor(db,user!);const share=await one(db,'SELECT a.*,p.status AS pool_status FROM incentive_allocations a JOIN incentive_pools p ON p.id=a.pool_id WHERE a.id=$1 FOR UPDATE OF a',[id]);requireThat(share,404,'NOT_FOUND','个人份额不存在');requireThat(share.pool_status==='approved',409,'POOL_NOT_APPROVED','批准后才能登记发放');
   await db.query("SELECT pg_advisory_xact_lock(hashtextextended('andrew.incentive.payment.'||$1,0))",[input.reference]);
   const existing=await one(db,paymentSelect+' WHERE reference=$1 OR result_reference=$1',[input.reference]);if(existing){requireThat(existing.allocationId===id&&safe(existing.amountCents as string)===input.amountCents&&existing.reference===input.reference,409,'PAYMENT_REFERENCE_CONFLICT','此凭证已用于其他发放');return wire<IncentivePayment>(existing);}
   requireThat(share.row_version===input.expectedVersion,409,'VERSION_CONFLICT','可发额度已变更，请刷新后核对');
   const used=await one<{amount:string}>(db,"SELECT coalesce(sum(amount_cents),0)::text AS amount FROM incentive_payments WHERE allocation_id=$1 AND status IN ('pending','succeeded')",[id]);requireThat(BigInt(used!.amount)+BigInt(input.amountCents)<=BigInt(share.amount_cents as string),409,'ALLOCATION_EXCEEDED','成功及待确认发放合计不得超过批准份额');
   const payment=await one<{id:string}>(db,'INSERT INTO incentive_payments(allocation_id,amount_cents,reference,created_by,created_staff_id) VALUES($1,$2,$3,$4,$5) RETURNING id',[id,input.amountCents,input.reference,a.userId,a.staffId]);await audit(db,user!.id,'incentive.payment.pending',payment!.id,req.id,{allocationId:id,amountCents:input.amountCents});return wire<IncentivePayment>((await one(db,paymentSelect+' WHERE id=$1',[payment!.id]))!);
  });
 });
 route('POST','/compensation/payments/:id/resolve','required',async(req,user)=>{
  hqOnly(user!);const id=uuid.parse(req.params.id);const input=z.object({expectedVersion:version,status:z.enum(['succeeded','failed']),reference}).strict().parse(req.body);
  return transaction(pool,async db=>{const a=await actor(db,user!);const hint=await one<{allocation_id:string}>(db,'SELECT allocation_id FROM incentive_payments WHERE id=$1',[id]);requireThat(hint,404,'NOT_FOUND','发放记录不存在');await db.query('SELECT id FROM incentive_allocations WHERE id=$1 FOR UPDATE',[hint.allocation_id]);const p=await one(db,'SELECT * FROM incentive_payments WHERE id=$1 FOR UPDATE',[id]);
   if(p!.status!=='pending'){requireThat(p!.status===input.status&&p!.result_reference===input.reference,409,'PAYMENT_FINAL','发放结果已确认，不能覆盖');return wire<IncentivePayment>((await one(db,paymentSelect+' WHERE id=$1',[id]))!);}
   requireThat(p!.row_version===input.expectedVersion,409,'VERSION_CONFLICT','发放记录已变更');await db.query('UPDATE incentive_payments SET status=$2,result_reference=$3,resolved_by=$4,resolved_staff_id=$5,resolved_at=now(),row_version=row_version+1 WHERE id=$1',[id,input.status,input.reference,a.userId,a.staffId]);await audit(db,user!.id,`incentive.payment.${input.status}`,id,req.id,{allocationId:hint.allocation_id});return wire<IncentivePayment>((await one(db,paymentSelect+' WHERE id=$1',[id]))!);
  });
 });
 route('GET','/compensation/me','required',async(_req,user)=>{
  staffOnly(user!);const identity=await one<{id:string}>(pool,'SELECT id FROM staff WHERE user_id=$1',[user!.id]);if(!identity)return {staffId:null,notice:'请联系总部关联员工档案后查看本人已批准份额。',allocations:[]};return {staffId:identity.id,notice:null,allocations:await allocations(pool,undefined,identity.id)};
 });
}
