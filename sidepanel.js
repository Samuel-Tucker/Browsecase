import { BACKUP_LIMITS, BackupValidationError, occupiedCollectionIdsFromStorage, parseBackup, planImport, serializeBackup } from "./lib/backup.js";
import { buildExportHtml, exportFilename } from "./lib/export-html.js";
import { SCHEMA_VERSION, collectionKey, collectionsFromStorage, createId, defaultCollectionName, flattenTabs } from "./lib/model.js";
import { planRestore } from "./lib/restore-plan.js";
import { displayHost, isCapturableUrl, isRestorableUrl } from "./lib/url-policy.js";

const ONBOARDING_KEY = "tab-pack:onboarding-dismissed";
const LARGE_RESTORE_TAB_COUNT = 25;
const DOWNLOAD_CLEANUP_MS = 120_000;
const $ = (selector) => document.querySelector(selector);
const elements = {
  appShell: $(".app-shell"),
  storageSummary: $("#storage-summary"), collectionCount: $("#collection-count"), captureView: $("#capture-view"), collectionsView: $("#collections-view"),
  refreshTabs: $("#refresh-tabs"), tabSummary: $("#tab-summary"), collectionName: $("#collection-name"), tabFilter: $("#tab-filter"), toggleAllTabs: $("#toggle-all-tabs"), captureEmpty: $("#capture-empty"), tabList: $("#tab-list"), selectedCount: $("#selected-count"), saveCollection: $("#save-collection"),
  collectionFilter: $("#collection-filter"), collectionsEmpty: $("#collections-empty"), collectionList: $("#collection-list"), emptyCaptureButton: $("#empty-capture-button"), exportBackup: $("#export-backup"), importBackupButton: $("#import-backup-button"), importBackup: $("#import-backup"),
  listScreen: $("#collections-list-screen"), detailScreen: $("#collection-detail-screen"), detailBack: $("#detail-back"), detailDate: $("#detail-date"), detailTitle: $("#detail-title"), detailMeta: $("#detail-meta"), detailOpenAll: $("#detail-open-all"), detailExport: $("#detail-export"), detailRename: $("#detail-rename"), detailDelete: $("#detail-delete"), detailFilter: $("#detail-filter"), detailLinkList: $("#detail-link-list"),
  proCard: $("#pro-card"), proBadge: $("#pro-card-badge"), proTitle: $("#pro-card-title"), proBody: $("#pro-card-body"), proFootnote: $("#pro-card-footnote"), proCta: $("#pro-card-cta"),
  onboarding: $("#onboarding"), dismissOnboarding: $("#dismiss-onboarding"), toast: $("#toast")
};

const state = {
  view: "capture", scope: "all", openTabs: [], windowCount: 0, selectedTabKeys: new Set(), collections: [], detailId: null, toastTimer: null,
  captureRequest: 0, loadingTabs: false, restoring: false, onboardingFocus: null
};
let importQueue = Promise.resolve();

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function formatDate(value, includeTime = true) {
  return new Intl.DateTimeFormat(undefined, includeTime
    ? { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "numeric", month: "long", year: "numeric" }).format(new Date(value));
}

function showToast(message, isError = false) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("is-error", isError);
  elements.toast.setAttribute("role", isError ? "alert" : "status");
  elements.toast.setAttribute("aria-live", isError ? "assertive" : "polite");
  elements.toast.hidden = false;
  state.toastTimer = setTimeout(() => { elements.toast.hidden = true; }, 4200);
}

function setOnboardingVisible(visible) {
  if (visible) {
    const activeElement = document.activeElement;
    state.onboardingFocus = activeElement instanceof HTMLElement && activeElement !== document.body
      ? activeElement
      : $("#capture-tab");
  }
  elements.onboarding.hidden = !visible;
  elements.appShell.inert = visible;
  document.body.classList.toggle("onboarding-open", visible);
  if (visible) requestAnimationFrame(() => elements.dismissOnboarding.focus());
  else {
    const restoreFocus = state.onboardingFocus instanceof HTMLElement && state.onboardingFocus.isConnected
      ? state.onboardingFocus
      : $("#capture-tab");
    state.onboardingFocus = null;
    requestAnimationFrame(() => restoreFocus?.focus());
  }
}

