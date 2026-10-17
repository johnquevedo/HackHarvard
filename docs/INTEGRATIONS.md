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
