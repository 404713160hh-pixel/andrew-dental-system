<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import type { Principal } from '@andrew/shared';
import { api,errorText } from '../api';
import { useAuth } from '../stores/auth';
const auth=useAuth(),router=useRouter();
const currentPassword=ref(''),newPassword=ref(''),confirm=ref(''),busy=ref(false),error=ref('');
async function save(){
 error.value='';
 if(newPassword.value.length<12||newPassword.value!==confirm.value){error.value='新密码至少 12 位，两次输入必须一致。';return;}
 busy.value=true;
 try{
  await api('/auth/change-password',{method:'POST',body:{currentPassword:currentPassword.value,newPassword:newPassword.value}});
  currentPassword.value='';newPassword.value='';confirm.value='';auth.user=await api<Principal>('/me');
  ElMessage.success('密码已更新。');await router.replace('/appointments');
 }catch(e){error.value=errorText(e);}finally{busy.value=false;}
}
</script>
<template>
 <section class="page-content" style="max-width:520px">
  <h1>修改密码</h1><p class="muted">{{ auth.user?.mustChangePassword?'首次登录或密码重置后，请先设置自己的新密码。':'定期更换密码，保护工作账号。' }}</p>
  <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
  <el-form label-position="top" @submit.prevent="save">
   <el-form-item label="当前密码"><el-input v-model="currentPassword" type="password" show-password autocomplete="current-password" /></el-form-item>
   <el-form-item label="新密码"><el-input v-model="newPassword" type="password" show-password autocomplete="new-password" /></el-form-item>
   <el-form-item label="再次输入新密码"><el-input v-model="confirm" type="password" show-password autocomplete="new-password" /></el-form-item>
   <el-button type="primary" native-type="submit" :loading="busy">更新密码</el-button>
  </el-form>
 </section>
</template>
