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
  catch { throw new Error('AI provider returned invalid JSON for a generation batch.'); }
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
    if (!raw) throw new Error('AI provider returned an empty generation batch.');
    return parseJsonContent(raw);
  } catch (err) {
    if (err.name === 'AbortError') {
      if (attempt < MAX_RETRIES) return callModel(systemPrompt, userPayload, { modelTier: profile, attempt: attempt + 1 });
      throw new Error(`AI generation batch timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s.`);
    }
    throw err;
  } finally { clearTimeout(timeout); }
}

const BATCH_PROMPT = `You are a senior QA test analyst. Generate a SMALL evidence-grounded batch for one explicit testing scope.

Rules:
- The business story defines scope. Discovered pages/controls provide evidence; discovery never broadens the requirement.
- Generate exactly requestedTestCaseCount cases.
- Generate only requestedCategory. Do not include or discuss other categories.
- Generate only requestedScenarioType. Category and scenario type are separate dimensions.
- Never invent selectors, pages, validation rules, messages, boundaries, options or business rules absent from story/discovery evidence.
- Use discovered selectors exactly when technical targets are needed.
- Avoid titles listed in excludeTitles and produce materially different scenarios.
- Tests describe EXPECTED behavior. Do not manufacture failures.
- SECURITY means safe security-functional checks only and must remain within supplied evidence.
- PERFORMANCE means single-user page/API timing expectations only.
- LOAD/STRESS may be classified/planned but must not claim concurrent execution behavior.
- Do not include passwords or secrets.

Return JSON only:
{
  "feature": string,
  "testCases": [{
    "title": string,
    "type": "positive"|"negative"|"boundary"|"functional",
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

function normalizeCaseShape(testCase, category, scenarioType) {
  const tc = testCase && typeof testCase === 'object' ? testCase : {};
  const requestedType = ['positive','negative','boundary','functional'].includes(String(scenarioType || '').toLowerCase()) ? String(scenarioType).toLowerCase() : 'functional';
  return {
    title: String(tc.title || '').trim(),
    type: requestedType,
    priority: ['low','medium','high'].includes(String(tc.priority || '').toLowerCase()) ? String(tc.priority).toLowerCase() : 'medium',
    testCategory: category,
    securitySubcategory: category === 'SECURITY' ? String(tc.securitySubcategory || '').trim().toUpperCase() || null : null,
    severity: category === 'SECURITY' ? String(tc.severity || '').trim().toUpperCase() || null : null,
    preconditions: Array.isArray(tc.preconditions) ? tc.preconditions.map(String).filter(Boolean) : [],
    testData: tc.testData && typeof tc.testData === 'object' ? tc.testData : {},
    steps: Array.isArray(tc.steps) ? tc.steps.map((step) => ({ action: String(step?.action || '').trim(), target: String(step?.target || '').trim(), value: step?.value == null ? null : String(step.value) })).filter((step) => step.action) : [],
    expectedResults: Array.isArray(tc.expectedResults) ? tc.expectedResults.map(String).filter(Boolean) : [],
  };
}

async function generateBatch({ story, pageDiscoveries, environment, category, scenarioType = 'functional', count, excludeTitles = [], securitySubcategories = [], securitySeverities = [], modelTier = 'fast' }) {
  const requestedCount = Math.max(1, Math.min(Number(count) || 1, 5));
  const result = await callModel(BATCH_PROMPT, {
    story,
    pageDiscoveries,
    environment,
    requestedCategory: category,
    requestedScenarioType: scenarioType,
    requestedTestCaseCount: requestedCount,
    excludeTitles: excludeTitles.slice(-20),
    securityScope: category === 'SECURITY' ? { subcategories: securitySubcategories, severities: securitySeverities } : null,
  }, { modelTier });
  if (!Array.isArray(result?.testCases) || result.testCases.length === 0) throw new Error(`AI returned no ${category}/${scenarioType} test cases.`);
  const cases = result.testCases.slice(0, requestedCount).map((tc) => normalizeCaseShape(tc, category, scenarioType));
  if (cases.some((tc) => !tc.title || !tc.steps.length || !tc.expectedResults.length)) throw new Error(`AI returned an incomplete ${category}/${scenarioType} generation batch.`);
  return { feature: result.feature || null, testCases: cases };
}

module.exports = { generateBatch };
