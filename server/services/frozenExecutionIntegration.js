const crypto = require('crypto');

let installed = false;

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function frozenArtifact(testCase) {
  const validation = testCase?.canonicalValidation || {};
  const script = String(validation.approvedAutomationSource || '');
  const expectedHash = String(validation.approvedAutomationSourceHash || '');
  if (!script && !expectedHash) return null;
  if (!script || !expectedHash) {
    const error = new Error(`${testCase.id || 'Approved test'} has an incomplete frozen execution artifact. Revalidate the test.`);
    error.code = 'APPROVED_AUTOMATION_SOURCE_INCOMPLETE';
    throw error;
  }
  const actualHash = hash(script);
  if (actualHash !== expectedHash) {
    const error = new Error(`${testCase.id || 'Approved test'} frozen execution source hash does not match the human-approved artifact.`);
    error.code = 'APPROVED_AUTOMATION_SOURCE_MISMATCH';
    throw error;
  }
  return { script, hash: actualHash };
}

function install() {
  if (installed) return;
  installed = true;
  const generator = require('./deterministicAutomationGenerator');
  const strict = require('./strictCypressIntegration');
  const previous = generator.generateDeterministicAutomation;

  generator.generateDeterministicAutomation = function frozenExecutionGenerate(approvedTestCases = []) {
    if (!Array.isArray(approvedTestCases) || !approvedTestCases.length) return previous(approvedTestCases);
    const artifacts = approvedTestCases.map(frozenArtifact);
    if (!artifacts.some(Boolean)) return previous(approvedTestCases);
    if (!artifacts.every(Boolean)) {
      const error = new Error('Frozen and non-frozen approved tests cannot be mixed in one execution batch. Revalidate all selected tests.');
      error.code = 'MIXED_FROZEN_EXECUTION_ARTIFACTS';
      throw error;
    }

    for (const testCase of approvedTestCases) {
      if (testCase?.canonicalIr) {
        strict.verifyLegacyDeterministicSeals(testCase);
        strict.verifyCypressSeal(testCase);
      }
    }

    const script = artifacts.map((item) => item.script).join('\n\n');
    return {
      fileName: 'approved-execution.cy.js',
      framework: 'browser-automation',
      language: 'javascript',
      generationMode: 'approved-frozen-execution-contract-v2',
      script,
      scriptHash: hash(script),
      testCaseIds: approvedTestCases.map((testCase) => testCase.id),
    };
  };
  generator.__frozenExecutionContractPatched = true;
}

module.exports = { install, frozenArtifact, hash };
