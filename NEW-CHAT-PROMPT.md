Chat: Datrum studio website v11

WORKING DIR: /Users/jelv/Desktop/backup 23.2.2026/DATRUM/DATRUM projects/jldatrum-PORTFOLIO/
Vanilla HTML/CSS/JS, no build step, bilingual EN + /es/. Live at https://jldatrum.com.
38 content pages + 404.html. Every change ships in BOTH languages — the site is
hand-mirrored, there is no templating.

═════════════════════════════════════════════════════════════════════════════
⚠️ START HERE. THE FIRST JOB OF THIS SESSION IS TWO PUSHES, ONE AT A TIME.

v10 left ~47 files changed and UNPUSHED in the worktree. The user asked for them
to go out as two separate pushes, verifying between them — not one big one.

  PUSH 1 — the site. Everything except worker/. This is the risky half: it
  removes 'unsafe-inline' from script-src, which means the mobile drawer, the
  cookie banner and the work-page tabs now depend on event delegation in
  js/nav.js and js/tabs.js instead of inline onclick=. If delegation fails, the
  menu and the cookie consent are dead on 39 pages.
  After pushing, WAIT for Pages (~60–90s) and verify against the LIVE site:
    curl -s -H 'Cache-Control: no-cache' "https://jldatrum.com/?b=$(date +%s)" \
      | grep -c 'onclick='            # must be 0
    curl -sI https://jldatrum.com/ | grep -i content-security-policy
  Then open it and actually click the hamburger and the cookie banner. Do not
  declare it working from the HTML alone.

  PUSH 2 — the worker. Only after push 1 is verified green:
    cd "/Users/jelv/Desktop/backup 23.2.2026/DATRUM/DATRUM projects/jldatrum-PORTFOLIO" && git pull origin main && cd worker && wrangler deploy
  Order matters: the worker carries the RAISED BAR. If it ships before the site,
  it grades jldatrum.com's OLD headers and the user's own domain shows B for the
  length of the Pages build — which breaks the "preach by example" argument that
  the whole pitch rests on.

  Verify push 2 live:
    curl -s -X POST https://ai-visibility.julioernestolv.workers.dev/scan \
      -H 'Content-Type: application/json' -H 'Origin: https://jldatrum.com' \
      -d '{"url":"https://jldatrum.com","lang":"en","mode":"headers"}'
  Expect score 100, grade A+. Then the same without "mode" — expect 100 A+ too.
═════════════════════════════════════════════════════════════════════════════

DEPLOY: github.com/dr-p1n/jldatrum-PORTFOLIO → Cloudflare Pages auto-deploys on
`git push origin main`. Build ~60–90s. Commit/push ONLY when the user says so
("push it" / "pushea" / "deploy"). End commit messages with:
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Last commit pushed in v10: 29a1921 "Drop the footer tagline".

⚠️ THE WORKER IS DEPLOYED SEPARATELY AND IS OFTEN THE REAL BLOCKER.
Site changes go live on push. Anything under worker/ does NOT.
Always give the FULL path, never `…/` — the user pasted an ellipsis literally once.

─────────────────────────────────────────────────────────────────────────────
NETWORK — THE v9/v10 PROMPT WAS WRONG ABOUT THIS
This session CAN reach jldatrum.com, api.cloudflare.com and the worker. In v10 the
prompt claimed the proxy 403s CONNECT; it does not. Wrangler is authenticated as
julioernestolv@gmail.com (OAuth, account 2b29809d1391e748856d98e409edaf0d) with
workers_kv write, so `wrangler deploy`, `kv namespace list` and `kv key get` all
work directly. Verify live rather than handing the user a curl to run.
Assets carry max-age=14400 — tell him to hard refresh (Cmd+Shift+R) or he sees
stale CSS and thinks the change failed. He screenshots STALE pages constantly.

LOCAL PREVIEW — use tools/serve.py, NOT python -m http.server
`python3 tools/serve.py 3456` (wired into .claude/launch.json). Resolves clean
URLs, applies the 22 rules in _redirects, serves a real 404 — and since v10 also
SENDS THE PRODUCTION HEADERS from _headers, so a CSP that only fails in
production cannot pass locally. HSTS is deliberately stripped: over http://localhost
it pins the browser to https on that port and breaks the preview until it expires.

