/* Run: node worker/impersonation/core.test.mjs
   Fixtures are DNS answers written out by hand, no network. The rule is
   DIRECTION: enforcing must never read as spoofable, and a failure to measure
   must never read as either. */
import * as C from "./core.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ok   " + m); } else { fail++; console.log("  FAIL " + m); } };
const err = code => Object.assign(new Error(code), { code });
const zone = z => async n => { if (!(n in z)) throw err("NXDOMAIN"); if (z[n] instanceof Error) throw z[n]; return z[n]; };

/* DMARC */
const D = t => C.parseDmarc(t ? [t] : []);
ok(D().policy === "missing", "no record is missing");
ok(D("v=DMARC1; p=none; rua=mailto:a@b.c").policy === "none", "p=none read");
ok(D("v=DMARC1; p=reject; pct=50").pct === 50, "pct read");
ok(D("v=DMARC1; p=reject").pct === 100, "pct defaults to 100");
ok(D("v=DMARC1; p=banana").policy === "invalid", "unknown policy is invalid");
ok(C.parseDmarc(["v=DMARC1; p=none", "v=DMARC1; p=reject"]).multiple === true, "two records flagged (jldatrum's own case)");
ok(C.parseDmarc(["google-site-verification=x"]).present === false, "unrelated TXT ignored");

/* SPF */
ok(C.parseSpf(["v=spf1 include:_spf.google.com ~all"]).all === "~all", "~all read");
ok(C.parseSpf(["v=spf1 -all"]).all === "-all", "-all read");
ok(C.parseSpf(["v=spf1 all"]).all === "+all", "bare all is +all");
ok(C.parseSpf(["v=spf1 mx"]).all === "none", "no all term");
ok(C.parseSpf(["v=spf1 -all", "v=spf1 +all"]).multiple === true, "two SPF records flagged");
ok(C.parseSpf([]).present === false, "no SPF");

/* SPF lookups */
const z1 = { "a.com": ["v=spf1 include:b.com include:c.com mx -all"], "b.com": ["v=spf1 a ip4:1.2.3.4 -all"], "c.com": ["v=spf1 include:a.com -all"] };
const r1 = await C.spfLookupCount("a.com", zone(z1));
ok(r1.count === 5, "counts include, include, mx, a, include (loop cut) = " + r1.count);
const many = { "x.com": ["v=spf1 " + Array.from({ length: 12 }, (_, i) => `include:i${i}.com`).join(" ") + " -all"] };
ok((await C.spfLookupCount("x.com", zone(many))).count === 12, "over-10 counted");
const r3 = await C.spfLookupCount("a.com", zone({ "a.com": ["v=spf1 include:dead.com -all"], "dead.com": err("SERVFAIL") }));
ok(r3.error === "SERVFAIL", "a resolver failure inside SPF is reported, not swallowed");
ok((await C.spfLookupCount("x.com", zone(many), 3)).capped === true, "query cap holds");

/* Other records */
ok(C.parseMtaSts(["v=STSv1; id=1"]) && !C.parseMtaSts(["x"]), "mta-sts record");
ok(C.parseMtaStsMode("version: STSv1\nmode: enforce\n") === "enforce", "mta-sts mode");
ok(C.parseMtaStsMode("") === "missing", "mta-sts mode missing");
ok(C.isNullMx([{ priority: 0, exchange: "" }]) && !C.isNullMx([{ priority: 10, exchange: "mx.a.com" }]), "null MX");

/* Verdict: direction */
const V = (dm, spf = "v=spf1 -all", extra = {}) =>
  C.verdict({ dmarc: C.parseDmarc(dm ? [dm] : []), spf: C.parseSpf(spf ? [spf] : []), nullMx: false, ...extra });
ok(V("v=DMARC1; p=reject").spoofable === false, "reject is not spoofable");
ok(V("v=DMARC1; p=quarantine").spoofable === false, "quarantine is not spoofable");
ok(V("v=DMARC1; p=none").spoofable === true, "none is spoofable");
ok(V(null).spoofable === true, "missing is spoofable");
ok(V("v=DMARC1; p=reject; pct=25").reason === "partial" && V("v=DMARC1; p=reject; pct=25").spoofable === true, "pct<100 is partial, spoofable");
ok(C.verdict({ dmarc: C.parseDmarc(["v=DMARC1; p=none", "v=DMARC1; p=reject"]), spf: C.parseSpf([]) }).reason === "multiple", "duplicate records read as no policy");
ok(V("v=DMARC1; p=reject", null).spoofable === false, "p=reject with no SPF is NOT spoofable");
ok(V("v=DMARC1; p=reject", null).ownMailRisk === "no-spf", "...and is reported as a risk to the firm's own mail");
ok(V("v=DMARC1; p=reject", "v=spf1 +all").ownMailRisk === "plus-all", "+all flagged");
ok(V("v=DMARC1; p=reject", "v=spf1 -all", { spfLookups: { count: 11 } }).ownMailRisk === "over-10", "over-10 flagged");
ok(V(null, null, { nullMx: true }).ownMailRisk === null, "null MX with no SPF is not an own-mail risk");
ok(C.verdict({ dmarc: C.parseDmarc([]), spf: C.parseSpf([]), measured: { dmarc: false } }).spoofable === null, "unmeasured is neither yes nor no");
const ord = ["missing", "none", "quarantine", "reject"].map(p => V(p === "missing" ? null : "v=DMARC1; p=" + p).spoofable);
ok(ord[0] && ord[1] && !ord[2] && !ord[3], "ordering: missing, none spoofable; quarantine, reject not");

/* Strings */
const vt = C.verdictText("ejemplo.com", V(null), "es");
ok(/ejemplo\.com/.test(vt) && /SÍ/.test(vt), "Spanish verdict names the domain and says SÍ");
ok(/YES/.test(C.verdictText("a.com", V(null), "en")), "English verdict says YES");
ok(!/DMARC|SPF|header/i.test(C.verdictText("a.com", V("v=DMARC1; p=none"), "en")), "verdict prose names no record type");
ok(/could not read/.test(C.verdictText("a.com", { spoofable: null }, "en")), "unmeasured says so");
ok(Object.keys({ missing: 1, none: 1, multiple: 1, invalid: 1, partial: 1, quarantine: 1, reject: 1 }).every(k => C.verdictText("a.com", { spoofable: k !== "reject" && k !== "quarantine", reason: k }, "es").length > 20), "every reason has Spanish text");

/* Lookalikes */
const L = C.lookalikes("seguroscorco.com");
ok(L.length === 30, "30 variants for a long name, got " + L.length);
ok(!L.includes("seguroscorco.com"), "never includes the input");
ok(new Set(L).size === L.length, "no duplicates");
ok(L.every(x => /^[a-z0-9.-]+$/.test(x) && !x.startsWith("-")), "all valid hostnames");
ok(L.some(x => x.endsWith(".com.pa")) , "TLD swap family survives the limit");
ok(C.lookalikes("pty.com.pa").every(x => !x.startsWith(".")), "two-label TLD handled");
ok(C.lookalikes("nodot").length === 0, "garbage in, nothing out");
ok(JSON.stringify(C.lookalikes("abc.com")) === JSON.stringify(C.lookalikes("abc.com")), "deterministic");
ok(C.METHOD_VERSION === "1.0", "method version set");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
