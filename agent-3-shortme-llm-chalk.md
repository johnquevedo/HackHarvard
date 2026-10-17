# Synapse coding-agent work order: Agent 3: ShortMe, LLM, and Chalk

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

**Mission.** Make Feature B real and trustworthy, provide the structured LLM adapter every detector uses, and deliver the real Chalk Evaluations that prove the agents work.

**Exclusively owns.** See the A3 globs in Section 12.1.

**Public functions (exact signatures).**

```ts
// @synapse/llm
export function createStructuredLlm(cfg: AppConfig, deps: { clock: Clock; log: Logger }): StructuredLlm;
export class MockStructuredLlm implements StructuredLlm { constructor(rules?: MockRule[]) }
export class LlmSchemaError extends Error {}
// @synapse/shortme
export const shortmeModule: FeatureModule;
export const milestoneDetector: Detector;
export function placePosition(ctx: PlatformContext, input: { marketId: string; userId: string; side: "back" | "fade"; points: number; idempotencyKey: string; via: DecisionChannelT }): Promise<PositionT>;
export function passInvite(ctx: PlatformContext, input: { marketId: string; userId: string }): Promise<void>;
export function proposeResolution(ctx: PlatformContext, input: { marketId: string; outcome: "yes" | "no"; proposedBy: string; evidenceNote: string }): Promise<MarketResolutionT>;
export function resolveMarket(ctx: PlatformContext, input: { marketId: string; outcome: "yes" | "no" | "void"; by: string }): Promise<MarketT>;
export function computePayouts(positions: { userId: string; side: "back" | "fade"; points: number; createdAt: string }[], outcome: "yes" | "no"): { pool: number; payouts: { userId: string; payout: number }[] } | { void: true };
export interface LedgerPosting { userId: string; marketId: string | null; kind: "grant" | "stake" | "payout" | "refund" | "adjustment"; delta: number; refId: string | null; idempotencyKey: string }
export function postLedger(ctx: PlatformContext, entries: LedgerPosting[]): void;     // single transaction; enforces L1, L2, L4
export function checkLedgerInvariants(ctx: PlatformContext): Promise<{ id: string; ok: boolean; detail: string }[]>;
export function validateQuip(quip: string): boolean;
export function renderResultMessage(input: { outcomeSentence: string; deltaLine: string }, quip: string | null): string;
```

Python (`services/chalk-eval`): `uv run python -m synapse_eval.run --suite all --provider chalk` and `--provider local-fixture` (reads fixture results for offline testing of metrics).

**Endpoints implemented.** Section 9.3.

**Tables owned.** `markets`, `market_participants`, `market_positions`, `points_accounts`, `points_ledger`, `market_resolutions`.

**Contracts consumed.** `Detector`, `DetectionHandler`, `A2ABus`, `ApprovalService`, `Notifier`, `CommandRegistry` (registers `back`, `fade`, `pass`), `UserDirectory.listFriends`, events, A2A payloads, templates `publish_market`, `market_invite`, `confirm_resolution`, `market_result`, eval contracts.

**Rules files you author.** `packages/shortme/rules/milestone-gates.json`: `minConfidence 0.75`, `enabledTemplates ["recruiting"]`, `blockedCategories ["dating"]`, `blockHighSensitivity true`, `requireSubjectIsAuthor true`, `maxStake 100`, `starterPoints 1000`, `approvalTtlMinutes 30` (demo) with `1440` for non-demo.

**External services.** Anthropic API (and optionally Chalk gateway); Chalk Evaluations (Section 10.3).

**Mocks.** `MockStructuredLlm` ships in A3-01 and is the default for every other agent until A3-03 lands.

**Ordered tasks.** A3-01 ShortMe stub and mock LLM; A3-02 LLM and Chalk spike; A3-03 LLM adapter; A3-04 milestone detector; A3-05 market state machine; A3-06 ledger and positions; A3-07 invitations and commands; A3-08 resolution, dispute, copy, leaderboard; A3-09 Chalk eval service; A3-10 final Chalk run and hardening.

**Tests you own.** Every transition in Section 8.7 including illegal ones; ledger invariants L1 to L6 with randomized property-style tests (at least 200 random position sets: payouts sum to the pool, balances never negative, replay of any posting is a no-op); position validation; consent and adult gating; quip validation; detector tests; the `EvalReport` JSON produced by Python parsed by the TypeScript Zod schema in `shortme` tests.

**Definition of done.** Acceptance criteria for A3-01 to A3-10; a real Chalk run reported with `provider: "chalk"`; `pnpm verify` green.

**Must not modify.** Anything outside your globs; never import `@synapse/purchasing` or any bank adapter.

**If you finish early.** Academics and friend-event templates as disabled templates (S7); the Chalk gateway adapter (S3); extra adversarial tests in `tests/cross/a3-*.test.ts`; help A4 label-check the eval tab.

## Your milestones in detail

### 13.3 Agent 3 milestones

