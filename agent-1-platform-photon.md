# Dennis coding-agent work order: Agent 1: Platform and Photon

Paste this whole file as the agent's task. The full specification is `docs/SPEC.md` in the repository and is authoritative; this file embeds everything the agent needs to start immediately.

## Shared conventions

You are one of four coding agents building **Dennis** for HackHarvard 2026, concurrently, in one repository. Deadline: Sunday, October 18, 2026, 8:00 AM ET. The other three agents are working at the same time; you cannot talk to them except through the repository and `docs/CONTRACT_REQUESTS.md`.

**Product in one paragraph.** Dennis is a network of personal AI agents that live in people's iMessage threads through Photon 2.0. Each agent notices plans in the thread its owner authorized, shares only a minimal anonymous summary with other agents, and brings its owner opportunities to approve. Pattern: Agent to Agent to User. Feature A finds friends who want the same purchase, compares a simulated group offer, collects two separate approvals, and moves sandbox money through Capital One Nessie. Feature B (ShortMe) proposes a private, invite-only, free-to-play prediction market among friends using fictional points. Sponsor priorities: Photon 2.0, Nessie, Chalk, Digital Trust.

**Authority.** `docs/SPEC.md` is the single source of truth. After milestone A1-01 the contract code in `packages/contracts` is the executable form of Section 8. If the spec and your instinct disagree, follow the spec. If the spec is silent, choose the simplest reading, write the choice in your PR description or spike document, and continue. Do not ask for architecture discussions.

**Rules (all non-negotiable).**

1. Own only your files. `ownership.json` lists your globs and `pnpm verify` enforces them. Never edit another agent's files. If you need a change elsewhere, append a request to `docs/CONTRACT_REQUESTS.md`.
2. Contracts are frozen at `contracts-v1`. Changes are additive only and go through Agent 1 via `docs/CONTRACT_REQUESTS.md`.
3. Code against ports (interfaces). Use the mock or simulated implementation for anything not yet built. Never wait for another agent.
4. The backend enforces consent, approvals, spending limits, and publication rules in code. LLM output is data validated by Zod schemas. No LLM output reaches money, an approval, a market state change, or a consent decision without a deterministic gate.
5. Every external call goes through a typed adapter with a timeout, error mapping, and a mock. Retriable writes carry idempotency keys. Webhooks and inbound events are replay-safe.
6. Never fabricate success. Anything simulated, replayed, or fallback is labeled as such in events, API responses, and UI. A payment is `verified` only when the provider read-back proves it.
7. No secrets in git or logs. Environment variables only. Keys never appear in `NEXT_PUBLIC_*`.
8. Money is integer cents. ShortMe points are fictional, have no monetary value, and never touch Nessie or any bank adapter.
9. Write tests with your code: table-driven where possible, no network in unit tests, in-memory database through `createTestPlatform`.
10. Do not use em dashes, en dashes, or arrow symbols in code comments, strings, or documents you write; plain hyphens and words only.

**Workflow.**

- Work in your own git worktree on branch `a<N>/<milestone-id>-<slug>`. Ports: `PORT_SERVER=410N`, `PORT_WEB=310N`, `DATABASE_URL=file:./data/aN.db`, `PHOTON_MODE=sim` unless you are the integration run.
- Merge at the end of every milestone: `git fetch origin && git rebase origin/main && pnpm install --frozen-lockfile && pnpm verify && git push origin HEAD:main`. Use the exact commit message in the milestone. Never hold unmerged work longer than 90 minutes.
- Timebox every milestone. If you exceed it by 50 percent, switch to the milestone's Fallback, merge what works, and tell the team in `docs/CONTRACT_REQUESTS.md` under a `STATUS` heading.
- At each sync point (S0 to S7 in Section 14.4) append a status block: milestones done, each integration LIVE or FALLBACK, blockers, contract requests.
- If `main` is red after your merge, fix or revert within 10 minutes.

**Quality bar.** A reliable live demonstration beats breadth. Prefer boring, direct code. Do not add dependencies that are not in Section 6. Do not add features that are not in the spec.

## Compact shared-interface contract

| Contract | Owner | Location | Every agent must |
| --- | --- | --- | --- |
| Zod schemas and types (IDs, enums, domain, events, A2A payloads, API, eval) | A1 steward, frozen at `contracts-v1` | `packages/contracts/src/*` | Import from `@dennis/contracts` only. Never redefine a shape locally. Additive changes only, via `docs/CONTRACT_REQUESTS.md`. |
| Ports: `MessagingProvider`, `BankingProvider`, `StructuredLlm`, `Detector` | A1, A2, A3, A1 interface and A2 and A3 implementations | `ports.ts` | Code against the interface. Each owner ships a `Mock` or simulated implementation in M0. |
| Platform services: `EventBus`, `ConsentService`, `ApprovalService`, `Notifier`, `A2ABus`, `IntentStore`, `OpportunityStore`, `UserDirectory`, `CommandRegistry`, `IntegrationRegistry` | A1 | `packages/platform` | Use only through `PlatformContext`. Never write core tables directly. |
| `FeatureModule` | A2 (`purchasingModule`), A3 (`shortmeModule`) | `packages/purchasing`, `packages/shortme` | Export one module object; register everything inside `register(ctx)`. Never edit `apps/server/src/compose.ts`. |
| Events | emitter owns the schema entry, A1 owns `events.ts` | Section 8.3 | Emit only listed types with exact payload fields. Shared events carry minimal data only. |
| A2A messages | A1 bus, A2 and A3 handlers | Section 8.4 | Send only listed types. Reply with reason codes. |
| Approvals | A1 engine, A2 and A3 hooks | `ApprovalService` | Bind every consequential action to an approved, unconsumed approval with a matching `payloadHash`. |
| Command grammar | A1 parser, A3 owns `back` `fade` `pass` handlers | Section 8.5 | Do not parse user text elsewhere. |
| Money | all | `Cents`, `formatUsd` | Integer cents internally; dollars only inside the Nessie adapter. |
| Idempotency | all | unique keys in Section 7 | Every write that can be retried carries an idempotency key. |
| Labels | all | `ProviderMode` | Anything simulated, replayed, or fallback says so in events and UI. |
| Ownership | A4 enforces | `ownership.json`, `scripts/check-ownership.ts` | Touch only files you own. |

## Your responsibilities and allocation

**Mission.** Own everything every feature stands on: contracts, database skeleton, event bus and SSE, identity, consent, command parsing, approvals, notifier and outbox, A2A bus, detector pipeline, agent isolation, and the Photon 2.0 integration with its simulator twin. You are on the critical path; the Photon spike (A1-02) is the highest-risk task of the project.

**Exclusively owns.** See the A1 globs in Section 12.1.

**Public functions (exact signatures).**

```ts
// @dennis/platform
export function loadConfig(env: NodeJS.ProcessEnv): AppConfig;
export function createPlatform(opts: { config: AppConfig; messaging?: MessagingProvider; llm?: StructuredLlm }): Promise<PlatformContext>;
export function ingestInbound(ctx: PlatformContext, msg: InboundMessage): Promise<{ messageId: string | null; outcome: "queued" | "command" | "ignored" | "replay" }>;
export function handleCommand(ctx: PlatformContext, input: { userId: string; agentId: string; messageId: string; command: ParsedCommand }): Promise<{ reply?: string }>;
export function runPipeline(ctx: PlatformContext, messageId: string): Promise<void>;
export function startRuntime(ctx: PlatformContext): Promise<{ stop(): Promise<void> }>; // provider, 30 s expiry sweeper, outbox dispatcher, recoverPending
export function recoverPending(ctx: PlatformContext): Promise<void>;
export function mountPlatformRoutes(app: Hono, ctx: PlatformContext): void;
export function seedCore(ctx: PlatformContext): Promise<void>;                        // users, agents, consents, friend links
export function resetCore(ctx: PlatformContext, opts: { keepUsers: boolean }): Promise<void>;
export function agentScope(ctx: PlatformContext, agentId: string): AgentScope;
// contracts
export function parseCommand(text: string): ParsedCommand;
export function hashPayload(payload: Record<string, unknown>): string;
// @dennis/messaging
export function createMessagingProvider(cfg: AppConfig, deps: { db: Db; clock: Clock; ids: IdFactory; log: Logger }): MessagingProvider;
export function normalizePhotonEvent(raw: unknown, agentUserId: string): InboundMessage | null;
export function normalizeHandle(raw: string): { handle: string; kind: "phone" | "email" };
```

**Endpoints implemented.** Section 9.1 in full, plus `POST /webhooks/photon`.

**Tables owned.** All core tables (7.1). Writes to core tables happen only inside `@dennis/platform`.

**External services.** Photon 2.0 (Section 10.1).

**Mocks you ship in M0.** `SimMessagingProvider` (also the production simulator) and `createTestPlatform` (due T+0:40). A3 ships `MockStructuredLlm` in A3-01; until then use an inline stub that returns no detections.

**Ordered tasks.** Execute in this order: A1-01 foundation and slice, A1-02 Photon spike, A1-06 pipeline, stores, A2A bus, A1-03 identity, consent, commands, A1-04 approvals, notifier, outbox, A1-05 Photon provider, A1-08 trust controls, A1-07 webhook path and integration status, A1-09 live hardening (Appendix B has the clock). Details in Section 13.

**Tests you own.** Command grammar (table-driven, at least 40 inputs including punctuation, case, extra spaces, wrong code); consent gating; approval lifecycle (expiry, wrong user, wrong hash, double approve, consume once); outbox idempotency; ingest replay; A2A validation and per-agent serialization; isolation tests; event payload schema conformance for every type you emit; `normalizePhotonEvent` against the recorded fixture; Photon provider against a faked `fetch`.

**Definition of done.** Sections 13 acceptance criteria for A1-01 to A1-09 met; `pnpm verify` green; live Photon round trip proven by `pnpm photon:doctor` within 3 seconds p50; spike document complete.

**Must not modify.** Anything outside your globs. Never edit `packages/purchasing`, `packages/shortme`, `packages/llm`, `apps/web`.

**If you finish early.** Add adversarial tests under `tests/cross/a1-*.test.ts`; build typing indicator and tapback acknowledgement (S2); support A4 with SSE performance checks; review other agents' PRs for contract misuse (comment only).

## Your milestones in detail

### 13.1 Agent 1 milestones

**A1-01 Foundation and vertical slice** (M0, P0, 50 min). Depends on: nothing.
- Tasks: first 15 minutes, write `packages/contracts` exactly per Sections 8 and 9 (all event payload schemas, A2A payloads, `parseCommand` returning `none` for now), merge, tag `contracts-rc`. Then `packages/db` (client with `foreign_keys=ON` and WAL, complete initial `core.ts`, `purchasing.ts`, `shortme.ts` from Sections 7.1 to 7.3, `db:push`, `db:reset`). Then `packages/platform`: config, clock, ids, log, `runExclusive`, event bus with viewer filter, SSE and events routes, integration registry, user directory, intent and opportunity stores, detector registry, a minimal `runPipeline`, `seedCore`, and `@dennis/platform/testing` exporting `createTestPlatform(overrides?)` (in-memory SQLite, `SimMessagingProvider`, mock LLM stub, real services as they land, in-memory fakes for approvals, notifier, and the A2A bus until A1-04 and A1-06 replace them; due by T+0:40). Then `SimMessagingProvider`, `POST /api/sim/inbound`, `apps/server` with `compose.ts` (mounts platform, purchasing, shortme, and `@dennis/eval-data` routes). Create stub exports so compose compiles: `purchasingModule` and `shortmeModule` (empty `FeatureModule`), `createStructuredLlm` (returns a stub), `evalDemoRoutes` (empty Hono app). A2, A3, A4 overwrite those stubs in their own M0.
- Files: `packages/contracts/**`, `packages/db/**`, `packages/platform/**`, `packages/messaging/src/sim/**`, `apps/server/**`, the four stubs above.
- Tests: `pnpm --filter @dennis/contracts test` (every event type has a schema and a sample payload that parses; shared-event payloads reject extra keys); `pnpm typecheck`.
- Done when: `pnpm dev:server` boots, `GET /api/health` returns ok, a `POST /api/sim/inbound` call produces `message.received` over `GET /api/events/stream`, tag `contracts-rc` pushed (final `contracts-v1` at S1).
- Commit: `feat(core): contracts, db schema, event bus, sim ingest, compose root`.
- Fallback: if a Drizzle partial unique index fails to push, create it with raw SQL in `client.ts` bootstrap.

