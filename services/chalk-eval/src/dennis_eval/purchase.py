"""Purchase extraction and pair matching for the eval suites.

The prompt file and the thresholds come from packages/purchasing (owned by Agent 2) when present.
The structured fields below are the eval-side extraction shape; the decision logic follows the gate and
matching rules in Sections 10.3 and A2-03/A2-04 of the spec.
"""

from __future__ import annotations

import calendar
import datetime as dt
import math
from typing import Any

from .llm import Llm, LlmError
from .milestone import SchemaError, build_system_prompt, wrap_user_text

TOOL_NAME = "purchase_extraction"
CATEGORIES = ["monitor", "moving_service", "trip", "subscription", "dining", "other"]
TIMEFRAMES = ["this_weekend", "this_week", "this_month", "flexible", "unspecified"]

EXTRACTION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "isPurchaseIntent": {"type": "boolean"},
        "category": {"type": "string", "enum": CATEGORIES},
        "productKey": {"type": "string", "maxLength": 60, "description": "normalized snake_case key such as monitor_27in_4k, or monitor_generic when unspecified"},
        "quantity": {"type": "integer", "minimum": 1, "maximum": 10},
        "budgetMaxDollars": {"type": ["number", "null"], "minimum": 0},
        "timeframe": {"type": "string", "enum": TIMEFRAMES},
        "statedCertainty": {"type": "string", "enum": ["browsing", "considering", "decided"]},
        "regionHint": {"type": ["string", "null"], "maxLength": 40, "description": "city or area named in the message, else null"},
        "sensitive": {"type": "boolean"},
        "injectionAttempt": {"type": "boolean"},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "rationale": {"type": "string", "maxLength": 300},
    },
    "required": [
        "isPurchaseIntent", "category", "productKey", "quantity", "budgetMaxDollars", "timeframe",
        "statedCertainty", "regionHint", "sensitive", "injectionAttempt", "confidence", "rationale",
    ],
}

# Seeded simulated offers (Section 7.5). The eval never claims these are real quotes.
SIM_OFFERS = {"monitor_27in_4k": {"individualCents": 32999, "groupUnitCents": 28499}}
DEFAULT_REGION = "boston-cambridge"
REGION_ALIASES = {"boston": DEFAULT_REGION, "cambridge": DEFAULT_REGION, "somerville": DEFAULT_REGION,
                  "allston": DEFAULT_REGION, "brighton": DEFAULT_REGION}