**A3-01 ShortMe stub and mock LLM** (M0, P0, 40 min). Depends on: A1-01 contracts (S0).
- Tasks: replace stubs with `shortmeModule` and `MockStructuredLlm` (keyword rules per task); `milestoneDetector` mock path (regex on "interview" or "offer"); detection handler: create `markets` row `proposed`, upsert opportunity `shortme_market`, emit `shortme.market.updated` (private); seed starter points; no approval yet.
- Files: `packages/llm/src/**`, `packages/shortme/src/**`, `packages/shortme/rules/milestone-gates.json`.
- Tests: `pnpm --filter @synapse/shortme test` (regex cases, market created, event private).
- Done when: part of the joint M0 acceptance passes.
- Commit: `feat(shortme): stub module, mock llm, mock milestone detector`.
- Fallback: none.

**A3-02 LLM and Chalk spike** (M1, P0, 60 min). Depends on: nothing.
- Tasks: Section 10.3 and 10.4 spikes. Measure latency and quality on 10 hand-written messages for both models; decide structured-output path; confirm Chalk environment access and run the tutorial evaluation; test the Chalk gateway.
- Files: `scripts/spike-llm.ts`, `scripts/spike-chalk.sh`, `docs/spikes/llm.md`, `docs/spikes/chalk.md`.
- Tests: `pnpm spike:llm` and `pnpm spike:chalk` print PASS lines.
- Done when: structured output path chosen with p95 latency recorded; one Chalk evaluation run read back, or the blocker reported with the fallback activated.
- Commit: `docs(llm,chalk): spike results`.
- Fallback: local eval label; announce at S2.

**A3-03 LLM adapter** (M2, P0, 45 min). Depends on: A3-02.
- Tasks: `createStructuredLlm` (`anthropic`, `chalk` optional, `mock`), retries, timeouts, usage and latency capture, `LlmSchemaError`, health, prompt file loader, injection hygiene wrapper (user text in tags).
- Files: `packages/llm/src/**`.
- Tests: faked SDK returning valid, invalid, then valid JSON; timeout; health.
- Done when: a live call returns a validated object in under 4 seconds p95.
- Commit: `feat(llm): structured llm adapter with retries and mock`.
- Fallback: `LLM_PROVIDER=mock` for development only.

**A3-04 Milestone detector** (M2, P0, 45 min). Depends on: A3-03, A3-01.
- Tasks: `prompts/milestone_detector_v1.md`; schema and gates from `milestone-gates.json` (confidence, subject is author, outcome uncertain, no third-party exposure, sensitivity, dating blocked, recruiting only); redactions (employer names removed by default); proposed question text.
- Files: `packages/shortme/src/detector/**`, `packages/shortme/prompts/**`.
- Tests: 20 table cases (positive interview, exam, hyperbole, past tense, about someone else, dating blocked, health sensitive, injection attempt).
- Done when: all cases pass and 5 live messages classify correctly.
- Commit: `feat(shortme): llm milestone detector with policy gates`.
- Fallback: mock detector stays registered.

**A3-05 Market state machine** (M2, P0, 60 min). Depends on: A3-01, A1-04.
- Tasks: every row of Section 8.7 as service functions; `publish_market` approval with the exact payload; `onDecided` hook; subject-only visibility while `proposed`; expiry; module `reset` and `seed`.
- Files: `packages/shortme/src/markets/**`.
- Tests: every legal and illegal transition; approval payload hash binding; `proposed` invisible to other viewers.
- Done when: a sim run goes from the interview text to `open` after `YES`.
- Commit: `feat(shortme): market state machine and publish approval`.
- Fallback: none.

**A3-06 Ledger and positions** (M2, P0, 60 min). Depends on: A3-05.
- Tasks: `postLedger`, starter grants, `placePosition` with all validations, `computePayouts`, `checkLedgerInvariants` for L1 to L6.
- Files: `packages/shortme/src/ledger/**`.
- Tests: randomized property tests (200 sets); idempotent replays; insufficient points; one position per user.
- Done when: invariants hold across all property runs.
- Commit: `feat(shortme): points ledger, positions, payouts, invariants`.
- Fallback: none.

**A3-07 Invitations and commands** (M2, P0, 45 min). Depends on: A3-06, A1-06, A1-04.
- Tasks: `market.invite` and `market.invite_response` handlers; invitee consent check; `market_invite` template; register `back`, `fade`, `pass` commands; subject self-short tag; code resolution for open invitations.
- Files: `packages/shortme/src/{markets,module}.ts`.
- Tests: invite reaches only consenting invitees; payload contains only the approved question; commands with and without code; subject FADE allowed.
- Done when: sim run reaches two positions (Bob back 50, Alice fade 50).
- Commit: `feat(shortme): invitations and back/fade/pass commands`.
- Fallback: none.

