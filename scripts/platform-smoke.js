const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const jsFiles = [
  'server/index.js',
  'server/db/index.js',
  'server/db/migrate.js',
  'server/data/sessionStore.js',
  'server/middleware/sessionPersistence.js',
  'server/routes/auth.js',
  'server/routes/chat.js',
  'server/routes/projects.js',
  'server/routes/reporting.js',
  'server/routes/restApi.js',
  'server/routes/sessionContext.js',
  'server/services/authService.js',
  'server/services/persistenceService.js',
  'server/services/requestContext.js',
  'server/services/sourceAwareService.js',
  'server/services/failureResolutionAiService.js',
  'server/services/restApiDiscoveryService.js',
  'server/services/restTestCaseAiService.js',
  'server/services/restAutomationService.js',
  'server/services/reportGenerator.js',
  'server/services/browserProcessCleanup.js',
  'server/services/singleSpecRunner.js',
  'automation-system/engine.config.js',
  'testpilot-ui/platform-ui.js',
  'testpilot-ui/defect-assignment.js',
  'testpilot-ui/results-analysis.js',
  'testpilot-ui/reporting.js',
  'testpilot-ui/reporting-entry.js',
  'testpilot-ui/test-case-export.js',
  'testpilot-ui/report-excel.js',
  'testpilot-ui/generation-experience.js',
];

const errors = [];
for (const relative of jsFiles) {
  const file = path.join(root, relative);
  try {
    const source = fs.readFileSync(file, 'utf8');
    new vm.Script(source, { filename: relative });
    console.log(`✓ syntax ${relative}`);
  } catch (err) {
    errors.push(`${relative}: ${err.message}`);
  }
}

try {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const dep of ['pg', 'bcryptjs', 'jsonwebtoken', 'yaml']) {
    if (!pkg.dependencies?.[dep]) errors.push(`package.json missing dependency ${dep}`);
  }
  if (!pkg.scripts?.['db:migrate']) errors.push('package.json missing db:migrate script');
} catch (err) {
  errors.push(`package.json: ${err.message}`);
}

for (const migration of [
  'server/db/001_platform.sql',
  'server/db/002_source_guidance.sql',
  'server/db/003_quality_attribution.sql',
  'server/db/004_rest_api_testing.sql',
  'server/db/005_reporting_categories.sql',
]) {
  if (!fs.existsSync(path.join(root, migration))) errors.push(`missing migration ${migration}`);
}

const schema = fs.readFileSync(path.join(root, 'server/db/001_platform.sql'), 'utf8');
for (const table of ['users', 'projects', 'source_repositories', 'test_sessions', 'test_runs', 'test_results', 'defect_analyses', 'code_change_metrics']) {
  if (!new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, 'i').test(schema)) errors.push(`schema missing ${table}`);
}

const restSchema = fs.readFileSync(path.join(root, 'server/db/004_rest_api_testing.sql'), 'utf8');
for (const table of ['api_targets', 'api_operations']) {
  if (!new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, 'i').test(restSchema)) errors.push(`REST schema missing ${table}`);
}
for (const marker of ['target_type', 'api_target_id', 'api_operation_ids']) {
  if (!restSchema.includes(marker)) errors.push(`REST schema missing ${marker}`);
}

const reportingSchema = fs.readFileSync(path.join(root, 'server/db/005_reporting_categories.sql'), 'utf8');
for (const marker of ['test_category', 'executed_by_role', 'idx_test_results_category_outcome', 'idx_test_runs_user_completed']) {
  if (!reportingSchema.includes(marker)) errors.push(`reporting schema missing ${marker}`);
}

const reportingRoute = fs.readFileSync(path.join(root, 'server/routes/reporting.js'), 'utf8');
for (const marker of ['/api/reporting/filters', '/api/reporting/summary', 'project_members visibility_pm', 'defect_analyses visibility_da', 'test_category']) {
  if (!reportingRoute.includes(marker)) errors.push(`reporting route missing marker: ${marker}`);
}

