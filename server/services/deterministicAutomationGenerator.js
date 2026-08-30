const v5 = require("./deterministicAutomationGeneratorV5");

function generateDeterministicAutomation(approvedTestCases = []) {
  const generated = v5.generateDeterministicAutomation(approvedTestCases);
  return {
    ...generated,
    script: String(generated.script || "").replace(
      "describe('AI TestPilot Approved Test Suite', () => {",
      "describe('Test execution', () => {"
    ),
  };
}

module.exports = { ...v5, generateDeterministicAutomation };
