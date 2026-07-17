// ── SCROLL ANIMATIONS ──────────────────────────────────
(function() {
  const heroObs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        const d = e.target.style.getPropertyValue('--delay') || '0s';
        e.target.style.animationDelay = d;
        e.target.classList.add('visible');
        heroObs.unobserve(e.target);
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.fade-up').forEach(el => heroObs.observe(el));

  // Metrics strip
  const metricObs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        const d = e.target.style.getPropertyValue('--delay') || '0s';
        e.target.style.animationDelay = d;
        e.target.classList.add('visible');
        metricObs.unobserve(e.target);
      }
    });
  }, { threshold: 0.2 });
  document.querySelectorAll('.metric-cell').forEach(el => metricObs.observe(el));

})();
