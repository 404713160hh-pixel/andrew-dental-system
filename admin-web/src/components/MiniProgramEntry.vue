<script setup lang="ts">
import miniProgramCode from '../assets/andrew-mini-program-code.jpeg';

defineProps<{ compact?: boolean }>();
</script>
<template>
  <aside class="mini-program-entry" :class="{ compact }" aria-label="微信小程序预约入口">
    <a class="mini-program-code" :href="miniProgramCode" target="_blank" rel="noopener" aria-label="查看大图版微信小程序码">
      <img :src="miniProgramCode" width="430" height="430" loading="lazy" alt="安德鲁牙科微信小程序码" />
    </a>
    <div>
      <p class="mini-entry-title">安德鲁牙科 · 患者端</p>
      <p class="mini-entry-note">微信扫一扫，预约或管理就诊。</p>
      <router-link v-if="compact" class="public-text-link" to="/#booking">查看预约指引 ↗</router-link>
    </div>
  </aside>
</template>
