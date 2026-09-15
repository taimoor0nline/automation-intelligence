const STOP_WORDS = new Set(['the','a','an','and','or','to','of','for','with','when','then','after','before','is','are','be','been','being','should','must','can','able','customer','user','form','field','fields','test','verify','validation','validate','show','display']);

function clean(value) { return String(value || '').trim().replace(/\s+/g, ' '); }
function lower(value) { return clean(value).toLowerCase(); }
function uniq(values) { return [...new Set(values.filter(Boolean))]; }

function tokens(value) {
  return uniq(lower(value).split(/[^a-z0-9]+/).filter((part) => part.length >= 3 && !STOP_WORDS.has(part)));
}

function requirement(id, key, text) {
  return { id, key, text, mandatory: true, tokens: tokens(text) };
}

function extractConceptRequirements(story) {
  const text = lower(story);
  const found = [];
  const add = (key, label) => { if (!found.some((item) => item.key === key)) found.push({ key, text: label }); };

  if (/\b(log\s*in|login|sign\s*in|signin|authenticate|authentication)\b/.test(text) && /\bvalid\b/.test(text)) add('LOGIN_VALID', 'Login authentication with valid credentials');
  if (/\bfeedback\b/.test(text) && /\b(submit|submission|send)\b/.test(text)) add('FEEDBACK_SUBMIT', 'Complete feedback form submission');
  if (/\busername\b/.test(text) && /\bpassword\b/.test(text) && /\brequired\b/.test(text)) add('LOGIN_REQUIRED', 'Username and password required validation');
  if (/\bfeedback\b/.test(text) && /\brequired\s+fields?\b/.test(text)) add('FEEDBACK_REQUIRED', 'Feedback required-field validation');
  if (/\bemail\b/.test(text) && /\b(format|valid|invalid|validation)\b/.test(text)) add('EMAIL_FORMAT', 'Email format validation');
  if (/\bage\b/.test(text) && /\b(boundar(?:y|ies)|minimum|maximum|min|max|range|18|100)\b/.test(text)) add('AGE_BOUNDARY', 'Age boundary validation');
  if (/\bwebsite\b/.test(text) && /\burl\b/.test(text) && /\b(format|valid|invalid|validation)\b/.test(text)) add('WEBSITE_URL', 'Website URL format validation');
  if (/\b(confirmation|success\s+(?:message|panel|confirmation)|thank\s+you)\b/.test(text) || (/\bshow\b/.test(text) && /\bconfirmation\b/.test(text))) add('SUCCESS_CONFIRMATION', 'Success confirmation after submission');

  return found;
}

function extractGenericRequirements(story, existing) {
  const seenText = new Set(existing.map((item) => lower(item.text)));
  const clauses = String(story || '')
    .split(/[.!?;]+/)
    .map(clean)
    .filter((part) => part && /\b(must|required|should|shall|needs? to|able to)\b/i.test(part));
  const generic = [];
  for (const clause of clauses) {
    const normalized = clause.replace(/^as\s+[^,]+,?\s*/i, '').replace(/^(?:the\s+)?(?:user|customer)\s+/i, '');
    const clauseTokens = tokens(normalized);
    if (clauseTokens.length < 2) continue;
    const overlapsKnown = existing.some((item) => {
      const known = new Set(item.tokens);
      return clauseTokens.filter((token) => known.has(token)).length >= Math.min(2, known.size || 2);
    });
    if (overlapsKnown || seenText.has(lower(normalized))) continue;
    seenText.add(lower(normalized));
    generic.push({ key: `GENERIC_${generic.length + 1}`, text: normalized });
  }
  return generic;
}

function extractExplicitRequirements(story) {
  const concepts = extractConceptRequirements(story);
  const generic = extractGenericRequirements(story, concepts.map((item, index) => requirement(`R${String(index + 1).padStart(3, '0')}`, item.key, item.text)));
  return [...concepts, ...generic].map((item, index) => requirement(`R${String(index + 1).padStart(3, '0')}`, item.key, item.text));
}

