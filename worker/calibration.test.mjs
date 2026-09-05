/* ── The calibration harness ───────────────────────────────────────────
 *
 * WHY THIS EXISTS. The instrument graded studiodearquitectura.com 25/100 F on
 * AI visibility. That site ranks first for its category in Spanish and in
 * English, is summarised accurately by Google's AI Overview with citations to
 * five of its own URLs, and has its portfolio indexed project by project. The
 * grade was not marginally wrong, it was inverted: every hygiene signal the
 * scanner measured was failing and every outcome that matters was passing.
 *
 * A check being individually defensible does not make a scoring model right.
 * The only thing that catches an inverted model is a fixture whose real-world
 * answer is known in advance, so that is what this file is.
 *
 * THE RULE: a site that ranks and is described correctly must score above one
 * that does not. If the ordering inverts, the model is wrong regardless of how
 * defensible each check looks on its own. Assert DIRECTION, not precision.
 *
 * Run: node worker/calibration.test.mjs
 *
 * ⚠️ ADDING A REFERENCE. Capture the three files a scan reads —
 *     curl -sL -A "DATRUM-VisibilityScanner/1.0 (+https://jldatrum.com/resources/scan/)" \
 *       https://HOST/            -o worker/fixtures/NAME.html
 *     ...same for /robots.txt -> NAME.robots.txt and /sitemap.xml -> NAME.sitemap.xml
 *   — then add a REFERENCES entry. `outcome` is what was actually observed in a
 *   search engine on a named date, by a person who looked. It is NEVER a guess:
 *   a fixture with no recorded outcome takes part in no ordering assertion, and
 *   that is the correct behaviour, not a gap to fill in with an estimate.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const fx = n => readFileSync(join(HERE, "fixtures", n), "utf8");

/* The worker is a Cloudflare module and its HTML parser is HTMLRewriter, which
   does not exist in Node. Everything else in it is portable, so the scoring
   half is imported as-is and only the parse is re-implemented below. */
const src = readFileSync(join(HERE, "ai-visibility-scanner.js"), "utf8")
  + "\nexport { runChecks, grade, parseRobots, sitemapLocs, urlFamilies, namesAPerson, h1State };";
const M = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));

let pass = 0, fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}` + (ok ? "" : `   got=${JSON.stringify(got)} want=${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
};
const gte = (name, got, min) => {
  const ok = got >= min;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}` + (ok ? ` (${got})` : `   got=${got} want>=${min}`));
  ok ? pass++ : fail++;
};

/* ── the Node-side parse ───────────────────────────────────────────────
   A second parser is a second source of truth, which is a real risk. It is
   pinned below against what the DEPLOYED worker actually returned for the
   Piekno fixture, so a drift between the two fails this file rather than
   quietly changing what calibration means. */
const strip = h => h.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
                    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const attr = (tag, name) => (new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag) || [])
  .slice(2).find(x => x !== undefined) || "";

function docFromHtml(html) {
  const headings = [];
  for (const m of html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi))
    headings.push({ level: Number(m[1]), text: strip(m[2]) });
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map(m => m[0]);
  const meta = n => {
    const m = new RegExp(`<meta[^>]*\\bname\\s*=\\s*["']?${n}["']?[^>]*>`, "i").exec(html);
    return m ? attr(m[0], "content") : "";
  };
  const canonEl = /<link[^>]*\brel\s*=\s*["']?canonical["']?[^>]*>/i.exec(html);
  const htmlEl  = /<html\b[^>]*>/i.exec(html);
  return {
    title: (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [, ""])[1].replace(/\s+/g, " ").trim(),
    description: meta("description"),
    canonical: canonEl ? attr(canonEl[0], "href") : "",
    lang: htmlEl ? attr(htmlEl[0], "lang") : "",
    headings,
    h1: headings.filter(h => h.level === 1),
    jsonld: [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]),
    hreflang: [...html.matchAll(/\bhreflang\s*=/gi)].map(() => 1),
    imgTotal: imgs.length,
    imgNoAlt: imgs.filter(i => !/\balt\s*=/i.test(i)).length,
    textLen: strip(html).length,
    robotsMeta: meta("robots"),
    insecureRefs: 0,
  };
}

/* ── the references ────────────────────────────────────────────────────
   `outcome` is an observation someone made in a search engine on a date, not
   an expectation of this instrument. null means nobody has looked. */
const REFERENCES = [
  {
    name: "studiodearquitectura.com (PIEKNO Studio)",
    file: "studiodearquitectura",
    outcome: {
      recorded: "2026-09-04",
      rank: "first for its category in Spanish and in English",
      cited: true,
      note: "Google AI Overview summarises it accurately — founder named, services correct, "
          + "zones listed — citing five of its own URLs. Portfolio indexed project by project.",
    },
    // THE CEILING. Any build that grades this below a B is broken.
    floorGrade: 80,
  },
  {
    name: "jldatrum.com",
    file: "jldatrum",
    outcome: null,          // nobody has recorded where this ranks
    floorGrade: null,
  },
  {
    name: "brochure.example (synthetic)",
    file: "brochure",
    // Synthetic on purpose. Naming a real business as a low reference would be
    // recording a search outcome nobody measured.
    outcome: { recorded: "synthetic", rank: "none", cited: false,
               note: "A hand-written one-pager. No real business, no claim made about one." },
    floorGrade: null,
  },
];

