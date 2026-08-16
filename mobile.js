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

  function init() {
    if (!isMobile()) return;
    ensureDshExpanded();
    observeDshCollapseState();
    hideDisabledSettingsNavTabs();
    hideSettingsAgentPresetRow();
    stripDeepSeekPrefix();
    observeModelLabel();
    syncTrajectoryTabStrip();
    relocateContextRing();
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
    syncSettingsPanelHeight();
    stripDeepSeekPrefix();
    observeModelLabel();
    syncTrajectoryTabStrip();
    relocateContextRing();
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

  // ── Workspace picker: the menu can overlap its trigger ──────────────
  // dsh's workspace picker opens in a menu positioned a few px below its
  // trigger (.pXSMma_workspace). On a phone the gap is small enough that
  // real layouts land the menu ON the button — measured 4px of clearance
  // in one viewport, and any safe-area/scroll drift can close it — so the
  // second tap hits the menu, not the button, and the picker never toggles
  // closed; only tapping another workspace or outside dismisses it (user
  // report). Intercepting a touch on the button's rectangle while a menu
  // is open and replaying the button's own click closes it
  // deterministically: pointerdown's preventDefault suppresses the
  // browser's synthetic click, so dsh's toggle runs exactly once (ours),
  // and the case where the button was cleanly visible behaves identically
  // to dsh's own handler.
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!isMobile()) return;
      if (!document.querySelector('[role="menu"]')) return;
      const btn = document.querySelector('.pXSMma_workspace');
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) return;
      event.preventDefault();
      event.stopPropagation();
      // Close the picker two ways so it closes no matter which listener
      // dsh's current build hangs off the button:
      //  1. Replay the button's own click (the earlier fix relied on this
      //     alone; a dsh re-render can desync its open-state, making the
      //     click a no-op re-open instead of a toggle — user report of
      //     "再按一下收不回去了").
      //  2. Dispatch an outside-pointerdown at the body: dsh's click-
      //     outside handler treats any pointerdown outside the menu as
      //     "dismiss", which is state-independent and always wins.
      btn.click();
      // Coordinates OUTSIDE the button's rect: this dispatched
      // pointerdown must not re-enter this same interceptor (it checks
      // the button's rect), or it would recurse forever.
      document.body.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: Math.max(0, r.left - 24), clientY: r.top + 4 })
      );
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
  let dragStartX = null;
  let dragStartY = null;
  let dragAxis = null; // null (undecided) | 'x' | 'y'
  let dragWidth = 0;
  let dragBaseX = 0; // translateX at gesture start: 0 if starting open, -dragWidth if starting closed
  let dragCurrentX = 0;
  let dragHapticFired = false;

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
      if (event.target.closest('button, a, [role="button"], [role="menuitem"]')) return;
      dragStartX = event.clientX;
      dragStartY = event.clientY;
      dragAxis = null;
      dragHapticFired = false;
      const el = drawerEl();
      dragWidth = el ? el.getBoundingClientRect().width : 0;
      dragBaseX = isSidebarOpen() ? 0 : -dragWidth;
      dragCurrentX = dragBaseX;
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

  function settleSidebarDrag() {
    if (dragStartX === null) return;
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
      // The user wants to type — lift the navigation lock right now.
      lastSessionNavAt = 0;
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
    const inLock = Date.now() - lastSessionNavAt < KEYBOARD_LOCK_MS;
    if (inLock) {
      // Re-assert every tick: dsh may replace the textarea or reset its
      // properties on re-render, and the readonly is what actually keeps
      // the keyboard off — blur alone lost this race before.
      if (!input.readOnly) input.readOnly = true;
      if (document.activeElement === input) input.blur();
    } else if (input.readOnly) {
      input.readOnly = false;
    }
  }, 150);

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
  const VOICE_DONE_DISPLAY_MS = 900;
  const VOICE_ERROR_DISPLAY_MS = 1500;
  // Upload/transcription budget. whisper.cpp transcribes longer
  // recordings slower than short ones; 20s was enough for a quick phrase
  // but aborted mid-transcription for anything longer (user report: "说
  // 的时间长一点就转译不出来"). 60s covers multi-sentence holds while
  // still failing fast on a genuinely stuck server.
  const VOICE_UPLOAD_TIMEOUT_MS = 60000;
  // Below this, a touch is a tap (type manually); at or above, it's a
  // hold (start recording). ~150ms is roughly how long a normal tap
  // lasts; 200ms gives a little slack without making holds feel laggy.
  const VOICE_HOLD_THRESHOLD_MS = 200;

  let voiceStream = null;
  let voiceRecorder = null;
  let voiceChunks = [];
  let voiceRecordingStartedAt = 0;
  let voiceReleaseRequested = false;
  let voiceHoldTimer = null;
  let voiceHoldArmed = false;

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

  function fillComposerText(text) {
    const input = getVoiceComposerInput();
    if (!input || !text) return;
    const existing = input.value || '';
    const combined = existing ? existing + text : text;
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    ).set;
    nativeSetter.call(input, combined);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

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

  async function uploadVoiceRecording(blob, overlay) {
    setVoiceState(overlay, 'ds-mobile-voice-busy');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), VOICE_UPLOAD_TIMEOUT_MS);
    try {
      const res = await fetch('/__ds_theme/stt', { method: 'POST', body: blob, signal: controller.signal });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (data && data.text) {
        const textLayer = overlay.querySelector('.ds-mobile-voice-text');
        textLayer.textContent = data.text;
        setVoiceState(overlay, 'ds-mobile-voice-done');
        fillComposerText(data.text);
        setTimeout(() => {
          overlay.classList.add('ds-mobile-voice-hidden');
          setVoiceState(overlay, null);
        }, VOICE_DONE_DISPLAY_MS);
      } else {
        showVoiceError(overlay, '没听清,再试一次');
      }
    } catch {
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
      () => {
        if (isVoiceMidFlow(overlay)) return;
        voiceHoldArmed = false;
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
      // Unconditional — even if voiceRecorder is still null because
      // getUserMedia's permission prompt hasn't resolved yet, this needs
      // to reach stopVoiceRecording so it can set voiceReleaseRequested
      // and prevent the recording from starting late with no matching
      // touchend left to stop it.
      stopVoiceRecording(overlay);
    });
  }

  function bindSendButtonForVoiceRecall() {
    const sendBtn = getSendButton();
    if (!sendBtn || sendBtn.dataset.dsVoiceRecallBound) return;
    sendBtn.dataset.dsVoiceRecallBound = '1';
    sendBtn.addEventListener('click', () => {
      setTimeout(recallVoiceOverlayAfterSend, 400);
    });
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
})();
