const { modelForProfile } = require('./aiModelProfiles');
const { inferTestCategory } = require('./testCategories');

const REQUEST_TIMEOUT_MS = Math.max(30000, Math.min(Number(process.env.QWEN_TIMEOUT_MS || 180000), 600000));
const MAX_CASES = Math.max(1, Math.min(Number(process.env.AI_REST_TEST_CASE_COUNT || 5), 12));

const PROMPT = `You are a senior REST API QA analyst operating under a strict evidence-grounding contract.
Generate executable REST API test cases from the BUSINESS REQUIREMENT and the supplied API OPERATIONS.

Hard rules:
- Test only selected API operations supplied in API OPERATIONS.
- Never invent an HTTP method, path, parameter, request field, response status, header, enum, validation rule or business rule not present in the requirement or operation evidence.
- A Swagger/OpenAPI operation is contract evidence; the BUSINESS REQUIREMENT determines which behavior is in scope.
- Manual operations may include requestTemplate values. Treat those as grounded baseline request values for headers, query, path parameters and body.
- You may vary a requestTemplate value only when the business requirement or supplied schema explicitly requires a positive, negative, boundary, or alternative-value scenario.
- Manual operations may have less schema evidence. When evidence is insufficient, generate only assertions supported by the requirement and manually supplied operation data.
- Never put passwords, bearer tokens, API keys or other secrets into generated test cases.
- Use relative operation paths exactly as provided.
- Path parameters must be represented in pathParams. Query parameters go in query. Request JSON goes in body. Ordinary non-secret headers go in headers.
- Prefer status assertions and explicit JSON assertions that can be proven from supplied evidence.
- Do not assume a 200 response when the contract declares another success status.
- Negative/boundary tests are allowed only when the business requirement or supplied schema explicitly supports that rule.
- Every test must have at least one deterministic assertion.
- Generate between 1 and requestedMaximumCases test cases. Do not create filler or duplicate tests merely to reach the maximum.

Allowed assertions:
STATUS_EQUALS {status}
HEADER_EXISTS {name}
HEADER_EQUALS {name,value}
JSON_PATH_EXISTS {path}
JSON_PATH_EQUALS {path,value}
JSON_PATH_NOT_NULL {path}
BODY_CONTAINS {text}
RESPONSE_TIME_AT_MOST {milliseconds}

JSON paths use simple dot notation such as data.customer.id. Array indexes may use numeric segments such as data.items.0.id.

Return JSON only:
{
  "feature": string,
  "testCases": [
    {
      "id": "TC001",
      "title": string,
      "type": "positive"|"negative"|"boundary"|"functional",
      "priority": "low"|"medium"|"high",
      "preconditions": [string],
      "testData": object,
      "steps": [{"action": string,"target": string,"value": string|null}],
      "expectedResults": [string],
      "apiRequest": {
        "operationKey": string,
        "method": string,
        "path": string,
        "pathParams": object,
        "query": object,
        "headers": object,
        "body": any
      },
      "apiAssertions": [{"operation": string}]
    }
  ]
}`;

function parseJson(raw) {
  const cleaned = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(cleaned); } catch { throw new Error('AI provider returned invalid REST test JSON.'); }
}

async function callProvider(payload, modelTier) {
  if (!process.env.QWEN_API_KEY || !process.env.QWEN_BASE_URL) throw new Error('AI provider is not configured.');
  const { model } = modelForProfile(modelTier || 'strong');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${process.env.QWEN_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.QWEN_API_KEY}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: JSON.stringify(payload) }],
        response_format: { type: 'json_object' },
        temperature: 0.05,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`AI API error (${response.status}): ${(await response.text().catch(() => '')).slice(0, 300)}`);
    const data = await response.json();
    return parseJson(data.choices?.[0]?.message?.content);
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`AI REST test generation timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)} seconds.`);
    throw err;
  } finally { clearTimeout(timeout); }
}

function requestTemplate(op) {
  const template = { headers: {}, query: {}, pathParams: {}, body: op.request_example ?? op.requestExample ?? null };
  for (const parameter of op.parameters || []) {
    if (parameter?.example === undefined || parameter?.example === null || !parameter?.name) continue;
    const location = String(parameter.in || '').toLowerCase();
    if (location === 'header') template.headers[parameter.name] = parameter.example;
    else if (location === 'query') template.query[parameter.name] = parameter.example;
    else if (location === 'path') template.pathParams[parameter.name] = parameter.example;
  }
  return template;
}

