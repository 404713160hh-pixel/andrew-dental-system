<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Lock, User, ArrowRight } from '@element-plus/icons-vue';
import { useAuth } from '../stores/auth';
import { errorText } from '../api';
const auth = useAuth();
const router = useRouter();
const route = useRoute();
const username = ref('');
const password = ref('');
const busy = ref(false);
const error = ref('');
const demoUsername = ref('');
onMounted(async () => {
  try {
    await auth.loadConfig();
  } catch (e) {
    error.value = errorText(e);
  }
});
async function login(demo = false) {
  error.value = '';
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
        <div class="orbit-art" aria-hidden="true">
          <div class="orbit orbit-one"></div>
          <div class="orbit orbit-two"></div>
          <div class="tooth-art">
            <svg viewBox="0 0 180 200">
              <path
                d="M90 35C55 5 13 31 28 78c12 35 12 93 33 95 14 1 13-51 29-51s15 52 29 51c21-2 21-60 33-95C167 31 125 5 90 35Z"
                fill="white"
              />
              <path
                d="M62 47c10-5 18-1 28 5"
                fill="none"
                stroke="#bce5df"
                stroke-width="8"
                stroke-linecap="round"
              />
            </svg>
          </div>
          <div class="floating-card fc-one"><span class="live-dot"></span>门诊资源实时协同</div>
          <div class="floating-card fc-two">✓ 预约冲突自动校验</div>
        </div>
      </div>
      <div class="login-foot">ANDREW DENTAL <span>工作人员入口</span></div>
    </section>
    <section class="login-form-section">
      <div class="login-form-wrap">
        <span class="overline">欢迎回来</span>
        <h2>登录预约工作台</h2>
        <p class="muted">使用您的工作人员账号，进入所属门诊工作空间。</p>
        <el-alert
          v-if="error"
          :title="error"
          type="error"
          show-icon
          :closable="false"
          class="mb-24"
        /><el-form label-position="top" @submit.prevent="login()"
          ><el-form-item label="用户名"
            ><el-input
              v-model="username"
              size="large"
              :prefix-icon="User"
              placeholder="请输入工作人员用户名"
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
        <div v-if="auth.config?.demoLoginEnabled" class="demo-login">
          <div class="section-kicker">开发环境快捷登录</div>
          <p class="muted small">仅在服务端启用时可用；账号列表来自当前环境。</p>
          <el-select v-model="demoUsername" placeholder="选择工作人员账号" class="full-width"
            ><el-option
              v-for="account in auth.config.demoAccounts.filter((item) => item.portal === 'staff')"
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
        <p class="login-security">账号权限由所属机构与岗位确定。顾客请使用预约小程序。</p>
      </div>
    </section>
  </div>
</template>
