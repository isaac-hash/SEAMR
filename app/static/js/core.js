/* LIFEOS core: helpers, API client, modal/toast/tooltip, and a small SVG viz toolkit. */
export const API = "/api/v1";
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
export const state = { meta: null };

// ------------------------------------------------------------------ formatting
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const fmt = (x, d) => {
  if (x === null || x === undefined || Number.isNaN(x)) return "–";
  const digits = d ?? (Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : 2);
  return Number(x).toLocaleString("en-GB", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
};
export const pct = (x, d = 0) => (x === null || x === undefined ? "–" : `${fmt(x * 100, d)}%`);
export const signed = (x, d = 1) => (x === null || x === undefined ? "–" : `${x > 0 ? "+" : ""}${fmt(x, d)}%`);
export const cls = (x) => (x === null || x === undefined ? "neu" : x > 0 ? "pos" : x < 0 ? "neg" : "neu");
export const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const parseISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
export const niceDate = (s, opts = { weekday: "short", day: "numeric", month: "short" }) => parseISO(s).toLocaleDateString("en-GB", opts);
export const shortDate = (s) => niceDate(s, { day: "numeric", month: "short" });
export const today = () => iso(new Date());
export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));

// ------------------------------------------------------------------ API
export async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { "Content-Type": "application/json" }, ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = typeof j.detail === "string" ? j.detail : j.detail.map((e) => `${e.loc.at(-1)}: ${e.msg}`).join("; "); } catch { /* keep statusText */ }
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

// ------------------------------------------------------------------ UI chrome
export function toast(msg, ms = 2400) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
}

export function openModal(title, html, onMount, wide = false) {
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = html;
  $("#modal .modal").classList.toggle("wide", wide);
  $("#modal").hidden = false;
  onMount && onMount($("#modal-body"));
}
export const closeModal = () => { $("#modal").hidden = true; document.dispatchEvent(new Event("modal-closed")); };

export function confirmDialog(title, text, okLabel = "Confirm", danger = false) {
  return new Promise((resolve) => {
    openModal(title, `<p style="margin:0;color:var(--muted)">${esc(text)}</p>
      <div class="form-actions"><button class="btn" data-close>Cancel</button>
      <button class="btn ${danger ? "danger" : "primary"}" id="ok">${esc(okLabel)}</button></div>`, (el) => {
      $("#ok", el).onclick = () => { closeModal(); resolve(true); };
      $$("[data-close]", el).forEach((b) => b.addEventListener("click", () => resolve(false)));
    });
  });
}

export function setHeader(eyebrow, title, actionsHtml = "") {
  $("#page-eyebrow").textContent = eyebrow;
  $("#page-title").textContent = title;
  $("#page-actions").innerHTML = actionsHtml;
}

export const info = (text) => `<span class="info" data-tip="${esc(text)}" tabindex="0">i</span>`;

// Floating tooltip for any element with data-tip (supports \n line breaks)
const tip = document.createElement("div");
tip.className = "tip"; tip.hidden = true; document.body.appendChild(tip);
let tipEl = null;
document.addEventListener("mouseover", (e) => {
  const el = e.target.closest("[data-tip]");
  if (!el) { tip.hidden = true; tipEl = null; return; }
  if (el !== tipEl) { tipEl = el; tip.innerHTML = esc(el.dataset.tip).replace(/\n/g, "<br>"); }
  tip.hidden = false;
});
document.addEventListener("mousemove", (e) => {
  if (tip.hidden) return;
  const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + w > window.innerWidth - 8) x = e.clientX - w - pad;
  if (y + h > window.innerHeight - 8) y = e.clientY - h - pad;
  tip.style.transform = `translate(${x}px, ${y}px)`;
});
document.addEventListener("scroll", () => (tip.hidden = true), true);

// ------------------------------------------------------------------ Chart.js
const charts = [];
export function chart(canvas, config) { const c = new Chart(canvas, config); charts.push(c); return c; }
export function destroyCharts() { while (charts.length) { try { charts.pop().destroy(); } catch { /* already destroyed */ } } }
export const gradient = (ctx, color, h = 260) => {
  const g = ctx.createLinearGradient(0, 0, 0, ctx.canvas.clientHeight || h);
  g.addColorStop(0, color + "55"); g.addColorStop(1, color + "00"); return g;
};
export const PALETTE = ["#7c8cff", "#34d399", "#f5b14c", "#4cc9f0", "#ff5c7a", "#b388ff", "#e9c46a", "#8d99ae", "#2ec4b6", "#f28482"];

if (window.Chart) {
  Object.assign(Chart.defaults, { color: "#8b93a7", borderColor: "#1d2230", maintainAspectRatio: false });
  Chart.defaults.animation.duration = 550;
  Chart.defaults.font.family = "Inter, system-ui, sans-serif";
  Chart.defaults.font.size = 11.5;
  Object.assign(Chart.defaults.plugins.legend.labels, { boxWidth: 10, boxHeight: 10 });
  Object.assign(Chart.defaults.plugins.tooltip, { backgroundColor: "#161a23", borderColor: "#2c3343", borderWidth: 1, padding: 10 });
}

