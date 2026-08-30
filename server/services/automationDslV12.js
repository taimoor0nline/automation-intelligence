const v11 = require('./automationDslV11');
const { normalizeTestCaseForAutomation } = require('./automationCaseNormalizer');

function compileTestCase(testCase, context = {}) {
  const prior = Array.isArray(testCase?._deterministicNormalizations) ? testCase._deterministicNormalizations : [];
  const normalized = normalizeTestCaseForAutomation(testCase, context);
  const normalizations = [...new Set([...prior, ...(normalized?._deterministicNormalizations || [])])];
  const compiled = v11.compileTestCase(normalized, context);
  if (!compiled || !normalizations.length) return compiled;

  if (compiled.ok && compiled.plan) {
    return {
      ...compiled,
      deterministicNormalizations: normalizations,
      plan: {
        ...compiled.plan,
        deterministicNormalizations: normalizations,
      },
    };
  }
  return { ...compiled, deterministicNormalizations: normalizations };
}

module.exports = {
  ...v11,
  compileTestCase,
  normalizeTestCaseForAutomation,
};
