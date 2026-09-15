function clean(value) {
  return String(value ?? '').trim();
}

function issue(code, message, details = null) {
  return { code, message, details };
}

function pageByRef(registry = {}) {
  return new Map((registry.pages || []).map((page) => [String(page.pageRef || ''), page]));
}

function elementByRef(registry = {}) {
  return new Map((registry.elements || []).map((element) => [String(element.elementRef || ''), element]));
}

function normalizeUrl(value, baseUrl = null) {
  try {
    const url = baseUrl ? new URL(String(value || ''), baseUrl) : new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url;
  } catch {
    return null;
  }
}

function pathParts(value, baseUrl = 'http://testnexus.local/') {
  const url = normalizeUrl(value, baseUrl);
  if (!url) return null;
  return {
    pathname: url.pathname || '/',
    search: url.search || '',
    hash: url.hash || '',
    path: `${url.pathname || '/'}${url.search || ''}`,
    url: url.toString(),
    origin: url.origin,
    host: url.host,
    protocol: url.protocol,
  };
}

function destinationForElement(element = {}, pages = new Map()) {
  const page = pages.get(String(element.pageRef || '')) || null;
  const baseUrl = clean(page?.url || '') || 'http://testnexus.local/';
  const explicit = clean(element.destinationUrl || element.href);
  if (!explicit) return null;
  const parsed = pathParts(explicit, baseUrl);
  if (!parsed) return null;
  return {
    ...parsed,
    sameOrigin: Boolean(page?.url && normalizeUrl(page.url)?.origin === parsed.origin),
    target: clean(element.target).toLowerCase() || null,
  };
}

function expectedLocationValues(assertion = {}) {
  const operation = clean(assertion.operation).toUpperCase();
  switch (operation) {
    case 'ASSERT_PATH_EQUALS': return { type: 'pathname-equals', value: clean(assertion.path) };
    case 'ASSERT_PATH_INCLUDES': return { type: 'pathname-includes', value: clean(assertion.fragment) };
    case 'ASSERT_URL_EQUALS': return { type: 'url-equals', value: clean(assertion.url) };
    case 'ASSERT_URL_INCLUDES':
    case 'ASSERT_URL_CONTAINS': return { type: 'url-includes', value: clean(assertion.fragment ?? assertion.path) };
    case 'ASSERT_URL_NOT_INCLUDES': return { type: 'url-not-includes', value: clean(assertion.fragment ?? assertion.path) };
    case 'ASSERT_QUERY_INCLUDES': return { type: 'query-includes', value: clean(assertion.fragment) };
    case 'ASSERT_QUERY_PARAM_EQUALS': return { type: 'query-param-equals', name: clean(assertion.name), value: clean(assertion.value) };
    case 'ASSERT_QUERY_PARAM_ABSENT': return { type: 'query-param-absent', name: clean(assertion.name) };
    case 'ASSERT_HASH_EQUALS': return { type: 'hash-equals', value: clean(assertion.hash) };
    case 'ASSERT_HASH_INCLUDES': return { type: 'hash-includes', value: clean(assertion.hash) };
    case 'ASSERT_ORIGIN_EQUALS': return { type: 'origin-equals', value: clean(assertion.value) };
    case 'ASSERT_HOST_EQUALS': return { type: 'host-equals', value: clean(assertion.value) };
    case 'ASSERT_PROTOCOL_EQUALS': return { type: 'protocol-equals', value: clean(assertion.value) };
    default: return null;
  }
}

function locationMatches(state, expectation) {
  if (!state || !expectation) return true;
  const value = expectation.value || '';
  switch (expectation.type) {
    case 'pathname-equals': return state.pathname === value;
    case 'pathname-includes': return Boolean(value && state.pathname.includes(value));
    case 'url-equals': return Boolean(state.url && normalizeUrl(value, state.origin)?.toString() === state.url);
    case 'url-includes': return Boolean(value && state.url && state.url.includes(value));
    case 'url-not-includes': return Boolean(value && state.url && !state.url.includes(value));
    case 'query-includes': return Boolean(value && state.search.includes(value));
    case 'query-param-equals': {
      const params = new URLSearchParams(state.search || '');
      return params.get(expectation.name) === value;
    }
    case 'query-param-absent': {
      const params = new URLSearchParams(state.search || '');
      return !params.has(expectation.name);
    }
    case 'hash-equals': return state.hash === value;
    case 'hash-includes': return Boolean(value && state.hash.includes(value));
    case 'origin-equals': return state.origin === value;
    case 'host-equals': return state.host === value;
    case 'protocol-equals': return state.protocol === value;
    default: return true;
  }
}