**A1-02 Photon spike** (M1, P0, 60 min). Depends on: nothing (runs from a scratch script; fixtures committed after S0).
- Tasks: Section 10.1 spike steps 1 to 7. Write `docs/spikes/photon.md` with the assumptions table filled in, record fixtures, propose `AppConfig` field corrections.
- Files: `scripts/spike-photon.ts`, `docs/spikes/photon.md`, `fixtures/photon/*.json`.
- Tests: `pnpm spike:photon` prints PASS lines for inbound capture, outbound `delivered`, event type listing.
- Done when: round trip measured under 3 seconds p50; `PHOTON_AGENT_USER_ID` and inbound envelope shape documented; ladder step chosen and announced at S2.
- Commit: `docs(photon): spike results and fixtures`.
- Fallback: Section 10.1 fallback ladder; announce at T+2:30 at the latest.

**A1-03 Identity, consent, commands** (M2, P0, 45 min). Depends on: A1-01.
- Tasks: full `parseCommand` per Section 8.5; full `ingestInbound` (replay guard, unknown handle onboarding once per hour, no-consent handling, command dispatch, enqueue pipeline); `ConsentService` with revoke hooks and append-only history; `AGREE` variants; `STOP`, `PAUSE`, `RESUME`, `STATUS`, `FORGET`, `HELP` replies; `onboarding` template.
- Files: `packages/platform/src/{commands,consent,identity}/**`, `packages/contracts/src/commands.ts` (implementation body only).
- Tests: `pnpm --filter @dennis/platform test` with at least 40 table-driven command inputs; ingest replay yields `replay`; unconsented message never stored; `STOP` revokes all.
- Done when: all tests green and a sim conversation walks `hi` to onboarding reply to `AGREE` to consent granted.
- Commit: `feat(platform): ingest, consent, command grammar`.
- Fallback: none needed; this is pure code.

**A1-04 Approvals, notifier, outbox** (M2, P0, 60 min). Depends on: A1-03.
- Tasks: `ApprovalService` (`request`, `decide`, `assertApproved`, `consume`, `onDecided`, `findPending`, `expireDue`); 4-character short codes unique among a user's pending approvals; `hashPayload`; `Notifier.send` writing `outbox`; dispatcher loop with retry 5, 15, 45 seconds; `handleCommand` for `approve`, `decline`, `confirm`, `dispute`; feature command dispatch for `back`, `fade`, `pass`; events per Section 8.3.
- Files: `packages/platform/src/{approvals,notifier,runtime}/**`.
- Tests: lifecycle table (approve, decline, expire, wrong user, wrong kind, wrong hash, double decide, consume twice, code ambiguity); outbox idempotency; dispatcher retries with a failing provider.
- Done when: a sim user receives an approval text and replies `YES` to change status to `approved` and `onDecided` fires exactly once.
- Commit: `feat(platform): approvals, notifier, outbox dispatcher`.
- Fallback: none.

**A1-05 Photon provider** (M2, P0, 60 min). Depends on: A1-02, A1-04.
- Tasks: Section 10.1 adapter design in full (`client`, `handles`, `normalize`, `events-socketio`, `provider`), delivery confirmer, cursor persistence, boot recovery of outbox, health. `PHOTON_MODE=live` selects it; `createMessagingProvider` falls back to sim when credentials are missing and reports SIMULATED.
- Files: `packages/messaging/src/photon/**`, `packages/messaging/src/index.ts`.
- Tests: `normalizePhotonEvent` against the recorded fixture (accept, own message, non-text, malformed); provider with a faked `fetch` (idempotency key header present, three-call sequence, 4xx not retried, 5xx retried); live: `pnpm photon:doctor` round trip.
- Done when: a real iMessage to the line produces `message.received` and a real approval text arrives on the phone.
- Commit: `feat(messaging): photon 2.0 provider with socket.io inbound`.
- Fallback: ladder step in Section 10.1; stay on sim and keep coding against the interface.

**A1-06 Pipeline, stores, A2A bus** (M2, P0, 60 min). Depends on: A1-01 (A1-04 for approvals in tests).
- Tasks: harden `runPipeline` (consent per detector kind, agent status, `recentContext`, rejection events, per-agent `runExclusive`); complete `IntentStore` (public payload `.strict()` parse, `listShared` returns views only), `OpportunityStore`; `A2ABus` (validate, persist, emit, deliver under per-agent serialization, record handled or failed, boot recovery); `agentScope`; `GET /api/a2a`, `GET /api/opportunities/:id/explain`.
- Files: `packages/platform/src/{pipeline,intents,opportunities,a2a}/**`, `packages/platform/src/routes/**`.
- Tests: A2A payload validation rejects unknown types and extra keys; handler failure recorded; per-agent serialization (two messages to one agent never overlap); isolation test; `listShared` never exposes `userId` or private payload.
- Done when: two mock detectors produce intents for two agents and a mock A2A conversation shows in `GET /api/a2a`.
- Commit: `feat(platform): pipeline, intent and opportunity stores, a2a bus`.
- Fallback: none.

**A1-07 Webhook path and integration status** (M3, P1, 45 min). Depends on: A1-05, A1-06.
- Tasks: `POST /webhooks/photon` with `standardwebhooks` verification, replay and age checks, dedupe; typing indicator and tapback acknowledgement behind `ackMode` (S2); integration registry fed by every provider's `health()` every 15 seconds; `GET /api/integrations`.
- Files: `packages/messaging/src/photon/events-webhook.ts`, `packages/platform/src/integrations/**`.
- Tests: valid, stale, tampered, duplicate webhook deliveries; integration status transitions emit events.
- Done when: webhook mode works through a tunnel in a manual test or is documented as unavailable.
- Commit: `feat(messaging): webhook inbound and integration status`.
- Fallback: skip webhook mode if Socket.IO is stable; keep integration status.

**A1-08 Trust controls** (M3, P0, 45 min). Depends on: A1-06, A1-04.
- Tasks: revoke cascade (`messaging_context` revoked marks intents revoked and clears the registry; `purchase_matching` revoked removes shared intents and notifies purchasing through `onRevoked`; `shortme_free_play` and `sandbox_payments` likewise), `POST /api/privacy/forget`, pause, viewer-lens filtering in events, intents, opportunities; shared-event scanner.
- Files: `packages/platform/src/{consent,events,intents}/**` (edits within owned files), `tests/cross/a1-trust.test.ts`.
- Tests: viewer B receives no private event of A; scanner finds no handle, raw text, or private field in any `shared` event emitted during a full sim run.
- Done when: all trust tests green and the Section 10.5 table has a passing test per row owned by A1.
- Commit: `feat(trust): revoke cascade, forget, lens filtering, isolation tests`.
- Fallback: none.

**A1-09 Live hardening** (M4, P0, 45 min). Depends on: A1-05, A1-07.
- Tasks: `pnpm photon:doctor` (credentials, line state, round trip, latency, echo check); reconnect and cursor-resume test; boot recovery tests; latency metrics event; deliverability preflight printing which handles have texted the line recently.
- Files: `scripts/photon-doctor.ts`, tests in `packages/messaging/**`.
- Tests: kill and restart the server mid-conversation; no message lost or duplicated.
- Done when: doctor green three times in a row and the recovery test passes.
- Commit: `chore(photon): doctor, reconnect and recovery hardening`.
- Fallback: none.

## Reference: data model, shared contracts, and API contract (you create the contracts from this)

## 7. Data Model

Conventions. Table and column names are `snake_case`. IDs are prefixed strings (`usr_`, `agt_`, and so on) generated by `IdFactory`. Timestamps are ISO-8601 UTC text. JSON columns use Drizzle `text({ mode: "json" })`. Booleans are `integer({ mode: "boolean" })`. Money is integer cents. Foreign keys are enforced (`PRAGMA foreign_keys = ON`). Schema files: `packages/db/src/schema/core.ts` (A1), `purchasing.ts` (A2), `shortme.ts` (A3). `index.ts` re-exports all and is written once in A1-01.

### 7.1 Core tables (owner A1)

| Table | Columns (type, constraints) | Indexes and notes |
| --- | --- | --- |
| `users` | `id` text PK; `display_name` text not null; `first_name` text not null; `handle` text not null unique (normalized E.164 or lowercase email); `handle_kind` text not null (`phone`/`email`); `photon_user_id` text null; `is_demo` bool not null default true; `region_code` text not null default `boston-cambridge`; `created_at` text not null | |
| `agents` | `id` text PK; `user_id` text not null unique FK users; `name` text not null; `status` text not null (`active`/`paused`); `settings` json not null (`matchingEnabled`, `shortmeEnabled`, `ackMode`); `created_at` | One agent per user. |
| `consents` | `id` integer PK autoincrement; `user_id` FK; `scope` text not null (4 scopes); `status` text not null (`granted`/`revoked`); `via` text not null (`imessage`/`dashboard`/`seed_demo`/`sim_phone`); `text_version` text not null; `created_at` | Append-only history. Current state is the latest row per (`user_id`, `scope`). Index (`user_id`, `scope`, `id` desc). |
| `friend_links` | `user_id` FK; `friend_user_id` FK; `can_invite` bool not null default true | PK (`user_id`, `friend_user_id`). Directed. |
| `photon_spaces` | `user_id` text PK FK; `photon_space_id` text not null; `created_at` | Cache of `createOrGetSpace` results. |
| `photon_cursors` | `key` text PK; `value` text not null; `updated_at` | Socket.IO replay cursor and seen webhook IDs. |
| `inbound_messages` | `id` text PK; `provider` text not null (`photon`/`sim`); `provider_message_id` text not null; `provider_space_id` text null; `user_id` FK null; `agent_id` FK null; `text` text null (null when no consent or purged); `status` text not null (`received`/`processed`/`ignored`/`command`/`failed`); `ignore_reason` text null; `received_at`; `processed_at` null | UNIQUE (`provider`, `provider_message_id`) is the replay guard. |
| `intents` | `id` text PK; `agent_id` FK; `user_id` FK; `kind` text (`purchase`/`milestone`); `status` text (`detected`/`shared`/`matched`/`closed`/`revoked`); `source_message_id` FK null; `private_payload` json not null; `public_payload` json null; `shared` bool not null default false; `confidence` real not null; `rationale` text not null; `created_at`; `updated_at`; `expires_at` null; `revoked_at` null | Indexes (`agent_id`, `kind`, `status`) and (`kind`, `shared`, `status`). Only `IntentStore.listShared` may read `public_payload` across agents. |
| `opportunities` | `id` text PK; `type` text (`group_purchase`/`shortme_market`); `domain_ref_id` text not null; `status` text not null (mirrors the domain status); `headline` text not null; `participant_agent_ids` json not null; `created_at`; `updated_at` | UNIQUE (`type`, `domain_ref_id`). The domain table is the source of truth; this is the common feed envelope. |
| `approvals` | `id` text PK; `short_code` text not null; `user_id` FK; `agent_id` FK; `opportunity_id` text null; `kind` text; `status` text (`pending`/`approved`/`declined`/`expired`/`revoked`); `payload` json not null; `payload_hash` text not null; `prompt_text` text not null; `expires_at`; `decided_at` null; `decided_via` null; `consumed_at` null; `idempotency_key` text not null unique; `created_at` | Partial unique index on (`user_id`, `short_code`) where `status = 'pending'`. |
| `a2a_messages` | `id` text PK; `conversation_id` text not null; `type` text not null; `from_agent_id` FK; `to_agent_id` FK; `opportunity_id` null; `payload` json not null; `status` text (`queued`/`handled`/`failed`); `error` null; `caused_by_event_id` null; `idempotency_key` text not null unique; `created_at`; `handled_at` null | Index (`conversation_id`, `created_at`). |
| `events` | `seq` integer PK autoincrement; `id` text unique not null; `ts`; `type` text not null; `actor_kind` text (`user`/`agent`/`system`/`provider`); `actor_agent_id` null; `actor_user_id` null; `visibility` text (`private`/`shared`/`system`); `opportunity_id` null; `trace_id` text not null; `provider_mode` text null (`live`/`simulated`/`replay`/`fallback`); `payload` json not null | Append-only (no updates, no deletes except `demo:reset`). Index (`visibility`, `actor_agent_id`, `seq`). |
| `outbox` | `id` text PK; `user_id` FK; `kind` text (`info`/`approval_request`/`result`/`invite`); `text` text not null; `approval_id` null; `opportunity_id` null; `status` text (`queued`/`sending`/`dispatched`/`delivered`/`failed`); `provider` text null; `provider_message_id` null; `provider_status` text null; `attempts` integer not null default 0; `last_error` null; `idempotency_key` text not null unique; `created_at`; `sent_at` null; `delivered_at` null | Outbound idempotency and Photon `Idempotency-Key` source. |
| `kv` | `key` text PK; `value` json not null | Flags such as `inbound_paused`, demo run id. |