⚠️ THE PREVIEW SERVES STALE CSS AND JS. Before measuring anything:
  document.querySelectorAll('link[rel=stylesheet]').forEach(l=>{
    if(l.href.includes('/css/')) l.href=l.href.split('?')[0]+'?v='+Date.now() });
Measure AFTER a tick — a getBoundingClientRect taken in the same call as the href
swap reads the unstyled document and reports nonsense (this happened twice in v10).

⚠️ THE BROWSER PANE IS UNRELIABLE. scrollTo often reports success with the
screenshot still at the top; `document.hidden` is true when the pane is
backgrounded, which pauses rAF and returns a BLANK screenshot of a page that is
actually fine — call tabs_select first. MEASURE WITH JS, treat screenshots as a
second opinion. `tabs_create` recovers a wedged pane. To photograph a section
that will not scroll into view, `display:none` the bands above it.

⚠️ WHEN STUBBING window.fetch TO TEST, YOUR STUB ALSO INTERCEPTS BLOB READS.
Cost two wrong conclusions in v10: reading back a generated file with fetch()
returned the canned scan JSON instead of the file. Use XMLHttpRequest — and note
XHR to a blob: URL is itself blocked by the site's own CSP (connect-src has no
blob:), so to inspect a generated PNG, override HTMLCanvasElement.toBlob and
stash this.toDataURL() instead. Also: overrides stack. Reload the page between
probes or an old interceptor silently overwrites the new one's variable.

⚠️ Throwaway scripts: prefer an inline `python3 - <<'PY'` heredoc so no file is
ever created. If you must write one it goes in the PROJECT ROOT and is `rm`'d in
the SAME Bash call. .gitignore covers `_*.py` and `_*.mjs` because one shipped.
NEVER use `pkill` — it kills the agent's own shell (exit 144). Leave servers running.
Chain commands so a failed check actually blocks the commit; `echo "exit=$?"`
between them resets the status and a broken validator once let a push through.

─────────────────────────────────────────────────────────────────────────────
DESIGN SYSTEM (dark editorial gallery)
bg #0C1B1F · bg2 #0E2329 · surface #0F5C6D · border #1A3A40 · teal(interactive) #1E7F98
lemon(accent/CTA) #F2D24B · text #E8EDED · muted #9AABAF
Fonts: Space Grotesk (display) + DM Sans (body). Fixed nav 64px.
`--coral-orange` still exists in css/main.css and css/tailwind.css — those two files
are DEAD (nothing links them). Never sweep them.

CONTRAST, MEASURED — compute before choosing:
  lemon on bg 11.8:1 · muted on bg 7.4:1 · teal on bg 3.81:1
⚠️ TEAL FAILS AA FOR BODY TEXT. Legal only at ≥24px, or ≥19px bold. The H1 and the
hero-mark caption rely on that. Never put teal on 11–14px text — use --muted.
--muted at 72% opacity over --bg computes to 4.39:1 and FAILS. Never stack opacity
on muted text.

USER'S SPACING/TYPE RULES: 8px scale — 4, 8, 12, 16, 24, 32, 40, 48, 64.
Weights 400 body, 500 labels, 600 headings; thin weights for display sizes only.
60-30-10 colour. When in doubt add whitespace, reduce colour noise, lower weight
before adding bold.

ONE VERTICAL RHYTHM, SITEWIDE. Every shade band: 96 desktop · 80 tablet · 56 mobile.
The fixed nav's 64px is ADDED ON TOP (160/144/120), never folded into a smaller
number. Lives in css/layout.css (.section-inner) and css/legal.css (.band .wrap).
Do not reintroduce a per-page value.

TWO INDEPENDENT STYLESHEET FAMILIES
  A) variables + typography + components + layout .css → index, work/index, bio (+/es/)
  B) legal.css (self-contained, its OWN :root, literal font names) → everything else
⚠️ --font-display / --font-body DO NOT EXIST under legal.css. Anything shared must
use var(--x, literal-fallback) or it renders serif on ~30 pages.
⚠️ legal.css has exactly ONE :root. viz.css must declare none.
⚠️ Generic `h2 { margin: 56px 0 16px }`, `section h2`, `section h3` and
`a { color: lemon; text-decoration: underline }` all reach into components.
A class-only selector must state margin AND colour explicitly. The generic `a`
is INLINE: an anchor given block children without display:block wraps one word
per line. Prefer `<h3><a>…</a></h3>` over wrapping a block in `<a>`.
⚠️ The rc-* namespace is crowded: `.rc-box` is the Ley 81 checkbox (20×20) and is
STILL LIVE in the security-headers checklist. Check the markup before assuming.

