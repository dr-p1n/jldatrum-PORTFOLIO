Chat: Datrum studio website v9

WORKING DIR: /Users/jelv/Desktop/backup 23.2.2026/DATRUM/DATRUM projects/jldatrum-PORTFOLIO/
Vanilla HTML/CSS/JS, no build step, bilingual EN + /es/. Live at https://jldatrum.com.
38 content pages + 404.html. Every change ships in BOTH languages — the site is
hand-mirrored, there is no templating.

DEPLOY: github.com/dr-p1n/jldatrum-PORTFOLIO → Cloudflare Pages auto-deploys on
`git push origin main`. Build ~60–90s. Commit/push ONLY when the user says so
("push it" / "pushea" / "deploy"). End commit messages with:
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Latest commit: cf5ed70 "Make the local preview behave like Cloudflare Pages".

⚠️ THE WORKER IS DEPLOYED SEPARATELY AND IS OFTEN THE REAL BLOCKER.
Site changes go live on push. Anything under worker/ does NOT — the user must run:
  cd "…full path…" && git pull origin main && cd worker && wrangler deploy
Always give the FULL path, never `…/` — the user pasted an ellipsis literally once.

─────────────────────────────────────────────────────────────────────────────
LOCAL PREVIEW — use tools/serve.py, NOT python -m http.server
`python3 tools/serve.py 3456` (wired into .claude/launch.json). It resolves
clean URLs (/security → security.html), applies the 22 rules in _redirects, and
serves 404.html with a real 404. Plain http.server 404s on /security and ignores
redirects entirely, which has caused wrong conclusions more than once.

VERIFY IN A REAL BROWSER, NOT BY READING CSS. Playwright is available:
  import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
  chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
Screenshot and LOOK at visual changes. Two bugs this session shipped from reading
code instead: a hit-area that didn't match its highlight, and a class collision.
When forcing animated state for a screenshot, add BOTH `.visible` (fade-up) and
`.is-drawn` (dx-anim), and wait past the longest `--delay` (up to 1s).

⚠️ Throwaway scripts go in the PROJECT ROOT and are `rm`'d in the SAME Bash call.
.gitignore now covers `_*.py` and `_*.mjs` because one survived and shipped.
NEVER use `pkill` — it kills the agent's own shell (exit 144). Leave servers running.
Chain commands so a failed check actually blocks the commit; `echo "exit=$?"`
between them resets the status and a broken validator once let a push through.

⚠️ NETWORK: this session cannot reach jldatrum.com, api.cloudflare.com, or the
worker — the proxy 403s CONNECT. Never claim a live verification you did not do.
Give the user the curl to run. Assets carry max-age=14400, so tell them to hard
refresh (Cmd+Shift+R) or they will see stale CSS and think the change failed.

─────────────────────────────────────────────────────────────────────────────
DESIGN SYSTEM (dark editorial gallery)
bg #0C1B1F · bg2 #0E2329 · surface #0F5C6D · border #1A3A40 · teal(interactive) #1E7F98
lemon(accent/CTA) #F2D24B · text #E8EDED · muted #9AABAF
Fonts: Space Grotesk (display) + DM Sans (body). Fixed nav 64px.
`--coral-orange` still exists in css/main.css and css/tailwind.css — those two files
are DEAD (nothing links them). Never sweep them.

USER'S SPACING/TYPE RULES (he supplied these; follow them):
8px scale — 4, 8, 12, 16, 24, 32, 40, 48, 64. Weights: 400 body, 500 labels,
600 headings; thin weights are for display sizes only. 60-30-10 colour. When in
doubt add whitespace, reduce colour noise, lower weight before adding bold.
Always compute contrast before choosing a colour — every value shipped this
session was checked against WCAG AA first.

TWO INDEPENDENT STYLESHEET FAMILIES
  A) variables + typography + components + layout .css → index, work/index, bio (+/es/)
  B) legal.css (self-contained, its OWN :root, literal font names) → everything else
⚠️ --font-display / --font-body DO NOT EXIST under legal.css. Anything shared must
use var(--x, literal-fallback) or it renders serif on ~30 pages.
⚠️ legal.css has exactly ONE :root. viz.css must declare none (its two matches are
the comment documenting that rule).
⚠️ Generic `h2 { margin: 56px 0 16px }`, `section h2`, `section h3` and
`a { color: lemon; text-decoration: underline }` all reach into components.
A class-only selector must state margin AND colour explicitly. The generic `a`
is also INLINE: an anchor given block children without display:block wraps one
word per line. Prefer `<h3><a>…</a></h3>` over wrapping a block in `<a>`.
⚠️ The rc-* namespace is crowded and bit hard: `.rc-box` is the Ley 81 checkbox
(20×20) and is STILL LIVE in the security-headers checklist. Check what the
markup actually uses before assuming a class is retired.

