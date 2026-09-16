const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const SAFE_RESPONSE_HEADERS = new Set([
  'content-type','cache-control','content-security-policy','strict-transport-security',
  'x-frame-options','x-content-type-options','referrer-policy','permissions-policy',
  'access-control-allow-origin','access-control-allow-methods','cross-origin-opener-policy',
  'cross-origin-resource-policy','cross-origin-embedder-policy',
]);

function boolEnv(value, fallback) {
  if (value == null || value === '') return fallback;
  return !['false', '0', 'no', 'off'].includes(String(value).toLowerCase());
}

function existingFile(candidates = []) {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

function resolveChrome() {
  const explicit = String(process.env.CHROME_PATH || process.env.GOOGLE_CHROME_BIN || '').trim();
  if (explicit && fs.existsSync(explicit)) return explicit;

  if (process.platform === 'win32') {
    return existingFile([
      process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ]);
  }

  if (process.platform === 'darwin') {
    return existingFile([
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      path.join(os.homedir(), 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'),
    ]);
  }

  return existingFile([
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]);
}

function cleanTerminal(value, max = 3000) {
  return String(value || '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(-max);
}

function terminateProcessTree(child) {
  if (!child?.pid) return Promise.resolve();
  if (process.platform !== 'win32') {
    try { child.kill('SIGKILL'); } catch {}
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.once('close', resolve);
    killer.once('error', resolve);
  });
}

function launchChrome(chromePath, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnexus-cdp-discovery-'));
    const args = [
      '--headless=new',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-popup-blocking',
      '--disable-renderer-backgrounding',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=0',
      '--remote-allow-origins=*',
      `--user-data-dir=${profileDir}`,
      'about:blank',
    ];
    const child = spawn(chromePath, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    let settled = false;

    const fail = async (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      await terminateProcessTree(child).catch(() => {});
      try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
      error.stderr = stderr;
      reject(error);
    };

    const succeed = (browserWsUrl) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ child, profileDir, browserWsUrl, stderr: () => stderr });
    };

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) succeed(match[1]);
    });
    child.once('error', (error) => fail(error));
    child.once('close', (code) => {
      if (settled) return;
      const error = new Error(`Chrome exited before exposing its DevTools endpoint (code ${code}).`);
      error.code = 'DIRECT_CHROME_START_FAILED';
      fail(error);
    });

    const timer = setTimeout(() => {
      const error = new Error(`Chrome did not expose its DevTools endpoint within ${Math.round(timeoutMs / 1000)} seconds.`);
      error.code = 'DIRECT_CHROME_START_TIMEOUT';
      fail(error);
    }, timeoutMs);
    timer.unref?.();
  });
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
  }

  open(timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      const timer = setTimeout(() => {
        try { ws.terminate(); } catch {}
        reject(new Error('Timed out connecting to the Chrome DevTools endpoint.'));
      }, timeoutMs);
      timer.unref?.();
      ws.once('open', () => { clearTimeout(timer); resolve(); });
      ws.once('error', (error) => { clearTimeout(timer); reject(error); });
      ws.on('message', (raw) => this.handleMessage(raw));
      ws.on('close', () => {
        for (const { reject: rejectPending } of this.pending.values()) rejectPending(new Error('Chrome DevTools connection closed.'));
        this.pending.clear();
      });
    });
  }

  handleMessage(raw) {
    let message;
    try { message = JSON.parse(String(raw)); } catch { return; }
    if (message.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || 'Chrome DevTools command failed.'));
      else pending.resolve(message.result || {});
      return;
    }
    for (const listener of this.listeners) {
      try { listener(message); } catch {}
    }
  }

  send(method, params = {}, sessionId = null, timeoutMs = 15000) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Chrome DevTools connection is not open.'));
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Chrome DevTools command ${method} timed out.`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      try { this.ws.send(JSON.stringify(payload)); }
      catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  waitForEvent(method, sessionId, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for Chrome event ${method}.`));
      }, timeoutMs);
      timer.unref?.();
      const cleanup = this.onEvent((message) => {
        if (message.method !== method) return;
        if (sessionId && message.sessionId !== sessionId) return;
        clearTimeout(timer);
        cleanup();
        resolve(message.params || {});
      });
    });
  }

  close() {
    try { this.ws?.close(); } catch {}
  }
}

