function text(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function identityToken(value) {
  return String(value || '').replace(/[^A-Za-z0-9]+/g, '').toLowerCase();
}

function selectorFor(item) {
  if (!item) return '';
  if (item.selector) return String(item.selector);
  if (item.testId) return `[data-testid="${item.testId}"]`;
  if (item.id) return `#${item.id}`;
  if (item.name) return `[name="${item.name}"]`;
  return '';
}

function selectorIdentity(value) {
  const source = text(value);
  let match = source.match(/^#([A-Za-z0-9_-]+)$/);
  if (match) return identityToken(match[1]);
  match = source.match(/^\[data-testid=(?:"([^"]+)"|'([^']+)')\]$/i);
  if (match) return identityToken(match[1] || match[2]);
  match = source.match(/^\[name=(?:"([^"]+)"|'([^']+)')\]$/i);
  if (match) return identityToken(match[1] || match[2]);
  return '';
}

function buildCanonicalSelectorIndex(pageDiscoveries = []) {
  const exact = new Set();
  const elements = new Map();
  const tokenOwners = new Map();

  function register(item) {
    if (!item) return;
    const canonical = selectorFor(item);
    if (!canonical) return;
    exact.add(canonical);
    elements.set(canonical, item);

    const aliases = [item.selector, item.testId, item.id, item.name, canonical].filter(Boolean);
    const tokens = new Set(aliases.map((value) => selectorIdentity(value) || identityToken(value)).filter(Boolean));
    for (const token of tokens) {
      if (!tokenOwners.has(token)) tokenOwners.set(token, new Set());
      tokenOwners.get(token).add(canonical);
    }
  }

  for (const page of pageDiscoveries || []) {
    for (const item of page?.elements || []) {
      register(item);
      register(item?.errorElement);
    }
    for (const item of page?.messages || []) register(item);
  }

  const uniqueByToken = new Map();
  for (const [token, owners] of tokenOwners.entries()) {
    if (owners.size === 1) uniqueByToken.set(token, [...owners][0]);
  }

  return { exact, elements, uniqueByToken };
}

function canonicalizeSelector(value, index) {
  const selector = text(value);
  if (!selector || !index) return selector;
  if (index.exact.has(selector)) return selector;
  const token = selectorIdentity(selector);
  if (!token) return selector;
  return index.uniqueByToken.get(token) || selector;
}

function canonicalizeSelectorsInText(value, index) {
  return String(value || '').replace(
    /\[data-testid=(?:"[^"]+"|'[^']+')\]|#[A-Za-z0-9_-]+|\[name=(?:"[^"]+"|'[^']+')\]/g,
    (selector) => canonicalizeSelector(selector, index)
  );
}

function normalizeValueExpectation(value, index) {
  let source = canonicalizeSelectorsInText(value, index);
  const selector = source.match(/\[data-testid=(?:"[^"]+"|'[^']+')\]|#[A-Za-z0-9_-]+|\[name=(?:"[^"]+"|'[^']+')\]/)?.[0];
  if (!selector) return source;
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  source = source.replace(
    new RegExp(`^\\s*Value\\s+of\\s+${escaped}\\s+(?:is|equals?|exactly)\\s+(["'\`][\\s\\S]*["'\`])\\s*$`, 'i'),
    (_all, expected) => `Value equals ${expected} in ${selector}`
  );
  source = source.replace(
    new RegExp(`^\\s*Value\\s+of\\s+${escaped}\\s+(?:contains?|includes?)\\s+(["'\`][\\s\\S]*["'\`])\\s*$`, 'i'),
    (_all, expected) => `Value contains ${expected} in ${selector}`
  );
  source = source.replace(
    new RegExp(`^\\s*Value\\s+of\\s+${escaped}\\s+(?:is\\s+)?(?:non[- ]?empty|not\\s+empty)\\s*$`, 'i'),
    () => `Value is non-empty in ${selector}`
  );
  source = source.replace(
    new RegExp(`^\\s*Value\\s+of\\s+${escaped}\\s+(?:is\\s+)?empty\\s*$`, 'i'),
    () => `Value is empty in ${selector}`
  );
  return source;
}

function normalizePath(value) {
  const source = text(value);
  if (!source) return '';
  if (source.startsWith('/')) return source;
  try {
    const url = new URL(source);
    return `${url.pathname}${url.search}` || '/';
  } catch {
    return '';
  }
}

function verificationExpectation(step, index) {
  const action = lower(step?.action);
  if (!/^(verify|assert|expect)\b/.test(action)) return '';
  const target = text(step?.target);
  const targetLower = target.toLowerCase();
  const value = step?.value == null ? '' : String(step.value).trim();

  if (targetLower === 'path' || /\bpath\b/.test(action)) {
    const path = normalizePath(value || target);
    return path ? `Path equals "${path}"` : '';
  }
  if (targetLower === 'url' || /\burl\b/.test(action)) {
    const expected = value || target;
    if (!expected) return '';
    return /^https?:\/\//i.test(expected) ? `URL equals "${expected}"` : `URL includes "${expected}"`;
  }

  const selector = canonicalizeSelector(target, index);
  if (selector && selector !== target || index?.exact?.has(selector)) {
    if (/not\s+visible|hidden|invisible/.test(`${action} ${value}`)) return `Element ${selector} is hidden`;
    if (/does\s+not\s+exist|not\s+exist|absent|not\s+present/.test(`${action} ${value}`)) return `Element ${selector} does not exist`;
    if (/enabled/.test(`${action} ${value}`)) return `Element ${selector} is enabled`;
    if (/disabled/.test(`${action} ${value}`)) return `Element ${selector} is disabled`;
    if (/required/.test(`${action} ${value}`)) return `Element ${selector} is required`;
    if (/visible|shown|displayed|appears/.test(`${action} ${value}`) || !value) return `Element ${selector} is visible`;
  }
  return '';
}

function canonicalizeSelectValue(step, index) {
  const action = lower(step?.action);
  if (!/select|choose option/.test(action)) return step;
  const selector = text(step?.target);
  const element = index?.elements?.get(selector);
  const options = Array.isArray(element?.options) ? element.options : [];
  if (!options.length || step?.value == null) return step;
  const requested = String(step.value);
  const exact = options.find((option) => String(option?.value ?? '') === requested);
  if (exact) return step;
  const wanted = requested.trim().toLowerCase();
  const matched = options.find((option) => String(option?.value ?? '').trim().toLowerCase() === wanted)
    || options.find((option) => String(option?.text ?? option?.label ?? '').trim().toLowerCase() === wanted);
  if (!matched || matched.value == null) return step;
  return { ...step, value: String(matched.value) };
}

function normalizeStep(step, index, normalizations) {
  const action = lower(step?.action);
  const originalTarget = text(step?.target);
  const target = canonicalizeSelector(originalTarget, index);
  let normalized = target && target !== originalTarget ? { ...step, target } : { ...step };
  if (target && target !== originalTarget) normalizations.push(`selector:${originalTarget}->${target}`);

  if (/^(?:fill|type|enter|input)(?:\b|$)/.test(action) && step?.value === '') {
    normalizations.push(`empty-fill:${target || originalTarget}`);
    normalized = { ...normalized, action: 'clear', value: null };
  }

  normalized = canonicalizeSelectValue(normalized, index);
  return normalized;
}

function normalizeTestCaseForAutomation(testCase, context = {}) {
  if (!testCase || typeof testCase !== 'object') return testCase;
  const index = buildCanonicalSelectorIndex(context.pageDiscoveries || []);
  const normalizations = [];
  const promotedExpectations = [];
  const steps = [];

  for (const sourceStep of Array.isArray(testCase.steps) ? testCase.steps : []) {
    const promoted = verificationExpectation(sourceStep, index);
    if (promoted) {
      promotedExpectations.push(promoted);
      normalizations.push(`verification-step:${text(sourceStep?.target) || text(sourceStep?.action)}`);
      continue;
    }
    steps.push(normalizeStep(sourceStep, index, normalizations));
  }

  const expectedResults = [
    ...(Array.isArray(testCase.expectedResults) ? testCase.expectedResults : []).map((item) => normalizeValueExpectation(item, index)),
    ...promotedExpectations,
  ];
  const dedupedExpected = [...new Set(expectedResults.map((item) => String(item || '').trim()).filter(Boolean))];

  return {
    ...testCase,
    steps,
    expectedResults: dedupedExpected,
    _deterministicNormalizations: [...new Set(normalizations)],
  };
}

module.exports = {
  identityToken,
  selectorIdentity,
  buildCanonicalSelectorIndex,
  canonicalizeSelector,
  canonicalizeSelectorsInText,
  normalizeValueExpectation,
  verificationExpectation,
  normalizeTestCaseForAutomation,
};