function focusHeading(selector) {
  requestAnimationFrame(() => $(selector)?.focus());
}

function resetPanelScroll() {
  window.scrollTo({ left: 0, top: 0, behavior: "instant" });
}

function switchView(view, { focus = true } = {}) {
  state.view = view;
  resetPanelScroll();
  document.body.classList.toggle("capture-active", view === "capture");
  elements.captureView.hidden = view !== "capture";
  elements.collectionsView.hidden = view !== "collections";
  document.querySelectorAll(".view-tab").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  if (view === "collections") renderCollections();
  requestAnimationFrame(resetPanelScroll);
  if (focus) focusHeading(view === "capture" ? "#capture-heading" : "#collections-heading");
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.setAttribute("aria-busy", String(busy));
  if (busy) {
    button.dataset.originalHtml = button.innerHTML;
    button.textContent = label;
  } else if (button.dataset.originalHtml !== undefined) {
    button.innerHTML = button.dataset.originalHtml;
    delete button.dataset.originalHtml;
  }
}

function restorableCount(collection) {
  try { return planRestore(collection).counts.plannedTabs; } catch { return 0; }
}

async function loadOpenTabs({ preserveSelection = false } = {}) {
  const request = ++state.captureRequest;
  const scope = state.scope;
  setCaptureLoading(true);
  setBusy(elements.refreshTabs, true, "Refreshing…");
  try {
    const windows = scope === "current"
      ? [await chrome.windows.getCurrent({ populate: true })]
      : await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
    if (request !== state.captureRequest) return;
    const ownOrigin = chrome.runtime.getURL("");
    const previous = state.selectedTabKeys;
    state.windowCount = windows.length;
    state.openTabs = windows.flatMap((windowInfo, windowOrder) => (windowInfo.tabs || []).map((tab, tabOrder) => {
      const url = tab.pendingUrl || tab.url || "";
      return { key: `${windowInfo.id}:${tab.id}`, windowOrder, tabOrder, title: tab.title || url || "Untitled tab", url, pinned: Boolean(tab.pinned), eligible: isCapturableUrl(url, ownOrigin) };
    })).filter((tab) => tab.eligible);
    state.selectedTabKeys = new Set(state.openTabs.filter((tab) => !preserveSelection || previous.has(tab.key)).map((tab) => tab.key));
    if (preserveSelection && !state.selectedTabKeys.size) state.selectedTabKeys = new Set(state.openTabs.map((tab) => tab.key));
    renderOpenTabs();
  } catch (error) {
    if (request !== state.captureRequest) return;
    state.openTabs = []; state.selectedTabKeys.clear(); renderOpenTabs();
    showToast("Couldn’t read open tabs. Try refreshing.", true); console.error(error);
  } finally {
    if (request === state.captureRequest) {
      setCaptureLoading(false);
      setBusy(elements.refreshTabs, false, "");
    }
  }
}

function setCaptureLoading(loading) {
  state.loadingTabs = loading;
  document.querySelectorAll(".scope-button").forEach((button) => { button.disabled = loading; });
  elements.refreshTabs.disabled = loading;
  elements.toggleAllTabs.disabled = loading || state.openTabs.length === 0;
  updateSelectionSummary();
}

function renderOpenTabs() {
  const query = elements.tabFilter.value.trim().toLocaleLowerCase();
  const visible = state.openTabs.filter((tab) => !query || `${tab.title} ${tab.url}`.toLocaleLowerCase().includes(query));
  updateCaptureFeedback(visible.length);
  elements.tabList.replaceChildren(); elements.captureEmpty.hidden = state.openTabs.length !== 0;
  const fragment = document.createDocumentFragment();
  for (const tab of visible) {
    const row = createElement("label", "tab-item"); row.setAttribute("role", "listitem");
    const checkbox = createElement("input", "tab-check"); checkbox.type = "checkbox"; checkbox.dataset.tabKey = tab.key; checkbox.checked = state.selectedTabKeys.has(tab.key); checkbox.setAttribute("aria-label", `Include ${tab.title}`);
    row.classList.toggle("is-unselected", !checkbox.checked);
    const main = createElement("span", "item-main"); main.append(createElement("span", "item-title", tab.title), createElement("span", "item-domain", displayHost(tab.url)));
    row.append(checkbox, main); fragment.append(row);
  }
  elements.tabList.append(fragment); updateSelectionSummary();
}

