export const COLLECTION_PREFIX = "collection:";
export const SCHEMA_VERSION = 1;

export function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function defaultCollectionName(date = new Date()) {
  const datePart = new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
  const timePart = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
  return `Tabs — ${datePart}, ${timePart}`;
}

export function collectionKey(id) {
  return `${COLLECTION_PREFIX}${id}`;
}

export function flattenTabs(collection) {
  return (collection?.sourceWindows || [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .flatMap((sourceWindow) => (sourceWindow.tabs || []).slice().sort((a, b) => a.order - b.order));
}

function isStoredTab(value) {
  return Boolean(
    value &&
      Number.isFinite(value.order) &&
      typeof value.title === "string" &&
      typeof value.url === "string" &&
      (value.pinned === undefined || typeof value.pinned === "boolean")
  );
}

function isStoredWindow(value) {
  return Boolean(
    value &&
      Number.isFinite(value.order) &&
      Array.isArray(value.tabs) &&
      value.tabs.every(isStoredTab)
  );
}

export function isCollection(value) {
  return Boolean(
    value &&
      value.schemaVersion === SCHEMA_VERSION &&
      typeof value.id === "string" &&
      value.id.length > 0 &&
      typeof value.name === "string" &&
      typeof value.createdAt === "string" &&
      Number.isFinite(Date.parse(value.createdAt)) &&
      Array.isArray(value.sourceWindows) &&
      value.sourceWindows.every(isStoredWindow)
  );
}

export function collectionsFromStorage(items) {
  return Object.entries(items || {})
    .filter(([key, value]) => key.startsWith(COLLECTION_PREFIX) && isCollection(value))
    .map(([, value]) => value)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function sanitizeFilename(name) {
  const cleaned = String(name || "browsecase")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 80);
  return cleaned || "browsecase";
}
