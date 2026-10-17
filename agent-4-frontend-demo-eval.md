# Synapse coding-agent work order: Agent 4: Frontend, Demo, and Evaluation Experience

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

**Mission.** Make everything visible and demoable: monorepo tooling and guardrails, the dashboard, the phone simulator, demo controls and reset, the evaluation dataset and local runner with the eval tab, and the end-to-end harness that proves the whole product on every merge.

**Exclusively owns.** See the A4 globs in Section 12.1.

**Public functions (exact signatures).**

```ts
// packages/eval-data
export function loadCases(suite?: EvalSuiteT): EvalCaseT[];
export function runLocalEval(ctx: PlatformContext, opts?: { suites?: EvalSuiteT[] }): Promise<EvalReportT>;
export function computeMetrics(rows: { caseId: string; suite: EvalSuiteT; label: EvalLabelT; expected: string; actual: string; leaked: boolean }[]): EvalSuiteResultT[];
export function writeReport(report: EvalReportT): Promise<string>;      // data/eval/<provider>-latest.json
// apps/web
export function useEventStream(opts: { viewerAgentId?: string }): { events: DomainEventT[]; connected: boolean };
export function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T>;   // honors NEXT_PUBLIC_API_MODE=mock
// scripts
//   pnpm demo:reset   pnpm demo:check   pnpm demo:replay   pnpm e2e:sim   pnpm verify
```

**Endpoints implemented.** Section 9.4. Consumes every other route over HTTP and SSE only.

**Tables owned.** None. The demo reset script calls `resetCore`, `purchasingModule.reset`, `shortmeModule.reset`, `purchasingModule.seed`, `shortmeModule.seed` through the composed platform context, never SQL.

**Dashboard requirements.**

- Top bar: integration badges from `/api/integrations` (LIVE green, SIMULATED amber, REPLAY blue, with detail on hover), demo run ID, privacy lens selector (Judge, Alice, Bob).
- Main view: three lanes (Alice private, Agent network shared, Bob private) fed by one SSE stream; each event is a compact card with type icon, summary, and a mode badge when not live; clicking opens the raw payload.
- Explain panel for the selected opportunity (rule checks with pass and fail).
- Purchasing view: opportunity card, savings, SIMULATED OFFER label, member approvals, payment timeline, bank panel with provider transfer IDs and balances before and after with a VERIFIED or UNVERIFIED chip.
- ShortMe view: market card, pools, positions (with the "shorted herself" tag), resolution state, ledger with the zero-sum invariant indicator, leaderboard, Demo Resolver button labeled STAND-IN FOR OFFICIAL SOURCE.
- Trust page: Consent Center per user and scope, pause, forget, revoke intent.
- Eval tab: report table, representative cases, CHALK EVAL or LOCAL RUN badge, run ID.
- Sim page: phone simulator for each user (send as, thread view); approval fallback buttons labeled DASHBOARD FALLBACK.
- Design direction: dark, high-contrast, large type for projector use; lanes use fixed colors; animate only new-event entry; a text-only legible fallback when the SSE stream is disconnected; no layout shift.

**Mocks.** `NEXT_PUBLIC_API_MODE=mock` serves `apps/web/src/mocks/*.json` (written from the contracts in A4-02) so the UI never waits for a backend.

**Ordered tasks.** A4-01 root tooling and slice page; A4-02 status bar, API client, SSE hook; A4-03 lanes and explain; A4-04 purchasing UI; A4-05 ShortMe UI; A4-06 simulator and consent center; A4-07 demo controls, reset, replay; A4-08 dataset, local runner, eval tab; A4-09 end-to-end harness; A4-10 runbook and rehearsal tooling; A4-11 polish pass.

**Tests you own.** Dataset schema validation (every case parses as `EvalCase`, counts per label and suite match Section 10.3); metrics unit tests; ownership checker tests; end-to-end scenarios on simulated providers (Section 15.4); optional Playwright smoke (P2).

**Definition of done.** Acceptance criteria for A4-01 to A4-11; `pnpm e2e:sim` runs both demo stories green; `pnpm demo:reset` and `pnpm demo:check` work from a cold start in under 60 seconds.

**Must not modify.** Anything outside your globs; do not call SQL; do not import domain packages from the web app.

**If you finish early.** Replay mode polish (S1); Playwright smoke (S8); help other agents with typecheck and test failures by opening issues in `docs/CONTRACT_REQUESTS.md`, never by editing their files.

## Your milestones in detail

### 13.4 Agent 4 milestones

