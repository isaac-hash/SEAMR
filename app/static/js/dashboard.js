/* Dashboard – the personal command centre. */
import {
  $, $$, api, calendar, chart, cls, esc, fmt, gradient, idxColor, info, niceDate, pct, setHeader, shortDate, signed, spark,
} from "./core.js";

let catMode = "bars";

export async function renderDashboard() {
  const [d, e] = await Promise.all([api("/dashboard"), api("/explore?days=84")]);
  setHeader(`Last 7 days · ${shortDate(d.week_start)} – ${shortDate(d.as_of)}`, "Your personal performance",
    `<a class="btn" href="#/explore">σ Explore data</a><button class="btn primary" data-quicklog>+ Quick log <kbd>L</kbd></button>`);
  const view = $("#view");
  if (!d.activities.length) {
    view.innerHTML = `<div class="card empty"><h3>Welcome to LIFEOS</h3><p>Create your first measurable activity to start building your personal dataset.</p>
      <a class="btn primary" href="#/track">Add an activity</a></div>`;
    return;
  }
  const H = d.history;
  const streakDots = H.index.slice(-14).map((v, i) => `<i class="sd ${v !== null && v >= 0.7 ? "on" : ""}" data-tip="${esc(`${niceDate(H.dates.slice(-14)[i])}: ${pct(v)}`)}"></i>`).join("");
  const kpi = (label, tipText, value, foot, sparkHtml, valueCls = "") =>
    `<div class="card kpi"><div class="label">${label} ${info(tipText)}</div><div class="kpi-row"><div class="value ${valueCls}">${value}</div><div class="kpi-spark">${sparkHtml}</div></div><div class="foot">${foot}</div></div>`;

  view.innerHTML = `
    <div class="grid kpis">
      ${kpi("Overall progress", "Change in your average daily performance index (importance-weighted target adherence), last 7 days vs the 7 before.",
        signed(d.overall_progress_pct), "performance vs previous 7 days", spark(H.index, { w: 110, h: 34, color: "#7c8cff", min: 0.3, max: 1 }), cls(d.overall_progress_pct))}
      ${kpi("Consistency", "Share of targets hit across the last 7 days, weighted by importance.",
        pct(d.consistency), "of targets hit · last 7 days", spark(H.met.map((m) => m.length), { w: 110, h: 34, color: "#34d399", type: "bar", min: 0 }))}
      ${kpi("Development hours", "Total time logged on duration activities (minutes / hours).",
        `${fmt(d.development_hours, 1)}h`, `<span class="${cls(d.development_hours_change_pct)}">${signed(d.development_hours_change_pct, 0)}</span> vs previous 7 days`, spark(H.hours, { w: 110, h: 34, color: "#4cc9f0", type: "bar", min: 0 }))}
      ${kpi("Current streak", "Consecutive days with a performance index of 70% or more.",
        `${d.streak_days}<small> day${d.streak_days === 1 ? "" : "s"}</small>`, `<div class="streak-dots">${streakDots}</div>`, "")}
    </div>

    <div class="grid two mt">
      <div class="card">
        <div class="card-head"><h2>Daily performance index ${info("Each day scored 0–100% on how well you hit your targets. Dashed = same weekday last week.")}</h2><span class="sub">avg ${pct(d.performance_score)} · prev ${pct(d.previous_performance_score)}</span></div>
        <div class="chart-box"><canvas id="c-daily"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Life categories</h2><div class="seg sm" id="cat-mode"><button data-m="bars">Bars</button><button data-m="radar">Radar</button></div></div>
        <div id="cat-body"></div>
        ${d.life_balance.index !== null ? `<div class="note">Life balance index <b class="mono">${pct(d.life_balance.index)}</b> ${info("1 − coefficient of variation across category scores. 100% = perfectly balanced.")}${d.life_balance.neglected.length ? ` · neglected: <span class="neg">${d.life_balance.neglected.map(esc).join(", ")}</span>` : ""}</div>` : ""}
      </div>
    </div>

    <div class="grid two mt">
      <div class="card">
        <div class="card-head"><h2>Life heatmap · 12 weeks ${info("Every square is a day, coloured by performance index. Click a day to open it in the tracker.")}</h2><a class="sub" href="#/explore">Open in Explore →</a></div>
        <div id="mini-cal" class="cal-scroll"></div>
        <div class="legend"><span>Less</span>${[0.4, 0.65, 0.75, 0.85, 0.93, 0.99].map((v) => `<i style="background:${idxColor(v)}"></i>`).join("")}<span>More</span></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Key findings</h2><a class="sub" href="#/explore">All insights →</a></div>
        <div class="insights compact">${e.insights.slice(0, 4).map((x) => `<div class="insight ${x.kind}"><div class="ico">${{ pattern: "◷", trend: "↗", warning: "!", data: "◌", link: "⇄" }[x.kind] || "•"}</div><div><b>${esc(x.title)}</b><p>${esc(x.text)}</p></div></div>`).join("")}</div>
      </div>
    </div>

    <div class="grid two-even mt">
      <div class="card">
        <div class="card-head"><h2>Performance alerts</h2><div class="seg sm" id="alert-filter"><button data-k="all" class="on">All</button><button data-k="attention">Needs attention</button><button data-k="wins">Wins</button></div></div>
        <div class="alerts" id="alerts"></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Development projects</h2><a class="sub" href="#/goals">View all →</a></div>
        ${d.goals.length ? d.goals.map(goalMini).join("") : `<div class="hint">No active goals. <a href="#/goals">Create one</a>.</div>`}
      </div>
    </div>

    <div class="card mt">
      <div class="card-head"><h2>The 1% improvement table ${info("Last 7 days vs the 7 before. Change is sign-adjusted so green always means better. Click a row for its drawdown curve.")}</h2>
        <input type="search" id="tbl-filter" placeholder="Filter activities…" style="width:200px"></div>
      <div class="table-wrap"><table id="imp-table">
        <thead><tr><th data-sort="name">Activity</th><th>8-week trend</th><th class="num" data-sort="last_week">Prev 7d</th><th class="num" data-sort="this_week">Last 7d</th><th class="num" data-sort="improvement_pct">Change</th><th class="num" data-sort="personal_best">Best</th><th class="num" data-sort="drawdown_pct">Drawdown</th><th class="num" data-sort="consistency_4w">Consistency</th><th>Status</th></tr></thead>
        <tbody></tbody>
      </table></div>
    </div>`;

  // daily chart
  const ctx = $("#c-daily").getContext("2d");
  chart(ctx, {
    type: "line",
    data: { labels: d.daily_performance.map((x) => niceDate(x.date, { weekday: "short", day: "numeric" })),
      datasets: [
        { label: "Last 7 days", data: d.daily_performance.map((x) => x.index && x.index * 100), borderColor: "#7c8cff", backgroundColor: gradient(ctx, "#7c8cff"), fill: true, tension: 0.35, borderWidth: 2.5, pointRadius: 4, pointHoverRadius: 7, pointBackgroundColor: d.daily_performance.map((x) => idxColor(x.index)) },
        { label: "Previous 7 days", data: d.daily_performance.map((x) => x.previous_week && x.previous_week * 100), borderColor: "#5c6478", borderDash: [5, 5], tension: 0.35, borderWidth: 1.5, pointRadius: 0 },
        { label: "Streak line (70%)", data: d.daily_performance.map(() => 70), borderColor: "#34d39955", borderWidth: 1, pointRadius: 0 },
      ] },
    options: { interaction: { mode: "index", intersect: false }, scales: { y: { suggestedMin: 40, max: 100, ticks: { callback: (v) => v + "%" } }, x: { grid: { display: false } } },
      plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.parsed.y, 0)}%` } } },
      onClick: (_, els) => { if (els.length) location.hash = `#/track/${d.daily_performance[els[0].index].date}`; } },
  });

  // categories bars / radar
  const drawCats = () => {
    $$("#cat-mode button").forEach((b) => b.classList.toggle("on", b.dataset.m === catMode));
    const body = $("#cat-body");
    if (catMode === "bars") {
      body.innerHTML = `<div class="bars">${Object.entries(d.categories).sort((a, b) => b[1] - a[1]).map(([c, v]) => {
        const i = d.radar.categories.indexOf(c), prev = i >= 0 ? d.radar.four_weeks_ago[i] : null;
        const delta = prev !== null && prev !== undefined ? (v - prev) * 100 : null;
        return `<div class="bar-row" data-tip="${esc(`${c}: ${pct(v)} of target (last 7 days)\n4 weeks ago: ${pct(prev)}`)}"><span>${esc(c)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.round(v * 100)}%;${v < 0.5 ? "background:linear-gradient(90deg,#ff5c7a,#f5b14c)" : ""}"></div>${prev !== null && prev !== undefined ? `<div class="bar-ghost" style="left:${prev * 100}%"></div>` : ""}</div><span class="num">${pct(v)}</span><span class="num delta ${cls(delta)}">${delta === null ? "" : (delta > 0 ? "▲" : delta < 0 ? "▼" : "") + fmt(Math.abs(delta), 0)}</span></div>`;
      }).join("")}</div><div class="hint" style="margin-top:10px">▏ marker = 4 weeks ago</div>`;
    } else {
      body.innerHTML = `<div class="chart-box short"><canvas id="c-radar-d"></canvas></div>`;
      chart($("#c-radar-d"), { type: "radar",
        data: { labels: d.radar.categories, datasets: [
          { label: "Last 7 days", data: d.radar.now.map((v) => (v ?? 0) * 100), borderColor: "#7c8cff", backgroundColor: "#7c8cff33", borderWidth: 2, pointBackgroundColor: "#7c8cff" },
          { label: "4 weeks ago", data: d.radar.four_weeks_ago.map((v) => (v ?? 0) * 100), borderColor: "#8b93a7", borderDash: [5, 4], backgroundColor: "#0000", pointRadius: 0 }] },
        options: { scales: { r: { min: 0, max: 100, ticks: { display: false }, grid: { color: "#222836" }, angleLines: { color: "#222836" }, pointLabels: { color: "#c8cdd8" } } }, plugins: { legend: { position: "bottom" } } } });
    }
  };
  $$("#cat-mode button").forEach((b) => b.addEventListener("click", () => { catMode = b.dataset.m; drawCats(); }));
  drawCats();

  // mini calendar
  const mc = $("#mini-cal");
  mc.innerHTML = calendar(e.dates, e.daily_index, { colorFn: idxColor, cell: Math.max(11, Math.min(30, Math.floor((mc.clientWidth - 40) / 13) - 4)), gap: 4,
    tipFn: (ds, v) => `${niceDate(ds, { weekday: "long", day: "numeric", month: "short" })}\nPerformance ${pct(v)}` });
  $$(".cal-cell", mc).forEach((r) => r.addEventListener("click", () => (location.hash = `#/track/${r.dataset.date}`)));

  // alerts with filter
  const drawAlerts = (k) => {
    const list = d.alerts.filter((a) => k === "all" || (k === "attention" ? ["at_risk", "declining"].includes(a.kind) : ["improving", "milestone"].includes(a.kind)));
    $("#alerts").innerHTML = list.length ? list.slice(0, 9).map((a) => `<a class="alert" ${a.activity_id ? `href="#/analytics/${a.activity_id}"` : ""}><span class="tag ${a.kind}">${a.kind.replace("_", " ")}</span><span>${esc(a.message)}</span></a>`).join("")
      : `<div class="hint">Nothing here – steady week.</div>`;
  };
  $$("#alert-filter button").forEach((b) => b.addEventListener("click", () => { $$("#alert-filter button").forEach((x) => x.classList.toggle("on", x === b)); drawAlerts(b.dataset.k); }));
  drawAlerts("all");

  // sortable, filterable table
  let sortKey = null, dir = -1;
  const drawTable = () => {
    const q = ($("#tbl-filter").value || "").toLowerCase();
    let rows = d.activities.filter((a) => a.name.toLowerCase().includes(q) || a.category.toLowerCase().includes(q));
    if (sortKey) rows = [...rows].sort((a, b) => (sortKey === "name" ? a.name.localeCompare(b.name) * -dir : ((a[sortKey] ?? -1e9) - (b[sortKey] ?? -1e9)) * dir));
    $("#imp-table tbody").innerHTML = rows.map((a) => `
      <tr class="clickable" data-id="${a.activity_id}">
        <td><span class="dot" style="background:${a.color}"></span>${esc(a.name)} <span class="hint">${a.indicator_type === "lagging" ? "· result" : ""}</span></td>
        <td>${spark(a.spark, { w: 96, h: 24, color: a.color, target: a.target, dots: true })}</td>
        <td class="num">${fmt(a.last_week)}</td>
        <td class="num">${fmt(a.this_week)} <span class="hint">${esc(a.rate_label)}</span></td>
        <td class="num ${cls(a.improvement_pct)}">${signed(a.improvement_pct)}</td>
        <td class="num">${fmt(a.personal_best)}</td>
        <td class="num"><div class="dd-bar" data-tip="${esc(`${fmt(a.drawdown_pct, 1)}% below personal best\nMax drawdown ${fmt(a.max_drawdown_pct, 1)}%`)}"><div style="width:${Math.min(100, Math.abs(a.drawdown_pct || 0))}%"></div></div><span class="${a.drawdown_pct < -0.05 ? "neg" : "neu"}">${a.drawdown_pct === null ? "–" : fmt(a.drawdown_pct, 1) + "%"}</span></td>
        <td class="num">${pct(a.consistency_4w)}</td>
        <td>${statusChip(a)}</td>
      </tr>`).join("");
    $$("#imp-table tr[data-id]").forEach((tr) => tr.addEventListener("click", () => (location.hash = `#/analytics/${tr.dataset.id}`)));
  };
  $("#tbl-filter").addEventListener("input", drawTable);
  $$("#imp-table th[data-sort]").forEach((th) => th.addEventListener("click", () => {
    dir = sortKey === th.dataset.sort ? -dir : -1; sortKey = th.dataset.sort;
    $$("#imp-table th").forEach((x) => x.classList.remove("asc", "desc")); th.classList.add(dir > 0 ? "asc" : "desc"); drawTable();
  }));
  drawTable();
}

