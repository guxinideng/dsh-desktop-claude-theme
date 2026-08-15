(function () {
  // Quiet pure trace/log rows in the 对话 (conversation) tab so it reads
  // like a clean chat, not a raw execution log — WITHOUT removing them.
  // This only tags qualifying rows with .ds-trace-quiet; theme.css does the
  // actual fading (50% opacity, full opacity on hover/focus). The rows keep
  // their native click-to-expand behavior untouched (DSH already ships that
  // — data-disclosure-row="true" / data-expandable="true" — this script
  // never hides content, just dims the collapsed summary line).
  //
  // Two component families observed in DSH's DOM:
  //  1. Generic collapsible step rows ([data-disclosure-row="true"]),
  //     shared by several row types including the interactive "提问"
  //     (question) row — so these are matched by an explicit title
  //     allowlist, never a blanket match, to avoid ever dimming/hiding
  //     something the user needs to respond to.
  //  2. Tool-call cards ([class*="_callRow"]) — e.g. Bash executions. This
  //     component is unconditionally trace content (never an interactive
  //     prompt), so all instances get the quiet treatment.
  var QUIET_TITLES = new Set(['Think', 'Bash', 'Tool call', '上下文注入', '更新任务清单']);

  function markQuietRows() {
    document.querySelectorAll('[data-disclosure-row="true"]').forEach(function (row) {
      var titleEl = row.querySelector('[class*="_title_9cl6j_"]');
      var label = titleEl ? titleEl.textContent.trim() : '';
      if (QUIET_TITLES.has(label)) {
        row.classList.add('ds-trace-quiet');
      }
    });
    document.querySelectorAll('[class*="_callRow"]').forEach(function (row) {
      row.classList.add('ds-trace-quiet');
    });
  }

  markQuietRows();
  var observer = new MutationObserver(markQuietRows);
  observer.observe(document.body, { childList: true, subtree: true });
})();
