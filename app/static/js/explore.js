/* Explore – a notebook-style exploratory data analysis of your life. */
import {
  $, $$, api, boxPlot, calendar, chart, clamp, divColor, esc, fmt, heat, idxColor, info, miniHist, niceDate, ols,
  pct, setHeader, shortDate, signed, spark, cls,
} from "./core.js";

const S = { days: 84, focus: null, hidden: new Set(), lag: 0, calMetric: "index", wdMode: "mean", pair: null, day: null, data: null, highlight: null };
let tsChart = null, histChart = null, scatterChart = null;

const RANGES = [[28, "4W"], [84, "12W"], [182, "26W"], [0, "All"]];

export async function renderExplore(arg) {
  if (arg && /^\d+$/.test(arg)) S.focus = Number(arg);
  setHeader("Life EDA · exploratory data analysis", "Explore your data",
    `<div class="seg" id="range">${RANGES.map(([d, l]) => `<button data-d="${d}" class="${S.days === d ? "on" : ""}">${l}</button>`).join("")}</div>`);
  $$("#range button").forEach((b) => b.addEventListener("click", () => { S.days = Number(b.dataset.d); S.day = null; renderExplore(); }));

  const e = await api(`/explore?days=${S.days}`);
  S.data = e;
  const view = $("#view");
  if (!e.activities.length) {
    view.innerHTML = `<div class="card empty"><h3>Nothing to explore yet</h3><p>Log a few days of activities and come back – the notebook builds itself.</p><a class="btn primary" href="#/track">Start tracking</a></div>`;
    return;
  }
  if (!S.focus || !e.activities.some((a) => a.id === S.focus)) S.focus = e.activities.find((a) => a.target_period === "daily")?.id ?? e.activities[0].id;
  const cats = [...new Set(e.activities.map((a) => a.category))];

  view.innerHTML = `
    <div class="filters">
      <span class="hint">Categories</span>
      ${cats.map((c) => `<button class="chip toggle ${S.hidden.has(c) ? "" : "on"}" data-cat="${esc(c)}">${esc(c)}</button>`).join("")}
      <span class="hint" style="margin-left:auto">${e.range.days} days · ${niceDate(e.range.start, { day: "numeric", month: "short", year: "numeric" })} → ${niceDate(e.range.end, { day: "numeric", month: "short", year: "numeric" })}</span>
    </div>
    ${cell(1, "life.info()", "What’s in the dataset, and the headline findings.", `<div id="o-info"></div>`)}
    ${cell(2, "life.plot.calendar()", "Every day of your life as a cell. Click a day to inspect it.", `<div class="cal-wrap"><div class="cal-left"><div class="cell-tools"><select id="cal-metric"></select><div class="legend" id="cal-legend"></div></div><div id="o-cal" class="cal-scroll"></div></div><div id="o-day" class="day-panel"></div></div>`)}
    ${cell(3, "life.describe()", "Summary statistics per activity. Click a row to focus it below.", `<div class="table-wrap" id="o-describe"></div>`)}
    ${cell(4, "life.isna()  # + intensity", "Rows are activities, columns are days. Brighter = more; red-tinted gaps = a daily habit you didn’t log.", `<div id="o-matrix" class="matrix-scroll"></div>`)}
    ${cell(5, `life["<span id="focus-name"></span>"].plot()`, "Daily values with 7-day rolling mean, ±1σ band, target, and outliers.", `
      <div class="cell-tools"><select id="focus-select"></select><span class="legend-inline"><i style="background:var(--focus)"></i>daily <i class="ln"></i>7-day mean <i class="band"></i>±1σ <i class="tg"></i>target <i class="an"></i>outlier</span></div>
      <div class="chart-box tall"><canvas id="c-ts"></canvas></div>`)}
    ${cell(6, `life["…"].hist()  ·  .boxplot()`, "How your values are distributed – are you consistent or all-or-nothing?", `
      <div class="grid two-even"><div><div class="chart-box short"><canvas id="c-hist"></canvas></div></div><div><div id="o-box"></div><div id="o-focus-stats" class="stat-grid"></div></div></div>`)}
    ${cell(7, `life.groupby("weekday").mean()`, "Your weekly rhythm: which days each activity actually happens.", `
      <div class="cell-tools"><div class="seg sm" id="wd-mode"><button data-m="mean">Average amount</button><button data-m="freq">How often</button></div></div><div id="o-weekday"></div>`)}
    ${cell(8, `life.corr(${S.lag ? "lag=1" : ""})`, "Pearson correlation between activities. Click any cell to see the scatter plot behind it.", `
      <div class="cell-tools"><div class="seg sm" id="lag-mode"><button data-l="0">Same day</button><button data-l="1">Next day (lag 1)</button></div><span class="hint" id="lag-hint"></span></div>
      <div class="grid corr-grid"><div id="o-corr" class="corr-scroll"></div><div><div class="chart-box"><canvas id="c-scatter"></canvas></div><div id="o-pair" class="pair-note"></div></div></div>`)}
    ${cell(9, `life.resample("W").sum()  ·  radar`, "Where your hours go each week, and how your life balance shifted vs 4 weeks ago.", `
      <div class="grid two"><div class="chart-box"><canvas id="c-area"></canvas></div><div class="chart-box"><canvas id="c-radar"></canvas></div></div>`)}
    ${cell(10, "life.outliers(z=2.2)", "Days that broke your pattern – good or bad. Click to locate it on the chart.", `<div id="o-anom" class="anoms"></div>`)}
    <p class="note">Correlation isn’t causation. Treat every pattern here as a hypothesis to test with a small experiment.</p>`;

  $$(".filters [data-cat]").forEach((b) => b.addEventListener("click", () => {
    const c = b.dataset.cat; S.hidden.has(c) ? S.hidden.delete(c) : S.hidden.add(c);
    b.classList.toggle("on"); drawFiltered();
  }));

  drawInfo(e);
  drawCalendar(e);
  drawFiltered();
  drawComposition(e);
  wireStatic(e);
}

