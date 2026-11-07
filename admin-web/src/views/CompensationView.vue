<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Refresh } from '@element-plus/icons-vue';
import type { CompensationContext, FinancialSourceInput, IncentiveAllocation, IncentiveMonth, IncentiveMonthInput, IncentivePayment, IncentiveQuarter, IncentiveQuarterDetail, MyCompensation } from '@andrew/shared';
import { api, errorText, query } from '../api';
import { useAuth } from '../stores/auth';
import { money } from '../utils';
import { centsToYuan, compensationStatuses, independentReviewer, previousQuarter, quarterMonths, yuanToCents } from '../compensation-view';

const auth = useAuth();
const canManage = computed(() => auth.isHq || !!auth.user?.roles.includes('manager'));
const tab = ref(auth.isHq ? 'quarters' : canManage.value ? 'months' : 'mine');
const pageTitle = computed(() => auth.isHq ? '季度业绩与激励' : canManage.value ? '月度业绩与激励' : '我的季度激励');
const quarter = ref(previousQuarter()), clinicId = ref('');
const context = ref<CompensationContext | null>(null), months = ref<IncentiveMonth[]>([]), quarters = ref<IncentiveQuarter[]>([]);
const mine = ref<MyCompensation>({ staffId: null, notice: null, allocations: [] });
const loading = ref(false), busy = ref(false), error = ref(''), formError = ref('');
let disposed = false, loadSequence = 0;
const monthOptions = computed(() => quarterMonths(quarter.value));
const coverage = computed(() => (context.value?.clinics || []).filter(c => !clinicId.value || c.id === clinicId.value).flatMap(c =>
  monthOptions.value.map(month => ({ clinic: c, month, source: months.value.find(item => item.clinicId === c.id && item.month === month) }))));
const closedCount = computed(() => coverage.value.filter(item => item.source?.status === 'closed').length);
const status = (value: string) => compensationStatuses[value] || value;
const dateTime = (value: string | null) => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'short', hour12: false }).format(new Date(value)) : '—';
function canReview(item: { createdBy: string; createdStaffId: string }) {
  const actor = context.value?.actor;
  return independentReviewer(actor ? { id: actor.userId, staffId: actor.staffId } : null, item.createdBy, item.createdStaffId);
}
async function load() {
  if (!monthOptions.value.length) { error.value = '季度格式为 2026-Q3。'; return; }
  const sequence = ++loadSequence;
  loading.value = true; error.value = '';
  try {
    const [nextContext, nextMonths, nextQuarters, nextMine] = await Promise.all([
      canManage.value ? api<CompensationContext>('/compensation/context') : Promise.resolve(null),
      canManage.value ? api<IncentiveMonth[]>('/compensation/months' + query({ quarter: quarter.value, clinicId: clinicId.value })) : Promise.resolve([]),
      auth.isHq ? api<IncentiveQuarter[]>('/compensation/quarters' + query({ quarter: quarter.value })) : Promise.resolve([]),
      api<MyCompensation>('/compensation/me'),
    ]);
    if (disposed || sequence !== loadSequence) return;
    context.value = nextContext; months.value = nextMonths; quarters.value = nextQuarters; mine.value = nextMine;
  } catch (e) {
    if (!disposed && sequence === loadSequence) { months.value = []; quarters.value = []; mine.value = { staffId: null, notice: null, allocations: [] }; error.value = errorText(e); }
  } finally { if (!disposed && sequence === loadSequence) loading.value = false; }
}
function filtersChanged() { months.value = []; quarters.value = []; }

