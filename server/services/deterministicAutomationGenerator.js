const crypto = require('crypto');
const v7 = require('./deterministicAutomationGeneratorV7');

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function frozenSource(testCase) {
  const validation = testCase?.canonicalValidation || {};
  const source = String(validation.approvedAutomationSource || '');
  const expectedHash = String(validation.approvedAutomationSourceHash || validation.approvedCypressArtifactHash || '');
  if (!source || !expectedHash) return null;
  const actualHash = hash(source);
  if (actualHash !== expectedHash) {
    const error = new Error(`${testCase.id || 'Approved test'} frozen automation source no longer matches its approval hash.`);
    error.code = 'APPROVED_AUTOMATION_SOURCE_MISMATCH';
    throw error;
  }
  return source;
}

function generateDeterministicAutomation(approvedTestCases = []) {
  if (!approvedTestCases.length) throw new Error('No approved test cases were supplied for deterministic generation.');
  const frozen = approvedTestCases.map(frozenSource);
  if (frozen.every(Boolean)) {
    const script = frozen.join('\n\n');
    return {
      fileName: 'approved-execution.cy.js',
      framework: 'browser-automation',
      language: 'javascript',
      generationMode: 'approved-frozen-execution-contract-v2',
      script,
      scriptHash: hash(script),
      testCaseIds: approvedTestCases.map((testCase) => testCase.id),
    };
  }
  if (frozen.some(Boolean)) {
    const error = new Error('Approved and non-frozen automation artifacts cannot be mixed in one execution batch. Revalidate all selected tests.');
    error.code = 'MIXED_FROZEN_EXECUTION_ARTIFACTS';
    throw error;
  }
  return v7.generateDeterministicAutomation(approvedTestCases);
}

module.exports = { ...v7, generateDeterministicAutomation };
