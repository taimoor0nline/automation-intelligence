const { stableHash, executionPlanShape, displayExpectationShape } = require('./startupIntegrityGuards');

function contractReviewHash(testCase = {}) {
  return stableHash({
    ir: testCase.canonicalIr || null,
    compiled: executionPlanShape(testCase.automationReadiness?.automationPlan || {}),
    display: displayExpectationShape(testCase),
    executableHash: testCase.automationReadiness?.cypressContract?.scriptHash || null,
  });
}

function ensurePendingReview(testCase = {}, revision = null) {
  if (!testCase?.canonicalIr) return testCase;
  const current = testCase.review;
  if (current?.status === 'PENDING_REVIEW' || current?.status === 'CONFIRMED') return testCase;
  const nextRevision = Number.isFinite(Number(revision))
    ? Math.max(1, Number(revision))
    : Math.max(1, (Number(current?.revision) || 0) + 1);
  return {
    ...testCase,
    review: {
      status: 'PENDING_REVIEW',
      revision: nextRevision,
      contractHash: contractReviewHash(testCase),
      confirmedAt: null,
    },
  };
}

function isConfirmedCurrentReview(testCase = {}) {
  if (!testCase?.canonicalIr) return true;
  const review = testCase.review;
  return Boolean(
    review
    && review.status === 'CONFIRMED'
    && review.confirmedAt
    && review.contractHash
    && review.contractHash === contractReviewHash(testCase)
  );
}

module.exports = { contractReviewHash, ensurePendingReview, isConfirmedCurrentReview };
