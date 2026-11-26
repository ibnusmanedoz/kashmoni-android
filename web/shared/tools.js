// Kash Moni AI - tools the model can call.
// Browser tools use chrome.scripting / chrome.tabs, and the Chrome DevTools
// Protocol (chrome.debugger) for console, network, keys and JavaScript.
// Workspace tools talk to the local helper (helper/kashmoni_helper.py).

const MAX_RESULT = 14000;

export function clip(s, n = MAX_RESULT) {
  s = typeof s === "string" ? s : JSON.stringify(s, null, 1);
  if (s.length <= n) return s;
  return s.slice(0, Math.floor(n * 0.75)) + `\n... [${s.length - n} chars cut] ...\n` + s.slice(-Math.floor(n * 0.25));
}

// ------------------------------------------------------------------ tool schemas
const fn = (name, description, properties = {}, required = []) => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required } },
});
const tabProp = { tab_id: { type: "integer", description: "Tab id from list_tabs. Leave out to use the user's current tab." } };
const elProp = { element: { type: "string", description: "Element number from read_page (e.g. \"12\") or a CSS selector." } };

export const BROWSER_TOOLS = [
  fn("list_tabs", "List open browser tabs with their ids, titles and URLs."),
  fn("open_url", "Open a URL. Opens a new tab by default and makes it the working tab.", {
    url: { type: "string" }, new_tab: { type: "boolean", description: "Default true. false = load in the current tab." },
  }, ["url"]),
  fn("read_page", "Read the page: title, URL, visible text and a numbered list of interactive elements (links, buttons, inputs). Use the numbers with click/type_text. Cheap - prefer this over screenshots.", {
    ...tabProp,
    include_text: { type: "boolean", description: "Include page text (default true)." },
    max_chars: { type: "integer", description: "Max text characters (default 8000)." },
  }),
  fn("click", "Click an element.", { ...tabProp, ...elProp }, ["element"]),
  fn("type_text", "Type into an input, textarea or editable element.", {
    ...tabProp, ...elProp, text: { type: "string" },
    clear: { type: "boolean", description: "Clear existing text first (default true)." },
    press_enter: { type: "boolean", description: "Press Enter afterwards (default false)." },
  }, ["element", "text"]),
  fn("select_option", "Choose an option in a <select> dropdown by its visible text or value.", { ...tabProp, ...elProp, option: { type: "string" } }, ["element", "option"]),
  fn("press_key", "Press a keyboard key in the page, e.g. Enter, Tab, Escape, ArrowDown, Backspace, PageDown.", { ...tabProp, key: { type: "string" } }, ["key"]),
  fn("scroll", "Scroll the page or bring an element into view.", {
    ...tabProp, direction: { type: "string", enum: ["down", "up", "top", "bottom"] },
    element: { type: "string", description: "Optional: element number or selector to scroll to." },
  }),
  fn("screenshot", "Take a screenshot of the visible part of a tab so you can SEE it. Costs more than read_page - use for layout/visual bugs or when text is not enough.", tabProp),
  fn("run_js", "Run JavaScript in the page (like the DevTools console) and get the result. The code is an expression or async function body; use `return` in multi-line code.", { ...tabProp, code: { type: "string" } }, ["code"]),
  fn("console_logs", "Get console messages and JavaScript errors from a tab. Capturing starts the first time you call this - call reload_tab after it to see errors during page load.", {
    ...tabProp, clear: { type: "boolean", description: "Clear the captured logs after reading." },
    only_errors: { type: "boolean" },
  }),
  fn("network_log", "List network requests of a tab (status, method, URL, type, failures). Capturing starts on first call - reload_tab after it to capture page load.", {
    ...tabProp, only_failed: { type: "boolean", description: "Only failed or 4xx/5xx requests (default false)." },
    filter: { type: "string", description: "Only URLs containing this text." },
  }),
  fn("get_response_body", "Get the response body of a captured network request (by request_id from network_log).", { ...tabProp, request_id: { type: "string" } }, ["request_id"]),
  fn("reload_tab", "Reload a tab and wait for it to load.", { ...tabProp, hard: { type: "boolean", description: "Ignore cache." } }),
  fn("go_back", "Go back in the tab's history.", tabProp),
  fn("close_tab", "Close a tab.", tabProp),
  fn("wait", "Wait some seconds (for pages or builds to finish).", { seconds: { type: "number" } }, ["seconds"]),
];

