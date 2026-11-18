<script setup lang="ts">
import publicSecurityIcon from '../assets/public-security-record.png';

// The public registration number is supplied by the deployment build.
const icpRecord = String(import.meta.env.VITE_ICP_RECORD || '').trim();
</script>

<template>
  <div class="site-records">
    <a v-if="icpRecord" class="site-record-link" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">{{ icpRecord }}</a>
    <a class="site-record-link" href="https://beian.mps.gov.cn/#/query/webSearch?code=43010402003409" target="_blank" rel="noopener noreferrer">
      <img :src="publicSecurityIcon" alt="" width="18" height="20">
      湘公网安备43010402003409号
    </a>
  </div>
</template>

<style scoped>
.site-records { display: inline-flex; flex-wrap: wrap; align-items: center; column-gap: 16px; row-gap: 4px; }
.site-record-link { display: inline-flex; align-items: center; gap: 6px; color: inherit; font-size: 12px; line-height: 1.8; text-decoration: none; }
.site-record-link:hover { text-decoration: underline; }
.site-record-link:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
</style>