function caseEvidence(testCase = {}) {
  return lower([
    testCase.id,
    testCase.title,
    testCase.type,
    testCase.testCategory,
    testCase.coverageRationale,
    ...(testCase.preconditions || []),
    ...(testCase.expectedResults || []),
    JSON.stringify(testCase.canonicalIr || {}),
    JSON.stringify(testCase.automationReadiness?.automationPlan || {}),
  ].filter(Boolean).join(' '));
}

function keyMatch(key, testCase, evidence) {
  const intent = lower([testCase?.title, testCase?.coverageRationale, testCase?.type, ...(testCase?.preconditions || [])].filter(Boolean).join(' '));
  const has = (...parts) => parts.every((part) => evidence.includes(part));
  switch (key) {
    case 'LOGIN_VALID': return (/\b(login|authentication|signin|sign in)\b/.test(intent) && /\b(valid|successful|success|positive)\b/.test(intent)) || /\"operation\":\"login_valid\"/.test(evidence);
    case 'FEEDBACK_SUBMIT': return String(testCase?.type || '').toLowerCase() === 'positive' && intent.includes('feedback') && /\b(submit|submission|complete|successful|positive)\b/.test(intent);
    case 'LOGIN_REQUIRED': return /\b(username|user-name)\b/.test(evidence) && /\b(password)\b/.test(evidence) && /\b(required|missing|empty|negative)\b/.test(intent + ' ' + evidence);
    case 'FEEDBACK_REQUIRED': return intent.includes('feedback') && /\b(required|missing|empty|reject)\b/.test(intent) && /full-name|email-error|required field/.test(evidence);
    case 'EMAIL_FORMAT': return intent.includes('email') && /\b(format|invalid|malformed)\b/.test(intent);
    case 'AGE_BOUNDARY': return intent.includes('age') && /\b(boundary|minimum|maximum|min|max|17|18|100|101)\b/.test(intent + ' ' + evidence);
    case 'WEBSITE_URL': return (has('website','url') || intent.includes('website')) && /\b(format|invalid|malformed)\b/.test(intent);
    case 'SUCCESS_CONFIRMATION': return /\b(confirmation|success-panel|thank you|success confirmation|success message)\b/.test(evidence);
    default: return false;
  }
}

function genericMatch(requirementItem, evidence) {
  const reqTokens = requirementItem.tokens || [];
  if (!reqTokens.length) return false;
  const evidenceTokens = new Set(tokens(evidence));
  const matches = reqTokens.filter((token) => evidenceTokens.has(token)).length;
  const threshold = reqTokens.length <= 2 ? reqTokens.length : Math.ceil(reqTokens.length * 0.6);
  return matches >= threshold;
}

function isExecutable(testCase = {}) {
  return String(testCase?.automationReadiness?.status || '').toUpperCase() === 'READY' &&
    Array.isArray(testCase?.automationReadiness?.automationPlan?.assertions) &&
    testCase.automationReadiness.automationPlan.assertions.length > 0;
}

function coversRequirement(requirementItem, testCase) {
  if (!isExecutable(testCase)) return false;
  const evidence = caseEvidence(testCase);
  if (requirementItem.key.startsWith('GENERIC_')) return genericMatch(requirementItem, evidence);
  return keyMatch(requirementItem.key, testCase, evidence);
}

