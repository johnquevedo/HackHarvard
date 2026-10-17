#!/usr/bin/env bash
# A3-02 Chalk spike: install chalkcompute, confirm credentials, run a 5-case Dennis evaluation with a
# trivial task, and read the result dataset back. Usage: pnpm spike:chalk
# Credentials: CHALK_CLIENT_ID and CHALK_CLIENT_SECRET (plus CHALK_ENVIRONMENT if needed), or `chalk login`.
set -euo pipefail
cd "$(dirname "$0")/../services/chalk-eval"

uv sync -q --python 3.12
echo "PASS chalkcompute $(uv run -q python -c 'import importlib.metadata as m; print(m.version("chalkcompute"))') installed"

if [[ -z "${CHALK_CLIENT_ID:-}" || -z "${CHALK_CLIENT_SECRET:-}" ]] && [[ ! -f "${XDG_CONFIG_HOME:-$HOME}/.chalk.yml" ]]; then
  echo "BLOCKED spike:chalk no Chalk credentials (CHALK_CLIENT_ID/CHALK_CLIENT_SECRET or ~/.chalk.yml); fallback: LOCAL RUN (NOT CHALK)"
  exit 2
fi

uv run -q python -I - <<'PY'
import time
import chalkcompute as cc

@cc.function
def dennis_spike_task(text_a: str) -> str:
    return "propose_market" if "interview" in text_a else "no_market"

@cc.function
def dennis_spike_scorer(output: str, expected: str) -> cc.EvaluationScorerResult:
    return cc.EvaluationScorerResult(score=1.0 if output == expected else 0.0)

rows = [
    {"text_a": "final round interview today", "expected": "propose_market"},
    {"text_a": "so cooked for this meeting", "expected": "no_market"},
    {"text_a": "interview at noon", "expected": "propose_market"},
    {"text_a": "got the offer", "expected": "no_market"},
    {"text_a": "lunch?", "expected": "no_market"},
]
t0 = time.time()
rev = cc.DatasetClient().upload("dennis-spike", rows)
print(f"PASS dataset uploaded {rev.dataset_id} rev {rev.revision_id}")
ev = cc.Evaluation.create("dennis-spike", dataset=rev, task=dennis_spike_task, scorers=[dennis_spike_scorer])
run = ev.run(metadata={"spike": True}).wait(timeout=900, raise_on_failure=False)
print(f"{'PASS' if run.status.value == 'succeeded' else 'FAIL'} run {run.id} {run.status.value} in {time.time() - t0:.0f}s {run.error_message or ''}")
if run.result_dataset is not None:
    table = cc.DatasetClient().read(run.result_dataset)
    print(f"PASS result rows read back: {table.num_rows}, columns: {table.column_names}")
PY
