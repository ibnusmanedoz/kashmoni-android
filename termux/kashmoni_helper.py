#!/usr/bin/env python3
"""
Kash Moni AI - workspace helper
================================
A tiny local server that gives Kash Moni AI a "workspace": a project folder
where it can write files, run commands, start dev servers, read their logs
and zip finished projects for you.

Only Python 3.8+ is needed (no extra packages). Works on Zorin/Ubuntu and in
Termux on Android.

    python3 kashmoni_helper.py            # start (listens on 127.0.0.1:8765)
    python3 kashmoni_helper.py --show-token
    python3 kashmoni_helper.py --port 9000
    python3 kashmoni_helper.py --workspace ~/MyProjects

Security:
  * Listens on 127.0.0.1 only (this computer). Use --host 0.0.0.0 only if you
    know why; then anyone on your network who has the token can run commands.
  * Every request needs the secret token stored in ~/.kashmoni/config.json.
"""
import argparse
import json
import os
import secrets
import shutil
import signal
import subprocess
import sys
import threading
import time
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

VERSION = "1.0.0"
CONFIG_DIR = Path.home() / ".kashmoni"
CONFIG_FILE = CONFIG_DIR / "config.json"
DEFAULT_WORKSPACE = Path.home() / "KashMoniProjects"
MAX_OUTPUT = 20000          # characters of command output sent back to the AI
MAX_READ = 200000           # max characters returned when reading a file
SKIP_IN_ZIP = {"node_modules", ".venv", "venv", "__pycache__", ".git", ".next",
               ".cache", ".gradle", "build", "dist", ".pytest_cache", "_zips", "_logs"}
KEEP_BUILD_DIRS = False     # set True to include build/ and dist/ in zips

WORKSPACE = DEFAULT_WORKSPACE
TOKEN = ""
PROCS = {}                  # name -> {"proc": Popen, "log": Path, "cmd": str, "cwd": str, "started": float}
PROCS_LOCK = threading.Lock()


# ------------------------------------------------------------------ config
def load_config():
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    cfg = {}
    if CONFIG_FILE.exists():
        try:
            cfg = json.loads(CONFIG_FILE.read_text())
        except Exception:
            cfg = {}
    if not cfg.get("token"):
        cfg["token"] = secrets.token_urlsafe(24)
        CONFIG_FILE.write_text(json.dumps(cfg, indent=2))
        try:
            os.chmod(CONFIG_FILE, 0o600)
        except Exception:
            pass
    return cfg


# ------------------------------------------------------------------ helpers
def trim(text, limit=MAX_OUTPUT):
    if text is None:
        return ""
    if len(text) <= limit:
        return text
    half = limit // 2
    return text[:half] + f"\n\n... [{len(text) - limit} characters cut] ...\n\n" + text[-half:]


def safe_path(rel, must_exist=False):
    """Resolve a path inside the workspace. Refuses anything outside it."""
    rel = (rel or "").strip()
    if rel.startswith("~"):
        rel = rel.lstrip("~/")
    p = (WORKSPACE / rel).resolve() if not os.path.isabs(rel) else Path(rel).resolve()
    ws = WORKSPACE.resolve()
    if p != ws and ws not in p.parents:
        raise ValueError(f"Path is outside the workspace ({ws}): {rel}")
    if must_exist and not p.exists():
        raise FileNotFoundError(f"Not found: {rel}")
    return p


def rel_to_ws(p):
    try:
        return str(Path(p).resolve().relative_to(WORKSPACE.resolve())) or "."
    except Exception:
        return str(p)


def find_shell():
    """bash if available (Termux keeps it in $PREFIX/bin), otherwise sh."""
    for cand in (shutil.which("bash"), "/bin/bash", shutil.which("sh"), "/bin/sh"):
        if cand and os.path.exists(cand):
            return cand
    return None


SHELL = find_shell()


def shell_env(extra=None):
    env = os.environ.copy()
    if isinstance(extra, dict):
        for k, v in extra.items():
            if isinstance(k, str) and k.replace("_", "").isalnum() and v is not None:
                env[k] = str(v)
    env.setdefault("CI", "1")              # makes npm/create-* tools less interactive
    env.setdefault("npm_config_yes", "true")
    env["PYTHONUNBUFFERED"] = "1"
    env.setdefault("BROWSER", "none")      # stop dev servers from opening browsers
    return env


