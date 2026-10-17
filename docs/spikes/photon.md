# Photon Beta spike status

Status: NOT LIVE VERIFIED. Active fallback: ladder rung 5, SIMULATED messaging.
No project credentials or assigned demo lines were available in this session.
No real inbound fixture, delivered message, round-trip p50, echo behavior, or line capacity is claimed.

## Evidence collected

The pinned @photon-ai/api 0.5.0 package was installed and its generated TypeScript declarations inspected. Operations compile as photon.projects.createOrGetUser, photon.projects.createOrGetSpace, photon.projects.sendMessage, photon.projects.getMessage, and photon.projects.platforms.getImessage. This version requires headers with the literal key "idempotency-key", correcting the specification's camelCase example.

The current [Beta Node example](https://photon.codes/docs/beta/websocket/example) and [event delivery documentation](https://photon.codes/docs/beta/websocket/events) specify Socket.IO at the API origin with path /v1/projects/{id}/events/ws, bearer authentication in extraHeaders, a subscribe command with startSeq, and delivery(event, { seq, replyExpected }). There is no processing acknowledgement callback. Dennis persists a cursor after its handler completes and retains it on failure. A project-level local lock prevents concurrent integration listeners on this machine.

## Assumptions table

| Item                              | Documentation or local evidence                                 | Live result                   |
| --------------------------------- | --------------------------------------------------------------- | ----------------------------- |
| Socket URL, auth, subscribe       | Beta documentation, fake-socket tests                           | Not run                       |
| Event name and metadata           | delivery and separate seq metadata documented                   | Not run                       |
| Cursor resume                     | Durable checkpoint and failure tests                            | Not run                       |
| Inbound resource                  | SDK received iMessage resource; strict normalizer tests         | Not run                       |
| Public envelope around resource   | Direct resource, data, and data.message accepted conservatively | Unconfirmed; capture required |
| Agent user ID                     | Explicit setting or unique-agent SDK discovery                  | Not available                 |
| Own-message echo                  | Normalizer rejects the configured sender identity               | Provider behavior unconfirmed |
| First outbound before human text  | Doctor replies only to new inbound                              | Not tested                    |
| Rate limits and shared-line seats | No live project queried                                         | Not tested                    |
| Webhook signatures                | Valid, stale, and tampered synthetic signature tests            | Tunnel not tested             |
| Outbound status                   | Mock HTTP tests preserve dispatched; never assume delivered     | Not run                       |
| Round-trip p50 under 3 seconds    | No measurements                                                 | Not available                 |

## A1-02 runner

The spike runner now performs the versioned catalog query, selects a selectable API version, discovers an agent ID only when exactly one iMessage agent is present, captures the actual public envelope with user text, handles, secrets and unknown string values redacted, fetches the matching incoming event schema, and confirms outbound delivered status. It keeps the provider idempotency key tied to the inbound message ID. A full run requires evidence from both demo senders.

These capabilities are tested with synthetic transports. They are not live spike results. An unsupported envelope is saved in redacted form and stops the probe before sending; its path must then be confirmed and the normalizer corrected.

Commands, once a local environment file exists:

```sh
node --env-file=.env.local --import tsx scripts/spike-photon.ts --catalog-only
node --env-file=.env.local --import tsx scripts/spike-photon.ts --samples 3
```

Catalog-only mode needs PHOTON_PROJECT_ID and PHOTON_API_KEY and makes read-only API calls. Live mode additionally needs DEMO_ALICE_HANDLE and DEMO_BOB_HANDLE. Set PHOTON_AGENT_USER_ID explicitly if discovery finds zero or multiple candidates. Keep every secret out of git and chat. Agent 4's root tooling now exposes pnpm spike:photon and pnpm photon:doctor. The direct commands also load a local environment file explicitly.

The runner writes event-catalog.json, inbound-text.json (and numbered subsequent samples), inbound-event-schema.json and spike-results.json under fixtures/photon only after actual calls. Inbound fixtures preserve envelope structure with redacted values. The results label the measured span as provider receipt to outbound delivered. This is distinct from device-to-device round-trip timing. A p50 is reported only after at least three samples; manual phone timing is still needed for the specification's round-trip target. A simulated or fallback transport cannot produce a successful live result.

## Next live steps

1. Sign into the Photon Beta dashboard. In this session the dashboard opened at its sign-in page; no authenticated project was available.
2. Create or select the Beta project, enable iMessage, assign the shared line for each demo sender, and configure the local environment. Neither project creation nor assigned lines are verified yet.
3. Run the catalog-only command. It must print PASS event type listing and save the actual API version and event names.
4. Stop any integration server so only one listener owns the project. Run the three-sample command. Text the assigned line from both configured demo phones when prompted. No outbound is sent before a recognized demo inbound.
5. Review the redacted live envelope, incoming schema and results. If normalization fails, use the captured shape to correct the adapter and repeat.
6. Record actual phone round-trip timing and check own-message echo and first-outbound behavior manually. Record line capacity and observed rate-limit behavior without inducing load. Fill in the assumptions table with evidence.
7. Mark A1-02 accepted only after its live criteria are satisfied, then resume the planned A1-06, A1-03, A1-04, A1-05, A1-08, A1-07, A1-09 sequence. Do not interpret the historical branch name as completion of A1-09.

The fixture inbound-text.synthetic.json contains invented test data based on the documented resource. It is not evidence of a live provider call.

## Milestone accounting after the sequencing correction

The plan is authoritative. Earlier commits bundled code across milestones and advanced to recovery fixes before the live spike; that was an execution-order deviation. This table distinguishes implementation from acceptance and describes the current Agent 1 branch, not an assertion that every change is on main.

| Planned order | Milestone                   | Current acceptance                                                                                                                                                             |
| ------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1             | A1-01 foundation            | Simulator vertical slice verified. Shared root verification is still blocked by CR-A1-006.                                                                                     |
| 2             | A1-02 Photon spike          | Runner code verified. Live spike blocked by project access and phones; documented rung 5 fallback active.                                                                      |
| 3             | A1-06 pipeline, stores, A2A | Two-agent mock-detector conversation, isolation, gate races and queued recovery verified. Full A2 purchasing rehearsal awaits its integration.                                 |
| 4             | A1-03 consent and commands  | Command grammar and STOP/onboarding/AGREE/scope/pause/resume conversation checks pass.                                                                                         |
| 5             | A1-04 approvals and outbox  | Binding, lifecycle, atomic consumption, repeated YES, retries and delivery confirmation checks pass.                                                                           |
| 6             | A1-05 Photon provider       | Synthetic SDK/HTTP/Socket.IO checks pass. Real inbound fixture and phone approval delivery remain unverified.                                                                  |
| 7             | A1-08 trust controls        | Isolation, shared-output scanning and new private-event erasure pass. Referenced-intent purge and legacy private-event migration remain acceptance exceptions.                 |
| 8             | A1-07 webhook and status    | Signature/dedupe tests, registered-provider polling, gated tapback and typing pass. Tunnel unavailable; A2/A3 health registration requested. Live acknowledgements unverified. |
| 9             | A1-09 live hardening        | Real-process SIGKILL/restart rehearsal, durable outbox recovery and socket cursor tests pass. Three live doctor passes, manual echo and device timing remain blocked.          |

## Ordered code acceptance checkpoint

The milestones above were reviewed in the agreed order, using A1-02's documented fallback while live prerequisites remain unavailable. The expanded acceptance command passes 270 tests across 23 files, including both agents' cross-feature tests and an actual server process killed and restarted against a temporary SQLite database:

```sh
pnpm exec vitest run --config packages/platform/vitest.acceptance.config.ts
pnpm exec tsc -p packages/platform/tsconfig.acceptance.json
```

All five A1 package/server TypeScript projects pass strict checking. The cross acceptance TypeScript config checks A1's cross tests; A3's cross tests execute successfully but their separate TypeScript check exposes two pre-existing unknown JSON response types recorded in CONTRACT_REQUESTS. Full root verify remains blocked by shared formatting, lockfile and root TypeScript configuration. A passing subset is not a claim that pnpm verify passes.

Doctor now supports a read-only deliverability preflight:

```sh
node --env-file=.env.local --import tsx scripts/photon-doctor.ts --preflight-only
node --env-file=.env.local --import tsx scripts/photon-doctor.ts
```

Preflight reads the iMessage line configuration, active shared assignments and the previous 30 minutes of incoming direct texts, with bounded pagination and masked sender labels. An unobserved sender is not proof of undeliverability. Preflight does not send messages or establish delivery. A full doctor run refuses missing assignments in shared-line mode and requires a new recognized demo inbound followed by delivered read-back. Its receipt and outbound timing do not establish device-to-device latency or own-message echo behavior. Run it successfully three times and record the manual checks before marking live hardening accepted.

New messaging.latency events are private, mode-labeled and measure outbox_send_to_delivered only. Optional MessagingProvider acknowledgement/typing capabilities use the typed pinned SDK, stable keys and the owner's ackMode=reaction setting. Default none sends no acknowledgement. Synthetic tests do not establish live support.

New private event prose uses removable overlays so FORGET can erase it while preserving immutable event rows. Existing databases with raw prose already embedded in immutable private events explicitly refuse FORGET pending a migration policy. Feature-referenced intents retain the previously documented refusal pending A2/A3 purge paths; financial and points audit records are not silently deleted.

## Follow-up integration evidence

Latest main through 053944e is integrated on the Agent 1 branch. Root TypeScript now passes after local dependency installation. Full verify is still blocked by three DB formatting files and the DB types lockfile importer, with ownership scope clarification pending. Server composition now registers banking and Chalk health sources when their implementations are present.

A detached checkout combining A2 at 984f209 with this branch exposed two real purchasing blockers despite its existing suite passing: a null required pool reference, and proposal lookup excluding already-matched intents. The tested proposed patch is packages/platform/integration/purchasing-984f209.patch; its companion runner is packages/platform/rehearse-purchasing.ts. With the patch applied only in that detached checkout, the full two-member simulated purchase reaches settled with exactly two simulated transfers, and 364 tests pass. This evidence does not mean the A2 implementation or proposed patch has been merged into the published Agent 1 branch.

The first live gate remains A1-02. Local credentials and phones are still unavailable. Referenced-intent FORGET and legacy-event migration exceptions remain open pending the documented policy and ownership decisions.
