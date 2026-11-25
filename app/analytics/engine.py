"""LIFEOS personal analytics engine.

Pure functions over plain data so every formula is unit-testable without a database.

Key definitions
---------------
rate        The headline metric of an activity over a window.
            daily-target activities  -> average per day      (e.g. pages/day)
            weekly-target activities -> total per 7 days     (e.g. gym sessions/week)
            Partial windows (the current week) are pro-rated, so comparisons are fair mid-week.
adherence   How close a value is to its target, 0..1, respecting `direction`.
growth      (current - previous) / previous * 100
improvement growth, sign-adjusted so that positive always means "better"
drawdown    How far the current weekly rate sits below the personal-best weekly rate, in %.
daily index Importance-weighted mean adherence of all active activities on a day (0..1).
"""
from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import date, timedelta

Series = Mapping[date, float]  # daily totals for one activity

HIGHER = "higher_is_better"
LOWER = "lower_is_better"
TARGET = "target_is_best"


# --------------------------------------------------------------------------- types
@dataclass(frozen=True)
class ActivitySpec:
    id: int
    name: str
    category: str
    measurement_type: str  # count | duration | boolean
    unit: str
    target_value: float
    target_period: str  # daily | weekly
    direction: str = HIGHER
    indicator_type: str = "leading"
    importance: int = 3
    created_on: date = date(2000, 1, 1)
    color: str = "#7c8cff"

    @property
    def daily(self) -> bool:
        return self.target_period == "daily"

    @property
    def rate_label(self) -> str:
        return f"{self.unit}/{'day' if self.daily else 'week'}"


@dataclass
class GoalSpec:
    id: int
    title: str
    start_date: date
    target_date: date
    status: str = "active"
    weekly_hours_commitment: float = 0.0
    activity_ids: list[int] = field(default_factory=list)
    metric_activity_id: int | None = None
    metric_target: float | None = None
    milestones_total: int = 0
    milestones_done: int = 0
    milestones_done_dates: list[date] = field(default_factory=list)


# --------------------------------------------------------------------------- dates
def week_start(d: date, start_weekday: int = 0) -> date:
    return d - timedelta(days=(d.weekday() - start_weekday) % 7)


def daterange(start: date, end: date) -> Iterable[date]:
    for i in range((end - start).days + 1):
        yield start + timedelta(days=i)


def month_start(d: date) -> date:
    return d.replace(day=1)


def prev_month_range(d: date) -> tuple[date, date]:
    first = month_start(d)
    last_prev = first - timedelta(days=1)
    return month_start(last_prev), last_prev


# --------------------------------------------------------------------------- core maths
def growth_pct(current: float | None, previous: float | None) -> float | None:
    """Percentage change. None when there's no meaningful baseline."""
    if current is None or previous is None:
        return None
    if previous == 0:
        return 0.0 if current == 0 else None
    return (current - previous) / abs(previous) * 100.0


def adherence(value: float, target: float, direction: str = HIGHER) -> float:
    if target <= 0:
        return 1.0
    if direction == LOWER:
        return 1.0 if value <= target else target / value
    if direction == TARGET:
        return max(0.0, 1.0 - abs(value - target) / target)
    return min(value / target, 1.0)


def improvement_pct(spec: ActivitySpec, current: float | None, previous: float | None) -> float | None:
    """Growth with the sign flipped where needed so positive always means 'better'."""
    if spec.direction == TARGET:
        if current is None or previous is None:
            return None
        a_now = adherence(current, spec.target_value, TARGET)
        a_prev = adherence(previous, spec.target_value, TARGET)
        return growth_pct(a_now, a_prev)
    g = growth_pct(current, previous)
    if g is None:
        return None
    return -g if spec.direction == LOWER else g


def to_hours(spec: ActivitySpec, value: float) -> float:
    if spec.measurement_type != "duration":
        return 0.0
    return value / 60.0 if spec.unit == "minutes" else value


def active_days(spec: ActivitySpec, start: date, end: date) -> int:
    s = max(start, spec.created_on)
    return max(0, (end - s).days + 1)


def window_total(series: Series, start: date, end: date) -> float:
    return sum(v for d, v in series.items() if start <= d <= end)


