/* ── DATRUM scan log — Google Apps Script ──────────────────────────────
 *
 * WHAT IT IS. One Google Sheet, one row per prospect URL, written by all three
 * instruments. Each fills its own pair of columns, and a second scan of the
 * same URL updates the row it already has instead of appending a duplicate.
 * Everything a human types — business name, vertical, outreach status — is
 * never touched by this script.
 *
 * WHY IT IS NOT IN THE SITE REPO'S ROOT. The repo root is the Cloudflare Pages
 * deploy directory, so anything tracked there is a public URL. `/worker/*`
 * 301s to /404, which is why this file lives here.
 *
 * ⚠️ THE /exec URL IS A CAPABILITY URL. No login, no key, possession is the
 * permission — the same species of thing as the old scorecard endpoint. That
 * is why every request must carry SHARED_TOKEN, and why the worker keeps the
 * URL in a wrangler secret rather than in this repo. Anyone who finds the URL
 * without the token gets a 200 that writes nothing.
 *
 * ── SETUP, ONCE ───────────────────────────────────────────────────────
 * 1. Create the Sheet. Copy its id from the address bar:
 *      docs.google.com/spreadsheets/d/<THIS PART>/edit
 * 2. script.google.com → New project → paste this file.
 * 3. Project Settings → Script Properties → add three:
 *      SHEET_ID      the id from step 1
 *      SHEET_NAME    Prospects          (optional, this is the default)
 *      SHARED_TOKEN  a long random string — `openssl rand -hex 24`
 * 4. Deploy → New deployment → Web app
 *      Execute as:      Me
 *      Who has access:  Anyone
 *    Copy the /exec URL.
 * 5. Give the worker the URL and the token, as secrets, never as [vars]:
 *      cd worker
 *      npx wrangler secret put SHEET_URL      # the /exec URL from step 4
 *      npx wrangler secret put SHEET_TOKEN    # SHARED_TOKEN from step 3
 *      npx wrangler secret put OPERATOR_KEY   # a different random string
 *    OPERATOR_KEY is separate on purpose: it is the one that travels to a
 *    browser, so it must not be the one that can write to the Sheet.
 * 6. Verify without touching the site — this must answer {"ok":true}:
 *      curl -sL -X POST "<EXEC URL>" -H 'Content-Type: application/json' \
 *        -d '{"token":"<SHARED_TOKEN>","url":"https://example.com/",
 *             "mode":"","score":72,"grade":"C-","gaps":["a","b","c"]}'
 *
 * ⚠️ EDITING THIS FILE CHANGES NOTHING UNTIL YOU REDEPLOY. Deploy → Manage
 * deployments → the pencil → Version: New version. Apps Script serves the
 * deployed version, not the saved one, and the /exec URL stays the same.
 * ───────────────────────────────────────────────────────────────────── */

var COLUMNS = [
  "URL", "Business", "Vertical",
  "AI score", "AI grade", "Trust score", "Trust grade", "Radar score", "Radar grade",
  "AI gaps", "Trust gaps", "Radar gaps",
  "First scanned", "Last scanned", "Outreach status",
];

// mode as the worker sends it -> the pair of columns it owns.
var MODES = {
  "":            { score: "AI score",     grade: "AI grade",     gaps: "AI gaps" },
  "headers":     { score: "Trust score",  grade: "Trust grade",  gaps: "Trust gaps" },
  "responsive":  { score: "Radar score",  grade: "Radar grade",  gaps: "Radar gaps" },
};

/* The three do not share a scale — the AI score is normalised against a pool
   that varies with what could be measured, the Trust score is 100 minus
   deductions out of a fixed 93, and the Radar is normalised over whichever of
   its three checks could be measured. Merging their gaps into one ranked list
   would be sorting numbers that do not mean the same thing, so each keeps its
   own column and the ordering inside a column is real. */
var COL = {};
for (var i = 0; i < COLUMNS.length; i++) COL[COLUMNS[i]] = i + 1;

function prop(name, fallback) {
  var v = PropertiesService.getScriptProperties().getProperty(name);
  return (v === null || v === "") ? fallback : v;
}

/* Two addresses that differ only by scheme, www or a trailing slash are one
   prospect. Query strings and fragments are dropped: they are how the same
   page arrives twice. */
function normalizeUrl(raw) {
  var s = String(raw || "").trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  s = s.split("#")[0].split("?")[0];
  s = s.replace(/\/+$/, "");
  return s;
}

function sheet_() {
  var id = prop("SHEET_ID", "");
  if (!id) throw new Error("SHEET_ID is not set in Script Properties");
  var book = SpreadsheetApp.openById(id);
  var name = prop("SHEET_NAME", "Prospects");
  var sh = book.getSheetByName(name) || book.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(COLUMNS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, COLUMNS.length).setFontWeight("bold");
  }
  return sh;
}

/* Returns the 1-indexed row for this URL, or 0. Reading column A in one call
   rather than per-row: a sheet heading for 500 prospects should not cost 500
   round trips. */
function findRow_(sh, key) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var col = sh.getRange(2, COL["URL"], last - 1, 1).getValues();
  for (var i = 0; i < col.length; i++)
    if (normalizeUrl(col[i][0]) === key) return i + 2;
  return 0;
}

function doGet() {
  // A deployment that answers this is live; one that 404s was never deployed.
  return json_({ ok: true, service: "datrum-scan-log" });
}

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return json_({ ok: false, error: "bad json" }); }

  // Wrong or missing token answers 200 and writes nothing. A 401 would tell
  // whoever found the URL that the URL is real and only the token is missing.
  var expected = prop("SHARED_TOKEN", "");
  if (!expected || String(body.token || "") !== expected)
    return json_({ ok: true });

  var key = normalizeUrl(body.url);
  if (!key) return json_({ ok: false, error: "no url" });

  // Two scans of the same prospect land seconds apart — the AI one and the
  // header one. Without the lock both read "no row yet" and both append.
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet_();
    var row = findRow_(sh, key);
    var now = new Date();

    if (!row) {
      row = sh.getLastRow() + 1;
      sh.getRange(row, COL["URL"]).setValue(body.url);
      sh.getRange(row, COL["First scanned"]).setValue(now);
    }

    var cols = MODES[String(body.mode || "")];
    // An unknown mode means a fourth instrument shipped and this script did
    // not. Writing it into the AI columns would corrupt the one number the
    // row exists for, so it is refused loudly instead.
    if (!cols) return json_({ ok: false, error: "unknown mode: " + String(body.mode || "") });

    var score = Number(body.score);
    if (isFinite(score)) {
      sh.getRange(row, COL[cols.score]).setValue(score);
      sh.getRange(row, COL[cols.grade]).setValue(String(body.grade || ""));
    }

    // The gaps arrive already cut to three and already sorted by what they
    // cost. Joining them here rather than in three columns keeps the row
    // readable next to a WhatsApp draft, which is the only place it is used.
    var gaps = (body.gaps || []).slice(0, 3);
    if (gaps.length) sh.getRange(row, COL[cols.gaps]).setValue(gaps.join("\n"));

    sh.getRange(row, COL["Last scanned"]).setValue(now);
    // Business, Vertical and Outreach status are never written here. They are
    // the human half of the row and a rescan must not erase them.
    return json_({ ok: true, row: row });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