export const WEB_TOOLS = [
  fn("web_search", "Search the web (DuckDuckGo). Returns titles, links and snippets.", { query: { type: "string" } }, ["query"]),
  fn("fetch_url", "Download a web page or API URL and return its text (no browser tab needed).", {
    url: { type: "string" }, max_chars: { type: "integer", description: "Default 12000" },
  }, ["url"]),
];

export const WORKSPACE_TOOLS = [
  fn("workspace_info", "Show the workspace folder, installed tools (node, python, git...) and running processes."),
  fn("run_command", "Run a shell command in the workspace and wait for it to finish (installs, builds, tests, git). Do NOT use for servers or watchers - use start_process.", {
    command: { type: "string" }, cwd: { type: "string", description: "Folder inside the workspace, e.g. \"my-app\"." },
    timeout: { type: "integer", description: "Seconds, default 120, max 1800." },
  }, ["command"]),
  fn("write_file", "Create or overwrite a file in the workspace with the full content.", {
    path: { type: "string", description: "Path inside the workspace, e.g. \"my-app/index.html\"." }, content: { type: "string" },
  }, ["path", "content"]),
  fn("edit_file", "Replace an exact piece of text in a file (for small changes). 'old' must match exactly once unless replace_all.", {
    path: { type: "string" }, old: { type: "string" }, new: { type: "string" }, replace_all: { type: "boolean" },
  }, ["path", "old", "new"]),
  fn("read_file", "Read a file from the workspace (with line numbers).", {
    path: { type: "string" }, start_line: { type: "integer" }, end_line: { type: "integer" },
  }, ["path"]),
  fn("list_files", "List files in a workspace folder (skips node_modules etc.).", { path: { type: "string" }, depth: { type: "integer" } }),
  fn("delete_path", "Delete a file or folder in the workspace.", { path: { type: "string" } }, ["path"]),
  fn("start_process", "Start a long-running command in the background (dev server, watcher). Returns the first log lines.", {
    command: { type: "string" }, cwd: { type: "string" }, name: { type: "string", description: "Short name, e.g. \"web\"." },
    wait_seconds: { type: "number", description: "Seconds to wait before returning logs (default 4)." },
  }, ["command", "name"]),
  fn("process_logs", "Read the latest output of a background process.", { name: { type: "string" } }, ["name"]),
  fn("stop_process", "Stop a background process (name \"*\" stops all).", { name: { type: "string" } }, ["name"]),
  fn("zip_project", "Zip a finished project folder (skips node_modules, .venv, .git) and download the zip to the user's Downloads folder.", {
    path: { type: "string", description: "Project folder inside the workspace." },
  }, ["path"]),
];

// ------------------------------------------------------------------ risk checks
export const RISKY_WORDS = /\b(buy|pay|payment|purchase|checkout|check out|place order|order now|subscribe|delete|remove|send|submit|confirm|transfer|withdraw|publish|post|tweet|sign up|register|unsubscribe|deactivate|close account|cancel (my )?(account|subscription|order)|donate|book now|reserve)\b/i;
export const RISKY_CMD = /(\brm\s+-[a-z]*[rf]|\bsudo\b|\bmkfs|\bdd\s+if=|\bshutdown\b|\breboot\b|\bgit\s+push\b|\bnpm\s+publish\b|\bchmod\s+-R\b|\bchown\b|>\s*\/dev\/|\bcurl\b[^|]*\|\s*(ba)?sh|\bwget\b[^|]*\|\s*(ba)?sh|:\(\)\s*\{)/i;

// ------------------------------------------------------------------ helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let workingTabId = null; // last tab the agent worked with

async function resolveTab(tab_id) {
  if (tab_id) {
    const t = await chrome.tabs.get(tab_id).catch(() => null);
    if (!t) throw new Error(`No tab with id ${tab_id}. Call list_tabs.`);
    workingTabId = t.id;
    return t;
  }
  if (workingTabId) {
    const t = await chrome.tabs.get(workingTabId).catch(() => null);
    if (t) return t;
  }
  const own = chrome.runtime.getURL("");
  let [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!t || (t.url || "").startsWith(own)) {
    const all = await chrome.tabs.query({});
    t = all.filter((x) => !(x.url || "").startsWith(own)).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  }
  if (!t) throw new Error("No usable tab. Use open_url first.");
  workingTabId = t.id;
  return t;
}

function blockedUrl(url = "") {
  return /^(chrome|brave|edge|about|chrome-extension|devtools|view-source):/i.test(url) ||
    /^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/i.test(url);
}

async function inPage(tabId, func, args = []) {
  const t = await chrome.tabs.get(tabId);
  if (blockedUrl(t.url)) throw new Error(`The browser does not allow extensions to control this page (${t.url}). Open a normal website.`);
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  if (res && res.error) throw new Error(res.error);
  const v = res ? res.result : undefined;
  if (v && v.__error) throw new Error(v.__error);
  return v;
}

function waitForLoad(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; chrome.tabs.onUpdated.removeListener(l); resolve(); } };
    const l = (id, info) => { if (id === tabId && info.status === "complete") setTimeout(finish, 300); };
    chrome.tabs.onUpdated.addListener(l);
    chrome.tabs.get(tabId).then((t) => { if (t.status === "complete") setTimeout(finish, 300); }).catch(finish);
    setTimeout(finish, timeoutMs);
  });
}

