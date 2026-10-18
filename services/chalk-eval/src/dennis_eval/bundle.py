"""Prompts and rules files, loaded from the repository or from a bundle shipped into the Chalk image.

The same prompt files and rules files used by the TypeScript detectors drive the Python tasks, so the
evaluation measures the product's real policy, not a copy of it.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .purchase import SYSTEM_PROMPT_FALLBACK

BUNDLE_FILE = Path(__file__).with_name("_bundle.json")

DEFAULT_MILESTONE_GATES: dict[str, Any] = {
    "minConfidence": 0.65,
    "enabledTemplates": ["recruiting", "dating", "academics", "friend_event", "other"],
    "blockedCategories": [],
    "blockHighSensitivity": False,
    "requireSubjectIsAuthor": True,
    "requireOutcomeUncertain": True,
    "blockThirdPartyExposure": False,
    "redactEmployerNames": False,
}
DEFAULT_PURCHASE_GATES: dict[str, Any] = {
    "minConfidence": 0.7,
    "enabledCategories": ["monitor"],
    "blockSensitive": True,
}
DEFAULT_MATCHING_RULES: dict[str, Any] = {
    "minSavingsCents": 1000,
    "minSavingsPercent": 5,
    "windowOverlapDays": 1,
    "requireSameRegion": True,
    "requireProductMatch": "same_or_generic",
}



def repo_root() -> Path | None:
    env = os.environ.get("DENNIS_REPO_ROOT")
    if env:
        return Path(env)
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "packages").is_dir() and (parent / "services").is_dir():
            return parent
    return None


def _read_text(root: Path | None, rel: str) -> str | None:
    if root is None:
        return None
    path = root / rel
    return path.read_text(encoding="utf-8") if path.is_file() else None


def _read_json(root: Path | None, rel: str, default: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    raw = _read_text(root, rel)
    if raw is None:
        return dict(default), False
    merged = dict(default)
    merged.update(json.loads(raw))
    return merged, True


@dataclass
class Bundle:
    milestone_prompt: str
    quip_prompt: str | None
    purchase_prompt: str
    milestone_gates: dict[str, Any]
    purchase_gates: dict[str, Any]
    matching_rules: dict[str, Any]
    sources: dict[str, str] = field(default_factory=dict)

    def to_json(self) -> str:
        return json.dumps(self.__dict__, sort_keys=True)

    @staticmethod
    def from_json(raw: str) -> "Bundle":
        return Bundle(**json.loads(raw))


def load_bundle() -> Bundle:
    """Load from the repository when available; otherwise from the shipped bundle file."""
    root = repo_root()
    milestone_prompt = _read_text(root, "packages/shortme/prompts/milestone_detector_v1.md")
    if milestone_prompt is None and BUNDLE_FILE.is_file():
        return Bundle.from_json(BUNDLE_FILE.read_text(encoding="utf-8"))
    if milestone_prompt is None:
        raise FileNotFoundError("milestone_detector_v1.md not found and no bundle shipped")
    purchase_prompt = _purchase_system_prompt(root)
    milestone_gates, mg = _read_json(root, "packages/shortme/rules/milestone-gates.json", DEFAULT_MILESTONE_GATES)
    purchase_gates, pg = _read_json(root, "packages/purchasing/rules/purchase-gates.json", DEFAULT_PURCHASE_GATES)
    matching_rules, mr = _read_json(root, "packages/purchasing/rules/matching-rules.json", DEFAULT_MATCHING_RULES)
    return Bundle(
        milestone_prompt=milestone_prompt,
        quip_prompt=_read_text(root, "packages/shortme/prompts/quip_v1.md"),
        purchase_prompt=purchase_prompt or SYSTEM_PROMPT_FALLBACK,
        milestone_gates=milestone_gates,
        purchase_gates=purchase_gates,
        matching_rules=matching_rules,
        sources={
            "purchase_prompt": "repo" if purchase_prompt else "fallback",
            "milestone_gates": "repo" if mg else "default",
            "purchase_gates": "repo" if pg else "default",
            "matching_rules": "repo" if mr else "default",
        },
    )


def _purchase_system_prompt(root: Path | None) -> str | None:
    """The live purchase detector keeps its system prompt inline in purchase.ts; read that exact text."""
    src = _read_text(root, "packages/purchasing/src/detector/purchase.ts")
    if src is None:
        return None
    m = re.search(r"const SYSTEM_PROMPT = `([^`]*)`;", src)
    return m.group(1) if m else None


def write_bundle_file(bundle: Bundle) -> Path:
    """Write the bundle next to this module so the Chalk image carries it."""
    BUNDLE_FILE.write_text(bundle.to_json(), encoding="utf-8")
    return BUNDLE_FILE
