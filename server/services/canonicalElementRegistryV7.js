const crypto = require('crypto');
const v6 = require('./canonicalElementRegistryV6');

function clean(value, max = 1200) { return String(value ?? '').trim().slice(0, max); }
function lower(value) { return clean(value, 120).toLowerCase(); }
function pagePath(page) {
  try {
    const url = new URL(page?.finalUrl || page?.url || 'http://testnexus.local/');
    return `${url.pathname}${url.search}` || '/';
  } catch { return '/'; }
}
function rawKey(path, selector) { return `${clean(path, 1200)}|${clean(selector, 500)}`; }

function rawMaps(pageDiscoveries = []) {
  const byKey = new Map();
  for (const page of pageDiscoveries || []) {
    const path = pagePath(page);
    for (const item of [...(page?.elements || []), ...(page?.messages || [])]) if (item?.selector) byKey.set(rawKey(path, item.selector), item);
  }
  return { byKey };
}

function optionEvidence(raw = {}, path = '', pageDiscoveries = []) {
  const controlsId = clean(raw.ariaControls || raw.ariaOwns || raw.list, 240);
  const out = [];
  const seen = new Set();
  for (const item of raw.suggestions || []) {
    const value = clean(item?.value ?? item?.text, 500);
    const text = clean(item?.text ?? item?.value, 500);
    const key = `${value}|${text}`;
    if ((value || text) && !seen.has(key)) { seen.add(key); out.push({ value, text, disabled: item?.disabled === true, source: raw.suggestionSource || 'rendered' }); }
  }
  if (!controlsId) return out;
  const page = (pageDiscoveries || []).find((candidate) => pagePath(candidate) === path);
  for (const item of page?.elements || []) {
    if (lower(item.role) !== 'option') continue;
    if (clean(item.listboxOwnerId, 240) !== controlsId) continue;
    const value = clean(item.controlValue || item.value || item.text || item.ariaLabel, 500);
    const text = clean(item.text || item.ariaLabel || item.controlValue || item.value, 500);
    const key = `${value}|${text}`;
    if ((value || text) && !seen.has(key)) {
      seen.add(key);
      out.push({ value, text, disabled: item.disabled === true || lower(item.ariaDisabled) === 'true', selected: lower(item.ariaSelected) === 'true', source: 'rendered-listbox' });
    }
  }
  return out.slice(0, 200);
}

function searchableControl(entry = {}) {
  const tag = lower(entry.tag);
  const type = lower(entry.type);
  const role = lower(entry.role);
  return role === 'combobox' || role === 'searchbox' || (tag === 'input' && (type === 'search' || Boolean(entry.ariaAutocomplete) || Boolean(entry.listboxId) || Boolean(entry.datalistId)));
}
function editableSearchControl(entry = {}) {
  const tag = lower(entry.tag);
  return ['input','textarea'].includes(tag) || entry.contenteditable === true;
}

function buildCanonicalElementRegistry(pageDiscoveries = []) {
  const base = v6.buildCanonicalElementRegistry(pageDiscoveries);
  const maps = rawMaps(pageDiscoveries);
  const pageByRef = new Map((base.pages || []).map((page) => [page.pageRef, page]));
  const idIndex = new Map();

  const firstPass = (base.elements || []).map((entry) => {
    const page = pageByRef.get(entry.pageRef);
    const path = page?.path || entry.path || '/';
    const raw = maps.byKey.get(rawKey(path, entry.selector)) || null;
    const decorated = {
      ...entry,
      ariaControls: clean(raw?.ariaControls, 240) || null,
      ariaOwns: clean(raw?.ariaOwns, 240) || null,
      ariaAutocomplete: lower(raw?.ariaAutocomplete) || null,
      ariaActivedescendant: clean(raw?.ariaActivedescendant, 240) || null,
      ariaMultiselectable: lower(raw?.ariaMultiselectable) || null,
      ariaHaspopup: lower(raw?.ariaHaspopup) || null,
      listboxOwnerId: clean(raw?.listboxOwnerId, 240) || null,
      listboxOwnerSelector: clean(raw?.listboxOwnerSelector, 500) || null,
      datalistId: clean(raw?.list, 240) || null,
      suggestionSource: clean(raw?.suggestionSource, 80) || null,
    };
    if (decorated.id) idIndex.set(`${decorated.pageRef}|${decorated.id}`, decorated);
    return decorated;
  });

  const elements = firstPass.map((entry) => {
    if (entry.kind === 'page-root') return entry;
    const page = pageByRef.get(entry.pageRef);
    const path = page?.path || entry.path || '/';
    const raw = maps.byKey.get(rawKey(path, entry.selector)) || {};
    const relationId = clean(entry.ariaControls || entry.ariaOwns || entry.datalistId, 240);
    const relation = relationId ? idIndex.get(`${entry.pageRef}|${relationId}`) : null;
    const suggestions = optionEvidence(raw, path, pageDiscoveries);
    const isDatalist = Boolean(entry.datalistId && relation && lower(relation.tag) === 'datalist');
    const listbox = relation && lower(relation.role) === 'listbox' ? relation : null;
    const multi = entry.ariaMultiselectable === 'true' || listbox?.ariaMultiselectable === 'true';
    const search = searchableControl({ ...entry, listboxId: listbox?.id, datalistId: isDatalist ? entry.datalistId : null });
    const editable = editableSearchControl(entry);
    const caps = new Set(entry.capabilities || []);

    if (search && editable && entry.disabled !== true && entry.readonly !== true) {
      caps.add('SEARCH_SUGGESTIONS');
      caps.add('CLEAR_SUGGESTION_SEARCH');
      caps.add('SUGGESTION_QUERY');
    }
    if (lower(entry.role) === 'combobox' || listbox) {
      caps.add('OPEN_COMBOBOX');
      caps.add('CLOSE_COMBOBOX');
    }
    if (listbox || (entry.ariaControls && !isDatalist)) {
      caps.add('SELECT_SUGGESTION');
      caps.add('ASSERT_SUGGESTIONS');
      caps.add('ASSERT_COMBOBOX_STATE');
    }
    if (multi && caps.has('SELECT_SUGGESTION') && caps.has('SEARCH_SUGGESTIONS')) caps.add('SELECT_SUGGESTIONS');
    if (isDatalist) caps.add('NATIVE_DATALIST_SUGGESTIONS');

    return {
      ...entry,
      capabilities: [...caps].sort(),
      searchableSuggestions: search,
      suggestionListId: listbox?.id || (entry.ariaControls && !isDatalist ? entry.ariaControls : null),
      suggestionListRef: listbox?.elementRef || null,
      suggestionListSelector: listbox?.selector || null,
      suggestionMultiselect: Boolean(multi),
      dynamicSuggestions: Boolean(entry.ariaAutocomplete && ['list','both','inline'].includes(entry.ariaAutocomplete)),
      suggestions,
    };
  });

  const registryCore = { version: 7, pages: base.pages || [], elements, capabilitySummary: v6.capabilitySummary(elements) };
  const registryHash = crypto.createHash('sha256').update(JSON.stringify(registryCore)).digest('hex');
  return { ...registryCore, registryHash };
}

