const TEST_CATEGORIES = Object.freeze([
  'FUNCTIONAL',
  'SMOKE',
  'REGRESSION',
  'SECURITY',
  'PERFORMANCE',
  'ACCESSIBILITY',
  'LOAD',
  'STRESS',
]);

const TEST_CATEGORY_SET = new Set(TEST_CATEGORIES);
const EXTERNAL_LOAD_CATEGORIES = new Set(['LOAD', 'STRESS']);

function normalizeTestCategory(value, fallback = 'FUNCTIONAL') {
  const normalized = String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  return TEST_CATEGORY_SET.has(normalized) ? normalized : fallback;
}

function inferTestCategory({ story = '', testCase = null } = {}) {
  const explicit = String(testCase?.testCategory || testCase?.category || '').trim();
  if (explicit) return normalizeTestCategory(explicit);

  const text = `${story}\n${testCase?.title || ''}\n${(testCase?.preconditions || []).join(' ')}\n${(testCase?.expectedResults || []).join(' ')}`.toLowerCase();

  if (/\bstress\b|peak\s+concurrency|breaking\s+point|saturation/.test(text)) return 'STRESS';
  if (/\bload\s+test|concurrent\s+users?|virtual\s+users?|requests?\s+per\s+second|\brps\b|throughput/.test(text)) return 'LOAD';
  if (/\bsecurity\b|authorization|access\s+control|xss|cross[- ]site|sql\s+injection|csrf|session\s+security|secure\s+cookie|security\s+header/.test(text)) return 'SECURITY';
  if (/\bperformance\b|response\s+time|page\s+load|latency|web\s+vitals?|largest\s+contentful|\blcp\b|\bfcp\b|time\s+to\s+interactive/.test(text)) return 'PERFORMANCE';
  if (/\baccessibility\b|\ba11y\b|\bwcag\b|keyboard\s+navigation|screen\s+reader|aria/.test(text)) return 'ACCESSIBILITY';
  if (/\bsmoke\b|\bsanity\b|critical\s+path|health\s+check|basic\s+availability/.test(text)) return 'SMOKE';
  if (/\bregression\b|previously\s+working|existing\s+behavior|existing\s+behaviour/.test(text)) return 'REGRESSION';
  return 'FUNCTIONAL';
}

function requiresExternalLoadEngine(value) {
  return EXTERNAL_LOAD_CATEGORIES.has(normalizeTestCategory(value));
}

module.exports = {
  TEST_CATEGORIES,
  normalizeTestCategory,
  inferTestCategory,
  requiresExternalLoadEngine,
};
