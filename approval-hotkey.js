(function () {
  // Matches Claude Code's own Cmd+Enter-to-approve convention. New buttons
  // are found by their visible label, not a class name — dsh's classes are
  // build-hashed and can change on any release (see theme.css's other
  // [class*="..."] selectors for the same reason), but this label text is
  // UI copy a recipient reads, so it's far less likely to move under us
  // silently. Covers every same-meaning "allow, just this once" spelling
  // dsh might render (language, capitalization) — deliberately NOT a
  // separate, more permanent action like "always allow" even if one turns
  // out to exist: conflating a one-time approval with a standing one under
  // the same keystroke could grant more than the user meant to. If dsh has
  // another one-time-approval spelling this list is missing, add it here.
  var ALLOW_LABELS = ['允许一次', 'Allow once', 'Allow Once', '允许', 'Allow'];
  var IS_MAC = /Mac/.test(navigator.platform || navigator.userAgent || '');
  var HINT_TEXT = IS_MAC ? '⌘Enter' : 'Ctrl+Enter';
  var MARK = 'data-ds-allow-btn';

  function isVisible(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  // The button's own label becomes JUST the shortcut ("⌘Enter"), replacing
  // "允许一次" rather than appending to it — the original label is kept as
  // an aria-label so screen readers still get the actual meaning, it just
  // isn't drawn on screen. Matching by exact text only works ONCE, at the
  // moment a fresh button appears — after this runs its textContent no
  // longer matches ALLOW_LABELS at all, so the button is tagged with MARK
  // and later lookups (including the keydown handler below) go by that tag
  // instead of re-deriving from text that's since changed.
  function tagFreshButtons() {
    var candidates = document.querySelectorAll('button, [role="button"]');
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (el.hasAttribute(MARK)) continue;
      var label = (el.textContent || '').trim();
      if (ALLOW_LABELS.indexOf(label) === -1 || !isVisible(el)) continue;
      el.setAttribute(MARK, '1');
      el.setAttribute('aria-label', label + '（' + HINT_TEXT + '）');
      el.textContent = HINT_TEXT;
    }
  }

  function findAllowButton() {
    var el = document.querySelector('[' + MARK + ']');
    return el && isVisible(el) ? el : null;
  }

  tagFreshButtons();
  new MutationObserver(tagFreshButtons).observe(document.body, { childList: true, subtree: true });

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
