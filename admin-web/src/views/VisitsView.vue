<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import type { Service, VisitDetail, VisitMaterialInput, VisitPaymentMethod, VisitSummary } from '@andrew/shared';
import { api, ApiError, errorText, query } from '../api';
import { money, time, today } from '../utils';
import { useAuth } from '../stores/auth';

const auth = useAuth();
const route = useRoute();
const id = computed(() => typeof route.params.id === 'string' ? route.params.id : '');
const day = ref(today());
const rows = ref<VisitSummary[]>([]);
const visit = ref<VisitDetail | null>(null);
const doctors = ref<{ id: string; name: string }[]>([]);
const services = ref<Service[]>([]);
const doctorId = ref('');
const materials = ref<{ name: string; unit: string; quantity: string; cost: string }[]>([]);
const noMaterials = ref(false);
const addMaterial = () => materials.value.push({name:'',unit:'',quantity:'1',cost:''});
const items = ref<{ serviceId: string; quantity: number; price: string }[]>([]);
const amount = ref('');
const method = ref<VisitPaymentMethod>('cash');
const reference = ref('');
const busy = ref(false);
const loading = ref(false);
const error = ref('');
const success = ref('');
type PaymentInput = { amountCents: number; method: VisitPaymentMethod; reference: string; commandKey: string };
const pending = ref<PaymentInput | null>(null);
const pendingKey = (appointmentId: string) => 'andrew.staff.visit-payment.' + auth.user?.id + '.' + appointmentId;
const methods: Record<VisitPaymentMethod, string> = { cash: '现金', wechat: '微信', alipay: '支付宝', card: '银行卡', transfer: '转账' };
const labels = { arrived: '待接诊', no_show: '未到', completed: '治疗已完成' };
const availableServices = computed(() => services.value.filter(s => s.active));
const paid = computed(() => visit.value?.invoice?.payments.reduce((total, p) => total + p.amountCents, 0) ?? 0);
const balance = computed(() => (visit.value?.invoice?.totalCents ?? 0) - paid.value);
const canRecord = computed(() => visit.value?.canManage && visit.value.appointmentStatus === 'confirmed'
  && visit.value.status !== 'completed');
const nextItem = () => ({ serviceId: '', quantity: 1, price: '' });
let generation = 0;

function cents(value: string): number {
  const [whole, fraction = ''] = value.trim().split('.');
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(value.trim())) return NaN;
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
function chooseService(index: number) {
  const row = items.value[index];
  const service = availableServices.value.find(s => s.id === row?.serviceId);
  if (row) row.price = service ? (service.priceCents / 100).toFixed(2) : '';
}
async function load() {
  const current = ++generation;
  const appointmentId = id.value;
  visit.value = null;
  rows.value = [];
  doctors.value = [];
  services.value = [];
  items.value = [];
  materials.value = [];
  noMaterials.value = false;
  doctorId.value = '';
  amount.value = '';
  method.value = 'cash';
  reference.value = '';
  pending.value = null;
  error.value = '';
  success.value = '';
  loading.value = true;
  try {
    if (!appointmentId) {
      const result = await api<VisitSummary[]>('/staff/visits' + query({ date: day.value }));
      if (current === generation) rows.value = result;
      return;
    }
    const detail = await api<VisitDetail>('/staff/visits/' + appointmentId);
    if (current !== generation) return;
    visit.value = detail;
    pending.value = JSON.parse(sessionStorage.getItem(pendingKey(appointmentId)) || 'null') as PaymentInput | null;
    const [eligible, catalog] = await Promise.all([
      detail.canManage && detail.status !== 'completed' && detail.appointmentStatus === 'confirmed'
        ? api<{ id: string; name: string }[]>('/staff/visits/' + appointmentId + '/eligible-doctors') : [],
      detail.canTreat && detail.status === 'arrived' ? api<Service[]>('/services' + query({ clinicId: detail.clinicId })) : [],
    ]);
    if (current !== generation) return;
    doctors.value = eligible;
    doctorId.value = detail.doctorId ?? eligible.find(d => d.name === detail.bookedDoctorName)?.id ?? '';
    services.value = catalog;
    const scheduled = catalog.find(s => s.id === detail.scheduledServiceId);
    items.value = [scheduled ? { serviceId: scheduled.id, quantity: 1, price: (scheduled.priceCents / 100).toFixed(2) } : nextItem()];
    amount.value = balance.value ? (balance.value / 100).toFixed(2) : '';
  } catch (e) {
    if (current === generation) error.value = errorText(e);
  } finally {
    if (current === generation) loading.value = false;
  }
}
watch([id, day], () => void load(), { immediate: true });

