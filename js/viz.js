// ── DATRUM viz layer ───────────────────────────────────
// Icons + charts, dependency-free vanilla SVG. Loaded on every page.
//
// ⚠ NEVER fork this file per language. Translated strings live in
//    markup via data-labels="A|B|C". js/scorecard.es.js is the
//    standing example of what forking costs.
//
// Markup contract:
//   <span class="dx-icon" data-icon="shield" aria-hidden="true"></span>
//   add data-scroll to animate once when scrolled into view
//
// Motion contract: the undrawn state is applied ONLY by adding
// .dx-anim here. If JS never runs, or reduced motion is on, or the
// observer never fires, graphics render COMPLETE. See css/viz.css.
(function () {
  'use strict';

  var REDUCE = window.matchMedia &&
               window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Icon registry ────────────────────────────────────
  // Matches the existing .feature-icon vocabulary exactly:
  // viewBox 0 0 24 24, fill none, stroke currentColor, width 1.6, round caps.
  var ICONS = {
    // compliance / Ley 81
    shield: '<path d="M12 3l7 3v5.5c0 4.2-2.9 7.6-7 8.5-4.1-.9-7-4.3-7-8.5V6z"/>' +
            '<path d="M9 12l2 2 4-4"/>',
    // security headers
    lock:   '<rect x="4.5" y="10.5" width="15" height="9.5" rx="2"/>' +
            '<path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><path d="M12 14.5v2"/>',
    // AI visibility / machine legibility
    mesh:   '<circle cx="12" cy="5"/><circle cx="5" cy="16"/><circle cx="19" cy="16"/>' +
            '<circle cx="12" cy="12.5"/>' +
            '<path d="M12 5v7.5M12 12.5L5 16M12 12.5L19 16M5 16h14"/>',
    // bilingual
    globe:  '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/>' +
            '<path d="M12 3.5c2.2 2.3 3.4 5.3 3.4 8.5S14.2 18.2 12 20.5"/>' +
            '<path d="M12 3.5C9.8 5.8 8.6 8.8 8.6 12s1.2 6.2 3.4 8.5"/>',
    // scored instruments
    gauge:  '<path d="M4 16.5a8.5 8.5 0 1 1 16 0"/><path d="M12 16.5l4.2-4.6"/>' +
            '<circle cx="12" cy="16.5" r="1.2"/>',
    // conversion / lead flow
    bars:   '<path d="M5 19v-5"/><path d="M10 19V8"/><path d="M15 19v-8"/><path d="M20 19V5"/>',

    // ── service / method marks (same language: 24px, 1.6 stroke, round) ──
    // product design — stacked artifacts
    layers: '<path d="M12 3l8 4.5-8 4.5-8-4.5z"/><path d="M4 12l8 4.5 8-4.5"/><path d="M4 16.5L12 21l8-4.5"/>',
    // strategy / positioning
    compass:'<circle cx="12" cy="12" r="8.5"/><path d="M15 9l-2.2 5.2L7.6 16l2.2-5.2z"/>',
    // website design
    window: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9h17"/>',
    // web app / app development
    app:    '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M10.8 5.4h2.4"/><path d="M11 18.6h2"/>',
    // heading / information architecture
    hierarchy:'<rect x="9.5" y="2.8" width="5" height="4" rx="1"/>' +
              '<rect x="3" y="17.2" width="5" height="4" rx="1"/>' +
              '<rect x="16" y="17.2" width="5" height="4" rx="1"/>' +
              '<path d="M12 6.8v5.4M5.5 17.2v-2.7h13v2.7"/>',
    // utility
    chevron:'<path d="M6 9.5l6 6 6-6"/>'
  };

  function iconSVG(name) {
    var body = ICONS[name];
    if (!body) return '';
    // mesh uses bare <circle cx cy> — supply the shared r once here
    body = body.replace(/<circle cx="(\d+)" cy="([\d.]+)"\/>/g,
                        '<circle cx="$1" cy="$2" r="1.7"/>');
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
           'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ' +
           'aria-hidden="true" focusable="false">' + body + '</svg>';
  }

  // ── Helpers ──────────────────────────────────────────
  function labels(el) {
    var s = el.getAttribute('data-labels');
    return s ? s.split('|').map(function (x) { return x.trim(); }) : [];
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function svgWrap(vb, inner) {
    return '<svg viewBox="' + vb + '" role="img" focusable="false">' + inner + '</svg>';
  }
  // SVG <text> does not wrap. Split on words so long labels become tspans
  // instead of running past the edge of the graphic.
  function wrapWords(s, max) {
    var words = String(s).split(/\s+/), lines = [], cur = '';
    words.forEach(function (w) {
      var t = cur ? cur + ' ' + w : w;
      if (t.length > max && cur) { lines.push(cur); cur = w; } else { cur = t; }
    });
    if (cur) lines.push(cur);
    return lines;
  }
  // path length without touching the DOM twice
  function lineLen(x1, y1, x2, y2) {
    return Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
  }

  // ── Renderers ────────────────────────────────────────
  var R = {};

  // Credential node graph — AG Law
  R.nodes = function (el) {
    var L = labels(el), hub = el.getAttribute('data-hub') || '', inner = '';
    var cx = 210, cy = 140, R0 = 96, n = L.length || 5, d = 0;
    var pos = [];
    for (var i = 0; i < n; i++) {
      var a = -Math.PI / 2 + i * (2 * Math.PI / n);
      pos.push([cx + Math.cos(a) * R0, cy + Math.sin(a) * R0 * 0.82]);
    }
    pos.forEach(function (p) {
      var len = lineLen(cx, cy, p[0], p[1]);
      inner += '<line class="dx-line dx-draw" x1="' + cx + '" y1="' + cy + '" x2="' + p[0].toFixed(1) +
               '" y2="' + p[1].toFixed(1) + '" style="--dx-len:' + len.toFixed(0) + ';--dx-d:' + d + 'ms"/>';
      d += 110;
    });
    inner += '<circle class="dx-node dx-node--hub dx-pop" cx="' + cx + '" cy="' + cy + '" r="9" style="--dx-d:0ms"/>';
    if (hub) inner += '<text class="dx-t-strong" x="' + cx + '" y="' + (cy + 26) + '" text-anchor="middle">' + esc(hub) + '</text>';
    d = 110;
    pos.forEach(function (p, i) {
      inner += '<circle class="dx-node dx-pop" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) +
               '" r="6.5" style="--dx-d:' + d + 'ms"/>';
      var anchor = Math.abs(p[0] - cx) < 8 ? 'middle' : (p[0] > cx ? 'start' : 'end');
      var ox = anchor === 'middle' ? 0 : (p[0] > cx ? 12 : -12);
      // Labels wrap. Unwrapped, a long one (e.g. "Cross-border commercial") runs past
      // the viewBox and .cs-figure clips it with overflow:hidden.
      var lines = wrapWords(L[i], 14), tx = (p[0] + ox).toFixed(1);
      var ty = (p[1] + 3.5 - (lines.length - 1) * 6).toFixed(1);
      inner += '<text class="dx-pop" x="' + tx + '" y="' + ty + '" text-anchor="' + anchor +
               '" style="--dx-d:' + d + 'ms">' +
               lines.map(function (ln, k) {
                 return '<tspan x="' + tx + '" dy="' + (k ? 13 : 0) + '">' + esc(ln) + '</tspan>';
               }).join('') + '</text>';
      d += 110;
    });
    el.innerHTML = svgWrap('0 0 420 300', inner);
  };

  // Timeline — UCC, 25 years. Draws left to right (enacts duration).
  R.timeline = function (el) {
    var marks = (el.getAttribute('data-marks') || '').split('|').filter(Boolean);
    var x0 = 40, x1 = 840, y = 70, inner = '';
    inner += '<line class="dx-accent dx-draw" x1="' + x0 + '" y1="' + y + '" x2="' + x1 + '" y2="' + y +
             '" style="--dx-len:' + (x1 - x0) + ';--dx-d:0ms"/>';
    marks.forEach(function (m, i) {
      var parts = m.split(':'), lab = parts[0].trim(), txt = (parts[1] || '').trim();
      var f = marks.length > 1 ? i / (marks.length - 1) : 0;
      var x = x0 + (x1 - x0) * f;
      var delay = Math.round(f * 900) + 120;   // labels trail the advancing line
      inner += '<line class="dx-axis dx-pop" x1="' + x.toFixed(1) + '" y1="' + (y - 9) + '" x2="' + x.toFixed(1) +
               '" y2="' + (y + 9) + '" style="--dx-d:' + delay + 'ms"/>';
      inner += '<text class="dx-t-accent dx-pop" x="' + x.toFixed(1) + '" y="' + (y - 20) +
               '" text-anchor="middle" style="--dx-d:' + delay + 'ms">' + esc(lab) + '</text>';
      if (txt) inner += '<text class="dx-pop" x="' + x.toFixed(1) + '" y="' + (y + 30) +
               '" text-anchor="middle" style="--dx-d:' + delay + 'ms">' + esc(txt) + '</text>';
    });
    el.innerHTML = svgWrap('0 0 880 140', inner);
  };

  // Step flow — Obstacle Race registration
  R.flow = function (el) {
    var S = labels(el), inner = '', bw = 160, bh = 64, gap = 36, y = 28;
    S.forEach(function (s, i) {
      var x = i * (bw + gap);
      inner += '<rect class="dx-box dx-pop" x="' + x + '" y="' + y + '" width="' + bw + '" height="' + bh +
               '" rx="8" style="--dx-d:' + (i * 140) + 'ms"/>';
      inner += '<text class="dx-t-strong dx-pop" x="' + (x + bw / 2) + '" y="' + (y + bh / 2 + 4) +
               '" text-anchor="middle" style="--dx-d:' + (i * 140) + 'ms">' + esc(s) + '</text>';
      if (i < S.length - 1) {
        var ax = x + bw, len = gap;
        inner += '<path class="dx-accent dx-draw" d="M' + ax + ' ' + (y + bh / 2) + 'h' + gap + '" ' +
                 'style="--dx-len:' + len + ';--dx-d:' + (i * 140 + 70) + 'ms"/>';
        inner += '<path class="dx-accent dx-pop" d="M' + (ax + gap - 6) + ' ' + (y + bh / 2 - 4) + 'l5 4-5 4" ' +
                 'style="--dx-d:' + (i * 140 + 140) + 'ms"/>';
      }
    });
    var w = S.length * bw + (S.length - 1) * gap;
    el.innerHTML = svgWrap('0 0 ' + w + ' 120', inner);
  };

  // Bilingual channel split — Seguros Corco. Static, no motion.
  R.split = function (el) {
    var L = labels(el);   // buyer | branchA | branchB
    var inner = '', cx = 90, cy = 120;
    inner += '<rect class="dx-box" x="10" y="' + (cy - 26) + '" width="160" height="52" rx="8"/>';
    inner += '<text class="dx-t-strong" x="90" y="' + (cy + 4) + '" text-anchor="middle">' + esc(L[0] || '') + '</text>';
    [[60, 'dx-accent'], [180, 'dx-line']].forEach(function (cfg, i) {
      var ty = cfg[0];
      inner += '<path class="' + cfg[1] + '" d="M170 ' + cy + ' C 240 ' + cy + ', 260 ' + ty + ', 330 ' + ty + '"/>';
      inner += '<rect class="dx-box" x="330" y="' + (ty - 26) + '" width="200" height="52" rx="8"/>';
      inner += '<text class="' + (i === 0 ? 'dx-t-accent' : 'dx-t-strong') + '" x="430" y="' + (ty + 4) +
               '" text-anchor="middle">' + esc(L[i + 1] || '') + '</text>';
    });
    el.innerHTML = svgWrap('0 0 640 240', inner);
  };

  // Flywheel — Method / Growth engines. The ONE looping animation.
  // Labels sit in an HTML legend BELOW the ring, never radially around it:
  // radial text cannot fit a narrow column and escapes the card. Real text
  // also wraps, translates and stays selectable.
  R.flywheel = function (el) {
    var L = labels(el), cx = 180, cy = 128, r = 52, inner = '';
    // spinning group: dashed arcs only, so no text ever rotates
    // stroke goes in style, not an attribute: .dx-grid's stroke would win over it
    inner += '<g class="dx-spin">' +
             '<circle class="dx-grid" cx="' + cx + '" cy="' + cy + '" r="' + r + '" ' +
             'stroke-dasharray="6 10" style="stroke:var(--teal, #1E7F98)"/>' +
             '<circle class="dx-grid" cx="' + cx + '" cy="' + cy + '" r="' + (r - 12) + '" ' +
             'stroke-dasharray="3 12" style="stroke:var(--lemon, #F2D24B);opacity:0.55"/>' +
             '</g>';
    // Labels sit at fixed anchors inside a viewBox wide enough to hold them, and
    // wrap onto a second line. Radial x/y positioning with unwrapped text is what
    // previously pushed a label outside the card.
    var slots = [{ x: 180, y: 34 }, { x: 268, y: 196 }, { x: 92, y: 196 }];
    for (var k = 0; k < 3; k++) {
      var a = -Math.PI / 2 + k * (2 * Math.PI / 3);
      var x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      // arrowhead sits between nodes so the cycle still reads when animation is off
      var am = a + Math.PI / 3;
      var ax = cx + Math.cos(am) * r, ay = cy + Math.sin(am) * r;
      inner += '<path class="dx-accent" d="M' + (ax - 4).toFixed(1) + ' ' + (ay - 5).toFixed(1) +
               'l5 5-5 5" transform="rotate(' + ((am * 180 / Math.PI) + 90).toFixed(1) + ' ' +
               ax.toFixed(1) + ' ' + ay.toFixed(1) + ')"/>';
      inner += '<circle class="dx-node dx-node--hub" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="6"/>';
      if (L[k]) {
        var s = slots[k], lines = wrapWords(L[k], 15);
        inner += '<text class="dx-t-strong" x="' + s.x + '" y="' + s.y + '" text-anchor="middle">' +
          lines.map(function (ln, i) {
            return '<tspan x="' + s.x + '" dy="' + (i ? 14 : 0) + '">' + esc(ln) + '</tspan>';
          }).join('') + '</text>';
      }
    }
    // height leaves room for a three-line label (the ES copy needs it)
    el.innerHTML = svgWrap('0 0 360 244', inner);
  };

  // ── Observer (one pass, never replays) ───────────────
  var io = ('IntersectionObserver' in window) ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('is-drawn');
      io.unobserve(e.target);
    });
  }, { threshold: 0.25 }) : null;

  // ── Scan ─────────────────────────────────────────────
  function scan(root) {
    root = root || document;

    root.querySelectorAll('.dx-icon[data-icon]:not([data-dx-on])').forEach(function (el) {
      el.setAttribute('data-dx-on', '');
      el.innerHTML = iconSVG(el.getAttribute('data-icon'));
    });

    root.querySelectorAll('[data-viz]:not([data-dx-on])').forEach(function (el) {
      var fn = R[el.getAttribute('data-viz')];
      if (!fn) return;
      el.setAttribute('data-dx-on', '');
      fn(el);
      if (el.hasAttribute('data-scroll')) {
        if (REDUCE || !io) { el.classList.add('is-drawn'); return; }
        el.classList.add('dx-anim');
        io.observe(el);
      }
    });
  }

  // Re-scan when a tab becomes visible. Inside a display:none subtree
  // IntersectionObserver never fires AND CSS animations do not run —
  // without this the Method flywheel stays frozen forever.
  document.addEventListener('tab:activate', function () { scan(); });

  // ── Home router (#offer) ─────────────────────────────
  // Hover/focus expands one panel and compresses the other two.
  // Lives here so it needs no extra <script> on any page; it simply
  // early-returns everywhere #router is absent.
  function initRouter() {
    var wrap = document.getElementById('router');
    if (!wrap || wrap.hasAttribute('data-router-on')) return;
    wrap.setAttribute('data-router-on', '');

    var mq = window.matchMedia('(max-width: 820px)');
    var panels = Array.prototype.slice.call(wrap.querySelectorAll('.router-panel'));

    function setActive(active) {
      if (mq.matches) active = null;     // stacked layout: everything stays expanded
      panels.forEach(function (p) {
        p.classList.toggle('is-active', p === active);
        p.classList.toggle('is-dimmed', active !== null && p !== active);
      });
    }

    // Listeners are always attached and the media query is consulted at event
    // time. Returning early on load instead would leave the router dead for
    // anyone who loads narrow and then widens the window.
    panels.forEach(function (p) {
      p.addEventListener('mouseenter', function () { setActive(p); });
      p.addEventListener('focus', function () { setActive(p); });
    });
    wrap.addEventListener('mouseleave', function () { setActive(null); });
    wrap.addEventListener('focusout', function (e) {
      if (!wrap.contains(e.relatedTarget)) setActive(null);
    });

    function sync() {
      // .router-js collapses the panel bodies; only opt in on the wide layout,
      // so no-JS and narrow viewports both keep every body readable.
      wrap.classList.toggle('router-js', !mq.matches);
      if (mq.matches) setActive(null);
    }
    if (mq.addEventListener) mq.addEventListener('change', sync);
    else if (mq.addListener) mq.addListener(sync);
    sync();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { scan(); initRouter(); });
  } else {
    scan(); initRouter();
  }

  window.DXViz = { scan: scan, reduce: REDUCE, icons: ICONS };
})();
