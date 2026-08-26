function jsString(value) {
  return JSON.stringify(String(value));
}

function jsNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be numeric.`);
  return number;
}

function keyToken(key) {
  const normalized = String(key || "").toLowerCase();
  const map = {
    enter: "{enter}",
    esc: "{esc}",
    escape: "{esc}",
    uparrow: "{uparrow}",
    downarrow: "{downarrow}",
    leftarrow: "{leftarrow}",
    rightarrow: "{rightarrow}",
    home: "{home}",
    end: "{end}",
    backspace: "{backspace}",
    del: "{del}",
    delete: "{del}",
  };
  if (!map[normalized]) throw new Error(`Unsupported deterministic key: ${key}`);
  return map[normalized];
}

function emitAction(action) {
  switch (action.operation) {
    case "LOGIN_VALID": return "    cy.loginWithRuntimeCredentials();";
    case "NAVIGATE": return `    cy.visit(${jsString(action.path)});`;
    case "RELOAD": return "    cy.reload();";
    case "GO_BACK": return "    cy.go('back');";
    case "GO_FORWARD": return "    cy.go('forward');";
    case "SET_VIEWPORT": return `    cy.viewport(${jsNumber(action.width, "viewport width")}, ${jsNumber(action.height, "viewport height")});`;
    case "TYPE": return `    cy.get(${jsString(action.selector)}).clear().type(${jsString(action.value)});`;
    case "CLEAR": return `    cy.get(${jsString(action.selector)}).clear();`;
    case "CLICK": return `    cy.get(${jsString(action.selector)}).click();`;
    case "DBLCLICK": return `    cy.get(${jsString(action.selector)}).dblclick();`;
    case "RIGHTCLICK": return `    cy.get(${jsString(action.selector)}).rightclick();`;
    case "HOVER": return `    cy.get(${jsString(action.selector)}).trigger('mouseover');`;
    case "FOCUS": return `    cy.get(${jsString(action.selector)}).focus();`;
    case "BLUR": return `    cy.get(${jsString(action.selector)}).blur();`;
    case "SELECT": return `    cy.get(${jsString(action.selector)}).select(${jsString(action.value)});`;
    case "CHECK": return `    cy.get(${jsString(action.selector)}).check();`;
    case "UNCHECK": return `    cy.get(${jsString(action.selector)}).uncheck();`;
    case "SUBMIT": return `    cy.get(${jsString(action.selector)}).submit();`;
    case "SCROLL_INTO_VIEW": return `    cy.get(${jsString(action.selector)}).scrollIntoView();`;
    case "PRESS_KEY": return `    cy.get(${jsString(action.selector)}).type(${jsString(keyToken(action.key))});`;
    default: throw new Error(`Unsupported deterministic action: ${action.operation}`);
  }
}

function networkFilterExpression(assertion) {
  const url = jsString(assertion.urlFragment || "");
  const method = assertion.method ? jsString(String(assertion.method).toUpperCase()) : null;
  return method
    ? `item.url.includes(${url}) && item.method === ${method}`
    : `item.url.includes(${url})`;
}

function emitAssertion(assertion) {
  const selector = assertion.selector ? jsString(assertion.selector) : null;
  switch (assertion.operation) {
    case "ASSERT_EXISTS": return `    cy.get(${selector}).should('exist');`;
    case "ASSERT_NOT_EXISTS": return `    cy.get(${selector}).should('not.exist');`;
    case "ASSERT_VISIBLE": return `    cy.get(${selector}).should('be.visible');`;
    case "ASSERT_HIDDEN": return `    cy.get(${selector}).should('not.be.visible');`;
    case "ASSERT_HIDDEN_OR_ABSENT": return `    cy.get('body').then(($body) => { const $el = $body.find(${selector}); if ($el.length) cy.wrap($el).should('not.be.visible'); });`;
    case "ASSERT_ELEMENT_IN_VIEWPORT": return `    cy.get(${selector}).should(($el) => { const rect = $el[0].getBoundingClientRect(); const win = $el[0].ownerDocument.defaultView; expect(rect.bottom > 0 && rect.right > 0 && rect.top < win.innerHeight && rect.left < win.innerWidth).to.eq(true); });`;
    case "ASSERT_ELEMENT_NOT_IN_VIEWPORT": return `    cy.get(${selector}).should(($el) => { const rect = $el[0].getBoundingClientRect(); const win = $el[0].ownerDocument.defaultView; expect(rect.bottom <= 0 || rect.right <= 0 || rect.top >= win.innerHeight || rect.left >= win.innerWidth).to.eq(true); });`;
    case "ASSERT_ELEMENT_WIDTH_EQUALS": return `    cy.get(${selector}).should(($el) => { expect($el[0].getBoundingClientRect().width).to.eq(${jsNumber(assertion.pixels, "pixels")}); });`;
    case "ASSERT_ELEMENT_WIDTH_AT_LEAST": return `    cy.get(${selector}).should(($el) => { expect($el[0].getBoundingClientRect().width).to.be.at.least(${jsNumber(assertion.pixels, "pixels")}); });`;
    case "ASSERT_ELEMENT_WIDTH_AT_MOST": return `    cy.get(${selector}).should(($el) => { expect($el[0].getBoundingClientRect().width).to.be.at.most(${jsNumber(assertion.pixels, "pixels")}); });`;
    case "ASSERT_ELEMENT_HEIGHT_EQUALS": return `    cy.get(${selector}).should(($el) => { expect($el[0].getBoundingClientRect().height).to.eq(${jsNumber(assertion.pixels, "pixels")}); });`;
    case "ASSERT_ELEMENT_HEIGHT_AT_LEAST": return `    cy.get(${selector}).should(($el) => { expect($el[0].getBoundingClientRect().height).to.be.at.least(${jsNumber(assertion.pixels, "pixels")}); });`;
    case "ASSERT_ELEMENT_HEIGHT_AT_MOST": return `    cy.get(${selector}).should(($el) => { expect($el[0].getBoundingClientRect().height).to.be.at.most(${jsNumber(assertion.pixels, "pixels")}); });`;
    case "ASSERT_IMAGE_LOADED": return `    cy.get(${selector}).should(($img) => { expect(Boolean($img[0]?.complete && $img[0]?.naturalWidth > 0 && $img[0]?.naturalHeight > 0)).to.eq(true); });`;
    case "ASSERT_IMAGE_ALT_NOT_EMPTY": return `    cy.get(${selector}).invoke('attr', 'alt').should((value) => { expect(String(value || '').trim()).to.not.equal(''); });`;

    case "ASSERT_TEXT_EQUALS": return `    cy.get(${selector}).should('have.text', ${jsString(assertion.text)});`;
    case "ASSERT_TEXT_CONTAINS": return `    cy.get(${selector}).should('contain.text', ${jsString(assertion.text)});`;
    case "ASSERT_TEXT_NOT_CONTAINS": return `    cy.get(${selector}).should('not.contain.text', ${jsString(assertion.text)});`;
    case "ASSERT_TEXT_EMPTY": return `    cy.get(${selector}).invoke('text').should('be.empty');`;
    case "ASSERT_TEXT_NOT_EMPTY": return `    cy.get(${selector}).invoke('text').should('not.be.empty');`;
    case "ASSERT_HTML_EQUALS": return `    cy.get(${selector}).should('have.html', ${jsString(assertion.html)});`;
    case "ASSERT_HTML_CONTAINS": return `    cy.get(${selector}).invoke('html').should('include', ${jsString(assertion.html)});`;

    case "ASSERT_VALUE_EQUALS": return `    cy.get(${selector}).should('have.value', ${jsString(assertion.value)});`;
    case "ASSERT_VALUE_CONTAINS": return `    cy.get(${selector}).invoke('val').then((value) => { expect(String(value ?? '')).to.include(${jsString(assertion.value)}); });`;
    case "ASSERT_VALUE_EMPTY": return `    cy.get(${selector}).should('have.value', '');`;
    case "ASSERT_VALUE_NOT_EMPTY": return `    cy.get(${selector}).invoke('val').then((value) => { expect(String(value ?? '')).to.not.equal(''); });`;
    case "ASSERT_VALUE_LENGTH_EQUALS": return `    cy.get(${selector}).invoke('val').then((value) => { expect(String(value ?? '').length).to.eq(${jsNumber(assertion.length, "length")}); });`;
    case "ASSERT_VALUE_LENGTH_AT_MOST": return `    cy.get(${selector}).invoke('val').then((value) => { expect(String(value ?? '').length).to.be.at.most(${jsNumber(assertion.length, "length")}); });`;
    case "ASSERT_VALUE_LENGTH_AT_LEAST": return `    cy.get(${selector}).invoke('val').then((value) => { expect(String(value ?? '').length).to.be.at.least(${jsNumber(assertion.length, "length")}); });`;
    case "ASSERT_CHECKED": return `    cy.get(${selector}).should('be.checked');`;
    case "ASSERT_UNCHECKED": return `    cy.get(${selector}).should('not.be.checked');`;
    case "ASSERT_ENABLED": return `    cy.get(${selector}).should('be.enabled');`;
    case "ASSERT_DISABLED": return `    cy.get(${selector}).should('be.disabled');`;
    case "ASSERT_FOCUSED": return `    cy.get(${selector}).should('be.focused');`;
    case "ASSERT_REQUIRED": return `    cy.get(${selector}).should('have.attr', 'required');`;
    case "ASSERT_OPTIONAL": return `    cy.get(${selector}).should('not.have.attr', 'required');`;
    case "ASSERT_READONLY": return `    cy.get(${selector}).should('have.attr', 'readonly');`;
    case "ASSERT_NOT_READONLY": return `    cy.get(${selector}).should('not.have.attr', 'readonly');`;
    case "ASSERT_VALID": return `    cy.get(${selector}).should(($el) => { expect(typeof $el[0]?.checkValidity === 'function' ? $el[0].checkValidity() : true).to.eq(true); });`;
    case "ASSERT_INVALID": return `    cy.get(${selector}).should(($el) => { expect(typeof $el[0]?.checkValidity === 'function' ? $el[0].checkValidity() : false).to.eq(false); });`;
    case "ASSERT_SELECTED_VALUE_EQUALS": return `    cy.get(${selector}).should('have.value', ${jsString(assertion.value)});`;
    case "ASSERT_SELECTED_TEXT_EQUALS": return `    cy.get(${selector}).find('option:selected').should('have.text', ${jsString(assertion.text)});`;
    case "ASSERT_OPTION_COUNT_EQUALS": return `    cy.get(${selector}).find('option').should('have.length', ${jsNumber(assertion.count, "option count")});`;
    case "ASSERT_INPUT_TYPE_EQUALS": return `    cy.get(${selector}).should('have.attr', 'type', ${jsString(assertion.value)});`;
    case "ASSERT_MIN_EQUALS": return `    cy.get(${selector}).should('have.attr', 'min', ${jsString(assertion.value)});`;
    case "ASSERT_MAX_EQUALS": return `    cy.get(${selector}).should('have.attr', 'max', ${jsString(assertion.value)});`;
    case "ASSERT_MINLENGTH_EQUALS": return `    cy.get(${selector}).should('have.attr', 'minlength', ${jsString(assertion.value)});`;
    case "ASSERT_MAXLENGTH_EQUALS": return `    cy.get(${selector}).should('have.attr', 'maxlength', ${jsString(assertion.value)});`;
    case "ASSERT_PATTERN_EQUALS": return `    cy.get(${selector}).should('have.attr', 'pattern', ${jsString(assertion.value)});`;

    case "ASSERT_ATTR_EXISTS": return `    cy.get(${selector}).should('have.attr', ${jsString(assertion.name)});`;
    case "ASSERT_ATTR_NOT_EXISTS": return `    cy.get(${selector}).should('not.have.attr', ${jsString(assertion.name)});`;
    case "ASSERT_ATTR_EQUALS": return `    cy.get(${selector}).should('have.attr', ${jsString(assertion.name)}, ${jsString(assertion.value)});`;
    case "ASSERT_ATTR_CONTAINS": return `    cy.get(${selector}).invoke('attr', ${jsString(assertion.name)}).then((value) => { expect(String(value ?? '')).to.include(${jsString(assertion.value)}); });`;
    case "ASSERT_PROP_EQUALS": return `    cy.get(${selector}).invoke('prop', ${jsString(assertion.name)}).then((value) => { expect(String(value)).to.eq(${jsString(assertion.value)}); });`;
    case "ASSERT_CLASS_INCLUDES": return `    cy.get(${selector}).should('have.class', ${jsString(assertion.className)});`;
    case "ASSERT_CLASS_NOT_INCLUDES": return `    cy.get(${selector}).should('not.have.class', ${jsString(assertion.className)});`;
    case "ASSERT_CSS_EQUALS": return `    cy.get(${selector}).should('have.css', ${jsString(assertion.name)}, ${jsString(assertion.value)});`;
    case "ASSERT_PLACEHOLDER_EQUALS": return `    cy.get(${selector}).should('have.attr', 'placeholder', ${jsString(assertion.value)});`;
    case "ASSERT_ARIA_EQUALS": return `    cy.get(${selector}).should('have.attr', ${jsString(assertion.name)}, ${jsString(assertion.value)});`;

    case "ASSERT_COUNT_EQUALS": return `    cy.get(${selector}).should('have.length', ${jsNumber(assertion.count, "count")});`;
    case "ASSERT_COUNT_AT_LEAST": return `    cy.get(${selector}).should(($els) => { expect($els.length).to.be.at.least(${jsNumber(assertion.count, "count")}); });`;
    case "ASSERT_COUNT_AT_MOST": return `    cy.get(${selector}).should(($els) => { expect($els.length).to.be.at.most(${jsNumber(assertion.count, "count")}); });`;

    case "ASSERT_URL_EQUALS": return `    cy.url().should('eq', ${jsString(assertion.url)});`;
    case "ASSERT_URL_INCLUDES": return `    cy.url().should('include', ${jsString(assertion.fragment ?? assertion.path)});`;
    case "ASSERT_URL_NOT_INCLUDES": return `    cy.url().should('not.include', ${jsString(assertion.fragment ?? assertion.path)});`;
    case "ASSERT_URL_CONTAINS": return `    cy.url().should('include', ${jsString(assertion.fragment)});`;
    case "ASSERT_PATH_EQUALS": return `    cy.location('pathname').should('eq', ${jsString(assertion.path)});`;
    case "ASSERT_PATH_INCLUDES": return `    cy.location('pathname').should('include', ${jsString(assertion.fragment)});`;
    case "ASSERT_QUERY_INCLUDES": return `    cy.location('search').should('include', ${jsString(assertion.fragment)});`;
    case "ASSERT_QUERY_PARAM_EQUALS": return `    cy.location().should((location) => { const params = new URLSearchParams(location.search); expect(params.get(${jsString(assertion.name)})).to.eq(${jsString(assertion.value)}); });`;
    case "ASSERT_QUERY_PARAM_ABSENT": return `    cy.location().should((location) => { const params = new URLSearchParams(location.search); expect(params.has(${jsString(assertion.name)})).to.eq(false); });`;
    case "ASSERT_HASH_EQUALS": return `    cy.location('hash').should('eq', ${jsString(assertion.hash)});`;
    case "ASSERT_HASH_INCLUDES": return `    cy.location('hash').should('include', ${jsString(assertion.hash)});`;
    case "ASSERT_ORIGIN_EQUALS": return `    cy.location('origin').should('eq', ${jsString(assertion.value)});`;
    case "ASSERT_HOST_EQUALS": return `    cy.location('host').should('eq', ${jsString(assertion.value)});`;
    case "ASSERT_PROTOCOL_EQUALS": return `    cy.location('protocol').should('eq', ${jsString(assertion.value)});`;
    case "ASSERT_TITLE_EQUALS": return `    cy.title().should('eq', ${jsString(assertion.text)});`;
    case "ASSERT_TITLE_INCLUDES": return `    cy.title().should('include', ${jsString(assertion.text)});`;
    case "ASSERT_DOCUMENT_LANG_EQUALS": return `    cy.document().should((doc) => { expect(doc.documentElement.lang).to.eq(${jsString(assertion.value)}); });`;
    case "ASSERT_META_CONTENT_EQUALS": return `    cy.document().should((doc) => { const el = doc.querySelector('meta[name=' + CSS.escape(${jsString(assertion.name)}) + ']'); expect(el?.getAttribute('content') || '').to.eq(${jsString(assertion.value)}); });`;
    case "ASSERT_NO_HORIZONTAL_OVERFLOW": return `    cy.document().should((doc) => { const root = doc.documentElement; expect(root.scrollWidth).to.be.at.most(root.clientWidth + 1); });`;

    case "ASSERT_COOKIE_EXISTS": return `    cy.getCookie(${jsString(assertion.name)}).should('exist');`;
    case "ASSERT_COOKIE_EQUALS": return `    cy.getCookie(${jsString(assertion.name)}).should('have.property', 'value', ${jsString(assertion.value)});`;
    case "ASSERT_COOKIE_ABSENT": return `    cy.getCookie(${jsString(assertion.name)}).should('be.null');`;
    case "ASSERT_LOCAL_STORAGE_EXISTS": return `    cy.window().then((win) => { expect(win.localStorage.getItem(${jsString(assertion.key)})).to.not.equal(null); });`;
    case "ASSERT_LOCAL_STORAGE_EQUALS": return `    cy.window().then((win) => { expect(win.localStorage.getItem(${jsString(assertion.key)})).to.eq(${jsString(assertion.value)}); });`;
    case "ASSERT_LOCAL_STORAGE_ABSENT": return `    cy.window().then((win) => { expect(win.localStorage.getItem(${jsString(assertion.key)})).to.equal(null); });`;
    case "ASSERT_SESSION_STORAGE_EXISTS": return `    cy.window().then((win) => { expect(win.sessionStorage.getItem(${jsString(assertion.key)})).to.not.equal(null); });`;
    case "ASSERT_SESSION_STORAGE_EQUALS": return `    cy.window().then((win) => { expect(win.sessionStorage.getItem(${jsString(assertion.key)})).to.eq(${jsString(assertion.value)}); });`;
    case "ASSERT_SESSION_STORAGE_ABSENT": return `    cy.window().then((win) => { expect(win.sessionStorage.getItem(${jsString(assertion.key)})).to.equal(null); });`;

    case "ASSERT_REQUEST_SENT": {
      const filter = networkFilterExpression(assertion);
      return `    cy.wrap(null).should(() => { const matches = __network.filter((item) => ${filter}); expect(matches.length).to.be.greaterThan(0); });`;
    }
    case "ASSERT_REQUEST_COUNT_EQUALS": {
      const filter = networkFilterExpression(assertion);
      return `    cy.wrap(null).should(() => { const matches = __network.filter((item) => ${filter}); expect(matches.length).to.eq(${jsNumber(assertion.count, "request count")}); });`;
    }
    case "ASSERT_REQUEST_BODY_CONTAINS": {
      const filter = networkFilterExpression(assertion);
      return `    cy.wrap(null).should(() => { const matches = __network.filter((item) => ${filter}); expect(matches.length).to.be.greaterThan(0); expect(JSON.stringify(matches[matches.length - 1].requestBody ?? '')).to.include(${jsString(assertion.value)}); });`;
    }
    case "ASSERT_REQUEST_HEADER_EQUALS": {
      const filter = networkFilterExpression(assertion);
      return `    cy.wrap(null).should(() => { const matches = __network.filter((item) => ${filter}); expect(matches.length).to.be.greaterThan(0); const headers = matches[matches.length - 1].requestHeaders || {}; const key = Object.keys(headers).find((k) => k.toLowerCase() === ${jsString(String(assertion.name).toLowerCase())}); expect(String(key ? headers[key] : '')).to.eq(${jsString(assertion.value)}); });`;
    }
    case "ASSERT_RESPONSE_STATUS": {
      const filter = networkFilterExpression(assertion);
      return `    cy.wrap(null).should(() => { const matches = __network.filter((item) => ${filter} && item.response); expect(matches.length).to.be.greaterThan(0); expect(matches[matches.length - 1].response.statusCode).to.eq(${jsNumber(assertion.status, "response status")}); });`;
    }
    case "ASSERT_RESPONSE_BODY_CONTAINS": {
      const filter = networkFilterExpression(assertion);
      return `    cy.wrap(null).should(() => { const matches = __network.filter((item) => ${filter} && item.response); expect(matches.length).to.be.greaterThan(0); expect(JSON.stringify(matches[matches.length - 1].response.body ?? '')).to.include(${jsString(assertion.value)}); });`;
    }
    case "ASSERT_RESPONSE_HEADER_EQUALS": {
      const filter = networkFilterExpression(assertion);
      return `    cy.wrap(null).should(() => { const matches = __network.filter((item) => ${filter} && item.response); expect(matches.length).to.be.greaterThan(0); const headers = matches[matches.length - 1].response.headers || {}; const key = Object.keys(headers).find((k) => k.toLowerCase() === ${jsString(String(assertion.name).toLowerCase())}); expect(String(key ? headers[key] : '')).to.eq(${jsString(assertion.value)}); });`;
    }

    case "ASSERT_NO_ACCESSIBILITY_VIOLATIONS": return assertion.selector ? `    cy.injectAxe();\n    cy.checkA11y(${selector});` : "    cy.injectAxe();\n    cy.checkA11y();";

    case "ASSERT_FILE_EXISTS": return `    cy.readFile(Cypress.config('downloadsFolder') + '/' + ${jsString(assertion.fileName)}, null, { timeout: 10000 }).should('exist');`;
    case "ASSERT_FILE_CONTENT_CONTAINS": return `    cy.readFile(Cypress.config('downloadsFolder') + '/' + ${jsString(assertion.fileName)}, 'utf8', { timeout: 10000 }).should('include', ${jsString(assertion.value)});`;
    case "ASSERT_FILE_SIZE_AT_LEAST": return `    cy.readFile(Cypress.config('downloadsFolder') + '/' + ${jsString(assertion.fileName)}, null, { timeout: 10000 }).should((buffer) => { expect(buffer.length).to.be.at.least(${jsNumber(assertion.bytes, "file bytes")}); });`;

    case "ASSERT_NO_CONSOLE_ERRORS": return "    cy.wrap(null).should(() => { expect(__consoleErrors, __consoleErrors.join(' | ')).to.have.length(0); });";
    case "ASSERT_NO_UNCAUGHT_ERRORS": return "    cy.wrap(null).should(() => { expect(__uncaughtErrors, __uncaughtErrors.join(' | ')).to.have.length(0); });";
    case "ASSERT_NO_UNHANDLED_REJECTIONS": return "    cy.wrap(null).should(() => { expect(__unhandledRejections, __unhandledRejections.join(' | ')).to.have.length(0); });";
    case "ASSERT_WINDOW_OPEN_CALLED": return "    cy.wrap(null).should(() => { expect(__openedWindows.length).to.be.greaterThan(0); });";
    case "ASSERT_WINDOW_OPEN_NOT_CALLED": return "    cy.wrap(null).should(() => { expect(__openedWindows.length).to.eq(0); });";
    case "ASSERT_WINDOW_OPEN_URL_INCLUDES": return `    cy.wrap(null).should(() => { expect(__openedWindows.some((url) => url.includes(${jsString(assertion.fragment)}))).to.eq(true); });`;
    case "ASSERT_WINDOW_OPEN_COUNT_EQUALS": return `    cy.wrap(null).should(() => { expect(__openedWindows.length).to.eq(${jsNumber(assertion.count, "window.open count")}); });`;

    case "ASSERT_PAGE_LOAD_AT_MOST": return `    cy.window().should((win) => { const nav = win.performance.getEntriesByType('navigation')[0]; expect(nav && nav.duration).to.be.at.most(${jsNumber(assertion.milliseconds, "milliseconds")}); });`;
    case "ASSERT_DOM_CONTENT_LOADED_AT_MOST": return `    cy.window().should((win) => { const nav = win.performance.getEntriesByType('navigation')[0]; expect(nav && (nav.domContentLoadedEventEnd - nav.startTime)).to.be.at.most(${jsNumber(assertion.milliseconds, "milliseconds")}); });`;
    case "ASSERT_RESOURCE_COUNT_AT_MOST": return `    cy.window().should((win) => { expect(win.performance.getEntriesByType('resource').length).to.be.at.most(${jsNumber(assertion.count, "resource count")}); });`;
    case "ASSERT_VIEWPORT_WIDTH_EQUALS": return `    cy.window().should((win) => { expect(win.innerWidth).to.eq(${jsNumber(assertion.pixels, "viewport width")}); });`;
    case "ASSERT_VIEWPORT_HEIGHT_EQUALS": return `    cy.window().should((win) => { expect(win.innerHeight).to.eq(${jsNumber(assertion.pixels, "viewport height")}); });`;

    default: throw new Error(`Unsupported deterministic assertion: ${assertion.operation}`);
  }
}

function observerSetup(plan) {
  const operations = new Set((plan.assertions || []).map((item) => item.operation));
  const lines = [];
  if ([...operations].some((op) => op.startsWith("ASSERT_REQUEST_") || op.startsWith("ASSERT_RESPONSE_"))) {
    lines.push(
      "    const __network = [];",
      "    cy.intercept({ url: '**' }, (req) => {",
      "      const observed = { method: String(req.method || '').toUpperCase(), url: String(req.url || ''), requestHeaders: req.headers || {}, requestBody: req.body, response: null };",
      "      __network.push(observed);",
      "      req.continue((res) => { observed.response = { statusCode: res.statusCode, headers: res.headers || {}, body: res.body }; });",
      "    });"
    );
  }
  if (operations.has("ASSERT_NO_CONSOLE_ERRORS") || operations.has("ASSERT_NO_UNCAUGHT_ERRORS") || operations.has("ASSERT_NO_UNHANDLED_REJECTIONS")) {
    lines.push(
      "    const __consoleErrors = [];",
      "    const __uncaughtErrors = [];",
      "    const __unhandledRejections = [];",
      "    cy.on('window:before:load', (win) => {",
      "      const originalError = typeof win.console?.error === 'function' ? win.console.error.bind(win.console) : null;",
      "      if (win.console) win.console.error = (...args) => { __consoleErrors.push(args.map((v) => String(v)).join(' ')); if (originalError) originalError(...args); };",
      "      win.addEventListener('error', (event) => { __uncaughtErrors.push(String(event.message || event.error || 'window error')); });",
      "      win.addEventListener('unhandledrejection', (event) => { __unhandledRejections.push(String(event.reason || 'unhandled rejection')); });",
      "    });"
    );
  }
  if (["ASSERT_WINDOW_OPEN_CALLED", "ASSERT_WINDOW_OPEN_NOT_CALLED", "ASSERT_WINDOW_OPEN_URL_INCLUDES", "ASSERT_WINDOW_OPEN_COUNT_EQUALS"].some((op) => operations.has(op))) {
    lines.push(
      "    const __openedWindows = [];",
      "    cy.on('window:before:load', (win) => {",
      "      win.open = (url) => { __openedWindows.push(String(url ?? '')); return null; };",
      "    });"
    );
  }
  return lines;
}

function generateDeterministicAutomation(approvedTestCases = []) {
  if (!approvedTestCases.length) throw new Error("No approved test cases were supplied for deterministic generation.");
  const lines = ["describe('AI TestPilot Approved Test Suite', () => {"];
  for (const testCase of approvedTestCases) {
    const plan = testCase?.automationReadiness?.automationPlan;
    if (!plan) throw new Error(`${testCase.id} has no compiled automation plan.`);
    lines.push(`  it(${jsString(`${testCase.id} - ${testCase.title}`)}, () => {`);
    const setup = observerSetup(plan);
    if (setup.length) lines.push(...setup, "");
    for (const action of plan.actions || []) lines.push(emitAction(action));
    lines.push("");
    for (const assertion of plan.assertions || []) lines.push(emitAssertion(assertion));
    lines.push("  });", "");
  }
  lines.push("});", "");
  return { fileName: "ai-generated.cy.js", framework: "browser-automation", language: "javascript", generationMode: "deterministic-dsl-v3", script: lines.join("\n") };
}

module.exports = { generateDeterministicAutomation, emitAssertion, emitAction, observerSetup };