interface SourceForm { doctorId: string; revenue: string; material: string; expense: string; revenueReference: string; materialReference: string; expenseReference: string }
const monthDialog = ref(false), monthReadOnly = ref(false), editingMonth = ref<IncentiveMonth | null>(null);
const monthForm = reactive({ clinicId: '', month: '', reference: '', noActivity: false, rows: [] as SourceForm[] });
function addRow() { monthForm.rows.push({ doctorId: '', revenue: '0.00', material: '0.00', expense: '0.00', revenueReference: '', materialReference: '', expenseReference: '' }); }
function openMonth(item?: IncentiveMonth, chosenClinic?: string, chosenMonth?: string) {
  editingMonth.value = item || null;
  monthReadOnly.value = !context.value?.actor || (!!item && (item.status !== 'draft' || item.createdBy !== auth.user?.id));
  Object.assign(monthForm, { clinicId: item?.clinicId || chosenClinic || clinicId.value || context.value?.clinics[0]?.id || '',
    month: item?.month || chosenMonth || monthOptions.value[0] || '', reference: item?.reference || '', noActivity: item?.noActivity || false,
    rows: item?.rows.map(row => ({ doctorId: row.doctorId, revenue: centsToYuan(row.revenueCents), material: centsToYuan(row.materialCostCents), expense: centsToYuan(row.operatingExpenseCents), revenueReference: row.revenueReference, materialReference: row.materialReference, expenseReference: row.expenseReference })) || [] });
  if (!item) addRow();
  formError.value = ''; monthDialog.value = true;
}
function monthBody(): IncentiveMonthInput {
  if (!monthForm.clinicId || !monthForm.month || !monthForm.reference.trim()) throw new Error('请选择门诊、月份并填写底稿依据。');
  if (!monthForm.noActivity && !monthForm.rows.length) throw new Error('请添加医生账证，或明确确认本月无业务。');
  const seen = new Set<string>();
  const rows: FinancialSourceInput[] = monthForm.noActivity ? [] : monthForm.rows.map(row => {
    if (!row.doctorId || seen.has(row.doctorId)) throw new Error('每位医生只保留一行，不能重复或遗漏医生。');
    seen.add(row.doctorId);
    if (![row.revenueReference, row.materialReference, row.expenseReference].every(value => value.trim())) throw new Error('收入、用品成本和运营费用均须填写来源编号；零金额也需有依据。');
    return { doctorId: row.doctorId, revenueCents: yuanToCents(row.revenue), materialCostCents: yuanToCents(row.material), operatingExpenseCents: yuanToCents(row.expense),
      revenueReference: row.revenueReference.trim(), materialReference: row.materialReference.trim(), expenseReference: row.expenseReference.trim() };
  });
  return { clinicId: monthForm.clinicId, month: monthForm.month, reference: monthForm.reference.trim(), noActivity: monthForm.noActivity, rows,
    ...(editingMonth.value ? { expectedVersion: editingMonth.value.rowVersion } : {}) };
}
async function saveMonth() {
  if (busy.value || monthReadOnly.value) return;
  formError.value = '';
  let body: IncentiveMonthInput;
  try { body = monthBody(); } catch (e) { formError.value = errorText(e); return; }
  busy.value = true;
  try {
    await api(editingMonth.value ? '/compensation/months/' + editingMonth.value.id : '/compensation/months', { method: editingMonth.value ? 'PUT' : 'POST', body });
    monthDialog.value = false; ElMessage.success('月度底稿已保存。'); await load();
  } catch (e) { formError.value = errorText(e); } finally { busy.value = false; }
}
async function closeMonth(item: IncentiveMonth) {
  try {
    await ElMessageBox.confirm('请核对全部医生及三类账证。关闭后底稿进入季度核算来源。', '独立复核关闭 ' + item.month,
      { confirmButtonText: '复核并关闭', cancelButtonText: '返回' });
  } catch { return; }
  await action('/compensation/months/' + item.id + '/close', { expectedVersion: item.rowVersion }, '月份已关闭。');
}
async function reopenMonth(item: IncentiveMonth) {
  try {
    const response = await ElMessageBox.prompt('请说明重开原因。已被有效季度快照引用的月份不能重开。', '重开月份',
      { inputType: 'textarea', inputValidator: value => !!value?.trim() || '请填写原因', confirmButtonText: '确认重开', cancelButtonText: '返回' });
    await action('/compensation/months/' + item.id + '/reopen', { expectedVersion: item.rowVersion, reason: response.value.trim() }, '月份已重开。');
  } catch { /* Cancel leaves the closed month unchanged. */ }
}