def rate(spec: ActivitySpec, series: Series, start: date, end: date) -> float | None:
    """Average per day (daily targets) or per week (weekly targets), pro-rated for partial windows."""
    days = active_days(spec, start, end)
    if days == 0:
        return None
    total = window_total(series, max(start, spec.created_on), end)
    per_day = total / days
    return per_day if spec.daily else per_day * 7


def day_score(spec: ActivitySpec, series: Series, d: date, wk_start_day: int = 0) -> float | None:
    """Adherence of one activity on one day. Weekly targets are judged on the rolling 7 days
    ending that day, so twice-a-week activities aren't punished on their rest days."""
    if d < spec.created_on:
        return None
    if spec.daily:
        return adherence(series.get(d, 0.0), spec.target_value, spec.direction)
    r = rate(spec, series, d - timedelta(days=6), d)
    return None if r is None else adherence(r, spec.target_value, spec.direction)


def is_met(spec: ActivitySpec, score: float | None) -> bool:
    """Targets with direction 'target_is_best' (e.g. sleep 8h) count as met within 10%."""
    if score is None:
        return False
    return score >= (0.9 if spec.direction == TARGET else 0.999)


def weighted_mean(pairs: Iterable[tuple[float, float]]) -> float | None:
    num = den = 0.0
    for value, weight in pairs:
        num += value * weight
        den += weight
    return num / den if den else None


def daily_index(specs: list[ActivitySpec], data: Mapping[int, Series], d: date, wsd: int = 0) -> float | None:
    pairs = []
    for s in specs:
        sc = day_score(s, data.get(s.id, {}), d, wsd)
        if sc is not None:
            pairs.append((sc, s.importance))
    return weighted_mean(pairs)


def period_score(spec: ActivitySpec, series: Series, start: date, end: date) -> float | None:
    """Adherence over a window. Daily activities: mean of capped daily scores (overshooting one day
    can't hide a missed day). Weekly activities: adherence of the pro-rated weekly rate."""
    s = max(start, spec.created_on)
    if s > end:
        return None
    if spec.daily:
        scores = [adherence(series.get(d, 0.0), spec.target_value, spec.direction) for d in daterange(s, end)]
        return sum(scores) / len(scores)
    r = rate(spec, series, s, end)
    return None if r is None else adherence(r, spec.target_value, spec.direction)


def target_met(spec: ActivitySpec, series: Series, start: date, end: date) -> bool | None:
    r = rate(spec, series, start, end)
    if r is None:
        return None
    if spec.direction == LOWER:
        return r <= spec.target_value
    if spec.direction == TARGET:
        return adherence(r, spec.target_value, TARGET) >= 0.9
    return r >= spec.target_value - 1e-9


def consistency(spec: ActivitySpec, series: Series, start: date, end: date, wsd: int = 0) -> float | None:
    """Share of days (daily targets) or 7-day blocks (weekly targets) on which the target was met."""
    s = max(start, spec.created_on)
    if s > end:
        return None
    if spec.daily:
        days = list(daterange(s, end))
        met = sum(1 for d in days if is_met(spec, day_score(spec, series, d, wsd)))
        return met / len(days)
    blocks, met, we = 0, 0, end
    while we >= s:
        ok = target_met(spec, series, max(we - timedelta(days=6), s), we)
        if ok is not None:
            blocks += 1
            met += int(ok)
        we -= timedelta(days=7)
    return met / blocks if blocks else None


# --------------------------------------------------------------------------- weekly series, PBs, drawdown
@dataclass
class WeekPoint:
    week_start: date
    week_end: date
    value: float | None


def weekly_rates(spec: ActivitySpec, series: Series, as_of: date, n_weeks: int, wsd: int = 0) -> list[WeekPoint]:
    """Rolling, non-overlapping 7-day windows ending on as_of (oldest first) – always complete weeks."""
    out = []
    for i in range(n_weeks - 1, -1, -1):
        we = as_of - timedelta(days=7 * i)
        ws = we - timedelta(days=6)
        # Historic windows that straddle the activity's creation date are incomplete: pro-rating a
        # single day to a week would fake a personal best, so they're excluded (the latest window is kept).
        if ws < spec.created_on and i > 0:
            out.append(WeekPoint(ws, we, None))
            continue
        out.append(WeekPoint(ws, we, rate(spec, series, ws, we)))
    return out


