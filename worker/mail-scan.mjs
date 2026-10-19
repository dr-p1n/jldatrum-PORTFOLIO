/* ── The mail instrument ───────────────────────────────────────────────
 * Could a stranger send mail that appears to come from this domain?
 *
 * DNS-over-HTTPS from a Worker, because Workers have no `dns` module. DoH is
 * an open protocol; the resolver URL is config (env.DOH_URL), not a vendor
 * contract. The parsing and the verdict are worker/impersonation/core.mjs,
 * the same file the Node batch runner uses, so one ruler serves both.
 *
 * ⚠️ THE INPUT IS A DOMAIN, NOT A URL. Nothing is fetched from it. Nothing at
 * a lookalike is ever visited; lookalikes are resolved and that is all.
 * ⚠️ A WORKER MAY MAKE ONLY SO MANY SUBREQUESTS. The budget below keeps one
 * scan near 30; LOOKALIKE_LIMIT is what pays for it. The Node runner checks
 * all thirty.
 * ⚠️ NO SCAN RESULT IS STORED. Same promise as the other instruments.
 */
import * as C from "./impersonation/core.mjs";

export const DEFAULT_DOH = "https://cloudflare-dns.com/dns-query";
export const LOOKALIKE_LIMIT = 15;
const SPF_QUERY_CAP = 8;

const err = code => Object.assign(new Error(code), { code });

/* A name the reader typed. Accepts a pasted URL or address and reduces it. */
export function cleanDomain(raw) {
  let s = String(raw || "").trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, "").replace(/^.*@/, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/^www\./, "").replace(/\.$/, "");
  if (s.length < 4 || s.length > 253) return null;
  if (!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(s)) return null;   // also rejects IP literals
  if (/\.(local|localhost|internal|test|invalid|example|onion)$/.test(s)) return null;
  return s;
}

export function dohResolver(env, fetchFn = fetch) {
  const base = env?.DOH_URL || DEFAULT_DOH;
  let calls = 0;
  async function ask(name, type) {
    calls++;
    const r = await fetchFn(`${base}?name=${encodeURIComponent(name)}&type=${type}`,
      { headers: { Accept: "application/dns-json" } });
    if (!r.ok) throw err("DOH" + r.status);
    const j = await r.json();
    if (j.Status === 3) throw err("NXDOMAIN");
    if (j.Status !== 0) throw err("RCODE" + j.Status);
    const want = { TXT: 16, MX: 15, A: 1 }[type];
    const ans = (j.Answer || []).filter(a => a.type === want);
    if (!ans.length) throw err("NODATA");
    return ans.map(a => a.data);
  }
  return {
    get calls() { return calls; },
    async txt(name) {
      return (await ask(name, "TXT")).map(d => {
        const parts = [...d.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m => m[1].replace(/\\"/g, '"'));
        return parts.length ? parts.join("") : d;
      });
    },
    async mx(name) {
      return (await ask(name, "MX")).map(d => { const [p, ...e] = d.split(" "); return { priority: Number(p), exchange: e.join(" ").replace(/\.$/, "") }; });
    },
    async a(name) { return (await ask(name, "A")).length > 0; },
  };
}

const RISK = {
  "no-spf": ["It publishes no list of who may send its mail, so its own messages can be treated as suspect.",
             "No publica una lista de quién puede enviar su correo, así que sus propios mensajes pueden tratarse como sospechosos."],
  "multiple-spf": ["It publishes two lists of who may send its mail, so receivers ignore both.",
                   "Publica dos listas de quién puede enviar su correo, así que los receptores ignoran ambas."],
  "plus-all": ["Its sender list allows anyone to send as the domain.",
               "Su lista de remitentes permite que cualquiera envíe como el dominio."],
  "over-10": ["Its sender list is too long, so receivers may ignore it.",
              "Su lista de remitentes es demasiado larga, así que los receptores pueden ignorarla."],
};
const NOTE_NOMAIL = ["No mail server is set up for this name. It can still be used as a sender.",
                     "Este nombre no tiene servidor de correo. Aun así puede usarse como remitente."];

async function soft(fn) {
  try { return { ok: true, v: await fn() }; }
  catch (e) { return ["NXDOMAIN", "NODATA"].includes(e.code) ? { ok: true, v: null } : { ok: false, err: e.code || "error" }; }
}

export async function scanMail(domain, lang, env, fetchFn = fetch) {
  const i = lang === "es" ? 1 : 0;
  const r = dohResolver(env, fetchFn);
  const [apex, dm, mxr, sts, rpt] = await Promise.all([
    soft(() => r.txt(domain)), soft(() => r.txt("_dmarc." + domain)), soft(() => r.mx(domain)),
    soft(() => r.txt("_mta-sts." + domain)), soft(() => r.txt("_smtp._tls." + domain)),
  ]);
  const spf = C.parseSpf(apex.ok ? apex.v || [] : []);
  const dmarc = C.parseDmarc(dm.ok ? dm.v || [] : []);
  const mxList = mxr.ok ? mxr.v || [] : [];
  const nullMx = C.isNullMx(mxList);
  const spfLookups = spf.present ? await C.spfLookupCount(domain, r.txt, SPF_QUERY_CAP) : { count: 0 };

  const v = C.verdict({ dmarc, spf, nullMx, spfLookups, measured: { dmarc: dm.ok, spf: apex.ok } });

  const looks = C.lookalikes(domain, LOOKALIKE_LIMIT);
  const hits = [];
  if (v.spoofable !== null) {
    for (let k = 0; k < looks.length; k += 5)
      await Promise.all(looks.slice(k, k + 5).map(async l => { const x = await soft(() => r.a(l)); if (x.ok && x.v) hits.push(l); }));
  }

  const evidence = [
    { name: domain, type: "TXT", answer: apex.ok ? (apex.v || []).filter(t => /^v=spf1/i.test(t)) : null },
    { name: "_dmarc." + domain, type: "TXT", answer: dm.ok ? dm.v || [] : null },
    { name: domain, type: "MX", answer: mxr.ok ? mxList.map(m => `${m.priority} ${m.exchange}`) : null },
  ];
  return {
    mode: "mail", domain, lang, scannedAt: new Date().toISOString(), method_version: C.METHOD_VERSION,
    spoofable: v.spoofable, reason: v.reason,
    verdict: C.verdictText(domain, v, lang),
    ownMail: v.ownMailRisk ? RISK[v.ownMailRisk][i] : null,
    note: !mxList.length && !nullMx && v.spoofable ? NOTE_NOMAIL[i] : null,
    evidence,
    mtaSts: !!(sts.ok && sts.v && C.parseMtaSts(sts.v)), tlsRpt: !!(rpt.ok && rpt.v && C.parseTlsRpt(rpt.v)),
    lookalikes: { checked: v.spoofable === null ? 0 : looks.length, registered: hits.sort() },
  };
}
