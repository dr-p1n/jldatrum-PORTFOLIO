#!/usr/bin/env node
/* Domains in, evidence and a hit-list CSV out. DNS only, passive.
 *
 *   node tools/impersonation.mjs jldatrum.com
 *   node tools/impersonation.mjs --file firms.csv --out index-out
 *   node tools/impersonation.mjs --file firms.csv --no-lookalikes
 *
 * firms.csv: a header row with at least `domain`; `name`, `hub`, `country`,
 * `is_prospect`, `is_mid_market` are carried through. A plain list of domains,
 * one per line, also works.
 *
 * Writes <out>/<date>/<domain>.json (raw answers, the evidence) and
 * <out>/<date>/summary.csv (one row per firm; the columns paste into the CRM
 * importer). ⚠️ index-out/ IS GITIGNORED: it holds third-party findings.
 *
 * Lookalike domains are RESOLVED, never visited. A registered lookalike is not
 * a malicious one. Resolvers: DATRUM_RESOLVERS="1.1.1.1,8.8.8.8".
 */
import dns from "node:dns/promises";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import * as C from "../worker/impersonation/core.mjs";

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i < 0 ? d : argv[i + 1]; };
const has = n => argv.includes(n);
const OUT = flag("--out", "index-out");
const DELAY = Number(flag("--delay", 250));
const LOOK = !has("--no-lookalikes");
const FILE = flag("--file", null);
const LANG = flag("--lang", "en");

dns.setServers((process.env.DATRUM_RESOLVERS || "1.1.1.1,8.8.8.8").split(",").map(s => s.trim()));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const HOST = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

/* ── firms in ────────────────────────────────────────────────────────── */
function csvLine(l) {
  const out = []; let cur = "", q = false;
  for (const ch of l) {
    if (ch === '"') q = !q; else if (ch === "," && !q) { out.push(cur); cur = ""; } else cur += ch;
  }
  return out.push(cur), out.map(s => s.trim());
}
function readFirms() {
  const tidy = d => d.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  if (!FILE) return argv.filter(a => !a.startsWith("--") && ![OUT, String(DELAY), LANG].includes(a)).map(d => ({ domain: tidy(d) }));
  const lines = readFileSync(FILE, "utf8").split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith("#"));
  if (!lines.length) return [];
  const head = csvLine(lines[0]).map(s => s.toLowerCase());
  if (!head.includes("domain")) return lines.map(d => ({ domain: tidy(d) }));
  return lines.slice(1).map(l => {
    const c = csvLine(l), row = {};
    head.forEach((h, i) => row[h] = c[i] || "");
    row.domain = tidy(row.domain || "");
    return row;
  });
}

/* ── resolver adapters: Node errors -> the core's clean-absence codes ─── */
const CLEAN = new Set(["ENOTFOUND", "ENODATA"]);
async function q(fn, ...args) {
  for (let t = 0; ; t++) {
    try { await sleep(DELAY); return await fn(...args); }
    catch (e) { if (CLEAN.has(e.code) || t >= 2) throw e; await sleep(500 * (t + 1)); }
  }
}
const txt = async name => (await q(dns.resolveTxt, name)).map(c => c.join(""));
const mx = async name => q(dns.resolveMx, name);
const has_ = async name => {
  for (const f of [dns.resolve4, dns.resolveMx]) {
    try { if ((await q(f, name)).length) return true; } catch (e) { if (!CLEAN.has(e.code)) throw e; }
  }
  return false;
};
/* A record that does not exist is a result; a resolver that failed is not. */
async function soft(fn) {
  try { return { ok: true, v: await fn() }; }
  catch (e) { return CLEAN.has(e.code) ? { ok: true, v: null } : { ok: false, err: e.code || String(e.message) }; }
}