ALTERNATING SHADES — no two adjacent bands share a shade, last content band is
--bg so the --bg2 footer reads as its own band.
  index.html   home bg · offer bg2 · who bg · trust bg2 · contact bg · footer bg2
  work/index   both tabs: band bg2 → band bg
  resources/   band bg · band--alt bg2 · band bg
⚠️ TABS CANNOT USE SIBLING <section>s — js/tabs.js only hides ids in TAB_IDS, so a
second section stays visible under EVERY tab. Each tab holds two full-bleed
`.tab-band` divs, each wrapping its own `.section-inner`.
⚠️ Banding a tab puts .section-inner one level deeper and the direct-child
nav-clearance rule in layout.css SILENTLY STOPS MATCHING. The selector list
carries `body.tabbed > section > .tab-band:first-of-type > .section-inner`; keep it.

─────────────────────────────────────────────────────────────────────────────
NO INLINE SCRIPT ANYWHERE — NEW IN v10, DO NOT REGRESS
script-src is `'self' https://www.googletagmanager.com`. There is no
'unsafe-inline'. That means:
  · ZERO inline `<script>` blocks. The GA4 Consent-Mode block lives in
    /js/analytics.js and MUST load synchronously BEFORE the async gtag.js tag —
    with defer or async, gtag.js wins the race and the default-deny never lands.
  · ZERO `onclick=` / `onerror=` attributes. 345 of them became data-action=
    (toggle-drawer, close-drawer, accept-cookies, decline-cookies, show-cookies)
    and data-fallback="hide-portrait", handled by delegation at the bottom of
    js/nav.js. The `error` listener is in the CAPTURE phase because error does
    not bubble.
  · The work page declares its tab set as data-tab-ids="services|work" on <body>;
    js/tabs.js reads it. window.TAB_IDS still wins if anything sets it.
  · style-src KEEPS 'unsafe-inline' — the fade-up `style="--delay:…"` attributes
    need it, and the CSP check only judges script.
Adding one inline handler silently breaks that element in production and nowhere
else. The local preview now catches it because serve.py sends the real CSP.

─────────────────────────────────────────────────────────────────────────────
SHARED LAYER: css/viz.css + js/viz.js
  · icon registry (data-icon) + FIVE chart renderers: flow, flywheel, nodes,
    split, timeline. 7 icons in use; chevron, gauge, globe, hierarchy, shield
    are orphaned. viz.js also owns initRouter() and initHeroMark() (home only).
  · NEVER fork viz.js or scan.js per language — translated strings live in
    data-labels="A|B|C" or in data-* attributes. js/scorecard.es.js is the
    standing example of what forking costs.
  · MOTION CONTRACT: the UNDRAWN state is applied ONLY by JS (.dx-anim, .mark-anim).
    With JS off, reduced motion on, in print, or in a hidden tab, graphics render
    COMPLETE. The hero mark's finished heights live in css/components.css under
    `/* ── finished state ── */` — never move them into JS.
  · SVG text scales with the viewBox: 11px in a 552-unit box renders near 8px.
    Size the viewBox ~360 units wide and 10–11px reads right.
  · Inline `opacity` on an SVG node beats `.dx-pop`'s class rule in BOTH states.
    Use `stroke-opacity`.
  · Flywheel labels wrap at 16 chars, not 15.

THE HERO MARK (index + es/index, `#heroMark`) — pure HTML/CSS, no SVG.
Two lanes on the same spend. Above the rule each digital product lands and STAYS,
each taller because it inherits the last; below it, rented attention lights
exactly one month and the previous goes dark. Caption "Marketing value over time"
sits ABOVE the lanes. OWNED = [16,26,40,58,80,106]. RENT is a single flat constant
on purpose — a declining lane claims the same spend buys less each month, which is
an empirical claim with nothing behind it. The loop parks on visibilitychange.

OTHER JS: nav.js (drawer + cookie consent + delegation), scan.js (client for BOTH
instruments), scroll-reveal.js, tabs.js, analytics.js. js/resources.js is DELETED.
⚠️ js/scan.js reads strings via `root.dataset[key]`, NOT getAttribute.
⚠️ Remote strings go through textContent, never innerHTML.

