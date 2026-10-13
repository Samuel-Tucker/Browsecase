import { createAccountlessAdapter } from "./pro/accountless-adapter.js";
import { createProMessageRouter } from "./pro/message-router.js";

// Chrome extension service workers require static ES module imports. These
// pure local modules perform no network or storage I/O,
// and the listener is registered synchronously during worker evaluation.
chrome.runtime.onMessage.addListener(createProMessageRouter({
  adapter: createAccountlessAdapter(),
  extensionId: chrome.runtime.id,
  sidepanelUrl: chrome.runtime.getURL("sidepanel.html")
}));

async function configureExtension() {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  if (chrome.storage.local.setAccessLevel) {
    await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  }
}

let configuredExtension;

function startExtension() {
  if (configuredExtension) return configuredExtension;
  configuredExtension = Promise.resolve().then(configureExtension).catch(() => {});
  return configuredExtension;
}

chrome.runtime.onInstalled.addListener(() => {
  void startExtension();
});

chrome.runtime.onStartup.addListener(() => {
  void startExtension();
});

// Configuration is intentionally independent of the synchronously registered
// entitlement gate above.
void startExtension();
