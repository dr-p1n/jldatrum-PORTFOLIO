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
  { ua: "GPTBot",          label: "ChatGPT (training + retrieval)", weight: 15 },
  { ua: "OAI-SearchBot",   label: "ChatGPT Search",                 weight: 10 },
  { ua: "ClaudeBot",       label: "Claude",                         weight: 10 },
  { ua: "PerplexityBot",   label: "Perplexity",                     weight: 10 },
  { ua: "Google-Extended", label: "Google AI Overviews / Gemini",   weight: 10 },
  { ua: "CCBot",           label: "Common Crawl (feeds many)",      weight:  5 },
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

function validateTarget(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { return { error: "That doesn't parse as a URL." }; }
  if (u.protocol !== "https:" && u.protocol !== "http:")
    return { error: "Only http and https URLs can be scanned." };
  if (u.username || u.password)
    return { error: "URLs with embedded credentials are not accepted." };
  if (isPrivateHost(u.hostname))
    return { error: "Private, loopback and link-local addresses cannot be scanned." };
  if (!u.hostname.includes("."))
    return { error: "That hostname doesn't look public." };
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

/* ── The checks ─────────────────────────────────────────────────────── */
function runChecks(ctx) {
  const c = [];
  const add = (id, group, pass, weight, title, detail) =>
    c.push({ id, group, pass, deduction: pass ? 0 : weight, title, detail });

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
    add("ld-present", "entity", false, 40,
        "Structured data is present",
        "No JSON-LD on this page. To an answer engine it describes no entity — prose with no claims it can attribute, no name, no address, no services. Everything below in this section is unmeasurable until there is a block to read.");
  } else {
    add("ld-present", "entity", true, 40,
        "Structured data is present", `${blocks.length} JSON-LD block(s) found.`);

    add("ld-valid", "entity", malformed === 0, 25,
        "Structured data parses as valid JSON",
        malformed === 0 ? "All blocks parse."
          : entityBug
            ? `${malformed} block(s) fail to parse. An HTML entity (${entityBug}) leaked into the JSON — the page looks correct to a human and is silently invisible to every parser.`
            : `${malformed} block(s) are malformed JSON and are discarded silently by every consumer.`);

    add("ld-org", "entity", !!org, 15,
        "An Organization entity is declared",
        org ? `Declared as ${typeOf(org)}.`
            : "No Organization, LocalBusiness or ProfessionalService node. Nothing here states what business this is.");

    // The property checks only mean something once an entity exists to carry them.
    if (org) {
      add("ld-name", "entity", !!org.name, 5,
          "The entity has a machine-readable name",
          org.name ? `name: ${org.name}` : "No name field on the entity.");

      add("ld-address", "entity", !!org.address, 5,
          "A postal address is structured",
          org.address ? "PostalAddress present."
                      : "No structured address — geographic queries cannot resolve to this business.");

      const sameAs = [].concat(org.sameAs || []);
      add("ld-sameas", "entity", sameAs.length > 0, 10,
          "sameAs links disambiguate the entity",
          sameAs.length ? `${sameAs.length} sameAs link(s).`
            : "No sameAs. Engines cannot reconcile this business with its LinkedIn, Wikidata or directory records, so it stays an unlinked string rather than a known entity.");

      add("ld-services", "entity",
          !!(org.hasOfferCatalog || org.makesOffer || nodes.some(n => /Service|Product/.test(typeOf(n)))), 5,
          "Services or products are enumerated",
          org.hasOfferCatalog || org.makesOffer ? "Catalog declared."
            : "No offer catalog. A machine can only recommend what it can list.");
    }
  }

  /* — Crawler access — */
  add("robots-exists", "access", robots.ok, 5,
      "robots.txt is reachable",
      robots.ok ? "Served." : "No robots.txt. Not fatal, but you have published no crawl policy at all.");

  for (const bot of AI_CRAWLERS) {
    const blocked = robots.ok && blocksAgent(robots.groups, bot.ua, ctx.path);
    add(`bot-${bot.ua}`, "access", !blocked, bot.weight,
        `${bot.ua} is allowed`,
        blocked ? `Blocked by robots.txt. ${bot.label} cannot read this page — not ranked lower, absent.`
                : `Allowed. ${bot.label} can retrieve this page.`);
  }

  add("sitemap", "access", sitemap.ok, 5,
      "A sitemap is published",
      sitemap.ok ? "sitemap.xml served." : "No sitemap.xml — discovery depends entirely on internal linking.");

  /* — Retrievability — */
  add("ssr", "retrieval", doc.textLen >= 500, 25,
      "Content is in the served HTML",
      doc.textLen >= 500
        ? `${doc.textLen} characters of text in the raw response.`
        : `Only ${doc.textLen} characters of text in the raw HTML. This page renders client-side. Most retrieval crawlers do not execute JavaScript, so they see an empty shell.`);

  add("title", "retrieval", doc.title.trim().length > 0, 5,
      "A title element is present", doc.title.trim() || "Missing.");

  const dlen = doc.description.trim().length;
  add("description", "retrieval", dlen > 0 && dlen <= 160, 5,
      "Meta description present and under 160 characters",
      dlen === 0 ? "Missing." : `${dlen} characters.`);

  add("h1", "retrieval", doc.h1.length === 1, 5,
      "Exactly one H1",
      doc.h1.length === 1 ? `"${doc.h1[0].text.trim().slice(0, 60)}"` : `Found ${doc.h1.length}.`);

  let skip = null;
  for (let i = 1; i < doc.headings.length; i++) {
    const d = doc.headings[i].level - doc.headings[i - 1].level;
    if (d > 1) { skip = `H${doc.headings[i - 1].level} followed directly by H${doc.headings[i].level}`; break; }
  }
  add("heading-order", "retrieval", !skip, 5,
      "Heading hierarchy is sequential", skip || "No skipped levels.");

  add("canonical", "retrieval", !!doc.canonical, 5,
      "A canonical URL is declared", doc.canonical || "Missing.");

  add("alt", "retrieval", doc.imgTotal === 0 || doc.imgNoAlt === 0, 5,
      "Images carry alt text",
      doc.imgTotal === 0 ? "No images." : `${doc.imgNoAlt} of ${doc.imgTotal} images have no alt text.`);

  add("hreflang", "retrieval", doc.hreflang.length === 0 || doc.hreflang.length >= 2, 3,
      "Language alternates are declared coherently",
      doc.hreflang.length ? `${doc.hreflang.length} hreflang declarations.` : "Single-language site — not applicable.");

  add("llms", "retrieval", llms.ok, 3,
      "An llms.txt summary is published",
      llms.ok ? "Served." : "No llms.txt. Emerging convention, not yet load-bearing — cheap to add.");

  add("hsts", "retrieval", !!headers.hsts, 2,
      "HTTPS is enforced with HSTS", headers.hsts || "No Strict-Transport-Security header.");

  return c;
}

