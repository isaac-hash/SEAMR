import { $, $$, addDays, api, chart, cls, esc, fmt, idxColor, info, iso, niceDate, parseISO, pct, setHeader, shortDate, signed, state, toast, today } from "./core.js";

// ================================================================== REPORTS
const reportState = { kind: "weekly", ref: null };
export async function renderReports() {
  const { kind, ref } = reportState;
  const r = kind === "weekly" ? await api(`/reports/weekly${ref ? `?week_of=${ref}` : ""}`) : await api(`/reports/monthly${ref ? `?month_of=${ref}` : ""}`);
  reportState.ref = r.start;
  const range = `${niceDate(r.start, { day: "numeric", month: "short" })} – ${niceDate(r.end, { day: "numeric", month: "short", year: "numeric" })}`;
  setHeader(`LIFEOS · ${kind} report`, kind === "weekly" ? "Your week in review" : "Your month in review",
    `<div class="seg"><button data-k="weekly" class="${kind === "weekly" ? "on" : ""}">Weekly</button><button data-k="monthly" class="${kind === "monthly" ? "on" : ""}">Monthly</button></div>
     <div class="day-nav"><button class="btn sm" id="rp-prev">‹</button><span class="date-label">${range}</span><button class="btn sm" id="rp-next">›</button></div>
     ${state.meta.ai_enabled && kind === "weekly" ? `<button class="btn primary" id="ai-btn">✦ AI review</button>` : ""}`);
  $$(".seg button").forEach((b) => b.addEventListener("click", () => { reportState.kind = b.dataset.k; reportState.ref = null; renderReports(); }));
  $("#rp-prev").onclick = () => { reportState.ref = kind === "weekly" ? addDays(r.start, -7) : addDays(r.start, -1).slice(0, 8) + "01"; renderReports(); };
  $("#rp-next").onclick = () => {
    const next = kind === "weekly" ? addDays(r.start, 7) : (() => { const d = parseISO(r.start); d.setMonth(d.getMonth() + 1); return iso(d); })();
    if (next > today()) return toast("That period hasn’t started yet");
    reportState.ref = next; renderReports();
  };

  if (!r.activities.length) {
    $("#view").innerHTML = `<div class="card empty"><h3>No report yet</h3><p>Reports appear once you've tracked a few days.</p><a class="btn primary" href="#/track">Start tracking</a></div>`;
    return;
  }
  const verdictCls = r.verdict.startsWith("Overall") ? "green" : r.verdict.startsWith("Mixed") ? "amber" : r.verdict.startsWith("Not") ? "" : "red";
  const o = r.observations || {};
  const obs = [["Strongest area", o.strongest_area], ["Biggest improvement", o.biggest_improvement], ["Biggest decline", o.biggest_decline],
    ["Needs attention", o.needs_attention], ["Recommendation", o.recommendation]].filter(([, v]) => v);

  $("#view").innerHTML = `
    <div style="margin-bottom:14px"><span class="chip ${verdictCls} verdict">${esc(r.verdict)}</span> ${r.partial ? `<span class="chip">In progress · pro-rated</span>` : ""}</div>
    <div class="grid kpis">
      <div class="card kpi"><div class="label">Hours invested</div><div class="value">${fmt(r.hours_invested, 1)}</div><div class="foot"><span class="${cls(r.hours_change_pct)}">${signed(r.hours_change_pct, 0)}</span> vs previous</div></div>
      <div class="card kpi"><div class="label">Targets achieved</div><div class="value">${pct(r.targets_achieved_pct)}</div><div class="foot">${r.targets_achieved} of ${r.targets_tracked} activities</div></div>
      <div class="card kpi"><div class="label">Performance score</div><div class="value">${pct(r.performance_score)}</div><div class="foot"><span class="${cls(r.performance_change_pct)}">${signed(r.performance_change_pct)}</span> vs previous</div></div>
      <div class="card kpi"><div class="label">Milestones</div><div class="value">${(r.milestones_reached || []).length}</div><div class="foot">${(r.milestones_reached || []).length ? esc(r.milestones_reached[0].split("– ")[1] || "") : "reached this period"}</div></div>
    </div>
    <div class="grid two mt">
      <div class="card"><div class="card-head"><h2>${kind === "weekly" ? "Day by day" : "Activity scorecard"} ${info(kind === "weekly" ? "Daily performance index for each day of the week. Click a bar to open that day." : "Target adherence per activity this month vs last month.")}</h2></div><div class="chart-box short"><canvas id="c-days"></canvas></div></div>
      <div class="card"><div class="card-head"><h2>Category scores</h2><span class="sub">% of target · hover for change</span></div><div class="chart-box short"><canvas id="c-cats"></canvas></div></div>
    </div>
    <div class="grid three mt">
      <div class="card"><div class="card-head"><h2>Time allocation</h2><span class="sub">hours</span></div><div class="chart-box short"><canvas id="c-alloc"></canvas></div></div>
      <div class="card"><div class="card-head"><h2>Performance changes</h2><span class="sub">by category</span></div>
        <table><tbody>${Object.entries(r.category_change_pct).map(([c, v]) => `<tr><td>${esc(c)}</td><td class="num ${cls(v)}">${signed(v, 0)}</td><td class="num hint">${pct(r.category_scores[c])}</td></tr>`).join("") || '<tr><td class="hint">No comparison yet</td></tr>'}</tbody></table></div>
      <div class="card"><div class="card-head"><h2>Observations</h2></div>
        <div class="obs">${obs.map(([k, v]) => `<div class="obs-item"><span class="k">${k}</span><span>${esc(v)}</span></div>`).join("")}</div>
        <div id="ai-out"></div></div>
    </div>
    <div class="card mt"><div class="card-head"><h2>Activity breakdown</h2><span class="sub">${kind === "weekly" ? "per-week rate vs previous week" : "rate vs previous month"}</span></div>
      <div class="table-wrap"><table><thead><tr><th>Activity</th><th>Category</th><th class="num">Previous</th><th class="num">Current</th><th class="num">Target</th><th class="num">Change</th><th>Result</th></tr></thead>
      <tbody>${r.activities.map((x) => `<tr><td><span class="dot" style="background:${x.color}"></span>${esc(x.name)}</td><td class="hint">${esc(x.category)}</td>
        <td class="num">${fmt(x.previous)}</td><td class="num">${fmt(x.current)} <span class="hint">${esc(x.rate_label)}</span></td><td class="num">${fmt(x.target)}</td>
        <td class="num ${cls(x.change_pct)}">${signed(x.change_pct)}</td><td>${x.met === null ? "–" : x.met ? '<span class="chip green">Met</span>' : '<span class="chip red">Missed</span>'}</td></tr>`).join("")}</tbody></table></div></div>
    ${kind === "weekly" ? `
    <div class="card mt"><div class="card-head"><h2>Weekly reflection</h2><span class="sub">what worked, what didn’t, what to adjust</span></div>
      <form id="refl" class="grid three">
        <label class="field">What went well<textarea name="went_well">${esc(r.reflection?.went_well)}</textarea></label>
        <label class="field">What didn’t<textarea name="didnt_go_well">${esc(r.reflection?.didnt_go_well)}</textarea></label>
        <label class="field">Adjust next week<textarea name="adjust_next">${esc(r.reflection?.adjust_next)}</textarea></label>
        <div style="grid-column:1/-1;display:flex;justify-content:flex-end"><button class="btn primary">Save reflection</button></div>
      </form></div>` : ""}`;

  if (kind === "weekly" && r.daily_index) {
    chart($("#c-days"), { type: "bar",
      data: { labels: r.daily_index.map((x) => niceDate(x.date, { weekday: "short", day: "numeric" })),
        datasets: [{ label: "Performance", data: r.daily_index.map((x) => (x.index ?? 0) * 100), backgroundColor: r.daily_index.map((x) => idxColor(x.index)), borderRadius: 6 }] },
      options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `Performance ${fmt(c.parsed.y, 0)}%` } } },
        scales: { y: { max: 100, beginAtZero: true, ticks: { callback: (v) => v + "%" } }, x: { grid: { display: false } } },
        onClick: (_, els) => { if (els.length) location.hash = `#/track/${r.daily_index[els[0].index].date}`; } } });
  } else {
    const acts = r.activities.filter((x) => x.score !== null);
    chart($("#c-days"), { type: "bar",
      data: { labels: acts.map((x) => x.name), datasets: [{ label: "Adherence", data: acts.map((x) => x.score * 100), backgroundColor: acts.map((x) => x.color + "cc"), borderRadius: 5 }] },
      options: { indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { max: 100, beginAtZero: true, ticks: { callback: (v) => v + "%" } }, y: { grid: { display: false } } } } });
  }
  const catNames = Object.keys(r.category_scores);
  chart($("#c-cats"), { type: "bar",
    data: { labels: catNames, datasets: [{ label: "Score", data: catNames.map((c) => r.category_scores[c] * 100),
      backgroundColor: catNames.map((c) => (r.category_scores[c] >= 0.8 ? "#34d399cc" : r.category_scores[c] >= 0.5 ? "#7c8cffcc" : "#ff5c7acc")), borderRadius: 5 }] },
    options: { plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: (c) => { const v = r.category_change_pct[catNames[c.dataIndex]]; return v === undefined || v === null ? "" : `Change vs previous: ${v > 0 ? "+" : ""}${fmt(v, 0)}%`; } } } },
      scales: { y: { max: 100, beginAtZero: true, ticks: { callback: (v) => v + "%" } }, x: { grid: { display: false } } } } });

  const alloc = Object.entries(r.time_allocation).filter(([, v]) => v > 0);
  const palette = ["#7c8cff", "#34d399", "#f5b14c", "#4cc9f0", "#ff5c7a", "#b388ff", "#e9c46a"];
  if (alloc.length) {
    chart($("#c-alloc"), { type: "doughnut",
      data: { labels: alloc.map(([k]) => k), datasets: [{ data: alloc.map(([, v]) => v), backgroundColor: palette, borderColor: "#11141b", borderWidth: 3 }] },
      options: { cutout: "68%", plugins: { legend: { position: "right" }, tooltip: { callbacks: { label: (c) => `${c.label}: ${fmt(c.parsed, 1)}h` } } } } });
  } else $("#c-alloc").parentElement.innerHTML = `<div class="hint">No duration activities logged.</div>`;

  $("#refl")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await api("/reflections", { method: "PUT", body: { week_start: r.start, ...Object.fromEntries(new FormData(e.target)) } });
    toast("Reflection saved");
  });
  $("#ai-btn")?.addEventListener("click", async () => {
    $("#ai-out").innerHTML = `<div class="skeleton" style="height:80px;margin-top:12px"></div>`;
    try { const s = await api(`/reports/weekly/ai-summary?week_of=${r.start}`, { method: "POST" }); $("#ai-out").innerHTML = `<div class="ai-box" style="margin-top:12px">${esc(s.summary)}</div>`; }
    catch (err) { $("#ai-out").innerHTML = `<div class="hint">${esc(err.message)}</div>`; }
  });
}

