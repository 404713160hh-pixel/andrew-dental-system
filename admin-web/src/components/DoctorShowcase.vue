<script setup lang="ts">
import { computed, ref, watch, type CSSProperties } from 'vue';
import type { PublicDoctor } from '@andrew/shared';
import { usePublicReveal } from '../composables/usePublicReveal';
const props = defineProps<{ doctors: PublicDoctor[]; loading: boolean; error: string; portrait: (doctor: PublicDoctor) => CSSProperties | undefined; clinicsFor: (doctor: PublicDoctor) => string }>();
defineEmits<{ retry: [] }>();
const root = ref<HTMLElement | null>(null);
const { enabled, backgrounded, revealAll } = usePublicReveal(root);
const selected = ref('');
const current = computed(() => props.doctors.find(d => d.id === selected.value) ?? props.doctors[0]);
const index = computed(() => props.doctors.findIndex(d => d.id === current.value?.id));
watch(() => props.doctors, items => { if (!items.some(d => d.id === selected.value)) selected.value = items[0]?.id ?? ''; });
function move(direction: number) { if (props.doctors.length) selected.value = props.doctors[(index.value + direction + props.doctors.length) % props.doctors.length].id; }
</script>
<template>
  <section id="team" ref="root" class="tail-section doctor-showcase" :class="{ 'reveal-enabled': enabled, 'is-backgrounded': backgrounded }" aria-labelledby="team-title" @focusin="revealAll">
    <div class="public-container">
      <div data-reveal class="tail-heading"><div><p class="public-eyebrow">04 / OUR TEAM</p><h2 id="team-title">认识你的医生，<br><em>让沟通先于到访。</em></h2></div><p>了解医生的关注方向与出诊门诊，再安排适合自己的就诊时间。</p></div>
      <div v-if="loading" class="public-state" role="status">正在加载医生资料…</div>
      <div v-else-if="error" class="public-state" role="alert">{{ error }} <button type="button" @click="$emit('retry')">重试</button></div>
      <p v-else-if="!current" class="public-state">暂无公开的医生资料。</p>
      <template v-else>
        <div data-reveal class="team-layout">
          <div class="team-portrait-frame"><Transition name="tail-image"><div :key="current.id" class="team-portrait" :style="portrait(current)" role="img" :aria-label="current.name + (current.isDemo ? '，AI 虚构人物示意' : '，暂无公开照片')"><span v-if="!portrait(current)" class="team-placeholder">{{ current.name.slice(0, 1) }}</span></div></Transition><span v-if="current.isDemo" class="team-photo-label">AI 虚构人物示意</span></div>
          <div class="team-description" aria-live="polite">
            <span class="team-counter">{{ String(index + 1).padStart(2, '0') }} / {{ String(doctors.length).padStart(2, '0') }}</span>
            <h3>{{ current.name }}</h3><p v-if="current.isDemo" class="team-demo">演示医生 · 姓名及资质为虚构信息</p>
            <p class="team-specialty">{{ current.specialty || '专业方向待完善' }}</p>
            <p v-if="current.bio" class="team-bio">{{ current.bio }}</p>
            <ul v-if="current.focusAreas?.length" class="team-focus"><li v-for="area in current.focusAreas" :key="area">{{ area }}</li></ul>
            <div class="team-clinics"><span>出诊门诊</span><p>{{ clinicsFor(current) }}</p></div>
            <div class="team-actions"><router-link class="public-text-link" :to="'/explore/doctors/' + current.id">查看医生资料 ↗</router-link><router-link class="public-text-link" to="/#booking">微信小程序预约 ↗</router-link></div>
            <div class="team-controls"><button type="button" aria-label="上一位医生" :disabled="doctors.length < 2" @click="move(-1)">←</button><button type="button" aria-label="下一位医生" :disabled="doctors.length < 2" @click="move(1)">→</button></div>
          </div>
        </div>
        <div data-reveal class="team-directory" role="group" aria-label="选择医生"><button v-for="doctor in doctors" :key="doctor.id" type="button" :aria-pressed="current.id === doctor.id" :class="{ active: current.id === doctor.id }" @click="selected = doctor.id">{{ doctor.name }}</button></div>
      </template>
      <div data-reveal class="tail-section-end"><router-link class="public-text-link" to="/explore/doctors">查看全部医生 ↗</router-link><span>下一步，了解如何预约 ↓</span></div>
    </div>
  </section>
</template>
