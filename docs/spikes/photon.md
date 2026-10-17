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

## Next live steps

1. Human lead creates the Beta project, enables iMessage, and assigns a shared line to each demo sender.
2. Configure PHOTON_PROJECT_ID, PHOTON_API_KEY, PHOTON_AGENT_USER_ID, DEMO_ALICE_HANDLE, DEMO_BOB_HANDLE, and PHOTON_MODE=live as environment variables. Never commit or paste the API key.
3. Stop the integration server so only one live listener owns the project. Run pnpm exec tsx scripts/photon-doctor.ts. Text the assigned line from a demo phone.
4. Capture the redacted actual public event as fixtures/photon/inbound-text.json, verify its envelope, and adjust the normalizer if necessary. Do not label the synthetic fixture as a recording.
5. Query the versioned webhook event catalog with the project key, record the selected API version and incoming event schema. Register and test a tunnel only if the Socket.IO path fails.
6. Run the doctor three times, record measured delivery latencies and observed inbound receipt lag separately, and manually check echo and first-outbound behavior. Measure the actual round trip before claiming its p50.

The fixture inbound-text.synthetic.json contains invented test data based on the documented resource. It is not evidence of a live provider call.
