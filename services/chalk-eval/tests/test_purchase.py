import json
import subprocess

import pytest

from dennis_eval.bundle import DEFAULT_MATCHING_RULES, DEFAULT_PURCHASE_GATES, repo_root
from dennis_eval.llm import StubLlm
from dennis_eval.purchase import (
    SYSTEM_PROMPT_FALLBACK,
    apply_gates,
    eval_decision,
    is_compatible,
    match_pair,
    normalize_product_key,
    public_payload,
    resolve_timeframe,
    round_budget_band,
    user_message,
    validate_extraction,
)

BASE = {
    "isPurchaseIntent": True, "subjectOwned": True, "category": "monitor", "productText": "27 inch 4K monitor",
    "productKeyCandidate": "monitor_27in_4k", "quantity": 1, "budgetMaxCents": 35000, "timeframeKind": "this_weekend",
    "statedCertainty": "considering", "sensitive": False, "confidence": 0.9, "rationale": "wants a monitor",
}
TODAY = "2026-10-17"  # a Saturday


def p(**over):
    d = dict(BASE)
    d.update(over)
    return validate_extraction(d)


@pytest.mark.parametrize(
    "over,reason,decision",
    [
        ({}, None, "create_intent"),
        ({"isPurchaseIntent": False}, "not_an_intent", "no_intent"),
        ({"subjectOwned": False}, "not_subject_owned", "no_intent"),
        ({"confidence": 0.69}, "low_confidence", "no_intent"),
        ({"category": "trip"}, "category_disabled", "no_intent"),
        ({"sensitive": True}, "sensitive", "blocked"),
        ({"isPurchaseIntent": False, "sensitive": True}, "not_an_intent", "no_intent"),
    ],
)
def test_gates_in_a2_order(over, reason, decision):
    got, _ = apply_gates(p(**over), DEFAULT_PURCHASE_GATES, ["monitor"])
    assert got == reason and eval_decision(got) == decision


@pytest.mark.parametrize(
    "text,key",
    [
        ("27 inch 4K monitor", "monitor_27in_4k"),
        ('27" 4k display', "monitor_27in_4k"),
        ("4K monitor", "monitor_4k"),
        ("a monitor", "monitor_generic"),
    ],
)
def test_product_key(text, key):
    assert normalize_product_key(p(productText=text, productKeyCandidate="")) == key


@pytest.mark.parametrize(
    "kind,today,expected",
    [
        ("this_weekend", "2026-10-17", ("2026-10-17", "2026-10-18")),
        ("this_weekend", "2026-10-15", ("2026-10-17", "2026-10-18")),
        ("this_weekend", "2026-10-18", ("2026-10-24", "2026-10-25")),
        ("this_week", "2026-10-15", ("2026-10-15", "2026-10-18")),
        ("this_month", "2026-12-05", ("2026-12-05", "2026-12-31")),
        ("flexible", "2026-10-17", ("2026-10-17", "2026-11-16")),
        ("unspecified", "2026-10-17", ("2026-10-17", "2026-10-31")),
    ],
)
def test_timeframe_matches_a2(kind, today, expected):
    w = resolve_timeframe(kind, today)
    assert (w["from"], w["to"]) == expected


def test_budget_band():
    assert round_budget_band(35000) == 35000 and round_budget_band(27600) == 30000 and round_budget_band(None) is None


@pytest.mark.parametrize(
    "a,b,ok,failed",
    [
        ({}, {"productKeyCandidate": "", "productText": "monitor", "budgetMaxCents": None, "timeframeKind": "unspecified"}, True, None),
        ({"productText": "32 inch 4K", "productKeyCandidate": ""}, {}, True, None),
        ({"category": "trip", "productKeyCandidate": "ski_trip"}, {}, False, "product_match"),
        ({"timeframeKind": "this_month"}, {"timeframeKind": "this_weekend"}, True, None),
    ],
)
def test_compatibility(a, b, ok, failed):
    got, checks = is_compatible(public_payload(p(**a), TODAY), public_payload(p(**b), TODAY), DEFAULT_MATCHING_RULES)
    assert got is ok
    if failed:
        assert failed in [c["rule"] for c in checks if not c["passed"]]


def test_pair_over_private_budget_is_no_match():
    def responder(tool, user):
        msg = json.loads(user)["message"]
        return dict(BASE, budgetMaxCents=20000 if "200" in msg else 35000)

    out = match_pair("monitor under $200", "monitor", StubLlm(responder), "sys", DEFAULT_PURCHASE_GATES, DEFAULT_MATCHING_RULES, today=TODAY)
    assert out["decision"] == "no_match" and "a:over_budget" in out["detail"]


def test_pair_demo_matches():
    out = match_pair("a", "b", StubLlm(lambda t, u: dict(BASE)), "sys", DEFAULT_PURCHASE_GATES, DEFAULT_MATCHING_RULES, today=TODAY)
    assert out["decision"] == "match"


def test_pair_needs_two_intents():
    llm = StubLlm(lambda t, u: dict(BASE, isPurchaseIntent="died" not in json.loads(u)["message"]))
    out = match_pair("my monitor died lol", "I need a 4K monitor", llm, "sys", DEFAULT_PURCHASE_GATES, DEFAULT_MATCHING_RULES, today=TODAY)
    assert out["decision"] == "no_match"


def test_user_message_is_js_json():
    assert user_message('a "b"', TODAY, "boston-cambridge", ["monitor"]) == (
        '{"date":"2026-10-17","region":"boston-cambridge","enabledCategories":["monitor"],"recentContext":[],"message":"a \\"b\\""}'
    )


def test_fallback_prompt_matches_live_detector_when_present():
    root = repo_root()
    path = root / "packages/purchasing/src/detector/purchase.ts" if root else None
    if path is None or not path.is_file():
        pytest.skip("purchasing detector not on this checkout yet")
    from dennis_eval.bundle import _purchase_system_prompt

    assert _purchase_system_prompt(root) == SYSTEM_PROMPT_FALLBACK
