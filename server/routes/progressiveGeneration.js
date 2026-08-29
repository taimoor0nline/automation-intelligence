const express = require('express');
const router = express.Router();

const { getSession, resetSession } = require('../data/sessionStore');
const { discoverPages } = require('../services/pageDiscovery');
const { compactDiscoveriesForModel } = require('../services/modelDiscoveryView');
const { normalizeProfile } = require('../services/aiModelProfiles');
const { TEST_CATEGORIES, normalizeTestCategory } = require('../services/testCategories');
const { SECURITY_SUBCATEGORIES, SECURITY_SEVERITIES, normalizeSecuritySubcategory, normalizeSecuritySeverity } = require('../services/securityTaxonomy');
const { generateBatch } = require('../services/progressiveTestGenerator');

const jobs = new Map();
const MAX_CASES = Math.max(1, Math.min(Number(process.env.AI_TEST_CASE_COUNT || 5) || 5, 50));
const GENERATION_CONCURRENCY = Math.max(1, Math.min(Number(process.env.AI_GENERATION_CONCURRENCY || 2) || 2, 4));
const JOB_TTL_MS = 30 * 60 * 1000;
const SCENARIO_TYPES = ['functional','negative','boundary','positive'];

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
function allowQaManager(req, res, next) {
  if (!req.user) return next();
  const role = String(req.user.role || '').toUpperCase();
  if (!['QA','MANAGER'].includes(role)) return res.status(403).json({ reply: 'QA or MANAGER role is required for test generation.' });
  next();
}
function targetUrl(value) { const u = new URL(String(value || '')); if (!['http:','https:'].includes(u.protocol)) throw new Error('Only HTTP/HTTPS targets are supported.'); return u.toString(); }
function discoveryUrls(baseUrl, additionalPaths = []) { const base = new URL(baseUrl); return [...new Set([baseUrl, ...(Array.isArray(additionalPaths) ? additionalPaths : []).map((p) => String(p || '').trim()).filter(Boolean).map((p) => new URL(p, `${base.protocol}//${base.host}/`).toString())])]; }
function pendingSummary(cases) { return { total: cases.length, ready: 0, checking: cases.length, manual: 0, insufficientEvidence: 0, invalid: 0, userInputRequired: 0, aiRepairable: 0, frameworkChangeRequired: 0 }; }

function relevantCategories(selected, story, discoveries) {
  if (selected.length !== TEST_CATEGORIES.length) return [...selected];
  const text = `${story} ${JSON.stringify(discoveries || [])}`.toLowerCase();
  const result = ['FUNCTIONAL'];
  if (/login|sign in|auth|role|permission|session|password|cookie/.test(text)) result.push('SECURITY');
  result.push('SMOKE','REGRESSION');
  if (/api|endpoint|request|response|status/.test(text)) result.push('API');
  else if (/form|button|input|select|textarea|page/.test(text)) result.push('UI');
  if (/aria|label|accessib|keyboard/.test(text)) result.push('ACCESSIBILITY');
  if (/performance|latency|response time|load time/.test(text)) result.push('PERFORMANCE');
  return [...new Set(result)].filter((c) => selected.includes(c));
}

function categoryPlan(categories, total) {
  const source = categories.length ? categories : ['FUNCTIONAL'];
  return Array.from({ length: total }, (_, i) => source[i % source.length]);
}
function scenarioTypePlan(types, total) {
  const source = types.length ? types : SCENARIO_TYPES;
  return Array.from({ length: total }, (_, i) => source[i % source.length]);
}

