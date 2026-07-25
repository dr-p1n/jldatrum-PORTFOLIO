// ── WORK PAGE TABS ─────────────────────────────────────
// Turns the work-page nav links into real tabs: one section
// visible at a time, no endless scroll.
(function () {
  // Page may override the tab set (e.g. the Resources hub) via window.TAB_IDS.
  const TAB_IDS = (window.TAB_IDS && window.TAB_IDS.length)
    ? window.TAB_IDS
    : ['who', 'services', 'framework', 'work'];

  const sections = {};
  TAB_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) sections[id] = el;
  });
  const ids = Object.keys(sections);
  if (!ids.length) return; // not a tabbed page

  const tabLinks = Array.from(document.querySelectorAll('a[href^="#"]'))
    .filter(a => ids.includes(a.getAttribute('href').slice(1)));

  function activate(id) {
    if (!sections[id]) id = ids[0];
    ids.forEach(k => {
      const isActive = (k === id);
      sections[k].style.display = isActive ? '' : 'none';
      if (isActive) {
        sections[k].querySelectorAll('.fade-up').forEach(el => el.classList.add('visible'));
      }
    });
    tabLinks.forEach(a => {
      a.classList.toggle('active', a.getAttribute('href').slice(1) === id);
    });
    // Inside a display:none subtree IntersectionObserver never fires and CSS
    // animations do not run, so any chart in a hidden tab would stay frozen.
    // js/viz.js listens for this and re-scans the now-visible section.
    document.dispatchEvent(new CustomEvent('tab:activate', { detail: { id: id } }));
    window.scrollTo(0, 0);
  }

  tabLinks.forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      const id = a.getAttribute('href').slice(1);
      if (typeof closeDrawer === 'function') closeDrawer();
      history.replaceState(null, '', '#' + id);
      activate(id);
    });
  });

  const initial = ids.includes(location.hash.slice(1)) ? location.hash.slice(1) : ids[0];
  activate(initial);
})();
