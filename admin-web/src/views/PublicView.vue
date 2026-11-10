<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import PublicFooter from '../components/PublicFooter.vue';
import DoctorShowcase from '../components/DoctorShowcase.vue';
import BookingGuide from '../components/BookingGuide.vue';
import PublicNavigation from '../components/PublicNavigation.vue';
import BrandIntroduction from '../components/BrandIntroduction.vue';
import ServiceGallery from '../components/ServiceGallery.vue';
import ClinicEnvironment from '../components/ClinicEnvironment.vue';
import type { Clinic, PublicDoctor, Service } from '@andrew/shared';
import hero from '../assets/clinic-light-v2.jpg';
import clinicMotion from '../assets/clinic-motion.mp4';
import reception from '../assets/reception.jpg';
import consultation from '../assets/consultation-v2.jpg';
import treatmentRoom from '../assets/treatment-room.jpg';
import preventive from '../assets/preventive-care.jpg';
import team from '../assets/team.jpg';
import checkup from '../assets/checkup.jpg';
import orthodontics from '../assets/care-detail-v2.jpg';
import demoDoctorsGrid from '../assets/demo-doctors-grid.png';
import '../public-site.css';
import '../hero-motion.css';
import '../card-interaction.css';
import '../public-navigation.css';
import '../brand-story-transition.css';
import '../public-tail.css';

