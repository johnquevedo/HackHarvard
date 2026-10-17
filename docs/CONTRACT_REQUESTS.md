# Contract requests and status

## STATUS A1 foundation started

Agent 1 is implementing contracts and the platform in a1/a1-01-foundation.
The supplied dennis-build-spec.md remains the authoritative spec until A4 creates docs/SPEC.md.

## REQUEST A4 root tooling

No root tooling exists in the initial checkout. A1 has temporary uncommitted package.json, pnpm-workspace.yaml and tsconfig.json for validation. Please supply the root tooling, ownership.json and verify scripts per Section 6. Package manifests inside A1 packages are included with the foundation. A1 will not publish temporary A4-owned root files.

## STATUS Photon live setup pending

Live Photon configuration has not been supplied or verified. Simulator mode is the active fallback. No live latency claim is made.

## REQUEST A2 and A3 privacy forget references

FORGET deletes a user's intents after consent-revoked hooks. The initial group_purchase_members.intent_id and markets.source_intent_id foreign keys prevent deleting an intent still referenced by feature rows. Please provide a purge path that removes or anonymizes those references without losing payment or points audit history. Until that path exists, the platform refuses FORGET with invalid_state for users with referenced feature rows. Open positions also refuse FORGET per Section 14.5.

## STATUS A1 local validation

97 tests pass with the pinned dependencies, including every event payload sample, 50 command inputs, replay protection, approval bindings, privacy, A2A and SSE. TypeScript passes. Live Photon setup is still unverified. Temporary root tooling uses the documented dependency versions. Node on this machine is 25.3.0 rather than the specified Node 22; tested behavior is recorded without claiming Node 22 validation.

## CR-A2-001 resolved by A1

Read from origin/a2/a2-09-live-rehearsal. ApprovalService now provides the additive synchronous consumeInTransaction(approvalId, tx) capability requested by Agent 2. It requires an active transaction on the platform SQLite connection, recomputes the stored payload hash, checks the lifecycle and expiry, and updates through the caller's Drizzle transaction. The payment attempt insert and approval consumption therefore commit or roll back together. Existing async consume remains available. A rollback test verifies the capability.

## CR-A2-002 forwarded to A4

Agent 2 requests the Demo 1 purchasing checklist in docs/DEMO_RUNBOOK.md: two join approvals, two payment approvals, provider read-back, both balance deltas, provider IDs, and the visible SIMULATED BANK fallback label. Agent 1 has not edited A4's runbook.

## STATUS A1 database push fallback

The pinned drizzle-kit 0.31.11 CLI creates duplicate CREATE INDEX statements on a second push, even for a database produced by its own first push. This was reproduced on disposable files. No version was changed. packages/db/src/push.ts uses the same pinned Drizzle schema-generation API to create missing definitions, skips existing matching definitions, and refuses schema drift before changing any existing rows. db:reset rebuilds from the current schemas. Reset followed by two pushes passes. This extends the A1-01 raw-SQL fallback beyond partial indexes because the failure affects ordinary unique indexes too.

## STATUS S0 and S1 A1 foundation

Contracts release candidate was published at contracts-rc; generated dependency artifacts were removed immediately in the following commit. The simulator server boots on 127.0.0.1:4101. Health returns ok and SIMULATED messaging; sim inbound produces message.received with the simulated label. Contracts include every event schema and six A2A schemas; transactional approval consumption is additive per CR-A2-001. 118 tests pass locally, and TypeScript passes. Foundation stubs for purchasing, shortme, llm and eval-data are explicitly the A1-01 exceptions; their owners replace them in M0. Agent 2 already has work on origin/a2/a2-09-live-rehearsal and can integrate against these contracts.

Photon status: FALLBACK, simulator rung 5. SDK request flow, idempotency headers, HTTP retry classification, own-message filtering, cursor checkpoints, one-listener locking and webhook signature checks are covered with synthetic mocks. No live Photon round trip is claimed. See docs/spikes/photon.md for the live steps and unconfirmed assumptions.

Full pnpm verify is unavailable because the A4-owned root script and ownership checker do not exist yet. A1 ran the individual available checks: Prettier, TypeScript, unit/integration tests, database reset and repeated push, git diff checks, and a real local HTTP smoke test. A4 should add .gitignore entries for node_modules, data files and generated caches before broad staging. Temporary root tooling and lockfile remain uncommitted in the Agent 1 worktree; all package dependency versions are pinned to Section 6.