def _better(spec: ActivitySpec, a: float, b: float) -> bool:
    if spec.direction == LOWER:
        return a < b
    if spec.direction == TARGET:
        return adherence(a, spec.target_value, TARGET) > adherence(b, spec.target_value, TARGET)
    return a > b


def personal_best(spec: ActivitySpec, points: list[WeekPoint]) -> tuple[float | None, date | None]:
    best, when = None, None
    for p in points:
        if p.value is None:
            continue
        if best is None or _better(spec, p.value, best):
            best, when = p.value, p.week_start
    return best, when


def drawdown_pct(spec: ActivitySpec, current: float | None, peak: float | None) -> float | None:
    """<= 0. How far current sits from the personal best (0 = at the peak)."""
    if current is None or peak is None:
        return None
    if spec.direction == TARGET:
        a_now, a_peak = adherence(current, spec.target_value, TARGET), adherence(peak, spec.target_value, TARGET)
        return 0.0 if a_peak == 0 else min(0.0, (a_now - a_peak) / a_peak * 100)
    if spec.direction == LOWER:
        if current <= peak:
            return 0.0
        return -((current - peak) / current * 100) if current else 0.0
    if peak == 0:
        return 0.0
    return min(0.0, (current - peak) / peak * 100)


def drawdown_curve(spec: ActivitySpec, points: list[WeekPoint]) -> list[dict]:
    """Running peak + drawdown per week – the 'equity curve' view of a habit."""
    peak = None
    out = []
    for p in points:
        if p.value is not None and (peak is None or _better(spec, p.value, peak)):
            peak = p.value
        out.append(
            {
                "week_start": p.week_start.isoformat(),
                "value": None if p.value is None else round(p.value, 2),
                "peak": None if peak is None else round(peak, 2),
                "week_end": p.week_end.isoformat(),
                "drawdown": None if p.value is None else round(drawdown_pct(spec, p.value, peak) or 0.0, 1),
            }
        )
    return out


def max_drawdown(curve: list[dict]) -> float | None:
    vals = [c["drawdown"] for c in curve if c["drawdown"] is not None]
    return min(vals) if vals else None


def streak_days(spec: ActivitySpec, series: Series, as_of: date, wsd: int = 0) -> int:
    n, d = 0, as_of
    while d >= spec.created_on:
        if not is_met(spec, day_score(spec, series, d, wsd)):
            break
        n += 1
        d -= timedelta(days=1)
    return n


def overall_streak(specs, data, as_of: date, threshold: float, wsd: int = 0, max_days: int = 3650) -> int:
    n, d = 0, as_of
    while n < max_days:
        idx = daily_index(specs, data, d, wsd)
        if idx is None or idx < threshold:
            break
        n += 1
        d -= timedelta(days=1)
    return n


# --------------------------------------------------------------------------- activity summary
def activity_summary(spec: ActivitySpec, series: Series, as_of: date, wsd: int = 0, history_weeks: int = 52) -> dict:
    ws = as_of - timedelta(days=6)  # rolling "this week" = last 7 days
    prev_ws, prev_we = ws - timedelta(days=7), ws - timedelta(days=1)
    cur = rate(spec, series, ws, as_of)
    prev = rate(spec, series, prev_ws, prev_we)
    points = weekly_rates(spec, series, as_of, history_weeks, wsd)
    curve = drawdown_curve(spec, points)
    pb, pb_week = personal_best(spec, points)
    prior_points = [p for p in points if p.week_start < ws]
    prior_pb, _ = personal_best(spec, prior_points)
    history_len = sum(1 for p in prior_points if p.value is not None)
    new_pb = (
        cur is not None
        and prior_pb is not None
        and history_len >= 3
        and _better(spec, cur, prior_pb)
        and spec.direction != TARGET
    )
    # Three consecutive weekly declines (includes the current week)
    recent = [p.value for p in points[-4:]]
    declining_run = (
        len(recent) == 4
        and all(v is not None for v in recent)
        and all((improvement_pct(spec, recent[i + 1], recent[i]) or 0) < 0 for i in range(3))
    )
    return {
        "activity_id": spec.id,
        "name": spec.name,
        "category": spec.category,
        "unit": spec.unit,
        "rate_label": spec.rate_label,
        "indicator_type": spec.indicator_type,
        "direction": spec.direction,
        "color": spec.color,
        "target": spec.target_value,
        "this_week": _r(cur),
        "last_week": _r(prev),
        "growth_pct": _r(growth_pct(cur, prev), 1),
        "improvement_pct": _r(improvement_pct(spec, cur, prev), 1),
        "on_target": target_met(spec, series, ws, as_of),
        "week_score": _r(period_score(spec, series, ws, as_of), 3),
        "consistency_4w": _r(consistency(spec, series, as_of - timedelta(days=27), as_of, wsd), 3),
        "streak": streak_days(spec, series, as_of, wsd) if spec.daily else None,
        "personal_best": _r(pb),
        "personal_best_week": pb_week.isoformat() if pb_week else None,
        "new_personal_best": bool(new_pb),
        "drawdown_pct": _r(drawdown_pct(spec, cur, pb), 1),
        "max_drawdown_pct": _r(max_drawdown(curve), 1),
        "declining_3_weeks": bool(declining_run),
        "hours_this_week": _r(to_hours(spec, window_total(series, ws, as_of)), 2),
        "curve": curve,
    }


