/* The Impersonation Check. One domain in, one verdict out, with the records
 * behind it. Its result is a verdict and not a score, which is why it is not
 * scan.js: that client is built around a graded checklist, and forcing a
 * yes/no through it would invent a grade.
 *
 * ⚠️ Every string from the worker goes through textContent. Strings for the
 * page come from root.dataset, the same contract as scan.js, so the two
 * languages share this one file.
 */
(function () {
  "use strict";
  var root = document.getElementById("scan");
  var form = document.getElementById("scanForm");
  if (!root || !form) return;

  var input  = document.getElementById("scanUrl");
  var btn    = document.getElementById("scanBtn");
  var status = document.getElementById("scanStatus");
  var errBox = document.getElementById("scanError");
  var result = document.getElementById("scanResult");
  var ENDPOINT = root.dataset.endpoint;
  var LANG = (document.documentElement.lang || "en").slice(0, 2) === "es" ? "es" : "en";
  var runId = 0;

  function t(key, fallback) { var v = root.dataset[key]; return v ? v : fallback; }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function render(d) {
    result.textContent = "";
    var yes = d.spoofable === true, unknown = d.spoofable === null;

    var head = el("div", "scan-head");
    var g = el("div", "scan-grade", unknown ? "—" : yes ? t("yes", "YES") : t("no", "NO"));
    g.setAttribute("data-band", unknown ? "mid" : yes ? "bad" : "good");
    head.appendChild(g);
    var meta = el("div", "scan-headmeta");
    meta.appendChild(el("p", "scan-score", d.verdict));
    meta.appendChild(el("p", "scan-target", d.domain));
    head.appendChild(meta);
    result.appendChild(head);

    if (d.note) result.appendChild(el("p", "scan-obslede", d.note));

    if (d.ownMail) {
      result.appendChild(el("h2", "scan-subhead", t("ownTitle", "Its own mail")));
      result.appendChild(el("p", "scan-obslede", d.ownMail));
    }

    result.appendChild(el("h2", "scan-subhead", t("readTitle", "What we read")));
    result.appendChild(el("p", "scan-obslede", t("readLede", "These are the public records behind the answer.")));
    var list = el("ul", "scan-checklist");
    (d.evidence || []).forEach(function (e) {
      var li = el("li", "is-ok");
      var body = el("span", "scan-check-title", e.name + "  " + e.type);
      var lines = e.answer === null ? [t("unreadable", "Could not be read")]
        : e.answer.length ? e.answer : [t("noRecord", "No record")];
      lines.forEach(function (ln) { body.appendChild(el("span", "scan-check-so", ln)); });
      li.appendChild(body);
      list.appendChild(li);
    });
    result.appendChild(el("div", "scan-checklist-box")).appendChild(list);

    if (d.lookalikes && d.lookalikes.checked) {
      result.appendChild(el("h2", "scan-subhead", t("lookTitle", "Similar names")));
      var n = d.lookalikes.registered.length;
      result.appendChild(el("p", "scan-obslede",
        (n ? t("lookSome", "{n} names checked, {k} registered.") : t("lookNone", "{n} names checked. None resolve."))
          .replace("{n}", d.lookalikes.checked).replace("{k}", n)));
      if (n) {
        var ul = el("ul", "scan-checklist");
        d.lookalikes.registered.forEach(function (name) {
          var li = el("li", "is-ok");
          li.appendChild(el("span", "scan-check-title", name));
          ul.appendChild(li);
        });
        result.appendChild(el("div", "scan-checklist-box")).appendChild(ul);
      }
    }
    result.appendChild(el("p", "scan-legal", t("method", "Method") + " " + d.method_version));
    result.hidden = false;
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var domain = input.value.trim();
    if (!domain) return;
    var mine = ++runId;
    errBox.hidden = true; result.hidden = true;
    status.textContent = t("scanning", "Reading the records…");
    status.hidden = false; btn.disabled = true;

    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: domain, lang: LANG, mode: "mail" })
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok || d.error) throw new Error(d.error || t("genericError", "The check failed."));
        return d;
      });
    }).then(function (d) {
      if (mine !== runId) return;
      render(d);
    }).catch(function (err) {
      if (mine !== runId) return;
      errBox.textContent = err.message;
      errBox.hidden = false;
    }).then(function () {
      if (mine !== runId) return;
      status.hidden = true; btn.disabled = false;
    });
  });
})();
