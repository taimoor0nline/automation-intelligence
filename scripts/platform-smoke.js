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
  'server/routes/projects.js',
  'server/routes/restApi.js',
  'server/routes/sessionContext.js',
  'server/routes/reporting.js',
  'server/services/authService.js',
  'server/services/persistenceService.js',
  'server/services/requestContext.js',
  'server/services/sourceAwareService.js',
  'server/services/failureResolutionAiService.js',
  'server/services/restApiDiscoveryService.js',
  'server/services/restTestCaseAiService.js',
  'server/services/restAutomationService.js',
  'server/services/reportGenerator.js',
  'server/services/testCategories.js',
  'testpilot-ui/platform-ui.js',
  'testpilot-ui/defect-assignment.js',
  'testpilot-ui/results-analysis.js',
  'testpilot-ui/reporting.js',
  'testpilot-ui/reporting-entry.js',
  'testpilot-ui/test-case-export.js',
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
for (const marker of ['test_category', 'executed_by_role', 'idx_test_results_category_outcome', 'idx_test_runs_user_completed', 'idx_test_runs_role_completed']) {
  if (!reportingSchema.includes(marker)) errors.push(`reporting schema missing ${marker}`);
}

const persistence = fs.readFileSync(path.join(root, 'server/services/persistenceService.js'), 'utf8');
for (const marker of ['test_category', 'executed_by_role', 'categoryByCaseId', 'normalizeTestCategory']) {
  if (!persistence.includes(marker)) errors.push(`persistence missing reporting marker ${marker}`);
}

const reportingRoute = fs.readFileSync(path.join(root, 'server/routes/reporting.js'), 'utf8');
for (const marker of ['/api/reporting/filters', '/api/reporting/summary', "viewerRole === 'QA'", "viewerRole === 'DEV'", "viewerRole !== 'MANAGER'", 'filters.from', 'filters.to', 'filters.category', 'filters.userId']) {
  if (!reportingRoute.includes(marker)) errors.push(`reporting route missing marker ${marker}`);
}

const reportsUi = path.join(root, 'testpilot-ui/reports.html');
if (!fs.existsSync(reportsUi)) errors.push('missing reporting dashboard UI');
else {
  const html = fs.readFileSync(reportsUi, 'utf8');
  for (const marker of ['From date', 'To date', 'Test category', 'User breakdown', 'Role breakdown', 'Run history']) {
    if (!html.includes(marker)) errors.push(`reporting UI missing marker: ${marker}`);
  }
}

const excelExport = fs.readFileSync(path.join(root, 'testpilot-ui/test-case-export.js'), 'utf8');
for (const marker of ['.xlsx', '[Content_Types].xml', 'Test Category', 'Automation Readiness', 'Expected Results']) {
  if (!excelExport.includes(marker)) errors.push(`Excel export missing marker ${marker}`);
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
