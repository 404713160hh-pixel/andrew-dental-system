/* Small, cancellable enhancements. Every control remains usable without animation. */
(() => {
  let observer, frames = new Set(), parallaxFrame = 0;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  function stop() {
    observer?.disconnect();
    for (const frame of frames) cancelAnimationFrame(frame);
    frames.clear();
  }
  function animateCount(node) {
    const target = Number(node.dataset.count);
    if (!Number.isFinite(target) || reduced.matches || target === 0) return;
    const started = performance.now();
    const tick = now => {
      const progress = Math.min(1, (now - started) / 520);
      node.textContent = Math.round(target * (1 - Math.pow(1 - progress, 3))).toLocaleString('zh-CN');
      if (progress < 1 && node.isConnected) {
        const frame = requestAnimationFrame(tick); frames.add(frame);
      }
    };
    frames.add(requestAnimationFrame(tick));
  }
  function mount(container) {
    stop();
    const elements = [...container.querySelectorAll('.reveal')];
    if (!reduced.matches && 'IntersectionObserver' in window) {
      observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      }, {threshold: .12});
      elements.forEach(element => observer.observe(element));
    } else elements.forEach(element => element.classList.add('is-visible'));
    container.querySelectorAll('[data-count]').forEach(animateCount);
    updateParallax();
  }
  function updateParallax() {
    const image = document.querySelector('[data-parallax]');
    if (!image) return;
    if (reduced.matches || window.innerWidth < 850) { image.style.removeProperty('--parallax'); return; }
    const bounds = image.closest('.customer-hero')?.getBoundingClientRect();
    if (!bounds || bounds.bottom < 0) return;
    image.style.setProperty('--parallax', `${Math.max(-16, Math.min(16, -bounds.top * .04))}px`);
  }
  window.addEventListener('scroll', () => {
    if (parallaxFrame) return;
    parallaxFrame = requestAnimationFrame(() => { parallaxFrame = 0; updateParallax(); });
  }, {passive:true});
  reduced.addEventListener?.('change', () => {
    stop();
    document.querySelectorAll('[data-count]').forEach(node => {node.textContent=Number(node.dataset.count).toLocaleString('zh-CN');});
    document.querySelectorAll('.reveal').forEach(node => node.classList.add('is-visible'));
    updateParallax();
  });
  window.DentalMotion = {mount};
})();
