(function () {
  if (window.__testNexusGenerationProgressClarity) return;
  window.__testNexusGenerationProgressClarity = true;

  function proposedCount() {
    const box = document.getElementById('generationCoverageProposal');
    if (!box) return 0;
    const text = String(box.textContent || '');
    const match = text.match(/(\d+)\s+tests?\s+proposed/i);
    return match ? Number(match[1]) : 0;
  }

  function rewrite() {
    const el = document.getElementById('caseSubtitle');
    if (!el || el.dataset.progressRewriteBusy === '1') return;
    const text = String(el.textContent || '').trim();
    let next = text;

    const progress = text.match(/^AI generation\s+(\d+)\/(\d+)\s*·\s*readiness\s+(\d+)\/(\d+)\s+checked(.*)$/i);
    if (progress) {
      const generated = Number(progress[1]);
      const planned = Number(progress[2]);
      const checked = Number(progress[3]);
      const generatedDenominator = Math.max(generated, Number(progress[4]) || 0);
      const stillGenerating = Math.max(0, planned - generated);
      next = `Generated ${generated} of ${planned} planned · readiness checked ${checked} of ${generatedDenominator} generated`;
      if (stillGenerating) next += ` · ${stillGenerating} AI case${stillGenerating === 1 ? '' : 's'} still generating`;
      next += progress[5] || '';
    } else if (!document.body.classList.contains('generation-active') && /AI-proposed test case\(s\) generated/i.test(text)) {
      const proposed = proposedCount();
      const generated = Number(document.getElementById('caseCount')?.textContent || 0);
      if (proposed > generated && generated > 0) {
        next = text.replace(/^\d+\s+AI-proposed test case\(s\) generated/i, `${generated} of ${proposed} planned AI test cases generated`);
        if (!/generation incomplete/i.test(next)) next += ` · generation incomplete: ${proposed - generated} planned case${proposed - generated === 1 ? '' : 's'} unavailable`;
      }
    }

    if (next !== text) {
      el.dataset.progressRewriteBusy = '1';
      el.textContent = next;
      queueMicrotask(() => { delete el.dataset.progressRewriteBusy; });
    }
  }

  function install() {
    const el = document.getElementById('caseSubtitle');
    if (!el) return false;
    const observer = new MutationObserver(rewrite);
    observer.observe(el, { childList: true, characterData: true, subtree: true });
    rewrite();
    return true;
  }

  if (!install()) {
    document.addEventListener('DOMContentLoaded', install, { once: true });
    setTimeout(install, 500);
  }
})();
