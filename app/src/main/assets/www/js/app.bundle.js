/** Río Pinto Coach v5.4.400 · bundle clásico generado desde módulos fuente. */


/* ===== core.js ===== */
/**
 * Río Pinto Coach · Núcleo compartido
 * Estado, constantes, configuración y utilidades puras.
 */

const $ = selector => document.querySelector(selector);

const state = {
  data: null,
  week: null,
  day: null,
  dayName: "",
  session: null,

  timer: null,
  lastTick: 0,
  gpsWatch: null,
  audio: null,
  cadenceTimer: null,
  lastWarningSecond: null,
  deferredInstall: null,
  wakeLock: null,

  musicAudio: null,
  musicLibrary: [],
  musicDirectoryHandle: null,
  musicIndexedAt: null,
  phaseTrackAssignments: new Map(),
  musicPositions: new Map(),
  phaseTrackQueues: new Map(),
  musicUsedByPhase: new Map(),
  currentMusicKey: null,
  musicTapTimer: null,
  lastMusicTap: 0,
  currentNativeMusicTrack: "",

  speechToken: 0,
  trainingViewMode: 0,
  swipeStartX: 0,
  swipeStartY: 0,
};

const ZONE_COLORS = {
  Z1: "#72a7d8",
  Z2: "#58c472",
  Z3: "#e0c23b",
  Z4: "#ff9b45",
  Z5: "#ef6262",
};

const ZONE_HR_PERCENT = {
  Z1: [50, 60],
  Z2: [60, 70],
  Z3: [70, 80],
  Z4: [80, 90],
  Z5: [90, 100],
};

const DEFAULT_SETTINGS = {
  maxHr: 185,
  gps: true,
  warningEnabled: true,
  voiceEnabled: true,
  cadenceEnabled: true,
  musicEnabled: true,
  warningVolume: 0.8,
  voiceVolume: 0.9,
  cadenceVolume: 0.45,
  musicVolume: 0.35,
  cadenceOverride: "",
};

function zoneColor(zone) {
  const key = String(zone || "").match(/Z[1-5]/)?.[0];
  return ZONE_COLORS[key] || "#718096";
}

function getSetting(key) {
  const fallback = DEFAULT_SETTINGS[key];
  const raw = localStorage.getItem(`rpc.${key}`);
  if (raw === null) return fallback;
  if (typeof fallback === "boolean") return raw === "true";
  if (typeof fallback === "number") return Number(raw);
  return raw;
}

function hrTarget(zone, maxHr) {
  const key = String(zone || "").match(/Z[1-5]/)?.[0];
  if (!key) return "—";
  const [low, high] = ZONE_HR_PERCENT[key];
  return `${Math.round(maxHr * low / 100)}–${Math.round(maxHr * high / 100)}`;
}

function parseDurationSeconds(text) {
  if (!text) return 0;
  const normalized = String(text).toLowerCase().replace(/,/g, ".");
  const hours = Number(normalized.match(/(\d+(?:\.\d+)?)\s*h/)?.[1] || 0);
  const minutes = Number(normalized.match(/(\d+(?:\.\d+)?)\s*min/)?.[1] || 0);
  const seconds = Number(normalized.match(/(\d+(?:\.\d+)?)\s*s(?:eg)?/)?.[1] || 0);
  let total = hours * 3600 + minutes * 60 + seconds;
  if (!total) total = Number(normalized.match(/\d+(?:\.\d+)?/)?.[0] || 0) * 60;
  return Math.max(1, Math.round(total));
}

const pad = value => String(value).padStart(2, "0");

function formatClock(seconds, withHours) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return withHours
    ? `${pad(hours)}:${pad(minutes)}:${pad(secs)}`
    : `${pad(Math.floor(total / 60))}:${pad(secs)}`;
}

function cleanPhaseName(name) {
  return String(name || "Etapa")
    .replace(/\s*\([^)]*\b(?:\d+(?:[.,]\d+)?(?:\s*[-–a]\s*\d+(?:[.,]\d+)?)?\s*)?rpm\b[^)]*\)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[char]);
}

function hasNativeAndroid() {
  try { return Boolean(window.AndroidNative?.isNative?.()); } catch { return false; }
}


/* ===== metrics.js ===== */
/**
 * Río Pinto Coach · Métricas de sesión
 * Reglas únicas para tiempo, distancia y promedios acreditables.
 */

function isSessionActive(session) {
  return Boolean(session && !session.paused && !session.finished);
}

function averageSessionSpeed(session) {
  if (!session || session.totalElapsed <= 0) return 0;
  return session.distance * 3600 / session.totalElapsed;
}

function averageSessionHr(session) {
  if (!session || session.hrSampleSeconds <= 0 || !session.hrWeighted) return 0;
  return session.hrWeighted / session.hrSampleSeconds;
}


/* ===== music.js ===== */
/**
 * Río Pinto Coach · Música
 * v5.4.400 · Control global de pausa y cambio de pista por doble toque.
 */
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

