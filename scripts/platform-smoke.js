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
  'server/routes/sessionContext.js',
  'server/services/authService.js',
  'server/services/persistenceService.js',
  'server/services/requestContext.js',
  'server/services/sourceAwareService.js',
  'server/services/failureResolutionAiService.js',
  'server/services/reportGenerator.js',
  'testpilot-ui/platform-ui.js',
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
  for (const dep of ['pg', 'bcryptjs', 'jsonwebtoken']) {
    if (!pkg.dependencies?.[dep]) errors.push(`package.json missing dependency ${dep}`);
  }
  if (!pkg.scripts?.['db:migrate']) errors.push('package.json missing db:migrate script');
} catch (err) {
  errors.push(`package.json: ${err.message}`);
}

for (const migration of ['server/db/001_platform.sql', 'server/db/002_source_guidance.sql', 'server/db/003_quality_attribution.sql']) {
  if (!fs.existsSync(path.join(root, migration))) errors.push(`missing migration ${migration}`);
}

const schema = fs.readFileSync(path.join(root, 'server/db/001_platform.sql'), 'utf8');
for (const table of ['users', 'projects', 'source_repositories', 'test_sessions', 'test_runs', 'test_results', 'defect_analyses', 'code_change_metrics']) {
  if (!new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, 'i').test(schema)) errors.push(`schema missing ${table}`);
}

if (errors.length) {
  console.error('\nPlatform smoke check failed:');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log('\nPlatform smoke check passed. This validates static wiring only; run PostgreSQL migration and Cypress integration separately.');
}
