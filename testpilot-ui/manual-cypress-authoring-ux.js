(function () {
  if (window.__testNexusManualCypressAuthoringUx) return;
  window.__testNexusManualCypressAuthoringUx = true;

  function startWhenReady(attempt = 0) {
    const mode = document.getElementById('testCreationModeSelect');
    const steps = document.getElementById('editSteps');
    const expected = document.getElementById('editExpected');
    const applyTemplate = document.getElementById('applyTemplateBtn');
    if ((!window.__testNexusManualCypressAuthoring || !mode || !steps || !expected || !applyTemplate) && attempt < 40) {
      return setTimeout(() => startWhenReady(attempt + 1), 50);
    }
    if (!mode || !steps || !expected || !applyTemplate) return;

    const stepLabel = steps.closest('.field')?.querySelector('label');
    const expectedLabel = expected.closest('.field')?.querySelector('label');
    const originalStepLabel = stepLabel?.textContent || 'Steps';
    const originalExpectedLabel = expectedLabel?.textContent || 'Expected Results';

    function currentCase() {
      try {
        const index = Number(document.getElementById('editIndex')?.value || -1);
        return index >= 0 && typeof testCases !== 'undefined' ? testCases[index] : null;
      } catch { return null; }
    }

    function manualCypressActive() {
      return mode.value === 'manual' || currentCase()?.manualAuthoringSyntax === 'cypress';
    }

    function updateLabels() {
      const active = manualCypressActive();
      if (stepLabel) stepLabel.textContent = active ? 'Steps · Cypress Commands' : originalStepLabel;
      if (expectedLabel) expectedLabel.textContent = active ? 'Expected Results · Cypress Assertions' : originalExpectedLabel;
      const help = document.getElementById('manualCypressHelp');
      if (help) help.classList.toggle('show', active);
      const advisor = document.getElementById('editorAssertionAi');
      if (advisor && active) advisor.style.display = 'none';
    }

    mode.addEventListener('change', () => {
      if (mode.value === 'manual') {
        const existing = String(steps.value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        if (!existing.length || existing.some((line) => !/^cy\./.test(line))) applyTemplate.click();
      }
      updateLabels();
    });

    const priorOpenEditor = window.openEditor;
    if (typeof priorOpenEditor === 'function') {
      window.openEditor = function (index) {
        priorOpenEditor(index);
        const numericIndex = Number(index);
        let tc = null;
        try { tc = numericIndex >= 0 && typeof testCases !== 'undefined' ? testCases[numericIndex] : null; } catch {}
        if (tc?.manualAuthoringSyntax === 'cypress') {
          mode.value = 'manual';
          mode.dispatchEvent(new Event('change', { bubbles: true }));
          if (Array.isArray(tc.cypressSteps)) steps.value = tc.cypressSteps.join('\n');
          if (Array.isArray(tc.cypressAssertions)) expected.value = tc.cypressAssertions.join('\n');
        }
        updateLabels();
      };
      try { openEditor = window.openEditor; } catch {}
    }

    updateLabels();
  }

  startWhenReady();
})();
