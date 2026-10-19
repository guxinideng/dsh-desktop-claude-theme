(function () {
  // Archived sessions entry for the DSH settings dialog. A cloned nav item
  // ("已归档会话") is appended after the last native settings nav item, and
  // clicking it opens our own overlay (a body-level fixed layer) listing the
  // archived sessions, with restore / permanent delete actions backed by
  // window.dshDesktop.archivedList / archivedApply. Idempotent.
  //
  // React owns the settings dialog, so this script never edits or removes
  // React-managed nodes' children: it only appends one cloned nav button into
  // the nav list, and keeps its overlay as a separate body child. Installed
  // only when the preload bridge exposes both archive methods.
  if (!window.dshDesktop ||
      typeof window.dshDesktop.archivedList !== 'function' ||
      typeof window.dshDesktop.archivedApply !== 'function') return;
  if (window.__dshArchivedPageInstalled) return;
  window.__dshArchivedPageInstalled = true;

  var NAV_ATTR = 'data-ds-archived-nav';
  var NAV_LABEL = '已归档会话';
  var OVERLAY_ID = 'ds-archived-overlay';
  var STYLE_ID = 'ds-archived-style';
  var SETTINGS_MARK = '通用设置';
  var THEME_VARS = [
    '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2',
    '--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary',
    '--dsw-alias-border-l2', '--dsw-alias-border-l1',
    '--dsw-alias-interactive-bg-hover', '--dsw-alias-interactive-bg-active',
    '--dsw-alias-state-warn-bg', '--dsw-alias-state-warn-label',
    '--dsw-alias-state-error-primary', '--dsw-alias-brand-primary', '--dsw-alias-label-primary-inverted'
  ];

  var CSS = [
    '#' + OVERLAY_ID + ' { position: fixed; inset: 0; z-index: 2000; display: flex; align-items: center; justify-content: center; background: rgba(15, 17, 21, 0.38); font-family: -apple-system, "system-ui", "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif; }',
    '#' + OVERLAY_ID + ' .ds-ar-card { box-sizing: border-box; width: min(640px, calc(100vw - 32px)); max-height: 80vh; display: flex; flex-direction: column; background: var(--dsw-alias-bg-layer-1, #fffdf9); color: var(--dsw-alias-label-primary, #1f1b16); border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.12)); border-radius: 16px; box-shadow: 0 18px 48px rgba(0,0,0,0.22); padding: 22px 24px 18px; outline: none; }',
    '#' + OVERLAY_ID + ' .ds-ar-title { margin: 0; font-size: 18px; font-weight: 600; letter-spacing: 0.01em; }',
    '#' + OVERLAY_ID + ' .ds-ar-desc { margin: 6px 0 14px; font-size: 13px; line-height: 1.6; color: var(--dsw-alias-label-secondary, #6b645b); }',
    '#' + OVERLAY_ID + ' .ds-ar-banner { margin: 0 0 12px; padding: 9px 12px; border-radius: 10px; font-size: 13px; line-height: 1.5; background: var(--dsw-alias-state-warn-bg, #fdf1e1); color: var(--dsw-alias-state-warn-label, #9a5a12); }',
    '#' + OVERLAY_ID + ' .ds-ar-banner[hidden] { display: none; }',
    '#' + OVERLAY_ID + ' .ds-ar-body { flex: 1 1 auto; min-height: 120px; overflow-y: auto; scrollbar-width: none; -ms-overflow-style: none; border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.08)); border-radius: 12px; }',
    '#' + OVERLAY_ID + ' .ds-ar-body::-webkit-scrollbar { display: none; }',
    '#' + OVERLAY_ID + ' .ds-ar-state { padding: 36px 16px; text-align: center; font-size: 14px; color: var(--dsw-alias-label-secondary, #6b645b); line-height: 1.6; }',
    '#' + OVERLAY_ID + ' .ds-ar-list { list-style: none; margin: 0; padding: 4px 0; }',
    '#' + OVERLAY_ID + ' .ds-ar-row { display: flex; align-items: center; gap: 10px; padding: 9px 14px; cursor: pointer; border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.06)); }',
    '#' + OVERLAY_ID + ' .ds-ar-row:first-child { border-top: 0; }',
    '#' + OVERLAY_ID + ' .ds-ar-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.04)); }',
    '#' + OVERLAY_ID + ' .ds-ar-row input { margin: 0; flex: 0 0 auto; cursor: pointer; accent-color: var(--dsw-alias-brand-primary, #c96442); }',
    '#' + OVERLAY_ID + ' .ds-ar-text { flex: 1 1 auto; min-width: 0; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '#' + OVERLAY_ID + ' .ds-ar-untitled { color: var(--dsw-alias-label-tertiary, #9a938a); }',
    '#' + OVERLAY_ID + ' .ds-ar-id { flex: 0 0 auto; font-family: ui-monospace, Menlo, monospace; font-size: 12px; color: var(--dsw-alias-label-tertiary, #9a938a); }',
    '#' + OVERLAY_ID + ' .ds-ar-error { min-height: 0; margin: 10px 0 0; font-size: 13px; color: var(--dsw-alias-state-error-primary, #c0392b); }',
    '#' + OVERLAY_ID + ' .ds-ar-error:empty { display: none; }',
    '#' + OVERLAY_ID + ' .ds-ar-footer { display: flex; align-items: center; gap: 8px; margin-top: 14px; flex-wrap: wrap; }',
    '#' + OVERLAY_ID + ' .ds-ar-spacer { flex: 1 1 auto; }',
    '#' + OVERLAY_ID + ' .ds-ar-btn { appearance: none; font: inherit; font-size: 13px; padding: 7px 14px; border-radius: 999px; cursor: pointer; border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.12)); background: transparent; color: var(--dsw-alias-label-primary, #1f1b16); }',
    '#' + OVERLAY_ID + ' .ds-ar-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.04)); }',
    '#' + OVERLAY_ID + ' .ds-ar-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #c96442); outline-offset: 2px; }',
    '#' + OVERLAY_ID + ' .ds-ar-btn:disabled { opacity: 0.45; cursor: not-allowed; }',
    '#' + OVERLAY_ID + ' .ds-ar-btn-link { border: 0; padding: 7px 4px; color: var(--dsw-alias-label-secondary, #6b645b); }',
    '#' + OVERLAY_ID + ' .ds-ar-btn-primary { background: var(--dsw-alias-brand-primary, #c96442); border-color: transparent; color: var(--dsw-alias-label-primary-inverted, #fff); }',
    '#' + OVERLAY_ID + ' .ds-ar-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-brand-primary, #c96442); filter: brightness(0.95); }',
    '#' + OVERLAY_ID + ' .ds-ar-btn-danger { color: var(--dsw-alias-state-error-primary, #c0392b); }',
    '#' + OVERLAY_ID + ' .ds-ar-btn-danger:hover:not(:disabled) { background: rgba(192, 57, 43, 0.08); }',
    '[' + NAV_ATTR + '].ds-ar-nav-active { font-weight: 600; }'
  ].join('\n');

  var state = {
    open: false,
    session: 0,       // bumps on every open/close, so stale promises are ignored
    items: [],        // { id, title }
    selected: {},     // id -> true
    busy: false,
    pendingAction: null,
    overlay: null,
    lastFocus: null
  };

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  // The settings dialog (React-managed) is the one whose text contains 通用设置.
  function findSettingsDialog() {
    var list = document.querySelectorAll('[role="dialog"]');
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === OVERLAY_ID) continue;
      if ((list[i].textContent || '').indexOf(SETTINGS_MARK) !== -1 && list[i].querySelector('nav')) {
        return list[i];
      }
    }
    return null;
  }

  // ---- nav entry ---------------------------------------------------------

  function setNavActive(on) {
    var item = document.querySelector('[' + NAV_ATTR + ']');
    if (!item) return;
    if (on) item.classList.add('ds-ar-nav-active');
    else item.classList.remove('ds-ar-nav-active');
    if (on) item.setAttribute('aria-current', 'true');
    else item.removeAttribute('aria-current');
  }

  function ensureNavEntry(dialog) {
    var nav = dialog.querySelector('nav');
    if (!nav || nav.querySelector('[' + NAV_ATTR + ']')) return;
    var natives = nav.querySelectorAll('button');
    var src = natives[natives.length - 1];
    if (!src || !src.parentNode) return;

    var item = src.cloneNode(true);
    item.removeAttribute('id');
    item.removeAttribute('aria-current');
    item.removeAttribute('aria-selected');
    item.setAttribute('type', 'button');
    item.setAttribute(NAV_ATTR, '1');
    // Drop the selected-state classes of the source (e.g. the active marker).
    var cls = (item.getAttribute('class') || '').split(/\s+/).filter(function (c) {
      return c && !/active|selected|current/i.test(c);
    });
    item.setAttribute('class', cls.join(' '));
    // No icon: a generic svg from the source would be misleading.
    var svgs = item.querySelectorAll('svg');
    for (var i = 0; i < svgs.length; i++) svgs[i].parentNode.removeChild(svgs[i]);
    var label = item.querySelector('span') || item;
    label.textContent = NAV_LABEL;
    item.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openPanel(item);
    });
    src.parentNode.insertBefore(item, src.nextSibling);
  }

  // ---- overlay -----------------------------------------------------------

  function readThemeVars(source) {
    var out = {};
    if (!source) return out;
    var cs = getComputedStyle(source);
    THEME_VARS.forEach(function (name) {
      var v = cs.getPropertyValue(name).trim();
      if (v) out[name] = v;
    });
    return out;
  }

  function buildOverlay(themeVars) {
    var overlay = el('div');
    overlay.id = OVERLAY_ID;
    Object.keys(themeVars).forEach(function (name) {
      overlay.style.setProperty(name, themeVars[name]);
    });

    var card = el('div', 'ds-ar-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'ds-ar-title');
    card.tabIndex = -1;

    var title = el('h2', 'ds-ar-title', NAV_LABEL);
    title.id = 'ds-ar-title';
    var desc = el('p', 'ds-ar-desc', '归档的会话不会显示在侧栏。你可以恢复它们，或永久删除（文件会先移到回收区）。');
    var banner = el('div', 'ds-ar-banner');
    banner.setAttribute('role', 'status');
    banner.hidden = true;
    var body = el('div', 'ds-ar-body');
    var error = el('div', 'ds-ar-error');
    error.setAttribute('role', 'alert');

    var footer = el('div', 'ds-ar-footer');
    var selectAll = el('button', 'ds-ar-btn ds-ar-btn-link', '全选');
    selectAll.type = 'button';
    var spacer = el('span', 'ds-ar-spacer');
    var restore = el('button', 'ds-ar-btn ds-ar-btn-primary', '恢复所选');
    restore.type = 'button';
    var remove = el('button', 'ds-ar-btn ds-ar-btn-danger', '永久删除所选');
    remove.type = 'button';
    var close = el('button', 'ds-ar-btn', '关闭');
    close.type = 'button';
    footer.appendChild(selectAll);
    footer.appendChild(spacer);
    footer.appendChild(restore);
    footer.appendChild(remove);
    footer.appendChild(close);

    card.appendChild(title);
    card.appendChild(desc);
    card.appendChild(banner);
    card.appendChild(body);
    card.appendChild(error);
    card.appendChild(footer);
    overlay.appendChild(card);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closePanel();
    });
    close.addEventListener('click', function () { closePanel(); });
    selectAll.addEventListener('click', function () { toggleSelectAll(); });
    restore.addEventListener('click', function () { applyAction('restore'); });
    remove.addEventListener('click', function () { applyAction('delete'); });

    state.overlay = overlay;
    return {
      overlay: overlay, card: card, banner: banner, body: body, error: error,
      selectAll: selectAll, restore: restore, remove: remove
    };
  }

  var ui = null;

  function selectedIds() {
    return state.items.filter(function (it) { return state.selected[it.id]; }).map(function (it) { return it.id; });
  }

  function render() {
    if (!ui) return;
    var ids = selectedIds();
    var canManage = state.canManage !== false;
    var hasItems = state.items.length > 0 && !state.loadError;

    ui.selectAll.disabled = state.busy || !hasItems;
    var allSelected = hasItems && ids.length === state.items.length;
    ui.selectAll.textContent = allSelected ? '取消全选' : '全选';

    var canAct = canManage && !state.busy && ids.length > 0;
    ui.restore.disabled = !canAct;
    ui.remove.disabled = !canAct;
    ui.restore.textContent = state.busy && state.pendingAction === 'restore' ? '处理中…' : '恢复所选';
    ui.remove.textContent = state.busy && state.pendingAction === 'delete' ? '处理中…' : '永久删除所选';
  }

  function setBody(node) {
    while (ui.body.firstChild) ui.body.removeChild(ui.body.firstChild);
    ui.body.appendChild(node);
  }

  function renderBody() {
    if (!ui) return;
    if (state.loading) {
      setBody(el('div', 'ds-ar-state', '加载中…'));
      return;
    }
    if (state.loadError) {
      setBody(el('div', 'ds-ar-state', '读取失败' + (state.loadError ? '：' + state.loadError : '')));
      return;
    }
    if (!state.items.length) {
      setBody(el('div', 'ds-ar-state', '没有已归档的会话'));
      return;
    }
    var list = el('ul', 'ds-ar-list');
    state.items.forEach(function (it) {
      var li = el('li');
      var row = el('label', 'ds-ar-row');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!state.selected[it.id];
      cb.disabled = state.busy;
      cb.addEventListener('change', function () {
        if (cb.checked) state.selected[it.id] = true;
        else delete state.selected[it.id];
        render();
      });
      var hasTitle = typeof it.title === 'string' && it.title.length > 0;
      var text = el('span', 'ds-ar-text' + (hasTitle ? '' : ' ds-ar-untitled'), hasTitle ? it.title : '（无标题）');
      var idTag = el('span', 'ds-ar-id', String(it.id).slice(0, 8));
      row.appendChild(cb);
      row.appendChild(text);
      row.appendChild(idTag);
      li.appendChild(row);
      list.appendChild(li);
    });
    setBody(list);
  }

  function renderBanner() {
    if (!ui) return;
    if (state.canManage === false && !state.loadError) {
      ui.banner.textContent = state.reason || '当前无法管理已归档会话，仅可查看。';
      ui.banner.hidden = false;
    } else {
      ui.banner.textContent = '';
      ui.banner.hidden = true;
    }
  }

  function setError(msg) {
    if (!ui) return;
    ui.error.textContent = msg || '';
  }

  function load() {
    var session = state.session;
    state.loading = true;
    state.loadError = null;
    state.items = [];
    state.selected = {};
    setError('');
    renderBanner();
    renderBody();
    render();
    var p;
    try {
      p = Promise.resolve(window.dshDesktop.archivedList());
    } catch (err) {
      p = Promise.reject(err);
    }
    p.then(function (res) {
      if (session !== state.session) return;
      state.loading = false;
      if (!res || res.ok !== true) {
        state.loadError = (res && res.reason) || '未知错误';
        state.items = [];
        state.canManage = false;
        state.reason = '';
      } else {
        state.canManage = res.canManage !== false;
        state.reason = res.reason || '';
        state.items = Array.isArray(res.items) ? res.items.filter(function (it) {
          return it && typeof it.id === 'string';
        }) : [];
      }
      renderBanner();
      renderBody();
      render();
    }, function (err) {
      if (session !== state.session) return;
      state.loading = false;
      state.loadError = (err && err.message) || '未知错误';
      state.canManage = false;
      renderBanner();
      renderBody();
      render();
    });
  }

  function toggleSelectAll() {
    if (state.busy || !state.items.length) return;
    var all = selectedIds().length === state.items.length;
    state.selected = {};
    if (!all) state.items.forEach(function (it) { state.selected[it.id] = true; });
    renderBody();
    render();
  }

  function setBusy(on, action) {
    state.busy = on;
    state.pendingAction = on ? action : null;
    if (ui) {
      ui.body.setAttribute('aria-busy', on ? 'true' : 'false');
    }
    renderBody();
    render();
  }

  function applyAction(action) {
    if (state.busy || state.loading) return;
    if (state.canManage === false) return;
    var ids = selectedIds();
    if (!ids.length) return;
    var session = state.session;
    setError('');
    setBusy(true, action);
    var p;
    try {
      p = Promise.resolve(window.dshDesktop.archivedApply(action, ids));
    } catch (err) {
      p = Promise.reject(err);
    }
    p.then(function (res) {
      if (session !== state.session) return;
      // Success may never arrive: the main process restarts dsh and reloads.
      if (!res) {
        setBusy(false);
        setError('操作没有返回结果');
        return;
      }
      if (res.cancelled) {
        setBusy(false);
        return;
      }
      if (res.ok === false) {
        setBusy(false);
        setError(res.error || '操作失败');
        return;
      }
      setBusy(false);
      load();
    }, function (err) {
      if (session !== state.session) return;
      setBusy(false);
      setError('操作失败：' + ((err && err.message) || '未知错误'));
    });
  }

  function focusables() {
    if (!ui) return [];
    return Array.prototype.slice.call(ui.card.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])'))
      .filter(function (n) { return !n.disabled && n.offsetParent !== null; });
  }

  function onKeyDown(e) {
    if (!state.open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closePanel();
      return;
    }
    if (e.key === 'Tab' && ui) {
      var list = focusables();
      if (!list.length) { e.preventDefault(); ui.card.focus(); return; }
      var first = list[0];
      var last = list[list.length - 1];
      var active = document.activeElement;
      if (!ui.card.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  function openPanel(navItem) {
    if (state.open) return;
    var dialog = findSettingsDialog();
    if (!dialog) return;
    injectStyle();
    state.open = true;
    state.session += 1;
    state.canManage = true;
    state.reason = '';
    state.loadError = null;
    state.loading = false;
    state.busy = false;
    state.pendingAction = null;
    state.lastFocus = navItem || null;

    ui = buildOverlay(readThemeVars(dialog));
    document.body.appendChild(ui.overlay);
    setNavActive(true);
    load();
    try { ui.card.focus(); } catch (e) { /* ignore */ }
  }

  function closePanel() {
    if (!state.open) return;
    state.open = false;
    state.session += 1;
    state.busy = false;
    state.pendingAction = null;
    if (ui && ui.overlay.parentNode) ui.overlay.parentNode.removeChild(ui.overlay);
    ui = null;
    state.overlay = null;
    setNavActive(false);
    var back = state.lastFocus;
    state.lastFocus = null;
    if (back && back.isConnected) {
      try { back.focus(); } catch (e) { /* ignore */ }
    }
  }

  // ---- native navigation / lifecycle ------------------------------------

  // Clicking a native settings nav item leaves our page: close the overlay
  // and drop our highlight. Our own entry is ignored here.
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!(t instanceof Element)) return;
    var btn = t.closest('button');
    if (!btn || btn.hasAttribute(NAV_ATTR)) return;
    var dialog = findSettingsDialog();
    if (!dialog) return;
    var nav = dialog.querySelector('nav');
    if (nav && nav.contains(btn)) {
      setNavActive(false);
      if (state.open) closePanel();
    }
  }, true);

  document.addEventListener('keydown', onKeyDown, true);

  var scheduled = 0;
  function sync() {
    scheduled = 0;
    try {
      var dialog = findSettingsDialog();
      if (dialog) {
        ensureNavEntry(dialog);
      } else if (state.open) {
        // Settings dialog went away (closed or re-rendered): close our layer.
        closePanel();
      }
    } catch (e) {
      console.warn('[dshArchived] sync failed', e);
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = requestAnimationFrame(sync);
  }

  var observer = new MutationObserver(schedule);
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  schedule();
})();
