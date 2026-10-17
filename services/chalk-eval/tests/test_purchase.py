import datetime as dt

import pytest

from dennis_eval.bundle import DEFAULT_MATCHING_RULES, DEFAULT_PURCHASE_GATES
from dennis_eval.llm import StubLlm
from dennis_eval.purchase import apply_gates, is_compatible, match_pair, resolve_window, validate_extraction

BASE = {
    "isPurchaseIntent": True, "category": "monitor", "productKey": "monitor_27in_4k", "quantity": 1,
    "budgetMaxDollars": 350, "timeframe": "this_weekend", "statedCertainty": "considering", "regionHint": None,
    "sensitive": False, "injectionAttempt": False, "confidence": 0.9, "rationale": "wants a monitor",
}
TODAY = dt.date(2026, 10, 17)  # a Saturday


def p(**over):
    d = dict(BASE)
    d.update(over)
    return validate_extraction(d)


@pytest.mark.parametrize(
    "over,decision",
    [
        ({}, "create_intent"),
        ({"injectionAttempt": True}, "blocked"),
        ({"sensitive": True}, "blocked"),
        ({"isPurchaseIntent": False}, "no_intent"),
        ({"statedCertainty": "browsing"}, "no_intent"),
        ({"confidence": 0.69}, "no_intent"),
        ({"category": "trip"}, "no_intent"),
    ],
)
def test_purchase_gates(over, decision):
    assert apply_gates(p(**over), DEFAULT_PURCHASE_GATES)[0] == decision


@pytest.mark.parametrize(
    "a,b,ok,failed",
    [
        ({}, {"budgetMaxDollars": None, "productKey": "monitor_generic"}, True, None),
        ({"budgetMaxDollars": 200}, {}, False, "budget_overlap"),
        ({"productKey": "monitor_32in_4k"}, {}, False, "product_match"),
        ({"regionHint": "new york"}, {}, False, "region_match"),
        ({"regionHint": "cambridge"}, {"regionHint": "boston"}, True, None),
        ({"timeframe": "unspecified"}, {}, True, None),
    ],
)
def test_compatibility(a, b, ok, failed):
    got, checks = is_compatible(p(**a), p(**b), DEFAULT_MATCHING_RULES, TODAY)
    assert got is ok
    if failed:
        assert failed in [c["rule"] for c in checks if not c["passed"]]


def test_budget_band_rounds_up():
    # 284.99 group price fits a 275 budget only after rounding up to the 2500-cent band (300.00)
    ok, _ = is_compatible(p(budgetMaxDollars=276), p(), DEFAULT_MATCHING_RULES, TODAY)
    assert ok


def test_windows():
    assert resolve_window("this_weekend", TODAY) == (TODAY, TODAY + dt.timedelta(days=1))
    assert resolve_window("unspecified", TODAY) is None
    assert resolve_window("this_month", TODAY)[1] == dt.date(2026, 10, 31)


def test_match_pair_needs_two_intents():
    llm = StubLlm(lambda t, u: dict(BASE, isPurchaseIntent="monitor died" not in u))
    out = match_pair("my monitor died lol", "I need a 4K monitor", llm, "{today}", DEFAULT_PURCHASE_GATES,
                     DEFAULT_MATCHING_RULES, today=TODAY.isoformat())
    assert out["decision"] == "no_match"