─────────────────────────────────────────────────────────────────────────────
THE TWO INSTRUMENTS — one worker, two endpoints, two modes
worker/ai-visibility-scanner.js → ai-visibility.julioernestolv.workers.dev
worker/scanner.test.mjs — 195 tests, `node worker/scanner.test.mjs`
KV: RATE = 1361a8801c4f4c8ca804168b8c93a3d6 · LEADS = f6ebc9c9e73940c9b73c7722b50b8f6e
⚠️ THE NAMESPACE TITLED "LEADS" IS NOT OURS. It holds 9 RFQ records from another
project (TRIANA STUDIO) under the same `lead:` prefix. v10 bound it by mistake and
had to unwind. The binding named LEADS points at DATRUM_REPORT_LEADS. Never repoint
it at the namespace titled LEADS.

POST /scan {url, lang, mode} → {url, lang, score, grade, passed, total, checks[]}
  mode ""        → AI Accessibility Scanner (26 checks: entity/access/retrieval)
  mode "headers" → Domain Security & Trust Index (7 checks: HTTPS + 6 headers)
POST /lead {email, company, lang, mode} → {ok:true}
  Anything whose path does not end in /lead is a scan, so callers posting to the
  bare origin keep working. Stores ONLY the address, keyed by the LOWERCASED
  address — keying on the literal filed Julio@ and julio@ as two people. Honeypot
  field `company` answers 200 and stores nothing. 10/hour/IP. Without the binding
  it answers 503, never a silent drop.

THE BAR — RAISED IN v10. Presence is no longer a pass.
  Headers: HSTS under six months (15552000) fails · a CSP whose script-src (or
  default-src fallback) allows 'unsafe-inline' without a nonce/hash/strict-dynamic
  fails · 'unsafe-eval' or a `*` script source fails · X-Frame-Options ALLOW-FROM
  fails (no browser honours it) · frame-ancestors * fails · a Referrer-Policy
  outside {no-referrer, same-origin, strict-origin, strict-origin-when-cross-origin}
  fails, judged on the LAST token of a list · an empty Permissions-Policy fails.
  Each has its own `weak:` string, distinct from the `no:` string.
  ⚠️ THE ONE CASE THAT MUST NEVER BE FLAGGED: 'unsafe-inline' beside a nonce or
  hash is correct practice — browsers ignore it there. There is a test for it.
  AI scanner: a <title> under 15 chars fails · a non-absolute canonical fails ·
  a robots.txt that is really an HTML 404 page fails · a sitemap with no <loc>
  and no <sitemapindex> fails (one DECLARED in robots.txt still passes — the
  scanner only fetches /sitemap.xml and penalising a sitemap that lives elsewhere
  would be a false finding) · HSTS uses the SAME six-month floor as the other
  instrument, because two instruments disagreeing about one header teach a
  prospect to distrust both.

THE TARGETS — DERIVED, NOT CHOSEN. data-target on each page.
  Security 95: deductions are 25/20/20/15/10/5/5 and the only subset summing to 5
  is one 5, so 95 means exactly one privacy header missing and nothing else.
  AI 85: above 85 the deductions total under 15, so nothing weighing 15+ can be
  failing — the entity block is present, valid, names an Organization, and the
  content is in the served HTML. That is the line every answer engine shares.
  If a weight ever changes, RE-DERIVE the targets or they become arbitrary.

RESULTS UI (js/scan.js): score head → the bar graphic → gaps table (worst first)
→ passing tally → the report offer. The distance to the bar is the argument; the
gaps are the evidence, in that order. data-compact drops the area tag on headers.

THE SHARE CARD — canvas, 1200×630, "Copy image" + "Download image".
⚠️ Do NOT rasterise the on-page SVG. An SVG loaded through an <img> does not fetch
the page's webfonts and ships in the viewer's system sans. Canvas 2D uses the
document's loaded fonts — hence the await on document.fonts.ready.
⚠️ No blob: as an image source, ever: img-src is `'self' data:` and the browser
refuses it silently. blob: appears only on the download anchor.
⚠️ ClipboardItem with images is not universal (Firefox rejects it). The catch says
so in words rather than failing quietly.
The card carries the worst single gap under the verdict — without it the card is
a note, with it it is a diagnosis, which is what makes it usable in cold outreach.

DESIGN RULES THAT WERE HARD-WON — do not undo:
· Absence of JSON-LD is priced ONCE at -40, not cascaded into seven deductions.
· The description check does NOT penalise >160 chars — a SERP rendering limit,
  not a retrieval one. Reported at zero cost.
