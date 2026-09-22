const { spawnSync } = require('child_process');
const path = require('path');

const files = [
  'server/index.js',
  'server/routes/run.js',
  'server/routes/testCaseRepairWorkbench.js',
  'server/services/reviewContract.js',
  'server/routes/progressiveGenerationCanonical.js',
  'server/middleware/sessionPersistence.js',
  'server/services/manualAutomationScript.js',
  'server/services/cypressManualScript.js',
  'testpilot-ui/test-case-repair-workbench.js',
  'testpilot-ui/add-test-mode.js',
  'server/services/deterministicAutomationGeneratorV6.js',
  'server/services/deterministicAutomationGeneratorV7.js',
  'server/services/virtualizedSuggestionTraversalEmitter.js',
  'server/services/canonicalTestIrV3.js',
  'server/services/strictCypressIntegration.js',
  'server/services/enterpriseAutomationCapabilities.js',
  'server/services/cypressPageDiscovery.js',
  'server/services/directChromeRenderedDiscovery.js',
  'server/services/directChromeRenderedDiscoveryV2.js',
  'server/services/directChromePageDiscovery.js',
  'server/services/pageDiscoveryV6.js',
  'server/services/pageDiscoveryV7.js',
  'scripts/rendered-discovery-smoke.js',
  'scripts/direct-browser-render-probe.js',
  'scripts/direct-chrome-discovery-smoke.js',
  'scripts/discovery-browser-fallback-smoke.js',
  'scripts/virtualized-traversal-emitter-smoke.js',
  'automation-system/tests/e2e/system/browser-discovery-strict.cy.js',
  'automation-system/tests/e2e/system/browser-discovery.cy.js',
  'automation-system/tests/e2e/system/searchable-suggestions-lab.cy.js',
];

for (const file of files) {
  const absolute = path.join(process.cwd(), file);
  const result = spawnSync(process.execPath, ['--check', absolute], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || `Syntax check failed: ${file}\n`);
    process.exit(result.status || 1);
  }
}

console.log(`server-syntax-smoke: PASS (${files.length} files)`);
