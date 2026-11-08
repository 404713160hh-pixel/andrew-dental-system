<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
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
import { instant, money, today } from '../utils';
import { createLatestRequest } from '../visible-refresh';
import DoctorProfileEditor from '../components/DoctorProfileEditor.vue';
type Kind = 'clinics' | 'doctors' | 'services' | 'chairs' | 'qualifications';
type Resource = Clinic | Doctor | Service | Chair | Qualification;
interface ResourceForm {
  name: string;
  address: string;
  openingHours: string;
  phone: string;
  email: string;
  active: boolean;
  employeeNo: string;
  birthDate: string;
  homeAddress: string;
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
const ready = ref(false);
const completedKind = ref<Kind | null>(null);
const requestScope = createLatestRequest(() => auth.user?.id);
const clock = ref(Date.now());
let clockTimer: number | undefined;
let disposed = false;
const dialog = ref(false);
const saving = ref(false);
const editing = ref<Resource | null>(null);
const formError = ref('');
const names: Record<Kind, string> = {
  clinics: '门诊机构',
  doctors: '医生档案',
  services: '预约服务',
  chairs: '牙椅资源',
  qualifications: '资质档案目录',
};
const explanations: Record<Kind, string> = {
  clinics: '维护机构信息与服务地点，停用门诊前需妥善处理既有预约。',
  doctors: '管理医生资料与展示专长。所有医生均可开展全部门诊项目，资质信息仅供内部留档。',
  services: '设置服务时长、准备缓冲与开展门诊，当班开放项目由排班安排。',
  chairs: '按门诊维护牙椅资源，预约占用由系统统一校验。',
  qualifications: '总部统一维护医生资质档案目录与有效期记录，供内部查阅。',
};
const allRows = computed<Resource[]>(() => {
  if (!ready.value || error.value || completedKind.value !== kind.value || !catalog.loaded) return [];
  if (kind.value === 'chairs' && catalog.chairsClinicId !== clinicId.value) return [];
  return kind.value === 'clinics'
    ? catalog.clinics
    : kind.value === 'doctors'
      ? catalog.doctors
      : kind.value === 'services'
        ? catalog.services
        : kind.value === 'chairs'
          ? catalog.chairs
          : catalog.qualifications;
});
const rows = computed(() =>
  allRows.value.filter((item) => item.name.toLowerCase().includes(q.value.trim().toLowerCase())),
);
const enabledCount = computed(() => allRows.value.filter((item) => item.active).length);
const permittedClinics = computed(() =>
  catalog.clinics.filter((item) => auth.isHq || auth.clinicIds.has(item.id)),
);
const canCreate = computed(() => auth.isHq || (kind.value === 'chairs' && auth.canManage));
const scopeLabel = computed(() => kind.value === 'chairs'
  ? permittedClinics.value.find(item => item.id === clinicId.value)?.name || (clinicId.value ? '所选门诊（目录待加载）' : '尚未选择门诊')
  : auth.isHq ? '全部门诊共享目录' : '当前账号授权目录');
const emptyText = computed(() => loading.value ? '正在加载当前筛选的资源…'
  : error.value ? '当前筛选加载失败，请重新加载'
  : !ready.value ? '当前资源尚未确认，请重新加载'
  : kind.value === 'chairs' && !clinicId.value ? '暂无可管理的门诊'
  : q.value.trim() ? '当前名称筛选没有匹配资源' : '当前范围暂无资源');
function canEdit(row: Resource) {
  if (auth.isHq) return true;
  if (!auth.canManage) return false;
  if (kind.value === 'clinics') return auth.clinicIds.has(row.id);
  return kind.value === 'chairs' && 'clinicId' in row && auth.clinicIds.has(row.clinicId);
}
const defaults = (): ResourceForm => ({
  name: '',
  address: '',
  openingHours: '',
  phone: '',
  email: '',
  active: true,
  employeeNo: '',
  birthDate: '',
  homeAddress: '',
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
async function load(refreshDirectory = true) {
  const requestKind = kind.value;
  const selectedClinicId = clinicId.value;
  const current = requestScope.begin();
  const accepts = () => current() && !disposed && kind.value === requestKind;
  loading.value = true;
  error.value = '';
  ready.value = false;
  completedKind.value = null;
  try {
    if (refreshDirectory || !catalog.loaded) {
      const accepted = await catalog.load();
      if (!accepts() || !accepted) return;
    }
    if (!accepts()) return;
    if (requestKind === 'chairs') {
      const selected = permittedClinics.value.find(item => item.id === selectedClinicId)?.id
        || permittedClinics.value[0]?.id || '';
      clinicId.value = selected;
      if (selected) {
        const accepted = await catalog.loadChairs(selected);
        if (!accepts() || !accepted || catalog.chairsClinicId !== selected) return;
      }
    }
    if (accepts()) { completedKind.value = requestKind; ready.value = true; }
  } catch (e) {
    if (accepts()) error.value = errorText(e);
  } finally {
    if (accepts()) loading.value = false;
  }
}
function open(row: Resource | null = null) {
  if (!ready.value || loading.value || error.value) return;
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
      form.description = row.description || '';
      form.openingHours = row.openingHours || '';
    }
    if ('employeeNo' in row) {
      form.employeeNo = row.employeeNo;
      form.phone = row.phone;
      form.birthDate = row.birthDate || '';
      form.homeAddress = row.homeAddress || '';
      form.email = row.email || '';
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
      description: form.description.trim() || null,
      openingHours: form.openingHours.trim() || null,
    };
  }
  if (kind.value === 'doctors') {
    if (!form.employeeNo.trim() || !form.phone.trim() || !form.specialty.trim()) {
      formError.value = '请填写工号、电话与专业方向。';
      return;
    }
    if (!editing.value && (!form.birthDate || !form.homeAddress.trim() || !form.email.trim())) {
      formError.value = '请填写出生日期、家庭住址和电子邮箱。';
      return;
    }
    if (form.birthDate && (form.birthDate < '1900-01-01' || form.birthDate > today())) {
      formError.value = '请填写有效的出生日期。';
      return;
    }
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      formError.value = '请填写有效的电子邮箱。';
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
      birthDate: form.birthDate || null,
      homeAddress: form.homeAddress.trim(),
      email: form.email.trim() || null,
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
function qualificationState(qualification: DentistQualification) {
  if (Date.parse(qualification.validFrom) > clock.value) return { label: '未生效', tone: 'info' as const };
  if (qualification.validUntil && Date.parse(qualification.validUntil) <= clock.value) return { label: '已过期', tone: 'warning' as const };
  return { label: '生效中', tone: 'success' as const };
}
function qualificationPeriod(qualification: DentistQualification) {
  return `${localDateTime(qualification.validFrom).replace('T', ' ')} 至 ${qualification.validUntil ? localDateTime(qualification.validUntil).replace('T', ' ') : '长期（无失效时刻）'}`;
}
watch([kind, () => auth.user?.id], () => {
  q.value = '';
  clinicId.value = '';
  dialog.value = false;
  void load();
});
onMounted(() => {
  void load();
  clockTimer = window.setInterval(() => { clock.value = Date.now(); }, 60000);
});
onUnmounted(() => {
  disposed = true; requestScope.stop();
  if (clockTimer !== undefined) window.clearInterval(clockTimer);
});
</script>
<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">RESOURCE MANAGEMENT</div>
      <h1>{{ names[kind] }}</h1>
      <p>{{ explanations[kind] }}</p>
    </div>
    <div class="button-row">
      <el-button :icon="Refresh" @click="load()" :loading="loading">刷新</el-button
      ><el-button v-if="canCreate" type="primary" :icon="Plus" :disabled="loading || !!error || !ready" @click="open()"
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
  /><el-alert v-if="error" title="当前资源未加载成功" type="error" :closable="false" show-icon class="mb-24 resource-load-state">
    <template #default><p>{{ error }}</p><p>当前筛选的结果尚未确认，请重新加载后再编辑资源。</p>
      <el-button :icon="Refresh" :loading="loading" @click="load()">重新加载</el-button>
    </template>
  </el-alert>
  <div class="resource-filter-summary" aria-live="polite">
    <span>当前门诊 / 范围：<strong>{{ scopeLabel }}</strong></span>
    <span>名称筛选：<strong>{{ q.trim() || '不限名称' }}</strong></span>
    <span>匹配 <strong>{{ ready ? rows.length : '—' }}</strong> / 总计 <strong>{{ ready ? allRows.length : '—' }}</strong> 条</span>
    <span v-if="loading" class="muted">正在读取当前范围…</span>
    <span v-else-if="error" class="muted">加载失败，结果尚未确认</span>
  </div>
  <div class="resource-count">
    <strong>{{ ready ? allRows.length : '—' }}</strong
    ><span>条范围内资源</span><template v-if="ready"><el-tag type="success" round>启用 {{ enabledCount }}</el-tag
    ><el-tag type="info" round>停用 {{ allRows.length - enabledCount }}</el-tag></template>
  </div>
  <section class="panel">
    <div class="panel-heading resource-panel-heading">
      <h2>{{ names[kind] }}清单</h2>
      <div class="button-row resource-filters">
        <el-select
          v-if="kind === 'chairs'"
          v-model="clinicId"
          class="resource-clinic-filter"
          placeholder="选择门诊"
          @change="load(false)"
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
          class="resource-name-filter"
        />
      </div>
    </div>
    <p v-if="kind === 'doctors'" class="muted small qualification-validity">专长用于向患者展示与推荐；所有医生均可预约全部门诊项目。以下资质及有效期仅作内部档案。</p>
    <div class="resources-table-scroll" role="region" :aria-label="`${names[kind]}表格，可横向滚动`" tabindex="0">
    <el-table :class="`resources-table resources-table--${kind}`" :data="rows" row-key="id" v-loading="loading" :empty-text="emptyText"
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
        ><el-table-column label="内部资质档案" min-width="250"
          ><template #default="{ row }"
            ><div class="qualification-summary">
              <div
                v-for="qualification in row.qualifications"
                :key="qualification.qualificationId"
                class="qualification-item"
                ><div><strong>{{ qualificationName(qualification.qualificationId) }}</strong>
                  <el-tag :type="qualificationState(qualification).tone" size="small" class="qualification-validity">{{ qualificationState(qualification).label }}</el-tag>
                </div><div class="qualification-period muted small">{{ qualificationPeriod(qualification) }} · 北京时间</div>
              </div
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
        width="180"
        fixed="right"
        ><template #default="{ row }"
          ><el-button v-if="canEdit(row)" type="primary" text @click="open(row)">编辑</el-button
          ><DoctorProfileEditor v-if="kind === 'doctors' && auth.isHq" :doctor="row" @saved="load()" />
          <span v-if="!canEdit(row)" class="muted small">只读</span></template
        ></el-table-column
      ></el-table
    >
    </div>
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
          <el-form-item label="门诊简介" class="span-two"><el-input v-model="form.description" type="textarea" :rows="3" maxlength="2000" show-word-limit placeholder="可选，将显示在公开门诊详情" /></el-form-item>
          <el-form-item label="营业时间" class="span-two"><el-input v-model="form.openingHours" maxlength="300" placeholder="可选，例如：周一至周六 09:00–18:00" /></el-form-item>
          <p class="muted small span-two">门诊时区：中国标准时间（Asia/Shanghai）。简介与营业时间会公开展示，留空可清除。</p></template
        ><template v-if="kind === 'doctors'"
          ><el-form-item label="员工编号" required
            ><el-input v-model="form.employeeNo" maxlength="40" /></el-form-item
          ><el-form-item label="联系电话" required
            ><el-input v-model="form.phone" maxlength="32" /></el-form-item
          ><el-form-item label="出生日期" :required="!editing"
            ><el-date-picker v-model="form.birthDate" type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD" placeholder="出生日期" /></el-form-item
          ><el-form-item label="电子邮箱" :required="!editing"
            ><el-input v-model="form.email" type="email" maxlength="180" /></el-form-item
          ><el-form-item label="家庭住址" :required="!editing" class="span-two"
            ><el-input v-model="form.homeAddress" maxlength="240" /></el-form-item
          ><el-form-item label="展示专长" required class="span-two"
            ><el-input v-model="form.specialty" maxlength="180"
          /></el-form-item>
          <p class="muted small span-two">出生日期、家庭住址和联系邮箱仅供总部管理，患者端不展示。历史缺失资料按核实结果补充。</p>
          <div class="span-two qualification-editor">
            <div class="section-row">
              <h3>内部资质档案与有效期</h3>
              <el-button text type="primary" :icon="Plus" @click="addQualification"
                >添加资格</el-button
              >
            </div>
            <p class="muted small mb-16">
              仅用于内部留档，不限制排班或预约项目。起止按北京时间填写，失效时刻留空表示长期有效。
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
              尚未录入资质档案，可继续安排全部门诊项目。
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
          ><p class="muted small span-two">所有医生均可开展该项目，患者可参考展示专长选择医生。实际预约以门诊开放项目、班次与可用时间为准。</p></template
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

<style scoped>
.page-heading {
  align-items: flex-end;
  gap: 20px;
}

.page-heading > div:first-child {
  min-width: 0;
}

.page-heading p {
  max-width: 760px;
  line-height: 1.65;
}

.resource-filter-summary {
  align-items: center;
  padding: 14px 18px;
  border-color: var(--border-subtle, #e7e4df);
  background: var(--brand-soft, #fcfbf9);
  line-height: 1.55;
}

.resource-count {
  flex-wrap: wrap;
  row-gap: 8px;
  margin-bottom: 20px;
}

.resource-count > strong {
  color: var(--text-primary, #292d30);
}

.resource-panel-heading {
  min-width: 0;
}

.resource-filters {
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 10px;
}

.resource-name-filter {
  width: 220px;
}

.resource-clinic-filter {
  width: 230px;
}

.qualification-validity {
  line-height: 1.6;
}

.resources-table-scroll {
  width: 100%;
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  -webkit-overflow-scrolling: touch;
}

.resources-table {
  width: 100%;
}

.qualification-summary {
  min-width: 0;
  gap: 10px;
}

.qualification-period {
  overflow-wrap: anywhere;
  line-height: 1.5;
}

.qualification-row {
  align-items: start;
}

.resource-load-state {
  line-height: 1.55;
}

:deep(.resources-table .cell) {
  overflow-wrap: anywhere;
}

@media (max-width: 760px) {
  .page-heading {
    align-items: stretch;
    flex-direction: column;
    gap: 14px;
  }

  .page-heading .button-row {
    width: 100%;
  }

  .page-heading .button-row :deep(.el-button) {
    flex: 1;
  }

  .resource-filter-summary {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
    padding: 12px 14px;
    margin-bottom: 14px;
    overflow-wrap: anywhere;
  }

  .resource-count {
    gap: 8px;
    margin-bottom: 16px;
  }

  .resource-count > strong {
    font-size: 23px;
  }

  .resource-count > .el-tag:first-of-type {
    margin-left: 0;
  }

  .resource-panel-heading {
    align-items: stretch;
    flex-direction: column;
    gap: 14px;
    padding: 18px 16px;
  }

  .resource-filters {
    width: 100%;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }

  .resource-name-filter,
  .resource-clinic-filter {
    width: 100% !important;
  }

  .resources-table--clinics,
  .resources-table--doctors,
  .resources-table--services,
  .resources-table--chairs,
  .resources-table--qualifications {
    min-width: 760px;
  }

  .resources-table--doctors,
  .resources-table--services {
    min-width: 920px;
  }

  .resources-table--clinics {
    min-width: 860px;
  }

  .resources-table--chairs {
    min-width: 720px;
  }

  .qualification-validity {
    margin: 0 16px 12px;
  }

  .qualification-row {
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
    padding: 12px;
  }

  .qualification-row > .el-select,
  .qualification-row > :deep(.el-date-editor) {
    width: 100% !important;
    max-width: none;
  }

  .qualification-row > :deep(.el-button) {
    justify-self: end;
  }

  .section-row {
    align-items: flex-start;
    gap: 10px;
  }

  .section-row > :deep(.el-button) {
    flex: 0 0 auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .resources-table-scroll {
    scroll-behavior: auto;
  }
}
</style>
