// Active progressive-generation entry point.
// Canonical IR is the default architecture. The previous scalable English-DSL
// generator remains available as an emergency compatibility switch during rollout.
const express = require('express');
const router = express.Router();

const canonicalEnabled = !['false','0','no','off'].includes(String(process.env.AUTOMATION_CANONICAL_IR_ENABLED ?? 'true').toLowerCase());
const activeGenerationRouter = canonicalEnabled
  ? require('./progressiveGenerationCanonical')
  : require('./progressiveGenerationScalable');

// Block new Custom test generation before either generation architecture sees the
// request. Historical Custom cases remain readable in existing sessions/reports.
router.use(require('./customTestDisableGuard'));

// Keep generation first, then add deterministic coverage, repair, and approval-contract
// guards to the same platform route stack. Repair always creates a new unapproved
// contract; approval sealing still happens only on an explicit human Run/Re-run action.
router.use(activeGenerationRouter);
router.use(require('./requirementCoverage'));
router.use(require('./testCaseRepairWorkbench'));
router.use(require('./approvalContractGuard'));

module.exports = router;
