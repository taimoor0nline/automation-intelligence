const fs = require('fs');
const path = require('path');
const { modelForProfile } = require('./aiModelProfiles');
const { refreshCapabilityConfiguration, visualBaselineMode } = require('./capabilityConfiguration');
const { resolveRuntimeWorkflowContext } = require('./workflowRuntimeContext');

function numberEnv(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function boolEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return !['false', '0', 'no', 'off'].includes(String(value).toLowerCase());
}

const REQUEST_TIMEOUT_MS = Math.max(30000, Math.min(numberEnv(process.env.QWEN_TIMEOUT_MS, 180000), 600000));
const MAX_RETRIES = Math.max(0, Math.min(Math.trunc(numberEnv(process.env.QWEN_MAX_RETRIES, 1)), 3));
const MAX_PLANNED_CASES = 250;
const MAX_GENERATION_BATCH = 10;
const EXTERNAL_CAPABILITIES = ['EMAIL_SMS_OTP','CROSS_ORIGIN_IFRAME','REAL_MULTI_TAB','CAPTCHA_BIOMETRIC','NATIVE_MOBILE','BROWSER_EXTENSION','OS_DIALOG'];

function ensureConfigured() {
  if (!process.env.QWEN_API_KEY || !process.env.QWEN_BASE_URL) throw new Error('AI provider is not configured.');
}

function parseJsonContent(raw) {
  const cleaned = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(cleaned); }
  catch { throw new Error('AI provider returned invalid JSON for test generation.'); }
}

async function callModel(systemPrompt, userPayload, { modelTier = 'fast', attempt = 0 } = {}) {
  ensureConfigured();
  const { profile, model } = modelForProfile(modelTier);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const endpoint = `${process.env.QWEN_BASE_URL.replace(/\/$/, '')}/chat/completions`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.QWEN_API_KEY}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: JSON.stringify(userPayload) }],
        response_format: { type: 'json_object' },
        temperature: 0.05,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      if (response.status >= 500 && attempt < MAX_RETRIES) return callModel(systemPrompt, userPayload, { modelTier: profile, attempt: attempt + 1 });
      if ([401,403].includes(response.status)) throw new Error(`AI authentication failed (${response.status}).`);
      throw new Error(`AI API error (${response.status}): ${body.slice(0, 300)}`);
    }
    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) throw new Error('AI provider returned an empty response.');
    return parseJsonContent(raw);
  } catch (err) {
    if (err.name === 'AbortError') {
      if (attempt < MAX_RETRIES) return callModel(systemPrompt, userPayload, { modelTier: profile, attempt: attempt + 1 });
      throw new Error(`AI request timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s.`);
    }
    throw err;
  } finally { clearTimeout(timeout); }
}

