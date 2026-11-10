<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Service } from '@andrew/shared';
const props = defineProps<{ services: Service[]; loading: boolean; error: string; imageFor: (name: string) => string }>();
defineEmits<{ retry: [] }>();
const selectedId = ref('');
const current = computed(() => props.services.find(s => s.id === selectedId.value) ?? props.services[0]);
const index = computed(() => Math.max(0, props.services.findIndex(s => s.id === current.value?.id)));
const section = ref<HTMLElement | null>(null);
const ready = ref(false);
const entered = ref(false);
let observer: IntersectionObserver | undefined;
watch(() => props.services, items => { if (!items.some(s => s.id === selectedId.value)) selectedId.value = items[0]?.id ?? ''; });
function preview(id: string, event?: PointerEvent) {
  if (event && event.pointerType !== 'mouse') return;
  selectedId.value = id;
}
onMounted(() => {
  if (typeof IntersectionObserver === 'undefined' || matchMedia('(prefers-reduced-motion: reduce)').matches) { entered.value = true; return; }
  try {
    observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { entered.value = true; observer?.disconnect(); }
    }, { threshold: 0 });
    if (section.value) observer.observe(section.value);
    ready.value = true;
  } catch { entered.value = true; }
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <section ref="section" class="public-section public-container story-services service-gallery" :class="{ 'gallery-ready': ready, 'gallery-entered': entered }" aria-labelledby="services-title">
    <div class="public-section-heading gallery-heading">
      <div><p class="public-eyebrow">02 / SERVICES</p><h2 id="services-title">让每一项诊疗，<br><em>都有清晰的选择。</em></h2></div>
      <p class="gallery-intro">在预约之前，先了解我们提供的诊疗服务。根据你的需求，选择合适的服务方向，从容安排就诊计划。</p>
    </div>
    <div v-if="loading" class="public-state" role="status">正在加载服务信息…</div>
    <div v-else-if="error" class="public-state" role="alert">{{ error }} <button type="button" @click="$emit('retry')">重试</button></div>
    <div v-else-if="!current" class="public-state">暂无可展示的服务项目。</div>
    <template v-else>
      <div class="gallery-layout">
        <div class="gallery-visual">
          <div class="gallery-frame">
            <Transition name="service-image">
              <img :key="current.id" :src="imageFor(current.name)" :alt="current.name + ' · 诊疗场景示意图'" decoding="async">
            </Transition>
            <span class="gallery-image-label">诊疗场景示意 · AI 生成</span>
          </div>
          <div class="gallery-caption" aria-live="polite"><span>{{ String(index + 1).padStart(2, '0') }} / {{ String(services.length).padStart(2, '0') }}</span><span>{{ current.name }}</span></div>
        </div>
        <div class="gallery-directory" role="group" aria-label="选择诊疗服务">
          <button v-for="(item, i) in services" :key="item.id" type="button" class="gallery-item" :class="{ active: current.id === item.id }" :aria-pressed="current.id === item.id" @pointerenter="preview(item.id, $event)" @focus="preview(item.id)" @click="preview(item.id)">
            <span class="gallery-index">{{ String(i + 1).padStart(2, '0') }}</span>
            <span class="gallery-item-copy"><strong>{{ item.name }}</strong><small>{{ item.description || '了解服务内容与预约安排' }}</small></span>
            <span class="gallery-arrow" aria-hidden="true">↗</span>
          </button>
        </div>
      </div>
      <div class="gallery-actions">
        <router-link class="public-text-link gallery-detail" :to="'/explore/services/' + current.id">了解{{ current.name }} <span aria-hidden="true">↗</span></router-link>
        <router-link class="public-button public-button-dark" to="/#booking">前往微信小程序预约 <span aria-hidden="true">↗</span></router-link>
      </div>
    </template>
    <div class="gallery-end" aria-hidden="true"><span></span><small>空间与照护</small><span>↓</span></div>
  </section>
</template>

