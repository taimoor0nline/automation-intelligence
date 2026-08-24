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

  function push(test, state, err = null) {
    const title = typeof test.fullTitle === "function" ? test.fullTitle() : test.title;
    tests.push({
      title: String(title || ""),
      state,
      durationMs: Number.isFinite(Number(test.duration)) ? Math.round(Number(test.duration)) : null,
      err: safeError(err),
    });
  }

  runner.on("pass", (test) => push(test, "passed"));
  runner.on("fail", (test, err) => push(test, "failed", err));
  runner.on("pending", (test) => push(test, "pending"));

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
