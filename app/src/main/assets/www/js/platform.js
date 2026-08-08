/**
 * Río Pinto Coach · Integración PWA
 * v5.4.400 · Wake Lock, instalación y protección global contra pull-to-refresh.
 */
import { $, state } from "./core.js";

export function setupInstallPrompt() {
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

export async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) state.wakeLock = await navigator.wakeLock.request("screen");
  } catch {}
}

export function releaseWakeLock() {
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
export function setupPullToRefreshGuard() {
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
