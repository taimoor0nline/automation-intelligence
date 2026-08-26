function jsString(value) {
  return JSON.stringify(String(value));
}

function emitAction(action) {
  switch (action.operation) {
    case "LOGIN_VALID":
      return "    cy.loginWithRuntimeCredentials();";
    case "NAVIGATE":
      return `    cy.visit(${jsString(action.path)});`;
    case "TYPE":
      return `    cy.get(${jsString(action.selector)}).clear().type(${jsString(action.value)});`;
    case "CLEAR":
      return `    cy.get(${jsString(action.selector)}).clear();`;
    case "CLICK":
      return `    cy.get(${jsString(action.selector)}).click();`;
    case "SELECT":
      return `    cy.get(${jsString(action.selector)}).select(${jsString(action.value)});`;
    case "CHECK":
      return `    cy.get(${jsString(action.selector)}).check();`;
    case "UNCHECK":
      return `    cy.get(${jsString(action.selector)}).uncheck();`;
    default:
      throw new Error(`Unsupported deterministic action: ${action.operation}`);
  }
}

function emitAssertion(assertion) {
  switch (assertion.operation) {
    case "ASSERT_VISIBLE":
      return `    cy.get(${jsString(assertion.selector)}).should('be.visible');`;
    case "ASSERT_TEXT_NOT_EMPTY":
      return `    cy.get(${jsString(assertion.selector)}).invoke('text').should('not.be.empty');`;
    case "ASSERT_HIDDEN_OR_ABSENT":
      return `    cy.get('body').then(($body) => { const $el = $body.find(${jsString(assertion.selector)}); if ($el.length) cy.wrap($el).should('not.be.visible'); });`;
    case "ASSERT_URL_INCLUDES":
      return `    cy.url().should('include', ${jsString(assertion.path)});`;
    case "ASSERT_URL_NOT_INCLUDES":
      return `    cy.url().should('not.include', ${jsString(assertion.path)});`;
    case "ASSERT_URL_CONTAINS":
      return `    cy.url().should('include', ${jsString(assertion.fragment)});`;
    case "ASSERT_PATH_EQUALS":
      return `    cy.location('pathname').should('eq', ${jsString(assertion.path)});`;
    case "ASSERT_VALUE_LENGTH_EQUALS":
      return `    cy.get(${jsString(assertion.selector)}).invoke('val').then((value) => { expect(String(value ?? '').length).to.eq(${Number(assertion.length)}); });`;
    case "ASSERT_VALUE_LENGTH_AT_MOST":
      return `    cy.get(${jsString(assertion.selector)}).invoke('val').then((value) => { expect(String(value ?? '').length).to.be.at.most(${Number(assertion.length)}); });`;
    default:
      throw new Error(`Unsupported deterministic assertion: ${assertion.operation}`);
  }
}

function generateDeterministicAutomation(approvedTestCases = []) {
  if (!approvedTestCases.length) throw new Error("No approved test cases were supplied for deterministic generation.");
  const lines = ["describe('AI TestPilot Approved Test Suite', () => {"];
  for (const testCase of approvedTestCases) {
    const plan = testCase?.automationReadiness?.automationPlan;
    if (!plan) throw new Error(`${testCase.id} has no compiled automation plan.`);
    lines.push(`  it(${jsString(`${testCase.id} - ${testCase.title}`)}, () => {`);
    for (const action of plan.actions || []) lines.push(emitAction(action));
    lines.push("");
    for (const assertion of plan.assertions || []) lines.push(emitAssertion(assertion));
    lines.push("  });", "");
  }
  lines.push("});", "");
  return { fileName: "ai-generated.cy.js", framework: "browser-automation", language: "javascript", generationMode: "deterministic-dsl", script: lines.join("\n") };
}

module.exports = { generateDeterministicAutomation };