function updateCaptureFeedback(visibleCount) {
  const query = elements.tabFilter.value.trim().toLocaleLowerCase();
  const shown = visibleCount ?? state.openTabs.filter((tab) => !query || `${tab.title} ${tab.url}`.toLocaleLowerCase().includes(query)).length;
  elements.tabSummary.textContent = `Showing ${shown} of ${state.openTabs.length} open ${state.openTabs.length === 1 ? "tab" : "tabs"}; selected ${state.selectedTabKeys.size}.`;
}

function updateSelectionSummary() {
  const count = state.selectedTabKeys.size;
  elements.selectedCount.textContent = `${count} selected`; elements.saveCollection.disabled = count === 0 || state.loadingTabs;
  elements.toggleAllTabs.disabled = state.loadingTabs || state.openTabs.length === 0;
  elements.toggleAllTabs.textContent = state.openTabs.length > 0 && count === state.openTabs.length ? "Clear all open tabs" : "Select all open tabs";
  updateCaptureFeedback();
}

function selectedTabsByWindow() {
  const grouped = new Map();
  for (const tab of state.openTabs.filter((item) => state.selectedTabKeys.has(item.key))) {
    if (!grouped.has(tab.windowOrder)) grouped.set(tab.windowOrder, []);
    grouped.get(tab.windowOrder).push({ order: tab.tabOrder, title: tab.title, url: tab.url, pinned: tab.pinned });
  }
  return [...grouped.entries()].map(([order, tabs]) => ({ order, tabs }));
}

async function saveCollection() {
  const sourceWindows = selectedTabsByWindow(); if (!sourceWindows.length) return;
  const downloadPermission = requestOptionalDownloadsOnGesture();
  const now = new Date();
  const collection = { schemaVersion: SCHEMA_VERSION, id: createId(), name: elements.collectionName.value.trim() || defaultCollectionName(now), createdAt: now.toISOString(), updatedAt: now.toISOString(), sourceWindows };
  setBusy(elements.saveCollection, true, "Saving…");
  try {
    await chrome.storage.local.set({ [collectionKey(collection.id)]: collection });
    await loadCollections(); elements.collectionName.value = defaultCollectionName(); switchView("collections");
    showToast(`Saved ${flattenTabs(collection).length} links to “${collection.name}”.`);
    // Saving is complete before the optional download path begins.
    void downloadBlob(
      new Blob([buildExportHtml(collection)], { type: "text/html;charset=utf-8" }),
      exportFilename(collection),
      downloadPermission,
      "Saved locally."
    );
  } catch (error) { showToast("Couldn’t save this collection. Your selected tabs are unchanged.", true); console.error(error); }
  finally { setBusy(elements.saveCollection, false, ""); }
}

function anchorDownload(objectUrl, filename, statusPrefix = "") {
  const anchor = document.createElement("a"); anchor.href = objectUrl; anchor.download = filename; anchor.style.display = "none";
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  showToast(`${statusPrefix ? `${statusPrefix} ` : ""}Download started.`);
}

function requestOptionalDownloadsOnGesture() {
  try {
    if (!chrome.permissions?.request) return Promise.resolve(false);
    return chrome.permissions.request({ permissions: ["downloads"] }).catch((error) => { console.warn("Optional downloads permission was denied", error); return false; });
  } catch (error) { console.warn("Optional downloads permission was unavailable", error); return Promise.resolve(false); }
}

