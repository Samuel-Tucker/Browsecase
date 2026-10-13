import { errorEntitlementSnapshot, normalizeEntitlementSnapshot } from "../lib/pro-entitlement.js";
import { PRO_ENTITLEMENT_MESSAGE } from "./message-router.js";

export const DEFAULT_ENTITLEMENT_TIMEOUT_MS = 750;

function errorSnapshot() {
  return errorEntitlementSnapshot();
}

function isSuccessfulResponse(value) {
  return Boolean(value && typeof value === "object" && value.ok === true && Object.keys(value).length === 2 && "entitlement" in value);
}

/**
 * Gets a fail-closed snapshot for optional remote UI. This function resolves to
 * an error snapshot for every runtime failure so free-panel initialization can
 * proceed normally.
 */
export function requestSidepanelEntitlement({
  runtime = globalThis.chrome?.runtime,
  timeoutMs = DEFAULT_ENTITLEMENT_TIMEOUT_MS,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout
} = {}) {
  if (!runtime || typeof runtime.sendMessage !== "function" || typeof setTimeoutFn !== "function" || typeof clearTimeoutFn !== "function") {
    return Promise.resolve(errorSnapshot());
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.resolve(errorSnapshot());

  try {
    return new Promise((resolve) => {
      let settled = false;
      let timer;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) {
          try { clearTimeoutFn(timer); } catch { /* Cleanup cannot change a fail-closed result. */ }
        }
        resolve(value);
      };
      try {
        timer = setTimeoutFn(() => finish(errorSnapshot()), timeoutMs);
      } catch {
        finish(errorSnapshot());
        return;
      }

      try {
        Promise.resolve(runtime.sendMessage({ type: PRO_ENTITLEMENT_MESSAGE }))
          .then((response) => {
            if (!isSuccessfulResponse(response)) return finish(errorSnapshot());
            const normalized = normalizeEntitlementSnapshot(response.entitlement);
            finish(normalized.valid ? normalized : errorSnapshot());
          })
          .catch(() => finish(errorSnapshot()));
      } catch {
        finish(errorSnapshot());
      }
    });
  } catch {
    return Promise.resolve(errorSnapshot());
  }
}
