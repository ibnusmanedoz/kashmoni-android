// Kash Moni AI - side panel UI: chats, settings, rendering.
// Kash Moni AI (Android) - app UI. GENERATED from the extension's sidepanel.js by tools/make_app_js.py
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
  connections: [],
  homeUrl: "https://www.google.com",
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
    helperOk = false; chip.title = "Helper not reachable. Start it in Termux with: kashmoni";
  }
  chip.className = "chip ghost " + (helperOk ? "on" : "off");
  chip.textContent = helperOk ? "● Workspace" : "○ Workspace off";
}

// ------------------------------------------------------------------ rendering
const host = (u) => { try { return new URL(u).host || u; } catch { return String(u || "").slice(0, 40); } };
const cut = (t, n = 40) => { t = String(t ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

// Friendly, human labels for each step (like "Reading the page").
function stepLabel(name, a = {}) {
  switch (name) {
    case "read_page": return "Reading the page";
    case "open_url": return `Opening ${host(a.url)}`;
    case "click": return "Clicking on the page";
    case "type_text": return `Typing "${cut(a.text, 30)}"`;
    case "select_option": return `Choosing "${cut(a.option, 30)}"`;
    case "press_key": return `Pressing ${a.key}`;
    case "scroll": return "Scrolling";
    case "screenshot": return "Taking a screenshot";
    case "run_js": return "Running code in the page";
    case "console_logs": return "Checking console errors";
    case "network_log": return "Checking network requests";
    case "get_response_body": return "Reading a server response";
    case "reload_tab": return "Reloading the page";
    case "go_back": return "Going back";
    case "close_tab": return "Closing a tab";
    case "list_tabs": return "Checking open tabs";
    case "wait": return `Waiting ${a.seconds}s`;
    case "show_browser": return a.show === false ? "Back to chat" : "Showing the browser";
    case "web_search": return `Searching "${cut(a.query, 36)}"`;
    case "fetch_url": return `Reading ${host(a.url)}`;
    case "workspace_info": return "Checking the workspace";
    case "run_command": return `Running ${cut(a.command, 42)}`;
    case "write_file": return `Writing ${cut(a.path, 40)}`;
    case "edit_file": return `Editing ${cut(a.path, 40)}`;
    case "read_file": return `Reading ${cut(a.path, 40)}`;
    case "list_files": return "Looking through the files";
    case "delete_path": return `Deleting ${cut(a.path, 40)}`;
    case "start_process": return `Starting ${a.name || "server"}`;
    case "process_logs": return "Checking the server output";
    case "stop_process": return "Stopping the server";
    case "zip_project": return `Zipping ${cut(a.path, 30)}`;
    case "call_api": return `${a.connection}: ${a.method || "GET"} ${cut(a.path, 30)}`;
    default: return name;
  }
}

function parseArgs(call) { try { return JSON.parse(call.function.arguments || "{}"); } catch { return {}; } }

// Each turn's tool work is shown as ONE block: a single live line while running,
// "Worked · N steps" when finished. Tap it to see every step and its result.
function renderWork(group, live) {
  const steps = group.steps;
  if (!steps.length && !group.notes.length) return "";
  const done = steps.filter((x) => x.result).length;
  const errors = steps.filter((x) => x.result && /^Error:/.test(x.result.content)).length;
  const now = steps.find((x) => !x.result);
  let label;
  if (live) label = now ? stepLabel(now.name, now.args) + "…" : "Thinking…";
  else label = `Worked · ${steps.length} step${steps.length === 1 ? "" : "s"}${errors ? ` · ${errors} hit an error` : ""}`;
  const rows = steps.map((x) => {
    const st = !x.result ? "pending" : /^Error:/.test(x.result.content) ? "err" : "ok";
    const body = x.name === "write_file" ? `path: ${x.args.path}\n\n${String(x.args.content || "").slice(0, 3000)}` : JSON.stringify(x.args, null, 1);
    return `<details class="wstep ${st}" data-id="${x.id}" ${openSteps.has(x.id) ? "open" : ""}><summary><span class="mark">${st === "ok" ? "✓" : st === "err" ? "✗" : "•"}</span>${escapeHtml(stepLabel(x.name, x.args))}</summary><pre>${escapeHtml(body)}${x.result ? "\n\n── result ──\n" + escapeHtml(x.result.content) : ""}</pre></details>`;
  }).join("");
  const notes = group.notes.map((n) => `<div class="wnote">${renderMarkdown(n)}</div>`).join("");
  const imgs = group.images.map((u) => `<img src="${u}" alt="screenshot">`).join("");
  return `<details class="work ${live ? "live" : ""}" data-id="${group.id}" ${openSteps.has(group.id) ? "open" : ""}>
    <summary>${live ? '<span class="spin"></span>' : '<span class="tick">✓</span>'}<span class="wl">${escapeHtml(label)}</span><span class="wc">${live ? `${done}/${steps.length || 1}` : "details"}</span></summary>
    <div class="wbody">${notes}${rows}${imgs ? `<div class="wimgs">${imgs}</div>` : ""}</div></details>`;
}

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
  let group = null;
  const newGroup = () => ({ id: "", steps: [], notes: [], images: [] });
  const flush = (live) => { if (group) html += renderWork(group, live); group = null; };
  const msgs = c.messages;
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role === "user" && !m.auto) {
      flush(false);
      html += `<div class="msg user">${escapeHtml(typeof m.content === "string" ? m.content : m.content.map((p) => p.text || "").join(" "))}</div>`;
    } else if (m.role === "user" && m.auto) {
      group = group || newGroup();
      for (const p of m.content || []) if (p.type === "image_url") group.images.push(p.image_url.url);
    } else if (m.role === "assistant" && m.tool_calls && m.tool_calls.length) {
      group = group || newGroup();
      if (m.content && m.content.trim()) group.notes.push(m.content);
      for (const call of m.tool_calls) {
        if (!group.id) group.id = "w-" + call.id;
        group.steps.push({ id: call.id, name: call.function.name, args: parseArgs(call), result: results[call.id] });
      }
    } else if (m.role === "assistant") {
      flush(false);
      if (m.content && m.content.trim()) html += `<div class="msg ai">${renderMarkdown(m.content)}</div>`;
    } else if (m.role === "error") {
      flush(false);
      html += `<div class="err-box">⚠ ${escapeHtml(m.content)}</div>`;
    }
  }
  if (running && !group) { group = newGroup(); group.id = "w-live"; }
  flush(!!running);
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
  render();
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
const FIELDS = ["homeUrl", "apiKey", "model", "strongModel", "reasoning", "helperUrl", "helperToken", "confirmMode", "maxSteps", "customInstructions"];
function openSettings() {
  FIELDS.forEach((f) => { $("s-" + f).value = settings[f] ?? ""; });
  renderConnections();
  $("conn-form").classList.add("hidden");
  $("view-settings").classList.remove("hidden");
}
async function saveStore() { saveAll(); }
async function saveSettings() {
  FIELDS.forEach((f) => { settings[f] = $("s-" + f).value.trim(); });
  settings.maxSteps = Math.max(5, Math.min(200, parseInt(settings.maxSteps, 10) || 40));
  if (!settings.model) settings.model = DEFAULTS.model;
  await saveStore();
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
    out.textContent = /fetch/i.test(e.message) ? "Can't reach the helper. In Termux run:  kashmoni" : "Helper error: " + e.message;
  }
}


