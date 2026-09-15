const ENTERPRISE_ACTIONS = new Set(['LOGIN_ENTERPRISE_SSO','PRESS_NATIVE_KEY']);
const EXTERNAL_ENTERPRISE_CAPABILITIES = Object.freeze(['MFA_OTP','WEBAUTHN_TEST_ADAPTER']);

function clean(value) { return String(value ?? '').trim(); }
function boolEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return !['false','0','no','off'].includes(String(value).toLowerCase());
}
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
  if (!clean(process.env.AUTOMATION_EXTERNAL_ADAPTER_URL)) return false;
  const configured = new Set(clean(process.env.AUTOMATION_EXTERNAL_CAPABILITIES).split(',').map((value) => value.trim().toUpperCase()).filter(Boolean));
  return !configured.size || configured.has(String(capability || '').toUpperCase());
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
        mode: 'real cy.origin browser flow with configured identity-provider selectors and runtime test credentials',
        noSelectorGuessing: true,
      },
      CLIENT_CERTIFICATE: {
        available: clientCertificateConfigured(),
        mode: 'Cypress clientCertificates mTLS configuration',
        secretMaterialPolicy: 'certificate/key material must be mounted or created from secrets and must not be committed',
      },
      NATIVE_KEYBOARD: {
        available: true,
        mode: 'cy.press native keyboard events',
        keys: ['TAB','ENTER','ESC','UP','DOWN','LEFT','RIGHT','HOME','END','PAGEUP','PAGEDOWN'],
      },
      CAPTCHA_OBSERVE_ONLY: {
        available: true,
        mode: 'observe/assert challenge presence or state only',
        bypassAllowed: false,
        solvingAllowed: false,
      },
    },
    external: Object.fromEntries(EXTERNAL_ENTERPRISE_CAPABILITIES.map((capability) => [capability, {
      available: externalAdapterAvailable(capability),
      mode: capability === 'MFA_OTP'
        ? 'approved test-account/OTP adapter only'
        : 'approved virtual-authenticator or test adapter only',
    }])),
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

function installRuntimeCapabilityPatch() {
  const progressive = require('./progressiveTestGenerator');
  if (progressive.__enterpriseRuntimeCapabilitiesPatched) return;
  const previous = progressive.runtimeCapabilities;
  progressive.runtimeCapabilities = function patchedRuntimeCapabilities() {
    return mergeCapabilities(previous());
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
      if (/CAPTCHA/.test(capability)) errors.push('CAPTCHA solving/bypass is not an executable capability. CAPTCHA may only be observed/asserted.');
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
        description: 'Run a real configured enterprise SSO browser login through cy.origin. provider must be one of runtimeCapabilities.direct.ENTERPRISE_SSO.providers. Identity-provider selectors come only from server configuration; never invent them.',
      },
      {
        operation: 'PRESS_NATIVE_KEY', usesElementRef: false, fields: ['key'],
        description: 'Dispatch a supported real browser keyboard key using the automation runtime native press command. Use only runtimeCapabilities.direct.NATIVE_KEYBOARD.keys.',
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
  providerNames,
  clientCertificateConfigured,
  externalAdapterAvailable,
  EXTERNAL_ENTERPRISE_CAPABILITIES,
};
