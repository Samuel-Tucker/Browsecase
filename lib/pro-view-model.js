import { ENTITLEMENT_STATES, isCurrentActiveEntitlement, normalizeEntitlementSnapshot } from "./pro-entitlement.js";

const CTA_DISABLED = true;

export const PRO_CARD_MODELS = Object.freeze({
  accountless: Object.freeze({
    badge: "Optional Pro",
    title: "Cloud protection, when you choose it",
    body: "Your collections stay local and keep working. Existing collections are not uploaded automatically.",
    footnote: "Cloud protection setup will be an explicit opt-in.",
    ctaLabel: "Pro setup coming soon",
    ctaDisabled: CTA_DISABLED
  }),
  signed_in_free: Object.freeze({
    badge: "Free plan",
    title: "Your local library is ready",
    body: "Your local library keeps working. Cloud protection will only begin after an explicit opt-in.",
    footnote: "Existing collections are never uploaded automatically.",
    ctaLabel: "Pro setup coming soon",
    ctaDisabled: CTA_DISABLED
  }),
  pro_active: Object.freeze({
    badge: "Pro access verified",
    title: "Cloud protection setup is coming",
    body: "Your Pro access is verified. Your local library keeps working; no collections are syncing yet.",
    footnote: "Setup will be an explicit opt-in. Existing collections are not uploaded automatically.",
    ctaLabel: "Setup coming soon",
    ctaDisabled: CTA_DISABLED
  }),
  pro_lapsed: Object.freeze({
    badge: "Pro access needs attention",
    title: "Your local library stays available",
    body: "Your local library remains available. Remote availability cannot be confirmed in this build.",
    footnote: "Remote writes are unavailable.",
    ctaLabel: "Check Pro later",
    ctaDisabled: CTA_DISABLED
  }),
  offline_unknown: Object.freeze({
    badge: "Pro status unavailable",
    title: "Your local library stays available",
    body: "Your local library keeps working while Pro status is unavailable.",
    footnote: "This panel cannot confirm cloud protection or any remote collection access.",
    ctaLabel: "Try again later",
    ctaDisabled: CTA_DISABLED
  }),
  error: Object.freeze({
    badge: "Pro status unavailable",
    title: "Your local library stays available",
    body: "Your local library remains available. Remote availability cannot be confirmed in this build.",
    footnote: "Remote writes are unavailable.",
    ctaLabel: "Try again later",
    ctaDisabled: CTA_DISABLED
  })
});

function validState(snapshot, now) {
  const normalized = normalizeEntitlementSnapshot(snapshot);
  if (normalized.valid && normalized.state === "pro_active" && !isCurrentActiveEntitlement(normalized, now)) return "error";
  return normalized.valid && ENTITLEMENT_STATES.includes(normalized.state)
    ? normalized.state
    : "error";
}

/**
 * Produces display-only state for the optional Pro card. It makes no feature
 * decision and malformed entitlement input is deliberately shown as an error.
 */
export function proCardViewModel(snapshot, now = Date.now()) {
  const state = validState(snapshot, now);
  return Object.freeze({ state, ...PRO_CARD_MODELS[state] });
}
