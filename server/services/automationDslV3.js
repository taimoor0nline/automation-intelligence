const {
  ASSERTION_OPERATIONS,
  ASSERTION_OPERATION_SET,
  capabilitySuggestionFor,
} = require("./assertionRegistry");

const ACTION_OPERATIONS = [
  "LOGIN_VALID",
  "NAVIGATE",
  "RELOAD",
  "GO_BACK",
  "GO_FORWARD",
  "SET_VIEWPORT",
  "TYPE",
  "CLEAR",
  "CLICK",
  "DBLCLICK",
  "RIGHTCLICK",
  "HOVER",
  "FOCUS",
  "BLUR",
  "SELECT",
  "CHECK",
  "UNCHECK",
  "SUBMIT",
  "SCROLL_INTO_VIEW",
  "PRESS_KEY",
];

const SUPPORTED_OPERATIONS = new Set([...ACTION_OPERATIONS, ...ASSERTION_OPERATIONS]);

function selectorFor(item) {
  if (!item) return "";
  if (item.selector) return String(item.selector);
  if (item.testId) return `[data-testid="${item.testId}"]`;
  if (item.id) return `#${item.id}`;
  if (item.name) return `[name="${item.name}"]`;
  return "";
}

function pathForPage(page) {
  try {
    const url = new URL(page?.finalUrl || page?.url || "http://local/");
    return `${url.pathname}${url.search}` || "/";
  } catch {
    return "/";
  }
}

function buildDiscoveryIndex(pageDiscoveries = []) {
  const selectors = new Map();
  const selectorPaths = new Map();
  const paths = new Set();
  for (const page of pageDiscoveries || []) {
    const pagePath = pathForPage(page);
    paths.add(pagePath);
    const register = (item) => {
      const selector = selectorFor(item);
      if (!selector) return;
      selectors.set(selector, item);
      selectorPaths.set(selector, pagePath);
    };
    for (const item of page?.elements || []) {
      register(item);
      if (item?.errorElement) register(item.errorElement);
    }
    for (const message of page?.messages || []) register(message);
  }
  return { selectors, selectorPaths, paths };
}

