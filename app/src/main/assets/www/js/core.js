/**
 * Río Pinto Coach · Núcleo compartido
 * Estado, constantes, configuración y utilidades puras.
 */

export const $ = selector => document.querySelector(selector);

export const state = {
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

export function zoneColor(zone) {
  const key = String(zone || "").match(/Z[1-5]/)?.[0];
  return ZONE_COLORS[key] || "#718096";
}

export function getSetting(key) {
  const fallback = DEFAULT_SETTINGS[key];
  const raw = localStorage.getItem(`rpc.${key}`);
  if (raw === null) return fallback;
  if (typeof fallback === "boolean") return raw === "true";
  if (typeof fallback === "number") return Number(raw);
  return raw;
}

export function hrTarget(zone, maxHr) {
  const key = String(zone || "").match(/Z[1-5]/)?.[0];
  if (!key) return "—";
  const [low, high] = ZONE_HR_PERCENT[key];
  return `${Math.round(maxHr * low / 100)}–${Math.round(maxHr * high / 100)}`;
}

export function parseDurationSeconds(text) {
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

export function formatClock(seconds, withHours) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return withHours
    ? `${pad(hours)}:${pad(minutes)}:${pad(secs)}`
    : `${pad(Math.floor(total / 60))}:${pad(secs)}`;
}

export function cleanPhaseName(name) {
  return String(name || "Etapa")
    .replace(/\s*\([^)]*\b(?:\d+(?:[.,]\d+)?(?:\s*[-–a]\s*\d+(?:[.,]\d+)?)?\s*)?rpm\b[^)]*\)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[char]);
}

export function hasNativeAndroid() {
  try { return Boolean(window.AndroidNative?.isNative?.()); } catch { return false; }
}
