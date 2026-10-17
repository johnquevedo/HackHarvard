# Synapse coding-agent work order: Agent 2: Purchasing and Nessie

Paste this whole file as the agent's task. The full specification is `docs/SPEC.md` in the repository and is authoritative; this file embeds everything the agent needs to start immediately.

## Shared conventions

You are one of four coding agents building **Synapse** for HackHarvard 2026, concurrently, in one repository. Deadline: Sunday, October 18, 2026, 8:00 AM ET. The other three agents are working at the same time; you cannot talk to them except through the repository and `docs/CONTRACT_REQUESTS.md`.

**Product in one paragraph.** Synapse is a network of personal AI agents that live in people's iMessage threads through Photon 2.0. Each agent notices plans in the thread its owner authorized, shares only a minimal anonymous summary with other agents, and brings its owner opportunities to approve. Pattern: Agent to Agent to User. Feature A finds friends who want the same purchase, compares a simulated group offer, collects two separate approvals, and moves sandbox money through Capital One Nessie. Feature B (ShortMe) proposes a private, invite-only, free-to-play prediction market among friends using fictional points. Sponsor priorities: Photon 2.0, Nessie, Chalk, Digital Trust.

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
| Zod schemas and types (IDs, enums, domain, events, A2A payloads, API, eval) | A1 steward, frozen at `contracts-v1` | `packages/contracts/src/*` | Import from `@synapse/contracts` only. Never redefine a shape locally. Additive changes only, via `docs/CONTRACT_REQUESTS.md`. |
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

**Mission.** Make Feature A real: detect purchase intent, match and price a group offer through agent-to-agent messages, collect two separate approvals, and execute and verify the Nessie sandbox transfers.

**Exclusively owns.** See the A2 globs in Section 12.1.

**Public functions (exact signatures).**

```ts
// @synapse/purchasing
export const purchasingModule: FeatureModule;
export const purchaseDetector: Detector;
export interface MatchingRules { version: number; minSavingsCents: number; minSavingsPercent: number; windowOverlapDays: number; requireSameRegion: boolean; requireProductMatch: "same_or_generic" | "same_only" }
export interface MatchCheck { rule: string; passed: boolean; detail: string }
export interface MatchDecision { compatible: boolean; checks: MatchCheck[] }
export function isCompatible(a: PurchaseIntentPublicT, b: PurchaseIntentPublicT, rules: MatchingRules): MatchDecision;
export interface GroupPrice { memberCount: number; individualCents: number; groupUnitCents: number; savingsPerMemberCents: number }
export function priceGroup(offer: MerchantOfferT, memberCount: number): GroupPrice | null;   // null when no tier applies
export function evaluateProposal(p: { groupUnitCents: number; savingsPerMemberCents: number }, own: PurchaseIntentPrivateT, rules: MatchingRules): { accept: boolean; reasons: string[] };
export function roundBudgetBand(cents: number | null): number | null;                        // up to a multiple of 2500
export function resolveTimeframe(kind: string, now: Date, tz: string): { from: string; to: string };
export function createBankingProvider(cfg: AppConfig, deps: { db: Db; clock: Clock; log: Logger }): BankingProvider;
export function seedBank(ctx: PlatformContext, opts?: { runTag?: string }): Promise<BankSeedResult>;
export function executeApprovedPayment(ctx: PlatformContext, approvalId: string): Promise<PaymentAttemptT>;
```

**Endpoints implemented.** Section 9.2.

**Tables owned.** `merchant_offers`, `group_purchases`, `group_purchase_members`, `bank_links`, `payment_attempts`. Reads core data only through `PlatformContext`.

**Contracts consumed.** `Detector`, `DetectionHandler`, `A2ABus`, `ApprovalService`, `Notifier`, `IntentStore.listShared`, `OpportunityStore`, `BankingProvider`, `StructuredLlm`, events, A2A payloads, templates `join_group` and `authorize_payment` and `payment_result`.

**Rules files you author.** `packages/purchasing/rules/matching-rules.json` (initial values: `minSavingsCents 1000`, `minSavingsPercent 5`, `windowOverlapDays 1`, `requireSameRegion true`, `requireProductMatch "same_or_generic"`; the budget rule: when both budgets are stated, the group unit price must not exceed either budget band), `purchase-gates.json` (`minConfidence 0.7`, `enabledCategories ["monitor"]`, `blockSensitive true`).

