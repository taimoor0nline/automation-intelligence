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

function compileTestCase(testCase, context = {}) {
  const normalized = normalizeTestCase(testCase);
  const compiled = v4.compileTestCase(normalized, context);
  return ensureStartNavigation(compiled, context.pageDiscoveries || []);
}

module.exports = {
  ...v4,
  compileTestCase,
  normalizeTestCase,
};
