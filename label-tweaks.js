(function () {
  function shortenModelLabel() {
    document
      .querySelectorAll('[aria-label*="选择模型"] [class*="triggerLabel"]')
      .forEach(function (el) {
        if (el.textContent.indexOf('DeepSeek-') === 0) {
          el.textContent = el.textContent.replace(/^DeepSeek-/, '');
        }
      });
  }

  // Tag the real composer input card with a stable class so theme.css can
  // style it. Its own class is a build-specific hash (uV2eYG_card), and the
  // stable-looking wrappers around it span the full window width — styling
  // those drew a box across the whole composer area instead of the input.
  function tagComposerCard() {
    var textarea = document.querySelector(
      'textarea[placeholder*="发消息"], textarea[placeholder*="描述你想"]'
    );
    if (!textarea) return;
    var card = textarea.closest('[class*="_card"]');
    if (card) card.classList.add('ds-composer-card');
  }

  // The model menu ships two groups for the same models: the plain DeepSeek
  // route, and modlens's wrapped copy of it. The wrapped one is a superset —
  // same model, same route underneath, plus it can read a pasted image — so
  // the plain group is only ever the worse choice, and having both means
  // picking between two entries whose names differ by a parenthetical.
  //
  // The suffix comes from modlens, which builds each label as
  // `${model.name ?? model.id} (modlens vision)`. It isn't configurable, so
  // trimming it here is the only place left. The group title gets the same
  // treatment, and the trigger button too, since the label also lands there.
  //
  // Text-only edits plus a display toggle: no node is added, moved, or
  // removed, so React keeps owning this subtree.
  var VISION_SUFFIX = /\s*\(modlens vision\)\s*$/;

  function tidyModelMenu() {
    document.querySelectorAll('[class*="_group"]').forEach(function (group) {
      // `:scope >` is load-bearing. The attribute selector above is a
      // substring match, so it also matches `_groups` — the container
      // holding every group. A descendant lookup finds the first group's
      // title through that container, and hiding the container hides the
      // whole menu: the symptom is a model list with nothing in it.
      // Restricting to direct children means only a real group answers.
      var title = group.querySelector(':scope > [class*="_groupTitle"]');
      if (!title) return;
      // Pro rows: hide the menu item only. Runs before the early returns
      // below so the vision group still gets it on every pass.
      group.querySelectorAll('[class*="_modelName"]').forEach(function (el) {
        if (!/\bpro\b/i.test(el.textContent || '')) return;
        var row = el.closest('[role="menuitemradio"]');
        if (!row) return;
        row.dataset.dsHidePro = '1';
        row.style.display = 'none';
      });
      var text = (title.textContent || '').trim();
      // This runs on every mutation, so it has to be idempotent. Trimming
      // the suffix renames the wrapped group to exactly "DeepSeek" — the
      // same string the plain group carries — so a second pass would hide
      // the one group worth keeping and leave the menu empty. The mark
      // says "this one was the wrapped group before I renamed it". React
      // drops it whenever it rebuilds the node, but that also restores the
      // original title, so the two always agree.
      if (group.dataset.dsVisionGroup === '1') {
        group.style.display = '';
        return;
      }
      if (text === 'DeepSeek') {
        // Hidden rather than removed: if modlens ever fails to register, a
        // reload brings this group back on its own.
        group.style.display = 'none';
        return;
      }
      if (VISION_SUFFIX.test(text)) {
        group.dataset.dsVisionGroup = '1';
        group.style.display = '';
        title.textContent = text.replace(VISION_SUFFIX, '');
      }
      group.querySelectorAll('[class*="_modelName"]').forEach(function (el) {
        var name = el.textContent || '';
        if (VISION_SUFFIX.test(name)) el.textContent = name.replace(VISION_SUFFIX, '');
      });
    });

    document
      .querySelectorAll('[class*="_triggerLabel"], [class*="_cellValue"]')
      .forEach(function (el) {
        var name = el.textContent || '';
        if (VISION_SUFFIX.test(name)) el.textContent = name.replace(VISION_SUFFIX, '');
      });
  }

  // theme.css shows only the first stats item by default. The full line
  // goes into title as a fallback. Idempotent: writes only on change.
  function tagStatsRow() {
    document.querySelectorAll('[class*="FJxK0a_root"]').forEach(function (row) {
      var text = (row.textContent || '').replace(/\s+/g, ' ').trim();
      if (text && row.title !== text) row.title = text;
    });
  }

  // Context-usage ring next to send. Its aria-label reads "上下文已用 6%".
  // Tag low (<50) or high (>=50) so theme.css can fade the idle low state.
  // An unparseable label clears the tag, so the ring stays visible.
  var CTX_RE = /上下文已用\s*(\d+(?:\.\d+)?)\s*%/;
  function tagContextRing() {
    document.querySelectorAll('button[class*="JObwrW_trigger"]').forEach(function (btn) {
      var m = CTX_RE.exec(btn.getAttribute('aria-label') || '');
      if (!m) {
        delete btn.dataset.dsCtx;
        return;
      }
      var level = parseFloat(m[1]) < 50 ? 'low' : 'high';
      if (btn.dataset.dsCtx !== level) btn.dataset.dsCtx = level;
    });
  }

  // The reasoning-effort text is hidden in theme.css, so the full aria-label
  // goes into title for hover. aria-label itself is left alone.
  function tagModelButton() {
    document.querySelectorAll('[aria-label*="选择模型"]').forEach(function (btn) {
      var label = btn.getAttribute('aria-label');
      if (label && btn.title !== label) btn.title = label;
    });
  }

  // The top-bar session log button shows only its icon, so title carries the label.
  function tagSessionLogButton() {
    document.querySelectorAll('[class*="nL4_yW_sessionLogButton"]').forEach(function (btn) {
      if (btn.title !== '会话日志') btn.title = '会话日志';
    });
  }

  // Session row "⋯" menu gets a "下载会话" item. A capture-phase click
  // listener remembers which session's ⋯ button was clicked last. Any other
  // click clears it, so the item only appears for session menus.
  var SESSION_MENU_SEL = 'button[aria-label^="会话“"][aria-label$="”的操作"]';
  var SESSION_MENU_RE = /^会话“(.*)”的操作$/;
  var DOWNLOAD_SVG =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"' +
    ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M8 2.5v7.5"/><path d="M5 7l3 3 3-3"/><path d="M3 12.5h10"/></svg>';
  var lastSessionMenuTitle = null;
  var exportBusy = false;

  function sessionTitleOf(btn) {
    var m = SESSION_MENU_RE.exec(btn.getAttribute('aria-label') || '');
    return m ? m[1].trim() : null;
  }

  function findSessionMenuButton(title) {
    var buttons = document.querySelectorAll(SESSION_MENU_SEL);
    for (var i = 0; i < buttons.length; i++) {
      if (sessionTitleOf(buttons[i]) === title) return buttons[i];
    }
    return null;
  }

  // Last breadcrumb segment is the open session's title.
  function currentSessionTitle() {
    var segs = document.querySelectorAll('[class*="wSkVaW_crumbSeg"]');
    if (!segs.length) return null;
    return (segs[segs.length - 1].textContent || '').trim();
  }

  function closeOpenMenu() {
    var target = document.activeElement || document.body;
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true,
      })
    );
  }

  // Fires the header's session log export for `title`. Switches to that
  // session first if it isn't open. Gives up silently after 3 seconds.
  function exportSessionLog(title) {
    if (exportBusy) return;
    exportBusy = true;

    function fire() {
      var logBtn = document.querySelector('button[class*="nL4_yW_sessionLogButton"]');
      if (logBtn) logBtn.click();
      exportBusy = false;
    }

    if (currentSessionTitle() === title) {
      fire();
      return;
    }

    var sessionBtn = findSessionMenuButton(title);
    if (!sessionBtn) {
      exportBusy = false;
      return;
    }
    var row = sessionBtn.closest('[class*="sessionRow"]') || sessionBtn.parentElement;
    if (!row) {
      exportBusy = false;
      return;
    }
    var leaf = Array.prototype.find.call(row.querySelectorAll('*'), function (el) {
      return el.childElementCount === 0 && (el.textContent || '').trim() === title;
    });
    (leaf || row).click();

    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (currentSessionTitle() === title) {
        clearInterval(timer);
        fire();
      } else if (tries >= 30) {
        clearInterval(timer);
        exportBusy = false;
      }
    }, 100);
  }

  document.addEventListener(
    'click',
    function (e) {
      var t = e.target;
      var btn = t && t.closest ? t.closest(SESSION_MENU_SEL) : null;
      lastSessionMenuTitle = btn ? sessionTitleOf(btn) : null;
    },
    true
  );

  function injectDownloadItem() {
    if (!lastSessionMenuTitle) return;
    var title = lastSessionMenuTitle;
    document.querySelectorAll('[role="menu"]').forEach(function (menu) {
      // Presence check instead of a menu-level flag: React may rebuild items.
      if (menu.querySelector('[data-ds-download-item]')) return;
      var items = Array.prototype.slice.call(menu.querySelectorAll('[role="menuitem"]'));
      var archive = null;
      items.forEach(function (item) {
        if ((item.textContent || '').trim() === '归档会话') archive = item;
      });
      if (!archive || !items.length) return;

      // cloneNode drops React's listeners, so the only click handler is ours.
      var item = archive.cloneNode(true);
      item.removeAttribute('id');
      item.setAttribute('type', 'button');
      item.setAttribute('data-ds-download-item', '1');

      var walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
      var node;
      while ((node = walker.nextNode())) {
        if (node.data.trim() === '归档会话') node.data = '下载会话';
      }

      var tpl = document.createElement('template');
      tpl.innerHTML = DOWNLOAD_SVG;
      var newIcon = tpl.content.firstChild;
      var oldIcons = item.querySelectorAll('svg');
      if (oldIcons.length) {
        // The svg sits inside span[class*="_itemIcon"], not as a direct child
        // of item, so replaceChild on item throws. Swap the svg in place.
        oldIcons[0].replaceWith(newIcon);
        for (var i = 1; i < oldIcons.length; i++) oldIcons[i].remove();
      } else {
        item.insertBefore(newIcon, item.firstChild);
      }

      item.addEventListener('click', function (e) {
        e.preventDefault();
        closeOpenMenu();
        exportSessionLog(title);
      });

      var last = items[items.length - 1];
      last.parentNode.insertBefore(item, last.nextSibling);
    });
  }

  // dsh sizes the menu for 3 items, so our 4th item can run past the viewport.
  // Only menus holding our injected item are moved; others are left alone.
  function keepMenuInViewport() {
    document.querySelectorAll('[role="menu"]').forEach(function (menu) {
      if (!menu || !menu.querySelector('[data-ds-download-item]')) return;
      var rect = menu.getBoundingClientRect();
      var target = null;
      if (rect.bottom > window.innerHeight - 8) {
        target = Math.max(8, window.innerHeight - 8 - rect.height);
      } else if (rect.top < 8) {
        target = 8;
      }
      // Re-checked on every applyTweaks run, since dsh may rewrite style.top.
      if (target !== null) menu.style.top = target + 'px';
    });
  }

  // dsh bug: with a dropdown open, clicking its toggle closes it on
  // pointerdown, then the toggle's own click re-opens it. For the two toggles
  // below, a click on a toggle that was already open at pointerdown is
  // swallowed, so it only closes. Other dropdowns are not touched.
  var TOGGLE_SEL = 'button[aria-label="选择工作区"], button[class*="cubgiG_seat"]';
  var swallowToggle = null;
  var swallowTimer = null;

  function clearSwallow() {
    swallowToggle = null;
    if (swallowTimer) clearTimeout(swallowTimer);
    swallowTimer = null;
  }

  document.addEventListener(
    'pointerdown',
    function (e) {
      var t = e.target;
      var btn = t && t.closest ? t.closest(TOGGLE_SEL) : null;
      clearSwallow();
      if (btn && btn.getAttribute('aria-expanded') === 'true') {
        swallowToggle = btn;
        // Fallback: a press that never ends in a click must not leave the flag set.
        swallowTimer = setTimeout(clearSwallow, 1000);
      }
    },
    true
  );

  document.addEventListener(
    'click',
    function (e) {
      if (!swallowToggle) return;
      var btn = swallowToggle;
      clearSwallow();
      var t = e.target;
      if (t && t.closest && btn.contains(t)) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true
  );

  // Sidebar session list: dsh shows 5 sessions per workspace and folds the
  // rest behind an overflow button. Click each button element once so the
  // full list shows. theme.css hides the button. The dataset mark keeps it
  // from being clicked again.
  function expandSessionOverflow() {
    document
      .querySelectorAll('button[class*="qDHVXG_sessionOverflowButton"]')
      .forEach(function (btn) {
        if (btn.dataset.dsExpanded === '1') return;
        btn.dataset.dsExpanded = '1';
        btn.click();
      });
  }

  // After the save dialog, dsh opens a "download started" modal that adds
  // nothing for the user. Only the success state is dismissed: the preparing
  // and error dialogs stay visible. The modal's own close button is clicked
  // so dsh resets its export state; hiding alone would leave it stuck.
  var EXPORT_DONE_TITLE = 'Session 导出已开始下载';
  var DIALOG_SEL = '[role="dialog"], [aria-modal="true"]';

  // Only dialogs are scanned, so a page with no open dialog costs one query.
  // A hidden portal root still holds its dialog in the DOM, so this still finds it.
  function findExportDoneTitle() {
    var dialogs = document.querySelectorAll(DIALOG_SEL);
    for (var d = 0; d < dialogs.length; d++) {
      var all = dialogs[d].querySelectorAll('*');
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        if (el.childElementCount === 0 && (el.textContent || '').trim() === EXPORT_DONE_TITLE) {
          return el;
        }
      }
    }
    return null;
  }

  // Portal root for the modal: the body child that holds the title. Returns
  // null when that child also holds the composer textarea, which means it is
  // the app root and must not be hidden.
  function exportModalRoot(title) {
    var node = title.closest(DIALOG_SEL) || title;
    while (node.parentElement && node.parentElement !== document.body) {
      node = node.parentElement;
    }
    if (!node.parentElement || node === document.body) return null;
    if (node.querySelector('textarea')) return null;
    return node;
  }

  function exportCloseButton(scope) {
    var buttons = scope.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      if ((b.textContent || '').trim() === '关闭' || b.getAttribute('aria-label') === '关闭') {
        return b;
      }
    }
    return null;
  }

  function dismissExportSuccessModal() {
    var title = findExportDoneTitle();
    if (!title) {
      // Modal is gone: clear the hide mark so a reused node shows again.
      var marked = document.querySelectorAll('[data-ds-hidden-export]');
      if (marked.length) {
        marked.forEach(function (el) {
          delete el.dataset.dsHiddenExport;
          el.style.display = '';
        });
      }
      return;
    }
    var root = exportModalRoot(title);
    var scope = root || title.closest(DIALOG_SEL);
    if (!scope) return;
    var close = exportCloseButton(scope);
    if (root) {
      if (root.dataset.dsHiddenExport === '1') return;
      root.dataset.dsHiddenExport = '1';
      root.style.display = 'none';
    }
    if (close) close.click();
  }

  // Flat ("单列表") view has session rows and no workspace rows. The mark
  // lives on body, not localStorage, so theme.css follows what is on screen.
  // Idempotent: writes only on change.
  function tagFlatMode() {
    var flat =
      !!document.querySelector('[class*="YDXeBa_sessionRow"]') &&
      !document.querySelector('[class*="YDXeBa_projectRow"], div[class*="qDHVXG_groupSection"]');
    if (flat) {
      if (document.body.dataset.dsFlat !== '1') document.body.dataset.dsFlat = '1';
    } else if (document.body.dataset.dsFlat) {
      delete document.body.dataset.dsFlat;
    }
  }

  // First run only: switch the sidebar to dsh's 单列表 grouping. The flag
  // makes it run once, so a later manual switch back to 按工作区 is kept.
  // An attempt opens 视图选项, clicks 单列表, and sends Escape if the menu
  // is still open. Failed attempts retry on later passes, at most 5 in all.
  var FLAT_FLAG = 'ds-view-flat-applied';
  var FLAT_MAX_TRIES = 5;
  var FLAT_GAP_MS = 1000;
  var flatTries = 0;
  var flatBusy = false;
  var flatNextAt = 0;

  function flatFlagSet() {
    try {
      return localStorage.getItem(FLAT_FLAG) === '1';
    } catch (e) {
      // Storage unavailable: treat as done, so the switch cannot repeat on every pass.
      return true;
    }
  }

  function setFlatFlag() {
    try {
      localStorage.setItem(FLAT_FLAG, '1');
    } catch (e) {
      // Nothing to do: the next launch simply tries again.
    }
  }

  function findMenuItem(text) {
    var items = document.querySelectorAll(
      '[role="menu"] [role="menuitem"], [role="menu"] [role="menuitemradio"]'
    );
    for (var i = 0; i < items.length; i++) {
      if ((items[i].textContent || '').trim() === text) return items[i];
    }
    return null;
  }

  function applyFlatDefault() {
    if (flatBusy || flatFlagSet()) return;
    tagFlatMode();
    // Already flat (chosen by hand earlier): only record that the default ran.
    if (document.body.dataset.dsFlat === '1' || flatTries >= FLAT_MAX_TRIES) {
      setFlatFlag();
      return;
    }
    if (Date.now() < flatNextAt) return;
    var viewBtn = document.querySelector('button[aria-label="视图选项"]');
    if (!viewBtn) return;

    flatBusy = true;
    flatTries++;
    viewBtn.click();
    setTimeout(function () {
      var item = findMenuItem('单列表');
      if (item) {
        item.click();
        // dsh normally closes the menu on pick. Escape covers the case it does not.
        setTimeout(function () {
          if (document.querySelector('[role="menu"]')) closeOpenMenu();
        }, 150);
      } else if (document.querySelector('[role="menu"]')) {
        // The menu we just opened did not offer 单列表: close it, retry later.
        closeOpenMenu();
      }
      setTimeout(function () {
        flatBusy = false;
        flatNextAt = Date.now() + FLAT_GAP_MS;
        tagFlatMode();
        if (document.body.dataset.dsFlat === '1' || flatTries >= FLAT_MAX_TRIES) setFlatFlag();
      }, 300);
    }, 150);
  }

  function applyTweaks() {
    shortenModelLabel();
    tagComposerCard();
    tidyModelMenu();
    tagStatsRow();
    tagContextRing();
    tagModelButton();
    tagSessionLogButton();
    injectDownloadItem();
    keepMenuInViewport();
    expandSessionOverflow();
    dismissExportSuccessModal();
    tagFlatMode();
    applyFlatDefault();
  }

  applyTweaks();
  var observer = new MutationObserver(applyTweaks);
  // aria-label is observed too: the context ring's percentage changes
  // through an attribute, which the childList/characterData config misses.
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['aria-label'],
  });
})();
