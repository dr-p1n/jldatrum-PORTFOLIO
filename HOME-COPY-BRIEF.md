# DATRUM — Home page copy brief
Paste this whole file into Claude chat. It contains everything needed to write the
home page without duplicating the Services tab.
Snapshot of live source: 2026-07-25.

---

## THE PROBLEM YOU ARE SOLVING

The home page currently **repeats the Services tab almost verbatim**, in two places.
That is the single thing this rewrite must fix.

| Duplicated block | On HOME | On WORK page | Status |
|---|---|---|---|
| Heading "What we build." | `#offer` — 3 service cards | `#services` — 6 service cards | **Same heading, same job, two pages** |
| Heading "The DATRUM method." | `#method` — 3 pillars | `#framework` — 4 pillars | **Same name, two different pillar sets** |

Worse, the two versions **contradict each other**:

- Home's services are named *Marketing Product Design · Lead Generation Systems ·
  AI Search Visibility*. The Services tab names them *Product Design · Marketing
  Strategy · Lead Generation Engines · Website Design · Web App & App Development ·
  AI Search Visibility*. A reader who visits both cannot tell how many services exist.
- Home's method pillars are **marketing-framed** (Distribution systems / Growth
  engines / Design + engineering). The Method tab's are **technical** (Secure
  Infrastructure / Heading Architecture / JSON-LD Schema / Information Architecture).
  Same brand, two different methods.

**The rule for the rewrite:** the deep pages own the detail. Home earns the click.
Home should never be a shorter list of the same items — it should make an argument
the deep pages then prove.

---

## SITE MAP — what already lives where (do NOT rewrite these)

| Page | Owns |
|---|---|
| `/work/` → Services tab | The **6 services**, in full. The definitive list. |
| `/work/` → DATRUM Method tab | The **4 technical pillars**, in full. |
| `/work/` → Case studies tab | 7 client cards → 7 detail pages |
| `/work/` → Who It's For tab | The fit / not-a-fit qualifier |
| `/resources/` | 4 free instruments (Ley 81, Security Headers, Visibility, Audit) + long-form research |
| `/bio/` | "Hi, I'm Julio." — the one-operator, three-disciplines thesis |
| `/security`, `/privacy`, `/subprocessors` | Compliance detail |

---

## WHAT THE HOME PAGE IS FOR

One job: **convert a cold, high-stakes buyer into an Audit start.**

The audience: owners and executives of high-trust businesses whose buyers vet them
digitally before any human contact — insurance, legal, industrial services, media,
events. Their reputation is already real offline. It is not converting online.

The central thesis (this is the whole pitch):
> Most marketing is rent — you stop paying, it stops working. DATRUM builds digital
> products whose value **compounds**, so marketing becomes an asset on the balance
> sheet rather than a recurring cost.

---

## PAGE STRUCTURE — the slots to fill

Sections are fixed (they are wired to the build). Write copy for each.

### 1. HERO — `#home`
Currently:
- Eyebrow: `B2B Marketing Asset Design Agency`
- H1: *Digital products that transform your marketing into a value-generating asset.*
- Sub: *I build digital products and campaigns whose value increases over time — so
  you stop paying rent for attention and start accumulating digital capital.*
- CTA: `See our work →`

Constraints: H1 is a **single sentence**, 8–14 words, set in 300-weight display type
— it must read cleanly at 56px. Two accent spans are available for colour emphasis.
Sub is 1–2 sentences, ≤ 220 characters.

### 2. SERVICES TEASER — `#offer`  ⚠️ THE MAIN REWRITE
Currently a 3-card mini-version of the Services tab. **Stop doing that.**

What it should be instead: a short argument for *why the work is built differently* —
one operator running security, data and design as one system, with no handoffs — that
ends by pointing at the full list. Three cards are available, but they should be
**three reasons / three outcomes, not three product names.**

Needs: a section heading (≠ "What we build."), a 1–2 sentence lead, 3 × (short label
+ 1–2 sentence body ≤ 200 chars), and a link labelled to the Services tab.

