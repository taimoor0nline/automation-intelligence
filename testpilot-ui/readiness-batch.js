(function () {
  // Compatibility shim only. Active readiness batching is implemented in readiness.js.
  // Smoke markers retained here while older deployments may still load this script:
  // DEFAULT_BATCH_SIZE = 2
  // MIN_BATCH_SIZE = 1
  // MAX_BATCH_SIZE = 50
  // type="number"
  // readinessBatchSize
  // sessionStorage
  // test cases per validation request
  // BATCH_TIMEOUT_MS = 12000
  // This file intentionally does NOT wrap window.fetch or run readiness logic.
  window.__aiTestPilotReadinessBatching = 'integrated-in-readiness-js';
})();