// ------------------------------------------------------------------ debugger (CDP)
const dbg = {
  attached: new Set(),
  logs: new Map(),     // tabId -> [entries]
  net: new Map(),      // tabId -> Map(requestId -> entry)
  init() {
    if (this._init) return;
    this._init = true;
    chrome.debugger.onEvent.addListener((src, method, p) => this.onEvent(src.tabId, method, p));
    chrome.debugger.onDetach.addListener((src) => this.attached.delete(src.tabId));
  },
  async attach(tabId) {
    this.init();
    if (this.attached.has(tabId)) return false;
    const t = await chrome.tabs.get(tabId);
    if (blockedUrl(t.url)) throw new Error(`The browser does not allow debugging this page (${t.url}).`);
    try {
      await chrome.debugger.attach({ tabId }, "1.3");
    } catch (e) {
      if (!/already attached/i.test(String(e.message))) throw new Error("Could not attach debugger: " + e.message + " (close DevTools for this tab and retry)");
    }
    this.attached.add(tabId);
    if (!this.logs.has(tabId)) this.logs.set(tabId, []);
    if (!this.net.has(tabId)) this.net.set(tabId, new Map());
    await this.send(tabId, "Runtime.enable").catch(() => {});
    await this.send(tabId, "Log.enable").catch(() => {});
    await this.send(tabId, "Network.enable", { maxPostDataSize: 4096 }).catch(() => {});
    await this.send(tabId, "Page.enable").catch(() => {});
    return true;
  },
  send(tabId, method, params = {}) {
    return chrome.debugger.sendCommand({ tabId }, method, params);
  },
  push(tabId, e) {
    const arr = this.logs.get(tabId) || [];
    arr.push(e);
    if (arr.length > 400) arr.splice(0, arr.length - 400);
    this.logs.set(tabId, arr);
  },
  onEvent(tabId, method, p) {
    const time = new Date().toLocaleTimeString();
    if (method === "Runtime.consoleAPICalled") {
      const text = (p.args || []).map((a) => a.value !== undefined ? (typeof a.value === "string" ? a.value : JSON.stringify(a.value)) : (a.description || a.type)).join(" ");
      const fr = p.stackTrace && p.stackTrace.callFrames && p.stackTrace.callFrames[0];
      this.push(tabId, { time, level: p.type, text, where: fr ? `${fr.url}:${fr.lineNumber + 1}` : "" });
    } else if (method === "Runtime.exceptionThrown") {
      const d = p.exceptionDetails || {};
      const text = (d.exception && d.exception.description) || d.text || "Uncaught exception";
      this.push(tabId, { time, level: "error", text, where: d.url ? `${d.url}:${(d.lineNumber || 0) + 1}` : "" });
    } else if (method === "Log.entryAdded") {
      const e = p.entry || {};
      this.push(tabId, { time, level: e.level, text: e.text, where: e.url || "", source: e.source });
    } else if (method === "Network.requestWillBeSent") {
      const m = this.net.get(tabId) || new Map();
      m.set(p.requestId, { id: p.requestId, method: p.request.method, url: p.request.url, type: p.type, time, postData: p.request.postData });
      if (m.size > 600) m.delete(m.keys().next().value);
      this.net.set(tabId, m);
    } else if (method === "Network.responseReceived") {
      const r = (this.net.get(tabId) || new Map()).get(p.requestId);
      if (r) { r.status = p.response.status; r.mime = p.response.mimeType; }
    } else if (method === "Network.loadingFailed") {
      const r = (this.net.get(tabId) || new Map()).get(p.requestId);
      if (r) { r.failed = p.errorText || "failed"; if (p.blockedReason) r.failed += ` (${p.blockedReason})`; }
    } else if (method === "Network.loadingFinished") {
      const r = (this.net.get(tabId) || new Map()).get(p.requestId);
      if (r) r.size = p.encodedDataLength;
    }
  },
};

