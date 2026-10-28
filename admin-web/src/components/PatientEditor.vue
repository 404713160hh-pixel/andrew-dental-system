<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { Patient, PatientInput } from '@andrew/shared';
import { api, errorText } from '../api';
import { useAuth } from '../stores/auth';
import { useCatalog } from '../stores/catalog';
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
const auth=useAuth(),catalog=useCatalog();
const clinicId=ref(''),notice=ref<{policyVersion:string;controller:string;contact:string;retention:string}|null>(null);
const noticeAccepted=ref(false),sensitiveAccepted=ref(false),guardianAccepted=ref(false),guardianName=ref(''),guardianRelationship=ref('');
const allowedClinics=computed(()=>catalog.clinics.filter(c=>c.active&&(auth.isHq||auth.clinicIds.has(c.id))));
const minor=computed(()=>{if(!form.birthDate)return false;const today=new Date(),birth=new Date(form.birthDate+'T00:00:00');const limit=new Date(birth);limit.setFullYear(limit.getFullYear()+14);return today<limit;});
function reset() {
  Object.assign(form, empty());
  allergyText.value = '';
  error.value = '';
  clinicId.value=allowedClinics.value.length===1?allowedClinics.value[0]!.id:'';
  noticeAccepted.value=false;sensitiveAccepted.value=false;guardianAccepted.value=false;guardianName.value='';guardianRelationship.value='';notice.value=null;
  void api<{policyVersion:string;controller:string;contact:string;retention:string}>('/privacy/notice').then(v=>notice.value=v).catch(e=>error.value=errorText(e));
}
async function save() {
  if (busy.value) return;
  error.value = '';
  if(!clinicId.value||!notice.value||!noticeAccepted.value||!sensitiveAccepted.value){error.value='请选择建档门诊，并在当面说明隐私告知及过敏信息处理后记录本人同意。';return;}
  if(minor.value&&(!guardianAccepted.value||!guardianName.value.trim()||!guardianRelationship.value.trim())){error.value='未满14周岁须由父母或其他监护人同意，并填写监护人信息。';return;}
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
        clinicId:clinicId.value,
        consent:{policyVersion:notice.value.policyVersion,noticeAccepted:true,sensitiveAccepted:true,guardian:minor.value?{name:guardianName.value.trim(),relationship:guardianRelationship.value.trim(),accepted:true}:null},
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
      ><div class="form-grid"><el-form-item label="建档门诊" required class="span-two"><el-select v-model="clinicId" placeholder="请选择患者建档门诊"><el-option v-for="clinic in allowedClinics" :key="clinic.id" :value="clinic.id" :label="clinic.name" /></el-select></el-form-item>
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
        /></el-form-item></div>
      <div v-if="notice" class="muted small"><p>信息处理方：{{ notice.controller }}；联系方式：{{ notice.contact }}。为预约及就诊协调处理姓名、联系方式、出生日期、地址和紧急联系人；过敏信息用于诊疗风险核对，仅授权人员依职责访问。保存期限：{{ notice.retention }}。患者可联系处理方咨询、更正、撤回同意或申请删除；依法应保存的信息按规定处理。</p><el-checkbox v-model="noticeAccepted">已向患者说明上述告知，患者同意处理预约信息</el-checkbox><el-checkbox v-model="sensitiveAccepted">患者单独同意处理过敏等健康信息</el-checkbox><template v-if="minor"><p>患者未满14周岁，请由父母或其他监护人确认，以下为当面登记的自述信息。</p><el-input v-model="guardianName" placeholder="监护人姓名" /><el-input v-model="guardianRelationship" placeholder="与患者的关系" /><el-checkbox v-model="guardianAccepted">监护人已同意处理患者个人信息</el-checkbox></template></div>
    </el-form
    ><template #footer
      ><el-button :disabled="busy" @click="emit('update:modelValue', false)">返回</el-button
      ><el-button type="primary" :loading="busy" @click="save">核对并建档</el-button></template
    ></el-dialog
  >
</template>