const route = useRoute();
const motionAllowed = ref(false);
const videoPlaying = ref(false);
const userPausedVideo = ref(false);
const videoFailed = ref(false);
let motionQuery: MediaQueryList | undefined;
const heroVideo = ref<HTMLVideoElement | null>(null);
const heroFigure = ref<HTMLElement | null>(null);
const heroSection = ref<HTMLElement | null>(null);
let heroPointerQuery: MediaQueryList | undefined;
let heroPointerX = 0;
let heroPointerY = 0;
let videoObserver: IntersectionObserver | undefined;
let videoInView = true;
let parallaxFrame = 0;
function updateVideoPlayback() {
  const video = heroVideo.value;
  if (!video) return;
  if (!motionAllowed.value || videoFailed.value || userPausedVideo.value || document.hidden || !videoInView) {
    video.pause();
    return;
  }
  void video.play().then(() => {
    if (heroVideo.value !== video || !motionAllowed.value || videoFailed.value || userPausedVideo.value || document.hidden || !videoInView) {
      video.pause();
      return;
    }
    videoPlaying.value = true;
  }).catch(() => { videoPlaying.value = false; });
}
function toggleHeroVideo() {
  if (videoPlaying.value) {
    userPausedVideo.value = true;
    heroVideo.value?.pause();
    videoPlaying.value = false;
    return;
  }
  userPausedVideo.value = false;
  updateVideoPlayback();
}
function failHeroVideo() {
  videoFailed.value = true;
  videoPlaying.value = false;
  updateHeroParallax();
}
watch(heroVideo, video => {
  videoObserver?.disconnect();
  videoObserver = undefined;
  videoInView = true;
  if (!video) return;
  if (typeof IntersectionObserver !== 'undefined') {
      try {
        videoObserver = new IntersectionObserver(entries => {
          videoInView = entries.some(entry => entry.isIntersecting);
          updateVideoPlayback();
        }, { threshold: 0.01 });
        videoObserver.observe(video);
      } catch {
        videoObserver?.disconnect();
        videoObserver = undefined;
        videoInView = true;
      }
  }
  updateVideoPlayback();
});
function syncMotionPreference() {
  motionAllowed.value = !motionQuery?.matches;
  if (!motionAllowed.value) videoPlaying.value = false;
  updateVideoPlayback();
  queueHeroParallax();
}
function updateHeroParallax() {
  const element = heroSection.value;
  if (!element) return;
  const bounds = element.getBoundingClientRect();
  const progress = Math.max(0, Math.min(1, -bounds.top / Math.max(bounds.height, 1)));
  const enabled = motionAllowed.value && !document.hidden && !!heroPointerQuery?.matches && bounds.bottom > 0 && bounds.top < window.innerHeight;
  const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));
  const values = {
    '--hero-bg-x': enabled ? heroPointerX * 6 : 0,
    '--hero-bg-y': enabled ? clamp(heroPointerY * 4 - progress * 4, 6) : 0,
    '--hero-image-x': enabled ? heroPointerX * 4 : 0,
    '--hero-image-y': enabled ? clamp(heroPointerY * 3 - progress * 3, 4) : 0,
    '--hero-copy-x': enabled ? heroPointerX * 2 : 0,
    '--hero-copy-y': enabled ? clamp(heroPointerY - progress * 2, 2) : 0,
  };
  for (const [name, value] of Object.entries(values)) element.style.setProperty(name, `${value.toFixed(2)}px`);
  element.style.setProperty('--hero-cue-opacity', motionAllowed.value ? String(Math.max(0, 1 - progress * 4)) : '1');
  const exit = motionAllowed.value ? Math.max(0, Math.min(1, (progress - .2) / .65)) : 0;
  element.style.setProperty('--hero-story-opacity', String(1 - exit * .95));
  element.style.setProperty('--hero-story-y', `${(-exit * 24).toFixed(2)}px`);
  element.style.setProperty('--hero-story-zoom', String(1 + exit * .035));
  element.style.setProperty('--hero-story-line', String(motionAllowed.value ? Math.min(1, progress * 3) : 1));
}
function onHeroPointerMove(event: PointerEvent) {
  const element = heroSection.value;
  if (!element || !heroPointerQuery?.matches || event.pointerType === 'touch' || !motionAllowed.value) return;
  const bounds = element.getBoundingClientRect();
  heroPointerX = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1));
  heroPointerY = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1));
  queueHeroParallax();
}
function resetHeroPointer() {
  heroPointerX = 0;
  heroPointerY = 0;
  queueHeroParallax();
}
function onPublicVisibilityChange() {
  updateVideoPlayback();
  queueHeroParallax();
}
function queueHeroParallax() {
  if (parallaxFrame) return;
  parallaxFrame = window.requestAnimationFrame(() => {
    parallaxFrame = 0;
    updateHeroParallax();
  });
}
function onPublicScroll() { queueHeroParallax(); }
const services = ref<Service[]>([]);
const doctors = ref<PublicDoctor[]>([]);
const clinics = ref<Clinic[]>([]);
const loading = ref(true);
const failures = ref({ services: false, doctors: false, clinics: false });
const retrying = ref({ services: false, doctors: false, clinics: false });
async function retryDirectory(kind: 'services' | 'doctors' | 'clinics') {
  if (retrying.value[kind]) return;
  retrying.value[kind] = true;
  try {
    const response = await fetch('/api/v1/' + kind, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('资料暂时无法加载');
    const data = (await response.json()).data;
    if (!Array.isArray(data)) throw new Error('资料格式不正确');
    if (kind === 'services') services.value = data;
    else if (kind === 'doctors') doctors.value = data;
    else clinics.value = data;
    failures.value[kind] = false;
  } catch { failures.value[kind] = true; }
  finally { retrying.value[kind] = false; }
}
const section = computed(() => String(route.params.section || 'home'));
const bookingGuideLocation = { path: '/', hash: '#booking' };
const error = computed(() => failures.value[section.value === 'home' ? 'services' : section.value as 'services' | 'doctors' | 'clinics'] ? '资料暂时无法加载，请稍后重试。' : '');
const selectedId = computed(() => String(route.params.id || ''));
const selectedService = computed(() => services.value.find(item => item.id === selectedId.value));
const selectedDoctor = computed(() => doctors.value.find(item => item.id === selectedId.value));
const selectedClinic = computed(() => clinics.value.find(item => item.id === selectedId.value));
const selectedItem = computed(() => section.value === 'services' ? selectedService.value : section.value === 'doctors' ? selectedDoctor.value : selectedClinic.value);
function serviceImage(name: string) { return /正畸|矫正/.test(name) ? orthodontics : /儿童|清洁|洁牙|预防/.test(name) ? preventive : /检查/.test(name) ? checkup : /种植|修复/.test(name) ? treatmentRoom : consultation; }
// The image is a sheet of fictional portraits, mapped only to known demo records.
const demoPortraitPositions = new Map<string, [number, number]>([
  ['李若宁（虚构医生）', [0, 0]], ['陈知远（虚构医生）', [1, 0]],
  ['苏予安（虚构医生）', [2, 0]], ['顾清和（虚构医生）', [3, 0]],
  ['许知夏（虚构医生）', [0, 1]], ['周沐辰（虚构医生）', [1, 1]],
  ['唐书禾（虚构医生）', [2, 1]], ['林亦岚（虚构医生）', [3, 1]],
]);
function demoPortrait(doctor: PublicDoctor) {
  const pos = doctor.isDemo ? demoPortraitPositions.get(doctor.name) : undefined;
  return pos ? { backgroundImage: `url("${demoDoctorsGrid}")`, backgroundPosition: `${pos[0] * 100 / 3}% ${pos[1] * 100}%` } : undefined;
}
function clinicImage(name: string) {
  if (name === '安德鲁牙科·越秀门诊') return reception;
  if (name === '安德鲁牙科·天河门诊') return hero;
  return undefined;
}
function doctorClinics(doctor: PublicDoctor) {
  if (failures.value.clinics) return '门诊信息暂未读取';
  return (doctor.clinicIds || []).map(id => clinics.value.find(clinic => clinic.id === id)?.name).filter(Boolean).join('、') || '暂无已发布排班门诊';
}
function clinicDoctors(id: string) { return doctors.value.filter(doctor => (doctor.clinicIds || []).includes(id)); }
function serviceSummary(description: string) { return description.length > 54 ? description.slice(0, 54) + '…' : description || '了解服务与预约安排'; }

async function load() {
  loading.value = true; failures.value = { services: false, doctors: false, clinics: false };
  try {
    const results = await Promise.allSettled(['/services', '/doctors', '/clinics'].map(async path => {
      const response = await fetch('/api/v1' + path, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('资料暂时无法加载，请稍后重试。');
      const data = (await response.json()).data;
      if (!Array.isArray(data)) throw new Error('资料格式不正确');
      return data;
    }));
    services.value = results[0].status === 'fulfilled' ? results[0].value : [];
    doctors.value = results[1].status === 'fulfilled' ? results[1].value : [];
    clinics.value = results[2].status === 'fulfilled' ? results[2].value : [];
    failures.value = { services: results[0].status === 'rejected', doctors: results[1].status === 'rejected', clinics: results[2].status === 'rejected' };
  }
  finally { loading.value = false; }
}
onMounted(() => { motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)'); heroPointerQuery = window.matchMedia('(min-width: 1025px) and (hover: hover) and (pointer: fine)'); heroPointerQuery.addEventListener('change', resetHeroPointer); syncMotionPreference(); motionQuery.addEventListener('change', syncMotionPreference); document.addEventListener('visibilitychange', onPublicVisibilityChange); void load(); queueHeroParallax(); window.addEventListener('resize', queueHeroParallax, { passive: true }); window.addEventListener('scroll', onPublicScroll, { passive: true }); });
onBeforeUnmount(() => { motionQuery?.removeEventListener('change', syncMotionPreference); heroPointerQuery?.removeEventListener('change', resetHeroPointer); document.removeEventListener('visibilitychange', onPublicVisibilityChange); videoObserver?.disconnect(); if (parallaxFrame) window.cancelAnimationFrame(parallaxFrame); window.removeEventListener('resize', queueHeroParallax); window.removeEventListener('scroll', onPublicScroll); });
watch(heroSection, () => { void nextTick(queueHeroParallax); });
</script>

<template>
  <div class="public-site">
    <div class="public-notice">课程演示 · 诊所场景素材示意，部分图片为 AI 生成</div>
    <PublicNavigation />

    <Transition name="public-page">
    <main v-if="section === 'home'" :key="route.path" class="public-story-flow">
      <section ref="heroSection" class="public-hero public-hero-motion" aria-labelledby="hero-title" @pointermove="onHeroPointerMove" @pointerleave="resetHeroPointer">
        <div class="public-hero-copy"><div class="hero-intro-motion"><p class="public-eyebrow hero-eyebrow">A MORE THOUGHTFUL DENTAL EXPERIENCE</p>
          <h1 id="hero-title" aria-label="让每一次就诊，从容一点。"><span class="hero-title-line"><span>让每一次就诊，</span></span><span class="hero-title-line"><em>从容一点。</em></span></h1>
          <p class="public-lead hero-description">从选择门诊到预约就诊，让口腔护理的每一步都清晰、安心。</p>
          </div>
          <div class="public-actions"><span class="hero-action-reveal"><router-link class="public-button public-button-dark" :to="bookingGuideLocation">微信小程序预约 <span aria-hidden="true">↗</span></router-link></span><span class="hero-action-reveal"><router-link class="public-button public-button-outline" to="/explore/services">探索诊疗服务 <span aria-hidden="true">↗</span></router-link></span></div>
          <router-link class="hero-scroll-cue" to="/#about"><span class="hero-scroll-rule" aria-hidden="true"></span>继续了解<span aria-hidden="true">↓</span></router-link>
        </div>
        <figure ref="heroFigure" class="public-hero-image"><div class="hero-image-pan"><div class="hero-media-settle"><img :src="hero" alt="" fetchpriority="high"><video v-if="motionAllowed && !videoFailed" ref="heroVideo" :class="{ playing: videoPlaying }" :src="clinicMotion" :poster="hero" muted loop playsinline aria-hidden="true" @playing="videoPlaying = true" @pause="videoPlaying = false" @error="failHeroVideo"></video></div></div><button v-if="motionAllowed && !videoFailed" type="button" class="public-video-control" :aria-pressed="videoPlaying" :aria-label="videoPlaying ? '暂停背景影像' : '播放背景影像'" @click="toggleHeroVideo">{{ videoPlaying ? '暂停影像' : '播放影像' }} <span aria-hidden="true">{{ videoPlaying ? 'Ⅱ' : '▶' }}</span></button><figcaption>诊所场景素材示意</figcaption></figure>
        <span class="hero-story-seam" aria-hidden="true"></span>
      </section>
      <BrandIntroduction :image="reception" />
      <ServiceGallery :services="services" :loading="loading || retrying.services" :error="failures.services ? '资料暂时无法加载，请稍后重试。' : ''" :image-for="serviceImage" @retry="retryDirectory('services')" />
      <ClinicEnvironment />
      <DoctorShowcase :doctors="doctors" :loading="loading || retrying.doctors" :error="failures.doctors ? '医生资料暂时无法加载，请稍后重试。' : ''" :portrait="demoPortrait" :clinics-for="doctorClinics" @retry="retryDirectory('doctors')" />
      <BookingGuide />
    </main>
    <main v-else :key="route.path" class="public-container public-explore">
      <router-link to="/" class="public-back">← 返回首页</router-link>
      <p class="public-eyebrow">{{ section === 'services' ? 'OUR SERVICES' : section === 'doctors' ? 'OUR DENTISTS' : 'OUR CLINICS' }}</p>
      <h1>{{ selectedItem ? selectedItem.name : section === 'services' ? '诊疗服务' : section === 'doctors' ? '医生团队' : '门诊信息' }}</h1>
      <p class="public-lead">{{ selectedItem ? '了解详情与就诊安排。' : section === 'services' ? '了解可预约服务，寻找合适的就诊安排。' : section === 'doctors' ? '了解医生的专业方向与排班门诊。' : '查看门诊资料，选择适合您的地点。' }}</p>
      <div v-if="loading" class="public-state">正在加载资料…</div><div v-else-if="error" class="public-state">{{ error }} <button @click="load">重试</button></div>
      <template v-else-if="selectedId">
        <div v-if="!selectedItem" class="public-state">未找到该信息，请返回列表查看。</div>
        <div v-else class="public-detail">
          <template v-if="selectedService"><figure class="public-detail-photo"><img :src="serviceImage(selectedService.name)" alt="牙科服务 AI 生成场景示意图"><figcaption>AI 生成场景示意</figcaption></figure><h2>关于这项服务</h2><p>{{ selectedService.description || '服务详情请与门诊沟通。' }}</p><p>预约时长：{{ selectedService.durationMinutes }} 分钟。具体诊疗方案由医生评估后确定。</p><h2 v-if="services.length > 1">其他可预约服务</h2><router-link v-for="item in services.filter(service => service.id !== selectedService?.id).slice(0, 3)" :key="item.id" class="public-related" :to="'/explore/services/' + item.id">{{ item.name }} ↗</router-link></template>
          <template v-if="selectedDoctor"><figure v-if="demoPortrait(selectedDoctor)" class="public-doctor-photo"><div class="public-doctor-portrait" role="img" :aria-label="selectedDoctor.name + '，AI 生成的虚构人物示意'" :style="demoPortrait(selectedDoctor)"></div><figcaption>AI 虚构人物示意</figcaption></figure><div v-else class="public-doctor-mark" aria-hidden="true"><span>ANDREW DENTAL</span><b>✳</b></div><p v-if="selectedDoctor.isDemo" class="public-demo">演示医生，姓名及资质为虚构信息</p><h2>专业方向</h2><p>{{ selectedDoctor.specialty || '专业信息待完善' }}</p><p v-if="selectedDoctor.bio">{{ selectedDoctor.bio }}</p><p v-if="selectedDoctor.focusAreas?.length">关注领域：{{ selectedDoctor.focusAreas.join('、') }}</p><h2>排班门诊</h2><p>{{ doctorClinics(selectedDoctor) }}</p></template>
          <template v-if="selectedClinic"><figure v-if="clinicImage(selectedClinic.name)" class="public-detail-photo"><img :src="clinicImage(selectedClinic.name)" alt="门诊环境 AI 生成示意图"><figcaption>门诊环境 · AI 生成示意图</figcaption></figure><h2 v-if="selectedClinic.description">门诊简介</h2><p v-if="selectedClinic.description">{{ selectedClinic.description }}</p><h2>门诊信息</h2><p>地址：{{ selectedClinic.address || '待完善' }}</p><p>电话：{{ selectedClinic.phone || '待完善' }}</p><p>邮箱：{{ selectedClinic.email || '待完善' }}</p><p>营业时间：{{ selectedClinic.openingHours || '暂无公开营业时间' }}</p><p>具体就诊时间请以可预约时段为准。</p><h2>排班医生</h2><p v-if="failures.doctors">医生信息暂时无法加载。</p><template v-else-if="clinicDoctors(selectedClinic.id).length"><router-link v-for="doctor in clinicDoctors(selectedClinic.id)" :key="doctor.id" class="public-related" :to="'/explore/doctors/' + doctor.id">{{ doctor.name }} · {{ doctor.specialty || '专业信息待完善' }} ↗</router-link></template><p v-else>暂无已发布排班的医生。</p></template>
          <router-link class="public-button public-button-dark" :to="bookingGuideLocation">微信小程序预约 <span aria-hidden="true">↗</span></router-link>
        </div>
      </template>
      <template v-else>
        <div v-if="section === 'services'" class="public-service-grid"><router-link v-for="(item,index) in services" :key="item.id" :to="'/explore/services/' + item.id" class="public-service-card"><figure><img :src="serviceImage(item.name)" alt="牙科服务场景示意图" loading="lazy"><figcaption>场景示意</figcaption></figure><span class="public-number">{{ String(index + 1).padStart(2, '0') }}</span><strong>{{ item.name }}</strong><small>{{ serviceSummary(item.description) }}</small><span class="public-text-link">了解详情 ↗</span></router-link><p v-if="!services.length">暂无可展示的服务项目。</p></div>
        <div v-if="section === 'doctors'"><figure class="public-team-photo"><img :src="team" alt="AI 生成的牙科团队工作场景示意" loading="lazy"><figcaption>团队工作 · AI 生成示意图</figcaption></figure><div class="public-directory"><router-link v-for="item in doctors" :key="item.id" :to="'/explore/doctors/' + item.id" class="public-directory-item"><figure v-if="demoPortrait(item)" class="public-doctor-photo"><div class="public-doctor-portrait" role="img" :aria-label="item.name + '，AI 生成的虚构人物示意'" :style="demoPortrait(item)"></div><figcaption>AI 虚构人物示意</figcaption></figure><div v-else class="public-doctor-mark" aria-hidden="true"><span>ANDREW DENTAL</span><b>✳</b></div><p class="public-eyebrow">DENTAL TEAM</p><h2>{{ item.name }}</h2><p>{{ item.specialty || '专业信息待完善' }}</p><p>排班门诊：{{ doctorClinics(item) }}</p><small v-if="item.isDemo">演示医生 · 姓名及资质为虚构信息</small><span class="public-text-link">查看详情 ↗</span></router-link><p v-if="!doctors.length">暂无公开的医生资料。</p></div></div>
        <div v-if="section === 'clinics'" class="public-directory"><router-link v-for="item in clinics" :key="item.id" :to="'/explore/clinics/' + item.id" class="public-directory-item"><figure v-if="clinicImage(item.name)" class="public-clinic-photo"><img :src="clinicImage(item.name)" alt="门诊环境 AI 生成示意图" loading="lazy"><figcaption>门诊环境 · AI 生成示意图</figcaption></figure><p class="public-eyebrow">OUR CLINICS</p><h2>{{ item.name }}</h2><p>{{ item.address || '地址待完善' }}</p><span class="public-text-link">查看详情 ↗</span></router-link><p v-if="!clinics.length">暂无公开的门诊资料。</p></div>
      </template>
    </main>
    </Transition>
    <PublicFooter :clinics="clinics" :loading="loading || retrying.clinics" :error="failures.clinics" @retry="retryDirectory('clinics')" />
  </div>
</template>
