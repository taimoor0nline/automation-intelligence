const v3 = require('./deterministicAutomationGeneratorV3');

function js(value) { return JSON.stringify(value); }
function num(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${label} must be numeric.`);
  return n;
}
function safeToken(value) {
  return String(value || 'visual').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'visual';
}

function emitPermissionPatch(permission, state) {
  const p = js(permission);
  const s = js(state);
  const patch = `(win) => { const name=${p}, state=${s}; win.__testNexusPermissionStates=win.__testNexusPermissionStates||{}; win.__testNexusPermissionStates[name]=state; const original=win.navigator.permissions&&win.navigator.permissions.query?win.navigator.permissions.query.bind(win.navigator.permissions):null; if(win.navigator.permissions){ win.navigator.permissions.query=(descriptor)=>{ const requested=String(descriptor&&descriptor.name||''); if(Object.prototype.hasOwnProperty.call(win.__testNexusPermissionStates,requested)) return Promise.resolve({state:win.__testNexusPermissionStates[requested], onchange:null, addEventListener(){}, removeEventListener(){}}); return original?original(descriptor):Promise.resolve({state:'prompt'}); }; } }`;
  return `    { const __patchPermission=${patch}; Cypress.once('window:before:load', __patchPermission); cy.window({ log:false }).then((win) => __patchPermission(win)); }`;
}

function emitAdvancedAction(action) {
  switch (action.operation) {
    case 'SELECT_FILE':
      return `    cy.task('testNexusResolveUploadFixture', ${js(action.fileName)}, { log:false }).then((filePath) => cy.get(${js(action.selector)}).selectFile(filePath));`;
    case 'DRAG_DROP':
      return `    cy.get(${js(action.sourceSelector)}).then(($source) => cy.get(${js(action.targetSelector)}).then(($target) => { const dataTransfer = new DataTransfer(); cy.wrap($source).trigger('dragstart', { dataTransfer, force:true }); cy.wrap($target).trigger('dragenter', { dataTransfer, force:true }).trigger('dragover', { dataTransfer, force:true }).trigger('drop', { dataTransfer, force:true }); cy.wrap($source).trigger('dragend', { dataTransfer, force:true }); }));`;
    case 'SET_PERMISSION_STATE':
      return emitPermissionPatch(action.permission, action.state);
    case 'EXTERNAL_ADAPTER_ACTION':
      return `    cy.task('testNexusExternalAdapter', ${js({ capability: action.capability, action: action.action, payload: action.payload || {} })}, { log:false }).then((result) => { expect(result && result.ok, ${js(`${action.capability} adapter action`)}).to.eq(true); });`;
    default:
      return v3.emitAction(action);
  }
}

function emitAdvancedAssertion(assertion) {
  switch (assertion.operation) {
    case 'ASSERT_VISUAL_MATCH': {
      const actualName = `visual-${safeToken(assertion.baselineName)}`;
      const screenshot = assertion.selector && assertion.selector !== 'body'
        ? `cy.get(${js(assertion.selector)}).screenshot(${js(actualName)}, { overwrite:true, log:false });`
        : `cy.screenshot(${js(actualName)}, { capture:'viewport', overwrite:true, log:false });`;
      return `    ${screenshot}\n    cy.task('testNexusCompareVisual', ${js({ actualName, baselineName: assertion.baselineName, threshold: Number(assertion.threshold || 0.1), maxDiffRatio: Number(assertion.maxDiffRatio || 0) })}, { log:false }).then((result) => { expect(result && result.matched, JSON.stringify(result || {})).to.eq(true); });`;
    }
    case 'ASSERT_WEB_VITAL_AT_MOST':
      return `    cy.window().should((win) => { const value = Number(win.__testNexusWebVitals && win.__testNexusWebVitals[${js(assertion.metric)}]); expect(Number.isFinite(value), ${js(`${assertion.metric} metric available`)}).to.eq(true); expect(value).to.be.at.most(${num(assertion.max, 'Web Vital threshold')}); });`;
    case 'ASSERT_EXTERNAL_MESSAGE_RECEIVED':
      return `    cy.task('testNexusExternalAdapter', ${js({ capability: 'EMAIL_SMS_OTP', action: 'assert-message', payload: { channel: assertion.channel, contains: assertion.contains || '', description: assertion.description || '' } })}, { log:false }).then((result) => { expect(result && result.ok, JSON.stringify(result || {})).to.eq(true); });`;
    case 'ASSERT_DATABASE_VALUE_EQUALS':
      return `    cy.task('testNexusDatabaseAssertion', ${js({ queryName: assertion.queryName, params: assertion.params || [] })}, { log:false }).then((result) => { const value = result && result.first ? result.first[${js(assertion.field)}] : undefined; expect(String(value ?? '')).to.eq(${js(assertion.value)}); });`;
    case 'ASSERT_DATABASE_ROW_COUNT_EQUALS':
      return `    cy.task('testNexusDatabaseAssertion', ${js({ queryName: assertion.queryName, params: assertion.params || [] })}, { log:false }).then((result) => { expect(Number(result && result.rowCount || 0)).to.eq(${num(assertion.count, 'database row count')}); });`;
    case 'ASSERT_STREAM_MESSAGE_CONTAINS':
      return `    cy.window().should((win) => { const items = Array.isArray(win.__testNexusStreamMessages) ? win.__testNexusStreamMessages : []; const found = items.some((item) => String(item.transport) === ${js(assertion.transport)} && (!${js(assertion.urlFragment || '')} || String(item.url || '').includes(${js(assertion.urlFragment || '')})) && String(item.data ?? '').includes(${js(assertion.value)})); expect(found, JSON.stringify(items)).to.eq(true); });`;
    case 'ASSERT_CLIPBOARD_EQUALS':
      return `    cy.window().should((win) => { const writes = Array.isArray(win.__testNexusClipboardWrites) ? win.__testNexusClipboardWrites : []; expect(String(writes[writes.length - 1] ?? '')).to.eq(${js(assertion.value)}); });`;
    case 'ASSERT_CLIPBOARD_CONTAINS':
      return `    cy.window().should((win) => { const writes = Array.isArray(win.__testNexusClipboardWrites) ? win.__testNexusClipboardWrites : []; expect(String(writes[writes.length - 1] ?? '')).to.include(${js(assertion.value)}); });`;
    case 'ASSERT_DOWNLOADED_DOCUMENT_CONTAINS':
      return `    cy.task('testNexusExtractDownloadedDocument', ${js({ fileName: assertion.fileName })}, { log:false }).then((result) => { expect(String(result && result.text || '')).to.include(${js(assertion.value)}); });`;
    case 'ASSERT_BROWSER_PERMISSION_EQUALS':
      return `    cy.window().then((win) => win.navigator.permissions.query({ name: ${js(assertion.permission)} })).its('state').should('eq', ${js(assertion.state)});`;
    case 'ASSERT_EXTERNAL_ADAPTER':
      return `    cy.task('testNexusExternalAdapter', ${js({ capability: assertion.capability, action: 'assert', payload: assertion.payload || { expectation: assertion.description || '' } })}, { log:false }).then((result) => { expect(result && result.ok, JSON.stringify(result || {})).to.eq(true); });`;
    default:
      return v3.emitAssertion(assertion);
  }
}

function advancedObserverSetup(plan) {
  const operations = new Set((plan.assertions || []).map((item) => item.operation));
  const lines = [];

  if (operations.has('ASSERT_WEB_VITAL_AT_MOST')) {
    lines.push(
      "    cy.on('window:before:load', (win) => {",
      "      win.__testNexusWebVitals = { LCP: null, CLS: 0, INP: null };",
      "      if (typeof win.PerformanceObserver !== 'function') return;",
      "      try { const lcp = new win.PerformanceObserver((list) => { const entries=list.getEntries(); const last=entries[entries.length-1]; if(last) win.__testNexusWebVitals.LCP=Number(last.startTime||last.renderTime||last.loadTime||0); }); lcp.observe({ type:'largest-contentful-paint', buffered:true }); } catch {}",
      "      try { const cls = new win.PerformanceObserver((list) => { for(const entry of list.getEntries()) if(!entry.hadRecentInput) win.__testNexusWebVitals.CLS += Number(entry.value||0); }); cls.observe({ type:'layout-shift', buffered:true }); } catch {}",
      "      try { const inp = new win.PerformanceObserver((list) => { for(const entry of list.getEntries()) if(Number(entry.interactionId||0)>0) win.__testNexusWebVitals.INP=Math.max(Number(win.__testNexusWebVitals.INP||0), Number(entry.duration||0)); }); inp.observe({ type:'event', buffered:true, durationThreshold:16 }); } catch {}",
      "    });"
    );
  }

  if (operations.has('ASSERT_STREAM_MESSAGE_CONTAINS')) {
    lines.push(
      "    cy.on('window:before:load', (win) => {",
      "      win.__testNexusStreamMessages = [];",
      "      const NativeWebSocket = win.WebSocket;",
      "      if (typeof NativeWebSocket === 'function') { const WrappedWebSocket = function(...args){ const socket=new NativeWebSocket(...args); socket.addEventListener('message',(event)=>win.__testNexusStreamMessages.push({transport:'WEBSOCKET',url:String(args[0]||''),data:String(event.data??'')})); return socket; }; WrappedWebSocket.prototype=NativeWebSocket.prototype; Object.setPrototypeOf(WrappedWebSocket, NativeWebSocket); win.WebSocket=WrappedWebSocket; }",
      "      const NativeEventSource = win.EventSource;",
      "      if (typeof NativeEventSource === 'function') { const WrappedEventSource = function(...args){ const source=new NativeEventSource(...args); source.addEventListener('message',(event)=>win.__testNexusStreamMessages.push({transport:'SSE',url:String(args[0]||''),data:String(event.data??'')})); return source; }; WrappedEventSource.prototype=NativeEventSource.prototype; Object.setPrototypeOf(WrappedEventSource, NativeEventSource); win.EventSource=WrappedEventSource; }",
      "    });"
    );
  }

  if (operations.has('ASSERT_CLIPBOARD_EQUALS') || operations.has('ASSERT_CLIPBOARD_CONTAINS')) {
    lines.push(
      "    cy.on('window:before:load', (win) => {",
      "      win.__testNexusClipboardWrites = [];",
      "      const existing = win.navigator.clipboard || {};",
      "      const clipboard = { ...existing, writeText: async (value) => { win.__testNexusClipboardWrites.push(String(value??'')); return undefined; }, readText: async () => String(win.__testNexusClipboardWrites[win.__testNexusClipboardWrites.length-1]??'') };",
      "      try { Object.defineProperty(win.navigator, 'clipboard', { configurable:true, value:clipboard }); } catch {}",
      "    });"
    );
  }

  return lines;
}

function observerSetup(plan) {
  return [...v3.observerSetup(plan), ...advancedObserverSetup(plan)];
}

function generateDeterministicAutomation(approvedTestCases = []) {
  if (!approvedTestCases.length) throw new Error('No approved test cases were supplied for deterministic generation.');
  const lines = ["describe('AI TestPilot Approved Test Suite', () => {"];
  for (const testCase of approvedTestCases) {
    const plan = testCase?.automationReadiness?.automationPlan;
    if (!plan) throw new Error(`${testCase.id} has no compiled automation plan.`);
    lines.push(`  it(${js(`${testCase.id} - ${testCase.title}`)}, () => {`);
    const setup = observerSetup(plan);
    if (setup.length) lines.push(...setup, '');
    for (const action of plan.actions || []) lines.push(emitAdvancedAction(action));
    lines.push('');
    for (const assertion of plan.assertions || []) lines.push(emitAdvancedAssertion(assertion));
    lines.push('  });', '');
  }
  lines.push('});', '');
  return { fileName: 'ai-generated.cy.js', framework: 'browser-automation', language: 'javascript', generationMode: 'deterministic-dsl-v4-advanced', script: lines.join('\n') };
}

module.exports = {
  ...v3,
  generateDeterministicAutomation,
  emitAction: emitAdvancedAction,
  emitAssertion: emitAdvancedAssertion,
  observerSetup,
  advancedObserverSetup,
};
