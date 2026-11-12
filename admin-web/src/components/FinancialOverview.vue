<script setup lang="ts">
import { computed, ref } from 'vue';
import { ArrowRight, Coin, DataLine, Document, OfficeBuilding, Wallet } from '@element-plus/icons-vue';
import { compensationStatuses } from '../compensation-view';
import type { IncentiveMonth, IncentiveQuarter } from '@andrew/shared';

const props = defineProps<{
  quarter: string;
  periods: string[];
  clinics: { id: string; name: string }[];
  months: IncentiveMonth[];
  snapshots: IncentiveQuarter[];
  history: IncentiveQuarter[];
  headquarters: boolean;
  loading: boolean;
  ready: boolean;
}>();
const emit = defineEmits<{ months: []; quarters: []; snapshot: [id: string] }>();

type Totals = { revenue: bigint; materials: bigint; operating: bigint; closed: number };
const emptyTotals = (): Totals => ({ revenue: 0n, materials: 0n, operating: 0n, closed: 0 });
const keys = [
  { key: 'revenue', label: '治疗收入' },
  { key: 'materials', label: '用品成本' },
  { key: 'operating', label: '运营费用' },
] as const;
const yuanInteger = new Intl.NumberFormat('zh-CN');
function currency(cents: bigint) {
  const absolute = cents < 0n ? -cents : cents;
  return (cents < 0n ? '−' : '') + '¥' + yuanInteger.format(absolute / 100n) + '.' + String(absolute % 100n).padStart(2, '0');
}
const profit = (totals: Totals) => totals.revenue - totals.materials - totals.operating;
const report = computed(() => {
  const total = emptyTotals();
  const clinics = new Map(props.clinics.map(clinic => [clinic.id, { ...clinic, ...emptyTotals() }]));
  const trend = new Map(props.periods.map(period => [period, { period, ...emptyTotals() }]));
  let drafts = 0;
  for (const month of props.months) {
    const clinic = clinics.get(month.clinicId);
    const period = trend.get(month.month);
    if (!clinic || !period) continue;
    if (month.status === 'draft') { drafts++; continue; }
    for (const entry of [total, clinic, period]) {
      entry.closed++;
      for (const row of month.rows) {
        entry.revenue += BigInt(row.revenueCents);
        entry.materials += BigInt(row.materialCostCents);
        entry.operating += BigInt(row.operatingExpenseCents);
      }
    }
  }
  const points = [...trend.values()];
  return { total, points, clinics: [...clinics.values()], drafts,
    expected: props.clinics.length * props.periods.length };
});
const snapshot = computed(() => props.snapshots.find(item => item.status !== 'voided'));
const synthetic = computed(() => props.months.some(item => item.reference.includes('虚构')) || snapshot.value?.reference.includes('虚构'));
const missing = computed(() => report.value.expected - report.value.total.closed - report.value.drafts);
const headlineMetrics = computed(() => [
  { name: '治疗收入', value: report.value.total.revenue, icon: Wallet },
  { name: '用品成本', value: report.value.total.materials, icon: Document },
  { name: '运营费用', value: report.value.total.operating, icon: OfficeBuilding },
  { name: '净利润', value: profit(report.value.total), icon: DataLine },
]);
const selectedMonth = ref('');
const axisFormat = new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 });
const axisLabel = (cents: bigint) => axisFormat.format(Number(cents) / 100);
const trend = computed(() => {
  const values = report.value.points.filter(point => point.closed).flatMap(point => [point.revenue, profit(point)]);
  const low = values.reduce((min, value) => value < min ? value : min, 0n);
  const high = values.reduce((max, value) => value > max ? value : max, 0n);
  const y = (amount: bigint) => 155 - Number((amount - low) * 13000n / (high - low || 1n)) / 100;
  const points = report.value.points.map((point, index) => ({
    ...point, x: 52 + index * 198, revenueY: y(point.revenue), profitY: y(profit(point)),
  }));
  const ticks = [...new Set([high, (high + low) / 2n, low])].map(value => ({ value, y: y(value) }));
  return { points, zero: y(0n), ticks };
});
const monthDetail = computed(() => trend.value.points.find(point => point.period === selectedMonth.value)
  || trend.value.points.filter(point => point.closed).at(-1));