function navigationStateFromPath(path, registry = {}) {
  const pages = registry.pages || [];
  const match = pages.find((page) => clean(page.path) === clean(path));
  if (match?.url) return pathParts(match.url);
  const base = pages.find((page) => page?.url)?.url || 'http://testnexus.local/';
  return pathParts(path, base);
}

function isLocationAssertion(assertion = {}) {
  return Boolean(expectedLocationValues(assertion));
}

function validateNavigationContract(ir = {}, registry = {}) {
  const problems = [];
  const byRef = elementByRef(registry);
  const pages = pageByRef(registry);
  const actions = Array.isArray(ir.actions) ? ir.actions : [];
  const assertions = Array.isArray(ir.assertions) ? ir.assertions : [];
  let state = null;
  let stateKnown = false;
  let lastNavigationSource = null;

  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index] || {};
    const operation = clean(action.operation).toUpperCase();
    const element = action.elementRef ? byRef.get(String(action.elementRef)) : null;

    if (operation === 'NAVIGATE') {
      const next = navigationStateFromPath(action.path ?? action.value, registry);
      if (next) {
        state = next;
        stateKnown = true;
        lastNavigationSource = { type: 'NAVIGATE', index, path: next.path };
      }
      continue;
    }

    if (operation === 'LOGIN_VALID' || operation === 'LOGIN_AS_ACTOR') {
      // Login helper owns its own navigation flow and can redirect according to
      // runtime configuration, so static page context becomes unknown afterwards.
      state = null;
      stateKnown = false;
      lastNavigationSource = { type: operation, index };
      continue;
    }

    if (['GO_BACK', 'GO_FORWARD'].includes(operation)) {
      state = null;
      stateKnown = false;
      lastNavigationSource = { type: operation, index };
      continue;
    }

    if (element && stateKnown && clean(element.path)) {
      const currentPath = clean(state?.path || state?.pathname);
      if (currentPath && currentPath !== clean(element.path)) {
        problems.push(issue(
          'AUTOMATION_ACTION_PAGE_CONTEXT_MISMATCH',
          `${operation} targets ${action.elementRef} from ${element.path}, but the preceding navigation leaves the browser on ${currentPath}. Navigate to the element's page before using it.`,
          { actionIndex: index, elementRef: action.elementRef, expectedPage: element.path, currentPage: currentPath }
        ));
      }
    }

    if (operation === 'CLICK' && element) {
      const destination = destinationForElement(element, pages);
      if (destination?.target === '_blank') {
        problems.push(issue(
          'AUTOMATION_NEW_TAB_NAVIGATION_UNSUPPORTED',
          `CLICK on ${action.elementRef} opens a new tab/window. Rewrite this case to validate the link target or use a configured new-window adapter.`,
          { actionIndex: index, elementRef: action.elementRef, destination: destination.url }
        ));
      }
      if (destination) {
        state = destination;
        stateKnown = true;
        lastNavigationSource = { type: 'CLICK_LINK', index, elementRef: action.elementRef, destination: destination.url };
      }
    }

    if (['SUBMIT', 'PRESS_KEY'].includes(operation)) {
      // These interactions may trigger application-controlled navigation. Keep page
      // state unknown unless the destination is intrinsically known from a link.
      state = null;
      stateKnown = false;
      lastNavigationSource = { type: operation, index, elementRef: action.elementRef || null };
    }
  }

  const locationAssertions = assertions.filter(isLocationAssertion);
  const pathEquals = [...new Set(locationAssertions
    .filter((assertion) => clean(assertion.operation).toUpperCase() === 'ASSERT_PATH_EQUALS')
    .map((assertion) => clean(assertion.path))
    .filter(Boolean))];
  if (pathEquals.length > 1) {
    problems.push(issue(
      'AUTOMATION_CONFLICTING_FINAL_LOCATION_ASSERTIONS',
      `One automation case ends in one browser location, but it contains conflicting final path expectations: ${pathEquals.join(', ')}. Split independent link checks into separate cases or rewrite the flow with explicit navigation checkpoints.`,
      { paths: pathEquals }
    ));
  }

  if (stateKnown && state && locationAssertions.length) {
    for (const assertion of locationAssertions) {
      const expectation = expectedLocationValues(assertion);
      if (!expectation || locationMatches(state, expectation)) continue;
      problems.push(issue(
        'AUTOMATION_NAVIGATION_EXPECTATION_MISMATCH',
        `${clean(assertion.operation).toUpperCase()} expects ${expectation.value || expectation.name || '(value)'}, but the deterministic action sequence ends at ${state.path || state.url}.`,
        { assertion, finalState: state, lastNavigationSource }
      ));
    }
  }

  return problems;
}

module.exports = {
  validateNavigationContract,
  destinationForElement,
  expectedLocationValues,
  locationMatches,
  navigationStateFromPath,
};
