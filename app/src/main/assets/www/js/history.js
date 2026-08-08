/**
 * Río Pinto Coach · Historial y progreso
 * v5.4.400 · Eliminación individual de registros y actualización inmediata.
 */
import { $, cleanPhaseName, escapeHtml, formatClock, state } from "./core.js";
import { averageSessionHr, averageSessionSpeed } from "./metrics.js";

export function bindHistoryEvents() {
  $("#progressCard").addEventListener("click", openHistory);
  $("#historyList").addEventListener("click", handleHistoryListClick);
}

export function trainingRecords() {
  try {
    return JSON.parse(localStorage.getItem("rpc.trainingRecords") || "[]");
  } catch {
    return [];
  }
}

export function totalPlannedTrainings() {
  return state.data?.weeks?.reduce((sum, week) => sum + Object.keys(week.days || {}).length, 0) || 0;
}

export function saveTrainingRecord() {
  const session = state.session;
  if (!session) return;

  const avgSpeed = averageSessionSpeed(session);
  const avgHr = averageSessionHr(session);
  const completed = session.phaseResults
    .map((result, index) => ({
      ...result,
      index,
      name: cleanPhaseName(session.phases[index].name),
      planned: session.phases[index].durationSeconds,
    }))
    .filter(result => result.status === "completed");
  const completedSeconds = completed.reduce((sum, result) => sum + result.planned, 0);

  const record = {
    id: `${Date.now()}-${state.week.number}-${state.dayName}`,
    date: new Date().toISOString(),
    week: state.week.number,
    day: state.dayName,
    title: state.day.title,
    plannedDuration: session.plannedTotal,
    actualDuration: session.totalElapsed,
    completedDuration: completedSeconds,
    completion: session.plannedTotal
      ? Math.min(100, Math.round(completedSeconds / session.plannedTotal * 100))
      : 0,
    completedPhases: completed,
    skippedPhases: session.phaseResults.filter(result => result.status === "skipped").length,
    objectives: {
      zone: state.day.zone || "—",
      cadence: state.day.cadence || "Cadencia libre",
      distance: state.day.distance || "—",
      phases: session.phases.map(phase => ({
        name: cleanPhaseName(phase.name),
        duration: phase.duration,
        zone: phase.zone,
        cadence: phase.cadence,
        hr: phase.hr,
      })),
    },
    actual: {
      distance: Number(session.distance.toFixed(2)),
      avgSpeed: Number(avgSpeed.toFixed(1)),
      elevation: Math.round(session.elevation),
      avgHr: Math.round(avgHr),
    },
  };

  const records = trainingRecords();
  records.push(record);
  localStorage.setItem("rpc.trainingRecords", JSON.stringify(records));
  renderProgressCard();
}

export function progressData() {
  const records = trainingRecords();
  const total = totalPlannedTrainings();
  const unique = new Set(
    records.filter(record => record.completion >= 100).map(record => `${record.week}-${record.day}`),
  ).size;
  const percent = total ? Math.min(100, Math.round(unique / total * 100)) : 0;
  return { records, total, unique, percent };
}

export function renderProgressCard() {
  if (!state.data || !$("#progressCard")) return;
  const data = progressData();
  $("#progressPercent").textContent = `${data.percent}%`;
  $("#progressSummary").textContent = `${data.unique} de ${data.total} entrenamientos`;
  $("#progressWeeks").textContent = `Plan de ${state.data.weeks.length} semanas`;
  $("#progressDonut").style.setProperty("--progress", data.percent);
}

function renderHistoryContents() {
  const data = progressData();
  $("#historySummary").innerHTML = `
    <strong>${data.percent}% completado</strong>
    <span>${data.unique} de ${data.total} entrenamientos del plan</span>`;

  $("#historyList").innerHTML = data.records.length
    ? [...data.records].reverse().map(record => {
      const recordId = escapeHtml(record.id || "");
      const phaseCount = record.objectives?.phases?.length || 0;
      return `
        <details class="history-record">
          <summary>
            <span>Semana ${record.week} · ${escapeHtml(record.day)}</span>
            <span class="history-summary-actions">
              <strong>${new Date(record.date).toLocaleDateString("es-AR")}</strong>
              <button class="history-delete" type="button" data-delete-record="${recordId}" aria-label="Eliminar este entrenamiento">×</button>
            </span>
          </summary>
          <div class="history-columns">
            <section>
              <h3>OBJETIVOS</h3>
              <p>Duración: ${formatClock(record.plannedDuration, true)}</p>
              <p>Zona: ${escapeHtml(record.objectives?.zone || "—")}</p>
              <p>Cadencia: ${escapeHtml(record.objectives?.cadence || "Cadencia libre")}</p>
              <p>Distancia: ${escapeHtml(record.objectives?.distance || "—")}</p>
            </section>
            <section>
              <h3>REGISTRADO</h3>
              <p>Duración: ${formatClock(record.actualDuration, true)}</p>
              <p>Cumplimiento: ${record.completion}%</p>
              <p>Etapas completadas: ${record.completedPhases?.length || 0}/${phaseCount}</p>
              <p>Etapas omitidas: ${record.skippedPhases || 0}</p>
              <p>Distancia: ${Number(record.actual?.distance || 0).toFixed(2)} km</p>
              <p>Velocidad media: ${Number(record.actual?.avgSpeed || 0).toFixed(1)} km/h</p>
              <p>Desnivel: +${Number(record.actual?.elevation || 0)} m</p>
              <p>FC media: ${record.actual?.avgHr || "—"} ppm</p>
            </section>
          </div>
        </details>`;
    }).join("")
    : '<p class="empty-history">Todavía no hay entrenamientos guardados.</p>';
}

export function openHistory() {
  renderHistoryContents();
  $("#historyDialog").showModal();
}

export function handleHistoryListClick(event) {
  const button = event.target.closest("button[data-delete-record]");
  if (!button) return;

  event.preventDefault();
  event.stopPropagation();
  const id = button.dataset.deleteRecord;
  if (!id) return;

  const record = trainingRecords().find(item => item.id === id);
  const label = record
    ? `Semana ${record.week} · ${record.day} (${new Date(record.date).toLocaleDateString("es-AR")})`
    : "este entrenamiento";

  if (!window.confirm(`¿Eliminar ${label} del historial?`)) return;

  const records = trainingRecords().filter(item => item.id !== id);
  localStorage.setItem("rpc.trainingRecords", JSON.stringify(records));
  renderProgressCard();
  renderHistoryContents();
}
