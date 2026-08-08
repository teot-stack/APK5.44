/**
 * Río Pinto Coach · Sesión de entrenamiento
 * v5.4.400 · Métricas acreditables, control musical persistente y voz repetible.
 */
import { $, cleanPhaseName, formatClock, getSetting, hasNativeAndroid, hrTarget, parseDurationSeconds, state, zoneColor } from "./core.js";
import { expandPhases, getPhases, showView } from "./plan.js";
import { beep, handleWarningBeep, phaseSpeechText, speakPhase, startCadencePulse, stopCadencePulse, unlockAudio } from "./media.js";
import { choosePhaseTrack, phaseQueue, resetMusicInteraction, saveCurrentMusicPosition, stopPhaseMusic, switchPhaseMusic } from "./music.js";
import { resetGpsDistanceAnchor, startGps, stopGps } from "./gps.js";
import { averageSessionHr, averageSessionSpeed } from "./metrics.js";
import { renderProgressCard, saveTrainingRecord } from "./history.js";
import { releaseWakeLock, requestWakeLock } from "./platform.js";

const TRANSITION_SECONDS = 10;

export function bindTrainingEvents() {
  $("#startButton").addEventListener("click", startTraining);
  $("#stageClockButton").addEventListener("click", toggleStageClock);
  $("#pauseButton").addEventListener("click", togglePause);
  $("#finishButton").addEventListener("click", () => $("#finishDialog").showModal());
  $("#confirmFinish").addEventListener("click", finishTraining);
  $("#saveFinish").addEventListener("click", saveAndFinish);
  $("#previousPhaseButton").addEventListener("click", () => changePhaseManually(-1));
  $("#nextPhaseButton").addEventListener("click", () => changePhaseManually(1));
  $("#currentStageCard").addEventListener("click", replayCurrentPhaseDescription);
  setupTrainingSwipe();
}

export function buildSession() {
  state.phaseTrackAssignments.clear();
  state.musicPositions.clear();
  state.phaseTrackQueues.clear();
  state.musicUsedByPhase.clear();
  state.currentMusicKey = null;
  resetMusicInteraction();

  const phases = expandPhases(getPhases()).map((phase, index) => ({
    ...phase,
    index,
    durationSeconds: parseDurationSeconds(phase.duration),
  }));
  const plannedTotal = phases.reduce((sum, phase) => sum + phase.durationSeconds, 0);

  return {
    phases,
    phaseIndex: 0,
    phaseElapsed: 0,
    totalElapsed: 0,
    plannedTotal,
    plannedSessionTotal: plannedTotal + phases.length * TRANSITION_SECONDS,
    paused: false,
    showRemaining: false,
    maxHr: getSetting("maxHr"),
    gps: getSetting("gps"),
    warningEnabled: getSetting("warningEnabled"),
    voiceEnabled: getSetting("voiceEnabled"),
    cadenceEnabled: getSetting("cadenceEnabled"),
    musicEnabled: getSetting("musicEnabled"),
    warningVolume: getSetting("warningVolume"),
    voiceVolume: getSetting("voiceVolume"),
    cadenceVolume: getSetting("cadenceVolume"),
    musicVolume: getSetting("musicVolume"),
    cadenceOverride: getSetting("cadenceOverride"),
    musicPausedByUser: false,
    distance: 0,
    elevation: 0,
    elevationAnchor: null,
    altitudeWindow: [],
    speed: 0,
    hr: 0,
    hrWeighted: 0,
    hrSampleSeconds: 0,
    finished: false,
    transition: true,
    transitionRemaining: TRANSITION_SECONDS,
    lastPosition: null,
    gpsDistanceAnchor: null,
    gpsSignalLost: false,
    lastGpsReceived: 0,
    phaseResults: phases.map(() => ({ status: "pending", elapsed: 0 })),
    nativeManaged: hasNativeAndroid(),
    nativeGpsAvailable: false,
  };
}