const KEYS = {
  Enter: [13, "\r"], Tab: [9, ""], Escape: [27, ""], Backspace: [8, ""], Delete: [46, ""], Space: [32, " "], " ": [32, " "],
  ArrowUp: [38, ""], ArrowDown: [40, ""], ArrowLeft: [37, ""], ArrowRight: [39, ""],
  PageUp: [33, ""], PageDown: [34, ""], Home: [36, ""], End: [35, ""],
};

async function pressKey(tabId, key) {
  await dbg.attach(tabId);
  const [code, text] = KEYS[key] || [key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0, key.length === 1 ? key : ""];
  const base = { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code };
  await dbg.send(tabId, "Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", text: text || undefined, ...base });
  await dbg.send(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

// ------------------------------------------------------------------ page scripts (run inside the web page)
export function pageRead(includeText, maxChars) {
  try {
    const isVisible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      const s = getComputedStyle(el);
      return s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
    };
    const label = (el) => {
      let t = el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("placeholder") || "";
      if (!t && el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) t = l.innerText; }
      if (!t && el.closest("label")) t = el.closest("label").innerText;
      if (!t) t = el.innerText || el.value || el.getAttribute("alt") || el.getAttribute("name") || "";
      if (!t && el.querySelector("img[alt]")) t = el.querySelector("img[alt]").alt;
      return t.replace(/\s+/g, " ").trim().slice(0, 80);
    };
    document.querySelectorAll("[data-km-id]").forEach((e) => e.removeAttribute("data-km-id"));
    const sel = 'a[href], button, input:not([type=hidden]), textarea, select, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=switch], [role=option], [contenteditable=""], [contenteditable=true], summary, [onclick], [tabindex]:not([tabindex="-1"])';
    const els = [...document.querySelectorAll(sel)].filter(isVisible).slice(0, 300);
    const items = els.map((el, i) => {
      const n = String(i + 1);
      el.setAttribute("data-km-id", n);
      const tag = el.tagName.toLowerCase();
      let kind = tag;
      if (tag === "input") kind = `input[${el.type}]`;
      else if (el.getAttribute("role")) kind = el.getAttribute("role");
      let extra = "";
      if (tag === "a") extra = ` -> ${(el.getAttribute("href") || "").slice(0, 100)}`;
      if (["input", "textarea", "select"].includes(tag)) {
        if (el.type === "checkbox" || el.type === "radio") extra = el.checked ? " [checked]" : " [unchecked]";
        else if (el.type === "password") extra = el.value ? ' value="•••"' : "";
        else if (el.value) extra = ` value="${String(el.value).slice(0, 60)}"`;
      }
      if (el.disabled) extra += " [disabled]";
      return `[${n}] ${kind} "${label(el)}"${extra}`;
    });
    let text = "";
    if (includeText) {
      text = (document.body ? document.body.innerText : "").replace(/\n{3,}/g, "\n\n").trim();
      if (text.length > maxChars) text = text.slice(0, maxChars) + `\n... [${text.length - maxChars} more chars - scroll or use run_js to read more]`;
    }
    return {
      title: document.title, url: location.href,
      scroll: `${Math.round(scrollY)} of ${Math.max(0, document.documentElement.scrollHeight - innerHeight)}px`,
      elements: items.join("\n"), text,
    };
  } catch (e) { return { __error: String(e) }; }
}

export function pageDescribe(spec) {
  try {
    const el = /^\d+$/.test(spec) ? document.querySelector(`[data-km-id="${spec}"]`) : document.querySelector(spec);
    if (!el) return { __error: `Element "${spec}" not found. The page may have changed - call read_page again.` };
    const form = el.form || el.closest("form");
    return {
      tag: el.tagName.toLowerCase(), type: el.type || "",
      text: (el.innerText || el.value || el.getAttribute("aria-label") || el.title || "").replace(/\s+/g, " ").trim().slice(0, 100),
      formMethod: form ? (form.getAttribute("method") || "get").toLowerCase() : "",
      formHasPassword: form ? !!form.querySelector("input[type=password]") : false,
      href: el.getAttribute("href") || "",
    };
  } catch (e) { return { __error: String(e) }; }
}