const cell = (n, code, desc, out) => `
  <section class="cell" id="cell-${n}">
    <div class="cell-in"><span class="prompt">In [${n}]:</span><code>${code}</code><span class="cell-desc">${esc(desc)}</span></div>
    <div class="cell-out">${out}</div>
  </section>`;

const visible = () => S.data.activities.filter((a) => !S.hidden.has(a.category));
const actById = (id) => S.data.activities.find((a) => a.id === id);
const descById = (id) => S.data.describe.find((d) => d.activity_id === id);

function drawFiltered() {
  drawDescribe();
  drawMatrix();
  drawWeekday();
  drawCorr();
  drawFocus();
}

// ------------------------------------------------------------------ 1. info + insights
function drawInfo(e) {
  const i = e.info;
  const kv = (k, v, t) => `<div class="info-kv"><div class="k">${k}${t ? info(t) : ""}</div><div class="v">${v}</div></div>`;
  const icon = { pattern: "◷", trend: "↗", warning: "!", data: "◌", link: "⇄" };
  $("#o-info").innerHTML = `
    <pre class="df-info">&lt;LifeFrame&gt; ${i.days} days × ${i.activities} activities · ${i.categories} categories · ${fmt(i.data_points, 0)} non-null values</pre>
    <div class="info-strip">
      ${kv("Days observed", i.days)}
      ${kv("Data points", fmt(i.data_points, 0))}
      ${kv("Logging coverage", pct(i.coverage), "Share of activity-days with any value logged. Weekly activities naturally have gaps on rest days.")}
      ${kv("Avg performance", pct(i.avg_index), "Mean daily performance index: importance-weighted adherence to all targets.")}
      ${kv("Best day", pct(i.best_index))}
      ${kv("Trend", `<span class="${cls(i.index_trend_per_week)}">${i.index_trend_per_week > 0 ? "+" : ""}${fmt(i.index_trend_per_week, 1)} pts/wk</span>`, "OLS slope of the daily performance index, in percentage points per week.")}
    </div>
    <div class="insights">${e.insights.map((x) => `<div class="insight ${x.kind}"><div class="ico">${icon[x.kind] || "•"}</div><div><b>${esc(x.title)}</b><p>${esc(x.text)}</p></div></div>`).join("")}</div>`;
}

