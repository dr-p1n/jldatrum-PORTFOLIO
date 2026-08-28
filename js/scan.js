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

  var lastData = null;

  function render(data) {
    lastData = data;
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

      // The headers instrument declares data-compact: seven one-line verdicts
      // read as a table, and the area tag that helps across twenty-six mixed
      // checks is just a third line of chrome on seven of one kind.
      var compact = root.dataset.compact === "true";
      var table = el("table", "scan-table" + (compact ? " scan-table--compact" : ""));
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
        if (!compact && area[c.group]) td.appendChild(el("span", "scan-area", area[c.group]));
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

    result.appendChild(buildCapture());
    show(result, true);
  }

  /* ── the report ────────────────────────────────────────────
     The scan renders in full above this; the address buys the FILE, not the
     findings. Built here in the client from data the page already has, so
     nothing about the scanned site is sent anywhere or stored.
     ──────────────────────────────────────────────────────── */

  var LEAD_ENDPOINT = String(ENDPOINT || "").replace(/\/scan\/*$/, "/lead");

  function buildCapture() {
    var box = el("div", "scan-capture");
    box.appendChild(el("p", "scan-capture-lede",
      t("reportLede", "Download this as a report \u2014 one file you can send on.")));

    var f = document.createElement("form");
    f.className = "scan-capture-form";

    var lab = el("label", "sr-only", t("emailLabel", "Email address"));
    lab.htmlFor = "scanEmail";
    var mail = document.createElement("input");
    mail.className = "scan-input";
    mail.id = "scanEmail";
    mail.type = "email";
    mail.required = true;
    mail.autocomplete = "email";
    mail.placeholder = t("emailPlaceholder", "you@company.com");

    // Honeypot. Off-screen rather than display:none, which some autofillers skip
    // and some bots specifically look for.
    var pot = document.createElement("input");
    pot.className = "sr-only";
    pot.type = "text";
    pot.name = "company";
    pot.tabIndex = -1;
    pot.autocomplete = "off";
    pot.setAttribute("aria-hidden", "true");

    var go = el("button", "scan-btn", t("reportBtn", "Get the report"));
    go.type = "submit";

    f.appendChild(lab);
    f.appendChild(mail);
    f.appendChild(pot);
    f.appendChild(go);
    box.appendChild(f);

    box.appendChild(el("p", "scan-capture-note",
      t("reportNote", "We keep the address, not the results.")));

    var say = el("p", "scan-capture-status");
    say.setAttribute("role", "status");
    say.setAttribute("aria-live", "polite");
    say.hidden = true;
    box.appendChild(say);

    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var addr = mail.value.trim();
      if (!addr) return;
      go.disabled = true;
      say.hidden = true;
      say.classList.remove("is-bad");

      fetch(LEAD_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: addr,
          company: pot.value,
          lang: LANG,
          mode: root.dataset.mode || ""
        })
      })
        .then(function (r) {
          return r.json().then(function (d) { return { ok: r.ok, data: d }; });
        })
        .then(function (res) {
          if (!res.ok || res.data.error)
            throw new Error(res.data.error || t("genericError", "The scan failed."));
          downloadReport();
          say.textContent = t("reportReady", "Report downloaded.");
          say.hidden = false;
          f.hidden = true;
        })
        .catch(function (err) {
          say.textContent = err.message || t("genericError", "The scan failed.");
          say.classList.add("is-bad");
          say.hidden = false;
          go.disabled = false;
        });
    });

    return box;
  }

  function reportHost() {
    try { return new URL(lastData.url).hostname; } catch (e) { return "site"; }
  }

  // Built with createElement throughout, so every remote string is escaped by
  // the DOM on the way in. Never assemble this document by concatenating HTML.
  function downloadReport() {
    if (!lastData) return;

    var h1 = document.querySelector("h1");
    var name = h1 ? h1.textContent.trim() : "DATRUM";
    var doc = document.implementation.createHTMLDocument(name);

    var meta = doc.createElement("meta");
    meta.setAttribute("charset", "utf-8");
    doc.head.appendChild(meta);
    var vp = doc.createElement("meta");
    vp.name = "viewport";
    vp.content = "width=device-width, initial-scale=1";
    doc.head.appendChild(vp);

    // Inlined, literal, and deliberately plain: this file opens on machines
    // that have never seen the site's stylesheets or its webfonts.
    var css = doc.createElement("style");
    css.textContent = [
      "body{margin:0;padding:48px 24px;background:#0C1B1F;color:#E8EDED;",
      "font:16px/1.6 'DM Sans',system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif}",
      ".r{max-width:760px;margin:0 auto}",
      "h1{font-size:28px;font-weight:600;margin:0 0 8px}",
      ".sub{color:#9AABAF;margin:0 0 32px;font-size:14px}",
      ".score{font-size:40px;font-weight:600;margin:0 0 4px}",
      "h2{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#9AABAF;",
      "font-weight:500;margin:40px 0 12px}",
      "table{width:100%;border-collapse:collapse}",
      "th,td{text-align:left;vertical-align:top;padding:14px 16px 14px 0;",
      "border-bottom:1px solid #1A3A40}",
      "td.c{text-align:right;white-space:nowrap;color:#F2D24B;padding-right:0}",
      ".t{font-weight:600;margin:0 0 4px}",
      ".d{margin:0;color:#9AABAF;font-size:14px}",
      "ul{padding-left:18px;color:#9AABAF;font-size:14px}",
      ".f{margin-top:48px;padding-top:16px;border-top:1px solid #1A3A40;",
      "color:#9AABAF;font-size:13px}",
      ".f a{color:#F2D24B}",
      "@media print{body{background:#fff;color:#111}.d,.sub,ul,.f{color:#444}",
      "td.c,.f a{color:#111}}"
    ].join("");
    doc.head.appendChild(css);

    function E(tag, cls, text) {
      var n = doc.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    }

    var wrap = E("div", "r");
    wrap.appendChild(E("h1", null, name));
    wrap.appendChild(E("p", "sub",
      lastData.url + " \u00b7 " + new Date().toISOString().slice(0, 10)));
    wrap.appendChild(E("p", "score", lastData.grade + " \u00b7 " + lastData.score + "/100"));
    wrap.appendChild(E("p", "sub",
      lastData.passed + "/" + lastData.total + " " + t("passedLabel", "checks passed")));

    var gaps = lastData.checks.filter(function (c) { return !c.pass; })
                              .sort(function (a, b) { return b.deduction - a.deduction; });

    if (gaps.length) {
      wrap.appendChild(E("h2", null, t("gapsLabel", "Gaps") + " (" + gaps.length + ")"));
      var tb = doc.createElement("table");
      var body = doc.createElement("tbody");
      gaps.forEach(function (c) {
        var tr = doc.createElement("tr");
        var td = doc.createElement("td");
        td.appendChild(E("p", "t", c.title));
        td.appendChild(E("p", "d", c.detail));
        tr.appendChild(td);
        tr.appendChild(E("td", "c", "\u2212" + c.deduction));
        body.appendChild(tr);
      });
      tb.appendChild(body);
      wrap.appendChild(tb);
    } else {
      wrap.appendChild(E("p", "d", t("cleanLabel", "No gaps found. Every check passed.")));
    }

    var ok = lastData.checks.filter(function (c) { return c.pass; });
    if (ok.length) {
      wrap.appendChild(E("h2", null, t("passedTitle", "Passed") + " (" + ok.length + ")"));
      var ul = doc.createElement("ul");
      ok.forEach(function (c) { ul.appendChild(E("li", null, c.title)); });
      wrap.appendChild(ul);
    }

    var f = E("div", "f");
    f.appendChild(doc.createTextNode("DATRUM \u00b7 "));
    var a = doc.createElement("a");
    a.href = "https://jldatrum.com" + (LANG === "es" ? "/es/" : "/");
    a.textContent = "jldatrum.com";
    f.appendChild(a);
    wrap.appendChild(f);

    doc.body.appendChild(wrap);

    var blob = new Blob(
      ["<!doctype html>\n", doc.documentElement.outerHTML],
      { type: "text/html;charset=utf-8" }
    );
    var href = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = href;
    link.download = "datrum-report-" + reportHost() + "-" +
                    new Date().toISOString().slice(0, 10) + ".html";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(href); }, 30000);
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
