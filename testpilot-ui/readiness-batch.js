(function () {
  // Compatibility shim only.
  // Readiness batching now lives directly in readiness.js so there is a single
  // readiness owner and no second window.fetch interception layer.
  window.__aiTestPilotReadinessBatching = 'integrated-in-readiness-js';
})();
