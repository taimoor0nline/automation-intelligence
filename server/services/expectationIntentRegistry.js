const INTENT_RULES = [
  { key: 'HIDDEN', patterns: [/hidden/i, /not visible/i, /invisible/i, /absent/i, /not present/i], phrase: (selector) => `Element ${selector} is hidden` },
  { key: 'VISIBLE', patterns: [/visible/i, /shown/i, /displayed/i, /appears?/i, /present/i], phrase: (selector) => `Element ${selector} is visible` },
  { key: 'UNCHECKED', patterns: [/not checked/i, /unchecked/i, /unselected checkbox/i, /unselected radio/i], phrase: (selector) => `Element ${selector} is unchecked` },
  { key: 'CHECKED', patterns: [/\bchecked\b/i, /selected checkbox/i, /selected radio/i], phrase: (selector) => `Element ${selector} is checked` },
  { key: 'DISABLED', patterns: [/\bdisabled\b/i, /cannot be clicked/i, /not clickable/i], phrase: (selector) => `Element ${selector} is disabled` },
  { key: 'ENABLED', patterns: [/\benabled\b/i, /clickable/i], phrase: (selector) => `Element ${selector} is enabled` },
  { key: 'REQUIRED', patterns: [/\brequired\b/i, /mandatory/i], phrase: (selector) => `Element ${selector} is required` },
  { key: 'OPTIONAL', patterns: [/\boptional\b/i, /not required/i], phrase: (selector) => `Element ${selector} is optional` },
  { key: 'INVALID', patterns: [/\binvalid\b/i, /fails? validation/i, /validation error/i], phrase: (selector) => `Element ${selector} is invalid` },
  { key: 'VALID', patterns: [/\bvalid\b/i, /passes? validation/i, /accepted without validation/i], phrase: (selector) => `Element ${selector} is valid` },
  { key: 'EXISTS', patterns: [/\bexists?\b/i, /present in (?:the )?dom/i], phrase: (selector) => `Element ${selector} exists` },
];

function matchesRule(text, rule) {
  return rule.patterns.some((pattern) => pattern.test(String(text || '')));
}

function detectedIntents(text) {
  const source = String(text || '');
  const matches = INTENT_RULES.filter((rule) => matchesRule(source, rule));
  // Negative/stronger states take precedence over their positive counterpart.
  const keys = new Set(matches.map((rule) => rule.key));
  if (keys.has('HIDDEN')) keys.delete('VISIBLE');
  if (keys.has('UNCHECKED')) keys.delete('CHECKED');
  if (keys.has('DISABLED')) keys.delete('ENABLED');
  if (keys.has('OPTIONAL')) keys.delete('REQUIRED');
  if (keys.has('INVALID')) keys.delete('VALID');
  return INTENT_RULES.filter((rule) => keys.has(rule.key));
}

function phrasesForSelector(text, selector) {
  return detectedIntents(text).map((rule) => rule.phrase(selector));
}

function hasSelectorIntent(text) {
  const source = String(text || '');
  return detectedIntents(source).length > 0 || /text|message|panel|reference|label|value|field|button|checkbox|radio|option|error|success/i.test(source);
}

module.exports = {
  INTENT_RULES,
  detectedIntents,
  phrasesForSelector,
  hasSelectorIntent,
};