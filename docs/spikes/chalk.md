# Spike A3-02: Chalk Evaluations

Status: BLOCKED on credentials (no Chalk environment or token on the A3 machine at T+0:50). The full evaluation service is written and unit tested against the real `chalkcompute` 2.13.7 API; it runs as soon as credentials exist. Until then the honest label is LOCAL RUN (NOT CHALK).

## Verified by reading the installed `chalkcompute` 2.13.7 source

| Fact | Evidence |
| --- | --- |
| Auth: `CHALK_CLIENT_ID` + `CHALK_CLIENT_SECRET` env vars (optional `CHALK_ENVIRONMENT`, `CHALK_API_SERVER`, default `https://api.chalk.ai`), else `~/.chalk.yml` from `chalk login` | `_auth_config.py` `load_token` |
| `DatasetClient().upload(name, rows)` accepts a list of row dicts and returns a `DatasetRevisionRef`; re-uploading a name makes a new revision | `_dataset.py` |
| `Evaluation.create(name, dataset=, task=, scorers=[...], metadata=)`; scorers are deployed `@chalkcompute.function` handles or `SqlExpression` (no built-in scorer handles in this version) | `_evaluation.py` `_scorer_spec` |
| Scorer functions must return `EvaluationScorerResult(score in [0,1], metadata?)`; parameters bind to dataset columns by name plus `output` | `_evaluation.py` |
| `evaluation.run(metadata=).wait(timeout=, raise_on_failure=False)`; statuses `pending`, `running`, `finalizing`, `succeeded`, `failed`, `canceled` | `EvaluationRunStatus` |
| `DatasetClient().read(run.result_dataset)` returns a PyArrow table with dataset columns, `output`, `output_error`, and `<scorer>_value`, `<scorer>_error`, `<scorer>_metadata` | `_dataset.py` `read` docstring |
| Decorating a function starts deployment in a background worker at import time | `_function.py` `function` docstring |
| Secrets: `Secret.from_local_env("ANTHROPIC_API_KEY")` injects a local env var into the container | `_secret.py` |
| `Image.debian_slim("3.12").add_local_python_source("dennis_eval")` ships our package to `/app` | `_image.py` |

## Design consequences

- One task function `dennis_task(suite, text_a, text_b) -> str` (JSON output) and three scorer functions `dennis_decision_match`, `dennis_category_match`, `dennis_no_leak`. Spec's built-in `json_match` is replaced by the equivalent function scorer because this SDK version accepts only functions or SQL expressions.
- Deployment happens only in `dennis_eval.chalk_app`, imported only for `--provider chalk`, so tests and local runs never deploy.
- Prompts and rules files are bundled into `_bundle.json` inside the shipped package so the task runs the same policy as the TypeScript detector.
- The task calls Anthropic directly (stdlib HTTP, forced tool call). Gateway auth from inside a deployed function is unverified.

## Still unknown (needs credentials)

Hackathon environment access and token issuance; whether default network policy allows egress to `api.anthropic.com`; image build time; run duration and quotas; gateway structured-output support.

## Commands

```
pnpm spike:chalk                                        # trivial 5-case evaluation, prints PASS or BLOCKED
cd services/chalk-eval && uv run python -m dennis_eval.run --suite all --provider chalk
cd services/chalk-eval && uv run python -m dennis_eval.run --provider local-run      # same tasks locally, labeled local
cd services/chalk-eval && uv run python -m dennis_eval.run --provider local-fixture  # metrics from fixture rows
```