### 7.2 Purchasing tables (owner A2)

| Table | Columns | Constraints and notes |
| --- | --- | --- |
| `merchant_offers` | `id` PK (`ofr_`); `merchant_name`; `product_key`; `title`; `unit_price_cents` int; `tiers` json (`[{minQty, unitPriceCents}]`); `is_simulated` bool not null default true; `source_label` text not null (shown in UI); `valid_until` | Seeded; no external fetch. |
| `group_purchases` | `id` PK (`grp_`); `opportunity_id` unique FK; `offer_id` FK; `product_key`; `lead_agent_id` FK; `status` (state machine 8.6); `individual_price_cents`; `group_unit_price_cents`; `quantity_per_member`; `savings_per_member_cents`; `pool_account_ref`; `failure_reason` null; `created_at`; `updated_at` | |
| `group_purchase_members` | `group_id` FK; `agent_id` FK; `user_id` FK; `intent_id` FK; `share_cents`; `join_state` (`pending`/`approved`/`declined`/`withdrawn`); `join_approval_id` null; `pay_state` (`none`/`authorized`/`settling`/`settled`/`failed`); `pay_approval_id` null | PK (`group_id`, `agent_id`). |
| `bank_links` | `link_key` text PK (user ID or the literal `pool`); `role` (`member`/`pool`); `provider` (`nessie`/`sim`); `customer_ref`; `account_ref`; `account_label`; `last4`; `baseline_cents` int; `seeded_at` | Allowlist of accounts the executor may touch. |
| `payment_attempts` | `id` PK (`pay_`); `group_id` FK; `user_id` FK; `approval_id` FK; `idempotency_key` text not null unique; `from_account_ref`; `to_account_ref`; `amount_cents`; `status` (`created`/`submitting`/`submitted`/`verified`/`unverified`/`failed`); `provider`; `provider_transfer_id` null; `request_json` null (key redacted); `response_json` null; `balances_before` json null; `balances_after` json null; `verification_note` null; `error` null; `created_at`; `updated_at` | Partial unique index on (`group_id`, `user_id`) where `status` in (`submitting`, `submitted`, `verified`, `unverified`): one live payment per member per group. |

### 7.3 ShortMe tables (owner A3)

| Table | Columns | Constraints and notes |
| --- | --- | --- |
| `markets` | `id` PK (`mkt_`); `opportunity_id` unique; `subject_user_id` FK; `subject_agent_id` FK; `source_intent_id` FK; `category`; `template_key`; `question` text; `resolution_criteria` text; `status` (state machine 8.7); `lock_at` null; `outcome` null (`yes`/`no`/`void`); `resolver_kind` (`demo_standin`/`subject`); `redactions` json; `created_at`; `updated_at`; `opened_at` null; `resolved_at` null | |
| `market_participants` | `market_id` FK; `user_id` FK; `role` (`subject`/`friend`); `invite_state` (`invited`/`accepted`/`declined`/`expired`/`not_applicable`) | PK (`market_id`, `user_id`). |
| `market_positions` | `id` PK (`pos_`); `market_id` FK; `user_id` FK; `side` (`back`/`fade`); `points` int check (points between 1 and 100); `idempotency_key` unique; `created_at` | UNIQUE (`market_id`, `user_id`). `back` means the outcome "yes" (the subject gets the thing); `fade` means "no". |
| `points_accounts` | `user_id` PK FK; `balance` int not null check (balance >= 0) | Derived value; always equals the sum of that user's ledger deltas. |
| `points_ledger` | `id` PK (`led_`); `user_id` FK; `market_id` null; `kind` (`grant`/`stake`/`payout`/`refund`/`adjustment`); `delta` int not null; `balance_after` int not null; `ref_id` null; `idempotency_key` unique; `created_at` | Append-only. |
| `market_resolutions` | `id` PK (`res_`); `market_id` FK; `proposed_outcome` (`yes`/`no`); `proposed_by` (`demo_resolver` or a user ID); `status` (`proposed`/`confirmed`/`disputed`/`voided`); `subject_confirm_state` (`pending`/`confirmed`/`disputed`); `evidence_note` text; `created_at`; `decided_at` null | |

### 7.4 Invariants (each one must have a test)

| ID | Invariant |
| --- | --- |
| L1 | `points_accounts.balance` equals the sum of the user's `points_ledger.delta`, always. |
| L2 | No ledger posting may leave a balance below zero. |
| L3 | For a resolved market, the sum of all `stake`, `payout`, and `refund` deltas for that market is exactly zero. |
| L4 | Ledger and position inserts are idempotent by `idempotency_key`. |
| L5 | A position's points never exceed the user's balance or 100. |
| L6 | A market cannot be resolved twice; `void` refunds every stake exactly once. |
| P1 | At most one live payment attempt per (group, user) (partial unique index). |
| P2 | A payment attempt exists only if an `approved`, unconsumed `authorize_payment` approval with matching payload hash exists; the approval is marked consumed in the same transaction that inserts the attempt. |
| P3 | `amount_cents` equals the member's `share_cents` and does not exceed `NESSIE_MAX_TRANSFER_CENTS`; both accounts are in `bank_links`. |
| P4 | `verified` is set only if the provider read-back shows the transfer with matching amount and payee and both balance deltas equal the amount (or the provider is documented as not updating balances; then the status is `unverified`, never `verified`). |
| A1 | An approval decision applies only to the approval's own user; decisions are idempotent; expired approvals cannot be approved. |
| A2 | An approval's `payload_hash` is the SHA-256 of canonical JSON of `payload`; executors recompute and compare. |
| I1 | `intents.public_payload` contains no field absent from the domain's public schema (enforced by `.strict()` Zod parse before insert). |
| I2 | A revoked or non-shared intent is never returned by `listShared`. |
| E1 | `events` rows are never updated or deleted outside `demo:reset`. |

### 7.5 Seed data (written by `seed()` functions, idempotent)

| Item | Value |
| --- | --- |
| Users | `usr_demo_alice` (first name Alice), `usr_demo_bob` (first name Bob). Handles come from `DEMO_ALICE_HANDLE`, `DEMO_BOB_HANDLE`. |
| Agents | `agt_demo_alice`, `agt_demo_bob`, status `active`, settings all enabled, `ackMode` `none`. |
| Consents | All four scopes granted for both, `via = seed_demo`, `text_version = v1`. |
| Friend links | Alice and Bob, both directions, `can_invite` true. |
| Offers | `ofr_demo_monitor`: merchant "DemoMart (simulated)", product key `monitor_27in_4k`, title "27-inch 4K monitor", unit price 32999 cents, tiers `[{minQty: 2, unitPriceCents: 28499}]`, `is_simulated` true, `source_label` "SIMULATED OFFER, not a real merchant quote". |
| Bank | Nessie customers and accounts for Alice (start $1,500.00), Bob (start $1,200.00), and "Dennis Group Pool" (start $0.00 or the provider minimum). Mapping stored in `bank_links`. |
| Points | 1,000 `grant` ledger entries per user. |

---

## 8. Shared Contracts

These files are created by Agent 1 in milestone A1-01 (first 15 minutes) exactly as specified here, pushed to `main` tagged `contracts-rc`, and frozen as `contracts-v1` at the end of M0. Location: `packages/contracts/src/`. Where a Zod schema is described in a table instead of code, write it with exactly those fields, strict (unknown keys rejected) for anything shared between agents.

Style rule for contract code: exported functions are declarations, callable types are interfaces with call signatures. No default exports.

### 8.1 Primitives: `ids.ts`, `money.ts`, `errors.ts`

```ts
import { z } from "zod";

export const ID_PREFIX = {
  user: "usr", agent: "agt", message: "msg", intent: "int", opportunity: "opp",
  approval: "apr", a2a: "a2a", event: "evt", outbox: "out", offer: "ofr",
  group: "grp", payment: "pay", market: "mkt", position: "pos", ledger: "led",
  resolution: "res", trace: "trc",
} as const;
export type IdKind = keyof typeof ID_PREFIX;

// Accepts generated IDs and fixed seed IDs such as usr_demo_alice.
export function idSchema(kind: IdKind) {
  return z.string().regex(new RegExp("^" + ID_PREFIX[kind] + "_[a-z0-9_]{6,40}$"));
}
export interface IdFactory { next(kind: IdKind): string }

export const Cents = z.number().int().min(0).max(10_000_000);
export function formatUsd(cents: number): string; // 28499 returns "$284.99"

export const ERROR_CODES = [
  "validation_error", "unauthorized", "forbidden", "consent_required", "not_found",
  "conflict", "invalid_state", "idempotency_conflict", "approval_invalid",
  "rate_limited", "upstream_error", "integration_unavailable", "internal",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
export class DennisError extends Error {
  constructor(public code: ErrorCode, message: string, public status: number, public details?: unknown);
}
export const ApiErrorBody = z.object({
  error: z.object({ code: z.enum(ERROR_CODES), message: z.string(), details: z.unknown().optional() }),
});
```

HTTP status mapping: `validation_error` 400, `unauthorized` 401, `forbidden` and `consent_required` 403, `not_found` 404, `conflict`, `invalid_state`, `idempotency_conflict`, `approval_invalid` 409, `rate_limited` 429, `upstream_error` 502, `integration_unavailable` 503, `internal` 500.

### 8.2 Enums and domain schemas: `enums.ts`, `domain.ts`

