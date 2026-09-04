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
```

## The scanners

Three instruments across two workers. The first two share the worker in this
repo; the third — Pipeline Visibility, at `/resources/pipeline/` and
`/es/resources/pipeline/` — is its own repo and its own worker, because the root
of this repo is the deploy directory and anything tracked here is a public URL.
Both languages of every instrument are served by the same code: the page
declares its language and the worker picks the copy file.

This worker, two instruments, at `POST /scan`. Omit `mode` for the AI Visibility Map
(26 checks); pass `"mode":"headers"` for the Header Security &
Indexability Scanner (15 checks). `POST /lead` records a report request. Rate limited
to 60 requests per IP per hour on each endpoint; the ceilings are `SCAN_LIMIT`
and `LEAD_LIMIT` in `worker/wrangler.toml`.

The grading logic is in this repo on purpose. The pages claim the score is
automated rather than self-reported, and that is only worth claiming if anyone
can read how it is calculated.
