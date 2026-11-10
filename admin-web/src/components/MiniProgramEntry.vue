<script setup lang="ts">
defineProps<{ compact?: boolean }>();
</script>
<template>
  <aside class="mini-program-entry" :class="{ compact }" aria-label="微信小程序预约入口">
    <div class="mini-code-pending" role="note"><span>微信小程序码</span><strong>待配置</strong></div>
    <div><p class="mini-entry-title">安德鲁牙科 · 患者端</p><p class="mini-entry-note">通过已配置的患者端入口预约。<br>正式小程序码待配置。</p><router-link v-if="compact" class="public-text-link" to="/#booking">查看预约指引 ↗</router-link></div>
  </aside>
</template>
