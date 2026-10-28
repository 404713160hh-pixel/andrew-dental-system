<script setup lang="ts">
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { Doctor } from '@andrew/shared';
import { api,errorText } from '../api';
const props=defineProps<{doctor:Doctor}>();
const emit=defineEmits<{saved:[]}>();
const visible=ref(false),busy=ref(false),error=ref(''),bio=ref(''),focus=ref(''),expectedVersion=ref(0);
function open(){
 bio.value=props.doctor.bio||'';focus.value=(props.doctor.focusAreas||[]).join('\n');
 expectedVersion.value=props.doctor.rowVersion;error.value='';visible.value=true;
}
async function save(){
 if(busy.value)return;
 const areas=focus.value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 if(new Set(areas).size!==areas.length){error.value='擅长方向不能重复。';return;}
 busy.value=true;error.value='';
 try {
  await api(`/staff/doctors/${props.doctor.id}/profile`,{method:'PUT',body:{expectedVersion:expectedVersion.value,bio:bio.value.trim(),focusAreas:areas}});
  visible.value=false;ElMessage.success('公开资料已保存。');emit('saved');
 }catch(e){error.value=errorText(e);}
 finally{busy.value=false;}
}
</script>
<template>
 <el-button text type="primary" @click="open">公开资料</el-button>
 <el-dialog v-model="visible" :title="`${doctor.name} · 医生公开资料`" width="min(620px, 94vw)" :close-on-click-modal="false">
  <p class="muted small">这些内容会展示给患者；请由机构核对医生资料后填写。每行填写一个擅长方向。</p>
  <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
  <el-form label-position="top" @submit.prevent="save">
   <el-form-item label="医生简介"><el-input v-model="bio" type="textarea" :rows="4" maxlength="2000" show-word-limit /></el-form-item>
   <el-form-item label="擅长方向"><el-input v-model="focus" type="textarea" :rows="4" placeholder="每行一项" maxlength="1600" /></el-form-item>
   <div style="text-align:right"><el-button @click="visible=false">取消</el-button><el-button type="primary" native-type="submit" :loading="busy">保存</el-button></div>
  </el-form>
 </el-dialog>
</template>