· SSRF guardrails are an explicit range enumeration, NOT a regex.
· A 403 is explained, not reported: bot protection, and the same WAF rule often
  blocks GPTBot. Says to confirm against the site's own rules — do not upgrade
  that into a claim.
· Header check titles name what the header PREVENTS, never the header. Tested.
· Header reasons capped at 84 chars AND at least 60, with an em dash, so seven of
  them read as a table. The old test set only a MINIMUM and 266-char reasons shipped.
· Weights follow Observatory's ordering of harm. It is NOT Observatory and must
  never claim its score.
· 2 MB cap, 8s timeout, 10 scans/IP/hour via KV.
Endpoint appears in THREE places that must stay in sync: data-endpoint in
/resources/scan/ and /resources/security-headers/, and connect-src in /_headers.
js/scan.js derives /lead from data-endpoint, so there is no fourth place.

─────────────────────────────────────────────────────────────────────────────
IA — CURRENT (38 pages)
Nav: Services · Case studies · Resources · Bio · ES · **Scan your site →**
/            Hero is TWO COLUMNS: headline+CTAs left, lede + hero mark right;
             stacks below 900px. Eyebrow "Marketing Product design studio" pulses
             on an inner .eyebrow-pulse span. H1 is a SINGLE colour var(--teal).
             Lede names what the products ARE, not what the H1 already said:
             "Calculators, diagnostics, interactive tools — … the source AI
             engines cite and recommend." EN and ES both say AI engines.
             Sections: #home #offer #who #trust #contact. #specialization was
             deleted in v9 and must not come back.
             #offer routers carry NO numerals and NO collapse.
             #who is ONE COLOUR (--muted) and CLOSES with a comparison table,
             `table.compare` in components.css: "Same budget. A different kind of
             resource." Rules only — no vertical borders, ever; that turns it back
             into the card grid he rejects. table-layout:fixed sizes columns off
             the FIRST row, so the width lives on thead, not tbody th.
/work/       Two tabs: Services + Case studies (7). TAB_IDS=['services','work'].
             Methodology is an <ol class="method-steps"> — no boxes, no icons.
/work/<7>/   go-clean · panama-treasures · verite · seguros · ag-law · obstacle-race · ucc
/resources/  TWO panels: "AI Visibility" (lemon fill) and "Literary" (dark).
/resources/{scan,security-headers}/   the two instruments — field, results, the
             bar, the share row, the report offer. NO explanatory prose. He
             removed it twice; do not put it back.
/resources/guides/<3>/  how-ai-engines-recommend-businesses · bilingual-website-architecture
                        · structured-data-high-value-inventory
/bio/  /security  /privacy  /subprocessors  /404.html
All mirrored under /es/ except 404.html. Deep pages: back link at the TOP OF THE
CONTENT COLUMN above the title; wordmark left, ES chip + hamburger right.
FOOTERS carry no tagline — top-level is `© 2026 DATRUM` alone, deep pages end on
their last real link. Deleted in v10; do not reintroduce a strapline.

