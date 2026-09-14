const crypto = require('crypto');

let installed = false;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      const item = value[key];
      if (item !== undefined) out[key] = stableValue(item);
      return out;
    }, {});
  }
  return value;
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value ?? null))).digest('hex');
}

function executionPlanShape(plan = {}) {
  return {
    actions: Array.isArray(plan.actions) ? plan.actions : [],
    assertions: Array.isArray(plan.assertions) ? plan.assertions : [],
    plannedId: plan.plannedId || null,
    registryHash: plan.registryHash || null,
    canonicalIrVersion: plan.canonicalIrVersion || null,
  };
}

function displayExpectationShape(testCase = {}) {
  return Array.isArray(testCase.expectedResults)
    ? testCase.expectedResults.map((value) => String(value || '').trim().replace(/\s+/g, ' ')).filter(Boolean)
    : [];
}

function contractSnapshot(testCase = {}) {
  const readiness = testCase?.automationReadiness || {};
  const plan = readiness.automationPlan || {};
  return {
    canonicalHash: testCase?.canonicalIr ? stableHash(testCase.canonicalIr) : null,
    compiledHash: readiness.status === 'READY' && plan ? stableHash(executionPlanShape(plan)) : null,
    displayExpectationHash: stableHash(displayExpectationShape(testCase)),
  };
}

function integrityFailure(readiness, reasonCode, reason, snapshot) {
  return {
    ...readiness,
    status: 'INVALID_TEST_CASE',
    automatable: false,
    reasonCode,
    reason,
    reasons: [reason],
    resolutionType: 'AI_REPAIRABLE',
    repairable: true,
    canSuggestAssertion: false,
    contractIntegrity: { ...(readiness?.contractIntegrity || {}), ...snapshot, status: 'MISMATCH' },
  };
}

function guardAssessedCase(testCase) {
  if (!testCase?.canonicalIr) return testCase;
  const readiness = testCase.automationReadiness || {};
  const snapshot = contractSnapshot(testCase);
  const approved = testCase.canonicalValidation || {};
  const baseReadiness = {
    ...readiness,
    contractIntegrity: {
      ...(readiness.contractIntegrity || {}),
      ...snapshot,
      approvedCanonicalHash: approved.approvedCanonicalHash || null,
      approvedCompiledHash: approved.approvedCompiledHash || null,
      approvedDisplayExpectationHash: approved.approvedDisplayExpectationHash || null,
      status: 'CHECKED',
    },
  };
  const checked = { ...testCase, automationReadiness: baseReadiness };

  if (approved.approvedCanonicalHash && snapshot.canonicalHash !== approved.approvedCanonicalHash) {
    return { ...checked, automationReadiness: integrityFailure(baseReadiness, 'APPROVED_CANONICAL_CONTRACT_CHANGED', 'The canonical actions/assertions changed after human approval. Revalidate the edited test before execution.', snapshot) };
  }
  if (approved.approvedCompiledHash && snapshot.compiledHash !== approved.approvedCompiledHash) {
    return { ...checked, automationReadiness: integrityFailure(baseReadiness, 'APPROVED_COMPILED_CONTRACT_CHANGED', 'The compiled deterministic automation contract changed after human approval. Execution is blocked until the test is reviewed again.', snapshot) };
  }
  if (approved.approvedDisplayExpectationHash && snapshot.displayExpectationHash !== approved.approvedDisplayExpectationHash) {
    return { ...checked, automationReadiness: integrityFailure(baseReadiness, 'APPROVED_EXPECTATION_CHANGED', 'The reviewed expected results changed after approval. Revalidate the test so the visible expectation and executable assertion remain identical.', snapshot) };
  }
  return checked;
}

function desiredScenarioForRequirementKeys(keys = []) {
  if (keys.includes('AGE_BOUNDARY')) return 'boundary';
  if (keys.some((key) => ['LOGIN_REQUIRED','FEEDBACK_REQUIRED','EMAIL_FORMAT','WEBSITE_URL'].includes(key))) return 'negative';
  return 'positive';
}

