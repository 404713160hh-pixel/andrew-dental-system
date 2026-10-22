<script setup lang="ts">
import { reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { Patient, PatientInput } from '@andrew/shared';
import { api, errorText } from '../api';
const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; created: [patient: Patient] }>();
const empty = (): PatientInput => ({
  name: '',
  birthDate: '',
  phone: '',
  email: null,
  billingAddress: '',
  emergencyName: '',
  emergencyPhone: '',
  allergyStatus: 'unknown',
  allergies: [],
});
const form = reactive<PatientInput>(empty());
const allergyText = ref('');
const busy = ref(false);
const error = ref('');
function reset() {
  Object.assign(form, empty());
  allergyText.value = '';
  error.value = '';
}
async function save() {
  if (busy.value) return;
  error.value = '';
  if (
    !form.name.trim() ||
    !form.birthDate ||
    !form.phone.trim() ||
    !form.billingAddress.trim() ||
    !form.emergencyName.trim() ||
    !form.emergencyPhone.trim()
  ) {
    error.value = '请填写姓名、出生日期、电话、账单地址和紧急联系人。';
    return;
  }
  const allergies =
    form.allergyStatus === 'known'
      ? allergyText.value
          .split(/[,，\n]/)
          .map((item) => item.trim())
          .filter(Boolean)
      : [];
  if (form.allergyStatus === 'known' && !allergies.length) {
    error.value = '请选择已知过敏原，或将过敏状态改为待核实。';
    return;
  }
  busy.value = true;
  try {
    const patient = await api<Patient>('/staff/patients', {
      method: 'POST',
      body: {
        ...form,
        name: form.name.trim(),
        phone: form.phone.trim(),
        billingAddress: form.billingAddress.trim(),
        emergencyName: form.emergencyName.trim(),
        emergencyPhone: form.emergencyPhone.trim(),
        email: form.email?.trim() || null,
        allergies,
      },
    });
    ElMessage.success('患者档案已建立。');
    emit('created', patient);
    emit('update:modelValue', false);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <el-dialog
    :model-value="props.modelValue"
    title="建立患者档案"
    width="620px"
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)"
    @open="reset"
    ><p class="muted small">
      请先核对已有档案，避免重复建档。此操作只建立患者档案，不创建登录账号。
    </p>
    <el-alert
      v-if="error"
      :title="error"
      type="error"
      show-icon
      :closable="false"
      class="mb-24"
    /><el-form label-position="top" @submit.prevent="save"
      ><div class="form-grid">
        <el-form-item label="患者姓名" required
          ><el-input v-model="form.name" maxlength="80" /></el-form-item
        ><el-form-item label="出生日期" required
          ><el-date-picker
            v-model="form.birthDate"
            type="date"
            value-format="YYYY-MM-DD"
            :disabled-date="(date: Date) => date.getTime() > Date.now()"
            class="full-width" /></el-form-item
        ><el-form-item label="联系电话" required
          ><el-input v-model="form.phone" maxlength="32" /></el-form-item
        ><el-form-item label="电子邮件（选填）"
          ><el-input v-model="form.email" type="email" maxlength="180" /></el-form-item
        ><el-form-item label="账单地址" required class="span-two"
          ><el-input v-model="form.billingAddress" maxlength="240" /></el-form-item
        ><el-form-item label="紧急联系人" required
          ><el-input v-model="form.emergencyName" maxlength="80" /></el-form-item
        ><el-form-item label="紧急联系电话" required
          ><el-input v-model="form.emergencyPhone" maxlength="32" /></el-form-item
        ><el-form-item label="过敏史状态" required class="span-two"
          ><el-radio-group v-model="form.allergyStatus"
            ><el-radio value="unknown">待核实</el-radio
            ><el-radio value="none_reported">未报告过敏</el-radio
            ><el-radio value="known">已知过敏</el-radio></el-radio-group
          ></el-form-item
        ><el-form-item
          v-if="form.allergyStatus === 'known'"
          label="过敏原（逗号或换行分隔）"
          class="span-two"
          required
          ><el-input v-model="allergyText" type="textarea" :rows="2" maxlength="500"
        /></el-form-item></div></el-form
    ><template #footer
      ><el-button :disabled="busy" @click="emit('update:modelValue', false)">返回</el-button
      ><el-button type="primary" :loading="busy" @click="save">核对并建档</el-button></template
    ></el-dialog
  >
</template>
