function clean(value) { return String(value ?? '').trim(); }
function lower(value) { return clean(value).toLowerCase(); }
function boolEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return !['false','0','no','off'].includes(String(value).toLowerCase());
}
function issue(code, message) { return { code, message }; }

const DEFAULT_VIEWPORTS = Object.freeze([
  Object.freeze({ width: 375, height: 667, name: 'mobile' }),
  Object.freeze({ width: 768, height: 1024, name: 'tablet' }),
  Object.freeze({ width: 1440, height: 900, name: 'desktop' }),
]);

function configuredViewports() {
  try {
    const raw = JSON.parse(process.env.WEB_COMPATIBILITY_VIEWPORTS_JSON || 'null');
    const values = Array.isArray(raw) ? raw : DEFAULT_VIEWPORTS;
    const out = [];
    for (const item of values) {
      const width = Number(Array.isArray(item) ? item[0] : item?.width);
      const height = Number(Array.isArray(item) ? item[1] : item?.height);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width < 240 || height < 240 || width > 7680 || height > 4320) continue;
      out.push({ width, height, name: clean(item?.name) || `${width}x${height}` });
    }
    return out.length ? out : [...DEFAULT_VIEWPORTS];
  } catch {
    return [...DEFAULT_VIEWPORTS];
  }
}

function storyText(testCase, context = {}) {
  return [context.story, testCase?.generationStory, testCase?.title, testCase?.coverageRationale, ...(testCase?.preconditions || []), ...(testCase?.expectedResults || [])]
    .filter(Boolean).join('\n').toLowerCase();
}

function facts(pageDiscoveries = []) {
  const pages = pageDiscoveries || [];
  const elements = pages.flatMap((page) => page?.elements || []);
  const messages = pages.flatMap((page) => page?.messages || []);
  const network = pages.flatMap((page) => page?.networkHints || []);
  const browserState = pages.map((page) => page?.browserState || {});
  const identity = (item) => [item?.tag,item?.type,item?.role,item?.id,item?.name,item?.testId,item?.label,item?.text,item?.ariaLabel,item?.placeholder,item?.autocomplete].filter(Boolean).join(' ').toLowerCase();
  const hasPassword = elements.some((item) => lower(item?.type) === 'password');
  const hasUsername = elements.some((item) => lower(item?.type) !== 'password' && /user.?name|email|login|account/.test(identity(item)));
  const hasSubmit = elements.some((item) => /sign\s*in|log\s*in|login|submit|continue/.test(identity(item)) && (['button','submit'].includes(lower(item?.type)) || lower(item?.tag) === 'button' || lower(item?.role) === 'button'));
  const validationControls = elements.filter((item) => item?.required || item?.pattern || item?.min != null || item?.max != null || item?.minlength != null || item?.maxlength != null || item?.errorElement);
  const securityHeaderNames = new Set();
  for (const hint of network) for (const key of Object.keys(hint?.responseHeaders || {})) securityHeaderNames.add(lower(key));
  const storageKeys = new Set();
  for (const state of browserState) {
    for (const key of state.cookieNames || []) storageKeys.add(String(key));
    for (const key of state.localStorageKeys || []) storageKeys.add(String(key));
    for (const key of state.sessionStorageKeys || []) storageKeys.add(String(key));
  }
  return {
    pages,
    elements,
    messages,
    network,
    storageKeys,
    securityHeaderNames,
    hasLoginControls: hasPassword && hasUsername && hasSubmit,
    validationControls,
    hasFileInput: elements.some((item) => lower(item?.tag) === 'input' && lower(item?.type) === 'file'),
    usesHttps: pages.some((page) => String(page?.finalUrl || page?.url || '').startsWith('https://')),
  };
}

function performanceThresholdConfigured(testCase, context = {}) {
  const text = storyText(testCase, context);
  if (/\b\d+(?:\.\d+)?\s*(?:ms|milliseconds?|s|seconds?)\b/.test(text)) return true;
  if (/\b(?:lcp|inp|cls)\b[^\n]{0,80}\b\d+(?:\.\d+)?\b/.test(text)) return true;
  try {
    const policy = JSON.parse(process.env.WEB_PERFORMANCE_THRESHOLDS_JSON || '{}');
    return policy && typeof policy === 'object' && !Array.isArray(policy) && Object.keys(policy).length > 0;
  } catch { return false; }
}

