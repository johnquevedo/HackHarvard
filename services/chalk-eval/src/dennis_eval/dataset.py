"""Load EvalCase JSONL files and flatten them into Chalk dataset rows."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .bundle import repo_root

SUITES = ["purchase_extraction", "milestone_extraction", "pair_match"]
LABELS = {"positive", "negative", "ambiguous", "privacy_restricted"}
DECISIONS = {"create_intent", "no_intent", "blocked", "propose_market", "no_market", "blocked_policy", "match", "no_match"}
STARTER_DIR = Path(__file__).resolve().parents[2] / "tests" / "starter"


class CaseError(Exception):
    pass


def validate_case(c: Any) -> dict[str, Any]:
    """Same rules as the EvalCase Zod schema in packages/contracts/src/eval.ts."""
    if not isinstance(c, dict):
        raise CaseError("case is not an object")
    for key in ["id", "suite", "label", "synthetic", "textA", "textB", "expected", "note"]:
        if key not in c:
            raise CaseError(f"{c.get('id', '?')}: missing {key}")
    if c["suite"] not in SUITES or c["label"] not in LABELS or c["synthetic"] is not True:
        raise CaseError(f"{c['id']}: bad suite, label, or synthetic flag")
    exp = c["expected"]
    if not isinstance(exp, dict) or exp.get("decision") not in DECISIONS or not isinstance(exp.get("mustNotLeak"), list):
        raise CaseError(f"{c['id']}: bad expected block")
    if c["suite"] == "pair_match" and not c["textB"]:
        raise CaseError(f"{c['id']}: pair case needs textB")
    return c


def case_files(source: str = "auto") -> tuple[list[Path], str]:
    """Prefer the shared dataset (packages/eval-data); fall back to the A3 starter set."""
    root = repo_root()
    shared = root / "packages" / "eval-data" / "cases" if root else None
    if source in ("auto", "shared") and shared is not None and shared.is_dir():
        files = sorted(shared.glob("*.jsonl"))
        if files:
            return files, "eval-data"
    if source == "shared":
        raise CaseError("packages/eval-data/cases has no JSONL files yet")
    return sorted(STARTER_DIR.glob("*.jsonl")), "starter"


def load_cases(source: str = "auto", suite: str = "all") -> tuple[list[dict[str, Any]], str]:
    files, origin = case_files(source)
    cases: list[dict[str, Any]] = []
    seen: set[str] = set()
    for path in files:
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if not line.strip():
                continue
            c = validate_case(json.loads(line))
            if c["id"] in seen:
                raise CaseError(f"duplicate case id {c['id']} ({path.name}:{n})")
            seen.add(c["id"])
            if suite == "all" or c["suite"] == suite:
                cases.append(c)
    return cases, origin


def to_row(c: dict[str, Any]) -> dict[str, Any]:
    """Flat, string-typed columns so the Arrow schema is stable across suites."""
    return {
        "case_id": c["id"],
        "suite": c["suite"],
        "label": c["label"],
        "text_a": c["textA"],
        "text_b": c["textB"] or "",
        "expected_decision": c["expected"]["decision"],
        "expected_category": c["expected"].get("category") or "",
        "must_not_leak": json.dumps(c["expected"]["mustNotLeak"]),
        "note": c["note"],
    }
