(function () {
  // Adds a "choose a file" button to the composer, next to DSH's own "+"
  // (which despite the icon opens the slash-command menu, not an attach
  // dialog). DSH only ever accepts images as real attachments, by drag or
  // paste; everything else is handed to the agent as a path it opens with
  // its own filesystem tools. So this button doesn't upload anything — it
  // opens a native file dialog and inserts the chosen paths as text in the
  // composer, which is exactly the input the agent already knows how to
  // act on. Paths are quoted when they contain spaces.
  if (!window.dshDesktop || typeof window.dshDesktop.pickFiles !== 'function') return;

  var BTN_ID = 'ds-file-picker-btn';

  function ensureStyle() {
    if (document.getElementById('ds-file-picker-style')) return;
    var style = document.createElement('style');
    style.id = 'ds-file-picker-style';
    style.textContent = [
      '#' + BTN_ID + ' {',
      '  display: inline-flex; align-items: center; justify-content: center;',
      '  cursor: pointer; flex: none;',
      '}',
      '#' + BTN_ID + ' svg { display: block; }',
    ].join('\n');
    document.head.appendChild(style);
  }

  function quote(p) {
    return /[\s"']/.test(p) ? '"' + p.replace(/"/g, '\\"') + '"' : p;
  }

  function insertPaths(textarea, paths) {
    if (!paths || !paths.length) return;
    var text = paths.map(quote).join(' ');
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    var before = textarea.value.slice(0, start);
    var after = textarea.value.slice(end);
    // Keep a space between an existing word and the pasted path.
    var glue = before && !/\s$/.test(before) ? ' ' : '';
    var next = before + glue + text + ' ' + after;

    // React owns this textarea's value, so assigning .value directly gets
    // reverted on the next render — go through the native setter and fire
    // the input event React actually listens for.
    var setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    ).set;
    setter.call(textarea, next);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    var caret = (before + glue + text + ' ').length;
    textarea.setSelectionRange(caret, caret);
    textarea.focus();
  }

  function buildButton(referenceBtn, textarea) {
    var btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.className = referenceBtn.className; // match DSH's own icon buttons
    btn.setAttribute('aria-label', '选择文件');
    btn.title = '选择文件，把路径插入输入框';
    btn.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M8.5 1.5H3.2A1.7 1.7 0 0 0 1.5 3.2v9.6A1.7 1.7 0 0 0 3.2 14.5h9.6a1.7 1.7 0 0 0 1.7-1.7V7.5" ' +
      'stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M11 1.5v4.5M13.25 3.75h-4.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' +
      '</svg>';

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      window.dshDesktop
        .pickFiles()
        .then(function (paths) {
          insertPaths(textarea, paths);
        })
        .catch(function () {
          /* dialog dismissed or unavailable — nothing to insert */
        });
    });
    return btn;
  }

  function tryInject() {
    if (document.getElementById(BTN_ID)) return;
    var textarea = document.querySelector(
      'textarea[placeholder*="发消息"], textarea[placeholder*="描述你想"]'
    );
    if (!textarea) return;
    var card = textarea.closest('[class*="_card"]');
    if (!card) return;
    var commandBtn = card.querySelector('[aria-label="命令"]');
    if (!commandBtn || !commandBtn.parentElement) return;

    ensureStyle();
    var btn = buildButton(commandBtn, textarea);
    commandBtn.parentElement.insertBefore(btn, commandBtn.nextSibling);
  }

  tryInject();
  var observer = new MutationObserver(tryInject);
  observer.observe(document.body, { childList: true, subtree: true });
})();