function run(ref) {
  const html = fx(ref.file + ".html");
  const doc = docFromHtml(html);
  const robotsTxt = fx(ref.file + ".robots.txt");
  const sitemapXml = fx(ref.file + ".sitemap.xml");
  const locs = M.sitemapLocs(sitemapXml);
  const all = M.runChecks({
    doc,
    robots: { ok: true, served: true, groups: M.parseRobots(robotsTxt),
              declaresSitemap: /sitemap:/i.test(robotsTxt) },
    sitemap: { ok: true, served: true, declared: false },
    llms: { ok: false },
    headers: { hsts: "max-age=63072000" },
    shape: { seen: true, locs, families: M.urlFamilies(locs), person: M.namesAPerson(locs) },
    path: "/", lang: "en",
  });
  const checks = all.filter(c => c.report === "b");
  const observations = all.filter(c => c.report === "a");
  const pool = checks.reduce((n, c) => n + c.weight, 0);
  const deducted = checks.reduce((n, c) => n + c.deduction, 0);
  const score = pool > 0 ? Math.round(100 * (pool - deducted) / pool) : 0;
  return { doc, locs, checks, observations, score, grade: M.grade(score), pool, deducted };
}

/* ── the parse is pinned to what the live worker returned ──────────────
   Captured from ai-visibility.julioernestolv.workers.dev against the same
   page, 2026-09-04. If the Node parse and the Workers parse stop agreeing,
   this file is calibrating something other than the instrument. */
console.log("\nthe harness reads the page the way the worker does");
{
  const { doc } = run(REFERENCES[0]);
  t("four H1s, as the worker counted",     doc.h1.length, 4);
  t("three of them are bare numerals",     doc.h1.filter(h => !/\p{L}/u.test(h.text)).length, 3);
  t("no structured data, as the worker saw", doc.jsonld.length, 0);
  t("the title is the one the worker read", /PIEKNO Studio/.test(doc.title), true);
  gte("the words arrive with the page",    doc.textLen, 500);
}

/* ── the defect that produced this file ────────────────────────────────*/
console.log("\nno finding claims an absence that is not one");
for (const ref of REFERENCES) {
  const { observations, checks } = run(ref);
  const rows = [...observations, ...checks];
  const h1 = rows.find(r => r.id === "h1");
  const n = run(ref).doc.h1.length;
  if (n > 1)
    t(`${ref.name}: ${n} headings are not reported as none`,
      /^No heading|^No one heading/.test(h1.title), false);
  if (n === 0)
    t(`${ref.name}: an absence still reads as one`, /No heading/.test(h1.title), true);
}

/* ── report A carries no grade, report B carries no markup hygiene ─────*/
console.log("\nthe two reports stay separate");
for (const ref of REFERENCES) {
  const { checks, observations } = run(ref);
  t(`${ref.name}: observations cost nothing`,
    observations.every(o => o.deduction === undefined || o.deduction === 0), true);
  t(`${ref.name}: observations claim no consequence`,
    observations.every(o => o.so === undefined), true);
  t(`${ref.name}: the heading outline is not graded`,
    checks.some(c => c.id === "h1" || c.id === "heading-order"), false);
  t(`${ref.name}: entity markup is not graded`,
    checks.some(c => c.id.startsWith("ld-")), false);
  t(`${ref.name}: no finding is in both reports`,
    checks.filter(c => observations.some(o => o.id === c.id)).length, 0);
}

/* ── the ceiling ───────────────────────────────────────────────────────*/
console.log("\nthe ceiling reference");
{
  const ref = REFERENCES[0];
  const r = run(ref);
  console.log(`  ${ref.name}: ${r.score}/100 ${r.grade}  (pool ${r.pool}, lost ${r.deducted})`);
  console.log(`  outcome on ${ref.outcome.recorded}: ${ref.outcome.rank}`);
  gte("a site that ranks first and is cited scores at least a B", r.score, ref.floorGrade);
  t("...and that is a B or better", ["A+","A","A-","B+","B","B-"].includes(r.grade), true);
  // The failures it DOES have are markup, and markup is now an observation.
  t("its structured data is still reported", r.observations.some(o => o.id === "ld-present" && !o.pass), true);
  t("...as an observation, not a deduction", r.checks.some(c => c.id === "ld-present"), false);
}

/* ── direction ─────────────────────────────────────────────────────────
   The assertion the brief is built on. Only fixtures with a RECORDED outcome
   take part: comparing against a site nobody has looked up would be inventing
   the very number this file exists to protect against. */
console.log("\nordering follows the recorded outcomes, not the markup");
{
  const measured = REFERENCES.filter(r => r.outcome).map(r => ({ ref: r, ...run(r) }));
  const cited    = measured.filter(m => m.ref.outcome.cited);
  const uncited  = measured.filter(m => !m.ref.outcome.cited);
  for (const c of cited)
    for (const u of uncited)
      t(`${c.ref.name} outscores ${u.ref.name}`, c.score > u.score, true);
  if (!cited.length || !uncited.length)
    console.log("  --    only one side of the ordering has a recorded outcome; supply more references");
  console.log(`  --    ${REFERENCES.filter(r => !r.outcome).length} fixture(s) carry no recorded outcome and assert no ordering`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
