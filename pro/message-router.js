import { errorEntitlementSnapshot, normalizeEntitlementSnapshot } from "../lib/pro-entitlement.js";

export const PRO_ENTITLEMENT_MESSAGE = "tabpack.pro.get-entitlement";
export const DEFAULT_ADAPTER_TIMEOUT_MS = 750;

function isExactEntitlementMessage(message) {
  try {
    return Boolean(
      message &&
        typeof message === "object" &&
        !Array.isArray(message) &&
        Object.getPrototypeOf(message) === Object.prototype &&
        Object.keys(message).length === 1 &&
        Object.hasOwn(message, "type") &&
        message.type === PRO_ENTITLEMENT_MESSAGE
    );
  } catch {
    return false;
  }
}

function isSidepanelSender(sender, extensionId, sidepanelUrl) {
  try {
    return Boolean(
      sender &&
        typeof sender === "object" &&
        typeof extensionId === "string" &&
        typeof sidepanelUrl === "string" &&
        sender.id === extensionId &&
        sender.url === sidepanelUrl
    );
  } catch {
    return false;
  }
}

function boundedTimeout(timeoutMs) {
  return Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.min(timeoutMs, DEFAULT_ADAPTER_TIMEOUT_MS)
    : DEFAULT_ADAPTER_TIMEOUT_MS;
}

function requestAdapter(adapter, timeoutMs, setTimeoutFn, clearTimeoutFn) {
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) {
        try { clearTimeoutFn(timer); } catch { /* A cleanup fault cannot keep the channel open. */ }
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
      Promise.resolve(adapter?.getEntitlement?.())
        .then((value) => finish(value), () => finish(errorEntitlementSnapshot()));
    } catch {
      finish(errorEntitlementSnapshot());
    }
  });
}

/**
 * Creates a Chrome 114-compatible async response listener. It only recognises
 * the side panel's exact entitlement request; all other traffic is ignored.
 */
export function createProMessageRouter({
  adapter,
  extensionId,
  sidepanelUrl,
  timeoutMs = DEFAULT_ADAPTER_TIMEOUT_MS,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout
} = {}) {
  const adapterTimeoutMs = boundedTimeout(timeoutMs);
  return function onMessage(message, sender, sendResponse) {
    if (!isExactEntitlementMessage(message) || !isSidepanelSender(sender, extensionId, sidepanelUrl) || typeof sendResponse !== "function") return undefined;

    let responded = false;
    const respond = (value) => {
      if (responded) return;
      responded = true;
      try { sendResponse(value); } catch { /* Chrome has already closed this optional response channel. */ }
    };
    requestAdapter(adapter, adapterTimeoutMs, setTimeoutFn, clearTimeoutFn)
      .then((entitlement) => {
        const normalized = normalizeEntitlementSnapshot(entitlement);
        if (!normalized.valid) {
          respond({ ok: false, entitlement: errorEntitlementSnapshot() });
          return;
        }
        respond({ ok: true, entitlement: normalized });
      })
      .catch(() => respond({ ok: false, entitlement: errorEntitlementSnapshot() }));

    return true;
  };
}
