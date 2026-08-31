const v3 = require('./pageDiscoveryV3');
const { annotatePageDiscovery, buildWebCapabilityMatrix } = require('./webCapabilityMatrix');
const requestContext = require('./requestContext');
const { getSession } = require('../data/sessionStore');

async function discoverPage(url) {
  return annotatePageDiscovery(await v3.discoverPage(url));
}

function attachMatrix(pages, scope) {
  const matrix = buildWebCapabilityMatrix(pages);
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    page.discoveryScope = scope;
    page.isStartingPage = index === 0;
    page.capabilitySummary = {
      version: matrix.version,
      discoveredElements: (page.elements || []).length,
      capabilities: [...new Set((page.elements || []).flatMap((item) => item.capabilities || []))].sort(),
    };
  }
  return pages;
}

function persistEffectiveScope(context, scope) {
  if (!context?.sessionId) return;
  try {
    const session = getSession(context.sessionId);
    if (session) session.pageScope = scope;
  } catch {}
}

async function discoverPages(urls) {
  const context = requestContext.current();
  const scope = context.pageScope === 'STARTING_PAGE_ONLY' ? 'STARTING_PAGE_ONLY' : 'ALL_DISCOVERED_PAGES';
  const seeds = [...new Set((urls || []).filter(Boolean))];
  if (!seeds.length) return [];
  persistEffectiveScope(context, scope);

  // Starting-page scope is a hard planning/discovery boundary, not a UI filter.
  // Route hints and additional known pages are deliberately not crawled in this mode.
  if (scope === 'STARTING_PAGE_ONLY') {
    return attachMatrix([await discoverPage(seeds[0])], scope);
  }

  const pages = (await v3.discoverPages(seeds)).map(annotatePageDiscovery);
  return attachMatrix(pages, scope);
}

module.exports = {
  ...v3,
  discoverPage,
  discoverPages,
  buildWebCapabilityMatrix,
};