def _r(x: float | None, nd: int = 2) -> float | None:
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return None
    return round(x, nd)


# --------------------------------------------------------------------------- alerts
def build_alerts(summaries: list[dict], threshold: float, goal_events: list[dict] | None = None) -> list[dict]:
    """Improving / Declining / At risk / Milestone – with context so healthy dips aren't punished."""
    alerts = []
    for s in summaries:
        imp = s["improvement_pct"]
        if s["new_personal_best"]:
            alerts.append(_alert("milestone", f"{s['name']} hit a new personal best: "
                                 f"{_fmt(s['this_week'])} {s['rate_label']}.", s))
        if s["declining_3_weeks"] and not s["on_target"]:
            alerts.append(_alert("at_risk", f"{s['name']} has declined for three consecutive weeks.", s))
            continue
        dd = s["drawdown_pct"]
        if dd is not None and dd <= -20 and not s["on_target"] and (imp is None or imp <= 0):
            alerts.append(_alert("at_risk", f"{s['name']} is in a {abs(dd):.0f}% drawdown from its personal best "
                                 f"({_fmt(s['personal_best'])} {s['rate_label']}).", s))
            continue
        if imp is None:
            continue
        if imp >= threshold:
            alerts.append(_alert("improving", f"{s['name']} improved {imp:+.0f}% vs last week.", s))
        elif imp <= -threshold:
            if s["on_target"]:
                alerts.append(_alert("info", f"{s['name']} slipped {abs(imp):.0f}% vs last week but is still on target. "
                                     "A lighter week can be healthy.", s))
            else:
                alerts.append(_alert("declining", f"{s['name']} decreased {abs(imp):.0f}% vs last week.", s))
    for ev in goal_events or []:
        alerts.append({"kind": "milestone", "message": ev["message"], "activity_id": None, "category": ev.get("category")})
    order = {"at_risk": 0, "declining": 1, "milestone": 2, "improving": 3, "info": 4}
    return sorted(alerts, key=lambda a: order.get(a["kind"], 9))


def _alert(kind: str, message: str, s: dict) -> dict:
    return {"kind": kind, "message": message, "activity_id": s["activity_id"], "category": s["category"]}


def _fmt(x: float | None) -> str:
    if x is None:
        return "–"
    return f"{x:,.0f}" if abs(x) >= 10 else f"{x:,.1f}"


# --------------------------------------------------------------------------- categories & dashboard
def category_scores(specs, data, start: date, end: date) -> dict[str, float]:
    by_cat: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for s in specs:
        sc = period_score(s, data.get(s.id, {}), start, end)
        if sc is not None:
            by_cat[s.category].append((sc, s.importance))
    return {c: round(weighted_mean(p) or 0.0, 3) for c, p in sorted(by_cat.items())}


def hours_by_category(specs, data, start: date, end: date) -> dict[str, float]:
    out: dict[str, float] = defaultdict(float)
    for s in specs:
        if s.measurement_type == "duration":
            out[s.category] += to_hours(s, window_total(data.get(s.id, {}), start, end))
    return {k: round(v, 2) for k, v in sorted(out.items(), key=lambda kv: -kv[1])}


