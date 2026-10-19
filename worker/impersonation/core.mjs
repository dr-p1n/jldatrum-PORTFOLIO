/* ── Impersonation core ────────────────────────────────────────────────
 *
 * The question: could a stranger send mail that appears to come from this
 * exact domain, with receivers not told to reject it?
 *
 * PURE JS. No Node imports, no fetch, no HTMLRewriter, so the same file runs
 * in the Node batch runner and in the Worker. Resolution is injected:
 *   resolveTxt(name) -> Promise<string[]>   one string per TXT record
 *   resolveHas(name, type) -> Promise<boolean>   A / AAAA / MX present
 * Both reject with an Error whose `code` is "NXDOMAIN"/"NODATA" for a clean
 * absence. ANY OTHER FAILURE IS "could not measure", never a pass or a fail.
 *
 * ⚠️ WHAT IT DOES NOT CLAIM. DMARC covers the exact From domain. Lookalike
 * domains and display-name tricks are outside it. A verdict says receivers are
 * not told to reject; it never says the message will arrive.
 * ⚠️ spoofable is "DMARC is not enforcing". A missing SPF with p=reject is NOT
 * spoofable; it is a risk to the firm's own mail and is reported separately.
 * ⚠️ DKIM is never "absent". Only "not found among common selectors".
 */
export const METHOD_VERSION = "1.0";

export const DKIM_SELECTORS = ["default", "google", "selector1", "selector2", "k1", "s1", "s2",
  "mail", "dkim", "zoho", "hostinger", "mandrill", "smtp"];

const CLEAN_ABSENCE = new Set(["NXDOMAIN", "NODATA", "ENOTFOUND", "ENODATA"]);
const absent = e => CLEAN_ABSENCE.has(e && e.code);

/* ── Parsers ─────────────────────────────────────────────────────────── */

export function parseSpf(txts) {
  const recs = txts.filter(t => /^\s*v=spf1(\s|$)/i.test(t));
  if (!recs.length) return { present: false, count: 0, all: "none", record: null };
  const rec = recs[0].trim();
  const terms = rec.split(/\s+/).slice(1);
  const allT = terms.find(t => /^[+\-~?]?all$/i.test(t));
  const all = allT ? (/^[+\-~?]/.test(allT) ? allT[0] : "+") + "all" : "none";
  return { present: true, count: recs.length, multiple: recs.length > 1, all, record: rec, terms };
}

export function parseDmarc(txts) {
  const recs = txts.filter(t => /^\s*v=DMARC1\s*(;|$)/i.test(t));
  if (!recs.length) return { present: false, count: 0, policy: "missing", record: null };
  if (recs.length > 1) return { present: true, count: recs.length, multiple: true, policy: "multiple", records: recs };
  const rec = recs[0].trim();
  const tag = n => { const m = rec.match(new RegExp("(?:^|;)\\s*" + n + "\\s*=\\s*([^;]*)", "i")); return m ? m[1].trim() : null; };
  const p = (tag("p") || "").toLowerCase();
  const pct = tag("pct") === null ? 100 : Math.max(0, Math.min(100, parseInt(tag("pct"), 10) || 0));
  const policy = ["none", "quarantine", "reject"].includes(p) ? p : "invalid";
  return { present: true, count: 1, multiple: false, policy, pct, sp: tag("sp"), rua: !!tag("rua"), record: rec };
}

export function parseMtaSts(txts) {
  return txts.some(t => /^\s*v=STSv1\s*;/i.test(t));
}
export function parseTlsRpt(txts) {
  return txts.some(t => /^\s*v=TLSRPTv1\s*;/i.test(t));
}
export function parseMtaStsMode(body) {
  const m = /^\s*mode\s*:\s*(enforce|testing|none)\s*$/im.exec(body || "");
  return m ? m[1].toLowerCase() : "missing";
}

/* RFC 7505: a single "0 ." MX means the domain sends and receives no mail. */
export const isNullMx = mxRecords =>
  mxRecords.length === 1 && Number(mxRecords[0].priority) === 0 && /^\.?$/.test(mxRecords[0].exchange || "");

/* ── SPF lookup count ────────────────────────────────────────────────── */

const COUNTED = /^[+\-~?]?(include|a|mx|ptr|exists|redirect)([:=/]|$)/i;

/* Counts DNS-lookup terms recursively, as RFC 7208 §4.6.4 does. Returns
   { count, capped, error }. `maxQueries` bounds the work in a Worker. */
export async function spfLookupCount(domain, resolveTxt, maxQueries = 30) {
  const seen = new Set();
  let queries = 0, count = 0, capped = false, error = null;
  async function walk(name, depth) {
    if (seen.has(name) || depth > 10) return;
    seen.add(name);
    if (queries++ >= maxQueries) { capped = true; return; }
    let txts;
    try { txts = await resolveTxt(name); } catch (e) { if (!absent(e)) error = e.code || "error"; return; }
    const spf = parseSpf(txts);
    if (!spf.present) return;
    for (const t of spf.terms) {
      const m = COUNTED.exec(t);
      if (!m) continue;
      count++;
      const kind = m[1].toLowerCase();
      if (kind === "include") await walk(t.split(":")[1], depth + 1);
      else if (kind === "redirect") await walk(t.split("=")[1], depth + 1);
    }
  }
  await walk(domain, 0);
  return { count, capped, error };
}

