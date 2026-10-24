# Integrations

The live table comes from `GET /api/integrations`. This file is the expected real versus simulated map. Do not edit a badge to look healthier than that endpoint.

| Integration | Real                       | Simulated or fallback                        | Label                                  |
| ----------- | -------------------------- | -------------------------------------------- | -------------------------------------- |
| Photon      | PhotonBetaProvider         | SimMessagingProvider and the phone simulator | SIMULATED INBOUND / SIMULATED OUTBOUND |
| Nessie      | NessieBankingProvider      | SimBankingProvider                           | SIMULATED BANK                         |
| LLM         | Anthropic or Chalk gateway | MockStructuredLlm                            | SIMULATED LLM                          |
| Chalk eval  | Chalk Evaluations          | local runner                                 | LOCAL RUN (NOT CHALK)                  |
| Replay      | none                       | fixtures/replay JSONL                        | REPLAY                                 |

Mock mode (`NEXT_PUBLIC_API_MODE=mock`) currently reports Photon, LLM, and Nessie as simulated and Chalk as fallback. A payment is VERIFIED only when the provider read-back proves it.

## Photon native breadth (Vincent / contest)

Prefer **Spectrum Cloud** (`PHOTON_PROJECT_ID` UUID + `PHOTON_PROJECT_SECRET`) for contest surfaces. `createMessagingProvider` already selects `PhotonSpectrumProvider` when the project secret is present. Pinned `@photon-ai/api` **0.5.0** (`PhotonBetaProvider`) remains for Beta API-key projects.

### Flags

| Opt-in | Env | Default | Live today |
| ------ | --- | ------- | ---------- |
| Tapbacks + typing | `DENNIS_ACK_MODE=reaction` | `none` | Yes — pipeline + Spectrum/Beta `acknowledge` / `setTyping` after `seed-demo` |
| Ack emoji | `DENNIS_PHOTON_ACK_REACTION` | `👍` | Spectrum uses hardcoded 👍; Beta emoji wire-up pending CR-A4-001 |
| Voice notes | `DENNIS_PHOTON_NATIVE_VOICE=1` | `0` | **Sendable** via `pnpm photon:send-native -- --kind voice` (Spectrum). Provider auto-send pending A1 |
| Web / miniapp cards | `DENNIS_PHOTON_SPECTRUM_WEBAPP=1` | `0` | **Sendable** via `photon:send-native` (`app` / `miniapp` / `richlink`) |
| Contact cards | `DENNIS_PHOTON_SPECTRUM_CONTACT_CARD=1` | `0` | **Sendable** via `photon:send-native` (`contact-card` / `contact`) |
| Live location proxy | `DENNIS_PHOTON_SPECTRUM_LIVE_LOCATION=1` | `0` | **Sendable** maps URL as `app({ live })` / richlink — not Apple live-share bubble |
| Beta attachment | `DENNIS_PHOTON_NATIVE_ATTACHMENT=1` | `0` | Builders only until A1 wires Beta provider |
| Beta read receipt | `DENNIS_PHOTON_NATIVE_READ=1` | `0` | Builders only until A1 wires Beta provider |

### Working send path (A4)

```sh
# Web app card (universal Spectrum mini-app)
DENNIS_PHOTON_SPECTRUM_WEBAPP=1 pnpm photon:send-native -- --kind app --to +15551234567 --url https://example.com/card --live

# Customized iMessage miniapp (needs bundle + team)
DENNIS_PHOTON_SPECTRUM_WEBAPP=1 pnpm photon:send-native -- --kind miniapp --to +15551234567 --url https://example.com/mini --bundle-id com.example.app.imessage --team-id TEAMID

# Bot contact card
DENNIS_PHOTON_SPECTRUM_CONTACT_CARD=1 pnpm photon:send-native -- --kind contact-card --to +15551234567

# Voice note
DENNIS_PHOTON_NATIVE_VOICE=1 pnpm photon:send-native -- --kind voice --to +15551234567 --file ./note.m4a

# Location proxy (maps link as live app card)
DENNIS_PHOTON_SPECTRUM_LIVE_LOCATION=1 pnpm photon:send-native -- --kind location --to +15551234567 --lat 42.36 --lng -71.06
```

Helpers live in `apps/web/src/lib/photon-native-breadth/`. `seed-demo` re-applies `DENNIS_ACK_MODE` onto existing `agt_demo_*` agents.

### Gaps (honest)

- **Outbound Apple live-location share bubble:** no `spectrum-ts` builder. Proxy = maps URL card. Inbound user-shared live location needs A1 to accept non-text Spectrum content.
- **Inbound voice:** Spectrum provider currently filters to text/markdown only — CR-A4-001.
- **Pipeline auto-send** of webapp/contact/voice on every turn: still A1 `PhotonSpectrumProvider` wire-up.
