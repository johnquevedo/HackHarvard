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