```ts
export const IsoDateTime = z.iso.datetime();
export const IsoDate = z.iso.date();
export const JsonObject = z.record(z.string(), z.unknown());

export const ConsentScope = z.enum(["messaging_context", "purchase_matching", "shortme_free_play", "sandbox_payments"]);
export const IntentKind = z.enum(["purchase", "milestone"]);
export const IntentStatus = z.enum(["detected", "shared", "matched", "closed", "revoked"]);
export const OpportunityType = z.enum(["group_purchase", "shortme_market"]);
export const ApprovalKind = z.enum(["join_group_purchase", "authorize_payment", "publish_market", "confirm_resolution"]);
export const ApprovalStatus = z.enum(["pending", "approved", "declined", "expired", "revoked"]);
export const DecisionChannel = z.enum(["imessage", "sim_phone", "dashboard_fallback"]);
export const OutboxStatus = z.enum(["queued", "sending", "dispatched", "delivered", "failed"]);
export const EventVisibility = z.enum(["private", "shared", "system"]);
export const ProviderMode = z.enum(["live", "simulated", "replay", "fallback"]);
export const IntegrationName = z.enum(["photon", "llm", "nessie", "chalk"]);
export const RejectReason = z.enum([
  "not_an_intent", "low_confidence", "category_disabled", "sensitive",
  "not_subject_owned", "policy_blocked", "llm_unavailable", "schema_invalid",
]);

export const AgentSettings = z.object({
  matchingEnabled: z.boolean(), shortmeEnabled: z.boolean(), ackMode: z.enum(["none", "reaction"]),
});
export const User = z.object({
  id: idSchema("user"), displayName: z.string(), firstName: z.string(), handle: z.string(),
  handleKind: z.enum(["phone", "email"]), photonUserId: z.string().nullable(),
  isDemo: z.boolean(), regionCode: z.string(), createdAt: IsoDateTime,
});
export const Agent = z.object({
  id: idSchema("agent"), userId: idSchema("user"), name: z.string(),
  status: z.enum(["active", "paused"]), settings: AgentSettings, createdAt: IsoDateTime,
});

// Normalized inbound message produced by every MessagingProvider.
export const InboundMessage = z.object({
  provider: z.enum(["photon", "sim"]), accountKey: z.string(),
  providerMessageId: z.string(), providerSpaceId: z.string().nullable(),
  providerSenderId: z.string().nullable(), senderHandle: z.string(),
  text: z.string().max(4000), receivedAt: IsoDateTime, mode: ProviderMode,
});

export const PurchaseCategory = z.enum(["monitor", "moving_service", "trip", "subscription", "dining", "other"]);
export const Timeframe = z.object({
  kind: z.enum(["this_weekend", "this_week", "this_month", "flexible", "unspecified"]),
  from: IsoDate.nullable(), to: IsoDate.nullable(),
});
export const PurchaseIntentPrivate = z.object({
  productText: z.string().max(200), category: PurchaseCategory,
  quantity: z.number().int().min(1).max(10), budgetMaxCents: Cents.nullable(),
  timeframe: Timeframe, statedCertainty: z.enum(["considering", "decided"]),
  sourceExcerpt: z.string().max(280), // never leaves the owner's private lane
}).strict();
export const PurchaseIntentPublic = z.object({
  category: PurchaseCategory,
  productKey: z.string().max(60),              // normalized, for example monitor_27in_4k
  quantity: z.number().int().min(1).max(10),
  budgetBandMaxCents: Cents.nullable(),         // budget rounded UP to a multiple of 2500 cents
  window: z.object({ from: IsoDate, to: IsoDate }),
  regionCode: z.string().max(16),               // coarse region only
}).strict();

export const MarketCategory = z.enum(["recruiting", "academics", "dating", "friend_event", "other"]);
export const MilestonePrivate = z.object({
  category: MarketCategory, milestoneKind: z.string().max(40),
  proposedQuestion: z.string().max(160), resolvesWithinDays: z.number().int().min(1).max(60).nullable(),
  sensitivity: z.enum(["none", "low", "high"]), redactions: z.array(z.string()).max(5),
  sourceExcerpt: z.string().max(280),
}).strict();
// Milestones have NO public payload. The only shared artifact is a published market.

export const Intent = z.object({
  id: idSchema("intent"), agentId: idSchema("agent"), userId: idSchema("user"),
  kind: IntentKind, status: IntentStatus, sourceMessageId: z.string().nullable(),
  privatePayload: JsonObject, publicPayload: JsonObject.nullable(), shared: z.boolean(),
  confidence: z.number().min(0).max(1), rationale: z.string().max(300),
  createdAt: IsoDateTime, updatedAt: IsoDateTime,
  expiresAt: IsoDateTime.nullable(), revokedAt: IsoDateTime.nullable(),
});
// What OTHER agents may see. No userId, no private payload.
export const SharedIntentView = z.object({
  intentId: idSchema("intent"), agentId: idSchema("agent"), kind: IntentKind,
  publicPayload: JsonObject, createdAt: IsoDateTime,
});

export const Approval = z.object({
  id: idSchema("approval"), shortCode: z.string().length(4), userId: idSchema("user"),
  agentId: idSchema("agent"), opportunityId: z.string().nullable(), kind: ApprovalKind,
  status: ApprovalStatus, payload: JsonObject, payloadHash: z.string().length(64),
  promptText: z.string(), expiresAt: IsoDateTime, decidedAt: IsoDateTime.nullable(),
  decidedVia: DecisionChannel.nullable(), consumedAt: IsoDateTime.nullable(), createdAt: IsoDateTime,
});
export const Opportunity = z.object({
  id: idSchema("opportunity"), type: OpportunityType, domainRefId: z.string(), status: z.string(),
  headline: z.string(), participantAgentIds: z.array(idSchema("agent")),
  createdAt: IsoDateTime, updatedAt: IsoDateTime,
});
export const OutboxRecord = z.object({
  id: idSchema("outbox"), userId: idSchema("user"), kind: z.enum(["info", "approval_request", "result", "invite"]),
  text: z.string(), approvalId: z.string().nullable(), opportunityId: z.string().nullable(),
  status: OutboxStatus, provider: z.string().nullable(), providerMessageId: z.string().nullable(),
  providerStatus: z.enum(["dispatched", "accepted", "delivered", "failed"]).nullable(),
  attempts: z.number().int(), lastError: z.string().nullable(), createdAt: IsoDateTime,
  sentAt: IsoDateTime.nullable(), deliveredAt: IsoDateTime.nullable(),
});
export const IntegrationStatus = z.object({
  name: IntegrationName, mode: ProviderMode, healthy: z.boolean(), detail: z.string(),
  lastCheckedAt: IsoDateTime, lastSuccessAt: IsoDateTime.nullable(),
});
export const ProviderSendRequest = z.object({
  accountKey: z.string(), toHandle: z.string(), toPhotonUserId: z.string().nullable(),
  spaceId: z.string().nullable(), text: z.string().max(1500), idempotencyKey: z.string(),
});
export const ProviderSendResult = z.object({
  providerMessageId: z.string(), status: z.enum(["dispatched", "accepted", "delivered", "failed"]),
  mode: ProviderMode, spaceId: z.string().nullable(), photonUserId: z.string().nullable(),
});
```

Domain schemas for purchasing (`purchasing.ts`) and ShortMe (`shortme.ts`) are written in A1-01 from the table columns in Sections 7.2 and 7.3 (one Zod object per table, camelCase fields, same enums), plus the API request and response schemas in Section 9 (`api.ts`). `config.ts` holds `AppConfigSchema` with exactly the environment variables of Section 16.1, camelCased.

### 8.3 Domain events: `events.ts`

Envelope (stored in `events`, streamed over SSE as `event: domain`, `id: <seq>`):

```ts
export const EventActor = z.object({
  kind: z.enum(["user", "agent", "system", "provider"]),
  agentId: z.string().optional(), userId: z.string().optional(),
});
export const DomainEvent = z.object({
  seq: z.number().int(), id: idSchema("event"), ts: IsoDateTime, type: z.string(),
  actor: EventActor, visibility: EventVisibility, opportunityId: z.string().nullable(),
  traceId: z.string(), mode: ProviderMode.nullable(), payload: JsonObject,
});
export const NewEvent = z.object({
  type: z.string(), actor: EventActor, visibility: EventVisibility,
  opportunityId: z.string().optional(), traceId: z.string().optional(),
  mode: ProviderMode.optional(), payload: JsonObject,
});
```

`EVENT_PAYLOAD_SCHEMAS` maps each type below to a strict Zod object with exactly the listed fields. `EventBus.emit` validates the payload against it and throws `DennisError("internal")` in tests and logs `error.logged` in production on mismatch. Every `shared` event must satisfy the minimal-data rule: no raw message text, no handles, no private payload fields.

| Type | Emitted by | Visibility | Payload fields |
| --- | --- | --- | --- |
| `message.received` | A1 | private | `messageId`, `provider`, `text` |
| `message.ignored` | A1 | system | `messageId?`, `reason` (`unknown_handle`, `no_consent`, `paused`, `non_text`, `own_message`, `replay`) |
| `command.handled` | A1 | private | `messageId`, `command`, `ok`, `note?` |
| `consent.changed` | A1 | private | `userId`, `scope`, `status`, `via` |
| `agent.status_changed` | A1 | private | `agentId`, `status` |
| `intent.detected` | A1 | private | `intentId`, `kind`, `confidence`, `rationale`, `summary`, `detectorId`, `llm` (`provider`, `model`, `latencyMs`) or null |
| `intent.rejected` | A1 | private | `messageId`, `detectorId`, `reason`, `detail` |
| `intent.registered` | A2 | shared | `intentId`, `agentId`, `kind`, `publicPayload` |
| `intent.revoked` | A1 | shared | `intentId`, `agentId`, `reason` |
| `a2a.sent` | A1 | shared | `a2aId`, `conversationId`, `type`, `fromAgentId`, `toAgentId`, `payload` |
| `a2a.handled` | A1 | shared | `a2aId`, `type`, `toAgentId`, `ok`, `error?` |
| `approval.requested` | A1 | private | `approvalId`, `kind`, `shortCode`, `expiresAt`, `summary` |
| `approval.decided` | A1 | private | `approvalId`, `kind`, `status`, `via` |
| `approval.expired` | A1 | private | `approvalId`, `kind` |
| `outbox.queued` | A1 | private | `outboxId`, `userId`, `kind`, `preview` |
| `outbox.updated` | A1 | private | `outboxId`, `status`, `providerStatus?`, `providerMessageId?`, `provider`, `error?` |
| `opportunity.updated` | A1 | shared | `opportunityId`, `type`, `status`, `headline` |
| `purchase.match.evaluated` | A2 | shared | `conversationId`, `aAgentId`, `bAgentId`, `compatible`, `checks` (array of `rule`, `passed`, `detail`) |
| `purchase.group.updated` | A2 | shared | `groupId`, `status`, `members` (array of `agentId`, `join`, `pay`), `savingsPerMemberCents?` |
| `purchase.payment.updated` | A2 | private | `attemptId`, `groupId`, `userId`, `status`, `amountCents`, `providerTransferId?`, `balancesBefore?`, `balancesAfter?`, `note?`, `mode` |
| `bank.seeded` | A2 | system | `provider`, `mode`, `accounts` (array of `label`, `last4`, `balanceCents`) |
| `shortme.market.updated` | A3 | private while `proposed`, shared after | `marketId`, `status`, `question`, `subjectAgentId` |
| `shortme.position.placed` | A3 | shared | `marketId`, `agentId`, `side`, `points`, `selfShort` |
| `shortme.resolution.updated` | A3 | shared | `marketId`, `status`, `proposedOutcome?`, `subjectConfirmState` |
| `shortme.ledger.posted` | A3 | shared | `marketId?`, `entries` (array of `agentId`, `kind`, `delta`, `balanceAfter`), `invariantOk` |
| `integration.status` | A1 | system | one `IntegrationStatus` |
| `demo.reset` | A4 | system | `runId` |
| `eval.report` | A3 | system | `provider`, `runId` |
| `error.logged` | any | system | `where`, `message` |

