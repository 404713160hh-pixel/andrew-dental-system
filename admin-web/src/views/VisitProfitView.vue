<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { CompensationContext, OperatingExpenseMonth, VisitProfitQuarter } from '@andrew/shared';
import { api, errorText, query } from '../api';
import { centsToYuan, previousQuarter, yuanToCents } from '../compensation-view';
import { money, today } from '../utils';
import { useAuth } from '../stores/auth';

const auth = useAuth();
const month = today().slice(0, 7);
const quarterNow = month.slice(0, 4) + '-Q' + Math.ceil(Number(month.slice(5)) / 3);
const quarter = ref(quarterNow);
const clinicId = ref('');
const context = ref<CompensationContext>();
const report = ref<VisitProfitQuarter>();
const scope = ref('');
const loading = ref(false);
const error = ref('');
const dialog = ref(false);
const expenseBusy = ref(false);
const expenseError = ref('');
const sheet = ref<OperatingExpenseMonth>();
const items = ref<{label:string;amount:string;reference:string}[]>([]);
const costClinic = ref('');
const costMonth = ref(month);
const labels = computed(() => context.value?.clinics ?? []);
const showAward = computed(() => auth.isHq && !scope.value);
const demoCount = computed(() => report.value?.months.reduce((n,m)=>n+m.demoVisits,0) ?? 0);

async function load() {
  if (loading.value) return;
  loading.value = true;
  error.value = '';
  report.value = undefined;
  const selected = clinicId.value;
  try {
    report.value = await api('/compensation/visit-profit' + query({ quarter:quarter.value,clinicId:selected }));
    scope.value = selected;
  } catch(e) { error.value = errorText(e); }
  finally { loading.value = false; }
}
onMounted(async () => {
  try { context.value = await api<CompensationContext>('/compensation/context'); await load(); }
  catch(e) { error.value=errorText(e); }
});
async function openExpense(clinic = '', selectedMonth = month) {
  costClinic.value = clinic || clinicId.value || labels.value[0]?.id || '';
  costMonth.value = selectedMonth;
  dialog.value = true;
  await loadExpense();
}
async function loadExpense() {
  if (expenseBusy.value) return;
  sheet.value = undefined;
  items.value = [];
  expenseError.value = '';
  if (!costClinic.value || !costMonth.value) return;
  expenseBusy.value = true;
  try {
    const data = await api<OperatingExpenseMonth>('/compensation/operating-expenses' + query({ clinicId:costClinic.value,month:costMonth.value }));
    sheet.value = data;
    items.value = data.items.map(row=>({label:row.label,amount:centsToYuan(row.amountCents),reference:row.reference}));
  } catch(e) { expenseError.value=errorText(e); }
  finally { expenseBusy.value = false; }
}
async function saveExpense() {
  if (!sheet.value || expenseBusy.value) return;
  expenseBusy.value = true;
  expenseError.value = '';
  try {
    const rows = items.value.map(row => {
      const amountCents = yuanToCents(row.amount);
      if (!row.label.trim() || !row.reference.trim() || amountCents <= 0) throw new Error('请填写费用名称、正金额和凭据。');
      return {label:row.label.trim(),amountCents,reference:row.reference.trim()};
    });
    if (!rows.length) {
      try { await ElMessageBox.confirm('确认该门诊本月运营费用为零？','确认零费用'); }
      catch { return; }
    }
    await api('/compensation/operating-expenses' + query({ clinicId:sheet.value.clinicId,month:sheet.value.month }),
      {method:'PUT',body:{items:rows,expectedVersion:sheet.value.rowVersion}});
    dialog.value = false;
    ElMessage.success('运营费用已保存并重新分摊。');
    await load();
  } catch(e) { expenseError.value = errorText(e); }
  finally { expenseBusy.value = false; }
}
async function createLedger(clinicId: string, selectedMonth: string) {
  try {
    await ElMessageBox.confirm('用该月的就诊收入、耗材和已登记运营费用生成待复核底稿？','生成月度底稿');
  } catch { return; }
  try {
    await api('/compensation/months/from-visits',{method:'POST',body:{clinicId,month:selectedMonth}});
    ElMessage.success('已生成月度底稿，请到业绩与激励页面复核。');
  } catch(e) { ElMessage.error(errorText(e)); }
}
</script>