**External services.** Nessie (Section 10.2); `StructuredLlm` from A3.

**Mocks.** `MockPurchaseDetector` (regex on "monitor") and `SimBankingProvider` both ship in M0 and A2-06 respectively; they stay available through `NESSIE_MODE=sim` and `LLM_PROVIDER=mock`.

**Ordered tasks.** Execute in this order: A2-01 purchasing stub and slice, A2-02 Nessie spike, A2-06 banking adapters, A2-03 purchase detector, A2-04 matching and probe protocol, A2-05 offers, pricing, group state machine, join approvals, A2-07 payment executor, A2-08 routes and adversarial tests, A2-09 live rehearsal (Appendix B has the clock).

**Tests you own.** Matcher table tests (including every non-match reason); pricing; group state machine (every row of Section 8.6); approval hooks; executor (double approval, replayed approval, wrong hash, insufficient funds, revoked consent mid-flow, crash recovery with `findTransfersByMemo`, Nessie 500 and timeout, unverified balances); fixture-driven Nessie adapter tests; detector tests with `MockStructuredLlm`.

**Definition of done.** Acceptance criteria for A2-01 to A2-09; a real verified Nessie transfer for both members in a live rehearsal; `pnpm verify` green.

**Must not modify.** Anything outside your globs; never import `@synapse/shortme`.

**If you finish early.** Moving-service category on the same matcher (S6); extra adversarial tests in `tests/cross/a2-*.test.ts`; help A4 with the purchasing view data shapes.

## Your milestones in detail

### 13.2 Agent 2 milestones

**A2-01 Purchasing stub and slice** (M0, P0, 40 min). Depends on: A1-01 contracts (S0).
- Tasks: replace the stub with `purchasingModule`; `MockPurchaseDetector` (regex on "monitor", parse "$350"); detection handler: check `purchase_matching` and agent setting, mark shared, emit `intent.registered`; when two shared monitor intents from different agents exist, upsert a `group_purchase` opportunity with headline marked SIMULATED; seed `ofr_demo_monitor`.
- Files: `packages/purchasing/src/**`, `packages/purchasing/rules/*.json`.
- Tests: `pnpm --filter @synapse/purchasing test` (regex cases, two intents yield one opportunity).
- Done when: part of the joint M0 acceptance passes.
- Commit: `feat(purchasing): stub module and mock detector slice`.
- Fallback: none.

**A2-02 Nessie spike** (M1, P0, 60 min). Depends on: nothing.
- Tasks: Section 10.2 spike. Record fixtures. Decide `NESSIE_BASE_URL`, creation versus adoption strategy, balance semantics, memo correlation.
- Files: `scripts/spike-nessie.ts`, `docs/spikes/nessie.md`, `fixtures/nessie/*.json`.
- Tests: `pnpm spike:nessie` prints PASS or documented behavior for each step.
- Done when: a $1.00 transfer is created and read back, and the doc states exactly how balances behave.
- Commit: `docs(nessie): spike results and fixtures`.
- Fallback: `SimBankingProvider` only; announce at S2.

**A2-03 Purchase detector** (M2, P0, 45 min). Depends on: A2-01 (A3-03 for the real LLM; use `MockStructuredLlm` until then).
- Tasks: `prompts/purchase_detector_v1.md` with date, region, categories, privacy rule, 3 positive and 3 negative few-shots; Zod extraction schema; gates from `purchase-gates.json`; private payload; public payload via `roundBudgetBand`, `resolveTimeframe`, product key normalization; rejection reasons; never copy names or employers into public fields.
- Files: `packages/purchasing/src/detector/**`, `packages/purchasing/prompts/**`.
- Tests: 20 table cases with canned LLM outputs (positive, negative, low confidence, sensitive, category disabled, schema invalid); public payload `.strict()` parse; injection text ignored.
- Done when: all cases pass and, once A3-03 lands, 5 live messages classify correctly.
- Commit: `feat(purchasing): llm purchase detector with gates`.
- Fallback: keep the mock regex detector registered if the LLM path is blocked.