const reportGenerator = fs.readFileSync(path.join(root, 'server/services/reportGenerator.js'), 'utf8');
for (const marker of ['exportAnalysisExcel', '/report-excel.js', 'AI TestPilot Analytics']) {
  if (!reportGenerator.includes(marker)) errors.push(`analytics report missing marker: ${marker}`);
}

const reportExcel = fs.readFileSync(path.join(root, 'testpilot-ui/report-excel.js'), 'utf8');
for (const marker of ['AI-TestPilot-Analysis-', 'Failure Classification', 'AI Resolution Guidance', 'Developer Review Area', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']) {
  if (!reportExcel.includes(marker)) errors.push(`analytics Excel export missing marker: ${marker}`);
}

const browserCleanup = fs.readFileSync(path.join(root, 'server/services/browserProcessCleanup.js'), 'utf8');
for (const marker of ['--ai-testpilot-run-id=', 'Get-CimInstance Win32_Process', 'taskkill', 'server startup stale cleanup', 'SIGINT', 'SIGTERM', 'AUTOMATION_BROWSER_CLEANUP_INCOMPLETE', 'Test results remain valid']) {
  if (!browserCleanup.includes(marker)) errors.push(`browser cleanup missing marker: ${marker}`);
}
if (/throw error;/.test(browserCleanup) && /AUTOMATION_BROWSER_CLEANUP_FAILED/.test(browserCleanup)) {
  errors.push('browser cleanup must not throw away captured PASS/FAIL results');
}
const runner = fs.readFileSync(path.join(root, 'server/services/singleSpecRunner.js'), 'utf8');
for (const marker of ['AUTOMATION_RUN_ID', 'cleanupAutomationBrowsers', 'post-run', 'randomUUID']) {
  if (!runner.includes(marker)) errors.push(`single spec runner cleanup missing marker: ${marker}`);
}
const engineConfig = fs.readFileSync(path.join(root, 'automation-system/engine.config.js'), 'utf8');
for (const marker of ['AUTOMATION_RUN_ID', '--ai-testpilot-run-id=']) {
  if (!engineConfig.includes(marker)) errors.push(`engine Chromium ownership marker missing: ${marker}`);
}

const chatRoute = fs.readFileSync(path.join(root, 'server/routes/chat.js'), 'utf8');
for (const marker of ['browser=not-launched', 'discovery=http+cheerio', 'status: "NOT_LAUNCHED"', 'Browser management is not invoked in this route']) {
  if (!chatRoute.includes(marker)) errors.push(`browser-free generation contract missing marker: ${marker}`);
}
for (const forbidden of ['ownedBrowserPids', 'generation-browser-audit', 'cleanupAutomationBrowsers', 'executeSingleGeneratedSpec']) {
  if (chatRoute.includes(forbidden)) errors.push(`generation route must not invoke browser lifecycle code: ${forbidden}`);
}
const generationUi = fs.readFileSync(path.join(root, 'testpilot-ui/generation-experience.js'), 'utf8');
for (const marker of ['No automation browser launched', 'Chrome opens only when', 'body.ai-generation-active #cases>.activity-alert', 'isReadinessValidation', '/api/test-cases/revalidate', 'setInterval(updateElapsed, 1000)']) {
  if (!generationUi.includes(marker)) errors.push(`generation overlay/timer missing marker: ${marker}`);
}

const restUi = path.join(root, 'testpilot-ui/rest.html');
if (!fs.existsSync(restUi)) errors.push('missing REST API workspace UI');
else {
  const html = fs.readFileSync(restUi, 'utf8');
  for (const marker of ['Swagger / OpenAPI URL', 'Manual endpoints', 'Generate REST Test Cases', 'Run Approved REST Tests']) {
    if (!html.includes(marker)) errors.push(`REST UI missing marker: ${marker}`);
  }
}

if (errors.length) {
  console.error('\nPlatform smoke check failed:');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log('\nPlatform smoke check passed. This validates static wiring only; run PostgreSQL migration and Cypress integration separately.');
}
