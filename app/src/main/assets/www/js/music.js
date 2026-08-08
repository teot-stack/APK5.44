/**
 * Río Pinto Coach · Música
 * v5.4.400 · Control global de pausa y cambio de pista por doble toque.
 */
import { $, escapeHtml, hasNativeAndroid, state } from "./core.js";


function applyNativeMusicLibrary(json, folderName = "") {
  try {
    const tracks = JSON.parse(json || "[]");
    state.musicLibrary = Array.isArray(tracks) ? tracks.map(track => ({
      ...track,
      name: track.name || "Tema",
      bpm: Number(track.bpm) || extractBpm(track.name || ""),
      path: track.path || track.name || "Tema",
      energy: track.energy || inferTrackEnergy(track.path || track.name || ""),
      nativeUri: track.nativeUri || "",
    })).filter(track => track.nativeUri) : [];
    state.musicDirectoryHandle = folderName ? { name: folderName, native: true } : state.musicDirectoryHandle;
    state.musicIndexedAt = state.musicLibrary.length ? new Date() : null;
    resetMusicAssignments();
    updateMusicLibraryStatus(state.musicLibrary.length ? "ok" : "");
    populatePhaseMusicSelect("auto", []);
  } catch (error) {
    console.warn("Biblioteca musical nativa inválida", error);
    updateMusicLibraryStatus("error");
  }
}

function installNativeMusicCallbacks() {
  if (!hasNativeAndroid()) return;
  window.RioPintoNative = window.RioPintoNative || {};
  window.RioPintoNative.onMusicLibrary = (json, folderName) => applyNativeMusicLibrary(json, folderName);
  window.RioPintoNative.onMusicStatus = (mode, message) => {
    const status = $("#musicLibraryStatus");
    if (status && message) status.textContent = message;
    if (mode === "error") updateMusicLibraryStatus("error");
  };
}

function nativeMusicQueueForPhase(phase, track) {
  const queue = phaseQueue(phase);
  if (!queue.length || !track) return;
  const startIndex = Math.max(0, queue.findIndex(item => item.name === track.name));
  const payload = queue.map(item => ({ uri: item.nativeUri, name: item.name })).filter(item => item.uri);
  if (!payload.length) return;
  state.currentNativeMusicTrack = track.name;
  try {
    window.AndroidNative.setMusicQueue(
      JSON.stringify(payload),
      startIndex,
      state.session.musicVolume,
      Boolean(state.session.musicPausedByUser),
      Boolean(phase.musicResume),
    );
  } catch (error) {
    console.warn("No se pudo iniciar música nativa", error);
  }
  updateMusicButton();
}

export function bindMusicEvents() {
  installNativeMusicCallbacks();
  $("#musicFiles").addEventListener("change", loadMusicLibrary);
  $("#chooseMusicFolder")?.addEventListener("click", chooseMusicFolder);
  $("#reindexMusicFolder")?.addEventListener("click", () => restoreMusicFolder(true));
  $("#phaseMusicButton").addEventListener("click", handlePhaseMusicTap);
  $("#editPhaseMusic").addEventListener("change", togglePreferredMusicFields);
}

export function populateTrackSelect(el, selected = "") {
  el.innerHTML = '<option value="">Automático</option>' + state.musicLibrary
    .map(track => `<option value="${escapeHtml(track.name)}">${escapeHtml(track.name)}</option>`)
    .join("");
  el.value = [...el.options].some(option => option.value === selected) ? selected : "";
}

export function populatePhaseMusicSelect(selected = "auto", preferences = []) {
  const mode = $("#editPhaseMusic");
  mode.value = selected === "off" ? "off" : "auto";
  [1, 2, 3].forEach((n, i) => populateTrackSelect(
    $("#editPhaseMusic" + n),
    preferences[i] || ((selected !== "auto" && selected !== "off" && i === 0) ? selected : ""),
  ));
}

export function togglePreferredMusicFields() {
  $("#preferredMusicFields").hidden = $("#editPhaseMusic").value === "off";
}

export function loadMusicLibrary(event) {
  clearMusicObjectUrls();
  state.musicLibrary = [...(event.target.files || [])].map(file => ({
    file,
    name: file.name,
    bpm: extractBpm(file.name),
    url: URL.createObjectURL(file),
    path: file.webkitRelativePath || file.name,
    energy: inferTrackEnergy(file.name),
  }));
  state.musicDirectoryHandle = null;
  state.musicIndexedAt = new Date();
  resetMusicAssignments();
  updateMusicLibraryStatus();
  populatePhaseMusicSelect("auto", []);
}

