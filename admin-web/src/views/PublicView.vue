<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Directive } from 'vue';
import { useRoute } from 'vue-router';
import SiteIcp from '../components/SiteIcp.vue';
import type { Clinic, PublicDoctor, Service } from '@andrew/shared';
import hero from '../assets/clinic-light-v2.jpg';
import clinicMotion from '../assets/clinic-motion.mp4';
import reception from '../assets/reception.jpg';
import consultation from '../assets/consultation-v2.jpg';
import treatmentRoom from '../assets/treatment-room.jpg';
import preventive from '../assets/preventive-care.jpg';
import patientExperience from '../assets/consultation-v2.jpg';
import team from '../assets/team.jpg';
import checkup from '../assets/checkup.jpg';
import orthodontics from '../assets/care-detail-v2.jpg';
import demoDoctorsGrid from '../assets/demo-doctors-grid.png';
import '../public-site.css';
import '../hero-motion.css';
import '../card-interaction.css';

const route = useRoute();
const menu = ref(false);
const motionAllowed = ref(false);
const videoPlaying = ref(false);
let motionQuery: MediaQueryList | undefined;
const heroVideo = ref<HTMLVideoElement | null>(null);
let videoObserver: IntersectionObserver | undefined;
let videoInView = true;
function updateVideoPlayback() {
  const video = heroVideo.value;
  if (!video) return;
  if (!motionAllowed.value || document.hidden || !videoInView) { video.pause(); return; }
  void video.play().catch(() => { videoPlaying.value = false; });
}
watch(heroVideo, video => {
  videoObserver?.disconnect();
  videoObserver = undefined;
  videoInView = true;
  if (!video) return;
  if (typeof IntersectionObserver !== 'undefined') {
    videoObserver = new IntersectionObserver(entries => {
      videoInView = entries.some(entry => entry.isIntersecting);
      updateVideoPlayback();
    }, { threshold: 0.01 });
    videoObserver.observe(video);
  }
  updateVideoPlayback();
});
function syncMotionPreference() { motionAllowed.value = !motionQuery?.matches; if (!motionAllowed.value) videoPlaying.value = false; }
const hasScrolled = ref(false);
const serviceRail = ref<HTMLElement | null>(null);
const canScrollBack = ref(false);
const canScrollForward = ref(false);
let revealObserver: IntersectionObserver | undefined;
const vReveal: Directive<HTMLElement> = {
  mounted(element) {
    // Start with visible content; only hide it once an observer can reveal it.
    if (typeof IntersectionObserver === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    revealObserver ||= new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        entry.target.classList.add('is-revealed');
        revealObserver?.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 });
    element.classList.add('will-reveal');
    revealObserver.observe(element);
  },
  unmounted(element) { revealObserver?.unobserve(element); },
};
function updateRail() {
  const rail = serviceRail.value;
  canScrollBack.value = Boolean(rail && rail.scrollLeft > 2);
  canScrollForward.value = Boolean(rail && rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 2);
}
function moveRail(direction: -1 | 1) {
  const rail = serviceRail.value;
  if (!rail) return;
  const firstCard = rail.querySelector<HTMLElement>('.public-service-card');
  const gap = Number.parseFloat(getComputedStyle(rail).columnGap) || 0;
  const distance = firstCard ? firstCard.getBoundingClientRect().width + gap : rail.clientWidth * .8;
  rail.scrollBy({ left: direction * distance, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
function updateHeader() { hasScrolled.value = window.scrollY > 12; }
const services = ref<Service[]>([]);
const doctors = ref<PublicDoctor[]>([]);
const clinics = ref<Clinic[]>([]);
const loading = ref(true);
const failures = ref({ services: false, doctors: false, clinics: false });
const section = computed(() => String(route.params.section || 'home'));
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
onMounted(() => { motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)'); syncMotionPreference(); motionQuery.addEventListener('change', syncMotionPreference); document.addEventListener('visibilitychange', updateVideoPlayback); void load(); updateHeader(); window.addEventListener('resize', updateRail, { passive: true }); window.addEventListener('scroll', updateHeader, { passive: true }); });
onBeforeUnmount(() => { motionQuery?.removeEventListener('change', syncMotionPreference); document.removeEventListener('visibilitychange', updateVideoPlayback); videoObserver?.disconnect(); revealObserver?.disconnect(); window.removeEventListener('resize', updateRail); window.removeEventListener('scroll', updateHeader); });
watch([services, section, selectedId, loading], () => { void nextTick(updateRail); });
</script>

<template>
  <div class="public-site" @keyup.esc="menu = false">
    <div class="public-notice">课程演示 · 诊所场景素材示意，部分图片为 AI 生成</div>
    <header class="public-header" :class="{ 'is-scrolled': hasScrolled, 'is-home': section === 'home' }">
      <router-link to="/" class="public-brand" @click="menu = false">ANDREW <span>DENTAL</span><small>安德鲁牙科</small></router-link>
      <button class="public-menu-button" :aria-expanded="menu" aria-controls="public-nav" @click="menu = !menu">{{ menu ? '关闭' : '菜单' }}</button>
      <nav id="public-nav" class="public-nav" :class="{ open: menu }" aria-label="网站导航" @click="menu = false">
        <router-link to="/">首页</router-link>
        <router-link to="/explore/services">诊疗服务</router-link>
        <router-link to="/explore/doctors">医生团队</router-link>
        <router-link to="/explore/clinics">门诊信息</router-link>
        <a href="/#about">关于我们</a>
        <router-link class="public-nav-login" to="/login">员工登录</router-link>
        <a class="public-button public-button-dark" href="/#booking">预约就诊 <span>↗</span></a>
      </nav>
    </header>

    <main v-if="section === 'home'">
      <section class="public-hero public-hero-motion">
        <div class="public-hero-copy"><p class="public-eyebrow">A MORE THOUGHTFUL DENTAL EXPERIENCE</p>
          <h1>让每一次就诊，<br><em>从容一点。</em></h1>
          <p class="public-lead">从选择门诊到预约就诊，让口腔护理的每一步都清晰、安心。</p>
          <div class="public-actions"><a class="public-button public-button-dark" href="#booking">了解预约方式 <span>↗</span></a><router-link class="public-button public-button-outline" to="/explore/services">探索诊疗服务 <span>↗</span></router-link></div>
        </div>
        <figure class="public-hero-image"><img :src="hero" alt="" fetchpriority="high"><video v-if="motionAllowed" ref="heroVideo" :class="{ playing: videoPlaying }" :src="clinicMotion" :poster="hero" muted autoplay loop playsinline aria-hidden="true" @playing="videoPlaying = true" @pause="videoPlaying = false" @error="videoPlaying = false"></video><figcaption>诊所场景素材示意</figcaption></figure>
      </section>
      <div v-reveal class="public-values public-container"><div><strong>01</strong><span>有序预约<small>选择适合的时间</small></span></div><div><strong>02</strong><span>清晰沟通<small>了解服务与安排</small></span></div><div><strong>03</strong><span>持续关怀<small>查看与管理预约</small></span></div></div>
      <section id="about" class="public-about"><div class="public-container public-split"><figure v-reveal class="public-reveal-image"><img :src="reception" alt="牙科诊所接待区，AI 生成示意图" loading="lazy"><figcaption>接待空间 · 示意图</figcaption></figure><div v-reveal class="public-split-copy"><p class="public-eyebrow">ABOUT ANDREW DENTAL</p><h2>关注口腔健康，<br><em>也关注你的感受。</em></h2><p>我们希望让就诊过程更清晰：先了解门诊与服务，再选择合适的医生和时间。每一次到访，都从充分沟通开始。</p><router-link class="public-text-link" to="/explore/clinics">了解门诊 <span>↗</span></router-link></div></div></section>
      <section v-reveal class="public-section public-container"><div class="public-section-heading"><div><p class="public-eyebrow">OUR SERVICES</p><h2>从日常护理开始</h2></div><div class="public-section-actions"><router-link class="public-text-link" to="/explore/services">查看全部服务 ↗</router-link><div v-if="services.length > 1" class="public-rail-controls" aria-label="服务列表翻页"><button type="button" aria-label="查看前面的服务" :disabled="!canScrollBack" @click="moveRail(-1)">←</button><button type="button" aria-label="查看后面的服务" :disabled="!canScrollForward" @click="moveRail(1)">→</button></div></div></div><p class="public-intro">了解可预约的服务项目，选择适合自己的就诊安排。</p><div v-if="loading" class="public-state">正在加载服务信息…</div><div v-else-if="error" class="public-state">{{ error }} <button @click="load">重试</button></div><div v-else-if="!services.length" class="public-state">暂无可展示的服务项目。</div><div v-else ref="serviceRail" class="public-service-rail" tabindex="0" aria-label="诊疗服务，可左右滚动查看更多" @scroll.passive="updateRail"><router-link v-for="(item, index) in services.slice(0, 6)" :key="item.id" :to="'/explore/services/' + item.id" class="public-service-card"><figure><img :src="serviceImage(item.name)" alt="牙科服务场景示意图" loading="lazy"><figcaption>场景示意</figcaption></figure><span class="public-number">0{{ index + 1 }}</span><strong>{{ item.name }}</strong><small>{{ serviceSummary(item.description) }}</small><span class="public-text-link">了解详情 ↗</span></router-link></div></section>
      <section class="public-gallery-section"><div v-reveal class="public-container"><div class="public-section-heading"><div><p class="public-eyebrow">A CLOSER LOOK</p><h2>让照护回归日常</h2></div><p class="public-gallery-note">空间、交流与护理 · AI 生成示意</p></div><div class="public-gallery"><figure class="public-gallery-main"><img :src="reception" alt="诊所空间 AI 生成示意图" loading="lazy"><figcaption>01 / 接待空间</figcaption></figure><figure><img :src="orthodontics" alt="护理用品 AI 生成示意图" loading="lazy"><figcaption>02 / 日常护理</figcaption></figure><figure><img :src="team" alt="牙科团队工作 AI 生成示意图" loading="lazy"><figcaption>03 / 团队协作</figcaption></figure></div></div></section>
      <section class="public-about public-experience"><div class="public-container public-split"><div v-reveal class="public-split-copy"><p class="public-eyebrow">A MORE PERSONAL EXPERIENCE</p><h2>把时间留给<br><em>沟通与理解。</em></h2><p>口腔护理从了解个人需求开始。关于服务、时间和就诊安排，都可以在预约前仔细查看。</p><router-link class="public-text-link" to="/explore/doctors">认识医生团队 ↗</router-link></div><figure v-reveal class="public-reveal-image"><img :src="patientExperience" alt="医患交流，AI 生成场景示意图" loading="lazy"><figcaption>医患交流 · AI 生成示意图</figcaption></figure></div></section>
      <section class="public-steps"><div v-reveal class="public-container"><p class="public-eyebrow">YOUR APPOINTMENT</p><h2>预约，简单四步</h2><div class="public-steps-grid"><div><b>01</b><h3>选择门诊</h3><p>查看门诊与服务信息。</p></div><div><b>02</b><h3>选择时间</h3><p>按医生和可约时段安排。</p></div><div><b>03</b><h3>确认预约</h3><p>核对就诊人与预约信息。</p></div><div><b>04</b><h3>管理预约</h3><p>随时查看、取消或改期。</p></div></div></div></section>
      <section id="booking" v-reveal class="public-cta public-container"><p class="public-eyebrow">LET'S BEGIN</p><h2>下一次就诊，<em>从这里开始。</em></h2><p>请在微信中打开安德鲁牙科患者小程序，选择门诊、医生和可预约时间。</p><span class="public-booking-note">小程序预约 · 预约结果以页面显示为准</span></section>
    </main>
    <main v-else class="public-container public-explore">
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
          <a class="public-button public-button-dark" href="/#booking">了解预约方式 ↗</a>
        </div>
      </template>
      <template v-else>
        <div v-if="section === 'services'" class="public-service-grid"><router-link v-for="(item,index) in services" :key="item.id" :to="'/explore/services/' + item.id" class="public-service-card"><figure><img :src="serviceImage(item.name)" alt="牙科服务场景示意图" loading="lazy"><figcaption>场景示意</figcaption></figure><span class="public-number">{{ String(index + 1).padStart(2, '0') }}</span><strong>{{ item.name }}</strong><small>{{ serviceSummary(item.description) }}</small><span class="public-text-link">了解详情 ↗</span></router-link><p v-if="!services.length">暂无可展示的服务项目。</p></div>
        <div v-if="section === 'doctors'"><figure class="public-team-photo"><img :src="team" alt="AI 生成的牙科团队工作场景示意" loading="lazy"><figcaption>团队工作 · AI 生成示意图</figcaption></figure><div class="public-directory"><router-link v-for="item in doctors" :key="item.id" :to="'/explore/doctors/' + item.id" class="public-directory-item"><figure v-if="demoPortrait(item)" class="public-doctor-photo"><div class="public-doctor-portrait" role="img" :aria-label="item.name + '，AI 生成的虚构人物示意'" :style="demoPortrait(item)"></div><figcaption>AI 虚构人物示意</figcaption></figure><div v-else class="public-doctor-mark" aria-hidden="true"><span>ANDREW DENTAL</span><b>✳</b></div><p class="public-eyebrow">DENTAL TEAM</p><h2>{{ item.name }}</h2><p>{{ item.specialty || '专业信息待完善' }}</p><p>排班门诊：{{ doctorClinics(item) }}</p><small v-if="item.isDemo">演示医生 · 姓名及资质为虚构信息</small><span class="public-text-link">查看详情 ↗</span></router-link><p v-if="!doctors.length">暂无公开的医生资料。</p></div></div>
        <div v-if="section === 'clinics'" class="public-directory"><router-link v-for="item in clinics" :key="item.id" :to="'/explore/clinics/' + item.id" class="public-directory-item"><figure v-if="clinicImage(item.name)" class="public-clinic-photo"><img :src="clinicImage(item.name)" alt="门诊环境 AI 生成示意图" loading="lazy"><figcaption>门诊环境 · AI 生成示意图</figcaption></figure><p class="public-eyebrow">OUR CLINICS</p><h2>{{ item.name }}</h2><p>{{ item.address || '地址待完善' }}</p><span class="public-text-link">查看详情 ↗</span></router-link><p v-if="!clinics.length">暂无公开的门诊资料。</p></div>
      </template>
    </main>
    <footer class="public-footer"><div class="public-container public-footer-inner"><div><router-link to="/" class="public-brand">ANDREW <span>DENTAL</span><small>安德鲁牙科</small></router-link><p>让每一次就诊，从容一点。</p><small>课程演示项目 · 图片为场景示意</small></div><div><strong>探索</strong><router-link to="/explore/services">诊疗服务</router-link><router-link to="/explore/doctors">医生团队</router-link><router-link to="/explore/clinics">门诊信息</router-link></div><div><strong>预约与协作</strong><a href="/#booking">患者小程序预约</a><router-link to="/login">员工工作台</router-link></div></div><div class="public-container public-copyright">© ANDREW DENTAL · 课程演示 <SiteIcp /></div></footer>
  </div>
</template>
