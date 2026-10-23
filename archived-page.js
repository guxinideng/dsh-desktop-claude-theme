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
    '#' + OVERLAY_ID + ' { position: fixed; inset: 0; z-index: 2000; display: flex; align-items: center; justify-content: center; background: rgba(15, 17, 21, 0.38); font-family: var(--dsw-font-family, -apple-system, "system-ui", "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif); }',
    '#' + OVERLAY_ID + ' .ds-ar-card { box-sizing: border-box; width: min(640px, calc(100vw - 32px)); max-height: 80vh; display: flex; flex-direction: column; background: var(--dsw-alias-bg-layer-1, #fffdf9); color: var(--dsw-alias-label-primary, #1f1b16); border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.12)); border-radius: 24px; box-shadow: var(--dsw-shadow-lv3, 0 18px 48px rgba(0,0,0,0.22)); padding: 22px 24px 18px; outline: none; overflow-y: auto; }',
    '#' + OVERLAY_ID + ' .ds-ar-title { margin: 0; font-size: 18px; font-weight: 600; letter-spacing: 0.01em; }',
    '#' + OVERLAY_ID + ' .ds-ar-desc { margin: 6px 0 14px; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary, #6b645b); }',
    '#' + OVERLAY_ID + ' .ds-ar-banner { margin: 0 0 12px; padding: 9px 12px; border-radius: 10px; font-size: 13px; line-height: 1.5; background: var(--dsw-alias-state-warn-bg, #fdf1e1); color: var(--dsw-alias-state-warn-label, #9a5a12); }',
    '#' + OVERLAY_ID + ' .ds-ar-banner[hidden] { display: none; }',
    '#' + OVERLAY_ID + ' .ds-ar-body { flex: 1 1 auto; min-height: 120px; overflow-y: auto; scrollbar-width: none; -ms-overflow-style: none; border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.08)); border-radius: 12px; }',
    '#' + OVERLAY_ID + ' .ds-ar-body::-webkit-scrollbar { display: none; }',
    '#' + OVERLAY_ID + ' .ds-ar-state { padding: 36px 16px; text-align: center; font-size: 14px; color: var(--dsw-alias-label-secondary, #6b645b); line-height: 1.6; }',
    '#' + OVERLAY_ID + ' .ds-ar-list { list-style: none; margin: 0; padding: 4px 0; }',
    '#' + OVERLAY_ID + ' .ds-ar-row { display: flex; align-items: center; gap: 10px; padding: 9px 14px; cursor: pointer; border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.06)); transition: background-color 150ms cubic-bezier(.4,0,.2,1); }',
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
    '#' + OVERLAY_ID + ' .ds-ar-btn { appearance: none; font: inherit; font-size: 14px; line-height: 22px; height: 36px; padding: 0 14px; border-radius: 18px; cursor: pointer; border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.12)); background: transparent; color: var(--dsw-alias-label-primary, #1f1b16); transition: background-color 150ms cubic-bezier(.4,0,.2,1); }',
    '#' + OVERLAY_ID + ' .ds-ar-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.04)); }',
    '#' + OVERLAY_ID + ' .ds-ar-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #c96442); outline-offset: 2px; }',
    '#' + OVERLAY_ID + ' .ds-ar-btn:disabled { opacity: 0.45; cursor: not-allowed; }',
    '#' + OVERLAY_ID + ' .ds-ar-btn-link { border: 0; padding: 7px 4px; color: var(--dsw-alias-label-secondary, #6b645b); }',
    '#' + OVERLAY_ID + ' .ds-ar-btn-primary { background: var(--dsw-alias-brand-primary, #c96442); border-color: transparent; color: var(--dsw-alias-label-primary-inverted, #fff); }',
    '#' + OVERLAY_ID + ' .ds-ar-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-brand-primary, #c96442); filter: brightness(0.95); }',
    '#' + OVERLAY_ID + ' .ds-ar-btn-danger { color: var(--dsw-alias-state-error-primary, #c0392b); }',
    '#' + OVERLAY_ID + ' .ds-ar-btn-danger:hover:not(:disabled) { background: rgba(192, 57, 43, 0.08); }',
    '#' + OVERLAY_ID + ' .ds-ar-tools { display: flex; justify-content: flex-end; margin: 0 0 10px; }',
    '#' + OVERLAY_ID + ' .ds-ar-clean { flex: 0 0 auto; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.08)); }',
    '#' + OVERLAY_ID + ' .ds-ar-clean-title { margin: 0; font-size: 15px; font-weight: 600; }',
    '#' + OVERLAY_ID + ' .ds-ar-clean-desc { margin: 4px 0 6px; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary, #6b645b); }',
    '#' + OVERLAY_ID + ' .ds-ar-clean-status { margin: 0 0 4px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary, #9a938a); }',
    '#' + OVERLAY_ID + ' .ds-ar-clean-status:empty { display: none; }',
    '#' + OVERLAY_ID + ' .ds-ar-clean-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 10px 0; border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.06)); }',
    '#' + OVERLAY_ID + ' .ds-ar-clean-row:first-child { border-top: 0; }',
    '#' + OVERLAY_ID + ' .ds-ar-clean-main { flex: 1 1 200px; min-width: 0; }',
    '#' + OVERLAY_ID + ' .ds-ar-clean-name { font-size: 14px; line-height: 22px; }',
    '#' + OVERLAY_ID + ' .ds-ar-clean-sub { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary, #6b645b); }',
    '#' + OVERLAY_ID + ' .ds-ar-clean-size { flex: 0 0 auto; min-width: 72px; text-align: right; font-size: 14px; line-height: 22px; font-variant-numeric: tabular-nums; }',
    '#' + OVERLAY_ID + ' .ds-ar-clean-actions { flex: 0 0 auto; display: flex; gap: 8px; }',
    '#' + OVERLAY_ID + ' .ds-ar-clean-flash { flex: 0 0 auto; font-size: 12px; color: var(--dsw-alias-label-secondary, #6b645b); }',
    '#' + OVERLAY_ID + ' .ds-ar-clean-err { flex: 0 0 100%; font-size: 13px; line-height: 18px; color: var(--dsw-alias-state-error-primary, #c0392b); }',
    '#' + OVERLAY_ID + ' .ds-ar-clean-err:empty { display: none; }',
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
    lastFocus: null,
    cleanupBusy: false,   // a storage-cleanup action is in flight
    cleanupKind: null,    // its kind, to label the button "处理中…"
    cleanup: { info: null, loading: false, loadError: false },
    rowErr: {},           // rowKey -> error text
    flash: {},            // rowKey -> "已清理 X" (3s)
    flashTimers: {}
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

  // ---- storage cleanup helpers -------------------------------------------
  // Rows of the 存储清理 block. rule: 'nonempty' disables the button and shows
  // "空" when count is 0; 'gt1' only disables it when count <= 1.

  var CLEAN_ROWS = [
    { key: 'trash', name: '回收区', desc: '已删除会话的文件，清空后才真正从磁盘删除。',
      buttons: [{ kind: 'trash', label: '清空回收区', rule: 'nonempty' }] },
    { key: 'backups', name: '索引备份', desc: '每次恢复/删除前自动生成的索引备份。',
      buttons: [{ kind: 'backups-keep-latest', label: '保留最新一份', rule: 'gt1' },
                { kind: 'backups-all', label: '全部清理', rule: 'nonempty' }] },
    { key: 'attachments', name: '会话附件缓存', desc: '图片等附件缓存；仍显示在会话里的图片之后可能无法再显示。',
      buttons: [{ kind: 'attachments', label: '清空附件', rule: 'nonempty' }] }
  ];

  // Both methods must exist, or the whole cleanup block (and the delete-all
  // button, which uses cleanupApply) is left out.
  function cleanupSupported() {
    var api = window.dshDesktop;
    return !!api && typeof api.cleanupInfo === 'function' && typeof api.cleanupApply === 'function';
  }

  function callBridge(name, args) {
    try {
      return Promise.resolve(window.dshDesktop[name].apply(window.dshDesktop, args || []));
    } catch (err) {
      return Promise.reject(err);
    }
  }

  function fmtBytes(n) {
    var v = Number(n);
    if (!isFinite(v) || v < 0) v = 0;
    if (v < 1024) return Math.round(v) + ' B';
    var units = ['KB', 'MB', 'GB'];
    var i = -1;
    do { v /= 1024; i++; } while (v >= 1024 && i < units.length - 1);
    return v.toFixed(1) + ' ' + units[i];
  }

  function errText(err) {
    return (err && err.message) || '未知错误';
  }

  function resetCleanupState() {
    Object.keys(state.flashTimers).forEach(function (k) { clearTimeout(state.flashTimers[k]); });
    state.flashTimers = {};
    state.flash = {};
    state.rowErr = {};
    state.cleanup = { info: null, loading: false, loadError: false };
    state.cleanupBusy = false;
    state.cleanupKind = null;
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

    var tools = null;
    var deleteAll = null;
    var clean = null;
    if (cleanupSupported()) {
      tools = el('div', 'ds-ar-tools');
      deleteAll = el('button', 'ds-ar-btn ds-ar-btn-danger', '全部永久删除');
      deleteAll.type = 'button';
      deleteAll.addEventListener('click', function () { applyAll(); });
      tools.appendChild(deleteAll);
      clean = buildCleanSection();
    }

    card.appendChild(title);
    card.appendChild(desc);
    card.appendChild(banner);
    if (tools) card.appendChild(tools);
    card.appendChild(body);
    if (clean) card.appendChild(clean.section);
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
      selectAll: selectAll, restore: restore, remove: remove,
      deleteAll: deleteAll, clean: clean
    };
  }

  function buildCleanSection() {
    var section = el('div', 'ds-ar-clean');
    var list = el('div', 'ds-ar-clean-list');
    section.appendChild(el('h3', 'ds-ar-clean-title', '存储清理'));
    section.appendChild(el('p', 'ds-ar-clean-desc', '这些文件不在侧栏显示，清理后无法恢复。'));
    var status = el('div', 'ds-ar-clean-status');
    section.appendChild(status);
    section.appendChild(list);

    var rows = CLEAN_ROWS.map(function (def) {
      var row = el('div', 'ds-ar-clean-row');
      var main = el('div', 'ds-ar-clean-main');
      main.appendChild(el('div', 'ds-ar-clean-name', def.name));
      main.appendChild(el('div', 'ds-ar-clean-sub', def.desc));
      var size = el('span', 'ds-ar-clean-size', '—');
      var actions = el('div', 'ds-ar-clean-actions');
      var buttons = def.buttons.map(function (b) {
        var btn = el('button', 'ds-ar-btn', b.label);
        btn.type = 'button';
        btn.addEventListener('click', function () { runCleanup(def.key, b); });
        actions.appendChild(btn);
        return { def: b, node: btn };
      });
      var flash = el('span', 'ds-ar-clean-flash');
      var err = el('div', 'ds-ar-clean-err');
      err.setAttribute('role', 'alert');
      row.appendChild(main);
      row.appendChild(size);
      row.appendChild(actions);
      row.appendChild(flash);
      row.appendChild(err);
      list.appendChild(row);
      return { key: def.key, size: size, buttons: buttons, flash: flash, err: err };
    });
    return { section: section, status: status, rows: rows };
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

    var anyBusy = state.busy || state.cleanupBusy;

    ui.selectAll.disabled = anyBusy || !hasItems;
    var allSelected = hasItems && ids.length === state.items.length;
    ui.selectAll.textContent = allSelected ? '取消全选' : '全选';

    var canAct = canManage && !anyBusy && ids.length > 0;
    ui.restore.disabled = !canAct;
    ui.remove.disabled = !canAct;
    ui.restore.textContent = state.busy && state.pendingAction === 'restore' ? '处理中…' : '恢复所选';
    ui.remove.textContent = state.busy && state.pendingAction === 'delete' ? '处理中…' : '永久删除所选';

    if (ui.deleteAll) {
      ui.deleteAll.disabled = !canManage || anyBusy || state.loading || !hasItems;
      ui.deleteAll.textContent = state.busy && state.pendingAction === 'archived-all' ? '处理中…' : '全部永久删除';
    }
    renderCleanup();
  }

  function renderCleanup() {
    if (!ui || !ui.clean) return;
    var c = ui.clean;
    var cs = state.cleanup;
    var hasData = !!cs.info && !cs.loadError;
    var locked = state.busy || state.cleanupBusy || cs.loading;
    c.status.textContent = cs.loadError ? '读取失败' : (cs.loading && !hasData ? '读取中…' : '');
    c.rows.forEach(function (r) {
      var data = hasData && cs.info[r.key] ? cs.info[r.key] : null;
      r.size.textContent = data ? fmtBytes(data.bytes) : '—';
      r.buttons.forEach(function (b) {
        var count = data ? data.count : undefined;
        var text = b.def.label;
        var disabled = locked || !data;
        if (data && b.def.rule === 'nonempty' && !(count > 0)) { text = '空'; disabled = true; }
        if (data && b.def.rule === 'gt1' && !(count > 1)) disabled = true;
        if (state.cleanupBusy && state.cleanupKind === b.def.kind) { text = '处理中…'; disabled = true; }
        b.node.textContent = text;
        b.node.disabled = disabled;
      });
      r.err.textContent = state.rowErr[r.key] || '';
      r.flash.textContent = state.flash[r.key] || '';
    });
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
      cb.disabled = state.busy || state.cleanupBusy;
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
    if (state.busy || state.loading || state.cleanupBusy) return;
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

  // Re-reads the storage numbers. When opts.before is given (after a cleanup
  // succeeded), the freed size is flashed on that row for 3 seconds.
  function loadCleanup(opts) {
    if (!ui || !ui.clean) return;
    var session = state.session;
    state.cleanup.loading = true;
    renderCleanup();
    callBridge('cleanupInfo').then(function (res) {
      if (session !== state.session) return;
      state.cleanup.loading = false;
      if (!res || res.ok !== true) {
        state.cleanup.info = null;
        state.cleanup.loadError = true;
      } else {
        state.cleanup.info = res;
        state.cleanup.loadError = false;
        if (opts && opts.before) flashFreed(opts.key, opts.before, res);
      }
      renderCleanup();
    }, function () {
      if (session !== state.session) return;
      state.cleanup.loading = false;
      state.cleanup.info = null;
      state.cleanup.loadError = true;
      renderCleanup();
    });
  }

  function flashFreed(key, before, after) {
    var b = before[key] ? Number(before[key].bytes) || 0 : 0;
    var a = after[key] ? Number(after[key].bytes) || 0 : 0;
    state.flash[key] = '已清理 ' + fmtBytes(Math.max(0, b - a));
    clearTimeout(state.flashTimers[key]);
    state.flashTimers[key] = setTimeout(function () {
      delete state.flash[key];
      delete state.flashTimers[key];
      renderCleanup();
    }, 3000);
  }

  // One button in the 存储清理 block. The native confirm is shown by the main
  // process, so no page-side confirm here.
  function runCleanup(key, b) {
    if (!ui || !ui.clean) return;
    if (state.busy || state.cleanupBusy || state.loading || state.cleanup.loading) return;
    if (!state.cleanup.info) return;
    var session = state.session;
    var before = state.cleanup.info;
    state.cleanupBusy = true;
    state.cleanupKind = b.kind;
    state.rowErr[key] = '';
    render();
    callBridge('cleanupApply', [b.kind]).then(function (res) {
      if (session !== state.session) return;
      state.cleanupBusy = false;
      state.cleanupKind = null;
      if (!res) {
        state.rowErr[key] = '操作没有返回结果';
        render();
      } else if (res.cancelled) {
        render();
      } else if (res.ok !== true) {
        state.rowErr[key] = String(res.error || '操作失败');
        render();
      } else {
        render();
        loadCleanup({ key: key, before: before });
      }
    }, function (err) {
      if (session !== state.session) return;
      state.cleanupBusy = false;
      state.cleanupKind = null;
      state.rowErr[key] = '操作失败：' + errText(err);
      render();
    });
  }

  // 全部永久删除: the main process shows the native confirm and may reload
  // dsh, so the promise can stay pending forever. That is fine.
  function applyAll() {
    if (!ui || !ui.deleteAll) return;
    if (state.busy || state.cleanupBusy || state.loading) return;
    if (state.canManage === false || state.loadError || !state.items.length) return;
    var session = state.session;
    setError('');
    setBusy(true, 'archived-all');
    callBridge('cleanupApply', ['archived-all']).then(function (res) {
      if (session !== state.session) return;
      if (!res) { setBusy(false); setError('操作没有返回结果'); return; }
      if (res.cancelled) { setBusy(false); return; }
      if (res.ok !== true) { setBusy(false); setError(String(res.error || '操作失败')); return; }
      setBusy(false);
      load();
      loadCleanup();
    }, function (err) {
      if (session !== state.session) return;
      setBusy(false);
      setError('操作失败：' + errText(err));
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
    resetCleanupState();

    ui = buildOverlay(readThemeVars(dialog));
    document.body.appendChild(ui.overlay);
    setNavActive(true);
    load();
    loadCleanup();
    try { ui.card.focus(); } catch (e) { /* ignore */ }
  }

  function closePanel() {
    if (!state.open) return;
    state.open = false;
    state.session += 1;
    state.busy = false;
    state.pendingAction = null;
    resetCleanupState();
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
