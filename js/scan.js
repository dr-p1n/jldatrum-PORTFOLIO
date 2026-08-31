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

    // The heading census. A count has no pass and no fail, so it is reported as
    // a fact and priced at nothing — it sits outside the checks and outside the
    // tally. Levels the page does not use are printed as 0 rather than omitted,
    // because "no H2s at all" is the finding worth seeing.
    if (data.headings) {
      var levels = ["h1", "h2", "h3", "h4", "h5", "h6"];
      var census = levels.map(function (k) {
        return k.toUpperCase() + " " + (data.headings[k] || 0);
      }).join("  ·  ");
      result.appendChild(el("h2", "scan-subhead", t("headingsTitle", "Heading outline")));
      result.appendChild(el("p", "scan-census", census));
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

    var scale = buildScale(data.score);
    if (scale) result.insertBefore(scale, result.children[1] || null);

    result.appendChild(buildCapture());
    show(result, true);
  }

  /* ── the bar ───────────────────────────────────────────
     A score out of 100 has no mental scale attached, and a peer median only
     works if you have actually measured the peers. A target needs no sample —
     but it does need a derivation, or it is a number someone felt like.

     Both targets fall out of the weights. Security: the pool is 76 across the
     seven headers and 24 across the five page checks, and at 10 points of
     deductions nothing weighing more than 10 can be failing — so 90 means
     HTTPS, HSTS, a CSP that actually stops injected script, and closed framing
     are all correct. 90 is the lowest number that still guarantees all four;
     at 88 the transport check drops out of the guarantee. AI: above 85 the
     deductions total under 15, so nothing weighing 15 or more can be failing —
     the entity block is present, valid, names an Organization, and the content
     is in the served HTML. That is the line every answer engine shares,
     because none of them reliably run JavaScript and all of them need an
     entity to attach a recommendation to.

     data-target on the page carries the number. Absent, this renders nothing.
     ──────────────────────────────────────────────────── */

  var SVGNS = "http://www.w3.org/2000/svg";

  function svg(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    for (var k in attrs) if (attrs.hasOwnProperty(k)) n.setAttribute(k, attrs[k]);
    return n;
  }

  function buildScale(score) {
    var target = Number(root.dataset.target);
    if (!root.dataset.target || !isFinite(target)) return null;

    var box = el("div", "scan-scale");
    box.appendChild(el("h2", "scan-subhead", t("scaleTitle", "Against the bar")));

    // 360 units wide: at the width this column renders, 10px type here reads
    // like 10px type. A wider viewBox shrinks it into illegibility.
    var W = 360, H = 74, X0 = 10, X1 = 350, RAIL = 46;
    var s = svg("svg", {
      viewBox: "0 0 " + W + " " + H, width: "100%", role: "img",
      "aria-label": t("scaleTitle", "Against the bar") + ": " + score + " / " + target
    });
    var at = function (n) { return X0 + (Math.max(0, Math.min(100, n)) / 100) * (X1 - X0); };
    var label = function (x, y, text, fill, size, weight) {
      var n = svg("text", {
        x: Math.max(X0 + 28, Math.min(X1 - 28, x)), y: y, fill: fill,
        "font-size": size, "text-anchor": "middle",
        "font-family": "DM Sans, sans-serif", "font-weight": weight || 400
      });
      n.textContent = text;
      return n;
    };

    var xs = at(score), xt = at(target);
    var made = score >= target;

    s.appendChild(svg("line", {
      x1: X0, y1: RAIL, x2: X1, y2: RAIL,
      stroke: "#1A3A40", "stroke-width": 2, "stroke-linecap": "round"
    }));

    // The distance to the bar is the finding. Drawn either way: short and
    // lemon when it is cleared, long and grey when it is not.
    s.appendChild(svg("line", {
      x1: Math.min(xs, xt), y1: RAIL, x2: Math.max(xs, xt), y2: RAIL,
      stroke: made ? "#F2D24B" : "#9AABAF", "stroke-width": 2, "stroke-linecap": "round"
    }));

    // The bar itself: a full-height gate, not a tick, because it is a threshold.
    s.appendChild(svg("line", {
      x1: xt, y1: RAIL - 11, x2: xt, y2: RAIL + 11, stroke: "#9AABAF",
      "stroke-width": 1, "stroke-dasharray": "3 3"
    }));
    s.appendChild(label(xt, RAIL + 24, t("targetLabel", "The bar") + " " + target, "#9AABAF", 9));

    s.appendChild(svg("circle", { cx: xs, cy: RAIL, r: 4, fill: "#F2D24B" }));
    s.appendChild(svg("line", {
      x1: xs, y1: RAIL - 13, x2: xs, y2: RAIL + 5, stroke: "#F2D24B", "stroke-width": 2
    }));
    s.appendChild(label(xs, RAIL - 19, t("scaleYou", "This site") + " " + score,
                        "#F2D24B", 11, 600));

    box.appendChild(s);

    var note = made ? t("targetMet", "") : t("targetMissed", "");
    if (note) box.appendChild(el("p", "scan-scale-cap", note.replace("{n}", target - score)));
    if (lastData) box.appendChild(buildShare(lastData, target));
    return box;
  }

  /* ── the share card ────────────────────────────────────
     Drawn on a canvas rather than by rasterising the SVG above. An SVG loaded
     through an <img> does not fetch the page's webfonts, so that route ships a
     card in whatever system sans the viewer happens to have. Canvas 2D uses
     the fonts already loaded in the document, so this comes out in the real
     ones — after document.fonts.ready, which is why the handler is async.

     No blob: anywhere. img-src is 'self' data:, and a blob: URL for the image
     would be refused; the download anchor takes a blob because that is a
     download, not an image load.
     ──────────────────────────────────────────────────── */

  var CARD_W = 1200, CARD_H = 630;
  var BG = "#0C1B1F", TEXT = "#E8EDED", MUTED = "#9AABAF",
      LEMON = "#F2D24B", BORDER = "#1A3A40";

  function cardFonts(weight, size, family) {
    return weight + " " + size + "px '" + family + "', system-ui, sans-serif";
  }

  function drawCard(data, target) {
    var c = document.createElement("canvas");
    c.width = CARD_W; c.height = CARD_H;
    var x = c.getContext("2d");

    x.fillStyle = BG;
    x.fillRect(0, 0, CARD_W, CARD_H);

    var M = 72;

    x.fillStyle = LEMON;
    x.font = cardFonts(700, 34, "Space Grotesk");
    x.letterSpacing = "2px";
    x.fillText("DATRUM", M, M + 26);
    x.letterSpacing = "0px";

    // What was measured, and by which instrument.
    var h1 = document.querySelector("h1");
    x.fillStyle = MUTED;
    x.font = cardFonts(500, 20, "DM Sans");
    x.textAlign = "right";
    x.fillText(h1 ? h1.textContent.trim() : "", CARD_W - M, M + 24);
    x.textAlign = "left";

    x.fillStyle = TEXT;
    x.font = cardFonts(400, 26, "DM Sans");
    x.fillText(String(data.url).replace(/^https?:\/\//, "").replace(/\/$/, ""), M, 208);

    x.fillStyle = LEMON;
    x.font = cardFonts(600, 132, "Space Grotesk");
    x.fillText(data.grade, M, 330);
    var gw = x.measureText(data.grade).width;
    x.fillStyle = MUTED;
    x.font = cardFonts(400, 34, "DM Sans");
    x.fillText(data.score + "/100", M + gw + 24, 330);

    // The bar, same geometry as the one on the page.
    // Vertical budget below the rail: bar labels, the verdict, the worst gap and
    // the footer all have to fit. 396 is what leaves them clear of each other.
    var X0 = M, X1 = CARD_W - M, RAIL = 396;
    var at = function (n) { return X0 + (Math.max(0, Math.min(100, n)) / 100) * (X1 - X0); };
    var xs = at(data.score), xt = at(target), made = data.score >= target;

    x.lineCap = "round";
    x.strokeStyle = BORDER; x.lineWidth = 4;
    x.beginPath(); x.moveTo(X0, RAIL); x.lineTo(X1, RAIL); x.stroke();

    x.strokeStyle = made ? LEMON : MUTED; x.lineWidth = 4;
    x.beginPath(); x.moveTo(Math.min(xs, xt), RAIL); x.lineTo(Math.max(xs, xt), RAIL); x.stroke();

    x.strokeStyle = MUTED; x.lineWidth = 2;
    x.setLineDash([6, 6]);
    x.beginPath(); x.moveTo(xt, RAIL - 26); x.lineTo(xt, RAIL + 26); x.stroke();
    x.setLineDash([]);

    x.fillStyle = LEMON;
    x.beginPath(); x.arc(xs, RAIL, 9, 0, Math.PI * 2); x.fill();

    x.textAlign = "center";
    x.fillStyle = MUTED;
    x.font = cardFonts(400, 20, "DM Sans");
    x.fillText(t("targetLabel", "The bar") + " " + target,
               Math.max(X0 + 60, Math.min(X1 - 60, xt)), RAIL + 54);
    x.textAlign = "left";

    // Canvas has no line breaking, so wrap by hand and return the baseline
    // reached, because what follows has to start below it.
    var wrap = function (text, y, size, fill, weight) {
      x.fillStyle = fill;
      x.font = cardFonts(weight || 400, size, "DM Sans");
      var words = String(text).split(" "), line = "", step = Math.round(size * 1.38);
      for (var i = 0; i < words.length; i++) {
        var probe = line ? line + " " + words[i] : words[i];
        if (x.measureText(probe).width > CARD_W - M * 2 && line) {
          x.fillText(line, M, y); y += step; line = words[i];
        } else { line = probe; }
      }
      if (line) { x.fillText(line, M, y); y += step; }
      return y;
    };

    var y = wrap((made ? t("targetMet", "") : t("targetMissed", ""))
                   .replace("{n}", target - data.score), RAIL + 104, 26, TEXT);

    // The worst single gap, so the card is a diagnosis and not just a number.
    // This is what makes it usable in an outreach message.
    var worst = (data.checks || []).filter(function (k) { return !k.pass; })
                  .sort(function (a, b) { return b.deduction - a.deduction; })[0];
    if (worst) wrap("\u2212" + worst.deduction + "  " + worst.title, y + 12, 22, MUTED);

    x.fillStyle = MUTED;
    x.font = cardFonts(400, 20, "DM Sans");
    x.fillText("jldatrum.com", M, CARD_H - 44);

    return c;
  }

  function cardBlob(data, target) {
    return (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve())
      .then(function () {
        return new Promise(function (resolve, reject) {
          drawCard(data, target).toBlob(function (b) {
            b ? resolve(b) : reject(new Error("canvas"));
          }, "image/png");
        });
      });
  }

  function cardName(data) {
    var host;
    try { host = new URL(data.url).hostname; } catch (e) { host = "site"; }
    return "datrum-" + host + "-" + data.score + ".png";
  }

  function buildShare(data, target) {
    var box = el("div", "scan-share");

    var copy = el("button", "scan-btn scan-btn--quiet", t("copyBtn", "Copy image"));
    copy.type = "button";
    var down = el("button", "scan-btn scan-btn--quiet", t("downloadBtn", "Download image"));
    down.type = "button";
    var say = el("span", "scan-share-say");
    say.setAttribute("role", "status");
    say.setAttribute("aria-live", "polite");

    // Clipboard image write is not universal, and Firefox in particular will
    // reject it. Offer the button, and say plainly when it will not go.
    copy.addEventListener("click", function () {
      copy.disabled = true;
      cardBlob(data, target)
        .then(function (b) {
          if (!navigator.clipboard || !window.ClipboardItem) throw new Error("unsupported");
          return navigator.clipboard.write([new window.ClipboardItem({ "image/png": b })]);
        })
        .then(function () { say.textContent = t("copied", "Copied."); })
        .catch(function () { say.textContent = t("copyFailed", "This browser will not copy images — download it instead."); })
        .then(function () { copy.disabled = false; });
    });

    down.addEventListener("click", function () {
      down.disabled = true;
      cardBlob(data, target)
        .then(function (b) {
          var href = URL.createObjectURL(b);
          var a = document.createElement("a");
          a.href = href; a.download = cardName(data);
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          setTimeout(function () { URL.revokeObjectURL(href); }, 30000);
          say.textContent = t("downloaded", "Saved.");
        })
        .catch(function () { say.textContent = t("genericError", "The scan failed."); })
        .then(function () { down.disabled = false; });
    });

    box.appendChild(copy);
    box.appendChild(down);
    box.appendChild(say);
    return box;
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