DELETED (301'd in _redirects, 22 rules — do not resurrect):
/audit/, /resources/visibility/, /resources/ley81/, three research pieces, two
folded guides, three earlier research pieces.
⚠️ Cloudflare Pages falls back to the root index when a path is missing and no
404.html exists — that is how fourteen deleted URLs once returned 200. Never
delete 404.html.

ROOT: robots.txt (16 AI crawlers + sitemap), sitemap.xml, llms.txt, _redirects,
404.html, _headers, tools/serve.py. Regenerate sitemap and llms.txt when pages change.

─────────────────────────────────────────────────────────────────────────────
CONTENT RULES
· NO NUMBERED SUBLABELS ("Instrument 01"). He rejects them on sight. A real <ol>
  where the ordinal is information is fine.
· NO BOXES around list items. A bordered card grid is "an easy tell for
  vibecoded". Rules and whitespace instead.
· NO QUESTION-AND-ANSWER BODY COPY. Guides are THREE PARAGRAPHS, claim stated flat.
· Instruments are tools, not essays.
· NO invented statistics and no vendor AEO projections. Argue from mechanism.
  Extends to graphics — a rising curve is a projection, and so is any lane that
  shrinks over time.
· ⚠️ AND IT EXTENDS TO THE INSTRUMENTS THEMSELVES. In v10 he asked for edge cases
  engineered to lower prospects' scores, and for his own domain to read 110/100.
  Both were declined and he accepted both refusals. The reason to give is not
  ethics in the abstract: the pages claim "Automated, not self-reported" and his
  pitch claims "objective, verifiable metrics", and any prospect can check the
  same headers on securityheaders.com in thirty seconds. A rigged instrument
  destroys the exact credibility it is being bought for. Raise the bar honestly
  instead — that is what he actually wanted, and he said so once it was built.
· Case-study claims assert only what the published work-index card already asserts.
· JSON-LD must be ENTITY-DECODED: json.dumps(ensure_ascii=True). Rewrite only the
  payload so surrounding indentation survives, and only blocks that changed.
· Spanish is written natively, and is TUTEO.
  ⚠️ When grepping for voseo, REQUIRE THE ACCENT: "haces"/"tienes" are correct
  tuteo; only "hacés"/"tenés"/"sos"/"vos" are voseo.
· Positioning is STUDIO, not agency, in every machine-readable field.
· ⚠️ CLAIMS ABOUT THE SITE ARE PART OF THE SITE. Adding the email-for-report made
  "no forms, no email" false in 20+ places — titles, meta, og, twitter, JSON-LD,
  llms.txt, the resources index — and /privacy still described a diagnostic widget
  deleted two versions earlier. Both were swept. After ANY feature that collects
  something, grep the marketing copy and the privacy policy before shipping.
· Home <title>/og:title/twitter:title: "DATRUM — Marketing product design studio"
  / "DATRUM — Estudio de diseño de productos de marketing". Set in v10; the old
  "Design & engineering studio for high-performance B2B marketing" was the last
  survivor of the retired positioning.

STRUCTURED DATA: all 38 pages carry the FULL Organization node sharing
@id https://jldatrum.com/#organization — exactly two description variants.

THE VALIDATOR TO RE-RUN BEFORE EVERY PUSH:
one H1 per page · balanced tags · no skipped heading levels · no HTML entities in
any JSON-LD · viz.css zero :root and legal.css exactly one · every data-viz= has
a matching renderer · every data-icon= is registered · every internal href
resolves · zero voseo in /es/ · zero inline onclick/onerror · zero inline <script>
· analytics.js loads BEFORE gtag.js on all 32 pages · every t("key") in scan.js
has its data-* on all four instrument pages · script-src has no 'unsafe-inline'.
⚠️ WRITE THE ASSERTIONS CAREFULLY. Three false alarms so far, all mine:
`initHeroMark()` matched its own declaration; `data-viz` renderers needed
`^\s*R\.name\s*=` not `\bname\s*:`; and `t\("` also matched `createElemenT("div")`
and `fillTexT(` and reported 52 nonexistent failures. Anchor with `(?<![A-Za-z0-9_])`.
Internal-link checks must resolve extensionless clean URLs (`p + ".html"`) or
every /privacy link looks dead.

SECURITY/PERF: _headers sets HSTS(preload), enforcing CSP, X-Frame-Options DENY,
X-Content-Type-Options, Referrer-Policy, Permissions-Policy.
⚠️ `img-src 'self' data:` — external images are BLOCKED and fail silently.
connect-src allows only the scanner worker + GA. No blob:.

─────────────────────────────────────────────────────────────────────────────
OPEN ITEMS

1. ⚠️ THE TWO PUSHES. See the top of this file. Nothing else starts first.
2. ⚠️ URGENT, DNS not code. CONFIRMED LIVE in v10 — `_dmarc.jldatrum.com` really
   does return two TXT records:
     v=DMARC1; p=none;   rua=mailto:julio@jldatrum.com              ← DELETE THIS
     v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s; rua=…cloudflare.net
   Per RFC 7489 two records are treated as NONE, so DMARC is NOT enforcing today
   while /security claims it is. DNS is in Cloudflare; the session token has
   zone READ only, so the user deletes it: dash → jldatrum.com → DNS → Records →
   filter `_dmarc`.
   ⚠️ WARN HIM BEFORE HE DOES: the survivor is p=reject with STRICT alignment.
   The moment the duplicate goes, enforcement starts for real and any mail that
   does not align exactly with jldatrum.com is REJECTED, not spam-foldered. SPF
   today is `v=spf1 include:_spf.google.com ~all` — no Hostinger. If the mail
   migration is close, delete p=none now but fix Hostinger's SPF/DKIM BEFORE
   flipping MX or the first batch bounces entirely.
3. Email migration Google Workspace → Hostinger. Verified values:
     MX  @ 5 mx1.hostinger.com · @ 10 mx2.hostinger.com  (delete Google's first)
     SPF v=spf1 include:_spf.google.com include:_spf.mail.hostinger.com ~all
     DKIM three CNAMEs (hostingermail-a/b/c._domainkey → …dkim.mail.hostinger.com),
     DNS-only/grey cloud or lookup fails.
   Order: mailbox → DKIM+SPF → fix DMARC → flip MX → verify → tighten.
   After: /subprocessors must list Hostinger, and re-verify the /security claim.
4. OG/twitter re-scrape. The home titles changed in v10; LinkedIn and Facebook
   cache them and WhatsApp uses the FB cache. Needs LinkedIn Post Inspector +
   Facebook Sharing Debugger after push 1.
5. THE SECTOR MEDIAN, PARKED. He asked for a median, then replaced it with the
   derived target. If he returns to it: it needs 20–40 real domains from HIS
   market (law, insurance, logistics, professional services in Panama/LatAm) that
   HE supplies, measured once and labelled with the sample size and date. The
   same run doubles as a prioritised outreach queue. For the AI scanner the right
   statistic is not a median but a proportion — "29 of 34 publish nothing that
   identifies the business" — because that instrument's argument is binary.
6. ⚠️ A MEASUREMENT ERROR TO NOT REPEAT: curl WITHOUT -L grades the 301 hop, not
   the page. v10 reported Shopify 25 / Squarespace 15 / Wix 15 from redirect
   headers. Following redirects, as the worker does: Stripe 90 · HubSpot 65 ·
   Mailchimp 55 · Salesforce 50 · Shopify 45 · Squarespace 45 · Wix 45 ·
   GoDaddy 35 · jldatrum 100. He was corrected; if he quotes 25 or 15 to a
   prospect, stop him.
7. UNANSWERED since v8: his message cut off at "3. tenemos likn". Ask or drop it.
8. Calendly: https://calendly.com/julio-jldatrum works but he asked to point it at
   julioernestolv@gmail.com; he later said "forget about calendly" — confirm
   before touching.
9. AG Law and UCC have no production URL, so neither ships `<p class="cs-live">`.
   AG Law credential: WBC presidency in Panama is CONFIRMED and is the only one.
   Do NOT add WTC Panama or the bilateral chamber.
10. Research piece "The Invisible Non-Event" (Verite) NOT written — blocked on
    client sign-off on network credits.
11. Ley 81 not-legal-advice framing stays wherever statutory claims appear.
12. Dead classes in markup with no CSS: bio-text, router-top, dx-viz--flywheel.
    Orphaned icons in the viz.js registry: chevron, gauge, globe, hierarchy,
    shield. All harmless; sweep only if asked.
13. Stale working files in root: DATRUM-copy-EN.txt, DATRUM-copy-ES.txt,
    DATRUM-current-copy.txt, HOME-COPY-BRIEF.md, "datrum website copy.txt".
    They record OLD hero copy and retired numbered sublabels. Told twice, no
    instruction to delete.

HOW THE USER WORKS
Terse, fast, decisive, writes in Spanish and English interchangeably — reply in
the language he last used. Sends corrections mid-turn: act on them in the SAME
turn, and expect the turn's scope to grow two or three times before it closes.
In v10 one turn went from a hero paragraph to a comparison table to an email-for-
report feature to a sitewide CSP rewrite. That is normal; finish each piece and
say plainly what is done, what is verified, and what is still unpushed.
Says "arreglalo" / "pushea" / "hazlo tú" and expects the whole thing done.
He screenshots STALE pages constantly — if his screenshot contradicts what you
just shipped, say so plainly and check the file rather than redoing the work.
Wants problems surfaced plainly INCLUDING your own mistakes, and does not want
them dressed up. State the correction in a sentence and move on. Do not defend a
decision he did not ask for.
When he hands you a prototype or a strategy doc, port the INTENT and say out loud
which parts violate the project's own rules and what you changed. In v9 that was
the motion contract and a declining data lane; in v10 it was unsourced conversion
percentages and a rigged score. Every refusal so far has been accepted once the
honest version was built and shown to be stronger.
Rejects anything that reads as generated: numbered sublabels, bordered card grids,
questionnaire formatting, padded copy, clichés. Write prose.