/* ── one firm ────────────────────────────────────────────────────────── */
async function check(domain) {
  const ev = { domain, checked_at: new Date().toISOString(), method_version: C.METHOD_VERSION, raw: {} };
  const apex = await soft(() => txt(domain));
  const dm = await soft(() => txt("_dmarc." + domain));
  const mxr = await soft(() => mx(domain));
  ev.raw.txt = apex; ev.raw.dmarc = dm; ev.raw.mx = mxr;

  const spf = C.parseSpf(apex.ok ? apex.v || [] : []);
  const dmarc = C.parseDmarc(dm.ok ? dm.v || [] : []);
  const mxList = mxr.ok ? mxr.v || [] : [];
  const nullMx = C.isNullMx(mxList);
  const spfLookups = spf.present ? await C.spfLookupCount(domain, txt) : { count: 0 };

  const dkim = [];
  for (const s of C.DKIM_SELECTORS) {
    const r = await soft(async () => {
      try { return (await q(dns.resolveCname, `${s}._domainkey.${domain}`)).length ? true : null; }
      catch (e) { if (!CLEAN.has(e.code)) throw e; }
      return (await txt(`${s}._domainkey.${domain}`)).length ? true : null;
    });
    if (r.ok && r.v) dkim.push(s);
  }
  const sts = await soft(() => txt("_mta-sts." + domain));
  const rpt = await soft(() => txt("_smtp._tls." + domain));
  let stsMode = "missing";
  if (sts.ok && sts.v && C.parseMtaSts(sts.v)) {
    stsMode = "none";
    try {   // the firm's own policy file: one plain GET
      const r = await fetch(`https://mta-sts.${domain}/.well-known/mta-sts.txt`,
        { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "DATRUM-TrustIndex/1.0 (+https://jldatrum.com/resources/)" } });
      stsMode = C.parseMtaStsMode(r.ok ? await r.text() : "");
    } catch { stsMode = "missing"; }
  }

  const v = C.verdict({ dmarc, spf, nullMx, spfLookups, measured: { dmarc: dm.ok, spf: apex.ok } });
  const looks = [];
  if (LOOK) for (const l of C.lookalikes(domain)) {
    const r = await soft(() => has_(l));
    if (r.ok && r.v) looks.push(l);
  }
  Object.assign(ev, {
    mx_present: mxList.length > 0, null_mx: nullMx,
    spf: { present: spf.present, multiple: !!spf.multiple, all: spf.all, record: spf.record, lookups: spfLookups },
    dmarc: { policy: dmarc.policy, pct: dmarc.pct ?? null, rua: !!dmarc.rua, multiple: !!dmarc.multiple, record: dmarc.record || dmarc.records || null },
    dkim_selectors_found: dkim, dkim_note: "found among common selectors only; absence is not claimed",
    mta_sts_mode: stsMode, tls_rpt_present: !!(rpt.ok && rpt.v && C.parseTlsRpt(rpt.v)),
    lookalikes_registered: looks, lookalikes_checked: LOOK ? C.lookalikes(domain).length : 0,
    verdict: v, verdict_en: C.verdictText(domain, v, "en"), verdict_es: C.verdictText(domain, v, "es"),
  });
  return ev;
}

/* ── run ─────────────────────────────────────────────────────────────── */
const firms = readFirms();
if (!firms.length) { console.error("usage: node tools/impersonation.mjs <domain…> | --file firms.csv [--out dir] [--no-lookalikes] [--lang es]"); process.exit(2); }

const day = new Date().toISOString().slice(0, 10);
const dir = `${OUT}/${day}`;
mkdirSync(dir, { recursive: true });
const esc = s => /[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s);
const COLS = ["name", "domain", "hub", "country", "is_prospect", "is_mid_market", "spoofable", "reason", "dmarc_policy", "spf_all", "own_mail_risk", "lookalikes", "verdict"];
const rows = [COLS.join(",")];
let failed = 0;

for (const f of firms) {
  if (!HOST.test(f.domain || "")) { console.log(`\n${f.domain || "(empty)"}\n  skipped: not a domain`); failed++; continue; }
  let ev;
  try { ev = await check(f.domain); }
  catch (e) { console.log(`\n${f.domain}\n  failed: ${e.message}`); failed++; continue; }
  writeFileSync(`${dir}/${f.domain}.json`, JSON.stringify(ev, null, 2));
  const v = ev.verdict;
  const mark = v.spoofable === null ? "—" : v.spoofable ? "YES" : "NO";
  console.log(`\n${f.domain}\n  spoofable ${mark}   ${ev.dmarc.policy}${ev.dmarc.multiple ? " (two records)" : ""}   spf ${ev.spf.all}   lookalikes ${ev.lookalikes_registered.length}` +
    (v.ownMailRisk ? `\n  · own mail: ${v.ownMailRisk}` : ""));
  rows.push([f.name || "", f.domain, f.hub || "", f.country || "", f.is_prospect || "", f.is_mid_market || "", mark, v.reason,
    ev.dmarc.policy, ev.spf.all, v.ownMailRisk || "", ev.lookalikes_registered.length, LANG === "es" ? ev.verdict_es : ev.verdict_en].map(esc).join(","));
}
writeFileSync(`${dir}/summary.csv`, rows.join("\n") + "\n");
console.log(`\n${rows.length - 1} written to ${dir}/summary.csv${failed ? `, ${failed} skipped or failed` : ""}`);
process.exit(failed && failed === firms.length ? 1 : 0);
