import { COLLECTION_PREFIX, SCHEMA_VERSION, collectionKey } from "./model.js";

/** The stable, legacy-compatible portable JSON envelope for Browsecase collection backups. */
export const BACKUP_FORMAT = "tab-pack-backup";
export const BACKUP_FORMAT_VERSION = 1;

/** Deliberately conservative limits for untrusted backup files. */
export const BACKUP_LIMITS = Object.freeze({
  maxBytes: 5 * 1024 * 1024,
  maxCollections: 1_000,
  maxWindowsPerCollection: 1_000,
  maxTabsPerCollection: 5_000,
  maxTabs: 25_000,
  maxTextBytes: 2 * 1024 * 1024,
  maxIdBytes: 256,
  maxNameBytes: 1_024,
  maxTitleBytes: 8_192,
  maxUrlBytes: 16_384
});

/** A user-safe error: callers may show its message, but should not expose input. */
export class BackupValidationError extends Error {
  constructor(code, message = "This backup file is not valid.") {
    super(message);
    this.name = "BackupValidationError";
    this.code = code;
  }
}

const encoder = new TextEncoder();
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function fail(code, message) {
  throw new BackupValidationError(code, message);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function byteLength(value) {
  return encoder.encode(value).byteLength;
}

function requireString(value, code, maxBytes) {
  if (typeof value !== "string" || byteLength(value) > maxBytes) fail(code);
  return value;
}

function requireDate(value, code) {
  const string = requireString(value, code, 128);
  if (!Number.isFinite(Date.parse(string))) fail(code);
  return string;
}

function requireFiniteNumber(value, code) {
  if (!Number.isFinite(value)) fail(code);
  return value;
}

function canonicalTab(tab, totals) {
  if (!isObject(tab)) fail("invalid_collection");
  const title = requireString(tab.title, "invalid_collection", BACKUP_LIMITS.maxTitleBytes);
  const url = requireString(tab.url, "invalid_collection", BACKUP_LIMITS.maxUrlBytes);
  totals.textBytes += byteLength(title) + byteLength(url);
  if (totals.textBytes > BACKUP_LIMITS.maxTextBytes) fail("text_too_large");

  const result = {
    order: requireFiniteNumber(tab.order, "invalid_collection"),
    title,
    url
  };
  if (own(tab, "pinned")) {
    if (typeof tab.pinned !== "boolean") fail("invalid_collection");
    result.pinned = tab.pinned;
  }
  return result;
}

function canonicalCollection(collection, totals) {
  if (!isObject(collection) || collection.schemaVersion !== SCHEMA_VERSION) fail("invalid_collection");

  const id = requireString(collection.id, "invalid_collection", BACKUP_LIMITS.maxIdBytes);
  if (!id) fail("invalid_collection");
  const result = {
    schemaVersion: SCHEMA_VERSION,
    id,
    name: requireString(collection.name, "invalid_collection", BACKUP_LIMITS.maxNameBytes),
    createdAt: requireDate(collection.createdAt, "invalid_collection")
  };
  if (own(collection, "updatedAt")) result.updatedAt = requireDate(collection.updatedAt, "invalid_collection");
  if (!Array.isArray(collection.sourceWindows) || collection.sourceWindows.length > BACKUP_LIMITS.maxWindowsPerCollection) {
    fail("invalid_collection");
  }

  let collectionTabs = 0;
  result.sourceWindows = collection.sourceWindows.map((sourceWindow) => {
    if (!isObject(sourceWindow) || !Array.isArray(sourceWindow.tabs)) fail("invalid_collection");
    const tabs = sourceWindow.tabs.map((tab) => {
      collectionTabs += 1;
      totals.tabs += 1;
      if (collectionTabs > BACKUP_LIMITS.maxTabsPerCollection || totals.tabs > BACKUP_LIMITS.maxTabs) {
        fail("too_many_tabs");
      }
      return canonicalTab(tab, totals);
    });
    return { order: requireFiniteNumber(sourceWindow.order, "invalid_collection"), tabs };
  });
  return result;
}

function canonicalRecords(records) {
  if (!Array.isArray(records) || records.length > BACKUP_LIMITS.maxCollections) fail("invalid_collections");
  const totals = { tabs: 0, textBytes: 0 };
  const seenKeys = new Set();
  const seenIds = new Set();
  const normalized = records.map((record) => {
    if (!isObject(record)) fail("invalid_record");
    const collection = canonicalCollection(record.collection, totals);
    const key = requireString(record.key, "invalid_record", BACKUP_LIMITS.maxIdBytes + COLLECTION_PREFIX.length);
    if (key !== collectionKey(collection.id) || seenKeys.has(key) || seenIds.has(collection.id)) fail("invalid_record");
    seenKeys.add(key);
    seenIds.add(collection.id);
    return { key, collection };
  });

  // Key ordering makes the serialized representation canonical and repeatable.
  return normalized.sort((a, b) => a.key.localeCompare(b.key));
}

function canonicalBackup(value) {
  if (!isObject(value)) fail("invalid_backup");
  if (value.format !== BACKUP_FORMAT) fail("unsupported_format", "This file is not a Browsecase backup.");
  if (value.version !== BACKUP_FORMAT_VERSION) fail("unsupported_version", "This Browsecase backup version is not supported.");
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_FORMAT_VERSION,
    exportedAt: requireDate(value.exportedAt, "invalid_exported_at"),
    collections: canonicalRecords(value.collections)
  };
}

