const fs = require("fs");
const path = require("path");

function safeError(err) {
  if (!err) return null;
  return {
    message: String(err.message || err.stack || err),
    stack: err.stack ? String(err.stack) : null,
  };
}

module.exports = function ResultFileReporter(runner) {
  const startedAt = Date.now();
  const tests = [];
  const testStartedAt = new WeakMap();
  const testStartedHr = new WeakMap();
  const outcomes = new WeakMap();
  const recorded = new WeakSet();

  runner.on("test", (test) => {
    testStartedAt.set(test, Date.now());
    if (typeof process.hrtime?.bigint === "function") testStartedHr.set(test, process.hrtime.bigint());
  });

  function durationFor(test) {
    const reported = Number(test?.duration);
    if (Number.isFinite(reported) && reported > 0) return Math.round(reported);

    const hrStart = testStartedHr.get(test);
    if (typeof hrStart === "bigint" && typeof process.hrtime?.bigint === "function") {
      const elapsed = Number(process.hrtime.bigint() - hrStart) / 1e6;
      if (Number.isFinite(elapsed) && elapsed > 0) return Math.max(1, Math.round(elapsed));
    }

    const started = testStartedAt.get(test);
    if (Number.isFinite(started)) {
      const elapsed = Date.now() - started;
      if (elapsed > 0) return Math.max(1, elapsed);
    }

    return Number.isFinite(reported) && reported > 0 ? Math.round(reported) : null;
  }

  function remember(test, state, err = null) {
    outcomes.set(test, { state, err });
  }

  function pushAtTestEnd(test) {
    if (!test || recorded.has(test)) return;
    const outcome = outcomes.get(test);
    if (!outcome) return;

    recorded.add(test);
    const title = typeof test.fullTitle === "function" ? test.fullTitle() : test.title;
    tests.push({
      title: String(title || ""),
      state: outcome.state,
      durationMs: durationFor(test),
      err: safeError(outcome.err),
    });
  }

  // Mocha can emit fail/pass before the final duration has been attached to the test.
  // Remember the outcome first and capture it at "test end", when timing metadata is final.
  runner.on("pass", (test) => remember(test, "passed"));
  runner.on("fail", (test, err) => remember(test, "failed", err));
  runner.on("pending", (test) => remember(test, "pending"));
  runner.on("test end", (test) => pushAtTestEnd(test));

  runner.once("end", () => {
    const outputFile = process.env.AUTOMATION_RESULT_FILE;
    if (!outputFile) return;

    const payload = {
      total: tests.length,
      passed: tests.filter((t) => t.state === "passed").length,
      failed: tests.filter((t) => t.state === "failed").length,
      pending: tests.filter((t) => t.state === "pending").length,
      skipped: 0,
      durationMs: Date.now() - startedAt,
      tests,
    };

    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    const tempFile = `${outputFile}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(payload, null, 2), "utf8");
    fs.renameSync(tempFile, outputFile);

    console.log(
      `[automation-reporter] Results captured: ${payload.passed} passed, ${payload.failed} failed`
    );
  });
};
