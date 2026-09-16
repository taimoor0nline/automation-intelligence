const requestContext = require('./requestContext');
const { discoverPageWithDirectChrome } = require('./directChromeRenderedDiscovery');

function boolEnv(value, fallback) {
  if (value == null || value === '') return fallback;
  return !['false', '0', 'no', 'off'].includes(String(value).toLowerCase());
}

function normalizeUrl(raw, base = null) {
  try {
    const url = base ? new URL(String(raw || ''), base) : new URL(String(raw || ''));
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function shouldUseDirectChromeFallback(error) {
  if (!boolEnv(process.env.BROWSER_DISCOVERY_DIRECT_CHROME_FALLBACK, true)) return false;
  if (!error || error.code !== 'BROWSER_DISCOVERY_PROCESS_FAILED') return false;
  if (error.runnerFailure) return false;
  if (error.snapshotFilePresent === true) return false;
  return true;
}

async function discoverDirectRenderedPages(urls = [], options = {}) {
  const seeds = [...new Set((urls || []).map((url) => normalizeUrl(url)).filter(Boolean))];
  if (!seeds.length) return [];

  const context = requestContext.current();
  const pageScope = context.pageScope === 'STARTING_PAGE_ONLY' ? 'STARTING_PAGE_ONLY' : 'ALL_DISCOVERED_PAGES';
  const maxPages = Math.max(1, Math.min(Number(options.maxPages || process.env.CYPRESS_DISCOVERY_MAX_PAGES || 6) || 6, 12));
  const pageLoadTimeoutMs = Math.max(10000, Math.min(Number(options.pageLoadTimeoutMs || process.env.BROWSER_DISCOVERY_PAGE_LOAD_TIMEOUT_MS || 30000) || 30000, 60000));
  const startingOrigin = new URL(seeds[0]).origin;
  const queue = pageScope === 'STARTING_PAGE_ONLY' ? [seeds[0]] : [...seeds];
  const queued = new Set(queue);
  const visited = new Set();
  const pages = [];
  const warnings = [];

  while (queue.length && pages.length < maxPages) {
    const seed = queue.shift();
    if (!seed || visited.has(seed)) continue;
    visited.add(seed);

    try {
      const page = await discoverPageWithDirectChrome(seed, { pageLoadTimeoutMs });
      pages.push(page);

      if (pageScope !== 'STARTING_PAGE_ONLY') {
        for (const rawHint of page.routeHints || []) {
          const hint = normalizeUrl(rawHint, page.finalUrl || page.url || seed);
          if (!hint) continue;
          let sameOrigin = false;
          try { sameOrigin = new URL(hint).origin === startingOrigin; } catch {}
          if (!sameOrigin || visited.has(hint) || queued.has(hint)) continue;
          queue.push(hint);
          queued.add(hint);
        }
      }
    } catch (error) {
      if (!pages.length) {
        error.message = `Direct Chrome could not render the starting page into a grounded browser snapshot. ${error.message}`;
        throw error;
      }
      warnings.push(`Skipped public page ${seed}: ${error.message}`);
    }
  }

  if (!pages.length) {
    const error = new Error('Direct Chrome rendered discovery completed without any grounded HTML pages.');
    error.code = 'DIRECT_CHROME_DISCOVERY_EMPTY';
    throw error;
  }
  if (queue.length && pages.length >= maxPages) warnings.push(`Public-page discovery reached its ${maxPages}-page safety limit; additional discovered routes were not used for generation.`);

  const complete = warnings.length === 0 && queue.length === 0;
  return pages.map((page, index) => ({
    ...page,
    discoveryEngine: 'BROWSER_RENDERED_DOM',
    discoveryTransport: 'DIRECT_CHROME_CDP',
    discoveryScope: pageScope,
    discoveryComplete: complete,
    discoveryWarnings: warnings,
    discoveryFallbackFrom: 'CYPRESS_PROXY',
    isStartingPage: index === 0,
  }));
}

module.exports = {
  discoverDirectRenderedPages,
  shouldUseDirectChromeFallback,
  normalizeUrl,
};
