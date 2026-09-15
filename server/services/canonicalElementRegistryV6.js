const crypto = require('crypto');
const v5 = require('./canonicalElementRegistryV5');

function lower(value) { return String(value ?? '').trim().toLowerCase(); }

function refinedCapabilities(element = {}) {
  const caps = new Set(v5.capabilitiesFor(element));
  const tag = lower(element.tag || element.tagName);
  const type = lower(element.type);

  // contenteditable is textual DOM, not a form-value control. Cypress .val()
  // semantics do not apply, so keep TYPE/CLEAR/TEXT/HTML but remove form value
  // capabilities that would authorize invalid assertions.
  if (element.contenteditable === true || lower(element.contenteditable) === 'true') {
    for (const capability of ['VALUE', 'VALIDITY', 'ENABLED_STATE']) caps.delete(capability);
    caps.add('TEXT');
    caps.add('HTML');
  }

  // Cypress does not type into the color picker. The platform uses a native
  // HTMLInputElement value setter and dispatches input/change deterministically.
  if (tag === 'input' && type === 'color' && element.disabled !== true && element.readonly !== true) {
    caps.add('SET_COLOR_VALUE');
  }

  // Native <select multiple> is distinct from a custom ARIA listbox/combobox.
  // Cypress supports selecting an array of real option values.
  if (tag === 'select' && element.multiple === true && element.disabled !== true) {
    caps.add('SELECT_MULTIPLE');
  }

  return [...caps].sort();
}

function buildCanonicalElementRegistry(pageDiscoveries = []) {
  const base = v5.buildCanonicalElementRegistry(pageDiscoveries);
  const elements = (base.elements || []).map((entry) => ({
    ...entry,
    capabilities: refinedCapabilities(entry),
  }));
  const registryCore = {
    version: 6,
    pages: base.pages || [],
    elements,
    capabilitySummary: v5.capabilitySummary(elements),
  };
  const registryHash = crypto.createHash('sha256').update(JSON.stringify(registryCore)).digest('hex');
  return { ...registryCore, registryHash };
}

function registryForModel(registry = {}) {
  const model = v5.registryForModel(registry);
  return {
    ...model,
    version: registry.version || 6,
    capabilityContract: {
      ...(model.capabilityContract || {}),
      authoritative: true,
      actionRequirements: {
        ...(model.capabilityContract?.actionRequirements || {}),
        SET_COLOR_VALUE: 'SET_COLOR_VALUE',
        SELECT_MULTIPLE: 'SELECT_MULTIPLE',
      },
      assertionRequirements: {
        ...(model.capabilityContract?.assertionRequirements || {}),
        selectedValues: 'SELECT_MULTIPLE',
      },
      specialRules: [
        ...(model.capabilityContract?.specialRules || []),
        'SET_COLOR_VALUE is only for a discovered input[type=color] advertising SET_COLOR_VALUE; use a six-digit #RRGGBB value.',
        'SELECT_MULTIPLE is only for a discovered native select[multiple] advertising SELECT_MULTIPLE; every requested value must be a discovered enabled option.',
        'ASSERT_SELECTED_VALUES_EQUALS is only for a discovered native select[multiple] and compares the exact selected values in DOM order.',
        'contenteditable elements are text/HTML editing surfaces, not form-value controls; use TYPE/CLEAR and text/HTML assertions rather than VALUE assertions.',
      ],
    },
  };
}

module.exports = {
  ...v5,
  buildCanonicalElementRegistry,
  registryForModel,
  refinedCapabilities,
};
