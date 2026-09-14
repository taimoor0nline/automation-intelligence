const crypto = require('crypto');
const { validateCypressContract } = require('./cypressContractValidator');
const rawGenerator = require('./deterministicAutomationGeneratorV6');
const { contractSnapshot } = require('./startupIntegrityGuards');

let installed = false;

function scriptHash(script) {
  return crypto.createHash('sha256').update(String(script || '')).digest('hex');
}

function strictFailure(testCase, strict) {
  const messages = (strict?.errors || []).map((item) => item?.message || String(item)).filter(Boolean);
  const reason = strict?.reason || messages[0] || 'The exact Cypress execution contract failed strict deterministic validation.';
  return {
    ...testCase,
    automationReadiness: {
      ...(testCase.automationReadiness || {}),
      status: 'INVALID_TEST_CASE',
      automatable: false,
      reasonCode: strict?.reasonCode || 'STRICT_CYPRESS_CONTRACT_INVALID',
      reason,
      reasons: messages.length ? messages : [reason],
      resolutionType: 'AI_REPAIRABLE',
      repairable: true,
      canSuggestAssertion: false,
      cypressContract: strict || null,
      validationSource: 'deterministic+cypress-contract',
    },
  };
}

function attachStrictContract(testCase, context) {
  if (!testCase?.canonicalIr || testCase?.automationReadiness?.status !== 'READY') return testCase;
  const strict = validateCypressContract(testCase, context);
  if (!strict.ok) return strictFailure(testCase, strict);

  const approvedHash = testCase?.canonicalValidation?.approvedCypressArtifactHash || null;
  if (approvedHash && approvedHash !== strict.scriptHash) {
    return strictFailure(testCase, {
      ...strict,
      ok: false,
      reasonCode: 'APPROVED_CYPRESS_ARTIFACT_CHANGED',
      reason: 'The exact Cypress artifact changed after human approval. Revalidate the case before execution.',
      errors: [{ code: 'APPROVED_CYPRESS_ARTIFACT_CHANGED', message: 'The exact Cypress artifact changed after human approval. Revalidate the case before execution.' }],
    });
  }

  return {
    ...testCase,
    automationReadiness: {
      ...testCase.automationReadiness,
      cypressContract: strict,
      contractIntegrity: {
        ...(testCase.automationReadiness?.contractIntegrity || {}),
        cypressArtifactHash: strict.scriptHash,
        cypressValidatorVersion: strict.version,
      },
      validationSource: 'deterministic+cypress-contract',
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
  const generated = rawGenerator.generateDeterministicAutomation([testCase]);
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
    const error = new Error(`${testCase.id || 'Canonical test'} no longer matches its human-approved deterministic contract. Execution was blocked before Cypress started.`);
    error.code = 'APPROVED_CONTRACT_MISMATCH';
    throw error;
  }
}

function verifyCypressSeal(testCase) {
  const approvedHash = testCase?.canonicalValidation?.approvedCypressArtifactHash || null;
  if (!approvedHash) {
    const error = new Error(`${testCase.id || 'Canonical test'} is missing its human-approved Cypress artifact seal. Revalidate/review the test before execution.`);
    error.code = 'APPROVED_CYPRESS_ARTIFACT_SEAL_MISSING';
    throw error;
  }
  const readinessHash = testCase?.automationReadiness?.cypressContract?.scriptHash || null;
  if (!readinessHash || readinessHash !== approvedHash) {
    const error = new Error(`${testCase.id || 'Canonical test'} readiness artifact does not match the human-approved Cypress artifact. Execution was blocked before the browser started.`);
    error.code = 'APPROVED_CYPRESS_ARTIFACT_MISMATCH';
    throw error;
  }
  const currentHash = currentSingleArtifactHash(testCase);
  if (currentHash !== approvedHash) {
    const error = new Error(`${testCase.id || 'Canonical test'} regenerated Cypress artifact differs from the reviewed artifact. Execution was blocked before the browser started.`);
    error.code = 'APPROVED_CYPRESS_ARTIFACT_CHANGED';
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
      const error = new Error('Canonical and non-canonical tests cannot be mixed in one strict Cypress execution batch. Run them separately.');
      error.code = 'MIXED_EXECUTION_CONTRACT_TYPES';
      throw error;
    }

    for (const testCase of canonical) {
      verifyLegacyDeterministicSeals(testCase);
      verifyCypressSeal(testCase);
    }

    // IMPORTANT: canonical execution bypasses all legacy late-source rewrite layers.
    // The same deterministic V6 emitter used to validate/seal each test is the only
    // source of executable Cypress code. Multi-test suites simply concatenate those
    // same deterministic test bodies under one describe() block.
    return rawGenerator.generateDeterministicAutomation(canonical);
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
