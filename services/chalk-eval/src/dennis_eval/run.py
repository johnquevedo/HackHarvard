"""CLI: python -m dennis_eval.run --suite all --provider chalk|local-run|local-fixture

Honesty rule: a report says provider "chalk" only for suites whose Chalk evaluation run SUCCEEDED,
and carries the Chalk run IDs. Every other path writes provider "local" to a different file.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from pathlib import Path
from typing import Any

from .dataset import SUITES, load_cases, to_row
from .report import build_report, iso_now, write_report

EVAL_NAMES = {
    "purchase_extraction": "dennis-purchase-extraction",
    "milestone_extraction": "dennis-milestone-extraction",
    "pair_match": "dennis-pair-match",
}


def _suites(arg: str) -> list[str]:
    if arg == "all":
        return list(SUITES)
    if arg not in SUITES:
        raise SystemExit(f"unknown suite {arg}")
    return [arg]


def _normalize_result_row(row: dict[str, Any], scorer_column: dict[str, str]) -> dict[str, Any]:
    out = dict(row)
    for key, value in row.items():
        for fn_name, short in scorer_column.items():
            if key == f"{fn_name}_value":
                out[f"{short}_value"] = value
    return out


def run_chalk(suites: list[str], cases: list[dict[str, Any]], origin: str, timeout: float) -> int:
    from chalkcompute import DatasetClient, Evaluation, EvaluationRunStatus

    from . import chalk_app

    started = iso_now()
    datasets = DatasetClient()
    all_rows: list[dict[str, Any]] = []
    details: dict[str, Any] = {"runs": [], "datasetOrigin": origin}
    run_ids: list[str] = []
    for suite in suites:
        rows = [to_row(c) for c in cases if c["suite"] == suite]
        if not rows:
            print(f"SKIP {suite}: no cases")
            continue
        revision = datasets.upload(f"dennis-eval-{suite}", rows)
        evaluation = Evaluation.create(
            EVAL_NAMES[suite],
            dataset=revision,
            task=chalk_app.dennis_task,
            scorers=chalk_app.SCORERS_BY_SUITE[suite],
            metadata={"suite": suite, "datasetOrigin": origin},
        )
        run = evaluation.run(metadata={"suite": suite}).wait(timeout=timeout, raise_on_failure=False)
        entry = {"suite": suite, "evaluationId": evaluation.id, "runId": run.id, "status": run.status.value,
                 "error": run.error_message}
        details["runs"].append(entry)
        print(f"{suite}: run {run.id} {run.status.value}")
        if run.status != EvaluationRunStatus.SUCCEEDED or run.result_dataset is None:
            continue
        table = datasets.read(run.result_dataset)
        result_rows = [_normalize_result_row(r, chalk_app.SCORER_COLUMN) for r in table.to_pylist()]
        details[f"rows_{suite}"] = result_rows
        all_rows.extend(result_rows)
        run_ids.append(run.id)
    if not run_ids:
        print("FAIL no Chalk run SUCCEEDED; no chalk report written", file=sys.stderr)
        write_report({"provider": "local", "note": "chalk attempt failed"}, "chalk-attempt", details)
        return 2
    report = build_report(provider="chalk", run_id="+".join(run_ids), started_at=started, finished_at=iso_now(),
                          rows=all_rows, dashboard_url=os.environ.get("CHALK_DASHBOARD_URL") or None,
                          dataset_origin=origin)
    path = write_report(report, "chalk", details)
    print(f"PASS chalk report {path}")
    return 0


def run_local(suites: list[str], cases: list[dict[str, Any]], origin: str) -> int:
    """Same task code, executed in this process (real LLM). Labeled local, never chalk."""
    from .tasks import run_case_json
    from .scorers import category_match, decision_match, no_leak

    started = iso_now()
    rows: list[dict[str, Any]] = []
    for c in cases:
        if c["suite"] not in suites:
            continue
        row = to_row(c)
        row["output"] = run_case_json(row["suite"], row["text_a"], row["text_b"])
        row["decision_match_value"] = decision_match(row["output"], row["expected_decision"])
        row["category_match_value"] = category_match(row["output"], row["expected_category"])
        row["no_leak_value"] = no_leak(row["output"], row["must_not_leak"])
        rows.append(row)
        print(f"{row['case_id']}: {json.loads(row['output'])['decision']} (expected {row['expected_decision']})")
    report = build_report(provider="local", run_id=f"local-{uuid.uuid4().hex[:12]}", started_at=started,
                          finished_at=iso_now(), rows=rows, dashboard_url=None, dataset_origin=origin)
    path = write_report(report, "local-python", {"rows": rows})
    print(f"PASS local report {path} (LOCAL RUN, NOT CHALK)")
    return 0


def run_fixture(fixture: Path) -> int:
    rows = json.loads(fixture.read_text(encoding="utf-8"))
    report = build_report(provider="local", run_id=f"fixture-{fixture.stem}", started_at=iso_now(),
                          finished_at=iso_now(), rows=rows, dashboard_url=None, dataset_origin="fixture")
    path = write_report(report, "local-fixture")
    print(f"PASS fixture report {path} (LOCAL RUN, NOT CHALK)")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="dennis_eval.run")
    p.add_argument("--suite", default="all")
    p.add_argument("--provider", choices=["chalk", "local-run", "local-fixture"], default="chalk")
    p.add_argument("--cases", choices=["auto", "shared", "starter"], default="auto")
    p.add_argument("--fixture", type=Path, default=Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "result_rows.json")
    p.add_argument("--timeout", type=float, default=900.0)
    args = p.parse_args(argv)
    if args.provider == "local-fixture":
        return run_fixture(args.fixture)
    suites = _suites(args.suite)
    cases, origin = load_cases(args.cases)
    print(f"{len(cases)} cases from {origin}")
    if args.provider == "chalk":
        return run_chalk(suites, cases, origin, args.timeout)
    return run_local(suites, cases, origin)


if __name__ == "__main__":
    raise SystemExit(main())
