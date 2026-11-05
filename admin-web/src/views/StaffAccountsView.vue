<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { Assignment, Clinic, Page, Principal, StaffProfile, StaffProfileInput } from '@andrew/shared';
import { api, errorText, query } from '../api';
import { useAuth } from '../stores/auth';
import { calendarDate, today } from '../utils';

interface Account { id:string; username:string; displayName:string; active:boolean; accountVersion:number; mustChangePassword:boolean; staffId:string|null; assignments:Assignment[] }
const roles: {value:Assignment['role'];label:string}[] = [
  {value:'hq',label:'总部'}, {value:'manager',label:'店长'}, {value:'front',label:'前台'}, {value:'doctor',label:'医生'},
];
const auth=useAuth(),router=useRouter();
const rows=ref<Account[]>([]), clinics=ref<Clinic[]>([]), profiles=ref<StaffProfile[]>([]), accountOptions=ref<Account[]>([]);
const activeTab=ref('accounts');
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
 try{
  const [nextClinics,nextProfiles,first]=await Promise.all([api<Clinic[]>('/clinics?includeInactive=true'),api<StaffProfile[]>('/staff/profiles'),api<Page<Account>>('/staff/accounts?page=1&pageSize=100')]);
  const accounts=[...first.items];
  for(let number=2;accounts.length<first.total;number++){
   const next=await api<Page<Account>>('/staff/accounts'+query({page:number,pageSize:100}));
   if(!next.items.length)break;accounts.push(...next.items);
  }
  clinics.value=nextClinics;profiles.value=nextProfiles;accountOptions.value=accounts;
 }
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
 if(form.value.assignments.some(a=>a.role==='doctor')&&!profiles.value.some(p=>p.id===form.value.staffId&&p.isDentist)){ElMessage.error('医生岗位必须关联医生档案。');return;}
 if(!editing.value && (!form.value.username.trim() || form.value.temporaryPassword.length<12)){ElMessage.error('请填写用户名和至少 12 位初始密码。');return;}
 if(editing.value && editing.value.active && !form.value.active){
  try{await ElMessageBox.confirm('停用后账号的现有会话将立即失效。医生离职时还需处理其未来预约、排班和医生档案。','停用账号',{type:'warning',confirmButtonText:'确认停用',cancelButtonText:'返回'});}catch{return;}
 }
 busy.value=true;
 try{
  const common={displayName:form.value.displayName.trim(),staffId:form.value.staffId,assignments:form.value.assignments};
  if(editing.value)await api(`/staff/accounts/${editing.value.id}`,{method:'PUT',body:{...common,active:form.value.active,expectedVersion:editing.value.accountVersion}});
  else await api('/staff/accounts',{method:'POST',body:{...common,username:form.value.username.trim(),temporaryPassword:form.value.temporaryPassword}});
  form.value.temporaryPassword='';dialog.value=false;ElMessage.success('账号已保存，岗位调整会使旧会话失效。');await Promise.all([load(),loadResources()]);
 }catch(e){ElMessage.error(errorText(e));}finally{busy.value=false;}
}
function openReset(row:Account){resetting.value=row;resetPassword.value='';resetDialog.value=true;}
const profileDialog=ref(false),profileEditing=ref<StaffProfile|null>(null),profileError=ref('');
const profileForm=reactive<StaffProfileInput>({employeeNo:'',name:'',phone:'',specialty:'',active:true,userId:null,birthDate:null,homeAddress:null,email:null});
function birthDateDisabled(value:Date){return value.getFullYear()<1900||calendarDate(value.toISOString())>today();}
function openProfile(profile?:StaffProfile){
 if(profile?.isDentist){void router.push('/resources/doctors');return;}
 profileEditing.value=profile||null;profileError.value='';
 Object.assign(profileForm,{employeeNo:profile?.employeeNo||'',name:profile?.name||'',phone:profile?.phone||'',specialty:profile?.specialty||'',active:profile?.active??true,userId:profile?.userId||null,birthDate:profile?.birthDate||null,homeAddress:profile?.homeAddress||null,email:profile?.email||null});
 profileDialog.value=true;
}
async function saveProfile(){
 if(busy.value)return;profileError.value='';
 if(!profileForm.employeeNo.trim()||!profileForm.name.trim()){profileError.value='请填写员工编号和姓名。';return;}
 if(!/^[+\d][\d ()-]{5,24}$/.test(profileForm.phone.trim())){profileError.value='请填写有效联系电话。';return;}
 busy.value=true;
 try{
  const body={employeeNo:profileForm.employeeNo.trim(),name:profileForm.name.trim(),phone:profileForm.phone.trim(),specialty:profileForm.specialty.trim(),active:profileForm.active,userId:profileForm.userId,birthDate:profileForm.birthDate||null,homeAddress:profileForm.homeAddress?.trim()||null,email:profileForm.email?.trim()||null,...(profileEditing.value?{expectedVersion:profileEditing.value.rowVersion}:{})};
  await api(profileEditing.value?'/staff/profiles/'+profileEditing.value.id:'/staff/profiles',{method:profileEditing.value?'PUT':'POST',body});
  profileDialog.value=false;ElMessage.success('员工档案已保存。');
  if(body.userId===auth.user?.id)auth.user=await api<Principal>('/me');
  await Promise.all([load(),loadResources()]);
 }catch(e){profileError.value=errorText(e);}finally{busy.value=false;}
}
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
  <div class="page-heading"><div><h1>员工账号与档案</h1><p class="muted">员工身份、登录账号与岗位授权统一关联。</p></div><div class="button-row"><el-button :disabled="busy" @click="openProfile()">新建员工档案</el-button><el-button type="primary" :disabled="busy" @click="openCreate">新建账号</el-button></div></div>
  <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" /><el-button v-if="error" @click="load();loadResources()">重新加载</el-button>
  <el-tabs v-model="activeTab">
  <el-tab-pane label="登录账号与岗位" name="accounts">
  <el-table :data="rows" v-loading="loading" empty-text="暂无员工账号" style="width:100%">
   <el-table-column prop="username" label="用户名" min-width="130" /><el-table-column prop="displayName" label="姓名" min-width="110" />
   <el-table-column label="关联员工" min-width="170"><template #default="{row}">{{ profiles.find(p=>p.id===row.staffId)?.name || (row.staffId?'待加载':'未关联') }}<div v-if="row.staffId" class="muted small">{{ profiles.find(p=>p.id===row.staffId)?.employeeNo }}</div></template></el-table-column>
   <el-table-column label="岗位和范围" min-width="240"><template #default="scope"><div v-for="a in scope.row.assignments" :key="a.role+':'+a.clinicId">{{ labelAssignment(a) }}</div></template></el-table-column>
   <el-table-column label="状态" min-width="110"><template #default="scope"><el-tag :type="scope.row.active?'success':'info'">{{ scope.row.active?'启用':'停用' }}</el-tag><div v-if="scope.row.mustChangePassword" class="muted small">等待修改密码</div></template></el-table-column>
   <el-table-column label="操作" min-width="150"><template #default="scope"><el-button link type="primary" @click="openEdit(scope.row)">管理</el-button><el-button link type="primary" @click="openReset(scope.row)">重置密码</el-button></template></el-table-column>
  </el-table>
  <el-pagination v-if="total>30" class="mt-12" layout="prev, pager, next, total" :total="total" :page-size="30" v-model:current-page="page" @current-change="load" />
  </el-tab-pane>
  <el-tab-pane label="员工档案" name="profiles">
   <el-table :data="profiles" empty-text="暂无员工档案" style="width:100%">
    <el-table-column prop="employeeNo" label="员工编号" min-width="120" /><el-table-column prop="name" label="姓名" min-width="130" />
    <el-table-column label="人员类型" min-width="110"><template #default="{row}">{{ row.isDentist?'医生':'其他员工' }}</template></el-table-column>
    <el-table-column prop="phone" label="联系电话" min-width="150" /><el-table-column prop="specialty" label="专长 / 岗位说明" min-width="190" show-overflow-tooltip />
    <el-table-column label="关联账号" min-width="140"><template #default="{row}">{{ row.username || '未关联' }}</template></el-table-column>
    <el-table-column label="状态" min-width="90"><template #default="{row}"><el-tag :type="row.active?'success':'info'">{{ row.active?'在岗':'停用' }}</el-tag></template></el-table-column>
    <el-table-column label="操作" min-width="110"><template #default="{row}"><el-button link type="primary" :disabled="busy" @click="openProfile(row)">{{ row.isDentist?'医生资料':'编辑档案' }}</el-button></template></el-table-column>
   </el-table>
  </el-tab-pane>
  </el-tabs>
  <el-dialog append-to-body v-model="dialog" :title="editing?'管理员工账号':'新建员工账号'" width="min(640px, 94vw)" @closed="form.temporaryPassword=''">
   <el-form label-position="top" @submit.prevent="save">
    <el-form-item label="用户名"><el-input v-model="form.username" :disabled="!!editing" maxlength="80" autocomplete="off" /></el-form-item>
    <el-form-item label="显示姓名"><el-input v-model="form.displayName" maxlength="100" /></el-form-item>
    <el-form-item v-if="!editing" label="初始密码（至少 12 位）"><el-input v-model="form.temporaryPassword" type="password" show-password autocomplete="new-password" /></el-form-item>
    <el-form-item label="关联员工档案（医生岗位须选医生）"><el-select v-model="form.staffId" clearable filterable placeholder="选择员工档案" style="width:100%"><el-option v-for="profile in profiles" :key="profile.id" :value="profile.id" :label="profile.name+' · '+profile.employeeNo+(profile.isDentist?' · 医生':'')" :disabled="(!profile.active && profile.id!==form.staffId) || (!!profile.userId && profile.userId!==editing?.id)" /></el-select></el-form-item>
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
  <el-dialog append-to-body v-model="profileDialog" :title="profileEditing?'编辑员工档案':'新建员工档案'" width="min(680px,94vw)" top="5vh" :close-on-click-modal="false">
   <el-alert v-if="profileError" class="mb-16" :title="profileError" type="error" :closable="false" />
   <el-form class="staff-profile-form" label-position="top" @submit.prevent="saveProfile">
    <el-form-item label="员工编号"><el-input v-model="profileForm.employeeNo" maxlength="50" /></el-form-item>
    <el-form-item label="姓名"><el-input v-model="profileForm.name" maxlength="100" /></el-form-item>
    <el-form-item label="出生日期"><el-date-picker v-model="profileForm.birthDate" type="date" value-format="YYYY-MM-DD" :disabled-date="birthDateDisabled" placeholder="未提供可留空" style="width:100%" /></el-form-item>
    <el-form-item label="联系电话"><el-input v-model="profileForm.phone" maxlength="25" /></el-form-item>
    <el-form-item label="电子邮箱"><el-input v-model="profileForm.email" type="email" maxlength="200" /></el-form-item>
    <el-form-item label="档案状态"><el-switch v-model="profileForm.active" active-text="在岗" inactive-text="停用" /></el-form-item>
    <el-form-item class="wide-field" label="家庭住址"><el-input v-model="profileForm.homeAddress" type="textarea" :rows="2" maxlength="500" /></el-form-item>
    <el-form-item class="wide-field" label="岗位说明"><el-input v-model="profileForm.specialty" type="textarea" :rows="2" maxlength="500" /></el-form-item>
    <el-form-item class="wide-field" label="关联现有员工账号"><el-select v-model="profileForm.userId" clearable filterable placeholder="可稍后在账号管理中关联" style="width:100%"><el-option v-for="account in accountOptions" :key="account.id" :value="account.id" :label="account.displayName+' · '+account.username" :disabled="!account.active || (!!account.staffId && account.staffId!==profileEditing?.id) || account.assignments.some(a=>a.role==='doctor')" /></el-select></el-form-item>
    <p class="muted small wide-field">关联档案用于识别制表与复核人员。医生档案请通过“医生与资质”维护。</p>
    <div class="button-row wide-field" style="justify-content:flex-end;margin-top:20px"><el-button @click="profileDialog=false">返回</el-button><el-button type="primary" native-type="submit" :loading="busy">保存档案</el-button></div>
   </el-form>
  </el-dialog>
  <el-dialog append-to-body v-model="resetDialog" title="重置员工密码" width="min(480px, 94vw)" @closed="resetPassword=''">
   <p>为 {{ resetting?.displayName }} 设置临时密码；原会话将失效，员工下次登录后须修改。</p>
   <el-input v-model="resetPassword" type="password" show-password placeholder="至少 12 位" autocomplete="new-password" />
   <template #footer><el-button @click="resetDialog=false">取消</el-button><el-button type="primary" :loading="busy" @click="reset">重置</el-button></template>
  </el-dialog>
 </section>
</template>
<style scoped>
.staff-profile-form { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:0 18px; }
.wide-field { grid-column:1 / -1; }
@media(max-width:560px) { .staff-profile-form { grid-template-columns:1fr; } }
</style>
