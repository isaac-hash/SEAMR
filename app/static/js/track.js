/* Track – daily logging, activity editor and the global quick-log panel. */
import { $, $$, addDays, api, closeModal, esc, fmt, niceDate, openModal, setHeader, spark, state, toast, today, unitSteps } from "./core.js";

export async function renderTrack(dateArg) {
  const day = dateArg && /^\d{4}-\d{2}-\d{2}$/.test(dateArg) ? dateArg : today();
  const log = await api(`/track/${day}`);
  const isToday = day === today();
  setHeader(isToday ? "Today" : niceDate(day, { weekday: "long" }), "Daily activity tracker",
    `<div class="day-nav">
       <button class="btn sm" id="prev-day" title="Previous day (←)">‹</button>
       <input type="date" id="pick-day" value="${day}" max="${today()}">
       <button class="btn sm" id="next-day" ${isToday ? "disabled" : ""} title="Next day (→)">›</button>
       ${isToday ? "" : `<button class="btn sm" id="to-today">Today</button>`}
     </div>
     <button class="btn primary" id="add-activity">+ Add activity</button>`);
  const go = (d) => (location.hash = d === today() ? "#/track" : `#/track/${d}`);
  $("#prev-day").onclick = () => go(addDays(day, -1));
  $("#next-day").onclick = () => !isToday && go(addDays(day, 1));
  $("#pick-day").onchange = (e) => e.target.value && go(e.target.value);
  $("#to-today") && ($("#to-today").onclick = () => go(today()));
  $("#add-activity").onclick = () => activityForm();
  document.onkeydown = (e) => {
    if (!location.hash.startsWith("#/track") || e.target.matches("input,textarea,select")) return;
    if (e.key === "ArrowLeft") go(addDays(day, -1));
    if (e.key === "ArrowRight" && !isToday) go(addDays(day, 1));
  };

  const view = $("#view");
  if (!log.activities.length) {
    view.innerHTML = `<div class="card empty"><h3>Track what matters</h3>
      <p>Create measurable activities – pages read, reps, minutes of French, hours of sport.<br>Mix <b>leading</b> indicators (effort) with <b>lagging</b> ones (results).</p>
      <button class="btn primary" id="first-act">+ Add your first activity</button>
      <div class="templates">${TEMPLATES.map((t, i) => `<button class="chip toggle" data-t="${i}">${esc(t.name)}</button>`).join("")}</div>
      <p class="hint">…or start from a template above.</p></div>`;
    $("#first-act").onclick = () => activityForm();
    $$("[data-t]").forEach((b) => b.addEventListener("click", () => activityForm(null, TEMPLATES[b.dataset.t])));
    return;
  }

  const groups = {};
  log.activities.forEach((r) => (groups[r.activity.category] ||= []).push(r));
  const ring = (p) => `<svg class="ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.5" class="ring-bg"/><circle cx="18" cy="18" r="15.5" class="ring-fg" stroke-dasharray="${(p * 97.4).toFixed(1)} 97.4"/></svg>`;
  view.innerHTML = `
    <div class="card track-summary">
      <div class="ts-ring">${ring(log.tracked ? log.completed / log.tracked : 0)}<span>${log.completed}/${log.tracked}</span></div>
      <div><div class="hint">${isToday ? "Today" : niceDate(day)}</div><b style="font-size:17px">${log.completed === log.tracked ? "Everything done – superb day 🎯" : `${log.tracked - log.completed} target${log.tracked - log.completed === 1 ? "" : "s"} still open`}</b>
        <div class="hint">Tap a chip to add, type a value and press Enter, or press <kbd>L</kbd> anywhere for quick log.</div></div>
      <div class="seg sm" id="track-filter" style="margin-left:auto"><button data-f="all" class="on">All</button><button data-f="open">Open</button><button data-f="done">Done</button></div>
    </div>
    <div class="tracker">${Object.values(groups).flat().map(trackCard).join("")}</div>
    <p class="note">Weekly-target activities show progress for the current week. “Set” replaces the day’s value; chips add on top.</p>`;

  $$("#track-filter button").forEach((b) => b.addEventListener("click", () => {
    $$("#track-filter button").forEach((x) => x.classList.toggle("on", x === b));
    $$(".track-card").forEach((c) => (c.hidden = b.dataset.f === "open" ? c.classList.contains("met") : b.dataset.f === "done" ? !c.classList.contains("met") : false));
  }));

  $$(".track-card").forEach((card) => {
    const id = Number(card.dataset.id);
    const row = log.activities.find((r) => r.activity.id === id);
    const save = async (value, mode = "set") => {
      try {
        await api("/entries", { method: "POST", body: { activity_id: id, date: day, value, mode } });
        const wasMet = row.met;
        await renderTrack(day);
        const now = $(`.track-card[data-id="${id}"]`);
        if (now && now.classList.contains("met") && !wasMet) { now.classList.add("celebrate"); toast(`🎯 ${row.activity.name} – target hit!`); }
        else toast(`Logged ${row.activity.name}`);
      } catch (e) { toast(e.message); }
    };
    $(".do-set", card)?.addEventListener("click", () => { const v = parseFloat($("input", card).value); if (!Number.isNaN(v)) save(v); });
    $("input", card)?.addEventListener("keydown", (e) => e.key === "Enter" && $(".do-set", card).click());
    $$("[data-add]", card).forEach((b) => b.addEventListener("click", () => save(Number(b.dataset.add), "add")));
    $("[data-fill]", card)?.addEventListener("click", () => save(Number($("[data-fill]", card).dataset.fill)));
    $(".check-btn", card)?.addEventListener("click", () => save(row.value >= 1 ? 0 : 1));
    $(".edit", card).addEventListener("click", () => activityForm(row.activity));
  });
}

