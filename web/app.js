// Kash Moni AI - side panel UI: chats, settings, rendering.
// Kash Moni AI (Android) - app UI. Bundled into app.bundle.js by build-web.sh
import { renderMarkdown, escapeHtml } from "./shared/markdown.js";
import { runAgent, fixDangling } from "./shared/agent.js";
import { androidToolList, androidRunTool } from "./tools-android.js";
import { native } from "./native.js";

const PLATFORM = {
  name: "android",
  intro: "You run as the Kash Moni Android app on the user's phone. The app has a built-in browser you control; the user switches between chat and browser with the 🌐 / 💬 buttons.",
  browserWhat: "the app's built-in browser (one page at a time; you cannot see other apps or the phone's Chrome)",
  workspaceWhere: "served by kashmoni_helper.py running in Termux on this phone, or on the user's PC over the hotspot",
  toolList: androidToolList,
  runTool: androidRunTool,
  http: native.http,
};

const $ = (id) => document.getElementById(id);
const DEFAULTS = {
  apiKey: "",
  model: "deepseek/deepseek-v4.1-flash",
  strongModel: "",
  reasoning: "default",
  helperUrl: "http://127.0.0.1:8765",
  helperToken: "",
  confirmMode: "risky",
  maxSteps: 40,
  customInstructions: "",
};

let settings = { ...DEFAULTS };
let chats = {};          // id -> chat
let current = null;      // chat id
let running = null;      // AbortController
let helperOk = false;
const openSteps = new Set();

// ------------------------------------------------------------------ storage
async function load() {
  const s = native.loadState();
  settings = { ...DEFAULTS, ...(s.km_settings || {}) };
  chats = s.km_chats || {};
  current = s.km_current && chats[s.km_current] ? s.km_current : null;
}
let saveTimer = null;
function saveChats() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveAll, 250);
}
function saveAll() {
  native.saveState({ km_settings: settings, km_chats: chats, km_current: current });
}
function chat() {
  if (!current || !chats[current]) {
    const id = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    chats[id] = { id, title: "New chat", created: Date.now(), updated: Date.now(), messages: [], cost: 0, tokens: 0 };
    current = id;
  }
  return chats[current];
}

// ------------------------------------------------------------------ helper status
async function checkHelper() {
  const chip = $("chip-helper");
  if (!settings.helperUrl || !settings.helperToken) {
    helperOk = false; chip.className = "chip ghost off"; chip.textContent = "○ Workspace off"; chip.title = "Set up the helper in Settings to build apps";
    return;
  }
  try {
    const r = await native.http(settings.helperUrl.replace(/\/$/, "") + "/info", {
      method: "POST", headers: { "X-KashMoni-Token": settings.helperToken, "Content-Type": "application/json" }, body: "{}",
      timeout: 4,
    });
    const j = await r.json();
    helperOk = !!j.ok;
    chip.title = helperOk ? `Workspace: ${j.workspace}` : (j.error || "Helper error");
  } catch {
    helperOk = false; chip.title = "Helper not reachable. Start kashmoni_helper.py in Termux";
  }
  chip.className = "chip ghost " + (helperOk ? "on" : "off");
  chip.textContent = helperOk ? "● Workspace" : "○ Workspace off";
}

// ------------------------------------------------------------------ rendering
function shortArgs(name, a) {
  if (!a) return "";
  const v = a.url || a.command || a.path || a.query || a.element || a.key || a.code || a.name || "";
  return String(v).replace(/\s+/g, " ").slice(0, 90);
}
const ICONS = {
  read_page: "📄", click: "👆", type_text: "⌨️", open_url: "🌐", screenshot: "📸", run_js: "⚙️", console_logs: "🐞", network_log: "📡",
  web_search: "🔎", fetch_url: "⬇️", run_command: "💻", write_file: "📝", edit_file: "✏️", read_file: "📖", list_files: "📁",
  start_process: "▶️", stop_process: "⏹", process_logs: "📜", zip_project: "📦", delete_path: "🗑", list_tabs: "🗂", show_browser: "🌐",
};

