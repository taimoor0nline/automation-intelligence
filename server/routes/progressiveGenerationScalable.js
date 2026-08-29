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
const { validateStoryDiscoveryCompatibility, mismatchMessage } = require('../services/storyDiscoveryCompatibility');

const jobs = new Map();
// AI_TEST_CASE_COUNT is a ceiling, never a required/target count. 250 supports
// production suites in the 100-200 range while keeping a bounded safety limit.
const MAX_CASE_LIMIT = Math.max(1, Math.min(Number(process.env.AI_TEST_CASE_COUNT || 6) || 6, 250));
// Generate several compatible tests per provider call. Five is intentionally small
// enough for reliable structured output while reducing 100-200 individual AI calls.
const GENERATION_BATCH_SIZE = Math.max(1, Math.min(Number(process.env.AI_GENERATION_BATCH_SIZE || 5) || 5, 10));
const GENERATION_CONCURRENCY = Math.max(1, Math.min(Number(process.env.AI_GENERATION_CONCURRENCY || 2) || 2, 6));
const READINESS_CONCURRENCY = Math.max(1, Math.min(Number(process.env.READINESS_CONCURRENCY || 4) || 4, 12));
const GENERATION_BATCH_TIMEOUT_MS = Math.max(30000, Math.min(Number(process.env.AI_GENERATION_BATCH_TIMEOUT_MS || process.env.AI_GENERATION_UNIT_TIMEOUT_MS || 120000) || 120000, 300000));
const GENERATION_BATCH_MAX_ATTEMPTS = Math.max(1, Math.min(Number(process.env.AI_GENERATION_BATCH_MAX_ATTEMPTS || process.env.AI_GENERATION_UNIT_MAX_ATTEMPTS || 1) || 1, 3));
const SPLIT_FAILED_BATCHES = !['false','0','no','off'].includes(String(process.env.AI_GENERATION_SPLIT_FAILED_BATCHES ?? 'true').toLowerCase());
const JOB_TTL_MS = 30 * 60 * 1000;
const EVENT_HISTORY_LIMIT = 2500;
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
  const raw = [...new Set((Array.isArray(input) ? input : []).map((x) => String(x || '').trim().toLowerCase()).filter(Boolean))];
  if (!raw.length) return [...SCENARIO_TYPES];
  const invalid = raw.filter((x) => !SCENARIO_TYPES.includes(x));
  if (invalid.length) {
    const legacyFunctional = invalid.includes('functional');
    throw new Error(legacyFunctional
      ? 'Functional is a Test Category, not a Scenario Type. Select Positive, Negative and/or Boundary and refresh the page if an old Functional scenario option is still cached.'
      : `Unsupported Scenario Type: ${invalid.join(', ')}. Allowed values are Positive, Negative and Boundary.`);
  }
  return raw;
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

function batchScopeKey(unit) {
  return [unit.category, unit.scenarioType, unit.customCategory || '', unit.customScenarioType || ''].join('|');
}

function buildGenerationBatches(units) {
  const groups = new Map();
  for (const unit of units) {
    const key = batchScopeKey(unit);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(unit);
  }
  const batches = [];
  for (const grouped of groups.values()) {
    for (let offset = 0; offset < grouped.length; offset += GENERATION_BATCH_SIZE) {
      batches.push({ units: grouped.slice(offset, offset + GENERATION_BATCH_SIZE) });
    }
  }
  batches.sort((a, b) => a.units[0].index - b.units[0].index);
  batches.forEach((batch, index) => { batch.batchNumber = index + 1; });
  return batches;
}

function withBatchTimeout(promise, batch) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const numbers = batch.units.map((unit) => unit.index + 1);
      const error = new Error(`AI generation batch for planned case(s) ${numbers.join(', ')} timed out after ${Math.round(GENERATION_BATCH_TIMEOUT_MS / 1000)} seconds.`);
      error.code = 'AI_GENERATION_BATCH_TIMEOUT';
      reject(error);
    }, GENERATION_BATCH_TIMEOUT_MS);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => { if (timer) clearTimeout(timer); });
}

