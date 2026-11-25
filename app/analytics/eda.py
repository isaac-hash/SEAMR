"""Life EDA – exploratory data analysis over your own behaviour.

Everything a data scientist would run first on a new dataset, applied to your life:
describe(), missing-data matrix, distributions, rolling stats, day-of-week profiles,
correlation matrix, lagged (next-day) effects, outliers and auto-generated findings.
"""
from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Mapping
from datetime import date, timedelta

from app.analytics import engine as eng

WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


# --------------------------------------------------------------------------- small stats helpers
def mean(xs: list[float]) -> float | None:
    return sum(xs) / len(xs) if xs else None


def std(xs: list[float]) -> float | None:
    if len(xs) < 2:
        return None
    m = sum(xs) / len(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))


def quantile(sorted_xs: list[float], q: float) -> float | None:
    if not sorted_xs:
        return None
    pos = (len(sorted_xs) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    return sorted_xs[lo] + (sorted_xs[hi] - sorted_xs[lo]) * (pos - lo)


def skewness(xs: list[float]) -> float | None:
    n = len(xs)
    s = std(xs)
    if n < 3 or not s:
        return None
    m = sum(xs) / n
    return (n / ((n - 1) * (n - 2))) * sum(((x - m) / s) ** 3 for x in xs)


def slope(ys: list[float]) -> float | None:
    """OLS slope of ys against 0..n-1 (units per day)."""
    n = len(ys)
    if n < 3:
        return None
    mx, my = (n - 1) / 2, sum(ys) / n
    sxx = sum((i - mx) ** 2 for i in range(n))
    return sum((i - mx) * (y - my) for i, y in enumerate(ys)) / sxx if sxx else None


def histogram(xs: list[float], max_bins: int = 12) -> dict:
    if not xs:
        return {"edges": [], "counts": []}
    lo, hi = min(xs), max(xs)
    if lo == hi:
        return {"edges": [lo, hi + 1], "counts": [len(xs)]}
    bins = max(4, min(max_bins, round(math.sqrt(len(xs)))))
    width = (hi - lo) / bins
    counts = [0] * bins
    for x in xs:
        counts[min(int((x - lo) / width), bins - 1)] += 1
    return {"edges": [round(lo + i * width, 3) for i in range(bins + 1)], "counts": counts}


def rolling(xs: list[float], window: int = 7) -> tuple[list[float | None], list[float | None]]:
    means, stds = [], []
    for i in range(len(xs)):
        w = xs[max(0, i - window + 1): i + 1]
        if len(w) < min(window, 3):
            means.append(None)
            stds.append(None)
            continue
        means.append(round(sum(w) / len(w), 3))
        s = std(w)
        stds.append(round(s, 3) if s is not None else None)
    return means, stds


def _r(x, nd=2):
    return None if x is None else round(x, nd)


# --------------------------------------------------------------------------- main entry
def explore(specs: list[eng.ActivitySpec], data: Mapping[int, eng.Series], start: date, end: date,
            wsd: int = 0) -> dict:
    start = max(start, min((s.created_on for s in specs), default=start))
    dates = list(eng.daterange(start, end)) if start <= end else []
    n_days = len(dates)

    def active(s: eng.ActivitySpec, d: date) -> bool:
        return d >= s.created_on

    values: dict[int, list[float | None]] = {}
    filled: dict[int, list[float]] = {}
    for s in specs:
        ser = data.get(s.id, {})
        values[s.id] = [(ser.get(d) if d in ser else None) if active(s, d) else None for d in dates]
        filled[s.id] = [ser.get(d, 0.0) for d in dates if active(s, d)]

    index = [eng.daily_index(specs, data, d, wsd) for d in dates]
    idx_vals = [x for x in index if x is not None]
    idx_roll, _ = rolling([x if x is not None else 0 for x in index])

    describe = [_describe(s, values[s.id], filled[s.id], data.get(s.id, {}), dates, wsd) for s in specs]
    weekday = _weekday_profiles(specs, data, dates, index)
    corr = _corr_matrix(specs, data, dates, lag=0)
    corr_lag = _corr_matrix(specs, data, dates, lag=1)
    lagged = _top_lagged(specs, corr_lag)
    anomalies = _anomalies(specs, values, dates)
    composition = _composition(specs, data, start, end, wsd)
    radar = _radar(specs, data, end)

    rolling_by_id = {}
    for s in specs:
        m, sd = rolling(filled[s.id])
        pad = n_days - len(filled[s.id])
        rolling_by_id[s.id] = {"mean": [None] * pad + m, "std": [None] * pad + sd}

    logged_points = sum(1 for s in specs for v in values[s.id] if v is not None)
    possible = sum(len(filled[s.id]) for s in specs)
    result = {
        "range": {"start": start.isoformat(), "end": end.isoformat(), "days": n_days},
        "dates": [d.isoformat() for d in dates],
        "activities": [_meta(s) for s in specs],
        "values": {str(k): v for k, v in values.items()},
        "rolling": {str(k): v for k, v in rolling_by_id.items()},
        "daily_index": [_r(x, 3) for x in index],
        "daily_index_rolling": idx_roll,
        "info": {
            "days": n_days,
            "activities": len(specs),
            "categories": len({s.category for s in specs}),
            "data_points": logged_points,
            "coverage": _r(logged_points / possible, 3) if possible else None,
            "avg_index": _r(mean(idx_vals), 3),
            "best_index": _r(max(idx_vals), 3) if idx_vals else None,
            "index_trend_per_week": _r((slope(idx_vals) or 0) * 7 * 100, 2) if idx_vals else None,
        },
        "describe": describe,
        "weekday": weekday,
        "corr": corr,
        "corr_lag1": corr_lag,
        "lagged": lagged,
        "anomalies": anomalies,
        "composition": composition,
        "radar": radar,
    }
    result["insights"] = _insights(specs, result)
    return result


def _meta(s: eng.ActivitySpec) -> dict:
    return {"id": s.id, "name": s.name, "category": s.category, "color": s.color, "unit": s.unit,
            "rate_label": s.rate_label, "target": s.target_value, "target_period": s.target_period,
            "direction": s.direction, "measurement_type": s.measurement_type, "indicator_type": s.indicator_type,
            "daily_target": s.target_value if s.daily else round(s.target_value / 7, 3)}


def _describe(s, vals, filled, series, dates, wsd) -> dict:
    logged = sorted(v for v in vals if v is not None)
    active_days = len(filled)
    hit_days = [d for d in dates if d >= s.created_on]
    hits = sum(1 for d in hit_days if eng.is_met(s, eng.day_score(s, series, d, wsd)))
    sl = slope(filled)
    base = mean(filled) or 0
    trend_pct_week = (sl * 7 / base * 100) if (sl is not None and base) else None
    if s.direction == eng.LOWER and trend_pct_week is not None:
        trend_pct_week = -trend_pct_week
    # lag-1 autocorrelation = "momentum": does doing it today predict doing it tomorrow?
    momentum = eng.pearson(filled[:-1], filled[1:]) if len(filled) > 14 else None
    return {
        "activity_id": s.id, "name": s.name, "category": s.category, "color": s.color, "unit": s.unit,
        "n": len(logged), "active_days": active_days,
        "coverage": _r(len(logged) / active_days, 3) if active_days else None,
        "mean": _r(mean(logged)), "std": _r(std(logged)),
        "cv": _r((std(logged) or 0) / mean(logged), 2) if mean(logged) else None,
        "min": _r(logged[0]) if logged else None, "q25": _r(quantile(logged, .25)), "median": _r(quantile(logged, .5)),
        "q75": _r(quantile(logged, .75)), "max": _r(logged[-1]) if logged else None,
        "skew": _r(skewness(logged)), "total": _r(sum(logged)),
        "hit_rate": _r(hits / len(hit_days), 3) if hit_days and s.daily else None,
        "trend_pct_per_week": _r(trend_pct_week, 1),
        "momentum": _r(momentum, 2),
        "hist": histogram(logged),
    }


def _weekday_profiles(specs, data, dates, index) -> dict:
    idx_by = defaultdict(list)
    for d, x in zip(dates, index, strict=True):
        if x is not None:
            idx_by[d.weekday()].append(x)
    acts = {}
    for s in specs:
        by = defaultdict(list)
        ser = data.get(s.id, {})
        for d in dates:
            if d >= s.created_on:
                by[d.weekday()].append(ser.get(d, 0.0))
        means = [mean(by[i]) for i in range(7)]
        top = max((m for m in means if m is not None), default=0)
        acts[str(s.id)] = {
            "mean": [_r(m) for m in means],
            "intensity": [_r(m / top, 3) if (m is not None and top) else 0 for m in means],
            "freq": [_r(sum(1 for v in by[i] if v > 0) / len(by[i]), 3) if by[i] else None for i in range(7)],
        }
    return {"labels": WEEKDAYS, "index": [_r(mean(idx_by[i]), 3) for i in range(7)], "activities": acts}


def _paired(a, b, data, dates, lag):
    s = max(a.created_on, b.created_on)
    ds = [d for d in dates if d >= s]
    xa, xb = data.get(a.id, {}), data.get(b.id, {})
    xs = [xa.get(d, 0.0) for d in ds[: len(ds) - lag]] if lag else [xa.get(d, 0.0) for d in ds]
    ys = [xb.get(d + timedelta(days=lag), 0.0) for d in ds[: len(ds) - lag]] if lag else [xb.get(d, 0.0) for d in ds]
    return xs, ys


def _corr_matrix(specs, data, dates, lag: int) -> dict:
    n = len(specs)
    matrix = [[None] * n for _ in range(n)]
    ns = [[0] * n for _ in range(n)]
    for i, a in enumerate(specs):
        for j, b in enumerate(specs):
            if lag == 0 and j < i:
                matrix[i][j], ns[i][j] = matrix[j][i], ns[j][i]
                continue
            if lag == 0 and i == j:
                matrix[i][j] = 1.0
                continue
            xs, ys = _paired(a, b, data, dates, lag)
            ns[i][j] = len(xs)
            if len(xs) >= 10:
                r = eng.pearson(xs, ys)
                matrix[i][j] = _r(r, 3)
    return {"ids": [s.id for s in specs], "matrix": matrix, "n": ns, "lag": lag}


def _top_lagged(specs, corr_lag, min_abs=0.2) -> list[dict]:
    out = []
    for i, a in enumerate(specs):
        for j, b in enumerate(specs):
            r = corr_lag["matrix"][i][j]
            if i == j or r is None or abs(r) < min_abs:
                continue
            word = "more" if r > 0 else "less"
            out.append({"a_id": a.id, "b_id": b.id, "a": a.name, "b": b.name, "r": r, "n": corr_lag["n"][i][j],
                        "insight": f"After a day with more {a.name}, you log {word} {b.name} the next day (r={r:+.2f})."})
    return sorted(out, key=lambda x: -abs(x["r"]))[:8]


def _anomalies(specs, values, dates, z_cut: float = 2.2) -> list[dict]:
    out = []
    for s in specs:
        logged = [v for v in values[s.id] if v is not None]
        m, sd = mean(logged), std(logged)
        if not sd or len(logged) < 10 or s.measurement_type == "boolean":
            continue
        for d, v in zip(dates, values[s.id], strict=True):
            if v is None:
                continue
            z = (v - m) / sd
            if abs(z) >= z_cut:
                out.append({"activity_id": s.id, "name": s.name, "color": s.color, "date": d.isoformat(),
                            "value": v, "unit": s.unit, "z": round(z, 2), "kind": "high" if z > 0 else "low",
                            "typical": _r(m)})
    return sorted(out, key=lambda a: a["date"], reverse=True)[:16]


def _composition(specs, data, start, end, wsd) -> dict:
    labels, hours, scores = [], defaultdict(list), defaultdict(list)
    cats = sorted({s.category for s in specs})
    ws = eng.week_start(start, wsd)
    while ws <= end:
        we = min(ws + timedelta(days=6), end)
        labels.append(ws.isoformat())
        h = eng.hours_by_category(specs, data, max(ws, start), we)
        sc = eng.category_scores(specs, data, max(ws, start), we)
        for c in cats:
            hours[c].append(h.get(c, 0.0))
            scores[c].append(sc.get(c))
        ws += timedelta(days=7)
    return {"labels": labels, "hours": dict(hours), "scores": dict(scores)}


def _radar(specs, data, end) -> dict:
    now = eng.category_scores(specs, data, end - timedelta(days=6), end)
    before = eng.category_scores(specs, data, end - timedelta(days=34), end - timedelta(days=28))
    cats = sorted(set(now) | set(before))
    return {"categories": cats, "now": [now.get(c) for c in cats], "four_weeks_ago": [before.get(c) for c in cats]}


def _insights(specs, r: dict) -> list[dict]:
    ins = []
    wd = r["weekday"]["index"]
    if any(x is not None for x in wd):
        full = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        pairs = [(full[i], x) for i, x in enumerate(wd) if x is not None]
        best, worst = max(pairs, key=lambda p: p[1]), min(pairs, key=lambda p: p[1])
        ins.append({"kind": "pattern", "title": f"{best[0]}s are your power day",
                    "text": f"Average performance {best[1] * 100:.0f}% on {best[0]}s vs {worst[1] * 100:.0f}% on {worst[0]}s."})
    t = r["info"]["index_trend_per_week"]
    if t is not None:
        ins.append({"kind": "trend" if t >= 0 else "warning", "title": "Overall trajectory",
                    "text": f"Your daily performance index is moving {t:+.1f} pts per week across this period."})
    desc = [d for d in r["describe"] if d["trend_pct_per_week"] is not None and d["n"] >= 7]
    if desc:
        up = max(desc, key=lambda d: d["trend_pct_per_week"])
        if up["trend_pct_per_week"] > 0:
            ins.append({"kind": "trend", "title": f"Fastest-growing: {up['name']}",
                        "text": f"Trending {up['trend_pct_per_week']:+.1f}% per week – compounding nicely."})
        down = min(desc, key=lambda d: d["trend_pct_per_week"])
        if down["trend_pct_per_week"] < -1:
            ins.append({"kind": "warning", "title": f"Fading: {down['name']}",
                        "text": f"Trending {down['trend_pct_per_week']:+.1f}% per week. Worth a look before it becomes a habit."})
    daily_ids = {sp.id for sp in specs if sp.daily}
    cov = [d for d in r["describe"] if d["coverage"] is not None and d["activity_id"] in daily_ids]
    if cov:
        lo = min(cov, key=lambda d: d["coverage"])
        if lo["coverage"] < 0.8:
            ins.append({"kind": "data", "title": "Missing data",
                        "text": f"{lo['name']} is logged on only {lo['coverage'] * 100:.0f}% of days – "
                                "gaps can hide the real trend."})
    mom = [d for d in r["describe"] if d["momentum"] is not None]
    if mom:
        m = max(mom, key=lambda d: d["momentum"])
        if m["momentum"] > 0.2:
            ins.append({"kind": "pattern", "title": f"Momentum habit: {m['name']}",
                        "text": f"Doing it today predicts doing it tomorrow (r={m['momentum']:+.2f}). Protect the chain."})
    ids = r["corr"]["ids"]
    best_pair = None
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            v = r["corr"]["matrix"][i][j]
            a, b = specs[i], specs[j]
            if v is None or a.category == b.category:
                continue  # skip trivially related pairs (French minutes vs French words)
            if best_pair is None or abs(v) > abs(best_pair[2]):
                best_pair = (a.name, b.name, v)
    if best_pair and abs(best_pair[2]) >= 0.25:
        ins.append({"kind": "link", "title": "Strongest cross-area link",
                    "text": f"{best_pair[0]} and {best_pair[1]} move "
                            f"{'together' if best_pair[2] > 0 else 'in opposite directions'} "
                            f"(r={best_pair[2]:+.2f})."})
    if r["lagged"]:
        lg = r["lagged"][0]
        ins.append({"kind": "link", "title": "Next-day effect", "text": lg["insight"]})
    if r["anomalies"]:
        a = r["anomalies"][0]
        ins.append({"kind": "data", "title": "Latest outlier",
                    "text": f"{a['name']} on {date.fromisoformat(a['date']):%a %d %b}: {eng._fmt(a['value'])} {a['unit']} "
                            f"vs typical {eng._fmt(a['typical'])} (z={a['z']:+.1f})."})
    return ins