// ------------------------------------------------------------------ 2. calendar
function drawCalendar(e) {
  const sel = $("#cal-metric");
  sel.innerHTML = `<option value="index">Performance index</option>` + e.activities.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("");
  sel.value = S.calMetric;
  const render = () => {
    let vals, colorFn, tipFn, legend;
    if (S.calMetric === "index") {
      vals = e.daily_index;
      colorFn = idxColor;
      tipFn = (d, v) => `${niceDate(d, { weekday: "long", day: "numeric", month: "short" })}\nPerformance ${v === null ? "–" : pct(v)}`;
      legend = `<span>Less</span>${[0.4, 0.65, 0.75, 0.85, 0.93, 0.99].map((v) => `<i style="background:${idxColor(v)}"></i>`).join("")}<span>More</span>`;
    } else {
      const a = actById(Number(S.calMetric));
      vals = e.values[a.id];
      const d = descById(a.id);
      const top = d.q75 !== null ? Math.max(d.q75 * 1.25, a.daily_target) : 1;
      colorFn = (v) => (v === null ? "#0f1218" : heat(a.color, v / top));
      tipFn = (ds, v) => `${niceDate(ds, { weekday: "long", day: "numeric", month: "short" })}\n${a.name}: ${v === null ? "not logged" : `${fmt(v)} ${a.unit}`}`;
      legend = `<span>0</span>${[0.15, 0.35, 0.6, 0.85, 1].map((t) => `<i style="background:${heat(a.color, t)}"></i>`).join("")}<span>${fmt(top)} ${esc(a.unit)}</span>`;
    }
    const wrap = $("#o-cal");
    const weeks = Math.ceil((e.dates.length + 7) / 7);
    const size = clamp(Math.floor((wrap.clientWidth - 40) / weeks) - 3, 10, 26);
    wrap.innerHTML = calendar(e.dates, vals, { colorFn, tipFn, cell: size, selected: S.day });
    $("#cal-legend").innerHTML = legend;
    $$(".cal-cell", wrap).forEach((r) => r.addEventListener("click", () => { S.day = r.dataset.date; render(); drawDay(); }));
  };
  sel.onchange = () => { S.calMetric = sel.value; render(); };
  render();
  if (!S.day) S.day = e.dates.at(-1);
  drawDay();
  render();
}

function drawDay() {
  const e = S.data, i = e.dates.indexOf(S.day);
  if (i < 0) return;
  const rows = e.activities.map((a) => {
    const v = e.values[a.id][i];
    const t = a.daily_target;
    const lower = a.direction === "lower_is_better";
    const ratio = v === null ? 0 : lower ? (v <= t ? 1 : t / v) : clamp(v / t, 0, 1);
    return `<div class="day-row" data-tip="${esc(`${a.name}: ${v === null ? "not logged" : fmt(v) + " " + a.unit}\nDaily target ${lower ? "≤ " : "≈ "}${fmt(t)} ${a.unit}${a.target_period === "weekly" ? " (weekly ÷ 7)" : ""}`)}">
      <span class="nm"><span class="dot" style="background:${a.color}"></span>${esc(a.name)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${ratio * 100}%;background:${a.color}"></div></div>
      <span class="num">${v === null ? '<span class="hint">—</span>' : fmt(v)}</span></div>`;
  }).join("");
  $("#o-day").innerHTML = `<div class="day-head"><div><div class="hint">${niceDate(S.day, { weekday: "long" })}</div><b>${niceDate(S.day, { day: "numeric", month: "long", year: "numeric" })}</b></div>
    <div class="day-score" style="background:${idxColor(e.daily_index[i])}">${pct(e.daily_index[i])}</div></div>${rows}
    <a class="btn sm" style="margin-top:12px" href="#/track/${S.day}">Edit this day →</a>`;
}