SHARED LAYER (every page): css/viz.css + js/viz.js
  · icon registry (data-icon, 8 marks in use) + chart renderers (data-viz).
    SIX renderers: compound, flow, flywheel, nodes, split, timeline.
    radar and bar6 were deleted with the pages that used them.
  · NEVER fork viz.js per language — translated strings live in data-labels="A|B|C".
  · Motion contract: the UNDRAWN state is applied ONLY by JS via .dx-anim. With JS
    off, reduced motion on, in print, or in a hidden tab, graphics render COMPLETE.
  · SVG text scales with the viewBox: 11px in a 552-unit box renders near 8px.
    Size type in user units.

OTHER JS: nav.js (drawer + cookie consent), scan.js (client for BOTH instruments),
scroll-reveal.js, tabs.js. js/resources.js is DELETED.
⚠️ js/scan.js reads strings via `root.dataset[key]`, NOT getAttribute — HTML
lowercases attribute names, so getAttribute("data-scoreLabel") silently misses.
⚠️ Remote strings go through textContent, never innerHTML.

─────────────────────────────────────────────────────────────────────────────
THE TWO INSTRUMENTS — one worker, one client, two modes
worker/ai-visibility-scanner.js → ai-visibility.julioernestolv.workers.dev
worker/scanner.test.mjs (108 tests) · KV RATE = 1361a8801c4f4c8ca804168b8c93a3d6
The Worker keeps the name ai-visibility even though the instruments were renamed;
it is referenced in both pages and in connect-src of _headers.

POST /scan {url, lang, mode} → {url, lang, score, grade, passed, total, checks[]}
  mode ""        → AI Accessibility Scanner (26 checks: entity/access/retrieval)
  mode "headers" → Domain Security & Trust Index (7 checks: HTTPS + 6 headers)
Both return the IDENTICAL shape, so js/scan.js renders both with no branching.
The page declares data-mode and data-compact.

RESULTS UI: gaps first, worst deduction first, as a table; passing checks collapse
to a tally of names. data-compact drops the area tag for the headers instrument.

DESIGN RULES THAT WERE HARD-WON — do not undo:
· Absence of JSON-LD is priced ONCE at -40, not cascaded into seven deductions.
· The description check does NOT penalise >160 chars — that is a SERP rendering
  limit, not a retrieval one. Reported at zero cost.
· SSRF guardrails are an explicit range enumeration, NOT a regex.
· A 403 is explained, not reported: it means bot protection, and the same WAF rule
  frequently blocks GPTBot. Says to confirm against the site's own rules rather
  than inferring it — do not upgrade that into a claim.
· Header check titles name what the header PREVENTS, never the header. A test
  asserts no title contains "Content-Security-Policy" etc.
· Header reasons are capped at 84 chars so seven of them read as a table. The test
  caps length; the old test set a MINIMUM and that is how 266-char reasons shipped.
· Weights follow Observatory's ordering of harm. It is NOT Observatory and must
  never claim its score.
· 2 MB cap, 8s timeout, 10 scans/IP/hour via KV.
Endpoint appears in THREE places that must stay in sync: data-endpoint in
/resources/scan/ and /resources/security-headers/, and connect-src in /_headers.

─────────────────────────────────────────────────────────────────────────────
IA — CURRENT (38 pages)
Nav: Services · Case studies · Resources · Bio · ES · **Scan your site →**
/            Home — hero is TWO COLUMNS: headline+CTAs left, sub + `compound`
             diagram right; stacks below 900px. Eyebrow "Marketing Product design
             studio" pulses muted↔lemon on an inner .eyebrow-pulse span (because
             .eyebrow is also .fade-up and would lose the single animation slot).
             H1 is a SINGLE colour var(--teal) — the tricolor was removed on purpose.
/work/       Two tabs: Services + Case studies (7). TAB_IDS=['services','work'].
/work/<7>/   go-clean · panama-treasures · verite · seguros · ag-law · obstacle-race · ucc
/resources/  TWO panels: "AI Visibility" (lemon fill) and "Literary" (dark).
             Rows highlight on hover, whole row clickable via a stretched ::after.
/resources/{scan,security-headers}/   the two instruments — field + results ONLY,
             no explanatory prose. The user removed it twice; do not put it back.
/resources/guides/<3>/  how-ai-engines-recommend-businesses · bilingual-website-architecture
                        · structured-data-high-value-inventory
/bio/  /security  /privacy  /subprocessors  /404.html
All mirrored under /es/ except 404.html. Deep pages: back link at the TOP OF THE
CONTENT COLUMN above the title; wordmark left, ES chip + hamburger right.

