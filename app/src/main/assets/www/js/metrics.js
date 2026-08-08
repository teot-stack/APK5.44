/**
 * Río Pinto Coach · Métricas de sesión
 * Reglas únicas para tiempo, distancia y promedios acreditables.
 */

export function isSessionActive(session) {
  return Boolean(session && !session.paused && !session.finished);
}

export function averageSessionSpeed(session) {
  if (!session || session.totalElapsed <= 0) return 0;
  return session.distance * 3600 / session.totalElapsed;
}

export function averageSessionHr(session) {
  if (!session || session.hrSampleSeconds <= 0 || !session.hrWeighted) return 0;
  return session.hrWeighted / session.hrSampleSeconds;
}
