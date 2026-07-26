Chat: Datrum agency website v7

WORKING DIR: /Users/jelv/Desktop/backup 23.2.2026/DATRUM/DATRUM projects/jldatrum-PORTFOLIO/
Vanilla HTML/CSS/JS, no build step, bilingual EN + /es/. Live at https://jldatrum.com.
58 HTML pages. Every change ships in BOTH languages — the site is hand-mirrored, there is
no templating.

DEPLOY: github.com/dr-p1n/jldatrum-PORTFOLIO → Cloudflare Pages auto-deploys on
`git push origin main`. Build ~60–90s. Commit/push ONLY when the user says so
("push it" / "deploy it"). End commit messages with:
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Latest commit: 557a4ce.

⚠️ CACHE GOTCHA — cost real confusion twice. `curl` against jldatrum.com returns a STALE
edge copy even with `?nc=$RANDOM`; the query string does not bust Cloudflare Pages cache.
Always verify with `curl -s -H 'Cache-Control: no-cache' "https://jldatrum.com/...?b=$(date +%s)"`
and confirm `cf-cache-status: MISS|DYNAMIC`. A "missing" change is usually cache, not a
failed deploy. Assets carry `max-age=14400`.

VERIFY PATTERN: preview_start name "jldatrum-portfolio" (.claude/launch.json, port 3456)
→ javascript_tool for computed styles/DOM/fetch sweeps → read_console_messages.
Screenshots in the in-app browser always render from viewport top and ignore scroll, and
requestAnimationFrame is PAUSED in the hidden pane — so verify via DOM/JS, never by
screenshot alone. Foreground `sleep` is blocked; poll with `until <check>; do sleep 5; done`.

⚠️ Write throwaway generator scripts into the PROJECT ROOT and `rm` them in the SAME Bash
call — the session scratchpad is cleared between turns.

─────────────────────────────────────────────────────────────────────────────
DESIGN SYSTEM (dark editorial gallery)
bg #0C1B1F · bg2 #0E2329 · surface #0F5C6D · border #1A3A40 · teal(interactive) #1E7F98
lemon(accent/CTA/headings) #F2D24B · text #E8EDED · muted #9AABAF
Fonts: Space Grotesk (display) + DM Sans (body).
The token was renamed --coral → --lemon (value unchanged) in variables.css, components.css
and legal.css, plus the `.coral` CLASS → `.lemon`. `--coral-orange` still exists in
css/main.css and css/tailwind.css — those two files are DEAD (nothing links them). Never
sweep them.
Spacing: 8px baseline (8/16/24/32/48/64/96/144). Fixed nav is 64px, so first sections add
nav height on top of their own padding (144 desktop / 128 tablet / 112 mobile).
Typography: 5 weights in use — 300 display, 400/500/600, 700 wordmark only.

ARCHITECTURE — TWO INDEPENDENT STYLESHEET FAMILIES
  A) variables + typography + components + layout .css → 6 "marketing" pages
     (index, work/index, bio/index + /es/)
  B) legal.css (self-contained, its OWN :root, literal font names) → the other ~50
     (legal, case studies, resources, research, guides, audit)
⚠️ --font-display / --font-body DO NOT EXIST under legal.css. Anything shared must use
var(--x, literal-fallback) or it renders serif on 50 pages.

SHARED LAYER (on EVERY page): css/viz.css + js/viz.js
  · viz.css MUST NOT declare :root (there are already two).
  · js/viz.js: 11-mark icon registry (data-icon) + chart renderers (data-viz):
    radar, bar6, nodes, timeline, flow, split, flywheel, herograph.
  · NEVER fork viz.js per language — translated strings live in data-labels="A|B|C".
  · Motion contract: the UNDRAWN state is applied only by JS via .dx-anim. With JS off,
    reduced motion on, in print, or in a hidden tab, graphics render COMPLETE. Never blank.
  · js/tabs.js dispatches `tab:activate` so viz re-scans — inside display:none an
    IntersectionObserver never fires and CSS animations never run.

OTHER JS: nav.js (drawer + cookie consent; toggle/closeDrawer are null-safe),
resources.js (checklist scoring — SINGLE source of truth, dispatches `rc:update`;
viz.js consumes it and must never recompute scores), scorecard.js + scorecard.es.js
(audit widget), scroll-reveal.js, tabs.js.

⚠️ scorecard.js / scorecard.es.js are line-for-line identical except strings.
Sync gate before any push: `diff js/scorecard.js js/scorecard.es.js | grep -c '^[<>]'`
must stay 60. Do NOT touch the 1400ms downloadPDF timer (gates lead capture + Worker
POST) or the six hardcoded 326.7 ring constants.