# ------------------------------------------------------------------ actions
def act_info(_):
    return {
        "ok": True, "version": VERSION, "workspace": str(WORKSPACE),
        "platform": sys.platform, "python": sys.version.split()[0],
        "termux": "com.termux" in os.environ.get("PREFIX", ""),
        "tools": {t: bool(shutil.which(t)) for t in
                  ["node", "npm", "npx", "python3", "pip", "git", "zip", "php", "java"]},
        "running": list_procs(),
    }


def act_run(d):
    cmd = d.get("command", "")
    if not cmd.strip():
        raise ValueError("command is empty")
    cwd = safe_path(d.get("cwd", ""))
    cwd.mkdir(parents=True, exist_ok=True)
    timeout = max(1, min(int(d.get("timeout", 120)), 1800))
    start = time.time()
    proc = subprocess.Popen(cmd, shell=True, cwd=str(cwd), stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True, errors="replace",
                            env=shell_env(d.get("env")), stdin=subprocess.DEVNULL, start_new_session=True,
                            executable=SHELL)
    try:
        out, err = proc.communicate(timeout=timeout)
        code, timed_out = proc.returncode, False
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)   # kill the command and everything it started
        except Exception:
            proc.kill()
        try:
            out, err = proc.communicate(timeout=5)
        except Exception:
            out, err = "", ""
        code, timed_out = None, True
    return {
        "ok": code == 0, "exit_code": code, "timed_out": timed_out,
        "seconds": round(time.time() - start, 1), "cwd": rel_to_ws(cwd),
        "stdout": trim(out), "stderr": trim(err),
        "hint": ("Command timed out. For servers or watchers use start_process instead."
                 if timed_out else None),
    }


def act_write(d):
    p = safe_path(d.get("path", ""))
    if p == WORKSPACE.resolve():
        raise ValueError("path must be a file inside the workspace")
    p.parent.mkdir(parents=True, exist_ok=True)
    content = d.get("content", "")
    if d.get("append"):
        with open(p, "a", encoding="utf-8") as f:
            f.write(content)
    else:
        p.write_text(content, encoding="utf-8")
    return {"ok": True, "path": rel_to_ws(p), "bytes": p.stat().st_size}


def act_edit(d):
    p = safe_path(d.get("path", ""), must_exist=True)
    text = p.read_text(encoding="utf-8", errors="replace")
    old, new = d.get("old", ""), d.get("new", "")
    if not old:
        raise ValueError("'old' text is empty")
    count = text.count(old)
    if count == 0:
        raise ValueError("'old' text was not found in the file. Read the file again and copy the exact text.")
    if count > 1 and not d.get("replace_all"):
        raise ValueError(f"'old' text appears {count} times. Add more surrounding text so it is unique, or set replace_all.")
    text = text.replace(old, new) if d.get("replace_all") else text.replace(old, new, 1)
    p.write_text(text, encoding="utf-8")
    return {"ok": True, "path": rel_to_ws(p), "replacements": count if d.get("replace_all") else 1}


def act_read(d):
    p = safe_path(d.get("path", ""), must_exist=True)
    if p.is_dir():
        raise ValueError("That is a folder. Use list_files.")
    data = p.read_text(encoding="utf-8", errors="replace")
    lines = data.splitlines()
    start = max(1, int(d.get("start_line", 1)))
    end = int(d.get("end_line", 0)) or len(lines)
    chunk = lines[start - 1:end]
    numbered = "\n".join(f"{i + start:5}| {l}" for i, l in enumerate(chunk))
    return {"ok": True, "path": rel_to_ws(p), "total_lines": len(lines),
            "content": trim(numbered, MAX_READ)}


def act_list(d):
    root = safe_path(d.get("path", ""))
    if not root.exists():
        return {"ok": True, "path": rel_to_ws(root), "entries": [], "note": "folder does not exist yet"}
    depth = max(1, min(int(d.get("depth", 3)), 8))
    out = []
    base_depth = len(root.parts)
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(x for x in dirnames if x not in SKIP_IN_ZIP)
        level = len(Path(dirpath).parts) - base_depth
        if level >= depth:
            dirnames[:] = []
        for name in sorted(filenames):
            fp = Path(dirpath) / name
            try:
                size = fp.stat().st_size
            except OSError:
                size = 0
            out.append(f"{rel_to_ws(fp)}  ({size} B)")
            if len(out) >= 800:
                return {"ok": True, "path": rel_to_ws(root), "entries": out, "note": "truncated at 800 files"}
    return {"ok": True, "path": rel_to_ws(root), "entries": out}


