/* Run: node worker/mail-scan.test.mjs
   A fake DoH server stands in for the network. */
import { scanMail, cleanDomain, dohResolver } from "./mail-scan.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ok   " + m); } else { fail++; console.log("  FAIL " + m); } };
const T = { TXT: 16, MX: 15, A: 1 };

/* zone: { "name|TYPE": [data…] }; missing = NXDOMAIN; "!": SERVFAIL */
const fake = (zone, log = []) => async url => {
  const u = new URL(url), name = u.searchParams.get("name"), type = u.searchParams.get("type");
  log.push(name + "|" + type);
  const v = zone[name + "|" + type];
  if (v === "!") return { ok: true, json: async () => ({ Status: 2 }) };
  if (v === undefined) return { ok: true, json: async () => ({ Status: zone[name + "|*"] ? 0 : 3 }) };
  return { ok: true, json: async () => ({ Status: 0, Answer: v.map(data => ({ type: T[type], data })) }) };
};
const q = d => `"${d}"`;

/* domain cleaning */
ok(cleanDomain("https://www.Example.com/path?x=1") === "example.com", "URL reduced to domain");
ok(cleanDomain("ana@empresa.com.pa") === "empresa.com.pa", "address reduced to domain");
ok(cleanDomain("example.com:8080") === "example.com", "port dropped");
ok(cleanDomain("127.0.0.1") === null && cleanDomain("10.0.0.5") === null, "IP literals refused");
ok(cleanDomain("localhost") === null && cleanDomain("x.internal") === null && cleanDomain("a.local") === null, "internal names refused");
ok(cleanDomain("") === null && cleanDomain("nodot") === null && cleanDomain("a b.com") === null, "garbage refused");

/* resolver parsing */
const r = dohResolver({}, fake({ "a.com|TXT": ['"v=spf1 include:x.com " "-all"'], "a.com|MX": ["10 mx.a.com."] }));
ok((await r.txt("a.com"))[0] === "v=spf1 include:x.com -all", "split TXT strings are joined");
ok((await r.mx("a.com"))[0].exchange === "mx.a.com", "MX parsed, trailing dot dropped");
let code; try { await r.txt("missing.com"); } catch (e) { code = e.code; }
ok(code === "NXDOMAIN", "status 3 is NXDOMAIN");
ok(new URL(String((await (async () => { const seen = []; await dohResolver({ DOH_URL: "https://doh.example/q" }, async u => (seen.push(u), { ok: true, json: async () => ({ Status: 0, Answer: [] }) })).txt("a.com").catch(() => {}); return seen; })())[0])).host === "doh.example", "resolver URL is config");

/* verdicts end to end */
const base = { "a.com|MX": ["10 mx.a.com."], "a.com|TXT": [q("v=spf1 -all")] };
const weak = await scanMail("a.com", "en", {}, fake({ ...base, "_dmarc.a.com|TXT": [q("v=DMARC1; p=none")] }));
ok(weak.spoofable === true && weak.reason === "none", "p=none is spoofable");
ok(/YES/.test(weak.verdict), "English verdict");
const strong = await scanMail("a.com", "es", {}, fake({ ...base, "_dmarc.a.com|TXT": [q("v=DMARC1; p=reject")] }));
ok(strong.spoofable === false && /NO\./.test(strong.verdict), "reject is not spoofable, Spanish verdict");
const none = await scanMail("a.com", "en", {}, fake(base));
ok(none.spoofable === true && none.reason === "missing", "no DMARC record is spoofable");
const down = await scanMail("a.com", "en", {}, fake({ ...base, "_dmarc.a.com|TXT": "!" }));
ok(down.spoofable === null && down.lookalikes.checked === 0, "resolver failure is neither yes nor no, and checks nothing further");
const two = await scanMail("a.com", "en", {}, fake({ ...base, "_dmarc.a.com|TXT": [q("v=DMARC1; p=none"), q("v=DMARC1; p=reject")] }));
ok(two.spoofable === true && two.reason === "multiple", "two policies read as none");
const nospf = await scanMail("a.com", "en", {}, fake({ "a.com|MX": ["10 mx.a.com."], "_dmarc.a.com|TXT": [q("v=DMARC1; p=reject")] }));
ok(nospf.spoofable === false && /no list/.test(nospf.ownMail), "reject with no SPF: not spoofable, own-mail note");
ok(weak.evidence.some(e => e.name === "_dmarc.a.com" && e.answer[0] === "v=DMARC1; p=none"), "raw record is returned as evidence");
ok(weak.note === null && (await scanMail("a.com", "en", {}, fake({ "_dmarc.a.com|TXT": [q("v=DMARC1; p=none")] }))).note !== null, "no-mail note only when there is no MX");

/* lookalikes and budget */
const log = [];
const looked = await scanMail("seguroscorco.com", "en", {}, fake({ "seguroscorco.com|TXT": [q("v=spf1 -all")], "seguroscorco.com|MX": ["10 m."], "_dmarc.seguroscorco.com|TXT": [q("v=DMARC1; p=none")],
  "seguroscorco.net|A": ["1.2.3.4"] }, log));
ok(looked.lookalikes.registered.includes("seguroscorco.net") || looked.lookalikes.checked === 15, "lookalikes resolved with a limit of 15");
ok(looked.lookalikes.checked === 15, "checked count reported");
ok(log.length <= 40, "stays well under the subrequest limit: " + log.length);
ok(log.filter(x => x.endsWith("|A")).length === 15, "lookalikes resolved by A record only, never visited");
ok(!log.some(x => /^https?:/.test(x)), "nothing fetched from the domain");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
