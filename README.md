# Browsecase

Capture your open tabs into local collections, back them up, and restore them later.

Browsecase lives in the browser's side panel. Capture the tabs in the current window or in all regular windows, name the collection, and it is saved locally. Later you can reopen a collection (one window per saved window, with tab order and pinned state kept where the browser allows), export a readable HTML archive, or export and import a .tabpack.json backup. Importing validates the whole file first and never overwrites your existing collections.

Download, install steps and screenshots: https://sams.help/extensions/browsecase

## Features

- Capture tabs from this window or all regular windows into a named collection
- Restore opens one window per saved source window, keeping tab order and pinned state where the browser permits
- Export every collection as a .tabpack.json backup, and import one back without overwriting anything
- Export a readable HTML archive of a single collection
- Browser-internal and unsupported URLs are kept as reference-only entries so the record stays complete
- Incognito windows are not supported

## Permissions

- `sidePanel`: To show Browsecase in the browser's side panel.
- `storage`: To keep your collections and a dismissed-onboarding flag in this browser profile's local extension storage.
- `tabs`: To read the titles and URLs of the tabs you choose to capture, and to open saved tabs when you restore.
- `downloads (optional)`: Only requested when you first export. It lets the browser start and report the download of your backup or archive; if you decline, a normal browser download is used instead.

## Privacy

No network access. Nothing leaves your browser: collections stay in this profile's local extension storage, with no account, server, analytics or sync. Exports can contain sensitive URL parameters, so treat them like browsing-history backups. Uninstalling clears the stored collections, so export a backup first if you want to keep them.

## Install (Chrome or Helium)

1. Download this repo (Code → Download ZIP) and unzip it, or grab the zip from the link above.
2. Open `chrome://extensions` (Helium: `helium://extensions`) and turn on Developer mode.
3. Click **Load unpacked** and choose the folder that contains `manifest.json`.

## Licence

MIT. See `LICENSE`.
