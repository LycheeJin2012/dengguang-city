// v50: scroll reveal — IntersectionObserver 进入视口时加 .is-visible
export function bindReveal() {
  const els = document.querySelectorAll('.section, .card, .stat-card');
  if (!('IntersectionObserver' in window)) {
    els.forEach(e => e.classList.add('is-visible'));
    return;
  }
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('is-visible');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.05, rootMargin: '50px' });
  els.forEach(e => io.observe(e));
}
