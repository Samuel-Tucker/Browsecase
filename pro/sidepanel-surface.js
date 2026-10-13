import { errorEntitlementSnapshot, isCurrentActiveEntitlement, normalizeEntitlementSnapshot } from "../lib/pro-entitlement.js";
import { proCardViewModel } from "../lib/pro-view-model.js";
import { DEFAULT_ENTITLEMENT_TIMEOUT_MS, requestSidepanelEntitlement } from "./sidepanel-client.js";

function setText(element, value) {
  if (element) element.textContent = value;
}

function setDisabled(button, disabled) {
  if (!button) return;
  button.disabled = Boolean(disabled);
  button.setAttribute?.("aria-disabled", String(Boolean(disabled)));
}

function renderSafely(proElements, model) {
  try {
    renderProSurface(proElements, model);
  } catch {
    // A partially rendered optional card must not affect the rest of the panel.
  }
  return model;
}

/** Renders only the supplied optional-Pro elements. */
export function renderProSurface(proElements = {}, model = proCardViewModel(errorEntitlementSnapshot())) {
  const safeModel = model && typeof model === "object" ? model : proCardViewModel(errorEntitlementSnapshot());
  const { card, badge, title, body, footnote, cta } = proElements;
  if (card?.dataset) card.dataset.proState = safeModel.state;
  setText(badge, safeModel.badge);
  setText(title, safeModel.title);
  setText(body, safeModel.body);
  setText(footnote, safeModel.footnote);
  setText(cta, safeModel.ctaLabel);
  setDisabled(cta, safeModel.ctaDisabled);
  return safeModel;
}

function requestWithTimeout(requestEntitlement, timeoutMs, setTimeoutFn, clearTimeoutFn) {
  if (typeof requestEntitlement !== "function" || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || typeof setTimeoutFn !== "function" || typeof clearTimeoutFn !== "function") {
    return Promise.resolve(errorEntitlementSnapshot());
  }
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) {
        try { clearTimeoutFn(timer); } catch { /* Timeout cleanup must not block safe rendering. */ }
      }
      resolve(value);
    };
    try {
      timer = setTimeoutFn(() => finish(errorEntitlementSnapshot()), timeoutMs);
    } catch {
      finish(errorEntitlementSnapshot());
      return;
    }
    try {
      Promise.resolve(requestEntitlement()).then(finish, () => finish(errorEntitlementSnapshot()));
    } catch {
      finish(errorEntitlementSnapshot());
    }
  });
}

/**
 * Starts the optional card independently from the local-library initializer.
 * It resolves to an error model on every failure and never throws.
 */
export async function initializeProSurface({
  proElements = {},
  requestEntitlement = requestSidepanelEntitlement,
  timeoutMs = DEFAULT_ENTITLEMENT_TIMEOUT_MS,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout
} = {}) {
  try {
    const snapshot = await requestWithTimeout(requestEntitlement, timeoutMs, setTimeoutFn, clearTimeoutFn);
    return renderSafely(proElements, proCardViewModel(snapshot));
  } catch {
    return renderSafely(proElements, proCardViewModel(errorEntitlementSnapshot()));
  }
}

function clearRefreshTimer(timer, clearTimeoutFn) {
  if (timer === undefined) return;
  try { clearTimeoutFn(timer); } catch { /* Timer cleanup cannot affect the local panel. */ }
}

/**
 * Keeps only the newest optional-Pro refresh eligible to paint or schedule an
 * expiry check. This controller is display-only and has no free-core callers.
 */
export function createProSurfaceController({
  proElements = {},
  requestEntitlement = requestSidepanelEntitlement,
  timeoutMs = DEFAULT_ENTITLEMENT_TIMEOUT_MS,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
  now = Date.now
} = {}) {
  let generation = 0;
  let expiryTimer;

  const currentTime = () => {
    try {
      const value = now();
      return Number.isFinite(value) ? value : Date.now();
    } catch {
      return Date.now();
    }
  };

  const scheduleExpiry = (snapshot, refreshGeneration) => {
    clearRefreshTimer(expiryTimer, clearTimeoutFn);
    expiryTimer = undefined;
    const nowTime = currentTime();
    if (!isCurrentActiveEntitlement(snapshot, nowTime)) {
      if (refreshGeneration === generation) {
        renderSafely(proElements, proCardViewModel(errorEntitlementSnapshot(), nowTime));
        void refresh();
      }
      return;
    }
    const expiresAt = Date.parse(normalizeEntitlementSnapshot(snapshot).expiresAt);
    const delay = expiresAt - nowTime;
    // Active snapshots are already bounded to 24 hours. Refuse malformed or
    // platform-unsafe timer values rather than extending a verified display.
    if (!Number.isFinite(delay) || delay <= 0 || delay > 0x7fffffff || typeof setTimeoutFn !== "function") {
      if (refreshGeneration === generation) renderSafely(proElements, proCardViewModel(errorEntitlementSnapshot(), nowTime));
      return;
    }
    try {
      expiryTimer = setTimeoutFn(() => {
        expiryTimer = undefined;
        if (refreshGeneration === generation) {
          // Do not leave a verified label visible while the expiry-triggered
          // request is in flight; a new verified snapshot can replace it.
          renderSafely(proElements, proCardViewModel(errorEntitlementSnapshot(), currentTime()));
          void refresh();
        }
      }, delay);
    } catch {
      if (refreshGeneration === generation) renderSafely(proElements, proCardViewModel(errorEntitlementSnapshot(), currentTime()));
    }
  };

  async function refresh() {
    const refreshGeneration = ++generation;
    clearRefreshTimer(expiryTimer, clearTimeoutFn);
    expiryTimer = undefined;
    let snapshot;
    try {
      snapshot = await requestWithTimeout(requestEntitlement, timeoutMs, setTimeoutFn, clearTimeoutFn);
    } catch {
      snapshot = errorEntitlementSnapshot();
    }
    const model = proCardViewModel(snapshot, currentTime());
    if (refreshGeneration !== generation) return model;
    renderSafely(proElements, model);
    if (model.state === "pro_active") scheduleExpiry(snapshot, refreshGeneration);
    return model;
  }

  return Object.freeze({ refresh });
}
