const express = require('express');
const router = express.Router();

const { getSession, resetSession } = require('../data/sessionStore');
const { discoverPages } = require('../services/pageDiscovery');
const { compactDiscoveriesForModel } = require('../services/modelDiscoveryView');
const { normalizeProfile } = require('../services/aiModelProfiles');
const { TEST_CATEGORIES, normalizeTestCategory } = require('../services/testCategories');
const { SECURITY_SUBCATEGORIES, SECURITY_SEVERITIES, normalizeSecuritySubcategory, normalizeSecuritySeverity } = require('../services/securityTaxonomy');
const { proposeGenerationPlan, generateBatch } = require('../services/progressiveTestGenerator');
const { assessTestCases, readinessSummary } = require('../services/testCaseFeasibility');

const jobs = new Map();
// AI_TEST_CASE_COUNT is a ceiling, never a required/target count.
const MAX_CASE_LIMIT = Math.max(1, Math.min(Number(process.env.AI_TEST_CASE_COUNT || 6) || 6, 50));
const GENERATION_CONCURRENCY = Math.max(1, Math.min(Number(process.env.AI_GENERATION_CONCURRENCY || 2) || 2, 4));
const READINESS_CONCURRENCY = Math.max(1, Math.min(Number(process.env.READINESS_CONCURRENCY || 2) || 2, 8));
const JOB_TTL_MS = 30 * 60 * 1000;
const SCENARIO_TYPES = ['positive', 'negative', 'boundary'];

function cleanArray(input, normalizer, allowed) {
  const out = [...new Set((Array.isArray(input) ? input : []).map((x) => normalizer(x, null)).filter(Boolean))];
  const filtered = allowed ? out.filter((x) => allowed.includes(x)) : out;
  return filtered.length ? filtered : [...allowed];
}
function normalizeCategories(input) { return cleanArray(input, normalizeTestCategory, TEST_CATEGORIES); }
function normalizeSecuritySubcategories(input) { return cleanArray(input, normalizeSecuritySubcategory, SECURITY_SUBCATEGORIES); }
function normalizeSecuritySeverities(input) { return cleanArray(input, normalizeSecuritySeverity, SECURITY_SEVERITIES); }
function normalizeScenarioTypes(input) {
  const values = [...new Set((Array.isArray(input) ? input : []).map((x) => String(x || '').trim().toLowerCase()).filter((x) => SCENARIO_TYPES.includes(x)))];
  return values.length ? values : [...SCENARIO_TYPES];
}
function cleanCustomLabels(input) {
  return [...new Set((Array.isArray(input) ? input : []).map((x) => String(x || '').trim().slice(0, 80)).filter(Boolean))].slice(0, 20);
}
function allowQaManager(req, res, next) {
  if (!req.user) return next();
  const role = String(req.user.role || '').toUpperCase();
  if (!['QA', 'MANAGER'].includes(role)) return res.status(403).json({ reply: 'QA or MANAGER role is required for test generation.' });
  next();
}
function targetUrl(value) {
  const u = new URL(String(value || ''));
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only HTTP/HTTPS targets are supported.');
  return u.toString();
}
function discoveryUrls(baseUrl, additionalPaths = []) {
  const base = new URL(baseUrl);
  return [...new Set([
    baseUrl,
    ...(Array.isArray(additionalPaths) ? additionalPaths : [])
      .map((p) => String(p || '').trim())
      .filter(Boolean)
      .map((p) => new URL(p, `${base.protocol}//${base.host}/`).toString()),
  ])];
}
function pendingSummary(cases) {
  return {
    total: cases.length,
    ready: 0,
    checking: cases.filter((tc) => !tc?.automationReadiness).length,
    manual: 0,
    insufficientEvidence: 0,
    invalid: 0,
    userInputRequired: 0,
    aiRepairable: 0,
    frameworkChangeRequired: 0,
  };
}

