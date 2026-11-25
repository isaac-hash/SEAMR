"""Service layer: loads data from the DB into the analytics engine's plain structures."""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.analytics import eda
from app.analytics import engine as eng
from app.core.config import get_settings
from app.models import Activity, Entry, Goal


def to_spec(a: Activity) -> eng.ActivitySpec:
    return eng.ActivitySpec(
        id=a.id, name=a.name, category=a.category, measurement_type=a.measurement_type.value,
        unit=a.unit, target_value=a.target_value, target_period=a.target_period.value,
        direction=a.direction.value, indicator_type=a.indicator_type.value, importance=a.importance,
        created_on=a.created_on, color=a.color,
    )


def load_specs(db: Session, include_archived: bool = False) -> list[eng.ActivitySpec]:
    q = select(Activity).order_by(Activity.category, Activity.id)
    if not include_archived:
        q = q.where(Activity.archived.is_(False))
    return [to_spec(a) for a in db.scalars(q)]


def load_series(db: Session, start: date | None = None, end: date | None = None) -> dict[int, dict[date, float]]:
    q = select(Entry.activity_id, Entry.date, func.sum(Entry.value)).group_by(Entry.activity_id, Entry.date)
    if start:
        q = q.where(Entry.date >= start)
    if end:
        q = q.where(Entry.date <= end)
    out: dict[int, dict[date, float]] = defaultdict(dict)
    for aid, d, v in db.execute(q):
        out[aid][d] = float(v)
    return out


def resolve_as_of(db: Session, requested: date | None = None) -> date:
    """Default analysis date: today if anything is logged today, otherwise yesterday,
    so an unlogged morning doesn't drag the numbers down."""
    if requested:
        return requested
    today = date.today()
    has_today = db.scalar(select(func.count()).select_from(Entry).where(Entry.date == today))
    if has_today:
        return today
    any_entry = db.scalar(select(func.count()).select_from(Entry))
    return today - timedelta(days=1) if any_entry else today


def goal_spec(g: Goal) -> eng.GoalSpec:
    done = [m for m in g.milestones if m.done]
    return eng.GoalSpec(
        id=g.id, title=g.title, start_date=g.start_date, target_date=g.target_date, status=g.status.value,
        weekly_hours_commitment=g.weekly_hours_commitment, activity_ids=[a.id for a in g.activities],
        metric_activity_id=g.metric_activity_id, metric_target=g.metric_target,
        milestones_total=len(g.milestones), milestones_done=len(done),
        milestones_done_dates=[m.done_on for m in done if m.done_on],
    )


def load_goals(db: Session) -> list[Goal]:
    q = select(Goal).options(selectinload(Goal.activities), selectinload(Goal.milestones)).order_by(Goal.id)
    return list(db.scalars(q))


def goal_progress(db: Session, goals: list[Goal], as_of: date) -> dict[int, dict]:
    specs = {s.id: s for s in load_specs(db, include_archived=True)}
    data = load_series(db)
    wsd = get_settings().week_start
    return {g.id: eng.goal_progress(goal_spec(g), specs, data, as_of, wsd) for g in goals}


def goal_events(goals: list[Goal], ws: date, as_of: date) -> list[dict]:
    events = []
    for g in goals:
        for m in g.milestones:
            if m.done and m.done_on and ws <= m.done_on <= as_of:
                events.append({"message": f"Milestone reached – {g.title}: {m.title}", "category": g.category})
    return events


def dashboard(db: Session, as_of: date | None = None) -> dict:
    s = get_settings()
    as_of = resolve_as_of(db, as_of)
    specs = load_specs(db)
    data = load_series(db, end=as_of)
    goals = load_goals(db)
    ws = as_of - timedelta(days=6)
    result = eng.dashboard(
        specs, data, as_of, streak_threshold=s.streak_threshold, growth_threshold=s.growth_alert_pct,
        wsd=s.week_start, goal_events=goal_events(goals, ws, as_of),
    )
    hist = recent_history(specs, data, as_of, 28)
    result["history"] = hist
    for summ, sp in zip(result["activities"], specs, strict=True):
        pts = eng.weekly_rates(sp, data.get(sp.id, {}), as_of, 8, s.week_start)
        summ["spark"] = [eng._r(p.value) for p in pts]
    result["radar"] = eda._radar(specs, data, as_of)
    progress = goal_progress(db, goals, as_of)
    result["goals"] = [
        {"id": g.id, "title": g.title, "category": g.category, **progress[g.id]}
        for g in goals if g.status.value == "active"
    ]
    return result