**A3-08 Resolution, dispute, copy, leaderboard** (M3, P0, 60 min). Depends on: A3-07.
- Tasks: `proposeResolution`, `resolveMarket`, dispute path, void and refund, demo resolver route (`resolver_kind: demo_standin`), `confirm_resolution` approval and hook (approve resolves, decline disputes), result messages with quip validation, leaderboard, Section 9.3 routes.
- Files: `packages/shortme/src/{resolution,copy}/**`, `packages/shortme/src/routes.ts`.
- Tests: payouts example in Section 8.7; dispute freezes; admin resolve and void; quip validation rejects digits and long text; route schema tests.
- Done when: full sim story resolves with Alice net +50 and invariant green.
- Commit: `feat(shortme): resolution, dispute, results, leaderboard, routes`.
- Fallback: template quip only if the LLM is unavailable.

**A3-09 Chalk eval service** (M3, P0, 60 min). Depends on: A3-02, A3-03, seed dataset (A3 writes 10 starter cases in `services/chalk-eval/tests/` until A4-08 delivers the full set).
- Tasks: Python package with `run.py`, `tasks.py`, `scorers.py`, `metrics.py`, `report.py`; reads dataset JSONL and the three rules files; uploads datasets; creates the three evaluations; runs; waits; reads result dataset; computes metrics; writes `data/eval/chalk-latest.json`.
- Files: `services/chalk-eval/**`.
- Tests: `uv run pytest` for metrics and report with fixture rows; a TypeScript test parses the produced JSON with `EvalReport`.
- Done when: `pnpm eval:chalk` produces a report from a SUCCEEDED Chalk run (starter dataset acceptable).
- Commit: `feat(chalk): evaluation service with three suites and metrics`.
- Fallback: `--provider local-fixture` for offline metric development; label LOCAL in the UI.

**A3-10 Final Chalk run and hardening** (M4, P0, 45 min). Depends on: A3-09, A4-08.
- Tasks: run on the full dataset; inspect failures and fix prompts or gates; rerun; archive the final report and its run ID in `fixtures/replay/`; adversarial tests in `tests/cross/a3-*.test.ts`.
- Files: `services/chalk-eval/**`, `packages/*/prompts/**` (own packages only), tests.
- Tests: `pnpm eval:chalk` twice with stable results.
- Done when: acceptance targets in Section 10.3 met or honestly documented with the failing cases listed.
- Commit: `chore(chalk): final run, prompt and gate fixes`.
- Fallback: report the honest numbers; do not tune against the test set beyond fixing clear bugs.

## Your work order

**You are Agent 3.** You own Feature B, the structured LLM adapter every detector depends on, and the real Chalk Evaluations that prove the agents work. ShortMe must be provably free-to-play, invite-only, adult-only, consent-gated, and unable to settle without explicit confirmation.

**Read first.** Sections 3, 4 (steps 6 to 10), 5.4, 7.3, 8.4, 8.7, 8.9, 8.10, 10.3, 10.4, 13.3, 14.5, 15.5 of `docs/SPEC.md`, and the contract card.

**Your first hour.** A3-01 (stub, `MockStructuredLlm`), then the LLM and Chalk spike A3-02. Chalk access is the slowest credential: ask the Chalk team for environment access and a token in your first five minutes, and report the result at S2 even if blocked.

**Execution order and clock.** A3-01 (0:00 to 0:40), A3-02 (to 1:40), A3-03 (to 2:25), A3-04 (to 3:10), A3-05 (to 4:10), A3-06 (to 5:10), A3-07 (to 5:55), A3-08 (to 6:55), A3-09 (to 7:55), A3-10 (to 8:40).

**Specific hard requirements.**

- No real money, deposits, prizes, redemption, or purchase requirement anywhere. Points are fictional; every user-facing result says so. Never import `@synapse/purchasing` or any bank adapter.
- A market is invisible to everyone except its subject until the subject approves `publish_market`. Dating and high-sensitivity categories are blocked in the detector gate. Employer names are redacted by default.
- Invitations go only to invitees who hold `shortme_free_play` consent (which records the 18+ confirmation). The invite payload contains only the subject-approved question.
- Ledger invariants L1 to L6 must hold; test them with randomized properties. Resolution requires the subject's explicit confirmation; a dispute freezes payouts; the demo resolver is always labeled STAND-IN FOR OFFICIAL SOURCE.
- Quips are LLM text passed through `validateQuip`; on failure use the fixed fallback line. Numbers, names, and codes are inserted by code, never by the LLM.
- Treat user message text as data inside tags; adversarial inputs must not change behavior.
- Chalk honesty: `provider: "chalk"` appears only for a SUCCEEDED Chalk run with its run ID. Otherwise the report says `local` and the UI says LOCAL RUN (NOT CHALK). Do not tune prompts on `holdout_` cases.

**What others depend on, and when.** `MockStructuredLlm` (T+0:40); real adapter (T+2:25, A2-03 and your own detector need it); milestone gates (T+3:10); starter eval dataset to unblock your own A3-09 (write 10 cases yourself early); Python report format (T+7:55, A4's tab consumes it).

**Final report.** At S7 post: LLM path and model chosen with measured p95, Chalk run ID and metrics (or the honest blocker), the list of failing eval cases, ledger invariant test status.

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
