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
const hasOneH1      = doc => doc.h1.length === 1;
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

const ERR = {
  en: {
    parse:    "That doesn't parse as a URL.",
    scheme:   "Only http and https URLs can be scanned.",
    creds:    "URLs with embedded credentials are not accepted.",
    private:  "Private, loopback and link-local addresses cannot be scanned.",
    public:   "That hostname doesn't look public.",
    json:     "Expected JSON.",
    method:   "POST only.",
    rate:     "Scan limit reached \u2014 10 per hour. Try again shortly.",
    fetch:    r => `Could not fetch that URL: ${r}`,
    failed:   "request failed",
    http: n =>
      n === 429 ? "The target returned HTTP 429 — it is rate-limiting requests rather than refusing them. Try again in a minute."
      : (n === 401 || n === 403)
        ? `The target returned HTTP ${n} — it refused an identified crawler. That is bot protection, not a markup problem, and this scan cannot see the page at all. It is worth knowing that the same rule frequently blocks GPTBot and the other AI crawlers: where it does, the page is invisible to answer engines however good its structured data is. Confirm that against the site's own WAF and robots rules rather than inferring it from this one refusal.`
      : `The target returned HTTP ${n}.`,
    notHtml:  ct => `That URL returned ${ct || "an unknown content type"}, not HTML.`,
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
    rate:     "L\u00edmite de escaneos alcanzado \u2014 10 por hora. Prueba de nuevo en un rato.",
    fetch:    r => `No se pudo obtener esa URL: ${r}`,
    failed:   "la petici\u00f3n fall\u00f3",
    http: n =>
      n === 429 ? "El destino devolvi\u00f3 HTTP 429 — est\u00e1 limitando peticiones, no rechaz\u00e1ndolas. Prueba de nuevo en un minuto."
      : (n === 401 || n === 403)
        ? `El destino devolvi\u00f3 HTTP ${n} — rechaz\u00f3 a un crawler identificado. Eso es protecci\u00f3n anti-bots, no un problema de marcado, y este escaneo no alcanza a ver la p\u00e1gina. Vale saber que esa misma regla suele bloquear a GPTBot y a los dem\u00e1s crawlers de IA: donde lo hace, la p\u00e1gina es invisible para los motores de respuesta por bueno que sea su marcado. Conf\u00edrmalo contra las reglas de WAF y robots del sitio, no lo infieras de este solo rechazo.`
      : `El destino devolvi\u00f3 HTTP ${n}.`,
    notHtml:  ct => `Esa URL devolvi\u00f3 ${ct || "un tipo de contenido desconocido"}, no HTML.`,
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
    "ld-present": { t: "Structured data is present",
      d: v => v.n === 0
        ? "No JSON-LD on this page. To an answer engine it describes no entity — prose with no claims it can attribute, no name, no address, no services. Everything below in this section is unmeasurable until there is a block to read."
        : `${v.n} JSON-LD block(s) found.` },
    "ld-valid": { t: "Structured data parses as valid JSON",
      d: v => v.malformed === 0 ? "All blocks parse."
        : v.entityBug
          ? `${v.malformed} block(s) fail to parse. An HTML entity (${v.entityBug}) leaked into the JSON — the page looks correct to a human and is silently invisible to every parser.`
          : `${v.malformed} block(s) are malformed JSON and are discarded silently by every consumer.` },
    "ld-org": { t: "An Organization entity is declared",
      d: v => v.type ? `Declared as ${v.type}.`
        : "No Organization, LocalBusiness or ProfessionalService node. Nothing here states what business this is." },
    "ld-name": { t: "The entity has a machine-readable name",
      d: v => v.name ? `name: ${v.name}` : "No name field on the entity." },
    "ld-address": { t: "A postal address is structured",
      d: v => v.ok ? "PostalAddress present."
        : "No structured address — geographic queries cannot resolve to this business." },
    "ld-sameas": { t: "sameAs links disambiguate the entity",
      d: v => v.n ? `${v.n} sameAs link(s).`
        : "No sameAs. Engines cannot reconcile this business with its LinkedIn, Wikidata or directory records, so it stays an unlinked string rather than a known entity." },
    "ld-services": { t: "Services or products are enumerated",
      d: v => v.catalog ? "Catalog declared."
        : "No offer catalog. A machine can only recommend what it can list." },
    "robots-exists": { t: "robots.txt is reachable",
      d: v => v.ok ? "Served."
        : v.served ? "That URL answers, but what it returns is not robots.txt — no crawl policy is being published."
        : "No robots.txt. Not fatal, but you have published no crawl policy at all." },
    bot: { t: v => `${v.ua} is allowed`,
      d: v => v.blocked
        ? `Blocked by robots.txt. ${v.label} cannot read this page — not ranked lower, absent.`
        : `Allowed. ${v.label} can retrieve this page.` },
    sitemap: { t: "A sitemap is published",
      d: v => v.ok ? (v.declared ? "Declared in robots.txt." : "sitemap.xml served.")
        : v.served ? "That URL answers, but it holds no URLs a crawler can follow — an empty sitemap discovers nothing."
        : "No sitemap.xml — discovery depends entirely on internal linking." },
    ssr: { t: "Content is in the served HTML",
      d: v => v.ok ? `${v.len} characters of text in the raw response.`
        : `Only ${v.len} characters of text in the raw HTML. This page renders client-side. Most retrieval crawlers do not execute JavaScript, so they see an empty shell.` },
    title: { t: "The page states what it is, in the title",
      d: v => !v.title ? "Missing."
        : v.ok ? v.title
        : `"${v.title}" — too thin to identify anything. This is the label an engine repeats when it names you.` },
    description: { t: "A meta description is present",
      d: v => v.len === 0 ? "Missing. Engines fall back to guessing a summary from the body." : `${v.len} characters.` },
    "description-length": { t: "The description works as a standalone summary",
      d: v => v.len === 0 ? "No description to assess."
        : v.len < 50  ? `${v.len} characters — too thin to summarise the page.`
        : v.len > 320 ? `${v.len} characters — past the point where it reads as a summary.`
        : `${v.len} characters. Usable in full by a retrieval engine.`
          + (v.len > 160 ? " Google will truncate the visible snippet at roughly 160, which costs nothing here." : "") },
    h1: { t: "Exactly one H1", d: v => v.n === 1 ? `"${v.text}"` : `Found ${v.n}.` },
    "heading-order": { t: "Heading hierarchy is sequential",
      d: v => v.skip ? `H${v.skip.from} followed directly by H${v.skip.to}` : "No skipped levels." },
    canonical: { t: "A canonical URL is declared",
      d: v => !v.canonical ? "Missing."
        : v.ok ? v.canonical
        : `"${v.canonical}" is not an absolute URL. A canonical that does not resolve is worse than none: it points nowhere.` },
    alt: { t: "Images carry alt text",
      d: v => v.total === 0 ? "No images." : `${v.noAlt} of ${v.total} images have no alt text.` },
    hreflang: { t: "Language alternates are declared coherently",
      d: v => v.n ? `${v.n} hreflang declarations.` : "Single-language site — not applicable." },
    llms: { t: "An llms.txt summary is published",
      d: v => v.ok ? "Served." : "No llms.txt. Emerging convention, not yet load-bearing — cheap to add." },
    hsts: { t: "HTTPS is enforced with HSTS",
      d: v => !v.hsts ? "No Strict-Transport-Security header."
        : v.ok ? v.hsts
        : `${v.hsts} — under six months. A browser that has not visited in a while goes back to plain HTTP first.` },
  },

  es: {
    "ld-present": { t: "Hay datos estructurados",
      d: v => v.n === 0
        ? "No hay JSON-LD en esta página. Para un motor de respuesta no describe ninguna entidad — prosa sin afirmaciones que pueda atribuir, sin nombre, sin dirección, sin servicios. Nada más de esta sección se puede medir hasta que haya un bloque que leer."
        : `${v.n} bloque(s) JSON-LD encontrados.` },
    "ld-valid": { t: "Los datos estructurados son JSON válido",
      d: v => v.malformed === 0 ? "Todos los bloques parsean."
        : v.entityBug
          ? `${v.malformed} bloque(s) no parsean. Una entidad HTML (${v.entityBug}) se filtró dentro del JSON — la página se ve correcta para una persona y es invisible para cualquier parser.`
          : `${v.malformed} bloque(s) son JSON mal formado y todo consumidor los descarta en silencio.` },
    "ld-org": { t: "Se declara una entidad Organization",
      d: v => v.type ? `Declarada como ${v.type}.`
        : "No hay nodo Organization, LocalBusiness ni ProfessionalService. Nada aquí dice qué negocio es este." },
    "ld-name": { t: "La entidad tiene un nombre legible por máquina",
      d: v => v.name ? `name: ${v.name}` : "La entidad no tiene campo name." },
    "ld-address": { t: "Hay una dirección postal estructurada",
      d: v => v.ok ? "PostalAddress presente."
        : "No hay dirección estructurada — las búsquedas por ubicación no pueden resolver a este negocio." },
    "ld-sameas": { t: "Los enlaces sameAs desambiguan la entidad",
      d: v => v.n ? `${v.n} enlace(s) sameAs.`
        : "No hay sameAs. Los motores no pueden reconciliar este negocio con su LinkedIn, Wikidata o registros de directorios, así que queda como un texto suelto y no como una entidad conocida." },
    "ld-services": { t: "Los servicios o productos están enumerados",
      d: v => v.catalog ? "Catálogo declarado."
        : "No hay catálogo de oferta. Una máquina solo puede recomendar lo que puede listar." },
    "robots-exists": { t: "robots.txt es alcanzable",
      d: v => v.ok ? "Servido."
        : v.served ? "Esa URL responde, pero lo que devuelve no es robots.txt — no estás publicando ninguna política de rastreo."
        : "No hay robots.txt. No es fatal, pero no has publicado ninguna política de rastreo." },
    bot: { t: v => `${v.ua} tiene permiso`,
      d: v => v.blocked
        ? `Bloqueado por robots.txt. ${v.label} no puede leer esta página — no queda más abajo, queda ausente.`
        : `Permitido. ${v.label} puede recuperar esta página.` },
    sitemap: { t: "Hay un sitemap publicado",
      d: v => v.ok ? (v.declared ? "Declarado en robots.txt." : "sitemap.xml servido.")
        : v.served ? "Esa URL responde, pero no contiene ninguna URL que un crawler pueda seguir — un sitemap vacío no descubre nada."
        : "No hay sitemap.xml — el descubrimiento depende por completo del enlazado interno." },
    ssr: { t: "El contenido viene en el HTML servido",
      d: v => v.ok ? `${v.len} caracteres de texto en la respuesta cruda.`
        : `Solo ${v.len} caracteres de texto en el HTML crudo. Esta página se renderiza en el cliente. La mayoría de los crawlers de recuperación no ejecutan JavaScript, así que ven un cascarón vacío.` },
    title: { t: "La página dice qué es, en el title",
      d: v => !v.title ? "Falta."
        : v.ok ? v.title
        : `"${v.title}" — demasiado corto para identificar nada. Esta es la etiqueta que un motor repite cuando te nombra.` },
    description: { t: "Hay una meta description",
      d: v => v.len === 0 ? "Falta. Los motores terminan adivinando un resumen a partir del cuerpo." : `${v.len} caracteres.` },
    "description-length": { t: "La description funciona como resumen autónomo",
      d: v => v.len === 0 ? "No hay description que evaluar."
        : v.len < 50  ? `${v.len} caracteres — demasiado delgada para resumir la página.`
        : v.len > 320 ? `${v.len} caracteres — pasada del punto en que se lee como un resumen.`
        : `${v.len} caracteres. Utilizable completa por un motor de recuperación.`
          + (v.len > 160 ? " Google va a truncar el fragmento visible cerca de los 160, y eso aquí no cuesta nada." : "") },
    h1: { t: "Exactamente un H1", d: v => v.n === 1 ? `"${v.text}"` : `Se encontraron ${v.n}.` },
    "heading-order": { t: "La jerarquía de encabezados es secuencial",
      d: v => v.skip ? `H${v.skip.from} seguido directamente de H${v.skip.to}` : "No hay niveles saltados." },
    canonical: { t: "Hay una URL canónica declarada",
      d: v => !v.canonical ? "Falta."
        : v.ok ? v.canonical
        : `"${v.canonical}" no es una URL absoluta. Una canónica que no resuelve es peor que ninguna: apunta a la nada.` },
    alt: { t: "Las imágenes llevan texto alt",
      d: v => v.total === 0 ? "No hay imágenes." : `${v.noAlt} de ${v.total} imágenes no tienen texto alt.` },
    hreflang: { t: "Las alternativas de idioma están declaradas de forma coherente",
      d: v => v.n ? `${v.n} declaraciones hreflang.` : "Sitio de un solo idioma — no aplica." },
    llms: { t: "Hay un resumen llms.txt publicado",
      d: v => v.ok ? "Servido." : "No hay llms.txt. Convención emergente, todavía no decisiva — barata de agregar." },
    hsts: { t: "HTTPS se fuerza con HSTS",
      d: v => !v.hsts ? "No hay encabezado Strict-Transport-Security."
        : v.ok ? v.hsts
        : `${v.hsts} — bajo seis meses. Un navegador que no te visita hace rato vuelve a intentar HTTP plano primero.` },
  },
};