const createQuarterDialog = ref(false), quarterReference = ref('');
const detail = ref<IncentiveQuarterDetail | null>(null), detailDialog = ref(false), detailLoading = ref(false), detailError = ref('');
let detailSequence = 0;
async function showQuarter(id: string) {
  const sequence = ++detailSequence;
  detailDialog.value = true; detailLoading.value = true; detailError.value = ''; detail.value = null;
  try { const result = await api<IncentiveQuarterDetail>('/compensation/quarters/' + id); if (!disposed && sequence === detailSequence) detail.value = result; }
  catch (e) { if (!disposed && sequence === detailSequence) detailError.value = errorText(e); }
  finally { if (!disposed && sequence === detailSequence) detailLoading.value = false; }
}
async function createQuarter() {
  if (!quarterReference.value.trim()) { formError.value = '请填写季度核算依据。'; return; }
  if (busy.value) return;
  busy.value = true; formError.value = '';
  try {
    const result = await api<IncentiveQuarter>('/compensation/quarters', { method: 'POST', body: { quarter: quarter.value, reference: quarterReference.value.trim() } });
    createQuarterDialog.value = false; ElMessage.success('季度快照已生成。'); await load(); await showQuarter(result.id);
  } catch (e) { formError.value = errorText(e); } finally { busy.value = false; }
}
async function action(path: string, body: unknown, success: string, detailId?: string) {
  if (busy.value) return;
  busy.value = true;
  try { await api(path, { method: 'POST', body }); ElMessage.success(success); await load(); if (detailId) await showQuarter(detailId); }
  catch (e) { ElMessage.error(errorText(e)); }
  finally { busy.value = false; }
}
async function quarterAction(kind: 'submit' | 'approve' | 'void') {
  const item = detail.value;
  if (!item) return;
  let reason: string | undefined;
  try {
    if (kind === 'void') {
      const response = await ElMessageBox.prompt('作废后保留当前快照，可重新生成季度结果。', '作废季度快照',
        { inputType: 'textarea', inputValidator: value => !!value?.trim() || '请填写作废原因', confirmButtonText: '确认作废', cancelButtonText: '返回' });
      reason = response.value.trim();
    } else await ElMessageBox.confirm(kind === 'submit' ? '确认来源、净利润和个人分配后，提交独立人员复核。' : '请核对来源完整性、10%基金及个人份额。批准后可登记发放。',
      kind === 'submit' ? '提交季度复核' : '批准季度激励', { confirmButtonText: kind === 'submit' ? '提交复核' : '独立复核通过', cancelButtonText: '返回' });
  } catch { return; }
  await action('/compensation/quarters/' + item.id + '/' + kind, { expectedVersion: item.rowVersion, ...(reason ? { reason } : {}) },
    kind === 'submit' ? '已提交复核。' : kind === 'approve' ? '季度激励已批准。' : '季度快照已作废。', item.id);
}

const paymentDialog = ref(false), paymentAllocation = ref<IncentiveAllocation | null>(null), paymentAmount = ref(''), paymentReference = ref('');
function openPayment(allocation: IncentiveAllocation) {
  paymentAllocation.value = allocation; paymentAmount.value = centsToYuan(allocation.remainingCents); paymentReference.value = ''; formError.value = ''; paymentDialog.value = true;
}
async function savePayment() {
  const allocation = paymentAllocation.value;
  if (!allocation || busy.value) return;
  let amountCents: number;
  try {
    amountCents = yuanToCents(paymentAmount.value);
    if (amountCents <= 0 || amountCents > allocation.remainingCents) throw new Error('发放金额须大于零且不超过可发余额。');
    if (!paymentReference.value.trim()) throw new Error('请填写唯一的发放凭证编号。');
  } catch (e) { formError.value = errorText(e); return; }
  busy.value = true; formError.value = '';
  try {
    await api('/compensation/allocations/' + allocation.id + '/payments', { method: 'POST', body: { expectedVersion: allocation.rowVersion, amountCents, reference: paymentReference.value.trim() } });
    paymentDialog.value = false; ElMessage.success('已登记待确认发放，请核验后登记结果。');
    await load(); if (detail.value) await showQuarter(detail.value.id);
  } catch (e) { formError.value = errorText(e); } finally { busy.value = false; }
}
const resolveDialog = ref(false), resolving = ref<IncentivePayment | null>(null), resultStatus = ref<'succeeded' | 'failed' | ''>(''), resultReference = ref('');
function openResolve(payment: IncentivePayment) { resolving.value = payment; resultStatus.value = ''; resultReference.value = ''; formError.value = ''; resolveDialog.value = true; }
async function resolvePayment() {
  const payment = resolving.value;
  if (!payment || busy.value) return;
  if (!resultStatus.value || !resultReference.value.trim()) { formError.value = '请选择核验结果并填写结果凭据。'; return; }
  busy.value = true; formError.value = '';
  try {
    await api('/compensation/payments/' + payment.id + '/resolve', { method: 'POST', body: { expectedVersion: payment.rowVersion, status: resultStatus.value, reference: resultReference.value.trim() } });
    resolveDialog.value = false; ElMessage.success('发放结果已登记。'); await load(); if (detail.value) await showQuarter(detail.value.id);
  } catch (e) { formError.value = errorText(e); } finally { busy.value = false; }
}
onMounted(load);
onUnmounted(() => { disposed = true; loadSequence++; detailSequence++; });
</script>