### 8.4 Agent-to-agent messages: `a2a.ts`

Envelope fields (table `a2a_messages`): `id`, `conversationId` (one per opportunity attempt, `cnv_` plus the lead intent ID), `type`, `fromAgentId`, `toAgentId`, `opportunityId?`, `payload`, `idempotencyKey`. Payloads are strict and minimal; the receiving handler validates before acting and replies with reason codes, never free text.

| Type | Sender to receiver | Payload fields |
| --- | --- | --- |
| `purchase.probe` | lead agent to candidate agent | `intentRef`, `publicIntent` (`PurchaseIntentPublic`), `leadAgentId` |
| `purchase.probe_result` | candidate to lead | `intentRef`, `compatible`, `reasons` (array of `budget_overlap`, `window_overlap`, `product_match`, `region_match`, `matching_disabled`, `already_matched`, `budget_too_low`) |
| `purchase.proposal` | lead to candidate | `groupId`, `offerId`, `productKey`, `individualPriceCents`, `groupUnitPriceCents`, `savingsPerMemberCents`, `quantityPerMember`, `isSimulatedOffer` (literal true), `validUntil` |
| `purchase.proposal_result` | candidate to lead | `groupId`, `accept`, `reasons` (array of `accepted`, `savings_below_threshold`, `over_budget`, `matching_disabled`) |
| `market.invite` | subject's agent to friend's agent | `marketId`, `question`, `subjectFirstName`, `pointsOnly` (literal true), `startingPoints`, `expiresAt` |
| `market.invite_response` | friend's agent to subject's agent | `marketId`, `response` (`accepted`, `declined`, `expired`) |

### 8.5 Command grammar: `commands.ts`

Parsing is deterministic and case-insensitive, trims whitespace, accepts an optional trailing 4-character code, ignores trailing punctuation. Platform implements `parseCommand`; feature-owned commands are routed through `CommandRegistry`.

| Input examples | Parsed command |
| --- | --- |
| `AGREE` / `AGREE SHORTME` / `AGREE PAYMENTS` | `agree` with `scope` `base` (grants `messaging_context` and `purchase_matching`), `shortme` (grants `shortme_free_play` and records the 18+ confirmation), `payments` (grants `sandbox_payments`) |
| `STOP`, `PAUSE`, `RESUME`, `STATUS`, `FORGET`, `HELP` | same-named command (`STOP` revokes all scopes and pauses; `FORGET` deletes data) |
| `YES`, `Y`, `APPROVE`, `OK`, optional code | `approve` |
| `NO`, `N`, `DECLINE`, optional code | `decline` |
| `BACK 50`, `BACK 50 a7f3` | `back` with `points` |
| `FADE 30`, `FADE 30 a7f3` | `fade` with `points` |
| `PASS`, `PASS a7f3` | `pass` |
| `CONFIRM`, `CONFIRM a7f3` | `confirm` (resolved as approve on a `confirm_resolution` approval) |
| `DISPUTE`, `DISPUTE a7f3` | `dispute` (resolved as decline on a `confirm_resolution` approval, then the ShortMe hook moves the market to `disputed`) |
| anything else | `none` (goes to the detector pipeline) |

Code resolution: if a code is present, it selects the pending approval (or open invitation) with that code for that user. If absent and exactly one is pending, it applies to that one. If absent and several are pending, the reply is `Which one? Reply YES followed by the 4-character code.`

```ts
export type ParsedCommand =
  | { kind: "agree"; scope: "base" | "shortme" | "payments" }
  | { kind: "stop" } | { kind: "pause" } | { kind: "resume" }
  | { kind: "status" } | { kind: "forget" } | { kind: "help" }
  | { kind: "approve"; code: string | null }
  | { kind: "decline"; code: string | null }
  | { kind: "back"; points: number; code: string | null }
  | { kind: "fade"; points: number; code: string | null }
  | { kind: "pass"; code: string | null }
  | { kind: "confirm"; code: string | null }
  | { kind: "dispute"; code: string | null }
  | { kind: "none" };
export function parseCommand(text: string): ParsedCommand;
```

### 8.6 State machine: group purchase (owner A2)

Statuses: `proposed`, `awaiting_join_approvals`, `confirmed`, `awaiting_payment_approvals`, `ready_to_settle`, `settling`, `settled`, `failed`, `cancelled`, `expired`. Terminal: `settled`, `cancelled`, `expired`. Every transition emits `purchase.group.updated` and updates the opportunity in the same transaction.

| From | Trigger | Guard | To | Effects |
| --- | --- | --- | --- | --- |
| (none) | lead sends `purchase.proposal` | probe was compatible | `proposed` | insert group and members |
| `proposed` | `purchase.proposal_result` accept true | both private checks passed | `awaiting_join_approvals` | each agent requests `join_group_purchase` for its own user |
| `proposed` | proposal result accept false | none | `cancelled` | no user is notified |
| `awaiting_join_approvals` | one member approves | others pending | same | member `join_state = approved` |
| `awaiting_join_approvals` | all members approve | all consents valid | `confirmed` then immediately `awaiting_payment_approvals` | reveal first names; request `authorize_payment` approvals |
| `awaiting_join_approvals` | any member declines | none | `cancelled` | notify the others neutrally ("the other person passed") |
| `awaiting_join_approvals` or `awaiting_payment_approvals` | approval expires | none | `expired` | notify members |
| `awaiting_payment_approvals` | all members authorize | all have `sandbox_payments`; accounts in allowlist | `ready_to_settle` | enqueue settlement |
| `awaiting_payment_approvals` | any member declines | none | `cancelled` | notify |
| `ready_to_settle` | executor starts | per-group lock held | `settling` | one attempt per member |
| `settling` | all members `verified` or `unverified` | none | `settled` | final notification |
| `settling` | a member attempt fails | none | `failed` | `failure_reason` set; members already paid stay paid |
| `failed` | retry route or re-approval | approval still valid, unconsumed | `settling` | only failed members retried |
| any non-terminal | a member revokes `purchase_matching` or `sandbox_payments` before `settling` | none | `cancelled` | notify others neutrally |

### 8.7 State machine: ShortMe market (owner A3)

Statuses: `proposed`, `declined`, `expired`, `open`, `locked`, `resolution_proposed`, `resolved`, `disputed`, `void`. Terminal: `declined`, `expired`, `resolved`, `void`.

| From | Trigger | Guard | To | Effects |
| --- | --- | --- | --- | --- |
| (none) | milestone detection passes gates | template enabled, subject has `shortme_free_play` | `proposed` | event visible only to the subject; `publish_market` approval requested |
| `proposed` | approval approved | payload hash matches | `open` | invitations sent to invitees who hold `shortme_free_play` |
| `proposed` | approval declined | none | `declined` | nothing leaves the subject's lane |
| `proposed` | approval expires | none | `expired` | none |
| `open` | position placed | user not already positioned; points between 1 and min(100, balance); user is an invited participant or the subject | `open` | stake ledger entry, event |
| `open` | `PASS` or invite expiry | none | `open` | participant `declined` or `expired` |
| `open` | lock (manual route or `lock_at`) | none | `locked` | betting closed |
| `open` or `locked` | resolution proposed | at least one `back` and one `fade` position | `resolution_proposed` | `confirm_resolution` approval requested for the subject |
| `open` or `locked` | void requested, or no counterparty at resolution | none | `void` | refund every stake once |
| `resolution_proposed` | subject confirms | approval valid, unconsumed | `resolved` | payouts posted atomically, invariant L3 asserted |
| `resolution_proposed` | subject or any participant disputes | none | `disputed` | payouts frozen |
| `resolution_proposed` | approval expires | none | `locked` | resolution cleared |
| `disputed` | admin resolves (admin token) | outcome supplied | `resolved` | payouts |
| `disputed` | admin voids | admin token | `void` | refunds |

Payout rule (pari-mutuel). `pool` is the sum of all stakes. Winners are `back` positions when the outcome is `yes`, `fade` positions when it is `no`. Each winner receives `floor(pool * stake / winnersTotal)`; any remainder points go to the largest winning stake (ties: earliest position) so payouts sum to exactly `pool`. If `winnersTotal` is 0 or the losing side is 0, the market is voided and refunded. Example: Alice `fade` 50, Bob `back` 50, outcome `no`: pool 100, Alice receives 100 (net +50), Bob net -50.

### 8.8 Ports (interfaces): `ports.ts`