**A4-01 Root tooling and slice page** (M0, P0, 50 min). Depends on: nothing (consumes contracts from S0).
- Tasks: pnpm workspace, `tsconfig.base.json`, `.npmrc` with `save-exact=true`, `.nvmrc`, `.prettierrc.json`, `.gitignore`, `.env.example` from Section 16.1, root scripts from Section 6.3, `ownership.json`, `check-ownership.ts`, `verify.sh`, CI workflow, README quickstart; `apps/web` skeleton with the admin-header proxy route and the ugly slice page (SSE event list, opportunity list, buttons for `/api/demo/script/*`); `packages/eval-data/src/routes.ts` with `POST /api/demo/script/:name` using the platform simulator.
- Files: root configs, `.github/**`, `scripts/{check-ownership,verify}*`, `apps/web/**`, `packages/eval-data/**`.
- Tests: `pnpm verify` runs (even if mostly empty); ownership checker unit tests (inside and outside globs).
- Done when: `pnpm install && pnpm dev` starts both apps; joint M0 acceptance passes.
- Commit: `chore(repo): workspace tooling, ci, ownership check, slice page`.
- Fallback: none.

**A4-02 Status bar, API client, SSE hook** (M1, P0, 45 min). Depends on: A4-01.
- Tasks: typed `api()` with mock mode and fixtures in `src/mocks/` (written from contracts); `useEventStream`; integration badge bar; lens selector; layout and design tokens; `pnpm demo:check` v0 (calls `/api/health`, `/api/integrations`).
- Files: `apps/web/src/{lib,components,mocks}/**`, `scripts/check-env.ts`.
- Tests: hook de-duplicates by `seq` and resumes with `Last-Event-ID` (unit test with a fake EventSource).
- Done when: with `NEXT_PUBLIC_API_MODE=mock` the dashboard renders badges and a scripted event stream.
- Commit: `feat(web): api client, sse hook, status bar, mock mode`.
- Fallback: none.

**A4-03 Lanes and explain** (M2, P0, 60 min). Depends on: A4-02.
- Tasks: three-lane view, event cards with mode badges, raw payload drawer, explain panel using `/api/opportunities/:id/explain`, privacy lens behavior.
- Files: `apps/web/src/app/(dashboard)/**`, `apps/web/src/components/lanes/**`.
- Tests: component tests with fixtures: private events render only in the matching lane under each lens.
- Done when: the mock story renders correctly in all three lens modes.
- Commit: `feat(web): three-lane activity view and explain panel`.
- Fallback: none.

**A4-04 Purchasing UI** (M2, P0, 60 min). Depends on: A4-03.
- Tasks: opportunity card, SIMULATED OFFER label, savings, member approval chips, payment timeline, bank panel with provider IDs, before and after balances, VERIFIED or UNVERIFIED chip, amber SIMULATED BANK banner.
- Files: `apps/web/src/app/purchasing/**`, components.
- Tests: fixture renders for verified, unverified, failed, simulated states.
- Done when: all states match the demo script expectations in Section 4.
- Commit: `feat(web): purchasing view and bank panel`.
- Fallback: none.

**A4-05 ShortMe UI** (M2, P0, 60 min). Depends on: A4-03.
- Tasks: market card, pools, positions with self-short tag, resolution panel, Demo Resolver button with the stand-in label, ledger table with invariant chip, leaderboard.
- Files: `apps/web/src/app/shortme/**`.
- Tests: fixture renders for each market status.
- Done when: all statuses of Section 8.7 render sensibly.
- Commit: `feat(web): shortme market view and ledger`.
- Fallback: none.

**A4-06 Simulator and consent center** (M2, P0, 45 min). Depends on: A4-02.
- Tasks: phone simulator per user (send as, thread view with direction and provider status), approval fallback buttons labeled DASHBOARD FALLBACK, Consent Center toggles, pause, forget, revoke intent.
- Files: `apps/web/src/app/{sim,trust}/**`.
- Tests: fixture-driven interaction tests (toggle calls the right route).
- Done when: every control calls its Section 9 route with the correct body.
- Commit: `feat(web): phone simulator, consent center, trust controls`.
- Fallback: none.

**A4-07 Demo controls, reset, replay** (M3, P0, 60 min). Depends on: A4-06, A1-04.
- Tasks: `scripts/reset-demo.ts` and `POST /api/demo/reset` (sequence in Section 17.3); `scripts/seed-demo.ts`; `pnpm demo:check` full; replay recorder and player (`fixtures/replay/*.jsonl`, events replayed with `mode: "replay"`); control panel buttons.
- Files: `scripts/{reset-demo,seed-demo,check-env,replay-demo}.ts`, `packages/eval-data/src/routes.ts`, `apps/web/src/app/demo/**`.
- Tests: reset twice in a row leaves identical state; replay emits only `replay` mode events.
- Done when: `pnpm demo:reset` under 60 seconds and `pnpm demo:check` all green on a fresh clone.
- Commit: `feat(demo): reset, check, replay, control panel`.
- Fallback: none.

