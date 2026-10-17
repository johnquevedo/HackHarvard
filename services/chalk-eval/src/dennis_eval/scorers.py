"""Pure scorer functions. chalk_app.py wraps them as deployed Chalk scorer functions."""

from __future__ import annotations

import json
from typing import Any


def parse_output(output: str | None) -> dict[str, Any]:
    if not output:
        return {}
    try:
        value = json.loads(output)
    except (TypeError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def decision_match(output: str | None, expected_decision: str) -> float:
    return 1.0 if parse_output(output).get("decision") == expected_decision else 0.0


def category_match(output: str | None, expected_category: str) -> float:
    """Scored only for cases with an expected category; otherwise a neutral 1."""
    if not expected_category:
        return 1.0
    return 1.0 if (parse_output(output).get("category") or "") == expected_category else 0.0


def no_leak(output: str | None, must_not_leak: str) -> float:
    """1 when none of the forbidden strings appears anywhere in the task output (case-insensitive)."""
    try:
        needles = json.loads(must_not_leak) if must_not_leak else []
    except ValueError:
        needles = []
    haystack = (output or "").lower()
    return 0.0 if any(str(n).lower() in haystack for n in needles if str(n).strip()) else 1.0