```ts
export interface Clock { now(): Date; nowIso(): string }
export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}
export interface Unsubscribe { (): void }
export interface Job<T> { (): Promise<T> }

// ---------- Messaging (owner A1, package @dennis/messaging) ----------
export interface InboundHandler { (msg: InboundMessage): Promise<void> }
export interface MessagingProvider {
  readonly name: "photon" | "sim";
  start(handler: InboundHandler): Promise<void>;
  stop(): Promise<void>;
  send(req: ProviderSendRequest): Promise<ProviderSendResult>;
  health(): Promise<IntegrationStatus>;
}

// ---------- Banking (owner A2, package @dennis/purchasing) ----------
export interface BankAccountView { accountRef: string; label: string; last4: string; balanceCents: number; ownerKey: string }
export interface SeedBankingInput { members: { linkKey: string; displayName: string; startCents: number }[]; poolStartCents: number; runTag: string }
export interface BankSeedResult { provider: "nessie" | "sim"; accounts: BankAccountView[]; created: number; reused: number }
export interface BankTransferRequest {
  fromAccountRef: string; toAccountRef: string; amountCents: number;
  memo: string; // must contain the payment attempt idempotency key
}
export interface BankTransferRecord {
  providerTransferId: string; fromAccountRef: string; toAccountRef: string;
  amountCents: number; status: string; memo: string | null; createdAt: string | null; raw: unknown;
}
export interface BankTransferResult { record: BankTransferRecord; mode: "live" | "simulated" }
export interface BankingProvider {
  readonly name: "nessie" | "sim";
  ensureSeeded(input: SeedBankingInput): Promise<BankSeedResult>;
  getBalance(accountRef: string): Promise<{ accountRef: string; balanceCents: number; fetchedAt: string }>;
  listAccounts(): Promise<BankAccountView[]>;
  transfer(req: BankTransferRequest): Promise<BankTransferResult>;
  getTransfer(providerTransferId: string): Promise<BankTransferRecord | null>;
  findTransfersByMemo(accountRef: string, memoContains: string): Promise<BankTransferRecord[]>;
  health(): Promise<IntegrationStatus>;
}

// ---------- LLM (owner A3, package @dennis/llm) ----------
export interface LlmUsage { inputTokens: number; outputTokens: number }
export interface StructuredRequest<T> {
  task: string;            // for example "purchase_detector_v1"
  system: string; user: string; schema: z.ZodType<T>;
  maxTokens?: number; temperature?: number; timeoutMs?: number; traceId?: string;
}
export interface StructuredResult<T> {
  value: T; usage: LlmUsage; model: string; provider: "anthropic" | "chalk_gateway" | "mock";
  latencyMs: number; attempts: number;
}
export interface StructuredLlm {
  readonly name: "anthropic" | "chalk_gateway" | "mock";
  generate<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
  health(): Promise<IntegrationStatus>;
}

// ---------- Detectors (interface: A1; implementations: A2 purchase, A3 milestone) ----------
export interface DetectorInput {
  agentId: string; userId: string; messageId: string; text: string; receivedAt: string;
  recentContext: string[];        // up to 3 earlier authorized messages from the same user
  regionCode: string; enabledCategories: string[];
}
export interface DetectorDeps { llm: StructuredLlm; clock: Clock; log: Logger }
export interface Detection {
  kind: "purchase" | "milestone"; confidence: number; rationale: string;
  privatePayload: Record<string, unknown>;             // validated against PurchaseIntentPrivate or MilestonePrivate
  publicPayload: Record<string, unknown> | null;       // validated against PurchaseIntentPublic, else null
  summary: string;                                     // one short line for the private lane
}
export interface DetectorOutcome {
  detections: Detection[];
  rejected: { reason: z.infer<typeof RejectReason>; detail: string }[];
  llm: { provider: string; model: string; latencyMs: number } | null;
}
export interface Detector {
  readonly id: "purchase" | "milestone";
  readonly intentKind: "purchase" | "milestone";
  detect(input: DetectorInput, deps: DetectorDeps): Promise<DetectorOutcome>;
}
export interface DetectionHandler { (input: { intent: Intent; agent: Agent }): Promise<void> }
export interface DetectorRegistry {
  register(detector: Detector): void;
  list(): Detector[];
  onDetection(kind: "purchase" | "milestone", handler: DetectionHandler): void;
  handlersFor(kind: "purchase" | "milestone"): DetectionHandler[];
}

// ---------- Platform services (owner A1, package @dennis/platform) ----------
export interface EventBus {
  emit(e: z.infer<typeof NewEvent>): z.infer<typeof DomainEvent>;
  subscribe(filter: { viewerAgentId?: string; judge?: boolean }, listener: EventListener): Unsubscribe;
  history(q: { sinceSeq?: number; limit?: number; viewerAgentId?: string; judge?: boolean }): z.infer<typeof DomainEvent>[];
}
export interface EventListener { (e: z.infer<typeof DomainEvent>): void }

export interface ConsentService {
  has(userId: string, scope: ConsentScopeT): Promise<boolean>;
  require(userId: string, scope: ConsentScopeT): Promise<void>;  // throws DennisError("consent_required")
  set(input: { userId: string; scope: ConsentScopeT; granted: boolean; via: "imessage" | "dashboard" | "seed_demo" | "sim_phone" }): Promise<void>;
  onRevoked(handler: ConsentRevokedHandler): void;
}
export interface ConsentRevokedHandler { (userId: string, scope: ConsentScopeT): Promise<void> }

export interface ApprovalRequestInput {
  kind: ApprovalKindT; userId: string; agentId: string; opportunityId?: string;
  payload: Record<string, unknown>;   // EXACTLY what the user is approving
  promptText: string;                 // contains the literal token {code}
  ttlMinutes: number; idempotencyKey: string;
}
export interface ApprovalService {
  request(input: ApprovalRequestInput): Promise<ApprovalT>;     // creates, queues the notification, emits events
  decide(input: { approvalId: string; userId: string; decision: "approve" | "decline"; via: DecisionChannelT }): Promise<ApprovalT>;
  get(approvalId: string): Promise<ApprovalT | null>;
  findPending(userId: string, code: string | null): Promise<ApprovalT[]>;
  // Throws DennisError("approval_invalid") unless approved, unexpired, unconsumed, same user, same kind, same payload hash.
  assertApproved(input: { approvalId: string; userId: string; kind: ApprovalKindT; payloadHash: string }): Promise<ApprovalT>;
  consume(approvalId: string): Promise<void>;                    // call inside the same DB transaction as the guarded action
  onDecided(kind: ApprovalKindT, handler: ApprovalDecidedHandler): void;
  expireDue(): Promise<number>;
}
export interface ApprovalDecidedHandler { (approval: ApprovalT): Promise<void> }
export function hashPayload(payload: Record<string, unknown>): string; // sha256 hex of canonical (sorted-key) JSON

export interface NotifyRequest {
  userId: string; kind: "info" | "approval_request" | "result" | "invite"; text: string;
  approvalId?: string; opportunityId?: string; idempotencyKey: string;
}
export interface Notifier { send(req: NotifyRequest): Promise<OutboxRecordT> }

export interface A2ASendInput {
  type: A2ATypeT; fromAgentId: string; toAgentId: string; conversationId: string;
  opportunityId?: string; payload: Record<string, unknown>; idempotencyKey: string;
}
export interface A2AMessage { id: string; type: A2ATypeT; fromAgentId: string; toAgentId: string; conversationId: string; opportunityId: string | null; payload: Record<string, unknown>; createdAt: string }
export interface A2AHandler { (msg: A2AMessage): Promise<void> }
export interface A2ABus {
  send(input: A2ASendInput): Promise<A2AMessage>;             // validates payload, persists, emits a2a.sent, schedules delivery
  on(type: A2ATypeT, handler: A2AHandler): void;              // handler runs serialized per receiving agent
  listConversation(conversationId: string): Promise<A2AMessage[]>;
}

export interface NewIntent {
  agentId: string; userId: string; kind: "purchase" | "milestone"; sourceMessageId: string | null;
  privatePayload: Record<string, unknown>; publicPayload: Record<string, unknown> | null;
  confidence: number; rationale: string; expiresAt?: string;
}
export interface IntentStore {
  create(input: NewIntent): Promise<IntentT>;
  get(id: string): Promise<IntentT | null>;
  listByAgent(agentId: string, filter?: { kind?: "purchase" | "milestone"; status?: IntentStatusT }): Promise<IntentT[]>;
  listShared(filter: { kind: "purchase" | "milestone"; excludeAgentId: string }): Promise<SharedIntentViewT[]>;
  markShared(id: string): Promise<IntentT>;
  setStatus(id: string, status: IntentStatusT, reason?: string): Promise<IntentT>;
  revoke(id: string, by: { userId: string }): Promise<IntentT>;   // clears shared flag, emits intent.revoked
}
export interface UpsertOpportunity {
  type: OpportunityTypeT; domainRefId: string; status: string; headline: string; participantAgentIds: string[];
}
export interface OpportunityStore {
  upsert(input: UpsertOpportunity): Promise<OpportunityT>;   // emits opportunity.updated
  get(id: string): Promise<OpportunityT | null>;
  list(filter?: { type?: OpportunityTypeT; viewerAgentId?: string; limit?: number }): Promise<OpportunityT[]>;
}
export interface UserDirectory {
  getByHandle(handle: string): Promise<UserT | null>;
  get(userId: string): Promise<UserT | null>;
  getAgentByUserId(userId: string): Promise<AgentT | null>;
  getAgent(agentId: string): Promise<AgentT | null>;
  listFriends(userId: string, opts?: { canInvite?: boolean }): Promise<UserT[]>;
}
export interface CommandInput { userId: string; agentId: string; command: ParsedCommand; messageId: string }
export interface CommandHandler { (input: CommandInput): Promise<{ reply?: string }> }
export interface CommandRegistry { register(kind: "back" | "fade" | "pass", handler: CommandHandler): void }
export interface IntegrationRegistry {
  report(status: IntegrationStatusT): void;       // emits integration.status when mode or health changes
  list(): IntegrationStatusT[];
}
```

(`ConsentScopeT`, `ApprovalT`, and the other `T`-suffixed names stand for `z.infer` of the schemas in 8.2; define them in the file as `export type ApprovalT = z.infer<typeof Approval>` and so on.)

`PlatformContext` and `FeatureModule` live in `@dennis/platform` (they need the `Db` type and Hono):

```ts
export interface PlatformContext {
  readonly config: AppConfig; readonly db: Db; readonly clock: Clock; readonly ids: IdFactory; readonly log: Logger;
  readonly events: EventBus; readonly consent: ConsentService; readonly approvals: ApprovalService;
  readonly notifier: Notifier; readonly a2a: A2ABus; readonly intents: IntentStore;
  readonly opportunities: OpportunityStore; readonly users: UserDirectory; readonly commands: CommandRegistry;
  readonly detectors: DetectorRegistry; readonly llm: StructuredLlm; readonly messaging: MessagingProvider;
  readonly integrations: IntegrationRegistry;
  runExclusive<T>(key: string, fn: Job<T>): Promise<T>;
}
export interface FeatureModule {
  readonly name: "purchasing" | "shortme";
  register(ctx: PlatformContext): Promise<void>;   // detector, detection handler, A2A handlers, approval hooks, consent-revoked hooks, commands
  routes(ctx: PlatformContext): Hono;              // mounted by apps/server at /api/purchasing or /api/shortme
  seed(ctx: PlatformContext): Promise<void>;       // idempotent
  reset(ctx: PlatformContext): Promise<void>;      // deletes only this module's rows
  recover(ctx: PlatformContext): Promise<void>;    // boot recovery for this module
}
```

### 8.9 Canonical message templates (use verbatim; only substitute `{placeholders}`)

Money inside any user-facing text is formatted by code from integer cents. The LLM never writes an amount, a code, or a name.

| Template ID | Owner | Text |
| --- | --- | --- |
| `onboarding` | A1 | `Hi {first}, I'm Dennis, your personal agent. With your OK I can notice plans in this chat, like things you want to buy, and talk to other people's agents to find ways to save. I share only a minimal anonymous summary, never your messages, and I ask before anything involving your name or money. Reply AGREE to turn this on. STOP any time.` |
| `join_group` | A2 | `Dennis for {first}: another Dennis user is also shopping for a {productLabel}. Together you'd each pay {group} instead of {individual}, saving {savings}. SIMULATED group offer from {merchant}. If you join, your first name is shared with them. Nothing is charged yet. Reply YES {code} to join or NO {code} to skip.` |
| `authorize_payment` | A2 | `Dennis for {first}: authorize a SANDBOX transfer of {amount} from your demo account ending {last4} to the group pool for the {productLabel}? Sandbox money only, no real funds. Reply YES {code} to authorize or NO {code} to cancel.` |
| `payment_result` | A2 | `Done, {first}: sandbox transfer of {amount} {verificationWord}. Ref {shortRef}. Demo balance now {balance}.` where `verificationWord` is `verified` or `recorded but not verified` |
| `publish_market` | A3 | `Dennis for {first}: that sounded like a ShortMe moment. Want a private, free-to-play market for friends: "{question}"? Invited: {names}. Points only, no money, no prizes. Reply YES {code} to publish or NO {code} to drop it.` |
| `market_invite` | A3 | `ShortMe from {subjectFirst}'s agent: "{question}" Fictional points only, you have {points}. Reply BACK <pts> {code} ({subjectFirst} gets it), FADE <pts> {code} ({subjectFirst} doesn't), or PASS {code}.` |
| `confirm_resolution` | A3 | `ShortMe: proposed outcome for "{question}" is {OUTCOME}. Reply CONFIRM {code} or DISPUTE {code}.` |
| `market_result` | A3 | `ShortMe result: {outcomeSentence} {quip} Points: {deltaLine}. (Fictional points, no value.)` The `quip` is LLM text, at most 140 characters, no digits, no currency symbols, no names other than the subject's first name, checked by code; on any failure use the fixed fallback `Ouch and congratulations, in that order.` |

### 8.10 Evaluation contracts: `eval.ts`