// ------------------------------------------------------------------ connections
const PRESETS = {
  github: { name: "GitHub", baseUrl: "https://api.github.com", headerName: "Authorization", headerPrefix: "Bearer ", envVar: "GITHUB_TOKEN, GH_TOKEN", test: "/user",
    notes: "GitHub REST API. Use for repos, issues, releases, Actions.", help: "Create a token at github.com/settings/tokens → Generate new token (classic) → tick 'repo' and 'workflow'." },
  vercel: { name: "Vercel", baseUrl: "https://api.vercel.com", headerName: "Authorization", headerPrefix: "Bearer ", envVar: "VERCEL_TOKEN", test: "/v2/user",
    notes: "Vercel API and CLI (vercel --token $VERCEL_TOKEN).", help: "Create a token at vercel.com/account/tokens." },
  netlify: { name: "Netlify", baseUrl: "https://api.netlify.com/api/v1", headerName: "Authorization", headerPrefix: "Bearer ", envVar: "NETLIFY_AUTH_TOKEN", test: "/user",
    notes: "Netlify API and CLI.", help: "Create a personal access token at app.netlify.com/user/applications." },
  supabase: { name: "Supabase", baseUrl: "https://api.supabase.com/v1", headerName: "Authorization", headerPrefix: "Bearer ", envVar: "SUPABASE_ACCESS_TOKEN", test: "/projects",
    notes: "Supabase management API and CLI.", help: "Create an access token at supabase.com/dashboard/account/tokens." },
  cloudflare: { name: "Cloudflare", baseUrl: "https://api.cloudflare.com/client/v4", headerName: "Authorization", headerPrefix: "Bearer ", envVar: "CLOUDFLARE_API_TOKEN", test: "/user/tokens/verify",
    notes: "Cloudflare API and wrangler CLI.", help: "Create an API token at dash.cloudflare.com/profile/api-tokens." },
  telegram: { name: "Telegram bot", baseUrl: "https://api.telegram.org/bot{token}", headerName: "URL", headerPrefix: "", envVar: "TELEGRAM_BOT_TOKEN", test: "/getMe",
    notes: "Telegram Bot API (sendMessage needs a chat_id).", help: "Talk to @BotFather on Telegram → /newbot → copy the token." },
  custom: { name: "", baseUrl: "", headerName: "Authorization", headerPrefix: "Bearer ", envVar: "", test: "", notes: "", help: "Any REST API that uses a token. Check its docs for the header name." },
};
const CFIELDS = ["name", "baseUrl", "token", "headerName", "headerPrefix", "envVar", "notes"];
let editing = -1; // index being edited, -2 = new

