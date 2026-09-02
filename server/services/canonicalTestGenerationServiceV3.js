const v2 = require('./canonicalTestGenerationServiceV2');
const { validateCanonicalIr } = require('./canonicalTestIrV3');
const { generateCypressPreviewFromPlan } = require('./deterministicAutomationGeneratorV6');

function clean(value) {
  return String(value ?? '').trim();
}

function identity(element = {}) {
  return [element.elementRef, element.testId, element.id, element.name, element.label, element.ariaLabel, element.text]
    .filter(Boolean).join(' ').toLowerCase();
}

function loginSurface(registry = {}) {
  const elements = Array.isArray(registry.elements) ? registry.elements : [];
  const loginElements = elements.filter((element) => {
    const type = String(element.type || '').toLowerCase();
    const text = identity(element);
    return type === 'password' || /\b(username|user name|user-name|login|sign in|signin|password)\b/.test(text);
  });
  const pageRefs = new Set(loginElements.map((element) => element.pageRef).filter(Boolean));
  const paths = new Set((registry.pages || [])
    .filter((page) => pageRefs.has(page.pageRef))
    .map((page) => String(page.path || '/')));
  return { pageRefs, paths };
}

function hasAuthenticationRequirement(story = '') {
  return /\b(login|log\s*in|sign\s*in|authentication|authenticate|credentials?)\b/i.test(String(story || ''));
}

function objectiveIsAuthentication(objective = '') {
  return /\b(login|log\s*in|sign\s*in|authentication|authenticate|username|password|credentials?)\b/i.test(String(objective || ''));
}

function actionUsesNonLoginSurface(action, byRef, login) {
  if (String(action?.operation || '').toUpperCase() === 'NAVIGATE') {
    const path = String(action.path || '/');
    return login.paths.size > 0 && !login.paths.has(path);
  }
  const element = byRef.get(String(action?.elementRef || ''));
  return Boolean(element?.pageRef && login.pageRefs.size > 0 && !login.pageRefs.has(element.pageRef));
}

function addAuthenticationPrerequisite(ir, { registry, story, hasCredentials }) {
  if (!hasCredentials || !hasAuthenticationRequirement(story)) return { ir, changed: false };
  const objective = clean(ir?.objective);
  if (objectiveIsAuthentication(objective)) return { ir, changed: false };
  const actions = Array.isArray(ir?.actions) ? ir.actions.map((item) => ({ ...item })) : [];
  if (actions.some((action) => ['LOGIN_VALID', 'LOGIN_AS_ACTOR'].includes(String(action?.operation || '').toUpperCase()))) {
    return { ir: { ...ir, actions }, changed: false };
  }
  const elements = Array.isArray(registry?.elements) ? registry.elements : [];
  const byRef = new Map(elements.map((element) => [String(element.elementRef || ''), element]));
  const login = loginSurface(registry);
  if (!actions.some((action) => actionUsesNonLoginSurface(action, byRef, login))) return { ir: { ...ir, actions }, changed: false };
  actions.unshift({ operation: 'LOGIN_VALID' });
  return { ir: { ...ir, actions }, changed: true };
}

function emptyRequiredIntent(objective = '') {
  const text = String(objective || '');
  return /required\s+fields?.*(?:empty|missing)|(?:empty|missing).*required\s+fields?/i.test(text);
}

function removeContradictoryRequiredFill(ir, registry = {}) {
  if (!emptyRequiredIntent(ir?.objective)) return { ir, changed: false, removed: [] };
  const elements = Array.isArray(registry.elements) ? registry.elements : [];
  const byRef = new Map(elements.map((element) => [String(element.elementRef || ''), element]));
  const removableOperations = new Set(['TYPE', 'TYPE_RUNTIME_CREDENTIAL', 'SELECT', 'CHECK', 'UNCHECK', 'CLEAR']);
  const removed = [];
  const actions = (Array.isArray(ir?.actions) ? ir.actions : []).filter((action) => {
    const operation = String(action?.operation || '').toUpperCase();
    if (!removableOperations.has(operation)) return true;
    const element = byRef.get(String(action?.elementRef || ''));
    if (!element || element.required !== true) return true;
    // Keep credential typing for an explicit login action sequence. Ordinary required
    // application fields must remain empty when that is the planned negative intent.
    if (String(element.type || '').toLowerCase() === 'password' || /username|login/.test(identity(element))) return true;
    removed.push({ ...action });
    return false;
  });
  return { ir: { ...ir, actions }, changed: removed.length > 0, removed };
}

