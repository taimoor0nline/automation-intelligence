const fs = require("fs");
const path = require("path");

const AUTOMATION_DIR = path.join(__dirname, "..", "..", "automation");
const SPEC_DIR = path.join(AUTOMATION_DIR, "cypress", "e2e", "generated");

function writeSpec(fileName, script) {
  if (!fs.existsSync(SPEC_DIR)) fs.mkdirSync(SPEC_DIR, { recursive: true });
  const specPath = path.join(SPEC_DIR, fileName);
  fs.writeFileSync(specPath, script, "utf8");
  return specPath;
}

async function runCypress(specFileName) {
  console.log("[test-runner] Starting Cypress...");
  console.log(`[test-runner] Automation directory: ${AUTOMATION_DIR}`);
  console.log(`[test-runner] Spec file name: ${specFileName}`);

  const cypressModulePath = path.join(AUTOMATION_DIR, "node_modules", "cypress");
  console.log(`[test-runner] Loading Cypress module from: ${cypressModulePath}`);

  let cypress;
  try {
    cypress = require(cypressModulePath);
  } catch (requireErr) {
    console.error("[test-runner] FAILED to require cypress module:", requireErr.message);
    throw new Error(
      `Cannot find Cypress in automation/node_modules. Did you run "npm install" inside automation/? Details: ${requireErr.message}`
    );
  }

  const specPath = path.join(AUTOMATION_DIR, "cypress", "e2e", "generated", specFileName);
  console.log(`[test-runner] Absolute spec path: ${specPath}`);
  console.log(`[test-runner] Spec file exists on disk: ${fs.existsSync(specPath)}`);

  const result = await cypress.run({
    project: AUTOMATION_DIR,
    spec: specPath,
    config: {
      baseUrl: process.env.TEST_BASE_URL || "http://localhost:4000",
      video: false,
    },
  });

  console.log("[test-runner] Cypress execution finished.");
  console.log("[test-runner] result.totalTests:", result && result.totalTests);
  console.log("[test-runner] result.totalPassed:", result && result.totalPassed);
  console.log("[test-runner] result.totalFailed:", result && result.totalFailed);

  return result;
}

// IMPORTANT FIX: this version of Cypress's run() result has NO top-level
// "status" field (it was undefined in testing, even on a fully successful
// run) — checking for status === "finished" was wrong and caused every
// run to be treated as a failure even when Cypress worked perfectly.
// We now check totalTests (a number) as the signal that results are real.
function summarize(result) {
  if (!result || typeof result.totalTests !== "number") {
    return {
      summary: null,
      diagnostic: `Unexpected Cypress result shape: ${JSON.stringify(result).slice(0, 300)}`,
    };
  }
  const run = result.runs && result.runs[0];
  if (!run) {
    return { summary: null, diagnostic: "Cypress finished but returned no run data (spec likely wasn't found/matched)." };
  }

  const tests = run.tests.map((t) => ({
    // t.title comes back as an array like ["Customer Feedback", "TC009: ..."] — join it into one string.
    title: Array.isArray(t.title) ? t.title.join(" ") : t.title,
    pass: t.state === "passed",
    fail: t.state === "failed",
    err: t.displayError ? { message: t.displayError } : null,
  }));

  return {
    summary: {
      total: result.totalTests,
      passed: result.totalPassed,
      failed: result.totalFailed,
      tests,
    },
    diagnostic: null,
  };
}

async function executeGeneratedTest({ fileName, script }) {
  const specPath = writeSpec(fileName, script);
  try {
    const result = await runCypress(fileName);
    const { summary, diagnostic } = summarize(result);
    return { specPath, ok: !!summary, summary, error: diagnostic };
  } catch (err) {
    console.error("[test-runner] Exception during Cypress execution:", err);
    return { specPath, ok: false, error: err.message || String(err), stack: err.stack };
  }
}

module.exports = { executeGeneratedTest, SPEC_DIR };