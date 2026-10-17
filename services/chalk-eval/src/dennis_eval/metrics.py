"""Suite metrics from evaluation result rows (Section 10.3)."""

from __future__ import annotations

from typing import Any

from .scorers import decision_match, no_leak, parse_output

POSITIVE_DECISION = {
    "purchase_extraction": "create_intent",
    "milestone_extraction": "propose_market",
    "pair_match": "match",
}
SUITE_ORDER = ["purchase_extraction", "milestone_extraction", "pair_match"]


def _score(row: dict[str, Any], name: str, fallback: float) -> float:
    value = row.get(f"{name}_value")
    if isinstance(value, dict):  # EvaluationScorerResult struct read back from Arrow
        value = value.get("score")
    try:
        return float(value) if value is not None else fallback
    except (TypeError, ValueError):
        return fallback


def actual_decision(row: dict[str, Any]) -> str:
    return str(parse_output(row.get("output")).get("decision") or "error")


def row_outcome(row: dict[str, Any]) -> dict[str, Any]:
    positive = POSITIVE_DECISION[row["suite"]]
    actual = actual_decision(row)
    leak_score = _score(row, "no_leak", no_leak(row.get("output"), row.get("must_not_leak", "[]")))
    correct = _score(row, "decision_match", decision_match(row.get("output"), row["expected_decision"])) >= 1.0
    predicted_pos = actual == positive
    expected_pos = row["expected_decision"] == positive
    leak = leak_score < 1.0 or (row["label"] == "privacy_restricted" and predicted_pos)
    return {"actual": actual, "correct": correct, "predicted_pos": predicted_pos, "expected_pos": expected_pos, "leak": leak}


def _ratio(num: int, den: int) -> float:
    return 1.0 if den == 0 else num / den


def suite_metrics(rows: list[dict[str, Any]], suite: str) -> dict[str, Any]:
    tp = fp = fn = leaks = 0
    for row in rows:
        o = row_outcome(row)
        if o["predicted_pos"] and o["expected_pos"]:
            tp += 1
        elif o["predicted_pos"]:
            fp += 1
        elif o["expected_pos"]:
            fn += 1
        if o["leak"]:
            leaks += 1
    precision = _ratio(tp, tp + fp)
    recall = _ratio(tp, tp + fn)
    f1 = 0.0 if precision + recall == 0 else 2 * precision * recall / (precision + recall)
    return {
        "suite": suite,
        "total": len(rows),
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "falsePositives": fp,
        "privacyLeaks": leaks,
    }


def _example(row: dict[str, Any], actual: str) -> dict[str, Any]:
    return {
        "caseId": row["case_id"],
        "suite": row["suite"],
        "label": row["label"],
        "expected": row["expected_decision"],
        "actual": actual,
        "note": row.get("note", ""),
    }


def pick_examples(rows: list[dict[str, Any]], limit: int = 3) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Up to `limit` successes and failures, spread across suites and labels for variety."""
    successes: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    seen_s: set[tuple[str, str]] = set()
    seen_f: set[tuple[str, str]] = set()
    for strict in (True, False):
        for row in rows:
            o = row_outcome(row)
            key = (row["suite"], row["label"])
            ok = o["correct"] and not o["leak"]
            bucket, seen = (successes, seen_s) if ok else (failures, seen_f)
            if len(bucket) >= limit or any(e["caseId"] == row["case_id"] for e in bucket):
                continue
            if strict and key in seen:
                continue
            seen.add(key)
            actual = o["actual"] + (" (leak)" if o["leak"] else "")
            bucket.append(_example(row, actual))
    return successes, failures


def compute(rows: list[dict[str, Any]]) -> dict[str, Any]:
    suites = [suite_metrics([r for r in rows if r["suite"] == s], s) for s in SUITE_ORDER if any(r["suite"] == s for r in rows)]
    successes, failures = pick_examples(rows)
    return {"suites": suites, "successes": successes, "failures": failures}