<template>
  <div class="page-heading"><div><h1>成本与季度利润</h1><p>按实际接诊医生汇总已出单收入、耗材成本和运营费用。</p></div><el-button type="primary" :disabled="!labels.length" @click="openExpense()">录入运营费用</el-button></div>
  <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" />
  <el-card v-loading="loading" shadow="never" class="profit-panel">
    <div class="profit-controls">
      <el-input v-model="quarter" aria-label="季度" placeholder="例如 2026-Q4" maxlength="7" :disabled="loading" />
      <el-select v-model="clinicId" aria-label="门诊" placeholder="全部门诊" clearable :disabled="loading"><el-option v-for="clinic in labels" :key="clinic.id" :label="clinic.name" :value="clinic.id" /></el-select>
      <el-button type="primary" :loading="loading" @click="load">查询</el-button>
      <el-button :disabled="loading" @click="quarter=previousQuarter(); load()">上个季度</el-button>
    </div>
    <template v-if="report">
      <el-alert v-if="demoCount" title="当前报表包含带标记的虚构演示就诊。" type="info" :closable="false" show-icon />
      <el-alert v-if="report.missingMaterials || report.unbilled || report.missingExpenseMonths || report.unallocatedCents"
        :title="'待补账证：' + report.unbilled + ' 笔未出单、' + report.missingMaterials + ' 笔缺耗材确认、' + report.missingExpenseMonths + ' 个门诊月份缺费用，未分摊 ' + money(report.unallocatedCents)"
        type="warning" :closable="false" show-icon />
      <div class="profit-totals">
        <div><span>治疗收入</span><strong>{{ money(report.revenueCents) }}</strong></div>
        <div><span>耗材成本</span><strong>{{ money(report.materialCostCents) }}</strong></div>
        <div><span>运营费用</span><strong>{{ money(report.expenseCents) }}</strong></div>
        <div><span>季度净利润 {{ report.quarter }}</span><strong>{{ money(report.netProfitCents) }}</strong></div>
        <div v-if="showAward"><span>10% 激励基金预估</span><strong>{{ money(report.fundCents) }}</strong></div>
      </div>
      <p>收入和耗材按治疗完成日期归月。运营费用按医生收入比例分摊，无收入时按完成就诊数分摊。正式激励以已复核的季度账证为准。</p>
      <el-table :data="report.doctors" empty-text="该季度暂无完成就诊">
        <el-table-column prop="doctorName" label="实际接诊医生" min-width="150" />
        <el-table-column prop="visits" label="就诊数" min-width="82" align="right" />
        <el-table-column label="收入" min-width="100" align="right"><template #default="{row}">{{ money(row.revenueCents) }}</template></el-table-column>
        <el-table-column label="耗材成本" min-width="100" align="right"><template #default="{row}">{{ money(row.materialCostCents) }}</template></el-table-column>
        <el-table-column label="费用分摊" min-width="100" align="right"><template #default="{row}">{{ money(row.expenseCents) }}</template></el-table-column>
        <el-table-column label="净利润" min-width="110" align="right"><template #default="{row}">{{ money(row.netProfitCents) }}</template></el-table-column>
        <el-table-column v-if="showAward" label="奖金预估" min-width="105" align="right"><template #default="{row}">{{ money(row.estimatedAwardCents ?? 0) }}</template></el-table-column>
      </el-table>
      <h2>门诊月度费用</h2>
      <el-table :data="report.months" empty-text="该季度暂无可登记月份">
        <el-table-column prop="clinicName" label="门诊" min-width="150" />
        <el-table-column prop="month" label="月份" min-width="95" />
        <el-table-column label="运营费用" min-width="110"><template #default="{row}">{{ row.expensesRecorded ? money(row.expenseCents) : '待登记' }}</template></el-table-column>
        <el-table-column label="未分摊" min-width="100"><template #default="{row}">{{ money(row.unallocatedCents) }}</template></el-table-column>
        <el-table-column label="操作" min-width="170"><template #default="{row}"><el-button link @click="openExpense(row.clinicId,row.month)">查看费用</el-button><el-button v-if="row.month < month" link @click="createLedger(row.clinicId,row.month)">生成底稿</el-button></template></el-table-column>
      </el-table>
    </template>
  </el-card>
  <el-dialog v-model="dialog" title="门诊运营费用" width="min(750px,96vw)">
    <div class="profit-controls">
      <el-select v-model="costClinic" aria-label="费用门诊" :disabled="expenseBusy" @change="loadExpense"><el-option v-for="clinic in labels" :key="clinic.id" :label="clinic.name" :value="clinic.id" /></el-select>
      <el-date-picker v-model="costMonth" type="month" value-format="YYYY-MM" :clearable="false" :disabled="expenseBusy" @change="loadExpense" />
    </div>
    <el-alert v-if="expenseError" :title="expenseError" type="error" :closable="false" />
    <template v-if="sheet">
      <p v-if="!items.length">暂无费用明细。零费用可直接保存并确认。</p>
      <div v-for="(item,index) in items" :key="index" class="profit-controls">
        <el-input v-model="item.label" aria-label="费用名称" placeholder="费用名称（如租金）" maxlength="100" :disabled="expenseBusy" />
        <el-input v-model="item.amount" aria-label="费用金额（元）" placeholder="金额（元）" inputmode="decimal" :disabled="expenseBusy" />
        <el-input v-model="item.reference" aria-label="费用凭据" placeholder="凭据编号或说明" maxlength="500" :disabled="expenseBusy" />
        <el-button :disabled="expenseBusy" @click="items.splice(index,1)">移除</el-button>
      </div>
      <el-button :disabled="expenseBusy || items.length >= 40" @click="items.push({label:'',amount:'',reference:''})">添加费用</el-button>
      <el-button type="primary" :loading="expenseBusy" @click="saveExpense">保存并分摊</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.profit-controls { display: flex; flex-wrap: wrap; gap: 10px; align-items:center; margin-bottom:14px; }
.profit-controls :deep(.el-select), .profit-controls :deep(.el-input) { width:min(180px,100%); }
.profit-controls :deep(.el-button) { margin-left:0; }
.profit-totals { display:grid; grid-template-columns:repeat(auto-fit,minmax(138px,1fr)); gap:12px; margin:16px 0; }
.profit-totals div { padding:12px; border:1px solid var(--brand-line,#e7e4df); border-radius:8px; }
.profit-totals strong { display:block; margin-top:6px; font-size:19px; }
.profit-panel h2 { font-size:17px; margin-top:24px; }
.profit-panel :deep(.el-alert) { margin-bottom:8px; }
</style>