function nativeTrainingConfig(session) {
  return {
    transitionSeconds: TRANSITION_SECONDS,
    weekNumber: state.week?.number || 0,
    dayName: state.dayName || "",
    gpsEnabled: session.gps,
    voiceEnabled: session.voiceEnabled,
    voiceVolume: session.voiceVolume,
    musicEnabled: session.musicEnabled,
    musicVolume: session.musicVolume,
    phases: session.phases.map(phase => {
      const queue = session.musicEnabled && phase.music !== "off" ? phaseQueue(phase) : [];
      const selected = queue.length ? choosePhaseTrack(phase) : null;
      return {
        ...phase,
        name: phase.name,
        durationSeconds: phase.durationSeconds,
        voiceText: phase.voice === false ? "" : phaseSpeechText(phase),
        musicOff: !session.musicEnabled || phase.music === "off" || !queue.length,
        musicLoopSingle: Boolean(phase.musicResume),
        musicStartIndex: selected ? Math.max(0, queue.findIndex(track => track.name === selected.name)) : 0,
        musicQueue: queue.map(track => ({ uri: track.nativeUri, name: track.name })).filter(track => track.uri),
      };
    }),
  };
}

function startNativeTraining(session) {
  if (!session.nativeManaged) return;
  try { window.AndroidNative.startTrainingSession(JSON.stringify(nativeTrainingConfig(session))); }
  catch (error) { console.warn("No se pudo iniciar el servicio nativo", error); session.nativeManaged = false; }
}

function syncNativeTrainingState() {
  const session = state.session;
  if (!session?.nativeManaged) return false;
  let snapshot;
  try { snapshot = JSON.parse(window.AndroidNative.getTrainingSnapshot() || "{}"); }
  catch { return false; }
  if (!snapshot || snapshot.running === false && !snapshot.finished) return false;

  const previousIndex = session.phaseIndex;
  const previousTransition = session.transition;
  const previousPaused = session.paused;

  const nextIndex = Math.max(0, Math.min(session.phases.length - 1, Number(snapshot.phaseIndex) || 0));
  if (Array.isArray(snapshot.phaseResults)) {
    session.phaseResults = session.phases.map((phase, index) => ({
      status: snapshot.phaseResults[index]?.status || "pending",
      elapsed: Math.max(0, Number(snapshot.phaseResults[index]?.elapsed) || 0),
    }));
  } else if (nextIndex > previousIndex) {
    for (let i = previousIndex; i < nextIndex; i++) {
      const result = session.phaseResults[i];
      if (result && result.status === "pending") {
        result.status = "completed";
        result.elapsed = session.phases[i].durationSeconds;
      }
    }
  }

  session.phaseIndex = nextIndex;
  session.phaseElapsed = Math.max(0, Number(snapshot.phaseElapsed) || 0);
  session.totalElapsed = Math.max(0, Number(snapshot.totalElapsed) || 0);
  session.transition = Boolean(snapshot.transition);
  session.transitionRemaining = Math.max(0, Number(snapshot.transitionRemaining) || 0);
  session.paused = Boolean(snapshot.paused);
  session.finished = Boolean(snapshot.finished);
  session.distance = Math.max(0, Number(snapshot.distance) || 0);
  session.elevation = Math.max(0, Number(snapshot.elevation) || 0);
  session.speed = Math.max(0, Number(snapshot.speed) || 0);
  session.nativeGpsAvailable = Boolean(snapshot.hasGps);

  if (session.phaseIndex !== previousIndex) {
    updatePhaseTargets(session.phases[session.phaseIndex]);
  }
  $("#trainingView").classList.toggle("is-transition", session.transition);

  if (session.paused !== previousPaused) {
    $("#pauseButton").textContent = session.paused ? "Continuar" : "Pausa";
    $("#pauseButton").classList.toggle("is-paused", session.paused);
  }
  if (session.finished) {
    stopCadencePulse();
    $("#pauseButton").textContent = "Completado";
    $("#pauseButton").disabled = true;
  } else if (!session.paused && previousTransition && !session.transition) {
    startCadencePulse();
  } else if (session.transition || session.paused) {
    stopCadencePulse();
  }
  return true;
}