function compatibilityPolicy(testCase, context = {}) {
  const allowed = configuredViewports();
  const problems = [];
  const viewportActions = (testCase?.canonicalIr?.actions || []).filter((item) => clean(item?.operation).toUpperCase() === 'SET_VIEWPORT');
  for (const action of viewportActions) {
    const width = Number(action.width), height = Number(action.height);
    const explicitlyStated = storyText(testCase, context).includes(String(width)) && storyText(testCase, context).includes(String(height));
    const configured = allowed.some((item) => item.width === width && item.height === height);
    if (!configured && !explicitlyStated) {
      problems.push(issue('WEB_COMPATIBILITY_VIEWPORT_UNAPPROVED', `Viewport ${width}x${height} is neither stated in the requirement nor present in the configured compatibility viewport policy.`));
    }
  }
  return problems;
}

function securityPolicy(testCase, context = {}, discovered = facts(context.pageDiscoveries || [])) {
  if (clean(testCase?.testCategory).toUpperCase() !== 'SECURITY') return [];
  const subcategory = clean(testCase?.securitySubcategory).toUpperCase();
  const text = storyText(testCase, context);
  const explicit = (pattern) => pattern.test(text);
  const activeSecurity = boolEnv(process.env.WEB_ACTIVE_SECURITY_TESTING_ENABLED, false);
  const repeatedSecurity = boolEnv(process.env.WEB_REPEATED_SECURITY_TESTING_ENABLED, false);
  const externalSecurity = boolEnv(process.env.WEB_EXTERNAL_SECURITY_ADAPTER_ENABLED, false);
  const problems = [];

  if (!subcategory || subcategory === 'CUSTOM') {
    problems.push(issue('WEB_SECURITY_SUBCATEGORY_REQUIRED', 'Security cases require one supported, explicit security subcategory. Generic/CUSTOM security cases are not executable in the web runner.'));
    return problems;
  }

  switch (subcategory) {
    case 'AUTHENTICATION':
      if (!discovered.hasLoginControls) problems.push(issue('WEB_SECURITY_EVIDENCE_MISSING', 'Authentication testing requires a grounded rendered login surface.'));
      break;
    case 'INPUT_VALIDATION':
      if (!discovered.validationControls.length) problems.push(issue('WEB_SECURITY_EVIDENCE_MISSING', 'Input-validation security testing requires rendered controls with validation/error evidence.'));
      break;
    case 'ERROR_INFORMATION_LEAKAGE':
      if (!discovered.messages.length && !explicit(/stack trace|debug information|error leakage|information leakage|verbose error/)) problems.push(issue('WEB_SECURITY_EVIDENCE_MISSING', 'Error-information-leakage testing requires a rendered error surface or an explicit requirement.'));
      break;
    case 'SECURITY_HEADERS':
      if (!discovered.securityHeaderNames.size) problems.push(issue('WEB_SECURITY_EVIDENCE_MISSING', 'Security-header assertions require headers observed by browser discovery.'));
      break;
    case 'SESSION_MANAGEMENT':
      if (!discovered.storageKeys.size && !explicit(/session|logout|timeout|cookie/)) problems.push(issue('WEB_SECURITY_EVIDENCE_MISSING', 'Session-management testing requires observed browser-state keys or an explicit session requirement.'));
      break;
    case 'FILE_UPLOAD':
      if (!discovered.hasFileInput) problems.push(issue('WEB_SECURITY_EVIDENCE_MISSING', 'File-upload security testing requires a rendered file input.'));
      break;
    case 'TLS_TRANSPORT':
      if (!discovered.usesHttps) problems.push(issue('WEB_SECURITY_EVIDENCE_MISSING', 'TLS transport testing requires an HTTPS target.'));
      if (!explicit(/tls|https|transport security|certificate/) && !boolEnv(process.env.WEB_TLS_POLICY_ENABLED, false)) problems.push(issue('WEB_SECURITY_POLICY_REQUIRED', 'TLS assertions require an explicit requirement or configured TLS policy; selecting Security alone is not sufficient.'));
      break;
    case 'AUTHORIZATION_RBAC':
    case 'ACCESS_CONTROL':
    case 'BUSINESS_LOGIC_ABUSE':
      if (!explicit(/authorization|rbac|role|permission|access control|unauthori[sz]ed|forbidden|workflow|business logic|bypass/)) problems.push(issue('WEB_SECURITY_POLICY_REQUIRED', `${subcategory} testing requires an explicit role/access/workflow requirement; the selected category alone cannot invent one.`));
      if (!context.actorCredentialRefs?.length && subcategory === 'AUTHORIZATION_RBAC') problems.push(issue('WEB_SECURITY_EVIDENCE_MISSING', 'RBAC execution requires configured role-based test actors.'));
      break;
    case 'XSS':
    case 'SQL_COMMAND_INJECTION':
      if (!activeSecurity) problems.push(issue('WEB_ACTIVE_SECURITY_MODE_REQUIRED', `${subcategory} is an active security probe and is disabled in generic web execution unless WEB_ACTIVE_SECURITY_TESTING_ENABLED is explicitly enabled.`));
      if (!explicit(/xss|cross[- ]site scripting|sql injection|command injection|injection security test/)) problems.push(issue('WEB_SECURITY_POLICY_REQUIRED', `${subcategory} requires explicit story/security scope; selecting the subcategory is not enough to inject payloads into an arbitrary site.`));
      break;
    case 'RATE_LIMITING':
      if (!repeatedSecurity) problems.push(issue('WEB_REPEATED_SECURITY_MODE_REQUIRED', 'Rate-limit/brute-force style repeated requests are disabled unless WEB_REPEATED_SECURITY_TESTING_ENABLED is explicitly enabled.'));
      if (!explicit(/rate limit|429|too many requests|brute force|attempts/)) problems.push(issue('WEB_SECURITY_POLICY_REQUIRED', 'Rate-limit testing requires an explicit requirement/policy.'));
      break;
    case 'CSRF':
    case 'CORS':
    case 'LOGGING_AUDIT':
      if (!externalSecurity) problems.push(issue('WEB_EXTERNAL_SECURITY_CAPABILITY_REQUIRED', `${subcategory} requires a dedicated security/integration adapter and is not inferred from ordinary DOM testing.`));
      break;
    case 'DEPENDENCY_VULNERABILITY_SCAN':
      problems.push(issue('WEB_NON_BROWSER_SECURITY_CAPABILITY', 'Dependency vulnerability scanning is not a Cypress browser scenario. It belongs to source/SCA scanning and must not be generated as a browser test.'));
      break;
    case 'API_SECURITY':
      problems.push(issue('WEB_NON_BROWSER_SECURITY_CAPABILITY', 'API security belongs to the dedicated API-testing workflow, not the web-browser test generator.'));
      break;
    case 'COOKIES':
      if (!discovered.storageKeys.size) problems.push(issue('WEB_SECURITY_EVIDENCE_MISSING', 'Cookie testing requires browser-observed cookie/session evidence. HttpOnly/Secure/SameSite flags need response-header evidence or an adapter.'));
      break;
    case 'SENSITIVE_DATA_EXPOSURE':
      if (!explicit(/sensitive data|secret|password exposure|pii|information disclosure/)) problems.push(issue('WEB_SECURITY_POLICY_REQUIRED', 'Sensitive-data-exposure assertions require an explicit data-classification/expected-behavior rule.'));
      break;
    default:
      problems.push(issue('WEB_SECURITY_SUBCATEGORY_UNSUPPORTED', `Security subcategory ${subcategory} is not supported by the strict browser scenario policy.`));
  }
  return problems;
}

