const v6 = require('./pageDiscoveryV6');
const requestContext = require('./requestContext');
const { getSession } = require('../data/sessionStore');
const { annotatePageDiscovery, buildWebCapabilityMatrix } = require('./webCapabilityMatrix');
const {
  discoverPagesWithDirectChrome,
  isDirectChromeFallbackEligible,
} = require('./directChromeRenderedDiscoveryV2');

function currentSession() {
  const context = requestContext.current();
  if (!context?.sessionId) return null;
  try { return getSession(context.sessionId); } catch { return null; }
}

function attachMatrix(pages, scope) {
  const annotated = (pages || [])
    .filter(v6.isNavigablePage)
    .map(v6.normalizeRenderedPage)
    .map(annotatePageDiscovery);
  const matrix = buildWebCapabilityMatrix(annotated);
  return annotated.map((page, index) => ({
    ...page,
    discoveryScope: scope,
    isStartingPage: index === 0,
    capabilitySummary: {
      version: matrix.version,
      discoveredElements: (page.elements || []).length,
      capabilities: [...new Set((page.elements || []).flatMap((item) => item.capabilities || []))].sort(),
    },
  }));
}

function persistSuccessfulFallback(pages, scope, primaryError) {
  const session = currentSession();
  if (!session) return;
  const warnings = [...new Set((pages || []).flatMap((page) => page.discoveryWarnings || []).map(String).filter(Boolean))];
  const complete = pages.length > 0 && pages.every((page) => page.discoveryComplete !== false) && warnings.length === 0;
  const maxTestCases = Math.max(1, Math.min(Number(process.env.AI_TEST_CASE_COUNT || 6) || 6, 250));
  session.maxTestCases = maxTestCases;
  session.pageScope = scope;
  session.discoveryStatus = {
    engine: 'BROWSER_RENDERED_DOM',
    transport: 'DIRECT_CHROME_CDP_V2',
    fallbackFrom: 'PRIMARY_BROWSER_RUNNER',
    complete,
    partial: pages.length > 0 && !complete,
    pageCount: pages.length,
    warnings,
    failure: null,
    primaryTransportFailure: primaryError ? {
      code: primaryError.code || 'BROWSER_DISCOVERY_PROCESS_FAILED',
      message: String(primaryError.message || '').slice(0, 2000),
    } : null,
    updatedAt: new Date().toISOString(),
  };
  session.lastGenerationFailure = null;
}

async function discoverPages(urls, options = {}) {
  try {
    return await v6.discoverPages(urls, options);
  } catch (primaryError) {
    if (!isDirectChromeFallbackEligible(primaryError)) throw primaryError;

    const context = requestContext.current();
    const scope = context.pageScope === 'STARTING_PAGE_ONLY' ? 'STARTING_PAGE_ONLY' : 'ALL_DISCOVERED_PAGES';
    const seeds = [...new Set((urls || []).filter(Boolean))];
    if (!seeds.length) throw primaryError;

    let directPages;
    try {
      directPages = await discoverPagesWithDirectChrome(scope === 'STARTING_PAGE_ONLY' ? [seeds[0]] : seeds, {
        ...options,
        pageScope: scope,
        maxPages: Math.max(1, Math.min(Number(options.maxPages || process.env.CYPRESS_DISCOVERY_MAX_PAGES || 6) || 6, 12)),
        pageLoadTimeoutMs: Math.max(10000, Math.min(Number(process.env.BROWSER_DISCOVERY_PAGE_LOAD_TIMEOUT_MS || 30000), 60000)),
      });
    } catch (directError) {
      directError.code = directError.code || 'DIRECT_CHROME_DISCOVERY_FAILED';
      directError.primaryDiscoveryFailure = {
        code: primaryError.code || null,
        message: String(primaryError.message || '').slice(0, 2000),
      };
      directError.message = `Primary rendered discovery failed and the direct Chrome rendered fallback also failed. ${directError.message}`;
      throw directError;
    }

    const grounded = attachMatrix(directPages.map((page) => ({
      ...page,
      discoveryEngine: 'BROWSER_RENDERED_DOM',
      discoveryTransport: 'DIRECT_CHROME_CDP_V2',
      discoveryTransportFallbackFrom: 'PRIMARY_BROWSER_RUNNER',
      primaryDiscoveryFailureCode: primaryError.code || null,
    })), scope);

    if (!grounded.length) {
      const error = new Error('Direct Chrome fallback returned no navigable grounded HTML pages.');
      error.code = 'DIRECT_CHROME_DISCOVERY_EMPTY';
      throw error;
    }

    persistSuccessfulFallback(grounded, scope, primaryError);
    return grounded;
  }
}

async function discoverPage(url, options = {}) {
  const pages = await discoverPages([url], { ...options, maxPages: 1 });
  if (!pages.length) {
    const error = new Error(`Rendered browser discovery returned no page for ${url}.`);
    error.code = 'BROWSER_DISCOVERY_EMPTY';
    throw error;
  }
  return pages[0];
}

module.exports = {
  ...v6,
  discoverPage,
  discoverPages,
};
