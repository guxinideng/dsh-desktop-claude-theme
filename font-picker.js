(function () {
  var STORAGE_KEY = 'ds-font-choice';

  // Each entry's own NAME is its specimen — rendered in its own face in the
  // menu, the way Font Book / Figma / Word show typefaces. That drops the
  // repeated sample word the earlier card grid used, which read as noise.
  // 霞鹜文楷 and 得意黑 ship with the app (fonts/, served over dshfont://);
  // the rest are already on macOS.
  var FONTS = [
    { id: 'wenkai', name: '霞鹜文楷', stack: '"LXGW WenKai Lite", "Songti SC", serif' },
    { id: 'smiley', name: '得意黑', stack: '"Smiley Sans", "PingFang SC", sans-serif' },
    { id: 'pingfang', name: '苹方', stack: '-apple-system, "PingFang SC", "Helvetica Neue", sans-serif' },
    { id: 'songti', name: '宋体', stack: '"Songti SC", ui-serif, Georgia, serif' },
    { id: 'fangsong', name: '华文仿宋', stack: 'STFangsong, "Songti SC", serif' },
  ];
  var DEFAULT_ID = 'wenkai';

  function fontById(id) {
    return FONTS.filter(function (f) { return f.id === id; })[0] || FONTS[0];
  }

  function currentFontId() {
    var saved = localStorage.getItem(STORAGE_KEY);
    return FONTS.some(function (f) { return f.id === saved; }) ? saved : DEFAULT_ID;
  }

  function ensureBaseStyle() {
    if (document.getElementById('ds-font-base')) return;
    var style = document.createElement('style');
    style.id = 'ds-font-base';
    style.textContent = [
      "@font-face { font-family: 'LXGW WenKai Lite'; src: url('dshfont://f/LXGWWenKaiLite-Regular.woff2') format('woff2'); font-display: swap; }",
      "@font-face { font-family: 'Smiley Sans'; src: url('dshfont://f/SmileySans-Oblique.woff2') format('woff2'); font-display: swap; }",
      '.ds-font-menu {',
      '  position: fixed; z-index: 9999; min-width: 200px; padding: 4px;',
      '  border-radius: 12px;',
      '  background: var(--dsw-alias-bg-overlay, #fff);',
      '  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.07));',
      '  box-shadow: 0 8px 32px rgba(40, 36, 32, .14);',
      '}',
      '.ds-font-menu-item {',
      '  display: flex; align-items: center; justify-content: space-between;',
      '  gap: 14px; width: 100%; padding: 9px 12px;',
      '  border: 0; background: none; cursor: pointer; text-align: left;',
      '  border-radius: 8px; font-size: 16px;',
      '  color: var(--dsw-alias-label-primary, #28241f);',
      '}',
      '.ds-font-menu-item:hover {',
      '  background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05));',
      '}',
      '.ds-font-menu-check {',
      '  flex: none; opacity: 0;',
      '  color: var(--dsw-alias-brand-primary, #cc785c);',
      '}',
      '.ds-font-menu-item[aria-checked="true"] .ds-font-menu-check { opacity: 1; }',
    ].join('\n');
    document.head.appendChild(style);
  }

  function applyFont(id) {
    var style = document.getElementById('ds-font-active');
    if (!style) {
      style = document.createElement('style');
      style.id = 'ds-font-active';
      document.head.appendChild(style);
    }
    style.textContent =
      'body, body[data-ds-dark-theme] { --dsw-font-family: ' + fontById(id).stack + ' !important; }';
  }

  var CHECK_SVG =
    '<svg class="ds-font-menu-check" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M15.05 3.93 8.5 12.38c-.24.31-.45.59-.65.79-.21.21-.46.41-.8.5-.19.05-.37.06-.56.05-.35-.03-.64-.19-.88-.36-.23-.17-.49-.4-.77-.66L1.03 9.21l.94-1.03 3.81 3.49c.31.28.5.45.65.56.07.05.12.08.14.09.02 0 .03.01.04.01.03 0 .07 0 .1-.01 0 0 .01 0 .01-.1.02-.02.06-.05.12-.11.13-.14.29-.34.55-.67l6.55-8.46 1.1.85Z" fill="currentColor"/></svg>';

  function closeMenu() {
    var menu = document.getElementById('ds-font-menu');
    if (menu) menu.remove();
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    var trigger = document.querySelector('#ds-font-row button');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  }

  function onDocDown(e) {
    var menu = document.getElementById('ds-font-menu');
    var row = document.getElementById('ds-font-row');
    if (menu && !menu.contains(e.target) && row && !row.contains(e.target)) closeMenu();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') closeMenu();
  }

  function setChoice(id, triggerLabel) {
    localStorage.setItem(STORAGE_KEY, id);
    applyFont(id);
    if (triggerLabel) triggerLabel.textContent = fontById(id).name;
    closeMenu();
  }

  function openMenu(trigger, triggerLabel) {
    if (document.getElementById('ds-font-menu')) {
      closeMenu();
      return;
    }
    var active = currentFontId();
    var menu = document.createElement('div');
    menu.id = 'ds-font-menu';
    menu.className = 'ds-font-menu';
    menu.setAttribute('role', 'menu');

    FONTS.forEach(function (font) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'ds-font-menu-item';
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(font.id === active));

      var label = document.createElement('span');
      label.textContent = font.name;
      label.style.fontFamily = font.stack;
      item.appendChild(label);
      item.insertAdjacentHTML('beforeend', CHECK_SVG);

      item.addEventListener('click', function () {
        setChoice(font.id, triggerLabel);
      });
      menu.appendChild(item);
    });

    document.body.appendChild(menu);

    // Anchor under the trigger, right-aligned, flipping up near the bottom.
    var r = trigger.getBoundingClientRect();
    var mr = menu.getBoundingClientRect();
    var left = Math.max(8, Math.min(r.right - mr.width, window.innerWidth - mr.width - 8));
    var top = r.bottom + 6;
    if (top + mr.height > window.innerHeight - 8) top = Math.max(8, r.top - mr.height - 6);
    menu.style.left = Math.round(left) + 'px';
    menu.style.top = Math.round(top) + 'px';

    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onKeyDown, true);
  }

  // Build the row by cloning the classes off a real settings row (语言), so
  // it matches the dialog's own rows exactly instead of guessing at styles.
  function buildRow(langRow) {
    var rowTextSrc = langRow.querySelector('[class*="_rowText"]');
    var titleSrc = langRow.querySelector('[class*="_title"]');
    var selectorSrc = langRow.querySelector('button');
    if (!rowTextSrc || !titleSrc || !selectorSrc) return null;

    var row = document.createElement('div');
    row.id = 'ds-font-row';
    row.className = langRow.className;

    var rowText = document.createElement('div');
    rowText.className = rowTextSrc.className;
    var title = document.createElement('div');
    title.className = titleSrc.className;
    title.textContent = '字体';
    rowText.appendChild(title);
    row.appendChild(rowText);

    var wrap = document.createElement('span');
    var selectorParent = selectorSrc.parentElement;
    if (selectorParent && selectorParent !== langRow) wrap.className = selectorParent.className;

    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = selectorSrc.className;
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');

    var triggerLabel = document.createElement('span');
    triggerLabel.textContent = fontById(currentFontId()).name;
    trigger.appendChild(triggerLabel);

    var chevron = selectorSrc.querySelector('svg');
    if (chevron) trigger.appendChild(chevron.cloneNode(true));

    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      openMenu(trigger, triggerLabel);
    });

    wrap.appendChild(trigger);
    row.appendChild(wrap);
    return row;
  }

  function tryInject() {
    if (document.getElementById('ds-font-row')) return;
    var titles = document.querySelectorAll('[class*="_title"]');
    var langTitle = Array.prototype.filter.call(titles, function (el) {
      return el.textContent.trim() === '语言';
    })[0];
    if (!langTitle) return;
    var langRow = langTitle.parentElement && langTitle.parentElement.parentElement;
    if (!langRow || !langRow.parentElement) return;

    ensureBaseStyle();
    var row = buildRow(langRow);
    if (!row) return;
    langRow.parentElement.insertBefore(row, langRow.nextSibling);
  }

  ensureBaseStyle();
  applyFont(currentFontId());
  tryInject();
  var observer = new MutationObserver(tryInject);
  observer.observe(document.body, { childList: true, subtree: true });
})();
