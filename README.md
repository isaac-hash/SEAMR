# LIFEOS — treat your life like a performance system

> Don't just feel like you're making progress. Measure it. Analyse it. Improve it by 1% every day.

LIFEOS is a personal analytics engine with a dashboard on top, essentially exploratory data analysis for your own life.
Its core is an **analytics engine** that tells you whether your behaviour is producing measurable improvement,
where your performance is slipping, and what to change.

**v2 adds Life EDA:** an interactive, notebook-style *Explore* page that runs the analysis a data scientist would do first on any new dataset, applied to your life.

This is the **MVP (priorities 1–6)** from the product concept, plus the Explore page:

| # | Feature | Where |
|---|---------|-------|
| 1 | Custom activity tracker (count / duration / done, daily or weekly targets, leading vs lagging, direction, importance) | **Track** |
| 2 | Goals & development projects (outcome, target date, milestones, linked activities, measurable outcome + forecast) | **Goals** |
| 3 | Daily dashboard (progress, consistency, development hours, streak, life categories, alerts) | **Dashboard** |
| 4 | Weekly analytics & charts (equity curve per activity, category trend, correlations) | **Analytics** |
| 5 | 1% improvement + drawdown system (growth %, personal bests, current & max drawdown, context-aware alerts) | **Dashboard / Analytics** |
| 6 | Weekly & monthly reports (day-by-day chart, category scores, time allocation, observations, recommendation, reflection, CSV export) | **Reports** |
| ★ | **Life EDA:** `life.info()`, calendar heatmap with day drill-down, `describe()` with mini histograms, missing-data / intensity matrix, time series with rolling mean ±1σ and outliers, histogram + box plot, weekday heatmap, correlation matrix (same-day and next-day lag) with scatter + OLS drill-down, weekly composition, life-balance radar, z-score outliers, auto-generated insights | **Explore** |

### Interaction & UX
- **Quick log from anywhere:** press <kbd>L</kbd> or the floating **+** button. One-tap chips (+5, +15…) and "Hit target".
- **Keyboard:** <kbd>1</kbd>–<kbd>6</kbd> jump between pages, <kbd>←</kbd>/<kbd>→</kbd> change day on Track, <kbd>?</kbd> shows the shortcuts.
- **Hover tooltips** on every heatmap cell and metric (look for the ⓘ icons), **click-through** everywhere: calendar → day, table row → equity curve, correlation cell → scatter, outlier → highlighted on the chart.
- Sparklines on KPIs, tracker cards and tables; a sortable, filterable improvement table; goal burn-up charts with required path and projection; activity templates.

Phase 2 (calendar integration + intelligent scheduling) and Phase 3 (wellbeing analytics) are shown in the nav as "coming next".

---

## Quick start

### Windows (one click)
1. Install Python 3.11+ (Anaconda works).
2. Unzip, then double-click **`run.bat`**.
   The first run creates a virtual environment and installs dependencies, which takes about a minute. Your browser then opens at **http://127.0.0.1:8000**.

### macOS / Linux
```bash
./run.sh
```

### Docker
```bash
docker compose up --build      # http://localhost:8000, data persisted in a named volume
```

On the first run, LIFEOS loads **26 weeks of realistic demo data** with planted patterns for Explore to find (e.g. heavy social-media days are followed by less French practice the next day) so every chart has something to show.
When you're ready to track your real life, click **Start fresh** in the sidebar. **Reset demo data** brings the demo back.

API docs: **http://127.0.0.1:8000/api/docs**

---

## How the numbers work

All formulas live in `app/analytics/engine.py` as pure functions with unit tests.

| Concept | Definition |
|---|---|
| **Rate** | Headline metric over a window. Daily-target activities → average per day (pages/day). Weekly-target → total per 7 days. Partial windows are pro-rated. |
| **Growth** | `(current − previous) / previous × 100` |
| **Improvement** | Growth with the sign flipped for "lower is better" activities (e.g. social media), so positive always means better. |
| **Adherence** | 0–1 closeness to target. *Higher is better*: `min(value/target, 1)`. *Lower is better*: `1` if under the limit else `target/value`. *Hit the target* (e.g. sleep 8h): `1 − |value−target|/target`, met within 10%. |
| **Daily performance index** | Importance-weighted mean adherence of all active activities that day. Weekly-target activities are judged on the rolling 7 days, so football twice a week isn't punished on rest days. |
| **Consistency** | Share of days (daily targets) or 7-day blocks (weekly targets) where the target was met. |
| **Personal best** | Best rolling 7-day rate in history. The creation week is excluded so a single day can't be pro-rated into a fake PB. |
| **Drawdown** | `(current − personal best) / personal best × 100`, borrowed from trading. Shown with a running-peak "equity curve" and max drawdown. |
| **Streak** | Consecutive days with a performance index ≥ 70% (configurable). |
| **Life balance index** | `1 − coefficient of variation` across category scores. Categories more than 1 SD below the mean are flagged as neglected. |
| **Goal forecast** | Cumulative outcome since the start date, last-28-day pace → projected completion date, compared against the required weekly pace. |
| **Correlations** | Same-day Pearson r between activities over 8 weeks (n ≥ 14, \|r\| ≥ 0.25). These are presented as questions to test, not causes. |