function findSelector(text) {
  const source = String(text || "");
  const literal = source.match(/\[data-testid=(?:"[^"]+"|'[^']+')\]|#[A-Za-z0-9_-]+|\[name=(?:"[^"]+"|'[^']+')\]/)?.[0];
  if (literal) return literal.replace(/\[data-testid='([^']+)'\]/, '[data-testid="$1"]').replace(/\[name='([^']+)'\]/, '[name="$1"]');
  const testId = source.match(/(?:data-testid|data testid|test id)\s*(?:=|is|of|named|called|:)?\s*["']([^"']+)["']/i)?.[1];
  if (testId) return `[data-testid="${testId}"]`;
  const name = source.match(/(?:name attribute|name)\s*(?:=|is|of|named|called|:)?\s*["']([^"']+)["']/i)?.[1];
  if (name) return `[name="${name}"]`;
  const id = source.match(/(?:element\s+)?id\s*(?:=|is|of|named|called|:)?\s*["']([A-Za-z0-9_-]+)["']/i)?.[1];
  if (id) return `#${id}`;
  return "";
}

function looksLikeSelector(value) {
  const text = String(value || "").trim();
  return text.startsWith("[") || text.startsWith("#") || text.startsWith(".");
}

function normalizePath(value) {
  const text = String(value || "").trim();
  if (text.startsWith("/")) return text;
  try {
    const url = new URL(text);
    return `${url.pathname}${url.search}` || "/";
  } catch {
    return "";
  }
}

function quotedValues(text) {
  const values = [];
  const source = String(text || "");
  const regex = /["'`]([^"'`]+)["'`]/g;
  let match;
  while ((match = regex.exec(source)) !== null) values.push(match[1]);
  return values;
}

function lastQuotedValue(text) {
  const values = quotedValues(text);
  return values.length ? values[values.length - 1] : "";
}

function numberFrom(text) {
  const match = String(text || "").match(/\b(\d{1,9}(?:\.\d+)?)\b/);
  return match ? Number(match[1]) : null;
}

function namedToken(text, keywords) {
  const source = String(text || "");
  const group = keywords.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const match = source.match(new RegExp(`(?:${group})\\s*(?:named|called|is|=|:)?\\s*["'\`]([^"'\`]+)["'\`]`, "i"));
  return match?.[1] || "";
}

function millisecondsFrom(text) {
  const source = String(text || "");
  const ms = source.match(/\b(\d+(?:\.\d+)?)\s*(?:ms|milliseconds?)\b/i);
  if (ms) return Number(ms[1]);
  const seconds = source.match(/\b(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds?)\b/i);
  return seconds ? Number(seconds[1]) * 1000 : null;
}

function safeFileName(text) {
  const quoted = quotedValues(text).find((value) => /^[A-Za-z0-9._ -]+\.[A-Za-z0-9]{1,8}$/.test(value));
  const plain = String(text || "").match(/\b[A-Za-z0-9][A-Za-z0-9._ -]*\.(?:txt|csv|json|xml|pdf|png|jpe?g|webp|zip|xlsx?|docx?)\b/i)?.[0];
  const name = quoted || plain || "";
  if (!name || name.includes("..") || /[\\/]/.test(name)) return "";
  return name;
}

function isConfiguredCredentialStep(action) {
  return /configured test (?:username|password)|runtime credentials|valid credentials/i.test(action);
}

function requiresValidLogin(testCase) {
  return (testCase?.preconditions || []).some((x) => /valid test credentials|configured test credentials|runtime credentials/i.test(String(x))) ||
    (testCase?.steps || []).some((s) => isConfiguredCredentialStep(String(s?.action || "")));
}

function materializeDescribedValue(value, element) {
  const text = String(value || "");
  const match = text.match(/(?:a\s+)?string\s+of\s+(?:exactly\s+)?(\d{1,5})\s+['"](.{1})['"]\s+characters?/i);
  if (!match) return value;
  const count = Number(match[1]);
  const char = match[2];
  const discoveredMax = Number(element?.maxlength);
  if (!Number.isFinite(count) || !Number.isFinite(discoveredMax)) return value;
  if (![discoveredMax, discoveredMax + 1].includes(count)) return value;
  if (count < 1 || count > 10000) return value;
  return char.repeat(count);
}

function compileStep(step, discovery, state) {
  const actionRaw = String(step?.action || "").trim();
  const action = actionRaw.toLowerCase();
  const target = String(step?.target || "").trim();
  let value = step?.value === null || step?.value === undefined ? null : String(step.value);

  if (isConfiguredCredentialStep(action) || (/click|submit/.test(action) && /sign\s*in|log\s*in|login/i.test(actionRaw) && state.validLoginRequired)) {
    if (!state.loginInserted) {
      state.loginInserted = true;
      return { operation: "LOGIN_VALID" };
    }
    return null;
  }

  if (/navigate|open page|visit|continue to/.test(action)) {
    const path = normalizePath(value || target);
    if (!path) return { error: `Navigation step does not contain a usable path: ${actionRaw}` };
    if (!discovery.paths.has(path) && !discovery.paths.has(path.split("?")[0])) return { error: `Navigation path is not grounded by discovery: ${path}` };
    return { operation: "NAVIGATE", path };
  }
  if (/reload|refresh/.test(action)) return { operation: "RELOAD" };
  if (/go back|navigate back|browser back/.test(action)) return { operation: "GO_BACK" };
  if (/go forward|navigate forward|browser forward/.test(action)) return { operation: "GO_FORWARD" };
  if (/set .*viewport|viewport.*\d+\s*[x×]\s*\d+|resize browser/.test(action)) {
    const dims = `${value || ""} ${target || ""} ${actionRaw}`.match(/(\d{2,5})\s*[x×]\s*(\d{2,5})/i);
    if (!dims) return { error: `Viewport step requires width x height: ${actionRaw}` };
    return { operation: "SET_VIEWPORT", width: Number(dims[1]), height: Number(dims[2]) };
  }

  if (!target || !looksLikeSelector(target)) return { error: `Step is not expressed with a grounded executable target: ${actionRaw}` };
  const element = discovery.selectors.get(target);
  if (!element) return { error: `Selector is not grounded by discovery: ${target}` };
  const type = String(element?.type || "").toLowerCase();
  const tag = String(element?.tag || "").toLowerCase();

  if (/leave .*blank|clear|empty/.test(action)) return { operation: "CLEAR", selector: target };
  if (/enter|type|fill|input/.test(action)) {
    if ((value === null || value === "") && /white\s*space|spaces?[- ]only|blank spaces?/i.test(actionRaw)) value = " ";
    value = materializeDescribedValue(value, element);
    if (value === null || value === "") return { error: `Typing step is missing a value for ${target}` };
    return { operation: "TYPE", selector: target, value };
  }
  if (/uncheck|deselect/.test(action) && (type === "checkbox" || type === "radio")) return { operation: "UNCHECK", selector: target };
  if (/check|consent|select at least one|choose/.test(action) && type === "checkbox") return { operation: "CHECK", selector: target };
  if (/select/.test(action) && tag === "select") {
    if (value === null || value === "") return { error: `Select step is missing an option value for ${target}` };
    return { operation: "SELECT", selector: target, value };
  }
  if (/double\s*click|dblclick/.test(action)) return { operation: "DBLCLICK", selector: target };
  if (/right\s*click|context menu/.test(action)) return { operation: "RIGHTCLICK", selector: target };
  if (/hover|mouse over|mouseover/.test(action)) return { operation: "HOVER", selector: target };
  if (/scroll .*into view|scroll to element/.test(action)) return { operation: "SCROLL_INTO_VIEW", selector: target };
  if (/\bfocus\b/.test(action)) return { operation: "FOCUS", selector: target };
  if (/\bblur\b|remove focus/.test(action)) return { operation: "BLUR", selector: target };
  if (/press|key(?:board)?/.test(action)) {
    const key = String(value || actionRaw.match(/\b(?:press|key)\s+["']?([A-Za-z]+)["']?/i)?.[1] || "").toLowerCase();
    const allowed = new Set(["enter", "esc", "escape", "uparrow", "downarrow", "leftarrow", "rightarrow", "home", "end", "backspace", "del", "delete"]);
    if (!allowed.has(key)) return { error: `Unsupported deterministic key '${key || "unknown"}' for ${target}` };
    return { operation: "PRESS_KEY", selector: target, key };
  }
  if (/submit form|\bsubmit\b/.test(action) && tag === "form") return { operation: "SUBMIT", selector: target };
  if (/select|click|choose|submit|press|sign\s*in|log\s*in|login/.test(action)) return { operation: "CLICK", selector: target };
  return { error: `Unsupported or ambiguous automation action: ${actionRaw}` };
}

function dedupeAssertions(assertions) {
  const seen = new Set();
  return (assertions || []).filter((assertion) => {
    if (!ASSERTION_OPERATION_SET.has(assertion.operation)) return false;
    const key = JSON.stringify(assertion);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compileSelectorAssertions(text, selector, discovery) {
  const lower = String(text).toLowerCase();
  const assertions = [];
  if (!discovery.selectors.has(selector)) return { error: `Expected-result selector is not grounded by discovery: ${selector}` };
  const element = discovery.selectors.get(selector) || {};
  const quoted = quotedValues(text).filter((value) => value !== selector);
  const expected = quoted.length ? quoted[quoted.length - 1] : "";
  const number = numberFrom(text);

  if (/hidden\s+or\s+absent|absent\s+or\s+hidden|remains?\s+absent|not\s+present\s+or\s+hidden/.test(lower)) assertions.push({ operation: "ASSERT_HIDDEN_OR_ABSENT", selector });
  else if (/does not exist|doesn't exist|not exist|is absent|is removed|not present/.test(lower)) assertions.push({ operation: "ASSERT_NOT_EXISTS", selector });
  else if (/hidden|not visible|invisible/.test(lower)) assertions.push({ operation: "ASSERT_HIDDEN", selector });
  else if (/visible|shown|displayed|appears/.test(lower)) assertions.push({ operation: "ASSERT_VISIBLE", selector });
  else if (/exists?|present in (?:the )?dom/.test(lower)) assertions.push({ operation: "ASSERT_EXISTS", selector });

  if (/not checked|unchecked|unselected checkbox|unselected radio/.test(lower)) assertions.push({ operation: "ASSERT_UNCHECKED", selector });
  else if (/\bchecked\b/.test(lower)) assertions.push({ operation: "ASSERT_CHECKED", selector });
  if (/\bdisabled\b/.test(lower)) assertions.push({ operation: "ASSERT_DISABLED", selector });
  else if (/\benabled\b/.test(lower)) assertions.push({ operation: "ASSERT_ENABLED", selector });
  if (/\bfocused\b|has focus/.test(lower)) assertions.push({ operation: "ASSERT_FOCUSED", selector });
  if (/not read.?only|editable/.test(lower)) assertions.push({ operation: "ASSERT_NOT_READONLY", selector });
  else if (/read.?only/.test(lower)) assertions.push({ operation: "ASSERT_READONLY", selector });
  if (/\bnot required\b|\boptional\b/.test(lower)) assertions.push({ operation: "ASSERT_OPTIONAL", selector });
  else if (/\brequired\b/.test(lower)) assertions.push({ operation: "ASSERT_REQUIRED", selector });
  if (/\binvalid\b|fails? browser validation|validation state is invalid/.test(lower)) assertions.push({ operation: "ASSERT_INVALID", selector });
  else if (/\bvalid\b|passes? browser validation|validation state is valid/.test(lower)) assertions.push({ operation: "ASSERT_VALID", selector });

  if (/text\s+(?:is|equals?|exactly)\s+["'`]/.test(lower) && expected) assertions.push({ operation: "ASSERT_TEXT_EQUALS", selector, text: expected });
  else if (/text\s+(?:contains?|includes?)\s+["'`]|contains?\s+(?:the\s+)?text\s+["'`]/.test(lower) && expected) assertions.push({ operation: "ASSERT_TEXT_CONTAINS", selector, text: expected });
  else if (/text\s+(?:does not|doesn't|must not)\s+(?:contain|include)|does not contain text|doesn't contain text/.test(lower) && expected) assertions.push({ operation: "ASSERT_TEXT_NOT_CONTAINS", selector, text: expected });
  if (/text\s+(?:is\s+)?(?:non-empty|not empty)|non-empty\s+(?:text|message)|not empty\s+(?:text|message)|message.*non-empty|(?:non-empty|not empty)(?!.*value)/.test(lower)) assertions.push({ operation: "ASSERT_TEXT_NOT_EMPTY", selector });
  else if (/text\s+(?:is\s+)?empty|empty text/.test(lower)) assertions.push({ operation: "ASSERT_TEXT_EMPTY", selector });
  if (/html\s+(?:is|equals?|exactly)\s+["'`]/.test(lower) && expected) assertions.push({ operation: "ASSERT_HTML_EQUALS", selector, html: expected });
  else if (/html\s+(?:contains?|includes?)\s+["'`]/.test(lower) && expected) assertions.push({ operation: "ASSERT_HTML_CONTAINS", selector, html: expected });

  if (/value\s+(?:is|equals?|exactly)\s+["'`]/.test(lower) && expected) assertions.push({ operation: "ASSERT_VALUE_EQUALS", selector, value: expected });
  else if (/value\s+(?:contains?|includes?)\s+["'`]/.test(lower) && expected) assertions.push({ operation: "ASSERT_VALUE_CONTAINS", selector, value: expected });
  if (/value\s+(?:is\s+)?(?:non-empty|not empty)|non-empty\s+value|not empty\s+value/.test(lower)) assertions.push({ operation: "ASSERT_VALUE_NOT_EMPTY", selector });
  else if (/value\s+(?:is\s+)?empty|empty value/.test(lower)) assertions.push({ operation: "ASSERT_VALUE_EMPTY", selector });

  const length = Number(String(text).match(/\b(\d{1,6})\s*(?:characters?|chars?)\b/i)?.[1]);
  if (Number.isFinite(length)) {
    if (/at most|maximum|max length|no more than|does not exceed|truncated/.test(lower)) assertions.push({ operation: "ASSERT_VALUE_LENGTH_AT_MOST", selector, length });
    else if (/at least|minimum|min length|no fewer than/.test(lower)) assertions.push({ operation: "ASSERT_VALUE_LENGTH_AT_LEAST", selector, length });
    else if (/exactly|length equals|full .* length|boundary/.test(lower)) assertions.push({ operation: "ASSERT_VALUE_LENGTH_EQUALS", selector, length });
  }

  if (/selected\s+(?:value|option).*?["'`]|(?:value|option).*?["'`].*selected/.test(lower) && expected) assertions.push({ operation: "ASSERT_SELECTED_VALUE_EQUALS", selector, value: expected });
  const selectedText = text.match(/selected\s+(?:option\s+)?text\s+(?:is|equals?|exactly)\s+["'`]([^"'`]+)["'`]/i)?.[1];
  if (selectedText) assertions.push({ operation: "ASSERT_SELECTED_TEXT_EQUALS", selector, text: selectedText });
  const optionCount = text.match(/(?:has|contains?)\s+(?:exactly\s+)?(\d+)\s+options?\b/i)?.[1];
  if (optionCount) assertions.push({ operation: "ASSERT_OPTION_COUNT_EQUALS", selector, count: Number(optionCount) });

  if (/placeholder\s+(?:is|equals?|exactly)\s+["'`]/.test(lower) && expected) assertions.push({ operation: "ASSERT_PLACEHOLDER_EQUALS", selector, value: expected });
  const inputType = text.match(/(?:input\s+)?type\s+(?:is|equals?|exactly)\s+["'`]([^"'`]+)["'`]/i)?.[1];
  if (inputType) assertions.push({ operation: "ASSERT_INPUT_TYPE_EQUALS", selector, value: inputType });
  for (const [pattern, operation, key] of [
    [/\bmin(?:imum)?\s+(?:is|equals?|exactly)\s+["'`]([^"'`]+)["'`]/i, "ASSERT_MIN_EQUALS", "value"],
    [/\bmax(?:imum)?\s+(?:is|equals?|exactly)\s+["'`]([^"'`]+)["'`]/i, "ASSERT_MAX_EQUALS", "value"],
    [/\bminlength\s+(?:is|equals?|exactly)\s+(\d+)/i, "ASSERT_MINLENGTH_EQUALS", "value"],
    [/\bmaxlength\s+(?:is|equals?|exactly)\s+(\d+)/i, "ASSERT_MAXLENGTH_EQUALS", "value"],
    [/\bpattern\s+(?:is|equals?|exactly)\s+["'`]([^"'`]+)["'`]/i, "ASSERT_PATTERN_EQUALS", "value"],
  ]) {
    const match = text.match(pattern)?.[1];
    if (match !== undefined) assertions.push({ operation, selector, [key]: String(match) });
  }

  const className = namedToken(text, ["class", "css class"]);
  if (className) assertions.push({ operation: /does not have|must not have|without/.test(lower) ? "ASSERT_CLASS_NOT_INCLUDES" : "ASSERT_CLASS_INCLUDES", selector, className });
  const ariaName = namedToken(text, ["aria attribute", "aria"]);
  if (ariaName && quoted.length >= 2) assertions.push({ operation: "ASSERT_ARIA_EQUALS", selector, name: ariaName.startsWith("aria-") ? ariaName : `aria-${ariaName}`, value: expected });
  const attrName = namedToken(text, ["attribute", "attr"]);
  if (attrName && !/^aria-/i.test(attrName)) {
    if (/does not have|not have|absent|missing/.test(lower)) assertions.push({ operation: "ASSERT_ATTR_NOT_EXISTS", selector, name: attrName });
    else if (/contains?|includes?/.test(lower) && quoted.length >= 2) assertions.push({ operation: "ASSERT_ATTR_CONTAINS", selector, name: attrName, value: expected });
    else if (quoted.length >= 2) assertions.push({ operation: "ASSERT_ATTR_EQUALS", selector, name: attrName, value: expected });
    else assertions.push({ operation: "ASSERT_ATTR_EXISTS", selector, name: attrName });
  }
  const cssName = namedToken(text, ["css property", "style property", "css"]);
  if (cssName && quoted.length >= 2) assertions.push({ operation: "ASSERT_CSS_EQUALS", selector, name: cssName, value: expected });
  const propName = namedToken(text, ["property", "prop"]);
  if (propName && quoted.length >= 2 && !/css property|style property|aria attribute/.test(lower)) assertions.push({ operation: "ASSERT_PROP_EQUALS", selector, name: propName, value: expected });

  if (/\b(count|elements?|matches?)\b/.test(lower) && Number.isFinite(number)) {
    if (/at least|minimum|no fewer than/.test(lower)) assertions.push({ operation: "ASSERT_COUNT_AT_LEAST", selector, count: number });
    else if (/at most|maximum|no more than/.test(lower)) assertions.push({ operation: "ASSERT_COUNT_AT_MOST", selector, count: number });
    else if (/exactly|count\s+(?:is|equals?)|matches?\s+\d+|\d+\s+elements?/.test(lower)) assertions.push({ operation: "ASSERT_COUNT_EQUALS", selector, count: number });
  }

  if (/not in (?:the )?viewport|outside (?:the )?viewport|offscreen/.test(lower)) assertions.push({ operation: "ASSERT_ELEMENT_NOT_IN_VIEWPORT", selector });
  else if (/in (?:the )?viewport|within (?:the )?viewport|onscreen/.test(lower)) assertions.push({ operation: "ASSERT_ELEMENT_IN_VIEWPORT", selector });
  const dimension = text.match(/\b(width|height)\s+(?:is|equals?|exactly|at least|at most|minimum|maximum)?\s*(\d+(?:\.\d+)?)\s*(?:px|pixels?)\b/i);
  if (dimension) {
    const axis = dimension[1].toUpperCase();
    const amount = Number(dimension[2]);
    const relation = /at least|minimum/.test(lower) ? "AT_LEAST" : /at most|maximum/.test(lower) ? "AT_MOST" : "EQUALS";
    assertions.push({ operation: `ASSERT_ELEMENT_${axis}_${relation}`, selector, pixels: amount });
  }
  if (/image.*loaded|loaded image|image loads successfully/.test(lower) && String(element.tag || "").toLowerCase() === "img") assertions.push({ operation: "ASSERT_IMAGE_LOADED", selector });
  if (/alt(?:ernative)? text.*(?:non-empty|not empty)|image.*alt.*(?:non-empty|not empty)/.test(lower)) assertions.push({ operation: "ASSERT_IMAGE_ALT_NOT_EMPTY", selector });

  return { assertions: dedupeAssertions(assertions) };
}

function networkRoute(text) {
  const quoted = quotedValues(text).find((value) => /^(?:https?:\/\/|\/|\*|api\b)/i.test(value));
  if (quoted) return quoted;
  return String(text || "").match(/https?:\/\/[^\s"'`]+|\/(?:api|graphql|rest)\/[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*/i)?.[0] || "";
}

function parseNetworkExpectation(text) {
  const lower = String(text).toLowerCase();
  if (!/\b(request|response|http|api|endpoint|status\s*code)\b/.test(lower)) return [];
  const url = networkRoute(text);
  if (!url) return [];
  const method = String(text).match(/\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/i)?.[1]?.toUpperCase() || null;
  const base = { urlFragment: url, ...(method ? { method } : {}) };
  const assertions = [];
  const status = String(text).match(/(?:status(?:\s*code)?|http)\s*(?:is|equals?|=|of)?\s*(\d{3})\b/i)?.[1];
  if (status && /response|status|http/.test(lower)) assertions.push({ operation: "ASSERT_RESPONSE_STATUS", ...base, status: Number(status) });
  const count = String(text).match(/(?:request|call)s?\s+(?:count\s+)?(?:is|equals?|exactly)?\s*(\d+)\b/i)?.[1];
  if (count) assertions.push({ operation: "ASSERT_REQUEST_COUNT_EQUALS", ...base, count: Number(count) });
  if (/request.*(?:is sent|was sent|occurs?|called|made)|api.*(?:called|requested)/.test(lower)) assertions.push({ operation: "ASSERT_REQUEST_SENT", ...base });
  const requestBody = String(text).match(/request\s+body\s+(?:contains?|includes?)\s+["'`]([^"'`]+)["'`]/i)?.[1];
  if (requestBody) assertions.push({ operation: "ASSERT_REQUEST_BODY_CONTAINS", ...base, value: requestBody });
  const responseBody = String(text).match(/response\s+body\s+(?:contains?|includes?)\s+["'`]([^"'`]+)["'`]/i)?.[1];
  if (responseBody) assertions.push({ operation: "ASSERT_RESPONSE_BODY_CONTAINS", ...base, value: responseBody });
  const requestHeader = String(text).match(/request\s+header\s+["'`]([^"'`]+)["'`]\s+(?:is|equals?|=)\s+["'`]([^"'`]+)["'`]/i);
  if (requestHeader) assertions.push({ operation: "ASSERT_REQUEST_HEADER_EQUALS", ...base, name: requestHeader[1], value: requestHeader[2] });
  const responseHeader = String(text).match(/response\s+header\s+["'`]([^"'`]+)["'`]\s+(?:is|equals?|=)\s+["'`]([^"'`]+)["'`]/i);
  if (responseHeader) assertions.push({ operation: "ASSERT_RESPONSE_HEADER_EQUALS", ...base, name: responseHeader[1], value: responseHeader[2] });
  return dedupeAssertions(assertions);
}

function compileExpected(expected, discovery) {
  const text = String(expected || "").trim();
  const lower = text.toLowerCase();
  const selector = findSelector(text);
  if (selector) {
    const compiled = compileSelectorAssertions(text, selector, discovery);
    if (compiled.error) return compiled;
    if (compiled.assertions?.length) return compiled;
  }

  const network = parseNetworkExpectation(text);
  if (network.length) return { assertions: network };

  if (/no accessibility violations|zero accessibility violations|passes? accessibility|axe.*no violations/.test(lower)) {
    return { assertions: [{ operation: "ASSERT_NO_ACCESSIBILITY_VIOLATIONS", ...(selector ? { selector } : {}) }] };
  }

  const fileName = safeFileName(text);
  if (fileName && /download|downloaded|file/.test(lower)) {
    const content = text.match(/(?:file|content)\s+(?:contains?|includes?)\s+["'`]([^"'`]+)["'`]/i)?.[1];
    const bytes = text.match(/(?:size|file size)\s+(?:is\s+)?(?:at least|minimum)\s+(\d+)\s*(?:bytes?|b)\b/i)?.[1];
    if (content) return { assertions: [{ operation: "ASSERT_FILE_CONTENT_CONTAINS", fileName, value: content }] };
    if (bytes) return { assertions: [{ operation: "ASSERT_FILE_SIZE_AT_LEAST", fileName, bytes: Number(bytes) }] };
    return { assertions: [{ operation: "ASSERT_FILE_EXISTS", fileName }] };
  }

  if (/no console errors?|console\.error.*(?:not|none|zero)/.test(lower)) return { assertions: [{ operation: "ASSERT_NO_CONSOLE_ERRORS" }] };
  if (/no uncaught (?:javascript |browser |window )?errors?|zero uncaught errors?/.test(lower)) return { assertions: [{ operation: "ASSERT_NO_UNCAUGHT_ERRORS" }] };
  if (/no unhandled (?:promise )?rejections?|zero unhandled rejections?/.test(lower)) return { assertions: [{ operation: "ASSERT_NO_UNHANDLED_REJECTIONS" }] };

  if (/window\.open|new (?:browser )?(?:window|tab)|popup/.test(lower)) {
    const count = text.match(/(?:window\.open|window|tab|popup).*?(?:count|called)\s*(?:is|equals?|exactly)?\s*(\d+)/i)?.[1];
    const url = quotedValues(text).find((value) => /^(?:https?:\/\/|\/)/.test(value));
    if (/not (?:called|opened)|does not open|no new/.test(lower)) return { assertions: [{ operation: "ASSERT_WINDOW_OPEN_NOT_CALLED" }] };
    if (count) return { assertions: [{ operation: "ASSERT_WINDOW_OPEN_COUNT_EQUALS", count: Number(count) }] };
    if (url) return { assertions: [{ operation: "ASSERT_WINDOW_OPEN_URL_INCLUDES", fragment: url }] };
    return { assertions: [{ operation: "ASSERT_WINDOW_OPEN_CALLED" }] };
  }

  const duration = millisecondsFrom(text);
  if (duration !== null && /(?:page|navigation).*load|load time|navigation duration/.test(lower)) return { assertions: [{ operation: "ASSERT_PAGE_LOAD_AT_MOST", milliseconds: duration }] };
  if (duration !== null && /dom\s*content\s*loaded|domcontentloaded/.test(lower)) return { assertions: [{ operation: "ASSERT_DOM_CONTENT_LOADED_AT_MOST", milliseconds: duration }] };
  const resourceCount = text.match(/(?:resource|resources).*?(?:at most|maximum|no more than)\s+(\d+)/i)?.[1];
  if (resourceCount) return { assertions: [{ operation: "ASSERT_RESOURCE_COUNT_AT_MOST", count: Number(resourceCount) }] };

  const viewportWidth = text.match(/viewport\s+width\s+(?:is|equals?|exactly)\s+(\d+)\s*(?:px|pixels?)/i)?.[1];
  if (viewportWidth) return { assertions: [{ operation: "ASSERT_VIEWPORT_WIDTH_EQUALS", pixels: Number(viewportWidth) }] };
  const viewportHeight = text.match(/viewport\s+height\s+(?:is|equals?|exactly)\s+(\d+)\s*(?:px|pixels?)/i)?.[1];
  if (viewportHeight) return { assertions: [{ operation: "ASSERT_VIEWPORT_HEIGHT_EQUALS", pixels: Number(viewportHeight) }] };
  if (/no horizontal overflow|does not horizontally overflow|no horizontal scrolling/.test(lower)) return { assertions: [{ operation: "ASSERT_NO_HORIZONTAL_OVERFLOW" }] };

  const quoted = quotedValues(text);
  const expectedValue = lastQuotedValue(text);
  const titleValue = text.match(/(?:document\s+|page\s+)?title\s+(?:is|equals?|exactly|contains?|includes?)\s+["'`]([^"'`]+)["'`]/i)?.[1];
  if (titleValue) return { assertions: [{ operation: /contains?|includes?/.test(lower) ? "ASSERT_TITLE_INCLUDES" : "ASSERT_TITLE_EQUALS", text: titleValue }] };
  const lang = text.match(/(?:document|html|page)\s+lang(?:uage)?\s+(?:is|equals?|exactly)\s+["'`]([^"'`]+)["'`]/i)?.[1];
  if (lang) return { assertions: [{ operation: "ASSERT_DOCUMENT_LANG_EQUALS", value: lang }] };
  const meta = text.match(/meta\s+(?:name\s+)?["'`]([^"'`]+)["'`]\s+content\s+(?:is|equals?|exactly)\s+["'`]([^"'`]+)["'`]/i);
  if (meta) return { assertions: [{ operation: "ASSERT_META_CONTENT_EQUALS", name: meta[1], value: meta[2] }] };

  const cookieName = namedToken(text, ["cookie"]);
  if (cookieName) {
    if (/absent|missing|does not exist|not exist|removed/.test(lower)) return { assertions: [{ operation: "ASSERT_COOKIE_ABSENT", name: cookieName }] };
    if (quoted.length >= 2 && /equals?|value|is/.test(lower)) return { assertions: [{ operation: "ASSERT_COOKIE_EQUALS", name: cookieName, value: expectedValue }] };
    return { assertions: [{ operation: "ASSERT_COOKIE_EXISTS", name: cookieName }] };
  }
  const localKey = namedToken(text, ["local storage key", "localstorage key", "local storage", "localstorage"]);
  if (localKey) {
    if (/absent|missing|does not exist|not exist|removed/.test(lower)) return { assertions: [{ operation: "ASSERT_LOCAL_STORAGE_ABSENT", key: localKey }] };
    if (quoted.length >= 2 && /equals?|value|is/.test(lower)) return { assertions: [{ operation: "ASSERT_LOCAL_STORAGE_EQUALS", key: localKey, value: expectedValue }] };
    return { assertions: [{ operation: "ASSERT_LOCAL_STORAGE_EXISTS", key: localKey }] };
  }
  const sessionKey = namedToken(text, ["session storage key", "sessionstorage key", "session storage", "sessionstorage"]);
  if (sessionKey) {
    if (/absent|missing|does not exist|not exist|removed/.test(lower)) return { assertions: [{ operation: "ASSERT_SESSION_STORAGE_ABSENT", key: sessionKey }] };
    if (quoted.length >= 2 && /equals?|value|is/.test(lower)) return { assertions: [{ operation: "ASSERT_SESSION_STORAGE_EQUALS", key: sessionKey, value: expectedValue }] };
    return { assertions: [{ operation: "ASSERT_SESSION_STORAGE_EXISTS", key: sessionKey }] };
  }

  const queryParam = text.match(/query\s+(?:parameter|param)\s+["'`]([^"'`]+)["'`]/i)?.[1];
  if (queryParam) {
    if (/absent|missing|does not exist|not present/.test(lower)) return { assertions: [{ operation: "ASSERT_QUERY_PARAM_ABSENT", name: queryParam }] };
    const value = quotedValues(text).filter((item) => item !== queryParam).pop();
    if (value) return { assertions: [{ operation: "ASSERT_QUERY_PARAM_EQUALS", name: queryParam, value }] };
  }
  const queryFragment = text.match(/(?:url|query parameter|query string)[^'"`]*['"`]([^'"`=]+=[^'"`]+)['"`]/i)?.[1];
  if (queryFragment && /contain|contains|includes|include/.test(lower)) return { assertions: [{ operation: "ASSERT_QUERY_INCLUDES", fragment: queryFragment }] };

  const origin = text.match(/origin\s+(?:is|equals?|exactly)\s+["'`]([^"'`]+)["'`]/i)?.[1];
  if (origin) return { assertions: [{ operation: "ASSERT_ORIGIN_EQUALS", value: origin }] };
  const host = text.match(/host(?:name)?\s+(?:is|equals?|exactly)\s+["'`]([^"'`]+)["'`]/i)?.[1];
  if (host) return { assertions: [{ operation: "ASSERT_HOST_EQUALS", value: host }] };
  const protocol = text.match(/protocol\s+(?:is|equals?|exactly)\s+["'`]([^"'`]+)["'`]/i)?.[1];
  if (protocol) return { assertions: [{ operation: "ASSERT_PROTOCOL_EQUALS", value: protocol.endsWith(":") ? protocol : `${protocol}:` }] };

  const fullUrl = text.match(/https?:\/\/[^\s"'`]+/i)?.[0] || "";
  if (fullUrl && /url/.test(lower)) {
    if (/not contain|not include|does not contain|does not include/.test(lower)) return { assertions: [{ operation: "ASSERT_URL_NOT_INCLUDES", fragment: fullUrl }] };
    if (/equal|exactly|is the url|url is/.test(lower)) return { assertions: [{ operation: "ASSERT_URL_EQUALS", url: fullUrl }] };
    return { assertions: [{ operation: "ASSERT_URL_INCLUDES", fragment: fullUrl }] };
  }
  const pathMatch = text.match(/\/(?:[A-Za-z0-9._~!$&'()*+,;=:@%-]+\/?)+(?:\?[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*)?/);
  const path = pathMatch?.[0] || "";
  if (path) {
    const pathname = path.split("?")[0] || "/";
    if (/not taken|not navigate|does not navigate|not include|does not include/.test(lower)) return { assertions: [{ operation: "ASSERT_URL_NOT_INCLUDES", fragment: path }] };
    if (/path.*(?:equal|exact)|pathname.*(?:equal|exact)|remain|stays? on/.test(lower)) return { assertions: [{ operation: "ASSERT_PATH_EQUALS", path: pathname }] };
    if (/path.*(?:contain|include)|pathname.*(?:contain|include)/.test(lower)) return { assertions: [{ operation: "ASSERT_PATH_INCLUDES", fragment: pathname }] };
    if (discovery.paths.has(path) || discovery.paths.has(pathname)) return { assertions: [{ operation: "ASSERT_URL_INCLUDES", fragment: path }] };
  }
  const hashValue = text.match(/(?:hash|fragment)\s+(?:is|equals?|exactly|contains?|includes?)\s+["'`]([^"'`]+)["'`]/i)?.[1];
  if (hashValue) return { assertions: [{ operation: /contains?|includes?/.test(lower) ? "ASSERT_HASH_INCLUDES" : "ASSERT_HASH_EQUALS", hash: hashValue }] };

  return { narrative: text, capabilitySuggestion: capabilitySuggestionFor(text) };
}

function ensureGroundedStartPage(actions, discovery) {
  if (!actions.length) return actions;
  if (["NAVIGATE", "LOGIN_VALID", "SET_VIEWPORT"].includes(actions[0].operation)) return actions;
  const firstSelectorAction = actions.find((action) => action.selector && discovery.selectorPaths.has(action.selector));
  if (!firstSelectorAction) return actions;
  const path = discovery.selectorPaths.get(firstSelectorAction.selector);
  if (!path || !discovery.paths.has(path)) return actions;
  return [{ operation: "NAVIGATE", path }, ...actions];
}

function addDeterministicFallbackAssertions(actions, assertions, narratives, discovery) {
  const primarySelector = actions.find((action) => action.operation === "TYPE" || action.operation === "CLEAR")?.selector || "";
  const element = primarySelector ? discovery.selectors.get(primarySelector) : null;
  const ownerPath = primarySelector ? discovery.selectorPaths.get(primarySelector) : null;
  for (const text of narratives) {
    const lower = String(text).toLowerCase();
    const quotedQuery = String(text).match(/['"`]([^'"`=]+=[^'"`]+)['"`]/)?.[1];
    if (quotedQuery && /url|query parameter|query string/.test(lower) && /contain|include/.test(lower)) {
      assertions.push({ operation: "ASSERT_QUERY_INCLUDES", fragment: quotedQuery });
      continue;
    }
    if (ownerPath && /remain|stays|not submitted|no search results page|homepage/.test(lower)) {
      assertions.push({ operation: "ASSERT_PATH_EQUALS", path: ownerPath.split("?")[0] || "/" });
      continue;
    }
    const length = Number(String(text).match(/\b(\d{2,6})\s*(?:characters?|chars?)\b/i)?.[1]);
    if (primarySelector && Number.isFinite(length) && /accepts? up to|does not accept more than|maximum|max length|truncated|boundary/.test(lower)) {
      const discoveredMax = Number(element?.maxlength);
      if (!Number.isFinite(discoveredMax) || discoveredMax !== length) continue;
      assertions.push({ operation: /exactly|full query/.test(lower) ? "ASSERT_VALUE_LENGTH_EQUALS" : "ASSERT_VALUE_LENGTH_AT_MOST", selector: primarySelector, length });
    }
  }
}

function compileTestCase(testCase, { pageDiscoveries = [], hasCredentials = false } = {}) {
  const discovery = buildDiscoveryIndex(pageDiscoveries);
  const validLoginRequired = requiresValidLogin(testCase);
  if (validLoginRequired && !hasCredentials) return { ok: false, reasonCode: "MISSING_CREDENTIALS", reason: "Valid runtime credentials are required before this test can compile into the automation contract." };

  const state = { validLoginRequired, loginInserted: false };
  let actions = [];
  const errors = [];
  for (const step of testCase?.steps || []) {
    const compiled = compileStep(step, discovery, state);
    if (!compiled) continue;
    if (compiled.error) errors.push(compiled.error);
    else actions.push(compiled);
  }
  if (validLoginRequired && !state.loginInserted) actions.unshift({ operation: "LOGIN_VALID" });
  actions = ensureGroundedStartPage(actions, discovery);

  let assertions = [];
  const narratives = [];
  const assertionSuggestions = [];
  for (const expected of testCase?.expectedResults || []) {
    const compiled = compileExpected(expected, discovery);
    if (compiled.error) errors.push(compiled.error);
    else if (compiled.assertions?.length) assertions.push(...compiled.assertions);
    else if (compiled.narrative) {
      narratives.push(compiled.narrative);
      if (compiled.capabilitySuggestion) assertionSuggestions.push({ expectation: compiled.narrative, ...compiled.capabilitySuggestion });
    }
  }
  addDeterministicFallbackAssertions(actions, assertions, narratives, discovery);
  assertions = dedupeAssertions(assertions);

  if (!actions.length) errors.push("No deterministic executable actions could be compiled.");
  if (!assertions.length) errors.push("No deterministic assertion could be compiled from the expected results.");
  const unsupported = [...new Set(errors)];
  if (unsupported.length) {
    return {
      ok: false,
      reasonCode: !assertions.length && assertionSuggestions.length ? "ASSERTION_CAPABILITY_MISSING" : "AUTOMATION_CONTRACT_INCOMPLETE",
      reason: unsupported[0],
      errors: unsupported,
      supportedOperations: [...SUPPORTED_OPERATIONS],
      supportedAssertions: [...ASSERTION_OPERATIONS],
      assertionSuggestions,
      uncompiledExpectations: narratives,
    };
  }

  return {
    ok: true,
    plan: {
      version: 3,
      testCaseId: testCase.id,
      title: testCase.title,
      actions,
      assertions,
      narrativeExpectations: narratives,
      assertionSuggestions,
    },
  };
}

module.exports = { SUPPORTED_OPERATIONS, ACTION_OPERATIONS, buildDiscoveryIndex, compileTestCase };
