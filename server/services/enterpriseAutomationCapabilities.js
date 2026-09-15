const ENTERPRISE_ACTIONS = new Set(['LOGIN_ENTERPRISE_SSO','PRESS_NATIVE_KEY']);
const EXTERNAL_ENTERPRISE_CAPABILITIES = Object.freeze(['MFA_OTP','WEBAUTHN_TEST_ADAPTER']);

function clean(value) { return String(value ?? '').trim(); }
function parseJsonEnv(name, fallback) {
  const raw = clean(process.env[name]);
  if (!raw) return fallback;
  try { return JSON.parse(raw); }
  catch { return fallback; }
}
function ssoConfigs() {
  const parsed = parseJsonEnv('AUTOMATION_ENTERPRISE_SSO_CONFIG_JSON', {});
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed;
}
function providerNames() {
  const cfg = ssoConfigs();
  const keys = Object.keys(cfg).filter((key) => cfg[key] && typeof cfg[key] === 'object' && /^https?:\/\//i.test(String(cfg[key].origin || '')));
  if (!keys.length && /^https?:\/\//i.test(String(cfg.origin || ''))) return ['ENTERPRISE'];
  return keys.map((key) => String(key).toUpperCase());
}
function externalAdapterAvailable(capability) {
  const cap = String(capability || '').toUpperCase();
  if (/CAPTCHA/.test(cap)) return false;
  if (!clean(process.env.AUTOMATION_EXTERNAL_ADAPTER_URL)) return false;
  const configured = new Set(clean(process.env.AUTOMATION_EXTERNAL_CAPABILITIES).split(',').map((value) => value.trim().toUpperCase()).filter(Boolean));
  return !configured.size || configured.has(cap);
}
function clientCertificateConfigured() {
  const parsed = parseJsonEnv('AUTOMATION_CLIENT_CERTIFICATES_JSON', []);
  return Array.isArray(parsed) && parsed.some((entry) => entry && typeof entry === 'object' && /^https:\/\//i.test(String(entry.url || '')) && Array.isArray(entry.certs) && entry.certs.length);
}

function enterpriseRuntimeCapabilities() {
  const providers = providerNames();
  return {
    direct: {
      ENTERPRISE_SSO: {
        available: providers.length > 0,
        providers,
        mode: 'real cross-origin browser flow with configured identity-provider selectors and runtime test credentials',
        noSelectorGuessing: true,
      },
      CLIENT_CERTIFICATE: {
        available: clientCertificateConfigured(),
        mode: 'mTLS client certificate configuration at browser proxy/runtime level',
        secretMaterialPolicy: 'certificate/key/passphrase files must come from runtime secrets and must not be committed',
      },
      NATIVE_KEYBOARD: {
        available: true,
        mode: 'native browser key events',
        keys: ['TAB','ENTER','ESC','UP','DOWN','LEFT','RIGHT','HOME','END','PAGEUP','PAGEDOWN'],
      },
      CAPTCHA_OBSERVE_ONLY: {
        available: true,
        mode: 'observe/assert challenge presence, visibility or state only',
        bypassAllowed: false,
        solvingAllowed: false,
      },
    },
    external: {
      MFA_OTP: {
        available: externalAdapterAvailable('MFA_OTP'),
        mode: 'approved test-account OTP adapter only; returned code is consumed by the real browser flow',
      },
      WEBAUTHN_TEST_ADAPTER: {
        available: externalAdapterAvailable('WEBAUTHN_TEST_ADAPTER'),
        mode: 'approved non-production virtual-authenticator/test credential adapter only',
      },
      CAPTCHA_BIOMETRIC: {
        available: false,
        mode: 'deprecated unsafe combined capability; CAPTCHA bypass is never enabled',
      },
    },
  };
}

function mergeCapabilities(base = {}) {
  const extra = enterpriseRuntimeCapabilities();
  return {
    ...base,
    direct: { ...(base.direct || {}), ...extra.direct },
    external: { ...(base.external || {}), ...extra.external },
  };
}

function unsafeCaptchaPlanningText(value) {
  const text = String(value || '');
  return /\b(?:bypass|solve|defeat|circumvent|disable|skip)\b.{0,40}\b(?:captcha|recaptcha|hcaptcha)\b|\b(?:captcha|recaptcha|hcaptcha)\b.{0,40}\b(?:bypass|solve|defeat|circumvent|disable|skip)\b/i.test(text);
}

function sanitizePlan(result = {}) {
  const units = (Array.isArray(result.units) ? result.units : []).filter((unit) => !unsafeCaptchaPlanningText(`${unit?.objective || ''} ${unit?.rationale || ''}`));
  const removed = (Array.isArray(result.units) ? result.units.length : 0) - units.length;
  return {
    ...result,
    units,
    recommendedTestCaseCount: units.length,
    runtimeCapabilities: mergeCapabilities(result.runtimeCapabilities || {}),
    knownGaps: removed
      ? [...new Set([...(result.knownGaps || []), 'CAPTCHA solving/bypass was not planned. Only challenge observation/assertion is allowed.'])]
      : (result.knownGaps || []),
  };
}

function sanitizeBatch(result = {}) {
  const testCases = (Array.isArray(result.testCases) ? result.testCases : []).filter((testCase) => !unsafeCaptchaPlanningText(JSON.stringify(testCase || {})));
  if (!testCases.length && Array.isArray(result.testCases) && result.testCases.length) {
    const error = new Error('Generated batch requested CAPTCHA solving/bypass. TestNexus only permits observation/assertion of a CAPTCHA challenge.');
    error.code = 'CAPTCHA_BYPASS_NOT_ALLOWED';
    throw error;
  }
  return { ...result, testCases, runtimeCapabilities: mergeCapabilities(result.runtimeCapabilities || {}) };
}

function installRuntimeCapabilityPatch() {
  const progressive = require('./progressiveTestGenerator');
  if (progressive.__enterpriseRuntimeCapabilitiesPatched) return;
  const previousCapabilities = progressive.runtimeCapabilities;
  const previousPlan = progressive.proposeGenerationPlan;
  const previousBatch = progressive.generateBatch;

  progressive.runtimeCapabilities = function patchedRuntimeCapabilities() {
    return mergeCapabilities(previousCapabilities());
  };
  progressive.proposeGenerationPlan = async function enterpriseSafePlan(...args) {
    return sanitizePlan(await previousPlan(...args));
  };
  progressive.generateBatch = async function enterpriseSafeBatch(...args) {
    return sanitizeBatch(await previousBatch(...args));
  };
  progressive.__enterpriseRuntimeCapabilitiesPatched = true;
}

function enterpriseValidationErrors(ir, context = {}) {
  const errors = [];
  const providers = new Set(providerNames());
  for (const action of ir?.actions || []) {
    const operation = clean(action?.operation).toUpperCase();
    if (operation === 'LOGIN_ENTERPRISE_SSO') {
      const provider = clean(action.provider || 'ENTERPRISE').toUpperCase();
      if (!providers.has(provider)) errors.push(`LOGIN_ENTERPRISE_SSO provider is not configured: ${provider}.`);
      if (!context.hasCredentials) errors.push('LOGIN_ENTERPRISE_SSO requires configured runtime test credentials.');
    }
    if (operation === 'PRESS_NATIVE_KEY') {
      const key = clean(action.key).toUpperCase();
      const allowed = new Set(['TAB','ENTER','ESC','ESCAPE','UP','DOWN','LEFT','RIGHT','HOME','END','PAGEUP','PAGEDOWN']);
      if (!allowed.has(key)) errors.push(`PRESS_NATIVE_KEY uses unsupported key: ${key || '(missing)'}.`);
    }
    if (operation === 'EXTERNAL_ADAPTER_ACTION') {
      const capability = clean(action.capability).toUpperCase();
      if (EXTERNAL_ENTERPRISE_CAPABILITIES.includes(capability) && !externalAdapterAvailable(capability)) {
        errors.push(`${capability} requires an explicitly configured external test adapter/test account.`);
      }
      if (/CAPTCHA/.test(capability)) errors.push('CAPTCHA solving/bypass is not an executable capability. CAPTCHA may only be observed/asserted through grounded page elements.');
    }
  }
  return errors;
}

function installCanonicalIrPatch() {
  const canonical = require('./canonicalTestIrV3');
  if (canonical.__enterpriseCapabilitiesPatched) return;
  const previousValidate = canonical.validateCanonicalIr;
  const previousCatalog = canonical.canonicalActionCatalog;

  canonical.validateCanonicalIr = function validateEnterpriseCanonicalIr(ir, context = {}) {
    const errors = enterpriseValidationErrors(ir, context);
    if (errors.length) return { ok: false, reasonCode: /credentials/i.test(errors[0]) ? 'MISSING_CREDENTIALS' : 'ENTERPRISE_CAPABILITY_NOT_CONFIGURED', reason: errors[0], errors };
    const originalActions = Array.isArray(ir?.actions) ? ir.actions : [];
    const transformed = {
      ...ir,
      actions: originalActions.map((action) => ENTERPRISE_ACTIONS.has(clean(action?.operation).toUpperCase()) ? { operation: 'RELOAD' } : action),
    };
    const validated = previousValidate(transformed, context);
    if (!validated.ok) return validated;
    const actions = validated.plan.actions.map((action, index) => {
      const original = originalActions[index] || {};
      const operation = clean(original.operation).toUpperCase();
      if (operation === 'LOGIN_ENTERPRISE_SSO') return { operation, provider: clean(original.provider || 'ENTERPRISE').toUpperCase() };
      if (operation === 'PRESS_NATIVE_KEY') return { operation, key: clean(original.key).toUpperCase() };
      return action;
    });
    const steps = validated.display.steps.map((step, index) => {
      const original = originalActions[index] || {};
      const operation = clean(original.operation).toUpperCase();
      if (operation === 'LOGIN_ENTERPRISE_SSO') return { action: `Login through configured ${clean(original.provider || 'enterprise')} SSO`, target: 'configured identity provider', value: null };
      if (operation === 'PRESS_NATIVE_KEY') return { action: `Press native ${clean(original.key).toUpperCase()} key`, target: 'browser keyboard', value: null };
      return step;
    });
    return { ...validated, canonicalIr: { ...ir, version: validated.canonicalIr?.version || ir?.version || 1 }, plan: { ...validated.plan, actions }, display: { ...validated.display, steps } };
  };

  canonical.canonicalActionCatalog = function enterpriseCanonicalActionCatalog() {
    return [
      ...previousCatalog(),
      {
        operation: 'LOGIN_ENTERPRISE_SSO', usesElementRef: false, fields: ['provider'],
        description: 'Run a real configured enterprise SSO browser login through the cross-origin browser command. provider must be one of runtimeCapabilities.direct.ENTERPRISE_SSO.providers. Identity-provider selectors come only from server configuration; never invent them.',
      },
      {
        operation: 'PRESS_NATIVE_KEY', usesElementRef: false, fields: ['key'],
        description: 'Dispatch a supported real browser keyboard key. Use only runtimeCapabilities.direct.NATIVE_KEYBOARD.keys.',
      },
    ];
  };
  canonical.__enterpriseCapabilitiesPatched = true;
}

function install() {
  installRuntimeCapabilityPatch();
  installCanonicalIrPatch();
}

module.exports = {
  install,
  enterpriseRuntimeCapabilities,
  mergeCapabilities,
  sanitizePlan,
  sanitizeBatch,
  unsafeCaptchaPlanningText,
  providerNames,
  clientCertificateConfigured,
  externalAdapterAvailable,
  EXTERNAL_ENTERPRISE_CAPABILITIES,
};