/* ── Verdict ─────────────────────────────────────────────────────────── */

/* input: { dmarc, spf, mx, nullMx, measured: { dmarc: bool, spf: bool } }
   spoofable: true | false | null (null = could not measure) */
export function verdict(i) {
  const d = i.dmarc;
  if (i.measured && i.measured.dmarc === false) return { spoofable: null, reason: "unmeasured", ownMailRisk: null };

  const enforcing = d.present && !d.multiple && (d.policy === "quarantine" || d.policy === "reject") && d.pct === 100;
  let reason;
  if (enforcing) reason = d.policy;
  else if (d.multiple) reason = "multiple";
  else if (!d.present) reason = "missing";
  else if (d.policy === "none") reason = "none";
  else if (d.policy === "invalid") reason = "invalid";
  else reason = "partial";            // quarantine/reject at pct < 100

  /* Reported separately from spoofability. */
  let ownMailRisk = null;
  if (i.measured && i.measured.spf === false) ownMailRisk = null;
  else if (!i.spf.present && !i.nullMx) ownMailRisk = "no-spf";
  else if (i.spf.multiple) ownMailRisk = "multiple-spf";
  else if (i.spf.present && i.spf.all === "+all") ownMailRisk = "plus-all";
  else if (i.spfLookups && i.spfLookups.count > 10) ownMailRisk = "over-10";

  return { spoofable: !enforcing, reason, ownMailRisk };
}

/* ── Strings, EN/ES ──────────────────────────────────────────────────── */

const REASON = {
  missing:    ["The domain publishes no policy telling receivers what to do with forged mail.",
               "El dominio no publica ninguna regla sobre qué hacer con correo falsificado."],
  none:       ["The domain's policy is to watch forged mail, not to stop it.",
               "La regla del dominio es observar el correo falsificado, no detenerlo."],
  multiple:   ["The domain publishes two policies, so receivers ignore both.",
               "El dominio publica dos reglas, así que los receptores ignoran ambas."],
  invalid:    ["The domain's policy cannot be read, so receivers ignore it.",
               "La regla del dominio no se puede leer, así que los receptores la ignoran."],
  partial:    ["The domain's policy applies to only part of the mail.",
               "La regla del dominio se aplica solo a una parte del correo."],
  quarantine: ["Receivers are told to treat forged mail as spam.",
               "A los receptores se les indica tratar el correo falsificado como spam."],
  reject:     ["Receivers are told to refuse forged mail.",
               "A los receptores se les indica rechazar el correo falsificado."],
  unmeasured: ["We could not read this domain's records, so there is no verdict.",
               "No pudimos leer los registros de este dominio, así que no hay veredicto."],
};

export function verdictText(domain, v, lang = "en") {
  const i = lang === "es" ? 1 : 0;
  if (v.spoofable === null) return REASON.unmeasured[i];
  const yes = lang === "es" ? "SÍ" : "YES", no = "NO";
  const head = lang === "es"
    ? `Un extraño podría enviar correo que parece venir de ${domain} hoy: ${v.spoofable ? yes : no}`
    : `A stranger could send mail that appears to come from ${domain} today: ${v.spoofable ? yes : no}`;
  return head + ". " + REASON[v.reason][i];
}

/* ── Lookalikes ──────────────────────────────────────────────────────── */

const HOMOGLYPH = [["o", "0"], ["0", "o"], ["l", "1"], ["1", "l"], ["i", "l"], ["l", "i"], ["rn", "m"], ["m", "rn"], ["vv", "w"], ["w", "vv"]];
const SWAP_TLDS = ["com", "net", "co", "org", "com.pa", "pa"];

/* ~30 variants, deterministic, never includes the input. Registered does not
   mean malicious: owners register these defensively. */
export function lookalikes(domain, limit = 30) {
  const d = domain.toLowerCase().replace(/^www\./, "");
  const dot = d.indexOf(".");
  if (dot < 1) return [];
  const sld = d.slice(0, dot), tld = d.slice(dot + 1);
  const fam = [[], [], [], [], []];
  const add = (f, s, t = tld) => { if (/^[a-z0-9-]+$/.test(s) && s && s[0] !== "-" && s.at(-1) !== "-") fam[f].push(s + "." + t); };

  for (let i = 0; i < sld.length && sld.length > 3; i++) add(0, sld.slice(0, i) + sld.slice(i + 1));    // omission
  for (let i = 0; i < sld.length - 1; i++) if (sld[i] !== sld[i + 1])                                    // swap
    add(1, sld.slice(0, i) + sld[i + 1] + sld[i] + sld.slice(i + 2));
  for (let i = 0; i < sld.length; i++) add(2, sld.slice(0, i + 1) + sld[i] + sld.slice(i + 1));         // repetition
  for (const [a, b] of HOMOGLYPH) { const k = sld.indexOf(a); if (k >= 0) add(3, sld.slice(0, k) + b + sld.slice(k + a.length)); }
  for (const t of SWAP_TLDS) if (t !== tld) add(4, sld, t);                                              // TLD swap

  /* Round-robin across families so the limit never drops a whole technique. */
  const out = new Set();
  for (let r = 0; fam.some(f => r < f.length); r++) for (const f of fam) if (r < f.length) out.add(f[r]);
  out.delete(d);
  return [...out].slice(0, limit);
}
