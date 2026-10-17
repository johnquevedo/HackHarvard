"""Deployed Chalk functions: one task function and three scorer functions.

Importing this module starts deployment (that is how @chalkcompute.function works), so only run.py
imports it, and only for --provider chalk. Inside the container the decorators are no-ops and the
bundle written below is read back from /app/dennis_eval/_bundle.json.
"""

from __future__ import annotations

import os

import chalkcompute as cc

from dennis_eval import scorers
from dennis_eval.bundle import BUNDLE_FILE, load_bundle, write_bundle_file

if not BUNDLE_FILE.is_file() or os.environ.get("DENNIS_EVAL_REBUNDLE") == "1":
    write_bundle_file(load_bundle())

_IMAGE = cc.Image.debian_slim("3.12").add_local_python_source("dennis_eval")
_ENV: dict[str, object] = {
    "LLM_MODEL": os.environ.get("LLM_MODEL") or "claude-sonnet-5-5",
    "DENNIS_EVAL_TODAY": os.environ.get("DENNIS_EVAL_TODAY") or "",
}
if os.environ.get("ANTHROPIC_API_KEY"):
    _ENV["ANTHROPIC_API_KEY"] = cc.Secret.from_local_env("ANTHROPIC_API_KEY")


@cc.function(image=_IMAGE, env=_ENV, retries=1)
def dennis_task(suite: str, text_a: str, text_b: str) -> str:
    from dennis_eval.tasks import run_case_json

    return run_case_json(suite, text_a, text_b)


@cc.function(image=_IMAGE)
def dennis_decision_match(output: str, expected_decision: str) -> cc.EvaluationScorerResult:
    return cc.EvaluationScorerResult(score=scorers.decision_match(output, expected_decision))


@cc.function(image=_IMAGE)
def dennis_category_match(output: str, expected_category: str) -> cc.EvaluationScorerResult:
    return cc.EvaluationScorerResult(score=scorers.category_match(output, expected_category))


@cc.function(image=_IMAGE)
def dennis_no_leak(output: str, must_not_leak: str) -> cc.EvaluationScorerResult:
    return cc.EvaluationScorerResult(score=scorers.no_leak(output, must_not_leak))


SCORERS_BY_SUITE = {
    "purchase_extraction": [dennis_decision_match, dennis_category_match, dennis_no_leak],
    "milestone_extraction": [dennis_decision_match, dennis_category_match, dennis_no_leak],
    "pair_match": [dennis_decision_match],
}
# Scorer column names in the result dataset are <scorer>_value; metrics.py reads these names.
SCORER_COLUMN = {
    "dennis_decision_match": "decision_match",
    "dennis_category_match": "category_match",
    "dennis_no_leak": "no_leak",
}
