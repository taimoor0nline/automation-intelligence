function jsString(value) {
  return JSON.stringify(String(value));
}

function jsNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be numeric.`);
  return number;
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
  const selector = assertion.selector ? jsString(assertion.selector) : null;
  switch (assertion.operation) {
    case "ASSERT_EXISTS":
      return `    cy.get(${selector}).should('exist');`;
    case "ASSERT_NOT_EXISTS":
      return `    cy.get(${selector}).should('not.exist');`;
    case "ASSERT_VISIBLE":
      return `    cy.get(${selector}).should('be.visible');`;
    case "ASSERT_HIDDEN":
      return `    cy.get(${selector}).should('not.be.visible');`;
    case "ASSERT_HIDDEN_OR_ABSENT":
      return `    cy.get('body').then(($body) => { const $el = $body.find(${selector}); if ($el.length) cy.wrap($el).should('not.be.visible'); });`;

    case "ASSERT_TEXT_EQUALS":
      return `    cy.get(${selector}).should('have.text', ${jsString(assertion.text)});`;
    case "ASSERT_TEXT_CONTAINS":
      return `    cy.get(${selector}).should('contain.text', ${jsString(assertion.text)});`;
    case "ASSERT_TEXT_NOT_CONTAINS":
      return `    cy.get(${selector}).should('not.contain.text', ${jsString(assertion.text)});`;
    case "ASSERT_TEXT_EMPTY":
      return `    cy.get(${selector}).invoke('text').should('be.empty');`;
    case "ASSERT_TEXT_NOT_EMPTY":
      return `    cy.get(${selector}).invoke('text').should('not.be.empty');`;
    case "ASSERT_HTML_EQUALS":
      return `    cy.get(${selector}).should('have.html', ${jsString(assertion.html)});`;
    case "ASSERT_HTML_CONTAINS":
      return `    cy.get(${selector}).invoke('html').should('include', ${jsString(assertion.html)});`;

    case "ASSERT_VALUE_EQUALS":
      return `    cy.get(${selector}).should('have.value', ${jsString(assertion.value)});`;
    case "ASSERT_VALUE_CONTAINS":
      return `    cy.get(${selector}).invoke('val').then((value) => { expect(String(value ?? '')).to.include(${jsString(assertion.value)}); });`;
    case "ASSERT_VALUE_EMPTY":
      return `    cy.get(${selector}).should('have.value', '');`;
    case "ASSERT_VALUE_NOT_EMPTY":
      return `    cy.get(${selector}).invoke('val').then((value) => { expect(String(value ?? '')).to.not.equal(''); });`;
    case "ASSERT_VALUE_LENGTH_EQUALS":
      return `    cy.get(${selector}).invoke('val').then((value) => { expect(String(value ?? '').length).to.eq(${jsNumber(assertion.length, "length")}); });`;
    case "ASSERT_VALUE_LENGTH_AT_MOST":
      return `    cy.get(${selector}).invoke('val').then((value) => { expect(String(value ?? '').length).to.be.at.most(${jsNumber(assertion.length, "length")}); });`;
    case "ASSERT_VALUE_LENGTH_AT_LEAST":
      return `    cy.get(${selector}).invoke('val').then((value) => { expect(String(value ?? '').length).to.be.at.least(${jsNumber(assertion.length, "length")}); });`;
    case "ASSERT_CHECKED":
      return `    cy.get(${selector}).should('be.checked');`;
    case "ASSERT_UNCHECKED":
      return `    cy.get(${selector}).should('not.be.checked');`;
    case "ASSERT_ENABLED":
      return `    cy.get(${selector}).should('be.enabled');`;
    case "ASSERT_DISABLED":
      return `    cy.get(${selector}).should('be.disabled');`;
    case "ASSERT_FOCUSED":
      return `    cy.get(${selector}).should('be.focused');`;
    case "ASSERT_REQUIRED":
      return `    cy.get(${selector}).should('have.attr', 'required');`;
    case "ASSERT_OPTIONAL":
      return `    cy.get(${selector}).should('not.have.attr', 'required');`;
    case "ASSERT_VALID":
      return `    cy.get(${selector}).should(($el) => { expect(typeof $el[0]?.checkValidity === 'function' ? $el[0].checkValidity() : true).to.eq(true); });`;
    case "ASSERT_INVALID":
      return `    cy.get(${selector}).should(($el) => { expect(typeof $el[0]?.checkValidity === 'function' ? $el[0].checkValidity() : false).to.eq(false); });`;
    case "ASSERT_SELECTED_VALUE_EQUALS":
      return `    cy.get(${selector}).should('have.value', ${jsString(assertion.value)});`;

    case "ASSERT_ATTR_EXISTS":
      return `    cy.get(${selector}).should('have.attr', ${jsString(assertion.name)});`;
    case "ASSERT_ATTR_NOT_EXISTS":
      return `    cy.get(${selector}).should('not.have.attr', ${jsString(assertion.name)});`;
    case "ASSERT_ATTR_EQUALS":
      return `    cy.get(${selector}).should('have.attr', ${jsString(assertion.name)}, ${jsString(assertion.value)});`;
    case "ASSERT_ATTR_CONTAINS":
      return `    cy.get(${selector}).invoke('attr', ${jsString(assertion.name)}).then((value) => { expect(String(value ?? '')).to.include(${jsString(assertion.value)}); });`;
    case "ASSERT_PROP_EQUALS":
      return `    cy.get(${selector}).invoke('prop', ${jsString(assertion.name)}).then((value) => { expect(String(value)).to.eq(${jsString(assertion.value)}); });`;
    case "ASSERT_CLASS_INCLUDES":
      return `    cy.get(${selector}).should('have.class', ${jsString(assertion.className)});`;
    case "ASSERT_CLASS_NOT_INCLUDES":
      return `    cy.get(${selector}).should('not.have.class', ${jsString(assertion.className)});`;
    case "ASSERT_CSS_EQUALS":
      return `    cy.get(${selector}).should('have.css', ${jsString(assertion.name)}, ${jsString(assertion.value)});`;
    case "ASSERT_PLACEHOLDER_EQUALS":
      return `    cy.get(${selector}).should('have.attr', 'placeholder', ${jsString(assertion.value)});`;
    case "ASSERT_ARIA_EQUALS":
      return `    cy.get(${selector}).should('have.attr', ${jsString(assertion.name)}, ${jsString(assertion.value)});`;

    case "ASSERT_COUNT_EQUALS":
      return `    cy.get(${selector}).should('have.length', ${jsNumber(assertion.count, "count")});`;
    case "ASSERT_COUNT_AT_LEAST":
      return `    cy.get(${selector}).should(($els) => { expect($els.length).to.be.at.least(${jsNumber(assertion.count, "count")}); });`;
    case "ASSERT_COUNT_AT_MOST":
      return `    cy.get(${selector}).should(($els) => { expect($els.length).to.be.at.most(${jsNumber(assertion.count, "count")}); });`;

    case "ASSERT_URL_EQUALS":
      return `    cy.url().should('eq', ${jsString(assertion.url)});`;
    case "ASSERT_URL_INCLUDES":
      return `    cy.url().should('include', ${jsString(assertion.fragment ?? assertion.path)});`;
    case "ASSERT_URL_NOT_INCLUDES":
      return `    cy.url().should('not.include', ${jsString(assertion.fragment ?? assertion.path)});`;
    case "ASSERT_URL_CONTAINS":
      return `    cy.url().should('include', ${jsString(assertion.fragment)});`;
    case "ASSERT_PATH_EQUALS":
      return `    cy.location('pathname').should('eq', ${jsString(assertion.path)});`;
    case "ASSERT_PATH_INCLUDES":
      return `    cy.location('pathname').should('include', ${jsString(assertion.fragment)});`;
    case "ASSERT_QUERY_INCLUDES":
      return `    cy.location('search').should('include', ${jsString(assertion.fragment)});`;
    case "ASSERT_HASH_EQUALS":
      return `    cy.location('hash').should('eq', ${jsString(assertion.hash)});`;
    case "ASSERT_TITLE_EQUALS":
      return `    cy.title().should('eq', ${jsString(assertion.text)});`;
    case "ASSERT_TITLE_INCLUDES":
      return `    cy.title().should('include', ${jsString(assertion.text)});`;

    case "ASSERT_COOKIE_EXISTS":
      return `    cy.getCookie(${jsString(assertion.name)}).should('exist');`;
    case "ASSERT_COOKIE_EQUALS":
      return `    cy.getCookie(${jsString(assertion.name)}).should('have.property', 'value', ${jsString(assertion.value)});`;
    case "ASSERT_COOKIE_ABSENT":
      return `    cy.getCookie(${jsString(assertion.name)}).should('be.null');`;
    case "ASSERT_LOCAL_STORAGE_EXISTS":
      return `    cy.window().then((win) => { expect(win.localStorage.getItem(${jsString(assertion.key)})).to.not.equal(null); });`;
    case "ASSERT_LOCAL_STORAGE_EQUALS":
      return `    cy.window().then((win) => { expect(win.localStorage.getItem(${jsString(assertion.key)})).to.eq(${jsString(assertion.value)}); });`;
    case "ASSERT_LOCAL_STORAGE_ABSENT":
      return `    cy.window().then((win) => { expect(win.localStorage.getItem(${jsString(assertion.key)})).to.equal(null); });`;
    case "ASSERT_SESSION_STORAGE_EXISTS":
      return `    cy.window().then((win) => { expect(win.sessionStorage.getItem(${jsString(assertion.key)})).to.not.equal(null); });`;
    case "ASSERT_SESSION_STORAGE_EQUALS":
      return `    cy.window().then((win) => { expect(win.sessionStorage.getItem(${jsString(assertion.key)})).to.eq(${jsString(assertion.value)}); });`;
    case "ASSERT_SESSION_STORAGE_ABSENT":
      return `    cy.window().then((win) => { expect(win.sessionStorage.getItem(${jsString(assertion.key)})).to.equal(null); });`;
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