function render() {
  const c = chats[current];
  const box = $("messages");
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  if (!c || !c.messages.length) {
    box.innerHTML = `<div class="welcome"><img src="icon.png" alt=""><h1>Kash Moni AI</h1>
      <div>Your own AI agent. It controls the built-in browser 🌐, debugs sites and builds apps.</div>
      ${settings.apiKey ? "" : '<p style="color:var(--gold)">Start by adding your OpenRouter key in ⚙ Settings.</p>'}
      <div class="suggest">
        <button data-s="Look at the page open in the built-in browser and summarise it.">📄 Summarise the browser page</button>
        <button data-s="Debug the page open in the built-in browser: check the console errors and failed network requests, reload to catch load errors, and tell me what's wrong and how to fix it.">🐞 Debug this page</button>
        <button data-s="Build me a simple budget tracker web app (HTML/CSS/JS, saves to localStorage). Test it, then give me the zip and run instructions.">📦 Build a small app</button>
        <button data-s="Search the web for today's top tech news and give me 5 bullet points with links.">🔎 Search the web</button>
      </div></div>`;
    updateChips();
    return;
  }
  const results = {};
  c.messages.forEach((m) => { if (m.role === "tool") results[m.tool_call_id] = m; });
  let html = "";
  for (const m of c.messages) {
    if (m.role === "user" && !m.auto) {
      html += `<div class="msg user">${escapeHtml(typeof m.content === "string" ? m.content : m.content.map((p) => p.text || "").join(" "))}</div>`;
    } else if (m.role === "user" && m.auto) {
      const imgs = (m.content || []).filter((p) => p.type === "image_url").map((p) => `<img src="${p.image_url.url}" alt="screenshot">`).join("");
      html += `<details class="step"><summary><span class="dot">●</span><span class="nm">📸 screenshot sent to AI</span></summary>${imgs}</details>`;
    } else if (m.role === "assistant") {
      if (m.content && m.content.trim()) html += `<div class="msg ai">${renderMarkdown(m.content)}</div>`;
      for (const call of m.tool_calls || []) {
        const name = call.function.name;
        let args = {};
        try { args = JSON.parse(call.function.arguments || "{}"); } catch { /* ignore */ }
        const r = results[call.id];
        const pending = !r;
        const isErr = r && /^Error:/.test(r.content);
        const body = name === "write_file"
          ? `path: ${args.path}\n\n${String(args.content || "").slice(0, 3000)}`
          : JSON.stringify(args, null, 1);
        html += `<details class="step ${pending ? "pending" : ""} ${isErr ? "err" : ""}" data-id="${call.id}" ${openSteps.has(call.id) ? "open" : ""}>
          <summary><span class="dot">●</span><span class="nm">${ICONS[name] || "🔧"} ${escapeHtml(name)}</span><span class="ar">${escapeHtml(shortArgs(name, args))}</span></summary>
          <pre>${escapeHtml(body)}${r ? "\n\n── result ──\n" + escapeHtml(r.content) : ""}</pre></details>`;
      }
    } else if (m.role === "error") {
      html += `<div class="err-box">⚠ ${escapeHtml(m.content)}</div>`;
    }
  }
  box.innerHTML = html;
  if (nearBottom || running) box.scrollTop = box.scrollHeight;
  updateChips();
}

function updateChips() {
  const c = chats[current];
  const m = $("strong").checked && settings.strongModel ? settings.strongModel : settings.model;
  $("chip-model").textContent = (m || "no model").split("/").pop();
  $("chip-model").title = "Model: " + m + " (click to change)";
  const cost = c ? c.cost || 0 : 0;
  $("chip-cost").textContent = cost ? `$${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(3)}` : "";
  $("chip-cost").title = c ? `This chat: ${c.tokens || 0} tokens, $${cost.toFixed(5)}` : "";
}

function setStatus(t) { $("status-line").textContent = t; }

// ------------------------------------------------------------------ confirm
function confirmAction(text) {
  return new Promise((resolve) => {
    $("confirm-text").innerHTML = renderMarkdown(text);
    $("confirm-bar").classList.remove("hidden");
    setStatus("Waiting for your OK…");
    const done = (v) => { $("confirm-bar").classList.add("hidden"); $("confirm-yes").onclick = $("confirm-no").onclick = null; resolve(v); };
    $("confirm-yes").onclick = () => done(true);
    $("confirm-no").onclick = () => done(false);
    if (running) running.signal.addEventListener("abort", () => done(false), { once: true });
  });
}