export function clearMusicObjectUrls() {
  for (const track of state.musicLibrary) {
    if (track.url) {
      try { URL.revokeObjectURL(track.url); } catch {}
    }
  }
}

export function resetMusicAssignments() {
  state.phaseTrackAssignments.clear();
  state.phaseTrackQueues.clear();
  state.musicUsedByPhase.clear();
}

export function resetMusicInteraction() {
  if (state.musicTapTimer) clearTimeout(state.musicTapTimer);
  state.musicTapTimer = null;
  state.lastMusicTap = 0;
}

export function inferTrackEnergy(text) {
  const value = String(text).toLowerCase();
  if (/recup|relax|suave|ambient|calma|chill/.test(value)) return "low";
  if (/rock|metal|power|intenso|hard|vo2|sprint/.test(value)) return "high";
  return "medium";
}

export function openMusicHandleDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("rpc-music-library", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("handles")) {
        request.result.createObjectStore("handles");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveMusicDirectoryHandle(handle) {
  try {
    const db = await openMusicHandleDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("handles", "readwrite");
      transaction.objectStore("handles").put(handle, "directory");
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (error) {
    console.warn("No se pudo guardar la carpeta musical", error);
  }
}

export async function loadMusicDirectoryHandle() {
  try {
    const db = await openMusicHandleDb();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("handles", "readonly");
      const request = transaction.objectStore("handles").get("directory");
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

export async function musicHandlePermission(handle, request = false) {
  if (!handle) return false;
  try {
    if (await handle.queryPermission({ mode: "read" }) === "granted") return true;
    if (request && await handle.requestPermission({ mode: "read" }) === "granted") return true;
  } catch {}
  return false;
}

export async function chooseMusicFolder() {
  if (hasNativeAndroid()) {
    $("#musicLibraryStatus").textContent = "Seleccione una carpeta musical en Android…";
    try { window.AndroidNative.chooseMusicFolder(); } catch { updateMusicLibraryStatus("error"); }
    return;
  }
  if (!window.showDirectoryPicker) {
    $("#musicLibraryStatus").textContent = "Este navegador no admite carpetas persistentes. Use la selección manual de canciones.";
    return;
  }

  try {
    const handle = await window.showDirectoryPicker({ mode: "read" });
    state.musicDirectoryHandle = handle;
    await saveMusicDirectoryHandle(handle);
    await indexMusicDirectory(handle, true);
  } catch (error) {
    if (error?.name !== "AbortError") {
      $("#musicLibraryStatus").textContent = "No se pudo acceder a la carpeta musical.";
    }
  }
}

export async function walkMusicDirectory(handle, prefix = "") {
  const tracks = [];
  for await (const [name, entry] of handle.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (entry.kind === "directory") {
      tracks.push(...await walkMusicDirectory(entry, path));
    } else if (entry.kind === "file" && /\.(mp3|m4a|aac|ogg|oga|wav|flac|opus)$/i.test(name)) {
      const file = await entry.getFile();
      tracks.push({
        file,
        handle: entry,
        name: file.name,
        bpm: extractBpm(file.name),
        url: URL.createObjectURL(file),
        path,
        energy: inferTrackEnergy(path),
      });
    }
  }
  return tracks;
}

export async function indexMusicDirectory(handle, requestPermission = false) {
  if (!await musicHandlePermission(handle, requestPermission)) {
    state.musicDirectoryHandle = handle;
    updateMusicLibraryStatus("permission");
    return false;
  }

  try {
    clearMusicObjectUrls();
    state.musicLibrary = await walkMusicDirectory(handle);
    state.musicDirectoryHandle = handle;
    state.musicIndexedAt = new Date();
    localStorage.setItem("rpc.musicIndexMeta", JSON.stringify({
      folder: handle.name,
      count: state.musicLibrary.length,
      at: state.musicIndexedAt.toISOString(),
    }));
    resetMusicAssignments();
    updateMusicLibraryStatus("ok");
    populatePhaseMusicSelect("auto", []);
    return true;
  } catch (error) {
    console.error(error);
    updateMusicLibraryStatus("error");
    return false;
  }
}

export async function restoreMusicFolder(requestPermission = false) {
  if (hasNativeAndroid()) {
    try {
      if (requestPermission) {
        window.AndroidNative.reindexMusicFolder();
        return true;
      }
      const json = window.AndroidNative.getMusicLibraryJson();
      const folder = window.AndroidNative.getMusicFolderName();
      applyNativeMusicLibrary(json, folder);
      return state.musicLibrary.length > 0;
    } catch {
      updateMusicLibraryStatus();
      return false;
    }
  }
  const handle = state.musicDirectoryHandle || await loadMusicDirectoryHandle();
  if (!handle) {
    updateMusicLibraryStatus();
    return false;
  }
  state.musicDirectoryHandle = handle;
  return indexMusicDirectory(handle, requestPermission);
}

export function extractBpm(name) {
  const explicit = String(name).match(/(?:^|[^0-9])(\d{2,3})\s*(?:bpm)?(?:[^0-9]|$)/i);
  const value = Number(explicit?.[1] || 0);
  return value >= 50 && value <= 200 ? value : 0;
}

export function updateMusicLibraryStatus(mode = "") {
  const status = $("#musicLibraryStatus");
  const count = $("#musicTrackCount");
  const folder = $("#musicFolderName");
  const indexed = $("#musicIndexedAt");
  const badge = $("#musicPermissionBadge");

  let meta = null;
  try { meta = JSON.parse(localStorage.getItem("rpc.musicIndexMeta") || "null"); } catch {}

  const folderName = state.musicDirectoryHandle?.name || meta?.folder || "Sin carpeta seleccionada";
  const total = state.musicLibrary.length || meta?.count || 0;
  const at = state.musicIndexedAt || (meta?.at ? new Date(meta.at) : null);

  if (folder) folder.textContent = folderName;
  if (count) count.textContent = String(total);
  if (indexed) indexed.textContent = at ? at.toLocaleString() : "—";

  if (badge) {
    badge.className = "";
    if (mode === "ok" || state.musicLibrary.length) {
      badge.textContent = "Disponible";
      badge.classList.add("ok");
    } else if (mode === "permission") {
      badge.textContent = "Autorizar";
      badge.classList.add("warn");
    } else {
      badge.textContent = "Sin acceso";
    }
  }

  if (status) {
    if (mode === "permission") {
      status.textContent = "La carpeta está recordada, pero Android requiere volver a autorizar el acceso.";
    } else if (mode === "error") {
      status.textContent = "No se pudo indexar la carpeta seleccionada.";
    } else if (state.musicLibrary.length) {
      status.textContent = `${state.musicLibrary.length} canciones disponibles para todos los entrenamientos.`;
    } else {
      status.textContent = "Seleccione una carpeta de memoria interna o tarjeta SD, o use la selección manual.";
    }
  }
}

export function musicTarget(phase) {
  const zone = (phase.zone || "").match(/Z[1-5]/)?.[0];
  const cadence = Number(phase.cadenceRpm)
    || Number(String(phase.cadence || "").match(/\d{2,3}/)?.[0])
    || 0;
  return cadence || ({ Z1: 72, Z2: 88, Z3: 106, Z4: 122, Z5: 138 }[zone] || 90);
}

export function dayMusicSeed() {
  const text = `${state.week?.number || 0}-${state.dayName || ""}`;
  return [...text].reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) >>> 0, 7);
}

export function rankedPhaseTracks(phase) {
  const target = musicTarget(phase);
  const seed = dayMusicSeed();
  const tracks = [...state.musicLibrary];
  const zone = String(phase.zone || "").toUpperCase();
  const low = /recuperaci|calma|enfri/i.test(phase.name || "") || zone === "Z1";
  const high = ["Z4", "Z5"].includes(zone) || target >= 95;
  const score = track => Math.abs((track.bpm || target) - target)
    + (low && track.energy !== "low" ? 20 : 0)
    + (high && track.energy !== "high" ? 14 : 0);

  return tracks.sort((a, b) => {
    const da = score(a);
    const db = score(b);
    if (da !== db) return da - db;
    const ai = state.musicLibrary.indexOf(a);
    const bi = state.musicLibrary.indexOf(b);
    return ((ai + seed + (phase.index || 0) * 3) % Math.max(1, tracks.length))
      - ((bi + seed + (phase.index || 0) * 3) % Math.max(1, tracks.length));
  });
}

export function musicKey(phase) {
  return phase.musicGroup || `phase-${phase.index ?? 0}`;
}


export function phaseQueue(phase) {
  const key = musicKey(phase);
  if (state.phaseTrackQueues.has(key)) return state.phaseTrackQueues.get(key);

  const preferred = (phase.musicPreferences || [])
    .map(name => state.musicLibrary.find(track => track.name === name))
    .filter(Boolean);
  const ranked = rankedPhaseTracks(phase).filter(track => !preferred.some(item => item.name === track.name));
  const queue = [...preferred, ...ranked];
  state.phaseTrackQueues.set(key, queue);
  return queue;
}

export function choosePhaseTrack(phase, advance = false) {
  if (!state.musicLibrary.length || phase.music === "off") return null;

  const key = musicKey(phase);
  const queue = phaseQueue(phase);
  if (!queue.length) return null;

  const currentName = state.phaseTrackAssignments.get(key);
  if (currentName && !advance) {
    return state.musicLibrary.find(track => track.name === currentName) || queue[0];
  }

  const used = state.musicUsedByPhase.get(key) || new Set();
  const currentIndex = Math.max(-1, queue.findIndex(track => track.name === currentName));
  let track = null;

  for (let step = 1; step <= queue.length; step++) {
    const candidate = queue[(currentIndex + step) % queue.length];
    if (!used.has(candidate.name)) {
      track = candidate;
      break;
    }
  }

  if (!track) {
    used.clear();
    track = queue[(currentIndex + 1) % queue.length];
  }

  used.add(track.name);
  state.musicUsedByPhase.set(key, used);
  state.phaseTrackAssignments.set(key, track.name);
  return track;
}

export function saveCurrentMusicPosition() {
  if (hasNativeAndroid()) {
    if (state.currentMusicKey) {
      try { state.musicPositions.set(state.currentMusicKey, window.AndroidNative.getMusicPositionMs() / 1000); } catch {}
    }
    return;
  }
  const audio = state.musicAudio;
  if (audio && state.currentMusicKey && Number.isFinite(audio.currentTime)) {
    state.musicPositions.set(state.currentMusicKey, audio.currentTime);
  }
}

function musicShouldPlay() {
  const session = state.session;
  return Boolean(session?.musicEnabled && !session.musicPausedByUser);
}

export function createMusicAudio(track, phase, resume = true) {
  const session = state.session;
  if (!session) return;

  const key = musicKey(phase);
  const audio = new Audio(track.url);
  audio.dataset.track = track.name;
  audio.loop = Boolean(phase.musicResume);
  audio.volume = session.musicVolume;
  state.musicAudio = audio;
  state.currentMusicKey = key;

  audio.addEventListener("loadedmetadata", () => {
    if (resume) {
      const saved = state.musicPositions.get(key) || 0;
      if (saved > 0 && saved < audio.duration) audio.currentTime = saved;
    }
  });
  audio.addEventListener("timeupdate", () => {
    if (Number.isFinite(audio.currentTime)) state.musicPositions.set(key, audio.currentTime);
  });
  audio.addEventListener("ended", () => {
    if (phase.musicResume) {
      audio.currentTime = 0;
      if (musicShouldPlay()) audio.play().catch(() => {});
    } else {
      playNextPhaseTrack(true);
    }
  });
  audio.addEventListener("play", updateMusicButton);
  audio.addEventListener("pause", updateMusicButton);

  if (musicShouldPlay()) audio.play().catch(() => updateMusicButton());
  updateMusicButton();
}

export function switchPhaseMusic(phase) {
  const session = state.session;
  if (hasNativeAndroid()) {
    if (!session?.musicEnabled || !state.musicLibrary.length || phase.music === "off") {
      try { window.AndroidNative.stopMusic(); } catch {}
      state.currentNativeMusicTrack = "";
      updateMusicButton();
      return;
    }
    const track = choosePhaseTrack(phase);
    if (!track) { updateMusicButton(); return; }
    state.currentMusicKey = musicKey(phase);
    nativeMusicQueueForPhase(phase, track);
    return;
  }
  if (!session?.musicEnabled) {
    stopPhaseMusic();
    return;
  }

  const track = choosePhaseTrack(phase);
  if (!track) {
    stopPhaseMusic();
    return;
  }

  const key = musicKey(phase);
  const sameTrack = state.musicAudio?.dataset.track === track.name && state.currentMusicKey === key;
  if (sameTrack) {
    state.musicAudio.volume = session.musicVolume;
    if (session.musicPausedByUser) state.musicAudio.pause();
    else if (state.musicAudio.paused) state.musicAudio.play().catch(() => {});
    updateMusicButton();
    return;
  }

  saveCurrentMusicPosition();
  stopPhaseMusic(false);
  createMusicAudio(track, phase, true);
}

export function playNextPhaseTrack(fromEnded = false) {
  if (hasNativeAndroid()) {
    try { window.AndroidNative.nextMusic(); state.currentNativeMusicTrack = window.AndroidNative.getCurrentMusicName() || state.currentNativeMusicTrack; } catch {}
    updateMusicButton();
    return;
  }
  const session = state.session;
  const phase = session?.phases?.[session.phaseIndex];
  if (!session?.musicEnabled || !phase || !state.musicLibrary.length) return;

  const key = musicKey(phase);
  if (!fromEnded) state.musicPositions.set(key, 0);
  const track = choosePhaseTrack(phase, true);
  if (!track) return;

  stopPhaseMusic(false);
  createMusicAudio(track, phase, false);
}

export function handlePhaseMusicTap() {
  const session = state.session;
  if (!session?.musicEnabled) return;

  const now = performance.now();
  if (now - state.lastMusicTap < 340) {
    clearTimeout(state.musicTapTimer);
    state.musicTapTimer = null;
    state.lastMusicTap = 0;
    // Cambia de tema sin alterar la pausa global elegida por el usuario.
    playNextPhaseTrack(false);
    return;
  }

  state.lastMusicTap = now;
  clearTimeout(state.musicTapTimer);
  state.musicTapTimer = setTimeout(() => {
    state.musicTapTimer = null;
    state.lastMusicTap = 0;

    session.musicPausedByUser = !session.musicPausedByUser;
    if (hasNativeAndroid()) {
      try { session.musicPausedByUser ? window.AndroidNative.pauseMusic() : window.AndroidNative.resumeMusic(); } catch {}
      updateMusicButton();
      return;
    }
    if (session.musicPausedByUser) {
      state.musicAudio?.pause();
    } else if (!state.musicAudio) {
      switchPhaseMusic(session.phases[session.phaseIndex]);
    } else {
      state.musicAudio.volume = session.musicVolume;
      state.musicAudio.play().catch(() => {});
    }
    updateMusicButton();
  }, 300);
}

export function updateMusicButton() {
  const button = $("#phaseMusicButton");
  if (!button) return;

  const session = state.session;
  const unavailable = !session?.musicEnabled || !state.musicLibrary.length;
  let playing = false;
  if (hasNativeAndroid()) {
    try { playing = Boolean(window.AndroidNative.isMusicPlaying()) && !session?.musicPausedByUser; } catch {}
  } else {
    playing = Boolean(state.musicAudio && !state.musicAudio.paused && !session?.musicPausedByUser);
  }
  button.disabled = unavailable;
  button.textContent = playing ? "Ⅱ" : "▶";
  button.classList.toggle("is-user-paused", Boolean(session?.musicPausedByUser));
  button.setAttribute("aria-label", playing
    ? "Pausar música; doble toque para siguiente tema"
    : "Reanudar música; doble toque para siguiente tema");
}

export function stopPhaseMusic(clearSource = true) {
  if (hasNativeAndroid()) {
    try { window.AndroidNative.stopMusic(); } catch {}
    state.currentNativeMusicTrack = "";
    state.currentMusicKey = null;
    updateMusicButton();
    return;
  }
  if (state.musicAudio) {
    saveCurrentMusicPosition();
    state.musicAudio.pause();
    if (clearSource) state.musicAudio.src = "";
    state.musicAudio = null;
  }
  state.currentMusicKey = null;
  updateMusicButton();
}

export function muteMusicForVoice() {
  if (hasNativeAndroid()) return;
  if (state.musicAudio) {
    state.musicAudio.dataset.preVoiceVolume = String(state.musicAudio.volume);
    state.musicAudio.volume = 0;
  }
}

export function restoreMusicAfterVoice(token) {
  if (hasNativeAndroid()) return;
  if (token !== state.speechToken) return;
  const audio = state.musicAudio;
  const session = state.session;
  if (audio && session?.musicEnabled) audio.volume = session.musicVolume;
}