function bindMusicEvents() {
  installNativeMusicCallbacks();
  $("#musicFiles").addEventListener("change", loadMusicLibrary);
  $("#chooseMusicFolder")?.addEventListener("click", chooseMusicFolder);
  $("#reindexMusicFolder")?.addEventListener("click", () => restoreMusicFolder(true));
  $("#phaseMusicButton").addEventListener("click", handlePhaseMusicTap);
  $("#editPhaseMusic").addEventListener("change", togglePreferredMusicFields);
}

function populateTrackSelect(el, selected = "") {
  el.innerHTML = '<option value="">Automático</option>' + state.musicLibrary
    .map(track => `<option value="${escapeHtml(track.name)}">${escapeHtml(track.name)}</option>`)
    .join("");
  el.value = [...el.options].some(option => option.value === selected) ? selected : "";
}

function populatePhaseMusicSelect(selected = "auto", preferences = []) {
  const mode = $("#editPhaseMusic");
  mode.value = selected === "off" ? "off" : "auto";
  [1, 2, 3].forEach((n, i) => populateTrackSelect(
    $("#editPhaseMusic" + n),
    preferences[i] || ((selected !== "auto" && selected !== "off" && i === 0) ? selected : ""),
  ));
}

function togglePreferredMusicFields() {
  $("#preferredMusicFields").hidden = $("#editPhaseMusic").value === "off";
}

