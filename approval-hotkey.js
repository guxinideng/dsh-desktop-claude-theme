(function () {
  // Matches Claude Code's own Cmd+Enter-to-approve convention. Deliberately
  // matched by the button's visible label, not a class name — dsh's classes
  // are build-hashed and can change on any release (see theme.css's other
  // [class*="..."] selectors for the same reason), but "允许一次" is UI copy
  // a recipient reads, so it's far less likely to move under us silently.
  var ALLOW_LABELS = ['允许一次', 'Allow once', 'Allow Once'];

  function isVisible(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  function findAllowButton() {
    var candidates = document.querySelectorAll('button, [role="button"]');
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      var label = (el.textContent || '').trim();
      if (ALLOW_LABELS.indexOf(label) !== -1 && isVisible(el)) return el;
    }
    return null;
  }

  document.addEventListener(
    'keydown',
    function (e) {
      if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
      var btn = findAllowButton();
      if (!btn) return; // no pending approval on screen — leave the shortcut to whatever else wants it (e.g. the composer's own busy-queue Cmd/Ctrl+Enter behavior)
      e.preventDefault();
      e.stopPropagation();
      btn.click();
    },
    true
  );
})();