// ------------------------------------------------------------------ 3. describe
function drawDescribe() {
  const rows = visible().map((a) => {
    const d = descById(a.id);
    return `<tr class="clickable ${a.id === S.focus ? "selected" : ""}" data-id="${a.id}">
      <td><span class="dot" style="background:${a.color}"></span>${esc(a.name)}<div class="hint">${esc(a.unit)} · ${a.target_period}</div></td>
      <td class="num">${d.n}</td>
      <td><div class="cov" data-tip="${esc(`Logged on ${d.n} of ${d.active_days} days`)}"><div style="width:${(d.coverage || 0) * 100}%;background:${a.target_period === "daily" && d.coverage < 0.7 ? "var(--amber)" : "var(--accent)"}"></div></div><span class="hint mono">${pct(d.coverage)}</span></td>
      <td class="num">${fmt(d.mean)}</td><td class="num">${fmt(d.std)}</td><td class="num">${fmt(d.min)}</td>
      <td class="num">${fmt(d.median)}</td><td class="num">${fmt(d.max)}</td>
      <td class="num" data-tip="Skew > 0: occasional big days. Skew < 0: mostly high with occasional dips.">${fmt(d.skew, 2)}</td>
      <td class="num">${d.hit_rate === null ? '<span class="hint">wkly</span>' : pct(d.hit_rate)}</td>
      <td class="num ${cls(d.trend_pct_per_week)}">${signed(d.trend_pct_per_week)}</td>
      <td>${miniHist(d.hist, { color: a.color })}</td>
      <td>${spark(S.data.rolling[a.id].mean.slice(-56), { w: 110, h: 26, color: a.color, target: a.daily_target })}</td>
    </tr>`;
  }).join("");
  $("#o-describe").innerHTML = `<table class="describe"><thead><tr>
    <th>Activity</th><th class="num">count</th><th>coverage</th><th class="num">mean</th><th class="num">std</th><th class="num">min</th>
    <th class="num">50%</th><th class="num">max</th><th class="num">skew</th><th class="num">hit rate ${info("Share of days the daily target was met")}</th>
    <th class="num">trend/wk ${info("Linear trend of daily values, % of the mean per week (sign-adjusted for limits)")}</th><th>distribution</th><th>7-day mean · last 8w</th></tr></thead><tbody>${rows}</tbody></table>`;
  $$("#o-describe tr[data-id]").forEach((tr) => tr.addEventListener("click", () => { setFocus(Number(tr.dataset.id)); $("#cell-5").scrollIntoView({ behavior: "smooth", block: "start" }); }));
}

// ------------------------------------------------------------------ 4. missing / intensity matrix
function drawMatrix() {
  const e = S.data;
  const acts = visible();
  const n = e.dates.length;
  const avail = ($("#o-matrix").clientWidth || 900) - 170;
  const cellW = clamp(Math.floor(avail / n) - 1, 3, 18);
  const every = Math.max(1, Math.ceil(56 / ((cellW + 1) * 7)));  // weeks between labels so they never overlap
  let mondays = 0;
  const header = e.dates.map((d, i) => {
    if (parseISOday(d) !== 1) return "";
    return mondays++ % every === 0 ? `<span style="grid-column:${i + 1}" class="mx-tick">${shortDate(d)}</span>` : "";
  }).join("");
  const rows = acts.map((a) => {
    const d = descById(a.id);
    const top = Math.max(d.q75 !== null ? d.q75 * 1.3 : 1, 1e-9);
    const daily = a.target_period === "daily";
    const cells = e.values[a.id].map((v, i) => {
      const ds = e.dates[i];
      const bg = v === null ? (daily ? "#ff5c7a1f" : "#0f1218") : v === 0 ? "#1a1f2a" : heat(a.color, v / top);
      return `<i class="${parseISOday(ds) === 1 ? "wk" : ""}" style="background:${bg}" data-tip="${esc(`${a.name} · ${niceDate(ds)}\n${v === null ? (daily ? "missing" : "no session") : fmt(v) + " " + a.unit}`)}"></i>`;
    }).join("");
    return `<div class="mx-label"><span class="dot" style="background:${a.color}"></span>${esc(a.name)}</div><div class="mx-row" style="grid-template-columns:repeat(${n},${cellW}px)">${cells}</div>`;
  }).join("");
  $("#o-matrix").innerHTML = `<div class="mx"><div></div><div class="mx-row mx-head" style="grid-template-columns:repeat(${n},${cellW}px)">${header}</div>${rows}</div>
    <div class="legend" style="margin-top:10px"><span>missing daily habit</span><i style="background:#ff5c7a1f;border:1px solid #ff5c7a40"></i><span style="margin-left:12px">logged 0</span><i style="background:#1a1f2a"></i><span style="margin-left:12px">low → high</span>${[0.2, 0.5, 0.8, 1].map((t) => `<i style="background:${heat("#7c8cff", t)}"></i>`).join("")}</div>`;
}
const parseISOday = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d).getDay(); };

