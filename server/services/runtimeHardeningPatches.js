const vm = require('vm');
const crypto = require('crypto');

let installed = false;

function cleanId(value) {
  return String(value || '').trim().toUpperCase();
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function extractTestTitles(script) {
  const titles = [];
  const pattern = /\bit(?:\.(?:only|skip))?\s*\(\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g;
  let match;
  while ((match = pattern.exec(String(script || '')))) {
    try {
      const decoded = vm.runInNewContext(match[1], Object.create(null), { timeout: 25 });
      if (typeof decoded === 'string') titles.push(decoded);
    } catch {}
  }
  return titles;
}

function idsInTitle(title) {
  return [...new Set((String(title || '').match(/TC(?:\d{3}|-H\d{3})/gi) || []).map(cleanId))];
}

function patchScriptValidator() {
  const validator = require('./scriptValidator');
  if (validator.__testNexusRobustIdMappingPatched) return;
  const original = validator.validateGroundedScript;

  validator.validateGroundedScript = function robustGroundedScriptValidation(script, options = {}) {
    const frameworkOwnedSelectors = [...new Set([...(options.frameworkOwnedSelectors || []), 'body'])];
    const nextOptions = { ...options, frameworkOwnedSelectors };
    const result = original(script, nextOptions);
    const approvedIds = (nextOptions.approvedTestCases || []).map((testCase) => cleanId(testCase?.id)).filter(Boolean);
    if (!approvedIds.length) return result;

    const mappingError = /^Approved test TC(?:\d{3}|-H\d{3}) must map to exactly one it\(\) block; found \d+\.$/i;
    const errors = (result.errors || []).filter((error) => !mappingError.test(String(error || '')));
    const titles = extractTestTitles(script);

    for (const id of approvedIds) {
      const matches = titles.filter((title) => idsInTitle(title).includes(id));
      if (matches.length !== 1) {
        const observed = titles.length ? ` Observed it() titles: ${titles.join(' | ')}` : ' No it() titles were parsed.';
        errors.push(`Approved test ${id} must map to exactly one it() block; found ${matches.length}.${observed}`);
      }
    }

    return { ...result, valid: errors.length === 0, errors: [...new Set(errors)] };
  };
  validator.__testNexusRobustIdMappingPatched = true;
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function radioAwareUncheckSource(selector) {
  const literal = JSON.stringify(String(selector || ''));
  return `cy.get(${literal}).then(($el) => { if ($el.is(':radio')) { const name=$el.attr('name'); const $form=$el.closest('form'); const $root=$form.length?$form:Cypress.$($el[0].ownerDocument); const $group=name?$root.find('input[type="radio"]').filter((_, el) => el.name === name):$el; $group.prop('checked', false).trigger('change'); } else { cy.wrap($el).uncheck(); } });`;
}

function rewriteRadioUnchecks(source, plan) {
  let output = String(source || '');
  for (const action of plan?.actions || []) {
    if (String(action?.operation || '').toUpperCase() !== 'UNCHECK' || !action.selector) continue;
    const literal = JSON.stringify(String(action.selector));
    const pattern = new RegExp(`cy\\.get\\(${escapeRegExp(literal)}\\)\\.uncheck\\(\\);`, 'g');
    output = output.replace(pattern, radioAwareUncheckSource(action.selector));
  }
  return output;
}

function normalizeExecutableScript(script, testCases = []) {
  let output = String(script || '').replace(
    "describe('AI TestPilot Approved Test Suite', () => {",
    "describe('Test execution', () => {"
  );
  for (const testCase of testCases || []) output = rewriteRadioUnchecks(output, testCase?.automationReadiness?.automationPlan);
  return output;
}

function selectorFor(item) {
  if (!item) return '';
  if (item.selector) return String(item.selector);
  if (item.testId) return `[data-testid="${item.testId}"]`;
  if (item.id) return `#${item.id}`;
  if (item.name) return `[name="${item.name}"]`;
  return '';
}

function pagePath(page) {
  try {
    const url = new URL(page?.finalUrl || page?.url || '/');
    return `${url.pathname}${url.search}` || '/';
  } catch {
    return '/';
  }
}

function resolveLoginRuntime(pageDiscoveries = []) {
  const entries = [];
  for (const page of pageDiscoveries || []) for (const item of page?.elements || []) entries.push({ page, item });
  const identity = (item) => [item?.testId, item?.id, item?.name, item?.label, item?.placeholder, item?.ariaLabel].filter(Boolean).join(' ').toLowerCase();
  const usernameEntry = entries.find(({ item }) => /\b(user.?name|email|login)\b/i.test(identity(item)) && String(item?.type || '').toLowerCase() !== 'password');
  const passwordEntry = entries.find(({ item }) => String(item?.type || '').toLowerCase() === 'password');
  const submitEntry = entries.find(({ item }) => /\b(sign\s*in|log\s*in|login|submit)\b/i.test(identity(item)) && ['button', 'submit'].includes(String(item?.type || '').toLowerCase()));
  const loginPage = usernameEntry?.page || passwordEntry?.page || submitEntry?.page || pageDiscoveries?.[0] || null;
  return {
    path: pagePath(loginPage),
    selectors: {
      username: selectorFor(usernameEntry?.item),
      password: selectorFor(passwordEntry?.item),
      submit: selectorFor(submitEntry?.item),
    },
  };
}

function buildUnsealedExecutableArtifact(testCase) {
  const v6 = require('./deterministicAutomationGeneratorV6');
  const generated = v6.generateDeterministicAutomation([testCase]);
  return { ...generated, script: normalizeExecutableScript(generated.script, [testCase]) };
}

function configuredActorRefs(context = {}) {
  if (Array.isArray(context.actorCredentialRefs)) return context.actorCredentialRefs.map(String).filter(Boolean);
  return [];
}

function strictArtifactReadiness(testCase, context = {}) {
  const readiness = testCase?.automationReadiness || {};
  if (readiness.status !== 'READY' || !testCase?.canonicalIr) return testCase;
  try {
    const artifact = buildUnsealedExecutableArtifact(testCase);
    const validator = require('./scriptValidator');
    const login = resolveLoginRuntime(context.pageDiscoveries || []);
    const validation = validator.validateGroundedScript(artifact.script, {
      approvedTestCases: [testCase],
      pageDiscoveries: context.pageDiscoveries || [],
      hasCredentials: Boolean(context.hasCredentials),
      loginSelectors: login.selectors,
      actorCredentialRefs: configuredActorRefs(context),
      frameworkOwnedSelectors: ['body'],
    });
    if (!validation?.valid) {
      const errors = validation?.errors || ['The executable browser artifact failed deterministic validation.'];
      return {
        ...testCase,
        automationReadiness: {
          ...readiness,
          status: 'INVALID_TEST_CASE',
          automatable: false,
          reasonCode: 'EXACT_CYPRESS_ARTIFACT_INVALID',
          reason: `The exact browser-execution artifact failed deterministic validation before approval: ${errors[0]}`,
          reasons: errors,
          resolutionType: 'AI_REPAIRABLE',
          repairable: true,
          executableArtifact: {
            framework: 'CYPRESS',
            validated: false,
            scriptHash: sha256(artifact.script),
            generationMode: artifact.generationMode || null,
          },
        },
      };
    }
    return {
      ...testCase,
      automationReadiness: {
        ...readiness,
        executableArtifact: {
          framework: 'CYPRESS',
          validated: true,
          validationSource: 'EXACT_ARTIFACT_PREAPPROVAL',
          scriptHash: sha256(artifact.script),
          generationMode: artifact.generationMode || null,
          testBlockCount: extractTestTitles(artifact.script).length,
        },
      },
    };
  } catch (err) {
    return {
      ...testCase,
      automationReadiness: {
        ...readiness,
        status: 'INVALID_TEST_CASE',
        automatable: false,
        reasonCode: 'EXACT_CYPRESS_ARTIFACT_GENERATION_FAILED',
        reason: `The exact browser-execution artifact could not be generated before approval: ${err.message}`,
        reasons: [err.message],
        resolutionType: 'AI_REPAIRABLE',
        repairable: true,
      },
    };
  }
}

function patchFeasibility() {
  const feasibility = require('./testCaseFeasibility');
  if (feasibility.__testNexusExactArtifactReadinessPatched) return;
  const originalAssess = feasibility.assessTestCases;
  feasibility.assessTestCases = function exactArtifactAssess(testCases = [], context = {}) {
    return originalAssess(testCases, context).map((testCase) => strictArtifactReadiness(testCase, context));
  };
  feasibility.__testNexusExactArtifactReadinessPatched = true;
}

function patchDeterministicGenerator() {
  const generator = require('./deterministicAutomationGenerator');
  if (generator.__testNexusRadioUncheckPatched) return;

  const originalGenerate = generator.generateDeterministicAutomation;
  generator.generateDeterministicAutomation = function radioAwareDeterministicGeneration(testCases = []) {
    const generated = originalGenerate(testCases);
    const script = normalizeExecutableScript(generated.script, testCases);
    if (testCases.length === 1) {
      const testCase = testCases[0];
      const expectedHash = testCase?.automationReadiness?.executableArtifact?.scriptHash || null;
      if (expectedHash && sha256(script) !== expectedHash) {
        const error = new Error(`${testCase.id || 'Approved test'} executable browser artifact changed after readiness validation. Execution was blocked before Cypress started.`);
        error.code = 'APPROVED_EXECUTABLE_ARTIFACT_DRIFT';
        throw error;
      }
    }
    return { ...generated, script };
  };

  if (typeof generator.generateCypressPreviewFromPlan === 'function') {
    const originalPreview = generator.generateCypressPreviewFromPlan;
    generator.generateCypressPreviewFromPlan = function radioAwarePreview(plan, options) {
      return rewriteRadioUnchecks(originalPreview(plan, options), plan);
    };
  }

  generator.__testNexusRadioUncheckPatched = true;
}

function identityToken(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function selectorIdentityTokens(value) {
  const source = String(value || '');
  const tokens = new Set();
  for (const match of source.matchAll(/\[data-testid=["']([^"']+)["']\]/gi)) tokens.add(identityToken(match[1]));
  for (const match of source.matchAll(/\[name=["']([^"']+)["']\]/gi)) tokens.add(identityToken(match[1]));
  for (const match of source.matchAll(/#([A-Za-z][A-Za-z0-9_-]*)/g)) tokens.add(identityToken(match[1]));
  for (const match of source.matchAll(/<(?:[A-Za-z0-9_-]+)#([A-Za-z0-9_-]+)/g)) tokens.add(identityToken(match[1]));
  return new Set([...tokens].filter(Boolean));
}

function semanticApprovedAssertion(testCase, actual) {
  const runtimeTokens = selectorIdentityTokens(actual);
  if (!runtimeTokens.size) return null;
  const assertions = testCase?.automationReadiness?.automationPlan?.assertions || [];
  const matches = assertions.filter((assertion) => {
    const assertionTokens = selectorIdentityTokens(assertion?.selector);
    return [...assertionTokens].some((token) => runtimeTokens.has(token));
  });
  return matches.length === 1 ? matches[0] : null;
}

function assertionSummary(assertion = {}) {
  const target = assertion.selector || assertion.path || 'approved target';
  const suffix = assertion.text ?? assertion.value ?? assertion.path ?? assertion.fragment ?? '';
  return `${assertion.operation || 'ASSERTION'} on ${target}${suffix !== '' ? ` (${JSON.stringify(suffix)})` : ''}`;
}

function patchFailureResolution() {
  const service = require('./failureResolutionAiService');
  if (service.__testNexusSelectorAliasTraceabilityPatched) return;
  const original = service.analyzeFailureWithResolution;

  service.analyzeFailureWithResolution = async function aliasAwareFailureResolution(args = {}) {
    const result = await original(args);
    const testCase = args.testCase || {};
    const id = testCase.id || 'the failed test';
    const sealed = Boolean(testCase?.canonicalValidation?.approvedCompiledHash);
    const assertion = sealed ? semanticApprovedAssertion(testCase, args.actual) : null;

    if (result?.classification === 'TEST_DEFECT' && assertion) {
      return {
        ...result,
        classification: 'APPLICATION_DEFECT',
        summary: `The browser failure maps unambiguously to ${id}'s sealed human-approved assertion through the same DOM identity. The approved expectation was executed and the observed application state did not satisfy it.`,
        probableCause: 'The application reached meaningful validation, but the observable state conflicted with the sealed reviewed expectation. Review the application validation/state-transition path before changing the test.',
        resolutionComment: `Correct the application behavior responsible for the failed approved assertion, then re-run ${id}. Do not weaken or replace the reviewed expectation.`,
        recommendedFix: `Align the application behavior with the approved assertion: ${assertionSummary(assertion)}. Preserve the valid-path behavior and re-run the original reviewed case.`,
        recommendedOwner: 'APPLICATION_TEAM',
        sourceGuidanceLevel: 'BLACK_BOX',
        sourceCandidateFiles: [],
        approvedAssertion: assertion,
        approvedAssertionSummary: assertionSummary(assertion),
        contractTraceability: 'SEALED_ASSERTION_ALIAS_MATCH',
        resolutionSource: 'DETERMINISTIC_CONTRACT_ALIAS_GUARD',
        regressionChecks: [
          'Confirm the corresponding valid-path behavior still succeeds.',
          'Confirm the rejected/boundary input does not transition into a success state.',
          'Confirm the approved validation feedback remains observable after submission.',
        ],
        verificationSteps: [
          `Apply the reviewed application correction without changing ${id}'s approved expectation.`,
          `Re-run ${id} and confirm the original sealed assertion passes.`,
          'Run the nearby positive case to confirm the valid flow still succeeds.',
        ],
        safeToAutoResolve: false,
        confidence: Math.max(Number(result.confidence) || 0, 0.98),
      };
    }

    if (result?.classification === 'TEST_DEFECT') {
      return {
        ...result,
        verificationSteps: [
          `Review ${id}'s displayed expected results against its compiled deterministic assertions.`,
          `Revalidate ${id} so the reviewed and compiled contracts are identical.`,
          `Re-run ${id} only after the test contract is traceable and sealed.`,
        ],
        regressionChecks: [],
      };
    }

    return result;
  };
  service.__testNexusSelectorAliasTraceabilityPatched = true;
}

function install() {
  if (installed) return;
  installed = true;
  patchScriptValidator();
  patchFeasibility();
  patchDeterministicGenerator();
  patchFailureResolution();
}

module.exports = {
  install,
  extractTestTitles,
  idsInTitle,
  rewriteRadioUnchecks,
  normalizeExecutableScript,
  semanticApprovedAssertion,
  strictArtifactReadiness,
  buildUnsealedExecutableArtifact,
};
