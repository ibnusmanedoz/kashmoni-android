// Kash Moni AI (Android) - tools. Browser tools drive the app's built-in browser.
// Web and workspace tools are shared with the browser extension (shared/tools.js).
import {
  BROWSER_TOOLS, WEB_TOOLS, WORKSPACE_TOOLS, runTool as sharedRunTool, clip,
  pageRead, pageDescribe, pageClick, pageType, pageSelect, pageScroll, RISKY_WORDS,
} from "./shared/tools.js";
import { native } from "./native.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Same browser tools as the extension, minus tab handling (there is one built-in browser).
const KEEP = ["open_url", "read_page", "click", "type_text", "select_option", "press_key", "scroll", "screenshot",
  "run_js", "console_logs", "network_log", "reload_tab", "go_back", "wait"];
export const ANDROID_BROWSER_TOOLS = BROWSER_TOOLS
  .filter((t) => KEEP.includes(t.function.name))
  .map((t) => {
    const c = JSON.parse(JSON.stringify(t));
    delete c.function.parameters.properties.tab_id;
    delete c.function.parameters.properties.new_tab;
    if (c.function.name === "open_url") c.function.description = "Open a URL in the app's built-in browser.";
    if (c.function.name === "console_logs") c.function.description = "Get console messages and JavaScript errors from the built-in browser (captured since the app started). Use reload_tab first to see fresh page-load errors, with clear=true to drop old ones.";
    if (c.function.name === "network_log") c.function.description = "List requests the built-in browser made (method, URL, HTTP errors and failures).";
    if (c.function.name === "reload_tab") c.function.description = "Reload the built-in browser page and wait for it.";
    if (c.function.name === "go_back") c.function.description = "Go back in the built-in browser.";
    return c;
  });
ANDROID_BROWSER_TOOLS.push({
  type: "function",
  function: {
    name: "show_browser",
    description: "Switch the user's screen to the built-in browser (or back to chat) so they can see or use the page.",
    parameters: { type: "object", properties: { show: { type: "boolean", description: "true = show browser, false = show chat" } } },
  },
});

export function androidToolList(helperOk) {
  return [...ANDROID_BROWSER_TOOLS, ...WEB_TOOLS, ...(helperOk ? WORKSPACE_TOOLS : [])];
}

// ------------------------------------------------------------------ browser helpers
async function state() { return native.browser("state"); }

async function waitForLoad(timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  await sleep(300);
  while (Date.now() < end) {
    const s = await state();
    if (!s.loading) { await sleep(300); return s; }
    await sleep(250);
  }
  return state();
}

async function evalRaw(code) {
  const r = await native.browser("eval", { code });
  if (r.error) throw new Error(r.error);
  return r.value; // JSON-encoded value from evaluateJavascript
}

// Run one of the shared page functions inside the page.
async function inPage(func, args = []) {
  const s = await state();
  if (!s.url || s.url === "about:blank") throw new Error("The browser has no page open. Use open_url first.");
  const code = `(function(){try{return JSON.stringify((${func.toString()}).apply(null, ${JSON.stringify(args)}));}catch(e){return JSON.stringify({__error:String(e)});}})()`;
  const raw = await evalRaw(code);
  let v;
  try { v = JSON.parse(JSON.parse(raw)); } catch { throw new Error("The page did not answer (it may still be loading). Try again."); }
  if (v && v.__error) throw new Error(v.__error);
  return v;
}

function pageKey(key) {
  try {
    const el = document.activeElement || document.body;
    const opts = { key, bubbles: true, cancelable: true };
    const allowed = el.dispatchEvent(new KeyboardEvent("keydown", opts));
    el.dispatchEvent(new KeyboardEvent("keyup", opts));
    if (!allowed) return { ok: true, note: "page handled the key" };
    if (key === "Enter") {
      const f = el.form || (el.closest && el.closest("form"));
      if (f && el.tagName !== "TEXTAREA") { f.requestSubmit ? f.requestSubmit() : f.submit(); return { ok: true, note: "form submitted" }; }
      if (el.click && /^(A|BUTTON)$/.test(el.tagName)) el.click();
    } else if (key === "PageDown") scrollBy(0, innerHeight * 0.85);
    else if (key === "PageUp") scrollBy(0, -innerHeight * 0.85);
    else if (key === "End") scrollTo(0, document.documentElement.scrollHeight);
    else if (key === "Home") scrollTo(0, 0);
    else if (key === "Escape" && el.blur) el.blur();
    else if (key === "Tab") {
      const f = [...document.querySelectorAll("a[href],button,input,select,textarea,[tabindex]")].filter((x) => !x.disabled && x.tabIndex >= 0);
      const i = f.indexOf(el);
      if (f.length) f[(i + 1) % f.length].focus();
    }
    return { ok: true };
  } catch (e) { return { __error: String(e) }; }
}

