const fs = require('fs');
const path = require('path');
const v10 = require('./automationDslV10');

function boolEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return !['false','0','no','off'].includes(String(value).toLowerCase());
}

function visualBaselineMode() {
  const explicit = String(process.env.AUTOMATION_VISUAL_BASELINE_MODE || '').trim().toLowerCase();
  if (['compare', 'create-missing'].includes(explicit)) return explicit;
  return boolEnv(process.env.AUTOMATION_VISUAL_UPDATE_BASELINES, false) ? 'create-missing' : 'compare';
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

function parseNamedDbQueries() {
  try {
    const parsed = JSON.parse(process.env.AUTOMATION_DB_ASSERTION_QUERIES_JSON || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function queryDefinition(queryName) {
  const value = parseNamedDbQueries()[String(queryName || '')];
  if (!value) return null;
  if (typeof value === 'string') return { sql: value, params: [] };
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return {
      sql: String(value.sql || ''),
      params: Array.isArray(value.params) ? value.params.map(String).filter(Boolean) : [],
    };
  }
  return null;
}

function attachDatabaseParameters(testCase, compiled) {
  if (!compiled?.ok || !compiled.plan?.assertions?.length) return compiled;
  const testData = testCase?.testData && typeof testCase.testData === 'object' && !Array.isArray(testCase.testData) ? testCase.testData : {};
  const assertions = [];

  for (const assertion of compiled.plan.assertions) {
    if (!['ASSERT_DATABASE_VALUE_EQUALS', 'ASSERT_DATABASE_ROW_COUNT_EQUALS'].includes(assertion.operation)) {
      assertions.push(assertion);
      continue;
    }

    const definition = queryDefinition(assertion.queryName);
    if (!definition) {
      return {
        ...compiled,
        ok: false,
        reasonCode: 'DATABASE_ASSERTION_NOT_CONFIGURED',
        reason: `Named database assertion query is not configured: ${assertion.queryName}`,
        errors: [`Named database assertion query is not configured: ${assertion.queryName}`],
      };
    }

    const missing = definition.params.filter((key) => !Object.prototype.hasOwnProperty.call(testData, key));
    if (missing.length) {
      return {
        ...compiled,
        ok: false,
        reasonCode: 'DATABASE_ASSERTION_PARAMETER_MISSING',
        reason: `Named database assertion ${assertion.queryName} requires reviewed testData value(s): ${missing.join(', ')}.`,
        errors: missing.map((key) => `Missing testData parameter for named DB assertion: ${key}`),
      };
    }

    assertions.push({
      ...assertion,
      params: definition.params.map((key) => testData[key]),
      parameterKeys: definition.params,
    });
  }

  return { ...compiled, plan: { ...compiled.plan, assertions } };
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

  if (visualBaselineMode() === 'compare') {
    for (const assertion of plan?.assertions || []) {
      if (assertion.operation !== 'ASSERT_VISUAL_MATCH') continue;
      if (!safeName(assertion.baselineName)) {
        errors.push({ reasonCode: 'VISUAL_BASELINE_INVALID', message: `Visual baseline name is unsafe: ${assertion.baselineName || 'missing'}` });
        continue;
      }
      const baselinePath = path.join(baselineDir, assertion.baselineName);
      if (!fs.existsSync(baselinePath) || !fs.statSync(baselinePath).isFile()) {
        errors.push({ reasonCode: 'VISUAL_BASELINE_NOT_FOUND', message: `Approved visual baseline is not available: ${assertion.baselineName}. Add it under ${baselineDir}, or temporarily set AUTOMATION_VISUAL_BASELINE_MODE=create-missing while intentionally approving the first baseline.` });
      }
    }
  }
  return errors;
}

function compileTestCase(testCase, context = {}) {
  let compiled = v10.compileTestCase(testCase, context);
  if (!compiled?.ok || !compiled.plan) return compiled;
  compiled = attachDatabaseParameters(testCase, compiled);
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
  attachDatabaseParameters,
  queryDefinition,
  visualBaselineMode,
};
