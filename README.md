# Dennis

Personal agents in iMessage. Agent to agent to user.

## Quickstart

```
corepack enable && corepack prepare pnpm@10.34.7 --activate
cp .env.example .env
pnpm install --frozen-lockfile
pnpm dev
```

Agent 4 local ports are `PORT_SERVER=4104` and `PORT_WEB=3104`. The web app runs with `NEXT_PUBLIC_API_MODE=mock` until the server from Agent 1 is on `main`. In mock mode the dashboard renders fixtures and labels every simulated integration.

`pnpm db:reset` and `pnpm dev:server` need `packages/db` and `apps/server` from Agent 1.

## Checks

- `pnpm verify` runs Prettier, typecheck, unit tests, and the ownership check.
- `pnpm demo:check` checks secret prefixes and, outside mock mode, `/api/health` and `/api/integrations`.
- `pnpm eval:local` writes `data/eval/local-latest.json`.
- `pnpm e2e:sim` runs the privacy scan now, and the HTTP stories when `apps/server` exists.

Do not put secrets in git or in `NEXT_PUBLIC_*`.

## Conversation modes

`CONVERSATION_MODE=normal` is the live product behavior. Dennis reads every authorized message,
batches rapid group-chat turns, speaks selectively, and grounds replies in current application
state. Natural `yes`/`no` is treated as an approval only when that sender has exactly one pending
approval.

`DEMO_SCRIPT=video` is a temporary recording mode. Dennis answers only the exact lines in
`packages/platform/src/scripted-demo.ts` with the scripted replies, ignores everything else, and runs
no markets, purchases, or payments. Set it back to `off` after recording.

`TYPING_MS` shows the iMessage typing bubble for that many milliseconds before every message Dennis
sends (for example `2000`). Dennis's copy comes in voice variants: tests use the first, canonical
line; live runs rotate through the others so a repeated message gets a similar but different reply.

Background planning: when a chat has been quiet for `PLANNING_QUIET_MS`, Dennis reads what was said
since his last plan, decides whether a real plan is forming (trip, meal, event, hangout, shared
purchase), researches it with Claude's web search when available, and sends one compiled "mom text".
Research falls back to labeled estimates if web search is unavailable. Dennis never books or pays.

`CONVERSATION_MODE=demo` enables the fixed scripted-demo grammar and copy, including the special
`I'll put $…` shortcuts and seeded outside purchase match. Keep this mode off during normal use.