function trackCard(r) {
  const a = r.activity;
  const weekly = a.target_period === "weekly";
  const shown = weekly ? r.week_to_date : r.value;
  const lower = a.direction === "lower_is_better";
  const width = Math.min(100, r.progress * 100);
  const barColor = lower ? (r.progress <= 1 ? "var(--green)" : "var(--red)") : r.met ? "var(--green)" : a.color;
  const dailyT = weekly ? a.target_value / 7 : a.target_value;
  const sp = spark(r.history, { w: 112, h: 30, color: a.color, type: "bar", target: dailyT, min: 0 });
  const head = `<div class="top"><div><div class="name"><span class="dot" style="background:${a.color}"></span>${esc(a.name)}</div>
      <div class="meta">${esc(a.category)} · ${a.indicator_type === "lagging" ? "result" : "effort"} · ${lower ? "≤" : ""}${fmt(a.target_value)} ${esc(a.unit)}/${weekly ? "week" : "day"}</div></div>
      <div class="card-spark" data-tip="Last 14 days${weekly ? "" : " · bright bars hit the daily target"}">${sp}</div>
      <button class="icon-btn edit" title="Edit activity">⋯</button></div>`;
  if (a.measurement_type === "boolean") {
    return `<div class="track-card ${r.met ? "met" : ""}" data-id="${a.id}">${head}
      <button class="btn check-btn ${r.value >= 1 ? "done" : ""}">${r.value >= 1 ? "✓ Done" : "Mark as done"}</button></div>`;
  }
  const remaining = Math.max(0, (weekly ? a.target_value - r.week_to_date : a.target_value - r.value));
  const steps = unitSteps(a.unit, a.target_value);
  return `<div class="track-card ${r.met ? "met" : ""}" data-id="${a.id}">${head}
    <div class="big">${fmt(shown)} <small>/ ${fmt(r.target)} ${esc(a.unit)}${weekly ? " this week" : ""}</small>${r.met ? '<span class="met-badge">✓</span>' : ""}</div>
    <div class="progress"><div style="width:${width}%;background:${barColor}"></div></div>
    <div class="chips">${steps.map((s) => `<button class="chip-btn" data-add="${s}">+${fmt(s)}</button>`).join("")}
      ${!lower && !r.met && remaining > 0 && !weekly ? `<button class="chip-btn fill" data-fill="${a.target_value}" title="Set today to the target">Hit target</button>` : ""}</div>
    <div class="log-row">
      <input type="number" min="0" step="any" placeholder="today's ${esc(a.unit)}" value="${r.value || ""}">
      <button class="btn sm do-set">Set</button>
    </div>
    ${weekly ? `<div class="hint" style="margin-top:6px">Today: ${fmt(r.value)} ${esc(a.unit)} · ${fmt(remaining)} to go this week</div>` : ""}
  </div>`;
}