export function restoreNativeTrainingSession() {
  if (!hasNativeAndroid() || state.session) return false;
  let snapshot, config;
  try {
    snapshot = JSON.parse(window.AndroidNative.getTrainingSnapshot() || "{}");
    config = JSON.parse(window.AndroidNative.getStoredTrainingConfig() || "{}");
  } catch { return false; }
  if ((!snapshot?.running && !snapshot?.finished) || !Array.isArray(config?.phases) || !config.phases.length) return false;

  const session = buildSession();
  session.phases = config.phases.map((phase, index) => ({
    ...phase,
    index,
    durationSeconds: Math.max(1, Number(phase.durationSeconds) || parseDurationSeconds(phase.duration || "")),
  }));
  session.plannedTotal = session.phases.reduce((sum, phase) => sum + phase.durationSeconds, 0);
  session.plannedSessionTotal = session.plannedTotal + session.phases.length * (Number(config.transitionSeconds) || TRANSITION_SECONDS);
  session.gps = config.gpsEnabled ?? session.gps;
  session.voiceEnabled = config.voiceEnabled ?? session.voiceEnabled;
  session.voiceVolume = Number(config.voiceVolume ?? session.voiceVolume);
  session.musicVolume = Number(config.musicVolume ?? session.musicVolume);
  session.phaseResults = session.phases.map(() => ({ status: "pending", elapsed: 0 }));
  session.nativeManaged = true;
  state.session = session;
  if (config.dayName) state.dayName = config.dayName;
  if (config.weekNumber && state.week) state.week = { ...state.week, number: config.weekNumber };
  syncNativeTrainingState();
  state.trainingViewMode = 0;
  setTrainingView(0);
  renderTrainingStatic();
  showView("training");
  history.replaceState({ training: true }, "", "#entrenamiento");
  $("#pauseButton").disabled = false;
  $("#pauseButton").textContent = session.paused ? "Continuar" : "Pausa";
  $("#pauseButton").classList.toggle("is-paused", session.paused);
  clearInterval(state.timer);
  state.timer = setInterval(tick, 200);
  updateTrainingUI();
  requestWakeLock();
  return true;
}

export async function startTraining() {
  state.session = buildSession();
  startNativeTraining(state.session);
  state.trainingViewMode = 0;
  setTrainingView(0);
  renderTrainingStatic();
  showView("training");
  history.replaceState({ training: true }, "", "#entrenamiento");
  await unlockAudio();
  if (state.session.gps && !state.session.nativeManaged) startGps();
  beginTransition();
  await requestWakeLock();
  state.lastTick = Date.now();
  clearInterval(state.timer);
  state.timer = setInterval(tick, 200);
}

export function renderTrainingStatic() {
  const session = state.session;
  $("#liveWeekDay").textContent = `SEMANA ${state.week.number} · ${state.dayName.toUpperCase()}`;
  updatePhaseTargets(session.phases[session.phaseIndex]);
}

export function updatePhaseTargets(phase) {
  const session = state.session;
  const zone = phase.zone || state.day.zone || "—";
  const cadence = phase.cadence || "Cadencia libre";
  const cadenceDisplay = /^cadencia libre$/i.test(String(cadence).trim()) ? "Libre" : cadence;

  document.documentElement.style.setProperty("--zone-color", zoneColor(zone));
  $("#targetTime").textContent = compactDuration(phase.duration, phase.durationSeconds);
  $("#targetZone").textContent = zone;
  $("#targetCadence").textContent = cadenceDisplay;
  $("#targetHr").textContent = phase.hr && phase.hr !== "Según zona"
    ? phase.hr
    : hrTarget(zone, session.maxHr);
  $("#currentPhaseName").textContent = cleanPhaseName(phase.name);
  $("#livePhaseCounter").textContent = `ETAPA ${phase.index + 1}/${session.phases.length}`;

  stopCadencePulse();
  if (!session.paused && !session.transition) startCadencePulse();
  switchPhaseMusic(phase);
}

