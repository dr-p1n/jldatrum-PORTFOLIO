/**
 * DATRUM — AI Visibility Scanner
 * Cloudflare Worker. Fetches one URL server-side (CORS makes this impossible
 * from the browser) and grades how legible it is to answer engines.
 *
 * Every deduction is a mechanical fact about a fetched document. No projections,
 * no vendor statistics — the score is reproducible by anyone with curl.
 *
 * Deploy:  wrangler deploy
 * Route:   POST /scan  { "url": "https://example.com" }
 */

const ALLOWED_ORIGINS = new Set([
  "https://jldatrum.com",
  "http://localhost:3456",
]);

const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES        = 2_000_000;   // 2 MB ceiling on the target document
const MAX_REDIRECTS    = 5;

/* ── Crawlers that matter, and what it costs to block them ─────────── */
const AI_CRAWLERS = [
  { ua: "GPTBot",          weight: 15, label: "ChatGPT (training + retrieval)", labelEs: "ChatGPT (entrenamiento + recuperaci\u00f3n)" },
  { ua: "OAI-SearchBot",   weight: 10, label: "ChatGPT Search",                 labelEs: "ChatGPT Search" },
  { ua: "ClaudeBot",       weight: 10, label: "Claude",                         labelEs: "Claude" },
  { ua: "PerplexityBot",   weight: 10, label: "Perplexity",                     labelEs: "Perplexity" },
  { ua: "Google-Extended", weight: 10, label: "Google AI Overviews / Gemini",   labelEs: "Google AI Overviews / Gemini" },
  { ua: "CCBot",           weight:  5, label: "Common Crawl (feeds many)",      labelEs: "Common Crawl (alimenta a muchos)" },
];

/* ── Guardrails: this endpoint fetches attacker-supplied URLs ─────────
   An anchored regex is the wrong tool here — `/^127\./` with a trailing `$`
   silently accepts 127.0.0.1. Enumerate the ranges instead.            */
function isPrivateHost(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");

  if (h === "localhost" || h === "::1" || h === "0.0.0.0") return true;
  if (/\.(local|internal|localhost|home|lan|corp|intranet)$/.test(h)) return true;

  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = v4.slice(1).map(Number);
    if (v4.slice(1).some(n => Number(n) > 255)) return true;
    if (a === 0 || a === 127) return true;                 // this-host, loopback
    if (a === 10) return true;                             // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true;      // RFC1918
    if (a === 192 && b === 168) return true;               // RFC1918
    if (a === 169 && b === 254) return true;               // link-local / cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true;     // CGNAT
    if (a >= 224) return true;                             // multicast + reserved
    return false;
  }

  if (h.includes(":")) {                                   // IPv6
    if (/^f[cd]/.test(h)) return true;                     // unique local fc00::/7
    if (/^fe[89ab]/.test(h)) return true;                  // link-local fe80::/10
    return false;
  }
  return false;
}

// A title shorter than this names nothing. "Home", "Inicio", "|" all clear a
// presence test and identify no business.
const MIN_TITLE = 15;

/* ── Facts about a document, shared by both instruments ──────────────
   Both instruments now read the same page, and both report on its title,
   description, H1 and heading order. They must never disagree about one:
   a prospect who runs both and gets two verdicts on the same H1 learns to
   trust neither. These predicates are the single source of truth, the way
   HSTS_MIN_AGE already is for the header both instruments judge.
   ─────────────────────────────────────────────────────────────────── */
const titleNames    = doc => doc.title.trim().length >= MIN_TITLE;

/* Three states, not two. A page with four H1s has not failed to have one, and
   telling its owner "no heading says what this page is" is a statement they
   disprove by pressing ctrl-U — which is the worst thing a cold-outreach
   instrument can do. The pass condition is unchanged (exactly one H1 that says
   something); what changes is that each failure now names the failure it is.
   A heading of "1." is present and carries no subject, so it is neither a pass
   nor an absence. Anything holding a letter carries a subject; numerals and
   punctuation styled large do not. */
const h1Subject = t => /\p{L}/u.test(String(t || ""));
function h1State(doc) {
  if (doc.h1.length === 0) return "none";
  if (doc.h1.length > 1)   return "many";
  return h1Subject(doc.h1[0].text) ? "ok" : "blank";
}
const hasOneH1      = doc => h1State(doc) === "ok";
const descPresent   = doc => doc.description.trim().length > 0;
const descUsable    = doc => { const n = doc.description.trim().length;
                               return n === 0 || (n >= 50 && n <= 320); };
// Absolute AND parseable. "http://[bad" satisfies the shape and no browser can
// resolve it, so shape alone is not the test.
const canonicalAbs  = doc => {
  const v = String(doc.canonical || "").trim();
  if (!/^https?:\/\/\S+$/i.test(v)) return false;
  try { new URL(v); return true; } catch { return false; }
};
const langDeclared  = doc => String(doc.lang || "").trim().length > 0;
const mixedContent  = doc => doc.insecureRefs > 0;

// noindex removes the page from the index outright — it is not a ranking
// penalty. It can arrive in the response header or in the markup, and the two
// are read together because either one alone is enough to do it.
function isNoindex(robotsHeader, doc) {
  const v = (String(robotsHeader || "") + " " + String((doc && doc.robotsMeta) || "")).toLowerCase();
  return /\bnone\b|\bnoindex\b/.test(v);
}

// A canonical is allowed to point somewhere else — that is what it is for on a
// paginated or syndicated page, and failing those would be inventing a finding.
// What is never right is pointing at a different site, which hands this page's
// standing to a domain the owner may not control. www is not a different site.
const bareHost = h => String(h || "").toLowerCase().replace(/^www\./, "");
function canonicalOffsite(doc, target) {
  if (!canonicalAbs(doc)) return false;          // priced by the absolute check
  try { return bareHost(new URL(doc.canonical.trim()).hostname) !== bareHost(target.hostname); }
  catch { return false; }
}

// The first place the document drops a level, e.g. an h2 followed by an h4.
// Returns null when the outline is sequential.
function headingSkip(doc) {
  for (let i = 1; i < doc.headings.length; i++) {
    const d = doc.headings[i].level - doc.headings[i - 1].level;
    if (d > 1) return { from: doc.headings[i - 1].level, to: doc.headings[i].level };
  }
  return null;
}

// A census, not a check. "How many H2s" has no pass and no fail, so it is
// reported as a fact beside the checks and priced at nothing.
function headingCensus(doc) {
  const n = { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 };
  for (const h of doc.headings) n["h" + h.level]++;
  return n;
}

// The rate-limit ceilings live in wrangler.toml [vars], so tuning them is a
// config deploy rather than a logic edit. The fallback is a number and never
// Infinity on purpose: an unset, misspelled or garbled var must not silently
// mean "no limit". This endpoint fetches arbitrary user-supplied URLs and the
// requests carry jldatrum.com in the User-Agent, so an unmetered scanner is a
// way for a stranger to get this domain WAF-blocked by somebody else's site.
// A ceiling of 0 or less reads as a mistake, not as "closed", and falls back
// too — closing the endpoint is what undeploying is for.
const RATE_FALLBACK = 60;
function ceiling(env, name) {
  const n = parseInt(env?.[name], 10);
  return Number.isFinite(n) && n > 0 ? n : RATE_FALLBACK;
}

const ERR = {
  en: {
    parse:    "That doesn't parse as a URL.",
    scheme:   "Only http and https URLs can be scanned.",
    creds:    "URLs with embedded credentials are not accepted.",
    private:  "Private, loopback and link-local addresses cannot be scanned.",
    public:   "That hostname doesn't look public.",
    json:     "Expected JSON.",
    method:   "POST only.",
    rate:     n => `Scan limit reached \u2014 ${n} per hour. Try again shortly.`,
    fetch:    r => `Could not fetch that URL: ${r}`,
    failed:   "request failed",
    http: n =>
      n === 429 ? "The target returned HTTP 429 — it is rate-limiting requests rather than refusing them. Try again in a minute."
      : (n === 401 || n === 403)
        ? `The target returned HTTP ${n} — it refused an identified crawler. That is bot protection, not a markup problem, and this scan cannot see the page at all. It is worth knowing that the same rule frequently blocks GPTBot and the other AI crawlers: where it does, the page is invisible to answer engines however good its structured data is. Confirm that against the site's own WAF and robots rules rather than inferring it from this one refusal.`
      : `The target returned HTTP ${n}.`,
    notHtml:  ct => `That URL returned ${ct || "an unknown content type"}, not HTML.`,
    shell: (bytes, text) =>
      `That URL returned ${bytes.toLocaleString()} bytes of HTML holding only ${text} characters of text — the page builds itself in the browser, and this reader does not run scripts. Everything measured on the words of a page would be measured against an empty shell, so nothing is scored. What a visitor sees is not in question; what an engine that does not run scripts sees is exactly this.`,
    crashed:  m => `Scan failed: ${m}`,
    email:    "That doesn't look like an email address.",
    leadRate: "Too many requests \u2014 try again shortly.",
    leadOff:  "The report service is not configured.",
  },
  es: {
    parse:    "Eso no se puede leer como una URL.",
    scheme:   "Solo se pueden escanear URLs http y https.",
    creds:    "No se aceptan URLs con credenciales incrustadas.",
    private:  "No se pueden escanear direcciones privadas, de loopback ni link-local.",
    public:   "Ese nombre de host no parece p\u00fablico.",
    json:     "Se esperaba JSON.",
    method:   "Solo POST.",
    rate:     n => `L\u00edmite de escaneos alcanzado \u2014 ${n} por hora. Prueba de nuevo en un rato.`,
    fetch:    r => `No se pudo obtener esa URL: ${r}`,
    failed:   "la petici\u00f3n fall\u00f3",
    http: n =>
      n === 429 ? "El destino devolvi\u00f3 HTTP 429 — est\u00e1 limitando peticiones, no rechaz\u00e1ndolas. Prueba de nuevo en un minuto."
      : (n === 401 || n === 403)
        ? `El destino devolvi\u00f3 HTTP ${n} — rechaz\u00f3 a un crawler identificado. Eso es protecci\u00f3n anti-bots, no un problema de marcado, y este escaneo no alcanza a ver la p\u00e1gina. Vale saber que esa misma regla suele bloquear a GPTBot y a los dem\u00e1s crawlers de IA: donde lo hace, la p\u00e1gina es invisible para los motores de respuesta por bueno que sea su marcado. Conf\u00edrmalo contra las reglas de WAF y robots del sitio, no lo infieras de este solo rechazo.`
      : `El destino devolvi\u00f3 HTTP ${n}.`,
    notHtml:  ct => `Esa URL devolvi\u00f3 ${ct || "un tipo de contenido desconocido"}, no HTML.`,
    shell: (bytes, text) =>
      `Esa URL devolvi\u00f3 ${bytes.toLocaleString()} bytes de HTML con apenas ${text} caracteres de texto — la p\u00e1gina se arma en el navegador y este lector no ejecuta scripts. Todo lo que se mide sobre las palabras de una p\u00e1gina se medir\u00eda contra una c\u00e1scara vac\u00eda, as\u00ed que no se califica nada. Lo que ve una persona no est\u00e1 en duda; lo que ve un motor que no ejecuta scripts es exactamente esto.`,
    crashed:  m => `El escaneo fall\u00f3: ${m}`,
    email:    "Eso no parece una direcci\u00f3n de correo.",
    leadRate: "Demasiadas peticiones \u2014 prueba de nuevo en un rato.",
    leadOff:  "El servicio de informes no est\u00e1 configurado.",
  },
};
const errs = lang => ERR[lang === "es" ? "es" : "en"];

