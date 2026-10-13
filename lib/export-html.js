import { flattenTabs, sanitizeFilename } from "./model.js";
import { isExportClickableUrl } from "./url-policy.js";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function exportFilename(collection) {
  const date = String(collection.createdAt || new Date().toISOString()).slice(0, 10);
  return `${sanitizeFilename(collection.name)} — ${date}.html`;
}

export function buildExportHtml(collection) {
  const tabs = flattenTabs(collection);
  const clickableUrls = tabs.filter((tab) => isExportClickableUrl(tab.url)).map((tab) => tab.url);
  const encodedUrls = toBase64(JSON.stringify(clickableUrls));
  const created = new Intl.DateTimeFormat(undefined, {
    dateStyle: "long",
    timeStyle: "short"
  }).format(new Date(collection.createdAt));

  const rows = tabs.map((tab, index) => {
    const title = escapeHtml(tab.title || tab.url || "Untitled tab");
    const url = escapeHtml(tab.url || "");
    const number = String(index + 1).padStart(2, "0");
    const link = isExportClickableUrl(tab.url)
      ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${title}</a>`
      : `<span class="restricted">${title}</span>`;
    return `<li><span class="number">${number}</span><div>${link}<code>${url}</code></div></li>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(collection.name)} — Browsecase</title>
<style>
:root{color-scheme:light;--ink:#171833;--muted:#6c6d80;--line:#e6e6ef;--brand:#5557dc;--paper:#f7f7fc}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{width:min(900px,calc(100% - 32px));margin:48px auto}.hero{background:linear-gradient(135deg,#5b5de4,#3f41ba);color:#fff;padding:32px;border-radius:24px;box-shadow:0 18px 45px #383a9f30}.eyebrow{margin:0 0 8px;text-transform:uppercase;letter-spacing:.14em;font-size:12px;opacity:.78}h1{margin:0;font-size:clamp(28px,6vw,48px);line-height:1.08}.meta{margin:12px 0 24px;opacity:.8}.actions{display:flex;align-items:center;gap:14px;flex-wrap:wrap}button{border:0;border-radius:12px;background:#ffd37a;color:#20213d;padding:12px 18px;font:700 14px inherit;cursor:pointer}button:hover{filter:brightness(1.04)}.note{font-size:13px;opacity:.78}.list{background:#fff;margin:20px 0 0;padding:8px 24px;border:1px solid var(--line);border-radius:20px;box-shadow:0 12px 32px #292a5520}ol{list-style:none;padding:0;margin:0}li{display:grid;grid-template-columns:36px 1fr;gap:10px;padding:17px 0;border-bottom:1px solid var(--line)}li:last-child{border:0}.number{color:#9a9bad;font:12px/1.6 ui-monospace,monospace}a,.restricted{display:block;color:var(--ink);font-weight:700;text-decoration:none;overflow-wrap:anywhere}a:hover{color:var(--brand);text-decoration:underline}.restricted{color:var(--muted)}code{display:block;margin-top:4px;color:var(--muted);font:12px/1.4 ui-monospace,SFMono-Regular,monospace;overflow-wrap:anywhere}footer{text-align:center;color:var(--muted);padding:20px;font-size:12px}@media(max-width:520px){.wrap{margin:16px auto}.hero{padding:24px}.list{padding:5px 16px}}
</style>
</head>
<body>
<main class="wrap">
  <section class="hero">
    <p class="eyebrow">Browsecase archive</p>
    <h1>${escapeHtml(collection.name)}</h1>
    <p class="meta">${tabs.length} links · Saved ${escapeHtml(created)}</p>
    <div class="actions"><button id="open-all" type="button">Open all ${clickableUrls.length} links</button><span class="note" id="open-note">Your browser may ask you to allow pop-ups.</span></div>
  </section>
  <section class="list" aria-label="Saved links"><ol>${rows}</ol></section>
  <footer>Saved locally by Browsecase. Reference-only entries, including browser-internal URLs, are listed for context but cannot be opened from this HTML file.</footer>
</main>
<script>
const urls=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob("${encodedUrls}"),c=>c.charCodeAt(0))));
document.getElementById("open-all").addEventListener("click",()=>{for(const url of urls)window.open(url,"_blank","noopener,noreferrer");document.getElementById("open-note").textContent="Requested "+urls.length+" links; allow pop-ups if fewer opened."});
</script>
</body>
</html>`;
}