function normalizeDynamicTextAssertions(ir, registry = {}) {
  const elements = Array.isArray(registry.elements) ? registry.elements : [];
  const byRef = new Map(elements.map((element) => [String(element.elementRef || ''), element]));
  let changed = false;
  const assertions = (Array.isArray(ir?.assertions) ? ir.assertions : []).map((assertion) => {
    if (String(assertion?.operation || '').toUpperCase() !== 'ASSERT_TEXT_EQUALS') return { ...assertion };
    const expected = clean(assertion.text ?? assertion.value);
    const element = byRef.get(String(assertion.elementRef || ''));
    if (!element || !expected) return { ...assertion };
    const discovered = clean(element.text).replace(/\s+/g, ' ');
    const expectedNormalized = expected.replace(/\s+/g, ' ');
    const signature = identity(element);
    const hasAdditionalDiscoveredText = discovered && discovered.includes(expectedNormalized) && discovered !== expectedNormalized;
    const dynamicContainer = /success|confirmation|confirmed|reference|receipt|thank/.test(signature);
    if (!hasAdditionalDiscoveredText && !dynamicContainer) return { ...assertion };
    changed = true;
    return { ...assertion, operation: 'ASSERT_TEXT_CONTAINS', text: expected };
  });
  return { ir: { ...ir, assertions }, changed };
}

function groundingMetadata(original, changes) {
  const existing = original?.behavioralGrounding && typeof original.behavioralGrounding === 'object'
    ? original.behavioralGrounding
    : { version: 1, status: 'GROUNDED', enrichments: [], unresolved: [] };
  const enrichments = [...(Array.isArray(existing.enrichments) ? existing.enrichments : [])];
  if (changes.auth) enrichments.push({
    code: 'AUTHENTICATION_PRECONDITION_ADDED',
    message: 'Added deterministic runtime login before exercising a non-login surface because the business story requires authentication.',
  });
  if (changes.emptyRemoved.length) enrichments.push({
    code: 'NEGATIVE_EMPTY_INTENT_RESTORED',
    message: 'Removed required-field fill actions that contradicted the planned empty-required-fields negative scenario.',
    removedActions: changes.emptyRemoved,
  });
  if (changes.dynamicText) enrichments.push({
    code: 'DYNAMIC_CONTAINER_TEXT_NORMALIZED',
    message: 'Changed exact container text comparison to deterministic containment because the target is a confirmation/result container that may include additional dynamic content.',
  });
  return { version: 1, status: 'GROUNDED', enrichments, unresolved: [] };
}

function findPlannedUnit(testCase, plannedUnits = []) {
  const id = String(testCase?.canonicalIr?.plannedId || '');
  return plannedUnits.find((unit) => String(unit?.plannedId || '') === id) || {
    plannedId: id,
    category: testCase?.testCategory || null,
    scenarioType: testCase?.type || null,
    objective: testCase?.coverageRationale || testCase?.canonicalIr?.objective || testCase?.title || '',
  };
}

function postProcessCase(testCase, options) {
  const registry = options.registry || {};
  const plannedUnit = findPlannedUnit(testCase, options.plannedUnits || []);
  let ir = { ...(testCase.canonicalIr || {}), actions: [...(testCase.canonicalIr?.actions || [])], assertions: [...(testCase.canonicalIr?.assertions || [])] };

  const empty = removeContradictoryRequiredFill(ir, registry);
  ir = empty.ir;
  const auth = addAuthenticationPrerequisite(ir, options);
  ir = auth.ir;
  const text = normalizeDynamicTextAssertions(ir, registry);
  ir = text.ir;
  ir.behavioralGrounding = groundingMetadata(testCase.canonicalIr, {
    auth: auth.changed,
    emptyRemoved: empty.removed,
    dynamicText: text.changed,
  });

  const actorRuntime = v2.resolveActorRuntime(options.actorCatalog || [], options.actorCredentialRefs || [], options.workflowRequirements || null);
  const validation = validateCanonicalIr(ir, {
    registry,
    plannedUnit,
    story: options.story || '',
    hasCredentials: Boolean(options.hasCredentials),
    actorCatalog: actorRuntime.safeActors,
    actorCredentialRefs: actorRuntime.configuredActorRefs,
  });
  if (!validation.ok) {
    const error = new Error(`${ir.plannedId || testCase.id || 'Canonical case'} failed runtime-safety validation: ${validation.reason}`);
    error.code = 'CANONICAL_RUNTIME_SAFETY_VALIDATION_FAILED';
    error.validationErrors = validation.errors || [];
    throw error;
  }

  const title = testCase.title || 'Canonical test';
  return {
    ...testCase,
    steps: validation.display.steps,
    expectedResults: validation.display.expectedResults,
    canonicalIr: ir,
    canonicalValidation: {
      ...(testCase.canonicalValidation || {}),
      status: 'VALID',
      plannedId: ir.plannedId,
      registryHash: registry.registryHash,
      actorRefs: validation.plan?.actorRefs || [],
      behavioralGrounding: ir.behavioralGrounding,
    },
    behavioralGrounding: ir.behavioralGrounding,
    cypressPreview: generateCypressPreviewFromPlan(validation.plan, { id: ir.plannedId || testCase.id || 'TC', title }),
    _canonicalAutomationPlan: validation.plan,
    generationStory: options.story || null,
  };
}

async function generateCanonicalBatch(options = {}) {
  const result = await v2.generateCanonicalBatch(options);
  const processed = (result.testCases || []).map((testCase) => postProcessCase(testCase, options));
  return { ...result, testCases: processed };
}

module.exports = {
  ...v2,
  generateCanonicalBatch,
  postProcessCase,
  addAuthenticationPrerequisite,
  removeContradictoryRequiredFill,
  normalizeDynamicTextAssertions,
};
