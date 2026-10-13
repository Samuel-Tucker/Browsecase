export const ENTITLEMENT_VERSION = 1;

export const ENTITLEMENT_STATES = Object.freeze([
  "accountless",
  "signed_in_free",
  "pro_active",
  "pro_lapsed",
  "offline_unknown",
  "error"
]);

export const REMOTE_FEATURE_IDS = Object.freeze([
  "sync_setup",
  "remote_collection_read",
  "remote_collection_write",
  "remote_revision_read",
  "remote_revision_write",
  "device_enrol"
]);

// This is a product promise, not an implementation claim. The S3 core only
// decides entitlement; it does not add any remote persistence or capture work.
export const PRO_V1_PROMISE = Object.freeze({
  collectionScope: "deliberately_saved_collections_only",
  explicitOptIn: true,
  automaticEncryptedRevisionAfterSavedLibraryChanges: true,
  revisionRetentionDays: 90,
  maxVersionsPerCollection: 50,
  maxDevices: 5,
  scheduledLiveTabCapture: false
});

const STATE_SET = new Set(ENTITLEMENT_STATES);
const FEATURE_SET = new Set(REMOTE_FEATURE_IDS);
const MAX_ACTIVE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ISSUED_AT_SKEW_MS = 5 * 60 * 1000;
const INVALID_SNAPSHOT = Object.freeze({
  version: ENTITLEMENT_VERSION,
  state: "error",
  authoritative: false,
  issuedAt: null,
  expiresAt: null,
  valid: false
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function parseTimestamp(value) {
  // Accept only the canonical UTC representation. Date.parse alone accepts
  // ambiguous and normalized inputs that an entitlement issuer must not emit.
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value ? timestamp : null;
}

function freezeSnapshot(snapshot) {
  return Object.freeze({ ...snapshot });
}

/**
 * Converts untrusted entitlement data into the only snapshot shape consumed by
 * the UI. Invalid input is represented as an error state instead of throwing.
 */
export function normalizeEntitlementSnapshot(value) {
  try {
    if (!isPlainObject(value) || value.version !== ENTITLEMENT_VERSION || !STATE_SET.has(value.state)) {
      return INVALID_SNAPSHOT;
    }

    const issuedAtTime = parseTimestamp(value.issuedAt);
    const expiresAtTime = parseTimestamp(value.expiresAt);
    const valid = typeof value.authoritative === "boolean" && issuedAtTime !== null && expiresAtTime !== null && issuedAtTime <= expiresAtTime;

    return freezeSnapshot({
      version: ENTITLEMENT_VERSION,
      state: value.state,
      authoritative: valid ? value.authoritative : false,
      issuedAt: valid ? value.issuedAt : null,
      expiresAt: valid ? value.expiresAt : null,
      valid
    });
  } catch {
    return INVALID_SNAPSHOT;
  }
}

export function errorEntitlementSnapshot() {
  return INVALID_SNAPSHOT;
}

/**
 * Checks the client-observable freshness envelope for an active snapshot.
 * This is deliberately not a server authorization decision: every paid
 * operation must independently be authorized by its server.
 */
export function isCurrentActiveEntitlement(snapshot, now = Date.now()) {
  const normalized = normalizeEntitlementSnapshot(snapshot);
  const nowTime = typeof now === "number" && Number.isFinite(now) ? now : NaN;
  const issuedAtTime = parseTimestamp(normalized.issuedAt);
  const expiresAtTime = parseTimestamp(normalized.expiresAt);
  return Boolean(
    normalized.valid &&
      normalized.state === "pro_active" &&
      normalized.authoritative &&
      Number.isFinite(nowTime) &&
      issuedAtTime !== null &&
      expiresAtTime !== null &&
      issuedAtTime <= nowTime + MAX_ISSUED_AT_SKEW_MS &&
      expiresAtTime > nowTime &&
      expiresAtTime - issuedAtTime <= MAX_ACTIVE_TTL_MS
  );
}

function advisoryDecision(allowed, reason) {
  return Object.freeze({
    allowed,
    reason,
    advisory: true,
    requiresServerAuthorization: true
  });
}

/**
 * The sole feature-decision API. It deliberately covers remote features only;
 * free functionality must continue without asking this module for permission.
 */
export function decideRemoteFeature(snapshot, featureId, now = Date.now()) {
  if (!FEATURE_SET.has(featureId)) return advisoryDecision(false, "unknown_feature");

  const normalized = normalizeEntitlementSnapshot(snapshot);
  if (!normalized.valid) return advisoryDecision(false, "invalid_entitlement");
  if (normalized.state !== "pro_active") return advisoryDecision(false, normalized.state);

  const nowTime = typeof now === "number" && Number.isFinite(now) ? now : NaN;
  const issuedAtTime = parseTimestamp(normalized.issuedAt);
  const expiresAtTime = parseTimestamp(normalized.expiresAt);
  if (!Number.isFinite(nowTime) || issuedAtTime === null || expiresAtTime === null) {
    return advisoryDecision(false, "invalid_entitlement");
  }
  if (issuedAtTime > nowTime + MAX_ISSUED_AT_SKEW_MS) return advisoryDecision(false, "future_issued");
  if (expiresAtTime <= nowTime) return advisoryDecision(false, "expired");
  if (expiresAtTime - issuedAtTime > MAX_ACTIVE_TTL_MS) return advisoryDecision(false, "excessive_ttl");
  if (!normalized.authoritative) return advisoryDecision(false, "not_authoritative");
  return advisoryDecision(true, "pro_active");
}