function newJob(sessionId) {
  const job = { sessionId, state: 'STARTING', createdAt: Date.now(), events: [], subscribers: new Set(), completed: false, error: null };
  jobs.set(sessionId, job);
  return job;
}
function emit(job, type, data = {}) {
  const event = { type, at: new Date().toISOString(), ...data };
  job.events.push(event);
  if (job.events.length > 400) job.events.shift();
  const payload = `event: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const res of [...job.subscribers]) {
    try { res.write(payload); } catch { job.subscribers.delete(res); }
  }
}
function finish(job, type, data = {}) {
  emit(job, type, data);
  job.completed = true;
  job.state = type;
  for (const res of [...job.subscribers]) { try { res.end(); } catch {} }
  job.subscribers.clear();
}
function trimJobs() {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) if (job.completed && now - job.createdAt > JOB_TTL_MS) jobs.delete(id);
}

function createReadinessPool(job, session, slots) {
  const queue = [];
  const waiters = [];
  let active = 0;
  let completed = 0;

  function notifyDrain() {
    if (queue.length || active) return;
    while (waiters.length) waiters.shift()();
  }
  function updateSession() {
    const available = slots.filter(Boolean).sort((a, b) => a.id.localeCompare(b.id));
    session.testCases = available;
    const assessed = available.filter((tc) => tc.automationReadiness);
    session.automationReadiness = assessed.length ? readinessSummary(assessed) : pendingSummary(available);
  }
  function pump() {
    while (active < READINESS_CONCURRENCY && queue.length) {
      const tc = queue.shift();
      active += 1;
      emit(job, 'READINESS_STARTED', {
        testCaseId: tc.id,
        checking: active,
        completed,
        generated: slots.filter(Boolean).length,
      });
      setImmediate(() => {
        try {
          const assessed = assessTestCases([tc], {
            pageDiscoveries: session.pageDiscoveries || [],
            hasCredentials: Boolean(session.credentials?.username && session.credentials?.password),
          })[0];
          const index = slots.findIndex((item) => item?.id === tc.id);
          if (index >= 0 && assessed) slots[index] = { ...slots[index], ...assessed, automationReadiness: assessed.automationReadiness };
          completed += 1;
          updateSession();
          emit(job, 'READINESS_COMPLETED', {
            testCaseId: tc.id,
            testCase: index >= 0 ? slots[index] : assessed,
            readiness: assessed?.automationReadiness || null,
            completed,
            generated: slots.filter(Boolean).length,
          });
        } catch (err) {
          emit(job, 'READINESS_FAILED', { testCaseId: tc.id, message: err.message, completed, generated: slots.filter(Boolean).length });
        } finally {
          active -= 1;
          pump();
          notifyDrain();
        }
      });
    }
    notifyDrain();
  }

  return {
    enqueue(tc) { if (tc) { queue.push(tc); pump(); } },
    drain() { if (!queue.length && !active) return Promise.resolve(); return new Promise((resolve) => waiters.push(resolve)); },
    completed: () => completed,
  };
}

async function runGeneration(job, input) {
  const session = getSession(job.sessionId);
  const startedAt = Date.now();
  try {
    job.state = 'DISCOVERING';
    emit(job, 'GENERATION_STARTED', {
      maxTestCases: MAX_CASE_LIMIT,
      planning: true,
      concurrency: GENERATION_CONCURRENCY,
      readinessConcurrency: READINESS_CONCURRENCY,
    });

    const urls = discoveryUrls(input.targetUrl, input.additionalPaths);
    const discoveryStarted = Date.now();
    const pages = await discoverPages(urls);
    session.pageDiscoveries = pages;
    const compact = compactDiscoveriesForModel(pages);
    emit(job, 'DISCOVERY_COMPLETED', { pageCount: pages.length, durationMs: Date.now() - discoveryStarted });

    job.state = 'PLANNING';
    emit(job, 'COVERAGE_PLANNING_STARTED', { maxTestCases: MAX_CASE_LIMIT });
    const coveragePlan = await proposeGenerationPlan({
      story: input.story,
      pageDiscoveries: compact,
      allowedCategories: input.categories,
      allowedScenarioTypes: input.scenarioTypes,
      customCategories: input.customCategories,
      customScenarioTypes: input.customScenarioTypes,
      securitySubcategories: input.securitySubcategories,
      securitySeverities: input.securitySeverities,
      maxTestCases: MAX_CASE_LIMIT,
      modelTier: input.aiModelTier,
    });

    const units = coveragePlan.units.map((unit, index) => ({
      index,
      category: unit.category,
      scenarioType: unit.scenarioType,
      rationale: unit.rationale,
      customCategory: unit.category === 'CUSTOM' && input.customCategories.length ? input.customCategories[index % input.customCategories.length] : null,
      customScenarioType: unit.scenarioType === 'custom' && input.customScenarioTypes.length ? input.customScenarioTypes[index % input.customScenarioTypes.length] : null,
    }));
    const plannedCount = units.length;
    if (!plannedCount) throw new Error('AI coverage planning did not propose any evidence-supported test cases.');

    session.coverageProposal = {
      score: coveragePlan.coverageScore,
      summary: coveragePlan.coverageSummary,
      coveredAreas: coveragePlan.coveredAreas,
      knownGaps: coveragePlan.knownGaps,
      proposedTestCaseCount: plannedCount,
      maxTestCases: MAX_CASE_LIMIT,
    };

    emit(job, 'GENERATION_PLAN', {
      proposedTestCaseCount: plannedCount,
      maxTestCases: MAX_CASE_LIMIT,
      coverageScore: coveragePlan.coverageScore,
      coverageSummary: coveragePlan.coverageSummary,
      coveredAreas: coveragePlan.coveredAreas,
      knownGaps: coveragePlan.knownGaps,
      units,
      concurrency: GENERATION_CONCURRENCY,
      readinessConcurrency: READINESS_CONCURRENCY,
    });

    const slots = Array(plannedCount).fill(null);
    const readinessPool = createReadinessPool(job, session, slots);
    let nextUnit = 0;
    let completedCount = 0;
    let feature = null;

    async function generateUnit(unit, workerNumber) {
      const securityScope = unit.category === 'SECURITY';
      let lastError = null;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const batchStarted = Date.now();
        emit(job, 'BATCH_STARTED', {
          batchNumber: unit.index + 1,
          workerNumber,
          category: unit.category,
          scenarioType: unit.scenarioType,
          rationale: unit.rationale,
          requested: 1,
          generatedSoFar: completedCount,
          totalRequested: plannedCount,
        });
        try {
          const generated = await generateBatch({
            story: input.story,
            pageDiscoveries: compact,
            environment: 'Test',
            category: unit.category,
            scenarioType: unit.scenarioType,
            customCategory: unit.customCategory,
            customScenarioType: unit.customScenarioType,
            count: 1,
            excludeTitles: slots.filter(Boolean).map((tc) => tc.title),
            securitySubcategories: securityScope ? input.securitySubcategories : [],
            securitySeverities: securityScope ? input.securitySeverities : [],
            modelTier: input.aiModelTier,
          });
          feature ||= generated.feature;
          const raw = generated.testCases?.[0];
          if (!raw) throw new Error(`AI returned no ${unit.category}/${unit.scenarioType} test case.`);
          const duplicate = slots.some((existing) => existing && existing.title.trim().toLowerCase() === raw.title.trim().toLowerCase());
          if (duplicate) {
            lastError = new Error(`Duplicate test title returned for ${unit.category}/${unit.scenarioType}.`);
            continue;
          }

          const tc = {
            ...raw,
            id: `TC${String(unit.index + 1).padStart(3, '0')}`,
            source: 'ai',
            coverageRationale: unit.rationale || null,
            automationReadiness: null,
          };
          slots[unit.index] = tc;
          completedCount += 1;
          const available = slots.filter(Boolean).sort((a, b) => a.id.localeCompare(b.id));
          session.testCases = available;
          session.automationReadiness = pendingSummary(available);
          emit(job, 'BATCH_COMPLETED', {
            batchNumber: unit.index + 1,
            workerNumber,
            category: unit.category,
            scenarioType: unit.scenarioType,
            durationMs: Date.now() - batchStarted,
            cases: [tc],
            generatedSoFar: completedCount,
            totalRequested: plannedCount,
          });
          readinessPool.enqueue(tc);
          return;
        } catch (err) {
          lastError = err;
          if (attempt === 2) throw err;
        }
      }
      throw lastError || new Error('Generation unit failed.');
    }

    async function worker(workerNumber) {
      while (true) {
        const unitIndex = nextUnit;
        nextUnit += 1;
        if (unitIndex >= units.length) return;
        await generateUnit(units[unitIndex], workerNumber);
      }
    }

    job.state = 'GENERATING';
    const workerCount = Math.min(GENERATION_CONCURRENCY, units.length);
    await Promise.all(Array.from({ length: workerCount }, (_, i) => worker(i + 1)));

    const generatedCases = slots.filter(Boolean);
    if (generatedCases.length !== plannedCount) throw new Error(`Generation completed with ${generatedCases.length}/${plannedCount} AI-planned test cases.`);

    job.state = 'VALIDATING';
    emit(job, 'READINESS_DRAINING', { generated: generatedCases.length, completed: readinessPool.completed() });
    await readinessPool.drain();

    const cases = slots.filter(Boolean).sort((a, b) => a.id.localeCompare(b.id));
    session.testCases = cases;
    session.automationReadiness = readinessSummary(cases);
    session.readinessValidated = cases.every((tc) => Boolean(tc?.automationReadiness));
    session.state = 'AWAITING_APPROVAL';
    finish(job, 'GENERATION_COMPLETED', {
      feature,
      cases,
      automationReadiness: session.automationReadiness,
      pageCount: pages.length,
      totalGenerated: cases.length,
      maxTestCases: MAX_CASE_LIMIT,
      coverageProposal: session.coverageProposal,
      durationMs: Date.now() - startedAt,
      categoryPlan: units.map((unit) => unit.category),
      scenarioTypePlan: units.map((unit) => unit.scenarioType),
      concurrency: workerCount,
      readinessConcurrency: READINESS_CONCURRENCY,
    });
    console.log(`[progressive-generation] session=${job.sessionId} planned=${plannedCount}/${MAX_CASE_LIMIT} coverage=${coveragePlan.coverageScore}% cases=${cases.length} total=${Date.now() - startedAt}ms`);
  } catch (err) {
    job.error = err.message;
    session.state = 'IDLE';
    finish(job, 'GENERATION_FAILED', { message: err.message, generatedSoFar: session.testCases?.length || 0, maxTestCases: MAX_CASE_LIMIT });
    console.error(`[progressive-generation] session=${job.sessionId} failed:`, err);
  }
}

router.post('/api/generation/start', allowQaManager, (req, res) => {
  trimJobs();
  try {
    const sessionId = String(req.body?.sessionId || '').trim();
    const story = String(req.body?.message || req.body?.story || '').trim();
    if (!sessionId) return res.status(400).json({ reply: 'sessionId is required.' });
    if (!story) return res.status(400).json({ reply: 'Business user story is required.' });
    if (jobs.get(sessionId) && !jobs.get(sessionId).completed) return res.status(409).json({ reply: 'Generation is already running for this session.' });

    const url = targetUrl(req.body?.targetUrl);
    const categories = normalizeCategories(req.body?.selectedTestCategories);
    const scenarioTypes = normalizeScenarioTypes(req.body?.selectedScenarioTypes);
    const customCategories = cleanCustomLabels(req.body?.customTestCategories);
    const customScenarioTypes = cleanCustomLabels(req.body?.customScenarioTypes).map((x) => x.toLowerCase());
    const hasSecurity = categories.includes('SECURITY');
    const securitySubcategories = hasSecurity ? normalizeSecuritySubcategories(req.body?.selectedSecuritySubcategories) : [];
    const securitySeverities = hasSecurity ? normalizeSecuritySeverities(req.body?.selectedSecuritySeverities) : [];
    const aiModelTier = normalizeProfile(req.body?.aiModelTier || process.env.AI_MODEL_DEFAULT || 'fast');

    const session = resetSession(sessionId);
    session.state = 'GENERATING';
    session.story = story;
    session.targetUrl = url;
    session.environment = 'Test';
    session.additionalPaths = Array.isArray(req.body?.additionalPaths) ? req.body.additionalPaths : [];
    session.selectedTestCategories = categories;
    session.selectedScenarioTypes = scenarioTypes;
    session.customTestCategories = customCategories;
    session.customScenarioTypes = customScenarioTypes;
    session.selectedSecuritySubcategories = securitySubcategories;
    session.selectedSecuritySeverities = securitySeverities;
    session.aiModelTier = aiModelTier;
    session.coverageProposal = null;
    session.credentials = req.body?.credentials && typeof req.body.credentials === 'object'
      ? { username: String(req.body.credentials.username || ''), password: String(req.body.credentials.password || '') }
      : null;

    const job = newJob(sessionId);
    const input = {
      targetUrl: url,
      story,
      additionalPaths: session.additionalPaths,
      categories,
      scenarioTypes,
      customCategories,
      customScenarioTypes,
      securitySubcategories,
      securitySeverities,
      aiModelTier,
    };
    setImmediate(() => runGeneration(job, input));
    res.status(202).json({
      ok: true,
      sessionId,
      planning: true,
      maxTestCases: MAX_CASE_LIMIT,
      batchSize: 1,
      concurrency: GENERATION_CONCURRENCY,
      readinessConcurrency: READINESS_CONCURRENCY,
      eventsUrl: `/api/generation/events/${encodeURIComponent(sessionId)}`,
    });
  } catch (err) { res.status(400).json({ reply: err.message }); }
});

router.get('/api/generation/events/:sessionId', allowQaManager, (req, res) => {
  trimJobs();
  const job = jobs.get(req.params.sessionId);
  if (!job) return res.status(404).json({ reply: 'Generation job not found.' });
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  for (const event of job.events) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  if (job.completed) return res.end();
  job.subscribers.add(res);
  const heartbeat = setInterval(() => { try { res.write(': keep-alive\n\n'); } catch {} }, 15000);
  req.on('close', () => { clearInterval(heartbeat); job.subscribers.delete(res); });
});

module.exports = router;
