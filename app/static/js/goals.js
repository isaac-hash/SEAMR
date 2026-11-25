import { $, $$, addDays, api, chart, closeModal, cls, confirmDialog, esc, fmt, gradient, info, niceDate, openModal, parseISO, iso, pct, setHeader, shortDate, signed, spark, state, toast, today } from "./core.js";
import { goalStatusChip, statusChip } from "./dashboard.js";

const view = () => $("#view");

export async function renderGoals() {
  const [goals, acts] = await Promise.all([api("/goals"), api("/activities")]);
  const byId = Object.fromEntries(acts.map((a) => [a.id, a]));
  setHeader("Development projects", "Goals & skills", `<button class="btn primary" id="new-goal">+ New project</button>`);
  $("#new-goal").onclick = () => goalForm(acts);
  if (!goals.length) {
    $("#view").innerHTML = `<div class="card empty"><h3>What are you trying to become better at?</h3><p>Connect daily activities to a long-term outcome with milestones and a forecast.</p></div>`;
    return;
  }
  $("#view").innerHTML = `<div class="goals">${goals.map((g) => goalCard(g, byId)).join("")}</div>`;
  $$(".goal-card").forEach((card) => {
    const gid = Number(card.dataset.id);
    $$("input[type=checkbox][data-ms]", card).forEach((cb) => cb.addEventListener("change", async () => {
      await api(`/milestones/${cb.dataset.ms}?done=${cb.checked}`, { method: "PATCH" });
      if (cb.checked) toast("Milestone reached 🎯");
      renderGoals();
    }));
    $(".add-ms button", card).addEventListener("click", async () => {
      const inp = $(".add-ms input", card); if (!inp.value.trim()) return;
      await api(`/goals/${gid}/milestones`, { method: "POST", body: { title: inp.value.trim() } }); renderGoals();
    });
    $(".goal-menu", card).addEventListener("click", () => goalActions(goals.find((g) => g.id === gid)));
  });
  goals.filter((g) => g.progress.metric).forEach(drawBurnup);
}