// ------------------------------------------------------------------ send
async function send(text) {
  text = (text || "").trim();
  if (!text || running) return;
  if (!settings.apiKey) { openSettings(); $("s-key-result").textContent = "Add your OpenRouter API key first."; $("s-key-result").className = "hint bad"; return; }
  const c = chat();
  fixDangling(c);
  c.messages.push({ role: "user", content: text });
  if (c.title === "New chat") c.title = text.slice(0, 60);
  c.updated = Date.now();
  $("input").value = ""; autosize();
  render(); saveChats();

  const model = $("strong").checked && settings.strongModel ? settings.strongModel : settings.model;
  running = new AbortController();
  $("btn-send").classList.add("stop"); $("btn-send").textContent = "■"; $("btn-send").title = "Stop";
  await checkHelper();
  try {
    await runAgent(c, settings, model, helperOk, running.signal, {
      onUpdate: () => { c.updated = Date.now(); render(); saveChats(); },
      onStatus: setStatus,
      confirm: confirmAction,
    }, PLATFORM);
    setStatus("Done");
  } catch (e) {
    if (e.name === "AbortError") { c.messages.push({ role: "error", content: "Stopped." }); setStatus("Stopped"); }
    else { c.messages.push({ role: "error", content: e.message || String(e) }); setStatus("Error"); }
  } finally {
    fixDangling(c);
    running = null;
    $("btn-send").classList.remove("stop"); $("btn-send").textContent = "➤"; $("btn-send").title = "Send (Enter)";
    $("confirm-bar").classList.add("hidden");
    render(); saveChats();
  }
}

// ------------------------------------------------------------------ history
function openHistory() {
  $("view-history").classList.remove("hidden");
  $("history-search").value = "";
  renderHistory();
}
function renderHistory() {
  const q = $("history-search").value.toLowerCase();
  const list = Object.values(chats).sort((a, b) => b.updated - a.updated)
    .filter((c) => !q || c.title.toLowerCase().includes(q) || c.messages.some((m) => typeof m.content === "string" && m.content.toLowerCase().includes(q)));
  $("history-list").innerHTML = list.length ? list.map((c) => `
    <div class="h-item ${c.id === current ? "active" : ""}" data-id="${c.id}">
      <div class="t"><div>${escapeHtml(c.title)}</div><div class="d">${new Date(c.updated).toLocaleString()} · ${c.messages.filter((m) => m.role === "user" && !m.auto).length} msgs${c.cost ? ` · $${c.cost.toFixed(4)}` : ""}</div></div>
      <button data-del="${c.id}" title="Delete">🗑</button>
    </div>`).join("") : '<div class="hint">No chats yet.</div>';
}

// ------------------------------------------------------------------ settings
const FIELDS = ["apiKey", "model", "strongModel", "reasoning", "helperUrl", "helperToken", "confirmMode", "maxSteps", "customInstructions"];
function openSettings() {
  FIELDS.forEach((f) => { $("s-" + f).value = settings[f] ?? ""; });
  $("view-settings").classList.remove("hidden");
}
async function saveSettings() {
  FIELDS.forEach((f) => { settings[f] = $("s-" + f).value.trim(); });
  settings.maxSteps = Math.max(5, Math.min(200, parseInt(settings.maxSteps, 10) || 40));
  if (!settings.model) settings.model = DEFAULTS.model;
  saveAll();
  await checkHelper();
  updateChips();
}
async function loadModels() {
  const out = $("s-key-result");
  out.className = "hint"; out.textContent = "Loading models…";
  try {
    const j = await (await native.http("https://openrouter.ai/api/v1/models")).json();
    const models = (j.data || []).filter((m) => (m.supported_parameters || []).includes("tools"));
    $("model-list").innerHTML = models.map((m) => {
      const p = m.pricing || {};
      const price = `$${(p.prompt * 1e6).toFixed(2)} in / $${(p.completion * 1e6).toFixed(2)} out per 1M`;
      return `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)} — ${price}</option>`;
    }).join("");
    out.className = "hint ok"; out.textContent = `Loaded ${models.length} models that support tools. Click a model field to pick one.`;
  } catch (e) { out.className = "hint bad"; out.textContent = "Could not load models: " + e.message; }
}
async function testKey() {
  const out = $("s-key-result");
  const key = $("s-apiKey").value.trim();
  out.className = "hint"; out.textContent = "Checking…";
  try {
    const r = await native.http("https://openrouter.ai/api/v1/key", { headers: { Authorization: "Bearer " + key } });
    const j = await r.json();
    if (!r.ok) throw new Error((j.error && j.error.message) || r.status);
    const d = j.data || {};
    const left = d.limit_remaining != null ? `, key limit left: $${Number(d.limit_remaining).toFixed(2)}` : "";
    let credits = "";
    try {
      const c = await (await native.http("https://openrouter.ai/api/v1/credits", { headers: { Authorization: "Bearer " + key } })).json();
      if (c.data) credits = `\nBalance: $${(c.data.total_credits - c.data.total_usage).toFixed(2)}`;
    } catch { /* optional */ }
    out.className = "hint ok"; out.textContent = `Key works. Used so far: $${Number(d.usage || 0).toFixed(4)}${left}${credits}`;
  } catch (e) { out.className = "hint bad"; out.textContent = "Key check failed: " + e.message; }
}
async function testHelper() {
  const out = $("s-helper-result");
  out.className = "hint"; out.textContent = "Checking…";
  const url = $("s-helperUrl").value.trim().replace(/\/$/, ""), tok = $("s-helperToken").value.trim();
  try {
    const r = await native.http(url + "/info", { method: "POST", headers: { "X-KashMoni-Token": tok, "Content-Type": "application/json" }, body: "{}", timeout: 5 });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "error");
    const tools = Object.entries(j.tools).map(([k, v]) => `${v ? "✓" : "✗"} ${k}`).join("  ");
    out.className = "hint ok"; out.textContent = `Connected. Workspace: ${j.workspace}\n${tools}`;
  } catch (e) {
    out.className = "hint bad";
    out.textContent = /fetch/i.test(e.message) ? "Can't reach the helper. In Termux run:  kashmoni   (or python3 kashmoni_helper.py)" : "Helper error: " + e.message;
  }
}