function formRisk() {
  const el = document.activeElement;
  const f = el && (el.form || (el.closest && el.closest("form")));
  return !!f && ((f.getAttribute("method") || "get").toLowerCase() === "post" || !!f.querySelector("input[type=password]"));
}

// ------------------------------------------------------------------ executor
export async function androidRunTool(name, args, ctx) {
  const ownBrowser = ANDROID_BROWSER_TOOLS.some((t) => t.function.name === name);
  if (!ownBrowser) {
    // web + workspace tools are shared with the extension
    return sharedRunTool(name, args, { ...ctx, http: native.http, download: native.download });
  }
  const mode = ctx.settings.confirmMode || "risky";
  const ask = async (q, risky) => {
    if (mode === "never" || (mode === "risky" && !risky)) return;
    if (!(await ctx.confirm(q))) throw new Error("The user said NO to this action. Do not retry it; ask the user what to do instead.");
  };
  const readOnly = ["read_page", "screenshot", "console_logs", "network_log", "wait", "show_browser"].includes(name);
  const always = mode === "always";
  if (always && !readOnly) await ask(`Allow **${name}**?\n\n\`${clip(JSON.stringify(args), 400)}\``, true);
  const host = async () => { try { return new URL((await state()).url).host; } catch { return "this page"; } };

  switch (name) {
    case "open_url": {
      await native.browser("open", { url: String(args.url || "") });
      const s = await waitForLoad();
      return `Opened in built-in browser: ${s.title} - ${s.url}\n(Use read_page to see it.)`;
    }
    case "read_page": {
      const r = await inPage(pageRead, [args.include_text !== false, Math.min(args.max_chars || 8000, 40000)]);
      return `Title: ${r.title}\nURL: ${r.url}\nScroll: ${r.scroll}\n\nINTERACTIVE ELEMENTS:\n${r.elements || "(none)"}\n\n${r.text ? "PAGE TEXT:\n" + r.text : ""}`;
    }
    case "click": {
      const d = await inPage(pageDescribe, [String(args.element)]);
      const risky = RISKY_WORDS.test(d.text) || (d.type === "submit" && (d.formMethod === "post" || d.formHasPassword));
      if (!always) await ask(`Kash Moni wants to click **"${d.text || d.tag}"** on ${await host()}. Allow?`, risky);
      await inPage(pageClick, [String(args.element)]);
      await sleep(600);
      const s = await waitForLoad(8000);
      return `Clicked ${d.tag} "${d.text}". Page now: ${s.title} - ${s.url}. Call read_page to see the result.`;
    }
    case "type_text": {
      const d = await inPage(pageDescribe, [String(args.element)]);
      if (args.press_enter && !always) await ask(`Kash Moni wants to type and press **Enter** (submits the form) on ${await host()}. Allow?`, d.formMethod === "post" || d.formHasPassword);
      const r = await inPage(pageType, [String(args.element), String(args.text ?? ""), args.clear !== false]);
      if (args.press_enter) { await inPage(pageKey, ["Enter"]); await sleep(800); await waitForLoad(8000); }
      return `Typed into ${d.tag}. Value now: "${r.value}"${args.press_enter ? " and pressed Enter." : ""}`;
    }
    case "select_option": {
      const r = await inPage(pageSelect, [String(args.element), String(args.option)]);
      return `Selected "${r.selected}".`;
    }
    case "press_key": {
      if (args.key === "Enter" && !always) await ask(`Kash Moni wants to press **Enter** (may submit a form) on ${await host()}. Allow?`, await inPage(formRisk));
      const r = await inPage(pageKey, [String(args.key)]);
      await sleep(400);
      return `Pressed ${args.key}${r.note ? " (" + r.note + ")" : ""}.`;
    }
    case "scroll": {
      const r = await inPage(pageScroll, [args.direction || "down", args.element ? String(args.element) : ""]);
      return `Scrolled. Position: ${r.scroll}`;
    }
    case "screenshot": {
      const r = await native.browser("screenshot");
      if (r.error) throw new Error(r.error);
      const s = await state();
      return { text: `Screenshot of the built-in browser (${s.title}) attached below.`, image: r.dataUrl };
    }
    case "run_js": {
      const code = String(args.code || "");
      const usesReturn = /(^|[;\n{}]\s*)return\b/.test(code);
      const body = usesReturn ? code : `return (${code.replace(/;\s*$/, "")});`;
      const key = "k" + Date.now() + Math.random().toString(36).slice(2, 6);
      const start = `(function(){window.__kmR=window.__kmR||{};(async function(){${"\n"}${body}${"\n"}})().then(function(v){var s;try{s=JSON.stringify(v===undefined?"undefined":v,null,1)}catch(e){s=JSON.stringify(String(v))}window.__kmR["${key}"]={v:s}},function(e){window.__kmR["${key}"]={e:String(e&&e.stack||e)}});return "started"})()`;
      // Try: whole code as an expression; then "statements; return lastExpression"; then plain statements.
      const variants = [body];
      if (!usesReturn) {
        const t = code.trim().replace(/;\s*$/, "");
        const cut = Math.max(t.lastIndexOf(";"), t.lastIndexOf("\n"));
        const tail = cut >= 0 ? t.slice(cut + 1).trim() : "";
        if (tail && !/^(const|let|var|if|for|while|do|switch|function|class|return|throw|try|}|\/\/)/.test(tail)) {
          variants.push(t.slice(0, cut + 1) + "\nreturn (" + tail + ");");
        }
        variants.push(code);
      }
      let raw = "null";
      for (const v of variants) {
        raw = await evalRaw(start.replace(body, () => v));
        if (raw !== "null") break;
      }
      if (raw === "null") return "Error: the code has a syntax error.";
      const end = Date.now() + 20000;
      while (Date.now() < end) {
        const got = await evalRaw(`JSON.stringify((window.__kmR||{})["${key}"]||null)`);
        let v = null;
        try { v = JSON.parse(JSON.parse(got)); } catch { /* not ready */ }
        if (v) {
          await evalRaw(`delete window.__kmR["${key}"]`);
          if (v.e) return "Error: " + v.e;
          let out = v.v;
          try { const p = JSON.parse(out); out = typeof p === "string" ? p : JSON.stringify(p, null, 1); } catch { /* keep */ }
          return clip(out);
        }
        await sleep(200);
      }
      return "Error: no result after 20 seconds (syntax error or a promise that never finished).";
    }
    case "console_logs": {
      const r = await native.browser("console");
      let logs = r.items || [];
      if (args.only_errors) logs = logs.filter((l) => /error|warn/i.test(l.level));
      if (args.clear) await native.browser("clear");
      const out = logs.map((l) => `[${l.time}] ${String(l.level).toUpperCase()}: ${l.text}${l.where ? "  @ " + l.where : ""}`).join("\n");
      return clip(out) || "No console messages captured.";
    }
    case "network_log": {
      const r = await native.browser("network");
      let reqs = r.items || [];
      if (args.filter) reqs = reqs.filter((x) => x.url.includes(args.filter));
      if (args.only_failed) reqs = reqs.filter((x) => x.failed || Number(x.status) >= 400);
      const out = reqs.slice(-150).map((x) => `${x.method} ${x.failed ? "FAILED " + x.failed : x.status || "ok"} ${x.main ? "[page] " : ""}${x.url.slice(0, 200)}`).join("\n");
      return out || "No requests captured.";
    }
    case "reload_tab": {
      await native.browser("reload");
      const s = await waitForLoad();
      return `Reloaded: ${s.title} - ${s.url}`;
    }
    case "go_back": {
      await native.browser("back");
      const s = await waitForLoad(8000);
      return `Now on: ${s.title} - ${s.url}`;
    }
    case "wait": {
      const sec = Math.max(0, Math.min(Number(args.seconds) || 1, 60));
      await sleep(sec * 1000);
      return `Waited ${sec}s.`;
    }
    case "show_browser": {
      if (args.show === false) native.showChat(); else native.showBrowser();
      return args.show === false ? "Showing chat." : "Showing the browser to the user. They can tap 💬 Chat to come back.";
    }
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}
