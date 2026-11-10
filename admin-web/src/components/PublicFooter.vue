<script setup lang="ts">
import { ref } from 'vue';
import type { Clinic } from '@andrew/shared';
import SiteIcp from './SiteIcp.vue';
import MiniProgramEntry from './MiniProgramEntry.vue';
import { usePublicReveal } from '../composables/usePublicReveal';
defineProps<{ clinics: Clinic[]; loading: boolean; error: boolean }>();
defineEmits<{ retry: [] }>();
const root = ref<HTMLElement | null>(null);
const { enabled, backgrounded, revealAll } = usePublicReveal(root);
const navigation = [{ title: '首页', to: '/' }, { title: '关于我们', to: '/#about' }, { title: '诊疗服务', to: '/explore/services' }, { title: '诊所环境', to: '/#environment' }, { title: '医生团队', to: '/#team' }, { title: '预约指引', to: '/#booking' }];
</script>
<template>
  <footer ref="root" class="tail-section branded-footer" :class="{ 'reveal-enabled': enabled, 'is-backgrounded': backgrounded }" @focusin="revealAll">
    <svg class="footer-curve" viewBox="0 0 1440 64" preserveAspectRatio="none" aria-hidden="true"><path d="M0 0H1440V64Q720 -25 0 64Z" /></svg>
    <div class="public-container">
      <div class="footer-columns">
        <div data-reveal class="footer-brand"><router-link class="public-brand" to="/">ANDREW <span>DENTAL</span><small>安德鲁牙科</small></router-link><p>以清晰、专业与用心，<br>提供更从容的口腔诊疗体验。</p><small>课程演示项目 · 场景图片为示意素材</small></div>
        <nav data-reveal aria-label="页脚网站导航"><h2>探索安德鲁</h2><router-link v-for="item in navigation" :key="item.to" :to="item.to">{{ item.title }} <span aria-hidden="true">↗</span></router-link><router-link to="/login">员工工作台 <span aria-hidden="true">↗</span></router-link></nav>
        <div data-reveal class="footer-clinics"><h2>门诊信息</h2><p v-if="loading" role="status">正在加载门诊资料…</p><p v-else-if="error" role="alert">门诊资料暂未加载 <button type="button" @click="$emit('retry')">重试</button></p><p v-else-if="!clinics.length">暂无公开门诊信息。</p><div v-for="clinic in clinics.slice(0, 2)" :key="clinic.id" class="footer-clinic"><router-link :to="'/explore/clinics/' + clinic.id">{{ clinic.name }}</router-link><p v-if="clinic.address">{{ clinic.address }}</p><a v-if="clinic.phone" :href="'tel:' + clinic.phone.replace(/[^\d+]/g, '')">{{ clinic.phone }}</a><p v-if="clinic.openingHours">{{ clinic.openingHours }}</p></div><router-link to="/explore/clinics" class="public-text-link">全部门诊 ↗</router-link></div>
        <div data-reveal class="footer-mini"><h2>微信小程序预约</h2><MiniProgramEntry compact /></div>
      </div>
      <div data-reveal class="footer-bottom"><p>© {{ new Date().getFullYear() }} ANDREW DENTAL · 课程演示</p><SiteIcp /><router-link to="/#booking">安排下一次到访 ↑</router-link></div>
    </div>
  </footer>
</template>
