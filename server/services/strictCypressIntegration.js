const crypto = require('crypto');
const { validateCypressContract } = require('./cypressContractValidator');
const { validateWebScenarioPolicy } = require('./webScenarioPolicy');
const { validateNavigationContract } = require('./navigationContract');
const { validateDeterministicStateContract } = require('./deterministicStateContract');
const { buildCanonicalElementRegistry } = require('./canonicalElementRegistry');
const {
  validateStrictGeneratedArtifact,
  assertGeneratedScriptSyntax,
  assertRuntimePrerequisites,
} = require('./strictGeneratedArtifactValidator');
const rawGenerator = require('./deterministicAutomationGeneratorV6');
const { contractSnapshot } = require('./startupIntegrityGuards');

let installed = false;

function scriptHash(script) {
  return crypto.createHash('sha256').update(String(script || '')).digest('hex');
}

function strictFailure(testCase, strict, extra = {}) {
  const messages = (strict?.errors || []).map((item) => item?.message || String(item)).filter(Boolean);
  const reason = strict?.reason || messages[0] || 'The exact executable automation contract failed strict deterministic validation.';
  return {
    ...testCase,
    automationReadiness: {
      ...(testCase.automationReadiness || {}),
      status: 'INVALID_TEST_CASE',
      automatable: false,
      reasonCode: strict?.reasonCode || strict?.errors?.[0]?.code || 'STRICT_AUTOMATION_CONTRACT_INVALID',
      reason,
      reasons: messages.length ? messages : [reason],
      resolutionType: 'AI_REPAIRABLE',
      repairable: true,
      canSuggestAssertion: false,
      cypressContract: extra.cypressContract ?? strict?.cypressContract ?? testCase?.automationReadiness?.cypressContract ?? null,
      generatedArtifactContract: extra.generatedArtifactContract ?? testCase?.automationReadiness?.generatedArtifactContract ?? null,
      webScenarioPolicy: extra.webScenarioPolicy ?? testCase?.automationReadiness?.webScenarioPolicy ?? null,
      navigationContract: extra.navigationContract ?? testCase?.automationReadiness?.navigationContract ?? null,
      stateContract: extra.stateContract ?? testCase?.automationReadiness?.stateContract ?? null,
      validationSource: 'deterministic+web-scenario-policy+navigation-contract+state-contract+strict-artifact-contract',
    },
  };
}

function attachStrictContract(testCase, context) {
  if (!testCase?.canonicalIr || testCase?.automationReadiness?.status !== 'READY') return testCase;

  const scenarioPolicy = validateWebScenarioPolicy(testCase, context);
  if (!scenarioPolicy.ok) {
    return strictFailure(testCase, {
      reasonCode: scenarioPolicy.errors?.[0]?.code || 'WEB_SCENARIO_POLICY_BLOCKED',
      reason: scenarioPolicy.errors?.[0]?.message || 'The generated scenario is not supported by the strict generic web-testing policy.',
      errors: scenarioPolicy.errors || [],
    }, { webScenarioPolicy: scenarioPolicy });
  }

  const registry = context?.canonicalElementRegistry || buildCanonicalElementRegistry(context?.pageDiscoveries || []);
  const navigationErrors = validateNavigationContract(testCase.canonicalIr, registry);
  const navigationContract = {
    ok: navigationErrors.length === 0,
    version: 'NAVIGATION_CONTRACT_V1',
    reasonCode: navigationErrors[0]?.code || null,
    reason: navigationErrors[0]?.message || null,
    errors: navigationErrors,
  };
  if (!navigationContract.ok) {
    return strictFailure(testCase, navigationContract, {
      webScenarioPolicy: scenarioPolicy,
      navigationContract,
    });
  }

  const stateContract = validateDeterministicStateContract(testCase.canonicalIr, registry);
  if (!stateContract.ok) {
    return strictFailure(testCase, stateContract, {
      webScenarioPolicy: scenarioPolicy,
      navigationContract,
      stateContract,
    });
  }

  const strict = validateCypressContract(testCase, { ...context, canonicalElementRegistry: registry });
  if (!strict.ok) {
    return strictFailure(testCase, strict, {
      webScenarioPolicy: scenarioPolicy,
      navigationContract,
      stateContract,
      cypressContract: strict,
    });
  }

  const generatedArtifactContract = validateStrictGeneratedArtifact(testCase, { ...context, canonicalElementRegistry: registry });
  if (!generatedArtifactContract.ok) {
    return strictFailure(testCase, generatedArtifactContract, {
      webScenarioPolicy: scenarioPolicy,
      navigationContract,
      stateContract,
      cypressContract: strict,
      generatedArtifactContract,
    });
  }

  const approvedHash = testCase?.canonicalValidation?.approvedCypressArtifactHash || null;
  if (approvedHash && approvedHash !== strict.scriptHash) {
    return strictFailure(testCase, {
      ...strict,
      ok: false,
      reasonCode: 'APPROVED_AUTOMATION_ARTIFACT_CHANGED',
      reason: 'The exact executable automation artifact changed after human approval. Revalidate the case before execution.',
      errors: [{ code: 'APPROVED_AUTOMATION_ARTIFACT_CHANGED', message: 'The exact executable automation artifact changed after human approval. Revalidate the case before execution.' }],
    }, { webScenarioPolicy: scenarioPolicy, navigationContract, stateContract, cypressContract: strict, generatedArtifactContract });
  }

  return {
    ...testCase,
    automationReadiness: {
      ...testCase.automationReadiness,
      cypressContract: strict,
      generatedArtifactContract,
      webScenarioPolicy: scenarioPolicy,
      navigationContract,
      stateContract,
      contractIntegrity: {
        ...(testCase.automationReadiness?.contractIntegrity || {}),
        cypressArtifactHash: strict.scriptHash,
        cypressValidatorVersion: strict.version,
        generatedArtifactValidatorVersion: generatedArtifactContract.version,
        navigationValidatorVersion: navigationContract.version,
        stateValidatorVersion: stateContract.version,
      },
      validationSource: 'deterministic+web-scenario-policy+navigation-contract+state-contract+strict-artifact-contract',
    },
  };
}

