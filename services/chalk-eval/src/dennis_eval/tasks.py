"""Task entry points. The same functions run locally and inside the deployed Chalk task functions."""

from __future__ import annotations

import datetime as dt
import json
import os
from functools import lru_cache
from typing import Any
from zoneinfo import ZoneInfo

from .bundle import Bundle, load_bundle
from .llm import AnthropicHttpLlm, Llm
from .milestone import extract_milestone
from .purchase import extract_purchase, match_pair


def today_iso() -> str:
    fixed = os.environ.get("DENNIS_EVAL_TODAY")
    if fixed:
        return fixed
    return dt.datetime.now(ZoneInfo("America/New_York")).date().isoformat()


@lru_cache(maxsize=1)
def _bundle() -> Bundle:
    return load_bundle()


@lru_cache(maxsize=1)
def _llm() -> Llm:
    return AnthropicHttpLlm.from_env()


def run_case(suite: str, text_a: str, text_b: str, *, llm: Llm | None = None, bundle: Bundle | None = None,
             today: str | None = None) -> dict[str, Any]:
    b = bundle or _bundle()
    m = llm or _llm()
    t = today or today_iso()
    if suite == "milestone_extraction":
        return extract_milestone(text_a, m, b.milestone_prompt, b.milestone_gates, today=t)
    if suite == "purchase_extraction":
        return extract_purchase(text_a, m, b.purchase_prompt, b.purchase_gates, today=t)
    if suite == "pair_match":
        return match_pair(text_a, text_b, m, b.purchase_prompt, b.purchase_gates, b.matching_rules, today=t)
    raise ValueError(f"unknown suite {suite}")


def run_case_json(suite: str, text_a: str, text_b: str = "") -> str:
    """String in, JSON string out: the shape of the Chalk task function output column."""
    return json.dumps(run_case(suite, text_a, text_b), sort_keys=True)
