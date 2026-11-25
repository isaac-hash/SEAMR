import { $, $$, addDays, api, chart, closeModal, cls, confirmDialog, esc, fmt, gradient, info, niceDate, openModal, parseISO, iso, pct, setHeader, shortDate, signed, spark, state, toast, today } from "./core.js";
import { statusChip } from "./dashboard.js";

export async function renderAnalytics(selectedId) {
  const a = await api("/analytics?weeks=12");
  setHeader(`Rolling weeks to ${niceDate(a.as_of, { day: "numeric", month: "short" })}`, "Performance analytics");
  if (!a.activities.length) { $("#view").innerHTML = `<div class="card empty"><h3>No data yet</h3></div>`; return; }
  let sel = a.activities.find((x) => String(x.activity_id) === String(selectedId)) || a.activities[0];

  $("#view").innerHTML = `
    <div class="grid two">
      <div class="card">
        <div class="card-head"><h2 id="dd-title"></h2><select id="dd-select" style="width:auto">${a.activities.map((x) => `<option value="${x.activity_id}">${esc(x.name)}</option>`).join("")}</select></div>
        <div class="chart-box tall"><canvas id="c-dd"></canvas></div>
        <p class="note">Borrowed from trading: the dashed line is your running personal best (the “peak”), red bars are the drawdown from it.</p>
      </div>
      <div class="card">
        <div class="card-head"><h2>Selected activity</h2></div><div id="dd-stats"></div>
      </div>
    </div>
    <div class="card mt">
      <div class="card-head"><h2>Growth, personal bests & drawdowns</h2><span class="sub">rolling 7-day windows</span></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Metric</th><th class="num">Last week</th><th class="num">This week</th><th class="num">Change</th><th class="num">Personal best</th><th class="num">Drawdown</th><th class="num">Max drawdown</th><th class="num">Consistency 4w</th><th class="num">Streak</th></tr></thead>
        <tbody>${a.activities.map((x) => `
          <tr class="clickable" data-id="${x.activity_id}">
            <td><span class="dot" style="background:${x.color}"></span>${esc(x.name)} <span class="hint">${esc(x.rate_label)}</span></td>
            <td class="num">${fmt(x.last_week)}</td><td class="num">${fmt(x.this_week)}</td>
            <td class="num ${cls(x.improvement_pct)}">${signed(x.improvement_pct)}</td>
            <td class="num">${fmt(x.personal_best)}</td>
            <td class="num ${x.drawdown_pct < -0.05 ? "neg" : "neu"}">${x.drawdown_pct === null ? "–" : fmt(x.drawdown_pct, 1) + "%"}</td>
            <td class="num neg">${x.max_drawdown_pct === null ? "–" : fmt(x.max_drawdown_pct, 1) + "%"}</td>
            <td class="num">${pct(x.consistency_4w)}</td>
            <td class="num">${x.streak === null ? "–" : x.streak + "d"}</td>
          </tr>`).join("")}</tbody></table></div>
      <p class="note">Change is sign-adjusted: for “lower is better” activities (e.g. social media) a drop shows as positive.</p>
    </div>
    <div class="grid two-even mt">
      <div class="card"><div class="card-head"><h2>Category trend</h2><span class="sub">weekly target adherence</span></div><div class="chart-box"><canvas id="c-cat"></canvas></div></div>
      <div class="card"><div class="card-head"><h2>Activity correlations</h2><span class="sub">last 8 weeks · beta</span></div>
        <div class="alerts">${a.correlations.length ? a.correlations.slice(0, 7).map((c) => `
          <div class="alert"><span class="tag ${c.r > 0 ? "improving" : "declining"} mono">r ${c.r > 0 ? "+" : ""}${c.r.toFixed(2)}</span><span>${esc(c.insight)}</span></div>`).join("")
          : `<div class="hint">Not enough overlapping data yet – correlations appear after ~2 weeks of logging.</div>`}</div>
        <p class="note">Correlation isn’t causation – treat these as questions to test, not conclusions.</p></div>
    </div>`;

  let ddChart;
  const drawSel = () => {
    $("#dd-select").value = sel.activity_id;
    $("#dd-title").textContent = `${sel.name} · equity curve`;
    $$("tr[data-id]").forEach((tr) => tr.classList.toggle("selected", tr.dataset.id == sel.activity_id));
    ddChart && ddChart.destroy();
    const ctx = $("#c-dd").getContext("2d");
    ddChart = chart(ctx, {
      data: {
        labels: sel.curve.map((c) => niceDate(c.week_end, { day: "numeric", month: "short" })),
        datasets: [
          { type: "line", label: sel.rate_label, data: sel.curve.map((c) => c.value), borderColor: sel.color, backgroundColor: gradient(ctx, sel.color),
            fill: true, tension: 0.3, borderWidth: 2.5, pointRadius: 3, yAxisID: "y" },
          { type: "line", label: "Personal best (peak)", data: sel.curve.map((c) => c.peak), borderColor: "#8b93a7", borderDash: [6, 5], borderWidth: 1.4, pointRadius: 0, stepped: true, yAxisID: "y" },
          { type: "line", label: "Target", data: sel.curve.map(() => sel.target), borderColor: "#34d39988", borderWidth: 1, pointRadius: 0, yAxisID: "y" },
          { type: "bar", label: "Drawdown %", data: sel.curve.map((c) => c.drawdown), backgroundColor: "#ff5c7a66", borderRadius: 4, yAxisID: "y2", barPercentage: 0.6 },
        ],
      },
      options: {
        interaction: { mode: "index", intersect: false },
        scales: { y: { beginAtZero: true, position: "left" }, y2: { position: "right", max: 0, suggestedMin: -50, grid: { display: false }, ticks: { callback: (v) => v + "%" } }, x: { grid: { display: false } } },
        plugins: { legend: { position: "bottom" } },
      },
    });
    $("#dd-stats").innerHTML = `<div class="stat-grid" style="margin-top:0">
      <div class="stat"><div class="k">This week</div><div class="v">${fmt(sel.this_week)} ${esc(sel.rate_label)}</div></div>
      <div class="stat"><div class="k">vs last week</div><div class="v ${cls(sel.improvement_pct)}">${signed(sel.improvement_pct)}</div></div>
      <div class="stat"><div class="k">Personal best</div><div class="v">${fmt(sel.personal_best)}</div></div>
      <div class="stat"><div class="k">PB week</div><div class="v">${sel.personal_best_week ? niceDate(sel.personal_best_week, { day: "numeric", month: "short" }) : "–"}</div></div>
      <div class="stat"><div class="k">Current drawdown</div><div class="v ${sel.drawdown_pct < 0 ? "neg" : ""}">${fmt(sel.drawdown_pct, 1)}%</div></div>
      <div class="stat"><div class="k">Max drawdown</div><div class="v neg">${fmt(sel.max_drawdown_pct, 1)}%</div></div>
      <div class="stat"><div class="k">Target</div><div class="v">${sel.direction === "lower_is_better" ? "≤ " : ""}${fmt(sel.target)} ${esc(sel.rate_label)}</div></div>
      <div class="stat"><div class="k">Consistency · 4w</div><div class="v">${pct(sel.consistency_4w)}</div></div>
    </div>
    <div style="margin-top:14px">${statusChip(sel)} <span class="chip">${sel.indicator_type === "lagging" ? "Lagging · result" : "Leading · effort"}</span> <span class="chip">${esc(sel.category)}</span></div>`;
  };
  drawSel();
  $("#dd-select").addEventListener("change", (e) => { sel = a.activities.find((x) => x.activity_id == e.target.value); history.replaceState(null, "", `#/analytics/${sel.activity_id}`); drawSel(); });
  $$("tr[data-id]").forEach((tr) => tr.addEventListener("click", () => { sel = a.activities.find((x) => x.activity_id == tr.dataset.id); history.replaceState(null, "", `#/analytics/${sel.activity_id}`); drawSel(); window.scrollTo({ top: 0, behavior: "smooth" }); }));

  const palette = ["#7c8cff", "#34d399", "#f5b14c", "#4cc9f0", "#ff5c7a", "#b388ff", "#e9c46a", "#8d99ae"];
  chart($("#c-cat"), {
    type: "line",
    data: { labels: a.category_trend.labels.map((l) => niceDate(l, { day: "numeric", month: "short" })),
      datasets: Object.entries(a.category_trend.series).map(([c, vals], i) => ({ label: c, data: vals.map((v) => v === null ? null : v * 100),
        borderColor: palette[i % palette.length], tension: 0.35, borderWidth: 2, pointRadius: 0 })) },
    options: { scales: { y: { max: 100, suggestedMin: 0, ticks: { callback: (v) => v + "%" } }, x: { grid: { display: false } } }, plugins: { legend: { position: "bottom" } } },
  });
}
