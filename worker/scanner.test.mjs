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
src += "\nexport { parseRobots, blocksAgent, grade, validateTarget, isPrivateHost, AI_CRAWLERS, runChecks, STR, ERR, runHeaderChecks, HDR, validEmail, handleLead };";
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
for (const [s, e] of [[100,"A+"],[95,"A"],[86,"A-"],[80,"B+"],[70,"B"],[66,"B-"],
                      [60,"C+"],[50,"C"],[45,"C-"],[40,"D+"],[30,"D"],[25,"D-"],[10,"F"],[0,"F"]])
  t(`${s} -> ${e}`, M.grade(s), e);

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
t("nothing set over http scores 0",   score(run({}, "http://x.com/")), 0);
t("nothing set over http grades F",   M.grade(score(run({}, "http://x.com/"))), "F");
t("https alone is not enough",        score(run({})) < 50, true);
t("7 checks, no more",                run(ALL).length, 7);

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
  t(`${lang}: every reason fits one line`,
    cs.every(c => c.detail.length <= 84), true);
  t(`${lang}: every reason still names a consequence`,
    cs.every(c => c.detail.length >= 60 && /—/.test(c.detail)), true);
  t(`${lang}: worst gap is the CSP`,
    cs.slice().sort((a, b) => b.deduction - a.deduction)[0].id, "csp");
}
t("es differs from en", M.HDR.es.csp.t === M.HDR.en.csp.t, false);

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
for (let i = 0; i < 10; i++) await M.handleLead({ email: `a${i}@b.co` }, { LEADS, RATE }, "9.9.9.9", "en");
r = await M.handleLead({ email: "a10@b.co" }, { LEADS, RATE }, "9.9.9.9", "en");
t("eleventh from one IP is 429", r.status, 429);
t("...and is not stored",        LEADS.m.size, 10);
r = await M.handleLead({ email: "a10@b.co" }, { LEADS, RATE }, "8.8.8.8", "en");
t("another IP is unaffected",    r.status, 200);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