async function drawBurnup(g) {
  const m = g.progress.metric, canvas = $(`canvas[data-burn="${g.id}"]`);
  if (!canvas) return;
  const entries = await api(`/entries?activity_id=${m.activity_id}&start=${g.start_date}&limit=5000`);
  const byDay = {};
  entries.forEach((e) => (byDay[e.date] = (byDay[e.date] || 0) + e.value));
  const end = g.target_date, labels = [], actual = [], required = [], projected = [];
  const total = (parseISO(end) - parseISO(g.start_date)) / 864e5;
  const todayS = today();
  let cum = 0, d = g.start_date, i = 0;
  const step = total > 200 ? 7 : 1;
  while (d <= end) {
    for (let k = 0; k < step; k++) { const dd = addDays(d, -k); if (dd >= g.start_date && dd <= todayS) cum += byDay[dd] || 0; }
    labels.push(shortDate(d));
    actual.push(d <= todayS ? cum : null);
    required.push((m.target * i) / total);
    projected.push(d >= todayS && m.pace_per_week ? Math.min(m.target * 1.1, m.current + (m.pace_per_week / 7) * ((parseISO(d) - parseISO(todayS)) / 864e5)) : null);
    d = addDays(d, step); i += step;
  }
  const ctx = canvas.getContext("2d");
  chart(ctx, { type: "line",
    data: { labels, datasets: [
      { label: "Actual", data: actual, borderColor: "#7c8cff", backgroundColor: gradient(ctx, "#7c8cff", 140), fill: true, pointRadius: 0, borderWidth: 2, tension: 0.2 },
      { label: "Required path", data: required, borderColor: "#8b93a7", borderDash: [6, 4], pointRadius: 0, borderWidth: 1.2 },
      { label: "Projection", data: projected, borderColor: "#34d399", borderDash: [2, 3], pointRadius: 0, borderWidth: 1.6 },
    ] },
    options: { interaction: { mode: "index", intersect: false }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.parsed.y, 0)} ${m.unit}` } } },
      scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 5, maxRotation: 0 } }, y: { beginAtZero: true, ticks: { maxTicksLimit: 4 } } } } });
}

function goalCard(g, byId) {
  const p = g.progress;
  const m = p.metric;
  return `<div class="card goal-card" data-id="${g.id}">
    <div class="goal-top"><div><div class="goal-title">${esc(g.title)}</div>
      <div class="goal-sub">${esc(g.category)} · due ${niceDate(g.target_date, { day: "numeric", month: "short", year: "numeric" })}</div></div>
      <div style="display:flex;gap:6px;align-items:center">${g.status === "active" ? goalStatusChip(p.status) : `<span class="chip">${g.status}</span>`}<button class="icon-btn goal-menu">⋯</button></div></div>
    ${g.desired_outcome ? `<div class="goal-sub" style="margin-top:10px">${esc(g.desired_outcome)}</div>` : ""}
    <div class="goal-pct">${pct(p.progress_pct)}<span class="hint" style="font-size:12px;font-family:var(--sans);font-weight:400;margin-left:10px">time elapsed ${pct(p.time_elapsed_pct)}</span></div>
    <div class="progress dual" style="height:9px" data-tip="${esc(`Progress ${pct(p.progress_pct)}\nTime elapsed ${pct(p.time_elapsed_pct)} (white marker)\nAhead of the marker = ahead of schedule`)}"><div style="width:${Math.min(100, p.progress_pct * 100)}%"></div><span class="time-marker" style="left:${p.time_elapsed_pct * 100}%"></span></div>
    <div class="hint" style="margin-top:6px">${p.days_left} days left · due ${niceDate(g.target_date, { day: "numeric", month: "short", year: "numeric" })}</div>
    ${m ? `<div class="burnup"><div class="hint" style="margin:14px 0 4px">Burn-up: actual vs required path ${info("Cumulative progress since the project started. Dashed = the straight line you need to reach the target on time; dotted = projection at your current pace.")}</div><div class="chart-box burn"><canvas data-burn="${g.id}"></canvas></div></div>` : ""}
    <div class="stat-grid">
      ${m ? `<div class="stat"><div class="k">${esc(m.name)}</div><div class="v">${fmt(m.current, 0)} / ${fmt(m.target, 0)} ${esc(m.unit)}</div></div>
             <div class="stat"><div class="k">Projected finish</div><div class="v">${m.projected_completion ? niceDate(m.projected_completion, { day: "numeric", month: "short", year: "numeric" }) : "no pace yet"}</div></div>
             <div class="stat"><div class="k">Current pace</div><div class="v">${fmt(m.pace_per_week)} /wk</div></div>
             <div class="stat"><div class="k">Required pace</div><div class="v ${m.pace_per_week >= m.required_per_week ? "pos" : "neg"}">${fmt(m.required_per_week)} /wk</div></div>` : ""}
      <div class="stat"><div class="k">Activity consistency · 4w</div><div class="v">${pct(p.activity_consistency_4w)}</div></div>
      ${g.activity_ids.some((id) => byId[id]?.measurement_type === "duration") ? `<div class="stat"><div class="k">Hours · last 7d</div><div class="v">${fmt(p.hours_this_week, 1)}h${g.weekly_hours_commitment ? ` / ${fmt(g.weekly_hours_commitment)}h` : ""}</div></div>` : g.milestones.length ? `<div class="stat"><div class="k">Milestones</div><div class="v">${g.milestones.filter((m) => m.done).length} / ${g.milestones.length}</div></div>` : ""}
    </div>
    ${g.activity_ids.length ? `<div class="checks" style="margin-top:12px">${g.activity_ids.map((id) => byId[id] ? `<span class="chip"><span class="dot" style="background:${byId[id].color};margin:0"></span>${esc(byId[id].name)}</span>` : "").join("")}</div>` : ""}
    <ul class="milestones">${g.milestones.map((ms) => `
      <li class="${ms.done ? "done" : ""}"><input type="checkbox" data-ms="${ms.id}" ${ms.done ? "checked" : ""}><span>${esc(ms.title)}</span>
      <span class="date">${ms.done && ms.done_on ? "✓ " + niceDate(ms.done_on, { day: "numeric", month: "short" }) : ms.target_date ? niceDate(ms.target_date, { day: "numeric", month: "short" }) : ""}</span></li>`).join("")}</ul>
    <div class="add-ms"><input type="text" placeholder="Add a milestone…" maxlength="120"><button class="btn sm">Add</button></div>
  </div>`;
}

function goalActions(g) {
  openModal(g.title, `<div style="display:flex;flex-direction:column;gap:8px">
    ${g.status !== "completed" ? `<button class="btn" data-s="completed">Mark project completed</button>` : ""}
    ${g.status === "active" ? `<button class="btn" data-s="paused">Pause project</button>` : `<button class="btn" data-s="active">Set active</button>`}
    <button class="btn danger" id="del-goal">Delete project</button></div>`, (el) => {
    $$("[data-s]", el).forEach((b) => b.addEventListener("click", async () => {
      await api(`/goals/${g.id}`, { method: "PATCH", body: { status: b.dataset.s } }); closeModal(); renderGoals();
    }));
    $("#del-goal", el).addEventListener("click", async () => {
      if (await confirmDialog("Delete project?", `“${g.title}” and its milestones will be removed. Activity history is kept.`, "Delete", true)) {
        await api(`/goals/${g.id}`, { method: "DELETE" }); renderGoals();
      }
    });
  });
}

function goalForm(acts) {
  const inYear = addDays(today(), 365);
  openModal("New development project", `
    <form id="goal-form" class="form-grid">
      <label class="field full">Project<input type="text" name="title" required maxlength="120" placeholder="Become fluent in French"></label>
      <label class="field">Category<input type="text" name="category" required list="gcats" placeholder="Language"><datalist id="gcats">${state.meta.categories.map((c) => `<option value="${c}">`).join("")}</datalist></label>
      <label class="field">Target date<input type="date" name="target_date" required value="${inYear}" min="${addDays(today(), 1)}"></label>
      <label class="field full">Desired outcome<textarea name="desired_outcome" placeholder="What does success look like?"></textarea></label>
      <label class="field">Weekly time commitment (h)<input type="number" name="weekly_hours_commitment" min="0" step="0.5" value="3"></label>
      <span></span>
      <div class="field full">Contributing activities<div class="checks">${acts.map((a) => `<label><input type="checkbox" name="act" value="${a.id}"><span class="dot" style="background:${a.color};margin:0"></span>${esc(a.name)}</label>`).join("") || '<span class="hint">Create activities first on the Track page.</span>'}</div></div>
      <label class="field">Measurable outcome (optional)<select name="metric_activity_id"><option value="">– milestones only –</option>${acts.filter((a) => a.direction === "higher_is_better").map((a) => `<option value="${a.id}">Total ${esc(a.name)} (${esc(a.unit)})</option>`).join("")}</select></label>
      <label class="field">Outcome target<input type="number" name="metric_target" min="1" step="any" placeholder="e.g. 7200 pages"></label>
      <label class="field full">Milestones (one per line)<textarea name="milestones" placeholder="Finish A1 course&#10;Hold a 10-minute conversation&#10;Pass DELF A2"></textarea></label>
      <div class="full form-actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Create project</button></div>
    </form>`, (el) => {
    $("#goal-form", el).addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target; const fd = new FormData(f);
      const body = {
        title: fd.get("title"), category: fd.get("category"), desired_outcome: fd.get("desired_outcome"),
        target_date: fd.get("target_date"), weekly_hours_commitment: parseFloat(fd.get("weekly_hours_commitment") || 0),
        activity_ids: fd.getAll("act").map(Number),
        metric_activity_id: fd.get("metric_activity_id") ? Number(fd.get("metric_activity_id")) : null,
        metric_target: fd.get("metric_target") ? parseFloat(fd.get("metric_target")) : null,
        milestones: String(fd.get("milestones") || "").split("\n").map((s) => s.trim()).filter(Boolean).map((title) => ({ title })),
      };
      if (body.metric_activity_id && !body.activity_ids.includes(body.metric_activity_id)) body.activity_ids.push(body.metric_activity_id);
      if (body.metric_activity_id && !body.metric_target) return toast("Add an outcome target for the measurable outcome");
      try { await api("/goals", { method: "POST", body }); closeModal(); toast("Project created"); renderGoals(); }
      catch (err) { toast(err.message, 4000); }
    });
  });
}
