const { modelForProfile } = require('./aiModelProfiles');

function numberEnv(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const REQUEST_TIMEOUT_MS = Math.max(30000, Math.min(numberEnv(process.env.QWEN_TIMEOUT_MS, 180000), 600000));
const MAX_RETRIES = Math.max(0, Math.min(Math.trunc(numberEnv(process.env.QWEN_MAX_RETRIES, 1)), 3));

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

const PLAN_PROMPT = `You are a senior QA test architect. Propose the SMALLEST evidence-grounded test suite that gives useful coverage of the supplied business requirement.

Important rules:
- maxTestCases is a HARD UPPER LIMIT, never a target. Never pad the suite just to reach it.
- Decide how many tests are actually justified by the business story and discovered UI evidence. Return between 1 and maxTestCases.
- The business story defines scope. Discovery provides evidence and must not broaden the requirement.
- Use only categories in allowedCategories and scenario types in allowedScenarioTypes.
- Positive, negative and boundary are scenario types. FUNCTIONAL is a test category, not a scenario type.
- Each planned test must cover a materially distinct behavior, rule, risk, state or boundary.
- Do not invent validation rules, boundaries, messages, controls, selectors or business rules that are absent from the story/discovery.
- If the configured ceiling prevents fuller coverage, explicitly list the remaining gaps.
- coverageScore is an AI ESTIMATE of requirement/scenario coverage achieved by this proposed suite, from 0 to 100. It is NOT source-code coverage and NOT a measured execution metric.
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
  const ceiling = Math.max(1, Math.min(Number(maxTestCases) || 1, 50));
  const categories = cleanTextArray(allowedCategories.map((x) => String(x).toUpperCase()), 50);
  const scenarioTypes = cleanTextArray(allowedScenarioTypes.map((x) => String(x).toLowerCase()), 20);
  if (!categories.length) throw new Error('At least one test category is required for AI coverage planning.');
  if (!scenarioTypes.length) throw new Error('At least one scenario type is required for AI coverage planning.');

  const result = await callModel(PLAN_PROMPT, {
    story,
    pageDiscoveries,
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
      rationale: 'Fallback allocation within the AI-recommended suite size.',
    });
  }
  requested = units.length;

  return {
    recommendedTestCaseCount: requested,
    maxTestCases: ceiling,
    coverageScore: clampCoverage(result?.coverageScore),
    coverageSummary: String(result?.coverageSummary || '').trim().slice(0, 1200),
    coveredAreas: cleanTextArray(result?.coveredAreas, 30),
    knownGaps: cleanTextArray(result?.knownGaps, 30),
    units,
  };
}

const BATCH_PROMPT = `You are a senior QA test analyst. Generate a SMALL evidence-grounded batch for one explicit testing scope.

Rules:
- The business story defines scope. Discovered pages/controls provide evidence; discovery never broadens the requirement.
- Generate exactly requestedTestCaseCount cases for this already-approved planning unit.
- Generate only requestedCategory. Do not include or discuss other categories.
- If requestedCategory is CUSTOM and requestedCustomCategory is supplied, use that custom label as the testing-purpose sub-scope.
- Generate only requestedScenarioType. Category and scenario type are separate dimensions.
- If requestedScenarioType is custom and requestedCustomScenarioType is supplied, use that label to describe how the scenario should behave.
- Never invent selectors, pages, validation rules, messages, boundaries, options or business rules absent from story/discovery evidence.
- Use discovered selectors exactly when technical targets are needed.
- Prefer human-readable actions from the supported interaction vocabulary: navigate, fill, clear, click, select, check, uncheck, submit, verify. Avoid arbitrary sleeps; use verify when an element must be available.
- Avoid titles listed in excludeTitles and produce materially different scenarios.
- Tests describe EXPECTED behavior. Do not manufacture failures.
- SECURITY means safe security-functional checks only and must remain within supplied evidence.
- PERFORMANCE means single-user page/API timing expectations only.
- Do not include passwords or secrets.

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
  const requestedCount = Math.max(1, Math.min(Number(count) || 1, 5));
  const result = await callModel(BATCH_PROMPT, {
    story,
    pageDiscoveries,
    environment,
    requestedCategory: category,
    requestedCustomCategory: category === 'CUSTOM' ? customCategory : null,
    requestedScenarioType: scenarioType,
    requestedCustomScenarioType: scenarioType === 'custom' ? customScenarioType : null,
    requestedTestCaseCount: requestedCount,
    excludeTitles: excludeTitles.slice(-20),
    securityScope: category === 'SECURITY' ? { subcategories: securitySubcategories, severities: securitySeverities } : null,
  }, { modelTier });
  if (!Array.isArray(result?.testCases) || result.testCases.length === 0) throw new Error(`AI returned no ${category}/${scenarioType} test cases.`);
  const cases = result.testCases.slice(0, requestedCount).map((tc) => normalizeCaseShape(tc, category, scenarioType, customCategory, customScenarioType));
  if (cases.some((tc) => !tc.title || !tc.steps.length || !tc.expectedResults.length)) throw new Error(`AI returned an incomplete ${category}/${scenarioType} generation batch.`);
  return { feature: result.feature || null, testCases: cases };
}

module.exports = { proposeGenerationPlan, generateBatch };