const TEMPLATES = [
  { name: "Reading · 30 pages/day", category: "Reading", measurement_type: "count", unit: "pages", target_value: 30, target_period: "daily", color: "#f5b14c" },
  { name: "Gym · 3 sessions/week", category: "Fitness", measurement_type: "count", unit: "sessions", target_value: 3, target_period: "weekly", color: "#ff6b6b" },
  { name: "Language · 30 min/day", category: "Language", measurement_type: "duration", unit: "minutes", target_value: 30, target_period: "daily", color: "#4cc9f0" },
  { name: "Sleep · 8 hrs", category: "Wellbeing", measurement_type: "count", unit: "hrs", target_value: 8, target_period: "daily", direction: "target_is_best", color: "#8d99ae" },
  { name: "Deep work · 10 h/week", category: "Career", measurement_type: "duration", unit: "hours", target_value: 10, target_period: "weekly", color: "#b388ff" },
  { name: "Screen time · ≤ 2 hrs", category: "Personal", measurement_type: "count", unit: "hrs", target_value: 2, target_period: "daily", direction: "lower_is_better", color: "#ef476f" },
  { name: "Meditation · done", category: "Wellbeing", measurement_type: "boolean", unit: "done", target_value: 1, target_period: "daily", color: "#90be6d" },
];

export function activityForm(a = null, template = null) {
  const v = a || { name: "", category: "", measurement_type: "count", unit: "", target_value: "", target_period: "daily",
    direction: "higher_is_better", indicator_type: "leading", importance: 3, color: "#7c8cff", ...(template ? { ...template, name: template.name.split(" · ")[0] } : {}) };
  openModal(a ? `Edit · ${a.name}` : "New activity", `
    ${a ? "" : `<div class="templates" style="margin:0 0 14px">${TEMPLATES.map((t, i) => `<button type="button" class="chip toggle" data-t="${i}">${esc(t.name)}</button>`).join("")}</div>`}
    <form id="act-form" class="form-grid">
      <label class="field full">Name<input type="text" name="name" required maxlength="80" value="${esc(v.name)}" placeholder="e.g. Reading"></label>
      <label class="field">Category<input type="text" name="category" required list="cats" value="${esc(v.category)}" placeholder="Fitness, Learning…">
        <datalist id="cats">${state.meta.categories.map((c) => `<option value="${c}">`).join("")}</datalist></label>
      <label class="field">Measurement
        <select name="measurement_type" ${a ? "disabled" : ""}>
          <option value="count">Count (pages, reps, words)</option><option value="duration">Duration (counts as dev hours)</option><option value="boolean">Done / not done</option>
        </select></label>
      <label class="field">Unit<input type="text" name="unit" value="${esc(v.unit)}" placeholder="pages, reps, minutes…" list="units"><datalist id="units"><option value="minutes"><option value="hours"><option value="pages"><option value="reps"><option value="sessions"><option value="words"></datalist></label>
      <label class="field">Target<input type="number" name="target_value" required min="0.01" step="any" value="${v.target_value}"></label>
      <label class="field">Per<select name="target_period"><option value="daily">Day</option><option value="weekly">Week</option></select></label>
      <label class="field">Direction<select name="direction">
        <option value="higher_is_better">Higher is better</option><option value="lower_is_better">Lower is better (limit)</option><option value="target_is_best">Hit the target (e.g. sleep)</option></select></label>
      <label class="field">Indicator<select name="indicator_type"><option value="leading">Leading – effort (30 min French)</option><option value="lagging">Lagging – result (words remembered)</option></select></label>
      <label class="field">Importance<select name="importance">${[1, 2, 3, 4, 5].map((i) => `<option value="${i}">${"★".repeat(i)}${"☆".repeat(5 - i)}</option>`).join("")}</select></label>
      <label class="field">Colour<input type="color" name="color" value="${v.color}"></label>
      <div class="full hint">Duration activities must use <b>minutes</b> or <b>hours</b>. Not every decrease is bad – use “lower is better” for limits like screen time.</div>
      <div class="full form-actions" style="justify-content:space-between">
        <span>${a ? `<button type="button" class="btn danger" id="archive">Archive</button>` : ""}</span>
        <span style="display:flex;gap:8px"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" type="submit">${a ? "Save" : "Create activity"}</button></span>
      </div>
    </form>`, (el) => {
    const f = $("#act-form", el);
    ["measurement_type", "target_period", "direction", "indicator_type", "importance"].forEach((k) => (f.elements[k].value = v[k] ?? f.elements[k].value));
    $$("[data-t]", el).forEach((b) => b.addEventListener("click", () => activityForm(null, TEMPLATES[b.dataset.t])));
    f.elements.measurement_type.addEventListener("change", (e) => {
      if (e.target.value === "duration" && !["minutes", "hours"].includes(f.elements.unit.value)) f.elements.unit.value = "minutes";
      if (e.target.value === "boolean") { f.elements.unit.value = "done"; f.elements.target_value.value = 1; }
    });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(f));
      body.target_value = parseFloat(body.target_value); body.importance = Number(body.importance);
      if (!body.unit) body.unit = body.measurement_type === "duration" ? "minutes" : "count";
      try {
        if (a) { delete body.measurement_type; await api(`/activities/${a.id}`, { method: "PATCH", body }); }
        else await api("/activities", { method: "POST", body });
        closeModal(); toast(a ? "Activity updated" : "Activity created"); window.dispatchEvent(new HashChangeEvent("hashchange"));
      } catch (err) { toast(err.message, 4000); }
    });
    $("#archive", el)?.addEventListener("click", async () => {
      await api(`/activities/${a.id}`, { method: "PATCH", body: { archived: true } });
      closeModal(); toast(`${a.name} archived – history kept`); window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
  });
}