function registryForModel(registry = {}) {
  const base = v6.registryForModel(registry);
  const byRef = new Map((registry.elements || []).map((entry) => [entry.elementRef, entry]));
  return {
    ...base,
    version: registry.version || 7,
    elements: (base.elements || []).map((entry) => {
      const source = byRef.get(entry.elementRef) || {};
      return {
        ...entry,
        ariaControls: source.ariaControls || null,
        ariaOwns: source.ariaOwns || null,
        ariaAutocomplete: source.ariaAutocomplete || null,
        ariaActivedescendant: source.ariaActivedescendant || null,
        ariaMultiselectable: source.ariaMultiselectable || null,
        searchableSuggestions: source.searchableSuggestions === true,
        suggestionListRef: source.suggestionListRef || null,
        suggestionMultiselect: source.suggestionMultiselect === true,
        dynamicSuggestions: source.dynamicSuggestions === true,
        suggestions: (source.suggestions || []).map((item) => ({ value: item.value, text: item.text, disabled: item.disabled === true, selected: item.selected === true })),
        capabilities: source.capabilities || entry.capabilities,
      };
    }),
    capabilityContract: {
      ...(base.capabilityContract || {}),
      authoritative: true,
      actionRequirements: {
        ...(base.capabilityContract?.actionRequirements || {}),
        OPEN_COMBOBOX: 'OPEN_COMBOBOX', CLOSE_COMBOBOX: 'CLOSE_COMBOBOX', SEARCH_SUGGESTIONS: 'SEARCH_SUGGESTIONS', CLEAR_SUGGESTION_SEARCH: 'CLEAR_SUGGESTION_SEARCH', SELECT_SUGGESTION: 'SELECT_SUGGESTION', SELECT_SUGGESTIONS: 'SELECT_SUGGESTIONS',
      },
      assertionRequirements: {
        ...(base.capabilityContract?.assertionRequirements || {}), suggestionVisible: 'ASSERT_SUGGESTIONS', suggestionSelected: 'ASSERT_SUGGESTIONS', comboState: 'ASSERT_COMBOBOX_STATE',
      },
      specialRules: [
        ...(base.capabilityContract?.specialRules || []),
        'Search/autocomplete actions are available only when rendered discovery proves an editable searchable input/combobox or native datalist relationship.',
        'Custom listbox option values must come from rendered suggestions or explicit user-authored test data/requirements. AI may not fabricate suggestion labels.',
        'A custom ARIA combobox remains distinct from native <select>; never substitute SELECT or SELECT_MULTIPLE for semantic suggestion actions.',
        'Native <datalist> suggestions are discoverable/groundable, but browser-owned popup selection is not treated as a custom listbox click capability.',
        'SELECT_SUGGESTIONS requires rendered aria-multiselectable=true evidence on the associated listbox/control.',
      ],
    },
  };
}

module.exports = { ...v6, buildCanonicalElementRegistry, registryForModel, searchableControl, editableSearchControl };
