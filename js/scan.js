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

  // Green means "clears the bar this instrument is held to", not "clears 85".
  // The security index is held to 90, so an 87 that renders green beside a
  // printed bar of 90 contradicts the page in the same glance.
  function band(score, target) {
    var bar = (isFinite(target) && target > 0) ? target : 85;
    return score >= bar ? "good" : score >= 50 ? "mid" : "bad";
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;   // textContent, never innerHTML:
    return n;                                  // every string here is remote data
  }

  function show(node, on) { node.hidden = !on; }

  var lastData  = null;   // this page's own instrument
  var lastUrl   = "";
  var otherData = null;   // the other one, once it has been run
  var comparing = false;     // the two instruments, side by side
  var wantCompare = false;   // a shared link asked for the side-by-side
  var rivalsOn  = false;     // this instrument, several sites
  var rivals    = [];        // [{ url, host, data, other }] as they were added
  // Whose pair the comparison is showing: null is the reader's own scan, a
  // hostname is one of the rows in the ranking. The outreach move is "here is
  // what your rival looks like on both doors", so the comparison cannot be
  // welded to the URL that happened to go in the form.
  var subject   = null;
  // Every scan carries the generation it was started in. Submitting a new URL
  // bumps it, so a cross-run still in flight against the old target lands on a
  // dead generation and drops instead of pairing two different sites.
  var runId = 0;

  // One client, two instruments. The page declares which one it is; the other
  // is whatever this is not. The response shape is identical either way.
  var MODE  = root.dataset.mode || "";
  var OTHER = MODE === "headers" ? "" : "headers";

  /* ── the gate ──────────────────────────────────────────
     Opt-in per page via data-gate, not global: the AI scanner's pages promise
     ungated results and still keep that promise. Where it is on, the free view
     is the checklist — every check, named, with its verdict — and what the
     address buys is why each one failed and what it costs.

     The score and the bar stay outside the gate on purpose. A number with no
     scale is not a teaser, it is noise, and the distance to the bar is the
     reason anyone would hand over an address at all.

     This is a soft gate. The worker answers with the full result in one
     response, so the reasons are readable in devtools by anyone who looks.
     Making it hard means a second round trip after the address is taken, which
     costs a scan against the hourly budget. ── */
  var GATED = root.dataset.gate === "true";
  var unlocked = false;

  // onlyGaps: the free view and the comparison both name what is wrong and stop
  // there. Naming twenty-six passes to sell an audit of five failures buries
  // the five, and the head line already carries how many of how many passed —
  // so what was measured is still on the page, in one line instead of twenty.
  function buildChecklist(data, onlyGaps) {
    var box = el("div", "scan-checklist-box");
    var list = el("ul", "scan-checklist");
    var rows = onlyGaps
      ? data.checks.filter(function (c) { return !c.pass; })
      : data.checks;
    rows.forEach(function (c) {
      var li = el("li", c.pass ? "is-ok" : "is-gap");
      li.appendChild(el("span", "scan-check-mark", c.pass ? "✓" : "✕"));
      var body = el("span", "scan-check-title", c.title);
      // What the gap means, wherever the gap is named. The technical reason and
      // the cost are what the address buys; this is what the two people looking
      // at the screen actually say to each other, and withholding it only makes
      // the free result harder to act on without making the audit worth more.
      if (c.so) body.appendChild(el("span", "scan-check-so", c.so));
      li.appendChild(body);
      list.appendChild(li);
    });
    box.appendChild(list);
    return box;
  }

  function runScan(url, mode) {
    return fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url, lang: LANG, mode: mode })
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok || d.error) throw new Error(d.error || t("genericError", "The scan failed."));
        return d;
      });
    });
  }

  function render(data) {
    lastData = data;
    result.textContent = "";
    if (lastUrl) result.appendChild(viewBar());
    var gated = GATED && !unlocked;

    var head = el("div", "scan-head");
    var g = el("div", "scan-grade", data.grade);
    g.setAttribute("data-band", band(data.score, Number(root.dataset.target)));
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

    if (gated && gaps.length) {
      // Each gap named, and nothing else. What is withheld is the why and the
      // cost; what was measured is in the head line above, as a count.
      result.appendChild(el("h2", "scan-subhead",
        t("gapsLabel", "Gaps") + " (" + gaps.length + ")"));
      result.appendChild(buildChecklist(data, true));
      result.appendChild(el("p", "scan-locked",
        t("gapsLocked", "{n} need work. The full audit names what each one costs and why it stops a reader.")
          .replace("{n}", gaps.length)));
    } else if (!gaps.length) {
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
        if (c.so) td.appendChild(el("p", "scan-so", c.so));
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

    // Everything that passed, named and nothing more. Redundant behind the
    // gate, where the checklist has already named every check.
    var ok = gated ? [] : data.checks.filter(function (c) { return c.pass; });
    if (ok.length) {
      result.appendChild(el("h2", "scan-subhead",
        t("passedTitle", "Passed") + " (" + ok.length + ")"));
      var list = el("ul", "scan-passed");
      ok.forEach(function (c) { list.appendChild(el("li", null, c.title)); });
      result.appendChild(list);
    }

    // After the view bar and the head, so the score keeps its place at the top.
    var scale = buildScale(data.score);
    if (scale) result.insertBefore(scale, result.children[lastUrl ? 2 : 1] || null);

    var cross = buildCross();
    if (cross) result.appendChild(cross);

    result.appendChild(buildCapture());
    show(result, true);
  }

  /* ── the two instruments, side by side ─────────────────
     They measure different things and are scored against different bars, so
     this compresses each one to what can be compared honestly: the score, the
     bar it is held to, and every check named with its verdict. No reasons and
     no costs in this view — those are per-instrument and belong to the full
     result, which is one button away.

     Compressing to the checklist is also what keeps the gate intact without a
     second rule: names and verdicts are free on both instruments, and it is
     the reasons that are held back on the one that gates them.

     A comparison is two scans. At sixty an hour that is not a budget anyone
     reaches, but it is why this is a button rather than something the page
     does on its own.
     ──────────────────────────────────────────────────── */

  function crossRun() {
    if (otherData) { comparing = true; rivalsOn = false; renderCompare(); return Promise.resolve(); }
    var id = runId;
    return runScan(lastUrl, OTHER).then(function (d) {
      if (id !== runId) return;          // a new target was submitted meanwhile
      otherData = d;
      comparing = true;
      rivalsOn  = false;
      renderCompare();
    });
  }

  // The cross-run's button and its status line, so the shared-link path and the
  // click path drive the same control and report failure in the same place.
  var crossBtn = null, crossSay = null;

  function startCross() {
    if (!crossBtn) return Promise.resolve();
    if (otherData) { comparing = true; renderCompare(); return Promise.resolve(); }
    var b = crossBtn, say = crossSay;
    b.disabled = true;
    say.classList.remove("is-bad");
    say.textContent = t("compareRunning", "Running the second instrument…");
    say.hidden = false;
    return crossRun().catch(function (err) {
      // The first result is on the page and is sound. A failure of the second
      // instrument belongs beside the button that asked for it, not in the
      // page-level alert above a result that came back fine.
      say.textContent = err.message || t("genericError", "The scan failed.");
      say.classList.add("is-bad");
      b.disabled = false;
    });
  }

  function buildCross() {
    var label = t("compareBtn", "");
    if (!label || !lastUrl) return null;

    var box = el("div", "scan-cross");
    var b = el("button", "scan-btn scan-btn--cross", label);
    b.type = "button";
    var say = el("p", "scan-cross-say");
    say.setAttribute("role", "status");
    say.setAttribute("aria-live", "polite");
    say.hidden = true;

    crossBtn = b;
    crossSay = say;
    b.addEventListener("click", startCross);

    box.appendChild(b);
    box.appendChild(say);
    return box;
  }

  function compareCol(data, name, target) {
    var col = el("div", "scan-compare-col");
    col.appendChild(el("h3", "scan-compare-name", name));

    var line = el("div", "scan-compare-score");
    var g = el("span", "scan-grade scan-grade--sm", data.grade);
    g.setAttribute("data-band", band(data.score, target));
    line.appendChild(g);
    line.appendChild(el("span", "scan-compare-num", data.score + "/100"));
    col.appendChild(line);

    var facts = data.passed + "/" + data.total + " " + t("passedLabel", "checks passed");
    if (isFinite(target) && target) facts += "  ·  " + t("targetLabel", "The bar") + " " + target;
    col.appendChild(el("p", "scan-compare-facts", facts));

    if (data.passed === data.total)
      col.appendChild(el("p", "scan-locked", t("cleanLabel", "No gaps found. Every check passed.")));
    else
      col.appendChild(buildChecklist(data, true));
    return col;
  }

  /* ── the joint verdict ─────────────────────────────────
     Two scores on one screen are two facts. The finding is what the pair
     means, and it is not an average: these are different doors. One is the
     answer engine, which reads the page and never asks you to explain
     anything; the other is the buyer, who checks the response before the call
     rather than after it. A page can pass one and fail the other, and which
     one is shut decides what it costs.

     Read from the gaps, not from the scores, so the sentence agrees with the
     columns underneath it.
     ──────────────────────────────────────────────────── */

  function rivalBy(host) {
    for (var i = 0; i < rivals.length; i++) if (rivals[i].host === host) return rivals[i];
    return null;
  }

  function pairFor(host) {
    if (!host) return { url: lastData ? lastData.url : lastUrl, mine: lastData, theirs: otherData };
    var r = rivalBy(host);
    return r ? { url: r.url, mine: r.data, theirs: r.other } : null;
  }

  function targetFor(mode) {
    return Number(mode === MODE ? root.dataset.target : root.dataset.otherTarget);
  }

  function verdict(pair) {
    var sec = MODE === "headers" ? pair.mine  : pair.theirs;
    var ai  = MODE === "headers" ? pair.theirs : pair.mine;
    if (!sec || !ai) return null;

    var secBar = targetFor("headers"), aiBar = targetFor("");
    var secOk = isFinite(secBar) && secBar ? sec.score >= secBar : true;
    var aiOk  = isFinite(aiBar)  && aiBar  ? ai.score  >= aiBar  : true;

    var key = secOk && aiOk ? "verdictBoth"
            : aiOk         ? "verdictEngineOnly"
            : secOk        ? "verdictBuyerOnly"
            :                "verdictNeither";
    var line = t(key, "");
    if (!line) return null;

    return line.replace("{a}", ai.total - ai.passed)
               .replace("{s}", sec.total - sec.passed);
  }

  /* ── the same test, several sites ──────────────────────
     A score on its own has no consequence attached. 65 reads as survivable
     until it is sitting under a firm the reader loses work to, and then it is
     a position rather than a number.

     Every row here is measured, never quoted: the studio's own site goes
     through the same request as anybody else's, because a page that claims
     "automated, not self-reported" cannot print its own score from a constant.
     That costs one test per site, which is why sites are added one at a time
     and never fetched on the reader's behalf.
     ──────────────────────────────────────────────────── */

  function hostOf(u) {
    try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return u; }
  }

  function otherFor(host) {
    if (!host) return otherData;
    var r = rivalBy(host);
    return r ? r.other : null;
  }

  // Two clicks, two different things, and the label says which: the first
  // measures the second instrument for that row and stays in the table, so the
  // ranking fills in across both tests; the second opens that row's pair. One
  // click is never more than one scan.
  function bothFor(host, btn, say) {
    var r = host ? rivalBy(host) : null;
    if (host && !r) return;
    if (otherFor(host)) {
      subject = host; comparing = true; rivalsOn = false; renderCompare();
      return;
    }

    btn.disabled = true;
    say.classList.remove("is-bad");
    say.textContent = t("compareRunning", "Running the second instrument…");
    say.hidden = false;
    var id = runId;
    runScan(host ? r.url : lastUrl, OTHER)
      .then(function (d) {
        if (id !== runId) return;
        if (host) r.other = d; else otherData = d;
        renderRivals();               // the row now carries both scores
      })
      .catch(function (err) {
        say.textContent = err.message || t("genericError", "The scan failed.");
        say.classList.add("is-bad");
        btn.disabled = false;
      });
  }

  function rivalRow(url, data, isYou, say) {
    var tr = document.createElement("tr");
    if (isYou) tr.className = "is-you";

    var site = document.createElement("td");
    site.appendChild(el("span", "scan-rival-host", hostOf(url)));
    if (isYou) site.appendChild(el("span", "scan-rival-you", t("scaleYou", "This site")));
    tr.appendChild(site);

    // One cell per instrument. A site nobody has run the second test on shows a
    // dash rather than a zero — unmeasured and failing are not the same thing,
    // and a ranking that blurs them is worse than one that admits the hole.
    var cell = function (d, target) {
      var td = el("td", "scan-rival-score");
      if (!d) { td.appendChild(el("span", "scan-rival-none", "\u2014")); return td; }
      var g = el("span", "scan-rival-grade", d.grade);
      g.setAttribute("data-band", band(d.score, target));
      td.appendChild(g);
      td.appendChild(el("span", "scan-rival-num", String(d.score)));
      td.appendChild(el("span", "scan-rival-gaps",
        (d.total - d.passed) + "/" + d.total));
      return td;
    };

    var host = isYou ? null : hostOf(url);
    var other = otherFor(host);
    tr.appendChild(cell(data,  Number(root.dataset.target)));
    tr.appendChild(cell(other, Number(root.dataset.otherTarget)));

    // Every row, not only the reader's: the useful thing to send a prospect is
    // what their rival looks like on both doors.
    var act = el("td", "scan-rival-act");
    var b = el("button", "scan-btn scan-btn--row",
                other ? t("compareTitle", "Side by side") : t("viewBoth", "Both tests"));
    b.type = "button";
    b.addEventListener("click", function () { bothFor(host, b, say); });
    act.appendChild(b);
    tr.appendChild(act);
    return tr;
  }

  function renderRivals() {
    result.textContent = "";
    crossBtn = null;
    crossSay = null;
    result.appendChild(viewBar());

    result.appendChild(el("p", "scan-rivals-lede",
      t("rivalsLede", "Add two: a firm you compete with, and one you think does this well.")));

    // Ranked, because the ranking is the finding. The reader's own row is
    // marked rather than pinned, so where they land is the first thing seen.
    var rows = [{ url: lastData.url, data: lastData, you: true }]
      .concat(rivals.map(function (r) { return { url: r.url, data: r.data, you: false }; }))
      .sort(function (a, b) { return b.data.score - a.data.score; });

    var say = el("p", "scan-cross-say");
    say.setAttribute("role", "status");
    say.setAttribute("aria-live", "polite");
    say.hidden = true;

    var table = el("table", "scan-rivals");
    var thead = document.createElement("thead");
    var hr = document.createElement("tr");
    hr.appendChild(el("th", null, t("rivalsSite", "Site")));
    hr.appendChild(el("th", "scan-rival-score", t("ownName", "")));
    hr.appendChild(el("th", "scan-rival-score", t("otherName", "")));
    hr.appendChild(el("th", "scan-rival-act", ""));
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = document.createElement("tbody");
    rows.forEach(function (r) { tbody.appendChild(rivalRow(r.url, r.data, r.you, say)); });
    table.appendChild(tbody);
    result.appendChild(table);
    result.appendChild(say);

    result.appendChild(rivalsForm());
    result.appendChild(buildCapture());
    show(result, true);
  }

  function addRival(url, say, done) {
    var host = hostOf(url);
    if (host === hostOf(lastData.url) || rivals.some(function (r) { return r.host === host; })) {
      say.textContent = t("rivalsDupe", "That one is already in the list.");
      say.hidden = false;
      done(false);
      return;
    }
    say.classList.remove("is-bad");
    say.textContent = t("rivalsRunning", "Measuring…");
    say.hidden = false;
    var id = runId;
    runScan(url, MODE)
      .then(function (d) {
        if (id !== runId) return;
        rivals.push({ url: url, host: host, data: d });
        renderRivals();
      })
      .catch(function (err) {
        say.textContent = err.message || t("genericError", "The scan failed.");
        say.classList.add("is-bad");
        done(false);
      });
  }

  function rivalsForm() {
    var box = el("div", "scan-rivals-add");
    var f = document.createElement("form");
    f.className = "scan-capture-form";

    var lab = el("label", "sr-only", t("rivalsSite", "Site"));
    lab.htmlFor = "scanRival";
    var input2 = document.createElement("input");
    input2.className = "scan-input";
    input2.id = "scanRival";
    input2.type = "text";
    input2.autocomplete = "off";
    input2.spellcheck = false;
    input2.placeholder = t("rivalsPlaceholder", "competitor.com");

    var go = el("button", "scan-btn", t("rivalsAdd", "Add"));
    go.type = "submit";

    var say = el("p", "scan-cross-say");
    say.setAttribute("role", "status");
    say.setAttribute("aria-live", "polite");
    say.hidden = true;

    f.appendChild(lab);
    f.appendChild(input2);
    f.appendChild(go);
    box.appendChild(f);

    // One click rather than one more thing to type. It is scanned like any
    // other row — the number it comes back with is the number it earned.
    var mark = root.dataset.benchmarkUrl;
    if (mark && hostOf(mark) !== hostOf(lastData.url) &&
        !rivals.some(function (r) { return r.host === hostOf(mark); })) {
      var chip = el("button", "scan-btn scan-btn--quiet", t("rivalsBenchmark", "Add the studio's own site"));
      chip.type = "button";
      chip.addEventListener("click", function () {
        chip.disabled = true;
        addRival(mark, say, function () { chip.disabled = false; });
      });
      var chipRow = el("div", "scan-cross");
      chipRow.appendChild(chip);
      box.appendChild(chipRow);
    }

    box.appendChild(say);

    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var raw = input2.value.trim();
      if (!raw) return;
      var url = /^https?:\/\//i.test(raw) ? raw : "https://" + raw;
      go.disabled = true;
      addRival(url, say, function () { go.disabled = false; });
    });

    return box;
  }

  /* ── the view bar ──────────────────────────────────────
     Three ways to read one scan, and the reader is always in exactly one of
     them. Buttons rather than links: nothing here changes the address, and a
     tab that lies about being a page is worse than a tab.
     ──────────────────────────────────────────────────── */

  function viewBar() {
    var bar = el("div", "scan-views");
    var here = comparing ? "both" : rivalsOn ? "rivals" : "single";
    [["single", t("viewResult", "Result")],
     ["rivals", t("viewRivals", "Competitors")],
     ["both",   t("viewBoth", "Both tests")]].forEach(function (v) {
      var b = el("button", "scan-view" + (here === v[0] ? " is-on" : ""), v[1]);
      b.type = "button";
      if (here === v[0]) b.setAttribute("aria-current", "true");
      b.addEventListener("click", function () {
        if (v[0] === "single") { comparing = false; rivalsOn = false; subject = null; render(lastData); }
        else if (v[0] === "rivals") { comparing = false; rivalsOn = true; renderRivals(); }
        else if (otherData) { rivalsOn = false; subject = null; comparing = true; renderCompare(); }
        else {
          // Reachable from any view, so it cannot lean on the cross-run button
          // — that only exists in the single result. The page-level status line
          // carries the wait instead.
          rivalsOn = false;
          subject = null;
          b.disabled = true;
          status.textContent = t("compareRunning", "Running the second instrument…");
          show(status, true);
          crossRun()
            .catch(function (err) { fail(err.message || t("genericError", "The scan failed.")); })
            .then(function () { show(status, false); b.disabled = false; });
        }
      });
      bar.appendChild(b);
    });
    return bar;
  }

  function renderCompare() {
    result.textContent = "";
    crossBtn = null;                     // both are about to be detached
    crossSay = null;
    result.appendChild(viewBar());

    var pair = pairFor(subject);
    if (!pair || !pair.mine || !pair.theirs) { subject = null; pair = pairFor(null); }

    var head = el("div", "scan-head");
    head.appendChild(el("h2", "scan-subhead", t("compareTitle", "Side by side")));
    head.appendChild(el("p", "scan-target", pair.url));
    result.appendChild(head);

    var says = verdict(pair);
    if (says) result.appendChild(el("p", "scan-verdict", says));

    var grid = el("div", "scan-compare");
    grid.appendChild(compareCol(pair.mine,   t("ownName", ""),   Number(root.dataset.target)));
    grid.appendChild(compareCol(pair.theirs, t("otherName", ""), Number(root.dataset.otherTarget)));
    result.appendChild(grid);

    // Two scores on one screen invite the wrong subtraction. Say the scales
    // are different rather than hoping the two bars printed above are read.
    var note = t("compareNote", "");
    if (note) result.appendChild(el("p", "scan-compare-note", note));

    // Every way out that the single result has. This is the view an outreach
    // message quotes, so it is the last place that should offer only a link.
    result.appendChild(buildShare(pairShare(pair)));

    var box = el("div", "scan-cross");
    var back = el("button", "scan-btn scan-btn--quiet", t("compareBack", "Back to the full result"));
    back.type = "button";
    back.addEventListener("click", function () {
      comparing = false; rivalsOn = false; subject = null; render(lastData);
    });
    box.appendChild(back);
    result.appendChild(box);

    // The report is the reader's own audit. It does not belong under somebody
    // else's pair of columns.
    if (!subject) result.appendChild(buildCapture());
    show(result, true);
  }

  /* ── the bar ───────────────────────────────────────────
     A score out of 100 has no mental scale attached, and a peer median only
     works if you have actually measured the peers. A target needs no sample —
     but it does need a derivation, or it is a number someone felt like.

     Both targets fall out of the weights. Security: fifteen checks share 100 —
     noindex 15, then the headers, then the page — and at 10 points of
     deductions nothing weighing more than 10 can be failing, so 90 means the
     page is indexable and HTTPS, HSTS, a CSP that actually stops injected
     script and closed framing are all correct. 90 is the lowest number that
     still guarantees all five; at 89 transport drops out.

     AI visibility derives the same 90 the same way. At ten points of slack
     nothing weighing eleven or more can be failing, which on that instrument
     is: the entity block present (40), parsing (25), naming an Organization
     (15), the content in the served HTML (25), GPTBot not blocked (15), and
     HTTPS (11). 90 is again the lowest number that holds all six — at 89 the
     11-point transport check drops out, exactly as it does on the other
     instrument. Those six are the line every answer engine shares, because
     none of them reliably run JavaScript and all of them need an entity to
     attach a recommendation to.

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
    if (lastData) box.appendChild(buildShare(singleShare(lastData, target)));
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

  // What the reader would say out loud, not what was typed into the form.
  function bareUrl(u) {
    return String(u).replace(/^https?:\/\//, "").replace(/\/$/, "");
  }

  function instrumentName() {
    var h1 = document.querySelector("h1");
    return h1 ? h1.textContent.trim() : "";
  }

  function today() { return new Date().toISOString().slice(0, 10); }

  // Worst first, everywhere: the ordinal in the card and in the pasted text is
  // the priority, the same ordering the downloaded report prints.
  function gapsOf(data) {
    return (data.checks || []).filter(function (c) { return !c.pass; })
             .sort(function (a, b) { return b.deduction - a.deduction; });
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
    x.fillStyle = MUTED;
    x.font = cardFonts(500, 20, "DM Sans");
    x.textAlign = "right";
    x.fillText(instrumentName(), CARD_W - M, M + 24);
    x.textAlign = "left";

    x.fillStyle = TEXT;
    x.font = cardFonts(400, 26, "DM Sans");
    x.fillText(bareUrl(data.url), M, 208);

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
    var worst = gapsOf(data)[0];
    if (worst) wrap("\u2212" + worst.deduction + "  " + worst.title, y + 12, 22, MUTED);

    x.fillStyle = MUTED;
    x.font = cardFonts(400, 20, "DM Sans");
    x.fillText("jldatrum.com", M, CARD_H - 44);

    return c;
  }

  // Drawn after the fonts have loaded, never before: canvas 2D takes whatever
  // the document has at the moment of the call, and a card in fallback sans is
  // the thing this route exists to avoid.
  function pngBlob(make) {
    return (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve())
      .then(function () {
        return new Promise(function (resolve, reject) {
          make().toBlob(function (b) {
            b ? resolve(b) : reject(new Error("canvas"));
          }, "image/png");
        });
      });
  }

  /* ── the results, as something you can paste ───────────
     A link is the better artifact and it is still here, but a cold recipient
     is right to be wary of one and half of them will not open it. So the
     findings themselves have to travel inside the message: the head, and every
     gap with the one sentence that says what it costs. Not the report — the
     report is the file the address buys, with the technical line under each
     row and the passing checks at the back.

     Two representations, one clipboard write. A messenger takes the image; a
     plain text field takes the text. Nothing here is behind the gate: the free
     view already names every gap and prints its plain sentence, and the points
     and the technical reasons are left out of both.
     ──────────────────────────────────────────────────── */

  // Enough to be a diagnosis, short enough to stay a message. What is left out
  // is counted out loud rather than dropped — a card that quietly shows eight
  // of twelve is a card that flatters.
  var CARD_GAPS = 8;

  // What the grade does not already say. On the card the grade is set large
  // above this line; in the text there is nothing to set large, so the grade
  // and the score are put back in front of it there.
  function scoreLine(data, target) {
    var s = data.passed + "/" + data.total + " " + t("passedLabel", "checks passed");
    if (isFinite(target) && target) s += "  ·  " + t("targetLabel", "The bar") + " " + target;
    return s;
  }

  // Canvas has no line breaking. Wrapping and drawing are one pass, so a line
  // that fits while measuring cannot fail to fit while drawing. Pass draw
  // false to get the height without painting anything.
  function wrapText(x, text, left, right, y, size, fill, weight, draw) {
    x.font = cardFonts(weight || 400, size, "DM Sans");
    x.fillStyle = fill;
    var words = String(text).split(/\s+/), line = "",
        step = Math.round(size * 1.4), max = right - left;
    for (var i = 0; i < words.length; i++) {
      var probe = line ? line + " " + words[i] : words[i];
      if (x.measureText(probe).width > max && line) {
        if (draw) x.fillText(line, left, y);
        y += step; line = words[i];
      } else { line = probe; }
    }
    if (line) { if (draw) x.fillText(line, left, y); y += step; }
    return y;
  }

  // Laid out twice against the same code: once to find the height, once to
  // draw it. The gap sentences wrap, so the height cannot be known before the
  // wrapping is done.
  function drawResults(data, target) {
    var c = document.createElement("canvas");
    var x = c.getContext("2d");
    var M = 72, IND = 62, RIGHT = CARD_W - M;
    var gaps = gapsOf(data), shown = gaps.slice(0, CARD_GAPS), rest = gaps.length - shown.length;

    function layout(draw, H) {
      function put(text, left, y, size, fill, weight) {
        return wrapText(x, text, left, RIGHT, y, size, fill, weight, draw);
      }

      function rule(y) {
        if (!draw) return;
        x.strokeStyle = BORDER; x.lineWidth = 2;
        x.beginPath(); x.moveTo(M, y); x.lineTo(RIGHT, y); x.stroke();
      }

      if (draw) { x.fillStyle = BG; x.fillRect(0, 0, CARD_W, H); }

      var y = M + 26;
      if (draw) {
        x.fillStyle = LEMON;
        x.font = cardFonts(700, 34, "Space Grotesk");
        x.letterSpacing = "2px";
        x.fillText("DATRUM", M, y);
        x.letterSpacing = "0px";
        x.fillStyle = MUTED;
        x.font = cardFonts(500, 20, "DM Sans");
        x.textAlign = "right";
        x.fillText(instrumentName(), RIGHT, y - 2);
        x.textAlign = "left";
      }

      y += 66;
      if (draw) {
        x.fillStyle = TEXT;
        x.font = cardFonts(400, 26, "DM Sans");
        x.fillText(bareUrl(data.url), M, y);
      }

      y += 92;
      if (draw) {
        x.fillStyle = LEMON;
        x.font = cardFonts(600, 92, "Space Grotesk");
        x.fillText(data.grade, M, y);
        var gw = x.measureText(data.grade).width;
        x.fillStyle = MUTED;
        x.font = cardFonts(400, 28, "DM Sans");
        x.fillText(data.score + "/100", M + gw + 22, y);
      }

      y += 44;
      if (draw) {
        x.fillStyle = MUTED;
        x.font = cardFonts(400, 22, "DM Sans");
        x.fillText(scoreLine(data, target), M, y);
      }

      y += 34;
      rule(y);
      y += 52;

      if (!gaps.length) {
        y = put(t("cleanLabel", "No gaps found. Every check passed."), M, y, 26, TEXT, 600);
      } else {
        if (draw) {
          x.fillStyle = MUTED;
          x.font = cardFonts(500, 20, "DM Sans");
          x.fillText(t("gapsLabel", "Gaps") + " (" + gaps.length + ")", M, y);
        }
        y += 46;
        shown.forEach(function (gap, i) {
          var top = y;
          if (draw) {
            x.fillStyle = "#E5484D";
            x.font = cardFonts(600, 24, "DM Sans");
            x.fillText("✕", M, top);
            x.fillStyle = MUTED;
            x.font = cardFonts(500, 22, "DM Sans");
            x.fillText(String(i + 1), M + 32, top);
          }
          y = put(gap.title, M + IND, y, 26, TEXT, 600);
          if (gap.so) y = put(gap.so, M + IND, y + 8, 23, MUTED);
          y += 34;
        });
        // Flush with the marks rather than with the titles: it closes the list
        // instead of reading as a ninth line belonging to the eighth gap.
        if (rest > 0) y = put(t("moreGaps", "+{n} more").replace("{n}", rest), M, y + 4, 22, MUTED);
      }

      y += 18;
      rule(y);
      y += 44;
      if (draw) {
        x.fillStyle = MUTED;
        x.font = cardFonts(400, 20, "DM Sans");
        x.fillText("jldatrum.com  ·  " + today(), M, y);
      }
      return y + M - 20;
    }

    var h = layout(false, 0);
    c.width = CARD_W; c.height = h;   // resizing clears the context; layout sets
    layout(true, h);                  // its own font and fill on every line
    return c;
  }

  function resultsText(data, target) {
    var gaps = gapsOf(data), shown = gaps.slice(0, CARD_GAPS), rest = gaps.length - shown.length;
    var name = instrumentName();
    var out = ["DATRUM" + (name ? " — " + name : ""),
               bareUrl(data.url) + " · " + today(),
               "",
               data.grade + " · " + data.score + "/100 · " +
                 scoreLine(data, target).replace(/ {2}/g, " "),
               ""];

    if (!gaps.length) {
      out.push(t("cleanLabel", "No gaps found. Every check passed."));
    } else {
      out.push(t("gapsLabel", "Gaps") + " (" + gaps.length + ")", "");
      // The mark travels with the title. Every check is titled for what it
      // prevents — "Structured data is present" — so a bare line under a
      // heading reads as the good news, which is the opposite of the finding.
      shown.forEach(function (gap, i) {
        out.push("✕ " + (i + 1) + ". " + gap.title);
        if (gap.so) out.push("   " + gap.so);
        out.push("");
      });
      if (rest > 0) out.push(t("moreGaps", "+{n} more").replace("{n}", rest), "");
    }

    out.push("jldatrum.com");
    return out.join("\n");
  }

  /* ── the pair, as something you can paste ──────────────
     The comparison is the first-touch artifact: two doors, one shut on the
     engine and one on the buyer, about a site the recipient owns and has not
     asked anyone to look at. It travels the same six ways the single result
     does, because the channel decides the form and a stranger's inbox is the
     hardest channel of all.

     Fewer gaps shown per instrument than on a single card. Two lists in one
     message is already the long version, and the verdict above them is what
     the first line of an outreach note is actually quoting.
     ──────────────────────────────────────────────────── */

  var PAIR_GAPS = 6;

  function pairSides(pair) {
    return [{ name: t("ownName", ""),   data: pair.mine,
              bar: Number(root.dataset.target) },
            { name: t("otherName", ""), data: pair.theirs,
              bar: Number(root.dataset.otherTarget) }];
  }

  function pairName(pair, kind) {
    var host;
    try { host = new URL(pair.url).hostname; } catch (e) { host = "site"; }
    return "datrum-" + host + "-both" + (kind ? "-" + kind : "") + ".png";
  }

  // The head both pair cards share: the two grades beside each other, then the
  // joint verdict. Drawn identically on the 630 card and on the tall one, so
  // the pair reads the same whichever of the two gets sent.
  function paintPairHead(x, pair, draw) {
    var M = 72, RIGHT = CARD_W - M, sides = pairSides(pair);

    var y = M + 26;
    if (draw) {
      x.fillStyle = LEMON;
      x.font = cardFonts(700, 34, "Space Grotesk");
      x.letterSpacing = "2px";
      x.fillText("DATRUM", M, y);
      x.letterSpacing = "0px";
      x.fillStyle = MUTED;
      x.font = cardFonts(500, 20, "DM Sans");
      x.textAlign = "right";
      x.fillText(t("compareTitle", "Side by side"), RIGHT, y - 2);
      x.textAlign = "left";
    }

    y += 66;
    if (draw) {
      x.fillStyle = TEXT;
      x.font = cardFonts(400, 26, "DM Sans");
      x.fillText(bareUrl(pair.url), M, y);
    }

    // Side by side stays side by side: two grades on one line is the whole
    // claim, and it survives being looked at on a phone.
    y += 76;
    sides.forEach(function (s, i) {
      if (!draw || !s.data) return;
      var left = i === 0 ? M : Math.round(CARD_W / 2) + 12;
      x.fillStyle = MUTED;
      x.font = cardFonts(500, 20, "DM Sans");
      x.fillText(s.name, left, y);

      x.fillStyle = LEMON;
      x.font = cardFonts(600, 76, "Space Grotesk");
      x.fillText(s.data.grade, left, y + 74);
      var gw = x.measureText(s.data.grade).width;
      x.fillStyle = MUTED;
      x.font = cardFonts(400, 26, "DM Sans");
      x.fillText(s.data.score + "/100", left + gw + 18, y + 74);

      x.font = cardFonts(400, 20, "DM Sans");
      x.fillText(scoreLine(s.data, s.bar), left, y + 110);
    });

    y += 196;
    var says = verdict(pair);
    if (says) y = wrapText(x, says, M, RIGHT, y, 26, TEXT, 400, draw);
    return y;
  }

  function drawPairCard(pair) {
    var c = document.createElement("canvas");
    c.width = CARD_W; c.height = CARD_H;
    var x = c.getContext("2d");
    x.fillStyle = BG;
    x.fillRect(0, 0, CARD_W, CARD_H);
    paintPairHead(x, pair, true);
    x.fillStyle = MUTED;
    x.font = cardFonts(400, 20, "DM Sans");
    x.fillText("jldatrum.com", 72, CARD_H - 44);
    return c;
  }

  function drawPairResults(pair) {
    var c = document.createElement("canvas");
    var x = c.getContext("2d");
    var M = 72, IND = 62, RIGHT = CARD_W - M;

    function layout(draw, H) {
      if (draw) { x.fillStyle = BG; x.fillRect(0, 0, CARD_W, H); }
      var y = paintPairHead(x, pair, draw);

      pairSides(pair).forEach(function (s) {
        if (!s.data) return;
        var gaps = gapsOf(s.data), shown = gaps.slice(0, PAIR_GAPS),
            rest = gaps.length - shown.length;

        y += 34;
        if (draw) {
          x.strokeStyle = BORDER; x.lineWidth = 2;
          x.beginPath(); x.moveTo(M, y); x.lineTo(RIGHT, y); x.stroke();
        }
        y += 46;

        if (draw) {
          x.fillStyle = MUTED;
          x.font = cardFonts(500, 20, "DM Sans");
          x.fillText(s.name + "  ·  " + (gaps.length
            ? t("gapsLabel", "Gaps") + " (" + gaps.length + ")"
            : t("cleanLabel", "No gaps found. Every check passed.")), M, y);
        }
        y += 44;

        shown.forEach(function (gap, i) {
          var top = y;
          if (draw) {
            x.fillStyle = "#E5484D";
            x.font = cardFonts(600, 24, "DM Sans");
            x.fillText("✕", M, top);
            x.fillStyle = MUTED;
            x.font = cardFonts(500, 22, "DM Sans");
            x.fillText(String(i + 1), M + 32, top);
          }
          y = wrapText(x, gap.title, M + IND, RIGHT, y, 26, TEXT, 600, draw);
          if (gap.so) y = wrapText(x, gap.so, M + IND, RIGHT, y + 8, 23, MUTED, 400, draw);
          y += 34;
        });
        if (rest > 0)
          y = wrapText(x, t("moreGaps", "+{n} more").replace("{n}", rest),
                       M, RIGHT, y + 4, 22, MUTED, 400, draw);
      });

      y += 18;
      if (draw) {
        x.strokeStyle = BORDER; x.lineWidth = 2;
        x.beginPath(); x.moveTo(M, y); x.lineTo(RIGHT, y); x.stroke();
      }
      y += 44;
      if (draw) {
        x.fillStyle = MUTED;
        x.font = cardFonts(400, 20, "DM Sans");
        x.fillText("jldatrum.com  ·  " + today(), M, y);
      }
      return y + M - 20;
    }

    var h = layout(false, 0);
    c.width = CARD_W; c.height = h;
    layout(true, h);
    return c;
  }

  function pairText(pair) {
    var out = ["DATRUM — " + t("compareTitle", "Side by side"),
               bareUrl(pair.url) + " · " + today(), ""];

    var says = verdict(pair);
    if (says) out.push(says, "");

    pairSides(pair).forEach(function (s) {
      if (!s.data) return;
      out.push(s.name + " — " + s.data.grade + " · " + s.data.score + "/100 · " +
               scoreLine(s.data, s.bar).replace(/ {2}/g, " "), "");

      var gaps = gapsOf(s.data), shown = gaps.slice(0, PAIR_GAPS),
          rest = gaps.length - shown.length;
      if (!gaps.length) {
        out.push(t("cleanLabel", "No gaps found. Every check passed."), "");
        return;
      }
      shown.forEach(function (gap, i) {
        out.push("✕ " + (i + 1) + ". " + gap.title);
        if (gap.so) out.push("   " + gap.so);
        out.push("");
      });
      if (rest > 0) out.push(t("moreGaps", "+{n} more").replace("{n}", rest), "");
    });

    out.push("jldatrum.com");
    return out.join("\n");
  }

  // The host and the score, so a folder of these sorts by site and a file
  // named in a cold email says what it is before it is opened.
  function cardName(data, kind) {
    var host;
    try { host = new URL(data.url).hostname; } catch (e) { host = "site"; }
    return "datrum-" + host + "-" + data.score + (kind ? "-" + kind : "") + ".png";
  }

  // A download, not an image load: img-src is 'self' data:, but an anchor is
  // free to take a blob: URL and this never reaches an <img>.
  function saveBlob(b, name) {
    var href = URL.createObjectURL(b);
    var a = document.createElement("a");
    a.href = href; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(href); }, 30000);
  }

  /* ── a link somebody else can open ─────────────────────
     The link carries the URL that was tested and nothing else — no result and
     no id, because there is no stored result to point an id at. Opening it
     runs the test again, so a recipient sees the site as it is now rather
     than a number the sender kept. Two consequences worth stating: the score
     can differ from the one the sender saw, which is the honest outcome when
     a site has changed in between; and "the results are not stored", which is
     printed on this page, stays true.

     ?c=1 asks for the side-by-side, which costs the opener two scans.
     ──────────────────────────────────────────────────── */

  function shareUrl() {
    // Whatever is on screen is what gets sent. Comparing a rival and copying
    // the link hands the recipient that rival's pair, run fresh on their side.
    var p = comparing ? pairFor(subject) : null;
    var u = (p && p.url) || (lastData && lastData.url) || lastUrl;
    var link = location.origin + location.pathname + "?u=" + encodeURIComponent(u);
    if (comparing) link += "&c=1";
    return link;
  }

  function linkButton(say) {
    var b = el("button", "scan-btn scan-btn--quiet", t("linkBtn", "Copy link"));
    b.type = "button";
    b.addEventListener("click", function () {
      var ok = function () {
        say.textContent = t("linkCopied", "Link copied. It runs the test again when opened.");
      };
      // Where the clipboard is refused, print the link rather than telling the
      // reader to go and find it: the page URL is not the share URL.
      var no = function () {
        say.textContent = t("linkFailed", "Copy this link:") + " " + shareUrl();
      };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText)
          navigator.clipboard.writeText(shareUrl()).then(ok, no);
        else no();
      } catch (e) { no(); }
    });
    return b;
  }

  // One row, two subjects. The single result and the pair differ only in what
  // they draw and what they write, so they hand this the same four things and
  // every button below means exactly what it means in the other view.
  function singleShare(data, target) {
    return {
      card:    function () { return drawCard(data, target); },
      results: function () { return drawResults(data, target); },
      text:    function () { return resultsText(data, target); },
      name:    function (kind) { return cardName(data, kind); }
    };
  }

  function pairShare(pair) {
    return {
      card:    function () { return drawPairCard(pair); },
      results: function () { return drawPairResults(pair); },
      text:    function () { return pairText(pair); },
      name:    function (kind) { return pairName(pair, kind); }
    };
  }

  function buildShare(spec) {
    var box = el("div", "scan-share");

    // The text on its own, first in the row. It is the one that belongs in a
    // cold email: an attachment from an unknown sender is a deliverability
    // signal and half the clients block remote images anyway, so a diagnosis
    // sent as a picture arrives as a grey box. This one renders in the preview
    // pane and survives being forwarded into their own thread.
    var plain = el("button", "scan-btn scan-btn--quiet", t("copyTextBtn", "Copy text"));
    plain.type = "button";
    var copy = el("button", "scan-btn scan-btn--quiet", t("copyBtn", "Copy image"));
    copy.type = "button";
    var both = el("button", "scan-btn scan-btn--quiet", t("copyBothBtn", "Copy image + results"));
    both.type = "button";
    var down = el("button", "scan-btn scan-btn--quiet", t("downloadBtn", "Download image"));
    down.type = "button";
    var downBoth = el("button", "scan-btn scan-btn--quiet",
                      t("downloadBothBtn", "Download image + results"));
    downBoth.type = "button";
    var say = el("span", "scan-share-say");
    say.setAttribute("role", "status");
    say.setAttribute("aria-live", "polite");

    plain.addEventListener("click", function () {
      var body = spec.text();
      var go;
      try {
        go = (navigator.clipboard && navigator.clipboard.writeText)
          ? navigator.clipboard.writeText(body)
          : Promise.reject(new Error("unsupported"));
      } catch (e) { go = Promise.reject(e); }

      plain.disabled = true;
      go.then(function () {
          say.textContent = t("copiedText", "Copied as text. Paste it into an email.");
        })
        .catch(function () {
          say.textContent = t("copyTextFailed",
            "This browser will not let the page copy — download it instead.");
        })
        .then(function () { plain.disabled = false; });
    });

    // Clipboard image write is not universal, and Firefox in particular will
    // reject it. Offer the button, and say plainly when it will not go.
    copy.addEventListener("click", function () {
      copy.disabled = true;
      pngBlob(spec.card)
        .then(function (b) {
          if (!navigator.clipboard || !window.ClipboardItem) throw new Error("unsupported");
          return navigator.clipboard.write([new window.ClipboardItem({ "image/png": b })]);
        })
        .then(function () { say.textContent = t("copied", "Copied."); })
        .catch(function () { say.textContent = t("copyFailed", "This browser will not copy images — download it instead."); })
        .then(function () { copy.disabled = false; });
    });

    // Both representations go on in one write, inside the click itself: Safari
    // only honours a clipboard write from the gesture that started it, so the
    // image goes in as a promise rather than after an await. Where images are
    // refused outright — Firefox — the text still goes, which in a message is
    // the half that carries the finding.
    both.addEventListener("click", function () {
      var text = spec.text();
      var wrote = null;
      try {
        if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem)
          wrote = navigator.clipboard.write([new window.ClipboardItem({
            "image/png": pngBlob(spec.results),
            "text/plain": new Blob([text], { type: "text/plain" })
          })]);
      } catch (e) { wrote = null; }

      both.disabled = true;
      (wrote || Promise.reject(new Error("unsupported")))
        .then(function () {
          say.textContent = t("copiedBoth", "Copied. Paste it straight into a message.");
        })
        .catch(function () {
          return navigator.clipboard.writeText(text).then(function () {
            say.textContent = t("copiedTextOnly",
              "This browser will not copy images — the results went across as text.");
          });
        })
        .catch(function () {
          say.textContent = t("copyFailed", "This browser will not copy images — download it instead.");
        })
        .then(function () { both.disabled = false; });
    });

    // Two downloads, one handler. The clipboard is the right way into a
    // messenger; a file is the right way into a mail client, where there is
    // nothing to paste into and an attachment is what the composer expects.
    function saver(button, make, kind) {
      button.addEventListener("click", function () {
        button.disabled = true;
        make()
          .then(function (b) {
            saveBlob(b, spec.name(kind));
            say.textContent = t("downloaded", "Saved.");
          })
          .catch(function () { say.textContent = t("genericError", "The scan failed."); })
          .then(function () { button.disabled = false; });
      });
    }

    saver(down, function () { return pngBlob(spec.card); }, "");
    saver(downBoth, function () { return pngBlob(spec.results); }, "results");

    box.appendChild(plain);
    box.appendChild(copy);
    box.appendChild(both);
    box.appendChild(down);
    box.appendChild(downBoth);
    box.appendChild(linkButton(say));
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
    var locked = GATED && !unlocked;
    box.appendChild(el("p", "scan-capture-lede",
      locked ? t("unlockLede", "Get the full audit \u2014 what each gap costs and why it stops a reader.")
             : t("reportLede", "Download this as a report \u2014 one file you can send on.")));

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

    var go = el("button", "scan-btn",
      locked ? t("unlockBtn", "Show the full audit") : t("reportBtn", "Get the report"));
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
          if (GATED && !unlocked) {
            // Unlocking from the comparison drops back to the full result. The
            // side-by-side view holds no reasons, so redrawing it would show
            // the reader nothing for the address they just handed over. The
            // second column is already scanned; the button reopens it free.
            unlocked = true;
            comparing = false;
            rivalsOn  = false;
            subject   = null;
            render(lastData);        // the same result, now with its reasons
            downloadReport();
            return;
          }
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
      // The mark and the number are what make this readable down a phone line:
      // one glance finds the failures, and "number three" points at a row
      // without anybody reading a title aloud. The gaps are sorted worst first,
      // so the ordinal carries the priority rather than decorating it.
      "td.x{width:2.4em;padding-right:8px;white-space:nowrap;color:#E5484D;",
      "font-weight:600;font-size:15px}",
      "td.x .n{color:#9AABAF;font-weight:500;font-size:13px;margin-left:2px}",
      ".t{font-weight:600;margin:0 0 6px;font-size:17px}",
      ".so{margin:0 0 6px;color:#E8EDED;font-size:15px;line-height:1.55;max-width:62ch}",
      ".d{margin:0;color:#9AABAF;font-size:13.5px}",
      "ul{padding-left:18px;color:#9AABAF;font-size:14px}",
      ".ok{margin-top:56px}",
      ".ok h2{color:#6FCF97}",
      ".ok ul{columns:2;column-gap:32px;font-size:13px;line-height:1.8}",
      "@media (max-width:560px){.ok ul{columns:1}}",
      ".f{margin-top:48px;padding-top:16px;border-top:1px solid #1A3A40;",
      "color:#9AABAF;font-size:13px}",
      ".f a{color:#F2D24B}",
      "@media print{body{background:#fff;color:#111}.d,.sub,ul,.f{color:#444}.so{color:#111}",
      "td.c,.f a{color:#111}td.x{color:#B3231F}.ok h2{color:#1E7A46}}"
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
      gaps.forEach(function (c, i) {
        var tr = doc.createElement("tr");
        var mark = E("td", "x", "\u2715");
        mark.appendChild(E("span", "n", String(i + 1)));
        tr.appendChild(mark);
        var td = doc.createElement("td");
        td.appendChild(E("p", "t", c.title));
        // The plain sentence sits above the technical line and in the reading
        // colour: this file gets forwarded, and the person it lands on has to
        // be able to discuss the row without anyone translating it for them.
        if (c.so) td.appendChild(E("p", "so", c.so));
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

    // Kept, because the report is the audit and an audit says what it looked
    // at — but at the back and in two quiet columns. Nobody opens this file to
    // read what already works, and on a call it was in the way.
    var ok = lastData.checks.filter(function (c) { return c.pass; });
    if (ok.length) {
      var okBox = E("div", "ok");
      okBox.appendChild(E("h2", null, t("passedTitle", "Passed") + " (" + ok.length + ")"));
      var ul = doc.createElement("ul");
      ok.forEach(function (c) { ul.appendChild(E("li", null, c.title)); });
      okBox.appendChild(ul);
      wrap.appendChild(okBox);
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

  function start(raw) {
    var url = String(raw || "").trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;

    show(errorBox, false);
    show(result, false);
    status.textContent = t("scanning", "Fetching and parsing…");
    show(status, true);
    btn.disabled = true;

    // Consumed here rather than on the success path: a shared link whose first
    // scan fails must not leave the flag armed and silently turn the reader's
    // next, unrelated scan into a two-instrument comparison.
    var alsoCompare = wantCompare;
    wantCompare = false;

    // A new target invalidates the pair. Keeping the old second column would
    // put two different sites side by side under one URL.
    var id    = ++runId;
    lastUrl   = url;
    otherData = null;
    comparing = false;
    rivalsOn  = false;
    rivals    = [];
    subject   = null;

    runScan(url, MODE)
      .then(function (data) {
        if (id !== runId) return;        // superseded while this was in flight
        render(data);
        // A link that asked for the comparison runs the second instrument
        // itself, so the recipient lands on what the sender was looking at.
        // startCross keeps its own failure beside its own button.
        if (alsoCompare) return startCross();
      })
      .catch(function (err) {
        if (id !== runId) return;
        fail(err.message || t("genericError", "The scan failed."));
      })
      .finally(function () {
        if (id !== runId) return;
        show(status, false);
        btn.disabled = false;
      });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    start(input.value);
  });

  // Opening a shared link. The URL goes into the field first, so the page shows
  // what it is testing rather than running something invisible.
  //
  // A link runs without anyone pressing anything, so what it carries is checked
  // here before it costs a scan. The worker validates properly and answers in
  // the reader's language; this only refuses what is plainly not a URL, so a
  // crafted or mistyped link fills the field and waits rather than spending one
  // of the reader's sixty.
  function usable(raw) {
    try {
      var u = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw);
      return (u.protocol === "https:" || u.protocol === "http:") &&
             u.hostname.indexOf(".") > 0 && !u.username && !u.password;
    } catch (e) { return false; }
  }

  var q = new URLSearchParams(location.search);
  var qUrl = (q.get("u") || "").trim();
  if (qUrl) {
    input.value = qUrl;
    if (usable(qUrl)) {
      wantCompare = q.get("c") === "1";
      start(qUrl);
    }
  }
})();