─────────────────────────────────────────────────────────────────────────────
IA — CURRENT
Nav (everywhere): Services · Case studies · Resources · Bio · ES · Audit Your Brand
Every deep page has a hamburger + drawer beside its back link (top-right), so no page
is a dead end.

/            Home — hero (+ ambient line-graph, hidden <900px) → #offer 3-panel ROUTER
             (expands on hover/focus, stacks <820px) → #who "Who's it for?" →
             #trust compliance → #specialization one line → #contact (WhatsApp + email)
/work/       TWO tabs only: Services (6 offers + the 4 DATRUM Method pillars + the
             growth-engine flywheel) and Case studies (7). TAB_IDS=['services','work'].
/work/<7>/   go-clean · panama-treasures · verite · seguros · ag-law · obstacle-race · ucc
/audit/      The 5-question scorecard widget (MOVED off home; score counts up)
/resources/  Three <details> squares: Engineering (4 instruments) · Literary (6 research)
             · Guides (5 AEO)
/resources/{ley81,security-headers,visibility}/     the instruments
/resources/research/<6>/                            literary pieces
/resources/guides/<5>/                              AEO guides
/bio/  /security  /privacy  /subprocessors
All of the above mirrored under /es/.

CONTENT RULES THAT MATTER
· Literary (research) = argued, first person, diagnostic close, anchored to a real
  engagement. AEO guides = neutral, answer-first, H1 and every H2 phrased as the buyer's
  query, 40–60 word answer block per section that must read correctly when extracted
  ALONE. Different registers on purpose — do not merge them.
· NO invented statistics anywhere, and specifically no vendor-published AEO projections.
  Argue from mechanism.
· Case-study claims assert only what the published work-index card already asserts plus
  category-level market dynamics — never an unaudited defect about a named client.
· JSON-LD text fields must be ENTITY-DECODED (a bug shipped `&mdash;` into structured
  data once). Visible HTML keeps its entities; JSON does not.
· Spanish is written natively, not translated.

SECURITY/PERF: _headers sets HSTS(preload), an ENFORCING CSP, X-Frame-Options DENY,
X-Content-Type-Options, Referrer-Policy, Permissions-Policy.
⚠️ `img-src 'self' data:` — external images are BLOCKED and fail silently. Any new asset
host must be added to _headers or self-hosted. script-src allows only googletagmanager +
cdnjs (jsPDF).

─────────────────────────────────────────────────────────────────────────────
OPEN ITEMS
1. AG Law live URL — user is supplying it shortly. The page currently ships WITHOUT a
   "View the live site" link because the old URL was a *.pages.dev preview. Add
   `<p class="cs-live">` once the production domain arrives. Same for UCC
   (ucc-latam-demo…workers.dev) — still no production domain.
2. AG Law credential: the WBC presidency in Panama is CONFIRMED and is the only
   credential that matters. It is asserted in the copy and shown as
   "President · WBC Panama" in the credential node graph. Do NOT add WTC Panama or the
   bilateral chamber — never confirmed.
3. Research piece 7 "The Invisible Non-Event" (anchored to Verite) is NOT written —
   blocked pending client sign-off on network credits. Note: "from MTV to Netflix" is
   already public on the Verite card, so the block may be narrower than it looks
   (using them inside a failure narrative vs listing them as credits).
4. Ley 81 guide: the not-legal-advice disclaimer STAYS and the guide is being actively
   promoted — it complements the domain-security / AI-SEO / Trust Score angle. Already
   cross-linked from the Ley 81 instrument and from /security (EN + ES). Statutory
   claims should still be checked against the official text.
5. AEO guides need a semi-annual refresh (citation favours recent pages). Only bump the
   visible "Last updated" when something actually changed.
6. Case-study accent images: deliberately NOT added. The four newer pages already carry a
   hero photo + a bespoke SVG diagram; generic stock would be a third figure and the
   site's first purely decorative image, against the rule that images must be proof.
   Real client photography would help; stock would not.
7. Editable working files in repo root (untracked/tracked): DATRUM-copy-EN.txt,
   DATRUM-copy-ES.txt, DATRUM-current-copy.txt, HOME-COPY-BRIEF.md.
8. When OG/share text changes, re-scrape via LinkedIn Post Inspector / Facebook Sharing
   Debugger (WhatsApp piggybacks on the FB cache).