export function pageClick(spec) {
  try {
    const el = /^\d+$/.test(spec) ? document.querySelector(`[data-km-id="${spec}"]`) : document.querySelector(spec);
    if (!el) return { __error: `Element "${spec}" not found. Call read_page again.` };
    el.scrollIntoView({ block: "center", inline: "center" });
    const r = el.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    el.dispatchEvent(new PointerEvent("pointerdown", opts));
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new PointerEvent("pointerup", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    if (typeof el.focus === "function") el.focus();
    el.click();
    return { ok: true };
  } catch (e) { return { __error: String(e) }; }
}

export function pageType(spec, text, clear) {
  try {
    const el = /^\d+$/.test(spec) ? document.querySelector(`[data-km-id="${spec}"]`) : document.querySelector(spec);
    if (!el) return { __error: `Element "${spec}" not found. Call read_page again.` };
    el.scrollIntoView({ block: "center" });
    el.focus();
    if (el.isContentEditable) {
      if (clear) { document.execCommand("selectAll", false); document.execCommand("delete", false); }
      document.execCommand("insertText", false, text);
    } else {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(el, (clear ? "" : el.value) + text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return { ok: true, value: el.isContentEditable ? el.innerText.slice(0, 200) : (el.type === "password" ? "•••" : String(el.value).slice(0, 200)) };
  } catch (e) { return { __error: String(e) }; }
}

export function pageSelect(spec, option) {
  try {
    const el = /^\d+$/.test(spec) ? document.querySelector(`[data-km-id="${spec}"]`) : document.querySelector(spec);
    if (!el || el.tagName !== "SELECT") return { __error: "Element is not a <select>. Call read_page again." };
    const o = [...el.options].find((x) => x.value === option || x.text.trim().toLowerCase() === option.trim().toLowerCase())
      || [...el.options].find((x) => x.text.toLowerCase().includes(option.toLowerCase()));
    if (!o) return { __error: "Option not found. Options: " + [...el.options].map((x) => x.text.trim()).join(" | ") };
    el.value = o.value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, selected: o.text };
  } catch (e) { return { __error: String(e) }; }
}

export function pageScroll(direction, spec) {
  try {
    if (spec) {
      const el = /^\d+$/.test(spec) ? document.querySelector(`[data-km-id="${spec}"]`) : document.querySelector(spec);
      if (!el) return { __error: "Element not found" };
      el.scrollIntoView({ block: "center" });
    } else if (direction === "top") scrollTo(0, 0);
    else if (direction === "bottom") scrollTo(0, document.documentElement.scrollHeight);
    else scrollBy(0, (direction === "up" ? -1 : 1) * innerHeight * 0.85);
    return { ok: true, scroll: `${Math.round(scrollY)} of ${Math.max(0, document.documentElement.scrollHeight - innerHeight)}px` };
  } catch (e) { return { __error: String(e) }; }
}

// ------------------------------------------------------------------ helper (workspace) client
async function helper(ctx, action, body = {}) {
  const { helperUrl, helperToken } = ctx.settings;
  if (!helperUrl || !helperToken) throw new Error("The workspace helper is not set up. Ask the user to start kashmoni_helper.py and enter its address and token in Settings.");
  let r;
  try {
    r = await (ctx.http || fetch)(helperUrl.replace(/\/$/, "") + "/" + action, {
      method: "POST", headers: { "Content-Type": "application/json", "X-KashMoni-Token": helperToken },
      body: JSON.stringify(body), signal: ctx.signal,
    });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new Error(`Cannot reach the workspace helper at ${helperUrl}. Is kashmoni_helper.py running?`);
  }
  if (r.status === 401) throw new Error("Workspace helper rejected the token. Check Settings.");
  return r.json();
}

// ------------------------------------------------------------------ web helpers
export function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,noscript,svg,iframe,template").forEach((e) => e.remove());
  const title = doc.title || "";
  const main = doc.querySelector("main, article, [role=main]") || doc.body;
  const links = [...(main ? main.querySelectorAll("a[href]") : [])].slice(0, 40)
    .map((a) => `${a.textContent.replace(/\s+/g, " ").trim().slice(0, 60)} -> ${a.getAttribute("href")}`).filter((s) => s.length > 6);
  const text = (main ? main.textContent : "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  return { title, text, links };
}

// ------------------------------------------------------------------ executor
// ctx: { settings, signal, confirm(question) -> Promise<boolean>, log(text) }
export async function runTool(name, args, ctx) {
  const confirmMode = ctx.settings.confirmMode || "risky";
  const ask = async (q, risky) => {
    if (confirmMode === "never") return;
    if (confirmMode === "risky" && !risky) return;
    const ok = await ctx.confirm(q);
    if (!ok) throw new Error("The user said NO to this action. Do not retry it; ask the user what to do instead.");
  };
  const isAction = !["list_tabs", "read_page", "screenshot", "console_logs", "network_log", "get_response_body", "wait",
    "web_search", "fetch_url", "workspace_info", "read_file", "list_files", "process_logs"].includes(name);
  if (confirmMode === "always" && isAction) await ask(`Allow **${name}**?\n\n\`${clip(JSON.stringify(args), 400)}\``, true);
  const always = confirmMode === "always";

  switch (name) {
    // ---------------- browser
    case "list_tabs": {
      const tabs = await chrome.tabs.query({});
      const own = chrome.runtime.getURL("");
      return tabs.filter((t) => !(t.url || "").startsWith(own))
        .map((t) => `${t.id}${t.active ? " (active)" : ""}${t.id === workingTabId ? " (working tab)" : ""}: ${t.title} - ${t.url}`).join("\n") || "No tabs";
    }
    case "open_url": {
      let url = String(args.url || "").trim();
      if (!/^[a-z]+:/i.test(url)) url = (/^(localhost|127\.|192\.168\.|10\.)/.test(url) ? "http://" : "https://") + url;
      let tab;
      if (args.new_tab === false) {
        const t = await resolveTab(args.tab_id);
        tab = await chrome.tabs.update(t.id, { url, active: true });
      } else {
        tab = await chrome.tabs.create({ url, active: true });
      }
      workingTabId = tab.id;
      await waitForLoad(tab.id);
      const t = await chrome.tabs.get(tab.id);
      return `Opened tab ${t.id}: ${t.title} - ${t.url}\n(Use read_page to see it.)`;
    }
    case "read_page": {
      const t = await resolveTab(args.tab_id);
      const r = await inPage(t.id, pageRead, [args.include_text !== false, Math.min(args.max_chars || 8000, 40000)]);
      return `Tab ${t.id}\nTitle: ${r.title}\nURL: ${r.url}\nScroll: ${r.scroll}\n\nINTERACTIVE ELEMENTS:\n${r.elements || "(none)"}\n\n${r.text ? "PAGE TEXT:\n" + r.text : ""}`;
    }
    case "click": {
      const t = await resolveTab(args.tab_id);
      const d = await inPage(t.id, pageDescribe, [String(args.element)]);
      const risky = RISKY_WORDS.test(d.text) || (d.type === "submit" && (d.formMethod === "post" || d.formHasPassword));
      if (!always) await ask(`Kash Moni wants to click **"${d.text || d.tag}"** on ${new URL(t.url).host}. Allow?`, risky);
      await inPage(t.id, pageClick, [String(args.element)]);
      await sleep(600);
      await waitForLoad(t.id, 8000);
      const nt = await chrome.tabs.get(t.id);
      return `Clicked ${d.tag} "${d.text}". Page now: ${nt.title} - ${nt.url}. Call read_page to see the result.`;
    }
    case "type_text": {
      const t = await resolveTab(args.tab_id);
      const d = await inPage(t.id, pageDescribe, [String(args.element)]);
      if (args.press_enter && !always) await ask(`Kash Moni wants to type and press **Enter** (submits the form) on ${new URL(t.url).host}. Allow?`, d.formMethod === "post" || d.formHasPassword);
      const r = await inPage(t.id, pageType, [String(args.element), String(args.text ?? ""), args.clear !== false]);
      if (args.press_enter) { await pressKey(t.id, "Enter"); await sleep(800); await waitForLoad(t.id, 8000); }
      return `Typed into ${d.tag}. Value now: "${r.value}"${args.press_enter ? " and pressed Enter." : ""}`;
    }
    case "select_option": {
      const t = await resolveTab(args.tab_id);
      const r = await inPage(t.id, pageSelect, [String(args.element), String(args.option)]);
      return `Selected "${r.selected}".`;
    }
    case "press_key": {
      const t = await resolveTab(args.tab_id);
      if (args.key === "Enter" && !always) {
        const focusRisk = await inPage(t.id, () => { const f = document.activeElement && (document.activeElement.form || document.activeElement.closest("form")); return !!f && ((f.getAttribute("method") || "get").toLowerCase() === "post" || !!f.querySelector("input[type=password]")); });
        await ask(`Kash Moni wants to press **Enter** (may submit a form) on ${new URL(t.url).host}. Allow?`, focusRisk);
      }
      await pressKey(t.id, args.key);
      await sleep(300);
      return `Pressed ${args.key}.`;
    }
    case "scroll": {
      const t = await resolveTab(args.tab_id);
      const r = await inPage(t.id, pageScroll, [args.direction || "down", args.element ? String(args.element) : ""]);
      return `Scrolled. Position: ${r.scroll}`;
    }
    case "screenshot": {
      const t = await resolveTab(args.tab_id);
      if (blockedUrl(t.url)) throw new Error("Cannot screenshot this browser page.");
      if (!t.active) { await chrome.tabs.update(t.id, { active: true }); await sleep(400); }
      await chrome.windows.update(t.windowId, { focused: true }).catch(() => {});
      const dataUrl = await chrome.tabs.captureVisibleTab(t.windowId, { format: "jpeg", quality: 60 });
      return { text: `Screenshot of tab ${t.id} (${t.title}) attached below.`, image: dataUrl };
    }
    case "run_js": {
      const t = await resolveTab(args.tab_id);
      await dbg.attach(t.id);
      const code = String(args.code || "");
      // replMode works like the DevTools console: top-level await, last expression is the result.
      const usesReturn = /(^|[;\n{}]\s*)return\b/.test(code);
      const expression = usesReturn ? `(async () => {\n${code}\n})()` : code;
      const r = await dbg.send(t.id, "Runtime.evaluate", { expression, replMode: !usesReturn, awaitPromise: true, returnByValue: true, userGesture: true, timeout: 20000 });
      if (r.exceptionDetails) return "Error: " + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
      const v = r.result;
      if (v.type === "undefined") return "undefined";
      return clip(v.value !== undefined ? (typeof v.value === "string" ? v.value : JSON.stringify(v.value, null, 1)) : (v.description || v.type));
    }
    case "console_logs": {
      const t = await resolveTab(args.tab_id);
      const fresh = await dbg.attach(t.id);
      let logs = dbg.logs.get(t.id) || [];
      if (args.only_errors) logs = logs.filter((l) => /error|assert/i.test(l.level) || /warn/i.test(l.level));
      const out = logs.map((l) => `[${l.time}] ${String(l.level).toUpperCase()}: ${l.text}${l.where ? "  @ " + l.where : ""}`).join("\n");
      if (args.clear) dbg.logs.set(t.id, []);
      return (fresh ? "Started capturing now - only messages from now on are shown. Call reload_tab to capture page-load errors.\n" : "") + (clip(out) || "No console messages captured.");
    }
    case "network_log": {
      const t = await resolveTab(args.tab_id);
      const fresh = await dbg.attach(t.id);
      let reqs = [...(dbg.net.get(t.id) || new Map()).values()];
      if (args.filter) reqs = reqs.filter((r) => r.url.includes(args.filter));
      if (args.only_failed) reqs = reqs.filter((r) => r.failed || (r.status >= 400));
      const out = reqs.slice(-150).map((r) => `${r.id} ${r.method} ${r.failed ? "FAILED " + r.failed : r.status || "pending"} [${r.type || ""}] ${r.url.slice(0, 200)}`).join("\n");
      return (fresh ? "Started capturing now. Call reload_tab to capture the page load.\n" : "") + (out || "No requests captured.");
    }
    case "get_response_body": {
      const t = await resolveTab(args.tab_id);
      await dbg.attach(t.id);
      const r = await dbg.send(t.id, "Network.getResponseBody", { requestId: String(args.request_id) });
      return clip(r.base64Encoded ? "[binary body, base64, " + r.body.length + " chars]" : r.body);
    }
    case "reload_tab": {
      const t = await resolveTab(args.tab_id);
      await chrome.tabs.reload(t.id, { bypassCache: !!args.hard });
      await sleep(300);
      await waitForLoad(t.id);
      const nt = await chrome.tabs.get(t.id);
      return `Reloaded: ${nt.title} - ${nt.url}`;
    }
    case "go_back": {
      const t = await resolveTab(args.tab_id);
      await chrome.tabs.goBack(t.id).catch(() => {});
      await sleep(500); await waitForLoad(t.id, 8000);
      const nt = await chrome.tabs.get(t.id);
      return `Now on: ${nt.title} - ${nt.url}`;
    }
    case "close_tab": {
      const t = await resolveTab(args.tab_id);
      await chrome.tabs.remove(t.id);
      if (workingTabId === t.id) workingTabId = null;
      return `Closed tab ${t.id}.`;
    }
    case "wait": {
      const s = Math.max(0, Math.min(Number(args.seconds) || 1, 60));
      await sleep(s * 1000);
      return `Waited ${s}s.`;
    }

    // ---------------- web
    case "web_search": {
      const r = await (ctx.http || fetch)("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(args.query), { signal: ctx.signal });
      const doc = new DOMParser().parseFromString(await r.text(), "text/html");
      const results = [...doc.querySelectorAll(".result")].slice(0, 8).map((el) => {
        const a = el.querySelector(".result__a");
        if (!a) return null;
        let href = a.getAttribute("href") || "";
        const m = href.match(/[?&]uddg=([^&]+)/);
        if (m) href = decodeURIComponent(m[1]);
        const snip = (el.querySelector(".result__snippet") || {}).textContent || "";
        return `- ${a.textContent.trim()}\n  ${href}\n  ${snip.trim()}`;
      }).filter(Boolean);
      return results.length ? results.join("\n") : "No results (the search page may have changed or blocked the request). Try open_url with a search engine instead.";
    }
    case "fetch_url": {
      const r = await (ctx.http || fetch)(args.url, { signal: ctx.signal });
      const type = r.headers.get("content-type") || "";
      const body = await r.text();
      const max = Math.min(args.max_chars || 12000, 50000);
      if (type.includes("html")) {
        const p = htmlToText(body);
        return `HTTP ${r.status} ${p.title}\n\n${clip(p.text, max)}\n\nLINKS:\n${p.links.join("\n")}`;
      }
      return `HTTP ${r.status} (${type})\n\n${clip(body, max)}`;
    }

    // ---------------- workspace
    case "workspace_info": return clip(await helper(ctx, "info"));
    case "run_command": {
      if (!always) await ask(`Kash Moni wants to run:\n\n\`\`\`\n${args.command}\n\`\`\``, RISKY_CMD.test(args.command));
      ctx.log && ctx.log(`$ ${args.command}`);
      return clip(await helper(ctx, "run", { command: args.command, cwd: args.cwd || "", timeout: args.timeout || 120 }));
    }
    case "write_file": return clip(await helper(ctx, "write", { path: args.path, content: args.content ?? "" }));
    case "edit_file": return clip(await helper(ctx, "edit", args));
    case "read_file": return clip(await helper(ctx, "read", args), 30000);
    case "list_files": return clip(await helper(ctx, "list", { path: args.path || "", depth: args.depth || 3 }));
    case "delete_path": {
      if (!always) await ask(`Kash Moni wants to delete **${args.path}** from your workspace. Allow?`, true);
      return clip(await helper(ctx, "delete", args));
    }
    case "start_process": {
      if (!always) await ask(`Kash Moni wants to start:\n\n\`\`\`\n${args.command}\n\`\`\``, RISKY_CMD.test(args.command));
      return clip(await helper(ctx, "start", args));
    }
    case "process_logs": return clip(await helper(ctx, "logs", args));
    case "stop_process": return clip(await helper(ctx, "stop", args));
    case "zip_project": {
      const r = await helper(ctx, "zip", { path: args.path });
      if (!r.ok) return clip(r);
      const url = ctx.settings.helperUrl.replace(/\/$/, "") + `/download?path=${encodeURIComponent(r.zip)}&token=${encodeURIComponent(ctx.settings.helperToken)}`;
      const filename = "KashMoni/" + r.zip.split("/").pop();
      let id = null;
      try {
        id = ctx.download ? await ctx.download(url, filename)
          : await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: "uniquify" });
      } catch (e) { /* ignore */ }
      return `Zipped ${r.files} files (${Math.round(r.bytes / 1024)} KB). ${id ? `Downloaded to the user's Downloads/${filename}.` : `Download failed; the zip is at workspace/${r.zip}.`}`;
    }
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}
