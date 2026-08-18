# AI Visibility Scanner — Worker

Server-side because it has to be: a browser cannot `fetch()` an arbitrary
third-party URL. CORS blocks it, and no prospect's site sends
`Access-Control-Allow-Origin: https://jldatrum.com`.

## Deploy

```
cd worker
wrangler kv namespace create RATE     # then paste the id into wrangler.toml
wrangler deploy
```

The deployed URL must match `data-endpoint` in `/resources/scan/index.html`
(both languages) **and** the `connect-src` entry in `/_headers`. All three
currently say `https://ai-visibility.julioernestolv.workers.dev`.

## Contract

`POST /scan` with `{"url": "https://example.com"}` returns:

```json
{ "url": "...", "score": 84, "grade": "A-", "passed": 17, "total": 21,
  "checks": [ { "id": "ld-present", "group": "entity", "pass": true,
                "deduction": 0, "title": "...", "detail": "..." } ] }
```

Errors return `{"error": "..."}` with a 4xx/5xx status.

## Guardrails

This endpoint fetches attacker-supplied URLs, so it validates before it fetches:
https/http only, no embedded credentials, and every private range is rejected —
loopback, RFC1918, link-local (including `169.254.169.254`, the cloud metadata
address), CGNAT, multicast, IPv6 ULA and link-local. Responses are capped at
2 MB with an 8-second timeout. Rate limit is 10 scans/IP/hour via KV.

`worker/scanner.test.mjs` covers the robots parser, the grade bands and the
SSRF rejection list. Run with `node worker/scanner.test.mjs`.
