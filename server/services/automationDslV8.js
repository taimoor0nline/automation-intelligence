const fs = require('fs');
const path = require('path');
const v7 = require('./automationDslV7');
const { ASSERTION_OPERATIONS } = require('./assertionRegistry');

const ADVANCED_ACTION_OPERATIONS = Object.freeze([
  'SELECT_FILE',
  'DRAG_DROP',
  'SET_PERMISSION_STATE',
  'EXTERNAL_ADAPTER_ACTION',
]);

function clean(value) { return String(value ?? '').trim(); }
function lower(value) { return clean(value).toLowerCase(); }
function quotedValues(text) {
  const out = [];
  const regex = /["'`]([^"'`]+)["'`]/g;
  let match;
  while ((match = regex.exec(String(text || ''))) !== null) out.push(match[1]);
  return out;
}
function explicitSelector(text) {
  return String(text || '').match(/\[data-testid=(?:"[^"]+"|'[^']+')\]|#[A-Za-z0-9_-]+|\.[A-Za-z][A-Za-z0-9_-]*|\[name=(?:"[^"]+"|'[^']+')\]/)?.[0] || '';
}
function safeFileName(value) {
  const name = clean(value);
  return Boolean(name && !name.includes('..') && !/[\\/]/.test(name));
}
function boolEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return !['false','0','no','off'].includes(String(value).toLowerCase());
}
function externalCapabilities() {
  return new Set(String(process.env.AUTOMATION_EXTERNAL_CAPABILITIES || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean));
}
function externalConfigured(capability) {
  if (!clean(process.env.AUTOMATION_EXTERNAL_ADAPTER_URL)) return false;
  const configured = externalCapabilities();
  return !configured.size || configured.has(String(capability || '').toUpperCase());
}
function adapterCapabilityForText(text) {
  const source = lower(text);
  if (/cross[- ]origin.*iframe|iframe.*cross[- ]origin/.test(source)) return 'CROSS_ORIGIN_IFRAME';
  if (/new\s+(?:tab|window)|second\s+(?:tab|window)|multi[- ]tab/.test(source)) return 'REAL_MULTI_TAB';
  if (/captcha|recaptcha|hcaptcha|biometric|fingerprint|face\s?id|touch\s?id/.test(source)) return 'CAPTCHA_BIOMETRIC';
  if (/native\s+mobile|android\s+app|ios\s+app|mobile\s+app/.test(source)) return 'NATIVE_MOBILE';
  if (/browser\s+extension|extension\s+popup|extension\s+ui/.test(source)) return 'BROWSER_EXTENSION';
  if (/native\s+(?:os\s+)?dialog|windows\s+(?:dialog|prompt)|os\s+(?:dialog|prompt)|native\s+file\s+(?:dialog|picker)/.test(source)) return 'OS_DIALOG';
  return '';
}

function parseUploadStep(step, discovery) {
  const action = lower(step?.action);
  if (!/upload|select\s+file|attach\s+file/.test(action)) return null;
  const selector = clean(step?.target);
  const fileName = clean(step?.value);
  if (!selector || !discovery.selectors.has(selector)) return { error: `Upload target is not grounded by discovery: ${selector || 'missing selector'}` };
  if (!safeFileName(fileName)) return { error: 'File upload requires a safe fixture file name without a path.' };
  return { action: { operation: 'SELECT_FILE', selector, fileName } };
}

function parseDragDropStep(step, discovery) {
  const action = clean(step?.action);
  if (!/drag|drop/i.test(action)) return null;
  const source = clean(step?.target);
  const target = clean(step?.value) || explicitSelector(action.replace(source, ''));
  if (!source || !discovery.selectors.has(source)) return { error: `Drag source is not grounded by discovery: ${source || 'missing selector'}` };
  if (!target || !discovery.selectors.has(target)) return { error: `Drop target is not grounded by discovery: ${target || 'missing selector'}` };
  return { action: { operation: 'DRAG_DROP', sourceSelector: source, targetSelector: target } };
}

function parsePermissionStep(step) {
  const action = clean(step?.action);
  if (!/permission/i.test(action) || !/(set|grant|deny|prompt|allow|block)/i.test(action)) return null;
  const permission = clean(step?.target) || action.match(/(?:permission\s+)(geolocation|camera|microphone|notifications?|clipboard-read|clipboard-write)/i)?.[1] || '';
  let state = lower(step?.value);
  if (!state) state = /deny|block/i.test(action) ? 'denied' : /prompt/i.test(action) ? 'prompt' : 'granted';
  if (!['granted','denied','prompt'].includes(state)) return { error: `Permission state must be granted, denied or prompt: ${state || 'missing'}` };
  if (!permission) return { error: 'Permission simulation requires a permission name.' };
  return { action: { operation: 'SET_PERMISSION_STATE', permission, state } };
}

function parseExternalAction(step) {
  const capability = adapterCapabilityForText(`${step?.action || ''} ${step?.target || ''}`);
  if (!capability) return null;
  return {
    requirement: capability,
    action: {
      operation: 'EXTERNAL_ADAPTER_ACTION',
      capability,
      action: clean(step?.action) || 'execute',
      payload: { target: clean(step?.target), value: step?.value ?? null },
    },
  };
}

function parseVisualExpectation(text, discovery) {
  const source = String(text || '');
  if (!/(visual\s+regression|pixel\s+diff|screenshot\s+(?:matches?|equals?)|visual\s+(?:matches?|equals?))/i.test(source)) return null;
  const selector = explicitSelector(source) || 'body';
  if (selector !== 'body' && !discovery.selectors.has(selector)) return { error: `Visual assertion selector is not grounded by discovery: ${selector}` };
  const values = quotedValues(source);
  const baselineName = values.find((value) => /\.png$/i.test(value)) || values[values.length - 1] || 'baseline.png';
  if (!safeFileName(baselineName)) return { error: 'Visual baseline must be a safe PNG file name.' };
  const ratio = source.match(/(?:max(?:imum)?\s+diff|difference)\s*(?:<=|at most|of)?\s*(\d+(?:\.\d+)?)\s*%/i)?.[1];
  return { assertion: { operation: 'ASSERT_VISUAL_MATCH', selector, baselineName, maxDiffRatio: ratio ? Number(ratio) / 100 : 0, threshold: 0.1 } };
}

function parseWebVitalExpectation(text) {
  const source = String(text || '');
  const metric = source.match(/\b(LCP|CLS|INP)\b/i)?.[1]?.toUpperCase();
  if (!metric || !/(?:<=|at most|maximum|max|under|below|no more than)/i.test(source)) return null;
  const number = source.match(/(?:<=|at most|maximum|max|under|below|no more than)\s*(\d+(?:\.\d+)?)/i)?.[1]
    || source.match(/\b(?:LCP|CLS|INP)\b[^\d]*(\d+(?:\.\d+)?)/i)?.[1];
  if (number == null) return { error: `${metric} assertion requires a numeric threshold.` };
  let max = Number(number);
  if (metric !== 'CLS' && /\bseconds?|\bsec\b|\bs\b/i.test(source) && !/ms|millisecond/i.test(source)) max *= 1000;
  return { assertion: { operation: 'ASSERT_WEB_VITAL_AT_MOST', metric, max } };
}

function parseExternalMessageExpectation(text) {
  const source = String(text || '');
  if (!/\b(email|e-mail|sms|text\s+message|otp)\b/i.test(source) || !/receiv|deliver|arriv/i.test(source)) return null;
  const channel = /sms|text\s+message|otp/i.test(source) ? 'SMS' : 'EMAIL';
  const quoted = quotedValues(source);
  return { requirement: 'EMAIL_SMS_OTP', assertion: { operation: 'ASSERT_EXTERNAL_MESSAGE_RECEIVED', channel, contains: quoted[quoted.length - 1] || '', description: source } };
}

function parseDatabaseExpectation(text) {
  const source = String(text || '');
  if (!/\b(database|db|sql)\b/i.test(source)) return null;
  const queryName = source.match(/(?:query|assertion|check)\s+["'`]([^"'`]+)["'`]/i)?.[1];
  if (!queryName) return null;
  const rowCount = source.match(/row\s+count\s+(?:is|equals?|=|exactly)\s*(\d+)/i)?.[1];
  if (rowCount != null) return { requirement: 'DATABASE_ASSERTIONS', assertion: { operation: 'ASSERT_DATABASE_ROW_COUNT_EQUALS', queryName, count: Number(rowCount) } };
  const fieldMatch = source.match(/field\s+["'`]([^"'`]+)["'`]\s+(?:is|equals?|=)\s+["'`]([^"'`]*)["'`]/i);
  if (fieldMatch) return { requirement: 'DATABASE_ASSERTIONS', assertion: { operation: 'ASSERT_DATABASE_VALUE_EQUALS', queryName, field: fieldMatch[1], value: fieldMatch[2] } };
  return { error: 'Database assertions must use a named query and either an expected row count or expected field value.' };
}

function parseStreamExpectation(text) {
  const source = String(text || '');
  const transport = /websocket|web\s*socket/i.test(source) ? 'WEBSOCKET' : /eventsource|server[- ]sent|\bsse\b/i.test(source) ? 'SSE' : '';
  if (!transport || !/(message|event|payload).*(contain|include|equal)|contain|include/i.test(source)) return null;
  const quoted = quotedValues(source);
  const expected = quoted[quoted.length - 1] || '';
  if (!expected) return { error: `${transport} assertion requires expected message content in quotes.` };
  const urlFragment = source.match(/(?:url|endpoint|stream)\s+["'`]([^"'`]+)["'`]/i)?.[1] || '';
  return { assertion: { operation: 'ASSERT_STREAM_MESSAGE_CONTAINS', transport, value: expected, urlFragment } };
}

function parseClipboardExpectation(text) {
  const source = String(text || '');
  if (!/clipboard/i.test(source)) return null;
  const quoted = quotedValues(source);
  const expected = quoted[quoted.length - 1] || '';
  if (!expected) return { error: 'Clipboard assertion requires expected text in quotes.' };
  return { assertion: { operation: /contain|include/i.test(source) ? 'ASSERT_CLIPBOARD_CONTAINS' : 'ASSERT_CLIPBOARD_EQUALS', value: expected } };
}

function parseDocumentExpectation(text) {
  const source = String(text || '');
  const fileName = source.match(/["'`]([^"'`]+\.(?:pdf|docx?|xlsx?|pptx|txt|csv|json|xml|html))["'`]/i)?.[1]
    || source.match(/\b([A-Za-z0-9][A-Za-z0-9._ -]*\.(?:pdf|docx?|xlsx?|pptx|txt|csv|json|xml|html))\b/i)?.[1];
  if (!fileName || !/(contain|include|content|text)/i.test(source)) return null;
  const values = quotedValues(source).filter((value) => value !== fileName);
  const expected = values[values.length - 1] || '';
  if (!expected) return { error: 'Downloaded document content assertion requires expected semantic text in quotes.' };
  return { assertion: { operation: 'ASSERT_DOWNLOADED_DOCUMENT_CONTAINS', fileName, value: expected } };
}

function parsePermissionExpectation(text) {
  const source = String(text || '');
  if (!/permission/i.test(source)) return null;
  const permission = source.match(/permission\s+["'`]([^"'`]+)["'`]/i)?.[1]
    || source.match(/\b(geolocation|camera|microphone|notifications?|clipboard-read|clipboard-write)\b/i)?.[1];
  const state = source.match(/\b(granted|denied|prompt)\b/i)?.[1]?.toLowerCase();
  if (!permission || !state) return null;
  return { assertion: { operation: 'ASSERT_BROWSER_PERMISSION_EQUALS', permission, state } };
}

function parseExternalExpectation(text) {
  const capability = adapterCapabilityForText(text);
  if (!capability) return null;
  return { requirement: capability, assertion: { operation: 'ASSERT_EXTERNAL_ADAPTER', capability, description: String(text || ''), payload: { expectation: String(text || '') } } };
}

function parseAdvancedExpectation(text, discovery) {
  return parseVisualExpectation(text, discovery)
    || parseWebVitalExpectation(text)
    || parseExternalMessageExpectation(text)
    || parseDatabaseExpectation(text)
    || parseStreamExpectation(text)
    || parseClipboardExpectation(text)
    || parseDocumentExpectation(text)
    || parsePermissionExpectation(text)
    || parseExternalExpectation(text);
}

function configurationError(requirement, assertion) {
  if (!requirement) return '';
  if (requirement === 'DATABASE_ASSERTIONS') {
    if (!boolEnv(process.env.AUTOMATION_DB_ASSERTIONS_ENABLED, false) || !clean(process.env.AUTOMATION_DB_ASSERTION_URL)) {
      return 'Database assertion capability requires AUTOMATION_DB_ASSERTIONS_ENABLED=true and AUTOMATION_DB_ASSERTION_URL.';
    }
    let queries = {};
    try { queries = JSON.parse(process.env.AUTOMATION_DB_ASSERTION_QUERIES_JSON || '{}'); } catch { return 'AUTOMATION_DB_ASSERTION_QUERIES_JSON is invalid JSON.'; }
    if (assertion?.queryName && !queries[assertion.queryName]) return `Named database assertion query is not configured: ${assertion.queryName}`;
    return '';
  }
  if (!externalConfigured(requirement)) return `Capability ${requirement} requires AUTOMATION_EXTERNAL_ADAPTER_URL and, when restricted, inclusion in AUTOMATION_EXTERNAL_CAPABILITIES.`;
  return '';
}

function firstPath(discovery) {
  return [...(discovery.paths || [])][0] || '/';
}

function syntheticExpectedFor(steps, discovery) {
  const selector = steps.map((step) => clean(step?.target)).find((target) => target && discovery.selectors.has(target));
  if (selector) return `Element ${selector} exists`;
  const pathValue = firstPath(discovery);
  return `Path equals "${pathValue.split('?')[0] || '/'}"`;
}

function compileTestCase(testCase, context = {}) {
  const discovery = v7.buildDiscoveryIndex(context.pageDiscoveries || []);
  const baseSteps = [];
  const baseExpected = [];
  const advancedActions = [];
  const advancedAssertions = [];
  const requirements = [];
  const errors = [];

  for (const step of testCase?.steps || []) {
    const parsed = parseUploadStep(step, discovery) || parseDragDropStep(step, discovery) || parsePermissionStep(step) || parseExternalAction(step);
    if (!parsed) baseSteps.push(step);
    else if (parsed.error) errors.push(parsed.error);
    else {
      if (parsed.requirement) requirements.push({ requirement: parsed.requirement, subject: parsed.action });
      if (parsed.action) advancedActions.push(parsed.action);
    }
  }

  for (const expected of testCase?.expectedResults || []) {
    const parsed = parseAdvancedExpectation(expected, discovery);
    if (!parsed) baseExpected.push(expected);
    else if (parsed.error) errors.push(parsed.error);
    else {
      if (parsed.requirement) requirements.push({ requirement: parsed.requirement, subject: parsed.assertion });
      if (parsed.assertion) advancedAssertions.push(parsed.assertion);
    }
  }

  for (const item of requirements) {
    const error = configurationError(item.requirement, item.subject);
    if (error) errors.push(error);
  }

  if (errors.length) {
    return {
      ok: false,
      reasonCode: errors.some((x) => /requires AUTOMATION_EXTERNAL_ADAPTER_URL/.test(x)) ? 'EXTERNAL_ADAPTER_NOT_CONFIGURED'
        : errors.some((x) => /Database assertion capability|Named database/.test(x)) ? 'DATABASE_ASSERTION_NOT_CONFIGURED'
        : 'ADVANCED_CAPABILITY_GROUNDING_FAILED',
      reason: errors[0],
      errors: [...new Set(errors)],
      supportedOperations: [...new Set([...(v7.SUPPORTED_OPERATIONS || []), ...ADVANCED_ACTION_OPERATIONS, ...ASSERTION_OPERATIONS])],
      supportedAssertions: [...ASSERTION_OPERATIONS],
    };
  }

  let baseCompiled = null;
  if (baseSteps.length || baseExpected.length) {
    const injectedStep = !baseSteps.length && baseExpected.length;
    const injectedExpected = baseSteps.length && !baseExpected.length;
    const compileSteps = injectedStep
      ? [{ action: 'Navigate to', target: 'page', value: firstPath(discovery) }]
      : baseSteps;
    const compileExpected = injectedExpected
      ? [syntheticExpectedFor(baseSteps, discovery)]
      : baseExpected;
    baseCompiled = v7.compileTestCase({ ...testCase, steps: compileSteps, expectedResults: compileExpected }, context);
    if (!baseCompiled.ok) return baseCompiled;
    if (injectedExpected && baseCompiled.plan) baseCompiled = { ...baseCompiled, plan: { ...baseCompiled.plan, assertions: [] } };
  } else {
    baseCompiled = {
      ok: true,
      plan: { version: 8, testCaseId: testCase.id, title: testCase.title, actions: [], assertions: [], narrativeExpectations: [], assertionSuggestions: [] },
    };
  }

  const plan = baseCompiled.plan || {};
  const merged = {
    ...plan,
    version: 8,
    actions: [...(plan.actions || []), ...advancedActions],
    assertions: [...(plan.assertions || []), ...advancedAssertions],
    advancedCapabilities: [...new Set(requirements.map((item) => item.requirement).filter(Boolean))],
  };
  if (!merged.actions.length && !merged.assertions.length) {
    return { ok: false, reasonCode: 'AUTOMATION_CONTRACT_INCOMPLETE', reason: 'No deterministic actions or assertions could be compiled.', errors: ['No deterministic actions or assertions could be compiled.'] };
  }
  if (!merged.assertions.length) {
    return { ok: false, reasonCode: 'AUTOMATION_CONTRACT_INCOMPLETE', reason: 'No deterministic assertion could be compiled from the expected results.', errors: ['No deterministic assertion could be compiled from the expected results.'] };
  }

  return {
    ...baseCompiled,
    ok: true,
    plan: merged,
    advancedCapabilities: merged.advancedCapabilities,
  };
}

module.exports = {
  ...v7,
  compileTestCase,
  ADVANCED_ACTION_OPERATIONS,
  parseAdvancedExpectation,
  adapterCapabilityForText,
  externalConfigured,
};