function requirementGroups(requirements = []) {
  const keys = new Set(requirements.map((item) => item.key));
  const groups = [];
  const add = (groupKeys, rationale) => {
    const active = groupKeys.filter((key) => keys.has(key));
    if (active.length) groups.push({ keys: active, rationale });
  };
  add(['LOGIN_VALID'], 'Verify login authentication succeeds with valid credentials and reaches the intended authenticated workflow.');
  add(['LOGIN_REQUIRED'], 'Verify login rejects missing username/password and exposes the required-field validation defined by the story.');
  add(['FEEDBACK_SUBMIT','SUCCESS_CONFIRMATION'], 'Submit a complete valid feedback form and verify the successful-submission confirmation in the same positive journey.');
  add(['FEEDBACK_REQUIRED'], 'Verify feedback submission is rejected when required feedback fields are missing and grounded validation feedback is shown.');
  add(['EMAIL_FORMAT','WEBSITE_URL'], 'Verify malformed email and website URL values are rejected with grounded format-validation evidence; cover both explicit format requirements in one negative form-validation case when the discovered UI permits it.');
  add(['AGE_BOUNDARY'], 'Verify the story-defined age boundary behavior, including an edge/out-of-range value grounded by the discovered age control.');
  return groups;
}

function patchCoveragePlanner() {
  const planner = require('./progressiveTestGenerator');
  if (planner.__requirementPriorityPatched) return;
  const original = planner.proposeGenerationPlan;
  const { extractExplicitRequirements } = require('./requirementCoverage');
  planner.proposeGenerationPlan = async function requirementFirstPlan(args = {}) {
    const planned = await original(args);
    const requirements = extractExplicitRequirements(args.story || '');
    const categories = (args.allowedCategories || []).map((value) => String(value || '').toUpperCase());
    const scenarios = (args.allowedScenarioTypes || []).map((value) => String(value || '').toLowerCase());
    if (!requirements.length || !categories.includes('FUNCTIONAL') || requirements.filter((item) => !item.key.startsWith('GENERIC_')).length < 2) return planned;

    const max = Math.max(1, Number(args.maxTestCases || planned.maxTestCases || 6) || 6);
    const groups = requirementGroups(requirements);
    const prioritized = [];
    const deferred = [];
    for (const group of groups) {
      const desired = desiredScenarioForRequirementKeys(group.keys);
      if (!scenarios.includes(desired)) {
        deferred.push(...group.keys);
        continue;
      }
      if (prioritized.length >= max) {
        deferred.push(...group.keys);
        continue;
      }
      prioritized.push({ category: 'FUNCTIONAL', scenarioType: desired, rationale: group.rationale, requirementKeys: group.keys });
    }

    const signatures = new Set(prioritized.map((unit) => `${unit.category}|${unit.scenarioType}|${unit.rationale.toLowerCase()}`));
    for (const unit of planned.units || []) {
      if (prioritized.length >= max) break;
      const signature = `${unit.category}|${unit.scenarioType}|${String(unit.rationale || '').toLowerCase()}`;
      if (signatures.has(signature)) continue;
      signatures.add(signature);
      prioritized.push(unit);
    }

    const allocatedKeys = new Set(prioritized.flatMap((unit) => unit.requirementKeys || []));
    const mandatoryKeys = requirements.filter((item) => !item.key.startsWith('GENERIC_')).map((item) => item.key);
    const uncovered = mandatoryKeys.filter((key) => !allocatedKeys.has(key));
    const allocatedCount = mandatoryKeys.filter((key) => allocatedKeys.has(key)).length;
    const score = mandatoryKeys.length ? Math.round((allocatedCount / mandatoryKeys.length) * 100) : planned.coverageScore;
    const keyToText = new Map(requirements.map((item) => [item.key, item.text]));
    const knownGaps = [...new Set([
      ...(planned.knownGaps || []),
      ...uncovered.map((key) => `Explicit story requirement not allocated within the ${max}-case plan: ${keyToText.get(key) || key}.`),
      ...deferred.filter((key) => !uncovered.includes(key)).map((key) => `Scenario-type selection prevented preferred coverage for: ${keyToText.get(key) || key}.`),
    ])];

    return {
      ...planned,
      recommendedTestCaseCount: prioritized.length,
      coverageScore: score,
      coverageSummary: `${allocatedCount} of ${mandatoryKeys.length} explicit story requirements are allocated in the proposed canonical test plan. Final coverage is recalculated only after generation and readiness complete.`,
      coveredAreas: mandatoryKeys.filter((key) => allocatedKeys.has(key)).map((key) => keyToText.get(key) || key),
      knownGaps,
      units: prioritized,
      explicitRequirements: requirements,
    };
  };
  planner.__requirementPriorityPatched = true;
}