function renderConnections() {
  const list = settings.connections || [];
  $("conn-list").innerHTML = list.length ? list.map((c, i) => `
    <div class="conn"><div class="t"><div>${escapeHtml(c.name)}</div><div>${escapeHtml(c.baseUrl || "")}</div></div>
      <button data-cedit="${i}" title="Edit">✏️</button><button data-cdel="${i}" title="Remove">🗑</button></div>`).join("")
    : '<div class="hint">No connections yet.</div>';
}
function openConnForm(c, idx) {
  editing = idx;
  CFIELDS.forEach((f) => { $("c-" + f).value = c[f] ?? ""; });
  $("c-help").textContent = c.help || "";
  $("c-result").textContent = "";
  $("conn-form").dataset.test = c.test || "";
  $("conn-form").classList.remove("hidden");
}
function readConnForm() {
  const c = {};
  CFIELDS.forEach((f) => { c[f] = $("c-" + f).value.trim(); });
  c.headerPrefix = $("c-headerPrefix").value; // keep trailing space
  c.test = $("conn-form").dataset.test || "";
  return c;
}
async function persistSettings() { await saveStore(); }
function wireConnections() {
  $("conn-add").onclick = () => { const p = PRESETS[$("conn-preset").value]; openConnForm({ ...p }, -2); };
  $("conn-cancel").onclick = () => { $("conn-form").classList.add("hidden"); editing = -1; };
  $("conn-save").onclick = async () => {
    const c = readConnForm();
    if (!c.name || !c.token) { $("c-result").className = "hint bad"; $("c-result").textContent = "Name and token are required."; return; }
    settings.connections = settings.connections || [];
    if (editing >= 0) settings.connections[editing] = c; else settings.connections.push(c);
    await persistSettings();
    $("conn-form").classList.add("hidden"); editing = -1;
    renderConnections();
  };
  $("conn-test").onclick = async () => {
    const c = readConnForm();
    const out = $("c-result");
    out.className = "hint"; out.textContent = "Testing…";
    try {
      const r = await PLATFORM.runTool("call_api", { connection: c.name || "x", method: "GET", path: c.test || "/" },
        { settings: { connections: [{ ...c, name: c.name || "x" }], confirmMode: "never" }, http: PLATFORM.http, confirm: async () => true });
      const ok = /^HTTP 2\d\d/.test(r);
      out.className = "hint " + (ok ? "ok" : "bad");
      out.textContent = (ok ? "Works! " : "Problem: ") + r.slice(0, 300);
    } catch (e) { out.className = "hint bad"; out.textContent = "Failed: " + e.message; }
  };
  $("conn-list").onclick = async (e) => {
    const ed = e.target.closest("[data-cedit]"), del = e.target.closest("[data-cdel]");
    if (ed) { const c = settings.connections[+ed.dataset.cedit]; const p = Object.values(PRESETS).find((x) => x.name === c.name) || {}; openConnForm({ help: p.help, ...c }, +ed.dataset.cedit); }
    if (del) { settings.connections.splice(+del.dataset.cdel, 1); await persistSettings(); renderConnections(); }
  };
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
  wireConnections();
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
  if (settings.homeUrl) native.browser("open", { url: settings.homeUrl }).catch(() => {});
  setInterval(() => { if (!running) checkHelper(); }, 20000);
})();
