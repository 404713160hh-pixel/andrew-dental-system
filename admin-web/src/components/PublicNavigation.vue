<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const items = [
  { key: 'home', label: '首页', to: '/' },
  { key: 'services', label: '诊疗服务', to: '/explore/services' },
  { key: 'doctors', label: '医生团队', to: '/explore/doctors' },
  { key: 'clinics', label: '门诊信息', to: '/explore/clinics' },
  { key: 'about', label: '关于我们', to: '/#about' },
  { key: 'login', label: '员工登录', to: '/login' },
];
const home = computed(() => route.path === '/');
const mobile = ref(window.matchMedia('(max-width: 800px)').matches);
const compact = ref(window.scrollY > 36);
const menu = ref(false);
const observedSection = ref('home');
const hoveredKey = ref('');
const focusedKey = ref('');
const links = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const drawer = ref<HTMLElement | null>(null);
const indicator = ref({ left: 0, top: 0, width: 0, visible: false });
let viewportQuery: MediaQueryList;
let sectionObserver: IntersectionObserver | undefined;
let sizeObserver: ResizeObserver | undefined;
let indicatorFrame = 0;
let disposed = false;
let unlockScroll: (() => void) | undefined;
let returnFocus: HTMLElement | null = null;

const activeKey = computed(() => {
  if (home.value) return observedSection.value;
  return items.find(item => item.key !== 'home' && item.key !== 'about' && route.path.startsWith(item.to))?.key || '';
});
const indicatorStyle = computed(() => ({
  transform: `translate3d(${indicator.value.left}px, ${indicator.value.top}px, 0)`,
  width: `${indicator.value.width}px`,
}));
function updateIndicator() {
  indicatorFrame = 0;
  const nav = links.value;
  const key = hoveredKey.value || focusedKey.value || activeKey.value;
  const target = nav?.querySelector<HTMLElement>(`[data-nav-key="${key}"]`);
  if (!nav || !target || mobile.value) {
    indicator.value = { ...indicator.value, visible: false };
    return;
  }
  const parent = nav.getBoundingClientRect();
  const bounds = target.getBoundingClientRect();
  indicator.value = { left: bounds.left - parent.left, top: bounds.bottom - parent.top - 4, width: bounds.width, visible: true };
}
function queueIndicator() {
  if (!indicatorFrame && !disposed) indicatorFrame = requestAnimationFrame(updateIndicator);
}
function onScroll() {
  if (menu.value) return;
  const next = window.scrollY > 36;
  if (compact.value !== next) compact.value = next;
}
function syncViewport() {
  mobile.value = viewportQuery.matches;
  if (!mobile.value) closeMenu();
  queueIndicator();
}
function setObservedSection() {
  sectionObserver?.disconnect();
  observedSection.value = 'home';
  if (!home.value || disposed) return;
  const about = document.getElementById('about');
  const booking = document.getElementById('booking');
  if (typeof IntersectionObserver === 'undefined') {
    observedSection.value = route.hash === '#about' ? 'about' : route.hash === '#booking' ? 'booking' : 'home';
    return;
  }
  const visible = new Set<string>();
  sectionObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) visible.add(entry.target.id);
      else visible.delete(entry.target.id);
    }
    observedSection.value = visible.has('booking') ? 'booking' : visible.has('about') ? 'about' : 'home';
  }, { rootMargin: '-20% 0px -50% 0px', threshold: 0 });
  if (about) sectionObserver.observe(about);
  if (booking) sectionObserver.observe(booking);
}
function lockBackground() {
  const surface = document.querySelector<HTMLElement>('.public-site');
  const wasInert = surface?.inert || false;
  const y = window.scrollY;
  const body = document.body;
  const properties = ['position', 'top', 'left', 'right', 'width', 'overflow', 'padding-right'];
  const saved = properties.map(name => [name, body.style.getPropertyValue(name), body.style.getPropertyPriority(name)]);
  const scrollbar = window.innerWidth - document.documentElement.clientWidth;
  const padding = Number.parseFloat(getComputedStyle(body).paddingRight) || 0;
  body.style.position = 'fixed';
  body.style.top = `-${y}px`;
  body.style.left = '0';
  body.style.right = '0';
  body.style.width = '100%';
  body.style.overflow = 'hidden';
  if (scrollbar) body.style.paddingRight = `${padding + scrollbar}px`;
  if (surface) surface.inert = true;
  unlockScroll = () => {
    for (const [name, value, priority] of saved) {
      if (value) body.style.setProperty(name, value, priority);
      else body.style.removeProperty(name);
    }
    if (surface) surface.inert = wasInert;
    window.scrollTo({ top: y, behavior: 'instant' });
  };
}
function focusableItems() {
  return Array.from(drawer.value?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),[tabindex="0"]') || [])
    .filter(element => element.getClientRects().length > 0);
}
function onMenuKey(event: KeyboardEvent) {
  if (!menu.value) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeMenu();
  } else if (event.key === 'Tab') {
    const all = focusableItems();
    const first = all[0];
    const last = all[all.length - 1];
    if (!first) { event.preventDefault(); drawer.value?.focus(); return; }
    if (event.shiftKey && (document.activeElement === first || !drawer.value?.contains(document.activeElement))) {
      event.preventDefault(); last?.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !drawer.value?.contains(document.activeElement))) {
      event.preventDefault(); first.focus();
    }
  }
}
function closeMenu() { menu.value = false; }
function onLogoClick(event: MouseEvent) {
  closeMenu();
  if (home.value && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
}
watch(menu, open => {
  if (open) {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : trigger.value;
    lockBackground();
    document.addEventListener('keydown', onMenuKey);
  } else {
    document.removeEventListener('keydown', onMenuKey);
    unlockScroll?.();
    unlockScroll = undefined;
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
    onScroll();
  }
}, { flush: 'sync' });
watch(drawer, element => {
  if (element && menu.value) focusableItems()[0]?.focus({ preventScroll: true });
}, { flush: 'post' });
watch([hoveredKey, focusedKey, activeKey, compact], queueIndicator);
watch(links, (element, previous) => {
  if (previous) sizeObserver?.unobserve(previous);
  if (element) sizeObserver?.observe(element);
  void nextTick(queueIndicator);
});
watch(() => route.fullPath, () => {
  closeMenu();
  hoveredKey.value = '';
  focusedKey.value = '';
  void nextTick(() => { if (!disposed) { setObservedSection(); queueIndicator(); } });
});
onMounted(() => {
  viewportQuery = window.matchMedia('(max-width: 800px)');
  viewportQuery.addEventListener('change', syncViewport);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', queueIndicator, { passive: true });
  if (typeof ResizeObserver !== 'undefined') {
    sizeObserver = new ResizeObserver(queueIndicator);
    if (links.value) sizeObserver.observe(links.value);
  }
  void nextTick(() => { setObservedSection(); queueIndicator(); });
  void document.fonts?.ready.then(() => { if (!disposed) queueIndicator(); });
});
onBeforeUnmount(() => {
  disposed = true;
  viewportQuery?.removeEventListener('change', syncViewport);
  window.removeEventListener('scroll', onScroll);
  window.removeEventListener('resize', queueIndicator);
  document.removeEventListener('keydown', onMenuKey);
  sectionObserver?.disconnect();
  sizeObserver?.disconnect();
  if (indicatorFrame) cancelAnimationFrame(indicatorFrame);
  unlockScroll?.();
});
</script>

<template>
  <div class="public-navigation-slot" :class="{ 'menu-is-open': menu }">
    <header class="public-header public-navigation" :class="{ 'is-scrolled': compact, 'is-home': home }">
      <router-link to="/" class="public-brand" @click="onLogoClick">ANDREW <span>DENTAL</span><small>安德鲁牙科</small></router-link>
      <nav v-if="!mobile" id="public-nav" ref="links" class="public-nav" aria-label="网站导航" @pointerleave="hoveredKey = ''">
        <router-link v-for="item in items" :key="item.key" :to="item.to" :data-nav-key="item.key"
          :class="{ 'public-nav-login': item.key === 'login', 'is-current': activeKey === item.key }"
          :aria-current="activeKey === item.key ? (home ? 'location' : 'page') : undefined"
          @pointerenter="hoveredKey = item.key" @focus="focusedKey = item.key" @blur="focusedKey = ''">{{ item.label }}</router-link>
        <span class="public-nav-indicator" :class="{ 'is-visible': indicator.visible }" :style="indicatorStyle" aria-hidden="true"></span>
        <router-link class="public-button public-button-dark public-nav-cta" :class="{ 'is-current': activeKey === 'booking' }" :aria-current="activeKey === 'booking' ? 'location' : undefined" to="/#booking">微信小程序预约 <span aria-hidden="true">↗</span></router-link>
      </nav>
      <button v-else ref="trigger" class="public-menu-button" type="button" :aria-label="menu ? '收起网站导航' : '展开网站导航'" :aria-expanded="menu" :aria-controls="menu ? 'public-mobile-nav' : undefined" aria-haspopup="dialog" @click="menu = !menu">
        <span class="public-menu-glyph" :class="{ 'is-open': menu }" aria-hidden="true"><i></i><i></i></span><span>菜单</span>
      </button>
    </header>
  </div>
  <Teleport to="body">
    <Transition name="public-drawer">
      <div v-if="mobile && menu" class="public-navigation-menu">
        <div class="public-menu-backdrop" aria-hidden="true" @click="closeMenu"></div>
        <section id="public-mobile-nav" ref="drawer" class="public-mobile-drawer" role="dialog" aria-modal="true" aria-label="网站导航" tabindex="-1">
          <div class="public-mobile-heading"><span>ANDREW <span>DENTAL</span><small>安德鲁牙科</small></span><button class="public-drawer-close" type="button" aria-label="收起网站导航" @click="closeMenu"><span class="public-menu-glyph is-open" aria-hidden="true"><i></i><i></i></span></button></div>
          <nav aria-label="网站导航菜单">
            <router-link v-for="(item, index) in items" :key="item.key" :to="item.to" :class="{ 'is-current': activeKey === item.key }" :aria-current="activeKey === item.key ? (home ? 'location' : 'page') : undefined" :style="{ '--item-index': index }" @click="closeMenu">{{ item.label }}<span aria-hidden="true">↗</span></router-link>
          </nav>
          <router-link class="public-mobile-cta" :class="{ 'is-current': activeKey === 'booking' }" :aria-current="activeKey === 'booking' ? 'location' : undefined" to="/#booking" @click="closeMenu">微信小程序预约<span aria-hidden="true">↗</span></router-link>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
