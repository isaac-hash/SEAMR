"""REST API – mounted at /api/v1."""
from __future__ import annotations

import csv
import io
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app import services
from app.ai import ai_weekly_summary
from app.analytics import engine as eng
from app.core.config import get_settings
from app.db.session import get_db
from app.models import (
    Activity,
    Direction,
    Entry,
    Goal,
    IndicatorType,
    MeasurementType,
    Milestone,
    Reflection,
    TargetPeriod,
)
from app.schemas import (
    ActivityCreate,
    ActivityOut,
    ActivityUpdate,
    DayActivity,
    DayLog,
    EntryCreate,
    EntryOut,
    GoalCreate,
    GoalOut,
    GoalUpdate,
    MilestoneIn,
    MilestoneOut,
    ReflectionIn,
    ReflectionOut,
)

router = APIRouter()
DB = Depends(get_db)

SUGGESTED_CATEGORIES = ["Fitness", "Learning", "Language", "Reading", "Sport", "Career", "Wellbeing", "Personal"]


def _get_or_404(db: Session, model, obj_id: int):
    obj = db.get(model, obj_id)
    if not obj:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{model.__name__} {obj_id} not found")
    return obj


# ------------------------------------------------------------------ meta
@router.get("/meta", tags=["meta"])
def meta():
    return {
        "categories": SUGGESTED_CATEGORIES,
        "measurement_types": [m.value for m in MeasurementType],
        "target_periods": [p.value for p in TargetPeriod],
        "directions": [d.value for d in Direction],
        "indicator_types": [i.value for i in IndicatorType],
        "ai_enabled": bool(get_settings().anthropic_api_key),
        "today": date.today().isoformat(),
    }


# ------------------------------------------------------------------ activities
@router.get("/activities", response_model=list[ActivityOut], tags=["activities"])
def list_activities(include_archived: bool = False, db: Session = DB):
    q = select(Activity).order_by(Activity.category, Activity.id)
    if not include_archived:
        q = q.where(Activity.archived.is_(False))
    return list(db.scalars(q))


@router.post("/activities", response_model=ActivityOut, status_code=201, tags=["activities"])
def create_activity(body: ActivityCreate, db: Session = DB):
    a = Activity(**body.model_dump(), created_on=date.today())
    db.add(a)
    db.commit()
    db.refresh(a)
    return a