<template>
  <section class="page-heading">
    <div><h1>{{ pageTitle }}</h1><p>{{ auth.isHq ? '汇总医生季度收入与成本，查看固定 10% 激励基金、个人分配和发放结果。' : canManage ? '登记门诊月度账证，经独立复核后纳入总部季度核算。' : '查看本人已批准的季度激励及发放记录。' }}</p></div>
    <el-button :icon="Refresh" :loading="loading" :disabled="busy" @click="load">刷新</el-button>
  </section>
  <el-alert v-if="error" class="mb-16" :title="error" type="error" show-icon :closable="false" />
  <el-alert v-if="canManage && context && !context.actor" class="mb-16" title="请先在员工账号与档案中关联本人档案，再制表或复核。" type="warning" show-icon :closable="false" />
  <section v-if="canManage" class="panel incentive-rules mb-16" aria-label="季度激励核算口径">
    <div class="incentive-rule-heading"><div><h2>净利润的 10% 作为季度激励基金</h2><p>净利润 = 治疗收入净额 − 医疗用品成本 − 医生运营费用</p></div><span class="fixed-rate">固定比例 <strong>10%</strong></span></div>
    <p class="incentive-workflow">月度账证 → 独立复核关闭 → 总部季度快照与批准 → 个人分配与发放。医生登录后从“我的季度激励”查看本人已批准的份额。</p>
    <details class="incentive-basis"><summary>查看核算口径与制度依据</summary><p>原案例第 1 页规定净利润定义及 10% 激励基金，第 2 页要求按季度跟踪每位牙医的收入、成本和运营费用。</p><p>本系统补充制度：先跨店合并，亏损计入全体净利润；基金最低为零，四舍五入到分；个人份额按正净贡献比例分配，余分按固定规则补齐；月度账证和季度结果均须独立复核。案例未给出个人分配、基本工资、税费或社保算法。</p></details>
  </section>
  <div v-if="canManage" class="panel mb-16 compensation-filters">
    <el-form inline @submit.prevent="load"><el-form-item label="季度"><el-input v-model="quarter" aria-label="核算季度" placeholder="2026-Q3" maxlength="7" style="width:130px" @input="filtersChanged" /></el-form-item>
      <el-form-item v-if="tab==='months'" label="门诊"><el-select v-model="clinicId" placeholder="全部授权门诊" clearable style="width:230px" @change="filtersChanged"><el-option v-for="clinic in context?.clinics || []" :key="clinic.id" :value="clinic.id" :label="clinic.name" /></el-select></el-form-item>
      <el-form-item><el-button type="primary" native-type="submit" :disabled="loading || busy">查询</el-button></el-form-item>
    </el-form>
  </div>
  <el-tabs v-model="tab" class="compensation-tabs">
    <el-tab-pane v-if="canManage" label="月度底稿" name="months">
      <div class="panel" v-loading="loading">
        <div class="panel-heading"><div><h2>来源完整性</h2><p>已关闭 {{ closedCount }} / {{ coverage.length }} 个月份。无业务月份也需确认。</p></div>
          <el-button type="primary" :icon="Plus" :disabled="busy || loading || !context?.actor || !monthOptions.length" @click="openMonth()">月度底稿</el-button></div>
        <el-table :data="coverage" empty-text="查询后显示核算月份" style="width:100%">
          <el-table-column label="门诊" min-width="160"><template #default="{row}">{{ row.clinic.name }}</template></el-table-column>
          <el-table-column prop="month" label="月份" min-width="95" />
          <el-table-column label="状态" min-width="110"><template #default="{row}"><el-tag :type="row.source?.status==='closed'?'success':'info'">{{ row.source ? status(row.source.status) : '未登记' }}</el-tag></template></el-table-column>
          <el-table-column label="制表 / 复核" min-width="160"><template #default="{row}">{{ row.source?.createdByName || '—' }}<div class="muted small">{{ row.source?.closedByName || '待独立复核' }}</div></template></el-table-column>
          <el-table-column label="业务" min-width="95"><template #default="{row}">{{ row.source ? row.source.noActivity ? '无业务' : row.source.rows.length + ' 位医生' : '—' }}</template></el-table-column>
          <el-table-column label="操作" min-width="210"><template #default="{row}">
            <el-button v-if="!row.source" link type="primary" :disabled="busy || !context?.actor" @click="openMonth(undefined,row.clinic.id,row.month)">登记</el-button>
            <template v-else><el-button link type="primary" :disabled="busy" @click="openMonth(row.source)">{{ row.source.status==='draft' && row.source.createdBy===auth.user?.id ? '编辑' : '查看底稿' }}</el-button>
              <el-button v-if="row.source.status==='draft'" link type="primary" :disabled="busy || !canReview(row.source)" @click="closeMonth(row.source)">复核关闭</el-button>
              <el-button v-if="row.source.status==='closed' && auth.isHq" link type="primary" :disabled="busy || !context?.actor" @click="reopenMonth(row.source)">重开</el-button></template>
          </template></el-table-column>
        </el-table>
      </div>
    </el-tab-pane>
    <el-tab-pane v-if="auth.isHq" label="季度业绩与激励" name="quarters">
      <el-alert v-if="quarters.some(item => item.reference.includes('虚构'))" class="mb-16" title="标注“虚构演示”的季度账证、基金和个人份额仅供课程演示。" type="info" show-icon :closable="false" />
      <div class="panel" v-loading="loading">
        <div class="panel-heading"><div><h2>季度核算</h2><p>跨店合并医生净利润，提取合计正值的 10%。</p></div><el-button type="primary" :icon="Plus" :disabled="loading || busy || !context?.actor" @click="quarterReference='';formError='';createQuarterDialog=true">生成季度快照</el-button></div>
        <el-table :data="quarters" empty-text="暂无该季度快照">
          <el-table-column label="季度" min-width="110"><template #default="{row}">{{ row.quarter }}<div v-if="row.reference.includes('虚构')" class="muted small">虚构演示</div></template></el-table-column>
          <el-table-column label="状态" min-width="100"><template #default="{row}"><el-tag :type="row.status==='approved'?'success':row.status==='submitted'?'warning':'info'">{{ status(row.status) }}</el-tag></template></el-table-column>
          <el-table-column label="治疗收入净额" min-width="140" align="right"><template #default="{row}">{{ money(row.totalRevenueCents) }}</template></el-table-column>
          <el-table-column label="用品成本" min-width="130" align="right"><template #default="{row}">{{ money(row.totalMaterialCostCents) }}</template></el-table-column>
          <el-table-column label="运营费用" min-width="130" align="right"><template #default="{row}">{{ money(row.totalOperatingExpenseCents) }}</template></el-table-column>
          <el-table-column label="净利润" min-width="140" align="right"><template #default="{row}">{{ money(row.netProfitCents) }}</template></el-table-column>
          <el-table-column label="10% 激励基金" min-width="140" align="right"><template #default="{row}">{{ money(row.fundCents) }}</template></el-table-column>
          <el-table-column prop="createdByName" label="制表人" min-width="105" />
          <el-table-column label="生成时间" min-width="150"><template #default="{row}">{{ dateTime(row.createdAt) }}</template></el-table-column>
          <el-table-column label="操作" min-width="155" fixed="right"><template #default="{row}"><el-button link type="primary" @click="showQuarter(row.id)">个人分配与明细</el-button></template></el-table-column>
        </el-table>
      </div>
    </el-tab-pane>
    <el-tab-pane label="我的激励" name="mine">
      <el-alert v-if="mine.notice" class="mb-16" :title="mine.notice" type="info" show-icon :closable="false" />
      <div v-loading="loading" class="personal-incentives">
        <el-empty v-if="!mine.allocations.length && !loading" description="暂无本人已批准的季度激励" />
        <article v-for="allocation in mine.allocations" :key="allocation.id" class="panel personal-incentive">
          <div class="panel-heading"><div><h2>{{ allocation.quarter }} · {{ allocation.doctorName }}</h2><p>{{ allocation.employeeNo }}</p></div><strong class="award">{{ money(allocation.amountCents) }}</strong></div>
          <div class="personal-totals"><span>跨店净贡献<strong>{{ money(allocation.contributionCents) }}</strong></span><span>已发放<strong>{{ money(allocation.paidCents) }}</strong></span><span>待确认<strong>{{ money(allocation.pendingCents) }}</strong></span><span>未发放<strong>{{ money(allocation.remainingCents) }}</strong></span></div>
          <el-table :data="allocation.payments" empty-text="尚无发放记录"><el-table-column prop="reference" label="发放凭证" min-width="180" /><el-table-column label="金额" min-width="120"><template #default="{row}">{{ money(row.amountCents) }}</template></el-table-column><el-table-column label="状态" min-width="110"><template #default="{row}">{{ status(row.status) }}</template></el-table-column><el-table-column label="登记时间" min-width="150"><template #default="{row}">{{ dateTime(row.createdAt) }}</template></el-table-column><el-table-column prop="resultReference" label="核验结果凭据" min-width="170" /></el-table>
        </article>
      </div>
    </el-tab-pane>
  </el-tabs>
  <p class="compensation-note">医生季度激励按核验账证计算；预约标价不计作治疗收入。</p>

  <el-dialog append-to-body v-model="monthDialog" :title="monthReadOnly?'月度账证底稿':editingMonth?'编辑月度底稿':'登记月度底稿'" width="min(1120px,96vw)" :close-on-click-modal="false">
    <el-alert v-if="formError" class="mb-16" :title="formError" type="error" :closable="false" />
    <el-form label-position="top" :disabled="monthReadOnly || busy" @submit.prevent="saveMonth">
      <div class="month-form-grid"><el-form-item label="门诊"><el-select v-model="monthForm.clinicId" :disabled="!!editingMonth" style="width:100%"><el-option v-for="clinic in context?.clinics || []" :key="clinic.id" :value="clinic.id" :label="clinic.name" /></el-select></el-form-item>
        <el-form-item label="月份"><el-select v-model="monthForm.month" :disabled="!!editingMonth" style="width:100%"><el-option v-for="month in monthOptions" :key="month" :value="month" :label="month" /></el-select></el-form-item></div>
      <el-form-item label="底稿依据 / 无业务确认依据"><el-input v-model="monthForm.reference" type="textarea" :rows="2" maxlength="500" show-word-limit placeholder="账证汇总编号、核验说明" /></el-form-item>
      <el-form-item><el-switch v-model="monthForm.noActivity" active-text="确认本月无业务" /></el-form-item>
      <template v-if="!monthForm.noActivity">
        <div v-for="(row,index) in monthForm.rows" :key="index" class="source-row">
          <div class="source-heading"><el-form-item label="医生"><el-select v-model="row.doctorId" filterable placeholder="选择医生" style="width:280px;max-width:100%"><el-option v-for="doctor in context?.doctors || []" :key="doctor.id" :value="doctor.id" :label="doctor.name+' · '+doctor.employeeNo" :disabled="monthForm.rows.some((other,j)=>j!==index && other.doctorId===doctor.id)" /></el-select></el-form-item><el-button v-if="!monthReadOnly" :disabled="busy" @click="monthForm.rows.splice(index,1)">移除</el-button></div>
          <div class="source-grid"><div><el-form-item label="治疗收入净额（元）"><el-input v-model="row.revenue" inputmode="decimal" maxlength="18" /></el-form-item><el-form-item label="收入来源编号"><el-input v-model="row.revenueReference" maxlength="500" /></el-form-item></div>
            <div><el-form-item label="医疗用品成本（元）"><el-input v-model="row.material" inputmode="decimal" maxlength="18" /></el-form-item><el-form-item label="用品成本来源编号"><el-input v-model="row.materialReference" maxlength="500" /></el-form-item></div>
            <div><el-form-item label="医生运营费用（元）"><el-input v-model="row.expense" inputmode="decimal" maxlength="18" /></el-form-item><el-form-item label="运营费用来源编号"><el-input v-model="row.expenseReference" maxlength="500" /></el-form-item></div></div>
        </div>
        <el-button v-if="!monthReadOnly" :icon="Plus" @click="addRow">添加医生账证</el-button>
      </template>
      <p class="muted small mt-16">金额可包含有来源的负数调整。关闭时核对已发布出诊医生的覆盖情况。</p>
      <p v-if="editingMonth" class="muted small mt-12">制表：{{ editingMonth.createdByName }} · 来源修订 {{ editingMonth.sourceRevision }}<template v-if="editingMonth.closedByName">；复核：{{ editingMonth.closedByName }} · {{ dateTime(editingMonth.closedAt) }}</template></p>
    </el-form>
    <div class="dialog-actions"><el-button @click="monthDialog=false">关闭</el-button><el-button v-if="!monthReadOnly" type="primary" :loading="busy" @click="saveMonth">保存底稿</el-button></div>
  </el-dialog>
  <el-dialog append-to-body v-model="createQuarterDialog" title="生成季度核算快照" width="min(500px,94vw)">
    <p class="mb-16">{{ quarter }} · 全部门诊的三个月底稿须已独立复核关闭。</p><el-alert v-if="formError" class="mb-16" :title="formError" type="error" :closable="false" />
    <el-input v-model="quarterReference" type="textarea" :rows="3" maxlength="500" placeholder="季度核算依据 / 汇总编号" />
    <template #footer><el-button @click="createQuarterDialog=false">返回</el-button><el-button type="primary" :loading="busy" @click="createQuarter">生成快照</el-button></template>
  </el-dialog>
  <el-dialog append-to-body v-model="detailDialog" title="季度激励明细" width="min(1240px,96vw)" :close-on-click-modal="false">
    <div v-loading="detailLoading"><el-alert v-if="detailError" :title="detailError" type="error" :closable="false" />
      <template v-if="detail">
        <div class="quarter-heading"><div><h2>{{ detail.quarter }} <el-tag>{{ status(detail.status) }}</el-tag></h2><p class="muted small">{{ detail.reference }}</p><p class="muted small">制表：{{ detail.createdByName }}<template v-if="detail.approvedByName">；复核：{{ detail.approvedByName }}</template> · 规则 {{ detail.ruleVersion }}</p></div>
          <div class="button-row"><el-button v-if="detail.status==='draft' && detail.createdBy===auth.user?.id" :disabled="busy || !context?.actor" type="primary" @click="quarterAction('submit')">提交复核</el-button>
            <el-button v-if="detail.status==='submitted'" :disabled="busy || !canReview(detail)" type="primary" @click="quarterAction('approve')">独立复核通过</el-button><el-button v-if="['draft','submitted'].includes(detail.status)" :disabled="busy || !context?.actor" @click="quarterAction('void')">作废</el-button></div></div>
        <el-alert v-if="detail.voidReason" class="mt-16" :title="'作废原因：'+detail.voidReason" type="info" :closable="false" />
        <div class="quarter-metrics"><div><span>治疗收入净额</span><strong>{{ money(detail.totalRevenueCents) }}</strong></div><div><span>用品成本</span><strong>{{ money(detail.totalMaterialCostCents) }}</strong></div><div><span>运营费用</span><strong>{{ money(detail.totalOperatingExpenseCents) }}</strong></div><div><span>合计净利润</span><strong>{{ money(detail.netProfitCents) }}</strong></div><div class="fund"><span>10% 激励基金</span><strong>{{ money(detail.fundCents) }}</strong></div></div>
        <el-tabs>
          <el-tab-pane label="个人分配与发放"><el-table :data="detail.allocations">
            <el-table-column prop="doctorName" label="医生" min-width="130" /><el-table-column prop="employeeNo" label="员工编号" min-width="110" />
            <el-table-column label="跨店净贡献" min-width="130" align="right"><template #default="{row}">{{ money(row.contributionCents) }}</template></el-table-column>
            <el-table-column :label="detail.status==='approved'?'批准份额':'试算份额'" min-width="120" align="right"><template #default="{row}">{{ money(row.amountCents) }}</template></el-table-column>
            <el-table-column label="已发放" min-width="120" align="right"><template #default="{row}">{{ money(row.paidCents) }}</template></el-table-column>
            <el-table-column label="待确认" min-width="120" align="right"><template #default="{row}">{{ money(row.pendingCents) }}</template></el-table-column>
            <el-table-column label="可发余额" min-width="120" align="right"><template #default="{row}">{{ money(row.remainingCents) }}</template></el-table-column>
            <el-table-column v-if="detail.status==='approved'" label="操作" min-width="100"><template #default="{row}"><el-button link type="primary" :disabled="busy || row.remainingCents<=0 || !context?.actor" @click="openPayment(row)">登记发放</el-button></template></el-table-column>
          </el-table><p class="muted small mt-12">份额按正净贡献比例分配，余分按固定规则补齐；亏损保留在基金计算中。</p>
            <h3 class="mt-24">发放记录</h3><el-table :data="detail.payments" empty-text="暂无发放记录">
              <el-table-column label="医生" min-width="120"><template #default="{row}">{{ detail.allocations.find(a=>a.id===row.allocationId)?.doctorName || '—' }}</template></el-table-column>
              <el-table-column prop="reference" label="发放凭证" min-width="160" /><el-table-column label="金额" min-width="110"><template #default="{row}">{{ money(row.amountCents) }}</template></el-table-column>
              <el-table-column label="状态" min-width="100"><template #default="{row}">{{ status(row.status) }}</template></el-table-column><el-table-column prop="resultReference" label="核验结果凭据" min-width="160" />
              <el-table-column label="操作" min-width="100"><template #default="{row}"><el-button v-if="row.status==='pending'" link type="primary" :disabled="busy || !context?.actor" @click="openResolve(row)">登记结果</el-button></template></el-table-column>
            </el-table>
          </el-tab-pane>
          <el-tab-pane label="医生门诊明细"><el-table :data="detail.results"><el-table-column prop="doctorName" label="医生" min-width="130" /><el-table-column prop="clinicName" label="门诊" min-width="150" /><el-table-column label="收入" min-width="130" align="right"><template #default="{row}">{{ money(row.revenueCents) }}</template></el-table-column><el-table-column label="用品成本" min-width="130" align="right"><template #default="{row}">{{ money(row.materialCostCents) }}</template></el-table-column><el-table-column label="运营费用" min-width="130" align="right"><template #default="{row}">{{ money(row.operatingExpenseCents) }}</template></el-table-column><el-table-column label="净利润" min-width="130" align="right"><template #default="{row}">{{ money(row.netProfitCents) }}</template></el-table-column></el-table></el-tab-pane>
          <el-tab-pane label="月份来源"><el-table :data="detail.months"><el-table-column prop="clinicName" label="门诊" min-width="150" /><el-table-column prop="month" label="月份" min-width="100" /><el-table-column label="业务" min-width="100"><template #default="{row}">{{ row.noActivity?'无业务确认':'有业务底稿' }}</template></el-table-column><el-table-column prop="reference" label="核算依据" min-width="200" /><el-table-column prop="sourceRevision" label="来源修订" min-width="100" /><el-table-column label="关闭时间" min-width="150"><template #default="{row}">{{ dateTime(row.closedAt) }}</template></el-table-column></el-table></el-tab-pane>
        </el-tabs>
      </template>
    </div>
  </el-dialog>
  <el-dialog append-to-body v-model="paymentDialog" title="登记待确认发放" width="min(500px,94vw)">
    <p class="mb-16">{{ paymentAllocation?.doctorName }} · 可发余额 {{ money(paymentAllocation?.remainingCents || 0) }}</p>
    <el-alert v-if="formError" class="mb-16" :title="formError" type="error" :closable="false" />
    <el-form label-position="top" @submit.prevent="savePayment"><el-form-item label="金额（元）"><el-input v-model="paymentAmount" inputmode="decimal" maxlength="18" /></el-form-item><el-form-item label="唯一发放凭证编号"><el-input v-model="paymentReference" maxlength="500" /></el-form-item><p class="muted small">保存后占用可发额度，核验实际结果后再登记成功或失败。</p><div class="dialog-actions"><el-button @click="paymentDialog=false">返回</el-button><el-button type="primary" native-type="submit" :loading="busy">登记待确认</el-button></div></el-form>
  </el-dialog>
  <el-dialog append-to-body v-model="resolveDialog" title="登记实际发放结果" width="min(500px,94vw)">
    <p class="mb-16">{{ resolving?.reference }} · {{ money(resolving?.amountCents || 0) }}</p>
    <el-alert v-if="formError" class="mb-16" :title="formError" type="error" :closable="false" />
    <el-form label-position="top" @submit.prevent="resolvePayment"><el-form-item label="核验结果"><el-select v-model="resultStatus" placeholder="选择已核实的结果" style="width:100%"><el-option value="succeeded" label="确认发放成功" /><el-option value="failed" label="确认发放失败" /></el-select></el-form-item><el-form-item label="结果凭据 / 查询回执"><el-input v-model="resultReference" maxlength="500" /></el-form-item><p class="muted small">结果尚不明确时保留待确认，核实后再登记。</p><div class="dialog-actions"><el-button @click="resolveDialog=false">保留待确认</el-button><el-button type="primary" native-type="submit" :loading="busy">保存结果</el-button></div></el-form>
  </el-dialog>