### 3. METHOD TEASER — `#method`
Currently 3 marketing-framed pillars that conflict with the Method tab's 4 technical
ones. **Pick one canonical framing.** Recommended: home describes the *shape* of the
method in prose; the Method tab keeps the 4 technical pillars as the detail.

The third pillar carries an animated flywheel graphic whose three labels are now:
**Authority & expertise → Educational resources → Compounding marketing asset.**
The pillar's prose must match that loop. Its current text still says *"attention
becomes booked deals, booked deals sharpen the loop"* — **this needs rewriting.**

Needs: heading, 1–2 lead paragraphs, 3 × (label + body ≤ 200 chars), link to Method tab.

### 4. STANDARDS — `#trust`
Keep as is unless asked. Three compliance cards, each linking into `/security`:
GDPR (Compliant) · PCI DSS (SAQ A Self-Attested) · Ley 81 PA (Compliant).
Current heading: *Standards we engineer to.*

### 5. AUDIT — `#diagnose`
The conversion moment. Interactive 5-question widget, animated score 0–10, PDF report.
Current title: *Your brand is either bringing clients to you — or it isn't.*
Body ≤ 300 chars. Three feature bullets: instant score / PDF breakdown / no obligation.
**Do not weaken this section — it is the page's only real conversion point.**

---

## VOICE

- **First person singular.** "I build", not "we leverage". One operator is the story.
- **Industry-neutral.** Say "high-stakes / high-trust businesses whose buyers vet them
  digitally before human contact." Never name sports, fashion, or "tastemakers" —
  that framing is retired.
- **Show asymmetry through mechanics, never announce it.** Don't write "we're
  different"; describe the thing competitors structurally cannot do.
- **Concrete over abstract.** "A procurement officer has a checklist and data handling
  is on it" beats "we optimise trust signals."
- **No invented numbers.** No fake stats, percentages, or client metrics. Ever.
- Em-dashes are on-brand. Avoid exclamation marks and growth-hack register.

## HARD CONSTRAINTS

- Everything ships **EN + ES**. Write English; Spanish is a separate genuine
  translation, not machine output. Keep sentences translatable (avoid puns).
- **Never repeat the 6 service names or the 4 method pillars on home.** Link instead.
- H1 must stay one sentence. Section headings are 2–5 words.
- Card bodies ≤ 200 characters or the 3-up grid breaks.
- Keep every existing link target: `/work/`, `/resources/`, `/bio/`, `/#diagnose`,
  `/security`.

## DELIVERABLE REQUESTED

For each of sections 1, 2, 3: heading, lead, and the three label + body pairs —
plus two alternative H1 options for the hero. Flag anything that would contradict
what the Services or Method tabs already say.

---

# APPENDIX A — THE DUPLICATED COPY, VERBATIM

Both blocks below are live on the site right now. Read them side by side:
this is the redundancy the rewrite has to remove.


## "What we build." — SERVICES

### HOME  ·  index.html  §#offer  (3 cards)

```
What we build.
Three engines that turn your reputation into signed deals — with a build quality most agencies can't match, because they don't run security, data, and design out of one head.
Marketing Product Design
A digital product that closes deals while you sleep — websites and apps engineered to convert, built to the caliber your name already carries. Not a brochure. A salesperson that never logs off.
Lead Generation Systems
Qualified prospects arriving on their own, pre-warmed and ready to book. Capture, follow-up, and search working as one loop — so you stop chasing attention and start fielding it.
AI Search Visibility
Be the name the AI recommends. When a buyer asks ChatGPT, Perplexity, or Google who to hire in your field, structured data I build into the site puts you in the answer — not on page two of the old web.
See all services →
```

### WORK  ·  /work/  §#services  (6 cards) — THE CANONICAL LIST

