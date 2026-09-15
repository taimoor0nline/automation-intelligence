/* TestNexus internal rendered-DOM discovery. Framework-owned; never exposed as a user-authored test. */

const MAX_PAGES = Math.max(1, Math.min(Number(Cypress.env('DISCOVERY_MAX_PAGES') || 6), 12));
const MAX_ELEMENTS_PER_PAGE = Math.max(100, Math.min(Number(Cypress.env('DISCOVERY_MAX_ELEMENTS') || 900), 2000));
const MAX_DOM_SCAN = Math.max(MAX_ELEMENTS_PER_PAGE, Math.min(Number(Cypress.env('DISCOVERY_MAX_DOM_SCAN') || 5000), 12000));
const QUIET_MS = 450;
const MAX_SETTLE_MS = 6000;
const SKIP_EXTENSIONS = /\.(?:js|mjs|css|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|eot|pdf|zip|json|xml|webmanifest|txt|csv|wasm|mp3|mp4|webm)(?:$|[?#])/i;
const SAFE_RESPONSE_HEADERS = new Set([
  'content-type','cache-control','content-security-policy','strict-transport-security',
  'x-frame-options','x-content-type-options','referrer-policy','permissions-policy',
  'access-control-allow-origin','access-control-allow-methods','cross-origin-opener-policy',
  'cross-origin-resource-policy','cross-origin-embedder-policy',
]);
const ALWAYS_DISCOVER_TAGS = new Set([
  'input','textarea','select','option','button','form','a','label','fieldset','legend',
  'h1','h2','h3','h4','h5','h6','p','li','dt','dd','summary','details',
  'img','picture','video','audio','canvas','table','thead','tbody','tfoot','tr','th','td',
  'progress','meter','output','iframe','object','embed',
]);
const EXCLUDED_TAGS = new Set(['script','style','noscript','meta','link','title','base','template']);

function clean(value, max = 500) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function cssEscape(win, value) {
  const source = String(value ?? '');
  if (win.CSS && typeof win.CSS.escape === 'function') return win.CSS.escape(source);
  return source.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

function quoteAttr(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function queryAll(root, selector) {
  try { return Array.from(root.querySelectorAll(selector)); } catch { return []; }
}

function isUnique(root, selector, element) {
  try {
    const nodes = root.querySelectorAll(selector);
    return nodes.length === 1 && nodes[0] === element;
  } catch {
    return false;
  }
}

function structuralSelector(root, element) {
  const parts = [];
  let current = element;
  for (let depth = 0; current && current.nodeType === 1 && depth < 7; depth += 1) {
    const tag = current.tagName.toLowerCase();
    const parent = current.parentElement;
    if (!parent) break;
    const same = Array.from(parent.children).filter((node) => node.tagName === current.tagName);
    const segment = same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(current) + 1})` : tag;
    parts.unshift(segment);
    const candidate = parts.join(' > ');
    if (isUnique(root, candidate, element)) return candidate;
    current = parent;
  }
  return parts.join(' > ');
}

function stableSelector(win, element, root = element.ownerDocument) {
  const tag = element.tagName.toLowerCase();
  const attrs = ['data-testid', 'data-cy', 'data-test', 'data-qa'];
  for (const name of attrs) {
    const value = element.getAttribute(name);
    if (!value) continue;
    const selector = `[${name}="${quoteAttr(value)}"]`;
    if (isUnique(root, selector, element)) return { selector, strategy: name.toUpperCase().replace(/-/g, '_'), stability: 'HIGH' };
  }
  if (element.id) {
    const selector = `#${cssEscape(win, element.id)}`;
    if (isUnique(root, selector, element)) return { selector, strategy: 'ID', stability: 'HIGH' };
  }
  const name = element.getAttribute('name');
  if (name) {
    const selector = `${tag}[name="${quoteAttr(name)}"]`;
    if (isUnique(root, selector, element)) return { selector, strategy: 'NAME', stability: 'MEDIUM' };
  }
  const aria = element.getAttribute('aria-label');
  if (aria) {
    const selector = `${tag}[aria-label="${quoteAttr(aria)}"]`;
    if (isUnique(root, selector, element)) return { selector, strategy: 'ARIA_LABEL', stability: 'MEDIUM' };
  }
  const role = element.getAttribute('role');
  if (role && aria) {
    const selector = `[role="${quoteAttr(role)}"][aria-label="${quoteAttr(aria)}"]`;
    if (isUnique(root, selector, element)) return { selector, strategy: 'ROLE_ARIA', stability: 'MEDIUM' };
  }
  const href = element.getAttribute('href');
  if (tag === 'a' && href) {
    const selector = `a[href="${quoteAttr(href)}"]`;
    if (isUnique(root, selector, element)) return { selector, strategy: 'HREF', stability: 'MEDIUM' };
  }
  const alt = element.getAttribute('alt');
  if (tag === 'img' && alt) {
    const selector = `img[alt="${quoteAttr(alt)}"]`;
    if (isUnique(root, selector, element)) return { selector, strategy: 'ALT', stability: 'MEDIUM' };
  }
  const selector = structuralSelector(root, element);
  return selector ? { selector, strategy: 'STRUCTURAL', stability: 'LOW' } : null;
}

function labelText(doc, element) {
  if (element.id) {
    const match = queryAll(doc, 'label[for]').find((label) => label.getAttribute('for') === element.id);
    if (match) return clean(match.textContent, 300);
  }
  const parentLabel = element.closest?.('label');
  return parentLabel ? clean(parentLabel.textContent, 300) : null;
}

function visibleState(win, element) {
  try {
    const style = win.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return !element.hidden && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0 && rect.width >= 0 && rect.height >= 0;
  } catch {
    return !element.hidden;
  }
}

function semanticText(element) {
  const tag = element.tagName.toLowerCase();
  if (['input','textarea','select','option'].includes(tag)) return null;
  return clean(element.textContent, 800) || null;
}

function formMetadata(element) {
  const form = element.closest?.('form');
  const fieldset = element.closest?.('fieldset');
  return {
    formId: form?.id || null,
    formName: form?.getAttribute('name') || null,
    formAction: form?.getAttribute('action') || null,
    formMethod: form ? String(form.getAttribute('method') || 'GET').toUpperCase() : null,
    groupName: element.getAttribute('name') || null,
    groupLabel: fieldset ? clean(fieldset.querySelector('legend')?.textContent, 300) || null : null,
  };
}

function errorElement(win, element) {
  const doc = element.ownerDocument;
  const describedBy = String(element.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
  for (const id of describedBy) {
    const node = doc.getElementById(id);
    if (!node) continue;
    const target = stableSelector(win, node, node.getRootNode());
    if (target) return { id, testId: node.getAttribute('data-testid') || null, selector: target.selector, text: clean(node.textContent, 500) || null, source: 'aria-describedby' };
  }
  let sibling = element.nextElementSibling;
  for (let i = 0; sibling && i < 4; i += 1, sibling = sibling.nextElementSibling) {
    const signature = [sibling.className, sibling.id, sibling.getAttribute('data-testid'), sibling.getAttribute('role')].filter(Boolean).join(' ').toLowerCase();
    if (!/(error|invalid|validation|alert)/.test(signature)) continue;
    const target = stableSelector(win, sibling, sibling.getRootNode());
    if (target) return { id: sibling.id || null, testId: sibling.getAttribute('data-testid') || null, selector: target.selector, text: clean(sibling.textContent, 500) || null, source: 'dom-proximity' };
  }
  return null;
}

function hasNativeDropEvidence(element) {
  return element.hasAttribute('ondrop') || element.hasAttribute('dropzone') || typeof element.ondrop === 'function';
}

function fileDropEvidence(element) {
  const text = [element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent, element.id, element.className]
    .filter(Boolean).join(' ').toLowerCase();
  const containsFileInput = Boolean(element.querySelector?.('input[type="file"]'));
  return hasNativeDropEvidence(element) && (containsFileInput || /\b(upload|drop|drag)\b.{0,40}\b(file|image|photo|document)\b|\b(file|image|photo|document)\b.{0,40}\b(drop|drag|upload)\b/.test(text));
}

function isMeaningfulCandidate(element) {
  const tag = element.tagName?.toLowerCase();
  if (!tag || EXCLUDED_TAGS.has(tag)) return false;
  if (ALWAYS_DISCOVER_TAGS.has(tag)) return true;
  if (element.hasAttribute('data-testid') || element.hasAttribute('data-cy') || element.hasAttribute('data-test') || element.hasAttribute('data-qa')) return true;
  if (element.id || element.getAttribute('name') || element.getAttribute('role') || element.getAttribute('aria-label')) return true;
  if (element.hasAttribute('contenteditable') || element.hasAttribute('draggable') || element.hasAttribute('ondrop') || element.hasAttribute('dropzone') || element.hasAttribute('tabindex')) return true;
  if (element.hasAttribute('onclick') || typeof element.onclick === 'function') return true;
  if (['div','span','section','article','main','nav','header','footer','aside'].includes(tag)) {
    const text = clean(element.textContent, 800);
    const childCount = element.children?.length || 0;
    return Boolean(text && text.length <= 800 && childCount <= 3);
  }
  return false;
}

function collectElements(doc) {
  const output = [];
  const seen = new Set();
  function scan(root, inShadow = false, hostSelector = null) {
    for (const element of queryAll(root, '*').slice(0, MAX_DOM_SCAN)) {
      if (!seen.has(element) && isMeaningfulCandidate(element)) {
        seen.add(element);
        output.push({ element, root, inShadow, hostSelector });
        if (output.length >= MAX_ELEMENTS_PER_PAGE) return;
      }
      if (element.shadowRoot && output.length < MAX_ELEMENTS_PER_PAGE) {
        const hostTarget = stableSelector(doc.defaultView, element, element.getRootNode());
        scan(element.shadowRoot, true, hostTarget?.selector || null);
      }
      if (output.length >= MAX_ELEMENTS_PER_PAGE) return;
    }
  }
  scan(doc, false, null);
  return output;
}

function serializeElement(win, element, root, inShadow, shadowHostSelector) {
  const target = stableSelector(win, element, root);
  if (!target) return null;
  if (inShadow && target.strategy === 'STRUCTURAL') return null;
  const doc = element.ownerDocument;
  const tag = element.tagName.toLowerCase();
  const type = clean(element.getAttribute('type') || (tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : tag), 60).toLowerCase();
  const role = element.getAttribute('role') || null;
  const text = semanticText(element);
  const result = {
    id: element.id || null,
    testId: element.getAttribute('data-testid') || element.getAttribute('data-cy') || element.getAttribute('data-test') || null,
    name: element.getAttribute('name') || null,
    selector: target.selector,
    selectorStrategy: target.strategy,
    selectorStability: target.stability,
    shadowDom: Boolean(inShadow),
    shadowHostSelector: shadowHostSelector || null,
    role,
    ariaLabel: element.getAttribute('aria-label') || null,
    ariaDescribedBy: element.getAttribute('aria-describedby') || null,
    ariaChecked: element.getAttribute('aria-checked'),
    ariaSelected: element.getAttribute('aria-selected'),
    ariaExpanded: element.getAttribute('aria-expanded'),
    className: typeof element.className === 'string' ? clean(element.className, 500) || null : null,
    hidden: Boolean(element.hidden),
    visible: visibleState(win, element),
    tag,
    type,
    text,
    label: labelText(doc, element) || element.getAttribute('placeholder') || element.getAttribute('name') || element.getAttribute('aria-label') || text || null,
    placeholder: element.getAttribute('placeholder') || null,
    required: element.required === true,
    disabled: element.disabled === true || element.getAttribute('aria-disabled') === 'true',
    readonly: element.readOnly === true || element.getAttribute('aria-readonly') === 'true',
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
    list: element.getAttribute('list'),
    accept: element.getAttribute('accept'),
    capture: element.getAttribute('capture'),
    href: element.getAttribute('href'),
    target: element.getAttribute('target'),
    alt: element.getAttribute('alt'),
    src: element.getAttribute('src'),
    draggable: element.draggable === true || element.getAttribute('draggable') === 'true',
    nativeDropTarget: hasNativeDropEvidence(element),
    fileDropTarget: fileDropEvidence(element),
    clickEvidence: element.hasAttribute('onclick') || typeof element.onclick === 'function',
    ...formMetadata(element),
  };

  if (['input', 'select', 'textarea'].includes(tag)) result.errorElement = errorElement(win, element);
  if (tag === 'select') {
    result.options = Array.from(element.options || []).slice(0, 150).map((option) => ({
      value: option.value,
      label: clean(option.textContent, 300),
      disabled: option.disabled === true,
      selected: option.selected === true,
    }));
  }
  if (type === 'radio' || type === 'checkbox') {
    result.controlValue = element.value || null;
    result.checked = Boolean(element.checked);
  }
  if (type === 'range') result.rangeValue = element.value || null;
  if (tag === 'img') {
    result.complete = element.complete === true;
    result.naturalWidth = Number(element.naturalWidth || 0);
    result.naturalHeight = Number(element.naturalHeight || 0);
  }
  if (tag === 'video' || tag === 'audio') {
    result.mediaReadyState = Number(element.readyState || 0);
    result.duration = Number.isFinite(Number(element.duration)) ? Number(element.duration) : null;
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
  const seenSelectors = new Set();
  const elements = [];
  for (const entry of collectElements(doc)) {
    const item = serializeElement(win, entry.element, entry.root, entry.inShadow, entry.hostSelector);
    if (!item?.selector) continue;
    const selectorKey = `${item.shadowHostSelector || 'light'}|${item.selector}`;
    if (seenSelectors.has(selectorKey)) continue;
    seenSelectors.add(selectorKey);
    elements.push(item);
    if (elements.length >= MAX_ELEMENTS_PER_PAGE) break;
  }

  const messages = elements.filter((item) => {
    const signature = [item.role, item.id, item.testId, item.className].filter(Boolean).join(' ').toLowerCase();
    return ['alert','status'].includes(String(item.role || '').toLowerCase()) || /(error|success|validation|message|notice)/.test(signature);
  }).map((item) => ({ ...item, text: item.text || null }));

  const routeHints = [];
  const routeSeen = new Set();
  for (const item of elements) {
    if (item.tag !== 'a' || !item.href) continue;
    const value = pageUrlCandidate(item.href, win.location.href);
    if (value && !routeSeen.has(value)) { routeSeen.add(value); routeHints.push(value); }
  }

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
    capabilityDiscovery: {
      scannedElements: Math.min(doc.querySelectorAll('*').length, MAX_DOM_SCAN),
      capturedElements: elements.length,
      maxElements: MAX_ELEMENTS_PER_PAGE,
      openShadowDom: elements.some((item) => item.shadowDom === true),
    },
    discoveryEngine: 'BROWSER_RENDERED_DOM_V2',
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
    const armQuiet = () => { clearTimeout(quietTimer); quietTimer = setTimeout(finish, QUIET_MS); };
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
  it('discovers rendered public DOM capabilities without application mutation', () => {
    const seeds = parseSeeds();
    const outputFile = String(Cypress.env('DISCOVERY_OUTPUT_FILE') || '').trim();
    const pageScope = String(Cypress.env('DISCOVERY_PAGE_SCOPE') || 'ALL_DISCOVERED_PAGES').toUpperCase();
    if (!seeds.length || !outputFile) { expect(true).to.equal(true); return; }

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
        version: 3,
        engine: 'BROWSER_RENDERED_DOM_V2',
        discoveredAt: new Date().toISOString(),
        pages,
      }, { log: false });
    });
  });
});
