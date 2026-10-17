# Demo runbook

A teammate can run the five-minute demo from this page. Fill the rehearsal times after a human pass. This session did not time a live rehearsal.

## Preflight

1. `cp .env.example .env` and fill tokens outside git.
2. `pnpm install --frozen-lockfile`
3. `pnpm demo:reset` once Agent 1, Agent 2, and Agent 3 modules are merged. Until then, start the web app with `NEXT_PUBLIC_API_MODE=mock`.
4. `pnpm demo:check`
5. Confirm the status bar. Read any SIMULATED or FALLBACK badge out loud. Do not call a fixture live.

## Script

Cast: Alice and Bob. Presenter drives the dashboard.

- Alice: `I'm thinking about getting a new 27 inch 4K monitor for my setup, maybe $350 or under.`
- Bob: `I need a monitor too, probably this weekend. 4K if I can find one.`
- Alice later: `just finished my final round interview at a quant firm. i either get the offer or im cooked`

| Clock | Action                                 | What good looks like                                                                    |
| ----- | -------------------------------------- | --------------------------------------------------------------------------------------- |
| 0:00  | Badges and Consent Center              | Modes are honest. Both users have four consents.                                        |
| 0:25  | Alice monitor text                     | Private text only in Alice's lane. Shared lane has the public product key.              |
| 0:50  | Bob monitor text                       | Match and SIMULATED OFFER. Explain panel shows pass and fail.                           |
| 1:10  | Two approval texts                     | Separate outbox rows.                                                                   |
| 1:25  | Both YES                               | Group confirmed. First names appear only after this.                                    |
| 1:50  | Both YES again                         | Bank panel shows provider ids and before/after balances. VERIFIED only after read-back. |
| 2:50  | Alice interview text                   | Proposed market only in Alice's lens.                                                   |
| 3:05  | Alice YES                              | Market open. Invite does not include the source text.                                   |
| 3:20  | Bob BACK 50, Alice FADE 50             | Alice is tagged shorted herself.                                                        |
| 3:40  | Demo Resolver, no offer, Alice CONFIRM | Button says STAND-IN FOR OFFICIAL SOURCE. Ledger zero-sum.                              |
| 4:10  | Eval tab                               | CHALK EVAL or LOCAL RUN (NOT CHALK).                                                    |
| 4:30  | Turn off Alice purchase matching       | Registry entry leaves the shared lane.                                                  |
| 4:45  | Close                                  | Done by 5:00. If long, skip 4:30 first.                                                 |

## Fallbacks

| What broke                | What to do                                                | Say this                                    |
| ------------------------- | --------------------------------------------------------- | ------------------------------------------- |
| iMessage outbound is slow | Show the outbox row. Use the dashboard approve button.    | DASHBOARD FALLBACK                          |
| Inbound is dead           | Phone simulator, Send as Alice or Bob.                    | SIMULATED INBOUND                           |
| LLM fails                 | The rejection event is real. Send the line again.         | Do not hide it                              |
| Bank fails                | Show the failed attempt. Do not switch the bank mid-demo. | SIMULATED BANK only if you started that way |
| Whole stack is down       | `pnpm demo:replay purchase`                               | REPLAY, always visible                      |

## Rehearsal

| Run | Date    | Duration | Notes                                           |
| --- | ------- | -------- | ----------------------------------------------- |
| 1   | not run |          | Presenter fills this after the first timed pass |
| 2   | not run |          | Second clean pass before demo lock              |

Backup video: record one clean mock or live run from the dashboard before demo lock. If the venue network blocks Photon, play `pnpm demo:replay` and keep the REPLAY banner on screen.