```
What we build.
Product Design
A digital product your clients actually want to use — booking platforms, portals, apps designed to the caliber of your work.
Marketing Strategy
A position your competitors can't occupy — because it's built on the story only you can tell, aimed at the exact audience that pays. I define how you show up before a single thing gets built.
Lead Generation Engines
The system that turns attention into booked calls and signed clients — funnels, capture, follow-up, and search visibility working together so qualified leads arrive on autopilot.
Website Design
A site that stops a scroll and holds its own next to the biggest names in your field — distinctive, fast, and built to convert. It looks like you and works like your best salesperson.
Web App & App Development
Custom web and mobile products — booking systems, portals, fan platforms, internal tools. Modern build, fast deploy, designed so the people using it come back. Engineered, not templated.
AI Search Visibility
Your name in the AI's answer, not buried in the old blue links. ChatGPT, Perplexity, and Google's AI are the new homepage — I structure your site's data so you're the one they surface when a buyer asks who to hire.
```


## "The DATRUM method." — METHOD

### HOME  ·  index.html  §#method  (3 pillars, marketing-framed)

```
The DATRUM method.
Our philosophy lives at the intersection of technology and art: design as an agent of change. Market advantages come from tactics competitors can't replicate — and that's where the methodology begins: the asymmetric design of opportunity.
Demand that arrives instead of demand you chase — that's the outcome. The reason it works is a method most studios structurally can't run: distribution, growth engineering, and editorial craft built by one operator, so nothing gets lost in a handoff.
Distribution systems
Your brand in front of the exact regional audience that can afford you — placed across search, AI results, and the channels higher-end buyers actually use. Reach is easy; reaching the right room is the work.
Growth engines
A closed loop that compounds month over month — attention becomes booked deals, booked deals sharpen the loop. The system gets better while you do nothing to it.
Design + engineering
Work that looks like the top of your market and performs like infrastructure. Product design, software, data, and security under one roof — no agency-to-freelancer telephone game degrading the result.
See the full method →
```

### WORK  ·  /work/  §#framework  (4 pillars, technical) — CANONICAL

```
The DATRUM methodology
The outcome is a presence that earns rankings, references, and trust on its own. The reason it works: I treat security, structure, schema, and strategy as one system — the same disciplines most agencies split across four vendors who never talk.
01
Secure Infrastructure
A search engine rewards a hardened site — and a serious buyer trusts one. I ship the exact security signals that earn both, on every site. Most agencies don't touch this layer; for me it's where distribution starts.
02
Heading Architecture
A per-page heading strategy that maps your industry as a network of information — positioning you as the authority and making the site effortless for search and AI to read. Structure is strategy made visible.
03
JSON-LD Schema (AI SEO)
Structured data written into your campaigns, content, and products so AI engines can quote you directly. This is the difference between being on the web and being the answer the web gives.
04
Information Architecture
Creative direction for the rollout of short- and long-term distribution campaigns, driven by data mining — the editorial eye and the data layer working as one, not fighting each other.
```


---

# APPENDIX B — HOME PAGE HTML (index.html)

Scripts and inline SVG stripped for readability; structure and copy are exact.
Section ids are wired to the build — keep them.

