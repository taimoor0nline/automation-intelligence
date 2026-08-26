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
  'server/services/authService.js',
  'server/services/persistenceService.js',
  'server/services/requestContext.js',
  'server/services/sourceAwareService.js',
  'server/services/failureResolutionAiService.js',
  'server/services/restApiDiscoveryService.js',
  'server/services/restTestCaseAiService.js',
  'server/services/restAutomationService.js',
  'server/services/reportGenerator.js',
  'testpilot-ui/platform-ui.js',
  'testpilot-ui/defect-assignment.js',
  'testpilot-ui/results-analysis.js',
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

for (const migration of ['server/db/001_platform.sql', 'server/db/002_source_guidance.sql', 'server/db/003_quality_attribution.sql', 'server/db/004_rest_api_testing.sql']) {
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
