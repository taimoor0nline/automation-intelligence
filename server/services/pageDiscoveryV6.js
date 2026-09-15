const v5 = require('./pageDiscoveryV5');
const requestContext = require('./requestContext');
const { discoverRenderedPages } = require('./cypressPageDiscovery');
const { annotatePageDiscovery, buildWebCapabilityMatrix } = require('./webCapabilityMatrix');
const { getSession } = require('../data/sessionStore');

const NON_PAGE_EXTENSION = /\.(?:js|mjs|css|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|eot|pdf|zip|json|xml|webmanifest|txt|csv|wasm|mp3|mp4|webm)(?:$|[?#])/i;

function boolEnv(value, fallback) {
  if (value == null || value === '') return fallback;
  return !['false', '0', 'no', 'off'].includes(String(value).toLowerCase());
}

function pageKey(page) {
  try {
    const url = new URL(page?.finalUrl || page?.url || 'http://testnexus.local/');
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return String(page?.finalUrl || page?.url || '');
  }
}

function isNavigablePage(page) {
  const raw = String(page?.finalUrl || page?.url || '');
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return !NON_PAGE_EXTENSION.test(url.pathname + url.search);
  } catch {
    return false;
  }
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return (items || []).filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeRenderedElement(item = {}) {
  const tag = String(item.tag || '').toLowerCase();
  const visibleText = String(item.text || '').replace(/\s+/g, ' ').trim();
  return {
    ...item,
    label: item.label || item.ariaLabel || item.placeholder || item.name || ((tag === 'button' || tag === 'a' || item.role) ? visibleText || null : null),
  };
}

function normalizeRenderedPage(page = {}) {
  return {
    ...page,
    elements: (page.elements || []).map(normalizeRenderedElement),
    messages: (page.messages || []).map(normalizeRenderedElement),
  };
}

function mergePage(rendered, source) {
  if (!source) return rendered;
  const networkHints = uniqueBy([...(rendered.networkHints || []), ...(source.networkHints || [])], (item) => `${item.method || '*'} ${item.url || ''}`);
  const meta = uniqueBy([...(rendered.meta || []), ...(source.meta || [])], (item) => String(item?.name || '').toLowerCase());
  return {
    ...source,
    ...rendered,
    elements: rendered.elements || [],
    messages: rendered.messages || [],
    routeHints: rendered.routeHints || [],
    networkHints,
    meta,
    staticSourceSupplemented: true,
    discoveryEngine: 'BROWSER_RENDERED_DOM',
  };
}

function attachMatrix(pages, scope) {
  const annotated = (pages || []).filter(isNavigablePage).map(annotatePageDiscovery);
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

function currentSession() {
  const context = requestContext.current();
  if (!context?.sessionId) return null;
  try { return getSession(context.sessionId); } catch { return null; }
}

function persistEffectiveScope(scope) {
  const session = currentSession();
  if (session) session.pageScope = scope;
}

function persistDiscoveryStatus({ complete = false, warnings = [], pages = [], failure = null } = {}) {
  const session = currentSession();
  if (!session) return;
  const maxTestCases = Math.max(1, Math.min(Number(process.env.AI_TEST_CASE_COUNT || 6) || 6, 250));
  session.maxTestCases = maxTestCases;
  session.discoveryStatus = {
    engine: 'BROWSER_RENDERED_DOM',
    complete: Boolean(complete),
    partial: pages.length > 0 && !complete,
    pageCount: pages.length,
    warnings: [...new Set((warnings || []).map(String).filter(Boolean))],
    failure: failure ? { code: failure.code || 'BROWSER_DISCOVERY_FAILED', message: String(failure.message || 'Rendered browser discovery failed.') } : null,
    updatedAt: new Date().toISOString(),
  };
  session.lastGenerationFailure = failure ? {
    stage: 'DISCOVERY',
    code: failure.code || 'BROWSER_DISCOVERY_FAILED',
    message: String(failure.message || 'Rendered browser discovery failed.'),
    at: new Date().toISOString(),
  } : null;
}

async function staticFallback(urls) {
  if (!boolEnv(process.env.CYPRESS_DISCOVERY_STATIC_SUPPLEMENT, true)) return [];
  try {
    return (await v5.discoverPages(urls)).filter(isNavigablePage);
  } catch (err) {
    console.warn(`[discovery] Static fallback skipped: ${err.message}`);
    return [];
  }
}

async function supplementRenderedPages(renderedPages) {
  if (!boolEnv(process.env.CYPRESS_DISCOVERY_STATIC_SUPPLEMENT, true)) return [];
  const out = [];
  for (const page of renderedPages || []) {
    const url = page?.finalUrl || page?.url;
    if (!url || !isNavigablePage(page)) continue;
    try {
      const source = await v5.discoverPage(url);
      if (isNavigablePage(source)) out.push(source);
    } catch (err) {
      console.warn(`[discovery] Static source supplement skipped for ${url}: ${err.message}`);
    }
  }
  return out;
}

async function discoverPages(urls, options = {}) {
  const context = requestContext.current();
  const scope = context.pageScope === 'STARTING_PAGE_ONLY' ? 'STARTING_PAGE_ONLY' : 'ALL_DISCOVERED_PAGES';
  const seeds = [...new Set((urls || []).filter(Boolean))];
  if (!seeds.length) return [];
  persistEffectiveScope(scope);

  const requireRendered = boolEnv(process.env.CYPRESS_RENDERED_DISCOVERY_REQUIRED, true);
  let rendered = [];
  try {
    rendered = (await discoverRenderedPages(scope === 'STARTING_PAGE_ONLY' ? [seeds[0]] : seeds, options)).map(normalizeRenderedPage);
  } catch (err) {
    persistDiscoveryStatus({ failure: err });
    if (requireRendered) {
      err.message = `Rendered browser discovery failed. TestNexus will not invent selectors or downgrade to brittle static DOM assumptions. ${err.message}`;
      persistDiscoveryStatus({ failure: err });
      throw err;
    }
    console.warn(`[discovery] Rendered browser discovery unavailable; using static fallback: ${err.message}`);
  }

  if (!rendered.length) {
    const fallback = attachMatrix(await staticFallback(scope === 'STARTING_PAGE_ONLY' ? [seeds[0]] : seeds), scope);
    persistDiscoveryStatus({ complete: false, pages: fallback, warnings: ['Rendered discovery was unavailable; static evidence was used only because strict rendered discovery was explicitly disabled.'] });
    return fallback;
  }

  const staticPages = await supplementRenderedPages(rendered);
  const staticByKey = new Map(staticPages.map((page) => [pageKey(page), page]));
  const merged = rendered.map((page) => mergePage(page, staticByKey.get(pageKey(page))));
  const finalPages = attachMatrix(merged, scope);
  const warnings = [...new Set(finalPages.flatMap((page) => page.discoveryWarnings || []).map(String).filter(Boolean))];
  const complete = finalPages.every((page) => page.discoveryComplete !== false) && warnings.length === 0;
  persistDiscoveryStatus({ complete, warnings, pages: finalPages });
  return finalPages;
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
  ...v5,
  discoverPage,
  discoverPages,
  isNavigablePage,
  mergePage,
  normalizeRenderedElement,
  normalizeRenderedPage,
};