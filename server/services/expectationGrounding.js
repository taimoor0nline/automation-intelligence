const INDEX_CACHE = new WeakMap();
const { phrasesForSelector, hasSelectorIntent } = require('./expectationIntentRegistry');

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
  return [selector,item?.testId,item?.id,item?.name,item?.label,item?.text,item?.placeholder,item?.ariaLabel,item?.title,item?.type,item?.tag]
    .filter(Boolean).join(' ');
}

function buildIndex(pageDiscoveries = []) {
  if (pageDiscoveries && typeof pageDiscoveries === 'object' && INDEX_CACHE.has(pageDiscoveries)) return INDEX_CACHE.get(pageDiscoveries);
  const entries = [];
  const paths = new Set();
  const seenSelectors = new Set();
  const register = (item, path) => {
    const selector = selectorFor(item);
    if (!selector || seenSelectors.has(selector)) return;
    seenSelectors.add(selector);
    entries.push({ selector, item, path, words: new Set(semanticWords(itemText(item, selector))) });
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
  if (!/redirect|navigat|land|arriv|open|route|path/.test(lower)) return null;
  let best = null;
  for (const path of index.paths) {
    if (path === '/') continue;
    const words = semanticWords(path);
    if (!words.length) continue;
    const score = words.reduce((sum, word) => sum + (lower.includes(word) ? 1 : 0), 0);
    if (!score) continue;
    if (!best || score > best.score) best = { path, score };
  }
  if (!best) return null;
  return { text: `Path equals "${best.path}"`, source: 'discovery-path', path: best.path, confidence: best.score };
}

function candidateScore(expectationWords, entry) {
  let score = 0;
  for (const word of expectationWords) if (entry.words.has(word)) score += 1;
  return score;
}

function resolveSelectorExpectation(text, index) {
  if (!hasSelectorIntent(text)) return null;
  const words = semanticWords(text);
  if (!words.length) return null;
  let best = null;
  let secondScore = 0;
  for (const entry of index.entries) {
    const score = candidateScore(words, entry);
    if (!best || score > best.score) {
      secondScore = best?.score || 0;
      best = { entry, score };
    } else if (score > secondScore) secondScore = score;
  }
  // Strong, unambiguous local evidence only. This keeps the resolver scalable without guessing.
  if (!best || best.score < 2 || best.score === secondScore) return null;

  const selector = best.entry.selector;
  const quotes = quotedValues(text).filter((value) => !value.includes('data-testid') && value !== selector);
  const quotedMessage = quotes.length ? quotes[quotes.length - 1] : '';
  const parts = phrasesForSelector(text, selector);
  if (!parts.length) parts.push(`Element ${selector} exists`);

  if (quotedMessage && /text|message|panel|reference|label|thank|error|required|success/i.test(text)) {
    parts.push(`Text contains "${quotedMessage}" in ${selector}`);
  }

  return { text: parts.join(' and '), source: 'discovery-selector', selector, confidence: best.score };
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
  return { results: records.map((record) => record.text), records, indexStats: { selectors: index.entries.length, paths: index.paths.size } };
}

module.exports = { buildIndex, resolveExpectedResults, resolveExpectation, normalizeTestIdPhrase };
