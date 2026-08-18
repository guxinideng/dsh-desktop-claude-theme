// mobile.js — drawer behavior for the phone-width sidebar overlay defined
// in mobile.css. Injected by remote-gateway.js alongside theme.css/mobile.css;
// never runs inside the Electron desktop app (main.js has its own injection
// list and doesn't include this file).
//
// dsh's [data-sidebar-collapsed] flag isn't just "hidden vs visible" — on
// desktop it's a real render-mode switch between a 56px icon rail and the
// full session list, and dsh animates that switch: a transition on
// .pI_x6G_frame's own grid-template-columns, plus separate keyframe
// animations in the sidebar component itself (a temporary .hHd-Xa_railIn
// class it adds makes its buttons and list region animate in from
// `opacity:0; transform:translate(49px)`). Early versions of this file
// went after those one at a time as they turned up (grid-template-columns
// transition, then the railIn animations) and each fix, verified as
// actually taking effect, still left the drawer visibly opening in two
// stages on a real phone — because there was no way to be sure that was
// the last animation dsh wired to this flag rather than just the last one
// found (see the 2026-08-16 chat). This file no longer lets
// [data-sidebar-collapsed] become true at all: ensureDshExpanded, below,
// corrects it back immediately if dsh (or a future dsh version) ever sets
// it. With the flag permanently pinned, the sidebar's contents are always
// rendered in full-list mode, so dsh never has a collapse/expand state
// change to animate in the first place — nothing to catch up with one
// animation at a time. Visibility is instead handled entirely by this
// file's own transform, driven by an independent open/closed class on the
// sidebar element itself (see DRAWER_OPEN_CLASS below), completely
// decoupled from dsh's own state.
(function () {
  'use strict';

  const MOBILE_BREAKPOINT = 640;
  const DRAWER_OPEN_CLASS = 'ds-mobile-drawer-open';

  // Run immediately (this script sits at the end of </body>, so body
  // exists): mobile is pinned to light mode, and stripping the dark flag
  // here — before the first paint can settle on dsh's dark palette —
  // stops the "闪一下深色再变浅色" flash on phones whose OS/appearance
  // is dark (the 2s poll below keeps it light against re-sets).
  if (window.innerWidth <= MOBILE_BREAKPOINT && document.body) {
    document.body.removeAttribute('data-ds-dark-theme');
  }

  function isMobile() {
    return window.innerWidth <= MOBILE_BREAKPOINT;
  }

  function getFrame() {
    return document.querySelector('.pI_x6G_frame');
  }

  function drawerEl() {
    return document.querySelector('.pI_x6G_sidebarCol');
  }

  function getToggleBtn() {
    return document.querySelector('button[aria-label="打开侧边栏"], button[aria-label="收起侧边栏"]');
  }

  // The only thing still allowed to touch dsh's own [data-sidebar-collapsed]
  // state — clicking its toggle button is the one action dsh exposes for
  // changing it, so correcting an unwanted "true" means clicking the same
  // button a real collapse-undo tap would. Hidden from view in mobile.css
  // (it drives real desktop state, and tapping it directly would collapse
  // the sidebar mid-session), but a hidden button can still be .click()'d.
  function ensureDshExpanded() {
    const frame = getFrame();
    if (!frame || frame.getAttribute('data-sidebar-collapsed') !== 'true') return;
    const btn = getToggleBtn();
    if (btn) btn.click();
  }

  function isSidebarOpen() {
    const el = drawerEl();
    return !!el && el.classList.contains(DRAWER_OPEN_CLASS);
  }

  function closeSidebar() {
    const el = drawerEl();
    if (el) el.classList.remove(DRAWER_OPEN_CLASS);
  }

  function openSidebar() {
    ensureDshExpanded();
    const el = drawerEl();
    if (el) el.classList.add(DRAWER_OPEN_CLASS);
  }

  // Corrects [data-sidebar-collapsed] back the instant dsh (or some
  // interaction this file didn't anticipate) sets it, and re-attaches
  // after dsh replaces the frame subtree — the same re-observe-on-a-poll
  // approach the old backdrop-sync code used, since dsh's SPA re-renders
  // can drop a plain MutationObserver along with the node it was watching.
  function observeDshCollapseState() {
    const frame = getFrame();
    if (!frame || frame.dataset.dsCollapseObserved) return;
    frame.dataset.dsCollapseObserved = '1';
    new MutationObserver(ensureDshExpanded).observe(frame, {
      attributes: true,
      attributeFilter: ['data-sidebar-collapsed'],
    });
  }

  // 模型/Agent 预设 settings tabs: both open onto developer-facing config
  // (30-some provider ids with no explanation; a preset-authoring flow) a
  // phone session has no use for. mobile.css can't reach these with a
  // plain selector — .VOzbGW_navCell is shared by all four tabs, nothing
  // distinguishes one from another except its text — so this does the
  // matching in JS and hands off to the shared .ds-mobile-hide class
  // mobile.css defines. If the dialog happened to be reopened onto
  // whichever of these two tabs was active last, hiding it out from under
  // itself would leave the panel showing content with no visible tab
  // selected — clicking back to 通用设置 avoids that.
  function hideDisabledSettingsNavTabs() {
    const navCells = document.querySelectorAll('.VOzbGW_navCell');
    if (!navCells.length) return;
    let generalTab = null;
    let activeIsHidden = false;
    navCells.forEach((cell) => {
      const label = cell.textContent;
      if (label.includes('通用设置')) generalTab = cell;
      if (label.includes('模型') || label.includes('Agent 预设')) {
        cell.classList.add('ds-mobile-hide');
        if (cell.classList.contains('VOzbGW_active')) activeIsHidden = true;
      }
    });
    if (activeIsHidden && generalTab) generalTab.click();
  }

  // The 通用设置 page's own "Agent 预设" row (default-preset picker that
  // picks what new sessions start with) is a desktop-authoring concept
  // with no place in a phone session — and its selector duplicates the
  // Agent 预设 tab that's already hidden above. Matched by title text
  // rather than class name: unlike the nav tabs (which share one class
  // across all four), every settings row carries its own per-row hash
  // prefix, so text is the only stable handle across dsh versions.
  function hideSettingsAgentPresetRow() {
    document.querySelectorAll('.VOzbGW_options [class$="_row"]').forEach((row) => {
      const title = row.querySelector('[class$="_title"]');
      if (title && title.textContent.trim() === 'Agent 预设') {
        row.classList.add('ds-mobile-hide');
      }
    });
  }

  // Workspace picker's "添加工作区…" entry starts a creation flow that
  // needs desktop-side setup (picking a local folder) — there's no
  // equivalent on a phone, so the entry is dead weight in a menu that,
  // with it gone, is just "here's your workspace" (user report). Matched
  // by text like the settings rows above: this menu component is shared
  // with the model/Agent-preset pickers, so the selector alone
  // ([role="menu"] [role="menuitem"]) isn't specific enough — the text
  // check is what keeps this from touching those.
  function hideAddWorkspaceMenuItem() {
    document.querySelectorAll('[role="menu"] [role="menuitem"]').forEach((item) => {
      if (item.textContent.trim().startsWith('添加工作区')) {
        item.classList.add('ds-mobile-hide');
      }
    });
  }

  // Hide it the instant the menu mounts, not up to 50ms later (the poll /
  // click-delay could let "添加工作区…" flash for a frame — user report
  // of it flickering on every open). A MutationObserver fires on the same
  // microtask as the menu's DOM insertion, before the browser paints, so
  // the entry never becomes visible.
  const workspaceMenuObserver = new MutationObserver(() => {
    if (isMobile()) hideAddWorkspaceMenuItem();
  });
  workspaceMenuObserver.observe(document.body, { childList: true, subtree: true });

  // Composer model-select button: dsh's own label is "DeepSeek-V4-Flash"
  // — the DeepSeek prefix is redundant here specifically (this whole
  // theme only exists for DeepSeek's own build of dsh, so every model in
  // the picker already carries it) and, at phone width, the label was
  // wide enough to force the effort badge next to it ("Max") into an
  // overflow ellipsis. Reads label.textContent fresh each call rather
  // than caching dsh's original string anywhere, so switching models
  // re-triggers the same strip on whatever the new label is, and running
  // it twice on an already-stripped label is a harmless no-op (the regex
  // just won't match) — including the run this function's own edit below
  // triggers on itself, through observeModelLabel's MutationObserver.
  function stripDeepSeekPrefix() {
    const label = document.querySelector('._7KE1Ra_triggerLabel');
    if (!label) return;
    const original = label.textContent;
    const stripped = original.replace(/^DeepSeek-?/, '');
    if (stripped && stripped !== original) {
      label.textContent = stripped;
    }
  }

  // The model menu carries two groups for the same models: the plain
  // DeepSeek route, and modlens's wrapped copy. The wrapped one is a
  // superset — same model, same route underneath, and it can also read a
  // pasted image — so the plain group is only ever the worse pick, and
  // showing both means choosing between two entries that differ by a
  // parenthetical.
  //
  // The suffix is modlens's, built as `${model.name ?? model.id} (modlens
  // vision)`. It has no config knob, and on a phone it does real damage:
  // the menu row is narrow enough that "V4 Flash (modlens vision)" gets
  // truncated mid-word.
  //
  // Text edits plus a display toggle — nothing added, moved, or removed,
  // so React keeps owning this subtree.
  const VISION_SUFFIX = /\s*\(modlens vision\)\s*$/;

  function tidyModelMenu() {
    document.querySelectorAll('[class*="_group"]').forEach((group) => {
      const title = group.querySelector('[class*="_groupTitle"]');
      if (!title) return;
      const text = (title.textContent || '').trim();
      if (text === 'DeepSeek') {
        // Hidden, not removed: if modlens ever fails to register its
        // wrapper, a reload brings this group back by itself.
        group.style.display = 'none';
        return;
      }
      if (VISION_SUFFIX.test(text)) {
        group.style.display = '';
        title.textContent = text.replace(VISION_SUFFIX, '');
      }
      group.querySelectorAll('[class*="_modelName"]').forEach((el) => {
        const name = el.textContent || '';
        if (VISION_SUFFIX.test(name)) el.textContent = name.replace(VISION_SUFFIX, '');
      });
    });

    document
      .querySelectorAll('[class*="_triggerLabel"], [class*="_cellValue"]')
      .forEach((el) => {
        const name = el.textContent || '';
        if (VISION_SUFFIX.test(name)) el.textContent = name.replace(VISION_SUFFIX, '');
      });
  }

  // Switching models used to visibly flash the full "DeepSeek-V4-Flash"
  // for a moment before settling back to "V4-Flash" — dsh re-renders this
  // label the instant a new model is picked, but the strip above only
  // ran on the 2s poll further down, so there was up to a 2s window
  // where the untrimmed label was what was actually on screen. Watching
  // the label directly re-strips it in the same tick dsh's own update
  // lands, closing that window instead of just shortening it.
  function observeModelLabel() {
    const label = document.querySelector('._7KE1Ra_triggerLabel');
    if (!label || label.dataset.dsObserved) return;
    label.dataset.dsObserved = '1';
    new MutationObserver(stripDeepSeekPrefix).observe(label, {
      characterData: true,
      childList: true,
      subtree: true,
    });
  }

  // Everything in init() looks for elements dsh may not have rendered
  // yet: this file loads at </body>, and measured on a session load the
  // core bundle finishes at 63ms while mobile.js isn't done until 109ms.
  // Each of those functions bails when its target is missing, so the fix
  // for a missing element used to be "wait for the next poll" — up to 2s
  // for the model label, 1s for the voice overlay. That wait is exactly
  // what shows: dsh paints "DeepSeek-V4-Flash" and an empty composer,
  // then a beat later the prefix disappears and a waveform appears.
  //
  // This watches for those elements instead of polling for them, so each
  // one is handled on the same frame it mounts. It disconnects as soon as
  // everything it's waiting for has been claimed — the ongoing polls and
  // per-element observers already cover later re-renders, so there's no
  // reason to keep a document-wide observer alive past first paint.
  function installFirstPaintWatcher() {
    if (!isMobile()) return;
    const pending = new Set(['model', 'voice', 'ring', 'tabs']);
    let observer = null;

    const claim = () => {
      if (pending.has('model') && document.querySelector('._7KE1Ra_triggerLabel')) {
        stripDeepSeekPrefix();
        tidyModelMenu();
        observeModelLabel();
        pending.delete('model');
      }
      if (pending.has('voice') && document.querySelector('.uV2eYG_grow')) {
        bindVoiceOverlay();
        bindSendButtonForVoiceRecall();
        pending.delete('voice');
      }
      if (pending.has('ring') && document.querySelector('.JObwrW_root')) {
        relocateContextRing();
        pending.delete('ring');
      }
      if (pending.has('tabs') && document.querySelector('.wSkVaW_tabs')) {
        syncTrajectoryTabStrip();
        pending.delete('tabs');
      }
      if (!pending.size && observer) {
        observer.disconnect();
        observer = null;
      }
    };

    observer = new MutationObserver(claim);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    claim();

    // Ceiling: if something never mounts (a view that doesn't have it),
    // don't leave a document-wide observer running for the session.
    setTimeout(() => {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    }, 15000);
  }

  function init() {
    if (!isMobile()) return;
    ensureDshExpanded();
    observeDshCollapseState();
    hideDisabledSettingsNavTabs();
    hideSettingsAgentPresetRow();
    hideAddWorkspaceMenuItem();
    stripDeepSeekPrefix();
    tidyModelMenu();
    observeModelLabel();
    syncTrajectoryTabStrip();
    relocateContextRing();
    syncThemeColor();
    pinMobileToLight();
    autoDismissWelcomeNotice();
    trimTurnStatusStats();
    installFirstPaintWatcher();
    // The model menu only renders once it's opened, and the poll below is
    // on a 1s cycle — so for up to a second after the tap, the untrimmed
    // name is what's actually on screen. Re-running on the click itself
    // closes that window instead of shortening it (same reasoning as
    // observeModelLabel above). Capture phase, and a 0ms defer so dsh's
    // own click handler has rendered the menu by the time this runs.
    document.addEventListener(
      'click',
      () => {
        setTimeout(tidyModelMenu, 0);
      },
      true
    );
  }

  // The status-bar / Dynamic-Island strip in iOS (especially in the
  // "添加到主屏幕" standalone mode the user runs this in) is painted
  // from <meta name="theme-color">, NOT from html/body backgrounds —
  // other dark-mode sites look "整体" because they ship one. dsh ships
  // none, so iOS fell back to its default light strip in every theme
  // (the persistent "灵动岛旁边还是浅色" report). Create/update the meta
  // to follow dsh's theme flag; iOS 15+ picks up dynamic changes, so the
  // 2s poll below keeps it in sync after a theme switch.
  function syncThemeColor() {
    const dark = document.body && document.body.hasAttribute('data-ds-dark-theme');
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = dark ? '#181716' : '#faf9f5';
  }

  // Mobile is pinned to light mode (2026-08-16). The Dynamic-Island /
  // status-bar strip in iOS standalone mode ("添加到主屏幕") doesn't track
  // dark mode reliably on this phone, and after several rounds of
  // fighting it the call was made to stop: the phone view stays light,
  // so the strip and the page always match. dsh's dark flag is simply
  // removed every poll — the whole UI (and the safe-area strip) falls
  // back to the light palette and stays there, no matter what the
  // appearance setting or the OS scheme says.
  function pinMobileToLight() {
    if (!isMobile()) return;
    if (document.body && document.body.hasAttribute('data-ds-dark-theme')) {
      document.body.removeAttribute('data-ds-dark-theme');
    }
  }

  // Auto-dismiss dsh's "内测声明" welcome notice (2026-08-16). It shows
  // whenever the acknowledged version in settings doesn't exactly match
  // the shipped WELCOME_NOTICE_VERSION, which after a config write-back
  // or fresh start keeps popping back up — and on a phone it's pure
  // friction ("每次点这个也挺烦"). Clicking its 继续/Continue button is
  // the same acknowledgement the user would tap, so dsh records it; the
  // overlay-hide fallback covers any state where the button isn't found.
  function autoDismissWelcomeNotice() {
    if (!isMobile()) return;
    const btn = [...document.querySelectorAll('button')].find((b) => /继续|Continue/.test(b.textContent || ''));
    if (btn) btn.click();
    const overlay = document.querySelector('[class*="onboardingOverlay"], [class*="onboarding"]');
    if (overlay) overlay.style.display = 'none';
  }

  // Message turn-status rows show "21:33 · 用时 2分15秒 · 首 token 28秒 ·
  // 106 tok/s" — the absolute time is useful on a phone, the latency/rate
  // stats are not (and they overflow the right edge — user report). Keep
  // only the time by emptying the text nodes that carry 用时/首 token/
  // tok/s; the time lives in its own element (timeStart), so it survives.
  // The row may not be rendered in every state, so this just re-runs on
  // the poll and trims whatever exists.
  //
  // NOTE (2026-08-16, corrected target): the row this must trim is dsh's
  // MessageIconActions component — the per-message "21:33 · 用时 … ·
  // deepdiving · 首 token … · … tok/s" footer — whose elements carry
  // *_timeStart / *_runTimeDot / *_actions classes. An earlier version
  // aimed at *turnStatus (the *other* status strip, which renders in
  // different states), so the actual stats row was never touched and kept
  // showing — the "从没成功过" report. Anchoring on the time element is
  // the reliable handle: every stats row has one, and its closest
  // *_actions ancestor is exactly the row to prune.
  // Keep ONLY the deepdiving marker in per-message stats footers, and
  // drop everything else (用时 / 首 token / tok/s / the clock time).
  // Previous versions anchored on guessed class names (*turnStatus,
  // *_timeStart) and kept missing the real row on the phone. This
  // version is structure-agnostic: any leaf text node that looks like a
  // stat (short, matches 用时/首 token/tok/s/ttft or a bare HH:MM clock)
  // Keep ONLY the deepdiving marker in per-message stats footers, and
  // drop everything else (用时 / 首 token / tok/s / the clock time).
  // Why every earlier version failed: the whole row often lives in ONE
  // text node ("21:33 · 用时 2分15秒 · deepdiving · 首 token 28秒 · 106
  // tok/s"), and the previous length cap (< 30 chars) excluded exactly
  // that. No cap now: any leaf text that mentions 用时/首 token/tok/s is
  // a stats row — if it also carries deepdiving/深度思考, the text is
  // REPLACED with the marker alone; otherwise it's emptied. Confined to
  // the message scroll area, never removes elements (removing empty
  // containers during dsh's mount is what blanked the page before).
  function trimTurnStatusStats() {
    if (!isMobile()) return;
    const scroll = document.querySelector('.wSkVaW_scrollBody');
    if (!scroll) return;
    // The 用时/首 token/tok/s/deepdiving are BARE TEXT NODES inside the
    // actions row (MessageIconActions renders them as raw children of a
    // Fragment) — querySelectorAll over elements never sees them, which
    // is why every earlier trim "didn't work" on the phone. Walk TEXT
    // nodes instead and empty every stat/marker node; the clock time
    // lives in its own element (timeStart, kept visible by mobile.css),
    // so it survives. Never removes elements.
    const walker = document.createTreeWalker(scroll, NodeFilter.SHOW_TEXT);
    const dead = [];
    let node;
    while ((node = walker.nextNode())) {
      const t = node.textContent || '';
      if (!/用时|首 ?token|tok\/s|tokensPerSecond|ttft|deep\s*diving|深度思考/.test(t)) continue;
      node.textContent = '';
    }
  }

  // The 对话/轨迹 tab strip is hidden on mobile (mobile.css), but dsh can
  // still navigate into the trajectory view from inside a conversation (a
  // tool-call row, the details panel) — and once there, the hidden strip
  // leaves no way back to the conversation. Re-show the strip
  // (ds-mobile-tabs-visible, styled in mobile.css) whenever the active tab
  // is 轨迹 so it can be tapped back; drop it again once 对话 is active.
  function syncTrajectoryTabStrip() {
    const tabs = document.querySelector('.wSkVaW_tabs');
    if (!tabs) return;
    const active = tabs.querySelector('.wSkVaW_tabActive');
    const onTrajectory = active && /轨迹/.test(active.textContent || '');
    tabs.classList.toggle('ds-mobile-tabs-visible', !!onTrajectory);
  }

  // ── Context-usage ring moved to the header row (2026-08-16) ────────
  // The context-progress circle (JObwrW) lives at the right end of the
  // composer row, crowding the model trigger on narrow screens. The user
  // wants it beside the conversation title instead. Move the whole
  // JObwrW_root (the trigger button AND its popup panel — the panel
  // positions relative to the root, so moving only the trigger left the
  // percentage detail popping up back at the composer row, user report).
  // mobile.css positions the root absolutely at the header's right edge
  // and flips the panel to open downward so it stays on screen.
  // dsh's re-renders restore the original tree, so the poll re-applies
  // the move (same pattern as the other relocations).
  function relocateContextRing() {
    const root = document.querySelector('.JObwrW_root');
    if (!root) return;
    const titleRow = document.querySelector('.wSkVaW_titleRow');
    if (!titleRow) return;
    if (root.parentElement === titleRow) return;
    titleRow.appendChild(root);
  }

  // ── "+" command menu: Chinese labels + 添加文件 entry ───────────────
  // The menu dsh opens from + lists actions in English (compact / export /
  // feedback / goal / permission / plan / model). Phone users asked for
  // short Chinese labels with a one-line description so each entry's
  // purpose is obvious, plus an 添加文件 entry at the bottom. The menu is
  // mounted per open, so translate/append fresh each time.
  const COMMAND_TRANSLATIONS = {
    compact: { name: '压缩', desc: '压缩旧会话，释放上下文' },
    export: { name: '导出', desc: '导出当前会话' },
    feedback: { name: '反馈', desc: '提交使用反馈' },
    goal: { name: '目标', desc: '查看或设置目标' },
    permission: { name: '权限', desc: '切换本会话权限模式' },
    plan: { name: '计划', desc: '进入或退出计划模式' },
    model: { name: '模型', desc: '选择本会话使用的模型' },
  };

  function translateCommandMenu() {
    document.querySelectorAll('._3e4SsG_item').forEach((item) => {
      const nameEl = item.querySelector('._3e4SsG_itemName');
      if (!nameEl || nameEl.dataset.dsTranslated) return;
      const t = COMMAND_TRANSLATIONS[nameEl.textContent.trim()];
      if (!t) return;
      nameEl.dataset.dsTranslated = '1';
      nameEl.textContent = t.name;
      const descEl = item.querySelector('._3e4SsG_itemDescription');
      if (descEl) descEl.textContent = t.desc;
    });
  }

  function ensureAddFileEntry() {
    const first = document.querySelector('._3e4SsG_item');
    if (!first) return;
    const menu = first.parentElement;
    if (!menu || menu.querySelector('.ds-mobile-add-file')) return;
    const item = document.createElement('div');
    item.className = '_3e4SsG_item ds-mobile-add-file';
    const name = document.createElement('span');
    name.className = '_3e4SsG_itemName';
    name.textContent = '添加文件';
    const desc = document.createElement('span');
    desc.className = '_3e4SsG_itemDescription';
    desc.textContent = '从手机选择文件';
    item.appendChild(name);
    item.appendChild(desc);
    item.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.style.display = 'none';
      document.body.appendChild(input);
      input.onchange = () => {
        const count = input.files ? input.files.length : 0;
        if (count > 0 && window.alert) window.alert(`已选择 ${count} 个文件`);
        input.remove();
      };
      input.click();
    });
    menu.appendChild(item);
  }

  // Tapping + opens the command menu — dsh focuses the composer right
  // after, popping the keyboard for what is a menu interaction (user
  // report). Feed the same navigation-lock timestamp the keyboard
  // suppression below reads: the input goes readonly for the lock window,
  // so the focus cannot summon the keyboard, and a real tap on the input
  // still lifts the lock immediately.
  document.addEventListener(
    'click',
    (event) => {
      if (!isMobile() || !event.target.closest('.uV2eYG_add')) return;
      lastSessionNavAt = Date.now();
      setTimeout(() => {
        translateCommandMenu();
        ensureAddFileEntry();
      }, 80);
    },
    true
  );

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  setInterval(() => {
    if (!isMobile()) return;
    ensureDshExpanded();
    observeDshCollapseState();
    hideDisabledSettingsNavTabs();
    hideSettingsAgentPresetRow();
    hideAddWorkspaceMenuItem();
    syncSettingsPanelHeight();
    stripDeepSeekPrefix();
    tidyModelMenu();
    observeModelLabel();
    syncTrajectoryTabStrip();
    relocateContextRing();
    pinMobileToLight();
    autoDismissWelcomeNotice();
    trimTurnStatusStats();
    syncThemeColor();
  }, 2000);

  // Settings dialog is a portal mounted fresh each time its trigger is
  // tapped, so the 2s poll above could leave the 模型/Agent 预设 tabs
  // (and the 通用设置 page's Agent 预设 row) visible for up to 2s right
  // after opening — catching the trigger tap itself and re-checking
  // shortly after (dialog needs a moment to mount) closes that gap
  // without lowering the poll interval everywhere else that doesn't need
  // it.
  document.addEventListener(
    'click',
    (event) => {
      if (!isMobile() || !event.target.closest('.VOzbGW_trigger')) return;
      setTimeout(() => {
        hideDisabledSettingsNavTabs();
        hideSettingsAgentPresetRow();
        syncSettingsPanelHeight();
      }, 50);
    },
    true
  );

  // Same portal-mount-delay problem as the settings dialog above, but for
  // the workspace picker's own trigger — without this, "添加工作区…"
  // would flash visible for up to 2s after every tap before the poll
  // caught up to hiding it.
  document.addEventListener(
    'click',
    (event) => {
      if (!isMobile() || !event.target.closest('.pXSMma_workspace')) return;
      setTimeout(hideAddWorkspaceMenuItem, 50);
    },
    true
  );

  // ── Settings dialog as the second drawer level ──────────────────────
  // The sidebar is level one (swipe/blank-tap to close, back to the main
  // page); dsh's settings dialog — its own portal component mounted fresh
  // on every open — is level two on top of it: swipe left on the panel or
  // tap the empty area to its right and settings closes back to the
  // sidebar, which itself remains open. The close button is hidden in
  // mobile.css, so the only way left to unwind dsh's own portal state is
  // to replay a click on that same hidden button — the identical pattern
  // ensureDshExpanded uses for the sidebar's hidden toggle button above.
  function settingsPanelEl() {
    return document.querySelector('.VOzbGW_panel');
  }
  function settingsOpen() {
    return !!settingsPanelEl();
  }

  // Dismiss the settings level with the same slide-out the sidebar uses:
  // animate the panel left off-screen (0.25s ease, matching the sidebar's
  // own close), then replay a click on dsh's hidden close button to let
  // its portal state unwind. The flag guards against double-dismissal
  // (a blank tap racing the swipe-release settle). The panel is unmounted
  // by dsh once the click lands, so the next open remounts it fresh and
  // replays the CSS slide-in.
  function closeSettings() {
    const panel = settingsPanelEl();
    if (!panel || panel.dataset.dsClosing) return;
    panel.dataset.dsClosing = '1';
    panel.style.animation = 'none';
    panel.style.transition = 'transform 0.25s ease';
    panel.style.transform = 'translateX(-100%)';
    setTimeout(() => {
      const btn = document.querySelector('.VOzbGW_close');
      if (btn) btn.click();
      delete panel.dataset.dsClosing;
    }, 250);
  }

  // The settings panel and the sidebar are level one / level two of the
  // same drawer stack, so they must be the same size — and "same size"
  // means matching whatever dsh's own sidebar stylesheet actually renders
  // (on a 390px viewport that's 796px tall, 16px short of the viewport,
  // because dsh leaves the sidebar a hair short of edge-to-edge). Reading
  // the sidebar's live height instead of hardcoding it keeps the two in
  // lockstep even if dsh changes that value.
  function syncSettingsPanelHeight() {
    const panel = settingsPanelEl();
    const sidebar = document.querySelector('.pI_x6G_sidebarCol');
    if (!panel || !sidebar) return;
    const h = sidebar.getBoundingClientRect().height;
    if (h > 0) panel.style.setProperty('height', `${h}px`, 'important');
  }

  // The panel is a portal mounted fresh on every open — the 50ms
  // trigger-timeout and the 2s poll can both miss the first paint, leaving
  // the panel at its CSS default (100dvh, edge-to-edge) beside the shorter
  // sidebar for a visible beat (the size mismatch the user keeps seeing).
  // Watching the DOM for the portal mount syncs the height the instant the
  // panel exists, before anything can paint it out of step. The callback
  // is throttled through requestAnimationFrame: the observer fires on
  // every subtree change (dsh re-renders constantly while the panel is
  // open), and getBoundingClientRect inside it forces a synchronous
  // layout — batching the work to one pass per frame keeps a busy re-render
  // from turning into a layout thrash on every mutation.
  let panelHeightSyncFrame = null;
  const panelHeightObserver = new MutationObserver(() => {
    if (panelHeightSyncFrame) return;
    panelHeightSyncFrame = requestAnimationFrame(() => {
      panelHeightSyncFrame = null;
      if (isMobile()) syncSettingsPanelHeight();
    });
  });
  panelHeightObserver.observe(document.body, { childList: true, subtree: true });

  // Left-swipe to dismiss the settings panel, tracking the finger 1:1 the
  // same way the sidebar's own drag does: the panel follows the finger
  // while it moves (transform, reflow-free), and release commits to either
  // fully closed (slide-out via closeSettings) or fully back to open.
  // 15% of the panel width (~48px on a 320px panel), not the sidebar's
  // own 28%: the settings panel is a lightweight second level meant to be
  // flicked away, and a full sidebar-strength drag on it read as the
  // threshold being too high (user report, 2026-08-16). The axis lock
  // keeps vertical scrolls inside the options list untouched.
  //
  // Implemented with pointer events, not touch: the panel carries
  // touch-action: pan-y (mobile.css), so the browser owns vertical
  // panning and horizontal movement is ours — which means these listeners
  // can all stay passive. A touch-based drag needed a non-passive
  // touchmove to preventDefault the horizontal pan, and that listener sat
  // on document, forcing the compositor to wait on JS for *every* scroll
  // frame whether or not the drag engaged (the jank source). With passive
  // pointer listeners and touch-action declaring the split up front, a
  // vertical scroll never blocks on this code.
  const SETTINGS_DRAG_COMMIT_FRACTION = 0.15;
  const SETTINGS_DRAG_AXIS_LOCK_PX = 6;
  let settingsDragStartX = null;
  let settingsDragStartY = null;
  let settingsDragAxis = null; // null | 'x' | 'y'
  let settingsDragWidth = 0;
  let settingsDragX = 0;

  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!isMobile() || !event.isPrimary) return;
      const panel = settingsPanelEl();
      if (!panel || panel.dataset.dsClosing) return;
      if (!event.target.closest('.VOzbGW_panel')) return;
      settingsDragStartX = event.clientX;
      settingsDragStartY = event.clientY;
      settingsDragAxis = null;
      settingsDragWidth = panel.getBoundingClientRect().width || 0;
      settingsDragX = 0;
      panel.style.animation = 'none'; // a touch interrupts the slide-in
      panel.style.transition = 'none';
    },
    { passive: true }
  );

  document.addEventListener(
    'pointermove',
    (event) => {
      if (!isMobile() || settingsDragStartX === null) return;
      const panel = settingsPanelEl();
      if (!panel) return;
      const dx = event.clientX - settingsDragStartX;
      const dy = event.clientY - settingsDragStartY;
      if (settingsDragAxis === null) {
        if (Math.abs(dx) < SETTINGS_DRAG_AXIS_LOCK_PX && Math.abs(dy) < SETTINGS_DRAG_AXIS_LOCK_PX) return;
        settingsDragAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      }
      if (settingsDragAxis !== 'x') return;
      settingsDragX = Math.max(-settingsDragWidth, Math.min(0, dx));
      panel.style.transform = `translateX(${settingsDragX}px)`;
    },
    { passive: true }
  );

  function settleSettingsDrag() {
    if (settingsDragStartX === null) return;
    settingsDragStartX = null;
    settingsDragStartY = null;
    const wasHorizontal = settingsDragAxis === 'x';
    settingsDragAxis = null;
    const panel = settingsPanelEl();
    if (!panel || !wasHorizontal || settingsDragWidth === 0) return;
    const openness = 1 + settingsDragX / settingsDragWidth;
    if (openness < 1 - SETTINGS_DRAG_COMMIT_FRACTION) {
      closeSettings(); // slides out from wherever the finger let go
    } else {
      panel.style.transition = 'transform 0.25s ease';
      panel.style.transform = 'translateX(0)';
    }
  }

  document.addEventListener('pointerup', settleSettingsDrag, { passive: true });
  document.addEventListener('pointercancel', settleSettingsDrag, { passive: true });

  // Tapping the dimmed main content used to close the drawer via a click
  // listener on a visible backdrop element; the backdrop itself is gone
  // (dropped per request — the shadow it cast over the main page read as
  // unwanted extra chrome, not a helpful dimming cue), but tapping outside
  // the drawer to close it is still the expected gesture, so this keeps
  // that behavior without anything visible backing it.
  //
  // The settings dialog (below) is a second level on top of the sidebar:
  // settings closes back to the sidebar, and only then does a blank tap
  // reach the sidebar's own close. While settings is open, any tap outside
  // its panel dismisses settings only — never the sidebar underneath.
  document.addEventListener(
    'click',
    (event) => {
      if (!isMobile()) return;
      if (settingsOpen()) {
        if (!event.target.closest('.VOzbGW_panel')) {
          // dsh's own mask layer carries onClick={onClose} — without
          // stopping propagation here (capture phase, before React's
          // delegated listener at the root), dsh unmounts the portal the
          // instant this handler's closeSettings starts its slide-out
          // animation, so the panel just vanished (user report). Kill the
          // event so only the animated path below runs.
          event.preventDefault();
          event.stopPropagation();
          closeSettings();
        }
        return;
      }
      if (!isSidebarOpen()) return;
      if (event.target.closest('.pI_x6G_sidebarCol')) return;
      closeSidebar();
    },
    true
  );

  // ── Workspace picker: dismiss-on-chip-tap ───────────────────────────
  // dsh's workspace Menu renders with anchor={null} and positions itself
  // off getAnchorRect (the chip's rect), so the chip button is NOT inside
  // the Menu's root ref. While the menu is open dsh's own document-level
  // pointerdown listener therefore treats a tap on the chip as an
  // "outside" interaction and closes the menu — and then the chip's own
  // onClick toggle (setPickerOpen(open => !open)) runs on the click that
  // follows and reopens it. Net effect of one tap: close→reopen in a
  // single gesture, which reads as a flash, and the menu never actually
  // dismisses (user report: "点一下...再点一下，它取消不了，它就会闪一下").
  // The Agent-preset seat next to it anchors its Menu on the button
  // itself, so the button lives inside the Menu's root ref, the pointer
  // down is not "outside", and its toggle closes cleanly — the behavior
  // the user asked the workspace chip to match.
  //
  // Fix: remember when a pointerdown lands on the chip while the menu is
  // open, then swallow the click that follows. The close already fired
  // from dsh's own pointerdown handler sticks instead of being re-toggled
  // open. Taps when the menu is closed are untouched (pointerdown records
  // false), so opening still works through dsh's normal toggle.
  let workspaceChipTapWhileOpen = false;
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!isMobile() || !event.isPrimary) return;
      const chip = event.target.closest && event.target.closest('.pXSMma_workspace');
      workspaceChipTapWhileOpen = !!chip && chip.getAttribute('aria-expanded') === 'true';
    },
    true
  );
  document.addEventListener(
    'click',
    (event) => {
      if (!isMobile() || !workspaceChipTapWhileOpen) return;
      workspaceChipTapWhileOpen = false;
      if (!event.target.closest('.pXSMma_workspace')) return;
      event.preventDefault();
      event.stopPropagation();
    },
    true
  );

  // Selecting a session (or starting a new one) should feel like
  // navigating, not "change the active chat but leave the list covering
  // it" — auto-close on tap so the conversation is what's left on screen,
  // matching what plain in-app navigation would do. An earlier version
  // only matched .YDXeBa_sessionRow, so the main content did navigate on
  // "新会话" but the drawer itself was left sitting open over it.
  // lastSessionNavAt feeds the keyboard-suppression lock further down
  // (dsh auto-focuses the composer on navigation, which would otherwise
  // pop the on-screen keyboard on a phone).
  let lastSessionNavAt = 0;
  document.addEventListener(
    'click',
    (event) => {
      if (!isMobile()) return;
      const row = event.target.closest('.YDXeBa_sessionRow');
      const newSessionBtn = event.target.closest('.hHd-Xa_newSession');
      if (!row && !newSessionBtn) return;
      lastSessionNavAt = Date.now();
      // A tap that landed on a row's own "…" actions button isn't a
      // navigation — it's opening the rename/delete menu (long-press
      // below also synthesizes a click on this same button). Closing the
      // sidebar out from under that menu yanks it off screen along with
      // its now-offscreen anchor.
      if (row && event.target.closest('.YDXeBa_rowActions')) return;
      // Let dsh apply the selection first — closing mid-click can race the
      // row's own click handler on some browsers.
      setTimeout(closeSidebar, 150);
    },
    true
  );

  // Session rows are draggable="true" (dsh lets you reorder them by
  // dragging on desktop). On a phone that collides head-on with the
  // long-press below: the same gesture that opens the row's menu also
  // starts a native drag, and iOS floats a snapshot of the row under the
  // finger — the solid black bar with doubled-up text and a grip icon
  // sitting over the sidebar while the menu is open. Cancelling dragstart
  // is what actually stops it; mobile.css's -webkit-user-drag:none is the
  // declarative half, but isn't honored consistently on its own. Reorder
  // by dragging has no mobile affordance to lose.
  document.addEventListener(
    'dragstart',
    (event) => {
      if (!isMobile()) return;
      if (!event.target.closest || !event.target.closest('.YDXeBa_sessionRow')) return;
      event.preventDefault();
    },
    true
  );

  // Long-press a session row to open its rename/delete menu — the actual
  // button for this (.YDXeBa_rowActions) is still in the DOM, just hidden
  // via visibility (see mobile.css) so it can't eat a row's first tap the
  // way its default hover-reveal did. Long-press replays a tap on it
  // (synthesizeTap, below); the button's own dropdown takes it from there.
  const LONG_PRESS_MS = 500;
  const LONG_PRESS_MOVE_TOLERANCE_PX = 10;
  let longPressTimer = null;
  let longPressRow = null;
  let longPressStartX = 0;
  let longPressStartY = 0;
  let longPressFired = false;

  // A plain el.click() only synthesizes a 'click' event — this menu trigger
  // turned out to be listening lower-level (pointerdown/mousedown), so
  // nothing opened until the full down/up/click sequence a real tap
  // produces was replayed here too (verified live against the real
  // component before landing this).
  function synthesizeTap(el) {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const base = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerId: 1, isPrimary: true, pointerType: 'touch' }));
    el.dispatchEvent(new MouseEvent('mousedown', base));
    el.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerId: 1, isPrimary: true, pointerType: 'touch' }));
    el.dispatchEvent(new MouseEvent('mouseup', base));
    el.dispatchEvent(new MouseEvent('click', base));
  }

  // Passive, no preventDefault: an earlier version called preventDefault
  // here unconditionally (on every touchstart landing on a row, not just
  // ones that turn into a real long-press) on the unconfirmed theory that
  // it would stop "unrelated conversation text" showing up mid-press. It
  // never actually fixed that, and cost two much more concrete things
  // instead — a touchstart that's preventDefault'd gets no synthetic click
  // from the browser afterward, so tapping a row to open it stopped
  // working entirely (only long-press still worked, since that path
  // dispatches its own synthetic click rather than relying on the
  // browser's), and it's the likely reason the list still wouldn't scroll
  // even after touchmove stopped preventDefaulting (see the 2026-08-16
  // chat) — the browser may write a touch off as non-scrolling from
  // touchstart alone. Both regressions are certain; the text-selection
  // theory this was defending against was never confirmed, so it's not
  // worth keeping.
  document.addEventListener(
    'touchstart',
    (event) => {
      if (!isMobile()) return;
      const row = event.target.closest('.YDXeBa_sessionRow');
      clearTimeout(longPressTimer);
      longPressRow = row;
      if (!row) return;
      const touch = event.touches[0];
      longPressStartX = touch.clientX;
      longPressStartY = touch.clientY;
      longPressTimer = setTimeout(() => {
        longPressFired = true;
        longPressRow = null;
        const actionsBtn = row.querySelector('.YDXeBa_rowActions button');
        if (actionsBtn) synthesizeTap(actionsBtn);
        if (navigator.vibrate) navigator.vibrate(10);
      }, LONG_PRESS_MS);
    },
    { passive: true }
  );

  // Passive, and never preventDefault: whether this touch is allowed to
  // scroll natively is decided by the browser from the very first touchmove
  // frame, and a long-press hold typically starts with a few px of drift
  // well inside the tolerance below — preventDefault on those early frames
  // (an earlier version did this, copying the swipe-drawer gesture's own
  // fix) was enough to make the browser write off the *entire* gesture as
  // non-scrolling, even once this handler stopped calling it. That's what
  // made the session list un-scrollable rather than just cancelling the
  // long-press. touchstart's own preventDefault (below) already covers the
  // thing this was trying to additionally suppress — iOS's native
  // long-press callout — so touchmove only needs to read position, never
  // block it.
  document.addEventListener(
    'touchmove',
    (event) => {
      if (!longPressRow) return;
      const touch = event.touches[0];
      const dx = Math.abs(touch.clientX - longPressStartX);
      const dy = Math.abs(touch.clientY - longPressStartY);
      if (dx > LONG_PRESS_MOVE_TOLERANCE_PX || dy > LONG_PRESS_MOVE_TOLERANCE_PX) {
        clearTimeout(longPressTimer);
        longPressRow = null;
      }
    },
    { passive: true }
  );

  document.addEventListener(
    'touchend',
    () => {
      clearTimeout(longPressTimer);
      longPressRow = null;
    },
    { passive: true }
  );

  // The touchend that ends a fired long-press still produces a trailing
  // click a moment later — without this it would immediately navigate
  // into the session right after the menu opens. But synthesizeTap's own
  // click on .YDXeBa_rowActions (dispatched inside the setTimeout above,
  // which sets longPressFired = true just before calling it) is nested
  // inside that same row — an earlier version of this guard didn't
  // exclude it, so it was swallowing that click too and the dropdown
  // never opened at all (found by comparing a synthesized tap dispatched
  // synchronously, which worked, against the same tap dispatched from
  // inside the real long-press timer, which didn't).
  document.addEventListener(
    'click',
    (event) => {
      if (!longPressFired) return;
      longPressFired = false;
      if (event.target.closest('.YDXeBa_rowActions')) return;
      const row = event.target.closest('.YDXeBa_sessionRow');
      if (row) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true
  );

  // Pressed-state feedback on a session row: needs the same "still resting
  // vs. passing through on the way to a scroll" distinction the long-press
  // timer above already makes, so it reuses that same move tolerance to
  // agree with it on what counts as holding still — but kept as its own
  // independent set of listeners rather than folded into the long-press
  // ones, since toggling a class has no state worth coupling to a timer
  // that's also deciding whether to pop a menu open.
  const PRESSED_CLASS = 'ds-mobile-row-pressed';
  let pressedRow = null;
  let pressedStartX = 0;
  let pressedStartY = 0;

  document.addEventListener(
    'touchstart',
    (event) => {
      if (!isMobile()) return;
      const row = event.target.closest('.YDXeBa_sessionRow');
      if (pressedRow) pressedRow.classList.remove(PRESSED_CLASS);
      pressedRow = row;
      if (!row) return;
      const touch = event.touches[0];
      pressedStartX = touch.clientX;
      pressedStartY = touch.clientY;
      row.classList.add(PRESSED_CLASS);
    },
    { passive: true }
  );

  document.addEventListener(
    'touchmove',
    (event) => {
      if (!pressedRow) return;
      const touch = event.touches[0];
      const dx = Math.abs(touch.clientX - pressedStartX);
      const dy = Math.abs(touch.clientY - pressedStartY);
      if (dx > LONG_PRESS_MOVE_TOLERANCE_PX || dy > LONG_PRESS_MOVE_TOLERANCE_PX) {
        pressedRow.classList.remove(PRESSED_CLASS);
        pressedRow = null;
      }
    },
    { passive: true }
  );

  function clearPressedRow() {
    if (pressedRow) pressedRow.classList.remove(PRESSED_CLASS);
    pressedRow = null;
  }
  document.addEventListener('touchend', clearPressedRow, { passive: true });
  document.addEventListener('touchcancel', clearPressedRow, { passive: true });

  // Drawer drag: tracks the finger 1:1 while dragging, then animates to
  // fully open or fully closed on release — the same pattern iOS's own
  // edge-swipe and most chat apps' drawers use. An earlier version jumped
  // straight from closed to open the instant a swipe crossed
  // SWIPE_THRESHOLD_PX; that read as a rigid on/off flip rather than
  // something being dragged, and (see the removed preventDefault-only
  // fix) still let the drag double as a native pan on whatever was
  // underneath. This drives the drawer's transform by hand during the
  // gesture, and only commits to this file's own DRAWER_OPEN_CLASS once,
  // after the release animation finishes settling on one side or the
  // other.
  // Fraction of the drawer's width this gesture needs to cross, measured
  // from wherever it started, before release commits to the opposite state
  // — the same 28% either direction. An earlier version compared the final
  // openness straight to this one constant regardless of start side, which
  // is only symmetric for a drag that starts closed: opening committed at
  // openness >= 0.28 (drag 28%), but closing needed openness < 0.28, i.e.
  // dragging through 72% of the width — closing took two and a half times
  // the swipe that opening did. wouldCommitOpen folds the start side back
  // in so both directions commit at the same 28%-of-width travel.
  const DRAG_COMMIT_FRACTION = 0.28;
  const DRAG_AXIS_LOCK_PX = 6; // movement needed before committing this gesture to horizontal vs. vertical
  // Width of the strip along the screen's left edge where iOS Safari's
  // swipe-to-go-back gesture (and Android Chrome's gesture-nav back)
  // claims a touch that starts there. Roughly Apple's own edge-swipe
  // zone. A swipe inside this strip is exactly the "swipe right to open
  // the drawer" gesture users expect to work from the screen edge, so
  // this file both lets the drag prime there (see the pointerdown
  // exclusion bypass below) and actively kills the browser's competing
  // back gesture (see edgeSwipeGuard).
  const EDGE_SWIPE_ZONE_PX = 28;
  let dragStartX = null;
  let dragStartY = null;
  let dragAxis = null; // null (undecided) | 'x' | 'y'
  let dragWidth = 0;
  let dragBaseX = 0; // translateX at gesture start: 0 if starting open, -dragWidth if starting closed
  let dragCurrentX = 0;
  let dragHapticFired = false;
  let dragXGuardArmed = false;
  // True while a drag that *started inside the left-edge strip* is live.
  // Only such a drag attaches the non-passive edgeSwipeGuard (below), so
  // ordinary touches never pay the compositor's "wait for JS" tax a
  // non-passive touchmove listener normally charges.
  let dragFromEdge = false;

  function wouldCommitOpen(openness) {
    const startedOpen = dragBaseX === 0;
    return startedOpen ? openness >= 1 - DRAG_COMMIT_FRACTION : openness >= DRAG_COMMIT_FRACTION;
  }

  // Live drag tracking only — called every touchmove tick while a finger
  // is actually moving, never for the post-release settle. Always
  // transform, never `left`: `left` reflows the page on every call, and
  // a drag can fire this dozens of times a second (a follow-up report of
  // the whole page feeling sluggish while dragging, specifically, is what
  // an earlier version of this function — which used `left` throughout —
  // turned out to cost). transform is expressed relative to dragBaseX
  // (the resting `left` the drawer actually had when this gesture began)
  // rather than as an absolute position, since `left` itself is never
  // touched during the drag — only reconciled with wherever transform
  // left off, once, in the touchend handler below.
  function setDragTransform(px) {
    const el = drawerEl();
    if (el) {
      el.style.transition = 'none';
      el.style.transform = `translateX(${px - dragBaseX}px)`;
    }
  }

  // Hands the drawer's position off from transform (what the live drag
  // above just finished moving it with) to `left` (what mobile.css's own
  // resting-state rule, and the settings dialog elsewhere in the sidebar,
  // both need it expressed in — see mobile.css's comment on
  // .pI_x6G_sidebarCol) without a visible jump. The two forceful reflows
  // are load-bearing, not defensive copy-paste: without the first, the
  // browser can coalesce the transition:none + left write with whatever
  // comes right after and the drawer would flash to its *old* left value
  // before jumping to the new one; without the second, clearing transform
  // could be coalesced with restoring transition, animating the "jump"
  // that removing transform should have made instantly. Every call site
  // already knows the drawer's current on-screen position when it calls
  // this (either px here, or the drag just ended at dragCurrentX), so the
  // handoff is always to a `left` value transform was already sitting at
  // — nothing left to animate between the two properties.
  //
  // `!important`, not a plain assignment: mobile.css's own resting-state
  // rule declares `left` with !important (needed there to beat theme.css),
  // and a plain el.style.left write can't outrank that — it was silently
  // no-opping, so this freeze was never actually taking effect. What a
  // drag ending near fully-open actually did was clear the live transform
  // with nothing real holding `left` at the drag's endpoint, snapping the
  // drawer straight back to the CSS default (fully closed) for a frame
  // before the class below reopened it — the "let go and it snaps back,
  // dragging again" report (see the 2026-08-16 chat). left is deliberately
  // left frozen (not cleared) when this returns; touchend clears it itself
  // once the open/closed class is set, so the class's own !important rule
  // — not this leftover freeze — is what the browser actually animates to.
  function settleAt(px) {
    const el = drawerEl();
    if (!el) return;
    el.style.setProperty('transition', 'none', 'important');
    el.style.setProperty('left', `${px}px`, 'important');
    el.style.removeProperty('transform');
    void el.offsetHeight;
    el.style.removeProperty('transition');
    void el.offsetHeight;
  }

  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!isMobile() || !event.isPrimary) return;
      // While the settings dialog is up, its panel sits in front of the
      // sidebar (portal on top of the overlay) — a swipe that starts on
      // the panel's blank areas must not also prime a sidebar drag behind
      // it, or a left-swipe to dismiss settings would drag (invisibly)
      // and possibly commit the sidebar closed underneath as well.
      if (settingsOpen()) return;
      // A touch starting inside the session list used to be excluded
      // entirely here, on the theory that a mostly-vertical scroll could
      // occasionally lean horizontal enough in its first few px to
      // axis-lock 'x' below and get hijacked into a drawer drag instead.
      // That exclusion was never actually confirmed to be what fixed the
      // list-won't-scroll report it was aimed at (a touchstart
      // preventDefault elsewhere, removed the same round, was at least as
      // likely the real cause) — and it had a real, confirmed cost: the
      // list fills nearly all of the drawer's height, so excluding it
      // left almost nowhere inside the open drawer where a left-swipe
      // could close it at all (see the 2026-08-16 chat). The axis lock
      // below already keeps a vertical scroll from preventDefaulting
      // (dragAxis only reaches 'x', and only then does this preventDefault,
      // once horizontal movement is actually confirmed to dominate) — so
      // removing the exclusion restores swipe-to-close from inside the
      // list without reintroducing the preventDefault that was the more
      // likely original cause.
      //
      // A touch starting on a button (or link, or anything else with its
      // own click behavior) *is* still excluded, on different grounds:
      // this listener is global, so every tap anywhere in the sidebar —
      // including on 工作区, 新会话, the row "…" menu — also primes a
      // potential drag. A real finger essentially never lands and lifts
      // at the exact same coordinate; a few px of incidental drift on an
      // ordinary tap was enough to cross DRAG_AXIS_LOCK_PX and
      // preventDefault the touchmove, which was enough for at least one
      // button (工作区's own dropdown trigger) to occasionally eat a tap
      // meant to close it (see the 2026-08-16 chat). Nothing here needs
      // a drag to start from on top of a button anyway — the drawer is
      // still just as draggable from the row's own padding, the header,
      // the footer, or any other blank space in the sidebar.
      // The button/link exclusion below has one deliberate hole: a touch
      // that starts in the left-edge strip (EDGE_SWIPE_ZONE_PX) while the
      // drawer is closed. There, the strip of screen under the finger is
      // the main content — the drawer itself is off-screen to the left —
      // so the exclusion's only real job (don't let a tap on a sidebar
      // button accidentally prime a drag) has nothing to protect, while
      // applying it would silently eat the most common way people try to
      // open the drawer: a swipe that begins against the screen's left
      // edge, which often lands on the header or a message row's
      // clickable bits first. Such a touch is allowed through to prime
      // the drag (an actual tap still works: nothing below preventDefaults
      // a tap, and settleSidebarDrag's axis-lock keeps it inert).
      const atEdge = event.clientX <= EDGE_SWIPE_ZONE_PX && !isSidebarOpen();
      if (event.target.closest('button, a, [role="button"], [role="menuitem"]') && !atEdge) return;
      dragStartX = event.clientX;
      dragStartY = event.clientY;
      dragAxis = null;
      dragHapticFired = false;
      const el = drawerEl();
      dragWidth = el ? el.getBoundingClientRect().width : 0;
      dragBaseX = isSidebarOpen() ? 0 : -dragWidth;
      dragCurrentX = dragBaseX;
      dragFromEdge = atEdge;
      if (dragFromEdge) document.addEventListener('touchmove', edgeSwipeGuard, { passive: false });
    },
    { passive: true }
  );

  // Passive pointermove: the drawer carries touch-action: pan-y
  // (mobile.css), so the browser owns vertical panning and horizontal
  // movement never reaches it as a native pan — no preventDefault is
  // needed and no non-passive listener blocks scroll frames (the jank
  // source when this used touch events and preventDefaulted).
  document.addEventListener(
    'pointermove',
    (event) => {
      if (!isMobile() || dragStartX === null || dragWidth === 0) return;
      const dx = event.clientX - dragStartX;
      const dy = event.clientY - dragStartY;
      if (dragAxis === null) {
        if (Math.abs(dx) < DRAG_AXIS_LOCK_PX && Math.abs(dy) < DRAG_AXIS_LOCK_PX) return;
        dragAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      }
      if (dragAxis !== 'x') return;
      // Committed horizontal drag: the browser's own scroll recognizer
      // (touch-action: pan-y on the sidebar) must not steal the gesture
      // mid-way — on iOS a slow swipe with slight vertical drift gets
      // claimed as a scroll and fires pointercancel, settling the drawer
      // while the finger is still moving ("手还在滑它自己回弹了"). A
      // non-passive touchmove preventDefault (same pattern as
      // edgeSwipeGuard) makes the recognizer back off for the rest of
      // the gesture. Armed only after the axis lock, so scroll frames
      // never wait on JS.
      if (!dragXGuardArmed) {
        dragXGuardArmed = true;
        document.addEventListener('touchmove', dragXGuard, { passive: false });
      }

      dragCurrentX = Math.max(-dragWidth, Math.min(0, dragBaseX + dx));
      setDragTransform(dragCurrentX);

      // One tick the instant this drag would flip the outcome from where
      // it started — a subtle "you've now dragged far enough" cue, same
      // idea as the haptic most native drawers give at their commit point.
      const wouldOpen = wouldCommitOpen(1 + dragCurrentX / dragWidth);
      const startedOpen = dragBaseX === 0;
      if (!dragHapticFired && wouldOpen !== startedOpen) {
        dragHapticFired = true;
        if (navigator.vibrate) navigator.vibrate(5);
      }
    },
    { passive: true }
  );

  // Kills iOS Safari's swipe-to-go-back on a drag that started in the
  // left-edge strip. touch-action: pan-y on body already tells the
  // browser horizontal panning isn't its job, but the back gesture is a
  // *navigation* gesture and doesn't consult touch-action — it engages on
  // ~25px of rightward travel and, once engaged, fires pointercancel,
  // aborting the drawer drag before the drawer has visibly moved (the
  // "swiping right from the left edge won't open the drawer" report).
  // preventDefault on the touchmove that first proves horizontal intent
  // is the reliable kill switch: it lands before Safari's engagement
  // threshold for any normal swipe, while a tap (no movement) and a
  // vertical scroll (vertical movement dominates) are never touched —
  // which is why this stays a touchmove guard rather than a touchstart
  // preventDefault, which would also have killed vertical scrolling of
  // the message list for any thumb that starts against the left edge.
  // Attached only for edge-start drags (see the pointerdown above) so the
  // compositor never waits on it for ordinary scrolls.
  function edgeSwipeGuard(event) {
    if (dragStartX === null || dragStartY === null) return;
    const touch = event.touches[0];
    if (!touch) return;
    const dx = touch.clientX - dragStartX;
    const dy = touch.clientY - dragStartY;
    if (Math.abs(dx) < DRAG_AXIS_LOCK_PX && Math.abs(dy) < DRAG_AXIS_LOCK_PX) return;
    if (Math.abs(dx) > Math.abs(dy)) event.preventDefault();
  }

  // The committed-horizontal counterpart of edgeSwipeGuard: once the
  // axis lock lands on 'x', every touchmove for the rest of the gesture
  // is preventDefaulted so the browser's scroll recognizer can't claim
  // the swipe and fire pointercancel mid-drag. See the pointermove
  // comment for the user-visible bug this prevents.
  function dragXGuard(event) {
    if (dragStartX === null || dragAxis !== 'x') return;
    event.preventDefault();
  }

  function settleSidebarDrag() {
    if (dragStartX === null) return;
    if (dragFromEdge) {
      document.removeEventListener('touchmove', edgeSwipeGuard);
      dragFromEdge = false;
    }
    if (dragXGuardArmed) {
      document.removeEventListener('touchmove', dragXGuard);
      dragXGuardArmed = false;
    }
    const wasDragging = dragAxis === 'x';
    dragStartX = null;
    dragStartY = null;
    dragAxis = null;
    if (!wasDragging || dragWidth === 0) return;

    // Freeze the drawer at exactly where the live drag (transform) left
    // it, now expressed as `left` instead — see settleAt's own comment
    // for why this has to happen before either class-toggle function
    // below, not after.
    settleAt(dragCurrentX);

    const openness = 1 + dragCurrentX / dragWidth;
    // Threshold commit (28%): dragging far enough flips the drawer,
    // otherwise it snaps back. pointercancel is settled the same way —
    // the dragXGuard above prevents the browser from cancelling a
    // committed horizontal drag in the first place, so a cancel that
    // does arrive is a genuine interruption and snapping back is right.
    const shouldOpen = wouldCommitOpen(openness);
    // mobile.css's own `left` transition on .pI_x6G_sidebarCol carries
    // the rest of the way from wherever the drag let go to fully open
    // or fully closed — a one-shot, browser-driven transition rather
    // than something this file drives frame by frame, so it doesn't
    // carry anywhere near the reflow cost the live drag itself would
    // have at that same frequency.
    if (shouldOpen) openSidebar();
    else closeSidebar();
    // settleAt's freeze is still holding `left` with !important at this
    // point — the class above changed, but can't visibly do anything
    // yet, since an inline !important always outranks one on a class
    // selector too. Releasing it now, with transition already back on
    // from settleAt, is what actually hands control to the class's own
    // !important rule and lets the browser animate to it.
    drawerEl()?.style.removeProperty('left');
  }

  document.addEventListener('pointerup', settleSidebarDrag, { passive: true });
  document.addEventListener('pointercancel', settleSidebarDrag, { passive: true });

  // dsh focuses the composer whenever a session becomes active — sensible
  // with a keyboard attached, but on a phone it pops the on-screen keyboard
  // up immediately on navigation, before there's any reason to type. Only
  // a focus that actually followed a real touch on the composer itself is
  // let through; anything else (a session switch, dsh's own post-navigation
  // autofocus) gets blurred straight back.
  //
  // Belt and suspenders: a capture-phase 'focus' listener is the standard
  // way to intercept this, but it's paired with a short poll of
  // document.activeElement rather than relying on that listener alone —
  // this environment's own tooling didn't reliably deliver 'focus'/'focusin'
  // to a document-level listener even for an explicit el.focus() call in
  // the same page (activeElement still updated correctly; the event just
  // never arrived), and there was no way to confirm from here whether real
  // phone browsers share that quirk or not. Polling activeElement doesn't
  // depend on the event firing at all, only on activeElement being
  // correct, which every engine guarantees — so it catches this regardless
  // of which explanation turns out to be right.
  // Keyboard suppression: dsh focuses the composer whenever a session
  // becomes active — sensible with a hardware keyboard, but on a phone it
  // pops the on-screen keyboard up right after every navigation, before
  // there's any reason to type. Earlier versions blurred the input, but
  // dsh's own re-render can refocus it right back (and the focus event
  // itself doesn't reliably arrive in every environment), leaving the
  // keyboard up anyway. The lock instead leans on a property that can't
  // be raced: for KEYBOARD_LOCK_MS after a navigation, the composer stays
  // readonly, and a readonly textarea never summons the iOS keyboard no
  // matter how often it gets focused. The instant the user actually taps
  // the composer, the lock is dropped so the keyboard comes up normally.
  const KEYBOARD_LOCK_MS = 1500;
  document.addEventListener(
    'touchstart',
    (event) => {
      const input = event.target.closest('.uV2eYG_input');
      if (!input) return;
      // The user wants to type — lift both locks (navigation and
      // post-send) right now so the keyboard comes up normally.
      lastSessionNavAt = 0;
      lastSendAt = 0;
      input.readOnly = false;
    },
    true
  );
  document.addEventListener(
    'focus',
    (event) => {
      if (!isMobile()) return;
      const el = event.target;
      if (!el.classList || !el.classList.contains('uV2eYG_input')) return;
      if (Date.now() - lastSessionNavAt < KEYBOARD_LOCK_MS) {
        el.readOnly = true;
        el.blur();
      }
    },
    true
  );
  setInterval(() => {
    if (!isMobile()) return;
    const input = document.querySelector('.uV2eYG_input');
    if (!input) return;
    const inNavLock = Date.now() - lastSessionNavAt < KEYBOARD_LOCK_MS;
    const inSendLock = Date.now() - lastSendAt < SEND_FOCUS_BLOCK_MS;
    if (inNavLock || inSendLock) {
      // Re-assert every tick: dsh may replace the textarea or reset its
      // properties on re-render, and the readonly is what actually keeps
      // the keyboard off — blur alone lost this race before.
      if (!input.readOnly) input.readOnly = true;
      if (document.activeElement === input) input.blur();
    } else if (input.readOnly) {
      input.readOnly = false;
    }
  }, 150);

  // ── Post-send focus lock: no keyboard right after 发送/停止 ────────
  // dsh programmatically refocuses the composer after a send (and after
  // stopping generation); on a phone that pops the keyboard the moment
  // the button is tapped — and blurring a beat later only made it flash
  // open-and-shut ("弹出来自己自动收回去 了"). Within SEND_FOCUS_BLOCK_MS
  // of a send/stop tap the composer is held readonly, so even if dsh
  // focuses it the keyboard physically can't appear (a readonly textarea
  // never summons the iOS keyboard — the same mechanism as the
  // navigation lock above). The moment the user actually taps the
  // composer the lock is dropped (see the touchstart handler). Other
  // flows that focus the composer outside this window — command menu,
  // model pickers — are untouched.
  const SEND_FOCUS_BLOCK_MS = 1500;
  let lastSendAt = 0;
  document.addEventListener(
    'focus',
    (event) => {
      if (!isMobile()) return;
      const el = event.target;
      if (!el.classList || !el.classList.contains('uV2eYG_input')) return;
      if (Date.now() - lastSendAt < SEND_FOCUS_BLOCK_MS) {
        el.readOnly = true;
        el.blur();
      }
    },
    true
  );

  // ---------------------------------------------------------------------
  // Voice-to-text composer input — an overlay pinned over the composer's
  // real <textarea> (.uV2eYG_input, inside the already-relative
  // .uV2eYG_grow). Press-and-hold the overlay to record, release to
  // upload to the gateway's local whisper.cpp endpoint; the transcribed
  // text fades into view on the overlay itself (while also being written
  // into the real textarea underneath), then the overlay hides and hands
  // control back to that textarea for the user to edit/send — never
  // auto-sends. Re-appears once the send button is used (dsh clears the
  // textarea on send), or on first load if the textarea starts empty.
  // See docs/superpowers/specs/2026-08-16-voice-to-text-composer-design.md
  // ---------------------------------------------------------------------

  const VOICE_OVERLAY_CLASS = 'ds-mobile-voice-overlay';
  const VOICE_STATE_CLASSES = [
    'ds-mobile-voice-recording',
    'ds-mobile-voice-busy',
    'ds-mobile-voice-done',
    'ds-mobile-voice-error',
  ];
  const VOICE_MIN_RECORDING_MS = 300;
  // One row of bars that lives in two shapes: at rest only the middle
  // VOICE_IDLE_SPAN*2+1 of them are grown (VOICE_IDLE_HEIGHTS — a
  // deliberate peak, since an even row of equal-ish bars read as flat
  // and lifeless); holding grows the whole row outward from the centre.
  // Odd count so there's a real middle bar to expand from. 21 bars, not
  // the earlier 41: every bar in recording mode runs its own infinite
  // scaleY animation on its own composited layer, and 41 concurrent
  // animated layers is exactly the sort of GPU pressure that reads as
  // stutter on a phone (the "转译过渡动画卡" report) — half the bars
  // still reads as a dense wave but costs half the compositor work.
  const VOICE_BAR_COUNT = 21;
  const VOICE_BAR_CENTER = 10;
  const VOICE_IDLE_SPAN = 2;
  const VOICE_IDLE_HEIGHTS = [10, 19, 28, 19, 10];
  // Per-bar variation for the expanded shape. A plain envelope alone
  // looks like a smooth hill rather than audio; this breaks it up while
  // staying repeatable (no Math.random, so the wave doesn't reshuffle
  // itself on every render).
  const VOICE_BAR_NOISE = [0.58, 0.92, 0.44, 0.78, 1, 0.62, 0.87, 0.48, 0.96, 0.7, 0.83, 0.52, 0.9, 0.66, 0.75];
  const VOICE_ERROR_DISPLAY_MS = 1500;
  // Upload/transcription budget. whisper.cpp transcribes longer
  // recordings slower than short ones; 20s was enough for a quick phrase
  // but aborted mid-transcription for anything longer (user report: "说
  // 的时间长一点就转译不出来"). 60s covers multi-sentence holds while
  // still failing fast on a genuinely stuck server.
  const VOICE_UPLOAD_TIMEOUT_MS = 60000;
  // One neutral copy change, no counter. The line this replaced said
  // "音频较长" at 8s, which guesses at a cause and often guesses wrong:
  // the slowest transcription is the FIRST one after the gateway has
  // released the whisper model, where the wait is model load and has
  // nothing to do with clip length (measured 1.49s cold against 0.59s
  // warm for the same audio). Telling someone who just spoke three words
  // that their clip is long reads as the app being confused.
  //
  // An elapsed-seconds counter was tried here too and removed: the panel
  // already has a moving progress bar saying the work is underway, and a
  // number ticking next to it turns waiting into watching a clock. The
  // user's word for it was 焦虑. Motion answers "is it alive"; a counter
  // answers "how much longer", which is a question this can't actually
  // answer — whisper reports no progress until it's done.
  const VOICE_WAIT_RETEXT_MS = 2500;
  // Below this, a touch is a tap (type manually); at or above, it's a
  // hold (start recording). ~150ms is roughly how long a normal tap
  // lasts; 200ms gives a little slack without making holds feel laggy.
  const VOICE_HOLD_THRESHOLD_MS = 200;
  // Slide up by this much while recording and releasing discards the
  // clip instead of transcribing it — same convention as most chat
  // apps' voice messages ("说一半不想说了/说错了想重说"). Distance, not
  // a specific direction of small jitter, so an ordinary unsteady hold
  // doesn't accidentally arm it.
  const VOICE_CANCEL_DISTANCE_PX = 60;

  let voiceStream = null;
  let voiceRecorder = null;
  let voiceChunks = [];
  let voiceRecordingStartedAt = 0;
  let voiceReleaseRequested = false;
  let voiceHoldTimer = null;
  let voiceHoldArmed = false;
  let voiceTouchStartY = 0;
  let voiceCancelArmed = false;
  let voiceWaitTimer = null;

  function getComposerGrow() {
    return document.querySelector('.uV2eYG_grow');
  }

  function getVoiceComposerInput() {
    return document.querySelector('.uV2eYG_input');
  }

  function getSendButton() {
    return document.querySelector('.uV2eYG_primary');
  }

  // Single place where state changes drive the wave's shape, so every
  // caller gets the right geometry without having to remember to also
  // reshape the bars. Busy/done/error all share the collapsed shape:
  // recording is over in all three, and what's on screen is the dots or
  // the text, not the wave.
  function setVoiceState(overlay, state) {
    overlay.classList.remove(...VOICE_STATE_CLASSES);
    if (state) overlay.classList.add(state);
    if (state === 'ds-mobile-voice-recording') applyVoiceWaveRecording(overlay);
    else if (state) applyVoiceWaveCollapse(overlay);
    else applyVoiceWaveIdle(overlay);
  }

  function isVoiceMidFlow(overlay) {
    return VOICE_STATE_CLASSES.some((cls) => overlay.classList.contains(cls));
  }

  // A tap (touch released before VOICE_HOLD_THRESHOLD_MS) means the user
  // wants to type, not talk — hide the overlay and hand focus to the
  // real textarea so the keyboard comes up. Called synchronously from
  // the touchend handler, which is what lets .focus() actually trigger
  // the keyboard on iOS/Android (a focus() call outside a user-gesture
  // callback is silently ignored by mobile browsers).
  function focusRealInputForTyping(overlay) {
    const input = getVoiceComposerInput();
    if (!input) return;
    overlay.classList.add('ds-mobile-voice-hidden');
    // The user tapped the voice control to type — that's a real intent
    // to use the keyboard, so lift the post-send lock (readonly would
    // otherwise swallow the focus without ever summoning it).
    lastSendAt = 0;
    input.readOnly = false;
    input.focus();
  }

  function showVoiceError(overlay, message) {
    const textLayer = overlay.querySelector('.ds-mobile-voice-text');
    textLayer.textContent = message;
    setVoiceState(overlay, 'ds-mobile-voice-error');
    setTimeout(() => {
      setVoiceState(overlay, null);
    }, VOICE_ERROR_DISPLAY_MS);
  }

  // Transcription wait panel — lives INSIDE the composer card (inserted
  // before the input strip), so the card itself grows upward while the
  // transcription runs and shrinks back when it lands: "输入框直接往上长,
  // 下面都成一个整体" (the card's bottom edge is pinned to the page bottom,
  // so extra height pushes the top edge up). No floating module, and no
  // "已转写 ✓" confirmation — the type-in animation simply takes over.
  // Visuals/timings borrowed from the bookkeeping app's processing sheet.
  function getComposerCard() {
    return document.querySelector('.uV2eYG_card');
  }

  function ensureVoiceWaitPanel() {
    const card = getComposerCard();
    if (!card) return null;
    let panel = card.querySelector('.ds-voice-wait-panel');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.className = 'ds-voice-wait-panel';
    const body = document.createElement('div');
    body.className = 'ds-voice-wait-body';
    const statusRow = document.createElement('div');
    statusRow.className = 'ds-voice-status-row';
    const shimmer = document.createElement('span');
    shimmer.className = 'ds-voice-shimmer';
    shimmer.textContent = '正在转写语音';
    const dots = document.createElement('span');
    dots.className = 'ds-voice-dots';
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('i');
      dot.textContent = '.';
      dots.appendChild(dot);
    }
    statusRow.appendChild(shimmer);
    statusRow.appendChild(dots);
    const track = document.createElement('div');
    track.className = 'ds-voice-track';
    const thumb = document.createElement('div');
    thumb.className = 'ds-voice-thumb';
    track.appendChild(thumb);
    body.appendChild(statusRow);
    body.appendChild(track);
    panel.appendChild(body);
    const scroll = card.querySelector('.uV2eYG_scroll');
    card.insertBefore(panel, scroll);
    // While the panel is visible it must swallow taps: the composer
    // card itself carries a click handler (onRequestWorkspace on the
    // hero), and a stray tap during transcription would otherwise open
    // a picker under the user's finger.
    ['touchstart', 'mousedown', 'click'].forEach((type) => {
      panel.addEventListener(
        type,
        (event) => {
          const overlay = ensureVoiceOverlay();
          if (overlay && isVoiceMidFlow(overlay)) {
            event.preventDefault();
            event.stopPropagation();
          }
        },
        true
      );
    });
    return panel;
  }

  function setVoiceWaitVisible(visible) {
    const card = getComposerCard();
    if (!card) return;
    card.classList.toggle('ds-voice-waiting', !!visible);
  }

  function setVoiceWaitLabel(label) {
    const card = getComposerCard();
    const shimmer = card && card.querySelector('.ds-voice-wait-panel .ds-voice-shimmer');
    if (shimmer) shimmer.textContent = label;
  }

  function applyVoiceAccentColor(overlay) {
    const sendBtn = getSendButton();
    if (!sendBtn) return;
    const accent = getComputedStyle(sendBtn).backgroundColor;
    if (accent) overlay.style.setProperty('--ds-voice-accent', accent);
  }

  // The three wave shapes. Each sets per-bar transition-delay as well as
  // the target geometry, because the staggering is the whole point — the
  // row grows outward from the middle and collapses back inward, rather
  // than every bar moving at once. CSS has no way to express "delay by
  // distance from centre", so the delays are computed here.
  function voiceWaveBars(overlay) {
    return overlay.querySelectorAll('.ds-mobile-voice-wave span');
  }

  function applyVoiceWaveIdle(overlay) {
    const accent = 'rgba(127, 127, 127, 0.42)';
    voiceWaveBars(overlay).forEach((bar, i) => {
      const offset = i - VOICE_BAR_CENTER;
      bar.style.transitionDelay = Math.abs(offset) * 4 + 'ms';
      bar.style.background = accent;
      if (Math.abs(offset) <= VOICE_IDLE_SPAN) {
        bar.style.opacity = '1';
        bar.style.height = VOICE_IDLE_HEIGHTS[offset + VOICE_IDLE_SPAN] + 'px';
        bar.style.animation = 'ds-voice-breathe 3.2s ease-in-out infinite';
        bar.style.animationDelay = (offset + VOICE_IDLE_SPAN) * 0.12 + 's';
      } else {
        // Outlier bars rest as short dim stubs instead of collapsing to
        // width:0 — visibility is opacity here (see the CSS transition
        // list), and animating opacity costs no layout, unlike width.
        bar.style.opacity = '0.35';
        bar.style.height = '6px';
        bar.style.animation = 'none';
      }
    });
  }

  function applyVoiceWaveRecording(overlay) {
    voiceWaveBars(overlay).forEach((bar, i) => {
      const distance = Math.abs(i - VOICE_BAR_CENTER);
      bar.style.transitionDelay = distance * 7 + 'ms';
      bar.style.height = bar.dataset.fullHeight + 'px';
      bar.style.background = 'var(--ds-voice-accent, #d85a30)';
      bar.style.opacity = '1';
      bar.style.animation = 'ds-voice-pulse 0.8s ease-in-out infinite';
      bar.style.animationDelay = distance * 0.045 + 's';
    });
  }

  function applyVoiceWaveCollapse(overlay) {
    voiceWaveBars(overlay).forEach((bar, i) => {
      // Reversed stagger: the outermost bars leave first, so the row
      // closes inward instead of unravelling from the middle. The bars
      // fade out (opacity) rather than animating width/margin to zero —
      // opacity transitions on the compositor, width/margin don't.
      bar.style.transitionDelay = (VOICE_BAR_CENTER - Math.abs(i - VOICE_BAR_CENTER)) * 5 + 'ms';
      bar.style.animation = 'none';
      bar.style.opacity = '0';
    });
  }

  function ensureVoiceOverlay() {
    if (!isMobile()) return null;
    const grow = getComposerGrow();
    if (!grow) return null;
    let overlay = grow.querySelector('.' + VOICE_OVERLAY_CLASS);
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.className = VOICE_OVERLAY_CLASS;
    // Second revision: this is the single hit-target again (not split
    // into a pointer-events:none wrapper + small inner pill — see the
    // note above bindVoiceOverlay for why that approach was replaced).
    overlay.setAttribute('role', 'button');
    overlay.setAttribute('aria-label', '轻点打字,按住说话');

    const wave = document.createElement('div');
    wave.className = 'ds-mobile-voice-wave';
    for (let i = 0; i < VOICE_BAR_COUNT; i++) {
      const bar = document.createElement('span');
      // Envelope (taller in the middle, tapering to the edges) times the
      // repeating noise above — the expanded height each bar animates to.
      const distance = Math.abs(i - VOICE_BAR_CENTER) / VOICE_BAR_CENTER;
      const envelope = 1 - distance * distance * 0.5;
      const noise = VOICE_BAR_NOISE[i % VOICE_BAR_NOISE.length];
      bar.dataset.fullHeight = String(Math.round(6 + 22 * envelope * noise));
      bar.style.height = bar.dataset.fullHeight + 'px';
      wave.appendChild(bar);
    }
    overlay.appendChild(wave);

    const busyDots = document.createElement('div');
    busyDots.className = 'ds-mobile-voice-busy-dots';
    busyDots.textContent = '···';
    overlay.appendChild(busyDots);

    const textLayer = document.createElement('div');
    textLayer.className = 'ds-mobile-voice-text';
    overlay.appendChild(textLayer);

    const input = getVoiceComposerInput();
    if (input && input.value) overlay.classList.add('ds-mobile-voice-hidden');

    grow.appendChild(overlay);
    // Bars are created at their expanded height with width:0; this is
    // what pulls them into the resting shape. Must run after the append
    // so the transition has a laid-out starting point to animate from.
    applyVoiceWaveIdle(overlay);
    return overlay;
  }

  // Write text into the composer's real textarea through the native value
  // setter, so React's controlled-input handler sees a real 'input' event
  // and keeps its draft state in sync (a plain value= assignment would be
  // overwritten by the next controlled re-render). Returns false when the
  // textarea isn't there. The voice overlay only ever appears over an
  // empty input, so this always overwrites rather than appends — and the
  // type-in animation calls it once per visible chunk.
  function fillComposerText(text) {
    const input = getVoiceComposerInput();
    if (!input) return false;
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    ).set;
    nativeSetter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  // Whisper emits CJK text with a space between every character ("你 好 世
  // 界") and one line per pause segment; neither belongs in the composer.
  // Collapse all whitespace to single spaces first (which also flattens
  // the multi-line segments into one paragraph), then drop the spaces
  // between CJK characters — English word spacing survives untouched.
  function cleanSttText(text) {
    return text
      .replace(/\s+/g, ' ')
      .replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, '$1')
      .trim();
  }

  // Type the transcription into the composer one character at a time —
  // the "交互动画" the user asked for ("慢而明显, 2~4 秒"): per-character
  // gaps follow an accelerating exponential curve, from ~240-310ms on
  // the first character down to a ~16ms floor, with the total runtime
  // scaled to the text length (short sentences ≈1.6s, a long paragraph
  // ≈3.5s). Every chunk goes through the native setter + input event so
  // dsh's draft stays live, and when the last character lands the
  // composer holds the complete final text — the one and only state,
  // with no second copy ever shown (previously the overlay flashed the
  // raw transcription, then swapped to the textarea 900ms later: the
  // "出现一下→格式很奇怪→再变化" report). Interruptible: tapping the input
  // (wants to edit) or the send button (wants to send now) aborts to
  // the full text instantly — see abortVoiceTypingToFull.
  const VOICE_TYPE_MIN_DELAY_MS = 16;
  const VOICE_TYPE_DECAY = 0.9;
  // Total animation time for a text of charCount characters, clamped to
  // the 1.6-3.8s range the user picked.
  const VOICE_TYPE_TOTAL_MS = (charCount) =>
    Math.max(1600, Math.min(3800, 900 + 55 * charCount));
  // Per-gap delays whose sum is exactly the target total: normalized
  // exponential weights (decay^i), so early gaps are wide and later
  // ones shrink — "开头慢, 后面巴啦啦变快". The floor keeps the tail from
  // out-running React's per-input render.
  function voiceTypeDelays(charCount) {
    let weightSum = 0;
    const weights = [];
    for (let i = 0; i < charCount; i++) {
      const w = Math.pow(VOICE_TYPE_DECAY, i);
      weights.push(w);
      weightSum += w;
    }
    const total = VOICE_TYPE_TOTAL_MS(charCount);
    return weights.map((w) => Math.max(VOICE_TYPE_MIN_DELAY_MS, (total * w) / weightSum));
  }
  let voiceTypingTimer = null;
  let voiceTypingChars = null;
  let voiceTypingIndex = 0;

  function isVoiceTyping() {
    return voiceTypingChars !== null;
  }

  function finishVoiceTyping() {
    if (voiceTypingTimer !== null) {
      clearTimeout(voiceTypingTimer);
      voiceTypingTimer = null;
    }
    voiceTypingChars = null;
    voiceTypingIndex = 0;
  }

  // Stop the animation and put the complete text in the composer in one
  // step. Used when the user taps the input to edit or hits send mid-
  // animation — sending must never fire with a half-typed sentence, and
  // editing a live-typing textarea is hopeless.
  function abortVoiceTypingToFull() {
    if (!isVoiceTyping()) return;
    const full = voiceTypingChars.join('');
    finishVoiceTyping();
    fillComposerText(full);
  }

  function typeVoiceTextIntoComposer(text) {
    finishVoiceTyping();
    const chars = Array.from(text);
    if (chars.length === 0) return;
    const delays = voiceTypeDelays(chars.length);
    voiceTypingChars = chars;
    voiceTypingIndex = 0;
    const tick = () => {
      voiceTypingIndex++;
      fillComposerText(chars.slice(0, voiceTypingIndex).join(''));
      if (voiceTypingIndex >= chars.length) {
        finishVoiceTyping();
        return;
      }
      voiceTypingTimer = setTimeout(tick, delays[voiceTypingIndex - 1]);
    };
    tick();
  }

  // Interrupts: capture-phase, so they run before dsh's own handlers. A
  // tap on the composer (user reaching for the keyboard) or on the send
  // button (user wants to send now) stops the animation and jumps to the
  // full text; dsh's own send handler then reads the complete draft as
  // usual. touchstart/mousedown cover every platform and fire earlier
  // than focus/click; focus and the send-button click stay as
  // belt-and-suspenders (keyboard-summoned focus, non-pointer clicks).
  const abortOnVoiceComposerTap = (event) => {
    if (!isMobile() || !isVoiceTyping()) return;
    if (event.target.closest('.uV2eYG_input') || event.target.closest('.uV2eYG_primary')) {
      abortVoiceTypingToFull();
    }
  };
  document.addEventListener('touchstart', abortOnVoiceComposerTap, true);
  document.addEventListener('mousedown', abortOnVoiceComposerTap, true);
  document.addEventListener(
    'focus',
    (event) => {
      if (!isMobile() || !isVoiceTyping()) return;
      const el = event.target;
      if (el.classList && el.classList.contains('uV2eYG_input')) abortVoiceTypingToFull();
    },
    true
  );
  document.addEventListener(
    'click',
    (event) => {
      if (!isMobile() || !isVoiceTyping()) return;
      if (event.target.closest('.uV2eYG_primary')) abortVoiceTypingToFull();
    },
    true
  );

  async function startVoiceRecording(overlay) {
    if (voiceRecorder || isVoiceMidFlow(overlay)) return;
    voiceReleaseRequested = false;
    applyVoiceAccentColor(overlay);
    // Expand the wave the moment the hold registers, before asking for
    // the mic — getUserMedia can take a while to settle (a permission
    // sheet on first use, tens to hundreds of ms even once granted), and
    // waiting for it left the finger down with nothing happening on
    // screen. The recording state is entered optimistically here and
    // walked back below if the mic never arrives.
    setVoiceState(overlay, 'ds-mobile-voice-recording');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      showVoiceError(overlay, '没有麦克风权限,请去设置里开启');
      return;
    }
    if (voiceReleaseRequested) {
      stream.getTracks().forEach((track) => track.stop());
      voiceReleaseRequested = false;
      setVoiceState(overlay, null);
      return;
    }
    voiceStream = stream;
    voiceChunks = [];
    voiceRecordingStartedAt = Date.now();
    voiceRecorder = new MediaRecorder(voiceStream);
    voiceRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) voiceChunks.push(event.data);
    };
    voiceRecorder.start();
    // No setVoiceState here — the recording state was already entered
    // optimistically above; re-applying it would restart the wave
    // animation mid-gesture.
  }

  function stopVoiceRecording(overlay) {
    if (!voiceRecorder) {
      voiceReleaseRequested = true;
      // Released while the mic request was still pending. Pull the wave
      // back so it doesn't sit expanded with nothing recording — but
      // only from the optimistic recording state, never over an error
      // message that already replaced it (that would blank the message
      // the moment the finger lifts, before it could be read).
      if (overlay.classList.contains('ds-mobile-voice-recording')) {
        setVoiceState(overlay, null);
      }
      return;
    }
    const recordedMs = Date.now() - voiceRecordingStartedAt;
    const recorder = voiceRecorder;
    voiceRecorder = null;

    recorder.addEventListener('stop', () => {
      if (voiceStream) {
        voiceStream.getTracks().forEach((track) => track.stop());
        voiceStream = null;
      }
      if (recordedMs < VOICE_MIN_RECORDING_MS) {
        setVoiceState(overlay, null);
        return;
      }
      const blob = new Blob(voiceChunks, { type: recorder.mimeType });
      uploadVoiceRecording(blob, overlay);
    });
    recorder.stop();
  }

  // Same shutdown as stopVoiceRecording (release the mic, walk back a
  // still-pending permission request) but the recorder's own 'stop'
  // handler never builds a blob or uploads — the whole point is that a
  // slide-up release discards the clip.
  function cancelVoiceRecording(overlay) {
    voiceCancelArmed = false;
    overlay.classList.remove('ds-mobile-voice-cancel-armed');
    if (!voiceRecorder) {
      voiceReleaseRequested = true;
      if (overlay.classList.contains('ds-mobile-voice-recording')) {
        setVoiceState(overlay, null);
      }
      return;
    }
    const recorder = voiceRecorder;
    voiceRecorder = null;
    recorder.addEventListener('stop', () => {
      if (voiceStream) {
        voiceStream.getTracks().forEach((track) => track.stop());
        voiceStream = null;
      }
      setVoiceState(overlay, null);
    });
    recorder.stop();
  }

  async function uploadVoiceRecording(blob, overlay) {
    setVoiceState(overlay, 'ds-mobile-voice-busy');
    // The composer card grows a wait panel above the input strip for
    // the duration of the transcription.
    ensureVoiceWaitPanel();
    setVoiceWaitVisible(true);
    setVoiceWaitLabel('正在转写语音');
    // One copy change, no counter — see the constants above.
    clearTimeout(voiceWaitTimer);
    voiceWaitTimer = setTimeout(() => {
      setVoiceWaitLabel('还在转写');
    }, VOICE_WAIT_RETEXT_MS);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), VOICE_UPLOAD_TIMEOUT_MS);
    try {
      const res = await fetch('/__ds_theme/stt', { method: 'POST', body: blob, signal: controller.signal });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (data && data.text) {
        // The card shrinks back and the type-in animation takes over in
        // the composer — no separate confirmation state (the user
        // rejected the "已转写 ✓" step: the char-by-char reveal IS the
        // feedback). The composer's text is the final text the whole
        // way through; nothing changes after the animation settles.
        const text = cleanSttText(data.text);
        clearTimeout(voiceWaitTimer);
        setVoiceWaitVisible(false);
        overlay.classList.add('ds-mobile-voice-hidden');
        setVoiceState(overlay, null);
        typeVoiceTextIntoComposer(text);
      } else {
        clearTimeout(voiceWaitTimer);
        setVoiceWaitVisible(false);
        showVoiceError(overlay, '没听清,再试一次');
      }
    } catch {
      clearTimeout(voiceWaitTimer);
      setVoiceWaitVisible(false);
      clearTimeout(timeoutId);
      showVoiceError(overlay, '识别失败,请重试');
    }
  }

  function recallVoiceOverlayAfterSend() {
    const overlay = ensureVoiceOverlay();
    if (!overlay || isVoiceMidFlow(overlay)) return;
    overlay.classList.remove('ds-mobile-voice-hidden');
    setVoiceState(overlay, null);
  }

  // Second revision: the first attempt made the overlay pointer-events:none
  // with only a small inner "hit" pill actually tappable, so taps outside
  // that pill would pass through to the real textarea. That fixed "can't
  // reach the input at all" but required aiming at a small target to type
  // — user feedback was that a tap ANYWHERE on the composer should focus
  // the real input (keyboard comes up), while a press-and-hold ANYWHERE
  // starts recording, same as a lot of chat apps do it. That can't be done
  // with pointer-events/positioning alone since both gestures start at the
  // same point — it has to be timing-based: touchstart arms a timer, and
  // whether touchend fires before or after that timer decides tap vs hold.
  function bindVoiceOverlay() {
    const overlay = ensureVoiceOverlay();
    if (!overlay || overlay.dataset.dsBound) return;
    overlay.dataset.dsBound = '1';
    overlay.addEventListener(
      'touchstart',
      (event) => {
        if (isVoiceMidFlow(overlay)) return;
        voiceHoldArmed = false;
        voiceCancelArmed = false;
        voiceTouchStartY = event.touches[0].clientY;
        clearTimeout(voiceHoldTimer);
        voiceHoldTimer = setTimeout(() => {
          voiceHoldTimer = null;
          // Set BEFORE calling startVoiceRecording, not after — its
          // getUserMedia await means the CSS recording state lags behind
          // by however long the permission prompt takes, so this flag
          // (not a class check) is what touchend relies on to know a
          // hold actually happened, even during that pending window.
          voiceHoldArmed = true;
          startVoiceRecording(overlay);
        }, VOICE_HOLD_THRESHOLD_MS);
      },
      { passive: true }
    );
    // Only meaningful once a hold is armed (mid-recording) — during the
    // tap-detection window a small drift shouldn't do anything, and once
    // idle/busy/done/error there's no active gesture to redirect.
    overlay.addEventListener(
      'touchmove',
      (event) => {
        if (!voiceHoldArmed) return;
        const deltaY = event.touches[0].clientY - voiceTouchStartY;
        const shouldArm = deltaY < -VOICE_CANCEL_DISTANCE_PX;
        if (shouldArm === voiceCancelArmed) return;
        voiceCancelArmed = shouldArm;
        overlay.classList.toggle('ds-mobile-voice-cancel-armed', shouldArm);
        if (shouldArm) {
          overlay.querySelector('.ds-mobile-voice-text').textContent = '松开取消';
        }
      },
      { passive: true }
    );
    overlay.addEventListener('touchend', (event) => {
      if (voiceHoldTimer) {
        // Released before the hold threshold — a tap, not a hold.
        clearTimeout(voiceHoldTimer);
        voiceHoldTimer = null;
        focusRealInputForTyping(overlay);
        return;
      }
      if (!voiceHoldArmed) return; // touchstart was ignored (isVoiceMidFlow) — nothing to stop
      voiceHoldArmed = false;
      event.preventDefault();
      if (voiceCancelArmed) {
        cancelVoiceRecording(overlay);
        return;
      }
      // Unconditional — even if voiceRecorder is still null because
      // getUserMedia's permission prompt hasn't resolved yet, this needs
      // to reach stopVoiceRecording so it can set voiceReleaseRequested
      // and prevent the recording from starting late with no matching
      // touchend left to stop it.
      stopVoiceRecording(overlay);
    });
  }

  function bindSendButtonForVoiceRecall() {
    if (document.documentElement.dataset.dsVoiceRecallDelegated) return;
    document.documentElement.dataset.dsVoiceRecallDelegated = '1';
    // Delegated on document (capture) so a dsh re-render that replaces
    // the button element can't orphan the handler.
    document.addEventListener(
      'click',
      (event) => {
        if (!isMobile()) return;
        if (!event.target.closest('.uV2eYG_primary')) return;
        // Same primary slot serves both 发送 and 停止 — either one arms
        // the post-send focus lock (readonly for SEND_FOCUS_BLOCK_MS)
        // and recalls the overlay to its idle wave.
        lastSendAt = Date.now();
        // Flip readOnly here, in the capture phase, instead of leaving it
        // to the focus listener and the 150ms poll further up. Capture
        // runs before dsh's own click handler, so the textarea is already
        // readonly by the time dsh does whatever it does to put focus back
        // on the composer. That ordering is the whole game on iOS: the
        // keyboard is raised at the moment focus lands on an editable
        // field, and turning readonly on *after* focus has already landed
        // does not put an open keyboard away again. All three earlier
        // attempts armed the lock strictly after focus — first a delayed
        // blur ("弹出来又自动收回"), then a focus-event guard, then this
        // same readonly lock but set from the focus listener — which is
        // consistent with the keyboard still appearing on a real phone
        // while every Electron check passed. See
        // docs/KEYBOARD-HANDOFF-2026-08-17.md for the full history.
        const composer = getVoiceComposerInput();
        if (composer) composer.readOnly = true;
        setTimeout(recallVoiceOverlayAfterSend, 400);
      },
      true
    );
  }

  // Recovery safety net: the recall above only fires on the send BUTTON's
  // click — sending via the iOS keyboard's return/go key (or Enter) never
  // touches that button, so the overlay stayed hidden forever after the
  // first typed or voice send (user report: "发言一次/打字之后就不出现
  // 语音了"). dsh clears the textarea on every successful send regardless
  // of how it was sent, so an empty input with a hidden overlay is the
  // reliable signal to bring the voice control back. Runs on the same 1s
  // poll as the other voice bindings.
  function recallVoiceOverlayWhenInputEmpty() {
    const overlay = ensureVoiceOverlay();
    if (!overlay || isVoiceMidFlow(overlay)) return;
    if (!overlay.classList.contains('ds-mobile-voice-hidden')) return;
    const input = getVoiceComposerInput();
    // Only recall when the input is both empty AND not focused: right
    // after a tap-to-type, the overlay is hidden but the input is still
    // empty and focused — recalling then would pop the wave back over
    // the keyboard just as the user starts typing (which also re-armed
    // the backdrop-transparent rule, so typed text was invisible while
    // the caret blinked — user report).
    if (input && !input.value && document.activeElement !== input) {
      overlay.classList.remove('ds-mobile-voice-hidden');
      setVoiceState(overlay, null);
    }
  }

  setInterval(() => {
    if (!isMobile()) return;
    bindVoiceOverlay();
    bindSendButtonForVoiceRecall();
    recallVoiceOverlayWhenInputEmpty();
  }, 1000);

  // Debug/test hook: lets the Electron harness drive the type-in
  // animation with canned text (the real flow needs a microphone). Never
  // referenced by the UI; harmless in production.
  window.__dsVoiceDebug = {
    cleanSttText,
    typeVoiceTextIntoComposer,
    abortVoiceTypingToFull,
    isVoiceTyping,
    ensureVoiceWaitPanel,
    setVoiceWaitVisible,
    setVoiceWaitLabel,
  };

})();
