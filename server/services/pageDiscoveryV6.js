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

function mergePage(rendered, source) {
  if (!source) return rendered;
  const networkHints = uniqueBy([...(rendered.networkHints || []), ...(source.networkHints || [])], (item) => `${item.method || '*'} ${item.url || ''}`);
  const routeHints = uniqueBy([...(rendered.routeHints || []), ...(source.routeHints || [])], String);
  const meta = uniqueBy([...(rendered.meta || []), ...(source.meta || [])], (item) => String(item?.name || '').toLowerCase());
  return {
    ...source,
    ...rendered,
    // Rendered DOM is authoritative for interactive/assertion targets.
    elements: rendered.elements || [],
    messages: rendered.messages || [],
    routeHints,
    networkHints,
    meta,
    staticSourceSupplemented: true,
    discoveryEngine: 'CYPRESS_RENDERED_DOM',
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

function persistEffectiveScope(scope) {
  const context = requestContext.current();
  if (!context?.sessionId) return;
  try {
    const session = getSession(context.sessionId);
    if (session) session.pageScope = scope;
  } catch {}
}

async function staticSupplement(urls) {
  if (!boolEnv(process.env.CYPRESS_DISCOVERY_STATIC_SUPPLEMENT, true)) return [];
  try {
    return (await v5.discoverPages(urls)).filter(isNavigablePage);
  } catch (err) {
    console.warn(`[discovery] Static supplementary discovery skipped: ${err.message}`);
    return [];
  }
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
    rendered = await discoverRenderedPages(scope === 'STARTING_PAGE_ONLY' ? [seeds[0]] : seeds, options);
  } catch (err) {
    if (requireRendered) {
      err.message = `Rendered browser discovery failed. TestNexus will not invent selectors or downgrade to brittle static DOM assumptions. ${err.message}`;
      throw err;
    }
    console.warn(`[discovery] Rendered browser discovery unavailable; using static fallback: ${err.message}`);
  }

  const staticPages = await staticSupplement(scope === 'STARTING_PAGE_ONLY' ? [seeds[0]] : seeds);
  if (!rendered.length) return attachMatrix(staticPages, scope);

  const staticByKey = new Map(staticPages.map((page) => [pageKey(page), page]));
  const merged = rendered.map((page) => mergePage(page, staticByKey.get(pageKey(page))));
  return attachMatrix(merged, scope);
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
};
