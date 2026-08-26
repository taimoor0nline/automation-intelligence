const v3 = require("./automationDslV3");
const { ASSERTION_OPERATIONS } = require("./assertionRegistry");

function discoveredNetworkHints(pageDiscoveries = []) {
  const hints = [];
  for (const page of pageDiscoveries || []) {
    for (const hint of page?.networkHints || []) {
      const url = String(hint?.url || "").trim();
      if (!url) continue;
      hints.push({ method: hint?.method ? String(hint.method).toUpperCase() : null, url });
    }
  }
  return hints;
}

function isGroundedNetworkAssertion(assertion, hints) {
  const requestedUrl = String(assertion?.urlFragment || "").trim();
  if (!requestedUrl) return false;
  let requestedPath = requestedUrl;
  try {
    const parsed = new URL(requestedUrl);
    requestedPath = `${parsed.pathname}${parsed.search}` || "/";
  } catch {}
  const requestedMethod = assertion?.method ? String(assertion.method).toUpperCase() : null;
  return hints.some((hint) => {
    const methodMatches = !requestedMethod || !hint.method || hint.method === requestedMethod;
    const urlMatches = hint.url === requestedPath || hint.url.includes(requestedPath) || requestedPath.includes(hint.url);
    return methodMatches && urlMatches;
  });
}

function compileTestCase(testCase, context = {}) {
  const compiled = v3.compileTestCase(testCase, context);
  if (!compiled.ok) return compiled;

  const networkAssertions = (compiled.plan?.assertions || []).filter((item) => item.operation.startsWith("ASSERT_REQUEST_") || item.operation.startsWith("ASSERT_RESPONSE_"));
  if (!networkAssertions.length) return compiled;

  const hints = discoveredNetworkHints(context.pageDiscoveries || []);
  const ungrounded = networkAssertions.filter((assertion) => !isGroundedNetworkAssertion(assertion, hints));
  if (!ungrounded.length) return compiled;

  const first = ungrounded[0];
  return {
    ok: false,
    reasonCode: "NETWORK_ENDPOINT_NOT_GROUNDED",
    reason: `The network assertion references an endpoint that was not discovered from the application: ${first.urlFragment}`,
    errors: ungrounded.map((item) => `Undiscovered network endpoint: ${item.method || "*"} ${item.urlFragment}`),
    supportedOperations: [...v3.SUPPORTED_OPERATIONS],
    supportedAssertions: [...ASSERTION_OPERATIONS],
    assertionSuggestions: [{
      expectation: `Verify network behavior for ${first.method || "request"} ${first.urlFragment}`,
      source: "deterministic-grounding",
      capability: "NETWORK_ASSERTIONS",
      proposedOperations: [first.operation],
      cypressStrategy: "Refresh page discovery so same-origin scripts can ground the endpoint, or edit the expected result to use an endpoint actually evidenced by the application.",
    }],
    uncompiledExpectations: compiled.plan?.narrativeExpectations || [],
  };
}

module.exports = {
  ...v3,
  compileTestCase,
  discoveredNetworkHints,
};
