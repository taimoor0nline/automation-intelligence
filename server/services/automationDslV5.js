const v4 = require("./automationDslV4");

function normalizeKeyStep(step) {
  const action = String(step?.action || "");
  const match = action.match(/\bpress\s+(?:the\s+)?(?:key\s+)?["']?(Enter|Escape|Esc|UpArrow|DownArrow|LeftArrow|RightArrow|Home|End|Backspace|Delete|Del)["']?\b/i);
  if (!match) return step;
  return { ...step, action: "Press key", value: step?.value || match[1] };
}

function normalizeExpectedResult(value) {
  let text = String(value || "");
  text = text.replace(
    /response\s+status(?:\s*code)?\s+for\s+(["'`][^"'`]+["'`])\s+(?:is|equals?|=)\s+(\d{3})/gi,
    "response status is $2 for $1"
  );
  text = text.replace(
    /http\s+status(?:\s*code)?\s+for\s+(["'`][^"'`]+["'`])\s+(?:is|equals?|=)\s+(\d{3})/gi,
    "HTTP status is $2 for $1"
  );

  // The V3 parser recognizes `Text contains "..."` directly. Human/AI test
  // cases also commonly use `Text in <selector> contains "..."`; normalize
  // that phrasing while keeping the grounded selector in the sentence.
  text = text.replace(
    /^\s*text\s+in\s+(\[data-testid=(?:"[^"]+"|'[^']+')\]|#[A-Za-z0-9_-]+|\[name=(?:"[^"]+"|'[^']+')\])\s+(contains?|includes?)\s+(["'`][\s\S]+["'`])\s*$/i,
    (_all, selector, verb, expected) => `Text ${verb} ${expected} in ${selector}`
  );
  return text;
}

function normalizeTestCase(testCase) {
  if (!testCase || typeof testCase !== "object") return testCase;
  return {
    ...testCase,
    steps: Array.isArray(testCase.steps) ? testCase.steps.map(normalizeKeyStep) : testCase.steps,
    expectedResults: Array.isArray(testCase.expectedResults) ? testCase.expectedResults.map(normalizeExpectedResult) : testCase.expectedResults,
  };
}

function ensureStartNavigation(compiled, pageDiscoveries = []) {
  if (!compiled?.ok || !compiled.plan?.actions?.length) return compiled;
  const actions = [...compiled.plan.actions];
  if (actions.some((item) => item.operation === "NAVIGATE" || item.operation === "LOGIN_VALID")) return compiled;
  const discovery = v4.buildDiscoveryIndex(pageDiscoveries);
  const firstSelectorAction = actions.find((item) => item.selector && discovery.selectorPaths.has(item.selector));
  if (!firstSelectorAction) return compiled;
  const path = discovery.selectorPaths.get(firstSelectorAction.selector);
  if (!path) return compiled;
  let insertAt = 0;
  while (insertAt < actions.length && actions[insertAt].operation === "SET_VIEWPORT") insertAt += 1;
  actions.splice(insertAt, 0, { operation: "NAVIGATE", path });
  return { ...compiled, plan: { ...compiled.plan, actions } };
}

function stripQuotedText(value) {
  return String(value || "").replace(/["'`][^"'`]*["'`]/g, "");
}

function explicitlyAssertsRequiredAttribute(value) {
  const text = stripQuotedText(value).toLowerCase();
  return /\bnot required\b|\boptional\b|\brequired\s+attribute\b|\bhas\s+(?:the\s+)?required\b|\b(?:is|be|remains?|should be|must be)\s+required\b/.test(text);
}

function removeFalseRequiredAssertions(compiled, normalizedTestCase) {
  if (!compiled?.ok || !compiled.plan?.assertions?.length) return compiled;
  const expectedResults = Array.isArray(normalizedTestCase?.expectedResults) ? normalizedTestCase.expectedResults : [];
  const assertions = compiled.plan.assertions.filter((assertion) => {
    if (assertion.operation !== "ASSERT_REQUIRED" && assertion.operation !== "ASSERT_OPTIONAL") return true;
    const selector = String(assertion.selector || "");
    const matching = expectedResults.filter((item) => selector && String(item).includes(selector));
    if (!matching.length) return true;
    return matching.some(explicitlyAssertsRequiredAttribute);
  });
  return { ...compiled, plan: { ...compiled.plan, assertions } };
}

function compileTestCase(testCase, context = {}) {
  const normalized = normalizeTestCase(testCase);
  let compiled = v4.compileTestCase(normalized, context);
  compiled = removeFalseRequiredAssertions(compiled, normalized);
  return ensureStartNavigation(compiled, context.pageDiscoveries || []);
}

module.exports = {
  ...v4,
  compileTestCase,
  normalizeTestCase,
};
