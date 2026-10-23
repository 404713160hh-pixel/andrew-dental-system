<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Plus, Refresh, Search } from '@element-plus/icons-vue';
import type {
  Chair,
  Clinic,
  DentistQualification,
  Doctor,
  Qualification,
  Service,
} from '@andrew/shared';
import { api, ApiError, errorText } from '../api';
import { useAuth } from '../stores/auth';
import { useCatalog } from '../stores/catalog';
import { calendarDate, instant, money, today } from '../utils';
type Kind = 'clinics' | 'doctors' | 'services' | 'chairs' | 'qualifications';
type Resource = Clinic | Doctor | Service | Chair | Qualification;
interface ResourceForm {
  name: string;
  address: string;
  phone: string;
  email: string;
  active: boolean;
  employeeNo: string;
  specialty: string;
  qualifications: DentistQualification[];
  description: string;
  durationMinutes: number;
  bufferMinutes: number;
  priceCents: number;
  unit: string;
  clinicIds: string[];
  qualificationIds: string[];
  clinicId: string;
}
const route = useRoute();
const auth = useAuth();
const catalog = useCatalog();
const kind = computed(() => route.params.kind as Kind);
const q = ref('');
const clinicId = ref('');
const loading = ref(false);
const error = ref('');
const dialog = ref(false);
const saving = ref(false);
const editing = ref<Resource | null>(null);
const formError = ref('');
const names: Record<Kind, string> = {
  clinics: '门诊机构',
  doctors: '医生与资质',
  services: '预约服务',
  chairs: '牙椅资源',
  qualifications: '资格目录',
};
const explanations: Record<Kind, string> = {
  clinics: '维护机构信息与服务地点，停用门诊前需妥善处理既有预约。',
  doctors: '管理医生基本资料与资格有效期，服务能力由资格规则计算。',
  services: '明确服务时长、准备缓冲与资格要求，连接可用的门诊资源。',
  chairs: '按门诊维护牙椅资源，预约占用由系统统一校验。',
  qualifications: '总部统一维护资格目录，医生资质与服务要求使用同一目录。',
};
const allRows = computed<Resource[]>(() =>
  kind.value === 'clinics'
    ? catalog.clinics
    : kind.value === 'doctors'
      ? catalog.doctors
      : kind.value === 'services'
        ? catalog.services
        : kind.value === 'chairs'
          ? catalog.chairs
          : catalog.qualifications,
);
const rows = computed(() =>
  allRows.value.filter((item) => item.name.toLowerCase().includes(q.value.trim().toLowerCase())),
);
const enabledCount = computed(() => allRows.value.filter((item) => item.active).length);
const permittedClinics = computed(() =>
  catalog.clinics.filter((item) => auth.isHq || auth.clinicIds.has(item.id)),
);
const canCreate = computed(() => auth.isHq || (kind.value === 'chairs' && auth.canManage));
function canEdit(row: Resource) {
  if (auth.isHq) return true;
  if (!auth.canManage) return false;
  if (kind.value === 'clinics') return auth.clinicIds.has(row.id);
  return kind.value === 'chairs' && 'clinicId' in row && auth.clinicIds.has(row.clinicId);
}
const defaults = (): ResourceForm => ({
  name: '',
  address: '',
  phone: '',
  email: '',
  active: true,
  employeeNo: '',
  specialty: '',
  qualifications: [],
  description: '',
  durationMinutes: 30,
  bufferMinutes: 10,
  priceCents: 0,
  unit: '次',
  clinicIds: [],
  qualificationIds: [],
  clinicId: clinicId.value || permittedClinics.value[0]?.id || '',
});
const form = reactive<ResourceForm>(defaults());
async function load() {
  loading.value = true;
  error.value = '';
  try {
    await catalog.load();
    if (kind.value === 'chairs') {
      if (!clinicId.value) clinicId.value = permittedClinics.value[0]?.id || '';
      if (clinicId.value) await catalog.loadChairs(clinicId.value);
      else catalog.chairs = [];
    }
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
function open(row: Resource | null = null) {
  formError.value = '';
  editing.value = row;
  Object.assign(form, defaults());
  if (row) {
    form.name = row.name;
    form.active = row.active;
    if ('address' in row) {
      form.address = row.address;
      form.phone = row.phone;
      form.email = row.email;
    }
    if ('employeeNo' in row) {
      form.employeeNo = row.employeeNo;
      form.phone = row.phone;
      form.specialty = row.specialty;
      form.qualifications = row.qualifications.map((item) => ({
        qualificationId: item.qualificationId,
        validFrom: localDateTime(item.validFrom),
        validUntil: item.validUntil ? localDateTime(item.validUntil) : null,
      }));
    }
    if ('durationMinutes' in row) {
      form.description = row.description;
      form.durationMinutes = row.durationMinutes;
      form.bufferMinutes = row.bufferMinutes;
      form.priceCents = row.priceCents;
      form.unit = row.unit;
      form.clinicIds = [...row.clinicIds];
      form.qualificationIds = [...row.qualificationIds];
    }
    if ('clinicId' in row) form.clinicId = row.clinicId;
  }
  dialog.value = true;
}
function localDateTime(value: string) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
  return parts.replace(' ', 'T');
}
function addQualification() {
  form.qualifications.push({
    qualificationId: '',
    validFrom: `${today()}T00:00:00`,
    validUntil: null,
  });
}
async function save() {
  if (saving.value) return;
  formError.value = '';
  if (!form.name.trim()) {
    formError.value = '请填写名称。';
    return;
  }
  let body: Record<string, unknown> = { name: form.name.trim(), active: form.active };
  if (kind.value === 'clinics') {
    if (!form.address.trim() || !form.phone.trim() || !form.email.trim()) {
      formError.value = '请填写门诊地址、电话和电子邮件。';
      return;
    }
    body = {
      ...body,
      address: form.address.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      timezone: 'Asia/Shanghai',
    };
  }
  if (kind.value === 'doctors') {
    if (!form.employeeNo.trim() || !form.phone.trim() || !form.specialty.trim()) {
      formError.value = '请填写工号、电话与专业方向。';
      return;
    }
    if (
      form.qualifications.some(
        (item) =>
          !item.qualificationId ||
          !item.validFrom ||
          (item.validUntil && item.validUntil < item.validFrom),
      )
    ) {
      formError.value = '请完整填写资格与生效日期，失效日期不能早于生效日期。';
      return;
    }
    if (
      new Set(form.qualifications.map((item) => item.qualificationId)).size !==
      form.qualifications.length
    ) {
      formError.value = '同一资格请勿重复添加。';
      return;
    }
    body = {
      ...body,
      employeeNo: form.employeeNo.trim(),
      phone: form.phone.trim(),
      specialty: form.specialty.trim(),
      qualifications: form.qualifications.map((item) => ({
        qualificationId: item.qualificationId,
        validFrom: instant(item.validFrom),
        validUntil: item.validUntil ? instant(item.validUntil) : null,
      })),
    };
  }
  if (kind.value === 'services') {
    if (
      !form.clinicIds.length ||
      !form.unit.trim() ||
      !Number.isInteger(form.priceCents) ||
      !Number.isInteger(form.durationMinutes) ||
      !Number.isInteger(form.bufferMinutes)
    ) {
      formError.value = '请选择至少一个门诊，并填写服务单位、整数时长与整数分价格。';
      return;
    }
    body = {
      ...body,
      description: form.description.trim(),
      durationMinutes: form.durationMinutes,
      bufferMinutes: form.bufferMinutes,
      priceCents: form.priceCents,
      unit: form.unit.trim(),
      clinicIds: form.clinicIds,
      qualificationIds: form.qualificationIds,
    };
  }
  if (kind.value === 'chairs') {
    if (!form.clinicId) {
      formError.value = '请选择所属门诊。';
      return;
    }
    body = { ...body, clinicId: form.clinicId };
  }
  if (editing.value) body.expectedVersion = editing.value.rowVersion;
  saving.value = true;
  try {
    await api(`/staff/${kind.value}${editing.value ? `/${editing.value.id}` : ''}`, {
      method: editing.value ? 'PUT' : 'POST',
      body,
    });
    dialog.value = false;
    ElMessage.success(editing.value ? '资料已更新。' : '资源已创建。');
    await load();
  } catch (e) {
    formError.value = errorText(e);
    if (e instanceof ApiError && e.status === 409)
      formError.value += ' 请关闭表单并刷新数据后重新编辑。';
  } finally {
    saving.value = false;
  }
}
function clinicName(id: string) {
  return catalog.clinics.find((item) => item.id === id)?.name || id;
}
function qualificationName(id: string) {
  return catalog.qualifications.find((item) => item.id === id)?.name || id;
}
watch(kind, () => {
  q.value = '';
  dialog.value = false;
  void load();
});
onMounted(load);
</script>
<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">RESOURCE MANAGEMENT</div>
      <h1>{{ names[kind] }}</h1>
      <p>{{ explanations[kind] }}</p>
    </div>
    <div class="button-row">
      <el-button :icon="Refresh" @click="load" :loading="loading">刷新</el-button
      ><el-button v-if="canCreate" type="primary" :icon="Plus" @click="open()"
        >新增{{
          kind === 'doctors'
            ? '医生'
            : kind === 'clinics'
              ? '门诊'
              : kind === 'services'
                ? '服务'
                : kind === 'chairs'
                  ? '牙椅'
                  : '资格'
        }}</el-button
      >
    </div>
  </section>
  <el-alert
    v-if="!auth.isHq && ['doctors', 'services', 'qualifications'].includes(kind)"
    title="共享资源由总部统一维护，当前岗位可查看资料。"
    type="info"
    :closable="false"
    show-icon
    class="mb-24"
  /><el-alert v-if="error" :title="error" type="error" :closable="false" show-icon class="mb-24" />
  <div class="resource-count">
    <strong>{{ allRows.length }}</strong
    ><span>条资源</span><el-tag type="success" round>启用 {{ enabledCount }}</el-tag
    ><el-tag type="info" round>停用 {{ allRows.length - enabledCount }}</el-tag>
  </div>
  <section class="panel">
    <div class="panel-heading">
      <h2>{{ names[kind] }}清单</h2>
      <div class="button-row">
        <el-select
          v-if="kind === 'chairs'"
          v-model="clinicId"
          style="width: 210px"
          placeholder="选择门诊"
          @change="load"
          ><el-option
            v-for="clinic in permittedClinics"
            :key="clinic.id"
            :label="clinic.name"
            :value="clinic.id" /></el-select
        ><el-input
          v-model="q"
          :prefix-icon="Search"
          clearable
          placeholder="筛选名称"
          style="width: 200px"
        />
      </div>
    </div>
    <el-table :data="rows" row-key="id" v-loading="loading" empty-text="暂无匹配资源"
      ><el-table-column prop="name" label="名称" min-width="170"
        ><template #default="{ row }"
          ><strong>{{ row.name }}</strong>
          <div v-if="kind === 'doctors'" class="table-sub">
            {{ row.employeeNo }} · {{ row.specialty }}
          </div></template
        ></el-table-column
      ><template v-if="kind === 'clinics'"
        ><el-table-column prop="address" label="门诊地址" min-width="220" /><el-table-column
          prop="phone"
          label="联系电话"
          min-width="150" /></template
      ><template v-if="kind === 'doctors'"
        ><el-table-column label="专业资格" min-width="250"
          ><template #default="{ row }"
            ><div class="tag-list">
              <el-tag
                v-for="qualification in row.qualifications"
                :key="qualification.qualificationId"
                type="info"
                size="small"
                >{{ qualificationName(qualification.qualificationId) }} ·
                {{
                  qualification.validUntil ? calendarDate(qualification.validUntil) : '长期有效'
                }}</el-tag
              ><span v-if="!row.qualifications.length" class="muted">未配置资格</span>
            </div></template
          ></el-table-column
        ><el-table-column prop="phone" label="联系电话" min-width="145" /></template
      ><template v-if="kind === 'services'"
        ><el-table-column label="时长 / 缓冲" width="145"
          ><template #default="{ row }"
            >{{ row.durationMinutes }} / {{ row.bufferMinutes }} 分钟</template
          ></el-table-column
        ><el-table-column label="参考价格" width="125"
          ><template #default="{ row }"
            >{{ money(row.priceCents) }} / {{ row.unit }}</template
          ></el-table-column
        ><el-table-column label="适用门诊" min-width="220"
          ><template #default="{ row }">{{
            row.clinicIds.map(clinicName).join('、')
          }}</template></el-table-column
        ></template
      ><el-table-column v-if="kind === 'chairs'" label="所属门诊" min-width="200"
        ><template #default="{ row }">{{ clinicName(row.clinicId) }}</template></el-table-column
      ><el-table-column label="状态" width="100"
        ><template #default="{ row }"
          ><el-tag :type="row.active ? 'success' : 'info'" round>{{
            row.active ? '启用' : '停用'
          }}</el-tag></template
        ></el-table-column
      ><el-table-column label="版本" width="75" prop="rowVersion" /><el-table-column
        label="操作"
        width="110"
        fixed="right"
        ><template #default="{ row }"
          ><el-button v-if="canEdit(row)" type="primary" text @click="open(row)">编辑</el-button
          ><span v-else class="muted small">只读</span></template
        ></el-table-column
      ></el-table
    >
  </section>
  <el-dialog
    v-model="dialog"
    :title="`${editing ? '编辑' : '新增'}${names[kind]}`"
    width="680px"
    :close-on-click-modal="false"
    ><el-alert
      v-if="formError"
      :title="formError"
      type="error"
      show-icon
      :closable="false"
      class="mb-24"
    /><el-form label-position="top" @submit.prevent="save"
      ><div class="form-grid">
        <el-form-item :label="kind === 'doctors' ? '医生姓名' : '名称'" required
          ><el-input v-model="form.name" maxlength="100" /></el-form-item
        ><el-form-item label="资源状态"
          ><el-switch v-model="form.active" active-text="启用" inactive-text="停用" /></el-form-item
        ><template v-if="kind === 'clinics'"
          ><el-form-item label="门诊地址" required class="span-two"
            ><el-input v-model="form.address" maxlength="240" /></el-form-item
          ><el-form-item label="联系电话" required
            ><el-input v-model="form.phone" maxlength="32" /></el-form-item
          ><el-form-item label="电子邮件" required
            ><el-input v-model="form.email" type="email" maxlength="180"
          /></el-form-item>
          <p class="muted small span-two">门诊时区：中国标准时间（Asia/Shanghai）。</p></template
        ><template v-if="kind === 'doctors'"
          ><el-form-item label="员工编号" required
            ><el-input v-model="form.employeeNo" maxlength="40" /></el-form-item
          ><el-form-item label="联系电话" required
            ><el-input v-model="form.phone" maxlength="32" /></el-form-item
          ><el-form-item label="专业方向" required class="span-two"
            ><el-input v-model="form.specialty" maxlength="180"
          /></el-form-item>
          <div class="span-two qualification-editor">
            <div class="section-row">
              <h3>专业资格与有效期</h3>
              <el-button text type="primary" :icon="Plus" @click="addQualification"
                >添加资格</el-button
              >
            </div>
            <p class="muted small mb-16">
              资格起止按北京时间填写；失效时刻留空表示长期有效，须覆盖完整班次。
            </p>
            <div
              v-for="(qualification, index) in form.qualifications"
              :key="index"
              class="qualification-row"
            >
              <el-select v-model="qualification.qualificationId" placeholder="资格名称"
                ><el-option
                  v-for="item in catalog.qualifications"
                  :key="item.id"
                  :value="item.id"
                  :label="item.name"
                  :disabled="
                    !item.active && item.id !== qualification.qualificationId
                  " /></el-select
              ><el-date-picker
                v-model="qualification.validFrom"
                type="datetime"
                value-format="YYYY-MM-DDTHH:mm:ss"
                format="YYYY-MM-DD HH:mm"
                placeholder="生效时刻"
              /><el-date-picker
                v-model="qualification.validUntil"
                type="datetime"
                value-format="YYYY-MM-DDTHH:mm:ss"
                format="YYYY-MM-DD HH:mm"
                placeholder="失效时刻（可空）"
              /><el-button type="danger" text @click="form.qualifications.splice(index, 1)"
                >移除</el-button
              >
            </div>
            <p v-if="!form.qualifications.length" class="muted small">
              尚未配置资格。可提供的服务由资格目录与服务要求计算。
            </p>
          </div></template
        ><template v-if="kind === 'services'"
          ><el-form-item label="服务说明" class="span-two"
            ><el-input
              v-model="form.description"
              type="textarea"
              :rows="2"
              maxlength="600" /></el-form-item
          ><el-form-item label="服务时长（分钟）" required
            ><el-input-number
              v-model="form.durationMinutes"
              :min="10"
              :max="240"
              :step="5" /></el-form-item
          ><el-form-item label="准备缓冲（分钟）" required
            ><el-input-number
              v-model="form.bufferMinutes"
              :min="0"
              :max="120"
              :step="5" /></el-form-item
          ><el-form-item label="参考价格（整数分）" required
            ><el-input-number v-model="form.priceCents" :min="0" :max="100000000" :precision="0" />
            <div class="table-sub">{{ money(form.priceCents) }}</div></el-form-item
          ><el-form-item label="计价单位" required
            ><el-input v-model="form.unit" maxlength="24" /></el-form-item
          ><el-form-item label="适用门诊" required class="span-two"
            ><el-select v-model="form.clinicIds" multiple placeholder="选择可开展该服务的门诊"
              ><el-option
                v-for="clinic in catalog.clinics"
                :key="clinic.id"
                :value="clinic.id"
                :label="clinic.name"
                :disabled="
                  !clinic.active && !form.clinicIds.includes(clinic.id)
                " /></el-select></el-form-item
          ><el-form-item label="所需资格（须同时满足）" class="span-two"
            ><el-select
              v-model="form.qualificationIds"
              multiple
              clearable
              placeholder="无资格要求时可留空"
              ><el-option
                v-for="item in catalog.qualifications"
                :key="item.id"
                :value="item.id"
                :label="item.name"
                :disabled="
                  !item.active && !form.qualificationIds.includes(item.id)
                " /></el-select></el-form-item></template
        ><el-form-item v-if="kind === 'chairs'" label="所属门诊" required class="span-two"
          ><el-select v-model="form.clinicId" :disabled="!!editing"
            ><el-option
              v-for="clinic in permittedClinics"
              :key="clinic.id"
              :value="clinic.id"
              :label="clinic.name" /></el-select
        ></el-form-item>
      </div>
      <el-alert
        v-if="editing"
        :title="`当前版本 ${editing.rowVersion}。保存时将校验版本，发生并发修改需刷新后重新核对。`"
        type="info"
        :closable="false"
        class="mt-16" /></el-form
    ><template #footer
      ><el-button :disabled="saving" @click="dialog = false">返回</el-button
      ><el-button type="primary" :loading="saving" @click="save">保存资料</el-button></template
    ></el-dialog
  >
</template>
