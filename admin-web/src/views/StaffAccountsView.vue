<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { Assignment, Clinic, Doctor, Page } from '@andrew/shared';
import { api, errorText, query } from '../api';

interface Account { id:string; username:string; displayName:string; active:boolean; accountVersion:number; mustChangePassword:boolean; staffId:string|null; assignments:Assignment[] }
const roles: {value:Assignment['role'];label:string}[] = [
  {value:'hq',label:'总部'}, {value:'manager',label:'店长'}, {value:'front',label:'前台'}, {value:'doctor',label:'医生'},
];
const rows=ref<Account[]>([]), clinics=ref<Clinic[]>([]), doctors=ref<Doctor[]>([]);
const total=ref(0),page=ref(1),loading=ref(false),busy=ref(false),error=ref('');
const dialog=ref(false), resetDialog=ref(false), editing=ref<Account|null>(null), resetting=ref<Account|null>(null);
const form=ref<{username:string;displayName:string;temporaryPassword:string;staffId:string|null;active:boolean;assignments:Assignment[]}>({
  username:'',displayName:'',temporaryPassword:'',staffId:null,active:true,assignments:[{role:'front',clinicId:null}],
});
const resetPassword=ref('');
function labelAssignment(a:Assignment){return `${roles.find(r=>r.value===a.role)?.label || a.role}${a.clinicId ? ' · '+(clinics.value.find(c=>c.id===a.clinicId)?.name || '已停用门诊') : ''}`;}
async function load(){
 loading.value=true;error.value='';
 try{
  const result=await api<Page<Account>>('/staff/accounts'+query({page:page.value,pageSize:30}));
  rows.value=result.items;total.value=result.total;
 }catch(e){rows.value=[];error.value=errorText(e);}
 finally{loading.value=false;}
}
async function loadResources(){
 try{[clinics.value,doctors.value]=await Promise.all([api<Clinic[]>('/clinics?includeInactive=true'),api<Doctor[]>('/doctors?includeInactive=true')]);}
 catch(e){error.value=errorText(e);}
}
function openCreate(){
 editing.value=null;form.value={username:'',displayName:'',temporaryPassword:'',staffId:null,active:true,assignments:[{role:'front',clinicId:null}]};dialog.value=true;
}
function openEdit(row:Account){
 editing.value=row;form.value={username:row.username,displayName:row.displayName,temporaryPassword:'',staffId:row.staffId,active:row.active,assignments:row.assignments.map(a=>({...a}))};dialog.value=true;
}
function roleChanged(a:Assignment){if(a.role==='hq')a.clinicId=null;}
async function save(){
 if(!form.value.displayName.trim()||!form.value.assignments.length){ElMessage.error('请填写姓名并分配至少一个岗位。');return;}
 if(form.value.assignments.some(a=>a.role!=='hq'&&!a.clinicId)){ElMessage.error('请为每个非总部岗位选择门诊。');return;}
 if(form.value.assignments.some(a=>a.role==='doctor')&&!form.value.staffId){ElMessage.error('医生岗位必须关联医生档案。');return;}
 if(!editing.value && (!form.value.username.trim() || form.value.temporaryPassword.length<12)){ElMessage.error('请填写用户名和至少 12 位初始密码。');return;}
 if(editing.value && editing.value.active && !form.value.active){
  try{await ElMessageBox.confirm('停用后账号的现有会话将立即失效。医生离职时还需处理其未来预约、排班和医生档案。','停用账号',{type:'warning',confirmButtonText:'确认停用',cancelButtonText:'返回'});}catch{return;}
 }
 busy.value=true;
 try{
  const common={displayName:form.value.displayName.trim(),staffId:form.value.staffId,assignments:form.value.assignments};
  if(editing.value)await api(`/staff/accounts/${editing.value.id}`,{method:'PUT',body:{...common,active:form.value.active,expectedVersion:editing.value.accountVersion}});
  else await api('/staff/accounts',{method:'POST',body:{...common,username:form.value.username.trim(),temporaryPassword:form.value.temporaryPassword}});
  form.value.temporaryPassword='';dialog.value=false;ElMessage.success('账号已保存，岗位调整会使旧会话失效。');await load();
 }catch(e){ElMessage.error(errorText(e));}finally{busy.value=false;}
}
function openReset(row:Account){resetting.value=row;resetPassword.value='';resetDialog.value=true;}
async function reset(){
 if(!resetting.value||resetPassword.value.length<12){ElMessage.error('请输入至少 12 位临时密码。');return;}
 busy.value=true;
 try{await api(`/staff/accounts/${resetting.value.id}/reset-password`,{method:'POST',body:{temporaryPassword:resetPassword.value,expectedVersion:resetting.value.accountVersion}});
  resetPassword.value='';resetDialog.value=false;ElMessage.success('密码已重置，原会话失效；员工登录后须修改密码。');await load();
 }catch(e){ElMessage.error(errorText(e));}finally{busy.value=false;}
}
onMounted(async()=>{await Promise.all([load(),loadResources()]);});
</script>
<template>
 <section class="page-content">
  <div class="page-heading"><div><h1>员工账号与岗位</h1><p class="muted">总部统一管理账号、门诊授权和密码重置。</p></div><el-button type="primary" @click="openCreate">新建账号</el-button></div>
  <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" /><el-button v-if="error" @click="load();loadResources()">重新加载</el-button>
  <el-table :data="rows" v-loading="loading" empty-text="暂无员工账号" style="width:100%">
   <el-table-column prop="username" label="用户名" min-width="130" /><el-table-column prop="displayName" label="姓名" min-width="110" />
   <el-table-column label="岗位和范围" min-width="240"><template #default="scope"><div v-for="a in scope.row.assignments" :key="a.role+':'+a.clinicId">{{ labelAssignment(a) }}</div></template></el-table-column>
   <el-table-column label="状态" min-width="110"><template #default="scope"><el-tag :type="scope.row.active?'success':'info'">{{ scope.row.active?'启用':'停用' }}</el-tag><div v-if="scope.row.mustChangePassword" class="muted small">等待修改密码</div></template></el-table-column>
   <el-table-column label="操作" min-width="150"><template #default="scope"><el-button link type="primary" @click="openEdit(scope.row)">管理</el-button><el-button link type="primary" @click="openReset(scope.row)">重置密码</el-button></template></el-table-column>
  </el-table>
  <el-pagination v-if="total>30" class="mt-12" layout="prev, pager, next, total" :total="total" :page-size="30" v-model:current-page="page" @current-change="load" />
  <el-dialog v-model="dialog" :title="editing?'管理员工账号':'新建员工账号'" width="min(640px, 94vw)" @closed="form.temporaryPassword=''">
   <el-form label-position="top" @submit.prevent="save">
    <el-form-item label="用户名"><el-input v-model="form.username" :disabled="!!editing" maxlength="80" autocomplete="off" /></el-form-item>
    <el-form-item label="显示姓名"><el-input v-model="form.displayName" maxlength="100" /></el-form-item>
    <el-form-item v-if="!editing" label="初始密码（至少 12 位）"><el-input v-model="form.temporaryPassword" type="password" show-password autocomplete="new-password" /></el-form-item>
    <el-form-item label="关联医生档案（医生岗位必选）"><el-select v-model="form.staffId" clearable placeholder="选择已有医生" style="width:100%"><el-option v-for="d in doctors.filter(x=>x.active)" :key="d.id" :value="d.id" :label="`${d.name} · ${d.employeeNo}`" /></el-select></el-form-item>
    <el-form-item v-if="editing" label="账号状态"><el-switch v-model="form.active" active-text="启用" inactive-text="停用" /></el-form-item>
    <el-form-item label="岗位与门诊">
     <div v-for="(a,i) in form.assignments" :key="i" style="display:flex;gap:8px;width:100%;margin-bottom:8px;flex-wrap:wrap">
      <el-select v-model="a.role" style="width:120px" @change="roleChanged(a)"><el-option v-for="r in roles" :key="r.value" :value="r.value" :label="r.label" /></el-select>
      <el-select v-if="a.role!=='hq'" v-model="a.clinicId" placeholder="选择门诊" style="min-width:180px;flex:1"><el-option v-for="c in clinics.filter(x=>x.active)" :key="c.id" :value="c.id" :label="c.name" /></el-select>
      <span v-else class="muted">全部门诊</span><el-button :disabled="form.assignments.length===1" @click="form.assignments.splice(i,1)">移除</el-button>
     </div><el-button @click="form.assignments.push({role:'front',clinicId:null})">添加岗位</el-button>
    </el-form-item>
    <div class="muted small">保存后员工现有登录会话将失效。初始密码仅用于首次登录，员工必须自行修改。</div>
    <div style="text-align:right;margin-top:18px"><el-button @click="dialog=false">取消</el-button><el-button type="primary" native-type="submit" :loading="busy">保存</el-button></div>
   </el-form>
  </el-dialog>
  <el-dialog v-model="resetDialog" title="重置员工密码" width="min(480px, 94vw)" @closed="resetPassword=''">
   <p>为 {{ resetting?.displayName }} 设置临时密码；原会话将失效，员工下次登录后须修改。</p>
   <el-input v-model="resetPassword" type="password" show-password placeholder="至少 12 位" autocomplete="new-password" />
   <template #footer><el-button @click="resetDialog=false">取消</el-button><el-button type="primary" :loading="busy" @click="reset">重置</el-button></template>
  </el-dialog>
 </section>
</template>
