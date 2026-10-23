<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Refresh } from '@element-plus/icons-vue';
import type { Shift } from '@andrew/shared';
import { api, errorText, query } from '../api';
import { useAuth } from '../stores/auth';
import { useCatalog } from '../stores/catalog';
import { instant, statusLabels, statusType, time, today } from '../utils';
const auth = useAuth();
const catalog = useCatalog();
const clinicId = ref('');
const date = ref(today());
const rows = ref<Shift[]>([]);
const loading = ref(false);
const error = ref('');
const dialog = ref(false);
const saving = ref(false);
const formError = ref('');
const form = reactive({
  clinicId: '',
  doctorId: '',
  startsAt: '',
  endsAt: '',
  serviceIds: [] as string[],
});
const permittedClinics = computed(() =>
  catalog.clinics.filter((item) => auth.isHq || auth.clinicIds.has(item.id)),
);
const serviceOptions = computed(() =>
  catalog.services.filter(
    (item) => item.active && item.clinicIds.includes(form.clinicId),
  ),
);
function canCancel(shift: Shift) {
  return auth.isHq || (auth.canManage && auth.clinicIds.has(shift.clinicId));
}
async function load() {
  loading.value = true;
  error.value = '';
  try {
    rows.value = await api<Shift[]>(
      `/shifts${query({ clinicId: clinicId.value, date: date.value })}`,
    );
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
function open() {
  Object.assign(form, {
    clinicId: clinicId.value || permittedClinics.value.find((item) => item.active)?.id || '',
    doctorId: '',
    startsAt: `${date.value || today()}T09:00:00`,
    endsAt: `${date.value || today()}T18:00:00`,
    serviceIds: [],
  });
  formError.value = '';
  dialog.value = true;
}
watch([() => form.clinicId, () => form.doctorId], () => {
  form.serviceIds = form.serviceIds.filter((id) =>
    serviceOptions.value.some((item) => item.id === id),
  );
});
async function save() {
  if (saving.value) return;
  formError.value = '';
  if (
    !form.clinicId ||
    !form.doctorId ||
    !form.startsAt ||
    !form.endsAt ||
    !form.serviceIds.length
  ) {
    formError.value = '请选择门诊、医生、起止时间和至少一项服务。';
    return;
  }
  if (form.endsAt <= form.startsAt) {
    formError.value = '结束时间必须晚于开始时间。';
    return;
  }
  saving.value = true;
  try {
    await api('/staff/shifts', {
      method: 'POST',
      body: { ...form, startsAt: instant(form.startsAt), endsAt: instant(form.endsAt) },
    });
    dialog.value = false;
    ElMessage.success('班次已发布。');
    await load();
  } catch (e) {
    formError.value = errorText(e);
  } finally {
    saving.value = false;
  }
}
async function cancel(shift: Shift) {
  try {
    await ElMessageBox.confirm(
      `撤销 ${shift.doctorName} 在 ${time(shift.startsAt, true)} 的班次。存在已确认预约时，系统将拒绝撤销。`,
      '撤销已发布班次',
      { confirmButtonText: '确认撤销', cancelButtonText: '返回', type: 'warning' },
    );
    await api(`/staff/shifts/${shift.id}/cancel`, {
      method: 'POST',
      body: { expectedVersion: shift.rowVersion },
    });
    ElMessage.success('班次已撤销。');
    await load();
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(errorText(e));
  }
}
function clinicName(id: string) {
  return catalog.clinics.find((item) => item.id === id)?.name || id;
}
function serviceName(id: string) {
  return catalog.services.find((item) => item.id === id)?.name || id;
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
      <div class="eyebrow">DOCTOR SCHEDULES</div>
      <h1>医生排班</h1>
      <p>让医生资格、门诊服务与可预约时段保持一致。</p>
    </div>
    <div class="button-row">
      <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button
      ><el-button v-if="auth.canManage" type="primary" :icon="Plus" @click="open"
        >发布班次</el-button
      >
    </div>
  </section>
  <el-alert
    v-if="!auth.canManage"
    title="当前岗位可查看授权范围内的排班，班次由总部或所属门诊店长发布。"
    type="info"
    :closable="false"
    show-icon
    class="mb-24"
  /><el-alert v-if="error" :title="error" type="error" :closable="false" show-icon class="mb-24" />
  <section class="panel">
    <div class="panel-heading">
      <div>
        <h2>已发布班次</h2>
        <p>跨门诊班次还需满足医生转场缓冲时间。</p>
      </div>
    </div>
    <el-form inline class="filter-bar"
      ><el-form-item label="日期"
        ><el-date-picker
          v-model="date"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="全部日期"
          clearable
          style="width: 170px"
          @change="load" /></el-form-item
      ><el-form-item label="门诊"
        ><el-select
          v-model="clinicId"
          clearable
          style="width: 210px"
          placeholder="全部授权门诊"
          @change="load"
          ><el-option
            v-for="clinic in catalog.clinics"
            :key="clinic.id"
            :value="clinic.id"
            :label="clinic.name" /></el-select></el-form-item></el-form
    ><el-table :data="rows" row-key="id" v-loading="loading" empty-text="暂无符合条件的排班"
      ><el-table-column prop="doctorName" label="医生" min-width="130" /><el-table-column
        label="门诊"
        min-width="180"
        ><template #default="{ row }">{{ clinicName(row.clinicId) }}</template></el-table-column
      ><el-table-column label="工作时段" min-width="185"
        ><template #default="{ row }"
          ><strong>{{ time(row.startsAt, true) }}</strong>
          <div class="table-sub">至 {{ time(row.endsAt, true) }}</div></template
        ></el-table-column
      ><el-table-column label="开展服务" min-width="230"
        ><template #default="{ row }"
          ><div class="tag-list">
            <el-tag v-for="id in row.serviceIds" :key="id" size="small" type="info">{{
              serviceName(id)
            }}</el-tag>
          </div></template
        ></el-table-column
      ><el-table-column label="状态" width="110"
        ><template #default="{ row }"
          ><el-tag :type="statusType(row.status)" round>{{
            statusLabels[row.status]
          }}</el-tag></template
        ></el-table-column
      ><el-table-column label="操作" width="120" fixed="right"
        ><template #default="{ row }"
          ><el-button
            v-if="row.status === 'published' && canCancel(row)"
            type="danger"
            text
            @click="cancel(row)"
            >撤销班次</el-button
          ><span v-else class="muted small">{{
            row.status === 'cancelled' ? '已撤销' : '只读'
          }}</span></template
        ></el-table-column
      ></el-table
    >
  </section>
  <el-dialog v-model="dialog" title="发布医生班次" width="630px" :close-on-click-modal="false"
    ><el-alert
      v-if="formError"
      :title="formError"
      type="error"
      show-icon
      :closable="false"
      class="mb-24"
    /><el-form label-position="top"
      ><div class="form-grid">
        <el-form-item label="开展门诊" required
          ><el-select v-model="form.clinicId"
            ><el-option
              v-for="clinic in permittedClinics.filter((item) => item.active)"
              :key="clinic.id"
              :value="clinic.id"
              :label="clinic.name" /></el-select></el-form-item
        ><el-form-item label="出诊医生" required
          ><el-select v-model="form.doctorId" filterable placeholder="选择医生"
            ><el-option
              v-for="doctor in catalog.doctors.filter((item) => item.active)"
              :key="doctor.id"
              :value="doctor.id"
              :label="`${doctor.name} · ${doctor.specialty}`" /></el-select></el-form-item
        ><el-form-item label="开始时间（北京时间）" required
          ><el-date-picker
            v-model="form.startsAt"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss"
            format="YYYY-MM-DD HH:mm"
            class="full-width" /></el-form-item
        ><el-form-item label="结束时间（北京时间）" required
          ><el-date-picker
            v-model="form.endsAt"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss"
            format="YYYY-MM-DD HH:mm"
            class="full-width" /></el-form-item
        ><el-form-item label="本班次开展服务" required class="span-two"
          ><el-select v-model="form.serviceIds" multiple placeholder="先选择门诊与医生"
            ><el-option
              v-for="service in serviceOptions"
              :key="service.id"
              :value="service.id"
              :label="service.name"
          /></el-select>
          <p class="muted small">
            仅展示该门诊已配置的服务；发布时将校验医生资格是否覆盖完整班次，并检查跨店排班冲突。
          </p></el-form-item
        >
      </div></el-form
    ><template #footer
      ><el-button :disabled="saving" @click="dialog = false">返回</el-button
      ><el-button type="primary" :loading="saving" @click="save">校验并发布</el-button></template
    ></el-dialog
  >
</template>
