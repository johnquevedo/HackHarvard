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

## STATUS A3 ShortMe, LLM, Chalk (A3-01 to A3-08 merged; A3-09 written, blocked on credentials)

Merged in one integration commit because A3 built against the spec while the foundation was in flight; the milestone commit subjects are listed in the commit body. Replaces the A1-01 stubs for @dennis/llm and @dennis/shortme.

- LLM: FALLBACK. `createStructuredLlm(config, deps?)` provides AnthropicLlm (messages.parse with zodOutputFormat, automatic fallback to a forced tool call on 400), ChalkGatewayLlm (optional, LLM_PROVIDER=chalk), and MockStructuredLlm. No ANTHROPIC_API_KEY on the A3 machine, so p95 is not measured yet; `pnpm spike:llm` fills docs/spikes/llm.md. A missing key never downgrades to the mock: health is red and calls fail as llm_unavailable.
- Chalk: BLOCKED on environment access (no CHALK_CLIENT_ID and CHALK_CLIENT_SECRET). services/chalk-eval is written against the installed chalkcompute 2.13.7 API and unit tested; `pnpm spike:chalk` prints BLOCKED until credentials exist. Honest label until then: LOCAL RUN (NOT CHALK).
- ShortMe: every Section 8.7 transition, publish_market and confirm_resolution approvals bound by payload hash and consumed with consumeInTransaction, invitations only to friends holding shortme_free_play, BACK, FADE, PASS handlers with invite codes, pari-mutuel payouts, dispute freeze, void refunds, L1 to L6 checks, Section 9.3 routes. 81 package tests plus tests/cross/a3-shortme-sim.test.ts, which drives the whole ShortMe demo by text through the real ingest, pipeline, command router, A2A bus and notifier. Repo total 202 tests green, tsc green.

## CR-A3-001 to A1: bootstrap snapshot and market_invites

ShortMe adds one table, `market_invites` (packages/db/src/schema/shortme.ts), for the 4-character invite codes that BACK, FADE, PASS may carry. The existing A1-generated table definitions are unchanged. Because createDb only runs BOOTSTRAP_SQL, ShortMe creates the table at register time with the exact drizzle-generated DDL plus IF NOT EXISTS, so db:push sees no drift. Request: regenerate BOOTSTRAP_SQL from the current schemas when convenient (additive). No action is needed for correctness.

## CR-A3-002 to A1: private opportunity while a market is proposed

Section 4.1 step 6 says a proposed market appears only in the subject's lane, but OpportunityStore.upsert always emits a shared `opportunity.updated`. ShortMe mitigates this with a neutral headline ("ShortMe draft (private to its subject)") and only the subject's agent in participantAgentIds, so no question text leaks. Request (additive): an optional `visibility` on UpsertOpportunity, or private emission when type is shortme_market and status is proposed.

## CR-A3-003 reply to A1 FORGET request

ShortMe keeps markets.source_intent_id as you generated it (NOT NULL). Positions and ledger rows are the points audit trail and are never deleted. Proposed approach, A1's choice: (a) refuse FORGET while the user is the subject of any market (current behavior, acceptable for the demo), or (b) make source_intent_id nullable in a regenerated snapshot and ShortMe will null it in its consent-revoked hook. A3 code already tolerates a null source intent.

## CR-A3-004 to A4: eval and UI contract notes

- Milestone eval decisions: propose_market only when every gate passes; blocked_policy for dating, high sensitivity, minors, prompt injection, third-party exposure, and milestones about someone else (not_subject_owned); no_market for hyperbole, past or known outcomes, low confidence, and disabled templates (academics, friend_event). The local runner should map RejectReason the same way.
- Report files: chalk-latest.json only for a SUCCEEDED Chalk run; Python local runs write local-python-latest.json and fixture runs write local-fixture-latest.json, both provider local, so they never overwrite your local-latest.json.
- MarketDetail adds `market.resolverLabel` ("STAND-IN FOR OFFICIAL SOURCE" for demo_standin), `market.pointsOnly: true`, and `firstName` on participants and positions. Invite codes are never returned by the API.
- Additive route: POST /api/shortme/markets/:marketId/dispute `{ userId }` lets any participant dispute a proposed resolution (D14).
- Root tooling: tests/cross needs the workspace packages as root dependencies (A3 used a temporary uncommitted root package.json).

## Note A3 to A2: mock rules

MockStructuredLlm(rules?) answers milestone_detector_v1 and quip_v1 by default. For purchase tasks pass rules to the constructor or call `ctx.llm.addRules([...])` when `ctx.llm instanceof MockStructuredLlm`.

## CR-A3-005 to A1 and A2: pipeline passes enabledCategories [] to every detector (likely blocks Demo 1)

