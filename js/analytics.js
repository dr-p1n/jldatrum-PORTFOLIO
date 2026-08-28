/* ─────────────────────────────────────────────────────────
   Google Analytics 4 — Consent Mode v2.

   This lived inline on 32 pages, which is why script-src had to carry
   'unsafe-inline', which is why an injected script would have run too. It is a
   file now so the policy can say 'self' and mean it.

   MUST load synchronously and BEFORE the async gtag.js tag: it installs the
   dataLayer and the gtag() shim, and denies analytics storage until the visitor
   consents. Loaded with defer or async, gtag.js can win the race and the
   default-deny never lands.
   ───────────────────────────────────────────────────────── */
window.dataLayer = window.dataLayer || [];
function gtag(){ dataLayer.push(arguments); }

// Default: deny analytics until the visitor consents (GDPR Article 6).
gtag('consent', 'default', {
  'ad_storage': 'denied',
  'ad_user_data': 'denied',
  'ad_personalization': 'denied',
  'analytics_storage': 'denied',
  'wait_for_update': 500
});

// Restore a prior choice.
try {
  if (localStorage.getItem('datrum_consent') === 'granted') {
    gtag('consent', 'update', { 'analytics_storage': 'granted' });
  }
} catch (e) { /* storage blocked — stay denied */ }

gtag('js', new Date());
gtag('config', 'G-CL53ZQMZ4P', { 'anonymize_ip': true });
