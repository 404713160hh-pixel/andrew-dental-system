<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import SiteIcp from '../components/SiteIcp.vue';
import { useRoute, useRouter } from 'vue-router';
import { Lock, User, ArrowRight } from '@element-plus/icons-vue';
import { useAuth } from '../stores/auth';
import { errorText } from '../api';
const auth = useAuth();
const router = useRouter();
const route = useRoute();
const isDevelopmentBuild = import.meta.env.DEV;
const username = ref('');
const password = ref('');
const busy = ref(false);
const error = ref('');
const demoUsername = ref('');
const staffDemoAccounts = computed(() =>
  isDevelopmentBuild && auth.config?.demoLoginEnabled
    ? auth.config.demoAccounts.filter((account) => account.portal === 'staff')
    : [],
);
onMounted(async () => {
  try {
    await auth.loadConfig();
  } catch (e) {
    error.value = errorText(e);
  }
});
async function login(demo = false) {
  error.value = '';
  const selectedDemoAccountIsAvailable = staffDemoAccounts.value.some(
    (account) => account.username === demoUsername.value,
  );
  if (
    demo &&
    (!isDevelopmentBuild || !auth.config?.demoLoginEnabled || !selectedDemoAccountIsAvailable)
  ) {
    error.value = '当前环境未提供可用的开发演示账号。';
    return;
  }
  if (demo ? !demoUsername.value : !username.value.trim() || !password.value) {
    error.value = demo ? '请选择开发环境工作人员账号。' : '请输入用户名和密码。';
    return;
  }
  busy.value = true;
  try {
    await auth.login(demo ? demoUsername.value : username.value.trim(), password.value, demo);
    const next =
      typeof route.query.next === 'string' &&
      route.query.next.startsWith('/') &&
      !route.query.next.startsWith('//')
        ? route.query.next
        : '/appointments';
    await router.replace(next);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="login-page">
    <section class="login-story">
      <div class="brand">
        <span class="brand-mark">A<span>+</span></span
        ><span>ANDREW<span class="brand-sub">安德鲁牙科</span></span>
      </div>
      <div class="login-story-content">
        <div class="eyebrow">BETTER CARE, TOGETHER</div>
        <h1>把每一次预约，<br />安排得更从容。</h1>
        <p>连接门诊、医生与患者，<br />让优质的口腔服务，从有序的预约开始。</p>
        <div class="clinic-visual" role="img" aria-label="诊所空间宣传示意图">
          <div class="clinic-visual-caption">
            <span class="caption-line"></span>
            <div><strong>好的照护，从有序开始</strong><small>诊所空间示意图</small></div>
          </div>
        </div>
        <div class="story-features" aria-label="工作台功能">
          <span><i></i> 预约协同</span><span><i></i> 排班管理</span><span><i></i> 患者服务</span>
        </div>
      </div>
      <div class="login-foot">ANDREW DENTAL <span>工作人员入口</span></div>
    </section>
    <section class="login-form-section">
      <div class="login-form-wrap">
        <router-link class="login-back-link" to="/">返回官网</router-link>
        <span class="overline">STAFF WORKSPACE <span> / </span> 工作人员入口</span>
        <h2>欢迎回来</h2>
        <p class="muted">登录预约工作台，开始今天的门诊协作。</p>
        <el-alert
          v-if="error"
          :title="error"
          type="error"
          show-icon
          :closable="false"
          class="mb-24"
        /><el-form label-position="top" @submit.prevent="login()"
          ><el-form-item label="员工账号"
            ><el-input
              v-model="username"
              size="large"
              :prefix-icon="User"
              placeholder="请输入员工账号"
              autocomplete="username"
              :disabled="busy" /></el-form-item
          ><el-form-item label="密码"
            ><el-input
              v-model="password"
              size="large"
              :prefix-icon="Lock"
              type="password"
              show-password
              placeholder="请输入密码"
              autocomplete="current-password"
              :disabled="busy" /></el-form-item
          ><el-button
            type="primary"
            size="large"
            native-type="submit"
            class="full-width"
            :loading="busy"
            >登录工作台<el-icon class="ml-8"><ArrowRight /></el-icon></el-button
        ></el-form>
        <div v-if="isDevelopmentBuild && auth.config?.demoLoginEnabled && staffDemoAccounts.length" class="demo-login">
          <div class="section-kicker">开发环境快捷登录</div>
          <p class="muted small">开发演示账号仅由当前服务端提供，不填写密码。</p>
          <el-select v-model="demoUsername" placeholder="选择工作人员账号" class="full-width"
            ><el-option
              v-for="account in staffDemoAccounts"
              :key="account.username"
              :value="account.username"
              :label="`${account.displayName} · ${account.username}`" /></el-select
          ><el-button
            class="full-width mt-12"
            :loading="busy"
            :disabled="!demoUsername"
            @click="login(true)"
            >进入开发工作台</el-button
          >
        </div>
        <p class="login-security">正式账号使用员工账号与密码登录。顾客请使用预约小程序。</p>
        <SiteIcp />
      </div>
    </section>
  </div>
</template>
