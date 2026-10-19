(function () {
  // Quiet pure trace/log rows in the 对话 (conversation) tab so it reads
  // like a clean chat, not a raw execution log — WITHOUT removing them.
  // This only tags qualifying rows with .ds-trace-quiet; theme.css does the
  // actual fading (50% opacity, full opacity on hover/focus) plus compact
  // row height and grey icons. The rows keep their native click-to-expand
  // behavior untouched (DSH already ships that — data-disclosure-row="true"
  // / data-expandable="true" — this script never hides content, just dims
  // the collapsed summary line).
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
  // Chinese labels are listed too: trace-translate.js rewrites the title
  // text to Chinese, and this match must still hold after that happens.
  var QUIET_TITLES = new Set([
    'Think', 'Bash', 'Tool call', '上下文注入', '更新任务清单',
    'Read', 'permission', 'Write', 'Edit',
    '思考', '工具调用', '权限', '读取', '写入', '编辑',
  ]);
  var ERROR_TITLES = new Set(['Tool call', '工具调用']);
  var PERMISSION_TITLES = new Set(['permission', '权限']);

  function titleOf(row) {
    var titleEl = row.querySelector('[class*="_title_9cl6j_"]');
    return titleEl ? titleEl.textContent.trim() : '';
  }

  // Keep only the last of each run of adjacent permission rows. Hidden
  // rows are marked, never removed, so React's reconciliation is untouched.
  function dedupePermissionRows() {
    document.querySelectorAll('[data-disclosure-row="true"]').forEach(function (row) {
      if (!PERMISSION_TITLES.has(titleOf(row))) return;
      var next = row.nextElementSibling;
      var dup = !!(next &&
        next.getAttribute('data-disclosure-row') === 'true' &&
        PERMISSION_TITLES.has(titleOf(next)));
      if (dup) row.setAttribute('data-ds-permission-dup', '1');
      else row.removeAttribute('data-ds-permission-dup');
    });
  }

  function markQuietRows() {
    document.querySelectorAll('[data-disclosure-row="true"]').forEach(function (row) {
      var label = titleOf(row);
      if (QUIET_TITLES.has(label)) {
        row.classList.add('ds-trace-quiet');
        // Failed tool calls keep their attention-grabbing colors.
        row.classList.toggle(
          'ds-trace-error',
          ERROR_TITLES.has(label) && /Error/.test(row.textContent)
        );
      }
    });
    document.querySelectorAll('[class*="_callRow"]').forEach(function (row) {
      row.classList.add('ds-trace-quiet');
    });
    dedupePermissionRows();
  }

  markQuietRows();
  var observer = new MutationObserver(markQuietRows);
  observer.observe(document.body, { childList: true, subtree: true });
})();
