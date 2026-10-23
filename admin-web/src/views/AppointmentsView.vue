<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
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
const loading = ref(false);
const error = ref('');
const selected = ref<Appointment | null>(null);
const drawer = ref(false);
const writing = ref(false);
const pending = ref<PendingCommand | null>(readPending());
const activeCount = computed(() => rows.value.filter((item) => item.status === 'confirmed').length);
const doctorCount = computed(() => new Set(rows.value.map((item) => item.doctorId)).size);
const currentTitle = computed(() => (date.value === today() ? '今日预约' : '预约总览'));
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const result = await api<Page<Appointment>>(
      `/staff/appointments${query({ clinicId: clinicId.value, date: date.value, status: status.value, page: page.value, pageSize: pageSize.value })}`,
    );
    rows.value = result.items;
    total.value = result.total;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
async function search() {
  page.value = 1;
  await load();
}
async function detail(row: Appointment) {
  try {
    selected.value = await api<Appointment>(`/appointments/${row.id}`);
    drawer.value = true;
  } catch (e) {
    ElMessage.error(errorText(e));
  }
}
async function cancel(row: Appointment) {
  if (pending.value) {
    ElMessage.warning('请先查询上一笔提交的结果。');
    return;
  }
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
  try {
    if (!catalog.loaded) await catalog.load();
  } catch (e) {
    error.value = errorText(e);
  }
  await load();
});
</script>
<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">APPOINTMENT OVERVIEW</div>
      <h1>{{ currentTitle }}</h1>
      <p>查看患者就诊安排，及时处理预约变更。</p>
    </div>
    <el-button :icon="Refresh" @click="load" :loading="loading">刷新数据</el-button>
  </section>
  <div class="hero-strip">
    <div>
      <span class="hero-tag">让协作有序发生</span>
      <h2>{{ auth.canBook ? '每一个预约，都值得认真安排。' : '专注当日安排，从容开始接诊。' }}</h2>
      <p>预约经医生资格、班次时段和牙椅资源共同校验后确认。</p>
    </div>
    <div class="hero-calendar" aria-hidden="true">
      <span>{{
        new Date(`${date || today()}T12:00:00+08:00`).toLocaleString('zh-CN', {
          month: 'long',
          timeZone: 'Asia/Shanghai',
        })
      }}</span
      ><strong>{{ (date || today()).slice(-2) }}</strong>
      <div><i></i><i></i><i></i></div>
    </div>
  </div>
  <div class="stat-grid">
    <div class="stat-card">
      <span>筛选结果总数</span><strong>{{ total }}<small>笔</small></strong>
      <p>当前日期、门诊与状态</p>
    </div>
    <div class="stat-card">
      <span>本页已确认</span><strong>{{ activeCount }}<small>笔</small></strong>
      <p>本页 {{ rows.length }} 条记录中</p>
    </div>
    <div class="stat-card">
      <span>本页服务医生</span><strong>{{ doctorCount }}<small>人</small></strong>
      <p>按本页预约去重统计</p>
    </div>
    <div class="stat-card stat-note">
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
    class="mb-24"
    ><template #default
      ><el-button size="small" :loading="writing" @click="checkPending">查询结果</el-button
      ><el-button size="small" :loading="writing" @click="retryPending"
        >使用原编号重试</el-button
      ></template
    ></el-alert
  ><el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="mb-24" />
  <section class="panel">
    <div class="panel-heading">
      <div>
        <h2>预约清单</h2>
        <p>日期与时间均为北京时间</p>
      </div>
      <el-button v-if="auth.canBook" type="primary" :icon="Plus" @click="router.push('/booking')"
        >为患者预约</el-button
      >
    </div>
    <el-form inline class="filter-bar" @submit.prevent="search"
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
    ><el-table
      :data="rows"
      v-loading="loading"
      row-key="id"
      empty-text="当前筛选条件下暂无预约"
      @row-click="detail"
      class="clickable-table"
      ><el-table-column label="预约时间" min-width="130"
        ><template #default="{ row }"
          ><strong>{{ time(row.startsAt) }}</strong>
          <div class="table-sub">至 {{ time(row.endsAt) }}</div></template
        ></el-table-column
      ><el-table-column label="患者" min-width="140"
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
      ><el-table-column label="操作" width="130" fixed="right"
        ><template #default="{ row }"
          ><el-button text type="primary" @click.stop="detail(row)"
            >查看<el-icon><ArrowRight /></el-icon></el-button></template></el-table-column
    ></el-table>
    <div class="pagination">
      <span>共 {{ total }} 笔预约</span
      ><el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :page-sizes="[10, 20, 50]"
        :total="total"
        layout="sizes, prev, pager, next"
        @current-change="load"
        @size-change="search"
      />
    </div>
  </section>
  <el-drawer v-model="drawer" title="预约详情" size="480px"
    ><template v-if="selected"
      ><div class="detail-title">
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
        ><el-descriptions-item label="到诊记录">尚未记录（预约阶段）</el-descriptions-item
        ><el-descriptions-item label="版本">{{ selected.rowVersion }}</el-descriptions-item
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
