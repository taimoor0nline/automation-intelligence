const INDEX_CACHE = new WeakMap();

const STOP_WORDS = new Set([
  'the','a','an','is','are','be','becomes','become','with','without','and','or','to','of','in','on','for','after','before','successfully','successful','user','element','field','form','page','text','message','displayed','visible','shown','appears','appear','accept','accepts','input','valid','validation','errors','error','feedback','submission','submit','button','value','data','all','reference','generated',
]);

function selectorFor(item) {
  if (!item) return '';
  if (item.selector) return String(item.selector);
  if (item.testId) return `[data-testid="${item.testId}"]`;
  if (item.id) return `#${item.id}`;
  if (item.name) return `[name="${item.name}"]`;
  return '';
}

function pathForPage(page) {
  try {
    const url = new URL(page?.finalUrl || page?.url || 'http://local/');
    return `${url.pathname}${url.search}` || '/';
  } catch {
    return '/';
  }
}

function normalizeWords(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function semanticWords(value) {
  return normalizeWords(value).filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

function itemText(item, selector) {
  return [
    selector,
    item?.testId,
    item?.id,
    item?.name,
    item?.label,
    item?.text,
    item?.placeholder,
    item?.ariaLabel,
    item?.title,
    item?.type,
    item?.tag,
  ].filter(Boolean).join(' ');
}

function buildIndex(pageDiscoveries = []) {
  if (pageDiscoveries && typeof pageDiscoveries === 'object' && INDEX_CACHE.has(pageDiscoveries)) {
    return INDEX_CACHE.get(pageDiscoveries);
  }

  const entries = [];
  const paths = new Set();
  const seenSelectors = new Set();
  const register = (item, path) => {
    const selector = selectorFor(item);
    if (!selector || seenSelectors.has(selector)) return;
    seenSelectors.add(selector);
    const words = new Set(semanticWords(itemText(item, selector)));
    entries.push({ selector, item, path, words });
  };

  for (const page of pageDiscoveries || []) {
    const path = pathForPage(page);
    paths.add(path);
    for (const item of page?.elements || []) {
      register(item, path);
      if (item?.errorElement) register(item.errorElement, path);
    }
    for (const message of page?.messages || []) register(message, path);
  }

  const index = { entries, paths };
  if (pageDiscoveries && typeof pageDiscoveries === 'object') INDEX_CACHE.set(pageDiscoveries, index);
  return index;
}

function hasExplicitSelector(text) {
  return /\[data-testid=(?:"[^"]+"|'[^']+')\]|#[A-Za-z0-9_-]+|\[name=(?:"[^"]+"|'[^']+')\]/.test(String(text || ''));
}

function quotedValues(text) {
  const values = [];
  const regex = /["'`]([^"'`]+)["'`]/g;
  let match;
  while ((match = regex.exec(String(text || ''))) !== null) values.push(match[1]);
  return values;
}

function resolvePathExpectation(text, index) {
  const lower = String(text || '').toLowerCase();
  if (!/redirect|navigat|land|arriv|open/.test(lower)) return null;
  for (const path of index.paths) {
    if (path === '/') continue;
    const pathWords = semanticWords(path);
    if (!pathWords.length) continue;
    if (pathWords.some((word) => lower.includes(word))) {
      return { text: `Path equals "${path}"`, source: 'discovery-path', path, confidence: 1 };
    }
  }
  return null;
}

function candidateScore(expectationWords, entry) {
  let score = 0;
  for (const word of expectationWords) if (entry.words.has(word)) score += 1;
  return score;
}

function resolveSelectorExpectation(text, index) {
  const lower = String(text || '').toLowerCase();
  if (!/visible|shown|displayed|appears?|exists?|present|hidden|absent|checked|enabled|disabled|text|message|panel|reference/.test(lower)) return null;

  const words = semanticWords(text);
  if (!words.length) return null;
  let best = null;
  let secondScore = 0;
  for (const entry of index.entries) {
    const score = candidateScore(words, entry);
    if (!best || score > best.score) {
      secondScore = best?.score || 0;
      best = { entry, score };
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  // Require two semantic matches and a clear winner. This avoids inventing selectors
  // from vague prose while still grounding phrases such as "success panel" or
  // "username error message" against test ids discovered from the page.
  if (!best || best.score < 2 || best.score === secondScore) return null;

  const selector = best.entry.selector;
  const quotes = quotedValues(text).filter((value) => !value.includes('data-testid') && value !== selector);
  const message = quotes.length ? quotes[quotes.length - 1] : '';
  const visible = /visible|shown|displayed|appears?|present/.test(lower);
  const hidden = /hidden|not visible|absent|not present/.test(lower);
  const checked = /\bchecked\b/.test(lower) && !/not checked|unchecked/.test(lower);
  const disabled = /\bdisabled\b/.test(lower);
  const enabled = /\benabled\b/.test(lower) && !disabled;

  const parts = [];
  if (hidden) parts.push(`Element ${selector} is hidden`);
  else if (visible) parts.push(`Element ${selector} is visible`);
  else if (checked) parts.push(`Element ${selector} is checked`);
  else if (disabled) parts.push(`Element ${selector} is disabled`);
  else if (enabled) parts.push(`Element ${selector} is enabled`);
  else parts.push(`Element ${selector} exists`);

  if (message && /text|message|panel|reference|thank|error|required/.test(lower)) {
    parts.push(`Text contains "${message}" in ${selector}`);
  }

  return {
    text: parts.join(' and '),
    source: 'discovery-selector',
    selector,
    confidence: best.score,
  };
}

function normalizeTestIdPhrase(text) {
  return String(text || '').replace(/\btest\s*id\s*[=:]?\s*["'`]([^"'`]+)["'`]/gi, '[data-testid="$1"]');
}

function resolveExpectation(value, index) {
  const original = String(value || '').trim();
  const normalized = normalizeTestIdPhrase(original);
  if (hasExplicitSelector(normalized)) {
    return { original, text: normalized, resolved: normalized !== original, source: normalized !== original ? 'testid-normalization' : 'explicit', confidence: 1 };
  }

  const path = resolvePathExpectation(normalized, index);
  if (path) return { original, resolved: true, ...path };

  const selector = resolveSelectorExpectation(normalized, index);
  if (selector) return { original, resolved: true, ...selector };

  return { original, text: normalized, resolved: false, source: 'narrative', confidence: 0 };
}

function resolveExpectedResults(expectedResults = [], pageDiscoveries = []) {
  const index = buildIndex(pageDiscoveries);
  const records = (expectedResults || []).map((value) => resolveExpectation(value, index));
  return {
    results: records.map((record) => record.text),
    records,
    indexStats: { selectors: index.entries.length, paths: index.paths.size },
  };
}

module.exports = {
  buildIndex,
  resolveExpectedResults,
  resolveExpectation,
  normalizeTestIdPhrase,
};
