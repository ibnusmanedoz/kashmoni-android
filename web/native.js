// Promise wrapper around the Java bridge (window.KMAndroid) in MainActivity.java.
const pending = new Map();
let seq = 0;

window.KMNative = {
  done(id, json) {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    let v;
    try { v = JSON.parse(json); } catch { v = { error: "Bad reply from app" }; }
    p(v);
  },
};

function bridge() {
  if (!window.KMAndroid) throw new Error("Native bridge missing (not running inside the Kash Moni app).");
  return window.KMAndroid;
}

function call(fnName, ...args) {
  return new Promise((resolve) => {
    const id = "n" + (++seq);
    pending.set(id, resolve);
    bridge()[fnName](id, ...args);
  });
}

function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException("Stopped", "AbortError"));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Stopped", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then((v) => { signal.removeEventListener("abort", onAbort); resolve(v); },
      (e) => { signal.removeEventListener("abort", onAbort); reject(e); });
  });
}

export const native = {
  // fetch()-like: returns { ok, status, text(), json(), headers.get() }
  async http(url, opts = {}) {
    const headers = {};
    if (opts.headers) for (const [k, v] of Object.entries(opts.headers)) headers[k] = String(v);
    const r = await abortable(call("http", opts.method || "GET", String(url), JSON.stringify(headers), opts.body || "", opts.timeout || 300), opts.signal);
    if (r.error) throw new TypeError("Failed to fetch: " + r.error);
    const h = r.headers || {};
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () => r.body,
      json: async () => JSON.parse(r.body),
      headers: { get: (k) => h[String(k).toLowerCase()] || null },
    };
  },
  browser(action, args = {}) { return call("browser", action, JSON.stringify(args)); },
  async download(url, filename) {
    const r = await call("download", url, filename);
    if (r.error) throw new Error(r.error);
    return r.path;
  },
  loadState() {
    try { return JSON.parse(bridge().loadState() || "{}"); } catch { return {}; }
  },
  saveState(obj) { bridge().saveState(JSON.stringify(obj)); },
  toast(msg) { try { bridge().toast(String(msg)); } catch { /* ignore */ } },
  showBrowser() { try { bridge().showBrowser(); } catch { /* ignore */ } },
  showChat() { try { bridge().showChatView(); } catch { /* ignore */ } },
  exitApp() { try { bridge().exitApp(); } catch { /* ignore */ } },
};