// ------------------------------------------------------------------ input
function autosize() {
  const t = $("input");
  t.style.height = "auto";
  t.style.height = Math.min(t.scrollHeight, 180) + "px";
}

function copyText(t) {
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
    $("input").value = `Look at this page I shared (it's open in the browser): ${text}\n`;
    autosize(); $("input").focus();
  },
};

function wire() {
  $("btn-browser").onclick = () => native.showBrowser();
  $("input").addEventListener("input", autosize);
  $("input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send($("input").value); }
  });
  $("btn-send").onclick = () => (running ? running.abort() : send($("input").value));
  $("btn-new").onclick = () => { if (running) return; current = null; render(); saveChats(); $("input").focus(); };
  $("btn-history").onclick = openHistory;
  $("btn-settings").onclick = openSettings;
  $("chip-model").onclick = openSettings;
  $("strong").onchange = () => {
    if ($("strong").checked && !settings.strongModel) { $("strong").checked = false; openSettings(); $("s-key-result").textContent = "Set a strong model first."; }
    updateChips();
  };
  document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => b.closest(".overlay").classList.add("hidden")));
  $("s-save").onclick = async () => { await saveSettings(); $("view-settings").classList.add("hidden"); render(); };
  $("s-load-models").onclick = loadModels;
  $("s-test-key").onclick = testKey;
  $("s-test-helper").onclick = testHelper;
  $("s-clear").onclick = () => {
    if (running) return;
    if (!$("s-clear").dataset.sure) { $("s-clear").dataset.sure = "1"; $("s-clear").textContent = "Tap again to delete ALL chats"; return; }
    chats = {}; current = null; saveChats(); render();
    delete $("s-clear").dataset.sure; $("s-clear").textContent = "Delete all chats";
  };
  $("history-search").oninput = renderHistory;
  $("history-list").onclick = (e) => {
    const del = e.target.closest("[data-del]");
    if (del) {
      if (running && del.dataset.del === current) return;
      delete chats[del.dataset.del];
      if (current === del.dataset.del) current = null;
      saveChats(); renderHistory(); render(); return;
    }
    const item = e.target.closest(".h-item");
    if (item && !running) { current = item.dataset.id; saveChats(); render(); $("view-history").classList.add("hidden"); $("messages").scrollTop = 1e9; }
  };
  $("messages").addEventListener("click", (e) => {
    const s = e.target.closest("[data-s]");
    if (s) { send(s.dataset.s); return; }
    const copy = e.target.closest(".copy");
    if (copy) {
      const code = copy.closest(".code").querySelector("code").innerText;
      copyText(code); copy.textContent = "Copied"; setTimeout(() => (copy.textContent = "Copy"), 1200);
    }
  });
  $("messages").addEventListener("toggle", (e) => {
    const d = e.target;
    if (d.dataset && d.dataset.id) d.open ? openSteps.add(d.dataset.id) : openSteps.delete(d.dataset.id);
  }, true);
}

(async function init() {
  await load();
  wire();
  render();
  checkHelper();
  setInterval(() => { if (!running) checkHelper(); }, 20000);
})();
