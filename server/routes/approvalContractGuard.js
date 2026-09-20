const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const { getSession } = require('../data/sessionStore');
const { assessTestCases } = require('../services/testCaseFeasibility');
const { stableHash, executionPlanShape, displayExpectationShape } = require('../services/startupIntegrityGuards');
const executionGenerator = require('../services/deterministicAutomationGeneratorV7');
const { validateGroundedScript } = require('../services/scriptValidator');
const { isConfirmedCurrentReview } = require('../services/reviewContract');

function configuredActorRefs(session) {
  return Object.entries(session.actorCredentials || {})
    .filter(([, credentials]) => credentials?.username && credentials?.password)
    .map(([actorRef]) => actorRef);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function selectorTokens(text) {
  const value = String(text || '');
  const selectors = new Set();
  for (const match of value.matchAll(/\[data-testid=["']([^"']+)["']\]/g)) selectors.add(`[data-testid="${match[1]}"]`);
  for (const match of value.matchAll(/#[A-Za-z][A-Za-z0-9_-]*/g)) selectors.add(match[0]);
  return [...selectors];
}

function normalizedSelector(value) {
  return String(value || '').replace(/'/g, '"').replace(/\s+/g, '').toLowerCase();
}

function normalizedExpectation(value) {
  return String(value || '').trim().replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').replace(/[.]$/, '').toLowerCase();
}

function visibleContractMismatch(testCase) {
  if (!testCase?.canonicalIr || testCase?.automationReadiness?.status !== 'READY') return null;
  const visible = (testCase.expectedResults || []).map(normalizedExpectation).filter(Boolean);
  const details = testCase.automationReadiness?.expectationCoverage?.details || testCase.automationReadiness?.automationPlan?.expectationCoverage?.details || [];
  const compiled = details.map((item) => normalizedExpectation(item?.expectation)).filter(Boolean);
  if (compiled.length) {
    const visibleSet = new Set(visible);
    const compiledSet = new Set(compiled);
    const onlyVisible = visible.filter((item) => !compiledSet.has(item));
    const onlyCompiled = compiled.filter((item) => !visibleSet.has(item));
    if (onlyVisible.length || onlyCompiled.length || visible.length !== compiled.length) {
      return `The reviewed expected results and compiled canonical assertions differ. Reviewed-only: ${onlyVisible.join(' | ') || 'none'}. Compiled-only: ${onlyCompiled.join(' | ') || 'none'}.`;
    }
    return null;
  }

  const visibleSelectors = selectorTokens((testCase.expectedResults || []).join('\n')).map(normalizedSelector);
  if (!visibleSelectors.length) return null;
  const compiledSelectors = new Set((testCase.automationReadiness?.automationPlan?.assertions || [])
    .map((item) => normalizedSelector(item?.selector))
    .filter(Boolean));
  const missing = visibleSelectors.filter((selector) => !compiledSelectors.has(selector));
  if (!missing.length) return null;
  return `The reviewed expectation references ${missing.join(', ')}, but the compiled canonical assertions do not. The displayed expectation and executable contract must be identical before approval.`;
}

function freezeExecutionSource(testCase, session) {
  const generated = executionGenerator.generateDeterministicAutomation([testCase]);
  const script = String(generated.script || '');
  const actorCredentialRefs = configuredActorRefs(session);
  const validation = validateGroundedScript(script, {
    approvedTestCases: [testCase],
    pageDiscoveries: session.pageDiscoveries || [],
    hasCredentials: Boolean(session.credentials?.username && session.credentials?.password),
    loginSelectors: testCase?.automationReadiness?.cypressContract?.loginRuntime?.selectors || undefined,
    actorCredentialRefs,
    frameworkOwnedSelectors: ['body'],
  });
  if (!validation.valid) {
    const error = new Error(`The exact approved execution source failed deterministic source validation: ${(validation.errors || []).join(' | ')}`);
    error.code = 'APPROVED_EXECUTION_SOURCE_INVALID';
    throw error;
  }
  return {
    script,
    hash: sha256(script),
    fileName: generated.fileName,
    generationMode: generated.generationMode,
  };
}

function seal(testCase, session) {
  if (!testCase?.canonicalIr || testCase?.automationReadiness?.status !== 'READY') return testCase;
  const plan = testCase.automationReadiness.automationPlan || {};
  const cypressContract = testCase.automationReadiness.cypressContract || {};
  const frozen = freezeExecutionSource(testCase, session);
  return {
    ...testCase,
    canonicalValidation: {
      ...(testCase.canonicalValidation || {}),
      approvedCanonicalHash: stableHash(testCase.canonicalIr),
      approvedCompiledHash: stableHash(executionPlanShape(plan)),
      approvedDisplayExpectationHash: stableHash(displayExpectationShape(testCase)),
      approvedCypressArtifactHash: cypressContract.scriptHash || null,
      approvedCypressValidatorVersion: cypressContract.version || null,
      approvedAutomationSource: frozen.script,
      approvedAutomationSourceHash: frozen.hash,
      approvedAutomationFileName: frozen.fileName,
      approvedAutomationGenerationMode: frozen.generationMode,
      approvedAt: new Date().toISOString(),
      approvalContractVersion: 3,
      approvalMode: 'HUMAN_REVIEWED_FROZEN_EXECUTION_CONTRACT',
    },
  };
}

function requestPath(req) {
  return String(req.originalUrl || req.url || req.path || '').split('?')[0];
}

function isExecutionApprovalRequest(req) {
  if (req.method !== 'POST') return false;
  const path = requestPath(req);
  const body = req.body || {};
  if (path === '/api/chat') {
    return body.message === 'approve reviewed cases' || Array.isArray(body.approvedIds);
  }
  if (path === '/api/test-runs/start') {
    return Array.isArray(body.approvedIds);
  }
  return false;
}

router.use((req, res, next) => {
  if (!isExecutionApprovalRequest(req)) return next();

  try {
    const body = req.body || {};
    const sessionId = body.sessionId || 'default';
    const session = getSession(sessionId);
    const submitted = Array.isArray(body.reviewedTestCases) && body.reviewedTestCases.length
      ? body.reviewedTestCases
      : session.testCases;
    if (!Array.isArray(submitted) || !submitted.length) return next();

    const authoritative = new Map((session.testCases || [])
      .map((testCase) => [String(testCase?.id || '').toUpperCase(), testCase]));
    const source = submitted.map((testCase) => {
      const original = authoritative.get(String(testCase?.id || '').toUpperCase());
      if (!original?.review) return testCase;
      // Never trust a browser-supplied confirmed flag, canonical IR, approval
      // or altered expectation: a reviewed edit is sourced from the server.
      if (stableHash(testCase.canonicalIr) !== stableHash(original.canonicalIr)
          || stableHash(displayExpectationShape(testCase)) !== stableHash(displayExpectationShape(original))) {
        const error = new Error(`Reviewed case ${testCase.id} differs from the saved draft. Reopen and confirm its latest version.`);
        error.code = 'REVIEWED_CONTRACT_CLIENT_MISMATCH';
        throw error;
      }
      return original;
    });

    const assessed = assessTestCases(source, {
      pageDiscoveries: session.pageDiscoveries || [],
      canonicalElementRegistry: session.canonicalElementRegistry || null,
      story: session.story || '',
      hasCredentials: Boolean(session.credentials?.username && session.credentials?.password),
      actorCatalog: session.testActors || [],
      actorCredentialRefs: configuredActorRefs(session),
    });
    const approved = new Set((Array.isArray(body.approvedIds) ? body.approvedIds : []).map((id) => String(id || '').toUpperCase()));

    for (const testCase of assessed) {
      const selected = !approved.size || approved.has(String(testCase.id || '').toUpperCase());
      if (!selected || !testCase?.canonicalIr) continue;

      if (!isConfirmedCurrentReview(testCase)) {
        return res.status(422).json({
          reply: `Execution blocked for ${testCase.id}: the edited draft must be reviewed and explicitly confirmed after validation.`,
          code: 'HUMAN_REVIEW_CONFIRMATION_REQUIRED',
          testCaseId: testCase.id,
          review: testCase.review || null,
        });
      }

      if (testCase?.automationReadiness?.status !== 'READY') {
        return res.status(422).json({
          reply: `Execution blocked for ${testCase.id}: ${testCase?.automationReadiness?.reason || 'the test is not Automation Ready under the strict execution contract.'}`,
          code: 'EXECUTION_CONTRACT_NOT_READY',
          testCaseId: testCase.id,
          automationReadiness: testCase.automationReadiness,
        });
      }

      const cypressContract = testCase?.automationReadiness?.cypressContract;
      if (!cypressContract?.ok || !cypressContract?.scriptHash) {
        return res.status(422).json({
          reply: `Execution blocked for ${testCase.id}: the exact automation artifact has not passed strict deterministic validation. Revalidate the test before execution.`,
          code: 'EXECUTION_ARTIFACT_NOT_VALIDATED',
          testCaseId: testCase.id,
          automationReadiness: testCase.automationReadiness,
        });
      }

      const mismatch = visibleContractMismatch(testCase);
      if (mismatch) {
        return res.status(422).json({
          reply: `Execution blocked for ${testCase.id}: ${mismatch}`,
          code: 'REVIEWED_EXPECTATION_CONTRACT_MISMATCH',
          testCaseId: testCase.id,
          automationReadiness: testCase.automationReadiness,
        });
      }
    }

    // Clicking Run/Re-run is the explicit human approval event. The exact generated
    // source is frozen here and later executed byte-for-byte. Runtime execution may
    // validate the hash, but it must never silently regenerate a different source.
    const sealed = assessed.map((testCase) => {
      const selected = !approved.size || approved.has(String(testCase.id || '').toUpperCase());
      return selected ? seal(testCase, session) : testCase;
    });

    req.body.reviewedTestCases = sealed;
    session.testCases = sealed;
    session.approvedContractSeals = Object.fromEntries(sealed
      .filter((testCase) => testCase?.canonicalValidation?.approvedCompiledHash)
      .map((testCase) => [testCase.id, {
        canonicalHash: testCase.canonicalValidation.approvedCanonicalHash,
        compiledHash: testCase.canonicalValidation.approvedCompiledHash,
        displayExpectationHash: testCase.canonicalValidation.approvedDisplayExpectationHash,
        cypressArtifactHash: testCase.canonicalValidation.approvedCypressArtifactHash,
        frozenSourceHash: testCase.canonicalValidation.approvedAutomationSourceHash,
        cypressValidatorVersion: testCase.canonicalValidation.approvedCypressValidatorVersion,
        approvalContractVersion: testCase.canonicalValidation.approvalContractVersion,
        approvedAt: testCase.canonicalValidation.approvedAt,
      }]));
    return next();
  } catch (err) {
    return res.status(422).json({ reply: `Approval contract validation failed: ${err.message}`, code: err.code || 'APPROVAL_CONTRACT_VALIDATION_FAILED' });
  }
});

module.exports = router;