function validateTarget(raw, lang) {
  const E = errs(lang);
  let u;
  try { u = new URL(String(raw).trim()); } catch { return { error: E.parse }; }
  if (u.protocol !== "https:" && u.protocol !== "http:")
    return { error: E.scheme };
  if (u.username || u.password)
    return { error: E.creds };
  if (isPrivateHost(u.hostname))
    return { error: E.private };
  if (!u.hostname.includes("."))
    return { error: E.public };
  u.hash = "";
  return { url: u };
}

async function fetchCapped(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      "User-Agent": "DATRUM-VisibilityScanner/1.0 (+https://jldatrum.com/resources/scan/)",
      "Accept": "text/html,application/xhtml+xml,text/plain,*/*",
      ...(init.headers || {}),
    },
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  const reader = res.body?.getReader();
  if (!reader) return { res, body: "" };
  const chunks = []; let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) { reader.cancel(); break; }
    chunks.push(value);
  }
  const buf = new Uint8Array(total > MAX_BYTES ? MAX_BYTES : total);
  let off = 0;
  for (const c of chunks) {
    if (off + c.length > buf.length) { buf.set(c.subarray(0, buf.length - off), off); break; }
    buf.set(c, off); off += c.length;
  }
  return { res, body: new TextDecoder("utf-8").decode(buf) };
}

