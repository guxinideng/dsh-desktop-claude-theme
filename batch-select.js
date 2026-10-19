(function () {
  // Batch selection for the sidebar session list.
  //
  // Adds a "批量选择" button to the sidebar header actions (a shallow copy of
  // the add-workspace button, so it inherits the hover-reveal rules), a
  // selection mode where session rows toggle instead of opening, a bottom
  // action bar, and a batch delete. Delete first archives each selected row
  // through dsh's own row menu, then deletes only the sessions that appeared
  // in the archived list during that run (set difference, never a guess).
  //
  // React owns the sidebar subtree. This script only appends its own button
  // and bar, sets data-ds-* attributes on existing nodes, and draws the
  // checkbox and check mark with ::before/::after from its own <style>.
  // Selection state lives in a Set of row elements, not in React's DOM.
  // Idempotent.
  if (window.__dsBatchInstalled) return;
  window.__dsBatchInstalled = true;

  var NS = 'http://www.w3.org/2000/svg';
  var STYLE_ID = 'ds-batch-style';
  var BUSY_STYLE_ID = 'ds-batch-busy-style';
  var BAR_ID = 'ds-batch-bar';
  var RESULT_ID = 'ds-batch-result';
  var BTN_ATTR = 'data-ds-batch-btn';
  var ROW_ATTR = 'data-ds-batch-selected';
  var ROW_SEL = '[class*="YDXeBa_sessionRow"]';
  var TITLE_SEL = '[class*="YDXeBa_title"]';
  var HEADER_SEL = '[class*="qDHVXG_headerActions"]';
  var SIDEBAR_SEL = '[class*="hHd-Xa_root"]';
  var OPS_SEL = 'button[aria-label^="会话“"][aria-label$="”的操作"]';
  var ARCHIVE_LABEL = '归档会话';
  var RAIL_MIN = 160;
  var BOTTOM_GAP = 12;

  var active = false;
  var busy = false;
  var armed = false;
  var armTimer = 0;
  var statusText = '';
  var errText = '';
  var scheduled = 0;
  var selected = new Set();
  // Whether dsh's archived-session API can delete right now (refreshed on enter).
  var manage = { canManage: false, reason: '' };

  var bar = null;
  var countEl = null;
  var allBtn = null;
  var delBtn = null;
  var cancelBtn = null;

  // Test hooks: window.__dsBatchDryRun === true makes the archive step log
  // titles to window.__dsBatchLog and push fake ids onto window.__fakeArchived
  // instead of clicking "归档会话".
  window.__dsBatchLog = window.__dsBatchLog || [];

  var CSS = [
    'body[data-ds-batch="1"] ' + ROW_SEL + ' {',
    '  position: relative !important; padding-left: 34px !important; cursor: pointer; user-select: none;',
    '}',
    'body[data-ds-batch="1"] ' + ROW_SEL + '::before {',
    '  content: ""; position: absolute; left: 10px; top: 50%; width: 16px; height: 16px; margin-top: -8px;',
    '  box-sizing: border-box; border: 1.5px solid var(--dsw-alias-border-l3, rgba(0, 0, 0, .25));',
    '  border-radius: 50%; background: transparent; pointer-events: none;',
    '  transition: background-color .12s ease, border-color .12s ease;',
    '}',
    'body[data-ds-batch="1"] ' + ROW_SEL + '[' + ROW_ATTR + '="1"]::before {',
    '  background: var(--dsw-alias-brand-primary, #cc785c); border-color: var(--dsw-alias-brand-primary, #cc785c);',
    '}',
    'body[data-ds-batch="1"] ' + ROW_SEL + '[' + ROW_ATTR + '="1"]::after {',
    '  content: ""; position: absolute; left: 15px; top: 50%; width: 5px; height: 9px; margin-top: -6px;',
    '  box-sizing: border-box; border-style: solid; border-color: var(--dsw-alias-button-contrast-fill, #fff);',
    '  border-width: 0 2px 2px 0; transform: rotate(45deg); pointer-events: none;',
    '}',
    'body[data-ds-batch="1"] ' + ROW_SEL + '[' + ROW_ATTR + '="1"] {',
    '  background-color: var(--dsw-alias-interactive-bg-active, rgba(0, 0, 0, .08)) !important;',
    '}',
    'body[data-ds-batch="1"] [class*="YDXeBa_rowActions"] { display: none !important; }',
    // The header actions group has a fixed 60px box that clips a third button.
    // Let it size to its content so the batch button is visible.
    '[class*="qDHVXG_headerActions"]:has([' + BTN_ATTR + ']) {',
    '  overflow: visible !important; width: auto !important; min-width: max-content !important;',
    '}',
    '[' + BTN_ATTR + '][aria-pressed="true"] {',
    '  opacity: 1 !important; color: var(--dsw-alias-brand-primary, #cc785c) !important;',
    '}',
    '#' + BAR_ID + ', #' + RESULT_ID + ' {',
    '  position: fixed; z-index: 9000; box-sizing: border-box; display: flex; align-items: center; gap: 4px;',
    '  padding: 8px 10px; border-radius: 12px; min-width: 0;',
    '  background: var(--dsw-alias-bg-layer-2, #fff); color: var(--dsw-alias-label-primary, #282420);',
    '  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, .1));',
    '  box-shadow: 0 6px 20px rgba(0, 0, 0, .14);',
    '  font: 13px/1.2 var(--dsw-font-family, system-ui, sans-serif);',
    '}',
    '#' + BAR_ID + ' .ds-batch-count {',
    '  flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',
    '  padding: 0 4px; color: var(--dsw-alias-label-secondary, #6e675c);',
    '}',
    '#' + BAR_ID + ' .ds-batch-count.ds-batch-err { color: #d4493a; font-weight: 600; white-space: normal; }',
    '#' + BAR_ID + ' button {',
    '  border: 0; border-radius: 8px; padding: 6px 9px; background: transparent; color: inherit;',
    '  font: inherit; cursor: pointer; white-space: nowrap;',
    '}',
    '#' + BAR_ID + ' button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, .05)); }',
    '#' + BAR_ID + ' button:disabled { opacity: .4; cursor: default; }',
    '#' + BAR_ID + ' button[data-act="delete"] { color: #d4493a; font-weight: 600; }',
    '#' + BAR_ID + ' button[data-act="delete"].ds-armed { background: #d4493a; color: #fff; }',
    '#' + RESULT_ID + ' { color: #d4493a; font-weight: 600; padding: 8px 12px; white-space: normal; }',
    '#' + RESULT_ID + '.ds-batch-hint { color: var(--dsw-alias-label-secondary, #6e675c); font-weight: 400; }'
  ].join('\n');

  var BUSY_CSS = '[role="menu"] { opacity: 0 !important; pointer-events: none !important; }';

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function addBusyStyle() {
    if (document.getElementById(BUSY_STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = BUSY_STYLE_ID;
    style.textContent = BUSY_CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function removeBusyStyle() {
    var style = document.getElementById(BUSY_STYLE_ID);
    if (style) style.remove();
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // Polls fn every `interval` ms until it returns a truthy value or `timeout` passes.
  function waitFor(fn, timeout, interval) {
    return new Promise(function (resolve) {
      var start = Date.now();
      (function tick() {
        var value = fn();
        if (value) return resolve(value);
        if (Date.now() - start >= timeout) return resolve(null);
        setTimeout(tick, interval);
      })();
    });
  }

  function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }

  function setDisabled(el, value) {
    if (el.disabled !== value) el.disabled = value;
  }

  // ---- entry button -----------------------------------------------------

  function updateButton() {
    var btn = document.querySelector('[' + BTN_ATTR + ']');
    if (!btn) return;
    var pressed = active ? 'true' : 'false';
    if (btn.getAttribute('aria-pressed') !== pressed) btn.setAttribute('aria-pressed', pressed);
  }

  // Shallow clone of the add-workspace button (cloneNode copies no React
  // listeners), with its children replaced by an empty svg that icons.js
  // fills with the list-checks glyph via data-ds-icon.
  function ensureButton() {
    var header = document.querySelector(HEADER_SEL);
    if (!header || header.querySelector('[' + BTN_ATTR + ']')) return;
    var src = header.querySelector('button[aria-label="添加工作区"]') || header.querySelector('button');
    if (!src) return;

    var btn = src.cloneNode(true);
    btn.removeAttribute('id');
    btn.setAttribute('type', 'button');
    btn.setAttribute(BTN_ATTR, '1');
    btn.setAttribute('aria-label', '批量选择');
    btn.setAttribute('title', '批量选择');
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    while (btn.firstChild) btn.removeChild(btn.firstChild);

    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('fill', 'none');
    // icons.js resolves "批量选择" to list-checks too; setting it here means the
    // glyph does not wait for that script's next scan.
    svg.setAttribute('data-ds-icon', 'list-checks');
    btn.appendChild(svg);

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (busy) return;
      if (active) exitMode(); else enterMode();
    });
    header.appendChild(btn);
  }

  // ---- selection --------------------------------------------------------

  function setRowSelected(row, on) {
    if (on) {
      selected.add(row);
      if (row.getAttribute(ROW_ATTR) !== '1') row.setAttribute(ROW_ATTR, '1');
    } else {
      selected.delete(row);
      if (row.hasAttribute(ROW_ATTR)) row.removeAttribute(ROW_ATTR);
    }
  }

  function selectAll() {
    errText = '';
    document.querySelectorAll(ROW_SEL).forEach(function (row) { setRowSelected(row, true); });
    disarm();
    updateBar();
  }

  // ---- dsh archived-session API -----------------------------------------

  function hasApi() {
    var d = window.dshDesktop;
    return !!(d && typeof d.archivedList === 'function' && typeof d.archivedApply === 'function');
  }

  // Never rejects: a missing API or a thrown error becomes { ok: false, error }.
  function fetchArchived() {
    return Promise.resolve()
      .then(function () { return window.dshDesktop.archivedList(); })
      .catch(function (err) { return { ok: false, error: String((err && err.message) || err) }; });
  }

  function archivedIds(res) {
    var set = new Set();
    (res.items || []).forEach(function (it) { if (it && it.id) set.add(it.id); });
    return set;
  }

  function refreshManage() {
    if (!hasApi()) {
      manage = { canManage: false, reason: '当前环境无法删除会话' };
      updateBar();
      return Promise.resolve();
    }
    manage = { canManage: false, reason: '正在检查…' };
    updateBar();
    return fetchArchived().then(function (res) {
      manage = res && res.ok && res.canManage
        ? { canManage: true, reason: '' }
        : { canManage: false, reason: (res && (res.reason || res.error)) || '无法管理已归档会话' };
      updateBar();
    });
  }

  function canDelete() {
    return manage.canManage && selected.size > 0;
  }

  // ---- bar --------------------------------------------------------------

  function mkBtn(act, label) {
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('data-act', act);
    b.textContent = label;
    return b;
  }

  function buildBar() {
    var el = document.createElement('div');
    el.id = BAR_ID;
    el.setAttribute('role', 'toolbar');
    el.setAttribute('aria-label', '批量选择');
    countEl = document.createElement('span');
    countEl.className = 'ds-batch-count';
    allBtn = mkBtn('all', '全选');
    delBtn = mkBtn('delete', '删除');
    cancelBtn = mkBtn('cancel', '取消');
    el.appendChild(countEl);
    el.appendChild(allBtn);
    el.appendChild(delBtn);
    el.appendChild(cancelBtn);
    el.addEventListener('click', onBarClick);
    document.body.appendChild(el);
    return el;
  }

  function ensureBar() {
    if (bar && bar.isConnected) return;
    bar = buildBar();
    updateBar();
  }

  function updateBar() {
    if (!bar) return;
    var msg = busy ? statusText : (errText || '已选 ' + selected.size + ' 个');
    setText(countEl, msg);
    countEl.classList.toggle('ds-batch-err', !busy && !!errText);
    setDisabled(allBtn, busy);
    setDisabled(cancelBtn, busy);
    setDisabled(delBtn, busy || !canDelete());
    setText(delBtn, armed ? '确认删除 ' + selected.size + ' 个？' : '删除');
    delBtn.classList.toggle('ds-armed', armed);
    var title = manage.canManage ? '' : manage.reason;
    if (delBtn.title !== title) delBtn.title = title;
  }

  // Keeps a fixed element aligned with the sidebar's bottom edge, or
  // centred at the bottom when the sidebar is collapsed (rail) or narrow.
  // Top edge of the sidebar's settings entry, so the bar sits above the footer.
  function footerTop(side) {
    var items = side.querySelectorAll('button, a');
    for (var i = 0; i < items.length; i++) {
      if ((items[i].textContent || '').trim() === '设置') {
        return items[i].getBoundingClientRect().top;
      }
    }
    return null;
  }

  function placeEl(el) {
    var side = document.querySelector(SIDEBAR_SEL);
    var r = side ? side.getBoundingClientRect() : null;
    if (r && r.width > RAIL_MIN) {
      var top = footerTop(side);
      el.style.left = (r.left + 8) + 'px';
      el.style.width = (r.width - 16) + 'px';
      el.style.right = 'auto';
      el.style.transform = '';
      el.style.bottom = (top !== null
        ? window.innerHeight - top + 8
        : window.innerHeight - r.bottom + BOTTOM_GAP) + 'px';
    } else {
      el.style.left = '50%';
      el.style.width = '';
      el.style.right = 'auto';
      el.style.transform = 'translateX(-50%)';
      el.style.bottom = BOTTOM_GAP + 'px';
    }
  }

  function placeBar() {
    if (bar) placeEl(bar);
  }

  function onBarClick(e) {
    var btn = e.target instanceof Element ? e.target.closest('button') : null;
    if (!btn || btn.disabled || busy) return;
    var act = btn.getAttribute('data-act');
    if (act === 'all') selectAll();
    else if (act === 'delete') onDeleteClick();
    else if (act === 'cancel') exitMode();
  }

  function disarm() {
    clearTimeout(armTimer);
    armTimer = 0;
    armed = false;
    updateBar();
  }

  // First click arms ("确认删除 N 个？", reverts after 3 s); second click runs.
  function onDeleteClick() {
    if (busy || !canDelete()) return;
    if (!armed) {
      errText = '';
      armed = true;
      updateBar();
      clearTimeout(armTimer);
      armTimer = setTimeout(disarm, 3000);
      return;
    }
    disarm();
    runDelete();
  }

  // Floating message shown after the bar has gone (mode already exited).
  function showResult(text, hint, ms) {
    var old = document.getElementById(RESULT_ID);
    if (old) old.remove();
    var el = document.createElement('div');
    el.id = RESULT_ID;
    if (hint) el.className = 'ds-batch-hint';
    el.textContent = text;
    document.body.appendChild(el);
    placeEl(el);
    setTimeout(function () { el.remove(); }, ms || 3000);
  }

  // ---- mode -------------------------------------------------------------

  function enterMode() {
    if (active) return;
    active = true;
    document.body.setAttribute('data-ds-batch', '1');
    ensureBar();
    placeBar();
    updateButton();
    updateBar();
    refreshManage();
  }

  function exitMode() {
    active = false;
    armed = false;
    errText = '';
    statusText = '';
    clearTimeout(armTimer);
    armTimer = 0;
    selected.forEach(function (row) {
      if (row.hasAttribute(ROW_ATTR)) row.removeAttribute(ROW_ATTR);
    });
    selected.clear();
    document.body.removeAttribute('data-ds-batch');
    if (bar) {
      bar.remove();
      bar = null;
    }
    updateButton();
  }

  // ---- archive ----------------------------------------------------------

  function findArchiveItem() {
    var menus = document.querySelectorAll('[role="menu"]');
    for (var i = 0; i < menus.length; i++) {
      var items = menus[i].querySelectorAll('[role="menuitem"]');
      for (var j = 0; j < items.length; j++) {
        if ((items[j].textContent || '').trim() === ARCHIVE_LABEL) return items[j];
      }
    }
    return null;
  }

  function menuOpen() {
    return !!document.querySelector('[role="menu"]');
  }

  function closeMenus() {
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true
    }));
  }

  // Returns true when the row was archived (or, in dry run, when the menu
  // item was found and the menu was closed again).
  async function archiveRow(row, dry) {
    var titleEl = row.querySelector(TITLE_SEL);
    var title = ((titleEl ? titleEl.textContent : row.textContent) || '').trim();
    var opBtn = row.querySelector(OPS_SEL);
    if (!opBtn) return false;

    opBtn.click();
    var item = await waitFor(findArchiveItem, 1500, 50);
    if (!item) {
      closeMenus();
      await waitFor(function () { return !menuOpen(); }, 1000, 50);
      return false;
    }

    if (dry) {
      window.__dsBatchLog.push(title);
      // Simulate the archived list growing by one per archived row.
      window.__fakeArchived = window.__fakeArchived || [];
      window.__fakeArchived.push('fake-' + window.__fakeArchived.length);
      closeMenus();
      await waitFor(function () { return !menuOpen(); }, 2000, 50);
      return true;
    }

    item.click();
    var gone = await waitFor(function () { return !row.isConnected && !menuOpen(); }, 2000, 50);
    if (!gone) {
      closeMenus();
      return false;
    }
    return true;
  }

  // Polls archivedList until exactly `expected` ids are new compared with
  // `known`. Returns those ids, or null after 5 s (never guesses).
  async function waitForNewIds(known, expected) {
    var deadline = Date.now() + 5000;
    for (;;) {
      var res = await fetchArchived();
      if (res && res.ok && res.canManage) {
        var fresh = [];
        archivedIds(res).forEach(function (id) { if (!known.has(id)) fresh.push(id); });
        if (fresh.length === expected) return fresh;
      }
      if (Date.now() >= deadline) return null;
      await sleep(400);
    }
  }

  async function applyDelete(ids) {
    try {
      return await window.dshDesktop.archivedApply('delete', ids);
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  function notDeleted(n) {
    return '已归档 ' + n + ' 个，但无法确定要删除的会话，请到 设置 → 已归档会话 里处理';
  }

  async function runDelete() {
    var rows = Array.from(selected);
    var total = rows.length;
    if (!total) return;
    var dry = window.__dsBatchDryRun === true;

    busy = true;
    errText = '';
    statusText = '检查已归档会话…';
    addBusyStyle();
    updateBar();

    // Step 2: snapshot of already-archived ids. Abort with nothing archived if unavailable.
    var before = await fetchArchived();
    if (!before || !before.ok || !before.canManage) {
      busy = false;
      statusText = '';
      removeBusyStyle();
      errText = (before && (before.reason || before.error)) || '无法管理已归档会话，未归档任何会话';
      updateBar();
      return;
    }
    var known = archivedIds(before);

    var archived = 0;
    var failed = 0;
    var message = '';
    var hint = false;
    var ms = 6000;
    try {
      // Step 3: archive each selected row through dsh's own row menu.
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        statusText = '正在归档 ' + (i + 1) + '/' + total + '…';
        updateBar();
        var ok = false;
        if (row.isConnected) {
          try {
            ok = await archiveRow(row, dry);
          } catch (err) {
            console.warn('[dsBatch] archive step failed', err);
          }
        }
        if (ok) archived++; else failed++;
        await sleep(150);
      }

      if (failed > 0 || archived === 0) {
        message = notDeleted(archived);
      } else {
        // Step 4: the new ids are exactly the set difference; no match means no delete.
        statusText = '核对已归档会话…';
        updateBar();
        var newIds = await waitForNewIds(known, archived);
        if (!newIds) {
          message = notDeleted(archived);
        } else {
          // Step 5: delete only those ids. A successful call reloads the page.
          statusText = '等待确认…';
          updateBar();
          var res = await applyDelete(newIds);
          if (res && res.cancelled) {
            message = '已归档但未删除，可在 设置 → 已归档会话 里恢复或删除';
            hint = true;
            ms = 3000;
          } else if (res && res.ok === false) {
            message = res.error || '删除失败';
          }
        }
      }
    } catch (err) {
      console.warn('[dsBatch] delete failed', err);
      message = '删除失败：' + String((err && err.message) || err);
    } finally {
      busy = false;
      statusText = '';
      removeBusyStyle();
      exitMode();
      if (message) showResult(message, hint, ms);
    }
  }

  // ---- event handling ---------------------------------------------------

  // Capture phase on document: runs before React's root listeners, so
  // stopPropagation keeps dsh from opening the session. Only trusted clicks
  // are intercepted, so programmatic clicks (e.g. label-tweaks export) pass.
  document.addEventListener('click', function (e) {
    if (!active || !e.isTrusted) return;
    var t = e.target;
    if (!(t instanceof Element)) return;
    var row = t.closest(ROW_SEL);
    if (!row || t.closest('button')) return;
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;
    errText = '';
    setRowSelected(row, !selected.has(row));
    disarm();
    updateBar();
  }, true);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && active && !busy) exitMode();
  });

  // ---- sync with React re-renders ---------------------------------------

  function sync() {
    ensureButton();
    if (active) {
      selected.forEach(function (row) {
        if (!row.isConnected) selected.delete(row);
        else if (row.getAttribute(ROW_ATTR) !== '1') row.setAttribute(ROW_ATTR, '1');
      });
      ensureBar();
      updateBar();
      placeBar();
    }
  }

  // Coalesces bursts of mutations into one sync. rAF is paused in hidden
  // panes, so a 120 ms timer is the fallback; whichever fires first runs it.
  function schedule() {
    if (scheduled) return;
    scheduled = 1;
    var fired = false;
    var run = function () {
      if (fired) return;
      fired = true;
      scheduled = 0;
      try { sync(); } catch (err) { console.warn('[dsBatch] sync failed', err); }
    };
    requestAnimationFrame(run);
    setTimeout(run, 120);
  }

  injectStyle();
  var observer = new MutationObserver(schedule);
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  window.addEventListener('resize', schedule);
  try { sync(); } catch (err) { console.warn('[dsBatch] sync failed', err); }
})();