**Not every decrease is bad.** A drop that still meets the target is reported as *info* ("a lighter week can be healthy"), not as *declining*.
*At risk* fires on three consecutive weekly declines, or a drawdown of 20% or more when the activity is below target and not recovering.

The dashboard compares the **last 7 days with the 7 before**, using rolling windows, so it's meaningful on any day of the week.
Reports use **calendar weeks and months**. The weekly report defaults to the last *complete* week.

---

## Project structure

```
app/
  main.py              FastAPI app factory, lifespan (auto-migrate + demo seed), middleware, static UI
  core/config.py       Settings (env vars prefixed LIFEOS_, .env supported)
  db/session.py        SQLAlchemy engine/session (SQLite WAL + FK pragmas)
  models.py            Activity, Entry, Goal, Milestone, Reflection, AppState
  schemas.py           Pydantic v2 request/response models + validation
  analytics/engine.py  The personal analytics engine (pure functions)
  analytics/eda.py     Life EDA: describe, histograms, rolling stats, weekday profiles, corr + lag-1, outliers, insights
  services.py          DB → engine adapters: dashboard, reports, analytics, goal progress
  api/routes.py        REST API (/api/v1)
  ai.py                Optional Claude-powered weekly review
  seed.py              Deterministic 26-week demo dataset with built-in storylines
  static/js/           ES-module frontend: core (viz toolkit), dashboard, explore, track, goals, analytics, reports
  static/vendor/       Chart.js (vendored – works offline)
migrations/            Alembic migrations (applied automatically on start-up)
tests/                 25 tests: engine + EDA formulas + API
```

### API (excerpt)

| Method | Path | Purpose |
|---|---|---|
| GET/POST/PATCH/DELETE | `/api/v1/activities` | Manage measurable activities |
| POST | `/api/v1/entries` | Log a value (`mode: set` replaces the day's value, `add` appends) |
| GET | `/api/v1/track/{date}` | Daily tracker view |
| GET/POST/PATCH/DELETE | `/api/v1/goals`, `/milestones/{id}` | Development projects |
| GET | `/api/v1/dashboard` | KPIs, daily index, categories, alerts, activity summaries, goals |
| GET | `/api/v1/analytics?weeks=12` | Equity curves, drawdowns, category trend, correlations |
| GET | `/api/v1/explore?days=84` | Life EDA payload (`days=0` = all history) |
| GET | `/api/v1/reports/weekly?week_of=` · `/reports/monthly?month_of=` | Reports |
| PUT | `/api/v1/reflections` | Weekly reflection |
| GET | `/api/v1/export/entries.csv` | Export everything |
| POST | `/api/v1/reports/weekly/ai-summary` | AI review (needs API key) |

---

## Configuration

Copy `.env.example` to `.env`. Useful settings:

- `LIFEOS_DATABASE_URL`: SQLite by default; any SQLAlchemy URL works (e.g. Postgres, after adding a driver such as `psycopg`).
- `LIFEOS_STREAK_THRESHOLD`, `LIFEOS_GROWTH_ALERT_PCT`: tune the analytics.
- `LIFEOS_ANTHROPIC_API_KEY`: enables the **✦ AI review** button on weekly reports. Without it, the rule-based observations and recommendation still work.

## Development

```bash
pip install -r requirements-dev.txt
pytest            # 25 tests
ruff check .
alembic revision --autogenerate -m "your change"   # after editing models.py
```

## Roadmap

- **Phase 2:** Google Calendar and Outlook OAuth, free-slot detection, non-negotiable days, smart allocation with approval before syncing, smart rescheduling of missed sessions.
- **Phase 3:** Wellbeing and recovery analytics (training load vs energy, sleep vs learning quality), weekly AI coach.
- **Production hardening:** user accounts and auth (JWT/OAuth), multi-tenant data, Postgres, rate limiting, mobile PWA.
