<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Search, Clock, Location, User, ArrowRight, Refresh } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import type { Appointment, BookingPolicy, BookingSlot, Hold, Page, Patient, PatientCandidate } from '@andrew/shared';
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
import { useCatalog } from '../stores/catalog';
import { useBooking } from '../stores/booking';
import { calendarDate, money, time, today } from '../utils';
import PatientEditor from '../components/PatientEditor.vue';
const route = useRoute();
const router = useRouter();
const catalog = useCatalog();
const booking = useBooking();
const original = ref<Appointment | null>(null);
const q = ref('');
const patients = ref<PatientCandidate[]>([]);
const patientSearchBusy = ref(false);
const patientTotal = ref(0);
const patientPage = ref(1);
const createDialog = ref(false);
const clinicId = ref('');
const serviceId = ref('');
const doctorId = ref('');
const date = ref(today());
const slots = ref<BookingSlot[]>([]);
const searched = ref(false);
const loading = ref(false);
const holding = ref(false);
const busy = ref(false);
const error = ref('');
const hold = ref<Hold | null>(null);
const policy = ref<BookingPolicy | null>(null);
const confirmed = ref(false);
const accepted = ref(false);
const reason = ref('');
const pending = ref<PendingCommand | null>(readPending());
const clock = ref(Date.now());
const isReschedule = computed(() => !!route.query.appointmentId);
const patientId = computed(() => original.value?.patientId || booking.patient?.id || '');
const patientName = computed(() => original.value?.patientName || booking.patient?.name || '');
const availableServices = computed(() =>
  catalog.services.filter(
    (item) => item.active && (!clinicId.value || item.clinicIds.includes(clinicId.value)),
  ),
);
const availableDoctors = computed(() => catalog.doctors.filter((item) => item.active));
const secondsLeft = computed(() =>
  hold.value
    ? Math.max(0, Math.ceil((new Date(hold.value.expiresAt).getTime() - clock.value) / 1000))
    : 0,
);
const canConfirm = computed(
  () =>
    !!hold.value &&
    secondsLeft.value > 0 &&
    confirmed.value &&
    accepted.value &&
    (!isReschedule.value || reason.value.trim().length >= 2) &&
    !pending.value &&
    !holding.value &&
    !loading.value &&
    !busy.value,
);
const timer = window.setInterval(() => {
  clock.value = Date.now();
}, 1000);
onUnmounted(() => window.clearInterval(timer));
function resetSlots() {
  slots.value = [];
  searched.value = false;
  hold.value = null;
  confirmed.value = false;
  accepted.value = false;
}
watch([clinicId, serviceId, doctorId, date], resetSlots);
watch(clinicId, () => {
  if (!availableServices.value.some((item) => item.id === serviceId.value)) serviceId.value = '';
});
watch(serviceId, () => {
  doctorId.value = '';
});
watch(patientId, () => {
  hold.value = null;
  confirmed.value = false;
  accepted.value = false;
});
async function searchPatients(reset = true) {
  if (reset) patientPage.value = 1;
  if (q.value.trim().length < 2) {
    error.value = '请输入至少两个字的姓名或联系电话核对患者。';
    return;
  }
  patientSearchBusy.value = true;
  error.value = '';
  try {
    const result = await api<Page<PatientCandidate>>(
      `/staff/patients${query({ q: q.value.trim(), page: patientPage.value, pageSize: 8 })}`,
    );
    patients.value = result.items;
    patientTotal.value = result.total;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    patientSearchBusy.value = false;
  }
}
function choosePatient(patient: PatientCandidate) {
  booking.patient = patient;
  patients.value = [];
  q.value = '';
}
function patientCreated(patient: Patient) {
  choosePatient({id:patient.id,name:patient.name,phone:patient.phone.length>7?patient.phone.slice(0,3)+'****'+patient.phone.slice(-4):'***',birthYear:patient.birthDate.slice(0,4),hasAccount:false,isDemo:patient.isDemo});
}
async function searchSlots() {
  error.value = '';
  hold.value = null;
  confirmed.value = false;
  accepted.value = false;
  if (!patientId.value || !clinicId.value || !serviceId.value || !date.value) {
    error.value = '请先选择患者、门诊、预约服务和日期。';
    return;
  }
  loading.value = true;
  try {
    slots.value = await api<BookingSlot[]>(
      `/booking-slots${query({ clinicId: clinicId.value, serviceId: serviceId.value, date: date.value, doctorId: doctorId.value })}`,
    );
    searched.value = true;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
async function chooseSlot(slot: BookingSlot) {
  if (busy.value || holding.value) return;
  if (pending.value) {
    error.value = '请先查询上一笔操作结果。';
    return;
  }
  holding.value = true;
  error.value = '';
  try {
    hold.value = await api<Hold>('/booking-holds', {
      method: 'POST',
      body: {
        clinicId: slot.clinicId,
        serviceId: slot.serviceId,
        doctorId: slot.doctorId,
        chairId: slot.chairId,
        shiftId: slot.shiftId,
        startsAt: slot.startsAt,
        patientId: patientId.value,
      },
    });
    clock.value = Date.now();
    confirmed.value = false;
    accepted.value = false;
  } catch (e) {
    error.value = errorText(e);
    if (e instanceof ApiError && e.status === 409) await searchSlots();
  } finally {
    holding.value = false;
  }
}
async function complete(result: Appointment) {
  booking.patient = null;
  pending.value = null;
  ElMessage.success(
    isReschedule.value ? '改期成功，原预约已标记为已改期。' : `预约已确认：${result.appointmentNo}`,
  );
  await router.push('/appointments');
}
async function confirm() {
  if (busy.value || !canConfirm.value || !hold.value) return;
  error.value = '';
  busy.value = true;
  const command: PendingCommand = {
    key: crypto.randomUUID(),
    path: original.value ? `/appointments/${original.value.id}/changes` : '/appointments/confirm',
    body: original.value
      ? {
          intent: 'reschedule',
          expectedVersion: original.value.rowVersion,
          reason: reason.value.trim(),
          holdId: hold.value.id,
          holdVersion: hold.value.rowVersion,
        }
      : {
          holdId: hold.value.id,
          holdVersion: hold.value.rowVersion,
          patientId: patientId.value,
          patientConfirmed: true,
          rulesAccepted: true,
        },
    createdAt: new Date().toISOString(),
  };
  try {
    await complete(await submitCommand(command));
  } catch (e) {
    error.value = errorText(e);
    pending.value = readPending();
    if (e instanceof ApiError && !e.uncertain && e.status === 409) {
      hold.value = null;
      confirmed.value = false;
      accepted.value = false;
    }
  } finally {
    busy.value = false;
  }
}
async function checkPending(retry = false) {
  if (!pending.value) return;
  busy.value = true;
  error.value = '';
  try {
    const result = retry ? await submitCommand(pending.value) : await resolvePending(pending.value);
    if (result) await complete(result);
    else error.value = '尚未查询到此操作。请稍后再查询，或使用原操作编号重试。';
  } catch (e) {
    error.value = errorText(e);
    pending.value = readPending();
  } finally {
    busy.value = false;
  }
}
onMounted(async () => {
  try {
    if (!catalog.loaded) await catalog.load();
    policy.value = await api<BookingPolicy>('/booking-policy');
    if (typeof route.query.appointmentId === 'string') {
      original.value = await api<Appointment>(
        `/appointments/${encodeURIComponent(route.query.appointmentId)}`,
      );
      if (original.value.status !== 'confirmed') {
        error.value = '该预约已发生变更，请返回预约清单刷新。';
        return;
      }
      clinicId.value = original.value.clinicId;
      serviceId.value = original.value.serviceId;
      date.value = calendarDate(original.value.startsAt);
    } else if (
      typeof route.query.patientId === 'string' &&
      booking.patient?.id !== route.query.patientId
    ) {
      booking.patient = null;
      error.value = '请重新查询并核对预约患者。';
    }
  } catch (e) {
    error.value = errorText(e);
  }
});
</script>
<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">BOOK AN APPOINTMENT</div>
      <h1>{{ isReschedule ? '为患者改期' : '患者代约' }}</h1>
      <p>
        {{
          isReschedule
            ? '新预约确认成功后才释放原预约；选时段不会取消原预约。'
            : '核对患者，选择合适资源，再确认预约。'
        }}
      </p>
    </div>
    <el-button @click="router.push('/appointments')">返回预约清单</el-button>
  </section>
  <el-alert
    v-if="error"
    :title="error"
    type="error"
    show-icon
    :closable="false"
    class="mb-24"
  /><el-alert
    v-if="pending"
    title="有一笔提交结果待确认。请查询后继续，避免重复预约。"
    type="warning"
    :closable="false"
    show-icon
    class="mb-24"
    ><template #default
      ><el-button size="small" :loading="busy" @click="checkPending()">查询操作结果</el-button
      ><el-button size="small" :loading="busy" @click="checkPending(true)"
        >使用原编号重试</el-button
      ></template
    ></el-alert
  >
  <div class="booking-layout">
    <div class="booking-main">
      <section class="panel">
        <div class="panel-heading">
          <div class="step-heading">
            <span class="step-number">01</span>
            <div>
              <h2>核对患者</h2>
              <p>确认患者姓名及联系方式；诊疗风险由医务人员另行核实。</p>
            </div>
          </div>
          <el-button v-if="!isReschedule" @click="createDialog = true">建立新档案</el-button>
        </div>
        <div class="panel-body">
          <div v-if="patientId" class="selected-patient">
            <span class="patient-avatar">{{ patientName.slice(-1) }}</span>
            <div>
              <h3>{{ patientName }}</h3>
              <p v-if="!original">
                {{ booking.patient?.phone }} · {{ booking.patient?.birthYear }} 年出生
              </p>
              <p v-else>
                原预约：{{ original.appointmentNo }} · {{ time(original.startsAt, true) }}
              </p>
            </div>
            <el-button v-if="!isReschedule" text type="primary" @click="booking.patient = null"
              >更换患者</el-button
            >
          </div>
          <template v-else-if="!isReschedule"
            ><el-form inline @submit.prevent="searchPatients()" class="patient-search"
              ><el-form-item
                ><el-input
                  v-model="q"
                  :prefix-icon="Search"
                  placeholder="输入姓名或联系电话"
                  clearable
                  style="width: 280px" /></el-form-item
              ><el-button type="primary" native-type="submit" :loading="patientSearchBusy"
                >查找患者</el-button
              ></el-form
            >
            <div v-loading="patientSearchBusy">
              <button
                v-for="patient in patients"
                :key="patient.id"
                class="patient-result"
                @click="choosePatient(patient)"
              >
                <span
                  ><strong>{{ patient.name }}</strong
                  ><small>{{ patient.phone }} · {{ patient.birthYear }} 年出生</small></span
                ><el-icon><ArrowRight /></el-icon></button
              ><el-pagination
                v-if="patientTotal > 8"
                v-model:current-page="patientPage"
                :page-size="8"
                :total="patientTotal"
                layout="prev,pager,next"
                @current-change="searchPatients(false)"
              />
              <p v-if="!patients.length" class="muted small">
                请先检索现有档案，核对无重复后再建立新档案。
              </p>
            </div></template
          ><el-alert
            v-else
            title="正在核对原预约信息，若加载失败请返回预约清单。"
            type="info"
            :closable="false"
          />
        </div>
      </section>
      <section class="panel mt-24">
        <div class="panel-heading">
          <div class="step-heading">
            <span class="step-number">02</span>
            <div>
              <h2>选择预约资源</h2>
              <p>可预约时段根据实时班次和占用情况生成。</p>
            </div>
          </div>
        </div>
        <div class="panel-body">
          <el-form label-position="top" @submit.prevent="searchSlots"
            ><div class="form-grid">
              <el-form-item label="就诊门诊" required
                ><el-select v-model="clinicId" placeholder="请选择门诊"
                  ><el-option
                    v-for="clinic in catalog.clinics.filter((item) => item.active)"
                    :key="clinic.id"
                    :value="clinic.id"
                    :label="clinic.name" /></el-select></el-form-item
              ><el-form-item label="预约服务" required
                ><el-select v-model="serviceId" placeholder="请选择服务" :disabled="!clinicId"
                  ><el-option
                    v-for="service in availableServices"
                    :key="service.id"
                    :value="service.id"
                    :label="`${service.name} · ${service.durationMinutes} 分钟`" /></el-select></el-form-item
              ><el-form-item label="就诊日期" required
                ><el-date-picker
                  v-model="date"
                  type="date"
                  value-format="YYYY-MM-DD"
                  :clearable="false"
                  class="full-width"
                  :disabled-date="
                    (value: Date) =>
                      value.getTime() < new Date(`${today()}T00:00:00+08:00`).getTime()
                  " /></el-form-item
              ><el-form-item label="偏好医生（可选）"
                ><el-select
                  v-model="doctorId"
                  clearable
                  placeholder="不限定医生，查询时校验资格"
                  :disabled="!serviceId"
                  ><el-option
                    v-for="doctor in availableDoctors"
                    :key="doctor.id"
                    :value="doctor.id"
                    :label="`${doctor.name} · ${doctor.specialty}`" /></el-select
              ></el-form-item>
            </div>
            <el-button
              type="primary"
              native-type="submit"
              :icon="Search"
              :loading="loading"
              :disabled="!patientId || !!pending || holding || busy"
              >查询可预约时段</el-button
            ></el-form
          >
          <div v-if="searched" class="slot-section">
            <div class="slot-section-heading">
              <h3>
                可预约时段 <span>{{ slots.length }}</span>
              </h3>
              <el-button text :icon="Refresh" @click="searchSlots" :disabled="holding"
                >刷新</el-button
              >
            </div>
            <div class="slot-grid" v-loading="holding">
              <button
                v-for="slot in slots"
                :key="`${slot.doctorId}-${slot.chairId}-${slot.startsAt}`"
                class="slot-button"
                :class="{
                  'is-selected':
                    hold?.slot.startsAt === slot.startsAt &&
                    hold.slot.doctorId === slot.doctorId &&
                    hold.slot.chairId === slot.chairId,
                }"
                :disabled="holding || busy || !!pending"
                @click="chooseSlot(slot)"
              >
                <strong>{{ time(slot.startsAt) }} — {{ time(slot.endsAt) }}</strong
                ><span>{{ slot.doctorName }}</span
                ><small>{{ slot.durationMinutes }} 分钟 · {{ money(slot.priceCents) }}</small>
              </button>
            </div>
            <el-empty
              v-if="!slots.length"
              description="暂无符合条件的时段，请更换日期、医生或门诊。"
              :image-size="100"
            />
          </div>
        </div>
      </section>
    </div>
    <aside class="booking-summary panel">
      <div class="panel-heading">
        <h2>预约确认</h2>
        <span class="summary-status" :class="{ ready: hold && secondsLeft > 0 && !pending }">{{
          pending ? '结果待确认' : hold && secondsLeft > 0 ? '时段已暂存' : '待选择时段'
        }}</span>
      </div>
      <div class="panel-body">
        <div class="summary-patient">
          <el-icon><User /></el-icon>{{ patientName || '尚未选择患者' }}
        </div>
        <template v-if="hold"
          ><div class="countdown" :class="{ expired: secondsLeft === 0 }">
            <el-icon><Clock /></el-icon
            ><span>{{
              pending
                ? '原操作编号已保存，请先核对提交结果'
                : secondsLeft > 0
                  ? `时段保留 ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`
                  : '时段保留已过期，请重新选择'
            }}</span>
          </div>
          <div class="summary-service">
            <h3>{{ hold.slot.serviceName }}</h3>
            <strong>{{ money(hold.slot.priceCents) }}<small>参考价</small></strong>
          </div>
          <ul class="summary-facts">
            <li>
              <el-icon><Location /></el-icon><span>{{ hold.slot.clinicName }}</span>
            </li>
            <li>
              <el-icon><User /></el-icon><span>{{ hold.slot.doctorName }}</span>
            </li>
            <li>
              <el-icon><Clock /></el-icon
              ><span
                >{{ time(hold.slot.startsAt, true) }} — {{ time(hold.slot.endsAt)
                }}<small
                  >服务 {{ hold.slot.durationMinutes }} 分钟 / 缓冲
                  {{ hold.slot.bufferMinutes }} 分钟</small
                ></span
              >
            </li>
          </ul>
          <el-input
            v-if="isReschedule"
            v-model="reason"
            type="textarea"
            :rows="2"
            maxlength="240"
            show-word-limit
            placeholder="请填写改期原因（至少 2 字）"
            class="mb-16"
          />
          <div class="confirmation-checks">
            <el-checkbox v-model="confirmed">已向患者核对门诊、医生和时段</el-checkbox
            ><el-checkbox v-model="accepted">患者已知晓并接受预约规则</el-checkbox>
          </div>
          <p class="muted small">
            取消或改期须至少提前
            {{ hold.policy.cancellationNoticeMinutes }}
            分钟。此处为预约确认，服务价格不代替临床方案报价。
          </p>
          <el-button
            type="primary"
            class="full-width mt-16"
            size="large"
            :loading="busy"
            :disabled="!canConfirm"
            @click="confirm"
            >{{ isReschedule ? '确认改期' : '确认预约' }}</el-button
          ></template
        >
        <div v-else class="empty-summary">
          <div class="empty-calendar">
            <el-icon><Clock /></el-icon>
          </div>
          <p>选定患者与时段后，<br />在这里完成最终确认。</p>
          <p v-if="policy" class="small">
            暂存时长 {{ policy.holdSeconds }} 秒<br />取消提前量
            {{ policy.cancellationNoticeMinutes }} 分钟
          </p>
        </div>
      </div>
    </aside>
  </div>
  <PatientEditor v-model="createDialog" @created="patientCreated" />
</template>
