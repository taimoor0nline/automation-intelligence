const v3 = require("./deterministicAutomationGeneratorV3");

function generateDeterministicAutomation(approvedTestCases = []) {
  const generated = v3.generateDeterministicAutomation(approvedTestCases);
  return {
    ...generated,
    script: String(generated.script || "").replace(
      "describe('AI TestPilot Approved Test Suite', () => {",
      "describe('Test execution', () => {"
    ),
  };
}

module.exports = { ...v3, generateDeterministicAutomation };
