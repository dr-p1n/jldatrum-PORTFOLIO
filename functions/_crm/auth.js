// Cloudflare Access JWT verification.
// Access sits in front of the custom domain; the Worker re-verifies the signed token
// so a misconfigured route can never expose prospect data (Ley 81).

let certCache = { keys: null, fetchedAt: 0 };

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function getKeys(teamDomain) {
  const now = Date.now();
  if (certCache.keys && now - certCache.fetchedAt < 3600_000) return certCache.keys;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error('Could not load Access certs');
  const { keys } = await res.json();
  certCache = { keys, fetchedAt: now };
  return keys;
}

export async function verifyAccess(request, env) {
  if (env.DEV_SKIP_ACCESS === 'true') return { email: 'dev@local' };

  const token =
    request.headers.get('cf-access-jwt-assertion') ||
    (request.headers.get('cookie') || '').match(/CF_Authorization=([^;]+)/)?.[1];
  if (!token) return null;

  const [h, p, sig] = token.split('.');
  if (!h || !p || !sig) return null;
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));

  const keys = await getKeys(env.ACCESS_TEAM_DOMAIN);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;

  const key = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
  );
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key, b64urlToBytes(sig), new TextEncoder().encode(`${h}.${p}`)
  );
  if (!valid) return null;

  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.exp && payload.exp < now) return null;
  if (!aud.includes(env.ACCESS_AUD)) return null;
  if (payload.iss && payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;

  return { email: payload.email };
}