def weekly_report(db: Session, week_of: date | None = None) -> dict:
    s = get_settings()
    as_of = resolve_as_of(db)
    if week_of is None:  # default to the most recent complete week
        cur_ws = eng.week_start(as_of, s.week_start)
        week_of = as_of if as_of == cur_ws + timedelta(days=6) else cur_ws - timedelta(days=7)
    ws = eng.week_start(week_of, s.week_start)
    we = min(ws + timedelta(days=6), as_of) if ws <= as_of else ws + timedelta(days=6)
    prev_ws = ws - timedelta(days=7)
    specs = load_specs(db)
    data = load_series(db, end=we)
    rep = eng.period_report(specs, data, ws, we, prev_ws, prev_ws + timedelta(days=6),
                            label=f"Week of {ws:%d %b %Y}", wsd=s.week_start, growth_threshold=s.growth_alert_pct)
    rep["kind"] = "weekly"
    rep["partial"] = we < ws + timedelta(days=6)
    rep["daily_index"] = [
        {"date": d.isoformat(), "index": eng._r(eng.daily_index(specs, data, d, s.week_start), 3)}
        for d in eng.daterange(ws, we)
    ]
    goals = load_goals(db)
    rep["milestones_reached"] = [e["message"] for e in goal_events(goals, ws, we)]
    return rep


def monthly_report(db: Session, month_of: date | None = None) -> dict:
    s = get_settings()
    as_of = resolve_as_of(db)
    ref = month_of or as_of
    ms = eng.month_start(ref)
    next_ms = (ms.replace(day=28) + timedelta(days=4)).replace(day=1)
    me = min(next_ms - timedelta(days=1), as_of) if ms <= as_of else next_ms - timedelta(days=1)
    prev_start, prev_end = eng.prev_month_range(ms)
    specs = load_specs(db)
    data = load_series(db, end=me)
    rep = eng.period_report(specs, data, ms, me, prev_start, prev_end, label=f"{ms:%B %Y}",
                            wsd=s.week_start, growth_threshold=s.growth_alert_pct)
    rep["kind"] = "monthly"
    rep["partial"] = me < next_ms - timedelta(days=1)
    return rep


def analytics_overview(db: Session, weeks: int = 12) -> dict:
    s = get_settings()
    as_of = resolve_as_of(db)
    specs = load_specs(db)
    data = load_series(db, end=as_of)
    summaries = [eng.activity_summary(sp, data.get(sp.id, {}), as_of, s.week_start, history_weeks=52) for sp in specs]
    for summ in summaries:
        summ["curve"] = summ["curve"][-weeks:]
    return {
        "as_of": as_of.isoformat(),
        "activities": summaries,
        "correlations": eng.correlations(specs, data, as_of - timedelta(days=55), as_of),
        "category_trend": _category_trend(specs, data, as_of, weeks, s.week_start),
    }


def _category_trend(specs, data, as_of: date, weeks: int, wsd: int) -> dict:
    cur = eng.week_start(as_of, wsd)
    labels, series = [], defaultdict(list)
    cats = sorted({sp.category for sp in specs})
    for i in range(weeks - 1, -1, -1):
        ws = cur - timedelta(days=7 * i)
        we = min(ws + timedelta(days=6), as_of)
        labels.append(ws.isoformat())
        scores = eng.category_scores(specs, data, ws, we)
        for c in cats:
            series[c].append(scores.get(c))
    return {"labels": labels, "series": dict(series)}


def explore(db: Session, days: int | None = 84) -> dict:
    """Life EDA over the last `days` days (None = all history)."""
    s = get_settings()
    as_of = resolve_as_of(db)
    specs = load_specs(db)
    start = as_of - timedelta(days=days - 1) if days else date(1970, 1, 1)
    data = load_series(db, end=as_of)
    if not specs:
        return {"range": None, "activities": [], "dates": [], "insights": []}
    return eda.explore(specs, data, start, as_of, s.week_start)


def recent_history(specs, data, as_of: date, days: int = 14) -> dict:
    """Small per-day series for sparklines."""
    dates = [as_of - timedelta(days=i) for i in range(days - 1, -1, -1)]
    wsd = get_settings().week_start
    return {
        "dates": [d.isoformat() for d in dates],
        "index": [eng._r(eng.daily_index(specs, data, d, wsd), 3) for d in dates],
        "hours": [round(sum(eng.to_hours(sp, data.get(sp.id, {}).get(d, 0.0)) for sp in specs), 2) for d in dates],
        "met": [
            [sp.id for sp in specs if sp.daily and eng.is_met(sp, eng.day_score(sp, data.get(sp.id, {}), d, wsd))]
            for d in dates
        ],
    }
