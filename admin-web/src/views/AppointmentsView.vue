<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Calendar, Search, Refresh, Plus, ArrowRight } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { Appointment, Page } from '@andrew/shared';
import {
  api,
  ApiError,
  errorText,
  query,
  readPending,
  resolvePending,
  submitCommand,
  type PendingCommand,
} from '../api';
import { useAuth } from '../stores/auth';
import { useCatalog } from '../stores/catalog';
import { statusLabels, statusType, time, today } from '../utils';
import { createLatestRequest, startVisibleRefresh } from '../visible-refresh';
import { collectAppointmentPages, groupByDoctor, isDoctorOnly, type PageCollectionReason } from '../schedule-view';
import DateNavigator from '../components/DateNavigator.vue';
const auth = useAuth();
const catalog = useCatalog();
const router = useRouter();
const clinicId = ref('');
const date = ref(today());
const status = ref('');
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const rows = ref<Appointment[]>([]);
const viewMode = ref<'list' | 'agenda'>('list');
const agendaRows = ref<Appointment[]>([]);
const agendaComplete = ref(false);
const agendaWarning = ref('');
const loading = ref(false);
const error = ref('');
const syncError = ref('');
const selected = ref<Appointment | null>(null);
const drawer = ref(false);
const detailOpening = ref(false);
const writing = ref(false);
const cancellationPromptOpen = ref(false);
const pending = ref<PendingCommand | null>(readPending());
const doctorOnly = computed(() => isDoctorOnly(auth.user?.roles));
const displayedRows = computed(() => viewMode.value === 'agenda' ? agendaRows.value : rows.value);
const agendaGroups = computed(() => groupByDoctor(agendaRows.value));
const activeCount = computed(() => displayedRows.value.filter((item) => item.status === 'confirmed').length);
const doctorCount = computed(() => new Set(displayedRows.value.map((item) => item.doctorId)).size);
const currentTitle = computed(() => doctorOnly.value ? '我的预约' : '预约总览');
const filterSummary = computed(() => [date.value || '全部日期',
  catalog.clinics.find(item => item.id === clinicId.value)?.name || '全部授权门诊',
  statusLabels[status.value] || '全部状态'].join(' · '));
