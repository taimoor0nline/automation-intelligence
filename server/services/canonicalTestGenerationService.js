const { modelForProfile } = require('./aiModelProfiles');
const { runtimeCapabilities } = require('./progressiveTestGenerator');
const { registryForModel } = require('./canonicalElementRegistry');
const { publicActorCatalog } = require('./testActorProfiles');
const { IR_VERSION, canonicalActionCatalog, canonicalAssertionCatalog, validateCanonicalIr } = require('./canonicalTestIrV3');
const { generateCypressPreviewFromPlan } = require('./deterministicAutomationGeneratorV6');

function numberEnv(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const REQUEST_TIMEOUT_MS = Math.max(30000, Math.min(numberEnv(process.env.QWEN_TIMEOUT_MS, 90000), 600000));
const MAX_RETRIES = Math.max(0, Math.min(Math.trunc(numberEnv(process.env.QWEN_MAX_RETRIES, 0)), 3));

function parseJsonContent(raw) {
  const cleaned = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(cleaned); }
  catch { throw new Error('AI provider returned invalid JSON for canonical test generation.'); }
}

async function callModel(systemPrompt, userPayload, { modelTier = 'fast', attempt = 0 } = {}) {
  if (!process.env.QWEN_API_KEY || !process.env.QWEN_BASE_URL) throw new Error('AI provider is not configured.');
  const { profile, model } = modelForProfile(modelTier);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const endpoint = `${process.env.QWEN_BASE_URL.replace(/\/$/, '')}/chat/completions`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.QWEN_API_KEY}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: JSON.stringify(userPayload) }],
        response_format: { type: 'json_object' },
        temperature: 0.02,
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
    if (!raw) throw new Error('AI provider returned an empty canonical generation response.');
    return parseJsonContent(raw);
  } catch (err) {
    if (err.name === 'AbortError') {
      if (attempt < MAX_RETRIES) return callModel(systemPrompt, userPayload, { modelTier: profile, attempt: attempt + 1 });
      const timeoutError = new Error(`AI canonical generation request timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s.`);
      timeoutError.code = 'AI_CANONICAL_REQUEST_TIMEOUT';
      throw timeoutError;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const CANONICAL_PROMPT = `You are TestNexus's canonical test-case generator. The coverage planner has already decided WHAT each planned unit must test. Your job is only to express each supplied planned unit as strict Canonical Test IR.

NON-NEGOTIABLE CONTRACT:
- Return exactly one case for every planned unit, using its exact plannedId. Do not omit, merge, replace, reorder semantically, or substitute another validation/field/boundary.
- The planned objective is authoritative. A planned email-format test may not become a subject-length test. A planned login-empty-field test may not become a feedback validation test.
- Use only elementRef values supplied in canonicalElementRegistry. NEVER output CSS selectors, XPath, ids, test ids, invented controls, or raw DOM targets.
- Use only canonical action/assertion operations supplied in the catalogs.
- English prose is display metadata only. actions/assertions are the execution truth.
- If a field must be empty, use CLEAR rather than TYPE with an empty value.
- When a login-negative case needs the configured valid username or password while testing the other credential, use TYPE_RUNTIME_CREDENTIAL with credential username|password. Never invent credential literals.
- LOGIN_VALID is for a complete valid-login precondition/workflow using the default runtime credentials, not for a negative login case that must leave or alter one credential.
- actorCatalog is authoritative for role-based users. When the planned objective explicitly requires a configured role/user handoff, use LOGIN_AS_ACTOR with an actorRef from actorCatalog. Never invent actorRef values, usernames or passwords.
- LOGIN_AS_ACTOR changes the authenticated runtime identity. Use it only when the business workflow genuinely requires that actor/role. Subsequent actions/assertions belong to that actor until another LOGIN_AS_ACTOR occurs.
- Usernames/passwords for actors are never provided to you. Do not ask for, infer or output them.
- SELECT uses the discovered option value from the element registry.
- Exact text assertions are allowed only when the literal is independently evidenced by canonicalElementRegistry. If exact text is not discovered, use visibility, validity, non-empty text, or another deterministic structural assertion instead of inventing a message.
- Navigation uses discovered paths only.
- Do not output raw SQL, credentials, API keys, tokens or connection strings. Database assertions use configured named queries only.
- Advanced operations may be used only when runtimeCapabilities says the capability is available/configured.
- Tests describe expected behavior; never manufacture a failure.

ACTION FIELD CONTRACT:
- LOGIN_VALID: {operation}
- LOGIN_AS_ACTOR: {operation,actorRef}
- NAVIGATE: {operation,path}
- TYPE: {operation,elementRef,value}
- TYPE_RUNTIME_CREDENTIAL: {operation,elementRef,credential:"username"|"password"}
- CLEAR/CLICK/DBLCLICK/RIGHTCLICK/HOVER/FOCUS/BLUR/CHECK/UNCHECK/SUBMIT/SCROLL_INTO_VIEW: {operation,elementRef}
- SELECT: {operation,elementRef,value}
- PRESS_KEY: {operation,elementRef,key}
- SET_VIEWPORT: {operation,width,height}
- SELECT_FILE: {operation,elementRef,fileName}
- DRAG_DROP: {operation,sourceElementRef,targetElementRef}
- SET_PERMISSION_STATE: {operation,permission,state}
- EXTERNAL_ADAPTER_ACTION: {operation,capability,action,payload}

COMMON ASSERTION FIELD CONTRACT:
- Element/form state assertions: {operation,elementRef}
- ASSERT_TEXT_EQUALS/CONTAINS/NOT_CONTAINS: {operation,elementRef,text}
- ASSERT_VALUE_EQUALS/CONTAINS and selected value: {operation,elementRef,value}
- ASSERT_PATH_EQUALS: {operation,path}; ASSERT_PATH_INCLUDES: {operation,fragment}
- ASSERT_URL_EQUALS: {operation,url}; ASSERT_URL_INCLUDES/NOT_INCLUDES: {operation,fragment}
- Attribute/property/CSS/ARIA assertions: include elementRef, name and value as required.
- Count assertions: include elementRef and count.
- Database assertions: use queryName plus field/value or count; never SQL.
- Advanced assertions must use the exact fields implied by their catalog description and runtime capability.

Return JSON only:
{
  "feature": string,
  "cases": [{
    "plannedId": "P001",
    "title": string,
    "priority": "low"|"medium"|"high",
    "preconditions": [string],
    "testData": object,
    "securitySubcategory": string|null,
    "severity": string|null,
    "actions": [object],
    "assertions": [object]
  }]
}`;

function cleanTextArray(value, max = 30) {
  return (Array.isArray(value) ? value : []).map((item) => String(item || '').trim()).filter(Boolean).slice(0, max);
}

function normalizePriority(value) {
  const priority = String(value || '').trim().toLowerCase();
  return ['low','medium','high'].includes(priority) ? priority : 'medium';
}

async function generateCanonicalBatch({
  story,
  registry,
  plannedUnits = [],
  environment = 'Test',
  excludeTitles = [],
  modelTier = 'fast',
  hasCredentials = false,
  actorCatalog = [],
  actorCredentialRefs = [],
  securitySubcategories = [],
  securitySeverities = [],
}) {
  if (!registry?.elements?.length) throw new Error('Canonical element registry is required before AI test generation.');
  if (!Array.isArray(plannedUnits) || !plannedUnits.length) throw new Error('At least one canonical planned unit is required.');

  const safeActors = publicActorCatalog(actorCatalog);
  const configuredActorRefs = [...new Set((Array.isArray(actorCredentialRefs) ? actorCredentialRefs : []).map(String).filter(Boolean))];
  const availableActors = safeActors.filter((actor) => configuredActorRefs.includes(actor.actorRef));
  const capabilities = runtimeCapabilities();
  const result = await callModel(CANONICAL_PROMPT, {
    irVersion: IR_VERSION,
    story,
    environment,
    hasRuntimeCredentials: Boolean(hasCredentials),
    actorCatalog: availableActors,
    plannedUnits: plannedUnits.map((unit) => ({
      plannedId: unit.plannedId,
      category: unit.category,
      scenarioType: unit.scenarioType,
      objective: unit.objective || unit.rationale,
      customCategory: unit.customCategory || null,
      customScenarioType: unit.customScenarioType || null,
    })),
    canonicalElementRegistry: registryForModel(registry),
    canonicalActionCatalog: canonicalActionCatalog(),
    canonicalAssertionCatalog: canonicalAssertionCatalog(),
    runtimeCapabilities: capabilities,
    excludeTitles: cleanTextArray(excludeTitles, 100),
    securityScope: plannedUnits.some((unit) => unit.category === 'SECURITY') ? {
      subcategories: cleanTextArray(securitySubcategories, 50),
      severities: cleanTextArray(securitySeverities, 20),
    } : null,
  }, { modelTier });

  const rawCases = Array.isArray(result?.cases) ? result.cases : [];
  if (rawCases.length !== plannedUnits.length) {
    const error = new Error(`AI returned ${rawCases.length}/${plannedUnits.length} canonical cases for the requested batch.`);
    error.code = 'CANONICAL_BATCH_COUNT_MISMATCH';
    throw error;
  }

  const byPlannedId = new Map();
  for (const raw of rawCases) {
    const plannedId = String(raw?.plannedId || '').trim();
    if (!plannedId || byPlannedId.has(plannedId)) {
      const error = new Error(`AI returned a missing or duplicate plannedId in canonical generation: ${plannedId || '(missing)'}.`);
      error.code = 'CANONICAL_PLANNED_ID_INVALID';
      throw error;
    }
    byPlannedId.set(plannedId, raw);
  }

  const testCases = [];
  for (const unit of plannedUnits) {
    const raw = byPlannedId.get(unit.plannedId);
    if (!raw) {
      const error = new Error(`AI did not return canonical case ${unit.plannedId}.`);
      error.code = 'CANONICAL_PLANNED_ID_MISSING';
      throw error;
    }
    const canonicalIr = {
      version: IR_VERSION,
      plannedId: unit.plannedId,
      objective: unit.objective || unit.rationale || '',
      actions: Array.isArray(raw.actions) ? raw.actions : [],
      assertions: Array.isArray(raw.assertions) ? raw.assertions : [],
    };
    const validation = validateCanonicalIr(canonicalIr, {
      registry,
      plannedUnit: unit,
      story: '',
      hasCredentials,
      actorCatalog: safeActors,
      actorCredentialRefs: configuredActorRefs,
    });
    if (!validation.ok) {
      const error = new Error(`${unit.plannedId} canonical IR failed deterministic validation: ${validation.reason}`);
      error.code = 'CANONICAL_IR_VALIDATION_FAILED';
      error.plannedId = unit.plannedId;
      error.validationErrors = validation.errors || [];
      throw error;
    }

    const title = String(raw.title || '').trim();
    if (!title) {
      const error = new Error(`${unit.plannedId} canonical case is missing a title.`);
      error.code = 'CANONICAL_TITLE_MISSING';
      throw error;
    }
    const cypressPreview = generateCypressPreviewFromPlan(validation.plan, { id: unit.plannedId, title });
    testCases.push({
      title,
      type: unit.scenarioType,
      customScenarioType: unit.customScenarioType || null,
      priority: normalizePriority(raw.priority),
      testCategory: unit.category,
      customCategory: unit.customCategory || null,
      securitySubcategory: unit.category === 'SECURITY' ? String(raw.securitySubcategory || '').trim().toUpperCase() || null : null,
      severity: unit.category === 'SECURITY' ? String(raw.severity || '').trim().toUpperCase() || null : null,
      preconditions: cleanTextArray(raw.preconditions, 30),
      testData: raw.testData && typeof raw.testData === 'object' && !Array.isArray(raw.testData) ? raw.testData : {},
      steps: validation.display.steps,
      expectedResults: validation.display.expectedResults,
      canonicalIr,
      canonicalValidation: {
        status: 'VALID',
        irVersion: IR_VERSION,
        plannedId: unit.plannedId,
        registryHash: registry.registryHash,
        actorRefs: validation.plan?.actorRefs || [],
      },
      cypressPreview,
      _canonicalAutomationPlan: validation.plan,
    });
  }

  return {
    feature: String(result?.feature || '').trim() || null,
    testCases,
    runtimeCapabilities: capabilities,
  };
}

module.exports = {
  CANONICAL_PROMPT,
  generateCanonicalBatch,
};