function calculateRequirementCoverage(session = {}) {
  const requirements = extractExplicitRequirements(session.story || '');
  const cases = Array.isArray(session.testCases) ? session.testCases : [];
  const executable = cases.filter(isExecutable);
  const rows = requirements.map((item) => {
    const matched = executable.filter((testCase) => coversRequirement(item, testCase)).map((testCase) => testCase.id);
    return { id: item.id, key: item.key, requirement: item.text, mandatory: true, covered: matched.length > 0, testCaseIds: matched };
  });
  const covered = rows.filter((row) => row.covered);
  const uncovered = rows.filter((row) => !row.covered);
  const score = rows.length ? Math.round((covered.length / rows.length) * 100) : 0;

  const caseCoverage = executable.map((testCase) => ({
    testCaseId: testCase.id,
    requirementIds: rows.filter((row) => row.testCaseIds.includes(testCase.id)).map((row) => row.id),
  }));
  const seen = new Set();
  const redundantTestCases = [];
  for (const item of caseCoverage.sort((a, b) => String(a.testCaseId).localeCompare(String(b.testCaseId), undefined, { numeric: true }))) {
    if (!item.requirementIds.length) continue;
    const addsCoverage = item.requirementIds.some((id) => !seen.has(id));
    if (!addsCoverage) redundantTestCases.push(item.testCaseId);
    item.requirementIds.forEach((id) => seen.add(id));
  }

  const proposal = session.coverageProposal || {};
  const failures = Array.isArray(proposal.generationFailures) ? proposal.generationFailures : [];
  const readiness = session.automationReadiness || {};
  const configuredMax = Math.max(1, Math.min(Number(process.env.AI_TEST_CASE_COUNT || 6) || 6, 250));
  const max = Number(proposal.maxTestCases || session.maxTestCases || session.canonicalGenerationPlan?.units?.length || configuredMax) || configuredMax;
  const planned = Number(proposal.proposedTestCaseCount || session.canonicalGenerationPlan?.units?.length || 0) || 0;
  const discovery = session.discoveryStatus || {};
  const terminalFailure = session.lastGenerationFailure || discovery.failure || null;
  const discoveryGaps = [
    ...(Array.isArray(proposal.knownGaps) ? proposal.knownGaps : []),
    ...(Array.isArray(discovery.warnings) ? discovery.warnings : []),
    terminalFailure?.message || null,
  ].map(clean).filter(Boolean);

  let summary;
  if (rows.length) {
    summary = `${covered.length} of ${rows.length} explicit story requirements are mapped to Automation Ready canonical assertions.`;
  } else if (terminalFailure) {
    summary = `Exploratory generation was blocked before test planning: ${clean(terminalFailure.message)}`;
  } else if (cases.length) {
    summary = `${cases.length} exploratory test case${cases.length === 1 ? '' : 's'} generated from rendered application evidence. No explicit requirement clauses were supplied, so a requirement percentage is not applicable.`;
  } else {
    summary = 'Exploratory scope: no explicit requirement clauses were supplied. Coverage will be reported from generated, evidence-grounded test cases after planning completes.';
  }

  return {
    mode: rows.length ? 'DETERMINISTIC_EXPLICIT_REQUIREMENT_COVERAGE' : 'EXPLORATORY_SCOPE_STATUS',
    score,
    coveredCount: covered.length,
    totalRequirements: rows.length,
    uncoveredCount: uncovered.length,
    requirements: rows,
    coveredRequirements: covered.map((row) => row.requirement),
    uncoveredMandatoryRequirements: uncovered.map((row) => row.requirement),
    executableTestCaseCount: executable.length,
    generatedTestCaseCount: cases.length,
    plannedTestCaseCount: planned,
    maxTestCases: max,
    generationFailureCount: failures.length + (terminalFailure ? 1 : 0),
    generationFailures: [
      ...failures.map((item) => ({
        plannedId: item.plannedId || null,
        message: item.message || 'Planned case was not generated.',
        category: item.category || null,
        scenarioType: item.scenarioType || null,
      })),
      ...(terminalFailure ? [{ plannedId: null, message: clean(terminalFailure.message), category: null, scenarioType: null, stage: terminalFailure.stage || 'DISCOVERY', code: terminalFailure.code || null }] : []),
    ],
    redundantTestCases,
    knownDiscoveryGaps: uniq(discoveryGaps),
    discovery: {
      complete: discovery.complete === true,
      partial: discovery.partial === true,
      pageCount: Number(discovery.pageCount || 0),
      failureCode: terminalFailure?.code || null,
    },
    generationComplete: proposal.generationComplete !== null && proposal.generationComplete !== undefined ? Boolean(proposal.generationComplete) : session.state === 'AWAITING_APPROVAL' || session.state === 'DONE',
    readinessValidated: Boolean(session.readinessValidated),
    readiness: {
      ready: Number(readiness.ready || 0),
      total: Number(readiness.total || cases.length || 0),
    },
    summary,
  };
}

module.exports = { extractExplicitRequirements, calculateRequirementCoverage, coversRequirement, isExecutable };