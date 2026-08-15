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
    stripDeepSeekPrefix();
    observeModelLabel();
  }

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
    stripDeepSeekPrefix();
    observeModelLabel();
  }, 2000);

  // Settings dialog is a portal mounted fresh each time its trigger is
  // tapped, so the 2s poll above could leave the 模型/Agent 预设 tabs
  // visible for up to 2s right after opening — catching the trigger tap
  // itself and re-checking shortly after (dialog needs a moment to
  // mount) closes that gap without lowering the poll interval everywhere
  // else that doesn't need it.
  document.addEventListener(
    'click',
    (event) => {
      if (!isMobile() || !event.target.closest('.VOzbGW_trigger')) return;
      setTimeout(hideDisabledSettingsNavTabs, 50);
    },
    true
  );

  // Tapping the dimmed main content used to close the drawer via a click
  // listener on a visible backdrop element; the backdrop itself is gone
  // (dropped per request — the shadow it cast over the main page read as
  // unwanted extra chrome, not a helpful dimming cue), but tapping outside
  // the drawer to close it is still the expected gesture, so this keeps
  // that behavior without anything visible backing it.
  document.addEventListener(
    'click',
    (event) => {
      if (!isMobile() || !isSidebarOpen()) return;
      if (event.target.closest('.pI_x6G_sidebarCol')) return;
      closeSidebar();
    },
    true
  );

  // Selecting a session (or starting a new one) should feel like
  // navigating, not "change the active chat but leave the list covering
  // it" — auto-close on tap so the conversation is what's left on screen,
  // matching what plain in-app navigation would do. An earlier version
  // only matched .YDXeBa_sessionRow, so the main content did navigate on
  // "新会话" but the drawer itself was left sitting open over it.
  document.addEventListener(
    'click',
    (event) => {
      if (!isMobile()) return;
      const row = event.target.closest('.YDXeBa_sessionRow');
      const newSessionBtn = event.target.closest('.hHd-Xa_newSession');
      if (!row && !newSessionBtn) return;
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
  function settleAt(px) {
    const el = drawerEl();
    if (!el) return;
    el.style.transition = 'none';
    el.style.left = `${px}px`;
    void el.offsetHeight;
    el.style.transform = '';
    void el.offsetHeight;
    el.style.transition = '';
  }

  document.addEventListener(
    'touchstart',
    (event) => {
      if (!isMobile() || event.touches.length !== 1) return;
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
      const touch = event.touches[0];
      dragStartX = touch.clientX;
      dragStartY = touch.clientY;
      dragAxis = null;
      dragHapticFired = false;
      const el = drawerEl();
      dragWidth = el ? el.getBoundingClientRect().width : 0;
      dragBaseX = isSidebarOpen() ? 0 : -dragWidth;
      dragCurrentX = dragBaseX;
    },
    { passive: true }
  );

  // Not passive: once a drag is confirmed horizontal, its native scroll/pan
  // needs suppressing for the rest of the gesture (see the long comment
  // this used to carry, now above setDragTransform) — touch-action: pan-y
  // in mobile.css declares the same thing up front, this is the enforcement.
  document.addEventListener(
    'touchmove',
    (event) => {
      if (!isMobile() || dragStartX === null || dragWidth === 0) return;
      const touch = event.touches[0];
      const dx = touch.clientX - dragStartX;
      const dy = touch.clientY - dragStartY;
      if (dragAxis === null) {
        if (Math.abs(dx) < DRAG_AXIS_LOCK_PX && Math.abs(dy) < DRAG_AXIS_LOCK_PX) return;
        dragAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      }
      if (dragAxis !== 'x') return;
      event.preventDefault();

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
    { passive: false }
  );

  document.addEventListener(
    'touchend',
    () => {
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
    },
    { passive: true }
  );

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
  let composerTouched = false;
  let composerTouchedResetTimer = null;
  document.addEventListener(
    'touchstart',
    (event) => {
      if (!event.target.closest('.uV2eYG_input')) return;
      composerTouched = true;
      clearTimeout(composerTouchedResetTimer);
      composerTouchedResetTimer = setTimeout(() => {
        composerTouched = false;
      }, 500);
    },
    true
  );
  document.addEventListener(
    'focus',
    (event) => {
      if (!isMobile()) return;
      if (event.target.classList && event.target.classList.contains('uV2eYG_input') && !composerTouched) {
        event.target.blur();
      }
    },
    true
  );
  setInterval(() => {
    if (!isMobile() || composerTouched) return;
    const active = document.activeElement;
    if (active && active.classList && active.classList.contains('uV2eYG_input')) {
      active.blur();
    }
  }, 150);
})();