// ------------------------------------------------------------------ colour
const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export function mix(a, b, t) {
  const A = hex2rgb(a), B = hex2rgb(b), k = clamp(t);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * k)).join(",")})`;
}
const BASE = "#161a23";
export const heat = (hex, t) => (t === null || t === undefined ? "#0f1218" : mix(BASE, hex, 0.12 + 0.88 * clamp(t)));
export function idxColor(x) {
  if (x === null || x === undefined) return "#0f1218";
  if (x < 0.5) return mix("#3b1d2a", "#ff5c7a", (0.5 - x) * 1.2);
  if (x < 0.7) return "#2a3160";
  if (x < 0.8) return "#3e4cb0";
  if (x < 0.9) return "#6372f0";
  if (x < 0.97) return "#8f9cff";
  return "#b9c2ff";
}
export function divColor(r) {
  if (r === null || r === undefined) return "#0f1218";
  return mix(BASE, r >= 0 ? "#4cc9f0" : "#ff5c7a", 0.08 + 0.92 * Math.min(1, Math.abs(r) * 1.25));
}

// ------------------------------------------------------------------ SVG viz toolkit
/** Sparkline (line or bars). values may contain nulls. */
export function spark(values, { w = 120, h = 30, color = "#7c8cff", type = "line", target = null, min = null, max = null, dots = false } = {}) {
  const vals = values.map((v) => (v === null || v === undefined ? null : Number(v)));
  const nums = vals.filter((v) => v !== null);
  if (!nums.length) return `<svg class="spark" width="${w}" height="${h}"></svg>`;
  const lo = min ?? Math.min(0, ...nums), hi = max ?? Math.max(...nums, target ?? -Infinity, lo + 1e-9);
  const y = (v) => h - 2 - ((v - lo) / (hi - lo || 1)) * (h - 4);
  const step = w / Math.max(vals.length, 1);
  let body = "";
  if (type === "bar") {
    vals.forEach((v, i) => {
      if (v === null) return;
      const top = y(v), bw = Math.max(1.5, step - 2);
      const hit = target !== null && v >= target;
      body += `<rect x="${(i * step + 1).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, h - 2 - top).toFixed(1)}" rx="1.5" fill="${color}" opacity="${hit ? 1 : 0.55}"/>`;
    });
  } else {
    const xs = (i) => (vals.length === 1 ? w / 2 : (i / (vals.length - 1)) * (w - 4) + 2);
    let d = "", pen = false;
    vals.forEach((v, i) => { if (v === null) { pen = false; return; } d += `${pen ? "L" : "M"}${xs(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
    const lastI = vals.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0).pop();
    body = `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (dots) vals.forEach((v, i) => { if (v !== null) body += `<circle cx="${xs(i)}" cy="${y(v)}" r="1.8" fill="${color}"/>`; });
    if (lastI !== undefined) body += `<circle cx="${xs(lastI).toFixed(1)}" cy="${y(vals[lastI]).toFixed(1)}" r="2.6" fill="${color}"/>`;
  }
  const tl = target !== null && target >= lo && target <= hi ? `<line x1="0" x2="${w}" y1="${y(target)}" y2="${y(target)}" stroke="#34d399" stroke-opacity=".55" stroke-dasharray="3 3"/>` : "";
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${tl}${body}</svg>`;
}

/** Tiny histogram from {edges, counts}. */
export function miniHist(hist, { w = 90, h = 26, color = "#7c8cff" } = {}) {
  if (!hist || !hist.counts.length) return "";
  const m = Math.max(...hist.counts), bw = w / hist.counts.length;
  return `<svg class="spark" width="${w}" height="${h}">${hist.counts.map((c, i) =>
    `<rect x="${(i * bw + 0.5).toFixed(1)}" y="${(h - (c / m) * (h - 2)).toFixed(1)}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${((c / m) * (h - 2)).toFixed(1)}" fill="${color}" opacity=".8" rx="1"/>`).join("")}</svg>`;
}

