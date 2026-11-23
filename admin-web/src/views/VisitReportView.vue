<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { VisitReportRow } from '@andrew/shared';
import { api, errorText, query } from '../api';
import { money, today } from '../utils';

const end = today();
const dates = ref<[string, string]>([end.slice(0, 7) + '-01', end]);
const group = ref<'clinic' | 'doctor' | 'detail'>('detail');
const clinic = ref('');
const doctor = ref('');
const rows = ref<VisitReportRow[]>([]);
const loading = ref(false);
const error = ref('');
const clinics = computed(() => Array.from(new Map(rows.value.map(r => [r.clinicId, r.clinicName]))));
const doctors = computed(() => Array.from(new Map(rows.value.map(r => [r.doctorId, r.doctorName]))));
const filtered = computed(() => rows.value.filter(r => (!clinic.value || r.clinicId === clinic.value) && (!doctor.value || r.doctorId === doctor.value)));
const shown = computed(() => {
  if (group.value === 'detail') return filtered.value;
  const groups = new Map<string, VisitReportRow>();
  for (const row of filtered.value) {
    const key = group.value === 'clinic' ? row.clinicId : row.doctorId;
    const total = groups.get(key);
    if (total) {
      total.completed += row.completed;
      total.billedCents += row.billedCents;
      total.collectedCents += row.collectedCents;
    } else groups.set(key, { ...row });
  }
  return [...groups.values()];
});
async function load() {
  if (loading.value) return;
  loading.value = true;
  error.value = '';
  rows.value = [];
  clinic.value = '';
  doctor.value = '';
  try {
    rows.value = await api<VisitReportRow[]>('/staff/visit-report' + query({ from: dates.value[0], to: dates.value[1] }));
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
</script>

<template>
  <div class="page-heading"><div><h1>门诊经营报表</h1><p>按门诊和实际接诊医生查看已完成就诊、应收和实收。</p></div></div>
  <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
  <el-card v-loading="loading" shadow="never">
    <div class="report-filters">
      <el-date-picker v-model="dates" type="daterange" value-format="YYYY-MM-DD" start-placeholder="开始日期" end-placeholder="结束日期" :clearable="false" :disabled="loading" />
      <el-button type="primary" :loading="loading" @click="load">查询</el-button>
      <el-select v-model="clinic" aria-label="筛选门诊" placeholder="全部门诊" clearable><el-option v-for="[id, name] in clinics" :key="id" :label="name" :value="id" /></el-select>
      <el-select v-model="doctor" aria-label="筛选接诊医生" placeholder="全部医生" clearable><el-option v-for="[id, name] in doctors" :key="id" :label="name" :value="id" /></el-select>
    </div>
    <el-radio-group v-model="group" aria-label="报表分组">
      <el-radio-button value="detail">门诊与医生</el-radio-button>
      <el-radio-button value="clinic">按门诊</el-radio-button>
      <el-radio-button value="doctor">按医生</el-radio-button>
    </el-radio-group>
    <p>就诊按治疗确认日，应收按出单日，实收按收款登记日统计。日期均为北京时间。</p>
    <el-table :data="shown" empty-text="该期间暂无就诊、出单或收款记录">
      <el-table-column v-if="group !== 'doctor'" prop="clinicName" label="门诊" min-width="175" />
      <el-table-column v-if="group !== 'clinic'" prop="doctorName" label="实际接诊医生" min-width="150" />
      <el-table-column prop="completed" label="已完成就诊" min-width="100" align="right" />
      <el-table-column label="应收" min-width="130" align="right"><template #default="{ row }">{{ money(row.billedCents) }}</template></el-table-column>
      <el-table-column label="实收" min-width="130" align="right"><template #default="{ row }">{{ money(row.collectedCents) }}</template></el-table-column>
    </el-table>
  </el-card>
</template>

<style scoped>
.report-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 16px; }
.report-filters :deep(.el-select) { width: min(220px, 100%); }
.report-filters :deep(.el-range-editor) { max-width: 100%; }
</style>
