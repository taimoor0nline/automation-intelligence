const assert = require('assert');
const crypto = require('crypto');

const envKeys = [
  'AUTOMATION_ENTERPRISE_SSO_CONFIG_JSON',
  'AUTOMATION_EXTERNAL_ADAPTER_URL',
  'AUTOMATION_EXTERNAL_CAPABILITIES',
  'AUTOMATION_CLIENT_CERTIFICATES_JSON',
];
const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

function restore() {
  for (const key of envKeys) {
    if (oldEnv[key] === undefined) delete process.env[key];
    else process.env[key] = oldEnv[key];
  }
}
function sha(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }

try {
  process.env.AUTOMATION_ENTERPRISE_SSO_CONFIG_JSON = JSON.stringify({
    MICROSOFT_ENTRA: {
      origin: 'https://login.example.test',
      usernameSelector: '#username',
      usernameSubmitSelector: '#next',
      passwordSelector: '#password',
      passwordSubmitSelector: '#signin',
      returnPath: '/app',
    },
    SAML: {
      origin: 'https://sso.example.test',
      usernameSelector: '#user',
      passwordSelector: '#pass',
      passwordSubmitSelector: '#login',
      returnPath: '/app',
    },
  });
  process.env.AUTOMATION_EXTERNAL_ADAPTER_URL = 'http://adapter.example.test';
  process.env.AUTOMATION_EXTERNAL_CAPABILITIES = 'MFA_OTP,WEBAUTHN_TEST_ADAPTER';
  process.env.AUTOMATION_CLIENT_CERTIFICATES_JSON = JSON.stringify([{ url: 'https://secure.example.test/**', certs: [{ pfx: '/run/secrets/test-client.p12', passphrase: 'from-secret-runtime' }] }]);

  const enterprise = require('../server/services/enterpriseAutomationCapabilities');
  enterprise.install();

  const capabilities = enterprise.enterpriseRuntimeCapabilities();
  assert.equal(capabilities.direct.ENTERPRISE_SSO.available, true);
  assert.deepEqual(new Set(capabilities.direct.ENTERPRISE_SSO.providers), new Set(['MICROSOFT_ENTRA', 'SAML']));
  assert.equal(capabilities.direct.CLIENT_CERTIFICATE.available, true);
  assert.equal(capabilities.direct.CAPTCHA_OBSERVE_ONLY.available, true);
  assert.equal(capabilities.direct.CAPTCHA_OBSERVE_ONLY.bypassAllowed, false);
  assert.equal(capabilities.direct.CAPTCHA_OBSERVE_ONLY.solvingAllowed, false);
  assert.equal(capabilities.external.MFA_OTP.available, true);
  assert.equal(capabilities.external.WEBAUTHN_TEST_ADAPTER.available, true);

  const registry = {
    version: 1,
    registryHash: 'enterprise-smoke',
    pages: [{ pageRef: 'PAGE:/app', path: '/app', url: 'https://app.example.test/app' }],
    elements: [{
      elementRef: 'EL:body', pageRef: 'PAGE:/app', selector: 'body', tag: 'body', type: 'body', text: 'Application',
      capabilities: ['TEXT','HTML','EXISTS','VISIBLE'],
    }],
  };
  const canonical = require('../server/services/canonicalTestIrV3');
  const sso = canonical.validateCanonicalIr({
    version: 1,
    plannedId: 'P901',
    objective: 'Login with Microsoft Entra and verify the application page',
    actions: [{ operation: 'LOGIN_ENTERPRISE_SSO', provider: 'MICROSOFT_ENTRA' }],
    assertions: [{ operation: 'ASSERT_VISIBLE', elementRef: 'EL:body' }],
  }, {
    registry,
    plannedUnit: { plannedId: 'P901', category: 'FUNCTIONAL', scenarioType: 'positive', objective: 'Login with Microsoft Entra and verify the application page' },
    story: 'Users sign in with Microsoft Entra SSO.',
    hasCredentials: true,
  });
  assert.equal(sso.ok, true, sso.reason || JSON.stringify(sso.errors));
  assert.equal(sso.plan.actions[0].operation, 'LOGIN_ENTERPRISE_SSO');
  assert.equal(sso.plan.actions[0].provider, 'MICROSOFT_ENTRA');

  const nativeKey = canonical.validateCanonicalIr({
    version: 1,
    plannedId: 'P902',
    objective: 'Use keyboard navigation on the application page',
    actions: [{ operation: 'PRESS_NATIVE_KEY', key: 'TAB' }],
    assertions: [{ operation: 'ASSERT_VISIBLE', elementRef: 'EL:body' }],
  }, {
    registry,
    plannedUnit: { plannedId: 'P902', category: 'ACCESSIBILITY', scenarioType: 'positive', objective: 'Use keyboard navigation on the application page' },
    story: 'Keyboard navigation is supported.',
    hasCredentials: false,
  });
  assert.equal(nativeKey.ok, true, nativeKey.reason || JSON.stringify(nativeKey.errors));
  assert.equal(nativeKey.plan.actions[0].operation, 'PRESS_NATIVE_KEY');
  assert.equal(nativeKey.plan.actions[0].key, 'TAB');

  const badKey = enterprise.enterpriseRuntimeCapabilities().direct.NATIVE_KEYBOARD.keys.includes('F13');
  assert.equal(badKey, false);
  const captchaErrors = enterprise.externalAdapterAvailable('CAPTCHA_BYPASS');
  assert.equal(captchaErrors, false, 'CAPTCHA bypass must never be advertised by the enterprise adapter allow-list.');

  const v7 = require('../server/services/deterministicAutomationGeneratorV7');
  const executable = {
    id: 'TC901',
    title: 'Enterprise SSO execution contract',
    automationReadiness: {
      automationPlan: {
        actions: [
          { operation: 'LOGIN_ENTERPRISE_SSO', provider: 'MICROSOFT_ENTRA' },
          { operation: 'PRESS_NATIVE_KEY', key: 'TAB' },
          { operation: 'EXTERNAL_ADAPTER_ACTION', capability: 'MFA_OTP', action: 'complete-test-challenge', payload: { accountRef: 'configured-test-account' } },
          { operation: 'EXTERNAL_ADAPTER_ACTION', capability: 'WEBAUTHN_TEST_ADAPTER', action: 'authenticate-test-credential', payload: { credentialRef: 'configured-test-credential' } },
        ],
        assertions: [{ operation: 'ASSERT_VISIBLE', selector: 'body', elementRef: 'EL:body' }],
      },
    },
  };
  const generated = v7.generateDeterministicAutomation([executable]);
  assert(generated.script.includes('cy.loginEnterpriseSso("MICROSOFT_ENTRA")'));
  assert(generated.script.includes('cy.pressNativeKey("TAB")'));
  assert(generated.script.includes("'testNexusEnterpriseAdapter'") || generated.script.includes('"testNexusEnterpriseAdapter"'));
  assert(generated.script.includes('TC901-ACT-001'));
  assert(generated.script.includes('TC901-ASRT-001'));
  assert(generated.script.includes('runtime selector uniqueness'));
  assert.equal(generated.scriptHash, sha(generated.script));

  const frozen = require('../server/services/frozenExecutionIntegration');
  const frozenCase = {
    id: 'TC901',
    canonicalValidation: { approvedAutomationSource: generated.script, approvedAutomationSourceHash: generated.scriptHash },
  };
  assert.equal(frozen.frozenArtifact(frozenCase).script, generated.script);
  assert.throws(() => frozen.frozenArtifact({ id: 'TC901', canonicalValidation: { approvedAutomationSource: generated.script, approvedAutomationSourceHash: 'bad' } }), /hash does not match/i);

  console.log('enterprise-execution-contract-smoke: PASS');
} finally {
  restore();
}
