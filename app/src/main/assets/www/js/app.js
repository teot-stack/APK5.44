/**
 * Río Pinto Coach · Punto de entrada
 * v5.4.400 · Línea PWA consolidada previa a migración Android.
 */

import { $, escapeHtml, state } from "./core.js";
import { bindMusicEvents, restoreMusicFolder, updateMusicLibraryStatus } from "./music.js";
import { bindPlanEvents, closePrepare, initializePlan, openPrepare } from "./plan.js";
import { bindTrainingEvents, restoreNativeTrainingSession } from "./training.js";
import { bindConfigEvents } from "./config.js";
import { bindHistoryEvents, renderProgressCard } from "./history.js";
import { requestWakeLock, setupInstallPrompt, setupPullToRefreshGuard } from "./platform.js";
import { startGps } from "./gps.js";

async function loadPlanData() {
  const response = await fetch("./data/entrenamiento.json");
  if (!response.ok) throw new Error(`No se pudo cargar el plan (${response.status})`);
  return response.json();
}

function bindApplicationEvents() {
  bindPlanEvents();
  bindTrainingEvents();
  bindConfigEvents();
  bindMusicEvents();
  bindHistoryEvents();
  setupPullToRefreshGuard();

  document.addEventListener("visibilitychange", () => {
    const session = state.session;
    if (document.visibilityState !== "visible" || !session || session.finished) return;

    requestWakeLock();
    if (session.gps && Date.now() - session.lastGpsReceived > 30000) {
      startGps({ preserveTracking: true });
    }
  });

  addEventListener("popstate", () => {
    if (!location.hash && state.session) {
      $("#finishDialog").showModal();
    } else if (!location.hash) {
      closePrepare();
    }
  });
}

async function init() {
  bindApplicationEvents();

  // Recupera la carpeta musical sin bloquear el arranque de la aplicación.
  restoreMusicFolder(false).catch(() => updateMusicLibraryStatus());

  const data = await loadPlanData();
  initializePlan(data);

  const restoredNativeTraining = restoreNativeTrainingSession();
  if (!restoredNativeTraining && (localStorage.getItem("rpc.view") || "home") === "prepare") {
    openPrepare(false);
  }

  renderProgressCard();
  setupInstallPrompt();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

init().catch(error => {
  document.body.innerHTML = `
    <main class="app">
      <section class="card">
        <h2>Error</h2>
        <p>${escapeHtml(error.message)}</p>
      </section>
    </main>`;
});
