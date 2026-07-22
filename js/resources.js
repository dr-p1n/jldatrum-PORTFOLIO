// ── RESOURCES: interactive self-scoring checklists ─────
// Each .rc-tool computes a live score across its .rc-group blocks.
//   data-mode="all"  → the group scores 1 point only if ALL its checks are ticked
//   data-mode="each" → each ticked check scores 1 point
// The matching band row in .rc-bands is highlighted as the score changes.
(function () {
  document.querySelectorAll('.rc-tool').forEach(function (tool) {
    var groups  = Array.prototype.slice.call(tool.querySelectorAll('.rc-group'));
    var numEl   = tool.querySelector('.rc-num');
    var bands   = Array.prototype.slice.call(tool.querySelectorAll('.rc-bands tr[data-min]'));

    function update() {
      var total = 0;
      groups.forEach(function (g) {
        var checks  = Array.prototype.slice.call(g.querySelectorAll('input[type="checkbox"]'));
        var checked = checks.filter(function (c) { return c.checked; }).length;
        var pts = g.getAttribute('data-mode') === 'all'
          ? (checks.length > 0 && checked === checks.length ? 1 : 0)
          : checked;
        total += pts;
        var partNum = g.querySelector('.rc-part-num');
        if (partNum) partNum.textContent = checked + ' / ' + g.getAttribute('data-part-max');
      });
      if (numEl) numEl.textContent = total;
      bands.forEach(function (r) {
        var min = +r.getAttribute('data-min');
        var max = +r.getAttribute('data-max');
        r.classList.toggle('active', total >= min && total <= max);
      });
    }

    tool.addEventListener('change', function (e) {
      if (e.target && e.target.matches && e.target.matches('input[type="checkbox"]')) update();
    });
    update();
  });
})();
