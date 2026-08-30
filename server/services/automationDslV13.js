const v12 = require('./automationDslV12');

function stripTrailingSentencePunctuation(value) {
  const source = String(value || '');
  // Remove sentence punctuation that appears after a closing quote/backtick. Keep
  // punctuation inside the quoted business value intact, e.g. "Thank you.".
  return source.replace(/(["'`])\s*[.;]\s*$/, '$1');
}

function unwrapNavigationVerificationValue(value) {
  const source = String(value ?? '').trim();
  if (!source) return source;
  const match = source.match(/^\s*(?:equals?|is|includes?|contains?)\s+["'`]([^"'`]+)["'`]\s*[.;]?\s*$/i);
  return match ? match[1] : source;
}

function normalizeVerificationNavigationStep(step) {
  if (!step || typeof step !== 'object') return step;
  const action = String(step.action || '').trim();
  const actionLower = action.toLowerCase();
  const target = String(step.target || '').trim();
  const targetLower = target.toLowerCase();
  if (!/^(verify|assert|expect)\b/.test(actionLower)) return step;
  if (targetLower !== 'url' && targetLower !== 'path' && !/\b(url|path)\b/.test(actionLower)) return step;

  const originalValue = step.value;
  const value = unwrapNavigationVerificationValue(originalValue);
  if (value === originalValue) return step;
  return { ...step, value };
}

function normalizePreCompilerSyntax(testCase) {
  if (!testCase || typeof testCase !== 'object') return testCase;
  return {
    ...testCase,
    steps: Array.isArray(testCase.steps)
      ? testCase.steps.map(normalizeVerificationNavigationStep)
      : testCase.steps,
    expectedResults: Array.isArray(testCase.expectedResults)
      ? testCase.expectedResults.map(stripTrailingSentencePunctuation)
      : testCase.expectedResults,
  };
}

function compileTestCase(testCase, context = {}) {
  return v12.compileTestCase(normalizePreCompilerSyntax(testCase), context);
}

module.exports = {
  ...v12,
  compileTestCase,
  stripTrailingSentencePunctuation,
  unwrapNavigationVerificationValue,
  normalizeVerificationNavigationStep,
  normalizePreCompilerSyntax,
};
