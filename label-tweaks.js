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

  function applyTweaks() {
    shortenModelLabel();
    tagComposerCard();
  }

  applyTweaks();
  var observer = new MutationObserver(applyTweaks);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
})();