/* ── The checks ─────────────────────────────────────────────────────── */
function runChecks(ctx) {
  const c = [];
  const L = STR[ctx.lang === "es" ? "es" : "en"];

  // key defaults to id; the per-crawler checks share one "bot" entry because
  // their ids are dynamic (`bot-GPTBot`).
  const add = (id, group, pass, weight, vars, key) => {
    const s = L[key || id] || STR.en[key || id];
    const v = vars || {};
    c.push({
      id, group, pass, deduction: pass ? 0 : weight,
      title:  typeof s.t === "function" ? s.t(v) : s.t,
      detail: s.d(v),
    });
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

  add("h1", "retrieval", hasOneH1(doc), 5,
      { n: doc.h1.length, text: hasOneH1(doc) ? doc.h1[0].text.trim().slice(0, 60) : "" });

  const skip = headingSkip(doc);
  add("heading-order", "retrieval", !skip, 5, { skip });

  // Google resolves a relative canonical, but it is a declaration about
  // identity and half the crawlers that matter here take it literally.
  const canonOk = canonicalAbs(doc);
  add("canonical", "retrieval", canonOk, 5, { canonical: doc.canonical, ok: canonOk });

  add("alt", "retrieval", doc.imgTotal === 0 || doc.imgNoAlt === 0, 5,
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

function grade(score) {
  const bands = [[100,"A+"],[90,"A"],[85,"A-"],[80,"B+"],[70,"B"],[65,"B-"],
                 [60,"C+"],[50,"C"],[45,"C-"],[40,"D+"],[30,"D"],[25,"D-"],[0,"F"]];
  return (bands.find(([min]) => score >= min) || [0,"F"])[1];
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

  const checks = runChecks({ doc, robots, sitemap, llms, headers, path: target.pathname, lang });
  const deducted = checks.reduce((s, c) => s + c.deduction, 0);
  const score = Math.max(0, 100 - deducted);

  return {
    url: target.href,
    lang: lang === "es" ? "es" : "en",
    scannedAt: new Date().toISOString(),
    score, grade: grade(score),
    passed: checks.filter(c => c.pass).length,
    total: checks.length,
    checks,
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
    noindex:     { t: "The page is allowed into the index",
                   ok: "Indexable.",
                   no: "Carries noindex — the page is removed from the index, not ranked lower." },
    mixed:       { t: "The padlock is not undone by the page itself",
                   ok: "All subresources load over HTTPS.",
                   no: v => "Loads " + v + " file" + (v === 1 ? "" : "s") + " over plain HTTP — the browser blocks them and flags it." },
    lang:        { t: "The page declares what language it is in",
                   ok: v => "Declared: " + v,
                   no: "No lang attribute — parsers and screen readers guess which language this is." },
    title:       { t: "The page names the business, not the file",
                   ok: v => "“" + v.slice(0, 60) + "”",
                   no: "Too short to identify anything — this is the line an engine repeats as you." },
    h1:          { t: "One heading says what this page is",
                   ok: "Exactly one H1.",
                   no: v => v === 0 ? "No H1 at all — nothing on the page claims to be its own subject."
                                    : "Found " + v + " — an outline with more than one subject presents none." },
    description: { t: "The summary is written, not scraped",
                   ok: v => "Present, " + v + " characters.",
                   no: "Missing — the engine writes your summary from whatever it finds first." },
    headingOrder:{ t: "The outline runs in order",
                   ok: "Levels run in sequence.",
                   no: v => v ? "Jumps H" + v.from + " to H" + v.to + " — a skipped level breaks the outline that follows."
                              : "A skipped level breaks the outline that follows it on the page." },
    canonical:   { t: "One address is the real one",
                   ok: "Absolute canonical declared.",
                   no: "Missing or relative — duplicate addresses split the page against itself." },
    https:       { t: "Buyers see a padlock, not a warning",
                   ok: "Served over HTTPS.",
                   no: "Plain HTTP — browsers stamp Not Secure on the page before a buyer reads it." },
    hsts:        { t: "The encrypted page loads without a detour",
                   ok: v => "Set. " + v,
                   no: "Missing — every first visit pays a redirect hop before your page can start." },
    csp:         { t: "Only your own scripts can run, and cost time",
                   ok: "Set.",
                   no: "Missing — injected third-party scripts run on your page and slow what loads." },
    frame:       { t: "Your brand cannot be reskinned by someone else",
                   ok: "Framing restricted.",
                   no: "Missing — your pages can be dressed up inside a stranger's site as their own." },
    nosniff:     { t: "A mislabelled file cannot run as code",
                   ok: "Set.",
                   no: "Missing — one mislabelled upload can execute and get the domain blocklisted." },
    referrer:    { t: "Outbound clicks do not leak your URLs",
                   ok: v => "Set. " + v,
                   no: "Missing — every outbound link hands the destination your full page address." },
    permissions: { t: "Nothing prompts for camera or mic in your name",
                   ok: "Set.",
                   no: "Missing — any script on the page can prompt visitors under your domain's name." },
    // Present-but-useless is its own verdict. A header that exists and does not
    // hold reads as a pass on a presence test and is why most sites score well
    // on one; it is not a pass here.
    weak: {
      hsts:        "Set but expires too soon — under six months, browsers forget between visits.",
      csp:         "Set but allows inline scripts — an injected one runs anyway, and still costs.",
      frame:       "Set to a value browsers ignore — your pages can still be framed elsewhere.",
      referrer:    "Set to a policy that still leaks — full URLs go out cross-site or on downgrade.",
      permissions: "Set but restricts nothing — scripts can still prompt under your domain's name.",
      description: "Present but unusable as a summary — too thin to say anything, or too long to be one.",
      canonical:   "Points at another domain — this hands the page's standing to a site elsewhere.",
    },
  },
  es: {
    groups: { transport: "La conexión", content: "Qué puede ejecutarse en la página", privacy: "Qué se filtra",
              page: "Qué dice la página que es", indexing: "Si se puede encontrar siquiera" },
    noindex:     { t: "La página tiene permiso de entrar al índice",
                   ok: "Indexable.",
                   no: "Lleva noindex — la página sale del índice, no baja de posición." },
    mixed:       { t: "La propia página no deshace el candado",
                   ok: "Todos los subrecursos cargan por HTTPS.",
                   no: v => "Carga " + v + " archivo" + (v === 1 ? "" : "s") + " por HTTP plano — el navegador los bloquea y la marca." },
    lang:        { t: "La página declara en qué idioma está",
                   ok: v => "Declarado: " + v,
                   no: "Sin atributo lang — los parsers y lectores de pantalla adivinan el idioma." },
    title:       { t: "La página nombra al negocio, no al archivo",
                   ok: v => "“" + v.slice(0, 60) + "”",
                   no: "Muy corto para identificar nada — es la línea que el motor repite como tú." },
    h1:          { t: "Un encabezado dice de qué trata la página",
                   ok: "Exactamente un H1.",
                   no: v => v === 0 ? "Sin H1 — nada en la página declara cuál es su propio tema central."
                                    : "Hay " + v + " — un esquema con más de un tema no presenta ninguno con claridad." },
    description: { t: "El resumen está escrito, no recogido",
                   ok: v => "Presente, " + v + " caracteres.",
                   no: "Falta — el motor arma tu resumen con lo primero que encuentre." },
    headingOrder:{ t: "El esquema va en orden",
                   ok: "Los niveles van en secuencia.",
                   no: v => v ? "Salta de H" + v.from + " a H" + v.to + " — un nivel omitido rompe el esquema que sigue."
                              : "Un nivel omitido rompe el esquema que sigue en la propia página." },
    canonical:   { t: "Una dirección es la verdadera",
                   ok: "Canónica absoluta declarada.",
                   no: "Falta o es relativa — direcciones duplicadas parten la página contra sí misma." },
    https:       { t: "El comprador ve un candado, no una advertencia",
                   ok: "Servido por HTTPS.",
                   no: "HTTP plano — el navegador marca No seguro antes de que el comprador lea nada." },
    hsts:        { t: "La página cifrada carga sin desvío",
                   ok: v => "Configurado. " + v,
                   no: "Falta — cada primera visita paga un salto de redirección antes de empezar." },
    csp:         { t: "Solo corren tus scripts, y solo ellos cuestan tiempo",
                   ok: "Configurado.",
                   no: "Falta — scripts de terceros inyectados corren en tu página y frenan la carga." },
    frame:       { t: "Tu marca no puede ser revestida por otro",
                   ok: "Enmarcado restringido.",
                   no: "Falta — tus páginas pueden montarse dentro del sitio de un extraño como suyas." },
    nosniff:     { t: "Un archivo mal etiquetado no corre como código",
                   ok: "Configurado.",
                   no: "Falta — una subida mal etiquetada puede ejecutarse y hacer bloquear el dominio." },
    referrer:    { t: "Los clics salientes no filtran tus URLs",
                   ok: v => "Configurado. " + v,
                   no: "Falta — cada enlace saliente entrega la dirección completa de tu página." },
    permissions: { t: "Nada pide cámara o micrófono en tu nombre",
                   ok: "Configurado.",
                   no: "Falta — cualquier script puede pedírselo a tus visitantes bajo tu dominio." },
    weak: {
      hsts:        "Configurado pero vence muy pronto — bajo seis meses el navegador lo olvida.",
      csp:         "Configurado pero permite scripts inline — uno inyectado corre y cuesta igual.",
      frame:       "Con un valor que el navegador ignora — te pueden seguir enmarcando afuera.",
      referrer:    "Con una política que igual filtra — la URL completa sale al bajar de HTTPS.",
      permissions: "Configurado pero no restringe nada — los scripts pueden pedir en tu nombre.",
      description: "Presente pero inservible — muy delgado para decir algo, o muy largo para resumir.",
      canonical:   "Apunta a otro dominio — le entrega el peso de esta página a un sitio ajeno.",
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

/* The deduction pool, stated once so the target stays derivable. Fifteen
   checks, 100 points:

   indexing   15:  noindex 15
   content    38:  csp 14 · frame 12 · mixed 7 · nosniff 5
   transport  23:  hsts 12 · https 11
   page       20:  title 5 · h1 5 · canonical 5 · description 2
                   · heading-order 2 · lang 1
   privacy     4:  referrer 2 · permissions 2

   The security ordering is the one this instrument has always used — CSP above
   framing, HSTS above transport, those above the two privacy headers. Only the
   scale changed, to make room.

   The bar stays 90, and 90 stays derived rather than chosen: at 10 points of
   deductions nothing weighing more than 10 can be failing, so a score of 90 or
   better means the page is indexable and HTTPS, HSTS, a CSP that actually
   stops injected script and closed framing are all correct. 90 is the lowest
   number that still guarantees all five — at 89 the transport check drops out
   of the guarantee. Change a weight and this paragraph stops being true:
   re-derive it rather than renaming it. */
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
    c.push({ id, group, pass, deduction: pass ? 0 : weight, title: S.t, detail: d });
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
    add("h1", "page", hasOneH1(doc) ? "ok" : "no", 5, "h1", doc.h1.length);
    // Absent or relative is one failure; pointing at another site is a worse
    // one and gets its own reason. Pointing elsewhere on the same site is
    // legitimate — pagination and syndication do it — and is not flagged.
    add("canonical", "page",
        !canonicalAbs(doc) ? "no" : canonicalOffsite(doc, target) ? "weak" : "ok", 5, "canonical");
    add("description", "page",
        !descPresent(doc) ? "no" : descUsable(doc) ? "ok" : "weak", 2,
        "description", doc.description.trim().length);
    const skip = headingSkip(doc);
    add("heading-order", "page", skip ? "no" : "ok", 2, "headingOrder", skip);
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
   The instruments stay free and ungated: the scan renders in full before
   this is ever offered. What the address buys is the report file, which
   the CLIENT builds from the result it already has. Nothing about the
   scanned site is stored here and no report is published — only the
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
    if (n >= 10) return { status: 429, payload: { error: E.leadRate } };
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

    // Rate limit: 10 scans per IP per hour. Requires a KV namespace bound as RATE.
    if (env?.RATE) {
      const key = `scan:${ip}:${Math.floor(Date.now() / 3600000)}`;
      const n = Number(await env.RATE.get(key)) || 0;
      if (n >= 10)
        return new Response(JSON.stringify({ error: E.rate }), { status: 429, headers });
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