<style scoped>
.service-gallery { padding-bottom:44px; }
.gallery-heading { display:grid; grid-template-columns:1.1fr .9fr; gap:10%; align-items:end; }
.gallery-heading h2 { font-size:clamp(32px,3.3vw,48px); line-height:1.45; }
.gallery-intro { max-width:420px; color:#686660; font-size:15px; line-height:1.95; }
.gallery-layout { display:grid; grid-template-columns:1.45fr 1fr; gap:clamp(32px,5vw,72px); margin-top:48px; align-items:start; }
.gallery-visual { min-width:0; }
.gallery-frame { position:relative; aspect-ratio:1.25; overflow:hidden; background:#eeece7; border-radius:3px; }
.gallery-frame img { position:absolute; inset:0; width:100%; height:100%; display:block; object-fit:cover; object-position:center; }
.gallery-image-label { position:absolute; bottom:16px; left:16px; z-index:2; padding:5px 8px; background:rgba(41,45,48,.65); color:white; font-size:10px; }
.gallery-caption { display:flex; justify-content:space-between; gap:16px; padding-top:18px; color:#77746f; font-size:12px; }
.gallery-caption > span:first-child { color:#947951; font-variant-numeric:tabular-nums; }
.gallery-directory { min-width:0; border-top:1px solid #e5e0d7; }
.gallery-item { position:relative; display:grid; grid-template-columns:32px 1fr 20px; align-items:start; gap:12px; width:100%; text-align:left; border:0; border-bottom:1px solid #e5e0d7; background:transparent; padding:24px 4px; color:#292d30; cursor:pointer; }
.gallery-item::before { content:''; position:absolute; left:0; top:0; width:32px; height:1px; background:#b79a6b; transform:scaleX(0); transform-origin:left; transition:transform .3s ease; }
.gallery-index { padding-top:4px; color:#8b8881; font-family:Georgia,serif; font-size:13px; }
.gallery-item-copy { min-width:0; }
.gallery-item strong { display:block; font-size:20px; font-weight:500; line-height:1.5; transition:transform .3s ease; }
.gallery-item small { display:block; margin-top:8px; font-size:13px; line-height:1.8; color:#77746f; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.gallery-arrow { padding-top:4px; color:#88847e; transition:transform .3s ease,color .3s ease; }
.gallery-item.active::before { transform:scaleX(1); }
.gallery-item.active .gallery-index,.gallery-item.active .gallery-arrow { color:#947951; }
.gallery-item.active strong { transform:translateX(5px); }
.gallery-item.active .gallery-arrow { transform:translateX(5px); }
.gallery-item:focus-visible { outline:2px solid #947951; outline-offset:3px; }
.gallery-actions { display:flex; align-items:center; justify-content:space-between; gap:24px; margin-top:32px; }
.gallery-detail { max-width:60%; line-height:1.8; }
.gallery-end { display:flex; align-items:center; gap:24px; margin-top:64px; color:#947951; }
.gallery-end > span:first-child { flex:1; height:1px; background:#e5d9c7; }
.gallery-end small { font-size:11px; letter-spacing:.08em; }
.service-image-enter-active { transition:opacity .6s ease,clip-path .65s cubic-bezier(.22,.61,.36,1),transform .65s ease; }
.service-image-leave-active { transition:opacity .5s ease; }
.service-image-enter-from { opacity:0; clip-path:inset(0 100% 0 0); transform:scale(1.04); }
.service-image-enter-to { opacity:1; clip-path:inset(0); transform:scale(1); }
.service-image-leave-to { opacity:0; }
.gallery-ready:not(.gallery-entered) .gallery-layout { opacity:0; transform:translateY(12px); }
.gallery-layout { transition:opacity .65s ease,transform .65s ease; }
@media(max-width:800px) {
  .gallery-heading { grid-template-columns:1fr; gap:24px; }
  .gallery-layout { grid-template-columns:1fr; gap:28px; margin-top:32px; }
  .gallery-intro { font-size:14px; }
  .gallery-item { padding:20px 4px; }
  .gallery-item strong { font-size:18px; }
  .gallery-actions { align-items:flex-start; flex-direction:column; }
  .gallery-detail { max-width:100%; }
  .gallery-actions .public-button { width:100%; }
  .gallery-end { margin-top:40px; }
}
@media(prefers-reduced-motion:reduce) {
  .service-gallery *, .service-gallery *::before { animation:none!important; transition:none!important; }
  .gallery-ready:not(.gallery-entered) .gallery-layout { opacity:1; transform:none; }
  .service-image-enter-from { opacity:1; clip-path:none; transform:none; }
}
</style>
