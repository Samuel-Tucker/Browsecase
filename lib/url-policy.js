const BLOCKED_PROTOCOLS = new Set(["javascript:", "data:", "blob:"]);
const RESTORE_PROTOCOLS = new Set(["http:", "https:", "file:", "chrome:"]);
const EXPORT_PROTOCOLS = new Set(["http:", "https:", "file:"]);

export function parseUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function isCapturableUrl(value, extensionBase = "") {
  const parsed = parseUrl(value);
  if (!parsed || BLOCKED_PROTOCOLS.has(parsed.protocol)) return false;
  const normalizedBase = extensionBase.replace(/\/$/, "");
  if (normalizedBase && (value === normalizedBase || value.startsWith(`${normalizedBase}/`))) return false;
  return true;
}

export function isRestorableUrl(value) {
  const parsed = parseUrl(value);
  return Boolean(parsed && RESTORE_PROTOCOLS.has(parsed.protocol));
}

export function isExportClickableUrl(value) {
  const parsed = parseUrl(value);
  return Boolean(parsed && EXPORT_PROTOCOLS.has(parsed.protocol));
}

export function displayHost(value) {
  const parsed = parseUrl(value);
  if (!parsed) return "Unknown address";
  if (parsed.hostname) return parsed.hostname.replace(/^www\./, "");
  return parsed.protocol.replace(":", "").toUpperCase() || "Link";
}
