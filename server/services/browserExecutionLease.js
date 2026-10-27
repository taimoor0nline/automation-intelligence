'use strict';
// In-process exclusive lease for Cypress resources. No waiting queue: repair and
// normal executions fail closed rather than racing over browsers/spec/evidence.
let owner = null;
function acquire(kind, runId) {
  if (owner) {
    const error = new Error('Browser automation engine is already owned by ' + owner.kind + ' execution.');
    error.code = 'AUTOMATION_ENGINE_BUSY';
    throw error;
  }
  const token = Object.freeze({ kind, runId, acquiredAt: new Date().toISOString() });
  owner = token;
  return token;
}
function release(token) {
  if (token && owner === token) { owner = null; return true; }
  return false;
}
function current() { return owner ? { kind: owner.kind, runId: owner.runId, acquiredAt: owner.acquiredAt } : null; }
module.exports = { acquire, release, current };