const search = ref('');
const showAll = ref(false);
const records = computed(() => {
  const term = search.value.trim().toLowerCase();
  const matches = props.history.filter(row => [row.quarter, row.createdByName, compensationStatuses[row.status]].some(value => value?.toLowerCase().includes(term)));
  return showAll.value ? matches : matches.slice(0, 5);
});
const formattedDate = (date: string) => new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'short',
}).format(new Date(date));
</script>

<template>
  <div class="finance-overview" v-loading="loading">
    <div v-if="loading && !ready" class="finance-skeleton"><el-skeleton :rows="5" animated /></div>
    <el-empty v-else-if="!ready" description="查询后查看已复核的月度账证" />
    <template v-else>
      <div class="finance-heading">
        <div><h2>{{ quarter }} 经营概览</h2><p>{{ clinics.length === 1 ? clinics[0]?.name : `${clinics.length} 家授权门诊` }} · 已关闭月度底稿</p></div>
        <span v-if="synthetic" class="finance-demo">含虚构演示账证</span>
      </div>
      <div class="finance-metrics" :class="{ 'with-fund': headquarters }">
        <div v-for="item in headlineMetrics" :key="item.name" class="finance-metric" :class="{ net: item.name === '净利润' }">
          <span>{{ item.name }} <el-icon><component :is="item.icon" /></el-icon></span>
          <strong>{{ report.total.closed ? currency(item.value) : '—' }}</strong>
          <small>来自已关闭账证</small>
        </div>
        <div v-if="headquarters" class="finance-metric fund">
          <span>激励基金（10%） <el-icon><Coin /></el-icon></span>
          <strong>{{ snapshot ? currency(BigInt(snapshot.fundCents)) : '—' }}</strong>
          <small>总部全部门诊 · {{ snapshot ? compensationStatuses[snapshot.status] : '待核算' }}</small>
        </div>
      </div>
      <div class="finance-grid">
        <section class="panel finance-panel" aria-label="收入与利润趋势">
          <h3>收入与利润趋势</h3>
          <p>按月汇总当前门诊范围</p>
          <div class="finance-legend"><span><i class="revenue" />治疗收入</span><span><i class="profit" />净利润</span></div>
          <template v-if="report.total.closed">
            <svg class="finance-chart" viewBox="0 0 490 184" aria-hidden="true">
              <g v-for="(tick,index) in trend.ticks" :key="index">
                <line x1="52" x2="448" :y1="tick.y" :y2="tick.y" stroke="#e8e2da" />
                <text x="45" :y="tick.y + 4" text-anchor="end" fill="#6b6359" font-size="10">{{ axisLabel(tick.value) }}</text>
              </g>
              <line x1="52" x2="448" :y1="trend.zero" :y2="trend.zero" stroke="#c6bbae" stroke-dasharray="4 4" />
              <g v-for="(point,index) in trend.points" :key="point.period">
                <template v-if="point.closed">
                  <g v-if="index > 0 && trend.points[index - 1]?.closed">
                    <line :x1="trend.points[index - 1]?.x" :x2="point.x" :y1="trend.points[index - 1]?.revenueY" :y2="point.revenueY" stroke="#b58b55" stroke-width="3" />
                    <line :x1="trend.points[index - 1]?.x" :x2="point.x" :y1="trend.points[index - 1]?.profitY" :y2="point.profitY" stroke="#27634f" stroke-width="3" />
                  </g>
                  <circle :cx="point.x" :cy="point.revenueY" r="4" fill="#b58b55" />
                  <circle :cx="point.x" :cy="point.profitY" r="4" fill="#27634f" />
                  <rect :x="point.x - 42" y="12" width="84" height="150" fill="transparent" @mouseenter="selectedMonth=point.period" />
                </template>
                <text :x="point.x" y="179" text-anchor="middle" fill="#6b6359" font-size="12">{{ point.period }}</text>
              </g>
            </svg>
            <div class="trend-picker">
              <button v-for="point in trend.points" :key="point.period" type="button" :aria-pressed="monthDetail?.period === point.period" @click="selectedMonth=point.period">{{ point.period.slice(5) }} 月</button>
            </div>
            <p v-if="monthDetail?.closed" class="trend-detail">治疗收入 {{ currency(monthDetail.revenue) }} · 净利润 {{ currency(profit(monthDetail)) }}</p>
            <p v-else class="trend-detail">该月暂无已关闭账证</p>
          </template>
          <el-empty v-else :image-size="54" description="暂无已关闭账证" />
        </section>
        <section id="finance-tasks" class="panel finance-panel" tabindex="-1">
          <h3>待办事项</h3>
          <p>{{ report.total.closed }} / {{ report.expected }} 个门诊月份已关闭</p>
          <div class="finance-task-list">
            <button type="button" @click="emit('months')"><span><strong>月度账证登记</strong><small>{{ missing ? missing + ' 个月份未登记' : '当前范围已登记' }}</small></span><el-icon><ArrowRight /></el-icon></button>
            <button type="button" @click="emit('months')"><span><strong>独立复核</strong><small>{{ report.drafts ? report.drafts + ' 份底稿待复核' : '暂无待复核底稿' }}</small></span><el-icon><ArrowRight /></el-icon></button>
            <button v-if="headquarters" type="button" @click="emit('quarters')"><span><strong>季度核算</strong><small>{{ snapshot ? compensationStatuses[snapshot.status] : '尚未生成快照' }}</small></span><el-icon><ArrowRight /></el-icon></button>
            <button v-if="headquarters && snapshot" type="button" @click="emit('snapshot', snapshot.id)"><span><strong>{{ snapshot.status === 'approved' ? '个人分配与发放' : '激励分配与审批' }}</strong><small>{{ compensationStatuses[snapshot.status] }} · 查看明细</small></span><el-icon><ArrowRight /></el-icon></button>
          </div>
        </section>
      </div>
      <section class="panel finance-panel finance-summary">
        <div><h3>季度汇总</h3><p>{{ quarter }} · {{ report.total.closed }} 份已关闭账证</p></div>
        <dl><div><dt>治疗收入</dt><dd>{{ report.total.closed ? currency(report.total.revenue) : '—' }}</dd></div><div><dt>总成本</dt><dd>{{ report.total.closed ? currency(report.total.materials + report.total.operating) : '—' }}</dd></div><div><dt>净利润</dt><dd>{{ report.total.closed ? currency(profit(report.total)) : '—' }}</dd></div></dl>
        <el-button v-if="headquarters" @click="emit('quarters')">进入季度核算 <el-icon><ArrowRight /></el-icon></el-button>
        <el-button v-else @click="emit('months')">查看月度账证</el-button>
      </section>
      <section v-if="headquarters" class="panel finance-panel">
        <div class="finance-heading"><h3>最近核算记录</h3><input id="finance-search" v-model="search" placeholder="搜索季度、状态或制表人" aria-label="搜索核算记录" /></div>
        <div v-if="records.length" class="finance-table" role="region" aria-label="最近核算记录" tabindex="0">
          <table>
            <thead><tr><th scope="col">季度</th><th scope="col">状态</th><th scope="col">净利润</th><th scope="col">激励基金</th><th scope="col">制表人</th><th scope="col">生成时间</th><th scope="col">操作</th></tr></thead>
            <tbody><tr v-for="row in records" :key="row.id">
              <th scope="row">{{ row.quarter }} <small v-if="row.reference.includes('虚构')">演示</small></th>
              <td><span class="finance-status" :class="row.status">{{ compensationStatuses[row.status] }}</span></td>
              <td>{{ currency(BigInt(row.netProfitCents)) }}</td><td>{{ currency(BigInt(row.fundCents)) }}</td><td>{{ row.createdByName }}</td><td>{{ formattedDate(row.createdAt) }}</td>
              <td><el-button link type="primary" @click="emit('snapshot', row.id)">查看详情</el-button></td>
            </tr></tbody>
          </table>
        </div>
        <el-empty v-else :image-size="46" description="暂无匹配核算记录" />
        <el-button v-if="history.length > 5 && !search" link @click="showAll=!showAll">{{ showAll ? '收起' : '查看全部' }}</el-button>
      </section>
      <section class="panel finance-panel">
        <h3>门诊业绩</h3>
        <div class="finance-table" role="region" aria-label="门诊业绩表" tabindex="0">
          <table>
            <thead><tr><th scope="col">门诊</th><th scope="col">已关闭</th><th v-for="item in keys" :key="item.key" scope="col">{{ item.label }}</th><th scope="col">净利润</th></tr></thead>
            <tbody>
              <tr v-for="clinic in report.clinics" :key="clinic.id">
                <th scope="row">{{ clinic.name }}</th><td>{{ clinic.closed }} / {{ periods.length }}</td>
                <td v-for="item in keys" :key="item.key">{{ clinic.closed ? currency(clinic[item.key]) : '—' }}</td>
                <td>{{ clinic.closed ? currency(profit(clinic)) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.finance-overview { display: grid; gap: 18px; min-width: 0; font-variant-numeric: tabular-nums; animation: finance-enter .24s ease-out; }
.finance-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
.finance-heading h2, .finance-panel h3 { margin: 0 0 5px; font-family: inherit; }
.finance-heading p, .finance-panel p { margin: 0; color: #6e655a; font-size: 13px; }
.finance-demo { background: #f5eee4; color: #75532f; padding: 5px 9px; border-radius: 6px; font-size: 12px; }
.finance-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.finance-metrics.with-fund { grid-template-columns: repeat(5, minmax(0, 1fr)); }
.finance-metric, .finance-skeleton { display: grid; gap: 8px; padding: 16px; border: 1px solid #eae4da; border-radius: 12px; background: white; }
.finance-metric { transition: box-shadow .18s, transform .18s; }
.finance-metric:hover { transform: translateY(-2px); box-shadow: 0 5px 16px #37271910; }
.finance-metric span { display: flex; justify-content: space-between; align-items: center; gap: 4px; color: #6a6055; font-size: 13px; }
.finance-metric .el-icon { color: #926c3e; flex: none; }
.finance-metric strong { font-size: clamp(16px, 1.8vw, 25px); overflow-wrap: anywhere; }
.finance-metric small { color: #6e655a; }
.finance-metric.fund { background: #f5eee4; }
.finance-grid { display: grid; grid-template-columns: minmax(0, 1.8fr) minmax(0, 1fr); gap: 16px; }
.finance-panel { min-width: 0; margin: 0; padding: 19px; border-radius: 12px; }
.finance-legend, .finance-legend span { display: flex; align-items: center; gap: 7px; font-size: 12px; }
.finance-legend { gap: 15px; margin: 13px 0 2px; }
.finance-legend i { width: 9px; height: 9px; border-radius: 50%; }
.revenue { background: #b58b55; }.profit { background: #27634f; }
.finance-chart { display: block; width: 100%; max-height: 245px; }
.trend-picker { display: flex; gap: 6px; margin: 9px 0; }
.trend-picker button { border: 1px solid #eae4da; border-radius: 6px; background: white; color: #5b5147; padding: 5px 9px; cursor: pointer; }
.trend-picker button[aria-pressed=true] { background: #f5eee4; }
.finance-task-list { display: grid; margin-top: 10px; }
.finance-task-list button { display: flex; align-items: center; justify-content: space-between; gap: 9px; text-align: left; padding: 11px 0; background: white; border: 0; border-top: 1px solid #eeeae4; cursor: pointer; }
.finance-task-list strong,.finance-task-list small { display: block; }
.finance-task-list small { margin-top: 4px; color: #6e655a; }
.finance-task-list button:hover strong { color: #8b663c; }
.finance-summary, .finance-summary dl { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14px; }
.finance-summary dl { margin: 0; }.finance-summary dd { margin: 3px 0 0; font-weight: 700; }.finance-summary dt { font-size: 12px; color: #6e655a; }
#finance-search { max-width: 100%; padding: 8px 10px; border: 1px solid #ded7ce; border-radius: 7px; }
.finance-status { display: inline-block; padding: 3px 8px; border-radius: 5px; background: #f0eeeb; color: #5d554a; }
.finance-status.approved { background: #e5f2e9; color: #206044; }
.finance-status.submitted { background: #f7ecda; color: #805514; }
.finance-status.voided { background: #faeae7; color: #953f38; }
.finance-table { overflow-x: auto; }
.finance-table table { width: 100%; border-collapse: collapse; white-space: nowrap; font-size: 13px; }
.finance-table th, .finance-table td { padding: 12px 10px; border-bottom: 1px solid #eeeae4; text-align: right; }
.finance-table th:first-child { text-align: left; }
@keyframes finance-enter { from { opacity: 0; transform: translateY(4px); } }
@media (max-width: 1050px) { .finance-metrics.with-fund { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 760px) { .finance-metrics,.finance-metrics.with-fund { grid-template-columns: repeat(2, minmax(0, 1fr)); }.finance-grid { grid-template-columns: minmax(0, 1fr); } }
@media (prefers-reduced-motion: reduce) { .finance-overview { animation: none; }.finance-metric { transition: none; }.finance-metric:hover { transform: none; } }
</style>
