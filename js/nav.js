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