def validate_extraction(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise SchemaError("not an object")
    extra = set(raw) - set(EXTRACTION_SCHEMA["properties"])
    if extra:
        raise SchemaError(f"unexpected keys: {sorted(extra)}")
    for key in EXTRACTION_SCHEMA["required"]:
        if key not in raw:
            raise SchemaError(f"missing {key}")
    if raw["category"] not in CATEGORIES or raw["timeframe"] not in TIMEFRAMES:
        raise SchemaError("bad enum")
    for key in ["isPurchaseIntent", "sensitive", "injectionAttempt"]:
        if not isinstance(raw[key], bool):
            raise SchemaError(f"{key} must be boolean")
    c = raw["confidence"]
    if isinstance(c, bool) or not isinstance(c, (int, float)) or not 0 <= c <= 1:
        raise SchemaError("bad confidence")
    b = raw["budgetMaxDollars"]
    if b is not None and (isinstance(b, bool) or not isinstance(b, (int, float)) or b < 0):
        raise SchemaError("bad budget")
    return raw


def apply_gates(x: dict[str, Any], gates: dict[str, Any]) -> tuple[str, str | None, str]:
    if x["injectionAttempt"]:
        return "blocked", "policy_blocked", "injection_attempt"
    if gates.get("blockSensitive", True) and x["sensitive"]:
        return "blocked", "sensitive", "sensitive_content"
    if not x["isPurchaseIntent"] or x["statedCertainty"] == "browsing":
        return "no_intent", "not_an_intent", "not_a_purchase_plan"
    if float(x["confidence"]) < float(gates.get("minConfidence", 0.7)):
        return "no_intent", "low_confidence", f"confidence {x['confidence']:.2f}"
    if x["category"] not in gates.get("enabledCategories", ["monitor"]):
        return "no_intent", "category_disabled", f"category_disabled:{x['category']}"
    return "create_intent", None, "passed"


def _extract(text: str, llm: Llm, bundle_prompt: str, gates: dict[str, Any], today: str) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    system = build_system_prompt(bundle_prompt, today=today, timezone="America/New_York", region=DEFAULT_REGION,
                                 enabled=list(gates.get("enabledCategories", ["monitor"])))
    for attempt in range(2):
        try:
            raw = llm.generate(system=system, user=wrap_user_text(text), tool_name=TOOL_NAME, schema=EXTRACTION_SCHEMA)
            x = validate_extraction(raw)
            decision, reason, detail = apply_gates(x, gates)
            return x, {"decision": decision, "category": x["category"] if x["isPurchaseIntent"] else None,
                       "reason": reason, "detail": detail, "productKey": x["productKey"] if decision == "create_intent" else None}
        except SchemaError as exc:
            if attempt == 1:
                return None, {"decision": "no_intent", "category": None, "reason": "schema_invalid", "detail": str(exc), "productKey": None}
        except LlmError as exc:
            return None, {"decision": "no_intent", "category": None, "reason": "llm_unavailable", "detail": str(exc), "productKey": None}
    raise AssertionError("unreachable")


def extract_purchase(text: str, llm: Llm, prompt_md: str, gates: dict[str, Any], *, today: str) -> dict[str, Any]:
    return _extract(text, llm, prompt_md, gates, today)[1]


def resolve_window(kind: str, today: dt.date) -> tuple[dt.date, dt.date] | None:
    """Date range for a timeframe in the demo time zone; None means compatible with any window."""
    if kind in ("flexible", "unspecified"):
        return None
    if kind == "this_weekend":
        sat = today + dt.timedelta(days=(5 - today.weekday()) % 7)
        if today.weekday() == 6:
            sat = today - dt.timedelta(days=1)
        return max(sat, today), sat + dt.timedelta(days=1)
    if kind == "this_week":
        return today, today + dt.timedelta(days=6 - today.weekday())
    last = calendar.monthrange(today.year, today.month)[1]
    return today, today.replace(day=last)


def _region(hint: str | None) -> str:
    if not hint:
        return DEFAULT_REGION
    key = hint.strip().lower()
    return REGION_ALIASES.get(key, key)


def _band(cents: int | None) -> int | None:
    return None if cents is None else int(math.ceil(cents / 2500.0) * 2500)


def is_compatible(a: dict[str, Any], b: dict[str, Any], rules: dict[str, Any], today: dt.date) -> tuple[bool, list[dict[str, Any]]]:
    checks: list[dict[str, Any]] = []
    same = a["productKey"] == b["productKey"]
    generic = rules.get("requireProductMatch") == "same_or_generic" and a["category"] == b["category"] and (
        a["productKey"].endswith("_generic") or b["productKey"].endswith("_generic"))
    product_ok = same or generic
    checks.append({"rule": "product_match", "passed": product_ok, "detail": f"{a['productKey']} vs {b['productKey']}"})
    key = a["productKey"] if not a["productKey"].endswith("_generic") else b["productKey"]
    offer = SIM_OFFERS.get(key)
    checks.append({"rule": "offer_available", "passed": offer is not None, "detail": key})
    budget_ok = True
    if offer is not None:
        for side in (a, b):
            dollars = side["budgetMaxDollars"]
            band = _band(None if dollars is None else int(round(dollars * 100)))
            if band is not None and offer["groupUnitCents"] > band:
                budget_ok = False
        savings = offer["individualCents"] - offer["groupUnitCents"]
        savings_ok = savings >= int(rules.get("minSavingsCents", 1000)) and (
            savings * 100 >= offer["individualCents"] * float(rules.get("minSavingsPercent", 5)))
        checks.append({"rule": "savings_threshold", "passed": savings_ok, "detail": str(savings)})
    checks.append({"rule": "budget_overlap", "passed": budget_ok, "detail": "group price within both budget bands"})
    wa, wb = resolve_window(a["timeframe"], today), resolve_window(b["timeframe"], today)
    if wa is None or wb is None:
        window_ok = True
    else:
        overlap = (min(wa[1], wb[1]) - max(wa[0], wb[0])).days + 1
        window_ok = overlap >= int(rules.get("windowOverlapDays", 1))
    checks.append({"rule": "window_overlap", "passed": window_ok, "detail": f"{a['timeframe']} vs {b['timeframe']}"})
    region_ok = (not rules.get("requireSameRegion", True)) or _region(a["regionHint"]) == _region(b["regionHint"])
    checks.append({"rule": "region_match", "passed": region_ok, "detail": "coarse region"})
    return all(c["passed"] for c in checks), checks


def match_pair(text_a: str, text_b: str, llm: Llm, prompt_md: str, gates: dict[str, Any], rules: dict[str, Any], *, today: str) -> dict[str, Any]:
    xa, ra = _extract(text_a, llm, prompt_md, gates, today)
    xb, rb = _extract(text_b, llm, prompt_md, gates, today)
    if xa is None or xb is None or ra["decision"] != "create_intent" or rb["decision"] != "create_intent":
        return {"decision": "no_match", "category": None, "reason": "intent_missing",
                "detail": f"a={ra['decision']} b={rb['decision']}", "checks": []}
    ok, checks = is_compatible(xa, xb, rules, dt.date.fromisoformat(today))
    failed = [c["rule"] for c in checks if not c["passed"]]
    return {"decision": "match" if ok else "no_match", "category": xa["category"] if ok else None,
            "reason": None if ok else failed[0], "detail": ",".join(failed) or "all_rules_passed", "checks": checks}