function newJob(sessionId) {
  const job = { sessionId, state: 'STARTING', createdAt: Date.now(), events: [], subscribers: new Set(), completed: false, error: null };
  jobs.set(sessionId, job);
  return job;
}
function emit(job, type, data = {}) {
  const event = { type, at: new Date().toISOString(), ...data };
  job.events.push(event);
  if (job.events.length > EVENT_HISTORY_LIMIT) job.events.shift();
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
          completed += 1;
          updateSession();
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
      batchSize: GENERATION_BATCH_SIZE,
      concurrency: GENERATION_CONCURRENCY,
      readinessConcurrency: READINESS_CONCURRENCY,
      generationBatchTimeoutMs: GENERATION_BATCH_TIMEOUT_MS,
      generationBatchMaxAttempts: GENERATION_BATCH_MAX_ATTEMPTS,
    });

    const urls = discoveryUrls(input.targetUrl, input.additionalPaths);
    const discoveryStarted = Date.now();
    const pages = await discoverPages(urls);
    session.pageDiscoveries = pages;
    const compact = compactDiscoveriesForModel(pages);
    emit(job, 'DISCOVERY_COMPLETED', { pageCount: pages.length, durationMs: Date.now() - discoveryStarted });

    const compatibility = validateStoryDiscoveryCompatibility(input.story, compact);
    session.storyDiscoveryCompatibility = compatibility;
    emit(job, 'SCOPE_VALIDATION_COMPLETED', {
      compatible: compatibility.compatible,
      requestedConcepts: compatibility.requestedConcepts,
      evidencedConcepts: compatibility.evidencedConcepts,
      missingConcepts: compatibility.missingConcepts,
      evidenceRatio: compatibility.evidenceRatio,
      finalUrls: compatibility.finalUrls,
    });
    if (!compatibility.compatible) {
      const error = new Error(mismatchMessage(compatibility, input.targetUrl));
      error.code = 'STORY_DISCOVERY_MISMATCH';
      error.scopeCompatibility = compatibility;
      throw error;
    }

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
    const batches = buildGenerationBatches(units);

    session.coverageProposal = {
      score: coveragePlan.coverageScore,
      summary: coveragePlan.coverageSummary,
      coveredAreas: coveragePlan.coveredAreas,
      knownGaps: coveragePlan.knownGaps,
      proposedTestCaseCount: plannedCount,
      maxTestCases: MAX_CASE_LIMIT,
      batchSize: GENERATION_BATCH_SIZE,
      plannedBatches: batches.length,
      storyDiscoveryEvidenceRatio: compatibility.evidenceRatio,
      generationComplete: null,
      generatedTestCaseCount: 0,
      generationFailures: [],
    };

    emit(job, 'GENERATION_PLAN', {
      proposedTestCaseCount: plannedCount,
      maxTestCases: MAX_CASE_LIMIT,
      coverageScore: coveragePlan.coverageScore,
      coverageSummary: coveragePlan.coverageSummary,
      coveredAreas: coveragePlan.coveredAreas,
      knownGaps: coveragePlan.knownGaps,
      units,
      batchSize: GENERATION_BATCH_SIZE,
      plannedBatches: batches.length,
      concurrency: GENERATION_CONCURRENCY,
      readinessConcurrency: READINESS_CONCURRENCY,
    });

    const slots = Array(plannedCount).fill(null);
    const generationFailures = [];
    const readinessPool = createReadinessPool(job, session, slots);
    let nextBatch = 0;
    let completedCount = 0;
    let feature = null;
    let dynamicBatchSequence = batches.length;

    function existingTitles() {
      return slots.filter(Boolean).map((tc) => tc.title);
    }

    function recordUnitFailure(unit, err, batchNumber) {
      const failure = {
        batchNumber,
        plannedCaseNumber: unit.index + 1,
        category: unit.category,
        scenarioType: unit.scenarioType,
        rationale: unit.rationale || null,
        code: err?.code || 'AI_GENERATION_BATCH_FAILED',
        message: err?.message || 'AI generation batch failed.',
      };
      generationFailures.push(failure);
      emit(job, 'BATCH_FAILED', {
        ...failure,
        generatedSoFar: completedCount,
        totalRequested: plannedCount,
      });
    }

    async function generateCompatibleBatch(batch, workerNumber, inheritedDepth = 0) {
      const first = batch.units[0];
      const securityScope = first.category === 'SECURITY';
      let lastError = null;
      for (let attempt = 1; attempt <= GENERATION_BATCH_MAX_ATTEMPTS; attempt += 1) {
        const batchStarted = Date.now();
        emit(job, 'BATCH_STARTED', {
          batchNumber: batch.batchNumber,
          workerNumber,
          category: first.category,
          scenarioType: first.scenarioType,
          plannedCaseNumbers: batch.units.map((unit) => unit.index + 1),
          requested: batch.units.length,
          generatedSoFar: completedCount,
          totalRequested: plannedCount,
          attempt,
          maxAttempts: GENERATION_BATCH_MAX_ATTEMPTS,
          timeoutMs: GENERATION_BATCH_TIMEOUT_MS,
          splitDepth: inheritedDepth,
        });
        try {
          const generated = await withBatchTimeout(generateBatch({
            story: input.story,
            pageDiscoveries: compact,
            environment: 'Test',
            category: first.category,
            scenarioType: first.scenarioType,
            customCategory: first.customCategory,
            customScenarioType: first.customScenarioType,
            count: batch.units.length,
            excludeTitles: existingTitles(),
            securitySubcategories: securityScope ? input.securitySubcategories : [],
            securitySeverities: securityScope ? input.securitySeverities : [],
            modelTier: input.aiModelTier,
          }), batch);
          feature ||= generated.feature;
          const rawCases = Array.isArray(generated.testCases) ? generated.testCases : [];
          if (rawCases.length !== batch.units.length) throw new Error(`AI returned ${rawCases.length}/${batch.units.length} test cases for batch ${batch.batchNumber}.`);

          const normalizedTitles = rawCases.map((raw) => String(raw?.title || '').trim().toLowerCase());
          if (new Set(normalizedTitles).size !== normalizedTitles.length) throw new Error(`AI returned duplicate titles inside batch ${batch.batchNumber}.`);
          const existing = new Set(existingTitles().map((title) => String(title).trim().toLowerCase()));
          if (normalizedTitles.some((title) => existing.has(title))) throw new Error(`AI returned a title already generated by another batch.`);

          const completedCases = rawCases.map((raw, index) => {
            const unit = batch.units[index];
            return {
              ...raw,
              id: `TC${String(unit.index + 1).padStart(3, '0')}`,
              source: 'ai',
              coverageRationale: unit.rationale || null,
              automationReadiness: null,
            };
          });
          completedCases.forEach((tc, index) => { slots[batch.units[index].index] = tc; });
          completedCount += completedCases.length;
          const available = slots.filter(Boolean).sort((a, b) => a.id.localeCompare(b.id));
          session.testCases = available;
          session.automationReadiness = pendingSummary(available);
          session.coverageProposal.generatedTestCaseCount = completedCount;
          emit(job, 'BATCH_COMPLETED', {
            batchNumber: batch.batchNumber,
            workerNumber,
            category: first.category,
            scenarioType: first.scenarioType,
            plannedCaseNumbers: batch.units.map((unit) => unit.index + 1),
            durationMs: Date.now() - batchStarted,
            cases: completedCases,
            generatedSoFar: completedCount,
            totalRequested: plannedCount,
            attempt,
          });
          completedCases.forEach((tc) => readinessPool.enqueue(tc));
          return true;
        } catch (err) {
          lastError = err;
          if (attempt < GENERATION_BATCH_MAX_ATTEMPTS) {
            emit(job, 'BATCH_RETRY', {
              batchNumber: batch.batchNumber,
              workerNumber,
              category: first.category,
              scenarioType: first.scenarioType,
              plannedCaseNumbers: batch.units.map((unit) => unit.index + 1),
              attempt,
              nextAttempt: attempt + 1,
              maxAttempts: GENERATION_BATCH_MAX_ATTEMPTS,
              message: err.message,
            });
          }
        }
      }

      // A failed multi-case batch is split so one problematic large response does not
      // discard all cases in that batch. Singletons become terminal generation gaps.
      if (SPLIT_FAILED_BATCHES && batch.units.length > 1) {
        const midpoint = Math.ceil(batch.units.length / 2);
        const left = { batchNumber: ++dynamicBatchSequence, units: batch.units.slice(0, midpoint) };
        const right = { batchNumber: ++dynamicBatchSequence, units: batch.units.slice(midpoint) };
        emit(job, 'BATCH_SPLIT', {
          batchNumber: batch.batchNumber,
          workerNumber,
          plannedCaseNumbers: batch.units.map((unit) => unit.index + 1),
          childBatches: [left.batchNumber, right.batchNumber],
          message: lastError?.message || 'Batch generation failed.',
        });
        await generateCompatibleBatch(left, workerNumber, inheritedDepth + 1);
        await generateCompatibleBatch(right, workerNumber, inheritedDepth + 1);
        return false;
      }

      batch.units.forEach((unit) => recordUnitFailure(unit, lastError, batch.batchNumber));
      return false;
    }

    async function worker(workerNumber) {
      while (true) {
        const batchIndex = nextBatch;
        nextBatch += 1;
        if (batchIndex >= batches.length) return;
        await generateCompatibleBatch(batches[batchIndex], workerNumber);
      }
    }

    job.state = 'GENERATING';
    const workerCount = Math.min(GENERATION_CONCURRENCY, batches.length);
    await Promise.all(Array.from({ length: workerCount }, (_, i) => worker(i + 1)));

    const generatedCases = slots.filter(Boolean);
    if (!generatedCases.length) {
      const firstFailure = generationFailures[0];
      const error = new Error(firstFailure?.message || 'AI could not generate any of the planned test cases.');
      error.code = firstFailure?.code || 'AI_GENERATION_ALL_BATCHES_FAILED';
      throw error;
    }

    if (generationFailures.length) {
      const failureGaps = generationFailures.map((item) => `Planned case ${item.plannedCaseNumber} (${item.category}/${item.scenarioType}) was not generated: ${item.message}`);
      session.coverageProposal = {
        ...session.coverageProposal,
        generationComplete: false,
        generatedTestCaseCount: generatedCases.length,
        generationFailures,
        knownGaps: [...new Set([...(session.coverageProposal.knownGaps || []), ...failureGaps])],
      };
    } else {
      session.coverageProposal.generationComplete = true;
      session.coverageProposal.generatedTestCaseCount = generatedCases.length;
    }

    job.state = 'VALIDATING';
    emit(job, 'READINESS_DRAINING', {
      generated: generatedCases.length,
      planned: plannedCount,
      generationFailed: generationFailures.length,
      completed: readinessPool.completed(),
    });
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
      plannedTestCases: plannedCount,
      partialGeneration: generationFailures.length > 0,
      generationFailures,
      maxTestCases: MAX_CASE_LIMIT,
      batchSize: GENERATION_BATCH_SIZE,
      plannedBatches: batches.length,
      coverageProposal: session.coverageProposal,
      storyDiscoveryCompatibility: compatibility,
      durationMs: Date.now() - startedAt,
      categoryPlan: units.map((unit) => unit.category),
      scenarioTypePlan: units.map((unit) => unit.scenarioType),
      concurrency: workerCount,
      readinessConcurrency: READINESS_CONCURRENCY,
    });
    console.log(`[progressive-generation] session=${job.sessionId} planned=${plannedCount}/${MAX_CASE_LIMIT} batches=${batches.length} batchSize=${GENERATION_BATCH_SIZE} generated=${cases.length} generationFailures=${generationFailures.length} coverage=${coveragePlan.coverageScore}% evidence=${compatibility.evidenceRatio}% total=${Date.now() - startedAt}ms`);
  } catch (err) {
    job.error = err.message;
    session.state = 'IDLE';
    finish(job, 'GENERATION_FAILED', {
      message: err.message,
      code: err.code || 'GENERATION_FAILED',
      scopeCompatibility: err.scopeCompatibility || null,
      generatedSoFar: session.testCases?.length || 0,
      maxTestCases: MAX_CASE_LIMIT,
    });
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
    session.storyDiscoveryCompatibility = null;
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
      batchSize: GENERATION_BATCH_SIZE,
      concurrency: GENERATION_CONCURRENCY,
      readinessConcurrency: READINESS_CONCURRENCY,
      generationBatchTimeoutMs: GENERATION_BATCH_TIMEOUT_MS,
      generationBatchMaxAttempts: GENERATION_BATCH_MAX_ATTEMPTS,
      splitFailedBatches: SPLIT_FAILED_BATCHES,
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
