# Photon Spectrum group-chat status

Status: IMPLEMENTED, CREDENTIAL AND PHONE VERIFICATION PENDING. The Photon-provided
account exposes a Spectrum Cloud UUID and project secret and reports two end users.
No real inbound, outbound, group membership, timing, or delivery observation is claimed yet.

## Evidence collected

The pinned @photon-ai/api 0.5.0 package was installed and its generated TypeScript declarations inspected. Operations compile as photon.projects.createOrGetUser, photon.projects.createOrGetSpace, photon.projects.sendMessage, photon.projects.getMessage, and photon.projects.platforms.getImessage. This version requires headers with the literal key "idempotency-key", correcting the specification's camelCase example.

The current [Beta Node example](https://photon.codes/docs/beta/websocket/example) and [event delivery documentation](https://photon.codes/docs/beta/websocket/events) specify Socket.IO at the API origin with path /v1/projects/{id}/events/ws, bearer authentication in extraHeaders, a subscribe command with startSeq, and delivery(event, { seq, replyExpected }). There is no processing acknowledgement callback. Dennis persists a cursor after its handler completes and retains it on failure. A project-level local lock prevents concurrent integration listeners on this machine.

The provided account is a Spectrum Cloud project, not a Photon Beta project. It uses
`PHOTON_PROJECT_ID` (a UUID) plus `PHOTON_PROJECT_SECRET`; it does not provide or
require `PHOTON_API_KEY` or `PHOTON_AGENT_USER_ID`. The integration uses
`spectrum-ts` 12.2.0 and the official iMessage provider. Spectrum models both DMs
and group chats as spaces, exposes group members, and accepts replies to the same
space. Dennis rejects a group event unless every human member maps to a registered
user with active `messaging_context` consent. Consent, approval, payment, STOP,
and other commands remain direct-message only.

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
node --env-file=.env --import tsx scripts/spike-photon.ts --catalog-only
node --env-file=.env --import tsx scripts/spike-photon.ts --samples 3
```

Catalog-only mode needs PHOTON_PROJECT_ID and PHOTON_API_KEY and makes read-only API calls. Live mode additionally needs DEMO_ALICE_HANDLE and DEMO_BOB_HANDLE. Set PHOTON_AGENT_USER_ID explicitly if discovery finds zero or multiple candidates. Keep every secret out of git and chat. Agent 4's root tooling now exposes pnpm spike:photon and pnpm photon:doctor. The direct commands also load a local environment file explicitly.

The runner writes event-catalog.json, inbound-text.json (and numbered subsequent samples), inbound-event-schema.json and spike-results.json under fixtures/photon only after actual calls. Inbound fixtures preserve envelope structure with redacted values. The results label the measured span as provider receipt to outbound delivered. This is distinct from device-to-device round-trip timing. A p50 is reported only after at least three samples; manual phone timing is still needed for the specification's round-trip target. A simulated or fallback transport cannot produce a successful live result.

## Next live steps

1. In `.env`, paste the dashboard's existing Project secret into
   `PHOTON_PROJECT_SECRET` and fill `DEMO_JOHN_HANDLE`, `DEMO_STEVEN_HANDLE`, and
   `DEMO_ISAAC_HANDLE` with the three real E.164 phone numbers or Apple ID email
   addresses. Do not commit `.env`.
2. Keep `PHOTON_MODE=live` and `PHOTON_SPACE_MODE=either`. The legacy Beta fields
   may stay blank; they are ignored whenever `PHOTON_PROJECT_SECRET` is present.
3. Run `node --env-file=.env --import tsx scripts/photon-doctor.ts --preflight-only`.
   It must print that Spectrum Cloud credentials were accepted.
4. Run the same command without `--preflight-only`, then send a new iMessage from
   any configured handle. Confirm the automated reply appears on the phone.
5. Create one iMessage group containing the Photon line and both demo users. Send
   one ordinary message from each user and confirm the reply remains in that group.
6. Run consent, approval, payment, and STOP commands only in each user's direct
   thread. Record phone timing, echo behavior, and a restart/reconnect check.

The fixture inbound-text.synthetic.json contains invented test data based on the documented resource. It is not evidence of a live provider call.

## Current review-branch status

All remaining local code and simulator integration work is prepared on a1/a1-09-recovery-hardening for human review. Main was not pushed during this pass. A2 at f84abd3 is integrated, including the two purchasing fixes that were previously only a proposed patch.

- pnpm install --frozen-lockfile passes.
- pnpm verify passes, including formatting, root TypeScript, 380 tests across 43 files, and the ownership check.
- pnpm e2e:sim passes its three tests. The server scenario now proves group creation, both join and payment approval stages, settlement and the three simulated account balances.
- pnpm exec tsx packages/platform/rehearse-purchasing.ts passes with two members, two simulated transfers of 28499 cents, replay protection and a shared-data privacy scan.

The exact review branch is recorded as a cross-package review in ownership.json. Ordinary agent branches retain their original ownership restrictions, and unowned paths still fail. This entry should be reviewed with the source changes; it does not authorize a push to main.

| Planned order | Milestone                   | Current acceptance                                                                                                                                                                                                                                              |
| ------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1             | A1-01 foundation            | Vertical slice, frozen install and full repository verification pass.                                                                                                                                                                                           |
| 2             | A1-02 Photon spike          | Runner ready. Live capture, timing, line behavior and real fixtures still require Photon credentials and phones. Simulated fallback remains explicit.                                                                                                           |
| 3             | A1-06 pipeline, stores, A2A | Real purchasing implementation integrated; complete two-member simulated settlement, isolation, gate races and recovery verified.                                                                                                                               |
| 4             | A1-03 consent and commands  | Deterministic grammar and STOP/onboarding/AGREE/scope/pause/resume checks pass.                                                                                                                                                                                 |
| 5             | A1-04 approvals and outbox  | Lifecycle, hashing, atomic consumption, repeated replies, retry schedule and delivery confirmation pass.                                                                                                                                                        |
| 6             | A1-05 Photon provider       | Adapter, signatures, SDK requests, typing and acknowledgement checks pass synthetically. Real inbound and phone approval remain unverified.                                                                                                                     |
| 7             | A1-08 trust controls        | Source-reference cleanup now supports actual FORGET after settled purchases and ShortMe drafts without deleting audit history. Open positions remain a documented refusal. Legacy payload migration is prepared separately and requires explicit policy review. |
| 8             | A1-07 webhook and status    | Banking and Chalk sources are wired through server composition. Cadence, timeout, failure transitions and webhook checks pass. Tunnel/live acknowledgement behavior remain unavailable.                                                                         |
| 9             | A1-09 live hardening        | Actual subprocess restart, SQLite recovery and socket resume checks pass. Three live doctor runs, device timing and manual echo checks remain unverified.                                                                                                       |

## Privacy upgrade and review procedure

The additive contract broadening makes GroupPurchaseMember.intentId and Market.sourceIntentId nullable. Feature-owned synchronous privacy cleanup detaches those references in the same SQLite transaction as private-content deletion. Payments, memberships, published market records, positions and points ledger rows are retained. Active settlement is refused; open market positions still prevent FORGET before consent or stakes are changed.

After review and before using an existing database with the updated source-reference schema, stop the server and run pnpm db:push. Its targeted table rebuild relaxes only the two private source columns, preserves all existing row values, recreates indexes and validates foreign keys. It rejects unrelated schema drift. Migration and repeated-push tests pass; no user database was reset during this work.

Legacy event prose cannot be removed from an immutable historical payload without an explicit exception to E1. The prepared utility is never run automatically by startup or FORGET. Its default is a read-only plan that reports counts only:

```sh
DATABASE_URL=file:./data/dennis.db pnpm exec tsx packages/platform/migrate-private-events.ts
```

Only after the human lead reviews and accepts the one-time legacy-payload rewrite exception, stop the server, take a SQLite backup, then use:

```sh
DATABASE_URL=file:./data/dennis.db pnpm exec tsx packages/platform/migrate-private-events.ts --apply --allow-audit-payload-rewrite
```

The migration retains event IDs, sequence, timestamps and actor metadata; it moves private prose into removable owner overlays and stores before/after payload hashes as migration receipts. Subsequent FORGET deletes those overlays. It is transactional, idempotent and rejects conflicting existing overlays. Tests prove the owner still sees history before FORGET and the text is absent afterward. This is an explicit legacy policy exception, not a claim that old payloads remained byte-for-byte immutable. No migration was applied to the user's database.

## Remaining live steps

Configure `PHOTON_PROJECT_SECRET` and all three demo handles locally, run the Spectrum
doctor, and exercise a real DM and group conversation across restart. Until those
observations exist, Photon is configured in code but not live verified.
