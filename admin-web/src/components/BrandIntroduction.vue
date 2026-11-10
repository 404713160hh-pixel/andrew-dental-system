<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import detailImage from '../assets/clinic-hero.jpg';

defineProps<{ image: string }>();
const section = ref<HTMLElement | null>(null);
const imageFrame = ref<HTMLElement | null>(null);
const photoStage = ref<HTMLElement | null>(null);
const copyStage = ref<HTMLElement | null>(null);
const valuesStage = ref<HTMLElement | null>(null);
const endStage = ref<HTMLElement | null>(null);
const motionEnabled = ref(false);
const values = [
  { title: '了解服务', description: '提前了解门诊和诊疗项目。' },
  { title: '充分沟通', description: '清晰了解医生与预约安排。' },
  { title: '从容预约', description: '通过微信小程序完成预约。' },
];
let observer: IntersectionObserver | undefined;
let motionQuery: MediaQueryList | undefined;
let mobileQuery: MediaQueryList | undefined;
let inView = false;
let listening = false;
let frame = 0;
let disposed = false;
let keyboardVisible = false;
let flow: HTMLElement | null = null;
let services: Element | null = null;
let valueElements: HTMLElement[] = [];
let heroActions: HTMLElement[] = [];
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const phase = (progress: number, start: number, end: number) => clamp((progress - start) / (end - start));
const progressVars = ['photo', 'aux', 'caption', 'chapter', 'eyebrow', 'title-one', 'title-two', 'description', 'action', 'end'];

