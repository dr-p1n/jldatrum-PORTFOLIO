/* ── Visibilidad de Pipeline · cliente ─────────────────────────────────
   El tercer instrumento. Los otros dos califican el activo; este califica
   lo que el dueño puede ver de su propio embudo, así que el resultado se
   lee en dos columnas y no en una: Fuga es el diagnóstico, Ceguera es el
   producto.

   Mismas reglas que js/scan.js, y por las mismas razones:
   · Los textos se leen de data-* con root.dataset, nunca escritos aquí.
   · Todo lo que llega del worker entra por textContent, nunca innerHTML.
   · Cero onclick. El envío se engancha aquí y el resto por delegación.
   · El estado sin dibujar lo aplica solo el JS, así que sin JS, con motion
     reducido o al imprimir, no queda nada a medio pintar.                */
(function () {
  "use strict";

  var root = document.getElementById("pipeline");
  if (!root) return;

  var form = document.getElementById("pvForm");
  var input = document.getElementById("pvUrl");
  var btn = document.getElementById("pvBtn");
  var status = document.getElementById("pvStatus");
  var errBox = document.getElementById("pvError");
  var out = document.getElementById("pvResult");
  var endpoint = root.dataset.endpoint;

  function t(key) { return root.dataset[key] || ""; }
  function fill(s, vars) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) {
      return vars && vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m;
    });
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  /* Cada escaneo lleva su generación. Una respuesta lenta de un escaneo
     que el visitante ya abandonó no puede pintar encima del siguiente. */
  var runId = 0;

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    run(input.value);
  });

  /* Un enlace ?u= corre el escaneo otra vez en vez de guardar nada, así
     que siempre muestra el sitio como está hoy y no como estaba el día
     que alguien compartió el enlace. */
  try {
    var q = new URLSearchParams(location.search).get("u");
    if (q && /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(q.trim())) {
      input.value = q.trim();
      run(q.trim());
    }
  } catch (err) { /* sin URLSearchParams no hay enlace que abrir */ }

  function run(url) {
    var id = ++runId;
    url = String(url || "").trim();
    if (!url) return;

    btn.disabled = true;
    errBox.hidden = true;
    out.hidden = true;
    out.textContent = "";
    status.hidden = false;
    status.textContent = t("scanning");

    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      /* El idioma lo declara la página, no el navegador: quien abre la
         versión en inglés quiere el informe en inglés aunque su teléfono
         esté en español. */
      body: JSON.stringify({ url: url, lang: root.dataset.lang || "es" })
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, body: j }; });
    }).then(function (res) {
      if (id !== runId) return;
      status.hidden = true;
      btn.disabled = false;
      if (!res.body || res.body.ok === false) return fail(res.body);
      render(res.body);
    }).catch(function () {
      if (id !== runId) return;
      status.hidden = true;
      btn.disabled = false;
      fail(null);
    });
  }

  function fail(body) {
    errBox.textContent = (body && body.detail) || t("genericError");
    errBox.hidden = false;
  }

  /* ── El informe ───────────────────────────────────────────────────── */
  function render(d) {
    out.textContent = "";

    if (d.readable === false) {
      out.appendChild(unreadable(d));
      out.hidden = false;
      remember(null);
      return;
    }

    out.appendChild(headline(d));
    out.appendChild(columns(d));
    out.appendChild(cost(d));
    var three = trio(d);
    if (three) out.appendChild(three);
    out.appendChild(cta());
    out.hidden = false;
    remember(d);
  }

  function headline(d) {
    var box = el("section", "pv-head");
    box.appendChild(el("div", "pv-eyebrow", t("headline")));

    var line = el("div", "pv-score");
    var g = el("span", "pv-grade", d.grade);
    g.classList.add(d.pipeline >= d.bar ? "pv-grade--ok" : "pv-grade--no");
    line.appendChild(g);
    line.appendChild(el("span", "pv-num", d.pipeline + "/100"));
    box.appendChild(line);

    box.appendChild(el("p", "pv-meta",
      fill(t("passedOf"), { n: d.passed, m: d.measured }) + " · " +
      fill(t("bar"), { n: d.bar })));
    box.appendChild(el("p", "pv-verdict", d.verdict));

    var sub = el("div", "pv-split");
    sub.appendChild(dimTile("fuga", d.fuga, d.bar));
    sub.appendChild(dimTile("ceguera", d.ceguera, d.bar));
    box.appendChild(sub);
    return box;
  }

  function dimTile(key, dim, bar) {
    var tile = el("div", "pv-tile");
    tile.appendChild(el("div", "pv-tile-label", t(key === "fuga" ? "fugaLabel" : "cegueraLabel")));
    tile.appendChild(el("div", "pv-tile-q", t(key === "fuga" ? "fugaQ" : "cegueraQ")));
    var n = el("div", "pv-tile-num", dim.score === null ? "—" : dim.score);
    if (dim.score !== null) n.classList.add(dim.score >= bar ? "pv-grade--ok" : "pv-grade--no");
    tile.appendChild(n);
    tile.appendChild(el("div", "pv-tile-meta",
      fill(t("passedOf"), { n: dim.passed, m: dim.measured })));
    return tile;
  }

  function columns(d) {
    var wrap = el("div", "pv-cols");
    ["fuga", "ceguera"].forEach(function (dim) {
      var col = el("section", "pv-col");
      col.appendChild(el("h2", "pv-col-title", t(dim === "fuga" ? "fugaLabel" : "cegueraLabel")));
      col.appendChild(el("p", "pv-col-q", t(dim === "fuga" ? "fugaQ" : "cegueraQ")));

      var list = el("ul", "pv-list");
      d.rows.filter(function (r) { return r.dimension === dim; }).forEach(function (r) {
        var li = el("li", "pv-item");
        if (!r.measured) li.classList.add("pv-item--na");
        else if (!r.pass) li.classList.add("pv-item--no");

        var head = el("div", "pv-item-head");
        var mark = el("span", "pv-mark", r.measured ? (r.pass ? "✓" : "✕") : "·");
        mark.setAttribute("aria-hidden", "true");
        head.appendChild(mark);
        head.appendChild(el("span", "sr-only",
          r.measured ? (r.pass ? t("passA11y") : t("failA11y")) : t("naA11y")));
        head.appendChild(el("span", "pv-item-title", r.title));
        li.appendChild(head);

        // La frase llana viaja solo en las fallas: es lo que se conversa,
        // y en un chequeo que pasó no hay nada que conversar.
        if (r.so) li.appendChild(el("p", "pv-item-so", r.so));
        li.appendChild(el("p", "pv-item-detail", r.detail));
        list.appendChild(li);
      });
      col.appendChild(list);
      wrap.appendChild(col);
    });
    return wrap;
  }

  /* ── El costo ─────────────────────────────────────────────────────────
     Las ocho etapas del embudo en orden, con las invisibles marcadas. Es la
     lectura entera del instrumento en una tira: dónde se puede seguir a
     alguien y dónde se apaga la luz.

     Todo sale del escaneo. No se estima nada y no se le pregunta nada al
     visitante — una proyección de "leads perdidos" sería el número inventado
     que las tres páginas prometen no tener, y la única entrada de esta
     página es la URL.

     Tres estados, no dos: una etapa que no se pudo medir queda en punto, no
     en ✕. Misma regla que la celda con guion en la comparación. */
  var STAGES = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"];

  function cost(d) {
    var by = {};
    d.rows.forEach(function (r) { by[r.id] = r; });

    var box = el("section", "pv-cost");
    box.appendChild(el("h2", "pv-cost-title", t("costTitle")));

    var list = el("ol", "pv-steps");
    var seen = 0, measured = 0, dark = null;
    STAGES.forEach(function (id) {
      var r = by[id];
      if (!r) return;
      if (r.measured) { measured++; if (r.pass) seen++; else if (!dark) dark = r; }

      var li = el("li", "pv-step");
      li.classList.add(!r.measured ? "pv-step--na" : r.pass ? "pv-step--seen" : "pv-step--dark");
      var mark = el("span", "pv-step-mark", r.measured ? (r.pass ? "✓" : "✕") : "·");
      mark.setAttribute("aria-hidden", "true");
      li.appendChild(mark);
      li.appendChild(el("span", "sr-only",
        r.measured ? (r.pass ? t("passA11y") : t("failA11y")) : t("naA11y")));
      li.appendChild(el("span", "pv-step-label", t("step" + id)));
      list.appendChild(li);
    });
    box.appendChild(list);

    box.appendChild(el("p", "pv-cost-seen", fill(t("costSeen"), { n: seen, m: measured })));
    box.appendChild(el("p", "pv-cost-line", dark
      ? fill(t("costLine"), { stage: t("stage" + dark.id) })
      : t("costClean")));

    if (d.channels && d.channels.kinds) {
      box.appendChild(el("p", "pv-cost-meta",
        fill(t("channels"), { n: d.channels.kinds, m: d.channels.destinations })));
    }
    return box;
  }

  /* ── Los tres instrumentos ────────────────────────────────────────────
     Solo si el visitante ya corrió los otros dos en esta pestaña. No se
     guarda nada en un servidor y se borra al cerrar. */
  function remember(d) {
    try {
      if (!d) return;
      sessionStorage.setItem("datrum:pipeline", JSON.stringify({
        host: d.host, score: d.pipeline, grade: d.grade
      }));
    } catch (err) { /* modo privado: el trío simplemente no aparece */ }
  }

  function readOther(key) {
    try {
      var raw = sessionStorage.getItem("datrum:" + key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) { return null; }
  }

  function trio(d) {
    var ai = readOther("ai"), sec = readOther("headers");
    if (!ai && !sec) return null;

    var box = el("section", "pv-trio");
    box.appendChild(el("h2", "pv-trio-title", t("trioTitle")));

    var grid = el("div", "pv-trio-grid");
    [[t("trioAi"), ai], [t("trioSec"), sec],
     [t("trioPipeline"), { score: d.pipeline, grade: d.grade }]].forEach(function (pair) {
      var cell = el("div", "pv-trio-cell");
      cell.appendChild(el("div", "pv-trio-label", pair[0]));
      cell.appendChild(el("div", "pv-trio-grade", pair[1] ? pair[1].grade : "—"));
      cell.appendChild(el("div", "pv-trio-num", pair[1] ? pair[1].score + "/100" : t("notRun")));
      grid.appendChild(cell);
    });
    box.appendChild(grid);

    if (ai && sec) box.appendChild(el("p", "pv-trio-line", t("trioLine")));
    return box;
  }

  function unreadable(d) {
    var box = el("section", "pv-blocked");
    box.appendChild(el("h2", "pv-blocked-title", d.title));
    box.appendChild(el("p", "pv-blocked-body", d.body));
    var a = el("a", "cs-btn-primary", t("blockedCta"));
    a.href = t("blockedHref");
    box.appendChild(a);
    return box;
  }

  function cta() {
    var box = el("section", "pv-cta");
    box.appendChild(el("p", "pv-cta-line", t("ctaLine")));
    var a = el("a", "cs-btn-primary", t("ctaBtn"));
    a.href = "https://wa.me/50765213318";
    a.rel = "noopener";
    box.appendChild(a);
    return box;
  }
})();
