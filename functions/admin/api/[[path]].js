// DATRUM CRM — Pages Functions entry for /admin/api/*.
//
// Cloudflare Access guards /admin and /admin/* at the edge. This handler
// re-verifies the signed Access JWT itself, so a misconfigured or deleted
// Access application cannot expose prospect data (Ley 81). Both checks are
// deliberate; neither is redundant.
//
// The static CRM front end at /admin/ is served by Pages directly and is
// protected by Access alone — there is no Worker in front of it.

import { verifyAccess } from '../../_crm/auth.js';
import { route, SECURITY_HEADERS, json, withHeaders } from '../../_crm/router.js';

// Second gate. The Access policy already restricts who can get a token, but a
// policy edit is one click; this is the copy that lives in the repo and shows
// up in review. Unset = fall back to the Access policy alone.
function emailAllowed(user, env) {
  const list = (env.ACCESS_ALLOWED_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return true;
  return list.includes((user.email || '').toLowerCase());
}

export async function onRequest(context) {
  const { request, env } = context;

  const user = await verifyAccess(request, env).catch(() => null);
  if (!user || !emailAllowed(user, env)) {
    return withHeaders(
      new Response('Unauthorized — this CRM is only reachable through Cloudflare Access.', { status: 401 })
    );
  }

  const url = new URL(request.url);
  try {
    return withHeaders(await route(request, env, url));
  } catch (err) {
    console.error(err);
    return withHeaders(json({ error: 'Server error: ' + (err.message || err) }, 500));
  }
}