def act_delete(d):
    p = safe_path(d.get("path", ""), must_exist=True)
    if p == WORKSPACE.resolve():
        raise ValueError("Refusing to delete the whole workspace")
    if p.is_dir():
        shutil.rmtree(p)
    else:
        p.unlink()
    return {"ok": True, "deleted": rel_to_ws(p)}


def list_procs():
    res = []
    with PROCS_LOCK:
        for name, info in PROCS.items():
            code = info["proc"].poll()
            res.append({"name": name, "command": info["cmd"], "cwd": info["cwd"],
                        "running": code is None, "exit_code": code,
                        "uptime_s": round(time.time() - info["started"])})
    return res


def stop_proc(name):
    with PROCS_LOCK:
        info = PROCS.get(name)
    if not info:
        return False
    proc = info["proc"]
    if proc.poll() is None:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except Exception:
            proc.terminate()
        try:
            proc.wait(5)
        except Exception:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except Exception:
                proc.kill()
    return True


def tail(path, chars=8000):
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - chars))
            return f.read().decode(errors="replace")
    except FileNotFoundError:
        return ""


def act_start(d):
    cmd = d.get("command", "")
    name = (d.get("name") or "server").strip().replace("/", "_")
    if not cmd.strip():
        raise ValueError("command is empty")
    cwd = safe_path(d.get("cwd", ""))
    cwd.mkdir(parents=True, exist_ok=True)
    stop_proc(name)
    logdir = WORKSPACE / "_logs"
    logdir.mkdir(parents=True, exist_ok=True)
    log = logdir / f"{name}.log"
    lf = open(log, "w", encoding="utf-8")
    proc = subprocess.Popen(cmd, shell=True, cwd=str(cwd), stdout=lf, stderr=subprocess.STDOUT,
                            stdin=subprocess.DEVNULL, env=shell_env(d.get("env")), start_new_session=True,
                            executable=SHELL)
    with PROCS_LOCK:
        PROCS[name] = {"proc": proc, "log": log, "cmd": cmd, "cwd": rel_to_ws(cwd), "started": time.time()}
    wait = max(0, min(float(d.get("wait_seconds", 4)), 60))
    time.sleep(wait)
    code = proc.poll()
    return {"ok": code is None or code == 0, "name": name, "running": code is None,
            "exit_code": code, "log_tail": trim(tail(log), 6000),
            "hint": "Process exited already - read log_tail for the error." if code not in (None, 0) else None}


def act_logs(d):
    name = d.get("name", "server")
    with PROCS_LOCK:
        info = PROCS.get(name)
    if not info:
        return {"ok": False, "error": f"No process named '{name}'", "running": list_procs()}
    code = info["proc"].poll()
    return {"ok": True, "name": name, "running": code is None, "exit_code": code,
            "log_tail": trim(tail(info["log"], int(d.get("chars", 8000))), 12000)}


def act_stop(d):
    name = d.get("name", "server")
    if name == "*":
        names = [p["name"] for p in list_procs()]
        for n in names:
            stop_proc(n)
        return {"ok": True, "stopped": names}
    return {"ok": stop_proc(name), "stopped": [name]}


def act_procs(_):
    return {"ok": True, "processes": list_procs()}


def act_zip(d):
    src = safe_path(d.get("path", ""), must_exist=True)
    if src == WORKSPACE.resolve():
        raise ValueError("Give a project folder, not the whole workspace")
    include_all = bool(d.get("include_dependencies"))
    zips = WORKSPACE / "_zips"
    zips.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    out = zips / f"{src.name}-{stamp}.zip"
    count = 0
    skip = set() if include_all else set(SKIP_IN_ZIP)
    if KEEP_BUILD_DIRS:
        skip -= {"build", "dist"}
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        if src.is_file():
            z.write(src, src.name)
            count = 1
        else:
            for dirpath, dirnames, filenames in os.walk(src):
                dirnames[:] = [x for x in dirnames if x not in skip]
                for fn in filenames:
                    fp = Path(dirpath) / fn
                    if fp.suffix in (".log", ".pyc"):
                        continue
                    z.write(fp, str(Path(src.name) / fp.relative_to(src)))
                    count += 1
    return {"ok": True, "zip": rel_to_ws(out), "files": count, "bytes": out.stat().st_size,
            "download_path": f"/download?path={rel_to_ws(out)}"}