function patchFeasibility() {
  const feasibility = require('./testCaseFeasibility');
  if (feasibility.__contractIntegrityPatched) return;
  const originalAssess = feasibility.assessTestCases;
  feasibility.assessTestCases = function guardedAssessTestCases(testCases = [], context = {}) {
    return originalAssess(testCases, context).map(guardAssessedCase);
  };
  feasibility.__contractIntegrityPatched = true;
}

function patchDeterministicGenerator() {
  const generator = require('./deterministicAutomationGenerator');
  if (generator.__contractIntegrityPatched) return;
  const originalGenerate = generator.generateDeterministicAutomation;
  generator.generateDeterministicAutomation = function guardedGenerate(approvedTestCases = []) {
    for (const testCase of approvedTestCases || []) {
      if (!testCase?.canonicalIr) continue;
      const approved = testCase.canonicalValidation || {};
      const snapshot = contractSnapshot(testCase);
      if (!approved.approvedCanonicalHash || !approved.approvedCompiledHash || !approved.approvedDisplayExpectationHash) {
        const error = new Error(`${testCase.id || 'Canonical test'} is missing its human-approved execution-contract seal. Revalidate/review the test before execution.`);
        error.code = 'APPROVED_CONTRACT_SEAL_MISSING';
        throw error;
      }
      if (snapshot.canonicalHash !== approved.approvedCanonicalHash || snapshot.compiledHash !== approved.approvedCompiledHash || snapshot.displayExpectationHash !== approved.approvedDisplayExpectationHash) {
        const error = new Error(`${testCase.id || 'Canonical test'} no longer matches the human-approved deterministic contract. Execution was blocked before Cypress started.`);
        error.code = 'APPROVED_CONTRACT_MISMATCH';
        throw error;
      }
    }
    return originalGenerate(approvedTestCases);
  };
  generator.__contractIntegrityPatched = true;
}

function assertionSelectorSet(testCase = {}) {
  return new Set((testCase?.automationReadiness?.automationPlan?.assertions || []).map((item) => String(item?.selector || '').trim()).filter(Boolean));
}