const listRequests = createLatestRequest(() => auth.user?.id);
const detailRequests = createLatestRequest(() => auth.user?.id);
let disposed = false;
let stopRefresh = () => {};
watch(drawer, open => {
  if (!open) { detailRequests.invalidate(); detailOpening.value = false; }
});
async function load(background = false) {
  if (disposed || !auth.user || background && loading.value) return;
  const current = listRequests.begin();
  const mode = viewMode.value;
  const filters = { clinicId: clinicId.value, date: date.value, status: status.value };
  if (!background) { loading.value = true; error.value = ''; }
  try {
    if (mode === 'agenda') {
      if (!filters.date) { agendaRows.value = []; agendaComplete.value = false; agendaWarning.value = '请先选择某一天，再查看该日的预约日程。'; return; }
      const result = await collectAppointmentPages<Appointment>((requestedPage, requestedSize) => api<Page<Appointment>>(
        `/staff/appointments${query({ ...filters, page: requestedPage, pageSize: requestedSize })}`), current);
      if (!current()) return;
      agendaRows.value = result.items;
      total.value = result.total;
      agendaComplete.value = result.complete;
      const warnings: Record<PageCollectionReason, string> = {
        changed: '查询期间预约记录有变化，当前日程可能不完整，请刷新后核对。',
        invalid: '预约分页响应不完整，当前日程可能不完整，请刷新后核对。',
        limit: '当前日程记录较多，未能全部加载，请缩小门诊或状态范围。',
        superseded: '筛选已变化，请等待新日程加载。',
      };
      agendaWarning.value = result.reason ? warnings[result.reason] : '';
    } else {
      const result = await api<Page<Appointment>>(
        `/staff/appointments${query({ ...filters, page: page.value, pageSize: pageSize.value })}`);
      if (!current()) return;
      rows.value = result.items;
      total.value = result.total;
    }
    syncError.value = '';
  } catch (e) {
    if (current()) {
      if (mode === 'agenda') { agendaComplete.value = false; agendaWarning.value = '当前日程未能完成更新，请刷新后核对。'; }
      if (background) syncError.value = errorText(e);
      else error.value = errorText(e);
    }
  } finally {
    if (current()) loading.value = false;
  }
}
async function search() {
  page.value = 1;
  rows.value = []; agendaRows.value = []; total.value = 0; agendaComplete.value = false; agendaWarning.value = '';
  await load();
}
async function selectDate(value: string) { date.value = value; await search(); }
async function selectView(value: 'list' | 'agenda') {
  if (viewMode.value === value) return;
  viewMode.value = value;
  await load();
}
async function detail(row: Appointment) {
  const current = detailRequests.begin();
  detailOpening.value = true;
  try {
    const result = await api<Appointment>(`/appointments/${row.id}`);
    if (!current()) return;
    selected.value = result;
    drawer.value = true;
  } catch (e) {
    if (current()) ElMessage.error(errorText(e));
  } finally {
    if (current()) detailOpening.value = false;
  }
}
async function refreshDetail() {
  if (!drawer.value || !selected.value || detailOpening.value || writing.value || cancellationPromptOpen.value) return;
  const id = selected.value.id;
  const current = detailRequests.begin();
  const accepts = () => current() && drawer.value && selected.value?.id === id && !writing.value && !cancellationPromptOpen.value;
  try {
    const result = await api<Appointment>(`/appointments/${id}`);
    if (accepts()) selected.value = result;
  } catch (e) {
    if (!accepts()) return;
    syncError.value = errorText(e);
    if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
      selected.value = null;
      drawer.value = false;
    }
  }
}
async function refreshVisible() {
  if (disposed || !auth.user || writing.value || cancellationPromptOpen.value) return;
  await Promise.all([load(true), refreshDetail()]);
}
async function cancel(row: Appointment) {
  if (pending.value) {
    ElMessage.warning('请先查询上一笔提交的结果。');
    return;
  }
  cancellationPromptOpen.value = true;
  detailRequests.invalidate();
  try {
    const answer = await ElMessageBox.prompt(
      `取消 ${row.patientName} 的 ${time(row.startsAt, true)} 预约。取消后将释放医生和牙椅资源。`,
      '取消预约',
      {
        inputPlaceholder: '请输入取消原因（至少 2 字）',
        inputValidator: (value) => value?.trim().length >= 2 || '请填写取消原因',
        confirmButtonText: '确认取消',
        cancelButtonText: '返回',
        type: 'warning',
      },
    );
    writing.value = true;
    const command = {
      key: crypto.randomUUID(),
      path: `/appointments/${row.id}/changes`,
      body: { intent: 'cancel', expectedVersion: row.rowVersion, reason: answer.value.trim() },
      createdAt: new Date().toISOString(),
    };
    try {
      selected.value = await submitCommand(command);
      ElMessage.success('预约已取消，资源已释放。');
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.uncertain) pending.value = readPending();
      ElMessage.error(errorText(e));
      if (e instanceof ApiError && e.status === 409) await load();
    }
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(errorText(e));
  } finally {
    cancellationPromptOpen.value = false;
    writing.value = false;
  }
}
async function checkPending() {
  if (!pending.value) return;
  writing.value = true;
  try {
    const result = await resolvePending(pending.value);
    if (result) {
      pending.value = null;
      selected.value = result;
      ElMessage.success(`操作已完成：${statusLabels[result.status]}`);
      await load();
    } else ElMessage.info('服务器尚未记录此操作。可用同一操作编号重试。');
  } catch (e) {
    ElMessage.error(errorText(e));
  } finally {
    writing.value = false;
  }
}
async function retryPending() {
  if (!pending.value) return;
  writing.value = true;
  try {
    await submitCommand(pending.value);
    pending.value = null;
    ElMessage.success('操作已完成。');
    await load();
  } catch (e) {
    pending.value = readPending();
    ElMessage.error(errorText(e));
  } finally {
    writing.value = false;
  }
}
onMounted(async () => {
  stopRefresh = startVisibleRefresh(refreshVisible, {
    isVisible: () => document.visibilityState === 'visible',
    subscribe: listener => {
      document.addEventListener('visibilitychange', listener);
      return () => document.removeEventListener('visibilitychange', listener);
    },
    schedule: (callback, delay) => window.setTimeout(callback, delay),
    cancel: handle => window.clearTimeout(handle),
  });
  try {
    if (!catalog.loaded) await catalog.load();
  } catch (e) {
    if (!disposed) error.value = errorText(e);
  }
  if (!disposed) await load();
});
onUnmounted(() => {
  disposed = true;
  stopRefresh();
  listRequests.stop();
  detailRequests.stop();
});
</script>
<template>
  <section class="page-heading appointments-heading">
    <div class="appointments-heading-copy">
      <div class="eyebrow">{{ doctorOnly ? 'MY APPOINTMENTS' : 'APPOINTMENT MANAGEMENT' }}</div>
      <h1>{{ currentTitle }}</h1>
      <p>{{ doctorOnly ? '查看本人预约与就诊安排。' : '管理门诊预约与患者就诊安排。' }}</p>
    </div>
    <div class="appointments-heading-actions">
      <el-button v-if="auth.canBook" class="appointments-create" type="primary" :icon="Plus" @click="router.push('/booking')">为患者预约</el-button>
      <el-button class="appointments-refresh" :icon="Refresh" @click="load()" :loading="loading">刷新</el-button>
    </div>
  </section>
  <section class="schedule-navigation appointments-date-area" aria-label="预约日期与视图">
    <DateNavigator :date="date" :today="today()" @select="selectDate">
      <el-button-group class="appointments-view-switch" aria-label="预约展示方式">
        <el-button :type="viewMode === 'list' ? 'primary' : 'default'" :aria-pressed="viewMode === 'list'" @click="selectView('list')">列表</el-button>
        <el-button :type="viewMode === 'agenda' ? 'primary' : 'default'" :aria-pressed="viewMode === 'agenda'" @click="selectView('agenda')">日程</el-button>
      </el-button-group>
    </DateNavigator>
    <div class="schedule-filter-summary appointments-filter-summary" aria-live="polite"><span>{{ filterSummary }}</span>
      <span v-if="doctorOnly" class="schedule-scope-badge">仅本人</span><span v-else class="schedule-scope-badge">授权范围</span>
    </div>
  </section>
  <div class="stat-grid appointments-stats" aria-label="当前预约统计">
    <div class="stat-card appointments-stat-total">
      <span>筛选预约总数</span><strong>{{ total }}<small>笔</small></strong>
      <p>当前条件匹配的服务端总数</p>
    </div>
    <div class="stat-card appointments-stat-confirmed">
      <span>{{ viewMode === 'list' ? '本页已确认' : '已加载记录中已确认' }}</span><strong>{{ activeCount }}<small>笔</small></strong>
      <p>{{ viewMode === 'list' ? '仅统计本页' : '仅统计已加载记录' }} · {{ displayedRows.length }} 条</p>
    </div>
    <div class="stat-card appointments-stat-doctors">
      <span>{{ viewMode === 'list' ? '本页服务医生' : '已加载记录中服务医生' }}</span><strong>{{ doctorCount }}<small>人</small></strong>
      <p>{{ viewMode === 'list' ? '按本页预约去重' : '按已加载预约去重' }}</p>
    </div>
    <div class="stat-card stat-note appointments-stat-note">
      <el-icon><Calendar /></el-icon>
      <div>
        <strong>资源协同</strong>
        <p>改期成功后才释放原预约；取消与改期保留事件记录。</p>
      </div>
    </div>
  </div>
  <el-alert
    v-if="pending"
    title="上一笔操作结果待确认，请先查询。网络异常不代表预约操作失败。"
    type="warning"
    show-icon
    :closable="false"
    class="mb-24 appointments-pending-alert"
    ><template #default
      ><el-button size="small" :loading="writing" @click="checkPending">查询结果</el-button
      ><el-button size="small" :loading="writing" @click="retryPending"
        >使用原编号重试</el-button
      ></template
    ></el-alert
  ><el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="mb-24 appointments-error-alert" />
  <el-alert v-if="syncError && !error" :title="'自动同步暂未完成：' + syncError" type="warning" show-icon :closable="false" class="mb-24 appointments-sync-alert" />
  <section class="panel appointments-panel">
    <div class="panel-heading appointments-panel-heading">
      <div>
        <h2>预约清单</h2>
        <p>日期与时间均为北京时间 · 当前筛选与授权范围</p>
      </div>
    </div>
    <el-form inline class="filter-bar appointments-filter-bar" @submit.prevent="search"
      ><el-form-item label="日期"
        ><el-date-picker
          v-model="date"
          type="date"
          value-format="YYYY-MM-DD"
          :clearable="false"
          style="width: 160px"
          @change="search" /></el-form-item
      ><el-form-item label="门诊"
        ><el-select
          v-model="clinicId"
          placeholder="全部授权门诊"
          clearable
          style="width: 190px"
          @change="search"
          ><el-option
            v-for="clinic in catalog.clinics"
            :key="clinic.id"
            :value="clinic.id"
            :label="clinic.name" /></el-select></el-form-item
      ><el-form-item label="状态"
        ><el-select
          v-model="status"
          placeholder="全部状态"
          clearable
          style="width: 145px"
          @change="search"
          ><el-option
            v-for="(label, key) in statusLabels"
            v-show="key !== 'published'"
            :key="key"
            :label="label"
            :value="key" /></el-select></el-form-item
      ><el-button :icon="Search" native-type="submit">查询</el-button></el-form
    ><p v-if="viewMode === 'list'" class="appointments-table-hint">可横向滚动查看全部预约字段与操作</p>
    <div v-if="viewMode === 'list'" class="appointments-table-scroll" role="region" tabindex="0" aria-label="预约清单，可横向滚动查看全部字段">
    <el-table
      :data="rows"
      v-loading="loading"
      row-key="id"
      empty-text="当前筛选条件下暂无预约"
      @row-click="detail"
      class="clickable-table appointments-table"
      ><el-table-column label="预约时间" min-width="130"
        ><template #default="{ row }"
          ><strong>{{ time(row.startsAt) }}</strong>
          <div class="table-sub">至 {{ time(row.endsAt) }}</div></template
        ></el-table-column
      ><el-table-column label="患者" min-width="180"
        ><template #default="{ row }"
          ><span class="table-person"
            ><span class="mini-avatar">{{ row.patientName.slice(-1) }}</span
            >{{ row.patientName }}</span
          ></template
        ></el-table-column
      ><el-table-column prop="serviceName" label="预约服务" min-width="150" /><el-table-column
        prop="doctorName"
        label="医生"
        width="110" /><el-table-column
        prop="clinicName"
        label="门诊"
        min-width="150" /><el-table-column label="状态" width="110"
        ><template #default="{ row }"
          ><el-tag :type="statusType(row.status)" effect="light" round>{{
            statusLabels[row.status]
          }}</el-tag></template
        ></el-table-column
      ><el-table-column label="操作" width="110"
        ><template #default="{ row }"
          ><el-button text type="primary" @click.stop="detail(row)"
            >查看<el-icon><ArrowRight /></el-icon></el-button></template></el-table-column
    ></el-table>
    </div>
    <div v-if="viewMode === 'list'" class="pagination">
      <span>共 {{ total }} 笔预约</span
      ><el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :page-sizes="[10, 20, 50]"
        :total="total"
        layout="sizes, prev, pager, next"
        @current-change="load()"
        @size-change="search"
      />
    </div>
    <div v-else class="schedule-agenda appointments-agenda" v-loading="loading" aria-label="按医生分组的预约日程">
      <el-alert v-if="agendaWarning" :title="agendaWarning" type="warning" :closable="false" show-icon />
      <p class="schedule-query-note" v-if="date">已加载 {{ agendaRows.length }} 条预约{{ agendaComplete ? '，当前筛选记录已加载。' : '，当前结果可能不完整。' }}记录会自动更新，变更请以最新详情为准。</p>
      <section v-for="group in agendaGroups" :key="group.doctorId" class="schedule-agenda-group">
        <header class="schedule-agenda-header"><h3>{{ group.doctorName }}</h3><small>{{ group.items.length }} 条已加载记录</small></header>
        <button v-for="item in group.items" :key="item.id" type="button" class="schedule-agenda-item" :class="'is-' + item.status" @click="detail(item)">
          <span class="schedule-agenda-time"><strong>{{ time(item.startsAt) }}</strong><small>— {{ time(item.endsAt) }}</small></span>
          <span class="schedule-agenda-content"><strong>{{ item.patientName }} · {{ item.serviceName }}</strong><span class="schedule-agenda-meta">{{ item.clinicName }} · {{ item.appointmentNo }}</span></span>
          <el-tag :type="statusType(item.status)">{{ statusLabels[item.status] }}</el-tag>
        </button>
      </section>
      <el-empty v-if="!loading && !agendaRows.length" :description="!date ? '请选择日期查看预约日程' : error || agendaWarning ? '日程尚未完整加载，请核对提示后重试' : '当前日期与筛选范围内暂无预约'" />
    </div>
  </section>
  <el-drawer v-model="drawer" class="appointment-detail-drawer" title="预约详情" size="480px"
    ><template v-if="selected"
      ><div class="detail-title appointment-detail-title">
        <span>{{ selected.appointmentNo }}</span
        ><el-tag :type="statusType(selected.status)">{{ statusLabels[selected.status] }}</el-tag>
      </div>
      <h2>{{ selected.patientName }} · {{ selected.serviceName }}</h2>
      <el-descriptions :column="1" border class="mt-24"
        ><el-descriptions-item label="就诊时间"
          >{{ time(selected.startsAt, true) }} — {{ time(selected.endsAt) }}</el-descriptions-item
        ><el-descriptions-item label="门诊">{{ selected.clinicName }}</el-descriptions-item
        ><el-descriptions-item label="地址">{{ selected.clinicAddress }}</el-descriptions-item
        ><el-descriptions-item label="医生">{{ selected.doctorName }}</el-descriptions-item
        ><el-descriptions-item v-if="selected.cancellationReason" label="变更原因">{{
          selected.cancellationReason
        }}</el-descriptions-item></el-descriptions
      >
      <p class="muted small mt-16">
        预约取消须至少提前 {{ selected.policy.cancellationNoticeMinutes }} 分钟，规则由服务端校验。
      </p>
      <div v-if="auth.canBook && selected.status === 'confirmed'" class="detail-actions">
        <el-button
          type="primary"
          :disabled="!!pending"
          @click="router.push({ path: '/booking', query: { appointmentId: selected.id } })"
          >为患者改期</el-button
        ><el-button
          type="danger"
          plain
          :loading="writing"
          :disabled="!!pending"
          @click="cancel(selected)"
          >取消预约</el-button
        >
      </div>
      <h3 class="mt-32">预约事件</h3>
      <el-timeline
        ><el-timeline-item
          v-for="event in selected.events || []"
          :key="event.id"
          :timestamp="time(event.occurredAt, true)"
          ><strong>{{
            event.kind === 'confirmed'
              ? '预约确认'
              : event.kind === 'cancelled'
                ? '取消预约'
                : event.kind === 'rescheduled'
                  ? '预约改期'
                  : event.kind
          }}</strong>
          <p>
            {{ event.actorName }}{{ event.reason ? ` · ${event.reason}` : '' }}
          </p></el-timeline-item
        ></el-timeline
      ><el-empty
        v-if="!selected.events?.length"
        description="暂无可显示的事件"
        :image-size="64" /></template
  ></el-drawer>
