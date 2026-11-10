<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue';
import { usePublicReveal } from '../composables/usePublicReveal';
import treatment from '../assets/treatment-room.jpg';
import reception from '../assets/reception.jpg';
import lounge from '../assets/clinic-hero.jpg';
const root = ref<HTMLElement | null>(null);
const { enabled, backgrounded, revealAll } = usePublicReveal(root);
const spaces = [
  { image: treatment, title: '诊疗空间', description: '提前熟悉就诊空间，让到访更从容。' },
  { image: reception, title: '接待空间', description: '从接待开始，了解本次就诊安排。' },
  { image: lounge, title: '候诊一角', description: '自然光与安静的空间，留一点时间给自己。' },
];
const selected = ref(0);
const dialog = ref<HTMLDialogElement | null>(null);
let returnFocus: HTMLElement | null = null;
let bodyOverflow: string | null = null;
function close() { dialog.value?.close(); restore(); }
function restore() {
  if (bodyOverflow !== null) document.body.style.overflow = bodyOverflow;
  bodyOverflow = null; returnFocus?.focus(); returnFocus = null;
}
async function open() {
  returnFocus = document.activeElement as HTMLElement;
  await nextTick(); dialog.value?.showModal();
  bodyOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
}
onBeforeUnmount(() => { if (bodyOverflow !== null) document.body.style.overflow = bodyOverflow; });
</script>
<template>
  <section id="environment" ref="root" class="tail-section clinic-environment" :class="{ 'reveal-enabled': enabled, 'is-backgrounded': backgrounded }" aria-labelledby="environment-title" @focusin="revealAll">
    <div class="public-container">
      <div data-reveal class="tail-heading"><div><p class="public-eyebrow">03 / OUR SPACES</p><h2 id="environment-title">先认识空间，<br><em>再从容到访。</em></h2></div><p>从接待到候诊，再到诊疗。让每一步都有熟悉的起点。</p></div>
      <div data-reveal class="space-stage">
        <button class="space-expand" type="button" :aria-label="'放大查看' + spaces[selected].title" @click="open">
          <Transition name="tail-image"><div :key="selected" class="tail-photo-pan"><img :src="spaces[selected].image" :alt="spaces[selected].title + '，AI 生成空间示意'" loading="lazy"></div></Transition>
          <span class="space-overlay"><span>{{ spaces[selected].title }}</span><span>放大查看 ↗</span></span>
        </button>
        <p class="space-credit">空间素材均为 AI 生成示意，具体门诊信息见门诊详情。</p>
      </div>
      <div data-reveal class="space-selector" role="group" aria-label="选择空间图片">
        <button v-for="(space, index) in spaces" :key="space.title" type="button" :aria-pressed="selected === index" :class="{ active: selected === index }" @click="selected = index"><img :src="space.image" alt="" loading="lazy"><span><small>0{{ index + 1 }}</small><strong>{{ space.title }}</strong><span>{{ space.description }}</span></span></button>
      </div>
      <div data-reveal class="tail-section-end"><router-link to="/explore/clinics" class="public-text-link">查看门诊地址与营业时间 ↗</router-link><span>接下来，认识医生团队 ↓</span></div>
    </div>
    <dialog ref="dialog" class="space-dialog" aria-label="诊所空间大图" @close="restore" @click="($event.target === dialog) && close()">
      <button type="button" class="space-close" aria-label="关闭空间大图" @click="close">关闭 ×</button><img :src="spaces[selected].image" :alt="spaces[selected].title + '，AI 生成示意'"><p>{{ spaces[selected].title }} · AI 生成空间示意</p>
    </dialog>
  </section>
</template>
