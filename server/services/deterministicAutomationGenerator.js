const v4 = require("./deterministicAutomationGeneratorV4");

function generateDeterministicAutomation(approvedTestCases = []) {
  const generated = v4.generateDeterministicAutomation(approvedTestCases);
  return {
    ...generated,
    script: String(generated.script || "").replace(
      "describe('AI TestPilot Approved Test Suite', () => {",
      "describe('Test execution', () => {"
    ),
  };
}

module.exports = { ...v4, generateDeterministicAutomation };
