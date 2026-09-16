const { spawnSync } = require('child_process');
const path = require('path');

const files = [
  'server/index.js',
  'server/routes/run.js',
  'server/routes/testCaseRepairWorkbench.js',
  'server/services/deterministicAutomationGeneratorV6.js',
  'server/services/canonicalTestIrV3.js',
  'server/services/strictCypressIntegration.js',
  'server/services/enterpriseAutomationCapabilities.js',
  'server/services/cypressPageDiscovery.js',
  'scripts/rendered-discovery-smoke.js',
  'automation-system/tests/e2e/system/browser-discovery-strict.cy.js',
  'automation-system/tests/e2e/system/browser-discovery.cy.js',
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