function loadMusicLibrary(event) {
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

function clearMusicObjectUrls() {
  for (const track of state.musicLibrary) {
    if (track.url) {
      try { URL.revokeObjectURL(track.url); } catch {}
    }
  }
}

function resetMusicAssignments() {
  state.phaseTrackAssignments.clear();
  state.phaseTrackQueues.clear();
  state.musicUsedByPhase.clear();
}

function resetMusicInteraction() {
  if (state.musicTapTimer) clearTimeout(state.musicTapTimer);
  state.musicTapTimer = null;
  state.lastMusicTap = 0;
}

function inferTrackEnergy(text) {
  const value = String(text).toLowerCase();
  if (/recup|relax|suave|ambient|calma|chill/.test(value)) return "low";
  if (/rock|metal|power|intenso|hard|vo2|sprint/.test(value)) return "high";
  return "medium";
}

function openMusicHandleDb() {
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

async function saveMusicDirectoryHandle(handle) {
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

async function loadMusicDirectoryHandle() {
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

async function musicHandlePermission(handle, request = false) {
  if (!handle) return false;
  try {
    if (await handle.queryPermission({ mode: "read" }) === "granted") return true;
    if (request && await handle.requestPermission({ mode: "read" }) === "granted") return true;
  } catch {}
  return false;
}

async function chooseMusicFolder() {
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

async function walkMusicDirectory(handle, prefix = "") {
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

async function indexMusicDirectory(handle, requestPermission = false) {
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

async function restoreMusicFolder(requestPermission = false) {
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

function extractBpm(name) {
  const explicit = String(name).match(/(?:^|[^0-9])(\d{2,3})\s*(?:bpm)?(?:[^0-9]|$)/i);
  const value = Number(explicit?.[1] || 0);
  return value >= 50 && value <= 200 ? value : 0;
}

function updateMusicLibraryStatus(mode = "") {
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

function musicTarget(phase) {
  const zone = (phase.zone || "").match(/Z[1-5]/)?.[0];
  const cadence = Number(phase.cadenceRpm)
    || Number(String(phase.cadence || "").match(/\d{2,3}/)?.[0])
    || 0;
  return cadence || ({ Z1: 72, Z2: 88, Z3: 106, Z4: 122, Z5: 138 }[zone] || 90);
}

function dayMusicSeed() {
  const text = `${state.week?.number || 0}-${state.dayName || ""}`;
  return [...text].reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) >>> 0, 7);
}

function rankedPhaseTracks(phase) {
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

function musicKey(phase) {
  return phase.musicGroup || `phase-${phase.index ?? 0}`;
}


function phaseQueue(phase) {
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

function choosePhaseTrack(phase, advance = false) {
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

function saveCurrentMusicPosition() {
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

function createMusicAudio(track, phase, resume = true) {
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

function switchPhaseMusic(phase) {
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

function playNextPhaseTrack(fromEnded = false) {
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

function handlePhaseMusicTap() {
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

function updateMusicButton() {
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

function stopPhaseMusic(clearSource = true) {
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

function muteMusicForVoice() {
  if (hasNativeAndroid()) return;
  if (state.musicAudio) {
    state.musicAudio.dataset.preVoiceVolume = String(state.musicAudio.volume);
    state.musicAudio.volume = 0;
  }
}

function restoreMusicAfterVoice(token) {
  if (hasNativeAndroid()) return;
  if (token !== state.speechToken) return;
  const audio = state.musicAudio;
  const session = state.session;
  if (audio && session?.musicEnabled) audio.volume = session.musicVolume;
}


/* ===== plan.js ===== */
/**
 * Río Pinto Coach · Plan y preparación
 * Arquitectura modular consolidada
 */
const customKey = () => `rpc.phases.${state.week.number}.${state.dayName}`;

function initializePlan(data) {
  state.data = data;
  if (!Array.isArray(state.data?.weeks) || !state.data.weeks.length) {
    throw new Error("El archivo del plan no contiene semanas válidas");
  }

  const savedWeek = Number(localStorage.getItem("rpc.week")) || 1;
  const savedDay = localStorage.getItem("rpc.day") || "Martes";

  $("#weekSelect").innerHTML = state.data.weeks
    .map(week => `<option value="${week.number}">${week.number}${week.recovery ? " · Descarga" : ""}</option>`)
    .join("");

  $("#weekSelect").value = state.data.weeks.some(week => week.number === savedWeek)
    ? savedWeek
    : 1;

  loadDays(savedDay);
}

function bindPlanEvents() {
  $("#weekSelect").addEventListener("change", () => loadDays("Martes"));
  $("#daySelect").addEventListener("change", render);
  $("#prepareButton").addEventListener("click", openPrepare);
  $("#backButton").addEventListener("click", closePrepare);
  $("#addPhaseButton").addEventListener("click", () => openPhaseEditor());
  $("#resetPhasesButton").addEventListener("click", resetCustomPhases);
  $("#phaseList").addEventListener("click", handlePhaseAction);
  $("#savePhaseButton").addEventListener("click", savePhase);
}

function currentWeek(){return state.data.weeks.find(w=>w.number===Number($("#weekSelect").value))}

function loadDays(preferred){const w=currentWeek(),names=Object.keys(w.days);$("#daySelect").innerHTML=names.map(d=>`<option>${d}</option>`).join("");$("#daySelect").value=names.includes(preferred)?preferred:names[0];render()}

function render(){const w=currentWeek(),day=$("#daySelect").value,d=w.days[day];state.week=w;state.day=d;state.dayName=day;localStorage.setItem("rpc.week",w.number);localStorage.setItem("rpc.day",day);$("#weekTitle").textContent=`Semana ${w.number} · ${w.title}`;$("#phaseName").textContent=w.phase;$("#phaseObjective").textContent=w.phaseObjective;$("#duration").textContent=d.duration||"—";$("#zone").textContent=d.zone||d.phases?.[0]?.zone||"—";$("#cadence").textContent=d.cadence||d.phases?.[0]?.cadence||"Cadencia libre";$("#type").textContent=d.type||"MTB";$("#distance").textContent=d.distance?`Distancia estimada: ${d.distance}`:"";$("#nutrition").textContent=d.nutrition;$("#technique").textContent=d.technique}

function originalPhases(){return state.day.phases?.length?structuredClone(state.day.phases):[{name:"Sesión continua",duration:state.day.duration,zone:state.day.zone,cadence:state.day.cadence,technique:state.day.technique}]}

function getPhases(){try{return JSON.parse(localStorage.getItem(customKey()))||originalPhases()}catch{return originalPhases()}}

function saveCustomPhases(phases){localStorage.setItem(customKey(),JSON.stringify(phases))}

function openPrepare(pushHistory=true){$("#prepareTitle").textContent=state.day.title;$("#prepareWeek").textContent=`Semana ${state.week.number} · ${state.dayName}`;renderPhaseList();showView("prepare");if(pushHistory&&!location.hash)history.pushState({prepare:true},"","#preparar")}

function renderPhaseList(){const phases=getPhases();$("#prepareDuration").textContent=formatClock(phases.reduce((a,p)=>a+parseDurationSeconds(p.duration),0),true);$("#phaseList").innerHTML=phases.map((p,i)=>`<article class="phase-row" style="--zone:${zoneColor(p.zone||p.name)}"><span class="phase-index">${i+1}</span><div><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.zone||"Sin zona")} · ${escapeHtml(p.cadence||state.day.cadence||"Cadencia libre")}</p></div><span class="phase-time">${escapeHtml(p.duration||"—")}</span><div class="phase-detail">${escapeHtml(p.technique||"Sin técnica específica")} · Pulsaciones: ${escapeHtml(p.hr||"según zona")}</div><div class="phase-actions"><button data-action="edit" data-index="${i}">Editar</button><button data-action="up" data-index="${i}">↑</button><button data-action="down" data-index="${i}">↓</button><button class="delete-phase" data-action="delete" data-index="${i}">Eliminar</button></div></article>`).join("")}

function handlePhaseAction(e){const b=e.target.closest("button[data-action]");if(!b)return;const phases=getPhases(),i=Number(b.dataset.index),a=b.dataset.action;if(a==="edit")return openPhaseEditor(i);if(a==="delete")phases.splice(i,1);if(a==="up"&&i>0)[phases[i-1],phases[i]]=[phases[i],phases[i-1]];if(a==="down"&&i<phases.length-1)[phases[i+1],phases[i]]=[phases[i],phases[i+1]];if(!phases.length)phases.push({name:"Nuevo período",duration:"5 min",zone:"Z1"});saveCustomPhases(phases);renderPhaseList()}

function openPhaseEditor(i=""){const p=i===""?{name:"Nuevo período",duration:"5 min",technique:"",zone:"Z1",cadence:state.day.cadence||"",hr:"",music:"auto",musicPreferences:[]}:getPhases()[i];$("#editPhaseIndex").value=i;for(const [id,key] of [["editPhaseName","name"],["editPhaseDuration","duration"],["editPhaseTechnique","technique"],["editPhaseZone","zone"],["editPhaseCadence","cadence"],["editPhaseHr","hr"]])$("#"+id).value=p[key]||"";populatePhaseMusicSelect(p.music||"auto",p.musicPreferences||[]);togglePreferredMusicFields();$("#phaseEditorDialog").showModal()}

function savePhase(e){e.preventDefault();const phases=getPhases(),i=$("#editPhaseIndex").value,p={name:$("#editPhaseName").value.trim(),duration:$("#editPhaseDuration").value.trim(),technique:$("#editPhaseTechnique").value.trim(),zone:$("#editPhaseZone").value.trim(),cadence:$("#editPhaseCadence").value.trim(),hr:$("#editPhaseHr").value.trim(),music:$("#editPhaseMusic").value,musicPreferences:[1,2,3].map(n=>$("#editPhaseMusic"+n).value).filter(Boolean)};if(!p.name||!p.duration)return;if(i==="")phases.push(p);else phases[Number(i)]=p;saveCustomPhases(phases);$("#phaseEditorDialog").close();renderPhaseList()}

function resetCustomPhases(){localStorage.removeItem(customKey());renderPhaseList()}

function closePrepare(){showView("home");if(location.hash)history.replaceState(null,"",location.pathname)}

function showView(name){$("#homeView").hidden=name!=="home";$("#prepareView").hidden=name!=="prepare";$("#trainingView").hidden=name!=="training";localStorage.setItem("rpc.view",name);scrollTo(0,0)}

function repetitionInfo(phase){const duration=String(phase?.duration||""),name=String(phase?.name||"");let m=duration.match(/(\d+)\s*[×xX]\s*(\d+(?:[.,]\d+)?)\s*(min|s(?:eg)?)/i);if(m)return {count:Number(m[1]),unit:`${m[2]} ${m[3]}`};const count=name.match(/(?:^|\D)(\d+)\s*[×xX]\s*(?:\d+(?:[.,]\d+)?)?(?:\D|$)/i)?.[1];const unit=duration.match(/(\d+(?:[.,]\d+)?)\s*(min|s(?:eg)?)/i);return count&&unit?{count:Number(count),unit:`${unit[1]} ${unit[2]}`} : null}

function expandPhases(source){const out=[];for(let i=0;i<source.length;i++){const p={...source[i]},rep=repetitionInfo(p),next=source[i+1],isRecovery=next&&/recuperaci[oó]n/i.test(next.name||"");if(!rep||rep.count<2){out.push(p);continue}const blockId=`${state.week?.number||0}-${state.dayName}-${i}`;for(let r=1;r<=rep.count;r++){out.push({...p,duration:rep.unit,repetition:r,repetitionCount:rep.count,name:`${cleanPhaseName(p.name)} · ${r}/${rep.count}`,musicGroup:`${blockId}-work`,musicResume:true});if(isRecovery&&r<rep.count)out.push({...next,name:cleanPhaseName(next.name),intercalatedRecovery:true,musicGroup:`${blockId}-recovery`,musicResume:true})}if(isRecovery)i++}return out}


/* ===== gps.js ===== */
/**
 * Río Pinto Coach · GPS
 * v5.4.400 · Distancia acreditable, recuperación de señal y desnivel positivo filtrado.
 */
const MAX_ACCEPTED_ACCURACY_M = 45;
const MIN_NORMAL_MOVING_SPEED_KMH = 1.2;
const MAX_PLAUSIBLE_SPEED_KMH = 120;
const MAX_PLAUSIBLE_VERTICAL_SPEED_MPS = 8;
const GAP_THRESHOLD_SECONDS = 10;
const ALTITUDE_WINDOW_SIZE = 5;

function startGps({ preserveTracking = false } = {}) {
  const session = state.session;
  if (!session) return;

  if (!navigator.geolocation) {
    $("#gpsStatus").textContent = "GPS: no disponible";
    return;
  }

  stopGps();

  if (!preserveTracking) {
    session.lastPosition = null;
    resetGpsDistanceAnchor();
  } else {
    session.gpsSignalLost = true;
  }

  session.lastGpsReceived = Date.now();
  $("#gpsStatus").textContent = "GPS: buscando";
  state.gpsWatch = navigator.geolocation.watchPosition(
    onGps,
    onGpsError,
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
  );
}

function stopGps() {
  if (state.gpsWatch !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(state.gpsWatch);
  }
  state.gpsWatch = null;
}

/**
 * Corta cualquier tramo acreditable que atraviese una pausa.
 * lastPosition se conserva para que la velocidad instantánea pueda seguir mostrándose.
 */
function resetGpsDistanceAnchor() {
  const session = state.session;
  if (!session) return;
  session.gpsDistanceAnchor = null;
  session.gpsSignalLost = false;
  session.elevationAnchor = null;
  session.altitudeWindow = [];
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function filteredAltitude(session, altitude) {
  if (!Number.isFinite(altitude)) return null;
  session.altitudeWindow.push(altitude);
  if (session.altitudeWindow.length > ALTITUDE_WINDOW_SIZE) session.altitudeWindow.shift();
  return median(session.altitudeWindow);
}

function elevationNoiseThreshold(current) {
  const verticalAccuracy = Number(current.altitudeAccuracy);
  if (Number.isFinite(verticalAccuracy) && verticalAccuracy > 0) {
    return Math.min(8, Math.max(2.5, verticalAccuracy * 0.35));
  }
  return Math.min(6, Math.max(2.5, (current.accuracy || 0) * 0.08));
}

function updatePositiveElevation(session, current, dt) {
  const altitude = filteredAltitude(session, current.alt);
  if (!Number.isFinite(altitude)) return;

  if (!Number.isFinite(session.elevationAnchor)) {
    session.elevationAnchor = altitude;
    return;
  }

  const delta = altitude - session.elevationAnchor;
  const threshold = elevationNoiseThreshold(current);
  const verticalSpeed = dt > 0 ? Math.abs(delta) / dt : 0;

  // Un salto vertical imposible se trata como error de altitud y sólo reancla.
  if (verticalSpeed > MAX_PLAUSIBLE_VERTICAL_SPEED_MPS) {
    session.elevationAnchor = altitude;
    return;
  }

  if (delta >= threshold) {
    session.elevation += delta;
    session.elevationAnchor = altitude;
  } else if (delta <= -threshold) {
    // Los descensos nunca se restan, pero actualizan el nuevo nivel de referencia.
    session.elevationAnchor = altitude;
  }
}

function onGps(pos) {
  const session = state.session;
  if (!session) return;

  const coords = pos.coords;
  const now = pos.timestamp || Date.now();
  const accuracy = Number(coords.accuracy) || 999;
  const sensorSpeed = Number.isFinite(coords.speed) && coords.speed >= 0
    ? coords.speed * 3.6
    : null;

  session.lastGpsReceived = Date.now();
  $("#gpsStatus").textContent = `GPS: ±${Math.round(accuracy)} m`;

  // Una lectura imprecisa no reemplaza el último punto válido: así, cuando
  // vuelve la señal, puede reconstruirse la distancia recta desde ese punto.
  if (accuracy > MAX_ACCEPTED_ACCURACY_M) {
    session.gpsSignalLost = true;
    if (sensorSpeed !== null) session.speed = sensorSpeed;
    return;
  }

  const current = {
    lat: coords.latitude,
    lon: coords.longitude,
    alt: Number.isFinite(coords.altitude) ? coords.altitude : null,
    altitudeAccuracy: Number.isFinite(coords.altitudeAccuracy) ? coords.altitudeAccuracy : null,
    t: now,
    accuracy,
  };

  // Velocidad instantánea: siempre disponible, incluso durante una pausa.
  const previous = session.lastPosition;
  const displayDt = previous ? (now - previous.t) / 1000 : 0;
  const displayDist = previous
    ? haversine(previous.lat, previous.lon, current.lat, current.lon)
    : 0;
  const derivedSpeed = displayDt > 0 ? displayDist / displayDt * 3.6 : 0;
  session.speed = sensorSpeed ?? derivedSpeed;
  if (!Number.isFinite(session.speed) || session.speed < 0) session.speed = 0;
  session.lastPosition = current;

  // Durante una pausa la posición y la velocidad siguen actualizándose, pero
  // no se acredita distancia ni desnivel y se corta cualquier tramo pendiente.
  if (!isSessionActive(session)) {
    resetGpsDistanceAnchor();
    return;
  }

  const anchor = session.gpsDistanceAnchor;
  if (!anchor) {
    session.gpsDistanceAnchor = current;
    session.gpsSignalLost = false;
    updatePositiveElevation(session, current, 1);
    return;
  }

  const dt = (now - anchor.t) / 1000;
  if (dt <= 0) {
    session.gpsDistanceAnchor = current;
    session.gpsSignalLost = false;
    return;
  }

  const distance = haversine(anchor.lat, anchor.lon, current.lat, current.lon);
  const uncertainty = Math.max(4, (accuracy + (anchor.accuracy || accuracy)) * 0.35);
  const impliedSpeed = distance / dt * 3.6;
  const recoveredGap = session.gpsSignalLost || dt > GAP_THRESHOLD_SECONDS;

  // Única exclusión de reconstrucción: salto incompatible con una bicicleta.
  if (impliedSpeed > MAX_PLAUSIBLE_SPEED_KMH) {
    session.gpsDistanceAnchor = current;
    session.gpsSignalLost = false;
    session.elevationAnchor = null;
    session.altitudeWindow = [];
    updatePositiveElevation(session, current, 1);
    return;
  }

  const movingNormally = impliedSpeed >= MIN_NORMAL_MOVING_SPEED_KMH;
  const shouldAccumulate = distance > uncertainty && (recoveredGap || movingNormally);

  if (shouldAccumulate) {
    session.distance += distance / 1000;
    updatePositiveElevation(session, current, dt);
    session.gpsDistanceAnchor = current;
  } else if (distance <= uncertainty) {
    // Conserva el ancla para que desplazamientos lentos reales puedan acumularse
    // hasta superar el ruido posicional.
  } else {
    // Movimiento muy lento sin pérdida de señal: reanclar evita deriva estando quieto.
    session.gpsDistanceAnchor = current;
    session.elevationAnchor = null;
    session.altitudeWindow = [];
    updatePositiveElevation(session, current, 1);
  }

  session.gpsSignalLost = false;
}

function onGpsError(error) {
  const session = state.session;
  if (session) session.gpsSignalLost = true;

  $("#gpsStatus").textContent = error.code === 1
    ? "GPS: permiso denegado"
    : error.code === 3
      ? "GPS: reintentando"
      : "GPS: sin señal";

  if (error.code === 3 && session?.gps) {
    setTimeout(() => {
      if (state.session?.gps && !state.session.finished) {
        startGps({ preserveTracking: true });
      }
    }, 1500);
  }
}

function haversine(a, b, c, d) {
  const earthRadius = 6371000;
  const latitudeDelta = (c - a) * Math.PI / 180;
  const longitudeDelta = (d - b) * Math.PI / 180;
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(a * Math.PI / 180)
    * Math.cos(c * Math.PI / 180)
    * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(value));
}


/* ===== media.js ===== */
/**
 * Río Pinto Coach · Audio, cadencia y voz
 * Arquitectura modular consolidada
 */
async function unlockAudio(){try{state.audio??=new (window.AudioContext||window.webkitAudioContext)();if(state.audio.state==="suspended")await state.audio.resume()}catch{}}

function beep(freq,duration,volume){const s=state.session;if(!s||volume<=0||!state.audio)return;const o=state.audio.createOscillator(),g=state.audio.createGain();o.frequency.value=freq;g.gain.value=volume*.18;o.connect(g).connect(state.audio.destination);o.start();g.gain.exponentialRampToValueAtTime(.0001,state.audio.currentTime+duration);o.stop(state.audio.currentTime+duration)}

function handleWarningBeep(remaining){const s=state.session,sec=Math.ceil(remaining);if(!s?.warningEnabled)return;if(sec<=5&&sec>=1&&sec!==state.lastWarningSecond){state.lastWarningSecond=sec;beep(720,.12,s.warningVolume)}}

function cadenceRpm(){const s=state.session,p=s?.phases?.[s.phaseIndex];if(!p||p.metronome===false)return 0;const override=Number(s.cadenceOverride);if(override>0)return override;if(Number(p.cadenceRpm)>0)return Number(p.cadenceRpm);const nums=String(p.cadence||"").match(/\d{2,3}/g)?.map(Number)||[];return nums.length>1?Math.round((nums[0]+nums[1])/2):(nums[0]||0)}

function startCadencePulse(){stopCadencePulse();const s=state.session,rpm=cadenceRpm();if(!s?.cadenceEnabled||!rpm||s.cadenceVolume<=0)return;beep(1100,.055,s.cadenceVolume);state.cadenceTimer=setInterval(()=>beep(1100,.055,s.cadenceVolume),60000/rpm)}

function stopCadencePulse(){clearInterval(state.cadenceTimer);state.cadenceTimer=null}

function spokenNumber(value){const words=["cero","uno","dos","tres","cuatro","cinco","seis","siete","ocho","nueve","diez","once","doce","trece","catorce","quince","dieciséis","diecisiete","dieciocho","diecinueve","veinte"];const n=Number(value);return Number.isInteger(n)&&n>=0&&n<words.length?words[n]:String(value)}

function spokenPhaseName(name){return cleanPhaseName(name).replace(/\s*[·-]\s*\d+\s*\/\s*\d+\s*$/u,"").trim()}

function phaseSpeechText(p){const s=state.session;const parts=[spokenPhaseName(p.name)];if(p.repetitionCount)parts.push(`${spokenNumber(p.repetition)} de ${spokenNumber(p.repetitionCount)}`);parts.push(p.duration);if(p.zone){const z=String(p.zone).match(/Z([1-5])/i)?.[1];parts.push(z?`Zona ${spokenNumber(z)}`:`Zona ${p.zone}`)}parts.push(p.cadence&&!/^cadencia libre$/i.test(String(p.cadence).trim())?String(p.cadence):"Cadencia libre");const target=p.hr&&p.hr!=="Según zona"?p.hr:hrTarget(p.zone||state.day.zone,s?.maxHr||185);if(target!=="—")parts.push(`Pulsaciones ${target}`);if(p.technique)parts.push(p.technique);return parts.filter(Boolean).join(". ")}

function speakPhase(p){const s=state.session;if(!s?.voiceEnabled||s.voiceVolume<=0||p.voice===false)return;const text=phaseSpeechText(p);if(hasNativeAndroid()){try{window.AndroidNative.speak(text,s.voiceVolume,1.08)}catch{}return}if(!("speechSynthesis" in window))return;const token=++state.speechToken;window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang="es-AR";u.volume=s.voiceVolume;u.rate=1.08;u.onstart=muteMusicForVoice;u.onend=()=>restoreMusicAfterVoice(token);u.onerror=()=>restoreMusicAfterVoice(token);window.speechSynthesis.speak(u)}


/* ===== history.js ===== */
/**
 * Río Pinto Coach · Historial y progreso
 * v5.4.400 · Eliminación individual de registros y actualización inmediata.
 */
function bindHistoryEvents() {
  $("#progressCard").addEventListener("click", openHistory);
  $("#historyList").addEventListener("click", handleHistoryListClick);
}

function trainingRecords() {
  try {
    return JSON.parse(localStorage.getItem("rpc.trainingRecords") || "[]");
  } catch {
    return [];
  }
}

function totalPlannedTrainings() {
  return state.data?.weeks?.reduce((sum, week) => sum + Object.keys(week.days || {}).length, 0) || 0;
}

function saveTrainingRecord() {
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

function progressData() {
  const records = trainingRecords();
  const total = totalPlannedTrainings();
  const unique = new Set(
    records.filter(record => record.completion >= 100).map(record => `${record.week}-${record.day}`),
  ).size;
  const percent = total ? Math.min(100, Math.round(unique / total * 100)) : 0;
  return { records, total, unique, percent };
}

function renderProgressCard() {
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

function openHistory() {
  renderHistoryContents();
  $("#historyDialog").showModal();
}

function handleHistoryListClick(event) {
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


/* ===== platform.js ===== */
/**
 * Río Pinto Coach · Integración PWA
 * v5.4.400 · Wake Lock, instalación y protección global contra pull-to-refresh.
 */
function setupInstallPrompt() {
  const hint = $("#installHint");
  addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    state.deferredInstall = event;
    hint.hidden = false;
    hint.textContent = "Tocá aquí para instalar la aplicación.";
    hint.setAttribute("role", "button");
    hint.tabIndex = 0;
  });

  const install = async () => {
    if (!state.deferredInstall) return;
    state.deferredInstall.prompt();
    await state.deferredInstall.userChoice;
    state.deferredInstall = null;
    hint.hidden = true;
  };

  hint.addEventListener("click", install);
  hint.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") install();
  });
  addEventListener("appinstalled", () => {
    state.deferredInstall = null;
    hint.hidden = true;
  });
}

async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) state.wakeLock = await navigator.wakeLock.request("screen");
  } catch {}
}

function releaseWakeLock() {
  try { state.wakeLock?.release(); } catch {}
  state.wakeLock = null;
}

function findVerticalScrollContainer(node) {
  for (
    let element = node instanceof Element ? node : node?.parentElement;
    element && element !== document.body;
    element = element.parentElement
  ) {
    const style = getComputedStyle(element);
    if (/auto|scroll|overlay/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1) {
      return element;
    }
  }
  return document.scrollingElement || document.documentElement;
}

/**
 * Bloquea únicamente el gesto descendente que Chrome/Android interpreta como
 * recarga cuando el contenedor activo ya está en su límite superior.
 * El scroll vertical normal y los gestos horizontales permanecen intactos.
 */
function setupPullToRefreshGuard() {
  let startX = 0;
  let startY = 0;
  let scrollContainer = null;

  const reset = () => { scrollContainer = null; };

  document.addEventListener("touchstart", event => {
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    scrollContainer = findVerticalScrollContainer(event.target);
  }, { passive: true, capture: true });

  document.addEventListener("touchmove", event => {
    if (event.touches.length !== 1 || !event.cancelable) return;

    const touch = event.touches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;

    if (dy <= 0 || Math.abs(dy) <= Math.abs(dx)) return;

    const container = scrollContainer || document.scrollingElement || document.documentElement;
    const documentScroll = container === document.scrollingElement
      || container === document.documentElement
      || container === document.body;
    const atTop = documentScroll
      ? Math.max(
        window.scrollY || 0,
        document.documentElement.scrollTop || 0,
        document.body.scrollTop || 0,
      ) <= 0
      : container.scrollTop <= 0;

    if (atTop) event.preventDefault();
  }, { passive: false, capture: true });

  document.addEventListener("touchend", reset, { passive: true, capture: true });
  document.addEventListener("touchcancel", reset, { passive: true, capture: true });
}


/* ===== training.js ===== */
/**
 * Río Pinto Coach · Sesión de entrenamiento
 * v5.4.400 · Métricas acreditables, control musical persistente y voz repetible.
 */
const TRANSITION_SECONDS = 10;

function bindTrainingEvents() {
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

function buildSession() {
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


function restoreNativeTrainingSession() {
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

async function startTraining() {
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

function renderTrainingStatic() {
  const session = state.session;
  $("#liveWeekDay").textContent = `SEMANA ${state.week.number} · ${state.dayName.toUpperCase()}`;
  updatePhaseTargets(session.phases[session.phaseIndex]);
}

function updatePhaseTargets(phase) {
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

function compactDuration(raw, seconds) {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return seconds % 60 ? formatClock(seconds, false) : `${seconds / 60} min`;
  return raw || formatClock(seconds, false);
}

/**
 * Usa tiempo real transcurrido y lo distribuye entre preparación y etapas.
 * Una pausa es la única situación que excluye tiempo de las métricas acumuladas.
 */
function tick() {
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

function consumeSessionTime(elapsed) {
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

function beginTransition() {
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

function startActivePhase() {
  const session = state.session;
  session.transition = false;
  session.transitionRemaining = 0;
  session.phaseElapsed = 0;
  $("#trainingView").classList.remove("is-transition");
  beep(900, .16, session.warningVolume);
  startCadencePulse();
}

function completeCurrentPhase() {
  const session = state.session;
  if (!session) return;

  const phase = session.phases[session.phaseIndex];
  const result = session.phaseResults[session.phaseIndex];
  if (result && result.status !== "completed") {
    result.status = "completed";
    result.elapsed = phase.durationSeconds;
  }
}

function advancePhase() {
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

function changePhaseManually(delta) {
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

function replayCurrentPhaseDescription(event) {
  if (event.target.closest("button,input,select,a,label")) return;
  const session = state.session;
  if (!session || session.finished) return;
  speakPhase(session.phases[session.phaseIndex]);
}

function cleanDrivingDuration(phase) {
  const seconds = phase?.durationSeconds || parseDurationSeconds(phase?.duration || "");
  return seconds % 60 === 0 ? `${Math.round(seconds / 60)} min` : formatClock(seconds, false);
}

function drivingCadence(phase) {
  const cadence = phase?.cadence || "Cadencia libre";
  return /^cadencia libre$/i.test(String(cadence).trim())
    ? "Libre"
    : String(cadence).replace(/\s*rpm/i, " rpm");
}

function updateDrivingView() {
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

function setTrainingView(mode) {
  state.trainingViewMode = mode ? 1 : 0;
  const driving = $("#drivingView");
  const dots = [...document.querySelectorAll("#trainingPager i")];
  if (driving) driving.hidden = state.trainingViewMode === 0;
  dots.forEach((dot, index) => dot.classList.toggle("active", index === state.trainingViewMode));
  updateDrivingView();
}

function setupTrainingSwipe() {
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

function updateTrainingUI() {
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

function toggleStageClock() {
  if (!state.session) return;
  state.session.showRemaining = !state.session.showRemaining;
  updateTrainingUI();
}

function togglePause() {
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

function saveAndFinish() {
  if (state.session && !state.session.paused && !state.session.finished) tick();
  saveTrainingRecord();
  finishTraining();
}

function finishTraining() {
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


/* ===== config.js ===== */
/**
 * Río Pinto Coach · Configuración
 * v5.4.400 · Configuración unificada desde Preparar y Entrenamiento.
 */
const TOGGLE_SETTINGS = [
  ["gps", "gpsEnabled"],
  ["warningEnabled", "warningEnabled"],
  ["voiceEnabled", "voiceEnabled"],
  ["cadenceEnabled", "cadenceEnabled"],
  ["musicEnabled", "musicEnabled"],
];

const VOLUME_SETTINGS = ["warningVolume", "voiceVolume", "cadenceVolume", "musicVolume"];

function bindConfigEvents() {
  $("#configButton").addEventListener("click", openConfig);
  $("#prepareConfigButton")?.addEventListener("click", openConfig);
  $("#autoCadenceButton")?.addEventListener("click", () => {
    $("#cadenceOverride").value = "";
  });
  $("#saveConfigButton").addEventListener("click", saveConfig);
  VOLUME_SETTINGS.forEach(id => $("#" + id).addEventListener("input", updateVolumeOutputs));
}

function openConfig() {
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

function updateVolumeOutputs() {
  VOLUME_SETTINGS.forEach(key => {
    $("#" + key + "Out").textContent = `${Math.round(Number($("#" + key).value) * 100)}%`;
  });
}

function saveConfig(event) {
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


/* ===== app.js ===== */
/**
 * Río Pinto Coach · Punto de entrada
 * v5.4.400 · Línea PWA consolidada previa a migración Android.
 */

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