function validateWebScenarioPolicy(testCase, context = {}) {
  const category = clean(testCase?.testCategory || testCase?.category).toUpperCase();
  const discovered = facts(context.pageDiscoveries || []);
  const problems = [];

  if (!discovered.pages.length) return { ok: false, errors: [issue('WEB_RENDERED_DISCOVERY_REQUIRED', 'At least one rendered HTML page is required before a web test can become Automation Ready.')] };

  if (category === 'PERFORMANCE' && !performanceThresholdConfigured(testCase, context)) {
    problems.push(issue('WEB_PERFORMANCE_POLICY_REQUIRED', 'Performance cases require an explicit threshold in the requirement or WEB_PERFORMANCE_THRESHOLDS_JSON. AI may not invent pass/fail performance limits.'));
  }
  if (category === 'COMPATIBILITY') problems.push(...compatibilityPolicy(testCase, context));
  if (category === 'INTEGRATION' && !discovered.network.length && !explicitIntegrationEvidence(testCase, context)) {
    problems.push(issue('WEB_INTEGRATION_EVIDENCE_REQUIRED', 'Integration tests require an observed browser network/integration surface or an explicit configured integration contract.'));
  }
  if (category === 'SECURITY') problems.push(...securityPolicy(testCase, context, discovered));
  if (['API','LOAD','STRESS','CUSTOM'].includes(category)) {
    problems.push(issue('WEB_CATEGORY_NOT_BROWSER_EXECUTABLE', `${category} is not executable through the strict generic web-browser pipeline.`));
  }

  return { ok: problems.length === 0, errors: problems, viewports: configuredViewports() };
}

function explicitIntegrationEvidence(testCase, context = {}) {
  const text = storyText(testCase, context);
  return /integration|websocket|eventsource|sse|database|external service|webhook|third[- ]party/.test(text) && boolEnv(process.env.WEB_INTEGRATION_CONTRACT_ENABLED, false);
}

module.exports = {
  DEFAULT_VIEWPORTS,
  configuredViewports,
  facts,
  validateWebScenarioPolicy,
  securityPolicy,
  performanceThresholdConfigured,
  compatibilityPolicy,
};
