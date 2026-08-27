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
async function extractHtml(html) {
  const out = {
    title: "", description: "", canonical: "", lang: "",
    h1: [], headings: [], jsonld: [], hreflang: [],
    imgTotal: 0, imgNoAlt: 0, textLen: 0, hasMain: false,
  };
  let capture = null;

  const rewriter = new HTMLRewriter()
    .on("title", { text(t) { out.title += t.text; } })
    .on('meta[name="description"]',  { element(e) { out.description = e.getAttribute("content") || ""; } })
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
      d: v => v.ok ? "Served." : "No robots.txt. Not fatal, but you have published no crawl policy at all." },
    bot: { t: v => `${v.ua} is allowed`,
      d: v => v.blocked
        ? `Blocked by robots.txt. ${v.label} cannot read this page — not ranked lower, absent.`
        : `Allowed. ${v.label} can retrieve this page.` },
    sitemap: { t: "A sitemap is published",
      d: v => v.ok ? "sitemap.xml served." : "No sitemap.xml — discovery depends entirely on internal linking." },
    ssr: { t: "Content is in the served HTML",
      d: v => v.ok ? `${v.len} characters of text in the raw response.`
        : `Only ${v.len} characters of text in the raw HTML. This page renders client-side. Most retrieval crawlers do not execute JavaScript, so they see an empty shell.` },
    title: { t: "A title element is present", d: v => v.title || "Missing." },
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
    canonical: { t: "A canonical URL is declared", d: v => v.canonical || "Missing." },
    alt: { t: "Images carry alt text",
      d: v => v.total === 0 ? "No images." : `${v.noAlt} of ${v.total} images have no alt text.` },
    hreflang: { t: "Language alternates are declared coherently",
      d: v => v.n ? `${v.n} hreflang declarations.` : "Single-language site — not applicable." },
    llms: { t: "An llms.txt summary is published",
      d: v => v.ok ? "Served." : "No llms.txt. Emerging convention, not yet load-bearing — cheap to add." },
    hsts: { t: "HTTPS is enforced with HSTS", d: v => v.hsts || "No Strict-Transport-Security header." },
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
      d: v => v.ok ? "Servido." : "No hay robots.txt. No es fatal, pero no has publicado ninguna política de rastreo." },
    bot: { t: v => `${v.ua} tiene permiso`,
      d: v => v.blocked
        ? `Bloqueado por robots.txt. ${v.label} no puede leer esta página — no queda más abajo, queda ausente.`
        : `Permitido. ${v.label} puede recuperar esta página.` },
    sitemap: { t: "Hay un sitemap publicado",
      d: v => v.ok ? "sitemap.xml servido." : "No hay sitemap.xml — el descubrimiento depende por completo del enlazado interno." },
    ssr: { t: "El contenido viene en el HTML servido",
      d: v => v.ok ? `${v.len} caracteres de texto en la respuesta cruda.`
        : `Solo ${v.len} caracteres de texto en el HTML crudo. Esta página se renderiza en el cliente. La mayoría de los crawlers de recuperación no ejecutan JavaScript, así que ven un cascarón vacío.` },
    title: { t: "Hay un elemento title", d: v => v.title || "Falta." },
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
    canonical: { t: "Hay una URL canónica declarada", d: v => v.canonical || "Falta." },
    alt: { t: "Las imágenes llevan texto alt",
      d: v => v.total === 0 ? "No hay imágenes." : `${v.noAlt} de ${v.total} imágenes no tienen texto alt.` },
    hreflang: { t: "Las alternativas de idioma están declaradas de forma coherente",
      d: v => v.n ? `${v.n} declaraciones hreflang.` : "Sitio de un solo idioma — no aplica." },
    llms: { t: "Hay un resumen llms.txt publicado",
      d: v => v.ok ? "Servido." : "No hay llms.txt. Convención emergente, todavía no decisiva — barata de agregar." },
    hsts: { t: "HTTPS se fuerza con HSTS", d: v => v.hsts || "No hay encabezado Strict-Transport-Security." },
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
  add("robots-exists", "access", robots.ok, 5, { ok: robots.ok });

  for (const bot of AI_CRAWLERS) {
    const blocked = robots.ok && blocksAgent(robots.groups, bot.ua, ctx.path);
    add(`bot-${bot.ua}`, "access", !blocked, bot.weight,
        { ua: bot.ua, label: ctx.lang === "es" ? bot.labelEs : bot.label, blocked },
        "bot");
  }

  add("sitemap", "access", sitemap.ok, 5, { ok: sitemap.ok });

  /* — Retrievability — */
  const ssrOk = doc.textLen >= 500;
  add("ssr", "retrieval", ssrOk, 25, { ok: ssrOk, len: doc.textLen });

  add("title", "retrieval", doc.title.trim().length > 0, 5, { title: doc.title.trim() });

  // A description is judged on whether a retrieval engine can use it, not on
  // whether Google truncates its display. 160 is a SERP rendering limit; the
  // crawler ingests the whole string either way, so charging retrieval points
  // for exceeding it measures the wrong thing. Penalise absent, uselessly
  // thin, or so long it has stopped being a summary.
  const dlen = doc.description.trim().length;
  add("description", "retrieval", dlen > 0, 5, { len: dlen });
  add("description-length", "retrieval",
      dlen === 0 || (dlen >= 50 && dlen <= 320), 3, { len: dlen });

  add("h1", "retrieval", doc.h1.length === 1, 5,
      { n: doc.h1.length, text: doc.h1.length === 1 ? doc.h1[0].text.trim().slice(0, 60) : "" });

  let skip = null;
  for (let i = 1; i < doc.headings.length; i++) {
    const d = doc.headings[i].level - doc.headings[i - 1].level;
    if (d > 1) { skip = { from: doc.headings[i - 1].level, to: doc.headings[i].level }; break; }
  }
  add("heading-order", "retrieval", !skip, 5, { skip });

  add("canonical", "retrieval", !!doc.canonical, 5, { canonical: doc.canonical });

  add("alt", "retrieval", doc.imgTotal === 0 || doc.imgNoAlt === 0, 5,
      { total: doc.imgTotal, noAlt: doc.imgNoAlt });

  add("hreflang", "retrieval", doc.hreflang.length === 0 || doc.hreflang.length >= 2, 3,
      { n: doc.hreflang.length });

  add("llms", "retrieval", llms.ok, 3, { ok: llms.ok });

  add("hsts", "retrieval", !!headers.hsts, 2, { hsts: headers.hsts });

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

  const robotsTxt = robotsRes.status === "fulfilled" && robotsRes.value.res.ok ? robotsRes.value.body : null;
  const robots = { ok: !!robotsTxt, groups: robotsTxt ? parseRobots(robotsTxt) : [],
                   declaresSitemap: !!robotsTxt && /sitemap:/i.test(robotsTxt) };
  const sitemap = { ok: (sitemapRes.status === "fulfilled" && sitemapRes.value.res.ok) || robots.declaresSitemap };
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
    groups: { transport: "The connection", content: "What can run on the page", privacy: "What leaks out" },
    https:       { t: "The connection is encrypted",
                   ok: "Served over HTTPS.",
                   no: "Served over plain HTTP. Anything typed into this site — a contact form, a login — travels readable by anyone on the same network. Browsers also mark it Not Secure in the address bar." },
    hsts:        { t: "Browsers are told to always use the encrypted version",
                   ok: v => "Set. " + v,
                   no: "Missing. The first visit of the day still tries the unencrypted address before being redirected, and that one request can be intercepted. This is one line of configuration." },
    csp:         { t: "Injected scripts are blocked from running",
                   ok: "A Content-Security-Policy is set.",
                   no: "Missing. If anything ever injects a script into a page — a compromised plugin, a hijacked ad, a comment field — it runs with full access, including to whatever your visitors type into your forms. This is the header that keeps a small bug from becoming a data breach." },
    frame:       { t: "Your pages cannot be loaded inside someone else's site",
                   ok: "Framing is restricted.",
                   no: "Missing. Your site can be rendered invisibly on top of an attacker's page so that people click your buttons while believing they are somewhere else. It is called clickjacking and it is cheap to prevent." },
    nosniff:     { t: "Files cannot be run as code because they were mislabelled",
                   ok: "X-Content-Type-Options is set.",
                   no: "Missing. A file uploaded as an image can be re-interpreted and executed by the browser. Relevant to any site that accepts uploads." },
    referrer:    { t: "The pages people visit do not leak to other sites",
                   ok: v => "Referrer-Policy: " + v,
                   no: "Missing. Every link out of your site hands the destination the full address of the page the visitor came from, query strings included. If those addresses carry personal data this is also a Ley 81 exposure." },
    permissions: { t: "Scripts cannot ask for camera, microphone or location",
                   ok: "Permissions-Policy is set.",
                   no: "Missing. Any script on the page — including one you did not write — may prompt your visitors for camera, microphone or location access under your domain's name." },
  },
  es: {
    groups: { transport: "La conexión", content: "Qué puede ejecutarse en la página", privacy: "Qué se filtra" },
    https:       { t: "La conexión está cifrada",
                   ok: "Servido por HTTPS.",
                   no: "Servido por HTTP plano. Todo lo que alguien escriba en este sitio — un formulario, un acceso — viaja legible para cualquiera en la misma red. Los navegadores además lo marcan como No seguro en la barra de direcciones." },
    hsts:        { t: "Se le indica al navegador usar siempre la versión cifrada",
                   ok: v => "Configurado. " + v,
                   no: "Falta. La primera visita del día todavía intenta la dirección sin cifrar antes de ser redirigida, y esa petición se puede interceptar. Es una línea de configuración." },
    csp:         { t: "Los scripts inyectados no pueden ejecutarse",
                   ok: "Hay una Content-Security-Policy configurada.",
                   no: "Falta. Si alguna vez se inyecta un script en una página — un plugin comprometido, un anuncio secuestrado, un campo de comentarios — se ejecuta con acceso completo, incluido lo que tus visitantes escriben en tus formularios. Este es el encabezado que evita que un bug menor se convierta en una fuga de datos." },
    frame:       { t: "Tus páginas no pueden cargarse dentro del sitio de otro",
                   ok: "El enmarcado está restringido.",
                   no: "Falta. Tu sitio puede renderizarse invisible sobre la página de un atacante para que la gente haga clic en tus botones creyendo que está en otro lado. Se llama clickjacking y es barato de prevenir." },
    nosniff:     { t: "Un archivo no puede ejecutarse como código por estar mal etiquetado",
                   ok: "X-Content-Type-Options está configurado.",
                   no: "Falta. Un archivo subido como imagen puede ser reinterpretado y ejecutado por el navegador. Relevante para cualquier sitio que acepte subidas." },
    referrer:    { t: "Las páginas que visita la gente no se filtran a otros sitios",
                   ok: v => "Referrer-Policy: " + v,
                   no: "Falta. Cada enlace que sale de tu sitio le entrega al destino la dirección completa de la página de donde vino el visitante, con parámetros incluidos. Si esas direcciones cargan datos personales, esto también es una exposición de Ley 81." },
    permissions: { t: "Los scripts no pueden pedir cámara, micrófono o ubicación",
                   ok: "Permissions-Policy está configurado.",
                   no: "Falta. Cualquier script en la página — incluido uno que no escribiste — puede pedirle a tus visitantes acceso a cámara, micrófono o ubicación bajo el nombre de tu dominio." },
  },
};

