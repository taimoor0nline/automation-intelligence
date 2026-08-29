const fs = require('fs');
const path = require('path');
const v10 = require('./automationDslV10');

function boolEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return !['false','0','no','off'].includes(String(value).toLowerCase());
}

function safeName(value) {
  const name = String(value || '').trim();
  return Boolean(name && !name.includes('..') && !/[\\/]/.test(name));
}

function configuredPath(envName, fallback) {
  const configured = String(process.env[envName] || '').trim();
  if (!configured) return fallback;
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
}

function runtimeAssetErrors(plan) {
  const errors = [];
  const repoRoot = path.resolve(__dirname, '..', '..');
  const uploadDir = configuredPath('AUTOMATION_UPLOAD_FIXTURE_DIR', path.join(repoRoot, 'automation-system', 'fixtures', 'uploads'));
  const baselineDir = configuredPath('AUTOMATION_VISUAL_BASELINE_DIR', path.join(repoRoot, 'automation-system', 'baselines'));

  for (const action of plan?.actions || []) {
    if (action.operation !== 'SELECT_FILE') continue;
    if (!safeName(action.fileName)) {
      errors.push({ reasonCode: 'UPLOAD_FIXTURE_INVALID', message: `Upload fixture name is unsafe: ${action.fileName || 'missing'}` });
      continue;
    }
    const filePath = path.join(uploadDir, action.fileName);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      errors.push({ reasonCode: 'UPLOAD_FIXTURE_NOT_FOUND', message: `Upload fixture is not available: ${action.fileName}. Add it under ${uploadDir}.` });
    }
  }

  if (!boolEnv(process.env.AUTOMATION_VISUAL_UPDATE_BASELINES, false)) {
    for (const assertion of plan?.assertions || []) {
      if (assertion.operation !== 'ASSERT_VISUAL_MATCH') continue;
      if (!safeName(assertion.baselineName)) {
        errors.push({ reasonCode: 'VISUAL_BASELINE_INVALID', message: `Visual baseline name is unsafe: ${assertion.baselineName || 'missing'}` });
        continue;
      }
      const baselinePath = path.join(baselineDir, assertion.baselineName);
      if (!fs.existsSync(baselinePath) || !fs.statSync(baselinePath).isFile()) {
        errors.push({ reasonCode: 'VISUAL_BASELINE_NOT_FOUND', message: `Approved visual baseline is not available: ${assertion.baselineName}. Add it under ${baselineDir}, or explicitly enable AUTOMATION_VISUAL_UPDATE_BASELINES while approving a new baseline.` });
      }
    }
  }
  return errors;
}

function compileTestCase(testCase, context = {}) {
  const compiled = v10.compileTestCase(testCase, context);
  if (!compiled?.ok || !compiled.plan) return compiled;
  const errors = runtimeAssetErrors(compiled.plan);
  if (!errors.length) return compiled;
  return {
    ok: false,
    reasonCode: errors[0].reasonCode,
    reason: errors[0].message,
    errors: errors.map((item) => item.message),
    supportedOperations: compiled.supportedOperations || [...(v10.SUPPORTED_OPERATIONS || [])],
    supportedAssertions: compiled.supportedAssertions || [],
    assertionSuggestions: compiled.plan.assertionSuggestions || [],
    uncompiledExpectations: compiled.plan.narrativeExpectations || [],
    expectationCoverage: compiled.expectationCoverage || compiled.plan.expectationCoverage || null,
  };
}

module.exports = {
  ...v10,
  compileTestCase,
  runtimeAssetErrors,
};