async function downloadBlob(blob, filename, downloadPermission = Promise.resolve(false), statusPrefix = "") {
  const objectUrl = URL.createObjectURL(blob);
  const message = (text) => `${statusPrefix ? `${statusPrefix} ` : ""}${text}`;
  try {
    if (!await downloadPermission) { anchorDownload(objectUrl, filename, statusPrefix); return; }
    if (!chrome.downloads?.download) { anchorDownload(objectUrl, filename, statusPrefix); return; }
    let downloadId;
    try { downloadId = await chrome.downloads.download({ url: objectUrl, filename, saveAs: false }); }
    catch (error) { console.warn("Chrome downloads API was unavailable", error); anchorDownload(objectUrl, filename, statusPrefix); return; }
    showToast(message("Download started."));
    let settled = false;
    let timeoutId;
    const onChanged = (delta) => {
      if (delta.id !== downloadId || !delta.state) return;
      if (delta.state.current === "complete") finish("complete");
      if (delta.state.current === "interrupted") finish("interrupted");
    };
    const cleanup = () => {
      if (settled) return false;
      settled = true;
      clearTimeout(timeoutId);
      chrome.downloads?.onChanged?.removeListener?.(onChanged);
      URL.revokeObjectURL(objectUrl);
      return true;
    };
    const finish = (outcome) => {
      if (!cleanup()) return;
      if (outcome === "complete") showToast(message("Download complete."));
      else if (outcome === "interrupted") showToast(message("Download interrupted."), true);
      else showToast(message("Download status timed out; check Chrome downloads."), true);
    };
    chrome.downloads?.onChanged?.addListener?.(onChanged);
    timeoutId = setTimeout(() => finish("timeout"), DOWNLOAD_CLEANUP_MS);
    // A download can finish between `download()` resolving and listener setup.
    try {
      const [record] = await chrome.downloads?.search?.({ id: downloadId }) || [];
      if (record?.state === "complete" || record?.state === "interrupted") finish(record.state);
    } catch (error) { console.warn("Couldn’t reconcile Chrome download status", error); }
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    showToast(message("Couldn’t start the download."), true); console.error(error);
  }
}

async function loadCollections() {
  try {
    const items = await chrome.storage.local.get(null); state.collections = collectionsFromStorage(items);
    elements.collectionCount.textContent = String(state.collections.length);
    elements.storageSummary.textContent = state.collections.length ? `${state.collections.length} local ${state.collections.length === 1 ? "collection" : "collections"}` : "Local tab archive";
    renderCollections(); if (state.detailId) renderDetail();
  } catch (error) { showToast("Couldn’t load local collections.", true); console.error(error); }
}

function collectionDomains(collection) { return [...new Set(flattenTabs(collection).map((tab) => displayHost(tab.url)))]; }

