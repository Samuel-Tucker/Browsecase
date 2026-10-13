import { ENTITLEMENT_VERSION, normalizeEntitlementSnapshot } from "../lib/pro-entitlement.js";

// This adapter is intentionally static: it performs no identity, network,
// environment, or extension-storage lookup.
const ACCOUNTLESS_ENTITLEMENT = normalizeEntitlementSnapshot({
  version: ENTITLEMENT_VERSION,
  state: "accountless",
  authoritative: false,
  issuedAt: "1970-01-01T00:00:00.000Z",
  expiresAt: "1970-01-01T00:00:00.000Z"
});

export function createAccountlessAdapter() {
  return Object.freeze({
    async getEntitlement() {
      return ACCOUNTLESS_ENTITLEMENT;
    }
  });
}