```ts
export const EvalSuite = z.enum(["purchase_extraction", "milestone_extraction", "pair_match"]);
export const EvalLabel = z.enum(["positive", "negative", "ambiguous", "privacy_restricted"]);
export const EvalCase = z.object({
  id: z.string(), suite: EvalSuite, label: EvalLabel, synthetic: z.literal(true),
  textA: z.string(), textB: z.string().nullable(),   // textB only for pair_match
  expected: z.object({
    decision: z.enum(["create_intent", "no_intent", "blocked", "propose_market", "no_market", "blocked_policy", "match", "no_match"]),
    category: z.string().nullable(), mustNotLeak: z.array(z.string()),
  }),
  note: z.string(),
});
export const EvalSuiteResult = z.object({
  suite: EvalSuite, total: z.number().int(), precision: z.number(), recall: z.number(), f1: z.number(),
  falsePositives: z.number().int(), privacyLeaks: z.number().int(),
});
export const EvalExample = z.object({
  caseId: z.string(), suite: EvalSuite, label: EvalLabel, expected: z.string(), actual: z.string(), note: z.string(),
});
export const EvalReport = z.object({
  provider: z.enum(["chalk", "local"]), runId: z.string(), startedAt: IsoDateTime, finishedAt: IsoDateTime,
  datasetVersion: z.string(), dashboardUrl: z.string().nullable(),
  suites: z.array(EvalSuiteResult), successes: z.array(EvalExample), failures: z.array(EvalExample),
});
```

### 8.11 Compact shared-interface contract card (all four agents must follow)

| Contract | Owner | Location | Every agent must |
| --- | --- | --- | --- |
| Zod schemas and types (IDs, enums, domain, events, A2A payloads, API, eval) | A1 steward, frozen at `contracts-v1` | `packages/contracts/src/*` | Import from `@dennis/contracts` only. Never redefine a shape locally. Additive changes only, via `docs/CONTRACT_REQUESTS.md`. |
| Ports: `MessagingProvider`, `BankingProvider`, `StructuredLlm`, `Detector` | A1, A2, A3, A1 interface and A2 and A3 implementations | `ports.ts` | Code against the interface. Each owner ships a `Mock` or simulated implementation in M0. |
| Platform services: `EventBus`, `ConsentService`, `ApprovalService`, `Notifier`, `A2ABus`, `IntentStore`, `OpportunityStore`, `UserDirectory`, `CommandRegistry`, `IntegrationRegistry` | A1 | `packages/platform` | Use only through `PlatformContext`. Never write core tables directly. |
| `FeatureModule` | A2 (`purchasingModule`), A3 (`shortmeModule`) | `packages/purchasing`, `packages/shortme` | Export one module object; register everything inside `register(ctx)`. Never edit `apps/server/src/compose.ts`. |
| Events | emitter owns the schema entry, A1 owns `events.ts` | Section 8.3 | Emit only listed types with exact payload fields. Shared events carry minimal data only. |
| A2A messages | A1 bus, A2 and A3 handlers | Section 8.4 | Send only listed types. Reply with reason codes. |
| Approvals | A1 engine, A2 and A3 hooks | `ApprovalService` | Bind every consequential action to an approved, unconsumed approval with a matching `payloadHash`. |
| Command grammar | A1 parser, A3 owns `back` `fade` `pass` handlers | Section 8.5 | Do not parse user text elsewhere. |
| Money | all | `Cents`, `formatUsd` | Integer cents internally; dollars only inside the Nessie adapter. |
| Idempotency | all | unique keys in Section 7 | Every write that can be retried carries an idempotency key. |
| Labels | all | `ProviderMode` | Anything simulated, replayed, or fallback says so in events and UI. |
| Ownership | A4 enforces | `ownership.json`, `scripts/check-ownership.ts` | Touch only files you own. |

---

## 9. API Contract

Base URL: `http://localhost:${PORT_SERVER}` (default 4000). JSON in, JSON out. Schemas named below live in `packages/contracts/src/api.ts` and are written in A1-01 from this section; request and response bodies are validated with `@hono/zod-validator` on the server and imported as types by the web app.

**Auth model.**

- No user login. Routes marked ADMIN require header `x-dennis-admin: <DENNIS_ADMIN_TOKEN>`; missing or wrong token returns `401 unauthorized`.
- The Next.js app proxies `/api/*` to the server through a route handler (`apps/web/src/app/api/[...path]/route.ts`) that adds the admin header from a server-only env var. The browser never sees the token. The server and web app bind to localhost.
- `viewerAgentId` is the privacy lens. With it, results are filtered to what that agent may see. Without it, event and intent routes return the judge view and require ADMIN.

**Errors.** Every non-2xx body is `ApiErrorBody` (Section 8.1). Zod failures return `400 validation_error` with `details` set to the issue list. `GET` list routes accept `limit` (default 50, maximum 200).

**Response types used below** (all in `api.ts`): `UserSummary` = `{ user (handle masked to its last 4 characters), agent, consents: Record<ConsentScope, boolean>, pendingApprovals: number }`; `ConsentState` = `{ scope, granted, updatedAt, via }`; `IntentView` = `Intent` with `privatePayload` removed unless the viewer owns it; `ExplainTrace` = `{ opportunityId, steps: { seq, ts, type, agentId?, summary, checks?: { rule, passed, detail }[] }[] }`; `GroupDetail` = `{ group, members (first names only after the group is `confirmed`), offer, savingsPerMemberCents, payments: PaymentAttemptView[] }`; `PaymentAttemptView` = payment attempt row without `request_json`; `MarketDetail` = `{ market, participants, positions, pools: { back, fade }, resolution, payoutPreview }`; `DemoState` = `{ runId, modes, checklist: { id, label, ok }[] }`.

### 9.1 Platform routes (owner A1)

| Method and path | Auth | Request | Response | Errors |
| --- | --- | --- | --- | --- |
| `GET /api/health` | none | none | `{ status: "ok", time, dbOk, modes: { photon, llm, nessie } }` | 503 `integration_unavailable` if the database is unreachable |
| `GET /api/integrations` | none | none | `IntegrationStatus[]` (photon, llm, nessie, chalk) | none |
| `GET /api/users` | none | none | `UserSummary[]` | none |
| `GET /api/users/:userId` | none | none | `UserSummary` | 404 `not_found` |
| `PATCH /api/agents/:agentId/settings` | none | `Partial<AgentSettings>` | `Agent` | 404, 400 |
| `POST /api/agents/:agentId/pause` | none | `{ paused: boolean }` | `Agent` | 404 |
| `GET /api/consents?userId=` | none | query `userId` | `ConsentState[]` | 404 user |
| `POST /api/consents` | none | `{ userId, scope, granted }` (recorded `via: "dashboard"`) | `ConsentState`; revocation cascades (Section 14.5) | 404, 400 |
| `POST /api/privacy/forget` | none | `{ userId }` | `{ deleted: { messages, intents, positions } }` | 404 |
| `GET /api/intents` | ADMIN unless `viewerAgentId` | query `agentId?`, `kind?`, `viewerAgentId?` | `IntentView[]` | 401, 400 |
| `POST /api/intents/:intentId/revoke` | none | `{ userId }` | `Intent` | 404; 403 `forbidden` if not the owner |
| `GET /api/events` | ADMIN unless `viewerAgentId` | query `sinceSeq?`, `limit?`, `viewerAgentId?` | `{ events: DomainEvent[], lastSeq }` | 401, 400 |
| `GET /api/events/stream` | ADMIN unless `viewerAgentId` | query `viewerAgentId?`, `sinceSeq?`; header `Last-Event-ID` | SSE: `event: domain`, `id: <seq>`, `data: <DomainEvent JSON>`; comment heartbeat every 15 s; replays history after `sinceSeq` or `Last-Event-ID`, then live | 401 |
| `GET /api/a2a` | ADMIN | query `conversationId?` or `opportunityId?` | `A2AMessage[]` | 401, 400 |
| `GET /api/approvals` | none | query `userId`, `status?` | `Approval[]` | 400 |
| `POST /api/approvals/:approvalId/decision` | none | `{ userId, decision }` (recorded `via: "dashboard_fallback"`) | `Approval` | 404; 403 wrong user; 409 `approval_invalid` (expired, already decided) |
| `GET /api/outbox` | none | query `userId`, `limit?` | `OutboxRecord[]` | 400 |
| `GET /api/opportunities` | none | query `type?`, `viewerAgentId?` | `Opportunity[]` | none |
| `GET /api/opportunities/:id` | none | none | `Opportunity` | 404 |
| `GET /api/opportunities/:id/explain` | none | query `viewerAgentId?` | `ExplainTrace` | 404 |
| `POST /api/sim/inbound` | ADMIN | `{ fromUserId, text, clientMessageId? }` | `{ messageId, accepted: boolean }`; the resulting events carry `mode: "simulated"` | 409 if the simulator provider is not active; 404 user |
| `GET /api/sim/thread` | none | query `userId` | `{ messages: { direction: "in" or "out", text, ts, status }[] }` | 404 |
| `POST /webhooks/photon` | Standard Webhooks signature (secondary inbound path) | raw body, headers `webhook-id`, `webhook-timestamp`, `webhook-signature` | `200 { ok: true }` also for duplicates | 401 invalid or stale signature; 400 malformed |

### 9.2 Purchasing routes (owner A2, mounted at `/api/purchasing`)

| Method and path | Auth | Request | Response | Errors |
| --- | --- | --- | --- | --- |
| `GET /offers` | none | none | `MerchantOffer[]` (each with `isSimulated` and `sourceLabel`) | none |
| `GET /registry` | ADMIN unless `viewerAgentId` | query `viewerAgentId?` | `SharedIntentView[]` (public payloads only) | 401 |
| `GET /groups` | none | query `status?` | `GroupPurchase[]` | none |
| `GET /groups/:groupId` | none | query `viewerAgentId?` | `GroupDetail` | 404 |
| `GET /bank/accounts` | none | none | `{ mode, accounts: BankAccountView[] }` with live balances | 503 `integration_unavailable` |
| `POST /bank/seed` | ADMIN | `{ runTag? }` | `BankSeedResult` | 401, 502 `upstream_error` |
| `GET /payments` | none | query `groupId?` | `PaymentAttemptView[]` | none |
| `POST /payments/:attemptId/retry` | ADMIN | none | the new pending `Approval` (the user must approve again; no money moves here) | 404; 409 `invalid_state` if the attempt is not `failed` |

### 9.3 ShortMe routes (owner A3, mounted at `/api/shortme`)

| Method and path | Auth | Request | Response | Errors |
| --- | --- | --- | --- | --- |
| `GET /markets` | none | query `viewerAgentId?`, `status?` | `Market[]`; `proposed` markets are returned only to the subject's own viewer | none |
| `GET /markets/:marketId` | none | query `viewerAgentId?` | `MarketDetail` | 404 (also for a `proposed` market the viewer may not see) |
| `POST /markets/:marketId/positions` | none | `{ userId, side: "back" or "fade", points }` | `Position` | 403 `consent_required`; 404; 409 `invalid_state` or duplicate; 400 limits |
| `POST /markets/:marketId/pass` | none | `{ userId }` | `MarketDetail` | 404, 409 |
| `POST /markets/:marketId/lock` | ADMIN | none | `MarketDetail` | 409 |
| `POST /markets/:marketId/demo-resolve` | ADMIN | `{ outcome: "yes" or "no" }` | `MarketDetail` in `resolution_proposed` (labeled `resolver_kind: "demo_standin"`); the subject confirmation approval is created | 409 `invalid_state` |
| `POST /markets/:marketId/admin-resolve` | ADMIN | `{ outcome: "yes" or "no" or "void" }` | `MarketDetail` (only from `disputed`) | 409 |
| `GET /ledger` | none | query `userId` | `{ balance, entries: LedgerEntry[] }` | 404 |
| `GET /leaderboard` | none | none | `{ firstName, balance, delta }[]` | none |
| `GET /invariants` | ADMIN | none | `{ ok, checks: { id, ok, detail }[] }` for L1 to L6 | 401 |

Subject confirmation and dispute go through `POST /api/approvals/:approvalId/decision` (approve means confirm, decline means dispute).

