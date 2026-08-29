const v9 = require('./automationDslV9');

function mergeExpectationCoverage(testCase, compiled, context = {}) {
  if (!compiled?.ok || !compiled.plan) return compiled;
  const expectations = Array.isArray(testCase?.expectedResults) ? testCase.expectedResults : [];
  if (!expectations.length) return compiled;
  const discovery = v9.buildDiscoveryIndex(context.pageDiscoveries || []);
  const baseDetails = compiled.plan.expectationCoverage?.details || compiled.expectationCoverage?.details || [];
  const buckets = new Map();
  for (const detail of baseDetails) {
    const key = String(detail.expectation || '');
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(detail);
  }

  const details = expectations.map((expectation, index) => {
    const advanced = v9.parseAdvancedExpectation(expectation, discovery);
    if (advanced?.assertion && !advanced.error) {
      return {
        index,
        expectation,
        resolvedText: String(expectation),
        grounded: true,
        groundingSource: advanced.requirement ? `advanced:${advanced.requirement}` : 'advanced:direct',
        compiled: true,
        operation: advanced.assertion.operation,
      };
    }
    const bucket = buckets.get(String(expectation)) || [];
    const base = bucket.shift();
    if (base) return { ...base, index };
    return {
      index,
      expectation,
      resolvedText: String(expectation),
      grounded: false,
      groundingSource: 'narrative',
      compiled: false,
    };
  });

  const compiledCount = details.filter((item) => item.compiled).length;
  const coverage = {
    total: details.length,
    compiled: compiledCount,
    unresolved: details.length - compiledCount,
    percent: details.length ? Math.round((compiledCount / details.length) * 100) : 0,
    quality: compiledCount === details.length ? 'COMPLETE' : compiledCount > 0 ? 'PARTIAL' : 'NONE',
    details,
  };
  return {
    ...compiled,
    expectationCoverage: coverage,
    plan: { ...compiled.plan, expectationCoverage: coverage },
  };
}

function compileTestCase(testCase, context = {}) {
  return mergeExpectationCoverage(testCase, v9.compileTestCase(testCase, context), context);
}

module.exports = {
  ...v9,
  compileTestCase,
  mergeExpectationCoverage,
};