export function compactDuration(raw, seconds) {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return seconds % 60 ? formatClock(seconds, false) : `${seconds / 60} min`;
  return raw || formatClock(seconds, false);
}

/**
 * Usa tiempo real transcurrido y lo distribuye entre preparación y etapas.
 * Una pausa es la única situación que excluye tiempo de las métricas acumuladas.
 */
export function tick() {
  const session = state.session;
  if (!session) return;
  if (session.nativeManaged) {
    syncNativeTrainingState();
    updateTrainingUI();
    return;
  }

  const now = Date.now();
  const elapsed = Math.max(0, (now - state.lastTick) / 1000);
  state.lastTick = now;
  if (session.finished) return;

  if (session.paused) {
    updateTrainingUI();
    return;
  }

  consumeSessionTime(elapsed);
  updateTrainingUI();
}

export function consumeSessionTime(elapsed) {
  const session = state.session;
  let pending = Math.max(0, elapsed);

  while (session && pending > 0 && !session.paused && !session.finished) {
    if (session.transition) {
      const step = Math.min(pending, Math.max(0, session.transitionRemaining));
      session.transitionRemaining -= step;
      session.totalElapsed += step;
      accumulateActiveMetrics(step);
      pending -= step;

      if (session.transitionRemaining <= 0.0001) startActivePhase();
      continue;
    }

    const phase = session.phases[session.phaseIndex];
    const remaining = Math.max(0, phase.durationSeconds - session.phaseElapsed);
    const step = Math.min(pending, remaining);
    session.phaseElapsed += step;
    session.totalElapsed += step;
    accumulateActiveMetrics(step);
    pending -= step;

    handleWarningBeep(Math.max(0, phase.durationSeconds - session.phaseElapsed));

    if (session.phaseElapsed >= phase.durationSeconds - 0.0001) advancePhase();
  }
}

function accumulateActiveMetrics(dt) {
  const session = state.session;
  if (!session || dt <= 0) return;

  if (session.hr > 0) {
    session.hrWeighted += session.hr * dt;
    session.hrSampleSeconds += dt;
  }
}

export function beginTransition() {
  const session = state.session;
  session.transition = true;
  session.transitionRemaining = TRANSITION_SECONDS;
  session.phaseElapsed = 0;
  state.lastWarningSecond = null;
  $("#trainingView").classList.add("is-transition");
  stopCadencePulse();
  if (!session.nativeManaged) speakPhase(session.phases[session.phaseIndex]);
  updateTrainingUI();
}

export function startActivePhase() {
  const session = state.session;
  session.transition = false;
  session.transitionRemaining = 0;
  session.phaseElapsed = 0;
  $("#trainingView").classList.remove("is-transition");
  beep(900, .16, session.warningVolume);
  startCadencePulse();
}

export function completeCurrentPhase() {
  const session = state.session;
  if (!session) return;

  const phase = session.phases[session.phaseIndex];
  const result = session.phaseResults[session.phaseIndex];
  if (result && result.status !== "completed") {
    result.status = "completed";
    result.elapsed = phase.durationSeconds;
  }
}

export function advancePhase() {
  const session = state.session;
  completeCurrentPhase();

  if (session.phaseIndex >= session.phases.length - 1) {
    session.paused = true;
    session.finished = true;
    stopCadencePulse();
    stopGps();
    $("#pauseButton").textContent = "Completado";
    $("#pauseButton").disabled = true;
    updateTrainingUI();
    return;
  }

  session.phaseIndex++;
  updatePhaseTargets(session.phases[session.phaseIndex]);
  beginTransition();
  if (navigator.vibrate) navigator.vibrate([180, 100, 180]);
}

