<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Search, Plus } from '@element-plus/icons-vue';
import type { Page, Patient, PatientCandidate } from '@andrew/shared';
import { api, errorText, query } from '../api';
import { useBooking } from '../stores/booking';
import { useAuth } from '../stores/auth';
import { useCatalog } from '../stores/catalog';
import PatientEditor from '../components/PatientEditor.vue';
import PatientInvite from '../components/PatientInvite.vue';
import { createLatestRequest } from '../visible-refresh';
const router = useRouter();
const booking = useBooking();
const auth = useAuth();
const catalog = useCatalog();
const q = ref('');
const rows = ref<PatientCandidate[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const error = ref('');
const createDialog = ref(false);
const requestScope = createLatestRequest(() => auth.user?.id);
let disposed = false;
async function loadCatalog() {
  try { if (!catalog.loaded) await catalog.load(); }
  catch (e) { error.value = errorText(e); }
}
async function load() {
  const current = requestScope.begin();
  if (!auth.isHq && q.value.trim().length < 2) {
    rows.value = [];
    total.value = 0;
    error.value = q.value.trim() ? '请输入至少两个字的姓名或联系电话。' : '';
    loading.value = false;
    return;
  }
  loading.value = true;
  error.value = '';
  rows.value = [];
  try {
    const result = await api<Page<PatientCandidate>>(
      `/staff/patients${query({ q: q.value.trim(), page: page.value, pageSize: 20 })}`,
    );
    if (current() && !disposed) {
      rows.value = result.items;
      total.value = result.total;
    }
  } catch (e) {
    if (current() && !disposed) {
      rows.value = [];
      total.value = 0;
      error.value = errorText(e);
    }
  } finally {
    if (current() && !disposed) loading.value = false;
  }
}
async function search() {
  page.value = 1;
  await load();
}
function reserve(patient: PatientCandidate) {
  booking.patient = patient;
  void router.push({ path: '/booking', query: { patientId: patient.id } });
}
function created(patient: Patient) {
  reserve({id:patient.id,name:patient.name,phone:patient.phone.length>7?patient.phone.slice(0,3)+'****'+patient.phone.slice(-4):'***',birthYear:patient.birthDate.slice(0,4),hasAccount:false,isDemo:patient.isDemo});
}
onMounted(async () => {
  await loadCatalog();
  if (auth.isHq) await load();
});
onUnmounted(() => { disposed = true; requestScope.stop(); });
</script>
<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">PATIENT RECORDS</div>
      <h1>患者档案</h1>
      <p>先核对患者身份，再为患者安排合适的预约。</p>
    </div>
    <el-button type="primary" :icon="Plus" :disabled="!catalog.loaded" @click="createDialog = true">建立档案</el-button>
  </section>
  <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon class="mb-24" />
  <el-button v-if="!catalog.loaded && !catalog.loading" @click="loadCatalog">重新加载门诊资料</el-button>
  <section class="panel patients-panel">
    <div class="panel-heading">
      <div>
        <h2>查找患者</h2>
        <p>按完整姓名或联系电话查找授权范围内的档案，结果仅显示身份核对所需信息。</p>
      </div>
    </div>
    <el-form class="filter-bar patients-filter" inline @submit.prevent="search"
      ><el-form-item
        ><el-input
          v-model="q"
          :prefix-icon="Search"
          placeholder="患者姓名 / 联系电话"
          clearable
          class="patients-search-input"
          @clear="search" /></el-form-item
      ><el-button native-type="submit" type="primary" :loading="loading"
        >查询档案</el-button
      ></el-form
    ><p class="patients-result-summary" aria-live="polite">当前页 {{ rows.length }} 位患者<span v-if="total"> · 共 {{ total }} 份档案</span></p>
    <div class="patients-table-scroll" role="region" aria-label="患者档案表格，可横向滚动" tabindex="0">
      <el-table
        class="patients-table"
        :data="rows"
        v-loading="loading"
        row-key="id"
        empty-text="未找到患者，请更换关键词或核对后建立档案"
        ><el-table-column label="姓名" min-width="140"
          ><template #default="{ row }"
            ><span class="table-person"
              ><span class="mini-avatar">{{ row.name.slice(-1) }}</span
              >{{ row.name }}</span
            ></template
          ></el-table-column
        ><el-table-column prop="phone" label="联系电话" min-width="145" /><el-table-column
          prop="birthYear"
          label="出生年份"
          width="135"
        /><el-table-column label="操作" width="210" fixed="right"
          ><template #default="{ row }"
            ><el-button type="primary" text @click="reserve(row)">为其预约</el-button><PatientInvite :patient-id="row.id" :patient-name="row.name" :linked="row.hasAccount" /></template
          ></el-table-column
        ></el-table
      >
    </div>
    <div class="pagination">
      <span>共 {{ total }} 份档案</span
      ><el-pagination
        v-model:current-page="page"
        :page-size="20"
        :total="total"
        layout="prev,pager,next"
        @current-change="load"
      />
    </div>
  </section>
  <PatientEditor v-model="createDialog" @created="created" />
</template>

<style scoped>
.patients-panel {
  overflow: hidden;
}

.patients-filter {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 0 12px;
}

.patients-search-input {
  width: min(100%, 380px);
}

.patients-result-summary {
  margin: 0 0 14px;
  color: var(--text-secondary, #667085);
  font-size: 13px;
}

.table-person {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.mini-avatar {
  flex: 0 0 auto;
}

.patients-table-scroll {
  width: 100%;
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  -webkit-overflow-scrolling: touch;
}

:deep(.patients-table) {
  min-width: 600px;
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

@media (max-width: 680px) {
  .page-heading {
    align-items: stretch;
    flex-direction: column;
    gap: 14px;
  }

  .patients-filter {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }

  .patients-filter :deep(.el-form-item),
  .patients-search-input {
    width: 100% !important;
  }

  .patients-filter :deep(.el-button) {
    width: 100%;
    margin-left: 0;
  }

  .patients-table-scroll {
    margin-inline: 0;
  }

  .pagination {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