function runHeaderChecks(res, target, lang) {
  const L = HDR[lang === "es" ? "es" : "en"];
  const c = [];
  const h = n => res.headers.get(n);
  const add = (id, group, pass, weight, key, val) => {
    const S = L[key];
    const d = pass ? (typeof S.ok === "function" ? S.ok(val) : S.ok) : S.no;
    c.push({ id, group, pass, deduction: pass ? 0 : weight, title: S.t, detail: d });
  };

  add("https", "transport", target.protocol === "https:", 15, "https");

  const hsts = h("strict-transport-security");
  add("hsts", "transport", !!hsts, 20, "hsts", hsts || "");

  const csp = h("content-security-policy");
  add("csp", "content", !!csp, 25, "csp");

  // frame-ancestors in a CSP supersedes X-Frame-Options; either one closes it.
  const xfo = h("x-frame-options");
  add("frame", "content", !!xfo || /frame-ancestors/i.test(csp || ""), 20, "frame");

  add("nosniff", "content", /nosniff/i.test(h("x-content-type-options") || ""), 10, "nosniff");

  const ref = h("referrer-policy");
  add("referrer", "privacy", !!ref, 5, "referrer", ref || "");

  add("permissions", "privacy", !!h("permissions-policy"), 5, "permissions");

  return c;
}

async function scanHeaders(target, lang) {
  const E = errs(lang);
  const page = await Promise.allSettled([fetchCapped(target.href)]).then(r => r[0]);
  if (page.status !== "fulfilled") return { error: E.fetch(page.reason?.message || E.failed) };
  if (!page.value.res.ok)          return { error: E.http(page.value.res.status) };

  const checks = runHeaderChecks(page.value.res, target, lang);
  const score = Math.max(0, 100 - checks.reduce((s, c) => s + c.deduction, 0));
  return {
    url: target.href,
    lang: lang === "es" ? "es" : "en",
    mode: "headers",
    scannedAt: new Date().toISOString(),
    score, grade: grade(score),
    passed: checks.filter(c => c.pass).length,
    total: checks.length,
    checks,
  };
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

    // Rate limit: 10 scans per IP per hour. Requires a KV namespace bound as RATE.
    const ip = request.headers.get("CF-Connecting-IP") || "anon";
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
