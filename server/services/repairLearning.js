'use strict';
const crypto = require('crypto');
const { contractReviewHash, isConfirmedCurrentReview } = require('./reviewContract');

const id = (value) => String(value || '').toUpperCase();
const hash = (value) => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const clone = (value) => JSON.parse(JSON.stringify(value));
const timestamp = () => new Date().toISOString();

function originFor(session) {
  try { return new URL(session.targetUrl).origin; } catch { return null; }
}
function contractIdentity(testCase) {
  return contractReviewHash(testCase);
}
function requirementShape(tc) {
  return (tc?.canonicalIr?.assertions || []).map((assertion) => {
    // A selector may be repaired; the business assertion and expected value may not silently change.
    const { elementRef, selector, pageRef, elementId, ...requirement } = assertion;
    return requirement;
  }).map((part) => JSON.stringify(part)).sort();
}
function unchangedRequirements(original, candidate) {
  const a = requirementShape(original);
  const b = requirementShape(candidate);
  return a.length > 0 && JSON.stringify(a) === JSON.stringify(b);
}
function failureSignature(session, caseId) {
  const result = (session.lastResults?.summary?.tests || []).find((test) => id(test.testCaseId) === id(caseId));
  const error = String(result?.err?.message || 'not-recorded')
    .replace(/https?:\/\/[^\s]+/g, '[url]')
    .replace(/\b\d+\b/g, '#').replace(/\s+/g, ' ').slice(0, 700).toLowerCase();
  return hash([originFor(session), id(caseId), error]);
}
function registryIndex(registry) {
  return new Map((registry?.elements || []).filter((item) => item.elementRef).map((item) => [item.elementRef, item]));
}
function dependencies(tc, registry) {
  const elements = registryIndex(registry);
  const values = new Set();
  for (const step of [...(tc?.canonicalIr?.actions || []), ...(tc?.canonicalIr?.assertions || [])]) {
    if (step.elementRef) {
      values.add('element:' + step.elementRef);
      const element = elements.get(step.elementRef);
      if (element?.pageRef) values.add('page:' + element.pageRef);
      if (element?.formId) values.add('form:' + element.formId);
      if (element?.selector) values.add('selector:' + element.selector);
    }
    if (step.path) values.add('path:' + step.path);
    if (step.selector) values.add('selector:' + step.selector);
  }
  for (const rule of tc?.ruleRefs || []) values.add('rule:' + rule);
  return [...values].sort();
}
function dependencyGraph(session, original = null) {
  const registry = session.canonicalElementRegistry;
  const cases = session.testCases || [];
  const nodes = cases.map((testCase) => {
    // The original dependency is critical: a renamed selector must still connect
    // with tests that depend on the old selector. Do not discard it after editing.
    const current = dependencies(testCase, registry);
    const before = original && id(original.id) === id(testCase.id)
      ? dependencies(original, registry) : [];
    return { caseId: id(testCase.id), dependencies: [...new Set([...current, ...before])].sort() };
  });
  if (original && !nodes.some((node) => node.caseId === id(original.id))) {
    nodes.push({ caseId: id(original.id), dependencies: dependencies(original, registry) });
  }
  const edges = [];
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const shared = nodes[i].dependencies.filter((dependency) => nodes[j].dependencies.includes(dependency));
    if (shared.length) edges.push({ from: nodes[i].caseId, to: nodes[j].caseId, shared });
  }
  return { nodes, edges };
}
function impactedCases(session, caseId, original = null) {
  const graph = dependencyGraph(session, original);
  const key = id(caseId);
  // Connected component, not only direct neighbors: shared workflows span
  // multiple pages/forms and can regress through chained dependencies.
  const reached = new Set([key]), pending = [key], explanations = {};
  while (pending.length) {
    const current = pending.shift();
    for (const edge of graph.edges) {
      const next = edge.from === current ? edge.to : edge.to === current ? edge.from : null;
      if (!next) continue;
      if (!explanations[next]) explanations[next] = [];
      explanations[next] = [...new Set([...explanations[next], ...edge.shared])].sort();
      if (!reached.has(next)) { reached.add(next); pending.push(next); }
    }
  }
  const before = original ? dependencies(original, session.canonicalElementRegistry) : [];
  const after = dependencies((session.testCases || []).find((tc) => id(tc.id) === key), session.canonicalElementRegistry);
  return {
    graph,
    impactedIds: [...reached].sort(),
    changedDependencies: { removed: before.filter((d) => !after.includes(d)), added: after.filter((d) => !before.includes(d)) },
    reasonsByCase: explanations,
  };
}
function getAttempt(session, caseId) {
  return session.repairLearning?.[id(caseId)] || null;
}
function createAttempt(session, original, candidate) {
  if (!session.repairLearning) session.repairLearning = {};
  const key = id(original.id);
  const prior = getAttempt(session, key);
  const baselineOriginal = prior && prior.status !== 'VALIDATED' && prior.originalSnapshot
    ? prior.originalSnapshot : original;
  const { impactedIds, changedDependencies, reasonsByCase } = impactedCases(session, key, baselineOriginal);
  session.repairLearning[key] = {
    attemptId: crypto.randomUUID(),
    status: 'PENDING_VALIDATION',
    caseId: key,
    revision: Number(candidate.review?.revision) || 0,
    originalHash: contractIdentity(baselineOriginal),
    candidateHash: contractIdentity(candidate),
    originalSnapshot: clone(baselineOriginal),
    // Intent is not taken from untrusted runtime errors; it is already the reviewed
    // test objective. Equivalent scenarios may use different TC numbers.
    intent: String(baselineOriginal.canonicalIr?.objective || baselineOriginal.coverageRationale || baselineOriginal.title || '').slice(0, 600),
    testCategory: String(baselineOriginal.testCategory || baselineOriginal.category || ''),
    scenarioType: String(baselineOriginal.type || ''),
    projectId: session.projectId || null,
    failureSignature: failureSignature(session, key),
    targetOrigin: originFor(session),
    impactedIds,
    changedDependencies,
    reasonsByCase,
    createdAt: timestamp(),
    previousAttemptId: prior?.attemptId || null,
    verifiedAt: null,
    verification: null,
  };
  return session.repairLearning[key];
}
function eligibleForValidation(session, caseId) {
  const candidate = (session.testCases || []).find((tc) => id(tc.id) === id(caseId));
  const attempt = getAttempt(session, caseId);
  if (!candidate || !attempt) throw Object.assign(new Error('There is no pending repair to validate.'), { code: 'REPAIR_NOT_FOUND' });
  if (!['PENDING_VALIDATION', 'REJECTED', 'ROLLED_BACK'].includes(attempt.status))
    throw Object.assign(new Error('Repair has already been validated or is being validated.'), { code: 'REPAIR_NOT_PENDING' });
  if (attempt.candidateHash !== contractIdentity(candidate) || !isConfirmedCurrentReview(candidate))
    throw Object.assign(new Error('Confirm the exact current repaired contract before validation.'), { code: 'REPAIR_CONTRACT_STALE' });
  if (candidate.automationReadiness?.status !== 'READY')
    throw Object.assign(new Error('The candidate is not Automation Ready.'), { code: 'REPAIR_NOT_READY' });
  if (!unchangedRequirements(attempt.originalSnapshot, candidate))
    throw Object.assign(new Error('The business assertions changed. Do not weaken or replace expected behavior through an automation repair.'), { code: 'BUSINESS_ASSERTION_CHANGED' });
  return { candidate, attempt };
}
function suiteToValidate(session, caseId) {
  const { candidate, attempt } = eligibleForValidation(session, caseId);
  const baseline = session.lastResults?.summary?.tests || [];
  if (!baseline.length && (session.testCases || []).length !== 1)
    throw Object.assign(new Error('No previous suite baseline exists. Run the unaffected confirmed cases first, then verify the repair.'), { code: 'REGRESSION_BASELINE_MISSING' });
  if (baseline.some((test) => !id(test.testCaseId)))
    throw Object.assign(new Error('A previously executed test has no trustworthy case identifier; regression cannot silently skip it.'), { code: 'REGRESSION_BASELINE_UNIDENTIFIED' });
  const caseMap = new Map((session.testCases || []).map((tc) => [id(tc.id), tc]));
  const impacted = impactedCases(session, caseId, attempt.originalSnapshot);
  const selected = new Set(impacted.impactedIds);
  const baselineById = new Map(baseline.map((test) => [id(test.testCaseId), test]));
  // Impacted tests that never passed a baseline cannot prove "no regression".
  // Require them to be executed before accepting a change; never skip silently.
  for (const impactedId of impacted.impactedIds) {
    if (impactedId === id(caseId)) continue;
    if (!baselineById.has(impactedId))
      throw Object.assign(new Error('Run a clean baseline for impacted test ' + impactedId + ' before validating this repair.'), { code: 'REGRESSION_IMPACT_BASELINE_MISSING' });
    if (baselineById.get(impactedId)?.pass !== true)
      throw Object.assign(new Error('Impacted test ' + impactedId + ' was not passing in the previous run.'), { code: 'REGRESSION_IMPACT_BASELINE_FAILED' });
  }
  for (const result of baseline) {
    const key = id(result.testCaseId);
    if (!key) continue;
    if (key !== id(caseId) && result.pass !== true)
      throw Object.assign(new Error('A separate baseline test is failing; resolve it before validating a repair.'), { code: 'REGRESSION_BASELINE_FAILED' });
    selected.add(key);
  }
  // Full previous execution scope, not only graph neighbors: protects unrelated behavior too.
  const suites = [...selected].map((key) => caseMap.get(key));
  if (suites.some((tc) => !tc))
    throw Object.assign(new Error('A previously executed test case is missing from the current suite.'), { code: 'REGRESSION_CASE_MISSING' });
  if (suites.length > 100)
    throw Object.assign(new Error('Regression scope exceeds 100 cases. Split the suite into verified execution scopes.'), { code: 'REGRESSION_SCOPE_TOO_LARGE' });
  for (const tc of suites) {
    if (tc.automationReadiness?.status !== 'READY' || !isConfirmedCurrentReview(tc))
      throw Object.assign(new Error(tc.id + ' is not ready and confirmed. Regression cannot skip it.'), { code: 'REGRESSION_CASE_UNVERIFIED' });
  }
  const initialCases = baseline.map((test) => id(test.testCaseId)).filter(Boolean);
  if (new Set(initialCases).size !== initialCases.length)
    throw Object.assign(new Error('Baseline contains duplicate case results.'), { code: 'REGRESSION_DUPLICATE_BASELINE' });
  const identities = Object.fromEntries(suites.map((tc) => [id(tc.id), contractIdentity(tc)]));
  const baselineRunNumber = session.lastResults?.runNumber || null;
  return { candidate, attempt, cases: suites, baselineRunNumber, identities, expectedIds: [...selected].sort(), impact: impacted };
}
function verifyExecution(expectedIds, run) {
  if (!run?.ok || !run.summary || !Array.isArray(run.summary.tests)) return { ok: false, reason: run?.error || 'No complete browser execution results.', results: [] };
  const tests = run.summary.tests;
  const seen = new Set();
  for (const item of tests) {
    const key = id(item.testCaseId);
    if (!key || seen.has(key) || !expectedIds.includes(key)) return { ok: false, reason: 'Unknown or duplicated regression test result.', results: [] };
    seen.add(key);
  }
  const missing = expectedIds.filter((key) => !seen.has(key));
  const failed = tests.filter((test) => test.pass !== true).map((test) => id(test.testCaseId));
  return {
    ok: missing.length === 0 && failed.length === 0 && tests.length === expectedIds.length,
    reason: missing.length ? 'Missing execution results: ' + missing.join(', ') : failed.length ? 'Regression failure: ' + failed.join(', ') : null,
    results: tests.map((item) => ({ caseId: id(item.testCaseId), pass: item.pass === true, state: String(item.state || '') })),
  };
}
function gateCheck(session, testCase) {
  const attempt = getAttempt(session, testCase.id);
  if (!attempt) return { ok: true };
  if (attempt.status !== 'VALIDATED' || attempt.candidateHash !== contractIdentity(testCase))
    return { ok: false, code: 'REPAIR_REGRESSION_GATE_REQUIRED', reason: 'Repair requires a successful isolated full-baseline regression run.' };
  const verified = attempt.verification;
  if (!verified || !Array.isArray(verified.results) || !verified.results.length ||
      Object.keys(verified.identities || {}).length !== verified.results.length ||
      !verified.results.every((result) => result.pass === true))
    return { ok: false, code: 'REPAIR_REGRESSION_EVIDENCE_MISSING', reason: 'The validated repair has no complete passing execution evidence.' };
  if (attempt.verification?.baselineRunNumber !== (session.lastResults?.runNumber || null)) {
    // A later normal execution that passed the same complete tested scope strengthens
    // the evidence instead of invalidating it. Any missing or failing case blocks.
    const last = session.lastResults?.summary?.tests || [];
    const byId = new Map(last.map((test) => [id(test.testCaseId), test]));
    if (!Object.keys(attempt.verification?.identities || {}).every((key) => byId.get(key)?.pass === true))
      return { ok: false, code: 'REPAIR_REGRESSION_STALE', reason: 'The latest run did not pass every case in the verified scope.' };
  }
  for (const [key, approvedHash] of Object.entries(attempt.verification?.identities || {})) {
    const current = (session.testCases || []).find((tc) => id(tc.id) === key);
    if (!current || contractIdentity(current) !== approvedHash)
      return { ok: false, code: 'REPAIR_REGRESSION_STALE', reason: 'A dependent test contract changed after the regression run.' };
  }
  return { ok: true };
}
function repairPattern(original, candidate) {
  const shape = (tc) => [...(tc?.canonicalIr?.actions || []), ...(tc?.canonicalIr?.assertions || [])]
    .map((step) => ({ operation: String(step.operation || ''), elementRef: String(step.elementRef || '').slice(0, 180) }));
  return { before: shape(original).slice(0, 50), after: shape(candidate).slice(0, 50) };
}
function recordEvaluation(session, caseId, scope, outcome) {
  const attempt = getAttempt(session, caseId);
  if (!attempt || attempt.attemptId !== scope.attempt.attemptId || attempt.candidateHash !== scope.attempt.candidateHash)
    throw Object.assign(new Error('Repair changed while regression validation was running.'), { code: 'REPAIR_CONCURRENT_CHANGE' });
  attempt.status = outcome.ok ? 'VALIDATED' : 'REJECTED';
  attempt.verifiedAt = outcome.ok ? timestamp() : null;
  attempt.verification = {
    baselineRunNumber: scope.baselineRunNumber,
    identities: scope.identities,
    results: outcome.results,
    reason: outcome.reason,
    validatedAt: timestamp(),
  };
  if (outcome.ok) {
    attempt.repairPattern = repairPattern(attempt.originalSnapshot, scope.candidate);
    const memory = {
      memoryId: crypto.randomUUID(),
      attemptId: attempt.attemptId,
      caseId: id(caseId),
      projectId: attempt.projectId || null,
      intent: attempt.intent,
      testCategory: attempt.testCategory,
      scenarioType: attempt.scenarioType,
      targetOrigin: attempt.targetOrigin,
      failureSignature: attempt.failureSignature,
      originalHash: attempt.originalHash,
      candidateHash: attempt.candidateHash,
      impactedIds: attempt.impactedIds,
      verifiedAt: attempt.verifiedAt,
      approval: 'HUMAN_CONFIRMED_AND_BROWSER_VERIFIED',
      repairPattern: repairPattern(attempt.originalSnapshot, scope.candidate),
    };
    session.validatedRepairMemory = [...(session.validatedRepairMemory || []), memory].slice(-200);
  }
  return attempt;
}
function rollback(session, caseId, options = {}) {
  const key = id(caseId);
  const attempt = getAttempt(session, key);
  if (!attempt?.originalSnapshot) throw Object.assign(new Error('A prior version is not available.'), { code: 'REPAIR_ROLLBACK_UNAVAILABLE' });
  const current = (session.testCases || []).find((tc) => id(tc.id) === key);
  if (!current || attempt.candidateHash !== contractIdentity(current)) throw Object.assign(new Error('The case has been edited again. Cannot safely roll back this version.'), { code: 'REPAIR_ROLLBACK_CONFLICT' });
  const previous = clone(attempt.originalSnapshot);
  // Rollback is a new draft, never an automatic restoration of an approval seal.
  // Never revive an old approval/frozen artifact when restoring a prior version.
  for (const seal of Object.keys(previous.canonicalValidation || {})) {
    if (seal.startsWith('approved') || seal === 'approvalMode' || seal === 'approvalContractVersion') delete previous.canonicalValidation[seal];
  }
  const restored = {
    ...previous,
    review: { status: 'PENDING_REVIEW', revision: Math.max(Number(current.review?.revision) || 0, Number(previous.review?.revision) || 0) + 1, contractHash: contractIdentity(previous), confirmedAt: null },
  };
  session.testCases = session.testCases.map((tc) => id(tc.id) === key ? restored : tc);
  session.approvedIds = (session.approvedIds || []).filter((value) => id(value) !== key);
  if (session.approvedContractSeals) delete session.approvedContractSeals[key];
  session.generatedScript = null;
  const failedEvidence = attempt.verification;
  attempt.status = 'ROLLED_BACK';
  attempt.rollbackMode = options.automatic ? 'AUTOMATIC_REGRESSION_FAILURE' : 'MANUAL';
  attempt.rollbackReason = String(options.reason || failedEvidence?.reason || '').slice(0, 500) || null;
  attempt.rejectedCandidateHash = attempt.candidateHash;
  attempt.candidateHash = contractIdentity(restored);
  attempt.verifiedAt = null;
  attempt.verification = options.automatic ? failedEvidence : null;
  attempt.rolledBackAt = timestamp();
  // A rollback revokes validated learning: a reverted repair must never
  // influence future tests or persist as a successful memory.
  session.validatedRepairMemory = (session.validatedRepairMemory || []).filter((memory) =>
    memory.attemptId !== attempt.attemptId);
  session.automationReadiness = { ...(session.automationReadiness || {}), ready: (session.testCases || []).filter((tc) => tc.automationReadiness?.status === 'READY').length };
  return restored;
}
module.exports = { hash, contractIdentity, originFor, unchangedRequirements, failureSignature, dependencies, dependencyGraph, impactedCases, getAttempt, createAttempt, eligibleForValidation, suiteToValidate, verifyExecution, gateCheck, repairPattern, recordEvaluation, rollback };