</template>

<style scoped>
.incentive-rules { padding: 22px 24px; }
.incentive-rule-heading { display: flex; justify-content: space-between; align-items: center; gap: 18px; }
.incentive-rule-heading h2 { font-size: 17px; margin: 0 0 10px; }
.incentive-rule-heading p,.incentive-workflow,.incentive-basis p { font-size: 13px; color: #6e6962; line-height: 1.8; margin: 0; }
.fixed-rate { background: #eae3d8; padding: 10px 16px; border-radius: 10px; font-size: 12px; white-space: nowrap; }
.fixed-rate strong { display: block; margin-top: 3px; font-size: 24px; }
.incentive-workflow { margin-top: 16px; }
.incentive-basis { margin-top: 14px; border-top: 1px solid #ebe6df; padding-top: 12px; }
.incentive-basis summary { cursor: pointer; font-size: 13px; color: #62503b; }
.incentive-basis p { margin-top: 10px; }
.compensation-filters { padding: 20px 24px 2px; }
.compensation-tabs :deep(.el-tabs__header) { margin-bottom: 20px; }
.compensation-note { color: #77716a; font-size: 12px; margin-top: 18px; }
.month-form-grid,.source-grid,.quarter-metrics,.personal-totals { display: grid; gap: 18px; }
.month-form-grid { grid-template-columns: 2fr 1fr; }
.source-row { background: #f8f6f2; border: 1px solid #ebe6df; border-radius: 12px; margin-bottom: 16px; padding: 20px; }
.source-heading,.quarter-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; }
.source-grid { grid-template-columns: repeat(3,minmax(0,1fr)); }
.source-grid .el-form-item:last-child { margin-bottom: 0; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px; }
.quarter-metrics { grid-template-columns: repeat(5,minmax(0,1fr)); margin: 24px 0; gap: 10px; }
.quarter-metrics > div { background: #f8f6f2; border-radius: 10px; padding: 16px; }
.quarter-metrics span,.personal-totals span { color: #77716a; font-size: 12px; }
.quarter-metrics strong,.personal-totals strong { display: block; font-size: 18px; font-weight: 600; color: #292d30; margin-top: 8px; overflow-wrap: anywhere; }
.quarter-metrics .fund { background: #eae3d8; }
.personal-incentives { display: grid; gap: 18px; }
.award { font-size: 24px; font-weight: 600; }
.personal-totals { grid-template-columns: repeat(4,minmax(0,1fr)); padding: 0 24px 24px; }
@media(max-width:760px) { .month-form-grid,.source-grid { grid-template-columns: 1fr; } .quarter-metrics { grid-template-columns: repeat(2,minmax(0,1fr)); } .source-heading,.quarter-heading { flex-wrap: wrap; } .personal-totals { grid-template-columns: repeat(2,minmax(0,1fr)); } .compensation-filters { padding: 16px 16px 0; } .source-row { padding: 16px; } .incentive-rules { padding: 18px 16px; } .incentive-rule-heading { align-items: flex-start; } .fixed-rate { padding: 10px; } }
</style>