/* ── robots.txt: parse group-by-group, honour wildcard fallback ─────── */
function parseRobots(txt) {
  const groups = []; let current = null;
  for (const line of txt.split(/\r?\n/)) {
    const clean = line.replace(/#.*$/, "").trim();
    if (!clean) continue;
    const [k, ...rest] = clean.split(":");
    const key = k.trim().toLowerCase();
    const val = rest.join(":").trim();
    if (key === "user-agent") {
      if (!current || current.rules.length) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(val.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && current) {
      current.rules.push({ allow: key === "allow", path: val });
    }
  }
  return groups;
}

function blocksAgent(groups, ua, path = "/") {
  const lower = ua.toLowerCase();
  const g = groups.find(x => x.agents.includes(lower)) || groups.find(x => x.agents.includes("*"));
  if (!g) return false;
  // Longest matching rule wins; an empty Disallow means "allow everything".
  let best = null;
  for (const r of g.rules) {
    if (r.path === "") { if (!r.allow) continue; }
    const pat = r.path === "" ? "/" : r.path;
    if (!path.startsWith(pat.replace(/\*$/, ""))) continue;
    if (!best || pat.length > best.pat.length) best = { pat, allow: r.allow };
  }
  return best ? !best.allow : false;
}

/* ── HTML extraction via HTMLRewriter (streaming, no DOM in Workers) ── */
// HTMLRewriter hands back the raw source text, so "Email &amp; SMS" arrives
// with the entity intact. The results table writes through textContent, which
// is correct and also means an undecoded entity is printed literally at the
// prospect. Decode the five named ones and numeric refs — enough for a title
// or a description, and no HTML parser needed to do it.
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEntities(s) {
  return String(s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, body) => {
    if (body[0] === "#") {
      const n = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    const v = ENT[body.toLowerCase()];
    return v === undefined ? m : v;
  });
}

async function extractHtml(html) {
  const out = {
    title: "", description: "", canonical: "", lang: "",
    h1: [], headings: [], jsonld: [], hreflang: [],
    imgTotal: 0, imgNoAlt: 0, textLen: 0, hasMain: false,
    robotsMeta: "", insecureRefs: 0,
  };
  // A subresource is fetched by the browser; a link is not. Only the first kind
  // is mixed content, so an ordinary <a href="http://…"> is left alone.
  const insecure = v => { if (/^http:\/\//i.test(String(v || "").trim())) out.insecureRefs++; };
  let capture = null;

  const rewriter = new HTMLRewriter()
    .on("title", { text(t) { out.title += t.text; } })
    .on('meta[name="description"]',  { element(e) { out.description = e.getAttribute("content") || ""; } })
    .on('meta[name="robots"], meta[name="googlebot"]',
                                     { element(e) { out.robotsMeta += " " + (e.getAttribute("content") || ""); } })
    .on("script[src], img[src], iframe[src], audio[src], video[src], embed[src], source[src], track[src]",
                                     { element(e) { insecure(e.getAttribute("src")); } })
    .on('link[rel="stylesheet"], link[rel="preload"], link[rel="modulepreload"]',
                                     { element(e) { insecure(e.getAttribute("href")); } })
    .on("object[data]",              { element(e) { insecure(e.getAttribute("data")); } })
    .on('link[rel="canonical"]',     { element(e) { out.canonical  = e.getAttribute("href") || ""; } })
    .on('link[rel="alternate"]',     { element(e) { const h = e.getAttribute("hreflang"); if (h) out.hreflang.push(h); } })
    .on("html",                      { element(e) { out.lang = e.getAttribute("lang") || ""; } })
    .on("main, article",             { element()  { out.hasMain = true; } })
    .on("img", { element(e) { out.imgTotal++; const a = e.getAttribute("alt"); if (a === null || a.trim() === "") out.imgNoAlt++; } })
    .on('script[type="application/ld+json"]', {
      element() { capture = ""; out.jsonld.push(null); },
      text(t) {
        if (capture === null) return;
        capture += t.text;
        if (t.lastInTextNode) { out.jsonld[out.jsonld.length - 1] = capture; capture = null; }
      },
    })
    .on("h1, h2, h3, h4, h5, h6", {
      element(e) { out.headings.push({ level: Number(e.tagName[1]), text: "" }); },
      text(t)    { const h = out.headings[out.headings.length - 1]; if (h) h.text += t.text; },
    })
    .on("body", {});

  await rewriter.transform(new Response(html)).text();

  // Visible text actually present in the served bytes. Anything a crawler that
  // does not run JavaScript would be able to read.
  out.textLen = html
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-zA-Z#0-9]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;

  out.title = decodeEntities(out.title);
  out.description = decodeEntities(out.description);
  out.headings.forEach(h => { h.text = decodeEntities(h.text); });

  out.h1 = out.headings.filter(h => h.level === 1);
  out.jsonld = out.jsonld.filter(Boolean);
  return out;
}

/* ── Result strings, both languages ──────────────────────────────────
   One table, never a forked worker. Titles are flat strings; details are
   functions because most interpolate a value the scan actually found.
   runChecks passes structured vars, so the pass/fail logic below stays the
   single source of truth and only the wording is per-language.          */
const STR = {
  en: {
    "ld-present": {
      so: "Nothing on the page tells an AI assistant what business this is, so it guesses from the prose or skips you.", t: "The page says what business this is", nt: "Nothing says what business this is",
      d: v => v.n === 0
        ? "Nothing on this page describes the business in a form a machine can read on its own — no name, no address, no list of what you sell, only prose. Nothing else in this section can be measured until something does."
        : `${v.n} machine-readable description(s) of the business found.` },
    "ld-valid": {
      so: "The one block that describes your business is unreadable to every engine, so it counts as if it were not there.", t: "The description of the business is readable", nt: "The description of the business cannot be read",
      d: v => v.malformed === 0 ? "All of them read cleanly."
        : v.entityBug
          ? `${v.malformed} of them are written incorrectly and no engine can read them. A stray character (${v.entityBug}) got into the text — the page looks right to a person and is blank to every machine.`
          : `${v.malformed} of them are written incorrectly, so every engine throws them away without telling anyone.` },
    "ld-org": {
      so: "Nothing states that this is a company, so an assistant has no business to attach a recommendation to.", t: "The page states that this is a company", nt: "Nothing states that this is a company",
      d: v => v.type ? `Declared as ${v.type}.`
        : "The description never says this is a company at all, so there is nothing for a recommendation to attach to." },
    "ld-name": {
      so: "Your business has no name an engine can quote, so it cannot be recommended by name.", t: "The business has a name an engine can quote", nt: "The business has no name an engine can quote",
      d: v => v.name ? `Named: ${v.name}` : "The description carries no name an engine could quote back." },
    "ld-address": {
      so: "Nothing states where you operate, so you do not come up when someone asks for a firm in your city.", t: "The page says where you operate", nt: "The page never says where you operate",
      d: v => v.ok ? "A postal address is stated."
        : "No address is stated where a machine looks, so a search for a firm in your city cannot land on you." },
    "ld-sameas": {
      so: "Nothing connects this site to your LinkedIn or directory listings, so engines treat you as a stranger rather than a known company.", t: "You are linked to the profiles that identify you", nt: "Nothing links you to the profiles that identify you",
      d: v => v.n ? `${v.n} link(s) out to your other profiles.`
        : "Nothing links this site to your LinkedIn or to any directory listing, so engines cannot tell this business apart from any other with a similar name." },
    "ld-services": {
      so: "Nothing lists what you actually sell, so an assistant cannot match you to someone asking for it.", t: "What you sell is listed, not just described", nt: "What you sell is listed nowhere",
      d: v => v.catalog ? "Services are listed."
        : "Nothing lists what you sell. A machine can only recommend what it can read as a list." },
    "robots-exists": {
      so: "The file that tells crawlers what they may read is missing, so each one decides for itself.", t: "Your site publishes rules for what may be read", nt: "No rules are published for what may be read",
      d: v => v.ok ? "Served."
        : v.served ? "That address answers, but what comes back is not robots.txt — you are publishing no rules at all."
        : "There is no robots.txt on your domain. Not fatal, but you have published no rules about what may be read." },
    bot: {
      so: "This crawler is turned away at the door, so the assistant it feeds cannot see your site at all.", t: v => `${v.ua} is allowed`, nt: v => `${v.ua} is turned away`,
      d: v => v.blocked
        ? `Your own rules turn it away. ${v.label} cannot read this page — not ranked lower, absent.`
        : `Allowed. ${v.label} can retrieve this page.` },
    sitemap: {
      so: "Nothing hands engines a list of your pages, so they find only what they stumble on.", t: "Your pages are listed where engines look", nt: "Your pages are not listed where engines look",
      d: v => v.ok ? (v.declared ? "Declared in robots.txt." : "sitemap.xml served.")
        : v.served ? "That address answers, but it holds no URLs anything can follow — an empty list finds nothing."
        : "No list of your pages is published, so engines find only what they stumble into from links." },
    ssr: {
      so: "The page arrives nearly empty and fills in afterwards, and most AI crawlers only read what arrived.", t: "The words arrive with the page", nt: "The words do not arrive with the page",
      d: v => v.ok ? `${v.len} characters of text arrived with the page.`
        : `Only ${v.len} characters of text arrived with the page — the rest is filled in afterwards, in the visitor’s browser. Most engines read only what arrived, so they see an empty shell.` },
    title: {
      so: "The line engines repeat as your headline does not say what you do.", t: "The page's headline says what you do", nt: "The page's headline does not say what you do",
      d: v => !v.title ? "The page has no title line at all."
        : v.ok ? v.title
        : `"${v.title}" — too thin to identify anything. This is the line search results and shared links show as you.` },
    description: {
      so: "Engines write your summary for you, from whatever text they find first.", t: "A summary is written, not scraped", nt: "No summary is written, so one gets scraped",
      d: v => v.len === 0 ? "No summary is written for this page, so engines guess one from the body text." : `${v.len} characters.` },
    "description-length": {
      so: "Your summary is too thin to stand on its own when it appears without the page around it.", t: "The summary stands on its own", nt: "The summary cannot stand on its own",
      d: v => v.len === 0 ? "There is no summary to assess."
        : v.len < 50  ? `${v.len} characters — too thin to summarise the page.`
        : v.len > 320 ? `${v.len} characters — past the point where it reads as a summary.`
        : `${v.len} characters. An engine can use it whole.`
          + (v.len > 160 ? " Google will truncate the visible snippet at roughly 160, which costs nothing here." : "") },
    h1: {
      so: v => v.state === "many"
        ? "Several headings claim to be the subject, so an engine picks one of them for you."
        : "Nothing on the page claims to be its subject, so engines decide what it is about for you.",
      t: "One heading says what this page is",
      // The failing title states which failure this is. "No heading says what
      // this page is" printed over a page with four of them is a claim the
      // reader disproves in ten seconds, and then nothing else in the report
      // gets believed either.
      nt: v => v.state === "many"  ? `${v.n} headings each claim to be this page's subject`
             : v.state === "blank" ? "The main heading carries no words"
             :                       "No heading says what this page is",
      d: v => v.state === "ok"    ? `"${v.text}"`
        : v.state === "none"  ? "The page has no main heading, so nothing on it says what it is about."
        : v.state === "blank" ? "The main heading holds no words — it reads as a heading and names nothing."
        : `${v.n} main headings: ${v.all.map(t => t ? `"${t}"` : "(empty)").join(", ")}. An engine has to choose which one is the subject.` },
    "heading-order": {
      so: "The page skips levels, so anything reading it as an outline loses the thread.", t: "The outline runs in order", nt: "The outline runs out of order",
      d: v => v.skip ? `The headings jump from level ${v.skip.from} to level ${v.skip.to}, so the outline breaks there.` : "No skipped levels." },
    canonical: {
      so: "The same page lives at several addresses and its credit is divided between them.", t: "One address is the real one", nt: "No single address is the real one",
      d: v => !v.canonical ? "The page never states which address is the real one."
        : v.ok ? v.canonical
        : `"${v.canonical}" is not a full address. A pointer that resolves nowhere is worse than none: it points at nothing.` },
    alt: {
      so: "Images carry no description, so anything that cannot see them — engines included — misses that part of the page.", t: "Images are described for anything that cannot see", nt: "Images are not described for anything that cannot see",
      d: v => v.total === 0 ? "No images." : `${v.noAlt} of ${v.total} images carry no description.` },
    hreflang: {
      so: "Your language versions are not linked to each other, so engines can serve the wrong one.", t: "Your language versions point at each other", nt: "Your language versions do not point at each other",
      d: v => v.n ? `${v.n} language versions are linked to each other.` : "Single-language site — not applicable." },
    llms: {
      so: "There is no short summary written for AI assistants, which is the cheapest thing on this list to add.", t: "A short summary is written for AI assistants", nt: "No short summary is written for AI assistants",
      d: v => v.ok ? "Served." : "There is no llms.txt on your domain. A newer convention, not yet decisive, and the cheapest thing here to add." },
    footprint: {
      so: "The whole business lives at a handful of addresses, so there is no page for an engine to send anyone to.", t: "Enough of the business has its own address", nt: "Almost none of the business has its own address",
      d: v => v.n >= 12 ? `${v.n} addresses published. There is a page to cite.`
        : `${v.n} addresses published. A question about one service or one place lands on a page that also answers six others.` },
    families: {
      so: "One page is doing the work of many, so a question about one of them matches nothing in particular.", t: "You publish a page per thing, not one page for all of them", nt: "One page carries what should be several",
      d: v => v.n > 0 ? `${v.top} holds ${v.size} pages that each answer for one thing${v.n > 1 ? `, and ${v.n - 1} more groups do the same` : ""}.`
        : "No group of addresses covers one thing each — every service and every place shares a page." },
    people: {
      so: "Nobody is named anywhere an engine can reach, so answers about this business name the business and no one in it.", t: "A person is named at an address of their own", nt: "No page names a person",
      d: v => v.ok ? "A page exists for the people behind the business."
        : "No address names a person. Answers that would have quoted a founder quote nobody." },
    hsts: {
      so: "Every first visit takes an extra unprotected step before the secure connection starts.", t: "The encrypted page loads without a detour", nt: "The encrypted page loads through a detour",
      d: v => !v.hsts ? "Nothing tells a browser to go straight to the secure address, so a first visit starts unprotected."
        : v.ok ? v.hsts
        : `${v.hsts} — under six months. A browser that has not visited in a while starts on the unprotected address again.` },
  },

  es: {
    "ld-present": {
      so: "Nada en la página le dice a un asistente de IA qué negocio es este, así que adivina con el texto o te salta.", t: "La página dice qué negocio es este", nt: "Nada dice qué negocio es este",
      d: v => v.n === 0
        ? "Nada en esta página describe al negocio de una forma que una máquina lea sola — sin nombre, sin dirección, sin lista de lo que vendes, solo prosa. Nada más de esta sección se puede medir hasta que algo lo haga."
        : `${v.n} descripción(es) del negocio legibles por máquina.` },
    "ld-valid": {
      so: "El único bloque que describe tu negocio es ilegible para los motores, así que cuenta como si no existiera.", t: "La descripción del negocio se puede leer", nt: "La descripción del negocio no se puede leer",
      d: v => v.malformed === 0 ? "Todas se leen bien."
        : v.entityBug
          ? `${v.malformed} están mal escritas y ningún motor puede leerlas. Un carácter suelto (${v.entityBug}) se coló en el texto — la página se ve bien para una persona y en blanco para toda máquina.`
          : `${v.malformed} están mal escritas, así que todo motor las descarta sin avisarle a nadie.` },
    "ld-org": {
      so: "Nada declara que esto es una empresa, así que un asistente no tiene a quién atribuirle una recomendación.", t: "La página declara que esto es una empresa", nt: "Nada declara que esto es una empresa",
      d: v => v.type ? `Declarada como ${v.type}.`
        : "La descripción nunca dice que esto es una empresa, así que no hay a qué colgarle una recomendación." },
    "ld-name": {
      so: "Tu negocio no tiene un nombre que un motor pueda citar, así que no te puede recomendar por nombre.", t: "El negocio tiene un nombre que un motor puede citar", nt: "El negocio no tiene un nombre que un motor pueda citar",
      d: v => v.name ? `Se llama: ${v.name}` : "La descripción no lleva un nombre que un motor pueda citar." },
    "ld-address": {
      so: "Nada dice dónde operas, así que no apareces cuando alguien pide una firma en tu ciudad.", t: "La página dice dónde operas", nt: "La página nunca dice dónde operas",
      d: v => v.ok ? "Hay una dirección postal declarada."
        : "No hay una dirección donde una máquina la busca, así que una búsqueda por tu ciudad no llega a ti." },
    "ld-sameas": {
      so: "Nada conecta este sitio con tu LinkedIn ni con directorios, así que los motores te tratan como un desconocido y no como una empresa identificada.", t: "Estás enlazado a los perfiles que te identifican", nt: "Nada te enlaza a los perfiles que te identifican",
      d: v => v.n ? `${v.n} enlace(s) hacia tus otros perfiles.`
        : "Nada enlaza este sitio con tu LinkedIn ni con ningún directorio, así que los motores no distinguen este negocio de cualquier otro de nombre parecido." },
    "ld-services": {
      so: "Nada enumera lo que vendes, así que un asistente no puede emparejarte con quien lo está pidiendo.", t: "Lo que vendes está listado, no solo descrito", nt: "Lo que vendes no está listado en ninguna parte",
      d: v => v.catalog ? "Los servicios están listados."
        : "Nada lista lo que vendes. Una máquina solo puede recomendar lo que puede leer como lista." },
    "robots-exists": {
      so: "Falta el archivo que le dice a los crawlers qué pueden leer, así que cada uno decide por su cuenta.", t: "Tu sitio publica reglas sobre qué se puede leer", nt: "No se publica ninguna regla sobre qué se puede leer",
      d: v => v.ok ? "Servido."
        : v.served ? "Esa dirección responde, pero lo que vuelve no es robots.txt — no estás publicando ninguna regla."
        : "No hay robots.txt en tu dominio. No es fatal, pero no has publicado ninguna regla sobre qué se puede leer." },
    bot: {
      so: "A este crawler lo dejan fuera en la puerta, así que el asistente que alimenta no ve tu sitio.", t: v => `${v.ua} tiene permiso`, nt: v => `A ${v.ua} lo dejan fuera`,
      d: v => v.blocked
        ? `Tus propias reglas lo dejan fuera. ${v.label} no puede leer esta página — no queda más abajo, queda ausente.`
        : `Permitido. ${v.label} puede recuperar esta página.` },
    sitemap: {
      so: "Nada le entrega a los motores la lista de tus páginas, así que encuentran solo lo que se tropiezan.", t: "Tus páginas están listadas donde los motores buscan", nt: "Tus páginas no están listadas donde los motores buscan",
      d: v => v.ok ? (v.declared ? "Declarado en robots.txt." : "sitemap.xml servido.")
        : v.served ? "Esa dirección responde, pero no contiene ninguna URL que se pueda seguir — una lista vacía no encuentra nada."
        : "No hay una lista publicada de tus páginas, así que los motores solo encuentran lo que se tropiezan desde un enlace." },
    ssr: {
      so: "La página llega casi vacía y se completa después, y la mayoría de los crawlers de IA solo leen lo que llegó.", t: "Las palabras llegan con la página", nt: "Las palabras no llegan con la página",
      d: v => v.ok ? `${v.len} caracteres de texto llegaron con la página.`
        : `Solo ${v.len} caracteres de texto llegaron con la página — el resto se completa después, en el navegador de quien la abre. La mayoría de los motores solo leen lo que llegó, así que ven un cascarón vacío.` },
    title: {
      so: "La línea que los motores repiten como tu titular no dice a qué te dedicas.", t: "El titular de la página dice a qué te dedicas", nt: "El titular de la página no dice a qué te dedicas",
      d: v => !v.title ? "La página no tiene línea de título."
        : v.ok ? v.title
        : `"${v.title}" — demasiado corto para identificar nada. Es la línea que muestran los resultados de búsqueda y los enlaces compartidos.` },
    description: {
      so: "Los motores arman tu resumen por ti, con el primer texto que encuentran.", t: "Hay un resumen escrito, no recogido", nt: "No hay resumen escrito, así que se recoge uno",
      d: v => v.len === 0 ? "Nadie escribió un resumen para esta página, así que los motores lo adivinan del texto." : `${v.len} caracteres.` },
    "description-length": {
      so: "Tu resumen es demasiado corto para sostenerse solo cuando aparece sin la página alrededor.", t: "El resumen se sostiene solo", nt: "El resumen no se sostiene solo",
      d: v => v.len === 0 ? "No hay resumen que evaluar."
        : v.len < 50  ? `${v.len} caracteres — demasiado delgada para resumir la página.`
        : v.len > 320 ? `${v.len} caracteres — pasada del punto en que se lee como un resumen.`
        : `${v.len} caracteres. Un motor la puede usar entera.`
          + (v.len > 160 ? " Google va a truncar el fragmento visible cerca de los 160, y eso aquí no cuesta nada." : "") },
    h1: {
      so: v => v.state === "many"
        ? "Varios encabezados dicen ser el tema, así que el motor elige uno por ti."
        : "Nada en la página declara ser su tema, así que los motores deciden por ti de qué trata.",
      t: "Un encabezado dice de qué trata esta página",
      nt: v => v.state === "many"  ? `${v.n} encabezados dicen ser el tema de esta página`
             : v.state === "blank" ? "El encabezado principal no lleva palabras"
             :                       "Ningún encabezado dice de qué trata esta página",
      d: v => v.state === "ok"    ? `"${v.text}"`
        : v.state === "none"  ? "La página no tiene encabezado principal, así que nada en ella dice de qué trata."
        : v.state === "blank" ? "El encabezado principal no lleva palabras — se lee como encabezado y no nombra nada."
        : `${v.n} encabezados principales: ${v.all.map(t => t ? `"${t}"` : "(vacío)").join(", ")}. El motor tiene que elegir cuál es el tema.` },
    "heading-order": {
      so: "La página se salta niveles, así que lo que la lee como esquema pierde el hilo.", t: "El esquema va en su orden", nt: "El esquema va fuera de orden",
      d: v => v.skip ? `Los encabezados saltan del nivel ${v.skip.from} al ${v.skip.to}, así que el esquema se rompe ahí.` : "No hay niveles saltados." },
    canonical: {
      so: "La misma página vive en varias direcciones y su crédito se reparte entre ellas.", t: "Una dirección es la verdadera de todas", nt: "Ninguna dirección es la verdadera de todas",
      d: v => !v.canonical ? "La página nunca dice cuál de sus direcciones es la verdadera."
        : v.ok ? v.canonical
        : `"${v.canonical}" no es una dirección completa. Un puntero que no resuelve es peor que ninguno: apunta a la nada.` },
    alt: {
      so: "Las imágenes no llevan descripción, así que todo lo que no puede verlas — motores incluidos — se pierde esa parte.", t: "Las imágenes están descritas para quien no las ve", nt: "Las imágenes no están descritas para quien no las ve",
      d: v => v.total === 0 ? "No hay imágenes." : `${v.noAlt} de ${v.total} imágenes no llevan descripción.` },
    hreflang: {
      so: "Tus versiones por idioma no están enlazadas entre sí, así que los motores pueden servir la equivocada.", t: "Tus versiones por idioma se apuntan entre sí", nt: "Tus versiones por idioma no se apuntan entre sí",
      d: v => v.n ? `${v.n} versiones por idioma enlazadas entre sí.` : "Sitio de un solo idioma — no aplica." },
    llms: {
      so: "No hay un resumen corto escrito para asistentes de IA, que es lo más barato de agregar de esta lista.", t: "Hay un resumen corto escrito para asistentes de IA", nt: "No hay resumen corto escrito para asistentes de IA",
      d: v => v.ok ? "Servido." : "No hay llms.txt en tu dominio. Convención nueva, todavía no decisiva, y lo más barato de agregar de esta lista." },
    footprint: {
      so: "Todo el negocio vive en un puñado de direcciones, así que no hay página a la que un motor pueda mandar a nadie.", t: "Suficiente del negocio tiene dirección propia", nt: "Casi nada del negocio tiene dirección propia",
      d: v => v.n >= 12 ? `${v.n} direcciones publicadas. Hay página que citar.`
        : `${v.n} direcciones publicadas. Una pregunta por un servicio o un lugar cae en una página que contesta otras seis.` },
    families: {
      so: "Una sola página hace el trabajo de muchas, así que una pregunta por una de ellas no coincide con nada en particular.", t: "Publicas una página por cosa, no una para todas", nt: "Una sola página carga con lo que deberían ser varias",
      d: v => v.n > 0 ? `${v.top} tiene ${v.size} páginas que contestan por una cosa cada una${v.n > 1 ? `, y ${v.n - 1} grupos más hacen lo mismo` : ""}.`
        : "Ningún grupo de direcciones cubre una cosa cada una — cada servicio y cada lugar comparten página." },
    people: {
      so: "Nadie está nombrado donde un motor pueda alcanzarlo, así que las respuestas nombran al negocio y a nadie dentro.", t: "Hay una persona nombrada en su propia dirección", nt: "Ninguna página nombra a una persona",
      d: v => v.ok ? "Existe una página para las personas detrás del negocio."
        : "Ninguna dirección nombra a una persona. Las respuestas que habrían citado a un fundador no citan a nadie." },
    hsts: {
      so: "Cada primera visita da un paso extra sin protección antes de que arranque la conexión segura.", t: "La página cifrada carga sin ningún desvío", nt: "La página cifrada carga con un desvío",
      d: v => !v.hsts ? "Nada le dice al navegador que vaya directo a la dirección segura, así que la primera visita empieza sin protección."
        : v.ok ? v.hsts
        : `${v.hsts} — bajo seis meses. Un navegador que no te visita hace rato vuelve a empezar por la dirección sin proteger.` },
  },
};

/* ── The checks ─────────────────────────────────────────────────────── */
/* Two reports out of one pass, and the split is the whole point. Structure and
   entity markup are things that are TRUE ABOUT THE MARKUP; they are reported
   plainly and priced at nothing, because the case this split came from was a
   site failing every one of them while ranking first in two languages and
   being quoted back with five of its own URLs. Charging a grade for them said
   something false. Access, retrieval and footprint are what decides whether a
   machine can reach the site, read it, and find a page that answers one
   question — those carry the grade. */
const REPORT_A = new Set(["entity", "structure"]);

function runChecks(ctx) {
  const c = [];
  const L = STR[ctx.lang === "es" ? "es" : "en"];

  // key defaults to id; the per-crawler checks share one "bot" entry because
  // their ids are dynamic (`bot-GPTBot`).
  const resolve = (x, v) => (typeof x === "function" ? x(v) : x);
  const add = (id, group, pass, weight, vars, key) => {
    const s = L[key || id] || STR.en[key || id];
    const v = vars || {};
    const report = REPORT_A.has(group) ? "a" : "b";
    const row = {
      id, group, report,
      pass,
      // What this check was worth, on the row, so the pool a score was computed
      // against can be added up from the report itself rather than taken on
      // trust. A prospect asking "16 of 20 passed, why is that a 25?" gets to
      // check the arithmetic instead of being told the weighting is severe.
      weight: report === "a" ? 0 : weight,
      // An observation costs nothing. It is a fact about the markup, not a
      // charge against the site.
      deduction: report === "a" || pass ? 0 : weight,
      // A title names what the check PREVENTS, so under a red mark it reads as
      // good news — "One heading says what this page is" next to a cross tells
      // a reader nothing about which way it went. A failing check states the
      // failure instead, and `t` stays the passing form.
      title:  resolve(!pass && s.nt ? s.nt : s.t, v),
      detail: s.d(v),
    };
    // One plain sentence about what this costs the business, carried only on
    // failures because that is the only place it is read: the report goes to
    // the client, and the client discusses the gaps. `detail` stays technical
    // for whoever has to fix it; `so` is what the two of them talk about.
    if (!pass && report === "b" && s.so) row.so = resolve(s.so, v);
    c.push(row);
  };

  const { doc, robots, sitemap, llms, headers } = ctx;

  /* — Entity layer — */
  const blocks = doc.jsonld;
  let parsed = [], malformed = 0, entityBug = null;
  for (const b of blocks) {
    try { parsed.push(JSON.parse(b)); }
    catch (e) {
      malformed++;
      if (/&[a-zA-Z]+;|&#\d+;/.test(b)) entityBug = (b.match(/&[a-zA-Z]+;|&#\d+;/) || [])[0];
    }
  }
  const nodes = parsed.flatMap(d => d["@graph"] || [d]);
  const typeOf = n => [].concat(n["@type"] || []).join(",");
  const org = nodes.find(n => /Organization|LocalBusiness|Corporation|ProfessionalService/.test(typeOf(n)));

  // One fact, one price. If there is no structured data at all, the six
  // dependent property checks would each fire too — charging ~95 points for a
  // single root cause and printing seven separate accusations for one problem.
  // Price the absence once, and skip what cannot be inspected.
  if (blocks.length === 0) {
    add("ld-present", "entity", false, 40, { n: 0 });
  } else {
    add("ld-present", "entity", true, 40, { n: blocks.length });
    add("ld-valid", "entity", malformed === 0, 25, { malformed, entityBug });
    add("ld-org", "entity", !!org, 15, { type: org ? typeOf(org) : null });

    // The property checks only mean something once an entity exists to carry them.
    if (org) {
      add("ld-name", "entity", !!org.name, 5, { name: org.name });
      add("ld-address", "entity", !!org.address, 5, { ok: !!org.address });
      const sameAs = [].concat(org.sameAs || []);
      add("ld-sameas", "entity", sameAs.length > 0, 10, { n: sameAs.length });
      const catalog = !!(org.hasOfferCatalog || org.makesOffer);
      add("ld-services", "entity",
          catalog || nodes.some(n => /Service|Product/.test(typeOf(n))), 5, { catalog });
    }
  }

  /* — Crawler access — */
  add("robots-exists", "access", robots.ok, 5, { ok: robots.ok, served: robots.served });

  for (const bot of AI_CRAWLERS) {
    const blocked = robots.ok && blocksAgent(robots.groups, bot.ua, ctx.path);
    add(`bot-${bot.ua}`, "access", !blocked, bot.weight,
        { ua: bot.ua, label: ctx.lang === "es" ? bot.labelEs : bot.label, blocked },
        "bot");
  }

  add("sitemap", "access", sitemap.ok, 5,
      { ok: sitemap.ok, served: sitemap.served, declared: sitemap.declared });

  /* — Footprint: how much of the business has an address of its own —
     Read entirely from the sitemap the site already publishes. These three
     are the shapes that got a Panama studio quoted back with five of its own
     URLs while it failed every markup check this instrument used to score.
     Each is n/a rather than a failure when the sitemap could not be read: a
     site whose shape cannot be seen has not been shown to have a bad one. */
  const shape = ctx.shape || { locs: [], families: [], person: false, seen: false };
  if (shape.seen) {
    // Being cited requires a page to cite. One page cannot be the answer to
    // eight questions, and the sites that get quoted have an address per
    // answer. 12 — below the retrieval essentials, above the tidiness checks.
    add("footprint", "footprint", shape.locs.length >= 12, 12,
        { n: shape.locs.length });

    // One address per thing, rather than one page listing them all.
    const top = shape.families[0] || null;
    add("families", "footprint", shape.families.length > 0, 10,
        { n: shape.families.length, top: top && top.parent, size: top && top.n });

    // An engine names a person when the site gives it one to name.
    add("people", "footprint", shape.person, 8, { ok: shape.person });
  }

  /* — Retrievability — */
  const ssrOk = doc.textLen >= 500;
  add("ssr", "retrieval", ssrOk, 25, { ok: ssrOk, len: doc.textLen });

  // A title is the label an engine repeats when it names the business. "Home"
  // is a title element and identifies nothing, so presence is not the test.
  const title = doc.title.trim();
  const titleOk = titleNames(doc);
  add("title", "retrieval", titleOk, 5, { title, ok: titleOk });

  // A description is judged on whether a retrieval engine can use it, not on
  // whether Google truncates its display. 160 is a SERP rendering limit; the
  // crawler ingests the whole string either way, so charging retrieval points
  // for exceeding it measures the wrong thing. Penalise absent, uselessly
  // thin, or so long it has stopped being a summary.
  const dlen = doc.description.trim().length;
  add("description", "retrieval", descPresent(doc), 5, { len: dlen });
  add("description-length", "retrieval", descUsable(doc), 3, { len: dlen });

  // 25, the same as the content being there and the entity parsing. A page
  // with no H1 makes no claim about its own subject, so a retriever that can
  // read every word still cannot say what the page is for. Priced with the
  // things that decide whether the page is legible at all, not with the
  // things that make a legible page tidier.
  add("h1", "structure", hasOneH1(doc), 25,
      { n: doc.h1.length, state: h1State(doc),
        text: doc.h1.length ? doc.h1[0].text.trim().slice(0, 60) : "",
        all: doc.h1.map(h => h.text.replace(/\s+/g, " ").trim().slice(0, 40)) });

  const skip = headingSkip(doc);
  add("heading-order", "structure", !skip, 5, { skip });

  // Google resolves a relative canonical, but it is a declaration about
  // identity and half the crawlers that matter here take it literally.
  const canonOk = canonicalAbs(doc);
  add("canonical", "retrieval", canonOk, 5, { canonical: doc.canonical, ok: canonOk });

  add("alt", "structure", doc.imgTotal === 0 || doc.imgNoAlt === 0, 5,
      { total: doc.imgTotal, noAlt: doc.imgNoAlt });

  add("hreflang", "retrieval", doc.hreflang.length === 0 || doc.hreflang.length >= 2, 3,
      { n: doc.hreflang.length });

  add("llms", "retrieval", llms.ok, 3, { ok: llms.ok });

  // Same six-month floor the security instrument uses. Two instruments that
  // disagree about the same header teach a prospect not to trust either.
  const hstsAge = Number((/max-age\s*=\s*"?(\d+)/i.exec(headers.hsts || "") || [])[1] || 0);
  const hstsOk = hstsAge >= HSTS_MIN_AGE;
  add("hsts", "retrieval", hstsOk, 2, { hsts: headers.hsts, ok: hstsOk });

  return c;
}

// The ordinary school scale, because that is the one every reader already has
// in their head: A from 90, B from 80, C from 70, D from 60, F below. The old
// curve stretched the top — it called 65 a B- and 70 a B — so a page could read
// "B" while failing a third of what was measured. A grade that flatters is
// worth nothing to a prospect who is about to check the same headers elsewhere.
//
// It also lines up with the bar. Both instruments are held to 90, which is
// exactly where A- begins, so clearing the bar and earning an A are the same
// event rather than two numbers that need reconciling.
function grade(score) {
  const bands = [[97,"A+"],[93,"A"],[90,"A-"],[87,"B+"],[83,"B"],[80,"B-"],
                 [77,"C+"],[73,"C"],[70,"C-"],[67,"D+"],[63,"D"],[60,"D-"],[0,"F"]];
  return (bands.find(([min]) => score >= min) || [0,"F"])[1];
}

/* ── What a site publishes about its own shape ────────────────────────
   Everything below reads ONE file the site already publishes: its sitemap. No
   search API is called, no index count is fetched, no engine is asked what it
   thinks. Those need keys this instrument does not have, and inventing their
   answers would be the invented statistic every page here promises not to
   carry.

   What a sitemap does show is SHAPE, and shape is what the case this check set
   came from turned on. A studio that ranks first in two languages and gets
   quoted back with five of its own URLs was failing every hygiene signal this
   scanner used to measure. What it had instead: a page per zone it serves, a
   page per project with the thing and the place in the address, a named human,
   and enough addresses to be worth paginating. None of that was measured. All
   of it is measurable from here, for nothing.                              */

// <loc> only, absolute http(s), deduplicated, capped so one enormous sitemap
// cannot turn a scan into a parse. A sitemap index yields its child sitemaps,
// which is one hop from the URLs and counts as a footprint either way.
const MAX_LOCS = 5000;
function sitemapLocs(xml) {
  const out = [];
  const seen = new Set();
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(String(xml || ""))) && out.length < MAX_LOCS) {
    const raw = m[1].replace(/&amp;/g, "&").trim();
    if (!/^https?:\/\//i.test(raw)) continue;
    let path;
    try { path = new URL(raw).pathname; } catch { continue; }
    const key = path.replace(/\/+$/, "") || "/";
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

const slugWords = seg => String(seg || "").split(/[-_]/).filter(w => /[a-zà-ÿ]/i.test(w));

/* A family is several addresses under one parent that differ only in their
   last segment — /zonas/<zone>, /project/<project>, /services/<service>. It is
   the difference between one page that mentions eight neighbourhoods and eight
   pages that each answer for one, and a query naming a neighbourhood matches
   the second. Three is the floor: two pages under a parent is a coincidence.

   No industry is read here and none is needed. The check does not know what a
   zone is; it knows that a site either publishes one address per thing or it
   does not. */
const FAMILY_MIN = 3;
function urlFamilies(paths) {
  const byParent = new Map();
  for (const p of paths) {
    const segs = p.split("/").filter(Boolean);
    if (segs.length < 2) continue;
    const parent = "/" + segs.slice(0, -1).join("/");
    const leaf = segs[segs.length - 1];
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(leaf);
  }
  const families = [];
  for (const [parent, leaves] of byParent) {
    // A language prefix is not a family: /es/... and /en/... are the same site
    // twice, and counting them would credit a translation as coverage.
    if (/^\/(?:es|en|pt|fr|de|it)$/i.test(parent)) continue;
    if (leaves.length < FAMILY_MIN) continue;
    // Leaves have to name something. Ten pages at /p/1 … /p/10 are a family
    // whose addresses say nothing, which is the opposite of the finding.
    const named = leaves.filter(l => slugWords(l).length >= 2);
    if (named.length < FAMILY_MIN) continue;
    families.push({ parent, n: named.length });
  }
  return families.sort((a, b) => b.n - a.n);
}

/* Does any address name a person's page? An answer engine names people when
   the site gives it one to name — that is how the founder surfaced in the case
   behind this check. Matching the ADDRESS, not the prose, keeps it honest:
   this is a fact about what the site publishes, not a guess about its staff. */
const PEOPLE_PATH = /(^|\/)(team|equipo|our-team|nuestro-equipo|about-us|sobre-nosotros|quienes-somos|people|staff|founder|fundador|leadership|bio|about|nosotros)(\/|$)/i;
const namesAPerson = paths => paths.some(p => PEOPLE_PATH.test(p));

/* ── A scanner has to be able to say "I could not read this" ──────────
   This reader does not run scripts. A site that renders in the browser hands
   it a shell: no H1, no alt text, no entity markup, no outline — and every one
   of those is then reported as a fault of the site rather than a limit of the
   reader. The failure signature is indistinguishable from a genuinely empty
   page, which is exactly why it has to be caught before anything is scored.

   The test is the RATIO, not the text length on its own. A deliberately terse
   page that ships 400 characters in 3 KB of HTML is a real page and gets
   scored. Forty kilobytes of markup carrying 200 characters is a hydration
   shell. Both numbers travel in the error so the reader can check the claim.
   Halting is the honest outcome: no score at all beats a fabricated F. */
const SHELL_MIN_TEXT  = 240;    // below this there is nothing to measure
const SHELL_MIN_BYTES = 8000;   // ...and this much markup means it is not a small page
function looksUnrendered(html, doc) {
  return doc.textLen < SHELL_MIN_TEXT
      && html.length >= SHELL_MIN_BYTES
      && /<script[\s>]/i.test(html);
}

async function scan(target, lang) {
  const E = errs(lang);
  const origin = target.origin;
  const [page, robotsRes, sitemapRes, llmsRes] = await Promise.allSettled([
    fetchCapped(target.href),
    fetchCapped(`${origin}/robots.txt`),
    fetchCapped(`${origin}/sitemap.xml`),
    fetchCapped(`${origin}/llms.txt`),
  ]);

  if (page.status !== "fulfilled")
    return { error: E.fetch(page.reason?.message || E.failed) };
  if (!page.value.res.ok)
    return { error: E.http(page.value.res.status) };

  const ct = page.value.res.headers.get("content-type") || "";
  if (!/text\/html/i.test(ct))
    return { error: E.notHtml(ct) };

  const doc = await extractHtml(page.value.body);

  // Before anything is scored: did we actually receive the page?
  if (looksUnrendered(page.value.body, doc))
    return { error: E.shell(page.value.body.length, doc.textLen) };

  // A host that answers 200 with its HTML 404 page for every unknown path is
  // the common case, not the exception. Checking the status alone credits a
  // site for files it does not have.
  const robotsServed = robotsRes.status === "fulfilled" && robotsRes.value.res.ok;
  const robotsBody = robotsServed ? robotsRes.value.body : null;
  const robotsReal = !!robotsBody && /^\s*user-agent\s*:/im.test(robotsBody) && !/<html/i.test(robotsBody.slice(0, 200));
  const robotsTxt = robotsReal ? robotsBody : null;
  const robots = { ok: robotsReal, served: robotsServed,
                   groups: robotsTxt ? parseRobots(robotsTxt) : [],
                   declaresSitemap: !!robotsTxt && /sitemap:/i.test(robotsTxt) };

  const sitemapServed = sitemapRes.status === "fulfilled" && sitemapRes.value.res.ok;
  const sitemapBody = sitemapServed ? sitemapRes.value.body : "";
  // A sitemap with no <loc> discovers nothing. A sitemap index counts: it is
  // one hop from the URLs. A sitemap declared in robots.txt but living
  // elsewhere is legitimate and is not a finding — this only fetches /sitemap.xml.
  const sitemapReal = /<loc\b/i.test(sitemapBody) || /<sitemapindex\b/i.test(sitemapBody);
  const sitemap = { ok: sitemapReal || robots.declaresSitemap,
                    served: sitemapServed, declared: !sitemapReal && robots.declaresSitemap };
  const llms    = { ok: llmsRes.status === "fulfilled" && llmsRes.value.res.ok
                        && !/<html/i.test(llmsRes.value.body.slice(0, 200)) };
  const headers = { hsts: page.value.res.headers.get("strict-transport-security") };

  // What the site says about its own shape. Only read when a real sitemap came
  // back: a site whose shape could not be seen has not been shown to have a
  // bad one, so the three footprint checks leave the pool entirely.
  const locs = sitemapReal ? sitemapLocs(sitemapBody) : [];
  const shape = { seen: sitemapReal, locs,
                  families: urlFamilies(locs), person: namesAPerson(locs) };

  const all = runChecks({ doc, robots, sitemap, llms, headers, shape,
                          path: target.pathname, lang });
  const checks = all.filter(c => c.report === "b");
  const observations = all.filter(c => c.report === "a")
    .map(({ id, group, pass, title, detail }) => ({ id, group, pass, title, detail }));

  /* Report B is normalised to the checks that actually ran, which the old
     subtract-from-100 model could not do: a check that could not be measured
     has to leave the pool rather than count as a pass or a failure. A site with
     no readable sitemap is not thereby a site with no footprint. Report A has
     no score of any kind — that is the point of it. */
  const pool     = checks.reduce((n, c) => n + c.weight, 0);
  const deducted = checks.reduce((n, c) => n + c.deduction, 0);
  const score    = pool > 0 ? Math.max(0, Math.round(100 * (pool - deducted) / pool)) : 0;

  return {
    url: target.href,
    lang: lang === "es" ? "es" : "en",
    scannedAt: new Date().toISOString(),
    score, grade: grade(score),
    // The pool the score was computed against, published rather than implied.
    pool, deducted,
    passed: checks.filter(c => c.pass).length,
    total: checks.length,
    // What the reader actually received, so any score in this report can be
    // reproduced and argued with. NOT the page itself: storing the HTML of
    // every scanned site would make "scan results are not stored" false on
    // /subprocessors and on the badge over the instruments, and two numbers
    // are enough to tell a real page from a shell.
    fetched: { bytes: page.value.body.length, textLen: doc.textLen },
    checks,
    // Report A. No score, no letter, no consequence claimed for any of it.
    observations,
  };
}

/* ── Security headers, in the words of someone who has to pay for it ──
   The same shape runChecks returns, so the client renders it with no idea
   these are headers rather than markup. Weights are modelled on the relative
   severity Mozilla Observatory assigns — this is not Observatory and does not
   claim its score, it borrows the grade bands and the ordering of harm. */
const HDR = {
  en: {
    groups: { transport: "The connection", content: "What can run on the page", privacy: "What leaks out",
              page: "What the page says it is", indexing: "Whether it can be found at all" },
    noindex:     {
      so: "Your page is asking search engines to leave it out, so someone looking for you by name may never reach it.", t: "The page is allowed into the index", nt: "The page is kept out of the index",
                   ok: "Indexable.",
                   no: "Something on this page tells search engines to skip it — so none list it." },
    mixed:       {
      so: "The browser blocks part of the page and warns the visitor, so something does not load and nobody is told why.", t: "The padlock is not undone by the page itself", nt: "The page undoes its own padlock",
                   ok: "All subresources load over HTTPS.",
                   no: v => v === 1 ? "1 file on the page arrives unprotected — the browser blocks it and warns."
                                    : v + " files on the page arrive unprotected — the browser blocks them and warns." },
    lang:        {
      so: "Translation tools and screen readers have to guess what language this is, and they sometimes guess wrong.", t: "The page declares what language it is in", nt: "The page does not declare what language it is in",
                   ok: v => "Declared: " + v,
                   no: "The page never says which language it is written in — everything guesses." },
    title:       {
      so: "This is the line that shows in search results and when someone shares your link, and it does not say who you are.", t: "The page names the business, not the file", nt: "The page names the file, not the business",
                   ok: v => "“" + v.slice(0, 60) + "”",
                   no: "Too short to name anyone — this is the line search results show as you." },
    description: {
      so: "Search engines write your summary for you, from whatever sentence they happen to find first.", t: "The summary is written, not scraped", nt: "The summary gets scraped, not written",
                   ok: v => "Present, " + v + " characters.",
                   no: "No summary is written for this page — the engine invents one from the text." },
    canonical:   {
      so: "The same page exists at several addresses and search engines split its credit between them, so none ranks as well as one would.", t: "One address is the real one", nt: "No address is marked as the real one",
                   ok: "Absolute canonical declared.",
                   no: "The page never names its real address — copies of it compete with it." },
    https:       {
      so: "Browsers put a Not Secure warning next to your address before a buyer has read a word.", t: "Buyers see a padlock, not a warning", nt: "Buyers see a warning, not a padlock",
                   ok: "Served over HTTPS.",
                   no: "The page travels unencrypted — browsers label it Not Secure on arrival." },
    hsts:        {
      so: "Every first visit takes an extra unprotected step before the secure connection starts.", t: "The encrypted page loads without a detour", nt: "The encrypted page loads through a detour",
                   ok: v => "Set. " + v,
                   no: "Every first visit starts unprotected and is redirected — a wasted hop." },
    csp:         {
      so: "If anyone gets a script onto your page, it can read what visitors type into your forms.", t: "Only your own scripts can run, and cost time", nt: "Anyone's script can run on your page",
                   ok: "Set.",
                   no: "Nothing limits which code may run here — anything slipped in runs too." },
    frame:       {
      so: "Someone can load your site inside their own page and pass your work off as theirs.", t: "Your brand cannot be reskinned by someone else", nt: "Your brand can be reskinned by someone else",
                   ok: "Framing restricted.",
                   no: "Nothing stops another site from showing your pages inside its own — as theirs." },
    nosniff:     {
      so: "Where your site serves files someone else uploaded, the browser decides for itself what they are.", t: "A mislabelled file cannot run as code", nt: "A mislabelled file can run as code",
                   ok: "Set.",
                   no: "A file with the wrong label can run as code here — one upload is enough." },
    referrer:    {
      so: "How much of your address travels with an outbound click is left to each browser's default rather than set by you.", t: "You decide what travels with an outbound click", nt: "The browser decides what travels with an outbound click",
                   ok: v => "Set. " + v,
                   no: "Every outbound click hands the other site your exact page — address and all." },
    permissions: {
      so: "Nothing limits which embedded third party may ask a visitor for their camera, microphone or location.", t: "Embedded third parties cannot prompt in your name", nt: "Any embedded third party can prompt in your name",
                   ok: "Set.",
                   no: "Anything on the page can ask visitors for camera or mic — in your name." },
    // Present-but-useless is its own verdict. A header that exists and does not
    // hold reads as a pass on a presence test and is why most sites score well
    // on one; it is not a pass here.
    weak: {
      hsts:        "It expires too soon — a browser forgets it between visits and starts over.",
      csp:         "The limit on what can run has a hole — anything slipped in runs anyway.",
      frame:       "The rule against being shown elsewhere is one browsers ignore — it does nothing.",
      referrer:    "The rule still leaks — your full page address goes out to other sites.",
      permissions: "The rule restricts nothing — anything can still ask in your domain's name.",
      description: "The summary is unusable — too thin to say anything, or too long to be one.",
      canonical:   "It names another domain as the real one — this page hands its standing over.",
    },
  },
  es: {
    groups: { transport: "La conexión", content: "Qué puede ejecutarse en la página", privacy: "Qué se filtra",
              page: "Qué dice la página que es", indexing: "Si se puede encontrar siquiera" },
    noindex:     {
      so: "Tu página le está pidiendo a los buscadores que la dejen fuera, así que quien te busque por nombre puede no llegar nunca.", t: "La página tiene permiso de entrar al índice", nt: "La página queda fuera del índice",
                   ok: "Indexable.",
                   no: "Algo en esta página le dice a los buscadores que la salten — nadie la lista." },
    mixed:       {
      so: "El navegador bloquea parte de la página y le avisa al visitante, así que algo no carga y nadie sabe por qué.", t: "La propia página no deshace el candado", nt: "La propia página deshace el candado",
                   ok: "Todos los subrecursos cargan por HTTPS.",
                   no: v => v === 1 ? "1 archivo de la página llega sin protección — el navegador lo bloquea."
                                    : v + " archivos de la página llegan sin protección — el navegador los bloquea." },
    lang:        {
      so: "Los traductores y lectores de pantalla tienen que adivinar en qué idioma está esto, y a veces se equivocan.", t: "La página declara en qué idioma está", nt: "La página no declara en qué idioma está",
                   ok: v => "Declarado: " + v,
                   no: "La página nunca dice en qué idioma está — todo lo que la lee lo adivina." },
    title:       {
      so: "Es la línea que aparece en los resultados y cuando alguien comparte tu enlace, y no dice quién eres.", t: "La página nombra al negocio, no al archivo", nt: "La página nombra al archivo, no al negocio",
                   ok: v => "“" + v.slice(0, 60) + "”",
                   no: "Muy corta para nombrar a nadie — es la línea que los buscadores muestran." },
    description: {
      so: "Los buscadores escriben tu resumen por ti, con la primera frase que encuentren.", t: "El resumen está escrito, no recogido", nt: "El resumen se recoge, no está escrito",
                   ok: v => "Presente, " + v + " caracteres.",
                   no: "Nadie escribió un resumen para esta página — el motor lo inventa del texto." },
    canonical:   {
      so: "La misma página existe en varias direcciones y los buscadores reparten su crédito entre ellas, así que ninguna posiciona como lo haría una sola.", t: "Una dirección es la verdadera", nt: "Ninguna dirección está marcada como la verdadera",
                   ok: "Canónica absoluta declarada.",
                   no: "La página nunca dice cuál es su dirección real — sus copias le compiten." },
    https:       {
      so: "El navegador pone un aviso de No seguro junto a tu dirección antes de que un comprador lea una palabra.", t: "El comprador ve un candado, no una advertencia", nt: "El comprador ve una advertencia, no un candado",
                   ok: "Servido por HTTPS.",
                   no: "La página viaja sin cifrar — el navegador la marca No seguro al abrirla." },
    hsts:        {
      so: "Cada primera visita da un paso extra sin protección antes de que arranque la conexión segura.", t: "La página cifrada carga sin desvío", nt: "La página cifrada carga con un desvío",
                   ok: v => "Configurado. " + v,
                   no: "Cada primera visita empieza sin protección y se redirige — un salto perdido." },
    csp:         {
      so: "Si alguien logra meter un script en tu página, puede leer lo que los visitantes escriben en tus formularios.", t: "Solo corren tus scripts, y solo ellos cuestan tiempo", nt: "Cualquier script puede correr en tu página",
                   ok: "Configurado.",
                   no: "Nada limita qué código puede correr aquí — lo que se cuele corre también." },
    frame:       {
      so: "Cualquiera puede cargar tu sitio dentro de su propia página y presentar tu trabajo como suyo.", t: "Tu marca no puede ser revestida por otro", nt: "Tu marca puede ser revestida por otro",
                   ok: "Enmarcado restringido.",
                   no: "Nada impide que otro sitio muestre tus páginas dentro del suyo — como suyas." },
    nosniff:     {
      so: "Donde tu sitio sirve archivos que subió otra persona, el navegador decide por su cuenta qué son.", t: "Un archivo mal etiquetado no corre como código", nt: "Un archivo mal etiquetado puede correr como código",
                   ok: "Configurado.",
                   no: "Un archivo mal etiquetado puede correr como código — basta una subida." },
    referrer:    {
      so: "Cuánta de tu dirección viaja con un clic saliente lo decide el navegador por defecto y no lo fijas tú.", t: "Tú decides qué viaja con un clic saliente", nt: "El navegador decide qué viaja con un clic saliente",
                   ok: v => "Configurado. " + v,
                   no: "Cada clic saliente le entrega al otro sitio tu página exacta — completa." },
    permissions: {
      so: "Nada limita qué tercero incrustado puede pedirle cámara, micrófono o ubicación a un visitante.", t: "Ningún tercero incrustado pide permisos en tu nombre", nt: "Cualquier tercero incrustado puede pedir permisos en tu nombre",
                   ok: "Configurado.",
                   no: "Cualquier cosa en la página puede pedir cámara o micrófono — en tu nombre." },
    weak: {
      hsts:        "Vence demasiado pronto — el navegador lo olvida entre visita y visita.",
      csp:         "El límite de lo que puede correr tiene un hueco — lo inyectado corre igual.",
      frame:       "La regla contra mostrarte en otro lado es una que el navegador ignora — nada hace.",
      referrer:    "La regla igual filtra — tu dirección completa sale hacia otros sitios.",
      permissions: "La regla no restringe nada — cualquiera puede seguir pidiendo en tu nombre.",
      description: "El resumen es inservible — muy delgado para decir algo, o muy largo para serlo.",
      canonical:   "Nombra a otro dominio como el real — esta página le entrega su propio peso.",
    },
  },
};

// Six months. Below it a browser that has not seen the site in a while goes
// back to trying the unencrypted address, which is the whole thing HSTS exists
// to stop. Same floor Observatory uses.
const HSTS_MIN_AGE = 15552000;

// A referrer policy either stops the full URL leaving the origin or it does
// not. These are the values that do; everything else — unsafe-url,
// no-referrer-when-downgrade, origin-when-cross-origin — still sends the path.
const SAFE_REFERRER = new Set([
  "no-referrer", "same-origin", "strict-origin", "strict-origin-when-cross-origin",
]);

function cspDirective(csp, name) {
  for (const part of String(csp).split(";")) {
    const t = part.trim();
    if (!t) continue;
    const sp = t.indexOf(" ");
    const dir = (sp === -1 ? t : t.slice(0, sp)).toLowerCase();
    if (dir === name) return sp === -1 ? "" : t.slice(sp + 1).trim();
  }
  return null;
}

// A CSP that permits arbitrary inline script does not stop an injected one.
// 'unsafe-inline' ALONGSIDE a nonce or hash is not that: modern browsers ignore
// it there, and it is the correct fallback for old ones. Flagging that would be
// inventing a finding, which is the one thing this instrument must never do.
function cspStopsInlineScript(csp) {
  const src = cspDirective(csp, "script-src") ?? cspDirective(csp, "default-src");
  if (src === null || src === "") return false;         // nothing constrains script at all
  const v = src.toLowerCase();
  if (/(^|\s)\*(\s|$)/.test(v)) return false;           // wildcard origin
  if (/(^|\s)'unsafe-eval'/.test(v)) return false;
  if (/(^|\s)'unsafe-inline'/.test(v))
    return /'nonce-|'sha(256|384|512)-|'strict-dynamic'/.test(v);
  return true;
}

function frameIsClosed(csp, xfo) {
  const fa = cspDirective(csp || "", "frame-ancestors");
  if (fa !== null) return fa !== "" && !/(^|\s)\*(\s|$)/.test(fa);
  // ALLOW-FROM was dropped by every browser; only DENY and SAMEORIGIN are honoured.
  return /^\s*(deny|sameorigin)\s*$/i.test(xfo || "");
}

/* The deduction pool, stated once so the target stays derivable. Thirteen
   checks, 93 points:

   indexing   15:  noindex 15
   content    38:  csp 14 · frame 12 · mixed 7 · nosniff 5
   transport  23:  hsts 12 · https 11
   page       13:  title 5 · canonical 5 · description 2 · lang 1
   privacy     4:  referrer 2 · permissions 2

   ⚠️ h1 (15) and heading-order (2) USED TO BE IN THE page BUCKET AND ARE GONE.
   They are HTML elements. This instrument reads what a server returns, and a
   heading level is not that — it was scoring the same two facts the visibility
   instrument scores, in near-identical words, so a prospect running both read
   one problem twice and saw an <h1> inside something calling itself a security
   score. What survives in `page` is indexability, which the instrument's name
   covers: the title, the canonical, the description and the declared language
   are all statements about whether the page can be found and identified.
   The heading outline now lives in exactly one place — the structural
   observations, which carry no grade at all.

   The pool is 93, not 100, and not being 100 is deliberate. Forcing it to 100
   means every check is priced against the others rather than against what it
   costs the reader, and the only way to say framing matters would have been to
   say HSTS matters less. A page that fails everything floors at 0 either way,
   which is the only thing 100 was buying.

   The security ordering is the one this instrument has always used — CSP above
   framing, HSTS above transport, those above the two privacy headers.

   The bar stays 90, and 90 stays derived rather than chosen: at 10 points of
   deductions nothing weighing more than 10 can be failing, so a score of 90 or
   better means the page is indexable and HTTPS, HSTS, a CSP that actually
   stops injected script and closed framing are all correct. 90 is the lowest
   number that still guarantees all five — at 89 the transport check drops out
   of the guarantee. Dropping h1 did not move the bar, because the bar is a
   statement about weights above 10 and h1 was never what made 90 the answer.
   Change a weight and this paragraph stops being true: re-derive it rather
   than renaming it. */
function runHeaderChecks(res, target, lang, doc) {
  const L = HDR[lang === "es" ? "es" : "en"];
  const c = [];
  const h = n => res.headers.get(n);
  // state: "ok" | "weak" | "no". Weak is a failure with its own reason — the
  // header is there, and it is not doing the job its presence implies.
  const add = (id, group, state, weight, key, val) => {
    const S = L[key];
    const pass = state === "ok";
    // Either side may interpolate what the scan found — "Found 3", "Jumps H2
    // to H4" — so both are resolved the same way. Treating only `ok` as
    // callable renders a function into the reason the prospect reads.
    const pick = v => (typeof v === "function" ? v(val) : v);
    const d = pass ? pick(S.ok)
            : state === "weak" ? pick(L.weak[key])
            : pick(S.no);
    // See runChecks: a failing check states the failure, not what it guards.
    const row = { id, group, pass, deduction: pass ? 0 : weight,
                  title: pass ? S.t : (S.nt || S.t), detail: d };
    // Failures only — see runChecks. A weak header is a failure too, and the
    // consequence is the same one, so it carries the same sentence.
    if (!pass && S.so) row.so = S.so;
    c.push(row);
  };
  const grade3 = (present, good) => !present ? "no" : good ? "ok" : "weak";

  // Nothing else on this list matters if the page is not in the index at all,
  // so it is judged first and priced highest. Header and markup are read
  // together because either one alone removes the page.
  add("noindex", "indexing", isNoindex(h("x-robots-tag"), doc) ? "no" : "ok", 15, "noindex");

  add("https", "transport", target.protocol === "https:" ? "ok" : "no", 11, "https");

  const hsts = h("strict-transport-security");
  const age = Number((/max-age\s*=\s*"?(\d+)/i.exec(hsts || "") || [])[1] || 0);
  add("hsts", "transport", grade3(!!hsts, age >= HSTS_MIN_AGE), 12, "hsts", hsts || "");

  // No compression check here on purpose. The Workers runtime decompresses the
  // response transparently and strips Content-Encoding before a Worker can read
  // it, so the header is absent for every target — including sites that
  // demonstrably send brotli to a browser. The check could only ever report a
  // false failure, which is the one thing this instrument must not do.

  const csp = h("content-security-policy");
  add("csp", "content", grade3(!!csp, cspStopsInlineScript(csp || "")), 14, "csp");

  // frame-ancestors in a CSP supersedes X-Frame-Options; either one closes it.
  const xfo = h("x-frame-options");
  add("frame", "content",
      grade3(!!xfo || /frame-ancestors/i.test(csp || ""), frameIsClosed(csp, xfo)), 12, "frame");

  add("nosniff", "content",
      /nosniff/i.test(h("x-content-type-options") || "") ? "ok" : "no", 5, "nosniff");

  const ref = h("referrer-policy");
  // A list is legal; the last token a browser understands wins, so judge that one.
  const refLast = String(ref || "").split(",").map(x => x.trim().toLowerCase())
                    .filter(Boolean).pop() || "";
  add("referrer", "privacy", grade3(!!ref, SAFE_REFERRER.has(refLast)), 2, "referrer", ref || "");

  const perm = h("permissions-policy");
  add("permissions", "privacy", grade3(!!perm, /=/.test(perm || "")), 2, "permissions");

  // What the page says about itself. Same predicates the AI scanner uses, so
  // the two instruments cannot return different verdicts on one H1. A document
  // that could not be parsed is not judged here rather than failed on guesswork.
  if (doc) {
    // A padlock the page's own markup undermines. Mixed subresources are
    // blocked or downgraded by the browser that the https check just credited.
    add("mixed", "content", mixedContent(doc) ? "no" : "ok", 7, "mixed", doc.insecureRefs);

    add("title", "page", titleNames(doc) ? "ok" : "no", 5, "title", doc.title.trim());
    // Absent or relative is one failure; pointing at another site is a worse
    // one and gets its own reason. Pointing elsewhere on the same site is
    // legitimate — pagination and syndication do it — and is not flagged.
    add("canonical", "page",
        !canonicalAbs(doc) ? "no" : canonicalOffsite(doc, target) ? "weak" : "ok", 5, "canonical");
    add("description", "page",
        !descPresent(doc) ? "no" : descUsable(doc) ? "ok" : "weak", 2,
        "description", doc.description.trim().length);
    add("lang", "page", langDeclared(doc) ? "ok" : "no", 1, "lang", doc.lang.trim());
  }

  return c;
}

async function scanHeaders(target, lang) {
  const E = errs(lang);
  const page = await Promise.allSettled([fetchCapped(target.href)]).then(r => r[0]);
  if (page.status !== "fulfilled") return { error: E.fetch(page.reason?.message || E.failed) };
  if (!page.value.res.ok)          return { error: E.http(page.value.res.status) };

  // The body is already in hand from the same fetch — no second request. It is
  // only parsed when the response is actually HTML; a PDF or a JSON endpoint
  // still gets its headers judged, and simply carries no page checks.
  const ct = page.value.res.headers.get("content-type") || "";
  const doc = /text\/html/i.test(ct) ? await extractHtml(page.value.body) : null;

  const checks = runHeaderChecks(page.value.res, target, lang, doc);
  const score = Math.max(0, 100 - checks.reduce((s, c) => s + c.deduction, 0));
  return {
    url: target.href,
    lang: lang === "es" ? "es" : "en",
    mode: "headers",
    scannedAt: new Date().toISOString(),
    score, grade: grade(score),
    passed: checks.filter(c => c.pass).length,
    total: checks.length,
    // A census, not a verdict. Counts have no pass state, so they are reported
    // beside the checks and priced at nothing.
    headings: doc ? headingCensus(doc) : null,
    checks,
  };
}

/* ── LEADS ──────────────────────────────────────────────────────────
   Both instruments are free and neither asks for an account. The AI scan
   still renders in full before this is ever offered; the trust index renders
   the checklist and holds the reasons, which is a choice made on the page via
   data-gate, not here. Either way the worker answers with the whole result and
   the CLIENT decides what to show, so the gate is soft by construction.
   Nothing about the scanned site is stored here and no report is published —
   only the
   address, so that promise on the page stays true.
   ─────────────────────────────────────────────────────────────────── */

const MAX_EMAIL = 254;

// Deliberately not a full RFC 5322 parser. This rejects what is obviously
// not an address and accepts the rest; the only real proof an address works
// is mail arriving at it, and refusing valid-but-odd addresses costs a lead.
function validEmail(raw) {
  const e = String(raw || "").trim();
  if (!e || e.length > MAX_EMAIL) return null;
  if (/[\s<>",;\\]/.test(e)) return null;

  const at = e.lastIndexOf("@");
  if (at < 1 || at === e.length - 1) return null;
  if (e.indexOf("@") !== at) return null;          // exactly one @

  const local = e.slice(0, at);
  const domain = e.slice(at + 1).toLowerCase();
  if (local.length > 64) return null;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return null;

  const labels = domain.split(".");
  if (labels.length < 2) return null;
  for (const l of labels) {
    if (!l || l.length > 63) return null;
    if (!/^[a-z0-9-]+$/.test(l)) return null;
    if (l.startsWith("-") || l.endsWith("-")) return null;
  }
  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2,}$/.test(tld)) return null;

  return local + "@" + domain;                      // domain normalised, local left alone
}

async function handleLead(body, env, ip, lang) {
  const E = errs(lang);

  // Honeypot. A real submitter never sees this field, so anything in it is a
  // bot. Answer 200 so it learns nothing, and store nothing.
  if (String(body?.company || "").trim() !== "")
    return { status: 200, payload: { ok: true } };

  const email = validEmail(body?.email);
  if (!email) return { status: 400, payload: { error: E.email } };

  if (!env?.LEADS) return { status: 503, payload: { error: E.leadOff } };

  if (env?.RATE) {
    const key = `lead:${ip}:${Math.floor(Date.now() / 3600000)}`;
    const n = Number(await env.RATE.get(key)) || 0;
    if (n >= ceiling(env, "LEAD_LIMIT")) return { status: 429, payload: { error: E.leadRate } };
    await env.RATE.put(key, String(n + 1), { expirationTtl: 3700 });
  }

  // Keyed by the lowercased address, so a second request updates one record
  // instead of filing a duplicate. The RFC says the local part is
  // case-sensitive and validEmail leaves it alone, but no mail provider in
  // practice treats Julio@ and julio@ as two people — keying on the literal
  // filed the same person twice.
  // `wrangler kv key list --binding LEADS --remote --prefix lead:` is the list.
  const now = new Date().toISOString();
  const k = `lead:${email.toLowerCase()}`;
  let rec = null;
  try { rec = JSON.parse(await env.LEADS.get(k)); } catch { /* first time, or corrupt */ }

  await env.LEADS.put(k, JSON.stringify({
    email,
    first: rec?.first || now,
    last: now,
    count: (Number(rec?.count) || 0) + 1,
    lang,
    // Which instrument asked, never what it found.
    mode: String(body?.mode || "") === "headers" ? "headers" : "scan",
  }));

  return { status: 200, payload: { ok: true } };
}

function cors(origin) {
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : "https://jldatrum.com";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = { ...cors(origin), "Content-Type": "application/json; charset=utf-8" };

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== "POST")    return new Response(JSON.stringify({ error: errs().method }), { status: 405, headers });

    let body = null;
    try { body = await request.json(); } catch { /* handled below */ }
    // Read the language before anything can reply, so even the rate-limit and
    // parse errors come back in the language of the page that called.
    const lang = String(body?.lang || "").toLowerCase() === "es" ? "es" : "en";
    const E = errs(lang);

    const ip = request.headers.get("CF-Connecting-IP") || "anon";

    // Two endpoints, one worker. Anything that is not /lead is a scan, so the
    // pre-existing callers that post to the bare origin keep working.
    if (new URL(request.url).pathname.replace(/\/+$/, "").endsWith("/lead")) {
      if (body === null) return new Response(JSON.stringify({ error: E.json }), { status: 400, headers });
      const out = await handleLead(body, env, ip, lang);
      return new Response(JSON.stringify(out.payload), { status: out.status, headers });
    }

    // Scans per IP per fixed hour bucket. SCAN_LIMIT in wrangler.toml; requires
    // a KV namespace bound as RATE. The bucket is fixed rather than rolling, so
    // the ceiling at 10:59 and the ceiling again at 11:00 is allowed by design.
    if (env?.RATE) {
      const limit = ceiling(env, "SCAN_LIMIT");
      const key = `scan:${ip}:${Math.floor(Date.now() / 3600000)}`;
      const n = Number(await env.RATE.get(key)) || 0;
      if (n >= limit)
        return new Response(JSON.stringify({ error: E.rate(limit) }), { status: 429, headers });
      await env.RATE.put(key, String(n + 1), { expirationTtl: 3700 });
    }

    if (body === null) return new Response(JSON.stringify({ error: E.json }), { status: 400, headers });

    const { url, error } = validateTarget(String(body?.url || ""), lang);
    if (error) return new Response(JSON.stringify({ error }), { status: 400, headers });

    try {
      const mode = String(body?.mode || "").toLowerCase();
      const result = mode === "headers" ? await scanHeaders(url, lang) : await scan(url, lang);
      return new Response(JSON.stringify(result), { status: result.error ? 502 : 200, headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: E.crashed(e.message) }), { status: 500, headers });
    }
  },
};