function patchFeasibility() {
  const feasibility = require('./testCaseFeasibility');
  if (feasibility.__strictCypressContractPatched) return;
  const previous = feasibility.assessTestCases;
  feasibility.assessTestCases = function strictCypressAssess(testCases = [], context = {}) {
    return previous(testCases, context).map((testCase) => attachStrictContract(testCase, context));
  };
  feasibility.__strictCypressContractPatched = true;
}

function currentSingleArtifactHash(testCase) {
  assertRuntimePrerequisites(testCase);
  const generated = rawGenerator.generateDeterministicAutomation([testCase]);
  assertGeneratedScriptSyntax(generated.script, { singleCase: true });
  return scriptHash(generated.script);
}

function verifyLegacyDeterministicSeals(testCase) {
  const approved = testCase?.canonicalValidation || {};
  const snapshot = contractSnapshot(testCase);
  if (!approved.approvedCanonicalHash || !approved.approvedCompiledHash || !approved.approvedDisplayExpectationHash) {
    const error = new Error(`${testCase.id || 'Canonical test'} is missing its human-approved deterministic contract seal. Revalidate/review the test before execution.`);
    error.code = 'APPROVED_CONTRACT_SEAL_MISSING';
    throw error;
  }
  if (snapshot.canonicalHash !== approved.approvedCanonicalHash || snapshot.compiledHash !== approved.approvedCompiledHash || snapshot.displayExpectationHash !== approved.approvedDisplayExpectationHash) {
    const error = new Error(`${testCase.id || 'Canonical test'} no longer matches its human-approved deterministic contract. Execution was blocked before the browser started.`);
    error.code = 'APPROVED_CONTRACT_MISMATCH';
    throw error;
  }
}

function verifyCypressSeal(testCase) {
  const approvedHash = testCase?.canonicalValidation?.approvedCypressArtifactHash || null;
  if (!approvedHash) {
    const error = new Error(`${testCase.id || 'Canonical test'} is missing its human-approved executable artifact seal. Revalidate/review the test before execution.`);
    error.code = 'APPROVED_AUTOMATION_ARTIFACT_SEAL_MISSING';
    throw error;
  }
  const readinessHash = testCase?.automationReadiness?.cypressContract?.scriptHash || null;
  if (!readinessHash || readinessHash !== approvedHash) {
    const error = new Error(`${testCase.id || 'Canonical test'} readiness artifact does not match the human-approved executable artifact. Execution was blocked before the browser started.`);
    error.code = 'APPROVED_AUTOMATION_ARTIFACT_MISMATCH';
    throw error;
  }
  const currentHash = currentSingleArtifactHash(testCase);
  if (currentHash !== approvedHash) {
    const error = new Error(`${testCase.id || 'Canonical test'} regenerated executable artifact differs from the reviewed artifact. Execution was blocked before the browser started.`);
    error.code = 'APPROVED_AUTOMATION_ARTIFACT_CHANGED';
    throw error;
  }
}

function patchGenerator() {
  const generator = require('./deterministicAutomationGenerator');
  if (generator.__strictCypressContractPatched) return;
  const previous = generator.generateDeterministicAutomation;

  generator.generateDeterministicAutomation = function strictCypressGenerate(approvedTestCases = []) {
    const canonical = (approvedTestCases || []).filter((testCase) => testCase?.canonicalIr);
    if (!canonical.length) return previous(approvedTestCases);
    if (canonical.length !== approvedTestCases.length) {
      const error = new Error('Canonical and non-canonical tests cannot be mixed in one strict execution batch. Run them separately.');
      error.code = 'MIXED_EXECUTION_CONTRACT_TYPES';
      throw error;
    }

    for (const testCase of canonical) {
      verifyLegacyDeterministicSeals(testCase);
      verifyCypressSeal(testCase);
    }

    // Canonical execution bypasses all legacy late-source rewrite layers. The exact
    // deterministic emitter used during readiness is also the only source of the
    // executable browser artifact. No late mutation is permitted after approval.
    const generated = rawGenerator.generateDeterministicAutomation(canonical);
    assertGeneratedScriptSyntax(generated.script, { singleCase: canonical.length === 1 });
    return generated;
  };
  generator.__strictCypressContractPatched = true;
}

function install() {
  if (installed) return;
  installed = true;
  patchFeasibility();
  patchGenerator();
}

module.exports = { install, attachStrictContract, scriptHash, verifyLegacyDeterministicSeals, verifyCypressSeal };
