const { READY, INVALID_TEST_CASE, INSUFFICIENT_EVIDENCE, REQUIRES_FRAMEWORK_CAPABILITY, readinessSummary } = require('./testCaseFeasibility');
const { normalizeTestCategory, requiresExternalLoadEngine } = require('./testCategories');

const ALLOWED_ASSERTIONS = new Set(['STATUS_EQUALS','HEADER_EXISTS','HEADER_EQUALS','JSON_PATH_EXISTS','JSON_PATH_EQUALS','JSON_PATH_NOT_NULL','BODY_CONTAINS','RESPONSE_TIME_AT_MOST']);
const SENSITIVE_HEADER = /^(authorization|proxy-authorization|x-api-key|api-key)$/i;

function js(value) { return JSON.stringify(value); }
function numeric(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${label} must be numeric.`);
  return n;
}

function availableOperationMap(operations = []) {
  return new Map(operations.map((op) => [`${String(op.method || '').toUpperCase()} ${String(op.path || '')}`, op]));
}

function validateRequest(testCase, operationMap) {
  const request = testCase?.apiRequest;
  if (!request || typeof request !== 'object') return { ok: false, code: 'REST_REQUEST_MISSING', reason: 'A deterministic REST request definition is required.' };
  const method = String(request.method || '').toUpperCase();
  const path = String(request.path || '');
  const key = `${method} ${path}`;
  if (!operationMap.has(key)) return { ok: false, code: 'REST_OPERATION_NOT_GROUNDED', reason: `${key} is not one of the selected discovered/manual API operations.` };
  const headers = request.headers && typeof request.headers === 'object' ? request.headers : {};
  const secretHeader = Object.keys(headers).find((name) => SENSITIVE_HEADER.test(name));
  if (secretHeader) return { ok: false, code: 'REST_SECRET_IN_TEST_CASE', reason: `${secretHeader} must be supplied through runtime authentication, not stored in a test case.` };
  const placeholders = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
  const pathParams = request.pathParams && typeof request.pathParams === 'object' ? request.pathParams : {};
  const missing = placeholders.filter((name) => pathParams[name] === undefined || pathParams[name] === null || pathParams[name] === '');
  if (missing.length) return { ok: false, code: 'REST_PATH_PARAMETER_MISSING', reason: `Path parameter value(s) required: ${missing.join(', ')}.` };
  return { ok: true, operation: operationMap.get(key) };
}

function validateAssertions(testCase) {
  const assertions = Array.isArray(testCase?.apiAssertions) ? testCase.apiAssertions : [];
  if (!assertions.length) return { ok: false, code: 'REST_ASSERTION_MISSING', reason: 'At least one deterministic REST assertion is required.' };
  for (const assertion of assertions) {
    const operation = String(assertion?.operation || '').toUpperCase();
    if (!ALLOWED_ASSERTIONS.has(operation)) return { ok: false, code: 'REST_ASSERTION_UNSUPPORTED', reason: `Unsupported REST assertion: ${operation || '(missing)'}.` };
    if (operation === 'STATUS_EQUALS' && !Number.isInteger(Number(assertion.status))) return { ok: false, code: 'REST_STATUS_INVALID', reason: 'STATUS_EQUALS requires an integer status.' };
    if ((operation === 'HEADER_EXISTS' || operation === 'HEADER_EQUALS') && !String(assertion.name || '').trim()) return { ok: false, code: 'REST_HEADER_NAME_MISSING', reason: `${operation} requires a header name.` };
    if (operation === 'HEADER_EQUALS' && assertion.value === undefined) return { ok: false, code: 'REST_HEADER_VALUE_MISSING', reason: 'HEADER_EQUALS requires a value.' };
    if (['JSON_PATH_EXISTS','JSON_PATH_EQUALS','JSON_PATH_NOT_NULL'].includes(operation) && !String(assertion.path || '').trim()) return { ok: false, code: 'REST_JSON_PATH_MISSING', reason: `${operation} requires a JSON path.` };
    if (operation === 'JSON_PATH_EQUALS' && assertion.value === undefined) return { ok: false, code: 'REST_JSON_VALUE_MISSING', reason: 'JSON_PATH_EQUALS requires a value.' };
    if (operation === 'BODY_CONTAINS' && !String(assertion.text || '').length) return { ok: false, code: 'REST_BODY_TEXT_MISSING', reason: 'BODY_CONTAINS requires text.' };
    if (operation === 'RESPONSE_TIME_AT_MOST' && !(Number(assertion.milliseconds) > 0)) return { ok: false, code: 'REST_RESPONSE_TIME_INVALID', reason: 'RESPONSE_TIME_AT_MOST requires milliseconds greater than zero.' };
  }
  return { ok: true };
}

function readinessResult(testCase, operations) {
  if (!testCase || !String(testCase.title || '').trim()) return { status: INVALID_TEST_CASE, automatable: false, reasonCode: 'REST_CASE_MALFORMED', reason: 'REST test case title is required.', reasons: ['REST test case title is required.'], resolutionType: 'AI_REPAIRABLE', repairable: true, requiredInputs: [], evidence: [], automationPlan: null, validationSource: 'deterministic-rest' };

  const testCategory = normalizeTestCategory(testCase.testCategory || testCase.category || testCase.testData?.__testCategory);
  if (requiresExternalLoadEngine(testCategory)) {
    return {
      status: REQUIRES_FRAMEWORK_CAPABILITY,
      automatable: false,
      reasonCode: 'LOAD_ENGINE_REQUIRED',
      reason: `${testCategory} testing requires a concurrent load-generation engine rather than Cypress cy.request().`,
      reasons: [`${testCategory} cases remain valid planned/manual tests.`, 'Use a dedicated load adapter such as k6 or Artillery for virtual users, ramp-up, sustained rate and saturation testing.'],
      resolutionType: 'FRAMEWORK_CHANGE_REQUIRED',
      repairable: false,
      requiredInputs: [],
      evidence: ['Recommended engine: k6 or Artillery', 'Current REST engine: Cypress cy.request()'],
      automationPlan: null,
      validationSource: 'deterministic-rest',
    };
  }

  const operationMap = availableOperationMap(operations);
  const request = validateRequest(testCase, operationMap);
  if (!request.ok) return { status: INSUFFICIENT_EVIDENCE, automatable: false, reasonCode: request.code, reason: request.reason, reasons: [request.reason], resolutionType: request.code === 'REST_PATH_PARAMETER_MISSING' ? 'USER_INPUT_REQUIRED' : 'AI_REPAIRABLE', repairable: request.code !== 'REST_PATH_PARAMETER_MISSING', requiredInputs: [], evidence: [], automationPlan: null, validationSource: 'deterministic-rest' };
  const assertion = validateAssertions(testCase);
  if (!assertion.ok) return { status: INVALID_TEST_CASE, automatable: false, reasonCode: assertion.code, reason: assertion.reason, reasons: [assertion.reason], resolutionType: 'AI_REPAIRABLE', repairable: true, requiredInputs: [], evidence: [], automationPlan: null, validationSource: 'deterministic-rest' };
  return {
    status: READY,
    automatable: true,
    reasonCode: 'REST_DETERMINISTIC_READY',
    reason: 'The REST request is grounded to a selected API operation and all assertions compile into the deterministic Cypress request contract. Automation Ready means executable; it does not predict PASS/FAIL.',
    reasons: ['Grounded REST operation', 'Supported deterministic REST assertions'],
    resolutionType: 'NONE',
    repairable: false,
    requiredInputs: [],
    evidence: [{ type: 'test-category', value: testCategory }, { type: 'api-operation', method: request.operation.method, path: request.operation.path, source: request.operation.source }],
    automationPlan: { targetType: 'REST', request: testCase.apiRequest, assertions: testCase.apiAssertions },
    validationSource: 'deterministic-rest',
  };
}

function assessRestTestCases(testCases = [], operations = []) {
  return testCases.map((tc) => ({ ...tc, automationReadiness: readinessResult(tc, operations) }));
}

function emitAssertion(a) {
  const op = String(a.operation).toUpperCase();
  switch (op) {
    case 'STATUS_EQUALS': return `      expect(response.status).to.eq(${numeric(a.status, 'status')});`;
    case 'HEADER_EXISTS': return `      expect(response.headers).to.have.property(${js(String(a.name).toLowerCase())});`;
    case 'HEADER_EQUALS': return `      expect(String(response.headers[${js(String(a.name).toLowerCase())}] ?? '')).to.eq(${js(String(a.value))});`;
    case 'JSON_PATH_EXISTS': return `      expect(readJsonPath(response.body, ${js(a.path)}).exists).to.eq(true);`;
    case 'JSON_PATH_EQUALS': return `      expect(readJsonPath(response.body, ${js(a.path)}).value).to.deep.eq(${js(a.value)});`;
    case 'JSON_PATH_NOT_NULL': return `      { const found = readJsonPath(response.body, ${js(a.path)}); expect(found.exists).to.eq(true); expect(found.value).to.not.eq(null); }`;
    case 'BODY_CONTAINS': return `      expect(typeof response.body === 'string' ? response.body : JSON.stringify(response.body)).to.include(${js(String(a.text))});`;
    case 'RESPONSE_TIME_AT_MOST': return `      expect(Number(response.duration || 0)).to.be.at.most(${numeric(a.milliseconds, 'milliseconds')});`;
    default: throw new Error(`Unsupported REST assertion: ${op}`);
  }
}

function generateRestAutomation(approvedCases = []) {
  if (!approvedCases.length) throw new Error('No REST test cases were approved.');
  for (const tc of approvedCases) if (tc.automationReadiness?.status !== READY) throw new Error(`${tc.id} is not REST Automation Ready.`);
  const blocks = approvedCases.map((tc) => {
    const r = tc.apiRequest;
    const headers = r.headers && typeof r.headers === 'object' ? r.headers : {};
    return `  it(${js(`[${tc.id}] ${tc.title}`)}, () => {\n    const url = buildRequestUrl(${js(r.path)}, ${js(r.pathParams || {})}, ${js(r.query || {})});\n    cy.request({\n      method: ${js(String(r.method).toUpperCase())},\n      url,\n      headers: { ...runtimeAuthHeaders(), ...${js(headers)} },\n      ${r.body === undefined || r.body === null ? '' : `body: ${js(r.body)},\n      `}failOnStatusCode: false,\n    }).then((response) => {\n${(tc.apiAssertions || []).map(emitAssertion).join('\n')}\n    });\n  });`;
  });
  const script = `function runtimeAuthHeaders() {\n  const type = String(Cypress.env('REST_AUTH_TYPE') || 'NONE').toUpperCase();\n  if (type === 'BEARER') { const token = String(Cypress.env('REST_AUTH_SECRET') || ''); if (!token) throw new Error('REST bearer token is not configured.'); return { Authorization: 'Bearer ' + token }; }\n  if (type === 'BASIC') { const username = String(Cypress.env('REST_AUTH_USERNAME') || ''); const password = String(Cypress.env('REST_AUTH_SECRET') || ''); if (!username || !password) throw new Error('REST basic credentials are not configured.'); return { Authorization: 'Basic ' + btoa(username + ':' + password) }; }\n  if (type === 'API_KEY_HEADER') { const name = String(Cypress.env('REST_AUTH_HEADER') || ''); const value = String(Cypress.env('REST_AUTH_SECRET') || ''); if (!name || !value) throw new Error('REST API-key header is not configured.'); return { [name]: value }; }\n  return {};\n}\n\nfunction buildRequestUrl(path, pathParams, query) {\n  let url = String(path);\n  for (const [name, value] of Object.entries(pathParams || {})) url = url.replaceAll('{' + name + '}', encodeURIComponent(String(value)));\n  const pairs = [];\n  for (const [name, value] of Object.entries(query || {})) { if (value === undefined || value === null) continue; if (Array.isArray(value)) value.forEach((item) => pairs.push(encodeURIComponent(name) + '=' + encodeURIComponent(String(item)))); else pairs.push(encodeURIComponent(name) + '=' + encodeURIComponent(String(value))); }\n  if (pairs.length) url += (url.includes('?') ? '&' : '?') + pairs.join('&');\n  return url;\n}\n\nfunction readJsonPath(root, path) {\n  let current = root;\n  for (const part of String(path || '').split('.').filter(Boolean)) { if (current === null || current === undefined || !Object.prototype.hasOwnProperty.call(Object(current), part)) return { exists: false, value: undefined }; current = current[part]; }\n  return { exists: true, value: current };\n}\n\ndescribe('AI TestPilot REST API tests', () => {\n${blocks.join('\n\n')}\n});\n`;
  return { fileName: 'ai-generated-rest.cy.js', framework: 'cypress-rest', language: 'javascript', generationMode: 'deterministic-rest-dsl-v1', script };
}

module.exports = { assessRestTestCases, generateRestAutomation, readinessSummary, ALLOWED_ASSERTIONS };