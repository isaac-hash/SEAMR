from datetime import date, timedelta

import pytest

from app.analytics import engine as eng

MON = date(2026, 11, 2)  # a Monday


def spec(**kw):
    base = dict(id=1, name="Reading", category="Reading", measurement_type="count", unit="pages",
                target_value=30, target_period="daily", created_on=MON - timedelta(days=200))
    base.update(kw)
    return eng.ActivitySpec(**base)


def test_growth_formula_matches_spec():
    # Growth = (Current - Previous) / Previous * 100
    assert eng.growth_pct(22, 20) == pytest.approx(10.0)
    assert eng.growth_pct(5, 6) == pytest.approx(-16.666, rel=1e-3)
    assert eng.growth_pct(0, 0) == 0.0
    assert eng.growth_pct(5, 0) is None


def test_drawdown_example_from_concept_doc():
    # Highest weekly reading average 35 pages/day, current 25 -> -28.6%
    assert eng.drawdown_pct(spec(), 25, 35) == pytest.approx(-28.571, rel=1e-3)
    assert eng.drawdown_pct(spec(), 35, 35) == 0.0


def test_lower_is_better_flips_improvement_sign():
    s = spec(direction=eng.LOWER, target_value=2, unit="hrs")
    assert eng.improvement_pct(s, 1.5, 2.0) == pytest.approx(25.0)
    assert eng.adherence(1.0, 2, eng.LOWER) == 1.0
    assert eng.adherence(4.0, 2, eng.LOWER) == 0.5


def test_target_is_best_tolerance():
    s = spec(direction=eng.TARGET, target_value=8, unit="hrs")
    assert eng.is_met(s, eng.adherence(7.4, 8, eng.TARGET))  # within 10%
    assert not eng.is_met(s, eng.adherence(6.0, 8, eng.TARGET))
    assert eng.adherence(9, 8, eng.TARGET) == pytest.approx(0.875)


def test_rate_daily_average_and_weekly_prorating():
    s = spec()
    series = {MON + timedelta(days=i): 20 for i in range(7)}
    assert eng.rate(s, series, MON, MON + timedelta(days=6)) == 20
    w = spec(target_period="weekly", target_value=3, unit="sessions")
    ser = {MON: 1, MON + timedelta(days=2): 1}
    # 2 sessions in 3 days -> pace of 4.67/week
    assert eng.rate(w, ser, MON, MON + timedelta(days=2)) == pytest.approx(14 / 3)


def test_rate_respects_creation_date():
    s = spec(created_on=MON + timedelta(days=5))
    series = {MON + timedelta(days=5): 30, MON + timedelta(days=6): 30}
    assert eng.rate(s, series, MON, MON + timedelta(days=6)) == 30  # only 2 active days


def test_consistency_and_streak():
    s = spec()
    series = {MON + timedelta(days=i): (30 if i != 2 else 10) for i in range(7)}
    end = MON + timedelta(days=6)
    assert eng.consistency(s, series, MON, end) == pytest.approx(6 / 7)
    assert eng.streak_days(s, series, end) == 4


def test_weekly_activity_not_punished_on_rest_days():
    w = spec(target_period="weekly", target_value=2, unit="sessions", measurement_type="count")
    series = {MON - timedelta(days=4): 1, MON - timedelta(days=1): 1}
    assert eng.day_score(w, series, MON) == 1.0  # rolling 7 days already has 2 sessions


def test_personal_best_and_new_pb_flag():
    s = spec()
    as_of = MON + timedelta(days=34)
    series = {}
    for w in range(5):
        for d in range(7):
            series[as_of - timedelta(days=7 * (4 - w)) - timedelta(days=d)] = 20 + w * 3
    summ = eng.activity_summary(s, series, as_of, history_weeks=8)
    assert summ["this_week"] == 32
    assert summ["personal_best"] == 32
    assert summ["new_personal_best"] is True
    assert summ["drawdown_pct"] == 0


def test_alerts_treat_on_target_dips_as_healthy():
    base = dict(activity_id=1, category="Fitness", rate_label="reps/week", personal_best=100, this_week=80,
                new_personal_best=False, declining_3_weeks=False, drawdown_pct=-5.0)
    healthy = eng.build_alerts([{**base, "name": "Gym", "improvement_pct": -20.0, "on_target": True}], 10)
    bad = eng.build_alerts([{**base, "name": "Gym", "improvement_pct": -20.0, "on_target": False}], 10)
    assert healthy[0]["kind"] == "info"
    assert bad[0]["kind"] == "declining"


