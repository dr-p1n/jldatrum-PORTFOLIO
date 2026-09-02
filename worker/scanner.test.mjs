/* Tests for the pure logic in ai-visibility-scanner.js.
   No Workers runtime needed — we strip the default export and import the rest.
   Run:  node worker/scanner.test.mjs                                        */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcPath = path.join(here, "ai-visibility-scanner.js");
const tmpPath = path.join(here, ".scanner.undertest.mjs");

let src = fs.readFileSync(srcPath, "utf8");
src = src.slice(0, src.indexOf("export default"));
src += "\nexport { isNoindex, langDeclared, mixedContent, canonicalOffsite, decodeEntities, parseRobots, blocksAgent, grade, validateTarget, isPrivateHost, AI_CRAWLERS, runChecks, STR, ERR, runHeaderChecks, HDR, validEmail, handleLead, titleNames, hasOneH1, descPresent, descUsable, canonicalAbs, headingSkip, headingCensus, ceiling };";
fs.writeFileSync(tmpPath, src);
const M = await import(tmpPath);
fs.unlinkSync(tmpPath);

let pass = 0, fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok ? "" : `   got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};
const g = s => M.parseRobots(s);

console.log("robots.txt");
t("Disallow:/ blocks",              M.blocksAgent(g("User-agent: *\nDisallow: /"), "GPTBot"), true);
t("Allow:/ permits",                M.blocksAgent(g("User-agent: *\nAllow: /"), "GPTBot"), false);
t("empty Disallow permits",         M.blocksAgent(g("User-agent: *\nDisallow:"), "GPTBot"), false);
t("no rules permits",               M.blocksAgent(g(""), "GPTBot"), false);
t("named group beats wildcard",     M.blocksAgent(g("User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /"), "GPTBot"), true);
t("...and spares other agents",     M.blocksAgent(g("User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /"), "ClaudeBot"), false);
t("user-agent is case-insensitive", M.blocksAgent(g("User-agent: gptbot\nDisallow: /"), "GPTBot"), true);
t("comments stripped",              M.blocksAgent(g("# x\nUser-agent: *\nDisallow: / # y"), "GPTBot"), true);
t("path rule misses root",          M.blocksAgent(g("User-agent: *\nDisallow: /admin"), "GPTBot", "/"), false);
t("path rule hits its subtree",     M.blocksAgent(g("User-agent: *\nDisallow: /admin"), "GPTBot", "/admin/x"), true);
t("longer Allow beats Disallow",    M.blocksAgent(g("User-agent: *\nDisallow: /\nAllow: /public"), "GPTBot", "/public/a"), false);

console.log("\nour own robots.txt lets every listed crawler through");
const ours = M.parseRobots(fs.readFileSync(path.join(here, "..", "robots.txt"), "utf8"));
for (const b of M.AI_CRAWLERS) t(b.ua, M.blocksAgent(ours, b.ua, "/"), false);

console.log("\ngrade bands");
for (const [s, e] of [[100,"A+"],[97,"A+"],[96,"A"],[93,"A"],[92,"A-"],[90,"A-"],
                      [89,"B+"],[87,"B+"],[86,"B"],[83,"B"],[82,"B-"],[80,"B-"],
                      [79,"C+"],[77,"C+"],[76,"C"],[73,"C"],[72,"C-"],[70,"C-"],
                      [69,"D+"],[67,"D+"],[66,"D"],[65,"D"],[63,"D"],[62,"D-"],[60,"D-"],
                      [59,"F"],[30,"F"],[0,"F"]])
  t(`${s} -> ${e}`, M.grade(s), e);

// The scale is the ordinary one a reader already knows, and it meets the bar
// where the bar is: both instruments are held to 90, and 90 is where A- starts.
t("the bar is exactly where A- begins", M.grade(90), "A-");
t("one under the bar is a B",           M.grade(89), "B+");
t("nothing under 60 passes",            M.grade(59), "F");

/* ── the plain sentence ────────────────────────────────────────────────
   Every check that can fail carries one sentence about what it costs the
   business, because the report is forwarded and discussed by people who do
   not read the technical line. A missing one ships a gap that cannot be
   talked about; an untranslated one ships English into a Spanish report. */
console.log("\nevery failure explains itself in plain language");
const soKeys = t => Object.keys(t).filter(k => t[k] && typeof t[k] === "object" && (t[k].t || t[k].d));
for (const [name, table] of [["STR", M.STR], ["HDR", M.HDR]]) {
  const en = soKeys(table.en).filter(k => k !== "groups" && k !== "weak");
  t(`${name}: every check has one in English`, en.filter(k => !table.en[k].so), []);
  t(`${name}: every check has one in Spanish`, en.filter(k => !table.es[k].so), []);
  t(`${name}: none is left in English`,
    en.filter(k => table.es[k].so === table.en[k].so), []);
  t(`${name}: one sentence, not a paragraph`,
    en.filter(k => (table.en[k].so.match(/\. /g) || []).length > 0), []);
  t(`${name}: no jargon in the plain line`,
    en.filter(k => /robots\.txt|JSON-LD|canonical|HSTS|CSP|X-Frame|hreflang|sitemap|meta |H1\b/.test(table.en[k].so)), []);
}

// It rides on failures only: a passing check has nothing to explain, and the
// payload is read by a browser on every scan.
const hs2 = { "strict-transport-security": "max-age=63072000" };
const someChecks = M.runHeaderChecks({ headers: { get: n => hs2[n.toLowerCase()] ?? null } },
                                     new URL("https://x.com/"), "en");
t("carried on failures", someChecks.filter(c => !c.pass).every(c => typeof c.so === "string"), true);
t("...and not on passes",  someChecks.filter(c =>  c.pass).every(c => c.so === undefined), true);
t("Spanish scan gets Spanish sentences",
  M.runHeaderChecks({ headers: { get: () => null } }, new URL("https://x.com/"), "es")
    .filter(c => !c.pass).every(c => c.so && c.so === M.HDR.es[Object.keys(M.HDR.es).find(k => M.HDR.es[k].t === c.title)].so), true);

console.log("\nSSRF: must reject");
for (const u of ["http://localhost/","http://127.0.0.1/","http://127.1.2.3/","https://192.168.1.1/",
  "https://10.0.0.5/","https://172.16.0.1/","https://172.31.255.254/","https://169.254.169.254/",
  "https://100.64.0.1/","https://0.0.0.0/","https://[::1]/","https://[fd00::1]/","https://[fe80::1]/",
  "https://239.1.1.1/","file:///etc/passwd","ftp://x.com/","https://foo.internal/","https://box.lan/",
  "https://a.local/","https://user:pw@evil.com/","not a url","https://nodot","https://999.1.1.1/"])
  t(u, !!M.validateTarget(u).error, true);

console.log("\nSSRF: must accept");
for (const u of ["https://jldatrum.com/","https://example.com/a/b?c=1","http://sub.domain.co.uk/",
                 "https://172.15.0.1/","https://172.32.0.1/","https://8.8.8.8/","https://100.63.0.1/"])
  t(u, !!M.validateTarget(u).error, false);

/* ── Localisation ──────────────────────────────────────────────────────
   The worker writes every check title and detail, so an untranslated key
   ships English into the Spanish report — exactly the bug this fixes.
   These assert parity rather than wording.                             */
console.log("\nlocalisation: every English key has a Spanish twin");
const enKeys = Object.keys(M.STR.en).sort();
const esKeys = Object.keys(M.STR.es).sort();
t("STR key sets match", esKeys, enKeys);
t("ERR key sets match", Object.keys(M.ERR.es).sort(), Object.keys(M.ERR.en).sort());
for (const b of M.AI_CRAWLERS) t(`${b.ua} has labelEs`, typeof b.labelEs, "string");

console.log("\nrunChecks renders in the requested language");
const emptyDoc = { jsonld: [], headings: [], h1: [], title: "", description: "",
                   canonical: "", hreflang: [], imgTotal: 0, imgNoAlt: 0, textLen: 0 };
const ctx = lang => ({ doc: emptyDoc, robots: { ok: false, groups: [] }, sitemap: { ok: false },
                       llms: { ok: false }, headers: {}, path: "/", lang });
const en = M.runChecks(ctx("en"));
const es = M.runChecks(ctx("es"));

t("same checks in both languages", es.map(c => c.id), en.map(c => c.id));
t("same deductions in both languages", es.map(c => c.deduction), en.map(c => c.deduction));
t("same pass/fail in both languages", es.map(c => c.pass), en.map(c => c.pass));
t("no check is left in English", es.filter(c => {
  const twin = en.find(e => e.id === c.id);
  return c.title === twin.title && c.detail === twin.detail;
}).map(c => c.id), []);
t("unknown lang falls back to English", M.runChecks(ctx("fr")).map(c => c.title), en.map(c => c.title));
t("ES prices the missing-JSON-LD root cause once", es.filter(c => c.id.startsWith("ld-")).length, 1);
t("ES blocked-crawler line names the crawler",
  /GPTBot/.test(es.find(c => c.id === "bot-GPTBot").title), true);

console.log("\nrefusals are explained, not just reported");
for (const lang of ["en", "es"]) {
  const E = M.ERR[lang];
  t(`${lang}: 403 names bot protection`, /bot protection|protecci/i.test(E.http(403)), true);
  t(`${lang}: 403 names GPTBot`,         /GPTBot/.test(E.http(403)), true);
  t(`${lang}: 401 treated like 403`,     E.http(401).length > 100, true);
  t(`${lang}: 429 is not a refusal`,     /429/.test(E.http(429)) && !/GPTBot/.test(E.http(429)), true);
  t(`${lang}: 500 stays terse`,          E.http(500).length < 60, true);
}
t("es 403 differs from en 403", M.ERR.es.http(403) === M.ERR.en.http(403), false);
t("no voseo left in es errors",
  Object.values(M.ERR.es).map(v => typeof v === "function" ? v(403) : v)
    .some(x => /\b(Prob\u00e1|Ingres\u00e1|Apunt\u00e1)\b/.test(x)), false);

console.log("\nsecurity headers test");
const res = hs => ({ headers: { get: n => hs[n.toLowerCase()] ?? null } });
const tgt = u => new URL(u);
const run = (hs, url = "https://x.com/", lang = "en") => M.runHeaderChecks(res(hs), tgt(url), lang);
const score = cs => Math.max(0, 100 - cs.reduce((s, c) => s + c.deduction, 0));
const by = (cs, id) => cs.find(c => c.id === id);

const ALL = {
  "strict-transport-security": "max-age=63072000",
  "content-security-policy": "default-src 'self'",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=()",
};
t("everything set scores 100",        score(run(ALL)), 100);
t("everything set grades A+",         M.grade(score(run(ALL))), "A+");
// A bare response cannot lose the whole header pool: absence of noindex IS the
// pass, so 15 of the 73 header points are already earned. What is left to lose
// is 58. If a weight moves, the bar of 90 stops being derivable and has to be
// recomputed, not renamed.
t("a bare response can still lose 58",
  run({}, "http://x.com/").reduce((n, c) => n + c.deduction, 0), 58);
t("...and noindex is what it keeps", by(run({}, "http://x.com/"), "noindex").pass, true);
t("nothing set over http bottoms out", score(run({}, "http://x.com/")), 42);
t("nothing set over http is still failing", M.grade(score(run({}, "http://x.com/"))), "F");
// HTTPS plus an indexable page earns two of the fifteen and nothing else, so
// it lands far below the bar rather than at zero.
t("https alone is not enough",        score(run({})) < 60, true);
t("...and nowhere near the bar",      score(run({})) < 90, true);
t("8 header checks without a document", run(ALL).length, 8);

t("plain http fails the https check", by(run({}, "http://x.com/"), "https").pass, false);
t("https passes it",                  by(run({}), "https").pass, true);
t("nosniff must say nosniff",         by(run({ "x-content-type-options": "yes" }), "nosniff").pass, false);
t("frame-ancestors substitutes XFO",
  by(run({ "content-security-policy": "frame-ancestors 'none'" }), "frame").pass, true);
t("a CSP without it does not",
  by(run({ "content-security-policy": "default-src 'self'" }), "frame").pass, false);

console.log("\n...and explains itself without naming the header");
for (const lang of ["en", "es"]) {
  const cs = run({}, "http://x.com/", lang);
  t(`${lang}: no title names a header`,
    cs.every(c => !/Content-Security-Policy|X-Frame-Options|Strict-Transport|X-Content-Type/i.test(c.title)), true);
  // One line per test, Observatory-style: long enough to name the consequence,
  // short enough that seven of them read as a table rather than an essay.
  // The rule is about the gaps table, where the reasons have to read as rows.
  // A passing check says "Set." on purpose and is not held to it.
  const gaps = cs.filter(c => !c.pass);
  t(`${lang}: every reason fits one line`,
    gaps.every(c => c.detail.length <= 84), true);
  t(`${lang}: every reason still names a consequence`,
    gaps.every(c => c.detail.length >= 60 && /—/.test(c.detail)), true);
  t(`${lang}: worst gap is the CSP`,
    cs.slice().sort((a, b) => b.deduction - a.deduction)[0].id, "csp");
}
t("es differs from en", M.HDR.es.csp.t === M.HDR.en.csp.t, false);

console.log("\nthe page checks, on the same instrument");
// A parsed document is passed in; without one the instrument judges headers only.
const doc = (o = {}) => ({
  title: "DATRUM — Marketing product design studio",
  description: "x".repeat(120),
  canonical: "https://x.com/",
  lang: "en", robotsMeta: "", insecureRefs: 0,
  headings: o.headings ?? [{ level: 1, text: "One" }, { level: 2, text: "Two" }],
  ...o,
  h1: (o.headings ?? [{ level: 1, text: "One" }, { level: 2, text: "Two" }]).filter(h => h.level === 1),
});
const runD = (hs, d, lang = "en", url = "https://x.com/") => M.runHeaderChecks(res(hs), tgt(url), lang, d);

t("a document adds seven checks",     runD(ALL, doc()).length, 15);
t("page pool totals 20",
  runD({}, doc({ title: "Home", description: "", canonical: "/x", lang: "",
                 headings: [{ level: 2, text: "a" }, { level: 4, text: "b" }] }))
    .filter(c => c.group === "page").reduce((n, c) => n + c.deduction, 0), 20);
// Everything wrong at once, over http and with noindex, must account for
// exactly 100 — the proof that the pool has not drifted.
const allWrong = doc({ title: "Home", description: "", canonical: "/x", lang: "",
                       insecureRefs: 3, robotsMeta: "noindex",
                       headings: [{ level: 2, text: "a" }, { level: 4, text: "b" }] });
t("the whole pool is still 100",
  runD({}, allWrong, "en", "http://x.com/").reduce((n, c) => n + c.deduction, 0), 100);
t("...and that is a zero", score(runD({}, allWrong, "en", "http://x.com/")), 0);
t("a clean page and clean headers still score 100", score(runD(ALL, doc())), 100);
t("perfect headers, broken page is not an A+",
  M.grade(score(runD(ALL, doc({ title: "Home", description: "", canonical: "/x",
    headings: [{ level: 2, text: "a" }, { level: 4, text: "b" }] })))) === "A+", false);

const PD = (d, id) => by(runD(ALL, d), id).pass;
t("a short title fails",              PD(doc({ title: "Home" }), "title"), false);
t("a naming title passes",            PD(doc(), "title"), true);
t("no H1 fails",                      PD(doc({ headings: [{ level: 2, text: "a" }] }), "h1"), false);
t("two H1s fail",                     PD(doc({ headings: [{ level: 1, text: "a" }, { level: 1, text: "b" }] }), "h1"), false);
t("exactly one H1 passes",            PD(doc(), "h1"), true);
t("a skipped level fails",            PD(doc({ headings: [{ level: 2, text: "a" }, { level: 4, text: "b" }] }), "heading-order"), false);
t("a sequential outline passes",      PD(doc(), "heading-order"), true);
t("a relative canonical fails",       PD(doc({ canonical: "/x" }), "canonical"), false);
t("an absolute canonical passes",     PD(doc(), "canonical"), true);
t("no description fails",             PD(doc({ description: "" }), "description"), false);
t("a thin description fails",         PD(doc({ description: "Short." }), "description"), false);
t("a usable description passes",      PD(doc(), "description"), true);

// The whole reason these predicates are shared: two instruments must never
// return different verdicts about the same H1 on the same page.
console.log("\nthe two instruments agree about the same document");
for (const d of [doc(), doc({ title: "Home" }), doc({ headings: [{ level: 1, text: "a" }, { level: 1, text: "b" }] }),
                 doc({ canonical: "/x" }), doc({ headings: [{ level: 2, text: "a" }, { level: 4, text: "b" }] })]) {
  const hdr = runD(ALL, d);
  t("h1 verdict matches the AI scanner",       by(hdr, "h1").pass, M.hasOneH1(d));
  t("title verdict matches the AI scanner",    by(hdr, "title").pass, M.titleNames(d));
  t("canonical verdict matches the AI scanner", by(hdr, "canonical").pass, M.canonicalAbs(d));
  t("outline verdict matches the AI scanner",  by(hdr, "heading-order").pass, !M.headingSkip(d));
}

console.log("\nindexability, mixed content, lang, compression");
// noindex arrives in the header or the markup; either alone removes the page.
t("clean page is indexable",       PD(doc(), "noindex"), true);
t("meta noindex fails",            by(runD(ALL, doc({ robotsMeta: "noindex" })), "noindex").pass, false);
t("meta none fails",               by(runD(ALL, doc({ robotsMeta: "none" })), "noindex").pass, false);
t("X-Robots-Tag noindex fails",
  by(M.runHeaderChecks(res({ ...ALL, "x-robots-tag": "noindex" }), tgt("https://x.com/"), "en", doc()), "noindex").pass, false);
t("noindex is case-insensitive",   by(runD(ALL, doc({ robotsMeta: "NoIndex" })), "noindex").pass, false);
t("nofollow alone is not noindex", by(runD(ALL, doc({ robotsMeta: "nofollow" })), "noindex").pass, true);
t("'noindexing' does not trip it", by(runD(ALL, doc({ robotsMeta: "noindexing" })), "noindex").pass, true);

// Mixed content: subresources only. A plain link to http is not mixed content.
t("no insecure refs passes",       PD(doc(), "mixed"), true);
t("one insecure subresource fails", PD(doc({ insecureRefs: 1 }), "mixed"), false);
t("the reason counts them",
  /\b3 files\b/.test(by(runD(ALL, doc({ insecureRefs: 3 })), "mixed").detail), true);
t("one file is singular",
  /\b1 file\b/.test(by(runD(ALL, doc({ insecureRefs: 1 })), "mixed").detail), true);

t("a declared lang passes",        PD(doc(), "lang"), true);
t("no lang fails",                 PD(doc({ lang: "" }), "lang"), false);
t("whitespace is not a lang",      PD(doc({ lang: "   " }), "lang"), false);

console.log("\na canonical may point away, but not off-site");
t("self canonical passes",         PD(doc(), "canonical"), true);
t("another path on the same site is fine",
  by(runD(ALL, doc({ canonical: "https://x.com/other" })), "canonical").pass, true);
t("www is not another site",
  by(runD(ALL, doc({ canonical: "https://www.x.com/" })), "canonical").pass, true);
t("...and the reverse holds",
  by(runD(ALL, doc({ canonical: "https://x.com/" }), "en", "https://www.x.com/"), "canonical").pass, true);
t("another domain fails",
  by(runD(ALL, doc({ canonical: "https://someone-else.com/" })), "canonical").pass, false);
t("...and says so, not 'missing'",
  /another domain/i.test(by(runD(ALL, doc({ canonical: "https://someone-else.com/" })), "canonical").detail), true);
t("a relative canonical is still the missing case",
  /Missing or relative/i.test(by(runD(ALL, doc({ canonical: "/x" })), "canonical").detail), true);
t("garbage canonical does not throw",
  by(runD(ALL, doc({ canonical: "http://[bad" })), "canonical").pass, false);

console.log("\nentities are decoded before a prospect reads them");
t("named entity",      M.decodeEntities("Email &amp; SMS"), "Email & SMS");
t("angle brackets",    M.decodeEntities("&lt;b&gt;"), "<b>");
t("numeric decimal",   M.decodeEntities("caf&#233;"), "caf\u00e9");
t("numeric hex",       M.decodeEntities("caf&#xe9;"), "caf\u00e9");
t("unknown is left alone", M.decodeEntities("a &bogus; b"), "a &bogus; b");
t("a bare ampersand survives", M.decodeEntities("Tom & Jerry"), "Tom & Jerry");
t("nothing to decode is unchanged", M.decodeEntities("plain title"), "plain title");

console.log("\nthe heading census is a fact, not a check");
const cen = M.headingCensus(doc({ headings: [
  { level: 1, text: "a" }, { level: 2, text: "b" }, { level: 2, text: "c" }, { level: 3, text: "d" }] }));
t("counts each level", cen.h1 === 1 && cen.h2 === 2 && cen.h3 === 1, true);
t("absent levels are zero, not missing", cen.h4 === 0 && cen.h5 === 0 && cen.h6 === 0, true);
t("the census scores nothing",
  runD(ALL, doc()).some(c => c.id === "heading-census"), false);

console.log("\npresent-but-useless is a failure, not a pass");
const hh = h => run(h);
const P  = (h, id) => by(run(h), id).pass;

// HSTS under six months is forgotten between visits.
t("hsts two years passes",   P({ "strict-transport-security": "max-age=63072000" }, "hsts"), true);
t("hsts five minutes fails", P({ "strict-transport-security": "max-age=300" }, "hsts"), false);
t("hsts with no max-age fails", P({ "strict-transport-security": "includeSubDomains" }, "hsts"), false);
t("...and says why it is weak",
  by(run({ "strict-transport-security": "max-age=300" }), "hsts").detail, M.HDR.en.weak.hsts);

// A CSP that still permits arbitrary inline script does not stop an injected one.
t("csp with a real script-src passes",
  P({ "content-security-policy": "default-src 'self'; script-src 'self'" }, "csp"), true);
t("csp with unsafe-inline fails",
  P({ "content-security-policy": "script-src 'self' 'unsafe-inline'" }, "csp"), false);
t("csp with unsafe-eval fails",
  P({ "content-security-policy": "script-src 'self' 'unsafe-eval'" }, "csp"), false);
t("wildcard script-src fails",
  P({ "content-security-policy": "script-src *" }, "csp"), false);
t("a CSP with no script rule at all fails",
  P({ "content-security-policy": "img-src 'self'" }, "csp"), false);
t("default-src stands in for script-src",
  P({ "content-security-policy": "default-src 'self'" }, "csp"), true);
// The one case that must NOT be flagged: unsafe-inline as a fallback beside a
// nonce is correct practice, and calling it a gap would be inventing a finding.
t("unsafe-inline beside a nonce passes",
  P({ "content-security-policy": "script-src 'nonce-r4nd0m' 'unsafe-inline'" }, "csp"), true);
t("unsafe-inline beside strict-dynamic passes",
  P({ "content-security-policy": "script-src 'strict-dynamic' 'unsafe-inline' 'nonce-x'" }, "csp"), true);

// X-Frame-Options values browsers no longer honour.
t("XFO DENY passes",        P({ "x-frame-options": "DENY" }, "frame"), true);
t("XFO SAMEORIGIN passes",  P({ "x-frame-options": "SAMEORIGIN" }, "frame"), true);
t("XFO ALLOW-FROM fails",   P({ "x-frame-options": "ALLOW-FROM https://x.com" }, "frame"), false);
t("frame-ancestors * fails",
  P({ "content-security-policy": "frame-ancestors *" }, "frame"), false);
t("frame-ancestors 'self' passes",
  P({ "content-security-policy": "frame-ancestors 'self'" }, "frame"), true);

// A referrer policy either keeps the path at home or it does not.
t("strict-origin-when-cross-origin passes",
  P({ "referrer-policy": "strict-origin-when-cross-origin" }, "referrer"), true);
t("unsafe-url fails",       P({ "referrer-policy": "unsafe-url" }, "referrer"), false);
t("no-referrer-when-downgrade fails",
  P({ "referrer-policy": "no-referrer-when-downgrade" }, "referrer"), false);
t("a list is judged on its last token",
  P({ "referrer-policy": "no-referrer, strict-origin" }, "referrer"), true);

t("an empty Permissions-Policy fails", P({ "permissions-policy": "" }, "permissions"), false);
t("one that restricts something passes",
  P({ "permissions-policy": "camera=(), microphone=()" }, "permissions"), true);

console.log("\n...and every weak reason reads like the others");
for (const lang of ["en", "es"]) {
  const w = Object.values(M.HDR[lang].weak);
  t(`${lang}: weak reasons fit one line`, w.every(x => x.length <= 84), true);
  t(`${lang}: weak reasons name a consequence`,
    w.every(x => x.length >= 60 && /—/.test(x)), true);
  t(`${lang}: weak never names a header`,
    w.every(x => !/Content-Security-Policy|X-Frame-Options|Strict-Transport|X-Content-Type|Permissions-Policy|Referrer-Policy/i.test(x)), true);
}
t("weak es differs from en", M.HDR.es.weak.csp === M.HDR.en.weak.csp, false);

console.log("\nthe AI scanner stops crediting mere presence");
const doc0 = { jsonld: [], headings: [], h1: [], title: "", description: "",
               canonical: "", hreflang: [], imgTotal: 0, imgNoAlt: 0, textLen: 0 };
const rc = (over = {}) => M.runChecks({
  doc: { ...doc0, ...(over.doc || {}) },
  robots: { ok: false, groups: [], ...(over.robots || {}) },
  sitemap: { ok: false, ...(over.sitemap || {}) },
  llms: { ok: false }, headers: over.headers || {}, path: "/", lang: "en" });
const K = (over, id) => rc(over).find(c => c.id === id);

// A title element that names nothing is not a title check passed.
t("a real title passes",
  K({ doc: { title: "DATRUM — Marketing product design studio" } }, "title").pass, true);
t("\"Home\" fails",           K({ doc: { title: "Home" } }, "title").pass, false);
t("...and is quoted back",   /"Home"/.test(K({ doc: { title: "Home" } }, "title").detail), true);
t("empty still fails",       K({}, "title").pass, false);

// A canonical is a claim about identity; a relative one does not resolve.
t("absolute canonical passes",
  K({ doc: { canonical: "https://x.com/a" } }, "canonical").pass, true);
t("relative canonical fails", K({ doc: { canonical: "/a" } }, "canonical").pass, false);
t("junk canonical fails",     K({ doc: { canonical: "x.com/a" } }, "canonical").pass, false);

// Both instruments must agree about the same header.
t("two-year HSTS passes",
  K({ headers: { hsts: "max-age=63072000" } }, "hsts").pass, true);
t("five-minute HSTS fails",
  K({ headers: { hsts: "max-age=300" } }, "hsts").pass, false);
t("...and the two instruments agree",
  K({ headers: { hsts: "max-age=300" } }, "hsts").pass,
  by(run({ "strict-transport-security": "max-age=300" }), "hsts").pass);

// A 200 that returns an HTML 404 page is the common case, not the exception.
t("a real robots.txt passes",   K({ robots: { ok: true } }, "robots-exists").pass, true);
t("a served non-robots fails",
  K({ robots: { ok: false, served: true } }, "robots-exists").pass, false);
t("...and says the URL answered",
  /not robots\.txt/.test(K({ robots: { ok: false, served: true } }, "robots-exists").detail), true);
t("an empty sitemap fails",
  K({ sitemap: { ok: false, served: true } }, "sitemap").pass, false);
t("...and says it holds no URLs",
  /no URLs/.test(K({ sitemap: { ok: false, served: true } }, "sitemap").detail), true);
t("one declared in robots.txt passes",
  K({ sitemap: { ok: true, declared: true } }, "sitemap").pass, true);
t("...and says where it came from",
  K({ sitemap: { ok: true, declared: true } }, "sitemap").detail, "Declared in robots.txt.");

console.log("\nemail validation");
const ve = M.validEmail;
t("plain address",              ve("julio@datrum.com"), "julio@datrum.com");
t("domain is lowercased",       ve("Julio@DATRUM.COM"), "Julio@datrum.com");
t("surrounding space trimmed",  ve("  a@b.co  "), "a@b.co");
t("plus tag survives",          ve("a+scan@b.co"), "a+scan@b.co");
t("subdomain survives",         ve("a@mail.b.co"), "a@mail.b.co");
t("no @",                       ve("datrum.com"), null);
t("two @",                      ve("a@b@c.com"), null);
t("no domain dot",              ve("a@localhost"), null);
t("numeric tld",                ve("a@b.12"), null);
t("empty local",                ve("@b.co"), null);
t("leading dot in local",       ve(".a@b.co"), null);
t("double dot in local",        ve("a..b@c.co"), null);
t("hyphen-led label",           ve("a@-b.co"), null);
t("space inside",               ve("a b@c.co"), null);
t("header injection",           ve("a@b.co\nBcc: x@y.co"), null);
t("angle brackets",             ve("<a@b.co>"), null);
t("over 254 chars",             ve("a".repeat(250) + "@b.co"), null);
t("local over 64",              ve("a".repeat(65) + "@b.co"), null);
t("empty",                      ve(""), null);
t("undefined",                  ve(undefined), null);

console.log("\nthe lead endpoint");
// Minimal KV doubles. put/get is all handleLead uses.
const kv = () => { const m = new Map(); return {
  m, get: async k => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); } }; };

let LEADS = kv(), RATE = kv();
let r = await M.handleLead({ email: "a@b.co", mode: "headers" }, { LEADS, RATE }, "1.1.1.1", "en");
t("valid address stored",       [r.status, r.payload.ok], [200, true]);
t("keyed by address",           [...LEADS.m.keys()], ["lead:a@b.co"]);
const rec = JSON.parse(LEADS.m.get("lead:a@b.co"));
t("record holds no scan data",  Object.keys(rec).sort(), ["count","email","first","lang","last","mode"]);
t("instrument recorded",        rec.mode, "headers");
t("counted once",               rec.count, 1);

r = await M.handleLead({ email: "A@B.co", mode: "" }, { LEADS, RATE }, "1.1.1.1", "en");
const rec2 = JSON.parse(LEADS.m.get("lead:a@b.co"));
t("mode falls back to scan",    rec2.mode, "scan");
// Julio@ and julio@ are one person to every mail provider there is.
t("case does not fork the key", LEADS.m.size, 1);
t("...and the count carries",   rec2.count, 2);
t("...keeping what they typed", rec2.email, "A@b.co");

LEADS = kv(); RATE = kv();
await M.handleLead({ email: "a@b.co" }, { LEADS, RATE }, "1.1.1.1", "en");
await M.handleLead({ email: "a@b.co" }, { LEADS, RATE }, "1.1.1.1", "en");
t("second ask updates, not duplicates", LEADS.m.size, 1);
t("...and increments the count", JSON.parse(LEADS.m.get("lead:a@b.co")).count, 2);

LEADS = kv(); RATE = kv();
r = await M.handleLead({ email: "a@b.co", company: "Acme" }, { LEADS, RATE }, "1.1.1.1", "en");
t("honeypot answers 200",       [r.status, r.payload.ok], [200, true]);
t("...and stores nothing",      LEADS.m.size, 0);

LEADS = kv(); RATE = kv();
r = await M.handleLead({ email: "nope" }, { LEADS, RATE }, "1.1.1.1", "en");
t("bad address is 400",         r.status, 400);
t("...in the page's language",  (await M.handleLead({ email: "nope" }, { LEADS, RATE }, "1.1.1.1", "es")).payload.error, M.ERR.es.email);
t("...and stores nothing",      LEADS.m.size, 0);

r = await M.handleLead({ email: "a@b.co" }, { RATE }, "1.1.1.1", "en");
t("no binding is 503, not a silent drop", r.status, 503);

LEADS = kv(); RATE = kv();
const capped = { LEADS, RATE, LEAD_LIMIT: "3" };
for (let i = 0; i < 3; i++) await M.handleLead({ email: `a${i}@b.co` }, capped, "9.9.9.9", "en");
r = await M.handleLead({ email: "a3@b.co" }, capped, "9.9.9.9", "en");
t("one over the ceiling is 429", r.status, 429);
t("...and is not stored",        LEADS.m.size, 3);
r = await M.handleLead({ email: "a3@b.co" }, capped, "8.8.8.8", "en");
t("another IP is unaffected",    r.status, 200);

// With no var set the ceiling is the fallback, not the sky. This is the whole
// point of the fallback being a number: a config that never landed must still
// stop somebody pointing the endpoint at a stranger's site all afternoon.
LEADS = kv(); RATE = kv();
for (let i = 0; i < 60; i++) await M.handleLead({ email: `b${i}@c.co` }, { LEADS, RATE }, "7.7.7.7", "en");
t("60 pass with no var set",     LEADS.m.size, 60);
t("the 61st is 429",
  (await M.handleLead({ email: "b60@c.co" }, { LEADS, RATE }, "7.7.7.7", "en")).status, 429);

console.log("\nthe rate ceilings");
t("unset falls back to 60",      M.ceiling({}, "SCAN_LIMIT"), 60);
t("no env at all falls back",    M.ceiling(undefined, "SCAN_LIMIT"), 60);
t("a set var is honoured",       M.ceiling({ SCAN_LIMIT: "120" }, "SCAN_LIMIT"), 120);
t("garbled is not unlimited",    M.ceiling({ SCAN_LIMIT: "sixty" }, "SCAN_LIMIT"), 60);
t("empty is not unlimited",      M.ceiling({ SCAN_LIMIT: "" }, "SCAN_LIMIT"), 60);
t("zero is a typo, not a door",  M.ceiling({ SCAN_LIMIT: "0" }, "SCAN_LIMIT"), 60);
t("negative falls back",         M.ceiling({ SCAN_LIMIT: "-5" }, "SCAN_LIMIT"), 60);
t("each endpoint reads its own",
  ["SCAN_LIMIT", "LEAD_LIMIT"].map(k => M.ceiling({ SCAN_LIMIT: "30", LEAD_LIMIT: "5" }, k)), [30, 5]);
t("the 429 names the number",    /\b60 per hour\b/.test(M.ERR.en.rate(60)), true);
t("...in Spanish too",           /\b60 por hora\b/.test(M.ERR.es.rate(60)), true);
t("...and follows the var",      /\b120 per hour\b/.test(M.ERR.en.rate(120)), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
