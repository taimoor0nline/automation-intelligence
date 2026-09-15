const crypto = require('crypto');
const v7 = require('./canonicalElementRegistryV7');

function clean(value, max = 1200) { return String(value ?? '').trim().slice(0, max); }
function lower(value) { return clean(value, 500).toLowerCase(); }

function semanticButton(entry = {}) {
  const tag = lower(entry.tag);
  const role = lower(entry.role);
  return tag === 'button' || role === 'button' || (tag === 'input' && ['button','reset'].includes(lower(entry.type)));
}

function semanticLabel(entry = {}) {
  return clean(entry.ariaLabel || entry.label || entry.text || entry.name, 500);
}

function clearAllAffordance(entry = {}) {
  if (!semanticButton(entry)) return false;
  const label = lower(semanticLabel(entry));
  return /^(?:clear|remove|reset)\s+(?:all\s+)?(?:selected\s+)?(?:items?|values?|tags?|chips?|selections?|skills?)$/.test(label)
    || /^(?:clear|remove)\s+all$/.test(label);
}

function removeTagAffordance(entry = {}) {
  if (!semanticButton(entry) || clearAllAffordance(entry)) return null;
  const label = semanticLabel(entry);
  const match = label.match(/^\s*(remove|delete)\s+(.+?)\s*$/i);
  if (!match) return null;
  return { verb: match[1], value: clean(match[2], 500), prefix: `${match[1]} ` };
}

function sameSuggestionSurface(candidate = {}, control = {}) {
  const listId = clean(control.suggestionListId, 240);
  if (!listId) return false;
  const candidateControls = clean(candidate.ariaControls || candidate.ariaOwns, 240);
  return candidate.pageRef === control.pageRef && candidateControls === listId;
}

function buildCanonicalElementRegistry(pageDiscoveries = []) {
  const base = v7.buildCanonicalElementRegistry(pageDiscoveries);
  const elements = (base.elements || []).map((entry) => ({ ...entry }));

  for (const control of elements) {
    if (!control.suggestionListId || !control.suggestionListSelector) continue;
    const caps = new Set(control.capabilities || []);

    // Bounded traversal is safe for both ordinary scrollable listboxes and true
    // virtualized listboxes. The runner stops when the exact evidenced value is
    // found, the list can no longer advance, or the hard attempt bound is reached.
    if (caps.has('SELECT_SUGGESTION')) {
      caps.add('TRAVERSE_SUGGESTIONS');
      caps.add('SELECT_SUGGESTION_BY_TRAVERSAL');
    }

    const related = elements.filter((candidate) => sameSuggestionSurface(candidate, control));
    const removeTargets = related.map((candidate) => {
      const semantic = removeTagAffordance(candidate);
      return semantic ? {
        value: semantic.value,
        selector: candidate.selector,
        elementRef: candidate.elementRef,
        ariaLabel: semanticLabel(candidate),
        prefix: semantic.prefix,
      } : null;
    }).filter(Boolean);
    const clearTargets = related.filter(clearAllAffordance).map((candidate) => ({
      selector: candidate.selector,
      elementRef: candidate.elementRef,
      ariaLabel: semanticLabel(candidate),
    }));

    const prefixes = [...new Set(removeTargets.map((item) => item.prefix).filter(Boolean))];
    const removeTagPattern = prefixes.length === 1 ? {
      strategy: 'ARIA_LABEL_PREFIX',
      prefix: prefixes[0],
      relationAttribute: 'aria-controls',
      relationValue: control.suggestionListId,
    } : null;

    if (control.suggestionMultiselect === true && (removeTargets.length || removeTagPattern)) {
      caps.add('REMOVE_SELECTED_TAG');
      caps.add('ASSERT_SELECTED_TAGS');
    }
    if (control.suggestionMultiselect === true && clearTargets.length === 1) {
      caps.add('CLEAR_SELECTED_TAGS');
      caps.add('ASSERT_SELECTED_TAGS');
    }

    Object.assign(control, {
      capabilities: [...caps].sort(),
      suggestionTraversalMaxAttempts: 24,
      removeTagTargets: removeTargets,
      removeTagPattern,
      clearTagsSelector: clearTargets.length === 1 ? clearTargets[0].selector : null,
      clearTagsRef: clearTargets.length === 1 ? clearTargets[0].elementRef : null,
    });
  }

  const registryCore = {
    version: 8,
    pages: base.pages || [],
    elements,
    capabilitySummary: v7.capabilitySummary(elements),
  };
  const registryHash = crypto.createHash('sha256').update(JSON.stringify(registryCore)).digest('hex');
  return { ...registryCore, registryHash };
}

function registryForModel(registry = {}) {
  const base = v7.registryForModel(registry);
  const byRef = new Map((registry.elements || []).map((entry) => [entry.elementRef, entry]));
  return {
    ...base,
    version: registry.version || 8,
    elements: (base.elements || []).map((entry) => {
      const source = byRef.get(entry.elementRef) || {};
      return {
        ...entry,
        suggestionTraversalMaxAttempts: source.suggestionTraversalMaxAttempts || null,
        removeTagTargets: (source.removeTagTargets || []).map((item) => ({ value: item.value, ariaLabel: item.ariaLabel })),
        removeTagPattern: source.removeTagPattern ? { strategy: source.removeTagPattern.strategy, prefix: source.removeTagPattern.prefix } : null,
        clearSelectedTags: Boolean(source.clearTagsSelector),
        capabilities: source.capabilities || entry.capabilities,
      };
    }),
    capabilityContract: {
      ...(base.capabilityContract || {}),
      actionRequirements: {
        ...(base.capabilityContract?.actionRequirements || {}),
        SCROLL_SUGGESTIONS_TO_VALUE: 'TRAVERSE_SUGGESTIONS',
        SELECT_SUGGESTION_BY_TRAVERSAL: 'SELECT_SUGGESTION_BY_TRAVERSAL',
        REMOVE_SELECTED_TAG: 'REMOVE_SELECTED_TAG',
        CLEAR_SELECTED_TAGS: 'CLEAR_SELECTED_TAGS',
      },
      assertionRequirements: {
        ...(base.capabilityContract?.assertionRequirements || {}),
        selectedTagPresent: 'ASSERT_SELECTED_TAGS',
        selectedTagAbsent: 'ASSERT_SELECTED_TAGS',
        selectedTagsEmpty: 'ASSERT_SELECTED_TAGS',
      },
      specialRules: [
        ...(base.capabilityContract?.specialRules || []),
        'Virtualized/scrollable list traversal is bounded and exact-match only; it stops rather than guessing when the list cannot advance or the attempt limit is reached.',
        'REMOVE_SELECTED_TAG is advertised only when discovery observes a semantic remove/delete affordance tied to the same suggestion list; an observed accessible-name prefix may safely parameterize another grounded selected value at runtime.',
        'CLEAR_SELECTED_TAGS is advertised only when discovery observes exactly one semantic clear-all affordance tied to the same suggestion list.',
      ],
    },
  };
}

module.exports = {
  ...v7,
  buildCanonicalElementRegistry,
  registryForModel,
  removeTagAffordance,
  clearAllAffordance,
};
