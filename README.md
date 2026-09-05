# jldatrum.com

The DATRUM studio site. Vanilla HTML, CSS and JS — no framework, no build step,
no bundler. 38 content pages plus `404.html`, mirrored by hand in English and
Spanish under `/es/`. Live at https://jldatrum.com.

## The rule that is easy to get wrong

**The repo root is the deploy directory.** Cloudflare Pages serves this
repository as-is, so every tracked file here is a public URL. A working note
dropped in the root is published the moment it is pushed. Drafts, briefs and
handoff notes stay untracked — see `.gitignore`.

## Layout

```
index.html  bio/  work/  resources/  es/       pages, hand-mirrored EN + ES
css/  js/                                      two independent stylesheet families
worker/                                        the scanner API — deploys separately
tools/serve.py                                 local preview
_headers  _redirects  robots.txt  sitemap.xml  llms.txt
```

## Local preview

```
python3 tools/serve.py 3456
```

Use this rather than `python -m http.server`. It resolves clean URLs, applies the
rules in `_redirects`, serves a real 404, and sends the production headers from
`_headers` — so a Content-Security-Policy that would only fail in production
fails locally too. HSTS is deliberately stripped: over `http://localhost` it pins
the browser to HTTPS on that port and breaks the preview until it expires.

## Deploying

The site deploys automatically on push to `main`. A build takes about 60–90
seconds.

The worker does **not**. It is a separate deploy:

```
cd worker && npx wrangler deploy
```

Its test suite runs offline, with no account and no network:

```
node worker/scanner.test.mjs
node worker/calibration.test.mjs
```

## The scanners

Two instruments, one worker, in this repo. Both languages are served by the
same code: the page declares its language and the worker picks the copy file.

This worker, two instruments, at `POST /scan`. Omit `mode` for the AI Visibility Map;
pass `"mode":"headers"` for the Header Security & Indexability Scanner (13 checks).
`POST /lead` records a report request. Rate limited to 60 requests per IP per hour on
each endpoint; the ceilings are `SCAN_LIMIT` and `LEAD_LIMIT` in `worker/wrangler.toml`.

### Two reports, one of them ungraded

The AI Visibility Map returns `checks` and `observations`, and only the first
is scored.

`checks` is what decides whether a machine can reach the site, read it, and
find a page that answers one question: crawler access, the words arriving in
the served HTML, the title and description, and how much of the business has
an address of its own. Scored, normalised to the checks that actually ran, and
every row carries the `weight` it was worth so the pool in the payload adds up.

`observations` is structured data, the heading outline and alt text. Reported
plainly, priced at nothing, and no consequence is claimed for any of it.

That split is not tidiness. The instrument graded a Panama interiors studio
25/100 F while that studio ranked first for its category in two languages and
was being quoted back by Google's AI Overview with citations to five of its own
URLs. It has four `<h1>`s — three of them the numerals `1.` `2.` `3.` — no
structured data, a broken heading outline and almost no alt text. Every hygiene
signal was failing and every outcome that matters was passing, so hygiene stopped
carrying a grade.

### Calibration

`worker/calibration.test.mjs` runs the scoring against captured fixtures whose
real-world search outcome is recorded. The rule it enforces is direction, not
precision: a site that ranks and is described correctly must score above one
that does not, and any build grading the ceiling reference below a B fails.

A fixture with no recorded outcome takes part in no ordering assertion. That is
deliberate — the alternative is inventing a search result nobody looked up.

### What it does not measure

Whether an engine actually cites you. That needs a SERP API for index coverage
and own-name ownership, and a model API to ask an engine what it says about a
business. Neither key exists here, so the instrument measures the shapes that
precede citation and says so, rather than estimating the thing itself.

The grading logic is in this repo on purpose. The pages claim the score is
automated rather than self-reported, and that is only worth claiming if anyone
can read how it is calculated.
