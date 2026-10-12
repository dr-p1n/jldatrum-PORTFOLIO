# /admin — the DATRUM CRM

`https://jldatrum.com/admin` — behind Cloudflare Access, never linked from the
public site, `Disallow: /admin` in robots.txt, `noindex` on the page.

This file is in the repo root, which **is** the Pages deploy directory, so it
301s to /404 like `package.json` and `/worker/*`. Read it here, not on the web.

## The three pieces

| Piece | Where | Deploys |
|---|---|---|
| Front end | `admin/` | with the site, on push to `main` |
| JSON API | `functions/admin/api/[[path]].js` + `functions/_crm/` | with the site, on push to `main` |
| Email intake | `workers/crm-mail/` | **by hand**: `cd workers/crm-mail && npx wrangler deploy` |

`functions/` is never served as static assets, which is why the shared modules
live in `functions/_crm/` instead of a root-level `crm/`.

## First-time setup

**1. Database**

```bash
npx wrangler d1 create datrum-crm
```

Put the returned id in `workers/crm-mail/wrangler.toml`, and bind the same
database to the Pages project as `DB` (Pages → Settings → Functions → D1
bindings). Then:

```bash
npx wrangler d1 migrations apply datrum-crm --remote
```

**2. Cloudflare Access** — click by click, this is not done in code:

1. Zero Trust dashboard → Access → Applications → **Add an application** → Self-hosted.
2. Name `DATRUM CRM`. Session duration: 24 hours.
3. Application domain: `jldatrum.com`, path `admin`. **Add another** domain with
   the same host and path `admin/*`. Both are needed; the API lives under the second.
4. Policies → Add a policy. Name `Only me`. Action **Allow**. Include → Emails →
   your address. Nothing else.
5. Save. Copy the **Application Audience (AUD) tag** from the application's
   Overview, and your team domain (`<team>.cloudflareaccess.com`).
6. Pages → Settings → Environment variables (Production), add:
   - `ACCESS_TEAM_DOMAIN` = `<team>.cloudflareaccess.com`
   - `ACCESS_AUD` = the AUD tag
   - `ACCESS_ALLOWED_EMAILS` = your address

`ACCESS_ALLOWED_EMAILS` is a second gate inside the Worker. The Access policy
already restricts who gets a token; this is the copy that lives in the repo and
shows up in review if the policy is ever widened by accident.

**3. Email intake**

Email Routing → Routes → add `log@crm-mail.jldatrum.com` → Send to a Worker →
`datrum-crm-mail`. The MX records on the root domain are not touched; this is a
subdomain. Hostinger keeps the root mail.

**4. Secrets** (optional — without it, Workers AI parses instead)

```bash
cd workers/crm-mail && npx wrangler secret put ANTHROPIC_API_KEY
```

## Verify it is actually closed

From a terminal with no Access cookie — both must be a redirect or a 401,
never 200:

```bash
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://jldatrum.com/admin
```

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://jldatrum.com/admin/api/config
```

And the public site must be untouched:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://jldatrum.com/
```

## Tests

```bash
node functions/_crm/leads.test.mjs && node functions/_crm/security.test.mjs
```

`security.test.mjs` fails the build if `DEV_SKIP_ACCESS` is ever *assigned*
outside `.dev.vars`, if `_routes.json` stops limiting Functions to
`/admin/api/*`, if the admin CSP picks up an analytics host, or if any public
page links `/admin`.

## Local development

```bash
npx wrangler pages dev . --d1 DB=datrum-crm
```

`.dev.vars` with `DEV_SKIP_ACCESS=true` bypasses Access locally. That file is
gitignored and must never be committed or set as a Pages variable.