function newJob(sessionId) {
  const job = { sessionId, state: 'STARTING', createdAt: Date.now(), events: [], subscribers: new Set(), completed: false, error: null };
  jobs.set(sessionId, job);
  return job;
}
function emit(job, type, data = {}) {
  const event = { type, at: new Date().toISOString(), ...data };
  job.events.push(event);
  if (job.events.length > 200) job.events.shift();
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

async function runGeneration(job, input) {
  const session = getSession(job.sessionId);
  const startedAt = Date.now();
  try {
    job.state = 'DISCOVERING';
    emit(job, 'GENERATION_STARTED', { totalRequested: MAX_CASES, concurrency: GENERATION_CONCURRENCY });

    const urls = discoveryUrls(input.targetUrl, input.additionalPaths);
    const discoveryStarted = Date.now();
    const pages = await discoverPages(urls);
    session.pageDiscoveries = pages;
    const compact = compactDiscoveriesForModel(pages);
    emit(job, 'DISCOVERY_COMPLETED', { pageCount: pages.length, durationMs: Date.now() - discoveryStarted });

    const categoryPool = relevantCategories(input.categories, input.story, compact);
    const categories = categoryPlan(categoryPool, MAX_CASES);
    const scenarioTypes = scenarioTypePlan(input.scenarioTypes, MAX_CASES);
    const units = Array.from({ length: MAX_CASES }, (_, i) => ({ index: i, category: categories[i], scenarioType: scenarioTypes[i] }));
    emit(job, 'GENERATION_PLAN', {
      categories: categoryPool,
      scenarioTypes: input.scenarioTypes,
      units,
      concurrency: GENERATION_CONCURRENCY,
      allCategoriesAutoScoped: input.categories.length === TEST_CATEGORIES.length,
    });

    const slots = Array(MAX_CASES).fill(null);
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
          requested: 1,
          generatedSoFar: completedCount,
          totalRequested: MAX_CASES,
        });
        try {
          const generated = await generateBatch({
            story: input.story,
            pageDiscoveries: compact,
            environment: 'Test',
            category: unit.category,
            scenarioType: unit.scenarioType,
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

          const tc = { ...raw, id: `TC${String(unit.index + 1).padStart(3, '0')}`, source: 'ai', automationReadiness: null };
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
            totalRequested: MAX_CASES,
          });
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

    const cases = slots.filter(Boolean).sort((a, b) => a.id.localeCompare(b.id));
    if (cases.length !== MAX_CASES) throw new Error(`Generation completed with ${cases.length}/${MAX_CASES} test cases.`);

    session.testCases = cases;
    session.automationReadiness = pendingSummary(cases);
    session.readinessValidated = false;
    session.state = 'AWAITING_APPROVAL';
    finish(job, 'GENERATION_COMPLETED', {
      feature,
      cases,
      pageCount: pages.length,
      totalGenerated: cases.length,
      durationMs: Date.now() - startedAt,
      categoryPlan: categories,
      scenarioTypePlan: scenarioTypes,
      concurrency: workerCount,
    });
    console.log(`[progressive-generation] session=${job.sessionId} cases=${cases.length} concurrency=${workerCount} categories=${categoryPool.join(',')} types=${input.scenarioTypes.join(',')} total=${Date.now()-startedAt}ms`);
  } catch (err) {
    job.error = err.message;
    session.state = 'IDLE';
    finish(job, 'GENERATION_FAILED', { message: err.message, generatedSoFar: session.testCases?.length || 0 });
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
    session.selectedSecuritySubcategories = securitySubcategories;
    session.selectedSecuritySeverities = securitySeverities;
    session.aiModelTier = aiModelTier;
    session.credentials = req.body?.credentials && typeof req.body.credentials === 'object' ? { username: String(req.body.credentials.username || ''), password: String(req.body.credentials.password || '') } : null;

    const job = newJob(sessionId);
    const input = { targetUrl: url, story, additionalPaths: session.additionalPaths, categories, scenarioTypes, securitySubcategories, securitySeverities, aiModelTier };
    setImmediate(() => runGeneration(job, input));
    res.status(202).json({
      ok: true,
      sessionId,
      totalRequested: MAX_CASES,
      batchSize: 1,
      concurrency: GENERATION_CONCURRENCY,
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
