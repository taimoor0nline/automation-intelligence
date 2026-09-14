const express = require('express');
const router = express.Router();

const { getSession } = require('../data/sessionStore');
const { assessTestCases } = require('../services/testCaseFeasibility');
const { stableHash, executionPlanShape, displayExpectationShape } = require('../services/startupIntegrityGuards');

function configuredActorRefs(session) {
  return Object.entries(session.actorCredentials || {})
    .filter(([, credentials]) => credentials?.username && credentials?.password)
    .map(([actorRef]) => actorRef);
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

function visibleContractMismatch(testCase) {
  if (!testCase?.canonicalIr || testCase?.automationReadiness?.status !== 'READY') return null;
  const visibleSelectors = selectorTokens((testCase.expectedResults || []).join('\n')).map(normalizedSelector);
  if (!visibleSelectors.length) return null;
  const compiledSelectors = new Set((testCase.automationReadiness?.automationPlan?.assertions || [])
    .map((item) => normalizedSelector(item?.selector))
    .filter(Boolean));
  const missing = visibleSelectors.filter((selector) => !compiledSelectors.has(selector));
  if (!missing.length) return null;
  return `The reviewed expectation references ${missing.join(', ')}, but the compiled canonical assertions do not. The displayed expectation and executable contract must be identical before approval.`;
}

function seal(testCase) {
  if (!testCase?.canonicalIr || testCase?.automationReadiness?.status !== 'READY') return testCase;
  const plan = testCase.automationReadiness.automationPlan || {};
  return {
    ...testCase,
    canonicalValidation: {
      ...(testCase.canonicalValidation || {}),
      approvedCanonicalHash: stableHash(testCase.canonicalIr),
      approvedCompiledHash: stableHash(executionPlanShape(plan)),
      approvedDisplayExpectationHash: stableHash(displayExpectationShape(testCase)),
      approvedAt: new Date().toISOString(),
      approvalContractVersion: 1,
      approvalMode: 'HUMAN_REVIEWED_DETERMINISTIC_CONTRACT',
    },
  };
}

router.use((req, res, next) => {
  if (req.method !== 'POST' || req.path !== '/api/chat') return next();
  const body = req.body || {};
  const isRunRequest = body.message === 'approve reviewed cases' || Array.isArray(body.approvedIds);
  if (!isRunRequest) return next();

  try {
    const sessionId = body.sessionId || 'default';
    const session = getSession(sessionId);
    const source = Array.isArray(body.reviewedTestCases) ? body.reviewedTestCases : session.testCases;
    if (!Array.isArray(source) || !source.length) return next();

    const assessed = assessTestCases(source, {
      pageDiscoveries: session.pageDiscoveries || [],
      hasCredentials: Boolean(session.credentials?.username && session.credentials?.password),
      actorCatalog: session.testActors || [],
      actorCredentialRefs: configuredActorRefs(session),
      story: session.story || '',
    });
    const approved = new Set((Array.isArray(body.approvedIds) ? body.approvedIds : []).map((id) => String(id || '').toUpperCase()));

    for (const testCase of assessed) {
      if (!testCase?.canonicalIr || (approved.size && !approved.has(String(testCase.id || '').toUpperCase()))) continue;
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

    const sealed = assessed.map(seal);
    req.body.reviewedTestCases = sealed;
    session.testCases = sealed;
    session.approvedContractSeals = Object.fromEntries(sealed
      .filter((testCase) => testCase?.canonicalValidation?.approvedCompiledHash)
      .map((testCase) => [testCase.id, {
        canonicalHash: testCase.canonicalValidation.approvedCanonicalHash,
        compiledHash: testCase.canonicalValidation.approvedCompiledHash,
        displayExpectationHash: testCase.canonicalValidation.approvedDisplayExpectationHash,
        approvedAt: testCase.canonicalValidation.approvedAt,
      }]));
    return next();
  } catch (err) {
    return res.status(422).json({ reply: `Approval contract validation failed: ${err.message}`, code: 'APPROVAL_CONTRACT_VALIDATION_FAILED' });
  }
});

module.exports = router;
