# TestNexus durable AI repair learning — development handoff

## Implemented
- Migration `020_ai_repair_memory.sql`: durable project-scoped selector repair memory, lifecycle state, verification run provenance, counters, and reuse event ledger.
- `repairMemoryService.js`: candidate normalization and fingerprinting, proposal creation, verified-run ingestion, verified suggestions, reuse events, revoke, and promotion from candidate to verified when an applied run has passing test results.
- `persistenceService.js`: verified repair capture runs within the same transaction as test-run results and report snapshots.
- `projectWorkspace.js`: project-authorized proposal, suggestion, event and verification APIs.
- Workspace inventory: project-specific verified repair suggestions, including original/replacement selector and reuse counters.

## Reuse policy
The existing approved/frozen Cypress artifact is **never silently rewritten** by learned selector memory. Reuse is deliberately approval-gated:
1. Record a candidate selector replacement.
2. Apply it to a draft test through the existing review process and record an `APPLIED` event referencing the run.
3. After that run finishes with all test results passing, call the verification endpoint to promote it to `VERIFIED`.
4. Retrieve verified suggestions for future similar failures; review the suggestion before applying it.
5. Record `SUCCEEDED` through verification, `FAILED` when appropriate, or `REVOKED` for harmful repairs.

The project suggestion API and UI provide the reuse discovery path. **Automatic insertion into draft scripts, similarity ranking beyond exact project/path, and full automatic replay of repaired scripts are not implemented**. They must not bypass approval or frozen-source hashes.

## API
- `POST /api/projects/:projectId/repair-memory`: propose candidate (failureSignature, originalSelector, replacementSelector, pagePath).
- `GET /api/projects/:projectId/repair-memory?pagePath=/login`: verified suggestions.
- `POST /api/projects/:projectId/repair-memory/:memoryId/events`: eventType, sessionId, runId.
- `POST /api/projects/:projectId/repair-memory/:memoryId/verify`: runId; requires an APPLIED event and all test results passing.

## Scope
Code committed to `live-browser-streaming`. Runtime testing/validation excluded at user's request. Database migration 020 must be applied at deployment. No report retention changes.
