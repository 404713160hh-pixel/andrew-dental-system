import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

/** Local, finite entrances; normal document scrolling remains the only scroll owner. */
export function usePublicReveal(root: Ref<HTMLElement | null>) {
  const enabled = ref(false);
  const backgrounded = ref(false);
  let observer: IntersectionObserver | undefined;
  let mutations: MutationObserver | undefined;
  const observed = new WeakSet<Element>();
  let query: MediaQueryList;
  let visible = false;
  let frame = 0;
  let listening = false;
  const revealAll = () => root.value?.querySelectorAll('[data-reveal]').forEach(e => e.classList.add('has-entered'));
  function register() {
    root.value?.querySelectorAll<HTMLElement>('[data-reveal]').forEach((e, i) => {
      if (observed.has(e)) return;
      observed.add(e); e.style.setProperty('--entry-delay', Math.min(i * 80, 240) + 'ms'); observer?.observe(e);
    });
  }
  function render() {
    frame = 0;
    if (!root.value || document.hidden || query.matches) return;
    const rect = root.value.getBoundingClientRect();
    const progress = (innerHeight / 2 - rect.top - rect.height / 2) / Math.max(innerHeight + rect.height, 1);
    root.value.style.setProperty('--section-image-y', Math.max(-12, Math.min(12, progress * 24)).toFixed(2) + 'px');
  }
  function queue() { if (!frame && listening) frame = requestAnimationFrame(render); }
  function stop() {
    removeEventListener('scroll', queue); removeEventListener('resize', queue);
    listening = false; if (frame) cancelAnimationFrame(frame); frame = 0;
  }
  function sync() {
    backgrounded.value = document.hidden;
    if (!query.matches && observer) enabled.value = true;
    if (query.matches || !observer) {
      enabled.value = false; revealAll(); stop(); root.value?.style.setProperty('--section-image-y', '0px');
    } else if (visible && !document.hidden) {
      if (!listening) { listening = true; addEventListener('scroll', queue, { passive: true }); addEventListener('resize', queue, { passive: true }); }
      queue();
      root.value?.querySelectorAll<HTMLElement>('[data-reveal]').forEach(e => {
        const r = e.getBoundingClientRect(); if (r.top < innerHeight && r.bottom > 0) e.classList.add('has-entered');
      });
    } else stop();
  }
  onMounted(() => {
    query = matchMedia('(prefers-reduced-motion: reduce)');
    try {
      if (typeof IntersectionObserver !== 'undefined' && root.value) {
        observer = new IntersectionObserver(entries => {
          for (const entry of entries) {
            if (entry.target === root.value) visible = entry.isIntersecting;
            else if (entry.isIntersecting && !document.hidden) entry.target.classList.add('has-entered');
          }
          sync();
        }, { threshold: 0, rootMargin: '0px 0px -5% 0px' });
        observer.observe(root.value);
        register();
        mutations = new MutationObserver(register);
        mutations.observe(root.value, { childList: true, subtree: true });
        enabled.value = !query.matches;
      }
    } catch { observer?.disconnect(); observer = undefined; }
    query.addEventListener('change', sync); document.addEventListener('visibilitychange', sync); sync();
  });
  onBeforeUnmount(() => { observer?.disconnect(); mutations?.disconnect(); stop(); query?.removeEventListener('change', sync); document.removeEventListener('visibilitychange', sync); });
  return { enabled, backgrounded, revealAll };
}