async function submit(path: string, verb: 'PUT' | 'POST', body: unknown, message: string) {
  const appointmentId = id.value;
  if (busy.value || !appointmentId) return;
  busy.value = true;
  error.value = '';
  success.value = '';
  try {
    const result = await api<VisitDetail>('/staff/visits/' + appointmentId + path, { method: verb, body });
    if (path === '/payments') sessionStorage.removeItem(pendingKey(appointmentId));
    if (appointmentId === id.value) {
      if (path === '/payments') pending.value = null;
      await load();
      if (appointmentId === id.value && !error.value) {
        visit.value = result;
        success.value = message;
      }
    }
  } catch (e) {
    if (path === '/payments' && e instanceof ApiError && !e.uncertain) {
      sessionStorage.removeItem(pendingKey(appointmentId));
      if (appointmentId === id.value) pending.value = null;
    }
    if (appointmentId === id.value) error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
async function mark(status: 'arrived' | 'no_show') {
  const appointmentId = id.value;
  if (status === 'arrived' && !doctorId.value) {
    error.value = '请先选择实际接诊医生。';
    return;
  }
  if (status === 'no_show') {
    try { await ElMessageBox.confirm('确定这位患者没有到诊？', '登记未到'); }
    catch { return; }
  }
  if (appointmentId !== id.value) return;
  await submit('/attendance', 'PUT', status === 'arrived' ? { status, doctorId: doctorId.value } : { status },
    status === 'arrived' ? '已保存到诊和接诊医生。' : '已登记未到。');
}
function materialUsage(): VisitMaterialInput[] {
  const usage: VisitMaterialInput[] = materials.value.map(row => {
    const [whole, fraction = ''] = row.quantity.trim().split('.');
    const quantityMilli = /^\d{1,4}(\.\d{1,3})?$/.test(row.quantity.trim())
      ? Number(whole) * 1000 + Number(fraction.padEnd(3, '0')) : NaN;
    return {name:row.name.trim(),unit:row.unit.trim(),quantityMilli,unitCostCents:cents(row.cost)};
  });
  if ((!usage.length && !noMaterials.value) || usage.some(row => !row.name || !row.unit ||
    !Number.isInteger(row.quantityMilli) || row.quantityMilli < 1 || row.quantityMilli > 1000000 ||
    !Number.isInteger(row.unitCostCents) || row.unitCostCents > 10000000)) {
    throw new Error('请完整登记耗材用量和单位成本，或勾选本次未使用耗材。');
  }
  return usage;
}
async function backfillMaterials() {
  let usage: VisitMaterialInput[];
  try { usage=materialUsage(); }
  catch(e) { error.value=errorText(e); return; }
  await submit('/materials','PUT',{materials:usage},'耗材记录已确认。');
}
async function complete() {
  const appointmentId = id.value;
  const lines = items.value.map(row => ({ serviceId: row.serviceId, quantity: row.quantity, unitPriceCents: cents(row.price) }));
  if (lines.some(row => !row.serviceId || !Number.isInteger(row.quantity) || row.quantity < 1 || !Number.isInteger(row.unitPriceCents) || row.unitPriceCents > 100000000)
    || new Set(lines.map(row => row.serviceId)).size !== lines.length) {
    error.value = '请填写每项治疗的项目、数量和单价。同一项目请合并数量。';
    return;
  }
  let usage: VisitMaterialInput[];
  try { usage = materialUsage(); }
  catch(e) { error.value=errorText(e); return; }
  try { await ElMessageBox.confirm('请核对实际完成的项目和单价。确认后前台可以出单。', '确认治疗'); }
  catch { return; }
  if (appointmentId !== id.value) return;
  await submit('/treatments', 'PUT', { items: lines, materials: usage }, '治疗和耗材记录已确认。');
}
async function collect() {
  const appointmentId = id.value;
  if (busy.value || !appointmentId) return;
  if (!pending.value) {
    const amountCents = cents(amount.value);
    if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > balance.value) {
      error.value = '请输入大于零且不超过剩余应收的金额。';
      return;
    }
    if (method.value !== 'cash' && !reference.value.trim()) {
      error.value = '请填写线下收款凭证编号。';
      return;
    }
    const payment = { amountCents, method: method.value, reference: reference.value.trim(), commandKey: crypto.randomUUID() };
    try {
      await ElMessageBox.confirm('确认已经收到 ' + money(amountCents) + '？', '登记线下收款');
    } catch { return; }
    if (appointmentId !== id.value || busy.value || pending.value) return;
    sessionStorage.setItem(pendingKey(appointmentId), JSON.stringify(payment));
    pending.value = payment;
  }
  await submit('/payments', 'POST', pending.value, '收款记录已保存。');
}
</script>

<template>
  <div class="page-heading">
    <div><h1>{{ id ? '就诊与结算' : '接诊台' }}</h1><p>{{ id ? '从到诊登记跟进到结算收款。' : '查看当天已登记的就诊和接诊任务。' }}</p></div>
    <router-link v-if="id" class="el-button" to="/visits">返回接诊台</router-link>
    <router-link v-else class="el-button" to="/appointments">去预约总览登记到诊</router-link>
  </div>
  <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
  <el-alert v-if="success" :title="success" type="success" :closable="false" show-icon />
  <div v-loading="loading" class="visit-sections">
    <el-card v-if="!id" shadow="never">
      <el-date-picker v-model="day" type="date" value-format="YYYY-MM-DD" :clearable="false" aria-label="就诊日期" />
      <el-table :data="rows" empty-text="这天暂无已登记的就诊">
        <el-table-column prop="patientName" label="患者" min-width="125" />
        <el-table-column prop="clinicName" label="门诊" min-width="175" />
        <el-table-column prop="doctorName" label="接诊医生" min-width="125" />
        <el-table-column label="状态" min-width="110"><template #default="{ row }">{{ row.status ? labels[row.status as keyof typeof labels] : '待登记' }}</template></el-table-column>
        <el-table-column label="操作" width="110"><template #default="{ row }"><router-link :to="'/visits/' + row.appointmentId">打开就诊</router-link></template></el-table-column>
      </el-table>
    </el-card>
    <template v-else-if="visit">
      <el-card shadow="never">
        <template #header><strong>{{ visit.patientName }} · {{ visit.appointmentNo }}</strong></template>
        <p>{{ visit.clinicName }} · {{ time(visit.startsAt, true) }}</p>
        <p>预约医生 {{ visit.bookedDoctorName }}<template v-if="visit.doctorName"> · 实际接诊 {{ visit.doctorName }}</template></p>
        <el-tag>{{ visit.status ? labels[visit.status] : visit.appointmentStatus === 'confirmed' ? '待登记' : '预约已变更' }}</el-tag>
        <p v-if="visit.arrivedAt">签到时间 {{ time(visit.arrivedAt, true) }}</p>
        <div v-if="canRecord" class="visit-actions">
          <el-select v-model="doctorId" aria-label="实际接诊医生" placeholder="选择实际接诊医生" :disabled="busy">
            <el-option v-for="doctor in doctors" :key="doctor.id" :label="doctor.name" :value="doctor.id" />
          </el-select>
          <el-button type="primary" :disabled="busy || !doctorId || Date.now() < Date.parse(visit.attendanceAllowedAt)" @click="mark('arrived')">{{ visit.status === 'arrived' ? '更新接诊医生' : '登记到诊' }}</el-button>
          <el-button v-if="!visit.status" :disabled="busy || Date.now() < Date.parse(visit.endsAt)" @click="mark('no_show')">登记未到</el-button>
          <p v-if="!visit.status && Date.now() < Date.parse(visit.attendanceAllowedAt)">预约开始前两小时内可登记到诊，预约结束后可登记未到。</p>
          <p v-if="!doctors.length">本门诊暂无可登录的在岗医生，请联系总部设置岗位。</p>
        </div>
      </el-card>
      <el-card v-if="visit.canTreat && visit.status === 'arrived'" shadow="never">
        <template #header><strong>记录实际治疗</strong></template>
        <p>项目带入目录参考价，请按本次确认的单价调整。</p>
        <div v-for="(item, index) in items" :key="index" class="visit-item">
          <el-select v-model="item.serviceId" aria-label="治疗项目" placeholder="选择项目" :disabled="busy" @change="chooseService(index)">
            <el-option v-for="service in availableServices" :key="service.id" :label="service.name" :value="service.id" />
          </el-select>
          <el-input-number v-model="item.quantity" aria-label="数量" :min="1" :max="99" :precision="0" :disabled="busy" />
          <el-input v-model="item.price" aria-label="单价（元）" placeholder="单价（元）" inputmode="decimal" maxlength="13" :disabled="busy"><template #append>元</template></el-input>
          <el-button :disabled="busy || items.length <= 1" @click="items.splice(index, 1)">移除</el-button>
        </div>
        <div class="visit-actions"><el-button :disabled="busy || items.length >= 30" @click="items.push(nextItem())">添加项目</el-button></div>
      </el-card>
      <el-card v-if="visit.canTreat && (visit.status === 'arrived' || visit.status === 'completed' && !visit.materialsRecorded)" shadow="never">
        <template #header><strong>{{ visit.status === 'completed' ? '补记耗材用量和成本' : '耗材用量与成本' }}</strong></template>
        <el-checkbox v-if="!materials.length" v-model="noMaterials" :disabled="busy">本次未使用耗材</el-checkbox>
        <div v-for="(row,index) in materials" :key="index" class="visit-item">
          <el-input v-model="row.name" aria-label="耗材名称" placeholder="耗材名称" maxlength="100" :disabled="busy" />
          <el-input v-model="row.unit" aria-label="耗材单位" placeholder="单位（支、包、克）" maxlength="20" :disabled="busy" />
          <el-input v-model="row.quantity" aria-label="实际用量" placeholder="实际用量" inputmode="decimal" :disabled="busy" />
          <el-input v-model="row.cost" aria-label="单位成本（元）" placeholder="单位成本（元）" inputmode="decimal" :disabled="busy" />
          <el-button :disabled="busy" @click="materials.splice(index,1)">移除耗材</el-button>
        </div>
        <div class="visit-actions">
          <el-button :disabled="busy || materials.length >= 40 || noMaterials" @click="addMaterial">添加耗材</el-button>
          <el-button type="primary" :loading="busy" @click="visit.status === 'completed' ? backfillMaterials() : complete()">{{ visit.status === 'completed' ? '确认耗材' : '确认治疗与耗材' }}</el-button>
        </div>
      </el-card>
      <el-card v-if="visit.treatments.length" shadow="never">
        <template #header><strong>已确认治疗</strong></template>
        <el-table :data="visit.treatments">
          <el-table-column prop="serviceName" label="治疗项目" min-width="165" />
          <el-table-column label="数量"><template #default="{ row }">{{ row.quantity }} {{ row.unit }}</template></el-table-column>
          <el-table-column label="单价"><template #default="{ row }">{{ money(row.unitPriceCents) }}</template></el-table-column>
          <el-table-column label="金额"><template #default="{ row }">{{ money(row.quantity * row.unitPriceCents) }}</template></el-table-column>
        </el-table>
        <h3>耗材成本</h3>
        <el-table v-if="visit.materials.length" :data="visit.materials">
          <el-table-column prop="name" label="耗材" min-width="120" />
          <el-table-column label="用量"><template #default="{ row }">{{ row.quantityMilli / 1000 }} {{ row.unit }}</template></el-table-column>
          <el-table-column label="单位成本"><template #default="{ row }">{{ money(row.unitCostCents) }}</template></el-table-column>
          <el-table-column label="小计"><template #default="{ row }">{{ money(row.costCents) }}</template></el-table-column>
        </el-table>
        <p v-else>{{ visit.materialsRecorded ? '本次未使用耗材。' : '本次耗材用量待确认。' }}</p>
        <div v-if="visit.canManage && !visit.invoice" class="visit-actions">
          <el-button type="primary" :loading="busy" @click="submit('/invoice', 'POST', undefined, '结算单已生成。')">生成结算单</el-button>
        </div>
      </el-card>
      <el-card v-if="visit.invoice" shadow="never">
        <template #header><strong>结算单</strong> · {{ visit.invoice.id }}</template>
        <p>应收 {{ money(visit.invoice.totalCents) }} · 已收 {{ money(paid) }} · 未收 {{ money(balance) }}</p>
        <el-table :data="visit.invoice.payments" empty-text="暂无收款记录">
          <el-table-column label="时间" min-width="145"><template #default="{ row }">{{ time(row.receivedAt, true) }}</template></el-table-column>
          <el-table-column label="方式"><template #default="{ row }">{{ methods[row.method as VisitPaymentMethod] }}</template></el-table-column>
          <el-table-column prop="reference" label="凭证编号" min-width="120" />
          <el-table-column label="实收"><template #default="{ row }">{{ money(row.amountCents) }}</template></el-table-column>
        </el-table>
        <div v-if="pending" class="visit-actions">
          <el-alert title="有一笔收款结果待核对，请用原操作重试。" type="warning" :closable="false" />
          <el-button type="primary" :loading="busy" @click="collect">核对 {{ money(pending.amountCents) }} 收款</el-button>
        </div>
        <div v-else-if="balance > 0" class="visit-actions">
          <el-input v-model="amount" aria-label="已收到的金额（元）" placeholder="实收（元）" maxlength="13" inputmode="decimal" :disabled="busy"><template #append>元</template></el-input>
          <el-select v-model="method" aria-label="收款方式" :disabled="busy"><el-option v-for="(label, key) in methods" :key="key" :label="label" :value="key" /></el-select>
          <el-input v-model="reference" aria-label="凭证编号" placeholder="凭证编号（非现金必填）" maxlength="100" :disabled="busy" />
          <el-button type="primary" :loading="busy" @click="collect">登记收款</el-button>
        </div>
      </el-card>
    </template>
  </div>
</template>

<style scoped>
.visit-sections { display: grid; gap: 16px; min-height: 80px; margin-top: 16px; }
.visit-actions, .visit-item { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 12px; }
.visit-item :deep(.el-input), .visit-actions :deep(.el-input), .visit-actions :deep(.el-select), .visit-item :deep(.el-select) { width: min(215px, 100%); }
.visit-item :deep(.el-input-number .el-input) { width: 100%; }
.visit-actions :deep(.el-button + .el-button) { margin-left: 0; }
</style>
