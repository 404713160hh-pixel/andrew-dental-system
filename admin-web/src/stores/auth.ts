import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { AuthConfig, LoginResult, Principal } from '@andrew/shared';
import { api, tokenStorage } from '../api';
export const useAuth = defineStore('auth', () => {
  const user = ref<Principal | null>(null);
  const initialized = ref(false);
  const config = ref<AuthConfig | null>(null);
  const roleNames = { hq: '总部', manager: '店长', front: '前台', doctor: '医生', patient: '顾客' };
  const roleLabel = computed(
    () => user.value?.roles.map((role) => roleNames[role]).join(' · ') || '未登录',
  );
  const canManage = computed(
    () => !!user.value?.roles.some((role) => role === 'hq' || role === 'manager'),
  );
  const canBook = computed(
    () => !!user.value?.roles.some((role) => ['hq', 'manager', 'front'].includes(role)),
  );
  const isHq = computed(() => !!user.value?.roles.includes('hq'));
  const clinicIds = computed(
    () =>
      new Set(
        user.value?.assignments
          .map((item) => item.clinicId)
          .filter((id): id is string => id !== null) || [],
      ),
  );
  async function restore() {
    if (initialized.value) return;
    try {
      if (tokenStorage.get()) {
        user.value = await api<Principal>('/me');
        tokenStorage.setOwner(user.value.id);
      }
    } catch {
      tokenStorage.clear();
    } finally {
      initialized.value = true;
    }
  }
  async function loadConfig() {
    config.value = await api<AuthConfig>('/auth/config');
  }
  async function login(username: string, password: string, demo = false) {
    const result = await api<LoginResult>(demo ? '/auth/demo' : '/auth/login', {
      method: 'POST',
      body: demo ? { username, portal: 'staff' } : { username, password, portal: 'staff' },
    });
    if (!result.user.roles.some((role) => role !== 'patient'))
      throw new Error('此入口仅供诊所工作人员使用。');
    tokenStorage.set(result.token, result.user.id);
    user.value = result.user;
    initialized.value = true;
  }
  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      tokenStorage.clear();
      user.value = null;
    }
  }
  function invalidate() {
    user.value = null;
    tokenStorage.clear();
  }
  return {
    user,
    initialized,
    config,
    roleLabel,
    canManage,
    canBook,
    isHq,
    clinicIds,
    restore,
    loadConfig,
    login,
    logout,
    invalidate,
  };
});