function grade(score) {
  const bands = [[100,"A+"],[90,"A"],[85,"A-"],[80,"B+"],[70,"B"],[65,"B-"],
                 [60,"C+"],[50,"C"],[45,"C-"],[40,"D+"],[30,"D"],[25,"D-"],[0,"F"]];
  return (bands.find(([min]) => score >= min) || [0,"F"])[1];
}

async function scan(target) {
  const origin = target.origin;
  const [page, robotsRes, sitemapRes, llmsRes] = await Promise.allSettled([
    fetchCapped(target.href),
    fetchCapped(`${origin}/robots.txt`),
    fetchCapped(`${origin}/sitemap.xml`),
    fetchCapped(`${origin}/llms.txt`),
  ]);

  if (page.status !== "fulfilled")
    return { error: `Could not fetch that URL: ${page.reason?.message || "request failed"}` };
  if (!page.value.res.ok)
    return { error: `The target returned HTTP ${page.value.res.status}.` };

  const ct = page.value.res.headers.get("content-type") || "";
  if (!/text\/html/i.test(ct))
    return { error: `That URL returned ${ct || "an unknown content type"}, not HTML.` };

  const doc = await extractHtml(page.value.body);

  const robotsTxt = robotsRes.status === "fulfilled" && robotsRes.value.res.ok ? robotsRes.value.body : null;
  const robots = { ok: !!robotsTxt, groups: robotsTxt ? parseRobots(robotsTxt) : [],
                   declaresSitemap: !!robotsTxt && /sitemap:/i.test(robotsTxt) };
  const sitemap = { ok: (sitemapRes.status === "fulfilled" && sitemapRes.value.res.ok) || robots.declaresSitemap };
  const llms    = { ok: llmsRes.status === "fulfilled" && llmsRes.value.res.ok
                        && !/<html/i.test(llmsRes.value.body.slice(0, 200)) };
  const headers = { hsts: page.value.res.headers.get("strict-transport-security") };

  const checks = runChecks({ doc, robots, sitemap, llms, headers, path: target.pathname });
  const deducted = checks.reduce((s, c) => s + c.deduction, 0);
  const score = Math.max(0, 100 - deducted);

  return {
    url: target.href,
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
    if (request.method !== "POST")    return new Response(JSON.stringify({ error: "POST only." }), { status: 405, headers });

    // Rate limit: 10 scans per IP per hour. Requires a KV namespace bound as RATE.
    const ip = request.headers.get("CF-Connecting-IP") || "anon";
    if (env?.RATE) {
      const key = `scan:${ip}:${Math.floor(Date.now() / 3600000)}`;
      const n = Number(await env.RATE.get(key)) || 0;
      if (n >= 10)
        return new Response(JSON.stringify({ error: "Scan limit reached — 10 per hour. Try again shortly." }), { status: 429, headers });
      await env.RATE.put(key, String(n + 1), { expirationTtl: 3700 });
    }

    let body;
    try { body = await request.json(); }
    catch { return new Response(JSON.stringify({ error: "Expected JSON." }), { status: 400, headers }); }

    const { url, error } = validateTarget(String(body?.url || ""));
    if (error) return new Response(JSON.stringify({ error }), { status: 400, headers });

    try {
      const result = await scan(url);
      return new Response(JSON.stringify(result), { status: result.error ? 502 : 200, headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: `Scan failed: ${e.message}` }), { status: 500, headers });
    }
  },
};
