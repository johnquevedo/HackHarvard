import json
import re
from pathlib import Path

from dennis_eval.dataset import load_cases, to_row
from dennis_eval.metrics import compute, suite_metrics
from dennis_eval.report import build_report, iso_now
from dennis_eval.run import main
from dennis_eval.scorers import category_match, decision_match, no_leak

FIXTURE = Path(__file__).parent / "fixtures" / "result_rows.json"
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")


def row(suite, label, expected, actual, leak=None, out_extra=""):
    output = json.dumps({"decision": actual, "category": None, "question": out_extra})
    return {"case_id": f"{suite}-{label}-{expected}-{actual}", "suite": suite, "label": label, "text_a": "", "text_b": "",
            "expected_decision": expected, "expected_category": "", "must_not_leak": json.dumps(leak or []),
            "note": "", "output": output}


def test_scorers():
    out = json.dumps({"decision": "propose_market", "category": "recruiting", "question": "Will {subject} get it?"})
    assert decision_match(out, "propose_market") == 1.0
    assert decision_match("not json", "propose_market") == 0.0
    assert category_match(out, "recruiting") == 1.0 and category_match(out, "") == 1.0
    assert no_leak(out, json.dumps(["Jane Street"])) == 1.0
    assert no_leak(out, json.dumps(["SUBJECT"])) == 0.0


def test_suite_metrics_counts():
    rows = [
        row("milestone_extraction", "positive", "propose_market", "propose_market"),
        row("milestone_extraction", "positive", "propose_market", "no_market"),
        row("milestone_extraction", "negative", "no_market", "propose_market"),
        row("milestone_extraction", "privacy_restricted", "blocked_policy", "propose_market"),
        row("milestone_extraction", "negative", "no_market", "no_market", leak=["cooked"], out_extra="so cooked"),
    ]
    m = suite_metrics(rows, "milestone_extraction")
    assert m["total"] == 5
    assert m["falsePositives"] == 2
    assert m["precision"] == round(1 / 3, 4)
    assert m["recall"] == 0.5
    assert m["privacyLeaks"] == 2  # restricted case proposed, plus a leaked string


def test_no_predictions_has_perfect_precision():
    m = suite_metrics([row("pair_match", "negative", "no_match", "no_match")], "pair_match")
    assert m["precision"] == 1.0 and m["recall"] == 1.0 and m["falsePositives"] == 0


def test_examples_are_capped():
    rows = [row("pair_match", "negative", "no_match", "no_match") for _ in range(10)]
    for i, r in enumerate(rows):
        r["case_id"] = f"c{i}"
    m = compute(rows)
    assert len(m["successes"]) == 3 and m["failures"] == []


def test_report_shape_matches_eval_report_contract():
    rows = json.loads(FIXTURE.read_text())
    r = build_report(provider="local", run_id="x", started_at=iso_now(), finished_at=iso_now(), rows=rows,
                     dashboard_url=None, dataset_origin="fixture")
    assert set(r) == {"provider", "runId", "startedAt", "finishedAt", "datasetVersion", "dashboardUrl", "suites", "successes", "failures"}
    assert ISO.match(r["startedAt"]) and ISO.match(r["finishedAt"])
    for s in r["suites"]:
        assert set(s) == {"suite", "total", "precision", "recall", "f1", "falsePositives", "privacyLeaks"}
    for e in r["successes"] + r["failures"]:
        assert set(e) == {"caseId", "suite", "label", "expected", "actual", "note"}


def test_report_refuses_unknown_provider():
    import pytest

    with pytest.raises(ValueError):
        build_report(provider="chalk-ish", run_id="x", started_at=iso_now(), finished_at=iso_now(), rows=[],
                     dashboard_url=None, dataset_origin="x")


def test_starter_cases_load_and_flatten():
    cases, origin = load_cases("starter")
    assert len(cases) == 10 and origin == "starter"
    assert all(set(to_row(c)) >= {"case_id", "text_a", "text_b", "expected_decision", "must_not_leak"} for c in cases)


def test_fixture_cli_writes_local_report(tmp_path, monkeypatch):
    monkeypatch.setenv("DENNIS_REPO_ROOT", str(tmp_path))
    (tmp_path / "packages").mkdir()
    assert main(["--provider", "local-fixture", "--fixture", str(FIXTURE)]) == 0
    report = json.loads((tmp_path / "data" / "eval" / "local-fixture-latest.json").read_text())
    assert report["provider"] == "local"