export function changePhaseManually(delta) {
  let session = state.session;
  if (!session || session.finished) return;

  if (!session.paused && !session.nativeManaged) tick();
  session = state.session;
  if (!session || session.finished) return;

  const next = session.phaseIndex + delta;
  if (next < 0 || next >= session.phases.length) return;

  const currentResult = session.phaseResults[session.phaseIndex];
  if (currentResult && currentResult.status !== "completed") {
    currentResult.status = "skipped";
    currentResult.elapsed = Math.min(
      session.phaseElapsed,
      session.phases[session.phaseIndex].durationSeconds,
    );
  }

  stopCadencePulse();
  saveCurrentMusicPosition();
  if (session.nativeManaged) {
    try { window.AndroidNative.changeTrainingPhase(next); } catch {}
  }
  session.phaseIndex = next;
  session.phaseElapsed = 0;
  session.transition = false;
  session.transitionRemaining = 0;
  updatePhaseTargets(session.phases[session.phaseIndex]);
  beginTransition();
  updateTrainingUI();
  if (navigator.vibrate) navigator.vibrate(80);
}

export function replayCurrentPhaseDescription(event) {
  if (event.target.closest("button,input,select,a,label")) return;
  const session = state.session;
  if (!session || session.finished) return;
  speakPhase(session.phases[session.phaseIndex]);
}

export function cleanDrivingDuration(phase) {
  const seconds = phase?.durationSeconds || parseDurationSeconds(phase?.duration || "");
  return seconds % 60 === 0 ? `${Math.round(seconds / 60)} min` : formatClock(seconds, false);
}

export function drivingCadence(phase) {
  const cadence = phase?.cadence || "Cadencia libre";
  return /^cadencia libre$/i.test(String(cadence).trim())
    ? "Libre"
    : String(cadence).replace(/\s*rpm/i, " rpm");
}

export function updateDrivingView() {
  const session = state.session;
  if (!session) return;

  const phase = session.phases[session.phaseIndex];
  const hasGps = session.nativeManaged ? session.nativeGpsAvailable : Boolean(session.lastPosition);
  const average = averageSessionSpeed(session);
  const progress = session.transition
    ? (TRANSITION_SECONDS - session.transitionRemaining) / TRANSITION_SECONDS * 100
    : Math.min(100, session.phaseElapsed / phase.durationSeconds * 100);

  $("#drivingPhaseName").textContent = cleanPhaseName(phase.name);
  $("#drivingPhaseMeta").textContent = `${cleanDrivingDuration(phase)} · ${drivingCadence(phase)}`;
  $("#drivingSpeed").textContent = hasGps ? session.speed.toFixed(1) : "—";
  $("#drivingDistance").textContent = session.distance.toFixed(2);
  $("#drivingAverage").textContent = session.totalElapsed > 0 ? average.toFixed(1) : "—";
  $("#drivingProgress").style.width = `${Math.max(0, progress)}%`;
  $("#previousPhaseButton").disabled = session.phaseIndex === 0;
  $("#nextPhaseButton").disabled = session.phaseIndex === session.phases.length - 1;
}

export function setTrainingView(mode) {
  state.trainingViewMode = mode ? 1 : 0;
  const driving = $("#drivingView");
  const dots = [...document.querySelectorAll("#trainingPager i")];
  if (driving) driving.hidden = state.trainingViewMode === 0;
  dots.forEach((dot, index) => dot.classList.toggle("active", index === state.trainingViewMode));
  updateDrivingView();
}

export function setupTrainingSwipe() {
  const element = $("#trainingView");
  element.addEventListener("touchstart", event => {
    const touch = event.changedTouches[0];
    state.swipeStartX = touch.clientX;
    state.swipeStartY = touch.clientY;
  }, { passive: true });

  element.addEventListener("touchend", event => {
    const touch = event.changedTouches[0];
    const dx = touch.clientX - state.swipeStartX;
    const dy = touch.clientY - state.swipeStartY;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.35) {
      setTrainingView(dx < 0 ? 1 : 0);
    }
  }, { passive: true });
}