/**
 * Builds a validated, safe-cloned backup envelope from storage-shaped records:
 * `{ key: "collection:<id>", collection }`.
 */
export function buildBackup(records, { exportedAt = new Date().toISOString() } = {}) {
  return canonicalBackup({
    format: BACKUP_FORMAT,
    version: BACKUP_FORMAT_VERSION,
    exportedAt,
    collections: records
  });
}

/** Serializes a canonical backup envelope to JSON. */
export function serializeBackup(records, options) {
  return JSON.stringify(buildBackup(records, options));
}

/**
 * Strictly parses one complete backup file. It never accepts a valid subset,
 * and returns a new data graph that callers may safely mutate.
 */
export function parseBackup(text) {
  if (typeof text !== "string") fail("invalid_input");
  if (byteLength(text) > BACKUP_LIMITS.maxBytes) fail("backup_too_large", "This backup file is too large to import.");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail("invalid_json", "This backup file is not valid JSON.");
  }
  return canonicalBackup(parsed);
}

/**
 * Reserves every identifier that could already occupy a collection key.
 *
 * Storage can contain a collection written by a newer build or a malformed
 * value. Both its raw key suffix and any string `id` in its value are treated
 * as occupied so an import can never overwrite that record.
 */
export function occupiedCollectionIdsFromStorage(items) {
  const occupied = new Set();
  for (const [key, value] of Object.entries(items || {})) {
    if (key.startsWith(COLLECTION_PREFIX)) {
      const rawId = key.slice(COLLECTION_PREFIX.length);
      if (rawId) occupied.add(rawId);
    }
    if (isObject(value) && typeof value.id === "string" && value.id) occupied.add(value.id);
  }
  return occupied;
}

/**
 * Plans storage-shaped import records without touching Chrome or storage.
 * Occupied IDs stay untouched; only collisions are remapped by `idFactory`.
 */
export function planImport(backup, existingIds = [], idFactory) {
  const validated = typeof backup === "string" ? parseBackup(backup) : canonicalBackup(backup);
  if (typeof idFactory !== "function") throw new TypeError("idFactory must be a function");

  const occupied = new Set();
  for (const id of existingIds) {
    if (typeof id !== "string" || !id) throw new TypeError("existingIds must contain non-empty strings");
    occupied.add(id);
  }
  // A replacement must not steal an ID that belongs to another incoming
  // collection. Those original IDs remain available to their own records.
  const backupIds = new Set(validated.collections.map(({ collection }) => collection.id));

  const remappedIds = [];
  const records = validated.collections.map(({ key, collection }) => {
    let id = collection.id;
    if (occupied.has(id)) {
      let attempts = 0;
      do {
        attempts += 1;
        if (attempts > 100) {
          throw new BackupValidationError("id_collision", "Could not allocate a unique collection ID for this import.");
        }
        id = idFactory();
        if (typeof id !== "string" || !id || byteLength(id) > BACKUP_LIMITS.maxIdBytes) {
          throw new TypeError("idFactory must return a non-empty ID within the backup limit");
        }
      } while (occupied.has(id) || backupIds.has(id));
      remappedIds.push({ from: collection.id, to: id });
    }
    occupied.add(id);
    const imported = { ...collection, id };
    return { key: id === collection.id ? key : collectionKey(id), collection: imported };
  });

  return {
    records,
    importedCount: records.length,
    remappedIds
  };
}