def week_score(specs, data, ws: date, we: date, wsd: int = 0) -> float | None:
    vals = [v for d in daterange(ws, we) if (v := daily_index(specs, data, d, wsd)) is not None]
    return sum(vals) / len(vals) if vals else None


def dashboard(specs: list[ActivitySpec], data: Mapping[int, Series], as_of: date, *, streak_threshold: float,
              growth_threshold: float, wsd: int = 0, goal_events: list[dict] | None = None) -> dict:
    ws = as_of - timedelta(days=6)  # rolling last 7 days vs the 7 before
    prev_ws, prev_we = ws - timedelta(days=7), ws - timedelta(days=1)
    cur_score = week_score(specs, data, ws, as_of, wsd)
    prev_score = week_score(specs, data, prev_ws, prev_we, wsd)

    cons_pairs = []
    for s in specs:
        c = consistency(s, data.get(s.id, {}), ws, as_of, wsd)
        if c is not None:
            cons_pairs.append((c, s.importance))

    daily = []
    for d in daterange(ws, as_of):
        idx = daily_index(specs, data, d, wsd)
        prev_idx = daily_index(specs, data, d - timedelta(days=7), wsd)
        daily.append({"date": d.isoformat(), "index": _r(idx, 3), "previous_week": _r(prev_idx, 3)})

    summaries = [activity_summary(s, data.get(s.id, {}), as_of, wsd, history_weeks=26) for s in specs]
    for s in summaries:
        s.pop("curve", None)

    cur_hours = sum(hours_by_category(specs, data, ws, as_of).values())
    prev_hours = sum(hours_by_category(specs, data, prev_ws, prev_we).values())
    return {
        "as_of": as_of.isoformat(),
        "week_start": ws.isoformat(),
        "week_end": as_of.isoformat(),
        "performance_score": _r(cur_score, 3),
        "previous_performance_score": _r(prev_score, 3),
        "overall_progress_pct": _r(growth_pct(cur_score, prev_score), 1),
        "consistency": _r(weighted_mean(cons_pairs), 3),
        "development_hours": round(cur_hours, 1),
        "development_hours_change_pct": _r(growth_pct(cur_hours, prev_hours), 1),
        "streak_days": overall_streak(specs, data, as_of, streak_threshold, wsd),
        "daily_performance": daily,
        "categories": category_scores(specs, data, ws, as_of),
        "life_balance": life_balance(category_scores(specs, data, as_of - timedelta(days=27), as_of)),
        "alerts": build_alerts(summaries, growth_threshold, goal_events),
        "activities": summaries,
    }


def life_balance(cat_scores: dict[str, float]) -> dict:
    """1 - coefficient of variation across category scores: 1 = perfectly balanced."""
    vals = list(cat_scores.values())
    if len(vals) < 2:
        return {"index": None, "neglected": []}
    mean = sum(vals) / len(vals)
    sd = math.sqrt(sum((v - mean) ** 2 for v in vals) / len(vals))
    idx = 1 - (sd / mean if mean else 1)
    neglected = [c for c, v in cat_scores.items() if v < mean - sd]
    return {"index": _r(max(0.0, idx), 3), "neglected": neglected}


