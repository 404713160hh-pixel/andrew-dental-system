<script setup lang="ts">
// The public registration number is supplied by the deployment build.
const icpRecord = String(import.meta.env.VITE_ICP_RECORD || '').trim();
</script>

<template>
  <a v-if="icpRecord" class="site-icp-link" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">{{ icpRecord }}</a>
</template>

<style scoped>
.site-icp-link { display: inline-block; margin: 0 12px; color: inherit; font-size: 12px; line-height: 1.8; text-decoration: none; }
.site-icp-link:hover { text-decoration: underline; }
.site-icp-link:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
</style>
