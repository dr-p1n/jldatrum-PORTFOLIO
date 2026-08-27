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
  // The worker renders every check title and detail itself, so it has to be
  // told which language to answer in — otherwise the Spanish page frames
  // English findings. <html lang> already carries this on every page, so
  // there is no fourth place to keep in sync.
  var LANG = (document.documentElement.lang || "en").slice(0, 2).toLowerCase();
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

    var area = {};
    GROUPS.forEach(function (grp) { area[grp.id] = grp.label; });

    // Gaps first, worst first. The passing checks are a tally, not a report:
    // nobody books a call over what already works, and printing all of them
    // buried the handful that matter under twenty lines of agreement.
    var gaps = data.checks.filter(function (c) { return !c.pass; })
                          .sort(function (a, b) { return b.deduction - a.deduction; });

    if (!gaps.length) {
      result.appendChild(el("p", "scan-clean",
        t("cleanLabel", "No gaps found. Every check passed.")));
    } else {
      result.appendChild(el("h2", "scan-subhead",
        t("gapsLabel", "Gaps") + " (" + gaps.length + ")"));

      var table = el("table", "scan-table");
      var thead = document.createElement("thead");
      var hr = document.createElement("tr");
      hr.appendChild(el("th", null, t("gapCol", "What is missing")));
      var th2 = el("th", "scan-col-cost", t("costCol", "Cost"));
      hr.appendChild(th2);
      thead.appendChild(hr);
      table.appendChild(thead);

      var tbody = document.createElement("tbody");
      gaps.forEach(function (c) {
        var tr = document.createElement("tr");
        var td = document.createElement("td");
        if (area[c.group]) td.appendChild(el("span", "scan-area", area[c.group]));
        td.appendChild(el("p", "scan-title", c.title));
        td.appendChild(el("p", "scan-detail", c.detail));
        tr.appendChild(td);
        tr.appendChild(el("td", "scan-col-cost scan-cost", "\u2212" + c.deduction));
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      result.appendChild(table);
    }

    // Everything that passed, named and nothing more.
    var ok = data.checks.filter(function (c) { return c.pass; });
    if (ok.length) {
      result.appendChild(el("h2", "scan-subhead",
        t("passedTitle", "Passed") + " (" + ok.length + ")"));
      var list = el("ul", "scan-passed");
      ok.forEach(function (c) { list.appendChild(el("li", null, c.title)); });
      result.appendChild(list);
    }

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
      // One client, two instruments. The page declares which via data-mode;
      // the response shape is identical either way, so nothing below branches.
      body: JSON.stringify({ url: url, lang: LANG, mode: root.dataset.mode || "" })
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
