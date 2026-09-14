// Active progressive-generation entry point.
// Canonical IR is the default architecture. The previous scalable English-DSL
// generator remains available as an emergency compatibility switch during rollout.
const express = require('express');
const router = express.Router();

const canonicalEnabled = !['false','0','no','off'].includes(String(process.env.AUTOMATION_CANONICAL_IR_ENABLED ?? 'true').toLowerCase());
const activeGenerationRouter = canonicalEnabled
  ? require('./progressiveGenerationCanonical')
  : require('./progressiveGenerationScalable');

// Keep generation first, then add deterministic coverage and approval-contract
// guards to the same platform route stack. The approval guard calls next() for
// ordinary requests and only seals canonical contracts on explicit run approval.
router.use(activeGenerationRouter);
router.use(require('./requirementCoverage'));
router.use(require('./approvalContractGuard'));

module.exports = router;