/** Horizontal box plot with optional target marker. */
export function boxPlot(d, { w = 520, h = 70, color = "#7c8cff", target = null, unit = "" } = {}) {
  if (d.min === null) return "";
  const lo = Math.min(d.min, target ?? d.min), hi = Math.max(d.max, target ?? d.max);
  const pad = 14, x = (v) => pad + ((v - lo) / (hi - lo || 1)) * (w - pad * 2);
  const cy = 30;
  const iqr = d.q75 - d.q25;
  const wl = Math.max(d.min, d.q25 - 1.5 * iqr), wh = Math.min(d.max, d.q75 + 1.5 * iqr);
  const t = target !== null ? `<line x1="${x(target)}" x2="${x(target)}" y1="8" y2="52" stroke="#34d399" stroke-dasharray="4 3"/><text x="${x(target)}" y="66" fill="#34d399" font-size="10.5" text-anchor="middle">target ${fmt(target)}</text>` : "";
  return `<svg width="100%" viewBox="0 0 ${w} ${h}" class="boxplot">
    <line x1="${x(wl)}" x2="${x(wh)}" y1="${cy}" y2="${cy}" stroke="#5c6478"/>
    <line x1="${x(wl)}" x2="${x(wl)}" y1="${cy - 8}" y2="${cy + 8}" stroke="#5c6478"/><line x1="${x(wh)}" x2="${x(wh)}" y1="${cy - 8}" y2="${cy + 8}" stroke="#5c6478"/>
    <rect x="${x(d.q25)}" y="${cy - 13}" width="${Math.max(2, x(d.q75) - x(d.q25))}" height="26" rx="5" fill="${color}" fill-opacity=".28" stroke="${color}"/>
    <line x1="${x(d.median)}" x2="${x(d.median)}" y1="${cy - 13}" y2="${cy + 13}" stroke="#fff" stroke-width="2"/>
    ${d.min < wl ? `<circle cx="${x(d.min)}" cy="${cy}" r="3" fill="none" stroke="#ff5c7a"/>` : ""}${d.max > wh ? `<circle cx="${x(d.max)}" cy="${cy}" r="3" fill="none" stroke="#ff5c7a"/>` : ""}
    <text x="${x(d.q25)}" y="12" fill="#8b93a7" font-size="10.5" text-anchor="middle">Q1 ${fmt(d.q25)}</text>
    <text x="${x(d.median)}" y="${cy + 28}" fill="#e7e9ef" font-size="10.5" text-anchor="middle">median ${fmt(d.median)} ${esc(unit)}</text>
    <text x="${x(d.q75)}" y="12" fill="#8b93a7" font-size="10.5" text-anchor="middle">Q3 ${fmt(d.q75)}</text>
    ${t}</svg>`;
}

/**
 * GitHub-style calendar heatmap. dates: ISO strings (contiguous); values: number|null; colorFn(v)->css.
 * Returns HTML; cells carry data-date for click handling.
 */
export function calendar(dates, values, { colorFn, tipFn, cell = 14, gap = 3, selected = null } = {}) {
  if (!dates.length) return "";
  const first = parseISO(dates[0]);
  const offset = (first.getDay() + 6) % 7; // Monday = 0
  const cols = Math.ceil((dates.length + offset) / 7);
  const W = 30 + cols * (cell + gap), H = 18 + 7 * (cell + gap);
  let svg = "", lastMonth = -1, lastX = -99;
  dates.forEach((ds, i) => {
    const k = i + offset, c = Math.floor(k / 7), r = k % 7;
    const x = 30 + c * (cell + gap), y = 18 + r * (cell + gap);
    const d = parseISO(ds);
    if ((r === 0 || i === 0) && d.getMonth() !== lastMonth) {
      lastMonth = d.getMonth();
      if (x - lastX >= 30) { svg += `<text x="${x}" y="11" class="cal-m">${d.toLocaleDateString("en-GB", { month: "short" })}</text>`; lastX = x; }
    }
    svg += `<rect class="cal-cell${selected === ds ? " sel" : ""}" data-date="${ds}" x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" fill="${colorFn(values[i])}" data-tip="${esc(tipFn ? tipFn(ds, values[i]) : ds)}"/>`;
  });
  ["Mon", "", "Wed", "", "Fri", "", "Sun"].forEach((l, r) => { if (l) svg += `<text x="0" y="${18 + r * (cell + gap) + cell - 3}" class="cal-d">${l}</text>`; });
  return `<svg class="calendar" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${svg}</svg>`;
}

/** Simple least-squares line through points [{x,y}]. */
export function ols(points) {
  const n = points.length; if (n < 3) return null;
  const mx = points.reduce((s, p) => s + p.x, 0) / n, my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  points.forEach((p) => { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; });
  if (!sxx) return null;
  const b = sxy / sxx;
  return { slope: b, intercept: my - b * mx, r: syy ? sxy / Math.sqrt(sxx * syy) : 0 };
}

export const unitSteps = (unit, target) => {
  const u = (unit || "").toLowerCase();
  if (u === "minutes") return [5, 15, 30];
  if (u === "hours") return [0.5, 1, 2];
  if (u === "hrs") return [0.5, 1];
  if (u === "pages") return [5, 10, 25];
  if (u === "reps") return [10, 25, 50];
  if (u === "words") return [5, 10, 20];
  const t = Number(target) || 10;
  return t >= 50 ? [5, 10, 25] : t >= 10 ? [1, 5, 10] : [1, 2];
};
