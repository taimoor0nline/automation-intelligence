let installed = false;

function text(value) { return String(value || '').toLowerCase(); }

function evidence(pageDiscoveries = []) {
  const pages = Array.isArray(pageDiscoveries) ? pageDiscoveries : [];
  const elements = pages.flatMap((page) => Array.isArray(page?.elements) ? page.elements : []);
  const messages = pages.flatMap((page) => Array.isArray(page?.messages) ? page.messages : []);
  const networkHints = pages.flatMap((page) => Array.isArray(page?.networkHints) ? page.networkHints : []);
  const pageTitles = pages.map((page) => String(page?.pageTitle || '')).filter(Boolean);
  const elementText = (item) => [item?.tag, item?.type, item?.role, item?.id, item?.name, item?.testId, item?.label, item?.text, item?.ariaLabel, item?.placeholder].filter(Boolean).join(' ').toLowerCase();
  const hasPassword = elements.some((item) => String(item?.type || '').toLowerCase() === 'password');
  const hasUsername = elements.some((item) => /username|user name|email|login/.test(elementText(item)) && String(item?.type || '').toLowerCase() !== 'password');
  const hasLoginSubmit = elements.some((item) => /login|log in|sign in|signin|submit|continue/.test(elementText(item)) && (['button','submit'].includes(String(item?.type || '').toLowerCase()) || String(item?.tag || '').toLowerCase() === 'button' || String(item?.role || '').toLowerCase() === 'button'));
  const paths = pages.map((page) => {
    try { const u = new URL(page?.finalUrl || page?.url || 'http://testnexus.local/'); return `${u.pathname}${u.search}` || '/'; }
    catch { return '/'; }
  });
  return { pages, elements, messages, networkHints, pageTitles, paths, hasLoginControls: hasPassword && hasUsername && hasLoginSubmit };
}

function unsupportedReason(unit, facts, story = '') {
  const rationale = text(unit?.rationale || unit?.objective);
  const storyText = text(story);
  if (!facts.pages.length) return 'No rendered HTML page was discovered.';
  if (/fallback allocation/.test(rationale)) return 'Generic fallback allocation is forbidden; every planned case must be evidence-grounded.';

  if (/credential|username|password|sign in|signin|log in|login/.test(rationale) && /submit|fake|invalid|missing|credential/.test(rationale) && !facts.hasLoginControls) {
    return 'The planned authentication interaction requires rendered username/password/submit controls that were not discovered.';
  }

  if (/\b(?:http\s*)?(?:status|4xx|5xx|status code|response code)\b/.test(rationale) && !facts.networkHints.length) {
    return 'The planned HTTP-status assertion has no discovered application request/response evidence.';
  }

  if (/stack trace|sql error|sensitive data|error leakage|information leakage/.test(rationale) && !facts.messages.length && !/(stack trace|sql error|sensitive data|error leakage|information leakage)/.test(storyText)) {
    return 'The planned error-leakage behavior is not required by the story and no rendered error/message surface was discovered.';
  }

  if (/page title|document title|title matches/.test(rationale) && !facts.pageTitles.length) {
    return 'The planned title assertion has no discovered document title.';
  }

  return null;
}

function planningActorRefs() {
  try {
    const requestContext = require('./requestContext');
    const { getSession } = require('../data/sessionStore');
    const current = requestContext.current();
    const session = current.sessionId ? getSession(current.sessionId) : null;
    return Object.entries(session?.actorCredentials || {}).filter(([, value]) => value?.username && value?.password).map(([key]) => key);
  } catch { return []; }
}

function scenarioPolicyReason(unit, args) {
  const { validateWebScenarioPolicy } = require('./webScenarioPolicy');
  const { inferSecuritySubcategory } = require('./securityTaxonomy');
  const category = String(unit?.category || '').toUpperCase();
  const rationale = String(unit?.rationale || unit?.objective || '');
  const pseudo = {
    id: 'PLANNED',
    title: rationale,
    coverageRationale: rationale,
    generationStory: args.story || '',
    testCategory: category,
    securitySubcategory: category === 'SECURITY' ? inferSecuritySubcategory({ title: rationale, expectedResults: [] }) : null,
    canonicalIr: { actions: [], assertions: [] },
  };
  const result = validateWebScenarioPolicy(pseudo, {
    pageDiscoveries: args.pageDiscoveries || [],
    story: args.story || '',
    actorCredentialRefs: planningActorRefs(),
  });
  return result.ok ? null : result.errors?.[0]?.message || 'The scenario is not supported by the strict generic web-testing policy.';
}

function safeFallback(args, facts) {
  const categories = (args.allowedCategories || []).map((value) => String(value || '').toUpperCase());
  const scenarios = (args.allowedScenarioTypes || []).map((value) => String(value || '').toLowerCase());
  if (!scenarios.includes('positive') || !facts.pages.length) return null;
  const category = categories.includes('SMOKE') ? 'SMOKE' : categories.includes('UI') ? 'UI' : categories.includes('FUNCTIONAL') ? 'FUNCTIONAL' : null;
  if (!category) return null;
  if (facts.pageTitles[0]) {
    return { category, scenarioType: 'positive', rationale: `Verify the discovered public page title equals ${JSON.stringify(facts.pageTitles[0])} on the rendered starting page.` };
  }
  return { category, scenarioType: 'positive', rationale: `Verify the rendered public starting page remains on the discovered path ${JSON.stringify(facts.paths[0] || '/')} after navigation.` };
}

function install() {
  if (installed) return;
  installed = true;
  const planner = require('./progressiveTestGenerator');
  if (planner.__strictEvidencePlannerGuard) return;
  const original = planner.proposeGenerationPlan;

  planner.proposeGenerationPlan = async function strictEvidencePlan(args = {}) {
    const plan = await original(args);
    const facts = evidence(args.pageDiscoveries || []);
    const kept = [];
    const dropped = [];
    for (const unit of plan.units || []) {
      const reason = unsupportedReason(unit, facts, args.story || '') || scenarioPolicyReason(unit, args);
      if (reason) dropped.push({ unit, reason });
      else kept.push(unit);
    }

    if (!kept.length) {
      const fallback = safeFallback(args, facts);
      if (fallback) kept.push(fallback);
    }

    const knownGaps = [...new Set([
      ...(plan.knownGaps || []),
      ...dropped.map(({ unit, reason }) => `Not allocated: ${unit.rationale || unit.objective || unit.category} — ${reason}`),
    ])];
    const requested = kept.length;
    const originalCount = Math.max(1, Number(plan.recommendedTestCaseCount || plan.units?.length || 1));
    const coverageScore = dropped.length
      ? Math.min(Number(plan.coverageScore || 0), Math.round((requested / originalCount) * 100))
      : Number(plan.coverageScore || 0);

    return {
      ...plan,
      recommendedTestCaseCount: requested,
      units: kept,
      knownGaps,
      coverageScore,
      coverageSummary: dropped.length
        ? `${plan.coverageSummary || ''} ${dropped.length} proposed case(s) were removed by deterministic evidence/policy gating before generation.`.trim()
        : plan.coverageSummary,
    };
  };
  planner.__strictEvidencePlannerGuard = true;
}

module.exports = { install, evidence, unsupportedReason, scenarioPolicyReason, safeFallback };
