const crypto = require('crypto');
const rawGenerator = require('./deterministicAutomationGeneratorV6');

function normalizeExecutionScript(script) {
  return String(script || '').replace(
    "describe('AI TestPilot Approved Test Suite', () => {",
    "describe('Test execution', () => {"
  );
}

function hashScript(script) {
  return crypto.createHash('sha256').update(String(script || '')).digest('hex');
}

function buildCypressArtifact(testCases = []) {
  const generated = rawGenerator.generateDeterministicAutomation(testCases);
  const script = normalizeExecutionScript(generated.script);
  return {
    ...generated,
    framework: 'browser-automation',
    generationMode: `${generated.generationMode || 'deterministic'}+strict-execution`,
    script,
    scriptHash: hashScript(script),
  };
}

function buildSingleCaseArtifact(testCase) {
  return buildCypressArtifact([testCase]);
}

module.exports = {
  buildCypressArtifact,
  buildSingleCaseArtifact,
  normalizeExecutionScript,
  hashScript,
};
