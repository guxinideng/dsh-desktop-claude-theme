(function () {
  // Unified line icons for the DSH UI, drawn from Lucide (ISC License,
  // https://lucide.dev — see NOTICE.md). Exposes window.dsIcons for other
  // injected scripts (file-picker.js, label-tweaks.js, ...):
  //   window.dsIcons.get(name) -> full <svg> string (caller sets width/height)
  //   window.dsIcons.has(name) -> boolean
  //
  // Page-side replacement never writes into the DOM tree that React manages.
  // It only sets a data-ds-icon attribute on recognised svg elements, and a
  // single injected <style> element draws the Lucide glyph with a CSS mask
  // (background-color: currentColor) while hiding the original children with
  // display:none. Nodes are never added, removed or edited, so React keeps
  // ownership of the whole subtree. When a button stops matching (e.g. send
  // turns into stop), the attribute is removed and the native icon returns.
  // Idempotent.
  if (window.__dsIconsInstalled) return;
  window.__dsIconsInstalled = true;

  var NS = 'http://www.w3.org/2000/svg';
  var ATTR_NAME = 'data-ds-icon';
  var STYLE_ID = 'ds-icons-style';
  var ATTRS = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.6',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true'
  };

  // Inner markup (children of the 24x24 svg), copied from lucide-static 0.460.0.
  var ICONS = {
    'panel-left': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
    'square-pen': '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>',
    'message-square-plus': '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 7v6"/><path d="M9 10h6"/>',
    'search': '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    'sliders-horizontal': '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
    'folder-plus': '<path d="M12 10v6"/><path d="M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    'folder': '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    'folder-open': '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
    'plus': '<path d="M5 12h14"/><path d="M12 5v14"/>',
    'shield-check': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    'arrow-up': '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    'x': '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    'copy': '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    'thumbs-up': '<path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>',
    'thumbs-down': '<path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/>',
    'rotate-ccw': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    'git-branch': '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
    'list-checks': '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
    'square-check': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/>',
    'square': '<rect width="18" height="18" x="3" y="3" rx="2"/>'
  };

  function has(name) {
    return Object.prototype.hasOwnProperty.call(ICONS, name);
  }

  function get(name) {
    if (!has(name)) return null;
    var attrs = '';
    for (var k in ATTRS) attrs += ' ' + k + '="' + ATTRS[k] + '"';
    return '<svg xmlns="' + NS + '"' + attrs + '>' + ICONS[name] + '</svg>';
  }

  window.dsIcons = { get: get, has: has };

  // ---- page-side replacement (CSS mask, attribute-only) ----------------

  // Mask glyph as a data URI. Mask uses the alpha channel, so black strokes
  // are the visible part; the colour comes from currentColor on the svg box.
  function maskUrl(name) {
    var svg = '<svg xmlns="' + NS + '" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
      ICONS[name] + '</svg>';
    return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
  }

  function buildCss() {
    var rules = ['svg[' + ATTR_NAME + '] > * { display: none !important; }'];
    for (var name in ICONS) {
      if (!has(name)) continue;
      var m = maskUrl(name);
      rules.push('svg[' + ATTR_NAME + '="' + name + '"] { background-color: currentColor; ' +
        '-webkit-mask: ' + m + ' center / contain no-repeat; mask: ' + m + ' center / contain no-repeat; }');
    }
    return rules.join('\n');
  }

  // Inject our own stylesheet once, in <head>, which React does not manage.
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = buildCss();
    (document.head || document.documentElement).appendChild(style);
  }

  // Element whose class contains the given token (dsh uses hashed class names).
  function classHas(el, token) {
    return !!el && (el.getAttribute('class') || '').indexOf(token) !== -1;
  }

  // Returns the icon name for an svg, or null when it should keep its native icon.
  function resolveName(svg) {
    var w = parseFloat(svg.getAttribute('width')) || 0;

    // Never touch brand, the context-usage ring, or inline svgs in text.
    if (svg.closest('[class*="hHd-Xa_brandMark"],[class*="brandName"],[class*="JObwrW_trigger"]')) return null;

    var btn = svg.closest('button,[role="button"]');

    // Workspace folder rows (host class YDXeBa_folder).
    var folderHost = svg.closest('[class*="YDXeBa_folder"]');
    if (folderHost && !(btn && (btn.getAttribute('aria-label') || '').indexOf('选择') === 0)) {
      return folderHost.getAttribute('aria-expanded') === 'true' ? 'folder-open' : 'folder';
    }

    if (!btn) return null;
    var label = btn.getAttribute('aria-label') || '';

    // Stop / interrupt buttons keep dsh's own icon.
    if (label.indexOf('停止') !== -1 || label.indexOf('中断') !== -1) return null;

    if (classHas(btn, 'hHd-Xa_newSession')) return 'square-pen';
    if (classHas(btn, 'hHd-Xa_toggle') || label === '打开侧边栏' || label === '收起侧边栏') return 'panel-left';
    if (label === '搜索会话') return 'search';
    if (label === '视图选项') return 'sliders-horizontal';
    if (label === '批量选择') return 'list-checks';
    if (label === '添加工作区') return 'folder-plus';
    if (label === '命令' || classHas(btn, 'uV2eYG_add')) return 'plus';
    if (label === '发送消息' || classHas(btn, 'uV2eYG_primary')) return 'arrow-up';
    if (label === '关闭详情' || classHas(btn, 'ydkMvW_close')) return 'x';
    if (label === '复制') return 'copy';
    if (label === '好的回答') return 'thumbs-up';
    if (label === '有问题的回答' || label === '不好的回答') return 'thumbs-down';
    if (label === '在新对话中分支' || label.indexOf('分叉') !== -1) return 'git-branch';
    if (label.indexOf('重新生成') !== -1) return 'rotate-ccw';

    // Access-mode button: shield at 16px, chevron at 14px.
    if (label.indexOf('访问模式') === 0 || classHas(btn, 'Sh0Q9G_trigger')) {
      if (svg.closest('[class*="triggerIcon"]') || w >= 15) return 'shield-check';
      return 'chevron-down';
    }
    // Model / workspace dropdowns: small chevron.
    if ((label.indexOf('选择') === 0) && w > 0 && w <= 14) return 'chevron-down';

    return null;
  }

  // Only writes our own data attribute on the svg element.
  function sync(svg) {
    var name = resolveName(svg);
    if (name) {
      if (svg.getAttribute(ATTR_NAME) !== name) svg.setAttribute(ATTR_NAME, name);
    } else if (svg.hasAttribute(ATTR_NAME)) {
      svg.removeAttribute(ATTR_NAME);
    }
  }

  function scan() {
    var list = document.querySelectorAll('svg');
    for (var i = 0; i < list.length; i++) {
      if (list[i].namespaceURI !== NS) continue;
      sync(list[i]);
    }
  }

  var scheduled = 0;
  function schedule() {
    if (scheduled) return;
    scheduled = requestAnimationFrame(function () {
      scheduled = 0;
      try { scan(); } catch (e) { console.warn('[dsIcons] scan failed', e); }
    });
  }

  injectStyle();
  var observer = new MutationObserver(schedule);
  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    // 'class' is kept because several mappings key on dsh's hashed class names.
    attributeFilter: ['aria-label', 'aria-expanded', 'class']
  });
  scan();
})();