function compactOperation(op) {
  return {
    id: op.id,
    operationKey: op.operation_key || op.operationKey,
    operationId: op.operation_id || op.operationId || null,
    method: op.method,
    path: op.path,
    summary: op.summary || '',
    description: op.description || '',
    parameters: op.parameters || [],
    requestSchema: op.request_schema || op.requestSchema || {},
    requestExample: op.request_example ?? op.requestExample ?? null,
    requestTemplate: requestTemplate(op),
    responses: op.responses || {},
    contentTypes: op.content_types || op.contentTypes || [],
  };
}

function objectOrEmpty(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }

function mergeGroundedRequest(tc, operation) {
  const defaults = operation.requestTemplate || { headers: {}, query: {}, pathParams: {}, body: null };
  const request = tc.apiRequest || {};
  request.pathParams = { ...objectOrEmpty(defaults.pathParams), ...objectOrEmpty(request.pathParams) };
  request.query = { ...objectOrEmpty(defaults.query), ...objectOrEmpty(request.query) };
  request.headers = { ...objectOrEmpty(defaults.headers), ...objectOrEmpty(request.headers) };
  if (!Object.prototype.hasOwnProperty.call(request, 'body') || request.body === undefined) request.body = defaults.body;
  return request;
}

function validate(result, operations) {
  if (!result || !Array.isArray(result.testCases) || !result.testCases.length) throw new Error('AI did not generate REST test cases.');
  if (result.testCases.length > MAX_CASES) throw new Error(`AI generated more than the allowed ${MAX_CASES} REST test cases.`);
  const allowed = new Map(operations.map((op) => [`${String(op.method).toUpperCase()} ${op.path}`, op]));
  const assertions = new Set(['STATUS_EQUALS','HEADER_EXISTS','HEADER_EQUALS','JSON_PATH_EXISTS','JSON_PATH_EQUALS','JSON_PATH_NOT_NULL','BODY_CONTAINS','RESPONSE_TIME_AT_MOST']);
  result.testCases.forEach((tc, index) => {
    tc.id = /^TC\d{3}$/i.test(String(tc.id || '')) ? String(tc.id).toUpperCase() : `TC${String(index + 1).padStart(3, '0')}`;
    if (!tc.title || !tc.apiRequest) throw new Error(`${tc.id} is missing title or apiRequest.`);
    tc.apiRequest.method = String(tc.apiRequest.method || '').toUpperCase();
    tc.apiRequest.path = String(tc.apiRequest.path || '');
    const key = `${tc.apiRequest.method} ${tc.apiRequest.path}`;
    const operation = allowed.get(key);
    if (!operation) throw new Error(`${tc.id} uses an operation that was not selected/discovered: ${key}.`);
    tc.apiRequest = mergeGroundedRequest(tc, operation);
    tc.apiRequest.operationKey = key;
    tc.apiAssertions = Array.isArray(tc.apiAssertions) ? tc.apiAssertions.filter((a) => assertions.has(String(a?.operation || '').toUpperCase())).map((a) => ({ ...a, operation: String(a.operation).toUpperCase() })) : [];
    if (!tc.apiAssertions.length) throw new Error(`${tc.id} has no supported deterministic REST assertion.`);
    tc.steps = Array.isArray(tc.steps) && tc.steps.length ? tc.steps : [{ action: `Send ${tc.apiRequest.method} request`, target: tc.apiRequest.path, value: null }];
    tc.expectedResults = Array.isArray(tc.expectedResults) ? tc.expectedResults : [];
    tc.preconditions = Array.isArray(tc.preconditions) ? tc.preconditions : [];
    tc.testData = tc.testData && typeof tc.testData === 'object' ? tc.testData : {};
    tc.type = ['positive','negative','boundary','functional'].includes(tc.type) ? tc.type : 'functional';
    tc.priority = ['low','medium','high'].includes(tc.priority) ? tc.priority : 'medium';
  });
  return result;
}

async function generateRestTestCases({ story, operations, modelTier = 'strong' }) {
  const compact = (operations || []).slice(0, 100).map(compactOperation);
  if (!compact.length) throw new Error('Select at least one REST operation before generating tests.');
  const result = await callProvider({ businessRequirement: story, apiOperations: compact, requestedMaximumCases: MAX_CASES }, modelTier);
  const validated = validate(result, compact);
  validated.testCases = validated.testCases.map((tc) => {
    const testCategory = inferTestCategory({ story, testCase: tc });
    return { ...tc, testCategory, testData: { ...(tc.testData || {}), __testCategory: testCategory } };
  });
  return validated;
}

module.exports = { generateRestTestCases, MAX_CASES };