function writeProgress(name: string, value: number) {
  section.value?.style.setProperty('--brand-' + name, value.toFixed(4));
}
function stopMotion() {
  window.removeEventListener('scroll', queueMotion);
  window.removeEventListener('resize', queueMotion);
  listening = false;
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
}
function showStatic() {
  motionEnabled.value = false;
  flow?.classList.remove('story-motion-enabled');
  for (const key of progressVars) writeProgress(key, 1);
  for (const key of ['entry-y', 'image-y', 'aux-y', 'copy-y']) section.value?.style.setProperty('--brand-' + key, '0px');
  for (const element of valueElements) element.style.setProperty('--value-progress', '1');
  flow?.style.setProperty('--story-services-progress', '1');
  stopMotion();
}
function renderMotion() {
  frame = 0;
  if (disposed || document.hidden || !motionEnabled.value) return;
  const element = section.value;
  const picture = imageFrame.value;
  if (!element || !picture) return;
  const bounds = element.getBoundingClientRect();
  const height = window.innerHeight;
  const mobile = mobileQuery?.matches;
  // Measure stable document-flow anchors, never the transformed picture itself.
  const topOf = (target: HTMLElement | null) => bounds.top + (target?.offsetTop ?? 0);
  const progressAt = (top: number, start = .94, end = .48) => clamp((height * start - top) / (height * (start - end)));
  const arrival = progressAt(bounds.top, .96, .1);
  const photo = progressAt(topOf(photoStage.value), .98, .48);
  const aux = phase(photo, .2, 1);
  const copy = progressAt(topOf(copyStage.value));
  const valueProgress = progressAt(topOf(valuesStage.value), .96, .43);
  const end = progressAt(topOf(endStage.value), .96, .68);
  const passed = bounds.bottom <= 0;
  const parallax = passed ? 0 : Math.max(-1, Math.min(1, (height / 2 - bounds.top - bounds.height / 2) / (height / 2 + bounds.height / 2)));
  const pictureBounds = picture.getBoundingClientRect();
  const protectedBottom = heroActions.reduce((bottom, action) => {
    const rect = action.getBoundingClientRect();
    return rect.right > pictureBounds.left && rect.left < pictureBounds.right ? Math.max(bottom, rect.bottom) : bottom;
  }, -Infinity);
  // Short windows must retain a clear reading/click area for the Hero controls.
  const overlapLimit = Math.min(mobile ? 52 : 112, Math.max(0, bounds.top - protectedBottom - 16));
  element.style.setProperty('--brand-entry-y', (-(1 - arrival) * overlapLimit).toFixed(2) + 'px');
  element.style.setProperty('--brand-image-y', (-parallax * picture.clientHeight * (mobile ? .012 : .04)).toFixed(2) + 'px');
  element.style.setProperty('--brand-aux-y', (parallax * (mobile ? 3 : 9) + (1 - aux) * 9).toFixed(2) + 'px');
  element.style.setProperty('--brand-copy-y', (mobile ? 0 : parallax * 3).toFixed(2) + 'px');
  writeProgress('photo', photo);
  writeProgress('aux', aux);
  writeProgress('caption', phase(photo, .5, 1));
  writeProgress('chapter', phase(copy, 0, .4));
  writeProgress('eyebrow', phase(copy, .05, .5));
  writeProgress('title-one', phase(copy, .1, .7));
  writeProgress('title-two', phase(copy, .2, .8));
  writeProgress('description', phase(copy, .3, .9));
  writeProgress('action', phase(copy, .4, 1));
  writeProgress('end', end);
  valueElements.forEach((target, index) => target.style.setProperty('--value-progress', phase(valueProgress, index * .12, .7 + index * .12).toFixed(4)));
  if (services) flow?.style.setProperty('--story-services-progress', progressAt(services.getBoundingClientRect().top, .98, .43).toFixed(4));
}
function queueMotion() {
  if (!frame && listening && !disposed) frame = requestAnimationFrame(renderMotion);
}
function syncMotion() {
  if (disposed) return;
  if (motionQuery?.matches || !observer || keyboardVisible) { showStatic(); return; }
  motionEnabled.value = true;
  flow?.classList.add('story-motion-enabled');
  if (document.hidden) { stopMotion(); return; }
  // Also resolve once when leaving the range, including fast jumps past it.
  if (frame) cancelAnimationFrame(frame);
  renderMotion();
  if (inView && !listening) {
    listening = true;
    window.addEventListener('scroll', queueMotion, { passive: true });
    window.addEventListener('resize', queueMotion, { passive: true });
  } else if (!inView) stopMotion();
}
function revealForKeyboard() {
  keyboardVisible = true;
  showStatic();
}
onMounted(() => {
  flow = section.value?.parentElement ?? null;
  services = section.value?.nextElementSibling ?? null;
  valueElements = Array.from(valuesStage.value?.querySelectorAll<HTMLElement>('.brand-value') ?? []);
  heroActions = Array.from(section.value?.previousElementSibling?.querySelectorAll<HTMLElement>('.public-actions a, .hero-scroll-cue') ?? []);
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  mobileQuery = window.matchMedia('(max-width: 800px)');
  // Keep the observer across preference changes so normal motion can resume.
  try {
    if (typeof IntersectionObserver !== 'undefined' && section.value) {
      observer = new IntersectionObserver(entries => {
        if (disposed) return;
        inView = entries.some(entry => entry.isIntersecting);
        syncMotion();
      }, { rootMargin: '128px 0px', threshold: 0 });
      observer.observe(section.value);
      const bounds = section.value.getBoundingClientRect();
      inView = bounds.bottom > -128 && bounds.top < window.innerHeight + 128;
    }
  } catch {
    observer?.disconnect();
    observer = undefined;
  }
  motionQuery.addEventListener('change', syncMotion);
  mobileQuery.addEventListener('change', syncMotion);
  document.addEventListener('visibilitychange', syncMotion);
  syncMotion();
});
onBeforeUnmount(() => {
  disposed = true;
  observer?.disconnect();
  stopMotion();
  motionQuery?.removeEventListener('change', syncMotion);
  mobileQuery?.removeEventListener('change', syncMotion);
  document.removeEventListener('visibilitychange', syncMotion);
  flow?.classList.remove('story-motion-enabled');
  flow?.style.removeProperty('--story-services-progress');
});
</script>

