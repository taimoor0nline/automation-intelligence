(function () {
  function applyBranding() {
    document.title = 'TestNexus AI';
    const brandStrong = document.querySelector('.brand strong');
    if (brandStrong) brandStrong.textContent = 'TestNexus AI';
    const brandSubtitle = document.querySelector('.brand span');
    if (brandSubtitle) brandSubtitle.textContent = 'Intelligent Quality Engineering · Human Review · Deterministic Execution · Analytics';

    document.querySelectorAll('[data-product-name]').forEach((el) => { el.textContent = 'TestNexus AI'; });

    const replacements = [
      ['AI TestPilot', 'TestNexus AI'],
      ['AI TestPilot Demo', 'TestNexus AI Demo'],
      ['AI TestPilot Approved Test Suite', 'TestNexus AI Test Suite'],
    ];
    document.querySelectorAll('h1,h2,h3,strong,.title,.page-title').forEach((el) => {
      let text = el.textContent || '';
      let next = text;
      for (const [from, to] of replacements) next = next.split(from).join(to);
      if (next !== text && el.childElementCount === 0) el.textContent = next;
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyBranding, { once: true });
  else applyBranding();
})();