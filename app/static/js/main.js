/* LIFEOS – router, global shortcuts and sidebar actions. */
import { $, $$, api, closeModal, confirmDialog, destroyCharts, esc, state, toast } from "./core.js";
import { renderDashboard } from "./dashboard.js";
import { renderExplore, resetExploreCharts } from "./explore.js";
import { renderTrack, quickLog } from "./track.js";
import { renderGoals } from "./goals.js";
import { renderAnalytics } from "./analytics.js";
import { renderReports } from "./reports.js";

const routes = { dashboard: renderDashboard, explore: renderExplore, track: renderTrack, goals: renderGoals, analytics: renderAnalytics, reports: renderReports };
const ORDER = ["dashboard", "explore", "track", "goals", "analytics", "reports"];

async function route() {
  const [name, arg] = location.hash.replace(/^#\//, "").split("/");
  const r = routes[name] ? name : "dashboard";
  $$("#nav a[data-route]").forEach((a) => a.classList.toggle("active", a.dataset.route === r));
  destroyCharts(); resetExploreCharts();
  document.onkeydown = null;
  $("#view").classList.remove("fade-in");
  $("#view").innerHTML = `<div class="grid kpis">${'<div class="skeleton"></div>'.repeat(4)}</div><div class="skeleton mt" style="height:280px"></div>`;
  try {
    await routes[r](arg);
    void $("#view").offsetWidth; $("#view").classList.add("fade-in");
  } catch (err) {
    console.error(err);
    $("#view").innerHTML = `<div class="card empty"><h3>Something went wrong</h3><p>${esc(err.message)}</p></div>`;
  }
}
window.addEventListener("hashchange", route);

// modal close (backdrop, ✕, [data-close], Esc)
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal" || e.target.closest("[data-close]")) closeModal(); });

// global shortcuts
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "Escape") return closeModal();
  if (!$("#modal").hidden) return;
  if (e.key === "l" || e.key === "L") { e.preventDefault(); quickLog(); }
  if (/^[1-6]$/.test(e.key)) location.hash = `#/${ORDER[Number(e.key) - 1]}`;
  if (e.key === "?") showShortcuts();
});
document.addEventListener("click", (e) => { if (e.target.closest("[data-quicklog]")) quickLog(); });

function showShortcuts() {
  import("./core.js").then(({ openModal }) => openModal("Keyboard shortcuts", `<div class="shortcuts">
    <div><kbd>L</kbd> Quick log today</div><div><kbd>1</kbd>–<kbd>6</kbd> Jump to page</div>
    <div><kbd>←</kbd> <kbd>→</kbd> Previous / next day (Track)</div><div><kbd>Esc</kbd> Close dialog</div><div><kbd>?</kbd> This help</div></div>`));
}
$("#btn-help").onclick = showShortcuts;

// sidebar actions
$("#btn-export").onclick = () => (location.href = "/api/v1/export/entries.csv");
$("#btn-reset").onclick = async () => {
  if (await confirmDialog("Reset demo data?", "This wipes everything and reloads 26 weeks of demo data.", "Reset")) {
    await api("/admin/reset-demo", { method: "POST" }); toast("Demo data restored"); route();
  }
};
$("#btn-clear").onclick = async () => {
  if (await confirmDialog("Start fresh?", "This permanently deletes all activities, entries, goals and reflections so you can track your real life. Export a CSV first if you want a copy.", "Delete everything", true)) {
    await api("/admin/clear", { method: "POST" }); toast("All clear – add your first activity"); location.hash = "#/track"; route();
  }
};

(async () => {
  state.meta = await api("/meta");
  if (!location.hash) location.hash = "#/dashboard"; else route();
})();