<template>
  <section id="about" ref="section" class="public-about brand-introduction" :class="{ 'scroll-motion-enabled': motionEnabled }" aria-labelledby="brand-story-title" @focusin="revealForKeyboard">
    <div class="public-container">
      <div ref="photoStage" class="brand-photo-stage">
        <figure class="brand-main-figure">
          <div ref="imageFrame" class="brand-image-mask">
            <div class="brand-image-pan"><div class="brand-image-settle"><img :src="image" alt="牙科诊所接待区，AI 生成示意图" loading="lazy" decoding="async"></div></div>
          </div>
        </figure>
        <figure class="brand-aux-figure"><div class="brand-aux-reveal"><div class="brand-aux-pan"><img :src="detailImage" alt="候诊空间与室内细节，AI 生成示意图" loading="lazy" decoding="async"></div></div></figure>
        <p class="brand-image-caption">接待空间与室内细节 · AI 生成示意</p>
      </div>
      <div ref="copyStage" class="brand-story-intro">
        <div class="brand-story-heading">
          <p class="brand-chapter">01 / BRAND STORY</p>
          <p class="public-eyebrow brand-story-eyebrow">ABOUT ANDREW DENTAL</p>
          <h2 id="brand-story-title" aria-label="让每一次就诊，都从清晰的沟通开始。"><span class="brand-title-line"><span>让每一次就诊，</span></span><span class="brand-title-line"><span>都从<em>清晰的沟通</em>开始。</span></span></h2>
        </div>
        <div class="brand-story-copy">
          <p class="brand-story-description">从了解诊疗项目，到选择门诊、医生与时间，我们希望把每一步说明白。让你在充分了解之后，再从容安排适合自己的就诊计划。</p>
          <div class="brand-story-action"><router-link class="public-text-link" to="/explore/clinics">了解门诊 <span aria-hidden="true">↗</span></router-link></div>
        </div>
      </div>
      <div ref="valuesStage" class="brand-values" role="group" aria-label="就诊安排的三个步骤">
        <div v-for="(item, index) in values" :key="item.title" class="brand-value" :style="{ '--value-index': index }">
          <span class="brand-value-number">0{{ index + 1 }}</span><svg viewBox="0 0 100 2" preserveAspectRatio="none" aria-hidden="true"><path d="M0 1H100" pathLength="1" /></svg>
          <h3>{{ item.title }}</h3><p>{{ item.description }}</p>
        </div>
      </div>
      <div ref="endStage" class="brand-story-end"><svg viewBox="0 0 1000 2" preserveAspectRatio="none" aria-hidden="true"><path d="M0 1H1000" pathLength="1" /></svg><span>02 / SERVICES</span><span aria-hidden="true">↓</span></div>
    </div>
  </section>
</template>