**A2-04 Matching and probe protocol** (M2, P0, 60 min). Depends on: A2-03, A1-06.
- Tasks: `isCompatible` with explained checks (product, budget, window, region, matching enabled, not already matched); `findCandidates` via `IntentStore.listShared`; lead selection (the agent whose intent was registered later); A2A handlers for `purchase.probe` and `purchase.probe_result`; emit `purchase.match.evaluated` with the checks.
- Files: `packages/purchasing/src/matching/**`, `packages/purchasing/src/module.ts`.
- Tests: one table row per non-match reason plus the match case; probe and result over a real `A2ABus` with the sim platform; no private field in either payload.
- Done when: the Alice and Bob monitor messages produce `purchase.match.evaluated` with `compatible: true`.
- Commit: `feat(purchasing): matcher and agent probe protocol`.
- Fallback: none.

**A2-05 Offers, pricing, group, join approvals** (M2, P0, 60 min). Depends on: A2-04, A1-04.
- Tasks: `priceGroup`; group state machine rows through `awaiting_payment_approvals`; `purchase.proposal` and `purchase.proposal_result` handlers with `evaluateProposal`; each agent requests `join_group_purchase` for its own user using the `join_group` template; `onDecided` hook for join approvals; first-name reveal only after all approve; cancellation rules.
- Files: `packages/purchasing/src/{offers,groups}/**`, `packages/purchasing/src/copy.ts`.
- Tests: state machine table (legal and illegal transitions); both users receive distinct outbox rows; one decline cancels neutrally; names absent before approval.
- Done when: sim run reaches `awaiting_payment_approvals` after both reply `YES`.
- Commit: `feat(purchasing): group offers, pricing, join approvals`.
- Fallback: none.

**A2-06 Banking adapters** (M2, P0, 60 min). Depends on: A2-02.
- Tasks: `NessieBankingProvider`, `SimBankingProvider`, `createBankingProvider`, `seedBank`, `bank_links` writes, `bank.seeded` event, health.
- Files: `packages/purchasing/src/bank/**`.
- Tests: fixture-driven adapter tests (requests built correctly, key redacted, cents conversion, error mapping, timeout); seed idempotence; sim provider atomic transfer.
- Done when: `pnpm nessie:doctor` seeds or adopts accounts and prints real balances (or the sim banner).
- Commit: `feat(purchasing): nessie and simulated banking providers`.
- Fallback: ship sim only and mark Nessie as blocked in the status badge.

**A2-07 Payment executor** (M2, P0, 60 min). Depends on: A2-05, A2-06, A1-04.
- Tasks: `authorize_payment` approvals after join; `executeApprovedPayment` per Section 10.2 steps 1 to 10; `recover` for `submitting` attempts; `payment_result` notifications; group transitions to `settled` or `failed`.
- Files: `packages/purchasing/src/payments/**`.
- Tests: double approval gives one attempt; replayed approval rejected; wrong hash rejected; insufficient funds; revoked consent mid-flow; Nessie 500; timeout then reconcile by memo; unverified balances produce `unverified`.
- Done when: sim run goes from two `YES` replies to `settled` with verified balances (simulated bank) and the same run passes with the Nessie adapter against fixtures.
- Commit: `feat(purchasing): approved payment executor with verification`.
- Fallback: none.

**A2-08 Routes and adversarial tests** (M3, P0, 45 min). Depends on: A2-07.
- Tasks: Section 9.2 routes; retry route creating a fresh approval; explain data; adversarial tests in `tests/cross/a2-*.test.ts` (injection text, duplicate intents, mid-flow revoke, two groups competing for one intent).
- Files: `packages/purchasing/src/routes.ts`, tests.
- Tests: route tests with a Hono test client; response schemas parse with the contract Zod types.
- Done when: every Section 9.2 route returns schema-valid data.
- Commit: `feat(purchasing): routes and adversarial coverage`.
- Fallback: none.

