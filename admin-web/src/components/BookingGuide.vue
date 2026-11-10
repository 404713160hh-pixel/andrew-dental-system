<script setup lang="ts">
import { ref } from 'vue';
import MiniProgramEntry from './MiniProgramEntry.vue';
import { usePublicReveal } from '../composables/usePublicReveal';
const root = ref<HTMLElement | null>(null);
const { enabled, backgrounded, revealAll } = usePublicReveal(root);
const active = ref(0);
const steps = [
  { title: '打开患者小程序', text: '登录并核对本人就诊资料。', detail: '进入安德鲁牙科患者端，登录后查看姓名、联系方式和就诊资料。' },
  { title: '选择门诊与时间', text: '选择服务、医生和可预约时段。', detail: '查看门诊与医生信息，选择诊疗服务和可预约时间；可用号源以小程序显示为准。' },
  { title: '确认并管理预约', text: '核对信息，查看预约结果。', detail: '提交前核对就诊人和时间，提交后在“我的预约”中查看结果，并按预约规则取消或改期。' },
];
</script>
<template>
  <section id="booking" ref="root" class="tail-section booking-guide" :class="{ 'reveal-enabled': enabled, 'is-backgrounded': backgrounded }" aria-labelledby="booking-title" @focusin="revealAll">
    <div class="public-container">
      <div data-reveal class="tail-heading"><div><p class="public-eyebrow">05 / YOUR NEXT VISIT</p><h2 id="booking-title">把下一次就诊，<br><em>从容安排好。</em></h2></div><p>通过微信小程序选择门诊、医生和合适的时间，预约与后续管理都在患者端完成。</p></div>
      <ol data-reveal class="booking-timeline"><li v-for="(step, i) in steps" :key="step.title" :class="{ active: active === i, complete: active > i }"><button type="button" :aria-pressed="active === i" @click="active = i"><span class="booking-step-number">0{{ i + 1 }}</span><strong>{{ step.title }}</strong><span>{{ step.text }}</span></button></li></ol>
      <div data-reveal class="booking-guide-bottom"><div class="booking-step-detail" aria-live="polite"><small>步骤 0{{ active + 1 }}</small><h3>{{ steps[active].title }}</h3><p>{{ steps[active].detail }}</p><div class="booking-step-controls"><button type="button" :disabled="active === 0" @click="active--">上一步</button><button type="button" :disabled="active === 2" @click="active++">下一步 →</button></div></div><MiniProgramEntry /></div>
    </div>
  </section>
</template>