<style scoped>
.brand-introduction.public-about { --story-ease:cubic-bezier(.22,.61,.36,1); padding-bottom:0; background:transparent; }
.brand-photo-stage { position:relative; z-index:1; padding-bottom:92px; pointer-events:none; }
.brand-main-figure { width:76%; margin:0; }
.brand-image-mask { position:relative; height:clamp(400px,39vw,530px); overflow:hidden; isolation:isolate; background:#f5f3ef; }
.brand-image-mask::after { content:''; position:absolute; inset:0; z-index:1; pointer-events:none; background:#fcfbf9; transform:scaleX(0); transform-origin:right center; }
.brand-image-pan { position:absolute; inset:-6% 0; transform:translate3d(0,var(--brand-image-y,0px),0); }
.brand-image-settle { height:100%; width:100%; }
.brand-image-settle img,.brand-aux-pan img { display:block; width:100%; height:100%; object-fit:cover; }
.brand-image-settle img { object-position:54% center; }
.brand-aux-figure { position:absolute; width:29%; max-width:340px; right:6%; top:43%; margin:0; border:10px solid #fcfbf9; transform:translate3d(0,var(--brand-aux-y,0px),0); }
.brand-aux-reveal { aspect-ratio:1 / 1.1; overflow:hidden; }
.brand-aux-pan { height:100%; }
.brand-aux-pan img { object-position:62% center; }
.brand-image-caption { margin:20px 42% 0 0!important; padding:0; color:#77746f; font-size:11px; line-height:1.7; letter-spacing:.03em; }
.brand-story-intro { display:grid; grid-template-columns:1.15fr .85fr; align-items:end; gap:clamp(48px,7vw,100px); margin-top:6px; }
.brand-chapter { margin:0 0 16px!important; color:#77746f; font-size:10px; letter-spacing:.14em; }
.brand-story-heading .brand-story-eyebrow { margin-bottom:24px!important; color:#806b50; font-size:11px; letter-spacing:.16em; }
.brand-story-heading h2 { margin:0; font-size:clamp(36px,3.55vw,50px); line-height:1.42; letter-spacing:0; }
.brand-title-line { display:block; overflow:hidden; padding-block:.04em; }
.brand-title-line > * { display:block; }
.brand-title-line em { color:#9b8059; font-style:normal; }
.brand-story-copy { min-width:0; max-width:430px; padding-bottom:3px; transform:translate3d(0,var(--brand-copy-y,0px),0); }
.brand-story-description { margin:0!important; color:#686660; font-size:16px; line-height:1.95; text-wrap:pretty; }
.brand-story-action { display:inline-block; margin-top:24px; }
.brand-story-action .public-text-link { display:inline-flex; align-items:center; gap:30px; min-height:44px; padding-block:8px; font-size:13px; border-color:#b79a6b; }
.brand-values { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:clamp(28px,5vw,72px); margin-top:64px; }
.brand-value { display:grid; grid-template-columns:auto 1fr; column-gap:20px; align-items:center; min-width:0; }
.brand-value-number { color:#9b8059; font-family:Georgia,serif; font-size:36px; line-height:1; font-variant-numeric:tabular-nums; }
.brand-value svg { display:block; width:100%; height:2px; }
.brand-value path,.brand-story-end path { fill:none; stroke:#b79a6b; stroke-width:1; opacity:.4; stroke-dasharray:1; stroke-dashoffset:0; }
.brand-value h3 { grid-column:1/-1; margin:22px 0 10px; font-size:18px; font-weight:500; }
.brand-value p { grid-column:1/-1; margin:0!important; color:#77746f; font-size:13px; line-height:1.8; }
.brand-story-end { display:flex; align-items:center; gap:28px; margin-top:64px; color:#806b50; font-size:10px; letter-spacing:.12em; }
.brand-story-end svg { flex:1; min-width:0; height:2px; }
.brand-story-end span { flex-shrink:0; }
/* One scroll frame owns each existing reveal; no sticky or time-filled stages. */
.scroll-motion-enabled .brand-photo-stage { translate:0 var(--brand-entry-y,0px); }
.scroll-motion-enabled .brand-image-mask { clip-path:inset(0 calc((1 - var(--brand-photo,1))*100%) 0 0); }
.scroll-motion-enabled .brand-image-settle { transform:scale(calc(1 + (1 - var(--brand-photo,1))*.08)); }
.scroll-motion-enabled .brand-aux-reveal { opacity:var(--brand-aux,1); }
.scroll-motion-enabled .brand-image-caption { opacity:var(--brand-caption,1); }
.scroll-motion-enabled .brand-chapter { opacity:var(--brand-chapter,1); }
.scroll-motion-enabled .brand-story-eyebrow { opacity:var(--brand-eyebrow,1); }
.scroll-motion-enabled .brand-title-line:first-child > * { opacity:var(--brand-title-one,1); transform:translateY(calc((1 - var(--brand-title-one,1))*105%)); }
.scroll-motion-enabled .brand-title-line:nth-child(2) > * { opacity:var(--brand-title-two,1); transform:translateY(calc((1 - var(--brand-title-two,1))*105%)); }
.scroll-motion-enabled .brand-story-description { opacity:var(--brand-description,1); transform:translateY(calc((1 - var(--brand-description,1))*9px)); }
.scroll-motion-enabled .brand-story-action { opacity:var(--brand-action,1); transform:translateY(calc((1 - var(--brand-action,1))*9px)); }
.scroll-motion-enabled .brand-value-number,
.scroll-motion-enabled .brand-value h3,
.scroll-motion-enabled .brand-value p { opacity:var(--value-progress,1); transform:translateY(calc((1 - var(--value-progress,1))*9px)); }
.scroll-motion-enabled .brand-value path { stroke-dashoffset:calc(1 - var(--value-progress,1)); }
.scroll-motion-enabled .brand-story-end path { stroke-dashoffset:calc(1 - var(--brand-end,1)); }
.scroll-motion-enabled .brand-story-end span { opacity:var(--brand-end,1); }
@media(max-width:1024px) and (min-width:801px) {
  .brand-story-intro { grid-template-columns:1fr 1fr; gap:44px; }
  .brand-story-heading h2 { font-size:clamp(27px,3.25vw,34px); }
  .brand-story-description { font-size:15px; }
}
@media(max-width:800px) {
  .brand-photo-stage { padding-bottom:76px; }
  .brand-main-figure { width:90%; }
  .brand-image-mask { height:350px; }
  .brand-aux-figure { width:38%; max-width:240px; right:0; top:52%; border-width:6px; }
  .brand-story-intro { grid-template-columns:1fr; gap:24px; margin-top:12px; }
  .brand-story-heading h2 { font-size:clamp(28px,8vw,38px); }
  .brand-story-heading .brand-story-eyebrow { margin-bottom:20px!important; }
  .brand-story-copy { max-width:540px; padding:0; }
  .brand-values { gap:22px; margin-top:40px; }
  .brand-value { column-gap:12px; }
  .brand-value-number { font-size:28px; }
  .brand-value h3 { font-size:16px; }
  .brand-value p { font-size:12px; }
  .brand-story-end { margin-top:44px; gap:16px; }
}
@media(max-width:480px) {
  .brand-photo-stage { padding-bottom:58px; }
  .brand-image-mask { height:280px; }
  .brand-aux-figure { top:48%; width:41%; }
  .brand-image-caption { font-size:10px; margin-top:14px!important; }
  .brand-chapter { font-size:9px; }
  .brand-story-description { font-size:14px; }
  .brand-values { grid-template-columns:1fr; gap:24px; }
  .brand-value { grid-template-columns:36px 1fr; column-gap:20px; }
  .brand-value-number { grid-row:1/4; align-self:start; font-size:30px; }
  .brand-value h3 { grid-column:2; margin-top:10px; margin-bottom:6px; }
  .brand-value p { grid-column:2; font-size:13px; }
}
@media(prefers-reduced-motion:reduce) {
  .brand-introduction *, .brand-introduction *::after { animation:none!important; transition:none!important; }
  .brand-introduction .brand-image-mask::after { transform:scaleX(0)!important; }
  .brand-introduction .brand-image-mask { clip-path:none!important; }
  .brand-introduction .brand-image-pan,.brand-introduction .brand-image-settle,.brand-introduction .brand-aux-figure,.brand-introduction .brand-story-copy,.brand-introduction .brand-title-line > * { transform:none!important; }
  .brand-introduction .brand-photo-stage { translate:none!important; }
  .brand-introduction .brand-chapter,.brand-introduction .brand-story-eyebrow,.brand-introduction .brand-title-line > *, .brand-introduction .brand-story-description,.brand-introduction .brand-story-action,.brand-introduction .brand-image-caption,.brand-introduction .brand-aux-reveal,.brand-introduction .brand-value-number,.brand-introduction .brand-value h3,.brand-introduction .brand-value p,.brand-introduction .brand-story-end span { opacity:1!important; }
  .brand-introduction path { stroke-dashoffset:0!important; }
}
</style>
