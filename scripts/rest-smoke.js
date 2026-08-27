const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { normalizeManualOperation } = require('../server/services/restApiDiscoveryService');
const { assessRestTestCases, generateRestAutomation } = require('../server/services/restAutomationService');

const operation = normalizeManualOperation({
  method: 'POST',
  path: '/api/customers/{id}',
  summary: 'Create customer',
  headers: { Accept: 'application/json', 'X-Tenant-Id': 'tenant-01' },
  query: { notify: true },
  pathParams: { id: '123' },
  body: { email: 'qa@example.test' },
  responses: { '201': { description: 'Created' }, '400': { description: 'Validation error' } },
});
operation.id = '00000000-0000-0000-0000-000000000001';

assert.equal(operation.requestExample.email, 'qa@example.test');
assert.ok(operation.parameters.some((p) => p.in === 'header' && p.name === 'X-Tenant-Id' && p.example === 'tenant-01'));
assert.ok(operation.parameters.some((p) => p.in === 'query' && p.name === 'notify' && p.example === true));
assert.ok(operation.parameters.some((p) => p.in === 'path' && p.name === 'id' && p.example === '123'));
assert.throws(() => normalizeManualOperation({ method: 'GET', path: '/secure', headers: { Authorization: 'Bearer secret' } }), /runtime authentication/i);

const cases = assessRestTestCases([{
  id: 'TC001',
  title: 'Create customer successfully',
  type: 'positive',
  priority: 'high',
  preconditions: [],
  testData: {},
  steps: [{ action: 'Send POST request', target: '/api/customers/{id}', value: null }],
  expectedResults: ['HTTP 201 is returned'],
  apiRequest: {
    operationKey: 'POST /api/customers/{id}',
    method: 'POST',
    path: '/api/customers/{id}',
    pathParams: { id: '123' },
    query: { notify: true },
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': 'tenant-01' },
    body: { email: 'qa@example.test' },
  },
  apiAssertions: [
    { operation: 'STATUS_EQUALS', status: 201 },
    { operation: 'JSON_PATH_NOT_NULL', path: 'id' },
  ],
}], [operation]);

assert.equal(cases[0].automationReadiness.status, 'READY');
const generated = generateRestAutomation(cases);
assert.equal(generated.framework, 'cypress-rest');
assert.ok(generated.script.includes('cy.request({'));
assert.ok(generated.script.includes('method: "POST"'));
assert.ok(generated.script.includes('failOnStatusCode: false'));
assert.ok(generated.script.includes('X-Tenant-Id'));
assert.ok(generated.script.includes('notify'));
assert.ok(generated.script.includes("Cypress.env('REST_AUTH_SECRET')"));
assert.ok(!generated.script.includes('qa-secret-value'));

const blocked = assessRestTestCases([{
  ...cases[0],
  automationReadiness: undefined,
  apiRequest: { ...cases[0].apiRequest, headers: { Authorization: 'Bearer should-not-be-stored' } },
}], [operation]);
assert.notEqual(blocked[0].automationReadiness.status, 'READY');
assert.equal(blocked[0].automationReadiness.reasonCode, 'REST_SECRET_IN_TEST_CASE');

const demoRoute = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'restDemo.js'), 'utf8');
const projectsRoute = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'projects.js'), 'utf8');
const restUi = fs.readFileSync(path.join(__dirname, '..', 'testpilot-ui', 'rest.html'), 'utf8');
const mainModeUi = fs.readFileSync(path.join(__dirname, '..', 'testpilot-ui', 'defect-assignment.js'), 'utf8');

for (const marker of [
  '/api/rest-demo/discover',
  '/api/rest-demo/normalize-operation',
  '/api/rest-demo/sessions/:sessionId/generate',
  '/api/rest-demo/sessions/:sessionId/run',
  'demoModeOnly',
]) assert.ok(demoRoute.includes(marker), `REST demo route marker missing: ${marker}`);
assert.ok(projectsRoute.includes("router.use(require('./restDemo'))"), 'REST demo router is not mounted.');
for (const marker of ['Database-free demo mode', '/api/rest-demo/discover', 'Swagger / OpenAPI document URL', 'Headers (JSON)', 'Runtime authentication']) {
  assert.ok(restUi.includes(marker), `REST demo UI marker missing: ${marker}`);
}
for (const marker of ['What would you like to test?', 'Web UI testing', 'REST API testing', 'No login required']) {
  assert.ok(mainModeUi.includes(marker), `Main mode/auth UI marker missing: ${marker}`);
}

console.log('REST smoke check passed: manual request templates, deterministic cy.request generation, runtime-secret guardrails, and database-free REST demo wiring are present.');
