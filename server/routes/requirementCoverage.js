const express = require('express');
const router = express.Router();
const { getSession } = require('../data/sessionStore');
const { calculateRequirementCoverage } = require('../services/requirementCoverage');

router.get('/api/requirement-coverage/:sessionId', (req, res) => {
  try {
    const session = getSession(req.params.sessionId || 'default');
    if (!session?.story) return res.status(404).json({ ok: false, reply: 'No generated story exists for this session.' });
    return res.json({ ok: true, coverage: calculateRequirementCoverage(session) });
  } catch (err) {
    return res.status(500).json({ ok: false, reply: `Requirement coverage could not be calculated: ${err.message}` });
  }
});

module.exports = router;