export function statusChip(a) {
  if (a.new_personal_best) return `<span class="chip accent">New PB</span>`;
  if (a.on_target) return `<span class="chip green">On target</span>`;
  if (a.drawdown_pct !== null && a.drawdown_pct <= -20) return `<span class="chip amber">In drawdown</span>`;
  return `<span class="chip red">Below target</span>`;
}

export const goalStatusChip = (s) => ({ ahead: `<span class="chip green">Ahead</span>`, on_track: `<span class="chip accent">On track</span>`,
  behind: `<span class="chip red">Behind</span>`, completed: `<span class="chip green">Completed</span>` }[s] || "");

function goalMini(g) {
  const tp = g.time_elapsed_pct * 100;
  return `<a class="goal-mini" href="#/goals">
    <div class="gm-top"><span style="font-weight:600">${esc(g.title)}</span><span>${goalStatusChip(g.status)} <span class="mono" style="margin-left:6px">${pct(g.progress_pct)}</span></span></div>
    <div class="progress dual" data-tip="${esc(`Progress ${pct(g.progress_pct)} · time elapsed ${pct(g.time_elapsed_pct)}`)}"><div style="width:${Math.min(100, g.progress_pct * 100)}%"></div><span class="time-marker" style="left:${tp}%"></span></div>
    <div class="hint" style="margin-top:5px">${g.metric ? `${fmt(g.metric.current, 0)} / ${fmt(g.metric.target, 0)} ${esc(g.metric.unit)} · projected ${g.metric.projected_completion ? niceDate(g.metric.projected_completion, { day: "numeric", month: "short", year: "numeric" }) : "–"}` : "milestone-based"} · ${g.days_left} days left</div>
  </a>`;
}