```html
<body>
<!-- MOBILE DRAWER -->
<div class="nav-drawer" id="navDrawer" aria-hidden="true" role="dialog">
  <a href="#offer" onclick="closeDrawer()">Services</a>
  <a href="#method" onclick="closeDrawer()">DATRUM Method</a>
  <a href="/work/" onclick="closeDrawer()">Case studies</a>
  <a href="/resources/" onclick="closeDrawer()">Resources</a>
  <a href="/bio/" onclick="closeDrawer()">Bio</a>
  <a href="/es/" onclick="closeDrawer()" lang="es" hreflang="es">ES</a>
  <a href="#diagnose" class="btn-diagnose-drawer" onclick="closeDrawer()">Audit Your Brand →</a>
</div>
<!-- NAV -->
<nav>
  <a href="#home" class="nav-logo">
    <span class="nav-brand">DATRUM</span>
  </a>
  <div class="nav-links">
    <a href="#offer">Services</a>
    <a href="#method">DATRUM Method</a>
    <a href="/work/">Case studies</a>
    <a href="/resources/">Resources</a>
    <a href="/bio/">Bio</a>
    <a href="/es/" lang="es" hreflang="es" class="nav-lang">ES</a>
    <a href="#diagnose" class="btn-diagnose">Audit Your Brand →</a>
  </div>
  <button class="hamburger" id="hamburger" aria-label="Menu" aria-expanded="false" onclick="toggleDrawer()">
    <span></span><span></span><span></span>
  </button>
</nav>
<!-- ── SECTION 1: HERO ──────────────────────────────── -->
<section id="home">
  <div class="section-inner">
    <div class="dx-hero" data-viz="herograph" aria-hidden="true"></div>
    <div class="eyebrow fade-up" style="--delay:0.2s">
      <span class="pulse-dot"></span>
      B2B Marketing Asset Design Agency
    </div>
    <h1 class="hero-title fade-up" style="--delay:0.4s">
      <em>Digital products</em> that transform your marketing into <span class="lemon">a value-generating asset.</span>
    </h1>
    <p class="hero-sub fade-up" style="--delay:0.6s">
      I build digital products and campaigns whose value increases over time — so you stop paying rent for attention and start accumulating digital capital.
    </p>
    <div class="hero-actions fade-up" style="--delay:0.8s">
      <a href="/work/" class="btn-primary">See our work →</a>
    </div>
  </div>
</section>
<!-- ── SERVICES TEASER ──────────────────────────────── -->
<section id="offer">
  <div class="section-inner">
    <h2 class="section-title">What we build.</h2>
    <p class="section-lead">Three engines that turn your reputation into signed deals — with a build quality most agencies can't match, because they don't run security, data, and design out of one head.</p>
    <div class="services-grid">
      <article class="service-cell fade-up" style="--delay:0.1s">
        <span class="dx-icon" data-icon="layers" aria-hidden="true"></span>
        <h3 class="service-name">Marketing Product Design</h3>
        <p class="service-desc">A digital product that closes deals while you sleep — websites and apps engineered to convert, built to the caliber your name already carries. Not a brochure. A salesperson that never logs off.</p>
      </article>
      <article class="service-cell fade-up" style="--delay:0.2s">
        <span class="dx-icon" data-icon="bars" aria-hidden="true"></span>
        <h3 class="service-name">Lead Generation Systems</h3>
        <p class="service-desc">Qualified prospects arriving on their own, pre-warmed and ready to book. Capture, follow-up, and search working as one loop — so you stop chasing attention and start fielding it.</p>
      </article>
      <article class="service-cell fade-up" style="--delay:0.3s">
        <span class="dx-icon" data-icon="mesh" aria-hidden="true"></span>
        <h3 class="service-name">AI Search Visibility</h3>
        <p class="service-desc">Be the name the AI recommends. When a buyer asks ChatGPT, Perplexity, or Google who to hire in your field, structured data I build into the site puts you in the answer — not on page two of the old web.</p>
      </article>
    </div>
    <a href="/work/#services" class="offer-more">See all services →</a>
  </div>
</section>
<!-- ── DATRUM METHOD ───────────────────────────────── -->
<section id="method">
  <div class="section-inner">
    <h2 class="section-title">The DATRUM method.</h2>
    <p class="section-lead">Our philosophy lives at the intersection of technology and art: design as an agent of change. Market advantages come from tactics competitors can't replicate — and that's where the methodology begins: the asymmetric design of opportunity.</p>
    <p class="section-lead">Demand that arrives instead of demand you chase — that's the outcome. The reason it works is a method most studios structurally can't run: distribution, growth engineering, and editorial craft built by one operator, so nothing gets lost in a handoff.</p>
    <div class="method-grid">
      <article class="method-pillar fade-up" style="--delay:0.1s">
        <span class="dx-icon" data-icon="globe" aria-hidden="true"></span>
        <div class="method-kicker">Distribution systems</div>
        <p class="method-body">Your brand in front of the exact regional audience that can afford you — placed across search, AI results, and the channels higher-end buyers actually use. Reach is easy; reaching the right room is the work.</p>
      </article>
      <article class="method-pillar fade-up" style="--delay:0.2s">
        <span class="dx-icon" data-icon="bars" aria-hidden="true"></span>
        <div class="method-kicker">Growth engines</div>
        <p class="method-body">A closed loop that compounds month over month — attention becomes booked deals, booked deals sharpen the loop. The system gets better while you do nothing to it.</p>
              <div class="dx-viz dx-viz--flywheel" data-viz="flywheel" data-labels="Authority &amp; expertise|Educational resources|Compounding marketing asset"></div>
      </article>
      <article class="method-pillar fade-up" style="--delay:0.3s">
        <span class="dx-icon" data-icon="layers" aria-hidden="true"></span>
        <div class="method-kicker">Design + engineering</div>
        <p class="method-body">Work that looks like the top of your market and performs like infrastructure. Product design, software, data, and security under one roof — no agency-to-freelancer telephone game degrading the result.</p>
      </article>
    </div>
    <a href="/work/#framework" class="offer-more">See the full method →</a>
  </div>
</section>
<!-- ── TRUST & COMPLIANCE ──────────────────────────── -->
<section id="trust">
  <div class="section-inner">
    <h2 class="section-title">Standards we engineer to.</h2>
    <p class="section-lead">High-stakes buyers vet you digitally before they ever call. These aren't badges — they're the signals that tell a serious client, and a search engine, that you're safe to trust.</p>
    <div class="trust-grid">
      <a href="/security#gdpr" class="trust-cell fade-up" style="--delay:0.1s">
        <!-- icon -->
        <div class="trust-badge">GDPR</div>
        <h3 class="trust-name">Compliant</h3>
        <p class="trust-desc">
          We meet EU General Data Protection Regulation requirements — transparency under Articles 13–14, lawful basis documented, data-subject rights honored. Cookie consent before tracking. Subprocessors disclosed.
        </p>
        <span class="trust-link">Read our GDPR posture →</span>
      </a>
      <a href="/security#pci" class="trust-cell fade-up" style="--delay:0.2s">
        <!-- icon -->
        <div class="trust-badge">PCI DSS</div>
        <h3 class="trust-name">SAQ A Self-Attested</h3>
        <p class="trust-desc">
          DATRUM does not store, process, or transmit cardholder data. We engineer flows that fully outsource payment handling to PCI Level 1 processors (Stripe, Adyen) — keeping client merchants in SAQ A scope.
        </p>
        <span class="trust-link">Read our SAQ A attestation →</span>
      </a>
      <a href="/security#ley81" class="trust-cell fade-up" style="--delay:0.3s">
        <!-- icon -->
        <div class="trust-badge">Ley 81 PA</div>
        <h3 class="trust-name">Compliant</h3>
        <p class="trust-desc">
          Panama's Personal Data Protection Law (Ley 81 de 2019). Built into every client site we deliver — explicit consent, data-subject access rights, retention controls, breach-notification readiness.
        </p>
        <span class="trust-link">Read our Ley 81 implementation →</span>
      </a>
    </div>
  </div>
</section>
<!-- ── THE AUDIT ────────────────────────────────────── -->
<section id="diagnose">
  <div class="section-inner">
    <div class="diagnostic-wrap">
      <!-- Left column -->
      <div class="fade-up">
        <h2 class="diag-title">Your brand is either bringing clients to you — or it isn't.</h2>
        <p class="diag-body">
          Five questions. An instant score, and a breakdown of exactly where you're leaking revenue right now. No pitch — just your numbers, and the honest picture of what your presence is costing you every month it stays as-is.
        </p>
        <div class="feature-list">
          <div class="feature-item">
            <div class="feature-icon"><!-- icon --></div>
            <div class="feature-text">
              <div class="feature-title">Instant score (0–10)</div>
              <div class="feature-desc">Weighted across 5 brand performance dimensions</div>
            </div>
          </div>
          <div class="feature-item">
            <div class="feature-icon"><!-- icon --></div>
            <div class="feature-text">
              <div class="feature-title">PDF breakdown</div>
              <div class="feature-desc">Downloadable report with per-dimension analysis</div>
            </div>
          </div>
          <div class="feature-item">
            <div class="feature-icon"><!-- icon --></div>
            <div class="feature-text">
              <div class="feature-title">No obligation</div>
              <div class="feature-desc">Useful whether you hire me or not</div>
            </div>
          </div>
        </div>
      </div>
      <!-- Widget -->
      <div class="widget fade-up">
        <div class="widget-header">
          <div class="widget-title">Brand Revenue Audit</div>
          <div class="live-badge">LIVE</div>
        </div>
        <!-- Progress bar (6 segments: 5 Qs + email) -->
        <div class="progress-bar" id="progressBar">
          <div class="progress-seg active" id="seg0"></div>
          <div class="progress-seg" id="seg1"></div>
          <div class="progress-seg" id="seg2"></div>
          <div class="progress-seg" id="seg3"></div>
          <div class="progress-seg" id="seg4"></div>
          <div class="progress-seg" id="seg5"></div>
        </div>
        <!-- Step 1 -->
        <div class="step active" id="step-0">
          <p class="step-question">How many new qualified leads does your website generate per month?</p>
          <div class="options">
            <button class="option-btn" onclick="selectOption(0, 10, this)">
              <span class="opt-badge">A</span>
              <span class="opt-text">5 or more new leads/month</span>
            </button>
            <button class="option-btn" onclick="selectOption(0, 5, this)">
              <span class="opt-badge">B</span>
              <span class="opt-text">2 to 4 leads/month</span>
            </button>
            <button class="option-btn" onclick="selectOption(0, 1, this)">
              <span class="opt-badge">C</span>
              <span class="opt-text">0 to 1 / don't know</span>
            </button>
          </div>
        </div>
        <!-- Step 2 -->
        <div class="step" id="step-1">
          <p class="step-question">What percentage of those leads are actually qualified for your practice?</p>
          <div class="options">
            <button class="option-btn" onclick="selectOption(1, 10, this)">
              <span class="opt-badge">A</span>
              <span class="opt-text">75%+ are real opportunities</span>
            </button>
            <button class="option-btn" onclick="selectOption(1, 5, this)">
              <span class="opt-badge">B</span>
              <span class="opt-text">50–75% are qualified</span>
            </button>
            <button class="option-btn" onclick="selectOption(1, 1, this)">
              <span class="opt-badge">C</span>
              <span class="opt-text">Less than 50% — mostly wrong fit</span>
            </button>
          </div>
        </div>
        <!-- Step 3 -->
        <div class="step" id="step-2">
          <p class="step-question">When prospects search for your practice area, do they find you?</p>
          <div class="options">
            <button class="option-btn" onclick="selectOption(2, 10, this)">
              <span class="opt-badge">A</span>
              <span class="opt-text">Yes — top 3 results for my main keywords</span>
            </button>
            <button class="option-btn" onclick="selectOption(2, 5, this)">
              <span class="opt-badge">B</span>
              <span class="opt-text">Sometimes — page 1 or 2 for some terms</span>
            </button>
            <button class="option-btn" onclick="selectOption(2, 1, this)">
              <span class="opt-badge">C</span>
              <span class="opt-text">Rarely or never</span>
            </button>
          </div>
        </div>
        <!-- Step 4 -->
        <div class="step" id="step-3">
          <p class="step-question">Are the leads you get attracting the clients you actually want?</p>
          <div class="options">
            <button class="option-btn" onclick="selectOption(3, 10, this)">
              <span class="opt-badge">A</span>
              <span class="opt-text">Mostly right-fit clients</span>
            </button>
            <button class="option-btn" onclick="selectOption(3, 5, this)">
              <span class="opt-badge">B</span>
              <span class="opt-text">Mixed bag</span>
            </button>
            <button class="option-btn" onclick="selectOption(3, 1, this)">
              <span class="opt-badge">C</span>
              <span class="opt-text">Mostly wrong-fit or low-value</span>
            </button>
          </div>
        </div>
        <!-- Step 5 -->
        <div class="step" id="step-4">
          <p class="step-question">How many hours/week does your firm spend on outbound marketing?</p>
          <div class="options">
            <button class="option-btn" onclick="selectOption(4, 10, this)">
              <span class="opt-badge">A</span>
              <span class="opt-text">0–5 hours/week</span>
            </button>
            <button class="option-btn" onclick="selectOption(4, 5, this)">
              <span class="opt-badge">B</span>
              <span class="opt-text">5–15 hours/week</span>
            </button>
            <button class="option-btn" onclick="selectOption(4, 1, this)">
              <span class="opt-badge">C</span>
              <span class="opt-text">15+ hours/week</span>
            </button>
          </div>
        </div>
        <!-- Step 6: Email -->
        <div class="step" id="step-5">
          <p class="email-step-title">One last thing — enter your details to generate your PDF report.</p>
          <div class="form-group">
            <input type="email" class="form-input" id="emailInput" placeholder="Email address" required autocomplete="email">
            <input type="url"   class="form-input" id="urlInput"   placeholder="Your website URL" required autocomplete="url">
          </div>
        </div>
        <!-- Score result (inline) -->
        <div class="score-result" id="scoreResult">
          <div class="score-ring-wrap">
            <!-- icon -->
            <div class="score-center" id="scoreDisplay">—</div>
          </div>
          <div class="score-tier-label" id="scoreTierLabel"></div>
          <div class="score-desc" id="scoreDesc"></div>
          <a href="https://calendly.com/julio-jldatrum" id="scheduleBtn" class="btn-schedule" target="_blank" rel="noopener">Schedule a Strategy Session →</a>
          <button id="btnDownloadPDF" class="btn-download" onclick="downloadPDF()"><!-- icon --><span id="btnDownloadLabel">Download PDF Report</span></button>
          <button class="btn-reset" onclick="resetWidget()">← Start over</button>
        </div>
        <!-- Footer nav -->
        <div class="widget-footer" id="widgetFooter">
          <span class="step-counter" id="stepCounter">Step 1 of 6</span>
          <button class="btn-next" id="btnNext" onclick="nextStep()">Next →</button>
        </div>
      </div>
    </div>
  </div>
</section>
<!-- ── FOOTER ──────────────────────────────────────── -->
<footer>
  <div class="footer-inner">
    <div class="footer-logo">DATRUM</div>
    <nav class="footer-links" aria-label="Legal">
      <a href="/security">Security</a>
      <a href="/privacy">Privacy</a>
      <a href="/subprocessors">Subprocessors</a>
      <a href="#" onclick="showCookieBanner(); return false;">Cookies</a>
    </nav>
    <div class="footer-copy">© 2026 DATRUM · Design and engineering for high-stakes digital infrastructure</div>
  </div>
</footer>
<!-- ── COOKIE CONSENT BANNER ──────────────────────── -->
<div id="cookieBanner" role="dialog" aria-live="polite" aria-label="Cookie consent">
  <p class="cookie-text">
    We use a privacy-respecting analytics setup (Google Analytics 4 with IP anonymization) to understand how visitors find DATRUM. Nothing personal, no ad tracking. You can decline and the site works the same. <a href="/privacy">Privacy policy</a>.
  </p>
  <div class="cookie-actions">
    <button class="cookie-btn primary" onclick="acceptCookies()">Accept analytics</button>
    <button class="cookie-btn" onclick="declineCookies()">Decline</button>
  </div>
</div>
<!-- Scripts -->
</body>
```