function runtimeSelectorHints(actual = '') {
  const text = String(actual || '');
  const out = new Set();
  for (const match of text.matchAll(/\[data-testid=["']([^"']+)["']\]/g)) out.add(`[data-testid="${match[1]}"]`);
  for (const match of text.matchAll(/<[^>]*#([A-Za-z0-9_-]+)/g)) out.add(`#${match[1]}`);
  for (const match of text.matchAll(/#[A-Za-z][A-Za-z0-9_-]*/g)) out.add(match[0]);
  return out;
}

function normalizeSelector(selector) {
  return String(selector || '').replace(/'/g, '"').replace(/\s+/g, '').toLowerCase();
}

function matchingApprovedAssertion(testCase, actual) {
  const assertions = testCase?.automationReadiness?.automationPlan?.assertions || [];
  const hints = [...runtimeSelectorHints(actual)].map(normalizeSelector);
  const matches = assertions.filter((assertion) => {
    const selector = normalizeSelector(assertion?.selector);
    return selector && hints.includes(selector);
  });
  if (matches.length === 1) return matches[0];
  if (!hints.length && assertions.length === 1) return assertions[0];
  return null;
}

function assertionSummary(assertion = {}) {
  const target = assertion.selector || assertion.path || assertion.fragment || 'approved target';
  const suffix = assertion.text ?? assertion.value ?? assertion.path ?? assertion.fragment ?? '';
  return `${assertion.operation || 'ASSERTION'} on ${target}${suffix !== '' ? ` (${JSON.stringify(suffix)})` : ''}`;
}

function replacePlannedIds(value, testCaseId) {
  if (Array.isArray(value)) return value.map((item) => replacePlannedIds(item, testCaseId));
  if (typeof value === 'string') return value.replace(/\bP\d{3}\b/g, testCaseId || 'the failed test');
  return value;
}

function patchFailureAnalysis() {
  const service = require('./failureResolutionAiService');
  if (service.__contractIntegrityPatched) return;
  const originalAnalyze = service.analyzeFailureWithResolution;
  service.analyzeFailureWithResolution = async function guardedFailureAnalysis(args = {}) {
    const result = await originalAnalyze(args);
    const testCase = args.testCase || {};
    const seal = testCase?.canonicalValidation?.approvedCompiledHash || null;
    const exactAssertion = matchingApprovedAssertion(testCase, args.actual);
    const selectors = assertionSelectorSet(testCase);
    const id = testCase.id || 'the failed test';

    let guarded = { ...result };
    if (!seal || !exactAssertion) {
      if (guarded.classification === 'APPLICATION_DEFECT') {
        guarded = {
          ...guarded,
          classification: 'TEST_DEFECT',
          summary: `The browser reported a failed assertion, but that runtime assertion could not be proven identical to ${id}'s sealed human-approved contract. Application-defect attribution is blocked.`,
          probableCause: 'The reviewed expectation, canonical assertion, or runtime failure mapping may have drifted. Review the test contract before changing application code.',
          resolutionComment: `Revalidate ${id}, confirm the displayed expected result and compiled assertion are identical, then re-run the original test.`,
          recommendedFix: 'Correct the test/contract mapping if it differs from the reviewed expectation. Do not change application behavior until the assertion is traceable to the approved contract.',
          recommendedOwner: 'TEST_AUTOMATION_TEAM',
          developerReviewArea: '',
          developerImplementationHint: '',
          developerExampleFix: '',
          regressionChecks: [],
          sourceGuidanceLevel: 'BLACK_BOX',
          sourceCandidateFiles: [],
          resolutionSource: 'DETERMINISTIC_CONTRACT_GUARD',
          confidence: Math.max(Number(guarded.confidence) || 0, 0.98),
        };
      }
    } else {
      guarded = { ...guarded, approvedAssertion: exactAssertion, approvedAssertionSummary: assertionSummary(exactAssertion), contractTraceability: 'SEALED_ASSERTION_MATCH' };
    }

    if (guarded.sourceGuidanceLevel === 'BLACK_BOX') guarded.sourceCandidateFiles = [];
    for (const key of ['summary','expected','actual','probableCause','resolutionComment','recommendedFix','developerReviewArea','developerImplementationHint','developerExampleFix']) guarded[key] = replacePlannedIds(guarded[key], id);
    guarded.regressionChecks = replacePlannedIds(guarded.regressionChecks || [], id);
    guarded.verificationSteps = replacePlannedIds(guarded.verificationSteps || [], id);

    if (guarded.classification === 'APPLICATION_DEFECT' && exactAssertion) {
      guarded.expected = guarded.expected || assertionSummary(exactAssertion);
      guarded.contractTraceability = 'SEALED_ASSERTION_MATCH';
      guarded.approvedAssertion = exactAssertion;
      guarded.approvedSelectorSet = [...selectors];
    }
    return guarded;
  };
  service.__contractIntegrityPatched = true;
}

function patchReportGenerator() {
  const report = require('./reportGenerator');
  if (report.__contractIntegrityPatched) return;
  const originalBuild = report.buildAnalyticsReport;
  report.buildAnalyticsReport = function guardedReport(args = {}) {
    const html = originalBuild(args);
    if (typeof html !== 'string') return html;
    return html.replace(
      /SOURCE_VERIFIED means the candidate path\/line area was grounded in repository evidence supplied to AI\. It is still advisory and not an applied or proven patch\./g,
      'Source guidance is labeled per failed case. BLACK BOX uses no repository source evidence; SOURCE VERIFIED indicates only that the candidate area was grounded in supplied repository evidence. All guidance remains advisory and must be verified by re-running the original approved test.'
    );
  };
  report.__contractIntegrityPatched = true;
}

function install() {
  if (installed) return;
  installed = true;
  patchCoveragePlanner();
  patchFeasibility();
  patchDeterministicGenerator();
  patchFailureAnalysis();
  patchReportGenerator();
}

module.exports = { install, stableHash, executionPlanShape, displayExpectationShape, contractSnapshot, guardAssessedCase };