**A2-09 Live rehearsal** (M4, P0, 45 min). Depends on: A2-07, A1-05.
- Tasks: full live run with real Photon and real Nessie for both members; `pnpm nessie:doctor`; reset rotation creating fresh accounts (or baseline deltas); record a replay fixture of the successful run with A4.
- Files: `scripts/nessie-doctor.ts`, `fixtures/nessie/**`.
- Tests: manual live run checklist in `docs/DEMO_RUNBOOK.md` section "Demo 1".
- Done when: two consecutive live runs end `settled` and `verified` with provider transfer IDs visible.
- Commit: `chore(purchasing): live rehearsal, doctor, reset rotation`.
- Fallback: demo with the simulated bank, clearly labeled.

## Your work order

**You are Agent 2.** You own Feature A end to end and the only financial rail (Nessie). A fabricated or double-executed payment is the worst possible bug in this project.

**Read first.** Sections 3, 4 (steps 1 to 5), 5.3, 7.2, 8.4, 8.6, 8.9, 10.2, 13.2, 14.5, 15.5 of `docs/SPEC.md`, and the contract card.

**Your first hour.** A2-01 (stub and slice; wait for S0 at T+0:15 for real types, until then write the regex detector and test fixtures), then immediately the Nessie spike A2-02. Obtain the Nessie API key first: login with GitHub on the Nessie site.

**Execution order and clock.** A2-01 (0:00 to 0:40), A2-02 (to 1:40), A2-06 (to 2:40), A2-03 (to 3:25), A2-04 (to 4:25), A2-05 (to 5:25), A2-07 (to 6:25), A2-08 (to 7:10), A2-09 (to 7:55).

**Specific hard requirements.**

- A payment attempt row exists only if an approved, unconsumed `authorize_payment` approval with a matching payload hash exists; the approval is consumed in the same transaction that inserts the attempt.
- Check, in this order, before any transfer: consent `sandbox_payments`, both accounts in `bank_links`, amount at most `NESSIE_MAX_TRANSFER_CENTS`, fresh balance covers the amount, group status allows settlement.
- Never retry a transfer POST blindly. Reconcile with `findTransfersByMemo` using the idempotency key placed in the memo.
- Mark `verified` only under invariant P4. Otherwise `unverified` with a note. The UI renders only values returned by the active `BankingProvider`.
- Public intent payloads contain only the fields of `PurchaseIntentPublic` (strict). Never copy names, handles, or raw text into them or into A2A payloads. Reveal first names only after all members approve joining.
- Simulated offers are always labeled SIMULATED OFFER. Do not claim a real merchant price anywhere.
- Never import `@synapse/shortme`. Never use a bank adapter for anything but the group pool.
- Treat everything marked [ASSUMED] in Section 10.2 as unknown until A2-02 proves it; write results to `docs/spikes/nessie.md` and adapt the adapter, not the contract.

**What others depend on, and when.** Mock detector and slice (S1); `SimBankingProvider` and Nessie adapter (T+2:40); `MatchingRules` and public intent shape for A3's Chalk task (T+3:25); group and payment data for A4's views (fixtures from A4-02, real by T+6:25).

**Final report.** At S7 post: Nessie status (live, adopted accounts, or simulated), the balance semantics found, two live verified runs with provider transfer IDs, open issues.

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
- Decision D3: authorized conversation means each user's 1:1 thread with the Synapse line. Group-chat listening is a stretch item.
- Decision D14: the ShortMe demo resolver stands in for an official outcome source and is always labeled as such.
- Workload changes from the provisional split (Section 12.0) are decisions, not requirements; if an agent is blocked or idle, rebalance through a note in `docs/CONTRACT_REQUESTS.md`.

### F.7 Highest-risk items, in order

1. Photon inbound and outbound working end to end on real phones (A1-02, A1-05). Ask Photon staff early.
2. Nessie balance semantics and verification (A2-02, A2-07). Never display `verified` unless the read-back proves it.
3. Chalk environment access (A3-02). Request it in the first five minutes.
4. Agent 1's critical path: A2 and A3 depend on A1-06 by about T+2:50 and on A1-04 by about T+4:35. Use `createTestPlatform` fakes until then.

### F.8 What to do with this list

Do not assume any item above works. Spike first, write the result into your spike document, adapt the adapter (not the contract) wherever possible, and report status at every sync point. If a result invalidates a statement elsewhere in this document, trust the spike result, note the correction in `docs/CONTRACT_REQUESTS.md`, and carry on.