function renderCollections() {
  const query = elements.collectionFilter.value.trim().toLocaleLowerCase();
  const filtered = state.collections.filter((collection) => !query || `${collection.name} ${collectionDomains(collection).join(" ")}`.toLocaleLowerCase().includes(query));
  elements.collectionList.replaceChildren(); elements.collectionsEmpty.hidden = filtered.length !== 0;
  const emptyHeading = elements.collectionsEmpty.querySelector("h3"); const emptyCopy = elements.collectionsEmpty.querySelector("p");
  if (state.collections.length && !filtered.length) { emptyHeading.textContent = "No matching collections"; emptyCopy.textContent = "Try a different collection name or website."; elements.emptyCaptureButton.textContent = "Clear search"; }
  else { emptyHeading.textContent = "No collections yet"; emptyCopy.textContent = "Capture your open tabs and they’ll stay organised here."; elements.emptyCaptureButton.textContent = "Capture open tabs"; }
  const fragment = document.createDocumentFragment();
  for (const collection of filtered) {
    const tabs = flattenTabs(collection); const restorable = restorableCount(collection);
    const card = createElement("article", "collection-card"); card.setAttribute("role", "listitem");
    const top = createElement("div", "collection-card-top"); const folder = createElement("div", "folder-mark", "▰"); folder.setAttribute("aria-hidden", "true");
    const info = createElement("div"); info.append(createElement("h3", "", collection.name), createElement("p", "collection-meta", `${tabs.length} ${tabs.length === 1 ? "link" : "links"} · ${formatDate(collection.createdAt)}`)); top.append(folder, info);
    const chips = createElement("div", "domain-chips"); for (const domain of collectionDomains(collection).slice(0, 2)) chips.append(createElement("span", "domain-chip", domain)); if (collectionDomains(collection).length > 2) chips.append(createElement("span", "domain-chip", `+${collectionDomains(collection).length - 2} sites`));
    const actions = createElement("div", "collection-actions");
    const viewButton = createElement("button", "secondary-button", "View links"); viewButton.type = "button"; viewButton.dataset.action = "view"; viewButton.dataset.id = collection.id; viewButton.setAttribute("aria-label", `View links in ${collection.name}`);
    const openButton = createElement("button", "primary-button", `Open all ${restorable}`); openButton.type = "button"; openButton.dataset.action = "open"; openButton.dataset.id = collection.id; openButton.dataset.restorable = String(restorable); openButton.disabled = state.restoring || restorable === 0; openButton.setAttribute("aria-label", restorable ? `Open all ${restorable} restorable links in ${collection.name}` : `No restorable links in ${collection.name}`);
    actions.append(viewButton, openButton); card.append(top, chips, actions); fragment.append(card);
  }
  elements.collectionList.append(fragment);
}

function showDetail(id) { state.detailId = id; elements.listScreen.hidden = true; elements.detailScreen.hidden = false; elements.detailFilter.value = ""; renderDetail(); focusHeading("#detail-title"); }
function hideDetail() { state.detailId = null; elements.detailScreen.hidden = true; elements.listScreen.hidden = false; focusHeading("#collections-heading"); }
function currentCollection() { return state.collections.find((collection) => collection.id === state.detailId) || null; }

function renderDetail() {
  const collection = currentCollection(); if (!collection) { hideDetail(); return; }
  const tabs = flattenTabs(collection); const restorable = restorableCount(collection); const query = elements.detailFilter.value.trim().toLocaleLowerCase();
  const visible = tabs.filter((tab) => !query || `${tab.title} ${tab.url}`.toLocaleLowerCase().includes(query));
  elements.detailDate.textContent = `Saved ${formatDate(collection.createdAt, false)}`; elements.detailTitle.textContent = collection.name;
  elements.detailMeta.textContent = `${tabs.length} ${tabs.length === 1 ? "link" : "links"} · ${restorable} restorable · ${collection.sourceWindows.length} ${collection.sourceWindows.length === 1 ? "source window" : "source windows"}`;
  elements.detailOpenAll.textContent = `Open all ${restorable}`; elements.detailOpenAll.disabled = state.restoring || restorable === 0;
  elements.detailLinkList.replaceChildren(); const fragment = document.createDocumentFragment();
  for (const tab of visible) {
    const restorableTab = isRestorableUrl(tab.url); const row = createElement("div", `link-item${restorableTab ? "" : " is-reference"}`); row.setAttribute("role", "listitem");
    row.append(createElement("span", "site-mark", displayHost(tab.url).slice(0, 1)));
    const main = createElement("div", "item-main");
    if (restorableTab) { const button = createElement("button", "item-title", tab.title || tab.url); button.type = "button"; button.dataset.url = tab.url; button.title = "Open in a new tab"; main.append(button); }
    else { const title = createElement("span", "item-title", tab.title || tab.url); title.setAttribute("aria-disabled", "true"); main.append(title, createElement("span", "reference-label", "Reference only — Chrome cannot reopen this URL")); }
    main.append(createElement("div", "item-domain", tab.url)); row.append(main); fragment.append(row);
  }
  elements.detailLinkList.append(fragment);
}

