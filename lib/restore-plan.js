import { isCollection } from "./model.js";
import { isRestorableUrl } from "./url-policy.js";

/** Limits restore planning to a bounded amount of storage-shaped input. */
export const RESTORE_PLAN_LIMITS = Object.freeze({
  maxSourceWindows: 1_000,
  maxSourceTabs: 5_000
});

export class RestorePlanError extends Error {
  constructor(message = "This collection cannot be restored.", code = "invalid_collection") {
    super(message);
    this.name = "RestorePlanError";
    this.code = code;
  }
}

function preflight(collection) {
  if (!collection || !Array.isArray(collection.sourceWindows)) throw new RestorePlanError();
  if (collection.sourceWindows.length > RESTORE_PLAN_LIMITS.maxSourceWindows) {
    throw new RestorePlanError("This collection is too large to restore.", "too_many_source_windows");
  }

  let sourceTabs = 0;
  for (const sourceWindow of collection.sourceWindows) {
    if (!sourceWindow || !Array.isArray(sourceWindow.tabs)) throw new RestorePlanError();
    sourceTabs += sourceWindow.tabs.length;
    if (sourceTabs > RESTORE_PLAN_LIMITS.maxSourceTabs) {
      throw new RestorePlanError("This collection is too large to restore.", "too_many_source_tabs");
    }
  }
}

function ordered(items) {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.order - b.item.order || a.index - b.index)
    .map(({ item }) => item);
}

/**
 * Produces one Chrome-independent restore job per source window with at least
 * one restorable tab. Callers can execute the jobs later with Chrome APIs.
 */
export function planRestore(collection) {
  // Run before validation's nested iteration and before ordering/copying work.
  preflight(collection);
  if (!isCollection(collection)) throw new RestorePlanError();

  const jobs = [];
  const skippedTabs = [];
  const skippedWindows = [];
  let sourceTabs = 0;

  for (const sourceWindow of ordered(collection.sourceWindows)) {
    const tabs = [];
    for (const tab of ordered(sourceWindow.tabs)) {
      sourceTabs += 1;
      if (!isRestorableUrl(tab.url)) {
        skippedTabs.push({
          sourceWindowOrder: sourceWindow.order,
          tabOrder: tab.order,
          url: tab.url,
          reason: "unsupported_url"
        });
        continue;
      }
      tabs.push({
        order: tab.order,
        title: tab.title,
        url: tab.url,
        pinned: Boolean(tab.pinned)
      });
    }
    if (!tabs.length) {
      skippedWindows.push({
        sourceWindowOrder: sourceWindow.order,
        reason: sourceWindow.tabs.length ? "no_restorable_tabs" : "empty_source_window"
      });
      continue;
    }
    jobs.push({ sourceWindowOrder: sourceWindow.order, tabs });
  }

  const plannedTabs = jobs.reduce((count, job) => count + job.tabs.length, 0);
  return {
    jobs,
    skippedTabs,
    skippedWindows,
    counts: {
      sourceWindows: collection.sourceWindows.length,
      sourceTabs,
      jobs: jobs.length,
      plannedTabs,
      skippedTabs: skippedTabs.length,
      skippedWindows: skippedWindows.length
    }
  };
}
