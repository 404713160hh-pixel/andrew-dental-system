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
const username = ref('');
const password = ref('');
const busy = ref(false);
const error = ref('');
const demoUsername = ref('');
const roleAccounts = [
  { role: '总部管理员', username: 'hq' },
  { role: '店长', username: 'manager.a' },
  { role: '前台', username: 'front.a' },
  { role: '医生', username: 'doctor.a' },
] as const;
const selectedAccount = computed(() =>
  roleAccounts.find((account) => account.username === username.value.trim())?.username ?? '',
);
function selectAccount(accountUsername: string) {
  if (busy.value) return;
  if (username.value !== accountUsername) {
    username.value = accountUsername;
    password.value = '';
  }
  error.value = '';
}
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
        <span class="overline">STAFF WORKSPACE <span> / </span> 工作人员入口</span>
        <h2>欢迎回来</h2>
        <p class="muted">登录预约工作台，开始今天的门诊协作。</p>
        <fieldset class="role-presets" :disabled="busy">
          <legend>选择演示角色</legend>
          <div class="role-preset-grid">
            <button
              v-for="account in roleAccounts"
              :key="account.username"
              type="button"
              class="role-preset"
              :class="{ active: selectedAccount === account.username }"
              :aria-pressed="selectedAccount === account.username"
              :aria-label="`${account.role}，账号 ${account.username}`"
              :disabled="busy"
              @click="selectAccount(account.username)"
            >
              <span class="role-preset-name">{{ account.role }}</span>
              <span class="role-preset-account">{{ account.username }}</span>
            </button>
          </div>
          <p class="role-preset-help">选择后填入账号，仍需输入密码。</p>
        </fieldset>
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
              placeholder="选择角色或输入员工账号"
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
        <SiteIcp />
      </div>
    </section>
  </div>
</template>
<style scoped>
.role-presets {
  border: 0;
  margin: 0 0 24px;
  padding: 0;
  min-width: 0;
}
.role-presets legend {
  padding: 0;
  margin-bottom: 12px;
  color: #504e49;
  font-size: 13px;
  font-weight: 600;
}
.role-preset-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.role-preset {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 5px;
  min-width: 0;
  min-height: 74px;
  padding: 14px 16px;
  border: 1px solid #e4dfd7;
  border-radius: 10px;
  background: #fcfbf8;
  color: #383734;
  text-align: left;
  cursor: pointer;
  transition: border-color .18s ease, background-color .18s ease, box-shadow .18s ease;
}
.role-preset:hover:not(:disabled) {
  border-color: #b79a6b;
  background: #f7f3e9;
}
.role-preset.active {
  border-color: #9e8257;
  background: #f6f0e5;
  box-shadow: 0 0 0 1px #9e8257 inset;
}
.role-preset:focus-visible {
  outline: 2px solid #826a48;
  outline-offset: 3px;
}
.role-preset:disabled {
  cursor: wait;
  opacity: .65;
}
.role-preset-name {
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
}
.role-preset-account {
  color: #77746f;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.role-preset-help {
  margin: 10px 0 0;
  color: #89857e;
  font-size: 12px;
  line-height: 1.6;
}
@media (max-width: 350px) {
  .role-preset { padding: 12px; }
}
</style>
