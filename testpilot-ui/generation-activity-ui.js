(function () {
  if (window.__testNexusGenerationActivityUi) return;
  window.__testNexusGenerationActivityUi = true;

  function ensureStyles() {
    if (document.getElementById('testNexusGenerationActivityStyles')) return;
    const style = document.createElement('style');
    style.id = 'testNexusGenerationActivityStyles';
    style.textContent = `
      .human-note{display:none!important}
      .ai-generation-status{display:none;align-items:center;gap:7px;margin-top:7px;color:#3155c8;font-size:10.5px;font-weight:800}
      body.generation-active .ai-generation-status{display:inline-flex}
      .ai-generation-pulse{position:relative;width:9px;height:9px;border-radius:50%;background:#2f5bff;box-shadow:0 0 0 0 rgba(47,91,255,.34);animation:testNexusAiPulse 1.1s ease-out infinite}
      .ai-generation-dots{display:inline-flex;gap:2px;margin-left:1px}
      .ai-generation-dots i{display:block;width:3px;height:3px;border-radius:50%;background:#3155c8;animation:testNexusAiDot 1.1s ease-in-out infinite}
      .ai-generation-dots i:nth-child(2){animation-delay:.15s}.ai-generation-dots i:nth-child(3){animation-delay:.3s}
      .test-case-serial{display:inline-grid;place-items:center;min-width:23px;height:23px;margin-right:7px;padding:0 6px;border-radius:7px;background:#eef2ff;color:#3155c8;font-size:10px;font-weight:900;vertical-align:middle}
      .generation-case-preview-title .test-case-serial{height:20px;min-width:20px;border-radius:6px;font-size:9px}
      @keyframes testNexusAiPulse{0%{box-shadow:0 0 0 0 rgba(47,91,255,.35)}70%{box-shadow:0 0 0 7px rgba(47,91,255,0)}100%{box-shadow:0 0 0 0 rgba(47,91,255,0)}}
      @keyframes testNexusAiDot{0%,80%,100%{opacity:.3;transform:translateY(0)}40%{opacity:1;transform:translateY(-2px)}}
    `;
    document.head.appendChild(style);
  }

  function removeHumanBanner() {
    document.querySelectorAll('.human-note').forEach((node) => node.remove());
  }

  function ensureActivityIndicator() {
    const subtitle = document.getElementById('caseSubtitle');
    if (!subtitle) return null;
    let indicator = document.getElementById('aiGenerationActivity');
    if (indicator) return indicator;
    indicator = document.createElement('div');
    indicator.id = 'aiGenerationActivity';
    indicator.className = 'ai-generation-status';
    indicator.setAttribute('role', 'status');
    indicator.setAttribute('aria-live', 'polite');
    indicator.innerHTML = '<span class="ai-generation-pulse" aria-hidden="true"></span><span>AI is working</span><span class="ai-generation-dots" aria-hidden="true"><i></i><i></i><i></i></span>';
    subtitle.insertAdjacentElement('afterend', indicator);
    return indicator;
  }

  function decorateSerialNumbers() {
    const container = document.getElementById('cases');
    if (!container) return;
    const cards = [...container.querySelectorAll('.case, .generation-case-preview')];
    cards.forEach((card, index) => {
      const title = card.querySelector('.case-title, .generation-case-preview-title');
      if (!title) return;
      const value = String(index + 1);
      let serial = title.querySelector(':scope > .test-case-serial');
      if (!serial) {
        serial = document.createElement('span');
        serial.className = 'test-case-serial';
        serial.textContent = value;
        serial.setAttribute('aria-label', `Test ${value}`);
        title.prepend(serial);
      } else if (serial.textContent !== value) {
        serial.textContent = value;
        serial.setAttribute('aria-label', `Test ${value}`);
      }
      if (card.dataset.testSerial !== value) card.dataset.testSerial = value;
    });
  }

  function install() {
    ensureStyles();
    removeHumanBanner();
    ensureActivityIndicator();
    decorateSerialNumbers();

    const cases = document.getElementById('cases');
    if (cases && !cases.__testNexusSerialObserver) {
      const observer = new MutationObserver(() => decorateSerialNumbers());
      observer.observe(cases, { childList: true, subtree: true });
      cases.__testNexusSerialObserver = observer;
    }

    if (document.body && !document.body.__testNexusActivityObserver) {
      const observer = new MutationObserver(() => {
        removeHumanBanner();
        ensureActivityIndicator();
      });
      observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
      document.body.__testNexusActivityObserver = observer;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