# --------------------------------------------------------------------------- goals
def goal_progress(goal: GoalSpec, specs_by_id: Mapping[int, ActivitySpec], data: Mapping[int, Series],
                  as_of: date, wsd: int = 0) -> dict:
    total_days = max(1, (goal.target_date - goal.start_date).days)
    elapsed = min(max(0, (as_of - goal.start_date).days), total_days)
    time_pct = elapsed / total_days
    out: dict = {
        "time_elapsed_pct": round(time_pct, 3),
        "days_left": max(0, (goal.target_date - as_of).days),
        "milestones_pct": round(goal.milestones_done / goal.milestones_total, 3) if goal.milestones_total else None,
        "metric": None,
    }

    if goal.metric_activity_id and goal.metric_target and goal.metric_activity_id in specs_by_id:
        series = data.get(goal.metric_activity_id, {})
        done = window_total(series, goal.start_date, as_of)
        remaining = max(0.0, goal.metric_target - done)
        lookback_start = max(goal.start_date, as_of - timedelta(days=27))
        lookback_days = (as_of - lookback_start).days + 1
        per_day = window_total(series, lookback_start, as_of) / lookback_days if lookback_days > 0 else 0
        projected = None
        if remaining == 0:
            projected = as_of
        elif per_day > 0:
            projected = as_of + timedelta(days=math.ceil(remaining / per_day))
        weeks_left = max((goal.target_date - as_of).days / 7, 1 / 7)
        spec = specs_by_id[goal.metric_activity_id]
        out["metric"] = {
            "activity_id": spec.id,
            "name": spec.name,
            "unit": spec.unit,
            "current": round(done, 2),
            "target": goal.metric_target,
            "pct": round(min(done / goal.metric_target, 1.0), 3),
            "pace_per_week": round(per_day * 7, 2),
            "required_per_week": round(remaining / weeks_left, 2),
            "projected_completion": projected.isoformat() if projected else None,
        }

    # Linked-activity adherence & hours over the last 4 weeks
    linked = [specs_by_id[i] for i in goal.activity_ids if i in specs_by_id]
    pairs = []
    for s in linked:
        c = consistency(s, data.get(s.id, {}), as_of - timedelta(days=27), as_of, wsd)
        if c is not None:
            pairs.append((c, s.importance))
    out["activity_consistency_4w"] = _r(weighted_mean(pairs), 3)
    ws = as_of - timedelta(days=6)
    out["hours_this_week"] = round(sum(to_hours(s, window_total(data.get(s.id, {}), ws, as_of)) for s in linked), 2)

    # Headline progress & status
    if out["metric"]:
        progress = out["metric"]["pct"]
    elif out["milestones_pct"] is not None:
        progress = out["milestones_pct"]
    else:
        progress = (out["activity_consistency_4w"] or 0) * time_pct
    out["progress_pct"] = round(progress, 3)

    if goal.status == "completed" or progress >= 1:
        status = "completed"
    elif out["metric"] and out["metric"]["projected_completion"]:
        proj = date.fromisoformat(out["metric"]["projected_completion"])
        slack = (goal.target_date - proj).days
        status = "ahead" if slack > 14 else "on_track" if slack >= 0 else "behind"
    elif out["metric"]:
        status = "behind"
    else:
        status = "on_track" if progress >= time_pct - 0.1 else "behind"
    out["status"] = status
    return out


# --------------------------------------------------------------------------- correlations
def pearson(xs: list[float], ys: list[float]) -> float | None:
    n = len(xs)
    if n < 3:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    if sxx == 0 or syy == 0:
        return None
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys, strict=True))
    return sxy / math.sqrt(sxx * syy)


def correlations(specs, data, start: date, end: date, min_days: int = 14, min_abs_r: float = 0.25) -> list[dict]:
    """Same-day correlations between activities (missing day = 0). Correlation ≠ causation."""
    out = []
    for i, a in enumerate(specs):
        for b in specs[i + 1:]:
            s = max(start, a.created_on, b.created_on)
            days = list(daterange(s, end)) if s <= end else []
            if len(days) < min_days:
                continue
            xs = [data.get(a.id, {}).get(d, 0.0) for d in days]
            ys = [data.get(b.id, {}).get(d, 0.0) for d in days]
            r = pearson(xs, ys)
            if r is None or abs(r) < min_abs_r:
                continue
            strength = "strong" if abs(r) >= 0.6 else "moderate" if abs(r) >= 0.4 else "weak"
            more_less = "more" if r > 0 else "less"
            out.append({
                "a": a.name, "b": b.name, "a_id": a.id, "b_id": b.id,
                "r": round(r, 2), "n": len(days), "strength": strength,
                "insight": f"On days you log more {a.name}, you tend to log {more_less} {b.name} ({strength}, r={r:.2f}).",
            })
    return sorted(out, key=lambda c: -abs(c["r"]))[:12]


