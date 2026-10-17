"""EvalReport writer (shape of packages/contracts/src/eval.ts)."""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from typing import Any

from . import DATASET_VERSION
from .bundle import repo_root
from .metrics import compute


def iso_now() -> str:
    now = dt.datetime.now(dt.timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def build_report(*, provider: str, run_id: str, started_at: str, finished_at: str, rows: list[dict[str, Any]],
                 dashboard_url: str | None, dataset_origin: str) -> dict[str, Any]:
    if provider not in ("chalk", "local"):
        raise ValueError("provider must be chalk or local")
    m = compute(rows)
    return {
        "provider": provider,
        "runId": run_id,
        "startedAt": started_at,
        "finishedAt": finished_at,
        "datasetVersion": f"{DATASET_VERSION}-{dataset_origin}",
        "dashboardUrl": dashboard_url,
        "suites": m["suites"],
        "successes": m["successes"],
        "failures": m["failures"],
    }


def eval_dir() -> Path:
    root = repo_root()
    base = root if root is not None else Path.cwd()
    out = base / "data" / "eval"
    out.mkdir(parents=True, exist_ok=True)
    return out


def write_report(report: dict[str, Any], name: str, details: dict[str, Any] | None = None) -> Path:
    out = eval_dir() / f"{name}-latest.json"
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if details is not None:
        (eval_dir() / f"{name}-latest.details.json").write_text(json.dumps(details, indent=2) + "\n", encoding="utf-8")
    return out
