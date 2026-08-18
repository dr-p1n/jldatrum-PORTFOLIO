/* ─────────────────────────────────────────────────────────
   AI Visibility Scanner — client
   Single file for both languages. Every visible string comes from a
   data-* attribute on the page, following the viz.js contract:
   never fork a script per language.

   With JS off the form is inert but the page still reads as an
   explanation of what the instrument measures — never blank.
   ───────────────────────────────────────────────────────── */
(function () {
  "use strict";

  var root = document.getElementById("scan");
  if (!root) return;

  var ENDPOINT = root.dataset.endpoint;
  var form     = document.getElementById("scanForm");
  var input    = document.getElementById("scanUrl");
  var btn      = document.getElementById("scanBtn");
  var status   = document.getElementById("scanStatus");
  var errorBox = document.getElementById("scanError");
  var result   = document.getElementById("scanResult");

  // dataset, not getAttribute: HTML lowercases attribute names, so
  // getAttribute("data-scoreLabel") looks for data-scorelabel and misses
  // data-score-label. dataset does the kebab<->camel mapping correctly.
  function t(key, fallback) {
    var v = root.dataset[key];
    return (v === undefined || v === "") ? fallback : v;
  }

  // "entity|Entity layer|What the page claims to be" triples
  var GROUPS = (t("groups", "") || "").split("~").filter(Boolean).map(function (g) {
    var p = g.split("|");
    return { id: p[0], label: p[1] || p[0], lede: p[2] || "" };
  });

  function band(score) {
    return score >= 85 ? "good" : score >= 50 ? "mid" : "bad";
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;   // textContent, never innerHTML:
    return n;                                  // every string here is remote data
  }

  function show(node, on) { node.hidden = !on; }

  function render(data) {
    result.textContent = "";

    var head = el("div", "scan-head");
    var g = el("div", "scan-grade", data.grade);
    g.setAttribute("data-band", band(data.score));
    head.appendChild(g);

    var meta = el("div", "scan-headmeta");
    meta.appendChild(el("p", "scan-score",
      t("scoreLabel", "Score") + " " + data.score + "/100 · " +
      data.passed + "/" + data.total + " " + t("passedLabel", "checks passed")));
    meta.appendChild(el("p", "scan-target", data.url));
    head.appendChild(meta);
    result.appendChild(head);

    GROUPS.forEach(function (grp) {
      var checks = data.checks.filter(function (c) { return c.group === grp.id; });
      if (!checks.length) return;

      var sec = el("section", "scan-group");
      sec.appendChild(el("h2", null, grp.label));
      if (grp.lede) sec.appendChild(el("p", "scan-grouplede", grp.lede));

      // failures first — the report should lead with what is broken
      checks.sort(function (a, b) {
        return (a.pass - b.pass) || (b.deduction - a.deduction);
      });

      checks.forEach(function (c) {
        var row = el("div", "scan-check");
        row.setAttribute("data-pass", String(!!c.pass));

        var mark = el("span", "scan-mark", c.pass ? "✓" : "✕");
        mark.setAttribute("aria-label", c.pass ? t("passA11y", "Passed") : t("failA11y", "Failed"));
        row.appendChild(mark);

        var body = el("div");
        body.appendChild(el("p", "scan-title", c.title));
        body.appendChild(el("p", "scan-detail", c.detail));
        row.appendChild(body);

        row.appendChild(el("span", "scan-cost", c.pass ? "—" : "−" + c.deduction));
        sec.appendChild(row);
      });
      result.appendChild(sec);
    });

    show(result, true);
  }

  function fail(msg) {
    errorBox.textContent = msg;
    show(errorBox, true);
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    var url = input.value.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;

    show(errorBox, false);
    show(result, false);
    status.textContent = t("scanning", "Fetching and parsing…");
    show(status, true);
    btn.disabled = true;

    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url })
    })
      .then(function (r) {
        return r.json().then(function (d) { return { ok: r.ok, data: d }; });
      })
      .then(function (res) {
        if (!res.ok || res.data.error) throw new Error(res.data.error || t("genericError", "The scan failed."));
        render(res.data);
      })
      .catch(function (err) {
        fail(err.message || t("genericError", "The scan failed."));
      })
      .finally(function () {
        show(status, false);
        btn.disabled = false;
      });
  });
})();