# --------------------------------------------------------------------------- reports
def period_report(specs, data, start: date, end: date, prev_start: date, prev_end: date, label: str,
                  wsd: int = 0, growth_threshold: float = 10.0) -> dict:
    rows = []
    for s in specs:
        series = data.get(s.id, {})
        cur = rate(s, series, start, end)
        prev = rate(s, series, prev_start, prev_end)
        rows.append({
            "activity_id": s.id, "name": s.name, "category": s.category, "rate_label": s.rate_label,
            "color": s.color, "current": _r(cur), "previous": _r(prev),
            "change_pct": _r(improvement_pct(s, cur, prev), 1),
            "target": s.target_value, "met": target_met(s, series, start, end),
            "score": _r(period_score(s, series, start, end), 3), "importance": s.importance,
        })

    tracked = [r for r in rows if r["met"] is not None]
    achieved = sum(1 for r in tracked if r["met"])
    hours = hours_by_category(specs, data, start, end)
    prev_hours = hours_by_category(specs, data, prev_start, prev_end)
    cats = category_scores(specs, data, start, end)

    cat_changes: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for r in rows:
        if r["change_pct"] is not None:
            cat_changes[r["category"]].append((max(-100.0, min(r["change_pct"], 200.0)), r["importance"]))
    category_change = {c: _r(weighted_mean(p), 1) for c, p in sorted(cat_changes.items())}

    score = week_score(specs, data, start, end, wsd)
    prev_score = week_score(specs, data, prev_start, prev_end, wsd)
    observations = _observations(rows, cats, category_change, hours, specs, data, start, end)
    pct_achieved = achieved / len(tracked) if tracked else None
    score_change = growth_pct(score, prev_score)
    if pct_achieved is None:
        verdict = "Not enough data yet"
    elif (score_change or 0) >= 0 and pct_achieved >= 0.6:
        verdict = "Overall positive"
    elif pct_achieved >= 0.4:
        verdict = "Mixed – some areas need attention"
    else:
        verdict = "Tough period – reset and simplify"

    return {
        "label": label,
        "start": start.isoformat(), "end": end.isoformat(),
        "previous_start": prev_start.isoformat(), "previous_end": prev_end.isoformat(),
        "hours_invested": round(sum(hours.values()), 1),
        "hours_change_pct": _r(growth_pct(sum(hours.values()), sum(prev_hours.values())), 1),
        "targets_achieved_pct": _r(pct_achieved, 3),
        "targets_achieved": achieved, "targets_tracked": len(tracked),
        "performance_score": _r(score, 3), "performance_change_pct": _r(score_change, 1),
        "time_allocation": hours, "category_scores": cats, "category_change_pct": category_change,
        "activities": rows, "observations": observations, "verdict": verdict,
    }


def _observations(rows, cats, cat_change, hours, specs, data, start, end) -> dict:
    obs: dict = {}
    if cats:
        strongest = max(cats.items(), key=lambda kv: kv[1])
        weakest = min(cats.items(), key=lambda kv: kv[1])
        obs["strongest_area"] = f"{strongest[0]} ({strongest[1] * 100:.0f}% of target)"
        obs["needs_attention"] = f"{weakest[0]} ({weakest[1] * 100:.0f}% of target)"
    improvers = [r for r in rows if r["change_pct"] is not None]
    if improvers:
        best = max(improvers, key=lambda r: r["change_pct"])
        worst = min(improvers, key=lambda r: r["change_pct"])
        if best["change_pct"] > 0:
            obs["biggest_improvement"] = f"{best['name']} ({best['change_pct']:+.0f}%)"
        if worst["change_pct"] < 0:
            obs["biggest_decline"] = f"{worst['name']} ({worst['change_pct']:+.0f}%)"
    # Recommendation: close the time gap on the weakest category's duration activities
    if cats:
        weakest_cat = min(cats.items(), key=lambda kv: kv[1])[0]
        gap_h, gaps = 0.0, []
        for s in specs:
            if s.category != weakest_cat or s.direction != HIGHER:
                continue
            r = rate(s, data.get(s.id, {}), start, end) or 0
            shortfall_per_week = max(0.0, s.target_value - r) * (7 if s.daily else 1)
            if shortfall_per_week <= 0:
                continue
            if s.measurement_type == "duration":
                gap_h += to_hours(s, shortfall_per_week)
            else:
                gaps.append(f"{s.name} +{_fmt(shortfall_per_week)} {s.unit}/week")
        if gap_h >= 0.25:
            obs["recommendation"] = (f"Protect {math.ceil(gap_h * 2) / 2:g} additional hour(s) for "
                                     f"{weakest_cat} next week.")
        elif gaps:
            obs["recommendation"] = f"To lift {weakest_cat} next week: {'; '.join(gaps)}."
        else:
            obs["recommendation"] = "Targets met across the board – consider raising one target by 1–5%."
    return obs
