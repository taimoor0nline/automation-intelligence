const v3 = require('./pageDiscoveryV3');
const { annotatePageDiscovery, buildWebCapabilityMatrix } = require('./webCapabilityMatrix');

async function discoverPage(url) {
  return annotatePageDiscovery(await v3.discoverPage(url));
}

async function discoverPages(urls) {
  const pages = (await v3.discoverPages(urls)).map(annotatePageDiscovery);
  // Matrix is computed once from the discovery result and attached non-invasively.
  // Existing consumers continue to read page.elements/page.messages as before.
  const matrix = buildWebCapabilityMatrix(pages);
  for (const page of pages) {
    page.capabilitySummary = {
      version: matrix.version,
      discoveredElements: (page.elements || []).length,
      capabilities: [...new Set((page.elements || []).flatMap((item) => item.capabilities || []))].sort(),
    };
  }
  return pages;
}

module.exports = {
  ...v3,
  discoverPage,
  discoverPages,
  buildWebCapabilityMatrix,
};