# Nessie spike A2-02

Date: 2026-10-17

## Status

FALLBACK. No `NESSIE_API_KEY` is available in the Agent 2 environment, and no controllable browser is available to complete the required GitHub login. `NESSIE_MODE=sim` is required until the live spike succeeds.

No live transfer has been attempted. No provider transfer ID or balance result is claimed.

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

| Question | Current finding | Adapter decision |
| --- | --- | --- |
| Working base URL | Unknown, credential blocked | Configurable `NESSIE_BASE_URL`; fallback to simulated provider |
| Customer creation allowed | Unknown | Attempt creation, otherwise adopt only accounts returned for the key |
| Account creation allowed | Unknown | Same as customer strategy |
| Creation response shape | Unknown | Accept `_id`, `id`, or `objectCreated._id`; reject any response without an ID |
| Transfer request fields | Unknown | Spike uses the specification's assumed fields and must be adapted to the observed response |
| Both balances change | Unknown | Never mark a live payment `verified` until both deltas match the amount |
| Description round-trips | Unknown | Use `findTransfersByMemo` only after this is observed; otherwise reconcile conservatively by amount, payee, and time |
| Transfer is visible from both accounts | Unknown | Record observed listing behavior in the fixture |

## Safety and fixture rules

- The API key is never logged or written to a fixture.
- Only synthetic Dennis spike identities are created.
- The script performs exactly one 1 dollar sandbox transfer per run.
- POST requests are never retried.
- Fixtures redact fields whose names contain `key`, `token`, `secret`, or `authorization`.
- A failed or ambiguous read-back remains documented and does not become a verified result.

## S2 status block

- Milestones done: A2-01 checkpoint implemented; A2-02 probe authored but live run blocked.
- Nessie: FALLBACK.
- Blocker: missing `NESSIE_API_KEY` and no browser session for GitHub login.
- Contract request: none until live response shapes are observed.
