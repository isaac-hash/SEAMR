"""Demo dataset: 26 weeks of realistic, deterministic history so every chart has something to show.

Built-in storylines the analytics should detect:
  * French practice trends up, and is better after longer sleep  -> improving + correlation
  * Reading peaked ~4 weeks ago and has slid since                -> drawdown + "at risk"
  * Gym volume keeps rising                                        -> new personal best
  * Sport dropped off over the last two weeks                      -> declining
  * Screen time (lower is better) is falling                       -> improving, sign handled
  * Heavy social-media days are followed by less French           -> next-day (lag-1) effect
"""
from __future__ import annotations

import random
from datetime import date, timedelta

from sqlalchemy.orm import Session

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

WEEKS = 26


def _a(name, category, mtype, unit, target, period, **kw) -> Activity:
    return Activity(name=name, category=category, measurement_type=mtype, unit=unit, target_value=target,
                    target_period=period, **kw)


def seed_demo(db: Session, today: date | None = None) -> None:
    today = today or date.today()
    end = today - timedelta(days=1)  # leave today blank so you can log it yourself
    start = end - timedelta(days=WEEKS * 7 - 1)
    rng = random.Random(42)
    C, D, B = MeasurementType.count, MeasurementType.duration, MeasurementType.boolean
    DAY, WEEK = TargetPeriod.daily, TargetPeriod.weekly

    acts = {
        "reading": _a("Reading", "Reading", C, "pages", 30, DAY, importance=4, color="#f5b14c"),
        "gym": _a("Gym volume", "Fitness", C, "reps", 450, WEEK, importance=4, color="#ff6b6b"),
        "french": _a("French practice", "Language", D, "minutes", 30, DAY, importance=4, color="#4cc9f0"),
        "words": _a("French words learnt", "Language", C, "words", 50, WEEK, importance=3,
                    indicator_type=IndicatorType.lagging, color="#3a86ff"),
        "sport": _a("Football training", "Sport", D, "hours", 5, WEEK, importance=3, color="#2ec4b6"),
        "career": _a("Algo / ML study", "Career", D, "hours", 5, WEEK, importance=5, color="#b388ff"),
        "sleep": _a("Sleep", "Wellbeing", C, "hrs", 8, DAY, importance=3, direction=Direction.target_is_best,
                    color="#8d99ae"),
        "meditation": _a("Meditation", "Wellbeing", D, "minutes", 10, DAY, importance=2, color="#90be6d"),
        "journal": _a("Journaling", "Personal", B, "done", 1, DAY, importance=2, color="#e9c46a"),
        "screen": _a("Social media", "Personal", C, "hrs", 2, DAY, importance=2,
                     direction=Direction.lower_is_better, color="#ef476f"),
    }
    for a in acts.values():
        a.created_on = start
    db.add_all(acts.values())
    db.flush()

    entries: list[Entry] = []

    def add(key: str, d: date, v: float):
        if v > 0:
            entries.append(Entry(activity_id=acts[key].id, date=d, value=round(v, 2)))

    n = (end - start).days + 1
    prev_screen = 2.5
    for i in range(n):
        d = start + timedelta(days=i)
        t = i / (n - 1)
        wd = d.weekday()
        days_left = n - 1 - i

        sleep = max(5.5, min(9.3, rng.gauss(7.3 + 0.3 * t, 0.6)))
        add("sleep", d, sleep)

        # French: trending up, better after longer sleep
        if rng.random() > 0.12:
            # ...and worse the day after heavy social media use (a next-day / lag-1 effect)
            mins = 18 + 22 * t + (sleep - 7.3) * 9 - (prev_screen - 2.0) * 7 + rng.gauss(0, 5)
            add("french", d, max(10, round(mins)))
            add("words", d, max(0, round(mins * 0.3 + rng.gauss(0, 2))))

        # Reading: climbs to a peak around week 8, then slides
        if rng.random() > 0.1:
            peak_t = 0.66
            base = 20 + 18 * (t / peak_t) if t <= peak_t else 38 - 48 * (t - peak_t)
            add("reading", d, max(5, round(base + rng.gauss(0, 4))))

        # Gym: Mon / Thu / Sat, rising volume, PB this week
        if wd in (0, 3, 5) and rng.random() > 0.08:
            add("gym", d, round(115 + 55 * t + rng.gauss(0, 8) + (12 if days_left < 7 else 0)))

        # Football: Wed + Sat, fell off in the last 2 weeks
        if wd in (2, 5):
            if days_left >= 14 or (wd == 5 and rng.random() > 0.4):
                add("sport", d, rng.choice([2, 2.5, 2.5, 3]))

        # Algo / ML study on weekday evenings
        if wd < 5 and rng.random() > 0.35:
            add("career", d, rng.choice([0.75, 1, 1, 1.5, 2]))

        if rng.random() > 0.3:
            add("meditation", d, rng.choice([10, 10, 15, 20]))
        if rng.random() > 0.25:
            add("journal", d, 1)
        prev_screen = max(0.5, rng.gauss(3.0 - 1.3 * t, 0.6))
        add("screen", d, prev_screen)

    db.add_all(entries)

    year_out = start + timedelta(days=365)
    goals = [
        Goal(title="Become conversational in French", category="Language",
             desired_outcome="Hold a 30-minute conversation and pass DELF A2.", start_date=start,
             target_date=year_out, weekly_hours_commitment=4,
             activities=[acts["french"], acts["words"]], metric_activity=acts["words"], metric_target=3200,
             milestones=[
                 Milestone(title="Finish A1 course", target_date=start + timedelta(days=45), done=True,
                           done_on=start + timedelta(days=41)),
                 Milestone(title="10-minute conversation with a tutor", target_date=start + timedelta(days=120), done=True,
                           done_on=start + timedelta(days=128)),
                 Milestone(title="30-minute conversation", target_date=start + timedelta(days=240)),
                 Milestone(title="Pass DELF A2", target_date=year_out),
             ]),
        Goal(title="Increase strength", category="Fitness", desired_outcome="Squat 1.5x bodyweight, bench 80 kg.",
             start_date=start, target_date=start + timedelta(days=330), weekly_hours_commitment=4,
             activities=[acts["gym"]],
             milestones=[
                 Milestone(title="Squat bodyweight", target_date=start + timedelta(days=60), done=True,
                           done_on=start + timedelta(days=55)),
                 Milestone(title="Bench 70 kg", target_date=start + timedelta(days=90), done=True, done_on=end),
                 Milestone(title="Bench 80 kg", target_date=start + timedelta(days=230)),
                 Milestone(title="Squat 1.5x bodyweight", target_date=start + timedelta(days=330)),
             ]),
        Goal(title="Read 24 books", category="Reading", desired_outcome="24 books ≈ 7,200 pages in a year.",
             start_date=start, target_date=year_out, weekly_hours_commitment=3,
             activities=[acts["reading"]], metric_activity=acts["reading"], metric_target=7200,
             milestones=[]),
    ]
    db.add_all(goals)

    last_ws = end - timedelta(days=end.weekday() + 7)
    db.add(Reflection(week_start=last_ws, went_well="Morning French sessions before work stuck.",
                      didnt_go_well="Skipped Saturday football twice – too tired after gym.",
                      adjust_next="Move gym to Friday so Saturday is free for football."))
    db.commit()
