/**
 * Río Pinto Coach · GPS
 * v5.4.400 · Distancia acreditable, recuperación de señal y desnivel positivo filtrado.
 */
import { $, state } from "./core.js";
import { isSessionActive } from "./metrics.js";

const MAX_ACCEPTED_ACCURACY_M = 45;
const MIN_NORMAL_MOVING_SPEED_KMH = 1.2;
const MAX_PLAUSIBLE_SPEED_KMH = 120;
const MAX_PLAUSIBLE_VERTICAL_SPEED_MPS = 8;
const GAP_THRESHOLD_SECONDS = 10;
const ALTITUDE_WINDOW_SIZE = 5;

export function startGps({ preserveTracking = false } = {}) {
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

export function stopGps() {
  if (state.gpsWatch !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(state.gpsWatch);
  }
  state.gpsWatch = null;
}

/**
 * Corta cualquier tramo acreditable que atraviese una pausa.
 * lastPosition se conserva para que la velocidad instantánea pueda seguir mostrándose.
 */
export function resetGpsDistanceAnchor() {
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

export function onGps(pos) {
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

export function onGpsError(error) {
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

export function haversine(a, b, c, d) {
  const earthRadius = 6371000;
  const latitudeDelta = (c - a) * Math.PI / 180;
  const longitudeDelta = (d - b) * Math.PI / 180;
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(a * Math.PI / 180)
    * Math.cos(c * Math.PI / 180)
    * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(value));
}
