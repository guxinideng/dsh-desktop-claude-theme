(function () {
  // Composer attachments, Claude/Codex style. The native "+" opens our own
  // menu (add files / add folder / the original slash-command menu). Picked
  // paths show as chips above the textarea, and on send they are prepended to
  // the message as @paths. Everything is delegated from document in the
  // capture phase, so it survives DSH re-rendering the composer. Idempotent.
  if (!window.dshDesktop || typeof window.dshDesktop.pickFiles !== 'function') return;
  if (window.__dshFilePickerInstalled) return;
  window.__dshFilePickerInstalled = true;

  var COMPOSER_SEL = 'textarea[placeholder*="发消息"], textarea[placeholder*="描述你想"]';
  var PLUS_SEL = 'button[aria-label="命令"]';
  var SEND_SEL = 'button[aria-label="发送消息"]';
  var OLD_BTN_ID = 'ds-file-picker-btn';
  var OLD_STYLE_ID = 'ds-file-picker-style';
  var STYLE_ID = 'ds-fp-style';
  var BAR_ID = 'ds-fp-chips';
  var MENU_ID = 'ds-fp-menu';

  var ICONS = {
    clip: '<path d="M13.2 7.6 8.4 12.4a3 3 0 0 1-4.2-4.2l5.3-5.3a2 2 0 0 1 2.8 2.8L7 11.2a1 1 0 0 1-1.4-1.4l4.6-4.6"/>',
    folder: '<path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.5 1.7h5A1.5 1.5 0 0 1 14 6.2v5.3a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z"/>',
    file: '<path d="M9.2 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6.3z"/><path d="M9.2 2v4.3h4.3"/>',
    image: '<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><circle cx="6" cy="6.2" r="1.2"/><path d="m13.5 10.5-3.2-3.2L4 13.5"/>',
    slash: '<rect x="2" y="2" width="12" height="12" rx="2.5"/><path d="M10 5.5 6 10.5"/>',
    close: '<path d="M4 4l8 8M12 4l-8 8"/>'
  };

  var chips = []; // { path: string, dir: boolean }
  var bypass = false; // lets our own re-dispatched "+" / send / Enter through
  var menuEl = null;
  var isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function svg(name, size) {
    return '<svg class="ds-fp-svg" width="' + size + '" height="' + size +
      '" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      ICONS[name] + '</svg>';
  }

  function composer() {
    return document.querySelector(COMPOSER_SEL);
  }

  function isComposer(node) {
    return !!node && typeof node.matches === 'function' && node.matches(COMPOSER_SEL);
  }

  function hasPickFolders() {
    return typeof window.dshDesktop.pickFolders === 'function';
  }

  function basename(p) {
    var parts = String(p).split(/[\\/]/);
    return parts.pop() || String(p);
  }

  function isImage(p) {
    return /\.(png|jpe?g|gif|webp|bmp|svg|heic|tiff?)$/i.test(p);
  }

  // "@path" for plain paths, "@\"path with spaces\"" when quoting is needed.
  function mention(p) {
    return '@' + (/\s/.test(p) ? '"' + p.replace(/"/g, '\\"') + '"' : p);
  }

  // Native setter + input event, so React's state sees the change.
  function setComposerValue(ta, value) {
    var desc = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
    if (desc && desc.set) desc.set.call(ta, value);
    else ta.value = value;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // DSH disables send while the textarea is empty. With chips attached, park a
  // zero-width space in the textarea so send is enabled; strip it on send.
  var SENTINEL = '\u200b';

  function syncSentinel() {
    var ta = composer();
    if (!ta) return;
    if (chips.length && ta.value === '') {
      setComposerValue(ta, SENTINEL);
    } else if (!chips.length && ta.value === SENTINEL) {
      setComposerValue(ta, '');
    }
  }

  function addChips(items) {
    var changed = false;
    items.forEach(function (item) {
      if (!item || !item.path) return;
      for (var i = 0; i < chips.length; i++) {
        if (chips[i].path === item.path) return;
      }
      chips.push({ path: item.path, dir: !!item.dir });
      changed = true;
    });
    if (changed) renderChips();
  }

  // Raster types dsh accepts as image attachments (same list as main.js).
  var PICKED_IMAGE_RE = /\.(png|jpe?g|gif|webp)$/i;
  var PICKED_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

  function isPickedImage(p) {
    return PICKED_IMAGE_RE.test(p);
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // Fire the same paste event DSH handles for a real clipboard image, so it
  // makes its own native thumbnail + ✕ and sends the image to the model.
  function pasteImageFile(ta, file) {
    var dt = new DataTransfer();
    dt.items.add(file);
    ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }

  // Resolves true when the image was handed to DSH; false means the caller
  // should fall back to a filename chip. Never rejects.
  function attachPickedImage(p) {
    return window.dshDesktop.readPickedImage(p).then(function (res) {
      if (!res || !res.ok || typeof res.base64 !== 'string') return false;
      var ta = composer();
      if (!ta) return false;
      var binary = atob(res.base64);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      if (bytes.length > PICKED_IMAGE_MAX_BYTES) return false;
      pasteImageFile(ta, new File([bytes], res.name || 'image', { type: res.mime }));
      return true;
    }).catch(function () { return false; });
  }

  // One image at a time, 50 ms apart, so DSH handles each paste before the next.
  // Returns the paths that failed and must become chips.
  function attachPickedImages(paths) {
    var failed = [];
    return paths.reduce(function (chain, p) {
      return chain.then(function () {
        return attachPickedImage(p).then(function (ok) {
          if (!ok) failed.push(p);
          return delay(50);
        });
      });
    }, Promise.resolve()).then(function () { return failed; });
  }

  function pickFiles() {
    window.dshDesktop.pickFiles().then(function (paths) {
      var list = paths || [];
      var images = [];
      var others = [];
      list.forEach(function (p) {
        // Without the bridge method or the composer, every image stays a chip.
        var canAttach = typeof window.dshDesktop.readPickedImage === 'function' && !!composer();
        if (canAttach && isPickedImage(p)) images.push(p);
        else others.push(p);
      });
      addChips(others.map(function (p) { return { path: p, dir: false }; }));
      var ta = composer();
      if (ta) ta.focus();
      if (!images.length) return;
      return attachPickedImages(images).then(function (failed) {
        addChips(failed.map(function (p) { return { path: p, dir: false }; }));
      });
    }).catch(function () { /* dialog dismissed */ });
  }

  function pickFolders() {
    if (!hasPickFolders()) return;
    window.dshDesktop.pickFolders().then(function (paths) {
      addChips((paths || []).map(function (p) { return { path: p, dir: true }; }));
      var ta = composer();
      if (ta) ta.focus();
    }).catch(function () { /* dialog dismissed */ });
  }

  // Click the native "+" for real (its slash-command menu) with our hook let through.
  function openSlashCommands() {
    var plus = document.querySelector(PLUS_SEL);
    if (!plus) return;
    bypass = true;
    try { plus.click(); } finally { bypass = false; }
  }

  function removeChip(path) {
    chips = chips.filter(function (c) { return c.path !== path; });
    renderChips();
  }

  function renderChips() {
    syncSentinel();
    var bar = document.getElementById(BAR_ID);
    if (!bar) return;
    bar.textContent = '';
    bar.hidden = chips.length === 0;
    chips.forEach(function (c) {
      var chip = el('div', 'ds-fp-chip');
      chip.title = c.path;

      var icon = el('span', 'ds-fp-chip-icon');
      icon.innerHTML = svg(c.dir ? 'folder' : (isImage(c.path) ? 'image' : 'file'), 14);

      var name = el('span', 'ds-fp-chip-name', basename(c.path));

      var x = el('button', 'ds-fp-chip-x');
      x.type = 'button';
      x.setAttribute('aria-label', '移除');
      x.innerHTML = svg('close', 12);
      x.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        removeChip(c.path);
      });

      chip.appendChild(icon);
      chip.appendChild(name);
      chip.appendChild(x);
      bar.appendChild(chip);
    });
  }

  // Keep the chip bar inside the composer card, right before the child that
  // holds the textarea. Re-inserted whenever DSH rebuilds the card.
  function mountBar() {
    var ta = composer();
    if (!ta) return;
    var card = ta.closest('[class*="_card"]') || ta.parentElement;
    if (!card) return;

    var bar = document.getElementById(BAR_ID);
    var created = false;
    if (!bar) {
      bar = el('div', 'ds-fp-chips');
      bar.id = BAR_ID;
      bar.hidden = true;
      created = true;
    }

    var anchor = ta;
    while (anchor.parentElement && anchor.parentElement !== card) {
      anchor = anchor.parentElement;
    }
    if (anchor.parentElement !== card) return;

    if (bar.parentElement !== card || bar.nextElementSibling !== anchor) {
      card.insertBefore(bar, anchor);
      created = true;
    }
    if (created) renderChips();
  }

  function removeLegacy() {
    var old = document.getElementById(OLD_BTN_ID);
    if (old) old.remove();
    var oldStyle = document.getElementById(OLD_STYLE_ID);
    if (oldStyle) oldStyle.remove();
  }

  function ensureStyle() {
    var prev = document.getElementById(STYLE_ID);
    if (prev) prev.remove();
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '#' + MENU_ID + ' {',
      '  position: fixed; z-index: 10000; min-width: 236px; box-sizing: border-box; padding: 4px;',
      '  border-radius: 12px;',
      '  background: var(--dsw-specific-menu, var(--dsw-alias-bg-overlay, #fff));',
      '  border: 1px solid var(--dsw-alias-border-inverted, var(--dsw-alias-border-l2, rgba(0, 0, 0, .1)));',
      '  box-shadow: var(--dsw-shadow-lv3, 0 8px 24px rgba(0, 0, 0, .12), 0 1px 3px rgba(0, 0, 0, .08));',
      '  color: var(--dsw-alias-label-primary, rgb(40, 36, 32));',
      '  font: 14px/1.2 var(--dsw-font-family, system-ui, sans-serif);',
      '}',
      '.ds-fp-item {',
      '  display: flex; align-items: center; gap: 8px; width: 100%; min-height: 40px; box-sizing: border-box;',
      '  padding: 8px 10px; margin: 0; border: 0; border-radius: 10px; background: transparent;',
      '  color: inherit; font: inherit; font-size: 14px; line-height: 22px; text-align: left; cursor: pointer;',
      '}',
      '.ds-fp-item:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, .05)); }',
      '.ds-fp-icon { display: inline-flex; flex: none; color: var(--dsw-alias-label-secondary, rgb(110, 103, 92)); }',
      '.ds-fp-label { flex: 1; min-width: 0; white-space: nowrap; }',
      '.ds-fp-kbd { flex: none; font-size: 12px; color: var(--dsw-alias-label-tertiary, rgb(150, 143, 130)); }',
      '.ds-fp-svg { display: block; }',
      '#' + BAR_ID + ' {',
      '  display: flex; flex-wrap: wrap; gap: 6px; box-sizing: border-box; padding: 10px 12px 0;',
      '}',
      '#' + BAR_ID + '[hidden] { display: none; }',
      '.ds-fp-chip {',
      '  display: inline-flex; align-items: center; gap: 6px; box-sizing: border-box;',
      '  max-width: 260px; height: 28px; padding: 0 4px 0 8px; min-width: 0;',
      '  border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, .1));',
      '  background: var(--dsw-alias-button-floating-fill, rgb(240, 238, 228));',
      '  color: var(--dsw-alias-label-primary, rgb(40, 36, 32)); font-size: 13px; line-height: 20px;',
      '}',
      '.ds-fp-chip-icon { display: inline-flex; flex: none; color: var(--dsw-alias-label-secondary, rgb(110, 103, 92)); }',
      '.ds-fp-chip-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.ds-fp-chip-x {',
      '  display: inline-flex; align-items: center; justify-content: center; flex: none;',
      '  width: 20px; height: 20px; padding: 0; margin: 0; border: 0; border-radius: 6px;',
      '  background: transparent; color: var(--dsw-alias-label-tertiary, rgb(150, 143, 130)); cursor: pointer;',
      '}',
      '.ds-fp-chip-x:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, .06)); color: var(--dsw-alias-label-primary, rgb(40, 36, 32)); }',
      'body.ds-fp-dragging .ds-composer-card {',
      '  outline: 2px dashed var(--dsw-alias-brand-primary, rgb(204, 120, 92)); outline-offset: 2px;',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function closeMenu() {
    if (menuEl) {
      menuEl.remove();
      menuEl = null;
    }
  }

  function menuItem(icon, label, kbd, action) {
    var item = el('button', 'ds-fp-item');
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    var ic = el('span', 'ds-fp-icon');
    ic.innerHTML = svg(icon, 16);
    item.appendChild(ic);
    item.appendChild(el('span', 'ds-fp-label', label));
    if (kbd) item.appendChild(el('span', 'ds-fp-kbd', kbd));
    item.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
      action();
    });
    menuEl.appendChild(item);
  }

  function openMenu(anchor) {
    closeMenu();
    menuEl = el('div');
    menuEl.id = MENU_ID;
    menuEl.setAttribute('role', 'menu');

    menuItem('clip', '添加文件或照片', isMac ? '⌘U' : 'Ctrl+U', pickFiles);
    if (hasPickFolders()) menuItem('folder', '添加文件夹', '', pickFolders);
    menuItem('slash', '斜杠命令', '', openSlashCommands);

    document.body.appendChild(menuEl);

    // Above the anchor button, left-aligned with it, kept on screen.
    var rect = anchor.getBoundingClientRect();
    var left = Math.max(8, Math.min(rect.left, window.innerWidth - menuEl.offsetWidth - 8));
    menuEl.style.left = left + 'px';
    menuEl.style.bottom = Math.max(8, window.innerHeight - rect.top + 8) + 'px';
  }

  // Put chips into the textarea as "@path" lines, then a blank line and the
  // user's own text. Clears the chips.
  function prepareSend(ta) {
    if (!chips.length) return;
    var header = chips.map(function (c) { return mention(c.path); }).join('\n');
    var body = (ta.value || '').replace(/\u200b/g, '');
    var next = body.trim() ? header + '\n\n' + body : header;
    setComposerValue(ta, next);
    chips = [];
    renderChips();
    ta.focus();
    try { ta.setSelectionRange(next.length, next.length); } catch (_) { /* ignore */ }
  }

  // Re-click the send button once React has enabled it after our input event.
  function resendClick(tries) {
    var btn = document.querySelector(SEND_SEL);
    if (!btn) return;
    if (btn.disabled && tries < 20) {
      setTimeout(function () { resendClick(tries + 1); }, 25);
      return;
    }
    bypass = true;
    try { btn.click(); } finally { bypass = false; }
  }

  // Re-dispatch Enter to the textarea so DSH's own keydown handler sends.
  function resendEnter(ta) {
    requestAnimationFrame(function () {
      bypass = true;
      try {
        ta.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
        }));
      } finally {
        bypass = false;
      }
    });
  }

  document.addEventListener('click', function (e) {
    if (bypass) return;
    var t = e.target;
    if (!t || typeof t.closest !== 'function') return;

    var plus = t.closest(PLUS_SEL);
    if (plus) {
      e.preventDefault();
      e.stopPropagation();
      if (menuEl) closeMenu();
      else openMenu(plus);
      return;
    }

    var send = t.closest(SEND_SEL);
    if (send && chips.length) {
      e.preventDefault();
      e.stopPropagation();
      var ta = composer();
      if (ta) prepareSend(ta);
      setTimeout(function () { resendClick(0); }, 0);
    }
  }, true);

  document.addEventListener('mousedown', function (e) {
    if (!menuEl) return;
    var t = e.target;
    if (menuEl.contains(t)) return;
    if (t && typeof t.closest === 'function' && t.closest(PLUS_SEL)) return;
    closeMenu();
  }, true);

  document.addEventListener('keydown', function (e) {
    if (bypass) return;

    if (e.key === 'Escape' && menuEl) {
      closeMenu();
      return;
    }

    // Cmd+U (Ctrl+U off macOS): file picker, only while this page has focus.
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey &&
        (e.key === 'u' || e.key === 'U')) {
      if (!document.hasFocus() || !composer()) return;
      e.preventDefault();
      e.stopPropagation();
      pickFiles();
      return;
    }

    // Enter sends (Shift+Enter and IME composition are left alone).
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return;
    // Plain Enter only; modified Enter keeps DSH's own behaviour.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!chips.length || !isComposer(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    prepareSend(e.target);
    resendEnter(e.target);
  }, true);

  // Drag files onto the window to attach them as chips.
  function hasFiles(e) {
    var dt = e.dataTransfer;
    if (!dt || !dt.types) return false;
    return Array.prototype.indexOf.call(dt.types, 'Files') !== -1;
  }

  // Absolute paths only; anything else is ignored.
  function filePath(file) {
    var p = '';
    try {
      if (window.dshDesktop && typeof window.dshDesktop.getPathForFile === 'function') {
        p = window.dshDesktop.getPathForFile(file) || '';
      } else if (file && typeof file.path === 'string') {
        p = file.path;
      }
    } catch (_) {
      p = '';
    }
    return /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(p) ? p : '';
  }

  window.addEventListener('dragenter', function (e) {
    if (hasFiles(e)) document.body.classList.add('ds-fp-dragging');
  }, true);

  window.addEventListener('dragover', function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault(); // allow drop, and stop Electron navigating to the file
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }, true);

  window.addEventListener('dragleave', function (e) {
    if (!e.relatedTarget) document.body.classList.remove('ds-fp-dragging');
  }, true);

  window.addEventListener('drop', function (e) {
    document.body.classList.remove('ds-fp-dragging');
    if (!hasFiles(e)) return;

    var dt = e.dataTransfer;
    var files = dt.files || [];
    var items = dt.items || [];
    // Any image in the drop: leave the whole drop to DSH's native image attach.
    for (var k = 0; k < files.length; k++) {
      if (files[k] && typeof files[k].type === 'string' && files[k].type.indexOf('image/') === 0) return;
    }
    e.preventDefault(); // never let Electron open the dropped file

    var found = [];
    for (var i = 0; i < files.length; i++) {
      var p = filePath(files[i]);
      if (!p) continue;
      // Read entries synchronously; they are invalid after the handler ends.
      var item = items[i];
      var entry = item && typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
      found.push({ path: p, dir: !!(entry && entry.isDirectory) });
    }
    if (found.length) {
      e.stopPropagation();
      addChips(found);
    }
  }, true);

  // Paste non-image files into the composer as chips. Images are left to DSH's
  // native paste handling (no preventDefault, no chip). When a paste mixes
  // images and other files, the chips are added but the event is not stopped,
  // so the images still reach DSH.
  document.addEventListener('paste', function (e) {
    var t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    if (!t.closest('textarea') && !t.closest('.ds-composer-card')) return;
    var cd = e.clipboardData;
    var files = cd && cd.files ? cd.files : null;
    if (!files || !files.length) return;

    var found = [];
    var hasImage = false;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (!f) continue;
      if (typeof f.type === 'string' && f.type.indexOf('image/') === 0) {
        hasImage = true;
        continue;
      }
      var p = filePath(f);
      if (p) found.push({ path: p, dir: false });
    }
    if (!found.length) return;
    if (!hasImage) {
      e.preventDefault();
      e.stopPropagation();
    }
    addChips(found);
  }, true);

  // Emptied by hand while chips are attached: restore the sentinel.
  document.addEventListener('input', function (e) {
    if (chips.length && isComposer(e.target) && e.target.value === '') {
      setComposerValue(e.target, SENTINEL);
    }
  }, true);

  window.addEventListener('resize', closeMenu);

  // DSH re-renders the composer often; coalesce checks into one per frame.
  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      removeLegacy();
      mountBar();
    });
  }

  ensureStyle();
  schedule();
  var observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
})();
