const v6 = require('./pageDiscoveryV6');
const requestContext = require('./requestContext');
const { getSession } = require('../data/sessionStore');
const { annotatePageDiscovery, buildWebCapabilityMatrix } = require('./webCapabilityMatrix');
const {
  discoverPagesWithDirectChrome,
  isDirectChromeFallbackEligible,
} = require('./directChromeRenderedDiscoveryV2');

const NON_PAGE_EXTENSION = /\.(?:js|mjs|css|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|eot|pdf|zip|json|xml|webmanifest|txt|csv|wasm|mp3|mp4|webm)(?:$|[?#])/i;

function currentSession() {
  const context = requestContext.current();
  if (!context?.sessionId) return null;
  try { return getSession(context.sessionId); } catch { return null; }
}

function normalizeUrl(raw, base = null) {
  try {
    const url = base ? new URL(String(raw || ''), base) : new URL(String(raw || ''));
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.pathname.startsWith('/api/') || NON_PAGE_EXTENSION.test(url.pathname + url.search)) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function pageUrl(page, base = null) {
  return normalizeUrl(page?.finalUrl || page?.url, base);
}

function collectMissingSameOriginRoutes(pages = [], startingUrl, requestedUrls = []) {
  const start = normalizeUrl(startingUrl);
  if (!start) return [];
  const origin = new URL(start).origin;
  const grounded = new Set((pages || []).map((page) => pageUrl(page, start)).filter(Boolean));
  const candidates = [];
  const seen = new Set();

  function add(raw, base) {
    const value = normalizeUrl(raw, base || start);
    if (!value || grounded.has(value) || seen.has(value)) return;
    try { if (new URL(value).origin !== origin) return; } catch { return; }
    seen.add(value);
    candidates.push(value);
  }

  for (const requested of requestedUrls || []) add(requested, start);
  for (const page of pages || []) {
    const base = pageUrl(page, start) || start;
    for (const hint of page?.routeHints || []) add(hint, base);
  }
  return candidates;
}

function missingSameOriginRouteHints(pages = [], startingUrl, maxPages = 6, requestedUrls = []) {
  const ceiling = Math.max(1, Math.min(Number(maxPages) || 1, 12));
  const remaining = Math.max(0, ceiling - (pages || []).length);
  if (!remaining) return [];
  return collectMissingSameOriginRoutes(pages, startingUrl, requestedUrls).slice(0, remaining);
}

function sanitizeDiscoveryWarnings(warnings = [], { dropBudgetWarning = false } = {}) {
  const output = [];
  const seen = new Set();
  for (const raw of warnings || []) {
    const warning = String(raw || '').trim();
    if (!warning) continue;
    if (/allowCypressEnv configuration option/i.test(warning)) continue;
    if (dropBudgetWarning && /overall discovery budget was reached/i.test(warning)) continue;
    if (seen.has(warning)) continue;
    seen.add(warning);
    output.push(warning);
  }
  return output;
}

function uniquePages(pages = [], startingUrl = null) {
  const output = [];
  const seen = new Set();
  for (const page of pages || []) {
    const key = pageUrl(page, startingUrl) || String(page?.finalUrl || page?.url || '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(page);
  }
  return output;
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

function persistSuccessfulFallback(pages, scope, primaryError, metadata = {}) {
  const session = currentSession();
  if (!session) return;
  const warnings = sanitizeDiscoveryWarnings(
    metadata.warnings || (pages || []).flatMap((page) => page.discoveryWarnings || []),
  );
  const complete = metadata.complete == null
    ? pages.length > 0 && pages.every((page) => page.discoveryComplete !== false) && warnings.length === 0
    : Boolean(metadata.complete);
  const maxTestCases = Math.max(1, Math.min(Number(process.env.AI_TEST_CASE_COUNT || 6) || 6, 250));
  session.maxTestCases = maxTestCases;
  session.pageScope = scope;
  session.discoveryStatus = {
    engine: 'BROWSER_RENDERED_DOM',
    transport: metadata.transport || 'DIRECT_CHROME_CDP_V2',
    fallbackFrom: metadata.fallbackFrom || 'PRIMARY_BROWSER_RUNNER',
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

function finalizeSupplementedPages(primaryPages, directPages, { scope, startingUrl, requestedUrls, maxPages }) {
  const directGrounded = attachMatrix((directPages || []).map((page) => ({
    ...page,
    discoveryEngine: 'BROWSER_RENDERED_DOM',
    discoveryTransport: 'DIRECT_CHROME_CDP_V2',
    discoveryTransportFallbackFrom: 'PRIMARY_PARTIAL_ROUTE_COMPLETION',
  })), scope);
  const merged = uniquePages([...(primaryPages || []), ...directGrounded], startingUrl);
  const unresolved = collectMissingSameOriginRoutes(merged, startingUrl, requestedUrls);
  const inheritedWarnings = [
    ...(primaryPages || []).flatMap((page) => page.discoveryWarnings || []),
    ...(directGrounded || []).flatMap((page) => page.discoveryWarnings || []),
  ];
  const warnings = sanitizeDiscoveryWarnings(inheritedWarnings, { dropBudgetWarning: unresolved.length === 0 });
  if (unresolved.length && merged.length >= maxPages) {
    warnings.push(`Public-page discovery reached its ${maxPages}-page safety limit; additional discovered routes were not used for generation.`);
  }
  const complete = unresolved.length === 0 && warnings.length === 0;
  const finalPages = merged.map((page, index) => ({
    ...page,
    discoveryScope: scope,
    discoveryComplete: complete,
    discoveryWarnings: warnings,
    isStartingPage: index === 0,
  }));
  return { pages: finalPages, complete, warnings, unresolved };
}

async function supplementPartialRoutes(primaryPages, urls, options, scope) {
  if (scope === 'STARTING_PAGE_ONLY' || !primaryPages?.length) return primaryPages;
  const seeds = [...new Set((urls || []).filter(Boolean))];
  if (!seeds.length) return primaryPages;
  const maxPages = Math.max(1, Math.min(Number(options.maxPages || process.env.CYPRESS_DISCOVERY_MAX_PAGES || 6) || 6, 12));
  const missing = missingSameOriginRouteHints(primaryPages, seeds[0], maxPages, seeds);
  if (!missing.length) {
    const warnings = sanitizeDiscoveryWarnings(primaryPages.flatMap((page) => page.discoveryWarnings || []));
    if (warnings.length === primaryPages.flatMap((page) => page.discoveryWarnings || []).length) return primaryPages;
    return primaryPages.map((page, index) => ({ ...page, discoveryWarnings: warnings, isStartingPage: index === 0 }));
  }

  const remaining = Math.max(1, maxPages - primaryPages.length);
  try {
    const directPages = await discoverPagesWithDirectChrome(missing, {
      ...options,
      pageScope: 'ALL_DISCOVERED_PAGES',
      maxPages: remaining,
      pageLoadTimeoutMs: Math.max(10000, Math.min(Number(process.env.BROWSER_DISCOVERY_PAGE_LOAD_TIMEOUT_MS || 30000), 60000)),
    });
    const finalized = finalizeSupplementedPages(primaryPages, directPages, {
      scope,
      startingUrl: seeds[0],
      requestedUrls: seeds,
      maxPages,
    });
    persistSuccessfulFallback(finalized.pages, scope, null, {
      transport: 'PRIMARY_PLUS_DIRECT_CHROME_CDP_V2',
      fallbackFrom: 'PRIMARY_PARTIAL_ROUTE_COMPLETION',
      complete: finalized.complete,
      warnings: finalized.warnings,
    });
    return finalized.pages;
  } catch (error) {
    const concise = `Additional discovered public routes could not be grounded before planning: ${error.message}`;
    const warnings = sanitizeDiscoveryWarnings([
      ...primaryPages.flatMap((page) => page.discoveryWarnings || []),
      concise,
    ]);
    return primaryPages.map((page, index) => ({
      ...page,
      discoveryWarnings: warnings,
      discoveryComplete: false,
      isStartingPage: index === 0,
    }));
  }
}

async function discoverPages(urls, options = {}) {
  const context = requestContext.current();
  const scope = context.pageScope === 'STARTING_PAGE_ONLY' ? 'STARTING_PAGE_ONLY' : 'ALL_DISCOVERED_PAGES';
  try {
    const primaryPages = await v6.discoverPages(urls, options);
    return await supplementPartialRoutes(primaryPages, urls, options, scope);
  } catch (primaryError) {
    if (!isDirectChromeFallbackEligible(primaryError)) throw primaryError;

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
  missingSameOriginRouteHints,
  sanitizeDiscoveryWarnings,
  supplementPartialRoutes,
};