// ------------------------------------------------------------------ 5/6. focus activity
function setFocus(id) {
  S.focus = id; S.highlight = null;
  history.replaceState(null, "", `#/explore/${id}`);
  $$("#o-describe tr[data-id]").forEach((tr) => tr.classList.toggle("selected", Number(tr.dataset.id) === id));
  drawFocus();
}

function drawFocus() {
  const e = S.data;
  const a = actById(S.focus) || visible()[0];
  if (!a) return;
  const d = descById(a.id);
  document.documentElement.style.setProperty("--focus", a.color);
  $("#focus-name").textContent = a.name;
  const fs = $("#focus-select");
  fs.innerHTML = e.activities.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join("");
  fs.value = a.id; fs.onchange = () => setFocus(Number(fs.value));

  const vals = e.values[a.id], roll = e.rolling[a.id];
  const anomIdx = new Set(e.anomalies.filter((x) => x.activity_id === a.id).map((x) => e.dates.indexOf(x.date)));
  tsChart && tsChart.destroy();
  const ctx = $("#c-ts").getContext("2d");
  tsChart = chart(ctx, {
    data: {
      labels: e.dates.map(shortDate),
      datasets: [
        { type: "line", label: "+1σ", data: roll.mean.map((m, i) => (m === null || roll.std[i] === null ? null : m + roll.std[i])), borderWidth: 0, pointRadius: 0, fill: false, order: 5 },
        { type: "line", label: "−1σ", data: roll.mean.map((m, i) => (m === null || roll.std[i] === null ? null : Math.max(0, m - roll.std[i]))), borderWidth: 0, pointRadius: 0, fill: "-1", backgroundColor: a.color + "22", order: 5 },
        { type: "line", label: "7-day mean", data: roll.mean, borderColor: "#e7e9ef", borderWidth: 2, pointRadius: 0, tension: 0.35, order: 1 },
        { type: "line", label: "Daily target", data: e.dates.map(() => a.daily_target), borderColor: "#34d399", borderDash: [5, 5], borderWidth: 1.2, pointRadius: 0, order: 2 },
        { type: "line", label: "Outlier", data: vals.map((v, i) => (anomIdx.has(i) ? v : null)), showLine: false, pointRadius: vals.map((_, i) => (i === S.highlight ? 9 : 5)), pointBackgroundColor: "#ff5c7a", pointBorderColor: "#fff", pointBorderWidth: 1.5, order: 0 },
        { type: "bar", label: a.name, data: vals, backgroundColor: vals.map((_, i) => (i === S.highlight ? "#ffffff" : a.color + "99")), borderRadius: 2, barPercentage: 1, categoryPercentage: 0.9, order: 3 },
      ],
    },
    options: {
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: false }, tooltip: { filter: (it) => !["+1σ", "−1σ"].includes(it.dataset.label) && it.raw !== null,
        callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.parsed.y)} ${a.unit}` } } },
      scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 12, maxRotation: 0 } }, y: { beginAtZero: true } },
    },
  });

  // histogram
  histChart && histChart.destroy();
  const h = d.hist;
  histChart = chart($("#c-hist"), {
    type: "bar",
    data: { labels: h.counts.map((_, i) => `${fmt(h.edges[i])}–${fmt(h.edges[i + 1])}`),
      datasets: [{ label: "days", data: h.counts, backgroundColor: h.counts.map((_, i) => (a.daily_target >= h.edges[i] && a.daily_target < h.edges[i + 1] ? "#34d399" : a.color + "cc")), borderRadius: 4, barPercentage: 1, categoryPercentage: 0.92 }] },
    options: { plugins: { legend: { display: false }, tooltip: { callbacks: { title: (c) => `${c[0].label} ${a.unit}`, label: (c) => `${c.parsed.y} days` } } },
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 6 } }, y: { beginAtZero: true, ticks: { precision: 0 } } } },
  });
  $("#o-box").innerHTML = boxPlot(d, { color: a.color, target: a.daily_target, unit: a.unit });
  const st = (k, v, t) => `<div class="stat"${t ? ` data-tip="${esc(t)}"` : ""}><div class="k">${k}</div><div class="v">${v}</div></div>`;
  $("#o-focus-stats").innerHTML = [
    st("Mean ± std", `${fmt(d.mean)} ± ${fmt(d.std)}`),
    st("Coefficient of variation", fmt(d.cv, 2), "std / mean. Below 0.3 = steady; above 0.6 = all-or-nothing."),
    st("Momentum (lag-1 autocorr)", fmt(d.momentum, 2), "Does a high day predict a high next day? Positive = habit momentum; negative = alternating days."),
    st("Total in period", `${fmt(d.total, 0)} ${esc(a.unit)}`),
  ].join("");
}

// ------------------------------------------------------------------ 7. weekday
function drawWeekday() {
  const e = S.data, wd = e.weekday;
  $$("#wd-mode button").forEach((b) => b.classList.toggle("on", b.dataset.m === S.wdMode));
  const idxRow = `<div class="wd-label"><b>Performance index</b></div>${wd.index.map((v, i) => `<div class="wd-cell" style="background:${idxColor(v)}" data-tip="${wd.labels[i]}: ${pct(v)} average performance"><span>${pct(v)}</span></div>`).join("")}`;
  const rows = visible().map((a) => {
    const p = wd.activities[a.id];
    const vals = S.wdMode === "mean" ? p.mean : p.freq;
    const top = Math.max(...vals.filter((v) => v !== null), 1e-9);
    return `<div class="wd-label"><span class="dot" style="background:${a.color}"></span>${esc(a.name)}</div>${vals.map((v, i) =>
      `<div class="wd-cell" style="background:${heat(a.color, v === null ? null : v / top)}" data-tip="${esc(`${a.name} on ${wd.labels[i]}s\nAverage: ${fmt(p.mean[i])} ${a.unit}\nDone on ${pct(p.freq[i])} of ${wd.labels[i]}s`)}"><span>${S.wdMode === "mean" ? fmt(v) : pct(v)}</span></div>`).join("")}`;
  }).join("");
  $("#o-weekday").innerHTML = `<div class="wd"><div></div>${wd.labels.map((l) => `<div class="wd-head">${l}</div>`).join("")}${idxRow}${rows}</div>`;
}

// ------------------------------------------------------------------ 8. correlation matrix + scatter
function drawCorr() {
  const e = S.data;
  const M = S.lag ? e.corr_lag1 : e.corr;
  $$("#lag-mode button").forEach((b) => b.classList.toggle("on", Number(b.dataset.l) === S.lag));
  $("#cell-8 .cell-in code").textContent = `life.corr(${S.lag ? "lag=1" : ""})`;
  $("#lag-hint").textContent = S.lag ? "Row = today, column = tomorrow. Does doing X today change Y tomorrow?" : "Symmetric. Blue = move together, red = move opposite.";
  const vis = visible();
  const idx = vis.map((a) => e.corr.ids.indexOf(a.id));
  const n = vis.length;
  const abbrev = (s) => (s.length > 12 ? s.slice(0, 11) + "…" : s);
  let html = `<div class="corr" style="grid-template-columns:150px repeat(${n}, minmax(34px, 1fr))"><div></div>`;
  html += vis.map((a) => `<div class="corr-col" title="${esc(a.name)}"><span>${esc(abbrev(a.name))}</span></div>`).join("");
  vis.forEach((a, ri) => {
    html += `<div class="corr-row-label"><span class="dot" style="background:${a.color}"></span>${esc(a.name)}</div>`;
    vis.forEach((b, ci) => {
      const r = M.matrix[idx[ri]][idx[ci]];
      const diag = !S.lag && ri === ci;
      const sel = S.pair && S.pair[0] === a.id && S.pair[1] === b.id;
      html += `<button class="corr-cell ${sel ? "sel" : ""} ${diag ? "diag" : ""}" data-a="${a.id}" data-b="${b.id}" style="background:${diag ? "#161a23" : divColor(r)}"
        data-tip="${esc(`${a.name}${S.lag ? " (today)" : ""} × ${b.name}${S.lag ? " (tomorrow)" : ""}\nr = ${r === null ? "n/a" : r.toFixed(2)}`)}">${diag ? "" : r === null ? "·" : Math.abs(r) < 0.05 ? "0" : r.toFixed(1).replace("0.", ".").replace("-.", "−.")}</button>`;
    });
  });
  html += `</div><div class="legend" style="margin-top:10px"><span>−1</span>${[-1, -0.6, -0.3, 0, 0.3, 0.6, 1].map((r) => `<i style="background:${divColor(r)}"></i>`).join("")}<span>+1</span></div>`;
  $("#o-corr").innerHTML = html;
  $$(".corr-cell").forEach((c) => c.addEventListener("click", () => { if (c.classList.contains("diag")) return; S.pair = [Number(c.dataset.a), Number(c.dataset.b)]; drawCorr(); }));

  if (!S.pair || !vis.some((a) => a.id === S.pair[0]) || !vis.some((a) => a.id === S.pair[1])) {
    // default to the strongest off-diagonal pair in view
    let best = null;
    vis.forEach((a, ri) => vis.forEach((b, ci) => {
      if (!S.lag && ci <= ri) return; if (S.lag && ci === ri) return;
      const r = M.matrix[idx[ri]][idx[ci]];
      if (r !== null && (!best || Math.abs(r) > Math.abs(best[2]))) best = [a.id, b.id, r];
    }));
    if (best) { S.pair = [best[0], best[1]]; return drawCorr(); }
  }
  drawScatter();
}

function drawScatter() {
  scatterChart && scatterChart.destroy();
  if (!S.pair) return;
  const e = S.data, A = actById(S.pair[0]), B = actById(S.pair[1]);
  const va = e.values[A.id], vb = e.values[B.id];
  const pts = [];
  for (let i = 0; i < e.dates.length - S.lag; i++) {
    const x = va[i] ?? 0, y = vb[i + S.lag] ?? 0;
    if (va[i] === null && vb[i + S.lag] === null && A.target_period === "weekly") continue;
    const jitter = A.measurement_type === "boolean" ? (Math.random() - 0.5) * 0.15 : 0;
    pts.push({ x: x + jitter, y, d: e.dates[i] });
  }
  const fit = ols(pts);
  const xs = pts.map((p) => p.x);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  scatterChart = chart($("#c-scatter"), {
    type: "scatter",
    data: { datasets: [
      { label: "days", data: pts, backgroundColor: B.color + "aa", borderColor: B.color, pointRadius: 3.5, pointHoverRadius: 6 },
      ...(fit ? [{ type: "line", label: "OLS fit", data: [{ x: x0, y: fit.intercept + fit.slope * x0 }, { x: x1, y: fit.intercept + fit.slope * x1 }], borderColor: "#e7e9ef", borderWidth: 2, pointRadius: 0, borderDash: [6, 4] }] : []),
    ] },
    options: {
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => c.raw.d ? `${shortDate(c.raw.d)}: ${fmt(c.raw.x)} ${A.unit} → ${fmt(c.raw.y)} ${B.unit}` : "" } } },
      scales: { x: { title: { display: true, text: `${A.name} (${A.unit})${S.lag ? " · today" : ""}` } }, y: { beginAtZero: true, title: { display: true, text: `${B.name} (${B.unit})${S.lag ? " · next day" : ""}` } } },
    },
  });
  if (fit) {
    const r = fit.r, strength = Math.abs(r) >= 0.6 ? "strong" : Math.abs(r) >= 0.4 ? "moderate" : Math.abs(r) >= 0.2 ? "weak" : "no clear";
    $("#o-pair").innerHTML = `<b>r = ${r >= 0 ? "+" : ""}${r.toFixed(2)}</b> · ${strength} ${r >= 0 ? "positive" : "negative"} relationship · n = ${pts.length} days.<br>
      Each extra 1 ${esc(A.unit)} of ${esc(A.name)}${S.lag ? " today" : ""} goes with <b>${fit.slope >= 0 ? "+" : ""}${fmt(fit.slope, Math.abs(fit.slope) < 0.1 ? 3 : 2)} ${esc(B.unit)}</b> of ${esc(B.name)}${S.lag ? " the next day" : ""}.`;
  }
}

// ------------------------------------------------------------------ 9. composition + radar
function drawComposition(e) {
  const pal = ["#7c8cff", "#34d399", "#f5b14c", "#4cc9f0", "#ff5c7a", "#b388ff", "#e9c46a"];
  const entries = Object.entries(e.composition.hours).filter(([, v]) => v.some((x) => x > 0));
  chart($("#c-area"), {
    type: "line",
    data: { labels: e.composition.labels.map(shortDate),
      datasets: entries.map(([c, v], i) => ({ label: c, data: v, borderColor: pal[i % pal.length], backgroundColor: pal[i % pal.length] + "55", fill: true, tension: 0.35, pointRadius: 0, borderWidth: 1.5 })) },
    options: { interaction: { mode: "index", intersect: false }, scales: { y: { stacked: true, title: { display: true, text: "hours / week" } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } } },
      plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.parsed.y, 1)}h` } } } },
  });
  chart($("#c-radar"), {
    type: "radar",
    data: { labels: e.radar.categories, datasets: [
      { label: "Last 7 days", data: e.radar.now.map((v) => (v ?? 0) * 100), borderColor: "#7c8cff", backgroundColor: "#7c8cff33", pointBackgroundColor: "#7c8cff", borderWidth: 2 },
      { label: "4 weeks ago", data: e.radar.four_weeks_ago.map((v) => (v ?? 0) * 100), borderColor: "#8b93a7", backgroundColor: "#8b93a711", borderDash: [5, 4], pointRadius: 0, borderWidth: 1.5 },
    ] },
    options: { scales: { r: { min: 0, max: 100, ticks: { display: false, stepSize: 25 }, grid: { color: "#222836" }, angleLines: { color: "#222836" }, pointLabels: { color: "#c8cdd8", font: { size: 12 } } } },
      plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.parsed.r, 0)}%` } } } },
  });

  $("#o-anom").innerHTML = e.anomalies.length ? e.anomalies.map((x) => `
    <button class="anom ${x.kind}" data-id="${x.activity_id}" data-date="${x.date}">
      <span class="z mono">z ${x.z > 0 ? "+" : ""}${x.z.toFixed(1)}</span>
      <span><b><span class="dot" style="background:${x.color}"></span>${esc(x.name)}</b><br><span class="hint">${niceDate(x.date)} · ${fmt(x.value)} ${esc(x.unit)} vs typical ${fmt(x.typical)}</span></span>
      <span class="arrow">${x.kind === "high" ? "▲" : "▼"}</span></button>`).join("")
    : `<div class="hint">No outliers in this range – remarkably steady.</div>`;
  $$(".anom").forEach((b) => b.addEventListener("click", () => {
    setFocus(Number(b.dataset.id));
    S.highlight = S.data.dates.indexOf(b.dataset.date);
    drawFocus();
    $("#cell-5").scrollIntoView({ behavior: "smooth", block: "start" });
  }));
}

function wireStatic() {
  $$("#wd-mode button").forEach((b) => b.addEventListener("click", () => { S.wdMode = b.dataset.m; drawWeekday(); }));
  $$("#lag-mode button").forEach((b) => b.addEventListener("click", () => { S.lag = Number(b.dataset.l); S.pair = null; drawCorr(); }));
}

export function resetExploreCharts() { tsChart = histChart = scatterChart = null; }
