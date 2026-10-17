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
| Agent user ID                     | Must be supplied as PHOTON_AGENT_USER_ID                        | Not available                 |
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

Catalog-only mode needs PHOTON_PROJECT_ID and PHOTON_API_KEY and makes read-only API calls. Live mode additionally needs DEMO_ALICE_HANDLE and DEMO_BOB_HANDLE. Set PHOTON_AGENT_USER_ID explicitly if discovery finds zero or multiple candidates. Keep every secret out of git and chat. The root script name remains Agent 4's tooling responsibility; these direct commands work with the existing local tooling.

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

| Planned order | Milestone                   | Evidence and remaining acceptance                                                                                                                                                                          |
| ------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1             | A1-01 foundation            | Simulator server, health, inbound/SSE, contract samples, database and contracts tags were verified. Agent 4's full root verify remains unavailable.                                                        |
| 2             | A1-02 Photon spike          | Active now. Runner and synthetic tests exist; live catalog, real inbound fixture, delivered reply, timing and assumptions still require project access and phones.                                         |
| 3             | A1-06 pipeline, stores, A2A | Implemented and tested, including category propagation and A2 detector compatibility. Full two-user purchasing integration and the milestone's combined acceptance scenario still need rehearsal.          |
| 4             | A1-03 consent and commands  | Implemented and simulation-tested, including onboarding, AGREE, STOP, replay and command grammar. Cross-feature FORGET has the documented referenced-record restriction.                                   |
| 5             | A1-04 approvals and outbox  | Implemented and simulation-tested, including hash/user binding, expiry, concurrency, transactional consumption, notification retries and interrupted-send recovery. Recheck with both integrated features. |
| 6             | A1-05 Photon provider       | Implemented with fake HTTP and Socket.IO tests. A real inbound event and real approval text on the phone remain unverified.                                                                                |
| 7             | A1-08 trust controls        | Core gates, revoke hooks, viewer filtering and shared-payload scanner are implemented and tested. Full cross-feature privacy acceptance and the referenced-record FORGET policy remain open.               |
| 8             | A1-07 webhook and status    | Webhook signatures, dedupe and messaging/LLM health are tested. Live tunnel, all-provider polling coverage and optional typing/tapback work remain unverified or incomplete.                               |
| 9             | A1-09 live hardening        | Some recovery and reconnect code was implemented early. Three passing live doctor runs, real server restart during a conversation, live timing and deliverability preflight are not done.                  |
