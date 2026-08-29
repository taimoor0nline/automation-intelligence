const v4 = require("./automationDslV4");
const { resolveExpectedResults } = require("./expectationGrounding");

function humanizeActionName(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeActionAlias(step) {
  if (!step || typeof step !== "object") return step;
  let action = humanizeActionName(step.action);
  const aliases = new Map([
    ["navigate to", "navigate"],
    ["go to", "navigate"],
    ["fill input", "fill"],
    ["fill textarea", "fill"],
    ["enter input", "fill"],
    ["type input", "fill"],
    ["click element", "click"],
    ["click button", "click"],
    ["click radio", "click"],
    ["click checkbox", "choose"],
    ["select option", "select"],
    ["choose option", "select"],
    ["check checkbox", "choose"],
    ["check radio", "choose"],
    ["check", "choose"],
  ]);
  action = aliases.get(action) || action;
  return { ...step, action };
}

function assertionFromVerificationStep(step) {
  const action = humanizeActionName(step?.action);
  const target = String(step?.target || "").trim();
  const value = step?.value === null || step?.value === undefined ? "" : String(step.value).trim();
  if (!/^verify\b|^assert\b|^expect\b/.test(action)) return "";

  const intent = `${action} ${value}`.replace(/\s+/g, " ").trim().toLowerCase();

  if (/\burl\b|\bpath\b|navigation|redirect/.test(action)) {
    const destination = value || target;
    if (!destination) return "";
    if (/^https?:\/\//i.test(destination)) return `URL equals "${destination}"`;
    if (destination.startsWith("/")) return `Path equals "${destination}"`;
    return `URL includes "${destination}"`;
  }

  if (target && (target.startsWith("[") || target.startsWith("#") || target.startsWith("."))) {
    if (/does not exist|doesn't exist|not exist|\babsent\b|not present|removed/.test(intent)) return `Element ${target} does not exist`;
    if (/not visible|\bhidden\b|\binvisible\b/.test(intent)) return `Element ${target} is hidden`;
    if (/not checked|\bunchecked\b/.test(intent)) return `Element ${target} is unchecked`;
    if (/\bchecked\b/.test(intent)) return `Element ${target} is checked`;
    if (/\bdisabled\b|not enabled/.test(intent)) return `Element ${target} is disabled`;
    if (/\benabled\b/.test(intent)) return `Element ${target} is enabled`;
    if (/\boptional\b|not required/.test(intent)) return `Element ${target} is optional`;
    if (/\brequired\b/.test(intent)) return `Element ${target} is required`;
    if (/\binvalid\b/.test(intent)) return `Element ${target} is invalid`;
    if (/\bvalid\b/.test(intent) && !/\binvalid\b/.test(intent)) return `Element ${target} is valid`;
    if (/text/.test(action) && value) {
      if (/contains|include/.test(intent)) return `Text contains "${value}" in ${target}`;
      return `Text equals "${value}" in ${target}`;
    }
    if (/\bvisible\b|\bshown\b|\bdisplayed\b|\bappears?\b/.test(intent)) return `Element ${target} is visible`;
    // Generic verification of a selector with no explicit state remains an existence/visibility check.
    return `Element ${target} is visible`;
  }
  return "";
}

function normalizeKeyStep(step) {
  const aliased = normalizeActionAlias(step);
  const action = String(aliased?.action || "");
  const match = action.match(/\bpress\s+(?:the\s+)?(?:key\s+)?["']?(Enter|Escape|Esc|UpArrow|DownArrow|LeftArrow|RightArrow|Home|End|Backspace|Delete|Del)["']?\b/i);
  if (!match) return aliased;
  return { ...aliased, action: "Press key", value: aliased?.value || match[1] };
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
  text = text.replace(
    /^\s*text\s+in\s+(\[data-testid=(?:"[^"]+"|'[^']+')\]|#[A-Za-z0-9_-]+|\[name=(?:"[^"]+"|'[^']+')\])\s+(contains?|includes?)\s+(["'`][\s\S]+["'`])\s*$/i,
    (_all, selector, verb, expected) => `Text ${verb} ${expected} in ${selector}`
  );
  return text;
}

function normalizeTestCase(testCase, context = {}) {
  if (!testCase || typeof testCase !== "object") return testCase;
  const sourceSteps = Array.isArray(testCase.steps) ? testCase.steps : [];
  const normalizedSteps = [];
  const promotedAssertions = [];

  for (const sourceStep of sourceSteps) {
    const verification = assertionFromVerificationStep(sourceStep);
    if (verification) {
      promotedAssertions.push(verification);
      continue;
    }
    normalizedSteps.push(normalizeKeyStep(sourceStep));
  }

  const humanExpectedResults = Array.isArray(testCase.expectedResults) ? testCase.expectedResults : [];
  const grounding = resolveExpectedResults(humanExpectedResults, context.pageDiscoveries || []);
  const expectedResults = [
    ...grounding.results.map(normalizeExpectedResult),
    ...promotedAssertions,
  ];

  return {
    ...testCase,
    steps: normalizedSteps,
    expectedResults,
    _expectationGrounding: grounding,
    _humanExpectationCount: humanExpectedResults.length,
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
  return String(value || "").replace(/["'`][^"'`]*["'`]/g, " ");
}

function semanticAssertionText(value, selector) {
  let text = stripQuotedText(value);
  if (selector) text = text.split(String(selector)).join(" ");
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function hasStructuralIntent(operation, value, selector) {
  const text = semanticAssertionText(value, selector);
  switch (operation) {
    case "ASSERT_HIDDEN_OR_ABSENT": return /hidden\s+or\s+absent|absent\s+or\s+hidden|not\s+present\s+or\s+hidden/.test(text);
    case "ASSERT_NOT_EXISTS": return /does not exist|doesn't exist|not exist|\bis absent\b|\bis removed\b|\bnot present\b/.test(text);
    case "ASSERT_HIDDEN": return /\bhidden\b|\bnot visible\b|\binvisible\b/.test(text);
    case "ASSERT_VISIBLE": return /\bvisible\b|\bshown\b|\bdisplayed\b|\bappears?\b/.test(text);
    case "ASSERT_EXISTS": return /\bexists?\b|present in (?:the )?dom/.test(text);
    case "ASSERT_UNCHECKED": return /\bnot checked\b|\bunchecked\b|unselected checkbox|unselected radio/.test(text);
    case "ASSERT_CHECKED": return /\bchecked\b/.test(text) && !/\bnot checked\b|\bunchecked\b/.test(text);
    case "ASSERT_DISABLED": return /\bdisabled\b/.test(text);
    case "ASSERT_ENABLED": return /\benabled\b/.test(text);
    case "ASSERT_FOCUSED": return /\bfocused\b|has focus/.test(text);
    case "ASSERT_NOT_READONLY": return /not read.?only|\beditable\b/.test(text);
    case "ASSERT_READONLY": return /read.?only/.test(text) && !/not read.?only/.test(text);
    case "ASSERT_OPTIONAL": return /\bnot required\b|\boptional\b/.test(text);
    case "ASSERT_REQUIRED": return /\brequired\s+attribute\b|\bhas\s+(?:the\s+)?required\b|\b(?:is|be|remains?|should be|must be)\s+required\b/.test(text);
    case "ASSERT_INVALID": return /\binvalid\b|fails? browser validation|validation state is invalid/.test(text);
    case "ASSERT_VALID": return /\bvalid\b|passes? browser validation|validation state is valid/.test(text) && !/\binvalid\b/.test(text);
    default: return true;
  }
}

const STRUCTURAL_STATE_ASSERTIONS = new Set([
  "ASSERT_HIDDEN_OR_ABSENT",
  "ASSERT_NOT_EXISTS",
  "ASSERT_HIDDEN",
  "ASSERT_VISIBLE",
  "ASSERT_EXISTS",
  "ASSERT_UNCHECKED",
  "ASSERT_CHECKED",
  "ASSERT_DISABLED",
  "ASSERT_ENABLED",
  "ASSERT_FOCUSED",
  "ASSERT_NOT_READONLY",
  "ASSERT_READONLY",
  "ASSERT_OPTIONAL",
  "ASSERT_REQUIRED",
  "ASSERT_INVALID",
  "ASSERT_VALID",
]);

function removeFalseStructuralAssertions(compiled, normalizedTestCase) {
  if (!compiled?.ok || !compiled.plan?.assertions?.length) return compiled;
  const expectedResults = Array.isArray(normalizedTestCase?.expectedResults) ? normalizedTestCase.expectedResults : [];
  const assertions = compiled.plan.assertions.filter((assertion) => {
    if (!STRUCTURAL_STATE_ASSERTIONS.has(assertion.operation)) return true;
    const selector = String(assertion.selector || "");
    const matching = expectedResults.filter((item) => selector && String(item).includes(selector));
    if (!matching.length) return true;
    return matching.some((item) => hasStructuralIntent(assertion.operation, item, selector));
  });
  return { ...compiled, plan: { ...compiled.plan, assertions } };
}

function attachExpectationCoverage(compiled, normalizedTestCase) {
  const grounding = normalizedTestCase?._expectationGrounding;
  const total = Number(normalizedTestCase?._humanExpectationCount || 0);
  if (!grounding || !total) return compiled;

  const unresolvedNarratives = new Set(
    (compiled?.plan?.narrativeExpectations || compiled?.uncompiledExpectations || []).map((value) => String(value))
  );
  const records = grounding.records || [];
  const details = records.map((record, index) => {
    const resolvedText = normalizeExpectedResult(record.text);
    const compiledExpectation = !unresolvedNarratives.has(resolvedText);
    return {
      index,
      expectation: record.original,
      resolvedText,
      grounded: Boolean(record.resolved || record.source === "explicit"),
      groundingSource: record.source,
      compiled: compiledExpectation,
    };
  });
  const compiledCount = details.filter((item) => item.compiled).length;
  const percent = total ? Math.round((compiledCount / total) * 100) : 0;
  const expectationCoverage = {
    total,
    compiled: compiledCount,
    unresolved: Math.max(0, total - compiledCount),
    percent,
    quality: compiledCount === total ? "COMPLETE" : compiledCount > 0 ? "PARTIAL" : "NONE",
    details,
  };

  if (compiled?.ok && compiled.plan) {
    return { ...compiled, expectationCoverage, plan: { ...compiled.plan, expectationCoverage } };
  }
  return { ...compiled, expectationCoverage };
}

function compileTestCase(testCase, context = {}) {
  const normalized = normalizeTestCase(testCase, context);
  let compiled = v4.compileTestCase(normalized, context);
  compiled = removeFalseStructuralAssertions(compiled, normalized);
  compiled = ensureStartNavigation(compiled, context.pageDiscoveries || []);
  return attachExpectationCoverage(compiled, normalized);
}

module.exports = {
  ...v4,
  compileTestCase,
  normalizeTestCase,
  normalizeActionAlias,
  assertionFromVerificationStep,
  semanticAssertionText,
  hasStructuralIntent,
  removeFalseStructuralAssertions,
  attachExpectationCoverage,
};
