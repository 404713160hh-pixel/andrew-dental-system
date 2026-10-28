<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Calendar,
  User,
  Clock,
  OfficeBuilding,
  FirstAidKit,
  Setting,
  SwitchButton,
  Plus,
  ArrowRight,
} from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { useAuth } from './stores/auth';
import { useCatalog } from './stores/catalog';
import { useBooking } from './stores/booking';
const auth = useAuth();
const route = useRoute();
const router = useRouter();
const catalog = useCatalog();
const booking = useBooking();
const compact = ref(false);
const menuOpen = ref(false);
const doctorView = computed(() => !!auth.user?.roles.includes('doctor') && !auth.canBook);
function restoreDensity() {
  try { compact.value = !!auth.user && localStorage.getItem('andrew.staff.density:' + auth.user.id) === 'compact'; }
  catch { compact.value = false; }
}
function toggleDensity() {
  compact.value = !compact.value;
  try { if (auth.user) localStorage.setItem('andrew.staff.density:' + auth.user.id, compact.value ? 'compact' : 'comfortable'); }
  catch { /* Display preferences never block clinical work. */ }
}
watch(
  () => auth.user?.id,
  () => {
    catalog.reset();
    booking.patient = null;
    restoreDensity();
  },
  { immediate: true },
);
watch(() => route.fullPath, () => { menuOpen.value = false; });
const title = computed(() => doctorView.value && route.path === '/appointments' ? '我的预约'
  : doctorView.value && route.path === '/shifts' ? '我的排班' : String(route.meta.title || '预约工作台'));
async function logout() {
  try {
    await auth.logout();
  } catch {
    ElMessage.warning('登录状态已清除。');
  }
  await router.replace('/login');
}
function expired() {
  auth.invalidate();
  void router.replace('/login');
}
onMounted(() => window.addEventListener('andrew:unauthorized', expired));
onUnmounted(() => window.removeEventListener('andrew:unauthorized', expired));
</script>
<template>
  <router-view v-if="route.meta.public" />
  <div v-else class="app-shell" :class="{ 'is-compact': compact, 'is-doctor': doctorView }" @keyup.esc="menuOpen = false">
    <button v-if="menuOpen" class="navigation-backdrop" aria-label="收起导航" @click="menuOpen = false"></button>
    <aside id="staff-navigation" class="sidebar" :class="{ 'is-open': menuOpen }">
      <router-link class="brand" to="/appointments"
        ><span class="brand-mark">A<span>+</span></span
        ><span>ANDREW<span class="brand-sub">安德鲁牙科 · 预约工作台</span></span></router-link
      >
      <div class="nav-label">工作空间</div>
      <nav aria-label="主导航">
        <router-link v-if="auth.isHq" to="/staff/accounts"><el-icon><User /></el-icon>员工账号</router-link>
        <router-link to="/change-password"><el-icon><Setting /></el-icon>修改密码</router-link>
        <router-link to="/appointments"
          ><el-icon><Calendar /></el-icon>{{ doctorView ? '我的预约' : '预约总览' }}</router-link
        >
        <router-link v-if="auth.canBook" to="/patients"
          ><el-icon><User /></el-icon>患者档案</router-link
        >
        <router-link v-if="auth.canBook" to="/booking"
          ><el-icon><Plus /></el-icon>患者代约</router-link
        >
        <router-link to="/shifts"
          ><el-icon><Clock /></el-icon>{{ doctorView ? '我的排班' : '医生排班' }}</router-link
        >
        <template v-if="auth.canManage"
          ><div class="nav-label">资源管理</div>
          <router-link to="/resources/clinics"
            ><el-icon><OfficeBuilding /></el-icon>门诊机构</router-link
          >
          <router-link to="/resources/doctors"
            ><el-icon><FirstAidKit /></el-icon>医生与资质</router-link
          >
          <router-link to="/resources/services"
            ><el-icon><Setting /></el-icon>预约服务</router-link
          >
          <router-link to="/resources/chairs"
            ><el-icon><Setting /></el-icon>牙椅资源</router-link
          >
          <router-link to="/resources/qualifications"
            ><el-icon><Setting /></el-icon>资格目录</router-link
          >
        </template>
      </nav>
      <div class="sidebar-note">
        <span class="live-dot"></span>预约协同工作台
        <p>时区 · 中国标准时间 UTC+8</p>
        <small>服务价格为预约参考价，实际诊疗费用以医生确认的方案为准。</small>
      </div>
      <button class="account" @click="logout">
        <span class="avatar">{{ auth.user?.displayName.slice(0, 1) }}</span
        ><span
          >{{ auth.user?.displayName }}<small>{{ auth.roleLabel }}</small></span
        ><el-icon><SwitchButton /></el-icon>
      </button>
    </aside>
    <div class="workspace">
      <header class="topbar">
        <button class="mobile-menu" aria-label="展开导航" aria-controls="staff-navigation" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen"><span></span><span></span><span></span></button>
        <div class="breadcrumb">
          工作台 <el-icon><ArrowRight /></el-icon><strong>{{ title }}</strong>
        </div>
        <div class="topbar-right">
          <button class="density-toggle" :aria-pressed="compact" @click="toggleDensity"><span class="density-icon" aria-hidden="true">☷</span>{{ compact ? '舒适视图' : '紧凑视图' }}</button>
          <span class="role-pill">{{ auth.roleLabel }}</span
          ><el-button
            v-if="auth.canBook && route.path !== '/booking'"
            type="primary"
            :icon="Plus"
            @click="router.push('/booking')"
            >新建预约</el-button
          >
        </div>
      </header>
      <main class="page"><router-view :key="route.fullPath" /></main>
      <footer>ANDREW DENTAL <span>预约 · 资源 · 协作</span></footer>
    </div>
  </div>
</template>