packages/platform/src/pipeline.ts builds DetectorInput with `enabledCategories: []`. The A2 purchase detector on origin/a2/a2-09-live-rehearsal rejects unless `input.enabledCategories.includes(extraction.category)`, so through the real pipeline every purchase would be rejected as `category_disabled` once purchasing merges. The milestone detector treats an empty list as "no extra restriction" and is unaffected (tests/cross/a3-shortme-sim.test.ts drives it through the real pipeline). Suggested fix, either side: A1 passes the agent's enabled categories (for example `["monitor", "recruiting"]` from settings or config), or A2 treats an empty list as "use purchase-gates.json only". Please confirm with a pipeline-level purchase test before Demo 1 rehearsal.

## STATUS A3 eval mirrors live detectors

services/chalk-eval now ports A2's live purchase detector exactly (PurchaseExtraction schema, inline SYSTEM_PROMPT read from purchase.ts at run time and verified identical, JSON user message, gate order, product key normalization, timeframe and budget band, isCompatible, priceGroup on the demo offer, evaluateProposal with each private budget). Purchase eval decisions: create_intent when all gates pass; blocked for sensitive; no_intent for not_an_intent, not_subject_owned, low_confidence, category_disabled, schema_invalid, llm_unavailable. Pair decision `match` means public compatibility plus both members accepting the simulated group offer. The Chalk integration badge is now reported by ShortMe from data/eval/chalk-latest.json (LIVE only for a provider chalk report, otherwise LOCAL RUN (NOT CHALK)), and eval.report is emitted once per new Chalk run id.

## CR-A3-001 resolved by A1

Regenerated packages/db/src/client.ts from the current schemas. market_invites and its unique indexes now exist immediately after createDb, including in createTestPlatform, before ShortMe registers. The existing feature-level IF NOT EXISTS fallback remains compatible. Database reset followed by repeated pushes is part of the validation.

## CR-A3-002 and CR-A3-003 response from A1

OpportunityStore already emits shortme_market opportunities privately for proposed, declined and expired states, identifies the subject as the first participant, and filters those drafts from other viewers. Existing platform tests cover the proposed and declined paths. No contract change is needed. For FORGET, retain the existing refusal while a user is the subject of a referenced market; the points audit trail is preserved as A3 requested. The purchasing-reference purge request remains open.

## STATUS A1 recovery hardening

Branch: a1/a1-09-recovery-hardening, based on the merged A3 implementation. Reproduced and fixed approval decisions racing with revocation, duplicate expiry hooks under concurrent sweepers, expiry discovered by a user reply skipping its feature hook, startup failure leaving the messaging listener active, an interrupted final outbox send staying queued forever, and a stopped socket overwriting the durable cursor. Runtime shutdown now waits for an in-flight health check and is idempotent. Restart recovery reuses the original provider idempotency key, so an interrupted final send can be reconciled without another logical delivery; its attempts counter remains monotonic.

Eight new regression tests cover these paths plus the bootstrap invitation table. The combined platform and A3 suites are validated together, including tests/cross/a3-shortme-sim.test.ts. Local root tooling needs workspace dependencies for the cross tests; the temporary root files remain uncommitted for A4 to replace. Full pnpm verify still awaits A4's root script and ownership checker. Live Photon checks still await credentials and assigned demo lines; the new recovery tests use mocks and a real temporary SQLite file, not a live provider.

Validation for the A1 recovery branch: 212 tests passed across 10 test files, including the complete ShortMe text-command simulation; TypeScript, changed-file Prettier, frozen-lockfile install, database reset and two subsequent pushes passed. Photon doctor was rerun and exited NOT VERIFIED because PHOTON_PROJECT_ID, PHOTON_API_KEY and PHOTON_AGENT_USER_ID are absent. No live send was attempted.

## A1 branch policy from the human lead

Keep Agent 1 changes on a1/a1-09-recovery-hardening with regular commits and branch pushes. Do not push Agent 1 changes to main. The original foundation was merged before this instruction; recovery hardening and subsequent work remain on the separate branch.

## CR-A3-005 resolved by A1 on the recovery branch

The platform now supplies the canonical PurchaseCategory values to an authorized purchase detector and MarketCategory values to an authorized milestone detector. Feature-specific policy files still apply their own allowlists, and the existing consent and agent-settings gates still run before detection. No contracts changed. Two regression tests cover purchase intent creation, category separation, and matchingEnabled=false.

Also verified the actual PurchaseDetector from origin/a2/a2-09-live-rehearsal in a temporary scratch directory against the real A1 ingest and pipeline, using MockStructuredLlm with synthetic extraction data. The pipeline created the expected monitor_27in_4k intent. This check used no network and does not claim live LLM or banking success.

Final validation after rebasing onto the newer A3 main commit and fixing CR-A3-005: 223 tests passed across 12 files; TypeScript and changed-file Prettier passed. Recovery commit f5e4b2f and the category correction are published only on the Agent 1 recovery branch, per the human lead's instruction.
