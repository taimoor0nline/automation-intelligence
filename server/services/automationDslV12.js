const v11 = require('./automationDslV11');
const { normalizeTestCaseForAutomation } = require('./automationCaseNormalizer');

function compileTestCase(testCase, context = {}) {
  const normalized = normalizeTestCaseForAutomation(testCase, context);
  const compiled = v11.compileTestCase(normalized, context);
  if (!compiled || !normalized?._deterministicNormalizations?.length) return compiled;

  const normalizations = normalized._deterministicNormalizations;
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
