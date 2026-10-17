# Nessie spike A2-02

Date: 2026-10-17

## Status

FALLBACK after a live contract probe. A Nessie credential successfully authenticated against `https://prod-api.nessieisreal.com` on 2026-10-17. Customer creation, account creation, transaction creation, transaction read-back, account reads, and the payer account transaction listing all succeeded.

The live endpoint cannot satisfy the Dennis payment invariant. Its current `TransferCreate` schema rejects the legacy `medium` and `payee_id` fields. With those fields omitted, it creates a transaction record but does not debit the payer or credit the intended pool. The returned record has no payer or payee field, and the pool account transaction listing returns 404. Dennis therefore stays fail closed and uses `NESSIE_MODE=sim` for the payment demo.

## Contract evidence before the live spike

- The official Nessie site describes customer creation, mock accounts, balance reads, and peer-to-peer transactions, and provides API keys after login: `https://api.nessieisreal.com/`.
- The official JavaScript SDK sends the API key with calls and exposes customer account operations: `https://github.com/nessieisreal/nessie-javascript-sdk`.
- The project specification treats transfer request fields and balance behavior as assumptions until this script observes them.

This evidence is enough to shape the probe, but it is not treated as live verification.

## Live probe procedure

1. Export `NESSIE_API_KEY` locally. Do not write it to a file.
2. Optionally set `NESSIE_BASE_URL`. Otherwise the spike probes `https://prod-api.nessieisreal.com` and then `http://api.nessieisreal.com`.
3. Set a unique `NESSIE_RUN_TAG`.
4. Run `pnpm spike:nessie` after the root workspace script lands. Until then run `node --experimental-strip-types scripts/spike-nessie.ts`.
5. Inspect the redacted file under `fixtures/nessie/` and update the findings below from observed responses.

The script creates one synthetic customer, a payer account with a 100 dollar sandbox balance, a pool account, and a 1 dollar sandbox transfer. It reads the transfer and both balances back and lists transfers for both accounts.

## Findings

| Question                               | Current finding                                                                                                      | Adapter decision                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Working base URL                       | `https://prod-api.nessieisreal.com`                                                                                  | Keep `NESSIE_BASE_URL` configurable; this is the verified default                    |
| Customer creation allowed              | Yes, HTTP 201                                                                                                        | Create synthetic demo customers using unique run tags                                |
| Account creation allowed               | Yes, HTTP 201                                                                                                        | Create tagged synthetic accounts; adopt tagged accounts on retries                   |
| Creation response shape                | `{ code, message, objectCreated: { _id, ... } }`                                                                     | Accept `_id`, `id`, or `objectCreated._id`; reject any response without an ID        |
| Transfer request fields                | `amount`, `transaction_date`, `status`, and `description` accepted; `medium` and `payee_id` rejected as extra fields | Do not claim the current endpoint can target a payee                                 |
| Both balances change                   | No; payer delta 0 dollars and pool delta 0 dollars after a 1 dollar record was created                               | Never mark this live transaction `verified`; use the simulated provider for the demo |
| Description round-trips                | Yes, exactly                                                                                                         | Memo lookup can identify the created record, but cannot prove movement of funds      |
| Transfer is visible from both accounts | No; payer listing returns it and pool listing returns 404                                                            | Do not use pool visibility as payment evidence                                       |

## Safety and fixture rules

- The API key is never logged or written to a fixture.
- Only synthetic Dennis spike identities are created.
- The script performs exactly one 1 dollar sandbox transfer per run.
- POST requests are never retried.
- Fixtures redact fields whose names contain `key`, `token`, `secret`, or `authorization`.
- A failed or ambiguous read-back remains documented and does not become a verified result.

## S2 status block

- Milestones done: A2-01 checkpoint implemented; A2-02 live contract probe completed.
- Nessie: FALLBACK.
- Blocker: the current live transfer endpoint cannot name a destination account and does not move either observed balance.
- Adapter decision: retain the legacy destination-bearing request so the live provider fails closed with HTTP 400; use `SimBankingProvider` with a visible `SIMULATED BANK` label.

## A2-09 rehearsal status

Live rehearsal is blocked. The credential works, but the live Nessie endpoint does not move funds between the two accounts. The Photon stack, shared platform, and root workspace are also unavailable in this worktree. The milestone fallback is active and must be shown as `SIMULATED BANK` in the product.

Two consecutive simulated banking rehearsals completed with two 28499-cent transfers per run. Each simulated transfer was read back, and both payer and pool balance deltas matched exactly. Evidence is stored in `fixtures/nessie/sim-rehearsal.json`.

No live Nessie transfer occurred. The `sim_tx_...` values in the fixture are simulated-provider IDs and must never be presented as Nessie IDs.

## Final Agent 2 report

- Nessie status: SIMULATED FALLBACK. Live customer and account creation work; account adoption remains the retry strategy.
- Live balance semantics: creating a 1 dollar transaction record changed neither the payer nor pool balance.
- Simulated balance semantics: transfers synchronously debit the payer and credit the pool by exactly `amountCents`.
- Live verified runs: zero. One live transaction record was created and read back, but it was not a verified transfer and is not represented as one.
- Simulated verified runs: two, clearly labeled, with four simulated transfer IDs in the rehearsal fixture.
- Open issue CR-A2-001: Agent 1 must add transaction-aware approval consumption before any payment execution can create an attempt.
- Open integration issues: shared contracts, platform, root workspace, and Photon are absent, so `pnpm verify` and the full Feature A story cannot run.