@router.patch("/activities/{activity_id}", response_model=ActivityOut, tags=["activities"])
def update_activity(activity_id: int, body: ActivityUpdate, db: Session = DB):
    a = _get_or_404(db, Activity, activity_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(a, k, v)
    db.commit()
    db.refresh(a)
    return a


@router.delete("/activities/{activity_id}", status_code=204, tags=["activities"])
def delete_activity(activity_id: int, db: Session = DB):
    """Permanently deletes an activity and its history. Prefer PATCH archived=true."""
    db.delete(_get_or_404(db, Activity, activity_id))
    db.commit()
    return Response(status_code=204)


# ------------------------------------------------------------------ entries & daily tracker
@router.post("/entries", response_model=EntryOut, tags=["entries"])
def log_entry(body: EntryCreate, db: Session = DB):
    a = _get_or_404(db, Activity, body.activity_id)
    if body.date > date.today():
        raise HTTPException(422, "Can't log entries in the future")
    value = min(body.value, 1.0) if a.measurement_type == MeasurementType.boolean else body.value
    existing = list(db.scalars(select(Entry).where(Entry.activity_id == a.id, Entry.date == body.date)))
    if body.mode == "set":
        for e in existing:
            db.delete(e)
        entry = Entry(activity_id=a.id, date=body.date, value=value, note=body.note)
        db.add(entry)
    else:
        if existing:
            entry = existing[0]
            entry.value = min(entry.value + value, 1.0) if a.measurement_type == MeasurementType.boolean else entry.value + value
            if body.note:
                entry.note = body.note
        else:
            entry = Entry(activity_id=a.id, date=body.date, value=value, note=body.note)
            db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.get("/entries", response_model=list[EntryOut], tags=["entries"])
def list_entries(activity_id: int | None = None, start: date | None = None, end: date | None = None,
                 limit: int = Query(500, le=5000), db: Session = DB):
    q = select(Entry).order_by(Entry.date.desc(), Entry.id.desc()).limit(limit)
    if activity_id:
        q = q.where(Entry.activity_id == activity_id)
    if start:
        q = q.where(Entry.date >= start)
    if end:
        q = q.where(Entry.date <= end)
    return list(db.scalars(q))


@router.delete("/entries/{entry_id}", status_code=204, tags=["entries"])
def delete_entry(entry_id: int, db: Session = DB):
    db.delete(_get_or_404(db, Entry, entry_id))
    db.commit()
    return Response(status_code=204)


@router.get("/track/{day}", response_model=DayLog, tags=["entries"])
def day_log(day: date, db: Session = DB):
    wsd = get_settings().week_start
    acts = [a for a in db.scalars(select(Activity).where(Activity.archived.is_(False))
                                  .order_by(Activity.category, Activity.id)) if a.created_on <= day]
    ws = eng.week_start(day, wsd)
    data = services.load_series(db, start=min(ws, day - timedelta(days=13)), end=day)
    hist_dates = [day - timedelta(days=i) for i in range(13, -1, -1)]
    rows = []
    for a in acts:
        spec = services.to_spec(a)
        series = data.get(a.id, {})
        val = series.get(day, 0.0)
        wtd = eng.window_total(series, max(ws, a.created_on), day)
        if spec.daily:
            target = spec.target_value
            progress = val / target
            met = eng.adherence(val, target, spec.direction) >= 0.999 and (val > 0 or spec.direction == "lower_is_better")
        else:
            target = spec.target_value
            progress = wtd / target
            met = eng.target_met(spec, series, ws, ws + timedelta(days=6)) or False
        rows.append(DayActivity(activity=ActivityOut.model_validate(a), value=val, target=target,
                                week_to_date=wtd, progress=round(progress, 3), met=bool(met),
                                history=[series.get(d, 0.0) if d >= a.created_on else None for d in hist_dates]))
    return DayLog(date=day, activities=rows, tracked=len(rows), completed=sum(r.met for r in rows))


# ------------------------------------------------------------------ goals
def _goal_out(g: Goal, progress: dict) -> GoalOut:
    return GoalOut(
        id=g.id, title=g.title, category=g.category, desired_outcome=g.desired_outcome,
        start_date=g.start_date, target_date=g.target_date, weekly_hours_commitment=g.weekly_hours_commitment,
        status=g.status, metric_activity_id=g.metric_activity_id, metric_target=g.metric_target,
        activity_ids=[a.id for a in g.activities],
        milestones=[MilestoneOut.model_validate(m) for m in g.milestones], progress=progress,
    )


def _set_activities(db: Session, g: Goal, ids: list[int]):
    acts = list(db.scalars(select(Activity).where(Activity.id.in_(ids)))) if ids else []
    if len(acts) != len(set(ids)):
        raise HTTPException(422, "Unknown activity id in activity_ids")
    g.activities = acts


@router.get("/goals", response_model=list[GoalOut], tags=["goals"])
def list_goals(db: Session = DB):
    goals = services.load_goals(db)
    prog = services.goal_progress(db, goals, services.resolve_as_of(db))
    return [_goal_out(g, prog[g.id]) for g in goals]


@router.post("/goals", response_model=GoalOut, status_code=201, tags=["goals"])
def create_goal(body: GoalCreate, db: Session = DB):
    start = body.start_date or date.today()
    if body.target_date <= start:
        raise HTTPException(422, "target_date must be after start_date")
    if body.metric_activity_id:
        _get_or_404(db, Activity, body.metric_activity_id)
    g = Goal(title=body.title, category=body.category, desired_outcome=body.desired_outcome, start_date=start,
             target_date=body.target_date, weekly_hours_commitment=body.weekly_hours_commitment,
             metric_activity_id=body.metric_activity_id, metric_target=body.metric_target)
    _set_activities(db, g, body.activity_ids)
    g.milestones = [Milestone(title=m.title, target_date=m.target_date) for m in body.milestones]
    db.add(g)
    db.commit()
    return _single_goal(db, g.id)


def _single_goal(db: Session, goal_id: int) -> GoalOut:
    goals = [g for g in services.load_goals(db) if g.id == goal_id]
    if not goals:
        raise HTTPException(404, f"Goal {goal_id} not found")
    prog = services.goal_progress(db, goals, services.resolve_as_of(db))
    return _goal_out(goals[0], prog[goal_id])


@router.patch("/goals/{goal_id}", response_model=GoalOut, tags=["goals"])
def update_goal(goal_id: int, body: GoalUpdate, db: Session = DB):
    g = _get_or_404(db, Goal, goal_id)
    data = body.model_dump(exclude_unset=True)
    if "activity_ids" in data:
        _set_activities(db, g, data.pop("activity_ids") or [])
    for k, v in data.items():
        setattr(g, k, v)
    db.commit()
    return _single_goal(db, goal_id)


@router.delete("/goals/{goal_id}", status_code=204, tags=["goals"])
def delete_goal(goal_id: int, db: Session = DB):
    db.delete(_get_or_404(db, Goal, goal_id))
    db.commit()
    return Response(status_code=204)


@router.post("/goals/{goal_id}/milestones", response_model=MilestoneOut, status_code=201, tags=["goals"])
def add_milestone(goal_id: int, body: MilestoneIn, db: Session = DB):
    _get_or_404(db, Goal, goal_id)
    m = Milestone(goal_id=goal_id, title=body.title, target_date=body.target_date)
    db.add(m)
    db.commit()
    db.refresh(m)
    return m


@router.patch("/milestones/{milestone_id}", response_model=MilestoneOut, tags=["goals"])
def toggle_milestone(milestone_id: int, done: bool, db: Session = DB):
    m = _get_or_404(db, Milestone, milestone_id)
    m.done = done
    m.done_on = date.today() if done else None
    db.commit()
    db.refresh(m)
    return m


@router.delete("/milestones/{milestone_id}", status_code=204, tags=["goals"])
def delete_milestone(milestone_id: int, db: Session = DB):
    db.delete(_get_or_404(db, Milestone, milestone_id))
    db.commit()
    return Response(status_code=204)


# ------------------------------------------------------------------ dashboard / analytics / reports
@router.get("/dashboard", tags=["analytics"])
def dashboard(as_of: date | None = None, db: Session = DB):
    return services.dashboard(db, as_of)


@router.get("/explore", tags=["analytics"])
def explore(days: int = Query(84, ge=0, le=3650, description="0 = all history"), db: Session = DB):
    """Life EDA: describe, missing matrix, distributions, weekday profiles, correlations, lag effects, outliers."""
    return services.explore(db, days or None)


@router.get("/analytics", tags=["analytics"])
def analytics(weeks: int = Query(12, ge=4, le=52), db: Session = DB):
    return services.analytics_overview(db, weeks)


@router.get("/reports/weekly", tags=["reports"])
def weekly_report(week_of: date | None = None, db: Session = DB):
    rep = services.weekly_report(db, week_of)
    r = db.scalar(select(Reflection).where(Reflection.week_start == date.fromisoformat(rep["start"])))
    rep["reflection"] = ReflectionOut.model_validate(r).model_dump(mode="json") if r else None
    return rep


@router.get("/reports/monthly", tags=["reports"])
def monthly_report(month_of: date | None = None, db: Session = DB):
    return services.monthly_report(db, month_of)


@router.post("/reports/weekly/ai-summary", tags=["reports"])
async def weekly_ai_summary(week_of: date | None = None, db: Session = DB):
    s = get_settings()
    if not s.anthropic_api_key:
        raise HTTPException(400, "Set LIFEOS_ANTHROPIC_API_KEY in .env to enable AI summaries")
    rep = services.weekly_report(db, week_of)
    return {"summary": await ai_weekly_summary(rep, s)}


@router.put("/reflections", response_model=ReflectionOut, tags=["reports"])
def save_reflection(body: ReflectionIn, db: Session = DB):
    ws = eng.week_start(body.week_start, get_settings().week_start)
    r = db.scalar(select(Reflection).where(Reflection.week_start == ws))
    if not r:
        r = Reflection(week_start=ws)
        db.add(r)
    r.went_well, r.didnt_go_well, r.adjust_next = body.went_well, body.didnt_go_well, body.adjust_next
    db.commit()
    db.refresh(r)
    return r


# ------------------------------------------------------------------ export / reset
@router.get("/export/entries.csv", tags=["export"])
def export_csv(db: Session = DB):
    acts = {a.id: a for a in db.scalars(select(Activity))}
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["date", "activity", "category", "value", "unit", "target", "target_period", "indicator", "note"])
    for e in db.scalars(select(Entry).order_by(Entry.date, Entry.activity_id)):
        a = acts.get(e.activity_id)
        if a:
            w.writerow([e.date.isoformat(), a.name, a.category, e.value, a.unit, a.target_value,
                        a.target_period.value, a.indicator_type.value, e.note or ""])
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="lifeos_export_{date.today()}.csv"'})


@router.post("/admin/reset-demo", tags=["admin"])
def reset_demo(db: Session = DB):
    """Wipes all data and re-seeds the demo dataset."""
    from app.seed import seed_demo

    for model in (Reflection, Milestone, Entry):
        db.execute(delete(model))
    db.execute(delete(Goal))
    db.execute(delete(Activity))
    db.commit()
    seed_demo(db)
    return {"ok": True}


@router.post("/admin/clear", tags=["admin"])
def clear_all(db: Session = DB):
    """Wipes all data so you can start tracking your real life."""
    for model in (Reflection, Milestone, Entry):
        db.execute(delete(model))
    db.execute(delete(Goal))
    db.execute(delete(Activity))
    db.commit()
    return {"ok": True}