### 9.4 Eval and demo routes (owner A4; report files written by A3 and A4)

| Method and path | Auth | Request | Response | Errors |
| --- | --- | --- | --- | --- |
| `GET /api/eval/report` | none | query `provider` (`chalk` or `local`) | `EvalReport` read from `data/eval/<provider>-latest.json` | 404 `not_found` when no run exists |
| `POST /api/eval/local/run` | ADMIN | none | `202 { runId }` (runs the local runner in the background) | 409 if a run is active |
| `GET /api/demo/state` | ADMIN | none | `DemoState` | 401 |
| `POST /api/demo/reset` | ADMIN | none | `{ runId }` after the reset sequence in Section 17.3 | 500 with the failing step |
| `POST /api/demo/script/:name` | ADMIN | name is `purchase_alice`, `purchase_bob`, or `shortme_alice` | `{ messageId }` sends the scripted message through the simulator, labeled SIMULATED INBOUND | 404, 409 |
| `POST /api/demo/replay/start` and `POST /api/demo/replay/stop` | ADMIN | `{ file? }` | `{ status: "running" or "stopped" }`; all replayed events carry `mode: "replay"` | 409 |

### 9.5 SSE details

- Content type `text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`.
- The first frames replay history after `sinceSeq`; then live events. The client reconnects with `Last-Event-ID`.
- The server filters per viewer on every event. A viewer never receives an event whose `visibility` or `actor.agentId` it may not see (Section 5.6).
- The web app uses a single `useEventStream({ viewerAgentId? })` hook and de-duplicates by `seq`.

---

## Your work order

**You are Agent 1.** You own the foundation everyone builds on and the Photon 2.0 integration, the highest-priority sponsor. You are on the critical path.

**Read first.** Sections 5, 7, 8, 9, 10.1, 13.1, 14, 17.3 of `docs/SPEC.md`.

**First action (before coding).** Ask the human lead to create the Photon beta project and project API key, enable iMessage, and assign shared lines for both demo phones, or do it yourself if you have access. Record the project ID and agent user ID. This unblocks A1-02.

**First 15 minutes.** Create `packages/contracts` exactly as Section 8 and Section 9 specify (all enums, domain schemas, every event payload schema, A2A payloads, commands, ports, API schemas, eval schemas, config schema), write a contract test that parses a sample payload for every event type, merge, tag `contracts-rc`, and announce S0 in `docs/CONTRACT_REQUESTS.md`. Then continue A1-01. Ship `@dennis/platform/testing` with `createTestPlatform(overrides?)` by T+0:40 (in-memory SQLite, `SimMessagingProvider`, mock LLM, real services as they land, in-memory fakes for approvals, notifier, and the A2A bus until you replace them).

**Execution order and clock.** A1-01 (0:00 to 0:50), A1-02 (to 1:50), A1-06 (to 2:50, because A2 and A3 need the A2A bus and stores), A1-03 (to 3:35), A1-04 (to 4:35), A1-05 (to 5:35), A1-08 (to 6:20), A1-07 (to 7:05), A1-09 (to 7:50). After that support the S3 and S4 integration runs.

**Specific hard requirements.**

- Never log, store in git, or echo the Photon key. Redact handles to their last 4 characters in logs.
- Never process the agent's own outbound messages as inbound. Never reply to unknown handles more than once per hour and never store their text.
- Acknowledge inbound events only after the database insert succeeds. Duplicate provider message IDs are acknowledged and dropped.
- Only one live Photon inbound listener may run at a time (integration worktree).
- `ApprovalService` must make approvals single use, payload-hash bound, user bound, and expiring. Binding checks live in `assertApproved`, not in callers.
- Event visibility rules (Section 5.6) are enforced in `EventBus.history` and `subscribe`, not in routes.
- Treat everything marked [ASSUMED] in Section 10.1 as unknown until A1-02 proves it; record each result in `docs/spikes/photon.md`.

**What others depend on, and when.** Contracts (S0, T+0:15); `createTestPlatform` (T+0:40); `SimMessagingProvider` and `POST /api/sim/inbound` (S1); events, SSE, stores, A2A bus (T+2:50); consent, commands, ingest (T+3:35); approvals and outbox (T+4:35); live Photon (T+5:35).

**Final report.** At S7 post: Photon status (LIVE or which fallback rung), measured round-trip p50, the assumptions table results, any open contract requests.

---

## Appendix F: Known Gaps and Open Items (read before you start)

This specification is complete as a plan but not everything in it has been proven. This appendix lists exactly what is unverified, unwritten, or estimated, who resolves each item, and what to do meanwhile. Treat anything listed here as unknown until your spike or test proves it, record the result in your spike document, and propose any contract change through `docs/CONTRACT_REQUESTS.md` (additive only, window `contracts-v1.1` at S2).

### F.1 Provider facts not yet verified (credentials needed)

| Item | Owner and milestone | Fallback if it fails |
| --- | --- | --- |
| Photon: Socket.IO URL, auth handshake, subscribe step, inbound event name and envelope, acknowledgement and cursor behavior | A1, A1-02 | Webhook inbound through a tunnel, then simulator (Section 10.1 ladder) |
| Photon: where to find `PHOTON_AGENT_USER_ID`; whether the agent's own outbound messages echo back as inbound; whether the first outbound to a handle works before the human has texted the line; rate limits and free-plan line capacity | A1, A1-02 | Filter by `sentBy.id`; users text first; simulator |
| Photon TypeScript client: the exact namespace path of each method (the spec lists operation names from the contract, for example `sendMessage`, `createOrGetUser`, `createOrGetSpace`; the nesting such as `photon.projects.sendMessage` and the line-assignment path is unconfirmed) | A1, A1-02 and A1-05 | Run `grep -n "sendMessage" node_modules/@photon-ai/api/dist/rpc.generated.d.ts` and use what the types show; or call the REST endpoints with `fetch` |
| Nessie: which base URL works (`http://api.nessieisreal.com` or `https://prod-api.nessieisreal.com`) | A2, A2-02 | Whichever answers; set `NESSIE_BASE_URL` |
| Nessie: transfer request and response field names, whether a transfer changes both balances (and when), whether our key may create customers and accounts, whether the memo or description round-trips, minimum starting balances, rate limits | A2, A2-02 | Adopt existing accounts; mark attempts `unverified` instead of `verified`; `SimBankingProvider` with the SIMULATED BANK banner |
| Chalk: how hackathon environment access and tokens are issued; how a deployed task function authenticates to a model; image and dependency setup; run duration and quotas; whether the model gateway supports structured output | A3, A3-02 | Local runner with the LOCAL RUN (NOT CHALK) label |
| Anthropic structured output: whether `messages.parse` with `zodOutputFormat` accepts our schemas (length limits, enums); p95 latency of `claude-sonnet-5-5` versus `claude-haiku-5-5` | A3, A3-02 | Forced tool call path (`tool_choice` of type `tool`) with `schema.safeParse`; switch to Haiku only if eval F1 holds |

### F.2 Contract code that is specified but not yet written

Agent 1 writes these in the first 15 minutes (A1-01) from the tables in this document; no one else should write local copies:

- All event payload Zod schemas in `events.ts` (Section 8.3 gives the fields per type).
- A2A payload schemas in `a2a.ts` (Section 8.4).
- `api.ts` request and response schemas (Section 9).
- `purchasing.ts` and `shortme.ts` domain schemas (one object per table in Sections 7.2 and 7.3).
- `AppConfigSchema` in `config.ts` (the variables in Section 16.1, camelCased).
- The `T`-suffixed type aliases mentioned under Section 8.8 (`type ApprovalT = z.infer<typeof Approval>` and so on).
- The bodies of `parseCommand`, `hashPayload`, `formatUsd` (signatures and behavior are specified).

The contract code blocks in this document were syntax-checked only, never type-checked as a package. Expect small fixes when they first compile; fix them in A1-01 and announce at S0.

### F.3 Artifacts the agents must still author

| Artifact | Author | Notes |
| --- | --- | --- |
| LLM prompt files (`purchase_detector_v1.md`, `milestone_detector_v1.md`, `quip_v1.md`) | A2, A3 | Requirements are in Sections 10.4, A2-03, A3-04. No prompt text exists yet. |
| Evaluation dataset (66 synthetic cases across three JSONL files) | A4 (starter set of 10 by A3 for A3-09) | Counts and content requirements in Section 10.3. |
| Chalk task functions, scorers, metrics, report writer | A3 | API shape verified from Chalk docs; behavior inside the hackathon environment is not. |
| Rules files | A2, A3 | Initial values are specified in Section 12; thresholds may change after the first eval run. |
| Mock data fixtures for the web app | A4 | Written from the contracts after S0. |
| Photon, Nessie, and LLM recorded fixtures | A1, A2, A3 | Produced by the spikes. |

### F.4 Estimates that are not measurements

- Milestone durations, the per-agent clock in Appendix B, and the roughly 11-hour path to the end of hardening are planning estimates. If a milestone overruns by 50 percent, switch to its Fallback line, merge, and report (preamble rule). If less time remains than the plan assumes, cut in this order: A4-11, A1-07, stretch items, extra adversarial tests, then run M4 items alongside S3.
- The 5:00 demo script has never been run against live providers. Rehearsal 1 at S4 is the first real timing; adjust the cut list in Section 4.1 then.
- Accuracy targets in Section 10.3 (F1 at least 0.85, zero false-positive matches, zero privacy leaks) are goals. Report the honest numbers.

### F.5 Environment and dependency risks not yet exercised

- The pinned dependency set was confirmed to exist on the registries but was never installed and built together. Likely friction points: Next 16 with React 19 and Tailwind 4 configuration, `better-sqlite3` 13 native prebuilds on each laptop (Node 22 or newer required), `drizzle-kit push` with partial unique indexes (workaround in A1-01), and whether `@types/better-sqlite3` is needed. Do not upgrade versions to fix a problem without a note in `docs/CONTRACT_REQUESTS.md`.
- The Mermaid diagrams parse but were not rendered visually; if one renders badly, fix the diagram source only.
- Venue Wi-Fi may block WebSockets, which would break Photon Socket.IO inbound. Test on the venue network early (Section 16.4).

### F.6 Interpretation decisions the team should confirm quickly

- Decision D4: "two distinct personal agent identities" is implemented as two logical agents (separate rows, state, intents, approvals, outbound persona labels) on one Photon agent identity and shared line. If the judges or the Photon team expect two real phone numbers, build stretch item S4; the adapter already carries an `accountKey` so no schema change is needed.
- Decision D3: authorized conversation means each user's 1:1 thread with the Dennis line. Group-chat listening is a stretch item.
- Decision D14: the ShortMe demo resolver stands in for an official outcome source and is always labeled as such.
- Workload changes from the provisional split (Section 12.0) are decisions, not requirements; if an agent is blocked or idle, rebalance through a note in `docs/CONTRACT_REQUESTS.md`.

### F.7 Highest-risk items, in order

1. Photon inbound and outbound working end to end on real phones (A1-02, A1-05). Ask Photon staff early.
2. Nessie balance semantics and verification (A2-02, A2-07). Never display `verified` unless the read-back proves it.
3. Chalk environment access (A3-02). Request it in the first five minutes.
4. Agent 1's critical path: A2 and A3 depend on A1-06 by about T+2:50 and on A1-04 by about T+4:35. Use `createTestPlatform` fakes until then.

### F.8 What to do with this list

Do not assume any item above works. Spike first, write the result into your spike document, adapt the adapter (not the contract) wherever possible, and report status at every sync point. If a result invalidates a statement elsewhere in this document, trust the spike result, note the correction in `docs/CONTRACT_REQUESTS.md`, and carry on.
