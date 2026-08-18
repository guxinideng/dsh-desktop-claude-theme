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

  function applyTweaks() {
    shortenModelLabel();
    tagComposerCard();
    tidyModelMenu();
  }

  applyTweaks();
  var observer = new MutationObserver(applyTweaks);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
})();
