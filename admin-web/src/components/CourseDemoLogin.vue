<script setup lang="ts">
defineProps<{ modelValue: string; disabled: boolean }>();
defineEmits<{ 'update:modelValue': [username: string] }>();
const courseDemoPassword = import.meta.env.VITE_COURSE_DEMO_PASSWORD;
const courseDemoAccounts = [
  { role: '总部管理员', username: 'hq' },
  { role: '门诊店长', username: 'manager.a' },
  { role: '前台员工', username: 'front.a' },
  { role: '医生', username: 'doctor.a' },
];
</script>

<template>
  <section v-if="courseDemoPassword" class="demo-login course-demo-login" aria-label="课程演示账号">
    <div class="section-kicker">课程演示账号</div>
    <p class="muted small">统一密码 <strong>{{ courseDemoPassword }}</strong>。点击角色可填入账号。</p>
    <div class="course-demo-roles">
      <button
        v-for="account in courseDemoAccounts"
        :key="account.username"
        type="button"
        :disabled="disabled"
        :aria-pressed="modelValue === account.username"
        @click="$emit('update:modelValue', account.username)"
      >
        <span>{{ account.role }}</span>
        <strong>{{ account.username }}</strong>
      </button>
    </div>
  </section>
</template>

<style scoped>
.course-demo-login {
  margin: 0 0 20px;
}
.course-demo-login .section-kicker,
.course-demo-login > p {
  font-size: 13px;
}
.course-demo-roles {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.course-demo-roles button {
  display: grid;
  gap: 4px;
  min-height: 44px;
  padding: 8px 10px;
  border: 1px solid var(--brand-line);
  border-radius: var(--brand-radius);
  background: #fff;
  color: var(--brand-ink);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.course-demo-roles button[aria-pressed='true'],
.course-demo-roles button:focus-visible {
  outline: 2px solid var(--brand-gold-hover);
  outline-offset: -2px;
}
.course-demo-roles button:disabled {
  cursor: wait;
  opacity: .6;
}
</style>