DELETED (301'd in _redirects, 22 rules — do not resurrect):
/audit/, /resources/visibility/, /resources/ley81/, three research pieces
(the-spreadsheet-is-the-cms, the-trade-already-has-structured-data,
instruments-beat-pitches), two folded guides, three earlier research pieces.
⚠️ Cloudflare Pages falls back to the root index when a path is missing and no
404.html exists — that is how fourteen deleted URLs once returned 200. Never
delete 404.html.

ROOT: robots.txt (16 AI crawlers + sitemap), sitemap.xml, llms.txt, _redirects,
404.html, _headers, tools/serve.py. Regenerate sitemap and llms.txt when pages change.

─────────────────────────────────────────────────────────────────────────────
CONTENT RULES
· NO NUMBERED SUBLABELS ("Instrument 01"). He rejects them on sight.
· NO QUESTION-AND-ANSWER BODY COPY. Guides are THREE PARAGRAPHS, claim stated flat.
· Instruments are tools, not essays: field and results, nothing else.
· NO invented statistics, and no vendor AEO projections. Argue from mechanism.
  This extends to graphics — a rising curve is a projection. The hero diagram
  shows what is left standing after equal spend, with no axis values.
· Case-study claims assert only what the published work-index card already asserts.
· JSON-LD must be ENTITY-DECODED: json.dumps(ensure_ascii=True). Rewrite only the
  payload so surrounding indentation survives, and only blocks that actually
  changed — reserialising every block churns 39 files for whitespace.
· Spanish is written natively, and is TUTEO. Voseo has been removed twice.
· Positioning is STUDIO, not agency, in every machine-readable field. The word
  "agencies" survives in the hero sub describing what other firms do.

STRUCTURED DATA: all 38 pages carry the FULL Organization node sharing
@id https://jldatrum.com/#organization — exactly two description variants, one
per language. Invariants after any bulk edit: one H1 per page, no skipped
heading levels, zero HTML entities inside JSON-LD, no dead internal links.

SECURITY/PERF: _headers sets HSTS(preload), enforcing CSP, X-Frame-Options DENY,
X-Content-Type-Options, Referrer-Policy, Permissions-Policy.
⚠️ `img-src 'self' data:` — external images are BLOCKED and fail silently.
connect-src allows only the scanner worker + GA.

─────────────────────────────────────────────────────────────────────────────
OPEN ITEMS

1. ⚠️ URGENT, DNS not code: `_dmarc.jldatrum.com` has TWO DMARC records. Per RFC
   7489 more than one is treated as NONE, so DMARC is NOT enforcing today — while
   /security claims "DKIM, SPF, DMARC enforced". Delete the `p=none` one. No DNS
   write token in-session.
2. Email migration Google Workspace → Hostinger. Verified values:
     MX  @ 5 mx1.hostinger.com · @ 10 mx2.hostinger.com  (delete Google's first)
     SPF v=spf1 include:_spf.google.com include:_spf.mail.hostinger.com ~all
     DKIM three CNAMEs (hostingermail-a/b/c._domainkey → …dkim.mail.hostinger.com),
     DNS-only/grey cloud or lookup fails.
   Order: mailbox → DKIM+SPF → fix DMARC → flip MX → verify → tighten.
   After: /subprocessors must list Hostinger, and re-verify the /security claim.
3. OG/twitter descriptions changed to "studio" — needs a re-scrape via LinkedIn
   Post Inspector and Facebook Sharing Debugger (WhatsApp uses the FB cache).
4. UNANSWERED: his message cut off at "3. tenemos likn". Ask what it was.
5. Calendly: https://calendly.com/julio-jldatrum works but he asked to point it at
   julioernestolv@gmail.com; unclear if that slug is the right account. He later
   said "forget about calendly" — confirm before touching.
6. AG Law and UCC have no production URL, so neither ships a `<p class="cs-live">`.
   AG Law credential: WBC presidency in Panama is CONFIRMED and is the only one.
   Do NOT add WTC Panama or the bilateral chamber.
7. Research piece "The Invisible Non-Event" (Verite) NOT written — blocked on
   client sign-off on network credits.
8. Ley 81 not-legal-advice framing stays wherever statutory claims appear.
9. Three classes in markup have no CSS anywhere: bio-text, router-top,
   dx-viz--flywheel. Pre-existing no-ops; may be styles lost in an old refactor.
10. Stale working files in root: DATRUM-copy-EN.txt, DATRUM-copy-ES.txt,
    DATRUM-current-copy.txt, HOME-COPY-BRIEF.md, "datrum website copy.txt".
    They record OLD hero copy, the old eyebrow and retired numbered sublabels.
11. Footer still says "Design and engineering for high-stakes digital
    infrastructure" on ~12 pages.

HOW THE USER WORKS
Terse, fast, decisive. Sends corrections mid-turn — act on them in the same turn.
Says "arreglalo" / "pushea" and expects the whole thing done, not a plan.
Wants problems surfaced plainly INCLUDING your own mistakes — he pushed back hard
when prose he never asked for was kept, and when a diagnosis blamed cache instead
of a real collision. Do not defend a decision he did not ask for. Rejects anything
that reads as generated: numbered sublabels, questionnaire formatting, padded copy,
clichés (he killed a hockey-stick chart on sight). Write prose.
Reply in the language he last used.