export function updateTrainingUI() {
  const session = state.session;
  if (!session) return;

  const phase = session.phases[session.phaseIndex];
  const remaining = Math.max(0, phase.durationSeconds - session.phaseElapsed);
  const avgSpeed = averageSessionSpeed(session);
  const avgHr = averageSessionHr(session);
  const hasGps = session.nativeManaged ? session.nativeGpsAvailable : Boolean(session.lastPosition);

  $("#stageCaption").textContent = "ETAPA";
  $("#stageClock").textContent = session.transition
    ? formatClock(session.transitionRemaining, false)
    : formatClock(session.showRemaining ? remaining : session.phaseElapsed, false);
  $("#stageClockLabel").textContent = session.transition
    ? "PREPARACIÓN"
    : session.showRemaining ? "TIEMPO RESTANTE" : "TIEMPO DE ETAPA";
  $("#stageClockButton").classList.toggle("show-remaining", !session.transition && session.showRemaining);
  $("#totalClock").textContent = formatClock(session.totalElapsed, true);
  $("#stageProgress").style.width = session.transition
    ? `${(TRANSITION_SECONDS - session.transitionRemaining) / TRANSITION_SECONDS * 100}%`
    : `${Math.min(100, session.phaseElapsed / phase.durationSeconds * 100)}%`;
  $("#totalProgress").style.width = `${Math.min(100, session.totalElapsed / session.plannedSessionTotal * 100)}%`;

  $("#speedNow").textContent = hasGps ? session.speed.toFixed(1) : "—";
  $("#hrNow").textContent = session.hr ? session.hr : "—";
  $("#speedAvg").textContent = session.totalElapsed > 0 ? avgSpeed.toFixed(1) : "—";
  $("#distanceTotal").textContent = session.distance.toFixed(2);
  $("#elevationTotal").textContent = hasGps ? `+${Math.round(session.elevation)}` : "—";
  $("#hrAvg").textContent = avgHr > 0 ? Math.round(avgHr) : "—";

  updateDrivingView();
}

export function toggleStageClock() {
  if (!state.session) return;
  state.session.showRemaining = !state.session.showRemaining;
  updateTrainingUI();
}

export function togglePause() {
  const session = state.session;
  if (!session || session.finished) return;

  if (session.nativeManaged) {
    const nextPaused = !session.paused;
    try { window.AndroidNative.setTrainingPaused(nextPaused); } catch {}
    session.paused = nextPaused;
    $("#pauseButton").textContent = session.paused ? "Continuar" : "Pausa";
    $("#pauseButton").classList.toggle("is-paused", session.paused);
    if (session.paused) stopCadencePulse();
    else if (!session.transition) startCadencePulse();
    updateTrainingUI();
    return;
  }

  if (!session.paused) {
    tick();
    if (session.finished) return;
    session.paused = true;
    resetGpsDistanceAnchor();
  } else {
    session.paused = false;
    resetGpsDistanceAnchor();
    state.lastTick = Date.now();
  }

  $("#pauseButton").textContent = session.paused ? "Continuar" : "Pausa";
  $("#pauseButton").classList.toggle("is-paused", session.paused);
  if (session.paused) stopCadencePulse();
  else if (!session.transition) startCadencePulse();
  updateTrainingUI();
}

export function saveAndFinish() {
  if (state.session && !state.session.paused && !state.session.finished) tick();
  saveTrainingRecord();
  finishTraining();
}

export function finishTraining() {
  if (state.session?.nativeManaged) {
    try { window.AndroidNative.stopTrainingSession(); } catch {}
  }
  clearInterval(state.timer);
  state.timer = null;
  stopCadencePulse();
  resetMusicInteraction();
  stopPhaseMusic();
  stopGps();
  releaseWakeLock();
  if (!hasNativeAndroid()) window.speechSynthesis?.cancel();
  state.speechToken++;

  if (state.session) state.session.finished = true;
  state.session = null;
  setTrainingView(0);
  $("#pauseButton").disabled = false;
  $("#pauseButton").textContent = "Pausa";
  $("#pauseButton").classList.remove("is-paused");
  showView("home");
  renderProgressCard();
  history.replaceState(null, "", location.pathname);
}