ACTIONS = {
    "info": act_info, "run": act_run, "write": act_write, "edit": act_edit, "read": act_read,
    "list": act_list, "delete": act_delete, "start": act_start, "logs": act_logs,
    "stop": act_stop, "procs": act_procs, "zip": act_zip,
}


# ------------------------------------------------------------------ http
class Handler(BaseHTTPRequestHandler):
    server_version = "KashMoniHelper/" + VERSION

    def log_message(self, fmt, *args):
        sys.stderr.write("[helper] " + (fmt % args) + "\n")

    def _cors(self):
        origin = self.headers.get("Origin", "")
        if origin.startswith(("chrome-extension://", "moz-extension://", "http://localhost", "http://127.0.0.1")):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-KashMoni-Token")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _authed(self, qs=None):
        tok = self.headers.get("X-KashMoni-Token") or ((qs or {}).get("token") or [""])[0]
        return secrets.compare_digest(tok, TOKEN)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        u = urlparse(self.path)
        qs = parse_qs(u.query)
        if u.path == "/ping":
            return self._send(200, {"ok": True, "app": "kashmoni-helper", "version": VERSION})
        if not self._authed(qs):
            return self._send(401, {"ok": False, "error": "Wrong or missing token"})
        if u.path == "/download":
            try:
                p = safe_path((qs.get("path") or [""])[0], must_exist=True)
                data = p.read_bytes()
            except Exception as e:
                return self._send(404, {"ok": False, "error": str(e)})
            self.send_response(200)
            self.send_header("Content-Type", "application/zip" if p.suffix == ".zip" else "application/octet-stream")
            self.send_header("Content-Disposition", f'attachment; filename="{p.name}"')
            self.send_header("Content-Length", str(len(data)))
            self._cors()
            self.end_headers()
            self.wfile.write(data)
            return
        return self._send(404, {"ok": False, "error": "unknown path"})

    def do_POST(self):
        u = urlparse(self.path)
        if not self._authed():
            return self._send(401, {"ok": False, "error": "Wrong or missing token"})
        action = u.path.strip("/")
        fn = ACTIONS.get(action)
        if not fn:
            return self._send(404, {"ok": False, "error": f"unknown action '{action}'"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            data = json.loads(self.rfile.read(length) or b"{}") if length else {}
            return self._send(200, fn(data))
        except Exception as e:
            return self._send(200, {"ok": False, "error": f"{type(e).__name__}: {e}"})


def main():
    global WORKSPACE, TOKEN
    ap = argparse.ArgumentParser(description="Kash Moni AI workspace helper")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--workspace", default=None)
    ap.add_argument("--show-token", action="store_true", help="print the token and exit")
    ap.add_argument("--new-token", action="store_true", help="make a new token")
    a = ap.parse_args()

    cfg = load_config()
    if a.new_token:
        cfg["token"] = secrets.token_urlsafe(24)
    if a.workspace:
        cfg["workspace"] = str(Path(a.workspace).expanduser())
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2))
    TOKEN = cfg["token"]
    WORKSPACE = Path(cfg.get("workspace") or DEFAULT_WORKSPACE).expanduser()
    WORKSPACE.mkdir(parents=True, exist_ok=True)

    if a.show_token:
        print(TOKEN)
        return

    srv = ThreadingHTTPServer((a.host, a.port), Handler)
    print("=" * 60)
    print(f" Kash Moni AI helper {VERSION}")
    print(f" Address  : http://{a.host}:{a.port}")
    print(f" Workspace: {WORKSPACE}")
    print(f" Token    : {TOKEN}")
    print(" Paste the address and token into Kash Moni AI > Settings.")
    print(" Press Ctrl+C to stop.")
    print("=" * 60)
    if a.host not in ("127.0.0.1", "localhost"):
        print(" WARNING: listening on the network. Anyone with the token can run commands.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        act_stop({"name": "*"})
        print("\nHelper stopped.")


if __name__ == "__main__":
    main()
