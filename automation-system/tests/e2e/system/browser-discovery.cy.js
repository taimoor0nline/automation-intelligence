/* TestNexus internal rendered-DOM discovery. This spec is framework-owned and never exposed as a user test. */

const MAX_PAGES = Math.max(1, Math.min(Number(Cypress.env('DISCOVERY_MAX_PAGES') || 6), 12));
const QUIET_MS = 450;
const MAX_SETTLE_MS = 6000;
const SKIP_EXTENSIONS = /\.(?:js|mjs|css|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|eot|pdf|zip|json|xml|webmanifest|txt|csv|wasm|mp3|mp4|webm)(?:$|[?#])/i;
const SAFE_RESPONSE_HEADERS = new Set([
  'content-type','cache-control','content-security-policy','strict-transport-security',
  'x-frame-options','x-content-type-options','referrer-policy','permissions-policy',
  'access-control-allow-origin','access-control-allow-methods','cross-origin-opener-policy',
  'cross-origin-resource-policy','cross-origin-embedder-policy',
]);

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function cssEscape(win, value) {
  const source = String(value ?? '');
  if (win.CSS && typeof win.CSS.escape === 'function') return win.CSS.escape(source);
  return source.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

function quoteAttr(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function isUnique(doc, selector, element) {
  try {
    const nodes = doc.querySelectorAll(selector);
    return nodes.length === 1 && nodes[0] === element;
  } catch {
    return false;
  }
}

function structuralSelector(win, element) {
  const doc = element.ownerDocument;
  const parts = [];
  let current = element;
  for (let depth = 0; current && current.nodeType === 1 && current !== doc.documentElement && depth < 7; depth += 1) {
    const tag = current.tagName.toLowerCase();
    const parent = current.parentElement;
    if (!parent) break;
    const same = Array.from(parent.children).filter((node) => node.tagName === current.tagName);
    const segment = same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(current) + 1})` : tag;
    parts.unshift(segment);
    const candidate = parts.join(' > ');
    if (isUnique(doc, candidate, element)) return candidate;
    current = parent;
  }
  return parts.join(' > ');
}

function stableSelector(win, element) {
  const doc = element.ownerDocument;
  const attrs = ['data-testid', 'data-cy', 'data-test', 'data-qa'];
  for (const name of attrs) {
    const value = element.getAttribute(name);
    if (!value) continue;
    const selector = `[${name}="${quoteAttr(value)}"]`;
    if (isUnique(doc, selector, element)) return { selector, strategy: name.toUpperCase().replace(/-/g, '_'), stability: 'HIGH' };
  }
  if (element.id) {
    const selector = `#${cssEscape(win, element.id)}`;
    if (isUnique(doc, selector, element)) return { selector, strategy: 'ID', stability: 'HIGH' };
  }
  const name = element.getAttribute('name');
  if (name) {
    const selector = `${element.tagName.toLowerCase()}[name="${quoteAttr(name)}"]`;
    if (isUnique(doc, selector, element)) return { selector, strategy: 'NAME', stability: 'MEDIUM' };
  }
  const aria = element.getAttribute('aria-label');
  if (aria) {
    const selector = `${element.tagName.toLowerCase()}[aria-label="${quoteAttr(aria)}"]`;
    if (isUnique(doc, selector, element)) return { selector, strategy: 'ARIA_LABEL', stability: 'MEDIUM' };
  }
  const href = element.getAttribute('href');
  if (element.tagName.toLowerCase() === 'a' && href) {
    const selector = `a[href="${quoteAttr(href)}"]`;
    if (isUnique(doc, selector, element)) return { selector, strategy: 'HREF', stability: 'MEDIUM' };
  }
  const selector = structuralSelector(win, element);
  return selector ? { selector, strategy: 'STRUCTURAL', stability: 'LOW' } : null;
}

function labelText(doc, element) {
  if (element.id) {
    const labels = Array.from(doc.querySelectorAll('label[for]'));
    const match = labels.find((label) => label.getAttribute('for') === element.id);
    if (match) return clean(match.textContent, 300);
  }
  const parentLabel = element.closest('label');
  return parentLabel ? clean(parentLabel.textContent, 300) : null;
}

function errorElement(win, element) {
  const doc = element.ownerDocument;
  const describedBy = String(element.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
  for (const id of describedBy) {
    const node = doc.getElementById(id);
    if (!node) continue;
    const target = stableSelector(win, node);
    if (target) return { id, testId: node.getAttribute('data-testid') || null, selector: target.selector, text: clean(node.textContent, 500) || null, source: 'aria-describedby' };
  }
  let sibling = element.nextElementSibling;
  for (let i = 0; sibling && i < 4; i += 1, sibling = sibling.nextElementSibling) {
    const signature = [sibling.className, sibling.id, sibling.getAttribute('data-testid'), sibling.getAttribute('role')].filter(Boolean).join(' ').toLowerCase();
    if (!/(error|invalid|validation|alert)/.test(signature)) continue;
    const target = stableSelector(win, sibling);
    if (target) return { id: sibling.id || null, testId: sibling.getAttribute('data-testid') || null, selector: target.selector, text: clean(sibling.textContent, 500) || null, source: 'dom-proximity' };
  }
  return null;
}

function formMetadata(element) {
  const form = element.closest('form');
  const fieldset = element.closest('fieldset');
  return {
    formId: form?.id || null,
    formName: form?.getAttribute('name') || null,
    formAction: form?.getAttribute('action') || null,
    formMethod: form ? String(form.getAttribute('method') || 'GET').toUpperCase() : null,
    groupName: fieldset ? element.getAttribute('name') || null : null,
    groupLabel: fieldset ? clean(fieldset.querySelector('legend')?.textContent, 300) || null : null,
  };
}

function serializeElement(win, element) {
  const target = stableSelector(win, element);
  if (!target) return null;
  const doc = element.ownerDocument;
  const tag = element.tagName.toLowerCase();
  const type = clean(element.getAttribute('type') || (tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : tag), 60).toLowerCase();
  const visibleText = ['button', 'a'].includes(tag) || element.getAttribute('role') ? clean(element.textContent, 500) || null : null;
  const result = {
    id: element.id || null,
    testId: element.getAttribute('data-testid') || element.getAttribute('data-cy') || element.getAttribute('data-test') || null,
    name: element.getAttribute('name') || null,
    selector: target.selector,
    selectorStrategy: target.strategy,
    selectorStability: target.stability,
    role: element.getAttribute('role') || null,
    ariaLabel: element.getAttribute('aria-label') || null,
    ariaDescribedBy: element.getAttribute('aria-describedby') || null,
    className: typeof element.className === 'string' ? clean(element.className, 500) || null : null,
    hidden: Boolean(element.hidden),
    tag,
    type,
    text: visibleText,
    label: labelText(doc, element) || element.getAttribute('placeholder') || element.getAttribute('name') || visibleText || null,
    placeholder: element.getAttribute('placeholder') || null,
    required: element.required === true,
    disabled: element.disabled === true,
    readonly: element.readOnly === true,
    multiple: element.multiple === true,
    contenteditable: element.isContentEditable === true,
    tabIndex: Number.isFinite(Number(element.tabIndex)) ? Number(element.tabIndex) : null,
    min: element.getAttribute('min'),
    max: element.getAttribute('max'),
    step: element.getAttribute('step'),
    minlength: element.getAttribute('minlength'),
    maxlength: element.getAttribute('maxlength'),
    pattern: element.getAttribute('pattern'),
    autocomplete: element.getAttribute('autocomplete'),
    inputmode: element.getAttribute('inputmode'),
    href: element.getAttribute('href'),
    alt: element.getAttribute('alt'),
    src: element.getAttribute('src'),
    ...formMetadata(element),
  };
  if (['input', 'select', 'textarea'].includes(tag)) result.errorElement = errorElement(win, element);
  if (tag === 'select') result.options = Array.from(element.options || []).slice(0, 100).map((option) => ({ value: option.value, label: clean(option.textContent, 300), disabled: option.disabled }));
  if (type === 'radio' || type === 'checkbox') {
    result.value = element.value || null;
    result.checked = Boolean(element.checked);
  }
  return result;
}

function pageUrlCandidate(raw, baseUrl) {
  if (!raw) return null;
  try {
    const base = new URL(baseUrl);
    const url = new URL(raw, base);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== base.origin) return null;
    if (url.pathname.startsWith('/api/')) return null;
    if (SKIP_EXTENSIONS.test(url.pathname + url.search)) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function safeHeaders(headers = {}) {
  const output = {};
  for (const [name, value] of Object.entries(headers || {})) {
    const key = String(name || '').toLowerCase();
    if (!SAFE_RESPONSE_HEADERS.has(key)) continue;
    output[key] = clean(Array.isArray(value) ? value.join(', ') : value, 1200);
  }
  return output;
}

function networkHint(request, pageUrl) {
  try {
    const page = new URL(pageUrl);
    const url = new URL(request?.url, page);
    if (url.origin !== page.origin) return null;
    const path = `${url.pathname}${url.search}` || '/';
    const method = String(request?.method || 'GET').toUpperCase();
    const stateChanging = ['POST','PUT','PATCH','DELETE'].includes(method);
    const apiLike = /^\/(?:api|graphql|rest)\b/i.test(path);
    if (!stateChanging && !apiLike) return null;
    return {
      method,
      url: path,
      status: Number.isFinite(Number(request?.status)) ? Number(request.status) : null,
      responseHeaders: request?.responseHeaders && typeof request.responseHeaders === 'object' ? request.responseHeaders : {},
      source: 'browser-network',
    };
  } catch {
    return null;
  }
}

function browserState(win) {
  const cookieNames = String(win.document.cookie || '').split(';').map((part) => part.split('=')[0].trim()).filter(Boolean).slice(0, 100);
  const localStorageKeys = [];
  const sessionStorageKeys = [];
  try { for (let i = 0; i < win.localStorage.length && localStorageKeys.length < 100; i += 1) localStorageKeys.push(String(win.localStorage.key(i))); } catch {}
  try { for (let i = 0; i < win.sessionStorage.length && sessionStorageKeys.length < 100; i += 1) sessionStorageKeys.push(String(win.sessionStorage.key(i))); } catch {}
  return { cookieNames: [...new Set(cookieNames)], localStorageKeys: [...new Set(localStorageKeys.filter(Boolean))], sessionStorageKeys: [...new Set(sessionStorageKeys.filter(Boolean))] };
}

function discoverDocument(win, requests) {
  const doc = win.document;
  const selector = [
    'input', 'select', 'textarea', 'button', 'a[href]', '[contenteditable="true"]',
    '[data-testid]', '[data-cy]', '[data-test]', '[role="button"]', '[role="link"]', '[role="textbox"]', '[role="combobox"]',
    '[role="checkbox"]', '[role="radio"]', '[role="switch"]', '[role="tab"]', '[role="alert"]', '[role="status"]', '[aria-live]',
    'img[id]', 'table[id]', 'h1[id]', 'h2[id]'
  ].join(',');
  const seen = new Set();
  const elements = [];
  for (const element of Array.from(doc.querySelectorAll(selector))) {
    const item = serializeElement(win, element);
    if (!item?.selector || seen.has(item.selector)) continue;
    seen.add(item.selector);
    elements.push(item);
  }

  const messages = [];
  for (const element of Array.from(doc.querySelectorAll('[role="alert"], [role="status"], [aria-live], .error, .success, .success-panel'))) {
    const item = serializeElement(win, element);
    if (!item?.selector) continue;
    messages.push({ ...item, text: clean(element.textContent, 800) || null });
  }

  const routeHints = [];
  const routeSeen = new Set();
  const addRoute = (raw) => {
    const value = pageUrlCandidate(raw, win.location.href);
    if (value && !routeSeen.has(value)) { routeSeen.add(value); routeHints.push(value); }
  };
  // Public rendered links define navigable public-page discovery. Form actions are
  // network behavior, not automatically crawlable pages.
  Array.from(doc.querySelectorAll('a[href]')).forEach((el) => addRoute(el.getAttribute('href')));

  const networkMap = new Map();
  for (const request of requests || []) {
    const hint = networkHint(request, win.location.href);
    if (hint) networkMap.set(`${hint.method} ${hint.url}`, hint);
  }

  return {
    url: win.location.href,
    finalUrl: win.location.href,
    pageTitle: clean(doc.title || doc.querySelector('h1')?.textContent || win.location.href, 500),
    documentLanguage: doc.documentElement.lang || null,
    meta: Array.from(doc.querySelectorAll('meta[name]')).slice(0, 50).map((el) => ({ name: el.getAttribute('name'), content: el.getAttribute('content') || '' })),
    elements,
    messages,
    routeHints,
    networkHints: Array.from(networkMap.values()),
    browserState: browserState(win),
    discoveryEngine: 'BROWSER_RENDERED_DOM',
  };
}

function waitForRenderedDom(win) {
  return new Cypress.Promise((resolve) => {
    let finished = false;
    let quietTimer = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(quietTimer);
      clearTimeout(maxTimer);
      observer.disconnect();
      resolve();
    };
    const armQuiet = () => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(finish, QUIET_MS);
    };
    const observer = new win.MutationObserver(armQuiet);
    observer.observe(win.document.documentElement, { childList: true, subtree: true, attributes: true });
    const maxTimer = setTimeout(finish, MAX_SETTLE_MS);
    armQuiet();
  });
}

function parseSeeds() {
  try {
    const parsed = JSON.parse(String(Cypress.env('DISCOVERY_TARGET_URLS_JSON') || '[]'));
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

describe('TestNexus internal rendered page discovery', () => {
  it('discovers the rendered public DOM without application mutation', () => {
    const seeds = parseSeeds();
    const outputFile = String(Cypress.env('DISCOVERY_OUTPUT_FILE') || '').trim();
    const pageScope = String(Cypress.env('DISCOVERY_PAGE_SCOPE') || 'ALL_DISCOVERED_PAGES').toUpperCase();

    // This framework-owned spec lives under the normal Cypress spec tree so the
    // server can invoke it explicitly. In an ordinary full suite run, discovery
    // inputs are absent; keep the internal spec a harmless no-op rather than
    // contaminating user-test results.
    if (!seeds.length || !outputFile) {
      expect(true).to.equal(true);
      return;
    }

    const queue = pageScope === 'STARTING_PAGE_ONLY' ? [seeds[0]] : [...seeds];
    const queued = new Set(queue);
    const visited = new Set();
    const pages = [];
    let currentRequests = [];

    cy.intercept({ url: '**' }, (req) => {
      const record = { method: req.method, url: req.url, status: null, responseHeaders: {} };
      currentRequests.push(record);
      req.on('response', (res) => {
        record.status = Number.isFinite(Number(res?.statusCode)) ? Number(res.statusCode) : null;
        record.responseHeaders = safeHeaders(res?.headers || {});
      });
    });

    function next() {
      if (!queue.length || pages.length >= MAX_PAGES) return cy.wrap(null, { log: false });
      const requestedUrl = queue.shift();
      if (!requestedUrl || visited.has(requestedUrl)) return next();
      visited.add(requestedUrl);
      currentRequests = [];

      return cy.visit(requestedUrl, { failOnStatusCode: false, log: false })
        .then({ log: false }, (win) => waitForRenderedDom(win).then(() => win))
        .then({ log: false }, (win) => {
          const page = discoverDocument(win, currentRequests);
          pages.push(page);
          if (pageScope !== 'STARTING_PAGE_ONLY') {
            for (const hint of page.routeHints || []) {
              if (!visited.has(hint) && !queued.has(hint) && queue.length + pages.length < MAX_PAGES) {
                queue.push(hint);
                queued.add(hint);
              }
            }
          }
        })
        .then({ log: false }, next);
    }

    next().then(() => {
      cy.writeFile(outputFile, {
        version: 2,
        engine: 'BROWSER_RENDERED_DOM',
        discoveredAt: new Date().toISOString(),
        pages,
      }, { log: false });
    });
  });
});