async function openCollection(collection) {
  if (state.restoring) return;
  let plan;
  try { plan = planRestore(collection); } catch (error) { showToast("This collection cannot be restored.", true); console.error(error); return; }
  if (!plan.counts.plannedTabs) { showToast("This collection has no links Chrome can reopen.", true); return; }
  if (plan.counts.plannedTabs >= LARGE_RESTORE_TAB_COUNT && !window.confirm(`Open ${plan.counts.plannedTabs} restorable tabs across ${plan.counts.jobs} new windows? Chrome tab groups will not be restored.`)) return;
  setRestoreControls(true);
  let opened = 0; let runtimeSkipped = 0; let restoredWindows = 0; let cleanupWarnings = 0;
  try {
    for (const job of plan.jobs) {
      let newWindow;
      let terminalTabs = 0;
      try {
        newWindow = await chrome.windows.create({ focused: restoredWindows === 0 });
        const seedTabIds = (await chrome.tabs.query({ windowId: newWindow.id })).map((tab) => tab.id).filter(Number.isInteger);
        let openedInWindow = 0; let firstTabId = null;
        for (const tab of job.tabs) {
          try {
            const created = await chrome.tabs.create({ windowId: newWindow.id, url: tab.url, active: false, pinned: tab.pinned });
            firstTabId ||= created.id; opened += 1; openedInWindow += 1; terminalTabs += 1;
          } catch (error) { runtimeSkipped += 1; terminalTabs += 1; console.warn("Skipped a tab while restoring", tab.url, error); }
        }
        if (openedInWindow) {
          if (seedTabIds.length) { try { await chrome.tabs.remove(seedTabIds); } catch (error) { cleanupWarnings += 1; console.warn("Couldn’t remove a restore seed tab", error); } }
          if (firstTabId) { try { await chrome.tabs.update(firstTabId, { active: true }); } catch (error) { cleanupWarnings += 1; console.warn("Couldn’t activate a restored tab", error); } }
          restoredWindows += 1;
        } else if (newWindow.id) { try { await chrome.windows.remove(newWindow.id); } catch (error) { cleanupWarnings += 1; console.warn("Couldn’t remove an empty restore window", error); } }
      } catch (error) {
        runtimeSkipped += job.tabs.length - terminalTabs;
        if (newWindow?.id) { try { await chrome.windows.remove(newWindow.id); } catch (cleanupError) { cleanupWarnings += 1; console.warn("Couldn’t clean up a failed restore window", cleanupError); } }
        console.warn("Skipped a source window while restoring", job.sourceWindowOrder, error);
      }
    }
    const skipped = plan.counts.skippedTabs + runtimeSkipped;
    const cleanupNote = cleanupWarnings ? ` ${cleanupWarnings} cleanup warning${cleanupWarnings === 1 ? "" : "s"}.` : "";
    showToast(`Opened ${opened}; skipped ${skipped}; created ${restoredWindows} ${restoredWindows === 1 ? "window" : "windows"}.${cleanupNote}`, opened === 0);
  } finally { setRestoreControls(false); }
}

function setRestoreControls(restoring) {
  state.restoring = restoring;
  renderCollections();
  if (state.detailId) renderDetail();
}

async function exportAllCollections() {
  const downloadPermission = requestOptionalDownloadsOnGesture();
  setBusy(elements.exportBackup, true, "Preparing…");
  try {
    const snapshot = await chrome.storage.local.get(null);
    const records = Object.entries(snapshot).filter(([key, value]) => key.startsWith("collection:") && value && value.schemaVersion === SCHEMA_VERSION).map(([key, collection]) => ({ key, collection }));
    const text = serializeBackup(records);
    const stamp = new Date().toISOString().slice(0, 10);
    await downloadBlob(new Blob([text], { type: "application/json;charset=utf-8" }), `browsecase-backup-${stamp}.tabpack.json`, downloadPermission);
  } catch (error) { showToast(error instanceof BackupValidationError ? error.message : "Couldn’t export this backup.", true); console.error(error); }
  finally { setBusy(elements.exportBackup, false, ""); }
}

