const { stableHash, executionPlanShape, displayExpectationShape } = require('./startupIntegrityGuards');

function contractReviewHash(testCase = {}) {
  return stableHash({
    ir: testCase.canonicalIr || null,
    compiled: executionPlanShape(testCase.automationReadiness?.automationPlan || {}),
    display: displayExpectationShape(testCase),
    executableHash: testCase.automationReadiness?.cypressContract?.scriptHash || null,
  });
}

function isConfirmedCurrentReview(testCase = {}) {
  const review = testCase.review;
  return !review || (
    review.status === 'CONFIRMED'
    && Boolean(review.confirmedAt)
    && Boolean(review.contractHash)
    && review.contractHash === contractReviewHash(testCase)
  );
}

module.exports = { contractReviewHash, isConfirmedCurrentReview };
