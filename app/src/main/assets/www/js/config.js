/**
 * Río Pinto Coach · Configuración
 * v5.4.400 · Configuración unificada desde Preparar y Entrenamiento.
 */
import { $, getSetting, hasNativeAndroid, state } from "./core.js";
import { startGps, stopGps } from "./gps.js";
import { startCadencePulse, stopCadencePulse } from "./media.js";
import { stopPhaseMusic, switchPhaseMusic, updateMusicLibraryStatus } from "./music.js";
import { updatePhaseTargets, updateTrainingUI } from "./training.js";

const TOGGLE_SETTINGS = [
  ["gps", "gpsEnabled"],
  ["warningEnabled", "warningEnabled"],
  ["voiceEnabled", "voiceEnabled"],
  ["cadenceEnabled", "cadenceEnabled"],
  ["musicEnabled", "musicEnabled"],
];

const VOLUME_SETTINGS = ["warningVolume", "voiceVolume", "cadenceVolume", "musicVolume"];

export function bindConfigEvents() {
  $("#configButton").addEventListener("click", openConfig);
  $("#prepareConfigButton")?.addEventListener("click", openConfig);
  $("#autoCadenceButton")?.addEventListener("click", () => {
    $("#cadenceOverride").value = "";
  });
  $("#saveConfigButton").addEventListener("click", saveConfig);
  VOLUME_SETTINGS.forEach(id => $("#" + id).addEventListener("input", updateVolumeOutputs));
}

export function openConfig() {
  $("#maxHr").value = state.session?.maxHr ?? getSetting("maxHr");
  $("#cadenceOverride").value = state.session?.cadenceOverride ?? getSetting("cadenceOverride");

  TOGGLE_SETTINGS.forEach(([key, id]) => {
    $("#" + id).checked = state.session?.[key] ?? getSetting(key);
  });

  VOLUME_SETTINGS.forEach(key => {
    $("#" + key).value = state.session?.[key] ?? getSetting(key);
  });

  updateVolumeOutputs();
  updateMusicLibraryStatus();
  $("#configDialog").showModal();
}

export function updateVolumeOutputs() {
  VOLUME_SETTINGS.forEach(key => {
    $("#" + key + "Out").textContent = `${Math.round(Number($("#" + key).value) * 100)}%`;
  });
}

export function saveConfig(event) {
  event.preventDefault();

  const values = {
    maxHr: Number($("#maxHr").value) || 185,
    gps: $("#gpsEnabled").checked,
    warningEnabled: $("#warningEnabled").checked,
    voiceEnabled: $("#voiceEnabled").checked,
    cadenceEnabled: $("#cadenceEnabled").checked,
    musicEnabled: $("#musicEnabled").checked,
    warningVolume: Number($("#warningVolume").value),
    voiceVolume: Number($("#voiceVolume").value),
    cadenceVolume: Number($("#cadenceVolume").value),
    musicVolume: Number($("#musicVolume").value),
    cadenceOverride: $("#cadenceOverride").value,
  };

  Object.entries(values).forEach(([key, value]) => {
    localStorage.setItem(`rpc.${key}`, String(value));
  });

  const session = state.session;
  if (session) {
    const previousGps = session.gps;
    Object.assign(session, values);
    updatePhaseTargets(session.phases[session.phaseIndex]);

    if (session.nativeManaged && hasNativeAndroid()) {
      try {
        window.AndroidNative.updateTrainingSettings(JSON.stringify({
          gpsEnabled: values.gps,
          voiceEnabled: values.voiceEnabled,
          voiceVolume: values.voiceVolume,
          musicVolume: values.musicVolume,
        }));
      } catch {}
    } else {
      if (!values.gps) stopGps();
      else if (!previousGps) startGps();
    }

    if (!values.cadenceEnabled) stopCadencePulse();
    else if (!session.paused && !session.transition) startCadencePulse();

    if (!values.musicEnabled) stopPhaseMusic();
    else switchPhaseMusic(session.phases[session.phaseIndex]);

    updateTrainingUI();
  }

  $("#configDialog").close();
}