function withImportLock(task) {
  if (navigator.locks?.request) return navigator.locks.request("tab-pack-import", { mode: "exclusive" }, task);
  // Older Chrome builds lack Web Locks. Serialize imports from this context so
  // read-plan-write remains atomic relative to other side-panel actions here.
  const run = importQueue.then(task, task);
  importQueue = run.catch(() => {});
  return run;
}

async function importBackup(file) {
  if (!file) return;
  try {
    if (file.size === 0) throw new BackupValidationError("empty_file", "This backup file is empty.");
    if (file.size > BACKUP_LIMITS.maxBytes) throw new BackupValidationError("backup_too_large", "This backup file is too large to import.");
    const text = await file.text();
    const backup = parseBackup(text);
    // Parse first, then serialize the storage read-plan-write so no raw
    // collection key (including malformed or newer records) is overwritten.
    const plan = await withImportLock(async () => {
      const snapshot = await chrome.storage.local.get(null);
      const occupiedIds = occupiedCollectionIdsFromStorage(snapshot);
      const importPlan = planImport(backup, occupiedIds, createId);
      if (importPlan.records.length) {
        const changes = Object.fromEntries(importPlan.records.map(({ key, collection }) => [key, collection]));
        await chrome.storage.local.set(changes);
      }
      return importPlan;
    });
    await loadCollections();
    showToast(`Imported ${plan.importedCount} ${plan.importedCount === 1 ? "collection" : "collections"}${plan.remappedIds.length ? `; remapped ${plan.remappedIds.length} ID${plan.remappedIds.length === 1 ? "" : "s"}.` : "."}`);
  } catch (error) {
    showToast(error instanceof BackupValidationError ? error.message : "Couldn’t import this backup. Nothing was changed.", true); console.error(error);
  } finally { elements.importBackup.value = ""; }
}

async function renameCollection(collection) {
  const name = window.prompt("Collection name", collection.name)?.trim(); if (!name || name === collection.name) return;
  try { await chrome.storage.local.set({ [collectionKey(collection.id)]: { ...collection, name: name.slice(0, 100), updatedAt: new Date().toISOString() } }); await loadCollections(); showToast("Collection renamed."); }
  catch (error) { showToast("Couldn’t rename this collection.", true); console.error(error); }
}

async function deleteCollection(collection) {
  if (!window.confirm(`Delete “${collection.name}” and its ${flattenTabs(collection).length} saved links?`)) return;
  try { await chrome.storage.local.remove(collectionKey(collection.id)); hideDetail(); await loadCollections(); showToast("Collection deleted."); }
  catch (error) { showToast("Couldn’t delete this collection.", true); console.error(error); }
}