function safeHeaders(headers = {}) {
  const output = {};
  for (const [name, value] of Object.entries(headers || {})) {
    const key = String(name || '').toLowerCase();
    if (!SAFE_RESPONSE_HEADERS.has(key)) continue;
    output[key] = String(Array.isArray(value) ? value.join(', ') : value ?? '').replace(/\s+/g, ' ').trim().slice(0, 1200);
  }
  return output;
}

function serializeRenderedDocument() {
  const MAX_ELEMENTS = 900;
  const MAX_SCAN = 5000;
  const SKIP_EXTENSIONS = /\.(?:js|mjs|css|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|eot|pdf|zip|json|xml|webmanifest|txt|csv|wasm|mp3|mp4|webm)(?:$|[?#])/i;
  const ALWAYS = new Set(['input','textarea','select','option','datalist','button','form','a','label','fieldset','legend','h1','h2','h3','h4','h5','h6','p','li','dt','dd','summary','details','img','picture','video','audio','canvas','table','thead','tbody','tfoot','tr','th','td','progress','meter','output','iframe','object','embed']);
  const EXCLUDED = new Set(['script','style','noscript','meta','link','title','base','template']);
  const clean = (value, max = 500) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
  const quoteAttr = (value) => String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const cssEscape = (value) => window.CSS && typeof window.CSS.escape === 'function' ? window.CSS.escape(String(value ?? '')) : String(value ?? '').replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
  const queryAll = (root, selector) => { try { return Array.from(root.querySelectorAll(selector)); } catch { return []; } };
  const isUnique = (root, selector, element) => { try { const nodes = root.querySelectorAll(selector); return nodes.length === 1 && nodes[0] === element; } catch { return false; } };

  function structuralSelector(root, element) {
    const parts = [];
    let current = element;
    for (let depth = 0; current && current.nodeType === 1 && depth < 7; depth += 1) {
      const tag = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (!parent) break;
      const same = Array.from(parent.children).filter((node) => node.tagName === current.tagName);
      parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(current) + 1})` : tag);
      const candidate = parts.join(' > ');
      if (isUnique(root, candidate, element)) return candidate;
      current = parent;
    }
    return parts.join(' > ');
  }

  function stableSelector(element, root = element.ownerDocument) {
    const tag = element.tagName.toLowerCase();
    for (const name of ['data-testid','data-cy','data-test','data-qa']) {
      const value = element.getAttribute(name);
      if (!value) continue;
      const selector = `[${name}="${quoteAttr(value)}"]`;
      if (isUnique(root, selector, element)) return { selector, strategy: name.toUpperCase().replace(/-/g, '_'), stability: 'HIGH' };
    }
    if (element.id) {
      const selector = `#${cssEscape(element.id)}`;
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

  function meaningful(element) {
    const tag = element.tagName?.toLowerCase();
    if (!tag || EXCLUDED.has(tag)) return false;
    if (ALWAYS.has(tag)) return true;
    if (element.hasAttribute('data-testid') || element.hasAttribute('data-cy') || element.hasAttribute('data-test') || element.hasAttribute('data-qa')) return true;
    if (element.id || element.getAttribute('name') || element.getAttribute('role') || element.getAttribute('aria-label')) return true;
    if (element.hasAttribute('aria-controls') || element.hasAttribute('aria-owns') || element.hasAttribute('aria-autocomplete') || element.hasAttribute('aria-multiselectable')) return true;
    if (element.hasAttribute('contenteditable') || element.hasAttribute('draggable') || element.hasAttribute('ondrop') || element.hasAttribute('dropzone') || element.hasAttribute('tabindex')) return true;
    if (element.hasAttribute('onclick') || typeof element.onclick === 'function') return true;
    if (['div','span','section','article','main','nav','header','footer','aside'].includes(tag)) {
      const text = clean(element.textContent, 800);
      return Boolean(text && text.length <= 800 && (element.children?.length || 0) <= 3);
    }
    return false;
  }

  function collect() {
    const output = [];
    const seen = new Set();
    function scan(root, inShadow = false, hostSelector = null) {
      for (const element of queryAll(root, '*').slice(0, MAX_SCAN)) {
        if (!seen.has(element) && meaningful(element)) {
          seen.add(element);
          output.push({ element, root, inShadow, hostSelector });
          if (output.length >= MAX_ELEMENTS) return;
        }
        if (element.shadowRoot && output.length < MAX_ELEMENTS) {
          const hostTarget = stableSelector(element, element.getRootNode());
          scan(element.shadowRoot, true, hostTarget?.selector || null);
        }
        if (output.length >= MAX_ELEMENTS) return;
      }
    }
    scan(document, false, null);
    return output;
  }

  function visible(element) {
    try {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return !element.hidden && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0 && rect.width >= 0 && rect.height >= 0;
    } catch { return !element.hidden; }
  }

  function labelText(element) {
    if (element.id) {
      const match = queryAll(document, 'label[for]').find((label) => label.getAttribute('for') === element.id);
      if (match) return clean(match.textContent, 300);
    }
    return element.closest?.('label') ? clean(element.closest('label').textContent, 300) : null;
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

  function errorElement(element) {
    for (const id of String(element.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)) {
      const node = document.getElementById(id);
      if (!node) continue;
      const target = stableSelector(node, node.getRootNode());
      if (target) return { id, testId: node.getAttribute('data-testid') || null, selector: target.selector, text: clean(node.textContent, 500) || null, source: 'aria-describedby' };
    }
    let sibling = element.nextElementSibling;
    for (let i = 0; sibling && i < 4; i += 1, sibling = sibling.nextElementSibling) {
      const signature = [sibling.className, sibling.id, sibling.getAttribute('data-testid'), sibling.getAttribute('role')].filter(Boolean).join(' ').toLowerCase();
      if (!/(error|invalid|validation|alert)/.test(signature)) continue;
      const target = stableSelector(sibling, sibling.getRootNode());
      if (target) return { id: sibling.id || null, testId: sibling.getAttribute('data-testid') || null, selector: target.selector, text: clean(sibling.textContent, 500) || null, source: 'dom-proximity' };
    }
    return null;
  }

  function serialize(entry) {
    const { element, root, inShadow, hostSelector } = entry;
    const target = stableSelector(element, root);
    if (!target || (inShadow && target.strategy === 'STRUCTURAL')) return null;
    const tag = element.tagName.toLowerCase();
    const browserType = (tag === 'input' || tag === 'button') ? element.type : null;
    const type = clean(browserType || element.getAttribute('type') || (tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : tag), 60).toLowerCase();
    const text = ['input','textarea','select','option'].includes(tag) ? null : clean(element.textContent, 800) || null;
    const listboxOwner = element.closest?.('[role="listbox"]');
    const listboxTarget = listboxOwner ? stableSelector(listboxOwner, listboxOwner.getRootNode()) : null;
    const result = {
      id: element.id || null,
      testId: element.getAttribute('data-testid') || element.getAttribute('data-cy') || element.getAttribute('data-test') || null,
      name: element.getAttribute('name') || null,
      selector: target.selector,
      selectorStrategy: target.strategy,
      selectorStability: target.stability,
      shadowDom: Boolean(inShadow),
      shadowHostSelector: hostSelector || null,
      role: element.getAttribute('role') || null,
      ariaLabel: element.getAttribute('aria-label') || null,
      ariaDescribedBy: element.getAttribute('aria-describedby') || null,
      ariaChecked: element.getAttribute('aria-checked'),
      ariaSelected: element.getAttribute('aria-selected'),
      ariaExpanded: element.getAttribute('aria-expanded'),
      ariaControls: element.getAttribute('aria-controls'),
      ariaOwns: element.getAttribute('aria-owns'),
      ariaAutocomplete: element.getAttribute('aria-autocomplete'),
      ariaActivedescendant: element.getAttribute('aria-activedescendant'),
      ariaMultiselectable: element.getAttribute('aria-multiselectable'),
      ariaHaspopup: element.getAttribute('aria-haspopup'),
      listboxOwnerId: listboxOwner?.id || null,
      listboxOwnerSelector: listboxTarget?.selector || null,
      className: typeof element.className === 'string' ? clean(element.className, 500) || null : null,
      hidden: Boolean(element.hidden),
      visible: visible(element),
      tag,
      type,
      text,
      label: labelText(element) || element.getAttribute('placeholder') || element.getAttribute('name') || element.getAttribute('aria-label') || text || null,
      placeholder: element.getAttribute('placeholder') || null,
      required: element.required === true,
      disabled: element.disabled === true || element.getAttribute('aria-disabled') === 'true',
      readonly: element.readOnly === true || element.getAttribute('aria-readonly') === 'true',
      multiple: element.multiple === true,
      contenteditable: element.isContentEditable === true,
      tabIndex: Number.isFinite(Number(element.tabIndex)) ? Number(element.tabIndex) : null,
      min: element.getAttribute('min'), max: element.getAttribute('max'), step: element.getAttribute('step'),
      minlength: element.getAttribute('minlength'), maxlength: element.getAttribute('maxlength'), pattern: element.getAttribute('pattern'),
      autocomplete: element.getAttribute('autocomplete'), inputmode: element.getAttribute('inputmode'), list: element.getAttribute('list'),
      accept: element.getAttribute('accept'), capture: element.getAttribute('capture'), href: element.getAttribute('href'), target: element.getAttribute('target'),
      alt: element.getAttribute('alt'), src: element.getAttribute('src'), draggable: element.draggable === true || element.getAttribute('draggable') === 'true',
      nativeDropTarget: element.hasAttribute('ondrop') || element.hasAttribute('dropzone') || typeof element.ondrop === 'function',
      fileDropTarget: false,
      clickEvidence: element.hasAttribute('onclick') || typeof element.onclick === 'function',
      ...formMetadata(element),
    };
    if (['input','select','textarea'].includes(tag)) result.errorElement = errorElement(element);
    if (tag === 'select') result.options = Array.from(element.options || []).slice(0, 150).map((option) => ({ value: option.value, label: clean(option.textContent, 300), disabled: option.disabled === true || option.closest?.('optgroup')?.disabled === true, selected: option.selected === true }));
    if (tag === 'datalist') result.options = Array.from(element.options || []).slice(0, 150).map((option) => ({ value: option.value, label: clean(option.label || option.textContent || option.value, 300), disabled: false, selected: false }));
    if (tag === 'input' && element.getAttribute('list')) {
      const datalist = document.getElementById(element.getAttribute('list'));
      if (datalist?.tagName?.toLowerCase() === 'datalist') {
        result.suggestions = Array.from(datalist.options || []).slice(0, 150).map((option) => ({ value: option.value, text: clean(option.label || option.textContent || option.value, 300), disabled: false }));
        result.suggestionSource = 'datalist';
      }
    }
    if (type === 'radio' || type === 'checkbox') { result.controlValue = element.value || null; result.checked = Boolean(element.checked); }
    if (type === 'range') result.rangeValue = element.value || null;
    if (tag === 'img') { result.complete = element.complete === true; result.naturalWidth = Number(element.naturalWidth || 0); result.naturalHeight = Number(element.naturalHeight || 0); }
    if (tag === 'video' || tag === 'audio') { result.mediaReadyState = Number(element.readyState || 0); result.duration = Number.isFinite(Number(element.duration)) ? Number(element.duration) : null; }
    return result;
  }

  const elements = [];
  const seen = new Set();
  for (const entry of collect()) {
    const item = serialize(entry);
    if (!item?.selector) continue;
    const key = `${item.shadowHostSelector || 'light'}|${item.selector}`;
    if (seen.has(key)) continue;
    seen.add(key);
    elements.push(item);
    if (elements.length >= MAX_ELEMENTS) break;
  }

  const messages = elements.filter((item) => {
    const signature = [item.role, item.id, item.testId, item.className].filter(Boolean).join(' ').toLowerCase();
    return ['alert','status'].includes(String(item.role || '').toLowerCase()) || /(error|success|validation|message|notice)/.test(signature);
  }).map((item) => ({ ...item, text: item.text || null }));

  const routeHints = [];
  const routeSeen = new Set();
  for (const item of elements) {
    if (item.tag !== 'a' || !item.href) continue;
    try {
      const base = new URL(location.href);
      const url = new URL(item.href, base);
      if (!['http:','https:'].includes(url.protocol) || url.origin !== base.origin || url.pathname.startsWith('/api/') || SKIP_EXTENSIONS.test(url.pathname + url.search)) continue;
      url.hash = '';
      const normalized = url.toString();
      if (!routeSeen.has(normalized)) { routeSeen.add(normalized); routeHints.push(normalized); }
    } catch {}
  }

  const cookieNames = String(document.cookie || '').split(';').map((part) => part.split('=')[0].trim()).filter(Boolean).slice(0, 100);
  const localStorageKeys = [];
  const sessionStorageKeys = [];
  try { for (let i = 0; i < localStorage.length && localStorageKeys.length < 100; i += 1) localStorageKeys.push(String(localStorage.key(i))); } catch {}
  try { for (let i = 0; i < sessionStorage.length && sessionStorageKeys.length < 100; i += 1) sessionStorageKeys.push(String(sessionStorage.key(i))); } catch {}

  return {
    url: location.href,
    finalUrl: location.href,
    pageTitle: clean(document.title || document.querySelector('h1')?.textContent || location.href, 500),
    documentLanguage: document.documentElement.lang || null,
    meta: Array.from(document.querySelectorAll('meta[name]')).slice(0, 50).map((el) => ({ name: el.getAttribute('name'), content: el.getAttribute('content') || '' })),
    elements,
    messages,
    routeHints,
    networkHints: [],
    browserState: { cookieNames: [...new Set(cookieNames)], localStorageKeys: [...new Set(localStorageKeys.filter(Boolean))], sessionStorageKeys: [...new Set(sessionStorageKeys.filter(Boolean))] },
    capabilityDiscovery: { scannedElements: Math.min(document.querySelectorAll('*').length, MAX_SCAN), capturedElements: elements.length, maxElements: MAX_ELEMENTS, openShadowDom: elements.some((item) => item.shadowDom === true) },
    discoveryEngine: 'BROWSER_RENDERED_DOM_V3',
    discoveryTransport: 'DIRECT_CHROME_CDP',
  };
}

function waitForQuietDomExpression(maxSettleMs, quietMs) {
  return `new Promise((resolve) => {\n    let done = false;\n    let quietTimer = null;\n    const finish = () => { if (done) return; done = true; clearTimeout(quietTimer); clearTimeout(maxTimer); observer.disconnect(); resolve(true); };\n    const arm = () => { clearTimeout(quietTimer); quietTimer = setTimeout(finish, ${Math.max(100, quietMs)}); };\n    const observer = new MutationObserver(arm);\n    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });\n    const maxTimer = setTimeout(finish, ${Math.max(1000, maxSettleMs)});\n    arm();\n  })`;
}

async function discoverPageWithDirectChrome(targetUrl, options = {}) {
  const parsed = new URL(String(targetUrl || ''));
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    const error = new Error('Direct Chrome discovery requires an http:// or https:// URL.');
    error.code = 'DIRECT_CHROME_URL_INVALID';
    throw error;
  }

  const chromePath = resolveChrome();
  if (!chromePath) {
    const error = new Error('Google Chrome/Chromium is unavailable for direct rendered discovery. Set CHROME_PATH if it is installed in a non-standard location.');
    error.code = 'DIRECT_CHROME_NOT_FOUND';
    throw error;
  }

  const pageLoadTimeoutMs = Math.max(10000, Math.min(Number(options.pageLoadTimeoutMs || 30000), 60000));
  const maxSettleMs = Math.max(1000, Math.min(Number(options.maxSettleMs || process.env.DIRECT_CHROME_DISCOVERY_SETTLE_MS || 6000), 15000));
  const quietMs = Math.max(100, Math.min(Number(options.quietMs || 450), 2000));
  const launched = await launchChrome(chromePath, Math.min(pageLoadTimeoutMs, 15000));
  const client = new CdpClient(launched.browserWsUrl);
  let targetId = null;

  try {
    await client.open();
    const created = await client.send('Target.createTarget', { url: 'about:blank' });
    targetId = created.targetId;
    const attached = await client.send('Target.attachToTarget', { targetId, flatten: true });
    const sessionId = attached.sessionId;
    const requests = new Map();

    client.onEvent((message) => {
      if (message.sessionId !== sessionId) return;
      if (message.method === 'Network.requestWillBeSent') {
        const request = message.params?.request || {};
        requests.set(message.params?.requestId, { method: request.method || 'GET', url: request.url || '', status: null, responseHeaders: {} });
      } else if (message.method === 'Network.responseReceived') {
        const response = message.params?.response || {};
        const current = requests.get(message.params?.requestId) || { method: 'GET', url: response.url || '', status: null, responseHeaders: {} };
        current.url = response.url || current.url;
        current.status = Number.isFinite(Number(response.status)) ? Number(response.status) : null;
        current.responseHeaders = safeHeaders(response.headers || {});
        requests.set(message.params?.requestId, current);
      }
    });

    await Promise.all([
      client.send('Page.enable', {}, sessionId),
      client.send('Runtime.enable', {}, sessionId),
      client.send('Network.enable', {}, sessionId),
    ]);

    if (boolEnv(process.env.DIRECT_CHROME_IGNORE_CERT_ERRORS, false)) {
      await client.send('Security.enable', {}, sessionId).catch(() => {});
      await client.send('Security.setIgnoreCertificateErrors', { ignore: true }, sessionId).catch(() => {});
    }

    const loadPromise = client.waitForEvent('Page.loadEventFired', sessionId, pageLoadTimeoutMs);
    const navigation = await client.send('Page.navigate', { url: parsed.toString() }, sessionId, pageLoadTimeoutMs);
    if (navigation.errorText) {
      const error = new Error(`Chrome navigation failed: ${navigation.errorText}`);
      error.code = 'DIRECT_CHROME_NAVIGATION_FAILED';
      throw error;
    }
    await loadPromise;

    await client.send('Runtime.evaluate', {
      expression: waitForQuietDomExpression(maxSettleMs, quietMs),
      awaitPromise: true,
      returnByValue: true,
    }, sessionId, maxSettleMs + 3000);

    const evaluated = await client.send('Runtime.evaluate', {
      expression: `(${serializeRenderedDocument.toString()})()`,
      awaitPromise: true,
      returnByValue: true,
    }, sessionId, 15000);
    if (evaluated.exceptionDetails) {
      const error = new Error(evaluated.exceptionDetails?.text || 'Chrome failed to serialize the rendered DOM.');
      error.code = 'DIRECT_CHROME_SERIALIZATION_FAILED';
      throw error;
    }

    const page = evaluated.result?.value;
    if (!page || !Array.isArray(page.elements)) {
      const error = new Error('Chrome completed navigation but did not return a grounded rendered page snapshot.');
      error.code = 'DIRECT_CHROME_SNAPSHOT_MISSING';
      throw error;
    }

    const finalUrl = page.finalUrl || page.url || parsed.toString();
    const pageOrigin = new URL(finalUrl).origin;
    const networkMap = new Map();
    for (const request of requests.values()) {
      try {
        const url = new URL(request.url, finalUrl);
        if (url.origin !== pageOrigin) continue;
        const requestPath = `${url.pathname}${url.search}` || '/';
        const method = String(request.method || 'GET').toUpperCase();
        if (!['POST','PUT','PATCH','DELETE'].includes(method) && !/^\/(?:api|graphql|rest)\b/i.test(requestPath)) continue;
        const hint = { method, url: requestPath, status: request.status, responseHeaders: request.responseHeaders || {}, source: 'browser-network' };
        networkMap.set(`${method} ${requestPath}`, hint);
      } catch {}
    }
    page.networkHints = [...networkMap.values()];
    return { ...page, discoveryBrowser: 'chrome', discoveryTransport: 'DIRECT_CHROME_CDP' };
  } catch (error) {
    error.chromePath = chromePath;
    error.terminalTail = cleanTerminal(launched.stderr());
    throw error;
  } finally {
    if (targetId) await client.send('Target.closeTarget', { targetId }).catch(() => {});
    client.close();
    await terminateProcessTree(launched.child).catch(() => {});
    try { fs.rmSync(launched.profileDir, { recursive: true, force: true }); } catch {}
  }
}

module.exports = {
  discoverPageWithDirectChrome,
  resolveChrome,
  serializeRenderedDocument,
  waitForQuietDomExpression,
};