def test_goal_forecast_projects_completion():
    s = spec(id=7, target_period="daily", target_value=30)
    as_of = MON + timedelta(days=27)
    series = {MON + timedelta(days=i): 30 for i in range(28)}
    g = eng.GoalSpec(id=1, title="Read", start_date=MON, target_date=MON + timedelta(days=365),
                     metric_activity_id=7, metric_target=3000, activity_ids=[7])
    p = eng.goal_progress(g, {7: s}, {7: series}, as_of)
    assert p["metric"]["current"] == 840
    # 2160 remaining at 30/day = 72 days
    assert p["metric"]["projected_completion"] == (as_of + timedelta(days=72)).isoformat()
    assert p["status"] == "ahead"


def test_pearson_and_correlations():
    assert eng.pearson([1, 2, 3, 4], [2, 4, 6, 8]) == pytest.approx(1.0)
    a, b = spec(id=1, name="Sleep"), spec(id=2, name="French")
    days = [MON + timedelta(days=i) for i in range(20)]
    data = {1: {d: 6 + (i % 3) for i, d in enumerate(days)}, 2: {d: 10 * (6 + (i % 3)) for i, d in enumerate(days)}}
    out = eng.correlations([a, b], data, days[0], days[-1])
    assert out and out[0]["r"] == pytest.approx(1.0)


def test_life_balance_flags_neglected_area():
    lb = eng.life_balance({"Fitness": 0.9, "Learning": 0.85, "Sport": 0.2, "Reading": 0.8})
    assert "Sport" in lb["neglected"]


def test_partial_creation_week_cannot_fake_a_personal_best():
    w = spec(target_period="weekly", target_value=5, unit="hours", measurement_type="duration",
             created_on=MON + timedelta(days=6))
    as_of = MON + timedelta(days=27)
    series = {MON + timedelta(days=6): 2.0, MON + timedelta(days=13): 2.5, MON + timedelta(days=20): 2.5}
    pb, _ = eng.personal_best(w, eng.weekly_rates(w, series, as_of, 8))
    assert pb <= 5  # a single creation day would otherwise pro-rate to 14 h/week


# ----------------------------------------------------------------------------- EDA
from app.analytics import eda  # noqa: E402


def test_eda_stats_helpers():
    xs = sorted([1, 2, 3, 4, 100])
    assert eda.quantile(xs, 0.5) == 3
    assert eda.skewness(xs) > 1  # long right tail
    assert eda.slope([1, 2, 3, 4]) == pytest.approx(1.0)
    h = eda.histogram([1, 2, 2, 3, 3, 3, 4, 4, 4, 4])
    assert sum(h["counts"]) == 10 and len(h["edges"]) == len(h["counts"]) + 1
    m, s = eda.rolling([1, 2, 3, 4, 5, 6, 7, 8], 7)
    assert m[6] == pytest.approx(4.0) and m[7] == pytest.approx(5.0)


def test_eda_finds_planted_lag_effect_and_outlier():
    a = spec(id=1, name="Screen", target_value=2, unit="hrs", category="Personal", direction=eng.LOWER)
    b = spec(id=2, name="French", target_value=30, unit="minutes", category="Language", measurement_type="duration")
    days = [MON + timedelta(days=i) for i in range(60)]
    screen = {d: 1 + (i * 7 % 5) for i, d in enumerate(days)}
    french = {d: 40 - 6 * screen[d - timedelta(days=1)] if i else 30 for i, d in enumerate(days)}
    french[days[30]] = 75  # outlier
    out = eda.explore([a, b], {1: screen, 2: french}, days[0], days[-1])
    lag = out["corr_lag1"]["matrix"][0][1]
    assert lag is not None and lag < -0.5
    assert any(x["activity_id"] == 2 and x["date"] == days[30].isoformat() for x in out["anomalies"])
    assert out["info"]["days"] == 60 and len(out["values"]["1"]) == 60
    assert out["weekday"]["labels"][0] == "Mon"
    assert any(i["title"] == "Next-day effect" for i in out["insights"])
