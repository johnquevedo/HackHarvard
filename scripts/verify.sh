#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if command -v pnpm >/dev/null 2>&1; then
  PNPM=(pnpm)
else
  PNPM=(corepack pnpm)
fi
"${PNPM[@]}" exec prettier --check .
"${PNPM[@]}" typecheck
"${PNPM[@]}" test
"${PNPM[@]}" exec tsx scripts/check-ownership.ts
