const v6 = require("./deterministicAutomationGeneratorV6");

function generateDeterministicAutomation(approvedTestCases = []) {
  const generated = v6.generateDeterministicAutomation(approvedTestCases);
  return {
    ...generated,
    script: String(generated.script || "").replace(
      "describe('AI TestPilot Approved Test Suite', () => {",
      "describe('Test execution', () => {"
    ),
  };
}

module.exports = { ...v6, generateDeterministicAutomation };
