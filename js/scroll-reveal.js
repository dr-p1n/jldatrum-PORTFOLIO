// ── CANVAS NODE GRAPH ──────────────────────────────────
(function() {
  const canvas = document.getElementById('bg-canvas');
  const ctx    = canvas.getContext('2d');
  const isMobile = () => window.innerWidth < 640;
  let mouse = { x: -999, y: -999 };
  let nodes = [];
  let W, H;

  class Node {
    constructor(W, H) {
      this.x  = Math.random() * W;
      this.y  = Math.random() * H;
      this.vx = (Math.random() - 0.5) * 0.8;
      this.vy = (Math.random() - 0.5) * 0.8;
      this.r  = 0.5 + Math.random() * 1.5;
      this.op = 0.2 + Math.random() * 0.5;
    }
    update(W, H) {
      this.x += this.vx;
      this.y += this.vy;
      if (this.x < 0 || this.x > W) this.vx *= -1;
      if (this.y < 0 || this.y > H) this.vy *= -1;
    }
    draw(ctx) {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(200,200,210,${this.op})`;
      ctx.fill();
    }
  }

  function init() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
    const divisor = isMobile() ? 12000 : 18000;
    const count   = Math.floor((W * H) / divisor);
    nodes = Array.from({ length: Math.min(count, 80) }, () => new Node(W, H));
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    // Node-to-node teal lines
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const d  = Math.sqrt(dx*dx + dy*dy);
        if (d < 140) {
          const alpha = (1 - d/140) * 0.35;
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.strokeStyle = `rgba(180,180,190,${alpha})`;
          ctx.lineWidth   = 0.8;
          ctx.stroke();
        }
      }
    }
    // Node-to-mouse coral lines
    for (let i = 0; i < nodes.length; i++) {
      const dx = nodes[i].x - mouse.x;
      const dy = nodes[i].y - mouse.y;
      const d  = Math.sqrt(dx*dx + dy*dy);
      if (d < 180) {
        const alpha = (1 - d/180) * 0.6;
        ctx.beginPath();
        ctx.moveTo(nodes[i].x, nodes[i].y);
        ctx.lineTo(mouse.x, mouse.y);
        ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
        ctx.lineWidth   = 0.8;
        ctx.stroke();
      }
    }
    // Draw nodes
    nodes.forEach(n => { n.update(W, H); n.draw(ctx); });
    requestAnimationFrame(draw);
  }

  window.addEventListener('mousemove', e => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });
  window.addEventListener('touchmove', e => {
    const t = e.touches[0];
    mouse.x = t.clientX;
    mouse.y = t.clientY;
  }, { passive: true });
  window.addEventListener('touchend', () => {
    mouse.x = -999;
    mouse.y = -999;
  });
  window.addEventListener('resize', init);

  init();
  draw();
})();

// ── SCROLL ANIMATIONS ──────────────────────────────────
(function() {
  const delays = {};
  document.querySelectorAll('.fade-up').forEach(el => {
    const d = el.style.getPropertyValue('--delay') || '0s';
    delays[el] = d;
  });

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

