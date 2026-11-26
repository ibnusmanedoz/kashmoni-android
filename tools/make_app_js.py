"""Generates web/app.js (Android UI) from the extension's sidepanel.js so both stay in sync."""
import sys
SRC = sys.argv[1] if len(sys.argv) > 1 else "../kashmoni-ai/extension/sidepanel.js"
s = open(SRC).read()
def rep(old, new):
    global s
    assert old in s, "NOT FOUND: " + old[:90]
    s = s.replace(old, new, 1)

start = s.index('import { renderMarkdown'); end = s.index('const $ = (id)')
s = s[:start] + '''// Kash Moni AI (Android) - app UI. GENERATED from the extension's sidepanel.js by tools/make_app_js.py
import { renderMarkdown, escapeHtml } from "./shared/markdown.js";
import { runAgent, fixDangling } from "./shared/agent.js";
import { androidToolList, androidRunTool } from "./tools-android.js";
import { uploadToWorkspace } from "./shared/tools.js";
import { native } from "./native.js";

const PLATFORM = {
  name: "android",
  intro: "You run as the Kash Moni Android app on the user's phone. The app has a built-in browser you control; the user switches between chat and browser with the 🌐 / 💬 buttons.",
  browserWhat: "the app's built-in browser (one page at a time; you cannot see other apps or the phone's Chrome)",
  workspaceWhere: "served by kashmoni_helper.py running in Termux on this phone, or on the user's PC over the hotspot",
  toolList: androidToolList,
  runTool: androidRunTool,
  http: native.http,
  stream: native.stream,
};

''' + s[end:]
rep('''async function load() {
  const s = await chrome.storage.local.get(["km_settings", "km_chats", "km_current"]);''', '''async function load() {
  const s = native.loadState();''')
rep('''  saveTimer = setTimeout(() => chrome.storage.local.set({ km_chats: chats, km_current: current }), 250);''', '''  saveTimer = setTimeout(saveAll, 250);''')
rep('''function chat() {''', '''function saveAll() {
  native.saveState({ km_settings: settings, km_chats: chats, km_current: current });
}
function chat() {''')
rep('''async function saveStore() { await chrome.storage.local.set({ km_settings: settings }); }''', '''async function saveStore() { saveAll(); }''')
rep('''    const r = await fetch(settings.helperUrl.replace(/\\/$/, "") + "/info", {
      method: "POST", headers: { "X-KashMoni-Token": settings.helperToken, "Content-Type": "application/json" }, body: "{}",
      signal: AbortSignal.timeout(2500),
    });''', '''    const r = await native.http(settings.helperUrl.replace(/\\/$/, "") + "/info", {
      method: "POST", headers: { "X-KashMoni-Token": settings.helperToken, "Content-Type": "application/json" }, body: "{}",
      timeout: 4,
    });''')
rep('''chip.title = "Helper not running. Start kashmoni_helper.py";''', '''chip.title = "Helper not reachable. Start it in Termux with: kashmoni";''')
rep('''const j = await (await fetch("https://openrouter.ai/api/v1/models")).json();''', '''const j = await (await native.http("https://openrouter.ai/api/v1/models")).json();''')
rep('''const r = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: "Bearer " + key } });''', '''const r = await native.http("https://openrouter.ai/api/v1/key", { headers: { Authorization: "Bearer " + key } });''')
rep('''const c = await (await fetch("https://openrouter.ai/api/v1/credits", { headers: { Authorization: "Bearer " + key } })).json();''', '''const c = await (await native.http("https://openrouter.ai/api/v1/credits", { headers: { Authorization: "Bearer " + key } })).json();''')
rep('''const r = await fetch(url + "/info", { method: "POST", headers: { "X-KashMoni-Token": tok, "Content-Type": "application/json" }, body: "{}" });''', '''const r = await native.http(url + "/info", { method: "POST", headers: { "X-KashMoni-Token": tok, "Content-Type": "application/json" }, body: "{}", timeout: 5 });''')
rep('''out.textContent = /fetch/i.test(e.message) ? "Can't reach the helper. Start it with:  python3 kashmoni_helper.py" : "Helper error: " + e.message;''', '''out.textContent = /fetch/i.test(e.message) ? "Can't reach the helper. In Termux run:  kashmoni" : "Helper error: " + e.message;''')
rep('''<img src="icons/icon128.png" alt="">''', '''<img src="icon.png" alt="">''')
rep('''<div>Your own AI agent. It can read and control your browser, debug sites and build apps.</div>''', '''<div>Your own AI agent. It controls the built-in browser 🌐, debugs sites and builds apps.</div>''')
rep('''<button data-s="Look at the page I'm on and summarise it.">📄 Summarise this page</button>''', '''<button data-s="Look at the page open in the built-in browser and summarise it.">📄 Summarise the browser page</button>''')
rep('''<button data-s="Debug the page I'm on: check the console errors''', '''<button data-s="Debug the page open in the built-in browser: check the console errors''')
rep('''      navigator.clipboard.writeText(code).then(() => { copy.textContent = "Copied"; setTimeout(() => (copy.textContent = "Copy"), 1200); });''',
    '''      copyText(code); copy.textContent = "Copied"; setTimeout(() => (copy.textContent = "Copy"), 1200);''')
# home page setting (Android only)
rep('''  customInstructions: "",
  connections: [],''', '''  customInstructions: "",
  connections: [],
  homeUrl: "https://www.google.com",''')
rep('''const FIELDS = ["apiKey",''', '''const FIELDS = ["homeUrl", "apiKey",''')
rep('''function wire() {''', '''function copyText(t) {
  const ta = document.createElement("textarea");
  ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); native.toast("Copied"); } catch { /* ignore */ }
  ta.remove();
}

// Called from Java (MainActivity)
window.KMApp = {
  onView(v) { document.body.dataset.view = v; },
  onBack() {
    const open = [...document.querySelectorAll(".overlay")].find((o) => !o.classList.contains("hidden"));
    if (open) { open.classList.add("hidden"); return; }
    if (!$("confirm-bar").classList.contains("hidden")) return;
    native.exitApp();
  },
  onShared(text) {
    $("input").value = `Look at this page I shared (it's open in the browser): ${text}\\n`;
    autosize(); $("input").focus();
  },
};

function wire() {
  $("btn-browser").onclick = () => native.showBrowser();''')
rep('''  checkHelper();
  setInterval(''', '''  checkHelper();
  if (settings.homeUrl) native.browser("open", { url: settings.homeUrl }).catch(() => {});
  setInterval(''')
rep('''  $("input").focus();
})();''', '''})();''')
open("web/app.js", "w").write(s)
print("web/app.js generated")