function configuredDirectory(envName, fallback) {
  const raw = String(process.env[envName] || '').trim();
  if (!raw) return fallback;
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

function safeFiles(directory, predicate = () => true, max = 50) {
  try {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.includes('..') && predicate(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, max);
  } catch {
    return [];
  }
}

function namedDatabaseQueryDefinitions() {
  if (!boolEnv(process.env.AUTOMATION_DB_ASSERTIONS_ENABLED, false)) return { names: [], parameters: {} };
  if (!String(process.env.AUTOMATION_DB_ASSERTION_URL || '').trim()) return { names: [], parameters: {} };
  try {
    const parsed = JSON.parse(process.env.AUTOMATION_DB_ASSERTION_QUERIES_JSON || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { names: [], parameters: {} };
    const names = Object.keys(parsed).filter(Boolean).sort().slice(0, 50);
    const parameters = {};
    for (const name of names) {
      const value = parsed[name];
      parameters[name] = value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.params)
        ? value.params.map(String).filter(Boolean)
        : [];
    }
    return { names, parameters };
  } catch {
    return { names: [], parameters: {} };
  }
}

function namedDatabaseQueries() {
  return namedDatabaseQueryDefinitions().names;
}

function configuredExternalCapabilities() {
  if (!String(process.env.AUTOMATION_EXTERNAL_ADAPTER_URL || '').trim()) return [];
  const allowList = String(process.env.AUTOMATION_EXTERNAL_CAPABILITIES || '')
    .split(',').map((value) => value.trim().toUpperCase()).filter(Boolean);
  if (!allowList.length) return [...EXTERNAL_CAPABILITIES];
  const allowed = new Set(EXTERNAL_CAPABILITIES);
  return [...new Set(allowList.filter((value) => allowed.has(value)))];
}

function runtimeCapabilities() {
  const root = path.resolve(__dirname, '..', '..');
  const uploadDir = configuredDirectory('AUTOMATION_UPLOAD_FIXTURE_DIR', path.join(root, 'automation-system', 'fixtures', 'uploads'));
  const baselineDir = configuredDirectory('AUTOMATION_VISUAL_BASELINE_DIR', path.join(root, 'automation-system', 'baselines'));
  const uploadFixtures = safeFiles(uploadDir);
  const visualBaselines = safeFiles(baselineDir, (name) => /\.png$/i.test(name));
  const external = configuredExternalCapabilities();
  const database = namedDatabaseQueryDefinitions();
  const baselineMode = visualBaselineMode();
  const visualCanCreateBaseline = baselineMode === 'create-missing';

  return {
    direct: {
      WEB_VITALS: { available: true, assertions: ['LCP','CLS','INP'] },
      FILE_UPLOAD: { available: uploadFixtures.length > 0, fixtures: uploadFixtures },
      DRAG_AND_DROP: { available: true },
      WEBSOCKET_SSE: { available: true, transports: ['WEBSOCKET','SSE'] },
      BROWSER_PERMISSION: { available: true, mode: 'deterministic permission-state simulation' },
      CLIPBOARD: { available: true, mode: 'application clipboard-write observation' },
      BINARY_DOCUMENT_CONTENT: { available: true, formats: ['txt','csv','json','xml','html','pdf','docx','xls','xlsx','pptx'] },
      VISUAL_REGRESSION: { available: visualBaselines.length > 0 || visualCanCreateBaseline, baselines: visualBaselines, baselineMode, baselineCreationEnabled: visualCanCreateBaseline },
    },
    database: {
      DATABASE_ASSERTIONS: { available: database.names.length > 0, namedQueries: database.names, queryParameters: database.parameters, readOnly: true },
    },
    external: Object.fromEntries(EXTERNAL_CAPABILITIES.map((capability) => [capability, { available: external.includes(capability) }])),
  };
}

const PLAN_PROMPT = `You are a senior QA test architect. Propose the SMALLEST evidence-grounded test suite that gives useful coverage of the supplied business requirement.

Important rules:
- maxTestCases is a HARD UPPER LIMIT, never a target. Never pad the suite just to reach it.
- Decide how many tests are actually justified by the business story and discovered UI evidence. Return between 1 and maxTestCases.
- The business story defines scope. Discovery provides evidence and must not broaden the requirement.
- workflowRequirements, when supplied, are explicit user-authored business workflow requirements. Treat them as authoritative workflow context within the story scope; do not invent extra approval stages, role transitions or state changes.
- actorCatalog contains only configured runtime test roles and never contains credentials. Allocate a cross-role workflow test only when workflowRequirements/story require it and the required roles are present in actorCatalog.
- Preserve user-stated role order in planned rationales, for example Requester -> Manager -> Approver. If a required role is not available in actorCatalog, put that limitation in knownGaps instead of planning an unrunnable role handoff.
- NEVER repurpose an unrelated discovered control to imitate a feature from the story. A search box is not a feedback field, a generic button is not a login button, etc.
- Use only categories in allowedCategories and scenario types in allowedScenarioTypes.
- Positive, negative and boundary are scenario types. FUNCTIONAL is a test category, not a scenario type.
- Each planned test must cover a materially distinct behavior, rule, risk, state or boundary.
- For large suites, keep every unit rationale concise. It is valid to propose 100-200 units when the evidenced application surface genuinely justifies that many distinct tests.
- Do not invent validation rules, boundaries, messages, controls, selectors or business rules that are absent from the story/discovery/workflow requirements.
- runtimeCapabilities is authoritative for advanced automation availability. Use an advanced capability only when the story actually requires it AND runtimeCapabilities marks it available.
- If the story requires an advanced capability that is unavailable, put that limitation in knownGaps instead of allocating an unrunnable test solely for it.
- CAPTCHA/biometric support means an explicitly configured vendor-supported non-production test adapter only. Never propose defeating a production security challenge.
- If the configured ceiling prevents fuller coverage, explicitly list the remaining gaps.
- coverageScore is an AI ESTIMATE of requirement/scenario coverage achieved by this proposed runnable suite, from 0 to 100. It is NOT source-code coverage and NOT a measured execution metric.
- Reduce coverageScore when story-required behavior cannot be covered because a required capability/configuration is unavailable.
- Prefer fewer strong tests over redundant tests.

Return JSON only:
{
  "recommendedTestCaseCount": number,
  "coverageScore": number,
  "coverageSummary": string,
  "coveredAreas": [string],
  "knownGaps": [string],
  "units": [{
    "category": string,
    "scenarioType": "positive"|"negative"|"boundary"|"custom",
    "rationale": string
  }]
}`;

function cleanTextArray(value, max = 20) {
  return [...new Set((Array.isArray(value) ? value : []).map((x) => String(x || '').trim()).filter(Boolean))].slice(0, max);
}

function clampCoverage(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
}

async function proposeGenerationPlan({
  story,
  pageDiscoveries,
  allowedCategories = [],
  allowedScenarioTypes = [],
  customCategories = [],
  customScenarioTypes = [],
  securitySubcategories = [],
  securitySeverities = [],
  maxTestCases = 6,
  modelTier = 'fast',
}) {
  await refreshCapabilityConfiguration();
  const ceiling = Math.max(1, Math.min(Number(maxTestCases) || 1, MAX_PLANNED_CASES));
  const categories = cleanTextArray(allowedCategories.map((x) => String(x).toUpperCase()), 50);
  const scenarioTypes = cleanTextArray(allowedScenarioTypes.map((x) => String(x).toLowerCase()), 20);
  if (!categories.length) throw new Error('At least one test category is required for AI coverage planning.');
  if (!scenarioTypes.length) throw new Error('At least one scenario type is required for AI coverage planning.');

  const runtimeWorkflow = resolveRuntimeWorkflowContext();
  const capabilities = runtimeCapabilities();
  const result = await callModel(PLAN_PROMPT, {
    story,
    workflowRequirements: runtimeWorkflow.workflowRequirements || null,
    actorCatalog: runtimeWorkflow.availableActors,
    workflowActorSequence: runtimeWorkflow.workflowContext.actorSequence,
    pageDiscoveries,
    runtimeCapabilities: capabilities,
    allowedCategories: categories,
    allowedScenarioTypes: scenarioTypes,
    customCategories: cleanTextArray(customCategories),
    customScenarioTypes: cleanTextArray(customScenarioTypes),
    securityScope: categories.includes('SECURITY') ? {
      subcategories: cleanTextArray(securitySubcategories, 50),
      severities: cleanTextArray(securitySeverities, 20),
    } : null,
    maxTestCases: ceiling,
  }, { modelTier });

  const rawUnits = Array.isArray(result?.units) ? result.units : [];
  const units = [];
  for (const raw of rawUnits) {
    if (units.length >= ceiling) break;
    const category = String(raw?.category || '').trim().toUpperCase();
    const scenarioType = String(raw?.scenarioType || '').trim().toLowerCase();
    if (!categories.includes(category) || !scenarioTypes.includes(scenarioType)) continue;
    units.push({
      category,
      scenarioType,
      rationale: String(raw?.rationale || '').trim().slice(0, 500),
    });
  }

  let requested = Math.max(1, Math.min(Math.trunc(Number(result?.recommendedTestCaseCount) || units.length || 1), ceiling));
  if (units.length > requested) units.length = requested;
  while (units.length < requested) {
    const index = units.length;
    units.push({
      category: categories[index % categories.length],
      scenarioType: scenarioTypes[index % scenarioTypes.length],
      rationale: 'Fallback allocation within the AI-recommended runnable suite size.',
    });
  }
  requested = units.length;

  return {
    recommendedTestCaseCount: requested,
    maxTestCases: ceiling,
    coverageScore: clampCoverage(result?.coverageScore),
    coverageSummary: String(result?.coverageSummary || '').trim().slice(0, 1200),
    coveredAreas: cleanTextArray(result?.coveredAreas, 100),
    knownGaps: cleanTextArray(result?.knownGaps, 100),
    runtimeCapabilities: capabilities,
    workflowRequirements: runtimeWorkflow.workflowRequirements || null,
    actorCatalog: runtimeWorkflow.actorCatalog,
    availableActorRefs: runtimeWorkflow.actorCredentialRefs,
    units,
  };
}

const BATCH_PROMPT = `You are a senior QA test analyst. Generate a SMALL evidence-grounded batch for one explicit testing scope.

Rules:
- The business story defines scope. Discovered pages/controls provide evidence; discovery never broadens the requirement.
- Generate exactly requestedTestCaseCount cases for this already-approved planning batch.
- Generate only requestedCategory. Do not include or discuss other categories.
- If requestedCategory is CUSTOM and requestedCustomCategory is supplied, use that custom label as the testing-purpose sub-scope.
- Generate only requestedScenarioType. Category and scenario type are separate dimensions.
- If requestedScenarioType is custom and requestedCustomScenarioType is supplied, use that label to describe how the scenario should behave.
- The batch may contain several materially distinct cases in the same category/scenario scope. Avoid duplicate titles and duplicate behavior.
- NEVER repurpose an unrelated discovered control to imitate story behavior. If the story says feedback but discovery only has search, do not use the search box as feedback.
- Never invent selectors, pages, validation rules, messages, boundaries, options or business rules absent from story/discovery evidence.
- Use discovered selectors exactly when technical targets are needed.
- runtimeCapabilities is authoritative. Never generate an advanced step/assertion for a capability with available=false.
- Prefer ordinary human-readable actions: navigate, fill, clear, click, select, check, uncheck, submit, verify.
- Every expectedResults entry MUST be a deterministic, evidence-grounded assertion that the compiler can verify. Do not write vague outcomes such as "submission triggers processing", "page remains accessible", "field accepts data", or "action succeeds" unless you express the exact observable state.
- Preferred basic expected-result grammar includes:
  * Element #selector is visible | hidden | absent | exists | enabled | disabled | required | valid | invalid.
  * Text in #selector contains "exact discovered text" | equals "exact discovered text" | is non-empty | is empty.
  * Value of #selector equals "value" | contains "value" | is non-empty | is empty.
  * Path equals "/discovered-path" | includes "/fragment".
  * URL includes "evidenced fragment" | does not include "fragment".
  * Selected value of #selector equals "value".
  * Attribute "name" of #selector equals "value" only when discovery/requirement evidences it.
- Use real discovered visible text for text assertions. Never use an id, class, selector or test-id token as display text unless discovery explicitly shows that same literal as rendered text.
- Advanced actions are allowed only when required by the story and available:
  * File upload: {"action":"Upload file","target":"#discoveredFileInput","value":"fixture-name.ext"}. The value MUST be one of runtimeCapabilities.direct.FILE_UPLOAD.fixtures.
  * Drag/drop: {"action":"Drag and drop","target":"#discoveredSource","value":"#discoveredTarget"}.
  * Browser permission: {"action":"Set browser permission","target":"geolocation|camera|microphone|notifications","value":"granted|denied|prompt"}.
  * Adapter-backed native/cross-origin/multi-tab/security actions may be stated plainly only when their named runtimeCapabilities.external capability is available.
- Advanced expected-result grammar supported by the deterministic compiler:
  * Visual: Visual screenshot #selector matches baseline "name.png". Baseline MUST be listed in runtimeCapabilities.direct.VISUAL_REGRESSION.baselines unless baselineCreationEnabled=true.
  * Web Vitals: LCP at most 2500 ms; CLS at most 0.1; INP at most 200 ms.
  * Email/SMS/OTP: Email received containing "text" or SMS received containing "text"; only when EMAIL_SMS_OTP is available.
  * Database: Database query "approved_query_name" field "fieldName" equals "value" OR Database query "approved_query_name" row count equals 1. Query name MUST be listed in runtimeCapabilities.database.DATABASE_ASSERTIONS.namedQueries. If runtimeCapabilities.database.DATABASE_ASSERTIONS.queryParameters lists parameter keys for that query, include those exact keys and values in testData. Never output SQL.
  * Stream: WebSocket message contains "text" or SSE message contains "text".
  * Clipboard: Clipboard equals "text" or Clipboard contains "text".
  * Downloaded semantic document: Downloaded file "report.pdf" contains "Approved". Supported formats are listed in runtimeCapabilities.direct.BINARY_DOCUMENT_CONTENT.formats.
  * Permission: Permission "geolocation" is granted|denied|prompt.
  * Cross-origin iframe / real multi-tab / CAPTCHA-biometric test harness / native mobile / extension / OS dialog: describe the expected outcome clearly only when the corresponding external capability is available; the deterministic compiler routes it to the configured adapter.
- CAPTCHA/biometric means an approved non-production test harness/vendor bypass. Never generate a method to defeat a real production security challenge.
- Avoid arbitrary sleeps; use verification/state expectations.
- Avoid titles listed in excludeTitles and produce materially different scenarios.
- Tests describe EXPECTED behavior. Do not manufacture failures.
- SECURITY means safe security-functional checks only and must remain within supplied evidence.
- PERFORMANCE means single-user page/API timing expectations only.
- Do not include passwords, tokens, connection strings, SQL statements or other secrets. Database tests use named queries only.

Return JSON only:
{
  "feature": string,
  "testCases": [{
    "title": string,
    "type": "positive"|"negative"|"boundary"|"custom",
    "priority": "low"|"medium"|"high",
    "testCategory": string,
    "securitySubcategory": string|null,
    "severity": string|null,
    "preconditions": [string],
    "testData": object,
    "steps": [{"action": string,"target": string,"value": string|null}],
    "expectedResults": [string]
  }]
}`;

function normalizeCaseShape(testCase, category, scenarioType, customCategory = null, customScenarioType = null) {
  const tc = testCase && typeof testCase === 'object' ? testCase : {};
  const requestedType = ['positive','negative','boundary','custom'].includes(String(scenarioType || '').toLowerCase()) ? String(scenarioType).toLowerCase() : 'positive';
  return {
    title: String(tc.title || '').trim(),
    type: requestedType,
    customScenarioType: requestedType === 'custom' ? String(customScenarioType || '').trim() || null : null,
    priority: ['low','medium','high'].includes(String(tc.priority || '').toLowerCase()) ? String(tc.priority).toLowerCase() : 'medium',
    testCategory: category,
    customCategory: category === 'CUSTOM' ? String(customCategory || '').trim() || null : null,
    securitySubcategory: category === 'SECURITY' ? String(tc.securitySubcategory || '').trim().toUpperCase() || null : null,
    severity: category === 'SECURITY' ? String(tc.severity || '').trim().toUpperCase() || null : null,
    preconditions: Array.isArray(tc.preconditions) ? tc.preconditions.map(String).filter(Boolean) : [],
    testData: tc.testData && typeof tc.testData === 'object' ? tc.testData : {},
    steps: Array.isArray(tc.steps) ? tc.steps.map((step) => ({ action: String(step?.action || '').trim(), target: String(step?.target || '').trim(), value: step?.value == null ? null : String(step.value) })).filter((step) => step.action) : [],
    expectedResults: Array.isArray(tc.expectedResults) ? tc.expectedResults.map(String).filter(Boolean) : [],
  };
}

async function generateBatch({ story, pageDiscoveries, environment, category, scenarioType = 'positive', customCategory = null, customScenarioType = null, count, excludeTitles = [], securitySubcategories = [], securitySeverities = [], modelTier = 'fast' }) {
  const requestedCount = Math.max(1, Math.min(Number(count) || 1, MAX_GENERATION_BATCH));
  const capabilities = runtimeCapabilities();
  const result = await callModel(BATCH_PROMPT, {
    story,
    pageDiscoveries,
    runtimeCapabilities: capabilities,
    environment,
    requestedCategory: category,
    requestedCustomCategory: category === 'CUSTOM' ? customCategory : null,
    requestedScenarioType: scenarioType,
    requestedCustomScenarioType: scenarioType === 'custom' ? customScenarioType : null,
    requestedTestCaseCount: requestedCount,
    excludeTitles: excludeTitles.slice(-100),
    securityScope: category === 'SECURITY' ? { subcategories: securitySubcategories, severities: securitySeverities } : null,
  }, { modelTier });
  if (!Array.isArray(result?.testCases) || result.testCases.length === 0) throw new Error(`AI returned no ${category}/${scenarioType} test cases.`);
  const cases = result.testCases.slice(0, requestedCount).map((tc) => normalizeCaseShape(tc, category, scenarioType, customCategory, customScenarioType));
  if (cases.length !== requestedCount) throw new Error(`AI returned ${cases.length}/${requestedCount} ${category}/${scenarioType} cases for the requested batch.`);
  if (cases.some((tc) => !tc.title || !tc.steps.length || !tc.expectedResults.length)) throw new Error(`AI returned an incomplete ${category}/${scenarioType} generation batch.`);
  return { feature: result.feature || null, testCases: cases, runtimeCapabilities: capabilities };
}

module.exports = { proposeGenerationPlan, generateBatch, runtimeCapabilities, configuredExternalCapabilities, namedDatabaseQueries, namedDatabaseQueryDefinitions };