/** Global quick-log panel (press L anywhere). */
export async function quickLog() {
  const day = today();
  const log = await api(`/track/${day}`);
  if (!log.activities.length) { location.hash = "#/track"; return; }
  let dirty = false;
  const rowHtml = (r) => {
    const a = r.activity;
    if (a.measurement_type === "boolean") {
      return `<div class="ql-row ${r.met ? "met" : ""}" data-id="${a.id}"><span class="nm"><span class="dot" style="background:${a.color}"></span>${esc(a.name)}</span>
        <span class="ql-val"></span><span class="chips"><button class="chip-btn ${r.value >= 1 ? "fill" : ""}" data-toggle>${r.value >= 1 ? "✓ done" : "mark done"}</button></span></div>`;
    }
    return `<div class="ql-row ${r.met ? "met" : ""}" data-id="${a.id}"><span class="nm"><span class="dot" style="background:${a.color}"></span>${esc(a.name)}</span>
      <span class="ql-val mono">${fmt(r.value)} <span class="hint">${esc(a.unit)}</span></span>
      <span class="chips">${unitSteps(a.unit, a.target_value).map((s) => `<button class="chip-btn" data-add="${s}">+${fmt(s)}</button>`).join("")}
      <input type="number" min="0" step="any" placeholder="set" class="ql-in"></span></div>`;
  };
  const draw = (rows) => {
    $("#ql").innerHTML = rows.map(rowHtml).join("");
    $$("#ql .ql-row").forEach((el) => {
      const id = Number(el.dataset.id), r = rows.find((x) => x.activity.id === id);
      const send = async (value, mode) => {
        await api("/entries", { method: "POST", body: { activity_id: id, date: day, value, mode } });
        dirty = true;
        const fresh = await api(`/track/${day}`);
        draw(fresh.activities);
        $(`#ql .ql-row[data-id="${id}"]`)?.classList.add("flash");
      };
      $$("[data-add]", el).forEach((b) => b.addEventListener("click", () => send(Number(b.dataset.add), "add")));
      $("[data-toggle]", el)?.addEventListener("click", () => send(r.value >= 1 ? 0 : 1, "set"));
      $(".ql-in", el)?.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.value !== "") send(Number(e.target.value), "set"); });
    });
  };
  openModal(`Quick log · ${niceDate(day)}`, `<div id="ql" class="ql"></div>
    <div class="form-actions"><span class="hint" style="margin-right:auto">Chips add to today · type a number + Enter to set</span><button class="btn primary" data-close>Done</button></div>`, () => draw(log.activities), true);
  const onClose = () => { document.removeEventListener("modal-closed", onClose); if (dirty) window.dispatchEvent(new HashChangeEvent("hashchange")); };
  document.addEventListener("modal-closed", onClose);
}