</template>

<style scoped>
.appointments-heading {
  align-items: flex-end;
  margin-bottom: 22px;
}
.appointments-heading-copy .eyebrow {
  margin-bottom: 6px;
  color: #80653d;
  font-size: 10px;
  letter-spacing: .13em;
}
.appointments-heading-copy h1 {
  color: #292d30;
  font-size: clamp(26px, 2.2vw, 32px);
  letter-spacing: -.025em;
}
.appointments-heading-copy p {
  max-width: 600px;
  margin-top: 7px;
  color: #686d70;
  font-size: 13px;
}
.appointments-heading-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 9px; }
.appointments-heading-actions :deep(.el-button) { min-height: 38px; padding-inline: 15px; }
.appointments-refresh { min-height: 38px; padding-inline: 14px; }
.appointments-date-area {
  overflow: hidden;
  border-color: #e7e4df;
  border-radius: 13px;
  background: #fff;
  box-shadow: 0 2px 10px rgb(41 45 48 / 4%);
}
.appointments-filter-summary {
  min-height: 42px;
  margin: 0 24px 18px;
  padding: 9px 13px;
  border-color: #ebe8e2;
  background: #fcfbf9;
  color: #555b5f;
}
.appointments-filter-summary > span:first-child { flex: 1 1 auto; }
.appointments-filter-summary .schedule-scope-badge {
  border: 1px solid #e8e1d5;
  background: #f5f0e8;
  color: #69583e;
}
.appointments-stats {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 13px;
  margin: 18px 0 22px;
}
.appointments-stats .appointments-stat-total,
.appointments-stats .appointments-stat-confirmed,
.appointments-stats .appointments-stat-doctors,
.appointments-stats .appointments-stat-note {
  min-width: 0;
  min-height: 116px;
  padding: 17px 19px;
  border-color: #e7e4df;
  border-radius: 11px;
  box-shadow: 0 2px 8px rgb(41 45 48 / 3%);
}
.appointments-stats .stat-card > span {
  color: #686d70;
  font-size: 11px;
  font-weight: 600;
}
.appointments-stats .stat-card > strong {
  display: block;
  margin-top: 9px;
  color: #292d30;
  font-size: 27px;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.appointments-stats .stat-card > strong > small {
  margin-left: 5px;
  color: #686d70;
  font-size: 12px;
  font-weight: 500;
}
.appointments-stats .stat-card > p {
  margin-top: 8px;
  color: #777c7f;
  font-size: 10px;
  line-height: 1.5;
}
.appointments-stats .appointments-stat-note {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #f8f5ef;
}
.appointments-stat-note > .el-icon {
  display: grid;
  flex: 0 0 34px;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 9px;
  background: #eee5d7;
  color: #80653d;
  font-size: 17px;
}
.appointments-stat-note > div { min-width: 0; }
.appointments-stat-note > div > strong { color: #292d30; font-size: 12px; }
.appointments-stat-note > div > p { margin-top: 5px; color: #686d70; font-size: 10px; line-height: 1.6; }
.appointments-pending-alert,
.appointments-error-alert,
.appointments-sync-alert { margin-bottom: 18px; }
.appointments-panel {
  overflow: hidden;
  border-color: #e7e4df;
  border-radius: 13px;
  box-shadow: 0 2px 10px rgb(41 45 48 / 4%);
}
.appointments-panel-heading {
  align-items: center;
  padding: 19px 22px;
  border-bottom: 1px solid #f0ede8;
}
.appointments-panel-heading h2 { color: #292d30; font-size: 16px; }
.appointments-panel-heading p { margin-top: 4px; color: #777c7f; font-size: 11px; }
.appointments-panel-heading :deep(.el-button) { min-height: 36px; padding-inline: 15px; }
.appointments-filter-bar {
  align-items: flex-end;
  padding: 15px 22px 16px;
  gap: 12px 16px;
  border-bottom: 1px solid #f0ede8;
  background: #fff;
}
.appointments-filter-bar :deep(.el-form-item) { margin: 0; }
.appointments-filter-bar :deep(.el-form-item__label) {
  color: #555b5f;
  font-size: 11px;
  font-weight: 600;
}
.appointments-filter-bar :deep(.el-button) { min-height: 34px; padding-inline: 14px; }
.appointments-table-scroll {
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scrollbar-width: thin;
  scrollbar-color: #cfc4b3 transparent;
}
.appointments-table-scroll:focus-visible { outline: 3px solid #80653d; outline-offset: -3px; }
.appointments-table { width: 100%; min-width: 940px !important; min-height: 120px; }
.appointments-table :deep(.el-table th.el-table__cell) { height: 48px; }
.appointments-table :deep(.el-table td.el-table__cell) { height: 64px; }
.appointments-table :deep(.el-table .cell) { padding-inline: 16px; }
.appointments-table :deep(.clickable-table tbody tr) { cursor: pointer; }
.appointments-table :deep(.el-table__empty-block) { min-height: 150px; }
.appointments-table-hint { display: none; }
.appointments-table :deep(.el-tag.el-tag--success),
.appointments-agenda :deep(.el-tag.el-tag--success),
.appointment-detail-drawer :deep(.el-tag.el-tag--success) {
  --el-tag-bg-color: #edf6ee;
  --el-tag-border-color: #d6e9d8;
  --el-tag-text-color: #356b43;
}
.appointments-table :deep(.el-tag.el-tag--info),
.appointments-agenda :deep(.el-tag.el-tag--info),
.appointment-detail-drawer :deep(.el-tag.el-tag--info) {
  --el-tag-bg-color: #f1f2f2;
  --el-tag-border-color: #e0e2e2;
  --el-tag-text-color: #5c6265;
}
.appointments-table :deep(.el-tag.el-tag--warning),
.appointments-agenda :deep(.el-tag.el-tag--warning),
.appointment-detail-drawer :deep(.el-tag.el-tag--warning) {
  --el-tag-bg-color: #f1f2f2;
  --el-tag-border-color: #e0e2e2;
  --el-tag-text-color: #5c6265;
}
.appointments-panel > .pagination {
  min-height: 62px;
  padding: 13px 21px;
  border-top: 1px solid #f0ede8;
}
.appointments-panel > .pagination > span { color: #686d70; font-variant-numeric: tabular-nums; }
.appointments-agenda { padding: 18px 22px 22px; gap: 15px; }
.appointments-agenda :deep(.el-alert) { margin-bottom: 0; }
.appointments-agenda .schedule-query-note {
  padding: 0 2px;
  color: #686d70;
  font-size: 11px;
}
.appointments-agenda .schedule-agenda-group {
  border-color: #e7e4df;
  border-radius: 10px;
}
.appointments-agenda .schedule-agenda-header {
  padding: 13px 17px;
  border-color: #e7e4df;
  background: #fcfbf9;
}
.appointments-agenda .schedule-agenda-header h3 { color: #292d30; font-size: 14px; }
.appointments-agenda .schedule-agenda-header small { color: #686d70; font-size: 10px; }
.appointments-agenda .schedule-agenda-item {
  align-items: center;
  min-height: 76px;
  padding: 15px 17px;
  border-bottom-color: #f0ede8;
  color: #292d30;
}
.appointments-agenda .schedule-agenda-item:hover { background: #fcfbf9; }
.appointments-agenda .schedule-agenda-time { min-width: 77px; font-variant-numeric: tabular-nums; }
.appointments-agenda .schedule-agenda-content { border-left-color: #b79a6b; }
.appointments-agenda .is-cancelled .schedule-agenda-content { border-left-color: #c9c5be; }
.appointments-agenda .is-rescheduled .schedule-agenda-content { border-left-color: #a99a83; }
.appointments-agenda .schedule-agenda-meta { color: #686d70; }
.appointment-detail-title {
  padding-bottom: 13px;
  border-bottom: 1px solid #f0ede8;
  color: #686d70;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.appointment-detail-drawer :deep(.el-drawer) {
  width: min(480px, 100vw) !important;
  max-width: 100vw;
  border-radius: 14px 0 0 14px;
}
.appointment-detail-drawer :deep(.el-drawer__header) { margin-bottom: 0; padding: 20px 22px; }
.appointment-detail-drawer :deep(.el-drawer__body) { padding: 21px 22px 26px; }
.appointment-detail-drawer h2 { color: #292d30; font-size: 19px; line-height: 1.5; }
.appointment-detail-drawer h3 { color: #292d30; font-size: 14px; }
.appointment-detail-drawer :deep(.el-descriptions__label) { width: 92px; color: #686d70; font-size: 11px; }
.appointment-detail-drawer :deep(.el-descriptions__content) { color: #292d30; font-size: 12px; overflow-wrap: anywhere; }
.appointment-detail-drawer :deep(.el-timeline-item__timestamp) { color: #777c7f; font-size: 10px; }
.appointment-detail-drawer .detail-actions { flex-wrap: wrap; }

@media (max-width: 1080px) {
  .appointments-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 720px) {
  .appointments-heading { align-items: flex-start; margin-bottom: 17px; }
  .appointments-heading-copy { min-width: 0; }
  .appointments-heading-copy h1 { font-size: 24px; }
  .appointments-heading-copy p { max-width: 250px; font-size: 11px; }
  .appointments-heading-actions { align-items: flex-end; flex-direction: column; gap: 6px; }
  .appointments-heading-actions :deep(.el-button) { min-height: 32px; padding-inline: 9px; font-size: 10px; }
  .appointments-refresh { flex: 0 0 auto; }
  .appointments-filter-summary { margin: 0 16px 15px; align-items: flex-start; font-size: 11px; }
  .appointments-stats { gap: 8px; margin: 15px 0 18px; }
  .appointments-stats .appointments-stat-total,
  .appointments-stats .appointments-stat-confirmed,
  .appointments-stats .appointments-stat-doctors,
  .appointments-stats .appointments-stat-note { min-height: 105px; padding: 13px 12px; }
  .appointments-stats .stat-card > strong { margin-top: 7px; font-size: 23px; }
  .appointments-stats .stat-card > p { margin-top: 6px; font-size: 9px; }
  .appointments-panel-heading { padding: 16px; }
  .appointments-filter-bar { display: grid; grid-template-columns: minmax(0, 1fr); padding: 14px 16px; gap: 10px; }
  .appointments-filter-bar :deep(.el-form-item),
  .appointments-filter-bar :deep(.el-date-editor),
  .appointments-filter-bar :deep(.el-select) { width: 100% !important; min-width: 0; }
  .appointments-filter-bar :deep(.el-button) { width: 100%; }
  .appointments-table-hint { display: block; margin: 0; padding: 0 16px 9px; color: #686d70; font-size: 10px; }
  .appointments-table-scroll { border-top: 1px solid #f0ede8; }
  .appointments-table :deep(.el-table .cell) { padding-inline: 11px; }
  .appointments-table :deep(.table-person) { white-space: nowrap; }
  .appointments-panel > .pagination { padding: 13px 12px; }
  .appointments-agenda { padding: 14px 12px 16px; gap: 12px; }
  .appointments-agenda .schedule-agenda-item { gap: 9px; padding: 13px 10px; }
  .appointments-agenda .schedule-agenda-time { min-width: 58px; font-size: 12px; }
  .appointments-agenda .schedule-agenda-content { padding-left: 9px; }
  .appointments-agenda .schedule-agenda-content strong { font-size: 12px; }
  .appointments-agenda .schedule-agenda-meta { font-size: 10px; }
  .appointment-detail-drawer :deep(.el-drawer) { border-radius: 12px 0 0 12px; }
  .appointment-detail-drawer :deep(.el-drawer__header) { padding: 16px; }
  .appointment-detail-drawer :deep(.el-drawer__body) { padding: 17px 16px 22px; }
}
@media (prefers-reduced-motion: reduce) {
  .appointments-table :deep(.el-table__row),
  .appointments-agenda .schedule-agenda-item { transition: none; }
}
</style>