function bindEvents() {
  document.querySelectorAll(".view-tab").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view, { focus: false })));
  document.querySelector(".view-tabs").addEventListener("keydown", (event) => {
    const tabs = [...document.querySelectorAll(".view-tab")]; const current = tabs.indexOf(document.activeElement); if (current < 0) return;
    let next = current; if (event.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length; else if (event.key === "ArrowRight") next = (current + 1) % tabs.length; else if (event.key === "Home") next = 0; else if (event.key === "End") next = tabs.length - 1; else return;
    event.preventDefault(); tabs[next].focus(); switchView(tabs[next].dataset.view, { focus: false });
  });
  document.querySelectorAll(".scope-button").forEach((button) => button.addEventListener("click", async () => { state.scope = button.dataset.scope; document.querySelectorAll(".scope-button").forEach((candidate) => { const active = candidate === button; candidate.classList.toggle("is-active", active); candidate.setAttribute("aria-pressed", String(active)); }); await loadOpenTabs(); }));
  elements.refreshTabs.addEventListener("click", () => loadOpenTabs({ preserveSelection: true })); elements.tabFilter.addEventListener("input", renderOpenTabs);
  elements.tabList.addEventListener("change", (event) => { const checkbox = event.target.closest("[data-tab-key]"); if (!checkbox) return; if (checkbox.checked) state.selectedTabKeys.add(checkbox.dataset.tabKey); else state.selectedTabKeys.delete(checkbox.dataset.tabKey); checkbox.closest(".tab-item").classList.toggle("is-unselected", !checkbox.checked); updateSelectionSummary(); });
  elements.toggleAllTabs.addEventListener("click", () => { const all = state.openTabs.length > 0 && state.selectedTabKeys.size === state.openTabs.length; state.selectedTabKeys = all ? new Set() : new Set(state.openTabs.map((tab) => tab.key)); renderOpenTabs(); }); elements.saveCollection.addEventListener("click", saveCollection);
  elements.collectionFilter.addEventListener("input", renderCollections); elements.exportBackup.addEventListener("click", exportAllCollections); elements.importBackupButton.addEventListener("click", () => elements.importBackup.click()); elements.importBackup.addEventListener("change", () => importBackup(elements.importBackup.files?.[0]));
  elements.emptyCaptureButton.addEventListener("click", () => { if (state.collections.length && elements.collectionFilter.value) { elements.collectionFilter.value = ""; renderCollections(); } else switchView("capture"); });
  elements.collectionList.addEventListener("click", (event) => { const button = event.target.closest("button[data-action]"); if (!button) return; const collection = state.collections.find((item) => item.id === button.dataset.id); if (!collection) return; if (button.dataset.action === "view") showDetail(collection.id); if (button.dataset.action === "open") openCollection(collection); });
  elements.detailBack.addEventListener("click", hideDetail); elements.detailFilter.addEventListener("input", renderDetail);
  elements.detailLinkList.addEventListener("click", async (event) => { const button = event.target.closest("button[data-url]"); if (!button || !isRestorableUrl(button.dataset.url)) return; try { await chrome.tabs.create({ url: button.dataset.url, active: true }); } catch { showToast("Chrome couldn’t open this saved address.", true); } });
  elements.detailOpenAll.addEventListener("click", () => { const collection = currentCollection(); if (collection) openCollection(collection); });
  elements.detailExport.addEventListener("click", () => { const collection = currentCollection(); if (collection) downloadBlob(new Blob([buildExportHtml(collection)], { type: "text/html;charset=utf-8" }), exportFilename(collection), requestOptionalDownloadsOnGesture()); });
  elements.detailRename.addEventListener("click", () => { const collection = currentCollection(); if (collection) renameCollection(collection); }); elements.detailDelete.addEventListener("click", () => { const collection = currentCollection(); if (collection) deleteCollection(collection); });
  elements.dismissOnboarding.addEventListener("click", async () => { setOnboardingVisible(false); try { await chrome.storage.local.set({ [ONBOARDING_KEY]: true }); } catch (error) { console.error(error); } });
  elements.onboarding.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    elements.dismissOnboarding.focus();
  });
  chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && Object.keys(changes).some((key) => key.startsWith("collection:"))) loadCollections(); });
}

async function init() {
  // Chrome may restore a recreated side-panel document after script evaluation.
  // Repeat on the next frame so the Capture view never opens mid-page.
  resetPanelScroll();
  requestAnimationFrame(resetPanelScroll);
  elements.collectionName.value = defaultCollectionName(); bindEvents();
  try { const result = await chrome.storage.local.get(ONBOARDING_KEY); setOnboardingVisible(result[ONBOARDING_KEY] !== true); } catch { setOnboardingVisible(true); }
  await Promise.all([loadOpenTabs(), loadCollections()]);
  resetPanelScroll();
  requestAnimationFrame(resetPanelScroll);
}

let optionalProSurfaceController;

function refreshOptionalProSurface() {
  // The accountless HTML card is deliberately present before this optional
  // import. A client snapshot only affects display; paid operations require
  // independent server authorization when they exist.
  void import("./pro/sidepanel-surface.js")
    .then(({ createProSurfaceController }) => {
      optionalProSurfaceController ??= createProSurfaceController({
        proElements: { card: elements.proCard, badge: elements.proBadge, title: elements.proTitle, body: elements.proBody, footnote: elements.proFootnote, cta: elements.proCta }
      });
      return optionalProSurfaceController.refresh();
    })
    .catch(() => {});
}

void init();
refreshOptionalProSurface();
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshOptionalProSurface();
});