**A4-08 Dataset, local runner, eval tab** (M3, P0, 60 min). Depends on: A4-01, A2-03 and A3-04 (for the local runner; use mocks until then).
- Tasks: the three JSONL case files with counts from Section 10.3, `loadCases`, `computeMetrics`, `runLocalEval` (real detectors and matcher through the platform context), `writeReport`, `POST /api/eval/local/run`, `GET /api/eval/report`, eval tab with badges.
- Files: `packages/eval-data/**`, `apps/web/src/app/eval/**`.
- Tests: every case parses as `EvalCase`; counts per suite and label; metrics on hand-made rows; report parses as `EvalReport`.
- Done when: `pnpm eval:local` writes a report and the eval tab shows it with the LOCAL badge; A3 can consume the JSONL.
- Commit: `feat(eval): synthetic dataset, local runner, eval tab`.
- Fallback: none.

**A4-09 End-to-end harness** (M3, P0, 60 min). Depends on: A1-06, A2-05, A3-07 (extend as A2-07 and A3-08 land).
- Tasks: `pnpm e2e:sim` boots the server in simulated mode with `LLM_PROVIDER=mock`, runs both demo stories through `/api/sim/inbound` and approval replies, asserts events, outbox texts, group and market end states, ledger invariants, and the shared-event privacy scanner; a second mode with the real LLM.
- Files: `tests/e2e/**`.
- Tests: the harness itself; run on every merge to `main` in CI (mock mode).
- Done when: both stories pass headless in under 90 seconds.
- Commit: `test(e2e): scripted demo stories on simulated providers`.
- Fallback: none.

**A4-10 Runbook and rehearsal tooling** (M4, P0, 45 min). Depends on: A4-07, A4-09.
- Tasks: `docs/DEMO_RUNBOOK.md` (preflight, script, cues, fallbacks), `docs/INTEGRATIONS.md` (real versus simulated table generated from `/api/integrations`), rehearsal timer page, backup video capture instructions.
- Files: `docs/**`, `apps/web/src/app/demo/**`.
- Tests: a human rehearsal run recorded in the runbook with timings.
- Done when: a teammate who has not seen the spec can run the demo from the runbook.
- Commit: `docs(demo): runbook, integrations table, rehearsal tooling`.
- Fallback: none.

**A4-11 Polish pass** (M4, P1, 45 min). Depends on: A4-10.
- Tasks: projector legibility, empty and error states, disconnected-stream fallback, responsive layout, performance check with 500 events.
- Files: `apps/web/**`.
- Tests: manual checklist in the runbook.
- Done when: no layout shift on event arrival; stream disconnect shows a clear banner.
- Commit: `style(web): polish, states, performance`.
- Fallback: cut first if time is short.

## Your work order

**You are Agent 4.** You own tooling, guardrails, everything judges see, the demo lifecycle, the evaluation dataset and local runner, and the end-to-end harness. Your UI must never overstate what is real.

**Read first.** Sections 3, 4, 5.6, 6, 9, 11, 12.1, 12.5, 13.4, 14, 15.4, 16, 17, and Appendix E of `docs/SPEC.md`, and the contract card.

**First action.** Merge root workspace config only (about 10 minutes) so everyone can install: pnpm workspace, `tsconfig.base.json`, `.npmrc` with `save-exact=true`, `.nvmrc`, root scripts. Then `ownership.json` and `scripts/check-ownership.ts`, then the rest of A4-01.

**Execution order and clock.** A4-01 (0:00 to 0:50), A4-02 (to 1:35), A4-03 (to 2:35), A4-04 (to 3:35), A4-05 (to 4:35), A4-06 (to 5:20), A4-07 (to 6:20), A4-08 (to 7:20), A4-09 (to 8:20), A4-10 (to 9:05), A4-11 (to 9:50). Build the e2e harness skeleton earlier and extend it as backends land.

**Specific hard requirements.**

- The web app imports only `@synapse/contracts` types and talks to the server by HTTP and SSE. No SQL, no domain package imports. `NEXT_PUBLIC_API_MODE=mock` must render the whole product from fixtures so you never wait for a backend.
- Every integration badge and every event shows its true mode: LIVE, SIMULATED, REPLAY, FALLBACK. DASHBOARD FALLBACK appears on any approval taken through the dashboard. The bank panel shows only provider-returned values with a VERIFIED or UNVERIFIED chip.
- The privacy lens must filter at the API (`viewerAgentId`), and the UI must prove it: switching to Bob hides Alice's private events.
- The admin token stays server side in the Next proxy route handler.
- Dataset: every case `synthetic: true`, counts per Section 10.3, about 20 percent with ids starting `holdout_`. No real people, numbers, or employers.
- `pnpm demo:reset` finishes in under 60 seconds and is idempotent. `pnpm e2e:sim` runs both stories headless in under 90 seconds with `LLM_PROVIDER=mock`.
- Design for a projector: dark theme, high contrast, large type, no layout shift on new events, a clear banner when the SSE stream disconnects.

**What others depend on, and when.** Root config (T+0:10); `check-ownership` and CI (T+0:50); dataset (T+7:20, A3-10 and the local runner need it); e2e harness (S3); runbook (T+9:05).

**Final report.** At S7 post: e2e result, two timed rehearsals, the real versus simulated table from `/api/integrations`, and the backup plan status.

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
