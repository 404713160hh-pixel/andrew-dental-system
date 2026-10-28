<script setup lang="ts">
import { ref } from 'vue';
import { ElMessageBox } from 'element-plus';
import { api, errorText } from '../api';
const props=defineProps<{patientId:string;patientName:string;linked?:boolean}>();
const busy=ref(false),visible=ref(false),code=ref(''),expiresAt=ref(''),error=ref('');
async function issue(){
 if(busy.value||props.linked)return;
 try { await ElMessageBox.confirm('请先当面核对就诊人身份及出生日期，再将一次性凭证交给本人或其合法监护人。凭证十分钟内有效，请勿通过公共渠道传播。','核对患者身份',{type:'warning',confirmButtonText:'已核对，生成凭证',cancelButtonText:'取消'}); }
 catch { return; }
 busy.value=true;error.value='';code.value='';
 try {
  const result=await api<{code:string;expiresAt:string}>(`/staff/patients/${props.patientId}/invitations`,{method:'POST',body:{identityVerified:true}});
  code.value=result.code;expiresAt.value=result.expiresAt;visible.value=true;
 } catch(e) { error.value=errorText(e);visible.value=true; }
 finally {busy.value=false;}
}
function clear(){code.value='';expiresAt.value='';error.value='';}
</script>
<template>
 <el-button text type="primary" :loading="busy" :disabled="linked" @click="issue">关联账号</el-button>
 <el-dialog v-model="visible" title="患者账号关联" width="min(500px, 94vw)" @closed="clear">
  <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
  <template v-else>
   <p>请将以下一次性凭证当面交给 {{ patientName }} 本人或合法监护人，用于在小程序注册并关联已有档案。</p>
   <p><strong style="font-size:1.2em;word-break:break-all">{{ code }}</strong></p>
   <p class="muted small">有效期至 {{ new Date(expiresAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}) }}。关闭后不再显示；如需重新办理，请重新核验并生成。</p>
  </template>
  <template #footer><el-button @click="visible=false">关闭</el-button></template>
 </el-dialog>
</template>
