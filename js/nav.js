// ── MOBILE NAV ─────────────────────────────────────────
function toggleDrawer() {
  const drawer = document.getElementById('navDrawer');
  const burger = document.getElementById('hamburger');
  if (!drawer || !burger) return; // pages without a mobile drawer (e.g. resources hub)
  const isOpen = drawer.classList.toggle('open');
  burger.setAttribute('aria-expanded', isOpen);
  drawer.setAttribute('aria-hidden', !isOpen);
  document.body.style.overflow = isOpen ? 'hidden' : '';
}
function closeDrawer() {
  const drawer = document.getElementById('navDrawer');
  const burger = document.getElementById('hamburger');
  if (!drawer || !burger) return; // pages without a mobile drawer (e.g. resources hub)
  drawer.classList.remove('open');
  burger.setAttribute('aria-expanded', false);
  drawer.setAttribute('aria-hidden', true);
  document.body.style.overflow = '';
}


// ── COOKIE CONSENT (GDPR) ─────────────────────────────
function acceptCookies() {
  try { localStorage.setItem('datrum_consent', 'granted'); } catch(e) {}
  if (typeof gtag === 'function') {
    gtag('consent', 'update', { 'analytics_storage': 'granted' });
  }
  document.getElementById('cookieBanner')?.classList.remove('show');
}
function declineCookies() {
  try { localStorage.setItem('datrum_consent', 'denied'); } catch(e) {}
  document.getElementById('cookieBanner')?.classList.remove('show');
}
function showCookieBanner() {
  document.getElementById('cookieBanner')?.classList.add('show');
}
// Show banner on first visit (no choice made yet)
(function() {
  try {
    if (!localStorage.getItem('datrum_consent')) {
      // Defer slightly so it doesn't compete with hero animation
      setTimeout(showCookieBanner, 1200);
    }
  } catch(e) {
    // localStorage blocked — show banner anyway
    setTimeout(showCookieBanner, 1200);
  }
})();


/* ── DELEGATION ────────────────────────────────────────
   These were inline onclick= attributes on 343 elements, which forced
   script-src to allow 'unsafe-inline'. One listener on the document does the
   same job and lets the policy say 'self'.

   The functions above stay exported on window: they are the behaviour, this is
   only how it is reached. */
document.addEventListener('click', function (e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  switch (el.getAttribute('data-action')) {
    case 'toggle-drawer':   toggleDrawer(); break;
    case 'close-drawer':    closeDrawer(); break;
    case 'accept-cookies':  acceptCookies(); break;
    case 'decline-cookies': declineCookies(); break;
    case 'show-cookies':    e.preventDefault(); showCookieBanner(); break;
    default: return;
  }
});

// The bio portrait hides itself when the file is missing. `error` does not
// bubble, so this listens in the capture phase.
document.addEventListener('error', function (e) {
  const el = e.target;
  if (!el || el.tagName !== 'IMG' || el.getAttribute('data-fallback') !== 'hide-portrait') return;
  el.style.display = 'none';
  el.parentElement?.classList.add('bio-portrait--empty');
}, true);
