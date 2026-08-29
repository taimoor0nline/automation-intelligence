const INDEX_CACHE = new WeakMap();
const { phrasesForSelector, hasSelectorIntent, detectedIntents } = require('./expectationIntentRegistry');
const { capabilitiesForElement } = require('./webCapabilityMatrix');

const STOP_WORDS = new Set([
  'the','a','an','is','are','be','becomes','become','with','without','and','or','to','of','in','on','for','after','before','successfully','successful','user','element','field','form','page','text','message','displayed','visible','shown','appears','appear','accept','accepts','input','valid','validation','errors','error','submission','submit','button','value','data','all','reference','generated',
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

function identityToken(value) {
  return String(value || '').replace(/[^A-Za-z0-9]+/g, '').toLowerCase();
}

function quoteMatchesEntryIdentity(value, entry) {
  const token = identityToken(value);
  if (!token) return false;
  const item = entry?.item || {};
  const identities = [
    entry?.selector,
    item.selector,
    item.testId,
    item.id,
    item.name,
    item.className,
    item.class,
  ].filter(Boolean);
  return identities.some((candidate) => identityToken(candidate) === token);
}

function itemText(item, selector) {
  return [selector,item?.testId,item?.id,item?.name,item?.label,item?.text,item?.placeholder,item?.ariaLabel,item?.title,item?.type,item?.tag]
    .filter(Boolean).join(' ');
}

function buildIndex(pageDiscoveries = []) {
  if (pageDiscoveries && typeof pageDiscoveries === 'object' && INDEX_CACHE.has(pageDiscoveries)) return INDEX_CACHE.get(pageDiscoveries);
  const entries = [];
  const paths = new Set();
  const seenSelectors = new Set();
  const capabilityCounts = new Map();
  const register = (item, path, parent = null) => {
    const selector = selectorFor(item);
    if (!selector || seenSelectors.has(selector)) return;
    seenSelectors.add(selector);
    const capabilities = new Set(Array.isArray(item?.capabilities) ? item.capabilities : capabilitiesForElement(item));
    for (const capability of capabilities) capabilityCounts.set(capability, (capabilityCounts.get(capability) || 0) + 1);
    entries.push({ selector, item, parent, path, capabilities, words: new Set(semanticWords(itemText(item, selector))) });
  };
  for (const page of pageDiscoveries || []) {
    const path = pathForPage(page);
    paths.add(path);
    for (const item of page?.elements || []) {
      register(item, path, null);
      if (item?.errorElement) register(item.errorElement, path, item);
    }
    for (const message of page?.messages || []) register(message, path, null);
  }
  const index = { entries, paths, capabilityCounts };
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
  if (!/redirect|navigat|land|arriv|open|route|path/.test(lower)) return null;
  let best = null;
  for (const path of index.paths) {
    if (path === '/') continue;
    const normalizedPath = String(path).toLowerCase();
    if (lower.includes(normalizedPath)) return { text: `Path equals "${path}"`, source: 'discovery-path', path, confidence: 10 };
    const words = normalizeWords(path).filter((word) => word.length > 1);
    if (!words.length) continue;
    const score = words.reduce((sum, word) => sum + (lower.includes(word) ? 1 : 0), 0);
    if (!score) continue;
    if (!best || score > best.score) best = { path, score };
  }
  if (!best) return null;
  return { text: `Path equals "${best.path}"`, source: 'discovery-path', path: best.path, confidence: best.score };
}

function requiredCapabilitiesForExpectation(text) {
  const source = String(text || '');
  const lower = source.toLowerCase();
  const required = new Set(detectedIntents(source).map((rule) => rule.key));
  if (/\b(text|message|label|caption|heading|content)\b|thank|error|required/i.test(source) && /contains|equals|exact|display|show|appear|text|message/i.test(source)) required.add('TEXT');
  if (/\bvalue\b|field.*(?:empty|non-empty|contains|equals)|\b(?:entered|filled|populated|set)\b/i.test(source)) required.add('VALUE');
  if (/selected\s+(?:value|option)|selected\s+from\s+(?:the\s+)?dropdown/i.test(source)) required.add('SELECTED_VALUE');
  if (/selected\s+(?:option\s+)?text/i.test(source)) required.add('SELECTED_TEXT');
  if (/\boptions?\b.*\b(count|exactly|at least|at most|\d+)/i.test(source)) required.add('OPTION_COUNT');
  if (/placeholder/i.test(lower)) required.add('PLACEHOLDER');
  if (/read.?only/i.test(lower)) required.add(/not read.?only|editable/i.test(lower) ? 'EDITABLE' : 'READONLY');
  if (/\bmin(?:imum)?\b/i.test(lower)) required.add('MIN');
  if (/\bmax(?:imum)?\b/i.test(lower)) required.add('MAX');
  if (/minlength|min length/i.test(lower)) required.add('MIN_LENGTH');
  if (/maxlength|max length/i.test(lower)) required.add('MAX_LENGTH');
  if (/pattern/i.test(lower)) required.add('PATTERN');
  if (/image.*loaded|loaded image/i.test(lower)) required.add('IMAGE_LOADED');
  if (/alt(?:ernative)? text/i.test(lower)) required.add('IMAGE_ALT');
  return [...required];
}

function supportsRequiredCapabilities(entry, required) {
  if (!required.length) return true;
  return required.every((capability) => entry.capabilities.has(capability));
}

function candidateScore(expectationWords, entry) {
  let score = 0;
  for (const word of expectationWords) if (entry.words.has(word)) score += 1;
  return score;
}

function bestEntry(text, index, capabilities = [], minimum = 1) {
  const words = semanticWords(text);
  if (!words.length) return null;
  let best = null;
  let second = 0;
  for (const entry of index.entries) {
    if (!supportsRequiredCapabilities(entry, capabilities)) continue;
    const score = candidateScore(words, entry);
    if (!best || score > best.score) {
      second = best?.score || 0;
      best = { entry, score };
    } else if (score > second) second = score;
  }
  if (!best || best.score < minimum || best.score === second) return null;
  return best;
}

function resolveValueExpectation(text, index) {
  if (!/\b(?:entered|filled|populated|set|selected)\b/i.test(String(text || ''))) return null;
  const quoted = quotedValues(text);
  if (!quoted.length) return null;
  const isSelected = /selected/i.test(text);
  const capability = isSelected ? 'SELECTED_VALUE' : 'VALUE';
  const best = bestEntry(text, index, [capability], 1);
  if (!best) return null;
  const expected = quoted[0];
  const selector = best.entry.selector;
  return {
    text: isSelected ? `Selected value equals "${expected}" in ${selector}` : `Value equals "${expected}" in ${selector}`,
    source: 'discovery-value-grounding',
    selector,
    confidence: best.score,
    requiredCapabilities: [capability],
    matchedCapabilities: [...best.entry.capabilities],
  };
}

function resolveAdjacentErrorExpectation(text, index) {
  if (!/(?:error|validation)\s+(?:message|text)|message.*(?:error|validation)/i.test(String(text || ''))) return null;
  const words = semanticWords(text);
  let best = null;
  let second = 0;
  for (const entry of index.entries) {
    if (!entry.parent) continue;
    if (!entry.capabilities.has('VISIBLE') && !entry.capabilities.has('TEXT')) continue;
    const combinedWords = new Set([...entry.words, ...semanticWords(itemText(entry.parent, selectorFor(entry.parent)))]);
    let score = 0;
    for (const word of words) if (combinedWords.has(word)) score += 1;
    if (!best || score > best.score) { second = best?.score || 0; best = { entry, score }; }
    else if (score > second) second = score;
  }
  if (!best || best.score < 1 || best.score === second) return null;
  const selector = best.entry.selector;
  return {
    text: `Element ${selector} is visible`,
    source: 'discovered-error-element',
    selector,
    confidence: best.score,
    requiredCapabilities: ['VISIBLE'],
    matchedCapabilities: [...best.entry.capabilities],
  };
}

function resolveSelectorExpectation(text, index) {
  if (!hasSelectorIntent(text)) return null;
  const words = semanticWords(text);
  if (!words.length) return null;
  const requiredCapabilities = requiredCapabilitiesForExpectation(text);
  const best = bestEntry(text, index, requiredCapabilities, 2);
  if (!best) return null;

  const selector = best.entry.selector;
  const quotes = quotedValues(text).filter((value) => !value.includes('data-testid') && value !== selector);
  const quotedMessage = quotes.length ? quotes[quotes.length - 1] : '';
  const parts = phrasesForSelector(text, selector);
  if (!parts.length) parts.push(`Element ${selector} exists`);

  const quotedValueIsIdentity = quotedMessage && quoteMatchesEntryIdentity(quotedMessage, best.entry);
  if (quotedMessage && !quotedValueIsIdentity && best.entry.capabilities.has('TEXT') && /text|message|panel|reference|label|thank|error|required|success/i.test(text)) {
    parts.push(`Text contains "${quotedMessage}" in ${selector}`);
  }

  return {
    text: parts.join(' and '),
    source: 'discovery-capability-matrix',
    selector,
    confidence: best.score,
    requiredCapabilities,
    matchedCapabilities: [...best.entry.capabilities],
    ignoredQuotedIdentity: quotedValueIsIdentity ? quotedMessage : null,
  };
}

function normalizeTestIdPhrase(text) {
  const source = String(text || '');
  if (hasExplicitSelector(source)) return source;
  return source.replace(/\btest\s*id\s*[=:]?\s*["'`]([^"'`]+)["'`]/gi, '[data-testid="$1"]');
}

function resolveExpectation(value, index) {
  const original = String(value || '').trim();
  const normalized = normalizeTestIdPhrase(original);
  if (hasExplicitSelector(normalized)) {
    return { original, text: normalized, resolved: normalized !== original, source: normalized !== original ? 'testid-normalization' : 'explicit', confidence: 1 };
  }
  const path = resolvePathExpectation(normalized, index);
  if (path) return { original, resolved: true, ...path };
  const error = resolveAdjacentErrorExpectation(normalized, index);
  if (error) return { original, resolved: true, ...error };
  const valueGrounding = resolveValueExpectation(normalized, index);
  if (valueGrounding) return { original, resolved: true, ...valueGrounding };
  const selector = resolveSelectorExpectation(normalized, index);
  if (selector) return { original, resolved: true, ...selector };
  return { original, text: normalized, resolved: false, source: 'narrative', confidence: 0, requiredCapabilities: requiredCapabilitiesForExpectation(normalized) };
}

function resolveExpectedResults(expectedResults = [], pageDiscoveries = []) {
  const index = buildIndex(pageDiscoveries);
  const records = (expectedResults || []).map((value) => resolveExpectation(value, index));
  return {
    results: records.map((record) => record.text),
    records,
    indexStats: {
      selectors: index.entries.length,
      paths: index.paths.size,
      capabilities: Object.fromEntries([...index.capabilityCounts.entries()].sort(([a],[b]) => a.localeCompare(b))),
    },
  };
}

module.exports = {
  buildIndex,
  resolveExpectedResults,
  resolveExpectation,
  normalizeTestIdPhrase,
  requiredCapabilitiesForExpectation,
  supportsRequiredCapabilities,
  resolveValueExpectation,
  resolveAdjacentErrorExpectation,
  quoteMatchesEntryIdentity,
};
