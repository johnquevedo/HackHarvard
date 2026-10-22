# Dennis, natively in iMessage

Dennis lives in the group chat, so it should act like a person in the group chat, not a bot that only sends text. Everything below goes through Photon Spectrum (`packages/messaging/src/photon/provider-spectrum.ts`) and is queued by the platform (`packages/platform/src/native.ts`) right after normal messages, so it lands in conversation order. Every action is idempotent, audited in the `native_actions` table, visible as a `native.action` event, and never blocks the product: if Photon is down or a feature is unsupported, the action is recorded as `failed`, `unsupported`, or `skipped` and the market or purchase carries on.

## What Dennis does

| Moment                                           | Native feature                        | What the group sees                                                                                                                                                                                                                                             |
| ------------------------------------------------ | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dennis first sees a new group                    | Contact card                          | Dennis's name and photo card ("Share Name and Photo")                                                                                                                                                                                                           |
| "i'm so cooked im failing my meta technical tmr" | Tapback                               | 💀 on john's message, then Dennis's offer to open a market                                                                                                                                                                                                      |
| "LMAO run it. I'll put $500"                     | Send effect + rename + poll + tapback | "Market created: ... $500 insurance for sale" sent with **Slam**; the group is renamed **📉 $JOHN short squeeze**; the market arrives as a **native iMessage poll** ("📈 long john · $100" / "📉 short john · $100"); 😂 on john's message (he shorted himself) |
| "nah you got that. I'll put $200"                | Tapback                               | ‼️ on steven's stake                                                                                                                                                                                                                                            |
| Someone votes in the poll                        | Poll vote, real stake                 | A $100 position on that side; Dennis replies "isaac put $100 against john. cold." Second votes and un-votes get "you're already in on this one." / "positions are final lol. no take backs."                                                                    |
| Result confirmed                                 | Send effect + rename + voice note     | One result line in the group with **Loud** (took the L) or **Fireworks** (did it); the group is renamed **💀 $JOHN delisted** or **📈 $JOHN to the moon**; a "closing bell" **voice note** reads the result and who is up or down                               |
| "also anyone tryna buy a monitor? mine's cooked" | Tapback                               | 👀 on isaac's message while the agents check for a match                                                                                                                                                                                                        |
| Both members approve the group deal              | Send effect                           | "both approved. group purchase organized." with **Confetti**                                                                                                                                                                                                    |

In a group chat, Dennis posts one line per moment: the poll replaces per-friend invite texts, and results go to the group once instead of to every participant.

Amounts are sim dollars on the ShortMe points ledger (1 point = $10); every result says "(sim $, no real money moved)". Purchases use the Nessie sandbox.

## Voice notes

The closing-bell voice note is synthesized locally with macOS `say` (AAC in an m4a container, the format iMessage plays as a voice message); no speech API key is needed. On machines without `say` the voice note is skipped. Choose the voice with `DENNIS_VOICE` (any name from `say -v '?'`), for example `DENNIS_VOICE=Daniel`.

## Live checklist (real phones)

1. `.env`: `PHOTON_MODE=live`, `PHOTON_SPACE_MODE=either`, `PHOTON_PROJECT_ID`, `PHOTON_PROJECT_SECRET`, `DEMO_JOHN_HANDLE`, `DEMO_STEVEN_HANDLE`, `DEMO_ISAAC_HANDLE`, `CONVERSATION_MODE=demo`, `DEMO_SCENARIO=group`, `LLM_PROVIDER=mock` for the scripted run. Optional: `DENNIS_VOICE`.
2. In the Photon dashboard, set the line's contact name to **Dennis** and give it a photo, so the contact card looks right.
3. `pnpm demo:reset`, then `pnpm dev`.
4. Create one iMessage group with the Photon line, john, steven, and isaac. Send the script in `packages/shortme/src/demo-script.ts`.
5. Vote in the poll from isaac's phone. Resolve from the dashboard (Demo Resolver, outcome No), then john sends `CONFIRM`.
6. Check `native_actions` (or the dashboard simulator thread) for any `failed` rows; the error column says why.

## Shot list for the post

1. The group header renamed to **📉 $JOHN short squeeze**, with the 💀 tapback on "i'm so cooked" and the slammed "Market created" line.
2. The native poll with votes on both sides.
3. The result line with the delisted rename and the voice note bubble (record a screen video for the Slam and Loud effects; effects do not show in stills).
4. The 👀 on the monitor message and the confetti "both approved" line.
