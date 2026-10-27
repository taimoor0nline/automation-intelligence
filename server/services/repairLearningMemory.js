'use strict';
// Retrieval only: learned repairs never bypass canonical validation, human review,
// or the real browser regression gate. Project + target-origin are strict boundaries.
const db = require('../db');
const learning = require('./repairLearning');

const STOP = new Set([
  'a','an','the','and','or','with','without','on','in','at','to','from','for','of','by','this','that',
  'test','case','tests','verify','check','ensure','should','must','when','then','user','users',
  'page','field','form','application','using','be','is','are','was','were','can','cannot',
  'valid','invalid','input','value','values','expected','result','results','scenario','functional',
]);
function tokens(value) {
  return [...new Set(String(value || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/).filter((word) => word.length >= 3 && !STOP.has(word)))].sort().slice(0, 40);
}
function purpose(testCase = {}) {
  return String(testCase.canonicalIr?.objective || testCase.coverageRationale || testCase.title || '');
}
function matchScore(a, b) {
  const first = new Set(tokens(a));
  const second = new Set(tokens(b));
  if (!first.size || !second.size) return 0;
  const common = [...first].filter((word) => second.has(word)).length;
  return common / Math.max(1, Math.min(first.size, second.size));
}
function groundedPattern(raw, registry) {
  const pattern = raw?.repairPattern;
  if (!pattern || !Array.isArray(pattern.before) || !Array.isArray(pattern.after)) return null;
  const available = new Set((registry?.elements || []).map((element) => String(element.elementRef || '')).filter(Boolean));
  const normalize = (parts) => parts.slice(0, 40).map((step) => ({
    operation: String(step?.operation || '').replace(/[^A-Z0-9_]/gi, '').toUpperCase().slice(0, 60),
    elementRef: String(step?.elementRef || '').slice(0, 180),
  })).filter((step) => step.operation && (!step.elementRef || available.has(step.elementRef)));
  const before = normalize(pattern.before);
  const after = normalize(pattern.after);
  // Do not partially replay an old pattern whose references disappeared.
  if (before.length !== pattern.before.length || after.length !== pattern.after.length || !after.length) return null;
  return { before, after };
}
function normalizedRecords(records = []) {
  const seen = new Set();
  return records.filter((record) => {
    if (!record || record.approval !== 'HUMAN_CONFIRMED_AND_BROWSER_VERIFIED') return false;
    const key = String(record.attemptId || record.memoryId || '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function findMatchingHints({ records = [], session, testCase, objective = '' }) {
  const scope = learning.originFor(session);
  if (!scope) return [];
  const intent = objective || purpose(testCase);
  if (!intent) return [];
  const candidates = [];
  for (const record of normalizedRecords(records)) {
    if (record.targetOrigin !== scope) continue;
    if (record.projectId && String(record.projectId) !== String(session.projectId || '')) continue;
    const score = matchScore(intent, record.intent);
    if (score < 0.6 || (tokens(intent).length >= 2 && tokens(record.intent).length >= 2 &&
      tokens(intent).filter((token) => tokens(record.intent).includes(token)).length < 2)) continue;
    const shape = groundedPattern(record, session.canonicalElementRegistry);
    if (!shape) continue;
    const category = String(testCase?.testCategory || testCase?.category || '').toUpperCase();
    if (record.testCategory && category && String(record.testCategory).toUpperCase() !== category) continue;
    const scenario = String(testCase?.scenarioType || testCase?.type || '').toLowerCase();
    if (record.scenarioType && scenario && String(record.scenarioType).toLowerCase() !== scenario) continue;
    candidates.push({
      memoryId: record.memoryId || record.attemptId,
      priorCaseId: record.caseId,
      score: Math.round(score * 100) / 100,
      intent: String(record.intent).slice(0, 280),
      before: shape.before,
      after: shape.after,
      verifiedAt: record.verifiedAt,
    });
  }
  return candidates.sort((a, b) => b.score - a.score || String(b.verifiedAt).localeCompare(String(a.verifiedAt))).slice(0, 3);
}
function sessionMemories(session) {
  const reversed = new Set(Object.values(session.repairLearning || {})
    .filter((attempt) => ['ROLLED_BACK','REJECTED','AUTO_ROLLED_BACK'].includes(attempt.status))
    .map((attempt) => String(attempt.attemptId)));
  return (session.validatedRepairMemory || []).filter((entry) => !reversed.has(String(entry.attemptId)));
}
async function retrieveVerifiedMemory(session, { sessionId = 'default', limit = 100 } = {}) {
  const origin = learning.originFor(session);
  if (!origin) return [];
  // Never read another project's memories through session-only mode or a missing project id.
  if (!db.isEnabled()) return sessionMemories(session).filter((item) => item.targetOrigin === origin);
  if (!db.isConfigured()) return []; // fail closed, not a cross-tenant cache fallback
  const project = session.projectId || null;
  const rows = await db.query(
    `select attempt_id, external_case_id, project_id, target_origin, failure_signature,
       original_hash, candidate_hash, evidence_json, updated_at
     from repair_learning_events where outcome='VALIDATED' and target_origin=$1
     and (($2::uuid is not null and project_id=$2::uuid)
       or ($2::uuid is null and session_id=$3))
     order by updated_at desc limit $4`,
    [origin, project, String(sessionId), Math.max(1, Math.min(Number(limit) || 100, 200))]
  );
  return (rows.rows || []).map((row) => ({
    attemptId: row.attempt_id,
    memoryId: row.attempt_id,
    caseId: row.external_case_id,
    projectId: row.project_id,
    targetOrigin: row.target_origin,
    failureSignature: row.failure_signature,
    originalHash: row.original_hash,
    candidateHash: row.candidate_hash,
    verifiedAt: row.updated_at,
    approval: 'HUMAN_CONFIRMED_AND_BROWSER_VERIFIED',
    repairPattern: row.evidence_json?.repairPattern,
    intent: row.evidence_json?.intent || '',
    testCategory: row.evidence_json?.testCategory || '',
    scenarioType: row.evidence_json?.scenarioType || '',
  }));
}
async function hintsForCase(session, testCase, { sessionId = 'default', objective = '' } = {}) {
  const records = await retrieveVerifiedMemory(session, { sessionId });
  return findMatchingHints({ records, session, testCase, objective });
}
function describeHints(hints) {
  if (!hints?.length) return '';
  // Small and source-free. Never give the model unchecked XPath, executable JS,
  // credentials, source snippets, or an instruction to remove assertions.
  const compact = hints.map((hint) => ({
    similarity: hint.score, validatedBefore: hint.before, validatedAfter: hint.after,
  }));
  return '\nPrevious browser-verified repair guidance (advisory only): ' +
    JSON.stringify(compact).slice(0, 2000) +
    '\nReuse only if the current rendered registry supports every reference. ' +
    'Preserve the user story and every business assertion; validate the result independently.';
}
module.exports = { tokens, purpose, matchScore, groundedPattern, findMatchingHints, sessionMemories, retrieveVerifiedMemory, hintsForCase, describeHints };
