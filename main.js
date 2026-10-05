// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Griffith.Software — https://griffith.software
// main.js — Benchdrop
//
// Drop in a zipped web-app project; Benchdrop unpacks it, installs its
// dependencies, runs it, and shows it in-window.
//
// Design notes worth knowing before editing:
//
//  * Runtime. Benchdrop needs a real Node.js. It uses one already on the
//    machine if it's new enough, otherwise it downloads an official build
//    once. (An earlier version reused Electron's embedded Node via
//    ELECTRON_RUN_AS_NODE; that breaks for packages whose install scripts
//    shell out through cmd.exe to a bare `node`, e.g. esbuild, which fail
//    with "[ERROR:icu_util.cc] Invalid file descriptor to ICU data".)
//
//  * Persistent project folders. Each zip maps to a STABLE folder keyed by
//    a hash of its path, so anything a project sets up on first run —
//    node_modules, .env.local, generated backend code — survives the next
//    run. "Reset project" wipes and re-extracts.
//
//  * Concurrent scripts. Real projects often need more than one process
//    (a backend plus a frontend). Benchdrop can run several scripts at once
//    and watches all of their output for the local URL.
//
//  * Interactive input. Some CLIs ask questions on first run. The log pane
//    can send a line to a running process's stdin. Note this is a plain
//    pipe, not a real terminal (no PTY), so a CLI that insists on a TTY may
//    still refuse to prompt.

const { app, BrowserWindow, ipcMain, dialog, shell, session, webContents, clipboard, nativeImage, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const treeKill = require('tree-kill');

let mainWindow;
let runningProcs = []; // [{ id, name, child }]
let runningStaticServer = null;
let currentProjectDir = null;
let currentScriptNames = [];
let currentZipPath = null;

// ---------------------------------------------------------------------------
// One-time migration from the old "DevBox Emulator" name
//
// Renaming the app moves its app-data folder, which would otherwise orphan
// every unpacked project — including any backend setup already done inside
// them. Copy the old folder's contents across on first run. Copy rather
// than move, so the old data is still there if anything goes wrong.
// ---------------------------------------------------------------------------
const LEGACY_APP_FOLDER = 'devbox-emulator';

// The webview's storage partition. Electron keeps its data in
// userData/Partitions/<name>, so renaming it would normally throw away
// cookies and localStorage for every app you've been testing — the rename
// below carries that folder across instead.
const APP_PARTITION = 'persist:benchdrop-app';
const LEGACY_PARTITION_DIR = 'devbox-app';
const APP_PARTITION_DIR = 'benchdrop-app';
let migrationNote = null;

function migrateLegacyData() {
  try {
    const oldDir = path.join(app.getPath('appData'), LEGACY_APP_FOLDER);
    const newDir = app.getPath('userData');
    if (!fs.existsSync(oldDir) || path.resolve(oldDir) === path.resolve(newDir)) return;

    // Only migrate into a fresh folder — never overwrite newer work.
    if (fs.existsSync(path.join(newDir, 'projects'))) return;

    fs.mkdirSync(newDir, { recursive: true });
    const carried = [];
    for (const item of ['projects', 'settings.json', 'screenshots', 'node-runtime', 'Partitions']) {
      const from = path.join(oldDir, item);
      const to = path.join(newDir, item);
      if (!fs.existsSync(from) || fs.existsSync(to)) continue;
      fs.cpSync(from, to, { recursive: true });
      carried.push(item);
    }
    if (carried.length) {
      migrationNote =
        `[Benchdrop] Carried your existing ${carried.join(', ')} over from DevBox Emulator, ` +
        'so previously unpacked projects and their setup are still here.\n';
    }
  } catch (err) {
    migrationNote = `[Benchdrop] Couldn't copy data from the old DevBox folder: ${err.message}\n`;
  }
}

// The webview partition was renamed along with the app. Chromium stores it
// by folder name, so move the old folder to the new name and the cookies and
// localStorage of everything you've tested carry over untouched.
function migratePartitionFolder() {
  try {
    const parts = path.join(app.getPath('userData'), 'Partitions');
    const from = path.join(parts, LEGACY_PARTITION_DIR);
    const to = path.join(parts, APP_PARTITION_DIR);
    if (!fs.existsSync(from) || fs.existsSync(to)) return;
    fs.mkdirSync(parts, { recursive: true });
    fs.cpSync(from, to, { recursive: true });
    migrationNote =
      (migrationNote || '') +
      '[Benchdrop] Moved saved site data (cookies, local storage) to the new name.\n';
  } catch (err) {
    // Not fatal: worst case a tested app starts with empty storage.
    migrationNote =
      (migrationNote || '') +
      `[Benchdrop] Couldn't carry over saved site data: ${err.message}\n`;
  }
}

migrateLegacyData();
migratePartitionFolder();

const WORK_ROOT = path.join(app.getPath('userData'), 'projects');
if (!fs.existsSync(WORK_ROOT)) fs.mkdirSync(WORK_ROOT, { recursive: true });

// ---------------------------------------------------------------------------
// Output plumbing
// ---------------------------------------------------------------------------

// Dev servers colorize output. Those escapes both wreck the log pane and can
// land *inside* a detected URL (http://localhost:<esc>[1m5173<esc>[22m/),
// producing an address the webview can't load.
const ANSI_RE = /\u001b\[[0-9;]*[A-Za-z]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;
const stripAnsi = (text) => String(text).replace(ANSI_RE, '');

function sendLog(line, source) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log', { text: stripAnsi(line), source: source || null });
  }
}

function sendStatus(status, extra = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('status', { status, ...extra });
  }
}

function sendProcs() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('procs', runningProcs.map((p) => ({ id: p.id, name: p.name })));
  }
  noteRunning();
}

// --- leftovers from a session that didn't close normally ---------------------
// Windows doesn't end a program's children when it dies, so if Benchdrop is
// ended from Task Manager or crashes, the dev servers it started keep running
// and keep their ports ("Port 5173 busy" next time). What Benchdrop is running
// is noted in running.json; a normal quit removes the note, and the next start
// ends what's left of that session - only processes started after it began,
// either the ones it noted or orphans running from that project's folder.
const SESSION_START = new Date().toISOString();
let lastRunningNote = null;
let quitting = false;
function runningFile() { return path.join(app.getPath('userData'), 'running.json'); }
function noteRunning() {
  if (quitting) return;
  const procs = runningProcs.filter((p) => p.child && p.child.pid).map((p) => ({ pid: p.child.pid, dir: currentProjectDir || '' }));
  const s = typeof nativeSession !== 'undefined' ? nativeSession : null;
  if (s && s.child && s.child.pid && !s.exited) procs.push({ pid: s.child.pid, dir: s.projectDir || '' });
  const text = procs.length ? JSON.stringify({ owner: process.pid, since: SESSION_START, procs }) : '';
  if (text === lastRunningNote) return;
  lastRunningNote = text;
  try {
    if (text) fs.writeFileSync(runningFile(), text);
    else fs.rmSync(runningFile(), { force: true });
  } catch (e) {
    /* best effort */
  }
}

function endLeftovers() {
  if (process.platform !== 'win32') return;
  let note;
  try {
    note = JSON.parse(fs.readFileSync(runningFile(), 'utf8'));
  } catch (e) {
    return;
  }
  if (!note || !Array.isArray(note.procs) || !note.procs.length) return;
  // That Benchdrop may still be running (an unpackaged copy beside an
  // installed one shares this folder): then they're its, not leftovers.
  try {
    process.kill(note.owner, 0);
    return;
  } catch (e) {
    /* gone - carry on */
  }
  try { fs.rmSync(runningFile(), { force: true }); } catch (e) { /* ignore */ }
  const script = [
    '$n = $env:BD_LEFTOVERS | ConvertFrom-Json',
    '$since = ([datetime]$n.since).ToLocalTime()',
    '$all = @(Get-CimInstance Win32_Process)',
    '$alive = @{}; foreach ($p in $all) { $alive[[int]$p.ProcessId] = $p }',
    '$hits = @{}',
    'foreach ($r in $n.procs) { $p = $alive[[int]$r.pid]; if ($p -and $p.CreationDate -ge $since) { $hits[[int]$p.ProcessId] = $p } }',
    '$dirs = @($n.procs | ForEach-Object { ([string]$_.dir) -replace "/", "\\" } | Where-Object { $_ })',
    '$kids = @{}; foreach ($p in $all) { $k = [int]$p.ParentProcessId; if (-not $kids[$k]) { $kids[$k] = @() }; $kids[$k] += $p }',
    'function Uses-Dir($p, $depth) {',
    '  $cl = ([string]$p.CommandLine) -replace "/", "\\"',
    '  foreach ($d in $dirs) { if ($cl.IndexOf($d, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true } }',
    '  if ($depth -lt 6) { foreach ($c in @($kids[[int]$p.ProcessId])) { if ($c -and (Uses-Dir $c ($depth + 1))) { return $true } } }',
    '  return $false',
    '}',
    '# Orphans (their parent is gone) from that session that run from its project folder, or whose children do.',
    'foreach ($p in $all) {',
    '  if ($p.CreationDate -lt $since -or $alive.ContainsKey([int]$p.ParentProcessId)) { continue }',
    '  if (Uses-Dir $p 0) { $hits[[int]$p.ProcessId] = $p }',
    '}',
    'foreach ($p in $hits.Values) { & taskkill.exe /PID $p.ProcessId /T /F | Out-Null; "$($p.ProcessId) $($p.Name)" }',
  ].join('\n');
  const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const child = spawn(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    windowsHide: true, env: { ...process.env, BD_LEFTOVERS: JSON.stringify(note) },
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.on('exit', () => {
    const ended = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (ended.length) {
      sendLog(`[Benchdrop] Benchdrop didn't close normally last time, so ${ended.length === 1 ? 'a process it started was' : ended.length + ' processes it started were'} still running (and holding ${ended.length === 1 ? 'its port' : 'their ports'}). Ended: ${ended.join(', ')}.\n`);
    }
  });
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Right-click menu
//
// Electron windows have no context menu unless you build one. Without this,
// right-clicking anywhere — the app being tested, the log, the command bar —
// does nothing, and copy/paste only works via the keyboard.
//
// The menu is attached to every web view, and each item acts on the exact
// view that was right-clicked (rather than using roles, which target whichever
// view happens to be focused and get this wrong inside a <webview>).
// ---------------------------------------------------------------------------

function buildContextMenu(contents, params) {
  const items = [];
  const flags = params.editFlags || {};
  const add = (item) => items.push(item);
  const sep = () => {
    if (items.length && items[items.length - 1].type !== 'separator') add({ type: 'separator' });
  };

  if (params.linkURL) {
    add({
      label: 'Open link in your browser',
      click: () => shell.openExternal(params.linkURL),
    });
    add({
      label: 'Copy link address',
      click: () => clipboard.writeText(params.linkURL),
    });
    sep();
  }

  if (params.mediaType === 'image') {
    add({
      label: 'Copy image',
      click: () => contents.copyImageAt(params.x, params.y),
    });
    sep();
  }

  if (params.isEditable) {
    add({ label: 'Undo', enabled: !!flags.canUndo, click: () => contents.undo() });
    add({ label: 'Redo', enabled: !!flags.canRedo, click: () => contents.redo() });
    sep();
    add({ label: 'Cut', enabled: !!flags.canCut, click: () => contents.cut() });
    add({ label: 'Copy', enabled: !!flags.canCopy, click: () => contents.copy() });
    add({ label: 'Paste', enabled: !!flags.canPaste, click: () => contents.paste() });
    add({
      label: 'Paste without formatting',
      enabled: !!flags.canPaste,
      click: () => contents.pasteAndMatchStyle(),
    });
    add({ label: 'Select all', click: () => contents.selectAll() });
  } else {
    if (params.selectionText) {
      add({ label: 'Copy', click: () => contents.copy() });
      add({
        label: 'Search the web for this',
        click: () =>
          shell.openExternal(
            `https://www.google.com/search?q=${encodeURIComponent(params.selectionText.slice(0, 300))}`
          ),
      });
      sep();
    }
    add({ label: 'Select all', click: () => contents.selectAll() });
  }

  sep();
  add({ label: 'Reload', click: () => contents.reload() });
  add({
    label: 'Inspect element',
    click: () => {
      contents.inspectElement(params.x, params.y);
      if (contents.isDevToolsOpened()) contents.devToolsWebContents?.focus();
    },
  });

  return Menu.buildFromTemplate(items);
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('context-menu', (_e, params) => {
    try {
      buildContextMenu(contents, params).popup();
    } catch (err) {
      /* a failed menu should never take the app down */
    }
  });
});

// ---------------------------------------------------------------------------
// Trace mode
//
// Normally the log shows what Benchdrop is doing. With trace on it also shows
// what the app being tested is doing: clicks and form input, console output,
// every network request and its result, navigation, and uncaught errors.
//
// Sources:
//   * interactions — a small script injected into the page, reporting through
//     console.debug so it needs no privileged bridge into the page;
//   * console + errors — the guest webContents' own events;
//   * network — the partition's webRequest hooks, which see fetch, XHR and
//     document/asset loads alike without attaching a debugger.
// ---------------------------------------------------------------------------

let traceEnabled = true;   // on by default: the log is more useful with it
let tracedContentsId = null;
let netHooksInstalled = false;
const netStarted = new Map();

const TRACE_MARK = '@@bdtrace@@';

function traceLog(kind, text) {
  if (!traceEnabled) return;
  sendLog(`${text}\n`, kind);
}

function shortUrl(url, max = 96) {
  const clean = String(url).split('?')[0];
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 20)}…${clean.slice(-18)}`;
}

// Injected into the page. Reports interactions through console.debug with a
// marker the main process filters on, so nothing extra is exposed to the page.
const TRACE_INJECT = `(() => {
  if (window.__bdTrace) return 'already';
  window.__bdTrace = true;
  const M = ${JSON.stringify(TRACE_MARK)};
  const say = (t) => { try { console.debug(M + t); } catch (e) {} };

  const FIELD = /^(input|textarea|select)$/;
  const SECRET = /pass|pwd|secret|token|key|auth|card|cvv|ssn|otp|pin/i;

  const describe = (el) => {
    if (!el || !el.tagName) return 'unknown';
    const tag = el.tagName.toLowerCase();
    const id = el.id ? '#' + el.id : '';
    const cls = (typeof el.className === 'string' && el.className.trim())
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
    let label = (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('name')
      || el.getAttribute('placeholder'))) || '';
    // Never fall back to a field's value: that would print whatever was
    // typed, including passwords, straight into the log.
    if (!label && !FIELD.test(tag)) {
      label = (el.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 40);
    }
    return tag + id + cls + (label ? ' "' + label + '"' : '');
  };

  const isSecret = (el) => {
    const t = (el.type || '').toLowerCase();
    if (t === 'password') return true;
    return SECRET.test((el.name || '') + ' ' + (el.id || '') + ' ' + (el.getAttribute('autocomplete') || ''));
  };

  document.addEventListener('click', (e) => {
    const t = e.target.closest('button,a,[role=button],input,select,label,summary') || e.target;
    say('click ' + describe(t));
  }, true);

  document.addEventListener('change', (e) => {
    const t = e.target;
    const kind = (t.type || '').toLowerCase();
    const val = isSecret(t) ? '(hidden)'
      : kind === 'checkbox' || kind === 'radio' ? String(t.checked)
      : String(t.value || '').slice(0, 40);
    say('change ' + describe(t) + ' -> ' + val);
  }, true);

  document.addEventListener('submit', (e) => say('submit ' + describe(e.target)), true);

  window.addEventListener('error', (e) => {
    say('ERROR ' + (e.message || 'script error') + (e.filename ? ' (' + e.filename + ':' + e.lineno + ')' : ''));
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    say('UNHANDLED PROMISE ' + ((r && (r.message || r.toString && r.toString())) || 'rejected'));
  });
  return 'installed';
})()`;

// Electron allows only ONE listener per webRequest event per session - a
// second registration silently replaces the first. So Trace and the
// autotester share these handlers rather than each installing their own.
const ROUTINE_NET = /ERR_ABORTED|ERR_CACHE_MISS/i;
const netObservers = new Set();   // autotest (and anything else) listens here

function installNetworkHooks() {
  if (netHooksInstalled) return;
  const ses = session.fromPartition(APP_PARTITION);

  ses.webRequest.onBeforeRequest((details, cb) => {
    try {
      if (!/^(data|blob):/i.test(details.url)) {
        netStarted.set(details.id, Date.now());
        for (const o of netObservers) o.start && o.start(details);
        if (traceEnabled) traceLog('net', `→ ${details.method} ${shortUrl(details.url)}`);
      }
    } finally {
      cb({});   // must always run, or the request hangs
    }
  });

  ses.webRequest.onCompleted((details) => {
    if (/^(data|blob):/i.test(details.url)) return;
    const started = netStarted.get(details.id);
    netStarted.delete(details.id);
    const ms = started ? Date.now() - started : null;
    for (const o of netObservers) o.done && o.done(details, ms);
    if (!traceEnabled) return;
    const bad = details.statusCode >= 400;
    traceLog('net', `${bad ? '✗' : '←'} ${details.statusCode} ${shortUrl(details.url)} ${ms != null ? ms + 'ms' : ''}`.trim());
  });

  ses.webRequest.onErrorOccurred((details) => {
    if (/^(data|blob):/i.test(details.url)) return;
    netStarted.delete(details.id);
    const routine = ROUTINE_NET.test(details.error || '');
    for (const o of netObservers) o.fail && o.fail(details, routine);
    if (!traceEnabled || routine) return;
    traceLog('net', `✗ failed ${shortUrl(details.url)} — ${details.error}`);
  });

  netHooksInstalled = true;
}

function attachTraceTo(wc) {
  if (!wc || wc.isDestroyed() || wc.__bdTraceAttached) return;
  wc.__bdTraceAttached = true;

  // Electron 35 changed this event's signature; support both shapes.
  wc.on('console-message', (...args) => {
    if (!traceEnabled) return;
    let level, message;
    if (args[1] && typeof args[1] === 'object') {
      level = args[1].level; message = args[1].message;
    } else {
      level = args[1]; message = args[2];
    }
    message = String(message == null ? '' : message);

    if (message.startsWith(TRACE_MARK)) {
      traceLog('app', message.slice(TRACE_MARK.length));
      return;
    }
    const tag = level === 'error' || level === 3 ? 'console error'
      : level === 'warning' || level === 2 ? 'console warn' : 'console';
    traceLog(tag, message.slice(0, 500));
  });

  wc.on('did-navigate', (_e, url) => traceLog('page', `navigated to ${shortUrl(url)}`));
  wc.on('did-navigate-in-page', (_e, url) => traceLog('page', `in-page → ${shortUrl(url)}`));
  wc.on('did-fail-load', (_e, code, desc, url) => {
    if (code === -3) return; // ERR_ABORTED: a reload cancelled the previous load
    traceLog('page', `failed to load ${shortUrl(url)} — ${desc} (${code})`);
  });
  wc.on('render-process-gone', (_e, d) => traceLog('page', `the page crashed (${d.reason})`));
  wc.on('unresponsive', () => traceLog('page', 'the page stopped responding'));
  wc.on('did-finish-load', () => {
    if (traceEnabled) wc.executeJavaScript(TRACE_INJECT, true).catch(() => {});
  });
}

ipcMain.handle('set-trace', async (_e, { enabled, webContentsId, announce }) => {
  const changed = traceEnabled !== !!enabled;
  traceEnabled = !!enabled;
  writeSettings({ trace: traceEnabled });

  if (traceEnabled) installNetworkHooks();

  if (webContentsId != null) {
    tracedContentsId = webContentsId;
    const wc = webContents.fromId(webContentsId);
    if (wc && !wc.isDestroyed()) {
      attachTraceTo(wc);
      if (traceEnabled) {
        try {
          await wc.executeJavaScript(TRACE_INJECT, true);
        } catch (err) {
          sendLog(`[Benchdrop] Couldn't watch this page for clicks: ${err.message}\n`);
        }
      }
    }
  }

  // Re-arming after a page load isn't news; only say something when the
  // setting actually changed or the user pressed the button.
  if (changed || announce) {
    sendLog(
      traceEnabled
        ? '[Benchdrop] Trace on — clicks, console output, network requests and page errors ' +
          'from the app will appear here.\n'
        : '[Benchdrop] Trace off.\n'
    );
  }
  return true;
});

// ---------------------------------------------------------------------------
// Code view
//
// Browse and edit the running project's own source. Everything is scoped to
// the project folder: paths are resolved and checked against it before any
// read or write, so a crafted path can't reach outside. Dependency and build
// folders are skipped — nobody wants to scroll past node_modules.
// ---------------------------------------------------------------------------

const CODE_SKIP_DIRS = new Set([
  'node_modules', '.git', '__pycache__', 'venv', '.venv', 'env', 'dist', 'build',
  '.next', '.cache', 'coverage', 'target', 'bin', 'obj', '.gradle', '.idea', '.vs',
]);
const CODE_MAX_FILES = 3000;
const CODE_MAX_BYTES = 2 * 1024 * 1024; // don't try to open anything huge

// Resolve a project-relative path, refusing anything that escapes the folder.
function safeProjectPath(relative) {
  if (!currentProjectDir) throw new Error('No project is open.');
  const full = path.resolve(currentProjectDir, relative);
  const root = path.resolve(currentProjectDir);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error('That path is outside the project folder.');
  }
  return full;
}

function listProjectFiles(dir) {
  const out = [];
  const walk = (current, depth) => {
    if (out.length >= CODE_MAX_FILES || depth > 8) return;
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (e) {
      return;
    }
    // Folders first, then files, each alphabetically.
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const e of entries) {
      if (out.length >= CODE_MAX_FILES) return;
      const full = path.join(current, e.name);
      if (e.isDirectory()) {
        if (CODE_SKIP_DIRS.has(e.name)) continue;
        walk(full, depth + 1);
      } else {
        let size = 0;
        try {
          size = fs.statSync(full).size;
        } catch (err) {
          continue;
        }
        out.push({
          path: path.relative(dir, full).replace(/\\/g, '/'),
          size,
          tooBig: size > CODE_MAX_BYTES,
        });
      }
    }
  };
  walk(dir, 0);
  return out;
}

function looksBinary(buf) {
  const sample = buf.subarray(0, 8192);
  for (let i = 0; i < sample.length; i++) if (sample[i] === 0) return true;
  return false;
}

ipcMain.handle('code-list', async () => {
  if (!currentProjectDir) return { ok: false, message: 'No project is open.' };
  try {
    return { ok: true, root: currentProjectDir, files: listProjectFiles(currentProjectDir) };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

ipcMain.handle('code-read', async (_e, { path: rel }) => {
  try {
    const full = safeProjectPath(rel);
    const stat = fs.statSync(full);
    if (stat.size > CODE_MAX_BYTES) {
      return { ok: false, message: `That file is ${(stat.size / 1024 / 1024).toFixed(1)} MB — too big to open here.` };
    }
    const buf = fs.readFileSync(full);
    if (looksBinary(buf)) {
      return { ok: false, binary: true, message: 'That looks like a binary file, so there is nothing to edit.' };
    }
    return { ok: true, content: buf.toString('utf8'), size: stat.size };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

ipcMain.handle('code-write', async (_e, { path: rel, content }) => {
  try {
    const full = safeProjectPath(rel);
    fs.writeFileSync(full, content, 'utf8');
    sendLog(`[Benchdrop] Saved ${rel}\n`);
    return { ok: true };
  } catch (err) {
    sendLog(`[Benchdrop] Couldn't save ${rel}: ${err.message}\n`);
    return { ok: false, message: err.message };
  }
});

// Export the project — with your edits — as a zip you can keep or hand back
// to whatever produced it.
ipcMain.handle('code-export', async () => {
  if (!currentProjectDir) return { ok: false, message: 'No project is open.' };
  const base = sanitizeName(path.basename(currentProjectDir)) || 'project';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19).replace('T', '_');

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export project',
    defaultPath: path.join(app.getPath('downloads'), `${base}_${stamp}.zip`),
    filters: [{ name: 'Zip archive', extensions: ['zip'] }],
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };

  try {
    const zip = new AdmZip();
    let count = 0;
    const add = (dir, rel) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          if (CODE_SKIP_DIRS.has(e.name)) continue;
          add(full, r);
        } else {
          if (e.name === '.devbox-extracted') continue;
          zip.addLocalFile(full, rel);
          count++;
        }
      }
    };
    add(currentProjectDir, '');
    zip.writeZip(result.filePath);
    sendLog(`[Benchdrop] Exported ${count} files to ${result.filePath}\n`);
    return { ok: true, file: result.filePath, count };
  } catch (err) {
    sendLog(`[Benchdrop] Export failed: ${err.message}\n`);
    return { ok: false, message: err.message };
  }
});

// ---------------------------------------------------------------------------
// Application menu
//
// Electron's default menu has no place for app settings, so the menu is built
// here: the standard roles, plus View > Appearance for the theme. The choice
// is saved and applied on the next launch.
// ---------------------------------------------------------------------------

function currentTheme() {
  const t = readSettings().theme;
  return t === 'light' ? 'light' : 'dark';
}

function applyTheme(theme) {
  writeSettings({ theme });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('theme', { theme });
  }
  buildAppMenu(); // keep the radio ticks in step
}

// Who makes Benchdrop: the name, notice, license and website, defined once
// here and read everywhere else (the About box, the window title). The
// version comes from package.json through app.getVersion().
const BRAND = {
  name: 'Benchdrop',
  notice: '© 2026 Griffith.Software',
  website: 'https://griffith.software',
  license: 'MIT License',
};

function aboutLine() {
  return `${BRAND.name} ${app.getVersion()} · ${BRAND.notice} · ${BRAND.website}`;
}

function showAbout() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: `About ${BRAND.name}`,
    message: `${BRAND.name} ${app.getVersion()}`,
    detail: `${aboutLine()}\n\n${BRAND.license}. Provided as is, with no promise of support, fixes or new features.`,
    buttons: ['OK', 'Open website'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  }).then(({ response }) => {
    if (response === 1) shell.openExternal(BRAND.website);
  }).catch(() => {});
}

function buildAppMenu() {
  const theme = currentTheme();
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Open project…', accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow && mainWindow.webContents.send('menu', { action: 'open' }) },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { label: 'Edit', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ]},
    {
      label: 'View',
      submenu: [
        {
          label: 'Appearance',
          submenu: [
            { label: 'Dark', type: 'radio', checked: theme === 'dark', click: () => applyTheme('dark') },
            { label: 'Light', type: 'radio', checked: theme === 'light', click: () => applyTheme('light') },
          ],
        },
        { type: 'separator' },
        { label: 'Show log', accelerator: 'CmdOrCtrl+L',
          click: () => mainWindow && mainWindow.webContents.send('menu', { action: 'toggle-log' }) },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }] },
    {
      label: 'Help',
      submenu: [
        { label: 'Project folder', click: () => currentProjectDir && shell.openPath(currentProjectDir) },
        { label: 'Screenshots folder', click: () => shell.openPath(shotsDir()) },
        { label: 'Settings file', click: () => shell.openPath(settingsPath()) },
        { type: 'separator' },
        { label: 'Connect to Claude…', click: () => sendStatus('connect-claude') },
        { type: 'separator' },
        { label: 'Check native program support', click: () => nativeSelfCheck() },
        { type: 'separator' },
        { label: `About ${BRAND.name}`, click: () => showAbout() },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ===========================================================================
// Autotest
//
// Explores the running app the way a tester would - clicking, typing,
// navigating - and logs anything that breaks. The loop:
//
//   perceive  list what's on screen and actionable (reuses Trace's labelling)
//   decide    pick the next action: the first control not yet tried, fields
//             before buttons, stepping back when a screen is exhausted
//   act       dispatch the click / typing into the page
//   verify    console errors, uncaught exceptions, failed requests, crashes
//   log       every step in the log, and a markdown report at the end
//
// Safety: things that look destructive or irreversible - delete, log out,
// pay, send, reset - are skipped unless the user explicitly allows them,
// and links that leave the app are never followed. An autonomous clicker
// pointed at a real app would otherwise happily remove a stored key or
// spend credits.
// ===========================================================================

let autotest = null;

// Before 4.2 Autotest could call Claude with the user's own API key, kept in
// secrets.json. Claude now connects to Benchdrop instead (see "Claude
// connector"), so a key left behind is removed rather than kept in plain text.
function forgetOldApiKey() {
  const file = path.join(app.getPath('userData'), 'secrets.json');
  try {
    const old = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!old || !old.anthropicKey) return;
    delete old.anthropicKey;
    if (Object.keys(old).length) fs.writeFileSync(file, JSON.stringify(old, null, 2), 'utf8');
    else fs.unlinkSync(file);
    migrationNote = (migrationNote || '') + '[Benchdrop] Removed the Anthropic API key saved by an earlier version — Autotest no longer uses one.\n';
  } catch (e) {
    /* no file, nothing to do */
  }
}

// What counts as risky - destructive or irreversible - for Autotest and for
// Claude. A word only counts as the action: the label's first word ("Pay now",
// "Delete all records", "Yes, delete it"), or inside a phrase that can't mean
// anything else ("place order", "close account"). Merely describing something
// ("Jobs & pay rules", "Payment history") isn't risky: that over-caution kept
// Claude out of ordinary settings pages. Programs add Exit, Quit and Format,
// which would end the session or worse.
const RISKY_FIRST = /^(?:(?:yes|ok|okay|confirm|continue)[,:!]?\s+)?(?:delete|remove|destroy|erase|wipe|reset|log ?out|sign ?out|unsubscribe|deactivate|pay|purchase|buy|checkout|check out|send|transfer|revoke|uninstall|drop)\b/i;
const RISKY_PHRASE = /\b(?:clear all|delete (?:all|everything|account|my account)|close (?:my )?account|cancel (?:my )?(?:account|subscription|plan|order)|place (?:the |my )?order|pay now|buy now|log ?out|sign ?out|unsubscribe|factory reset|reset (?:all|everything|password|data)|remove all|erase all|wipe all)\b/i;
const NATIVE_RISKY_FIRST = /^(?:exit|quit|format)\b/i;

function isRiskyLabel(label, native = false) {
  const l = String(label || '').trim().replace(/^[^\p{L}\p{N}]+/u, '');   // leading icons and symbols
  return RISKY_FIRST.test(l) || RISKY_PHRASE.test(l) || (native && NATIVE_RISKY_FIRST.test(l));
}

// Runs in the page. Labels everything actionable, tags each element with a
// data-bd-id so the act step can find it again, and flags anything risky.
const AUTOTEST_SNAPSHOT = `(() => {
  const SECRET = /pass|pwd|secret|token|key|auth|card|cvv|ssn|otp|pin/i;
  const RISKY_FIRST = new RegExp(${JSON.stringify(RISKY_FIRST.source)}, 'i');
  const RISKY_PHRASE = new RegExp(${JSON.stringify(RISKY_PHRASE.source)}, 'i');
  const isRisky = (label) => {
    const l = String(label || '').trim().replace(/^[^\\p{L}\\p{N}]+/u, '');
    return RISKY_FIRST.test(l) || RISKY_PHRASE.test(l);
  };
  const FIELD_TYPES = ['button','submit','reset','checkbox','radio','image','file','hidden','range','color'];
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  };
  const describe = (el) => {
    const tag = el.tagName.toLowerCase();
    let label = el.getAttribute('aria-label') || el.getAttribute('title') || '';
    if (!label && /^(input|textarea|select)$/.test(tag)) {
      label = el.getAttribute('placeholder') || el.getAttribute('name') || '';
      if (!label && el.id) {
        const lab = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (lab) label = lab.innerText;
      }
    }
    if (!label) label = (el.innerText || el.value || '').trim();
    label = String(label).replace(/\\s+/g, ' ').trim().slice(0, 60);
    return label || (el.id ? '#' + el.id : tag);
  };
  const isSecret = (el) => (el.type || '').toLowerCase() === 'password' ||
    SECRET.test((el.name || '') + ' ' + (el.id || '') + ' ' + (el.getAttribute('autocomplete') || ''));

  document.querySelectorAll('[data-bd-id]').forEach((e) => e.removeAttribute('data-bd-id'));
  const sel = 'button, a[href], input, select, textarea, summary, [role=button], [role=link], ' +
              '[role=tab], [role=menuitem], [role=checkbox], [role=switch], [onclick]';
  const els = [...document.querySelectorAll(sel)].filter(visible).slice(0, 120);

  const elements = els.map((el, i) => {
    const id = 'bd' + (i + 1);
    el.setAttribute('data-bd-id', id);
    const tag = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();
    const kind = tag === 'a' ? 'link'
      : tag === 'select' ? 'select'
      : tag === 'textarea' || (tag === 'input' && !FIELD_TYPES.includes(type)) ? 'field'
      : type === 'checkbox' || type === 'radio' || el.getAttribute('role') === 'checkbox' ? 'toggle'
      : type === 'file' ? 'file'
      : 'button';
    const label = describe(el);
    let external = false;
    if (tag === 'a') {
      const href = el.getAttribute('href') || '';
      try {
        const u = new URL(href, location.href);
        external = u.origin !== location.origin || /^(mailto|tel|javascript):/i.test(href);
      } catch (e) { external = true; }
      if (el.getAttribute('target') === '_blank') external = true;
    }
    return {
      id, kind, label,
      disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
      risky: isRisky(label),
      secret: kind === 'field' && isSecret(el),
      external,
      inputType: kind === 'field' ? (tag === 'textarea' ? 'textarea' : type || 'text') : undefined,
    };
  });

  return {
    url: location.pathname + location.search + location.hash,
    title: document.title,
    text: (document.body ? document.body.innerText : '').replace(/\\s+/g, ' ').slice(0, 1200),
    elements,
  };
})()`;

// Runs in the page: perform one action on a tagged element.
function autotestActScript(id, action, value) {
  return `((id, action, value) => {
    const el = document.querySelector('[data-bd-id="' + id + '"]');
    if (!el) return { ok: false, why: 'element is gone' };
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
    if (action === 'type') {
      // Use the native setter so frameworks that track input (React, Vue)
      // see the change the way they would from a real keyboard.
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      el.focus();
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    }
    if (action === 'select') {
      if (el.options && el.options.length > 1) {
        el.selectedIndex = (el.selectedIndex + 1) % el.options.length;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return { ok: true };
    }
    el.click();
    return { ok: true };
  })(${JSON.stringify(id)}, ${JSON.stringify(action)}, ${JSON.stringify(value || '')})`;
}

// Plausible test input for a field, chosen from its type and label.
function sampleInputFor(el) {
  const l = `${el.label} ${el.inputType || ''}`.toLowerCase();
  if (/email/.test(l)) return 'tester@example.com';
  if (/url|link|website/.test(l)) return 'https://example.com';
  if (/phone|tel/.test(l)) return '555-0100';
  if (/number|qty|quantity|amount|age|count/.test(l) || el.inputType === 'number') return '3';
  if (/date/.test(l) || el.inputType === 'date') return '2026-01-15';
  if (/search|filter|find/.test(l)) return 'test';
  if (/name/.test(l)) return 'Test User';
  if (el.inputType === 'textarea') return 'Benchdrop autotest: sample text for this field.';
  return 'Benchdrop test';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shortHash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);

function screenKey(snap) {
  return shortHash(snap.url.split('#')[0] + '|' + snap.elements.map((e) => `${e.kind}:${e.label}`).sort().join('|'));
}
function elementKey(snap, el) {
  return `${snap.url.split('?')[0]}|${el.kind}|${el.label}`;
}

function autotestLog(text) {
  sendLog(`${text}\n`, 'autotest');
}

function recordIssue(at, issue) {
  // One entry per distinct problem - the same failing request on every step
  // is one bug, not forty.
  const sig = `${issue.type}|${issue.message}`.slice(0, 300);
  if (at.issueSigs.has(sig)) return;
  at.issueSigs.add(sig);
  issue.step = at.steps.length;
  issue.url = at.lastUrl;
  issue.path = at.steps.slice(-8).map((s) => s.describe);
  issue.pathTotal = at.steps.length;
  at.issues.push(issue);
  sendLog(`${issue.severity.toUpperCase()} — ${issue.type}: ${issue.message}\n`, 'bug');
  at.pendingShot = true;
}

// Wait for the page to finish reacting: a short pause, then until requests
// quiet down (websockets excluded - they stay open by design).
async function settle(at) {
  if (at.driver.settle) return at.driver.settle(at);
  await sleep(450);
  const t0 = Date.now();
  while (at.inflight.size > 0 && Date.now() - t0 < 4000) await sleep(120);
  await sleep(180);
}

async function captureIssueShot(at) {
  if (!at.pendingShot || at.shots >= 15) return null;
  at.pendingShot = false;
  try {
    const png = await at.driver.screenshot();
    if (!png) return null;
    const file = path.join(shotsDir(), `autotest_${at.stamp}_${String(at.steps.length).padStart(3, '0')}.png`);
    fs.writeFileSync(file, png);
    at.shots++;
    const last = at.issues[at.issues.length - 1];
    if (last && !last.screenshot) last.screenshot = file;
    return file;
  } catch (e) {
    return null;
  }
}

// --- deciding without AI: breadth-first over untried elements ---
function decideDeterministic(at, snap) {
  const usable = snap.elements.filter((e) =>
    !e.disabled && !e.external && e.kind !== 'file' && (at.allowRisky || !e.risky) && !(e.kind === 'field' && e.secret));

  for (const e of snap.elements) {
    if (e.risky && !at.allowRisky && !e.disabled) at.skipped.add(`${e.label} (${snap.url.split('?')[0]})`);
  }

  // Fill fields before pressing buttons, so forms get submitted with data.
  const untried = usable.filter((e) => !at.tried.has(elementKey(snap, e)));
  const pick = untried.find((e) => e.kind === 'field') || untried.find((e) => e.kind !== 'field');
  if (pick) {
    return pick.kind === 'field'
      ? { action: 'type', el: pick, value: sampleInputFor(pick) }
      : pick.kind === 'select'
        ? { action: 'select', el: pick }
        : { action: 'click', el: pick };
  }
  // Nothing new here: step back, or return to where we started.
  if (at.backs < 25 && at.canGoBack) return { action: 'back' };
  if (at.driver.home && snap.url !== at.startPath && !at.returnedHome) return { action: 'home' };
  return { action: 'done', reason: 'every reachable control has been tried' };
}

// --- what Claude may do through the connector ---
// The same rules the explorer follows, enforced here rather than asked of
// the model: anything risky, disabled, external, secret or made up is refused,
// with the reason, whoever asked for it.
function vetChoice(at, snap, req) {
  const action = req && req.action;
  if (action === 'back') return at.canGoBack ? { action: 'back' } : { refused: 'there is nothing to go back to or close here' };
  const el = snap.elements.find((e) => e.id === (req && req.target));
  if (!el) return { refused: `there's no control "${req && req.target}" on this screen — take a new snapshot` };
  if (el.disabled) return { refused: `"${el.label}" is disabled` };
  if (el.external) return { refused: `"${el.label}" leaves the app, and Benchdrop never follows links out of it` };
  if (el.risky && !at.allowRisky) {
    return { refused: `"${el.label}" looks destructive or irreversible, so Benchdrop won't press it for Claude — ask the person to do it themselves` };
  }
  if (el.kind === 'field') {
    if (el.secret) return { refused: `"${el.label}" is a password or secret field, and Benchdrop never types into those for Claude` };
    return { action: 'type', el, value: String(req.value != null && req.value !== '' ? req.value : sampleInputFor(el)).slice(0, 500) };
  }
  if (el.kind === 'select') return { action: 'select', el };
  return { action: 'click', el };
}

function describeAction(a, snap) {
  if (a.action === 'back') return a.native ? 'close the dialog (Esc)' : 'go back';
  if (a.action === 'home') return 'return to the start page';
  if (a.action === 'type') return `type "${a.value}" into ${a.el.kind} "${a.el.label}"`;
  if (a.action === 'select') return `change ${a.el.kind} "${a.el.label}"`;
  return `click ${a.el.kind} "${a.el.label}"` + (snap ? ` on ${snap.url.split('?')[0]}` : '');
}

// --- drivers: what the engine is testing ------------------------------------
// The engine only knows "take a snapshot, do this, go back, take a picture".
// A driver says how, for a web page or for a native program.

function makeWebDriver(wc) {
  let onConsole, onGone, onHang, onFail, observer;
  return {
    kind: 'web',
    startUrl: wc.getURL(),
    alive: () => !wc.isDestroyed(),
    snapshot: () => wc.executeJavaScript(AUTOTEST_SNAPSHOT, true),
    canGoBack: () => (wc.navigationHistory ? wc.navigationHistory.canGoBack() : wc.canGoBack()),
    act: (choice) => wc.executeJavaScript(autotestActScript(choice.el.id, choice.action, choice.value), true),
    back: async () => {
      try { wc.navigationHistory ? wc.navigationHistory.goBack() : wc.goBack(); } catch (e) { /* ignore */ }
    },
    home: async (at) => {
      try { await wc.loadURL(at.startUrl); } catch (e) { /* ignore */ }
    },
    screenshot: async () => (await wc.capturePage()).toPNG(),
    attach(at) {
      onConsole = (...args) => {
        let level, message;
        if (args[1] && typeof args[1] === 'object') { level = args[1].level; message = args[1].message; }
        else { level = args[1]; message = args[2]; }
        message = String(message || '');
        if (message.startsWith(TRACE_MARK)) return;
        if (level === 'error' || level === 3) {
          const uncaught = /^Uncaught/.test(message);
          at.sinceLast.push(`console error: ${message.slice(0, 160)}`);
          recordIssue(at, {
            type: uncaught ? 'uncaught exception' : 'console error',
            severity: uncaught ? 'high' : 'medium',
            message: message.slice(0, 300),
            source: 'detected',
          });
        }
      };
      onGone = (_e, d) => recordIssue(at, { type: 'page crashed', severity: 'critical', message: `renderer gone (${d.reason})`, source: 'detected' });
      onHang = () => recordIssue(at, { type: 'page unresponsive', severity: 'high', message: 'the page stopped responding', source: 'detected' });
      onFail = (_e, code, desc, url) => {
        if (code === -3) return;
        recordIssue(at, { type: 'page failed to load', severity: 'high', message: `${shortUrl(url)} — ${desc} (${code})`, source: 'detected' });
      };
      observer = {
        start: (d) => { if (!/^wss?:/i.test(d.url)) at.inflight.add(d.id); },
        done: (d) => {
          at.inflight.delete(d.id);
          if (/\/favicon\.ico(\?|$)/i.test(d.url)) return;
          if (d.statusCode >= 400) {
            at.sinceLast.push(`${d.statusCode} ${shortUrl(d.url)}`);
            recordIssue(at, {
              type: d.statusCode >= 500 ? 'server error' : 'failed request',
              severity: d.statusCode >= 500 ? 'high' : 'medium',
              message: `${d.method} ${shortUrl(d.url)} → ${d.statusCode}`,
              source: 'detected',
            });
          }
        },
        fail: (d, routine) => {
          at.inflight.delete(d.id);
          if (routine || /^wss?:/i.test(d.url)) return;
          at.sinceLast.push(`failed ${shortUrl(d.url)}`);
          recordIssue(at, { type: 'network failure', severity: 'high', message: `${d.method} ${shortUrl(d.url)} — ${d.error}`, source: 'detected' });
        },
      };
      wc.on('console-message', onConsole);
      wc.on('render-process-gone', onGone);
      wc.on('unresponsive', onHang);
      wc.on('did-fail-load', onFail);
      installNetworkHooks();
      netObservers.add(observer);
    },
    detach() {
      netObservers.delete(observer);
      if (!wc.isDestroyed()) {
        wc.removeListener('console-message', onConsole);
        wc.removeListener('render-process-gone', onGone);
        wc.removeListener('unresponsive', onHang);
        wc.removeListener('did-fail-load', onFail);
      }
    },
  };
}


function makeNativeDriver(s, helper = winHelper) {
  const handlers = {};
  return {
    kind: 'native',
    startUrl: s.exe,
    alive: () => !s.exited,
    async snapshot() {
      const r = await helper.call('snapshot', { pid: s.pid }, 20000);
      if (!r.ok) throw new Error(r.error || 'snapshot failed');
      const wins = r.windows || [];
      // Read any new dialog now, right after the action that opened it,
      // rather than leaving it to the monitor's next poll.
      for (const w of wins) {
        if (s.primaryHwnd && w.hwnd !== s.primaryHwnd) await inspectNewWindow(s, w, helper).catch(() => {});
      }
      // A dialog on top is the screen that matters, so name the screen after it.
      const title = (wins.length > 1 ? wins[wins.length - 1].title : (wins[0] && wins[0].title)) || s.exe;
      return {
        url: title,
        title,
        text: r.text || '',
        windows: wins,
        elements: (r.elements || []).map((e) => ({
          ...e,
          risky: isRiskyLabel(e.label, true),
          external: false,
          inputType: e.kind === 'field' ? 'text' : undefined,
        })),
      };
    },
    canGoBack: (snap) => !!(snap && snap.windows && snap.windows.length > 1),
    act: (choice) => helper.call('act', { pid: s.pid, target: choice.el.id, action: choice.action, value: choice.value || '' }, 10000),
    back: () => helper.call('act', { pid: s.pid, action: 'escape' }, 8000).catch(() => {}),
    home: null,   // a program has no start URL to go back to
    screenshot: async () => (await captureNativeImage(s)).toPNG(),
    settle: async () => { await sleep(900); },
    attach(at) {
      handlers.exit = (info) => {
        if (info.crashed || info.code !== 0) {
          recordIssue(at, {
            type: info.crashed ? 'program crashed' : 'program exited',
            severity: info.crashed ? 'critical' : 'high',
            message: `${s.exe} — ${info.name}${info.hex ? ` (${info.hex})` : ''}${info.meaning ? `: ${info.meaning}` : ''}`,
            source: 'detected',
          });
        }
      };
      handlers.crash = (d) => {
        const last = at.issues[at.issues.length - 1];
        if (last && last.type === 'program crashed') {
          last.message += ` — ${d.module ? 'faulting module ' + d.module : ''}${d.exception ? ' exception ' + d.exception : ''}`;
        }
      };
      handlers.hang = () => recordIssue(at, { type: 'not responding', severity: 'high', message: `${s.exe} stopped responding`, source: 'detected' });
      handlers.dialog = (d) => {
        at.sinceLast.push(`error dialog: ${d.text.slice(0, 120)}`);
        recordIssue(at, { type: 'error dialog', severity: 'high', message: d.text, source: 'detected' });
      };
      handlers.stderr = (line) => recordIssue(at, { type: 'error output', severity: 'medium', message: line, source: 'detected' });
      handlers.net = (ev) => {
        if (ev.kind === 'http' && ev.status >= 400) {
          recordIssue(at, {
            type: ev.status >= 500 ? 'server error' : 'failed request',
            severity: ev.status >= 500 ? 'high' : 'medium',
            message: `${ev.method} ${shortUrl(ev.url)} → ${ev.status}`, source: 'detected',
          });
        } else if (ev.kind === 'fail') {
          recordIssue(at, { type: 'network failure', severity: 'high', message: `${ev.method} ${shortUrl(ev.url)} — ${ev.error}`, source: 'detected' });
        }
      };
      s.events.on('exit', handlers.exit);
      s.events.on('crash-detail', handlers.crash);
      s.events.on('hang', handlers.hang);
      s.events.on('dialog', handlers.dialog);
      s.events.on('stderr-error', handlers.stderr);
      s.events.on('net', handlers.net);
    },
    detach() {
      s.events.removeListener('exit', handlers.exit);
      s.events.removeListener('crash-detail', handlers.crash);
      s.events.removeListener('hang', handlers.hang);
      s.events.removeListener('dialog', handlers.dialog);
      s.events.removeListener('stderr-error', handlers.stderr);
      s.events.removeListener('net', handlers.net);
    },
  };
}

// --- the run ---
async function runAutotest(at) {
  const drv = at.driver;
  drv.attach(at);

  const t0 = Date.now();
  autotestLog(
    'Started — exploring every control' +
    `${drv.kind === 'native' ? ` on the program ${drv.startUrl}` : ''}, ` +
    `up to ${at.maxSteps} steps.` +
    (at.allowRisky ? ' Risky actions ALLOWED.' : ' Risky actions (delete, log out, pay, send…) will be skipped.')
  );

  let reason = 'step limit reached';
  try {
    for (let i = 0; i < at.maxSteps; i++) {
      if (at.stopRequested) { reason = 'stopped'; break; }
      if (!drv.alive()) {
        reason = drv.kind === 'native' ? 'the program closed' : 'the app view closed';
        break;
      }

      let snap;
      try {
        snap = await drv.snapshot();
      } catch (e) {
        if (!drv.alive()) { reason = 'the program closed'; break; }
        recordIssue(at, { type: drv.kind === 'native' ? 'window not readable' : 'page not scriptable', severity: 'medium', message: e.message, source: 'detected' });
        await sleep(600);
        continue;
      }
      at.lastUrl = snap.url;
      at.canGoBack = drv.canGoBack(snap);
      const key = screenKey(snap);
      if (!at.screens.has(key)) {
        at.screens.set(key, { url: snap.url, title: snap.title, controls: snap.elements.length });
        autotestLog(`New screen ${at.screens.size}: ${snap.url} — ${snap.elements.length} controls`);
      }
      await captureIssueShot(at);

      // Decide.
      at.sinceLast = [];
      const choice = decideDeterministic(at, snap);

      if (choice.action === 'done') { reason = choice.reason; break; }

      // Act.
      if (drv.kind === 'native') choice.native = true;
      const describe = describeAction(choice, drv.kind === 'web' ? snap : null);
      at.steps.push({ describe, url: snap.url, at: Date.now() - t0 });
      autotestLog(`Step ${at.steps.length}/${at.maxSteps}: ${describe}${drv.kind === 'native' ? ` in "${snap.url}"` : ''}`);
      sendStatus('autotest-progress', { step: at.steps.length, max: at.maxSteps, issues: at.issues.length });

      if (choice.action === 'back') {
        at.backs++;
        await drv.back(at);
      } else if (choice.action === 'home') {
        at.returnedHome = true;
        if (drv.home) await drv.home(at);
      } else {
        if (choice.el) at.tried.add(elementKey(snap, choice.el));
        const r = await Promise.resolve(drv.act(choice)).catch((e) => ({ ok: false, why: e.message }));
        if (!r || !r.ok) autotestLog(`  (couldn't act: ${r ? (r.why || r.error) : 'no response'})`);
      }
      await settle(at);
    }
  } finally {
    drv.detach();
  }

  at.duration = Date.now() - t0;
  at.reason = reason;
  const report = writeAutotestReport(at);
  const counts = severityCounts(at.issues);
  autotestLog(
    `Finished (${reason}) — ${at.steps.length} steps, ${at.screens.size} screens, ` +
    `${at.issues.length} issue${at.issues.length === 1 ? '' : 's'}` +
    (at.issues.length ? ` (${Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ')})` : '') +
    `. Report: ${report}`
  );
  return report;
}

function severityCounts(issues) {
  const c = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const i of issues) c[i.severity] = (c[i.severity] || 0) + 1;
  return c;
}

function writeAutotestReport(at) {
  const dir = path.join(app.getPath('userData'), 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const name = sanitizeName(path.basename(at.projectDir || 'project'));
  const file = path.join(dir, `${name}_autotest_${at.stamp}.md`);
  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  const issues = [...at.issues].sort((a, b) => order[a.severity] - order[b.severity]);
  const detected = issues.filter((i) => i.source === 'detected');
  const c = severityCounts(issues);
  const L = [];

  L.push(`# Autotest report — ${name}`, '');
  L.push(`- **When:** ${new Date().toLocaleString()}`);
  L.push(`- **${at.driver && at.driver.kind === 'native' ? 'Program' : 'Start'}:** ${at.startUrl}`);
  L.push(`- **Ran for:** ${Math.round(at.duration / 1000)}s, ${at.steps.length} steps, ended because ${at.reason}`);
  L.push(`- **Coverage:** ${at.screens.size} distinct screens, ${at.tried.size} controls exercised`);
  L.push(`- **Issues:** ${issues.length} — ${c.critical} critical, ${c.high} high, ${c.medium} medium, ${c.low} low`, '');

  const section = (title, list, note) => {
    L.push(`## ${title}`, '');
    if (note) L.push(note, '');
    if (!list.length) { L.push('None.', ''); return; }
    list.forEach((i, n) => {
      L.push(`### ${n + 1}. [${i.severity.toUpperCase()}] ${i.type}`, '');
      L.push(`${i.message}`, '');
      L.push(`- **Where:** ${i.url || '(unknown)'} — at step ${i.step}`);
      if (i.path && i.path.length) {
        L.push(`- **Steps leading up to it**${i.pathTotal > i.path.length ? ` (last ${i.path.length} of ${i.pathTotal})` : ''}:`);
        i.path.forEach((p, k) => L.push(`  ${k + 1}. ${p}`));
      }
      if (i.screenshot) L.push(`- **Screenshot:** ${i.screenshot}`);
      L.push('');
    });
  };

  section('Detected problems', detected,
    'Found by the harness itself — console errors, exceptions, failed requests, crashes. These are reliable.');
  L.push('## Screens reached', '');
  for (const s of at.screens.values()) L.push(`- ${s.url}${s.title ? ` — ${s.title}` : ''} (${s.controls} controls)`);
  L.push('');

  if (at.skipped.size) {
    L.push('## Not tested (skipped as risky)', '');
    L.push('These looked destructive or irreversible, so they were left alone. Re-run with risky actions allowed to include them.', '');
    for (const s of at.skipped) L.push(`- ${s}`);
    L.push('');
  }

  L.push('## Every step', '');
  at.steps.forEach((s, n) => L.push(`${n + 1}. ${s.describe}`));
  L.push('');

  fs.writeFileSync(file, L.join('\n'), 'utf8');
  return file;
}

// The state of one test session. Autotest uses it for a whole run; the
// Claude connector makes one per action, to collect what that action caused.
function newTestSession(driver, opts = {}) {
  const at = {
    running: true, stopRequested: false, driver,
    maxSteps: Math.max(5, Math.min(300, Number(opts.maxSteps) || 40)),
    allowRisky: !!opts.allowRisky,
    projectDir: currentProjectDir,
    startUrl: driver.startUrl,
    startPath: '',
    stamp: new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19),
    steps: [], issues: [], issueSigs: new Set(),
    screens: new Map(), tried: new Set(), skipped: new Set(),
    inflight: new Set(), sinceLast: [],
    backs: 0, returnedHome: false, canGoBack: false,
    shots: 0, pendingShot: false,
    lastUrl: '',
  };
  if (driver.kind === 'web') {
    try {
      const u = new URL(at.startUrl);
      at.startPath = u.pathname + u.search + u.hash;
    } catch (e) { /* keep empty */ }
  }
  return at;
}

// What there is to test right now: the native program if one is running,
// otherwise the page in the app view.
function testDriver(opts = {}) {
  if (opts.native) {
    const s = nativeSession;
    if (!s || s.exited || !s.pid) return { message: 'No program is running to test.' };
    if (!winHelper.available()) return { message: 'Testing a native program needs Windows.' };
    if (!s.primaryHwnd) return { message: "The program hasn't opened a window yet — console programs have nothing to click." };
    return { driver: makeNativeDriver(s) };
  }
  const wc = opts.webContentsId != null ? webContents.fromId(opts.webContentsId) : null;
  if (!wc || wc.isDestroyed()) return { message: 'Nothing is running to test — start a project first.' };
  return { driver: makeWebDriver(wc) };
}

// Starts a run; `done` resolves with the report's path (or null).
function startAutotest(opts = {}) {
  if (autotest && autotest.running) return { ok: false, message: 'An autotest is already running.' };
  const { driver, message } = testDriver(opts);
  if (!driver) return { ok: false, message };
  const at = newTestSession(driver, opts);
  autotest = at;
  sendStatus('autotest-started', { maxSteps: at.maxSteps, native: driver.kind === 'native' });
  const done = runAutotest(at)
    .then((report) => {
      sendStatus('autotest-done', {
        report, issues: at.issues.length, steps: at.steps.length,
        screens: at.screens.size, counts: severityCounts(at.issues),
      });
      return report;
    })
    .catch((err) => {
      autotestLog(`Stopped with an error: ${err.message}`);
      sendStatus('autotest-done', { report: null, issues: at.issues.length, error: err.message });
      return null;
    })
    .finally(() => { at.running = false; });
  return { ok: true, at, done };
}

ipcMain.handle('autotest-start', async (_e, opts = {}) => {
  const r = startAutotest(opts);
  return r.ok ? { ok: true } : r;
});

ipcMain.handle('autotest-stop', async () => {
  if (autotest && autotest.running) autotest.stopRequested = true;
  return true;
});

ipcMain.handle('open-path', async (_e, { target }) => {
  if (!target) return false;
  const reports = path.join(app.getPath('userData'), 'reports');
  // Only open files Benchdrop wrote itself.
  if (!path.resolve(target).startsWith(path.resolve(reports))) return false;
  shell.openPath(target);
  return true;
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 860,
    minHeight: 560,
    title: BRAND.name,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (migrationNote) {
    mainWindow.webContents.once('did-finish-load', () => {
      sendLog(migrationNote);
      migrationNote = null;
    });
  }
  mainWindow.on('closed', () => {
    // Benchdrop is closing: wait for the process trees to end (see before-quit).
    stopRunningApp({ wait: true });
    mainWindow = null;
  });
  // A docked program is a window of its own laid over the pane, so it has to
  // follow when Benchdrop's window moves. (Resizes come from the renderer.)
  mainWindow.on('move', () => {
    if (typeof nativeSession !== 'undefined' && nativeSession && nativeSession.docked) moveDocked(nativeSession);
  });
}

// One Benchdrop at a time. A second copy would fight the first over the
// Claude connector (each claims connector.json, so Claude reaches whichever
// started last) and over the fixed port, so opening it again just brings the
// running window forward. Installed app only: development runs (npm start,
// the test harness) have to be able to sit beside an installed copy.
if (app.isPackaged && !app.requestSingleInstanceLock()) {
  app.exit(0);
}
app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(() => {
  traceEnabled = readSettings().trace !== false;
  if (traceEnabled) installNetworkHooks();
  forgetOldApiKey();
  buildAppMenu();
  createWindow();
  startConnector();
  mainWindow.webContents.once('did-finish-load', () => endLeftovers());
  setInterval(noteRunning, 3000).unref();
});
// On quit, wait for each process tree to be ended: the quit doesn't wait for a
// background taskkill, and the dev servers outlived Benchdrop.
app.on('before-quit', () => {
  stopRunningApp({ wait: true });
  quitting = true;
  try { fs.rmSync(runningFile(), { force: true }); } catch (e) { /* ignore */ }
  stopConnector();
  // The Windows helper is a separate process; don't leave it behind.
  if (typeof winHelper !== 'undefined') winHelper.stop();
  if (typeof winMonitor !== 'undefined') winMonitor.stop();
});
app.on('window-all-closed', () => {
  stopRunningApp({ wait: true });
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---------------------------------------------------------------------------
// Node runtime resolution
// ---------------------------------------------------------------------------

const MIN_NODE = { major: 20, minor: 19 };
const FALLBACK_NODE_VERSION = 'v20.19.0';
let resolvedNodePath = null;

function npmCliPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'npm-cli', 'bin', 'npm-cli.js')
    : path.join(__dirname, 'node_modules', 'npm', 'bin', 'npm-cli.js');
}

function nodeRuntimeDir() {
  return path.join(app.getPath('userData'), 'node-runtime');
}

function versionIsNewEnough(versionString) {
  const m = /v?(\d+)\.(\d+)\.(\d+)/.exec(versionString || '');
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (major > MIN_NODE.major) return true;
  if (major < MIN_NODE.major) return false;
  return minor >= MIN_NODE.minor;
}

function probeNodeVersion(nodeExe) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(nodeExe, ['-v'], {
        env: { ...process.env },
        windowsHide: true,
        shell: process.platform === 'win32',
      });
    } catch (e) {
      resolve(null);
      return;
    }
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.on('error', () => resolve(null));
    child.on('exit', () => resolve(out.trim() || null));
    setTimeout(() => {
      try {
        child.kill();
      } catch (e) {
        /* ignore */
      }
      resolve(out.trim() || null);
    }, 10000);
  });
}

function httpsGetFollow(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'BenchdropEmulator' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
          res.resume();
          resolve(httpsGetFollow(new URL(res.headers.location, url).toString(), redirectsLeft - 1));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        resolve(res);
      })
      .on('error', reject);
  });
}

async function pickNodeVersion() {
  try {
    const res = await httpsGetFollow('https://nodejs.org/dist/index.json');
    let raw = '';
    await new Promise((resolve, reject) => {
      res.on('data', (d) => (raw += d.toString()));
      res.on('end', resolve);
      res.on('error', reject);
    });
    const list = JSON.parse(raw);
    const wanted = list.find(
      (e) =>
        e.lts && versionIsNewEnough(e.version) && Array.isArray(e.files) && e.files.includes('win-x64-zip')
    );
    if (wanted) return wanted.version;
  } catch (e) {
    sendLog(`[Benchdrop] (couldn't read the Node.js release index: ${e.message})\n`);
  }
  return FALLBACK_NODE_VERSION;
}

async function httpsGetText(url) {
  const res = await httpsGetFollow(url);
  let raw = '';
  await new Promise((resolve, reject) => {
    res.on('data', (d) => (raw += d.toString()));
    res.on('end', resolve);
    res.on('error', reject);
  });
  return raw;
}

// The hash a SHASUMS256.txt gives for one file name ("<hex>  <name>" lines).
function expectedSha256(shasums, fileName) {
  for (const line of String(shasums).split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(\S+)$/i.exec(line.trim());
    if (m && m[2] === fileName) return m[1].toLowerCase();
  }
  return null;
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

async function downloadNodeRuntime() {
  const version = await pickNodeVersion();
  const base = `node-${version}-win-x64`;
  const url = `https://nodejs.org/dist/${version}/${base}.zip`;
  const destDir = nodeRuntimeDir();
  const zipPath = path.join(destDir, `${base}.zip`);

  fs.mkdirSync(destDir, { recursive: true });
  sendLog(`[Benchdrop] Downloading the Node.js ${version} runtime (one time only)...\n`);

  const res = await httpsGetFollow(url);
  const total = Number(res.headers['content-length'] || 0);
  let received = 0;
  let lastPct = -1;

  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(zipPath);
    res.on('data', (chunk) => {
      received += chunk.length;
      if (total) {
        const pct = Math.floor((received / total) * 100);
        if (pct >= lastPct + 10) {
          lastPct = pct;
          sendLog(`[Benchdrop] ...${pct}%\n`);
        }
      }
    });
    res.pipe(out);
    out.on('finish', () => out.close(resolve));
    out.on('error', reject);
    res.on('error', reject);
  });

  // nodejs.org publishes the SHA-256 of every file it serves. A download that
  // doesn't match - or that the list doesn't mention - is deleted, never run.
  const want = expectedSha256(await httpsGetText(`https://nodejs.org/dist/${version}/SHASUMS256.txt`), `${base}.zip`);
  const got = await sha256File(zipPath);
  if (!want || got !== want) {
    fs.rmSync(zipPath, { force: true });
    throw new Error(want
      ? 'the Node.js download did not match the checksum nodejs.org publishes, so it was deleted and not run'
      : "nodejs.org's checksum list doesn't include this download, so it was deleted and not run");
  }
  sendLog('[Benchdrop] Download verified against nodejs.org\'s published SHA-256.\n');

  sendLog('[Benchdrop] Unpacking the Node.js runtime...\n');
  new AdmZip(zipPath).extractAllTo(destDir, true);
  try {
    fs.rmSync(zipPath, { force: true });
  } catch (e) {
    /* ignore */
  }

  const exe = path.join(destDir, base, process.platform === 'win32' ? 'node.exe' : 'bin/node');
  if (!fs.existsSync(exe)) throw new Error('Node runtime unpacked but node executable not found.');
  if (process.platform !== 'win32') fs.chmodSync(exe, 0o755);
  return exe;
}

function findDownloadedNode() {
  const dir = nodeRuntimeDir();
  if (!fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir)) {
    const exe = path.join(dir, entry, process.platform === 'win32' ? 'node.exe' : 'bin/node');
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}

async function resolveNodeRuntime() {
  if (resolvedNodePath) return resolvedNodePath;
  sendStatus('preparing');

  const downloaded = findDownloadedNode();
  if (downloaded) {
    const v = await probeNodeVersion(downloaded);
    if (v && versionIsNewEnough(v)) {
      sendLog(`[Benchdrop] Using the Node.js runtime Benchdrop downloaded earlier (${v}).\n`);
      resolvedNodePath = downloaded;
      return resolvedNodePath;
    }
  }

  const systemVersion = await probeNodeVersion('node');
  if (systemVersion && versionIsNewEnough(systemVersion)) {
    sendLog(`[Benchdrop] Using the Node.js already installed on this machine (${systemVersion}).\n`);
    resolvedNodePath = 'node';
    return resolvedNodePath;
  }
  if (systemVersion) {
    sendLog(
      `[Benchdrop] Found Node.js ${systemVersion}, but this needs ${MIN_NODE.major}.${MIN_NODE.minor}+. ` +
        'Fetching a newer one just for Benchdrop.\n'
    );
  } else {
    sendLog('[Benchdrop] No Node.js found on this machine — Benchdrop will fetch its own copy.\n');
  }

  resolvedNodePath = await downloadNodeRuntime();
  sendLog('[Benchdrop] Node.js runtime ready.\n');
  return resolvedNodePath;
}

function childEnv(nodeExe, extra = {}) {
  const base = { ...process.env, ...extra };
  delete base.ELECTRON_RUN_AS_NODE;
  if (nodeExe && nodeExe !== 'node') {
    const dir = path.dirname(nodeExe);
    const pathKey = Object.keys(base).find((k) => k.toLowerCase() === 'path') || 'PATH';
    base[pathKey] = `${dir}${path.delimiter}${base[pathKey] || ''}`;
  }
  return base;
}

// ---------------------------------------------------------------------------
// Python runtime resolution
//
// Unlike Node, Benchdrop does NOT auto-download Python. The official Windows
// embeddable build ships without pip and with site-packages disabled, which
// makes dependency installs unreliable — so rather than half-work, Benchdrop
// detects what's installed and tells the user plainly if it isn't there.
// ---------------------------------------------------------------------------

const MIN_PYTHON = { major: 3, minor: 9 };
let resolvedPythonPath = null;

function pythonVersionIsNewEnough(v) {
  const m = /(\d+)\.(\d+)/.exec(v || '');
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (major > MIN_PYTHON.major) return true;
  if (major < MIN_PYTHON.major) return false;
  return minor >= MIN_PYTHON.minor;
}

function probePython(cmd, args = ['--version']) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, {
        env: { ...process.env },
        windowsHide: true,
        shell: process.platform === 'win32',
      });
    } catch (e) {
      resolve(null);
      return;
    }
    let out = '';
    const collect = (d) => (out += d.toString());
    child.stdout.on('data', collect);
    child.stderr.on('data', collect); // older Pythons print version to stderr
    child.on('error', () => resolve(null));
    child.on('exit', () => resolve(out.trim() || null));
    setTimeout(() => {
      try {
        child.kill();
      } catch (e) {
        /* ignore */
      }
      resolve(out.trim() || null);
    }, 8000);
  });
}

// Windows ships a "py" launcher; Linux/mac use python3. Try each in turn.
async function resolvePythonRuntime() {
  if (resolvedPythonPath) return resolvedPythonPath;

  const candidates =
    process.platform === 'win32'
      ? [{ cmd: 'py', args: ['-3', '--version'], run: ['py', '-3'] },
         { cmd: 'python', args: ['--version'], run: ['python'] },
         { cmd: 'python3', args: ['--version'], run: ['python3'] }]
      : [{ cmd: 'python3', args: ['--version'], run: ['python3'] },
         { cmd: 'python', args: ['--version'], run: ['python'] }];

  for (const c of candidates) {
    const out = await probePython(c.cmd, c.args);
    if (out && pythonVersionIsNewEnough(out)) {
      sendLog(`[Benchdrop] Using ${out.trim()} found on this machine.\n`);
      resolvedPythonPath = c.run;
      return resolvedPythonPath;
    }
  }
  return null;
}

function sanitizeName(name) {
  return name.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'project';
}

function stableDirForZip(zipPath) {
  const base = sanitizeName(path.basename(zipPath, path.extname(zipPath)));
  const hash = crypto.createHash('sha1').update(path.resolve(zipPath)).digest('hex').slice(0, 8);
  return path.join(WORK_ROOT, `${base}-${hash}`);
}

function findProjectRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(dir, 'package.json')) || fs.existsSync(path.join(dir, 'index.html'))) {
      return dir;
    }
    const entries = fs.readdirSync(dir).filter((e) => !e.startsWith('.') && !e.startsWith('__MACOSX'));
    const dirsOnly = entries.filter((e) => fs.statSync(path.join(dir, e)).isDirectory());
    if (entries.length === 1 && dirsOnly.length === 1) {
      dir = path.join(dir, dirsOnly[0]);
      continue;
    }
    break;
  }
  return dir;
}

// Extract into the zip's stable folder. If it's already set up, reuse it as
// is — that's what lets a project's own first-run setup (generated code,
// .env.local, node_modules) persist across runs.
function hashFile(filePath) {
  return crypto.createHash('sha1').update(fs.readFileSync(filePath)).digest('hex');
}

function zipShipsNodeModules(zipPath) {
  try {
    return new AdmZip(zipPath)
      .getEntries()
      .some((e) => /(^|\/)node_modules\//.test(e.entryName));
  } catch (e) {
    return false;
  }
}

function stripBundledNodeModules(root) {
  const bundled = path.join(root, 'node_modules');
  if (fs.existsSync(path.join(root, 'package.json')) && fs.existsSync(bundled)) {
    sendLog('[Benchdrop] This zip ships a node_modules folder built elsewhere — removing it.\n');
    try {
      fs.rmSync(bundled, { recursive: true, force: true });
    } catch (e) {
      sendLog(`[Benchdrop] (couldn't fully remove it: ${e.message})\n`);
    }
  }
}

// Each zip maps to a stable folder so a project's own setup survives between
// runs. The folder is keyed by the zip's PATH, but whether it gets re-used is
// decided by the zip's CONTENTS: drop in a rebuilt zip with the same filename
// and Benchdrop unpacks the new code over the old, rather than silently serving
// what it unpacked last time.
function prepareProjectDir(zipPath, { forceFresh = false } = {}) {
  const destDir = stableDirForZip(zipPath);
  const marker = path.join(destDir, '.devbox-extracted');
  const zipHash = hashFile(zipPath);

  if (forceFresh && fs.existsSync(destDir)) {
    sendLog('[Benchdrop] Resetting this project (deleting its folder and starting over)...\n');
    fs.rmSync(destDir, { recursive: true, force: true });
  }

  if (fs.existsSync(marker)) {
    let meta = null;
    try {
      const raw = fs.readFileSync(marker, 'utf8').trim();
      meta = raw.startsWith('{') ? JSON.parse(raw) : { root: raw, zipHash: null };
    } catch (e) {
      meta = null;
    }

    if (meta && meta.root && fs.existsSync(meta.root)) {
      if (meta.zipHash === zipHash) {
        sendLog("[Benchdrop] Same zip as last time — reusing the folder, so earlier setup is kept.\n");
        return { projectDir: meta.root, reused: true, updated: false };
      }

      // Contents differ: unpack the new code over the existing folder.
      // Anything the zip doesn't contain (node_modules, .env.local,
      // generated backend code) is left alone, so setup isn't lost.
      sendLog(
        '[Benchdrop] This zip has changed since last time — unpacking the new version ' +
          'over the existing folder (installed packages and local settings are kept).\n'
      );
      try {
        new AdmZip(zipPath).extractAllTo(destDir, true);
      } catch (err) {
        sendStatus('error', { message: `Couldn't unzip that file: ${err.message}` });
        throw err;
      }
      if (zipShipsNodeModules(zipPath)) stripBundledNodeModules(meta.root);
      fs.writeFileSync(marker, JSON.stringify({ root: meta.root, zipHash }), 'utf8');
      return { projectDir: meta.root, reused: true, updated: true };
    }
  }

  fs.mkdirSync(destDir, { recursive: true });
  new AdmZip(zipPath).extractAllTo(destDir, true);

  let root = destDir;
  const entries = fs.readdirSync(destDir).filter((e) => !e.startsWith('__MACOSX') && e !== '.devbox-extracted');
  if (entries.length === 1 && fs.statSync(path.join(destDir, entries[0])).isDirectory()) {
    root = findProjectRoot(path.join(destDir, entries[0]));
  } else {
    root = findProjectRoot(destDir);
  }

  stripBundledNodeModules(root);

  fs.writeFileSync(marker, JSON.stringify({ root, zipHash }), 'utf8');
  return { projectDir: root, reused: false, updated: false };
}

// Scripts that start a long-running backend/service alongside the app,
// rather than the app itself. Used both for script classification (the
// picker) and URL detection — so a backend's own local address (e.g.
// Convex's http://127.0.0.1:3210) never gets mistaken for the app URL.
const BACKEND_SCRIPT_RE = /convex|server|backend|api|worker|wrangler|supabase|db/i;
function isBackendScriptName(name) {
  return BACKEND_SCRIPT_RE.test(name);
}

// Python web frameworks — if one of these is present, running the project
// should produce a URL we can show, so it's not a CLI-only tool.
const PY_WEB_FRAMEWORKS = [
  'flask', 'fastapi', 'django', 'streamlit', 'gradio', 'uvicorn',
  'starlette', 'bottle', 'tornado', 'dash', 'panel', 'nicegui', 'reflex',
];

function listPythonFiles(projectDir, limit = 200) {
  const found = [];
  const skipDirs = new Set(['node_modules', '.git', '__pycache__', 'venv', '.venv', 'env', 'site-packages']);
  const walk = (dir, depth) => {
    if (depth > 3 || found.length >= limit) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const e of entries) {
      if (found.length >= limit) return;
      if (e.isDirectory()) {
        if (skipDirs.has(e.name) || e.name.startsWith('.')) continue;
        walk(path.join(dir, e.name), depth + 1);
      } else if (e.name.endsWith('.py')) {
        found.push(path.relative(projectDir, path.join(dir, e.name)));
      }
    }
  };
  walk(projectDir, 0);
  return found;
}

function detectPythonProject(projectDir) {
  const pyFiles = listPythonFiles(projectDir);
  const reqPath = path.join(projectDir, 'requirements.txt');
  const pyprojectPath = path.join(projectDir, 'pyproject.toml');
  const hasReq = fs.existsSync(reqPath);
  const hasPyproject = fs.existsSync(pyprojectPath);

  if (!pyFiles.length && !hasReq && !hasPyproject) return null;

  // Look for a web framework in declared dependencies or in imports, to work
  // out whether this project can actually show a UI.
  let haystack = '';
  for (const f of [reqPath, pyprojectPath]) {
    if (fs.existsSync(f)) {
      try {
        haystack += fs.readFileSync(f, 'utf8').toLowerCase();
      } catch (e) {
        /* ignore */
      }
    }
  }
  for (const rel of pyFiles.slice(0, 40)) {
    try {
      haystack += fs.readFileSync(path.join(projectDir, rel), 'utf8').slice(0, 4000).toLowerCase();
    } catch (e) {
      /* ignore */
    }
  }
  const frameworks = PY_WEB_FRAMEWORKS.filter((fw) =>
    new RegExp(`(^|[^a-z])${fw}([^a-z]|$)`).test(haystack)
  );

  // Rank likely entry points: conventional names first, then shallowest path.
  const preferred = ['app.py', 'main.py', 'server.py', 'run.py', 'manage.py', 'streamlit_app.py'];
  const ranked = [...pyFiles].sort((a, b) => {
    const ai = preferred.indexOf(path.basename(a));
    const bi = preferred.indexOf(path.basename(b));
    const aScore = ai === -1 ? 99 : ai;
    const bScore = bi === -1 ? 99 : bi;
    if (aScore !== bScore) return aScore - bScore;
    const aDepth = a.split(/[\\/]/).length;
    const bDepth = b.split(/[\\/]/).length;
    if (aDepth !== bDepth) return aDepth - bDepth;
    return a.localeCompare(b);
  });

  return {
    type: 'python',
    name: path.basename(projectDir),
    pyFiles: ranked,
    entryCandidates: ranked.slice(0, 12),
    hasRequirements: hasReq,
    hasPyproject,
    frameworks,
    servesUI: frameworks.length > 0,
  };
}

// A web entry point doesn't have to be called index.html. Look for any HTML
// file near the top of the project and rank the likeliest candidates.
function findHtmlEntries(projectDir) {
  const found = [];
  const skipDirs = new Set(['node_modules', '.git', '__pycache__', 'venv', '.venv', 'dist', 'build']);
  const walk = (dir, depth) => {
    if (depth > 2 || found.length >= 30) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (skipDirs.has(e.name) || e.name.startsWith('.')) continue;
        walk(path.join(dir, e.name), depth + 1);
      } else if (/\.(html?|md|markdown)$/i.test(e.name)) {
        found.push(path.relative(projectDir, path.join(dir, e.name)).replace(/\\/g, '/'));
      }
    }
  };
  walk(projectDir, 0);

  const preferred = ['index.html', 'app.html', 'main.html', 'home.html'];
  const isMd = (f) => /\.(md|markdown)$/i.test(f);
  return found.sort((a, b) => {
    // A real page beats a README when a project has both.
    if (isMd(a) !== isMd(b)) return isMd(a) ? 1 : -1;
    const ai = preferred.indexOf(path.basename(a).toLowerCase());
    const bi = preferred.indexOf(path.basename(b).toLowerCase());
    const aS = ai === -1 ? 99 : ai;
    const bS = bi === -1 ? 99 : bi;
    if (aS !== bS) return aS - bS;
    const aD = a.split('/').length;
    const bD = b.split('/').length;
    if (aD !== bD) return aD - bD;
    return a.localeCompare(b);
  });
}

// Accept more than zips. A dropped item can be:
//   * a .zip            — unpacked into its own folder (original behaviour)
//   * a single file      — e.g. a standalone .html page or a .py script;
//                          copied into a folder of its own so it can be
//                          served/run like any other project
//   * a folder           — used where it sits, so edits you make in your own
//                          editor show up on reload
const SINGLE_FILE_TYPES = /\.(html?|py|md|txt|json|js|css|svg)$/i;

function prepareFromSingleFile(filePath) {
  const destDir = stableDirForZip(filePath); // same keying scheme: path hash
  const marker = path.join(destDir, '.devbox-extracted');
  const fileHash = hashFile(filePath);
  const target = path.join(destDir, path.basename(filePath));

  let updated = false;
  let reused = false;

  if (fs.existsSync(marker) && fs.existsSync(target)) {
    let meta = null;
    try {
      const raw = fs.readFileSync(marker, 'utf8').trim();
      meta = raw.startsWith('{') ? JSON.parse(raw) : null;
    } catch (e) {
      meta = null;
    }
    reused = true;
    if (!meta || meta.zipHash !== fileHash) {
      sendLog('[Benchdrop] This file has changed since last time — copying the new version in.\n');
      fs.copyFileSync(filePath, target);
      updated = true;
    } else {
      sendLog('[Benchdrop] Same file as last time — reusing its folder.\n');
    }
  } else {
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(filePath, target);
  }

  fs.writeFileSync(marker, JSON.stringify({ root: destDir, zipHash: fileHash }), 'utf8');
  return { projectDir: destDir, reused, updated };
}

function prepareProjectFromPath(inputPath, { forceFresh = false } = {}) {
  const stat = fs.statSync(inputPath);

  if (stat.isDirectory()) {
    sendLog(
      '[Benchdrop] Opening this folder where it is, so anything you change in your own ' +
        'editor shows up when you reload.\n'
    );
    return { projectDir: findProjectRoot(inputPath), reused: false, updated: false, inPlace: true };
  }

  if (/\.zip$/i.test(inputPath)) {
    return prepareProjectDir(inputPath, { forceFresh });
  }

  // A program runs where it is: copying it elsewhere would separate it from
  // the DLLs, config and data files it expects to find beside it.
  if (/\.exe$/i.test(inputPath)) {
    sendLog('[Benchdrop] Running this program where it is, so the files beside it are found.\n');
    return {
      projectDir: path.dirname(inputPath), reused: false, updated: false,
      inPlace: true, exe: path.basename(inputPath),
    };
  }

  if (SINGLE_FILE_TYPES.test(inputPath)) {
    return prepareFromSingleFile(inputPath);
  }

  throw new Error(
    `Benchdrop doesn't know what to do with "${path.basename(inputPath)}". ` +
      'Drop a .zip, a folder, a program (.exe), or a single .html, .py or .md file — or paste a GitHub link.'
  );
}

// ---------------------------------------------------------------------------
// Other language runtimes
//
// Node and Python have bespoke handling above. Everything else is described
// declaratively here: how to recognise the project, how to check whether the
// runtime is installed, and what commands will start it. Adding a language
// means adding an entry, not new plumbing.
//
// Benchdrop never installs these runtimes — unlike Node, there's no
// single official portable build to fetch for most of them, and quietly
// installing a language toolchain isn't something a test tool should do
// behind your back. It detects what's there and says plainly what's missing.
// ---------------------------------------------------------------------------

const has = (dir, ...names) => names.some((n) => fs.existsSync(path.join(dir, n)));

function filesWithExt(dir, re, limit = 40) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && re.test(e.name))
      .slice(0, limit)
      .map((e) => e.name);
  } catch (e) {
    return [];
  }
}

const RUNTIMES = [
  {
    id: 'php',
    label: 'PHP',
    installUrl: 'https://www.php.net/downloads',
    probe: ['php', ['--version']],
    detect: (d) => has(d, 'composer.json', 'index.php', 'artisan') || filesWithExt(d, /\.php$/i).length > 0,
    commands: (d) => {
      const list = [];
      if (has(d, 'artisan')) {
        list.push({ label: 'Laravel dev server', cmd: 'php artisan serve --port={port}', servesAt: true });
      }
      const root = has(d, 'public') ? '-t public' : '-t .';
      list.push({ label: 'PHP built-in server', cmd: `php -S localhost:{port} ${root}`, servesAt: true });
      if (has(d, 'composer.json')) {
        list.push({ label: 'Install dependencies (composer install)', cmd: 'composer install', oneShot: true });
      }
      return list;
    },
  },
  {
    id: 'go',
    label: 'Go',
    installUrl: 'https://go.dev/dl/',
    probe: ['go', ['version']],
    detect: (d) => has(d, 'go.mod', 'main.go'),
    commands: () => [
      { label: 'go run .', cmd: 'go run .' },
      { label: 'go test ./...', cmd: 'go test ./...', oneShot: true },
    ],
  },
  {
    id: 'rust',
    label: 'Rust',
    installUrl: 'https://www.rust-lang.org/tools/install',
    probe: ['cargo', ['--version']],
    detect: (d) => has(d, 'Cargo.toml'),
    commands: () => [
      { label: 'cargo run', cmd: 'cargo run' },
      { label: 'cargo test', cmd: 'cargo test', oneShot: true },
    ],
  },
  {
    id: 'ruby',
    label: 'Ruby',
    installUrl: 'https://www.ruby-lang.org/en/downloads/',
    probe: ['ruby', ['-v']],
    detect: (d) => has(d, 'Gemfile', 'config.ru') || filesWithExt(d, /\.rb$/i).length > 0,
    commands: (d) => {
      const list = [];
      if (has(d, 'bin/rails') || has(d, 'config', 'application.rb')) {
        list.push({ label: 'Rails server', cmd: 'bundle exec rails server -p {port}', servesAt: true });
      }
      if (has(d, 'config.ru')) {
        list.push({ label: 'Rack server', cmd: 'bundle exec rackup -p {port}', servesAt: true });
      }
      for (const f of filesWithExt(d, /\.rb$/i, 6)) {
        list.push({ label: `ruby ${f}`, cmd: `ruby ${f}` });
      }
      if (has(d, 'Gemfile')) {
        list.push({ label: 'Install gems (bundle install)', cmd: 'bundle install', oneShot: true });
      }
      return list;
    },
  },
  {
    id: 'dotnet',
    label: '.NET',
    installUrl: 'https://dotnet.microsoft.com/download',
    probe: ['dotnet', ['--version']],
    detect: (d) => filesWithExt(d, /\.(csproj|fsproj|sln)$/i).length > 0,
    commands: () => [
      { label: 'dotnet run', cmd: 'dotnet run' },
      { label: 'dotnet build', cmd: 'dotnet build', oneShot: true },
    ],
  },
  {
    id: 'java',
    label: 'Java',
    installUrl: 'https://adoptium.net/',
    probe: ['java', ['-version']],
    detect: (d) =>
      has(d, 'pom.xml', 'build.gradle', 'build.gradle.kts') || filesWithExt(d, /\.jar$/i).length > 0,
    commands: (d) => {
      const list = [];
      if (has(d, 'pom.xml')) list.push({ label: 'Maven (spring-boot:run)', cmd: 'mvn spring-boot:run' });
      if (has(d, 'gradlew.bat') || has(d, 'gradlew')) {
        list.push({
          label: 'Gradle (bootRun)',
          cmd: process.platform === 'win32' ? 'gradlew.bat bootRun' : './gradlew bootRun',
        });
      }
      for (const f of filesWithExt(d, /\.jar$/i, 4)) {
        list.push({ label: `java -jar ${f}`, cmd: `java -jar ${f}` });
      }
      return list;
    },
  },
];

function probeRuntimeVersion(cmd, args) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, {
        env: { ...process.env },
        windowsHide: true,
        shell: process.platform === 'win32',
      });
    } catch (e) {
      resolve(null);
      return;
    }
    let out = '';
    const collect = (d) => (out += d.toString());
    child.stdout.on('data', collect);
    child.stderr.on('data', collect); // java -version prints to stderr
    child.on('error', () => resolve(null));
    child.on('exit', (code) => resolve(code === 0 && out.trim() ? out.trim().split('\n')[0] : null));
    setTimeout(() => {
      try {
        child.kill();
      } catch (e) {
        /* ignore */
      }
      resolve(out.trim() ? out.trim().split('\n')[0] : null);
    }, 8000);
  });
}

function detectRuntimeProject(projectDir) {
  for (const rt of RUNTIMES) {
    let hit = false;
    try {
      hit = rt.detect(projectDir);
    } catch (e) {
      hit = false;
    }
    if (!hit) continue;
    const commands = rt.commands(projectDir).filter(Boolean);
    if (!commands.length) continue;
    return {
      type: 'runtime',
      name: path.basename(projectDir),
      runtimeId: rt.id,
      runtimeLabel: rt.label,
      installUrl: rt.installUrl,
      commands,
    };
  }
  return null;
}

function detectProject(projectDir) {
  const pkgPath = path.join(projectDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    let pkg = {};
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch (e) {
      /* empty pkg */
    }
    const scripts = pkg.scripts || {};
    const names = Object.keys(scripts);
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

    // Scripts that start a long-running backend/service alongside the app.
    const backendScripts = names.filter(isBackendScriptName);
    // Only the single best frontend script — ticking both "dev" and
    // "preview" would start two competing servers.
    const frontendOrder = ['dev', 'start', 'serve', 'preview'];
    const bestFrontend = frontendOrder.find((s) => scripts[s] && !backendScripts.includes(s));
    const frontend = bestFrontend ? [bestFrontend] : [];

    // Does this project appear to need a backend that isn't configured yet?
    const setupNotes = [];
    if (deps.convex && fs.existsSync(path.join(projectDir, 'convex'))) {
      const hasEnvLocal = fs.existsSync(path.join(projectDir, '.env.local'));
      if (!hasEnvLocal) {
        setupNotes.push(
          'This project uses Convex for its backend, and it has not been set up yet. ' +
            'Run the backend script together with the app — it will ask you to sign in ' +
            'to your own Convex account the first time, then create the database it needs.'
        );
      }
    }

    const suggested = [...backendScripts, ...frontend];
    return {
      type: 'node',
      name: pkg.name || path.basename(projectDir),
      scripts,
      allScripts: names,
      backendScripts,
      suggestedScripts: suggested.length ? suggested : names,
      setupNotes,
    };
  }
  const htmlEntries = findHtmlEntries(projectDir);
  const py = detectPythonProject(projectDir);

  // PHP / Go / Rust / Ruby / .NET / Java. Checked before the static and
  // Python branches: a project with a real runtime behind it should run,
  // not just have one of its pages served.
  const runtime = detectRuntimeProject(projectDir);
  if (runtime) {
    runtime.htmlEntries = htmlEntries;
    return runtime;
  }

  // A program sitting at the top of the folder is almost certainly the point
  // of the folder, even if there's a readme page beside it.
  const exes = findExes(projectDir);
  if (exes.some((e) => !e.includes('/'))) {
    return { type: 'native', name: path.basename(projectDir), exes, htmlEntries };
  }

  // Both a web page and Python scripts? Offer both rather than guessing —
  // e.g. a CLI tool that also ships a standalone browser version.
  if (htmlEntries.length && py) {
    return {
      type: 'mixed',
      name: path.basename(projectDir),
      htmlEntries,
      python: py,
    };
  }

  if (htmlEntries.length) {
    return { type: 'static', name: path.basename(projectDir), htmlEntries };
  }

  if (py) return py;

  // Programs only in build-output folders (bin/Release and friends).
  if (exes.length) {
    return { type: 'native', name: path.basename(projectDir), exes, htmlEntries };
  }

  // Nothing runnable found — describe what IS in the folder, so the message
  // says what this looks like rather than only what's missing.
  let topLevel = [];
  try {
    topLevel = fs
      .readdirSync(projectDir, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('.'))
      .slice(0, 12)
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
  } catch (e) {
    /* ignore */
  }
  return { type: 'unknown', name: path.basename(projectDir), topLevel };
}

// ---------------------------------------------------------------------------
// URL detection
// ---------------------------------------------------------------------------

function findServedUrl(text) {
  const clean = stripAnsi(text);
  const m = clean.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?[^\s'"<>]*/i);
  if (!m) return null;
  return m[0].replace('0.0.0.0', 'localhost');
}

// A sign-in / device-authorization link a CLI wants the user to open in a
// real browser (Convex, Vercel, Cloudflare, GitHub device flow, etc.).
function findAuthUrl(text) {
  const clean = stripAnsi(text);
  const matches = clean.match(/https?:\/\/[^\s'"<>]+/gi) || [];
  for (const url of matches) {
    if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(url)) continue;
    if (/(login|auth|signin|sign-in|device|verify|activate|oauth)/i.test(url)) return url;
  }
  return null;
}

const NATIVE_BINDING_FAILURE_RE =
  /(Cannot find native binding|npm\/cli\/issues\/4828|Cannot find module ['"][^'"]*\.node['"]|Cannot find module ['"]@[\w.-]+\/[\w-]*binding[\w-]*['"])/i;

// Errors that mean "a one-time setup command was never run". When we spot
// one we surface the fix as a suggestion — we never run it automatically,
// since these commands change the user's own cloud deployment.
const SETUP_HINTS = [
  {
    match: /Missing environment variable ['"`]?JWT_PRIVATE_KEY/i,
    command: 'npx @convex-dev/auth --skip-git-check',
    reason:
      'This project signs in with @convex-dev/auth, which needs a signing keypair ' +
      '(JWT_PRIVATE_KEY and JWKS) set on your Convex deployment. That is a one-time ' +
      'setup step the project never ran.',
  },
];

function findSetupHint(text) {
  return SETUP_HINTS.find((h) => h.match.test(text)) || null;
}

// "Something else is already on that port" — almost always a leftover dev
// server from a previous run that outlived its parent.
const PORT_CONFLICT_RES = [
  /local backend is still running on port (\d+)/i,
  /EADDRINUSE[^\n]*?:(\d+)/i,
  /address already in use[^\n]*?:(\d+)/i,
  /port (\d+) is already in use/i,
  // Projects often say this in their own words rather than letting the
  // socket error through, so match the common phrasings too.
  /(?:is )?answering on port (\d+)/i,
  /already running on port (\d+)/i,
  /port (\d+)[^\n]{0,30}\b(?:in use|taken|occupied|busy|unavailable)\b/i,
  /listen tcp[^\n]*?:(\d+): bind/i,
  /only one usage of each socket address[^\n]*?:(\d+)/i,
];

function findPortConflict(text) {
  for (const re of PORT_CONFLICT_RES) {
    const m = re.exec(text);
    if (m) return Number(m[1]);
  }
  return null;
}

// Find the PIDs listening on a port, so we can offer to free it.
function findPidsOnPort(port) {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const cmd = isWin
      ? `netstat -ano | findstr LISTENING | findstr :${port}`
      : `lsof -ti tcp:${port} -sTCP:LISTEN`;
    const child = spawn(cmd, { shell: true, windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.on('error', () => resolve([]));
    child.on('exit', () => {
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (isWin) {
          const parts = trimmed.split(/\s+/);
          const pid = Number(parts[parts.length - 1]);
          if (pid > 0) pids.add(pid);
        } else {
          const pid = Number(trimmed);
          if (pid > 0) pids.add(pid);
        }
      }
      resolve([...pids].filter((pid) => pid !== process.pid));
    });
    setTimeout(() => resolve([]), 8000);
  });
}

// ---------------------------------------------------------------------------
// Static server (zips that are just HTML/CSS/JS)
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html', '.htm': 'text/html', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain',
};

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

// A stable port matters once a project talks to an API that allow-lists an
// origin or redirect URI — a port that changes every run breaks that every
// session. Benchdrop tries this port first and only falls back if it's taken.
const PREFERRED_PORT = 5599;

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch (e) {
    return {};
  }
}

function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8');
  } catch (e) {
    sendLog(`[Benchdrop] Couldn't save settings: ${e.message}\n`);
  }
  return next;
}

function portIsFree(port) {
  return new Promise((resolve) => {
    const srv = http.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

// Resolve the port to serve on: the fixed one when enabled and available,
// otherwise any free port.
async function resolveServePort() {
  const settings = readSettings();
  const useFixed = settings.fixedPort !== false; // default on
  const wanted = Number(settings.port) || PREFERRED_PORT;

  if (useFixed) {
    if (await portIsFree(wanted)) return wanted;
    sendLog(
      `[Benchdrop] Port ${wanted} is in use, so this run gets a random one instead. ` +
        'If an API needs a fixed address, free that port and reload.\n'
    );
  }
  return getFreePort();
}

// Markdown gets rendered to a readable page rather than served as raw text.
// This is a small, deliberately limited renderer — enough for notes, plans
// and READMEs, not a full CommonMark implementation.
function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMarkdown(src, title) {
  const lines = src.split(/\r?\n/);
  const out = [];
  let inCode = false;
  let listType = null;

  const closeList = () => {
    if (listType) {
      out.push(listType === 'ul' ? '</ul>' : '</ol>');
      listType = null;
    }
  };

  const inline = (t) => {
    let s = escapeHtml(t);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
    s = s.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2">$2</a>');
    return s;
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');

    const fence = /^```/.test(line);
    if (fence) {
      closeList();
      out.push(inCode ? '</code></pre>' : '<pre><code>');
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(escapeHtml(raw));
      continue;
    }

    if (!line.trim()) {
      closeList();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^(\s*)([-*+])\s+/.test(line)) {
      if (listType !== 'ul') {
        closeList();
        out.push('<ul>');
        listType = 'ul';
      }
      out.push(`<li>${inline(line.replace(/^(\s*)([-*+])\s+/, ''))}</li>`);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      if (listType !== 'ol') {
        closeList();
        out.push('<ol>');
        listType = 'ol';
      }
      out.push(`<li>${inline(line.replace(/^\s*\d+[.)]\s+/, ''))}</li>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      closeList();
      out.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      closeList();
      out.push('<hr/>');
      continue;
    }

    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  if (inCode) out.push('</code></pre>');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#14161a; color:#dbe2ea;
         font: 16px/1.65 -apple-system, "Segoe UI", Roboto, sans-serif; }
  .page { max-width: 820px; margin: 0 auto; padding: 48px 28px 96px; }
  h1,h2,h3,h4 { color:#fff; line-height:1.25; margin:1.8em 0 .6em; }
  h1 { font-size:2em; margin-top:0; border-bottom:1px solid #2a2e37; padding-bottom:.3em; }
  h2 { font-size:1.45em; border-bottom:1px solid #22262f; padding-bottom:.25em; }
  h3 { font-size:1.18em; }
  p { margin:.9em 0; }
  a { color:#7dd3fc; }
  code { background:#1c1f26; border:1px solid #2a2e37; border-radius:4px;
         padding:.12em .38em; font-family:ui-monospace,Consolas,monospace; font-size:.9em; }
  pre { background:#11141a; border:1px solid #2a2e37; border-radius:8px;
        padding:14px 16px; overflow:auto; }
  pre code { background:none; border:none; padding:0; }
  blockquote { margin:1em 0; padding:.4em 1em; border-left:3px solid #7dd3fc;
               background:#181b21; color:#b7c0cc; }
  ul,ol { padding-left:1.5em; }
  li { margin:.35em 0; }
  hr { border:none; border-top:1px solid #2a2e37; margin:2em 0; }
</style></head>
<body><div class="page">${out.join('\n')}</div></body></html>`;
}

// ---------------------------------------------------------------------------
// Live reload
//
// Watches the project folder and refreshes the app pane when a file changes,
// so editing in your own editor shows up without clicking Reload. Build
// output and dependency folders are ignored, and changes are debounced so a
// save that touches several files causes one refresh, not five.
// ---------------------------------------------------------------------------

const WATCH_IGNORE = /(^|[\\/])(node_modules|\.git|__pycache__|venv|\.venv|dist|build|\.next|\.cache|coverage)([\\/]|$)/i;
const WATCH_IGNORE_FILES = /(^|[\\/])(\.devbox-extracted|\.DS_Store|[^\\/]*\.(log|tmp|swp|swx)|~[^\\/]*|\d+)$/i;
const WATCH_DEBOUNCE_MS = 260;

let watcher = null;
let watchTimer = null;
let currentProjectType = null;

function liveReloadEnabled() {
  return readSettings().liveReload !== false; // default on
}

function stopWatching() {
  if (watchTimer) {
    clearTimeout(watchTimer);
    watchTimer = null;
  }
  if (watcher) {
    try {
      watcher.close();
    } catch (e) {
      /* ignore */
    }
    watcher = null;
  }
}

function startWatching(projectDir) {
  stopWatching();
  if (!projectDir || !liveReloadEnabled()) return;

  const onChange = (eventType, filename) => {
    if (!filename) return;
    const rel = String(filename);
    if (WATCH_IGNORE.test(rel) || WATCH_IGNORE_FILES.test(rel)) return;

    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => {
      // A Node project's own dev server (Vite and friends) already pushes
      // updates and usually keeps app state; forcing a reload on top of that
      // would just throw that state away. Say something instead of acting.
      if (currentProjectType === 'node') {
        sendLog(`[Benchdrop] ${rel} changed — your dev server handles reloading.\n`);
        return;
      }
      sendLog(`[Benchdrop] ${rel} changed — reloading.\n`);
      sendStatus('reload-app', { file: rel });
    }, WATCH_DEBOUNCE_MS);
  };

  try {
    // Recursive watching is supported on Windows and macOS.
    watcher = fs.watch(projectDir, { recursive: true }, onChange);
    sendLog('[Benchdrop] Watching this project for changes — edits will reload the page.\n');
  } catch (err) {
    try {
      // Fall back to watching just the top folder rather than giving up.
      watcher = fs.watch(projectDir, onChange);
      sendLog(
        '[Benchdrop] Watching the top level of this project for changes ' +
          '(recursive watching is unavailable here).\n'
      );
    } catch (err2) {
      sendLog(`[Benchdrop] Couldn't watch this project for changes: ${err2.message}\n`);
    }
  }
}

// ---------------------------------------------------------------------------
// Phone preview (HTTPS over the local network)
//
// Two things are needed to test on a real phone:
//   * an address the phone can reach — Benchdrop serves on localhost, so we
//     need to listen on the machine's LAN address too;
//   * HTTPS — geolocation, camera and service workers only work in a secure
//     context, and unlike localhost, a plain http:// LAN address is not one.
//     That's the difference between being able to test ClockRoute's GPS on a
//     phone and not.
//
// Rather than re-implementing serving for every project type, this listens
// over HTTPS and proxies straight through to whatever is already running in
// the app pane, so it works the same for a static page, a Vite dev server or
// a Python app. WebSocket upgrades are proxied too, so hot reload survives.
// The certificate is self-signed, which means the phone shows a warning the
// first time; that's expected and explained in the UI.
// ---------------------------------------------------------------------------

const selfsigned = require('selfsigned');
const QRCode = require('qrcode');
const net = require('net');

const PHONE_PORT_OFFSET = 1; // e.g. app on 5599 -> phone preview on 5600

let phoneServer = null;
let phoneUrl = null;

function getLanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces || {})) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal) continue;
      // Skip virtual adapters that a phone can't reach.
      if (/^(vEthernet|VirtualBox|VMware|Loopback|Hyper-V|docker|br-|veth)/i.test(name)) continue;
      out.push({ name, address: a.address });
    }
  }
  // Prefer typical home-network ranges.
  out.sort((a, b) => {
    const score = (ip) => (/^192\.168\./.test(ip) ? 0 : /^10\./.test(ip) ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
    return score(a.address) - score(b.address);
  });
  return out;
}

function certPaths() {
  const dir = path.join(app.getPath('userData'), 'certs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return { dir, cert: path.join(dir, 'cert.pem'), key: path.join(dir, 'key.pem'), meta: path.join(dir, 'cert.json') };
}

// The certificate must name the exact IP the phone connects to, so it's
// regenerated whenever the machine's LAN address changes.
async function ensureCertificate(ips) {
  const p = certPaths();
  const wanted = [...ips].sort().join(',');

  if (fs.existsSync(p.cert) && fs.existsSync(p.key) && fs.existsSync(p.meta)) {
    try {
      const meta = JSON.parse(fs.readFileSync(p.meta, 'utf8'));
      if (meta.ips === wanted && new Date(meta.expires) > new Date()) {
        return { cert: fs.readFileSync(p.cert, 'utf8'), key: fs.readFileSync(p.key, 'utf8') };
      }
    } catch (e) {
      /* regenerate below */
    }
  }

  sendLog('[Benchdrop] Creating a certificate for this machine (one time)...\n');
  const altNames = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
    ...ips.map((ip) => ({ type: 7, ip })),
  ];
  const days = 825;
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'Benchdrop' }], {
    days,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames }],
  });

  fs.writeFileSync(p.cert, pems.cert, 'utf8');
  fs.writeFileSync(p.key, pems.private, 'utf8');
  fs.writeFileSync(
    p.meta,
    JSON.stringify({ ips: wanted, expires: new Date(Date.now() + days * 864e5).toISOString() }),
    'utf8'
  );
  return { cert: pems.cert, key: pems.private };
}

function stopPhonePreview() {
  deviceLabels.clear();
  if (phoneServer) {
    try {
      phoneServer.close();
    } catch (e) {
      /* ignore */
    }
    phoneServer = null;
  }
  phoneUrl = null;
}

async function startPhonePreview(targetUrl) {
  stopPhonePreview();

  const ips = getLanAddresses();
  if (!ips.length) {
    return { ok: false, message: 'No network connection found — this machine has no LAN address, so a phone has nothing to connect to.' };
  }

  let target;
  try {
    target = new URL(targetUrl);
  } catch (e) {
    return { ok: false, message: 'Nothing is running to share yet — load a project first.' };
  }

  const { cert, key } = await ensureCertificate(ips.map((i) => i.address));
  const basePort = Number(target.port) || 80;
  let port = basePort + PHONE_PORT_OFFSET;
  if (!(await portIsFree(port))) port = await getFreePort();

  const proxyRequest = (req, res) => {
    const who = deviceLabel(req);

    // Reports coming back from the phone. Handled here rather than forwarded,
    // so the project never sees them.
    if (req.url.startsWith('/__benchdrop/trace')) {
      let body = '';
      req.on('data', (c) => {
        body += c;
        if (body.length > 200000) req.destroy();  // don't let a page flood us
      });
      req.on('end', () => {
        try {
          for (const ev of JSON.parse(body || '[]')) {
            traceLog(`${ev.kind || 'app'} · ${who}`, ev.text);
          }
        } catch (e) {
          /* malformed batch: ignore */
        }
        res.writeHead(204);
        res.end();
      });
      return;
    }

    const started = Date.now();
    const headers = { ...req.headers, host: target.host };
    // Ask upstream not to compress: the HTML has to be readable to inject
    // the trace client into it.
    if (traceEnabled) headers['accept-encoding'] = 'identity';

    const upstream = http.request(
      { hostname: target.hostname, port: target.port, path: req.url, method: req.method, headers },
      (up) => {
        const type = String(up.headers['content-type'] || '');
        const isHtml = /text\/html/i.test(type);

        if (traceEnabled) {
          const bad = (up.statusCode || 0) >= 400;
          traceLog(`net · ${who}`,
            `${bad ? '✗' : '←'} ${up.statusCode} ${shortUrl(req.url)} ${Date.now() - started}ms`);
        }

        if (!traceEnabled || !isHtml) {
          res.writeHead(up.statusCode || 502, up.headers);
          up.pipe(res);
          return;
        }

        // Buffer the page so the client script can be added to it.
        const chunks = [];
        up.on('data', (c) => chunks.push(c));
        up.on('end', () => {
          let html = Buffer.concat(chunks).toString('utf8');
          if (/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, `${PHONE_TRACE_CLIENT}</body>`);
          else html += PHONE_TRACE_CLIENT;

          const out = { ...up.headers };
          delete out['content-length'];
          delete out['content-encoding'];
          res.writeHead(up.statusCode || 200, out);
          res.end(html);
        });
      }
    );
    upstream.on('error', (err) => {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(`Benchdrop could not reach the app: ${err.message}`);
    });
    req.pipe(upstream);
  };

  const server = https.createServer({ cert, key }, proxyRequest);

  // Pass WebSocket upgrades through as well, so hot reload keeps working.
  server.on('upgrade', (req, socket, head) => {
    const upstream = net.connect(Number(target.port), target.hostname, () => {
      upstream.write(
        `${req.method} ${req.url} HTTP/1.1\r\n` +
          Object.entries({ ...req.headers, host: target.host })
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
            .join('\r\n') +
          '\r\n\r\n'
      );
      if (head && head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', resolve);
  });

  phoneServer = server;
  const host = ips[0].address;
  phoneUrl = `https://${host}:${port}${target.pathname}${target.search}`;

  const qr = await QRCode.toDataURL(phoneUrl, {
    width: 320,
    margin: 1,
    color: { dark: '#0f1115', light: '#ffffff' },
  });

  sendLog(`[Benchdrop] Phone preview ready at ${phoneUrl}\n`);
  return {
    ok: true,
    url: phoneUrl,
    qr,
    addresses: ips.map((i) => `https://${i.address}:${port}${target.pathname}`),
    interfaceName: ips[0].name,
  };
}

// ---------------------------------------------------------------------------
// Recent projects
// ---------------------------------------------------------------------------

const MAX_RECENTS = 12;

function recentsPath() {
  return path.join(app.getPath('userData'), 'recents.json');
}

function readRecents() {
  try {
    const list = JSON.parse(fs.readFileSync(recentsPath(), 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function writeRecents(list) {
  try {
    fs.writeFileSync(recentsPath(), JSON.stringify(list.slice(0, MAX_RECENTS), null, 2), 'utf8');
  } catch (e) {
    /* a missing recents list is not worth interrupting anything for */
  }
}

function rememberRecent(entry) {
  const list = readRecents().filter((r) => r.path !== entry.path);
  list.unshift({ ...entry, opened: Date.now() });
  writeRecents(list);
}

// ---------------------------------------------------------------------------
// Loading straight from a URL
//
// Accepts a GitHub repo link (or any direct link to a .zip) so a project can
// be tried without cloning it first. The archive is kept in Benchdrop's own
// downloads folder, which means the usual content-hash logic applies: pull
// the same repo again later and a changed archive is re-extracted.
// ---------------------------------------------------------------------------

function parseProjectUrl(raw) {
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch (e) {
    return { error: "That doesn't look like a web address." };
  }
  if (!/^https?:$/.test(u.protocol)) {
    return { error: 'Only http and https addresses can be loaded.' };
  }

  // A direct link to an archive: use it as-is.
  if (/\.zip$/i.test(u.pathname)) {
    const name = sanitizeName(path.basename(u.pathname, '.zip')) || 'download';
    return { kind: 'zip', name, candidates: [u.toString()] };
  }

  if (/(^|\.)github\.com$/i.test(u.hostname)) {
    const parts = u.pathname.replace(/^\/+|\/+$/g, '').split('/');
    const owner = parts[0];
    const repo = (parts[1] || '').replace(/\.git$/i, '');
    if (!owner || !repo) {
      return { error: 'That GitHub link needs to include an owner and a repository.' };
    }
    // .../tree/<branch> pins a branch; otherwise try the usual defaults.
    const branch = parts[2] === 'tree' && parts[3] ? parts.slice(3).join('/') : null;
    const branches = branch ? [branch] : ['main', 'master'];
    return {
      kind: 'github',
      name: sanitizeName(`${repo}`),
      candidates: branches.map(
        (b) => `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${b}`
      ),
      label: `${owner}/${repo}${branch ? ` (${branch})` : ''}`,
    };
  }

  return {
    error:
      'Only GitHub links and direct .zip links are supported. ' +
      'For anything else, download the project and drop the file in.',
  };
}

function downloadToFile(url, destPath) {
  return new Promise((resolve, reject) => {
    httpsGetFollow(url)
      .then((res) => {
        const total = Number(res.headers['content-length'] || 0);
        let received = 0;
        let lastPct = -1;
        const out = fs.createWriteStream(destPath);
        res.on('data', (chunk) => {
          received += chunk.length;
          if (total) {
            const pct = Math.floor((received / total) * 100);
            if (pct >= lastPct + 20) {
              lastPct = pct;
              sendLog(`[Benchdrop] ...${pct}%\n`);
            }
          }
        });
        res.pipe(out);
        out.on('finish', () => out.close(() => resolve(destPath)));
        out.on('error', reject);
        res.on('error', reject);
      })
      .catch(reject);
  });
}

async function fetchProjectFromUrl(rawUrl) {
  const parsed = parseProjectUrl(rawUrl);
  if (parsed.error) return { ok: false, message: parsed.error };

  const dir = path.join(app.getPath('userData'), 'downloads');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${parsed.name}.zip`);

  sendLog(`[Benchdrop] Downloading ${parsed.label || rawUrl} ...\n`);
  let lastError = null;
  for (const candidate of parsed.candidates) {
    try {
      await downloadToFile(candidate, dest);
      const size = fs.statSync(dest).size;
      if (size < 128) throw new Error('the download was empty');
      sendLog(`[Benchdrop] Downloaded ${(size / 1024 / 1024).toFixed(1)} MB.\n`);
      return { ok: true, zipPath: dest, label: parsed.label || parsed.name };
    } catch (err) {
      lastError = err;
      // A 404 here usually just means the branch is named differently.
    }
  }
  return {
    ok: false,
    message:
      `Couldn't download that project: ${lastError ? lastError.message : 'not found'}. ` +
      'Check the address, and note that private repositories need to be downloaded manually.',
  };
}

// Anything the phone does is tagged with the device it came from, so two
// phones (or a phone and a tablet) don't get muddled together in the log.
const deviceLabels = new Map();

function deviceLabel(req) {
  const ip = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  const ua = String(req.headers['user-agent'] || '');
  // Keyed on address AND browser: one device running two browsers should
  // still show up as two entries rather than being merged.
  const key = `${ip}|${ua}`;
  if (deviceLabels.has(key)) return deviceLabels.get(key);
  const kind = /iPhone/i.test(ua) ? 'iPhone'
    : /iPad/i.test(ua) ? 'iPad'
    : /Android/i.test(ua) ? 'Android'
    : /Macintosh/i.test(ua) ? 'Mac'
    : /Windows/i.test(ua) ? 'Windows'
    : 'device';
  const label = `${kind} ${ip}`;
  deviceLabels.set(key, label);
  sendLog(`[Benchdrop] ${label} connected to the phone preview.\n`);
  return label;
}

// Injected into pages served over the phone preview. Reports back to
// Benchdrop over the same connection, so a phone needs no setup and nothing
// is left behind in the project.
const PHONE_TRACE_CLIENT = `<script>(function(){
  if (window.__bdPhoneTrace) return;
  window.__bdPhoneTrace = true;
  var ENDPOINT = '/__benchdrop/trace';
  var queue = [], timer = null;

  function flush() {
    timer = null;
    if (!queue.length) return;
    var batch = queue.splice(0, queue.length);
    try {
      var body = JSON.stringify(batch);
      if (navigator.sendBeacon) navigator.sendBeacon(ENDPOINT, new Blob([body], {type:'application/json'}));
      else fetch(ENDPOINT, { method:'POST', body: body, headers:{'Content-Type':'application/json'}, keepalive:true });
    } catch (e) {}
  }
  function say(kind, text) {
    queue.push({ kind: kind, text: String(text).slice(0, 500) });
    if (!timer) timer = setTimeout(flush, 350);
  }
  window.addEventListener('pagehide', flush);

  var FIELD = /^(input|textarea|select)$/;
  var SECRET = /pass|pwd|secret|token|key|auth|card|cvv|ssn|otp|pin/i;
  function describe(el) {
    if (!el || !el.tagName) return 'unknown';
    var tag = el.tagName.toLowerCase();
    var id = el.id ? '#' + el.id : '';
    var cls = (typeof el.className === 'string' && el.className.trim())
      ? '.' + el.className.trim().split(/\\s+/).slice(0,2).join('.') : '';
    var label = (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('name')
      || el.getAttribute('placeholder'))) || '';
    if (!label && !FIELD.test(tag)) label = (el.innerText||'').trim().replace(/\\s+/g,' ').slice(0,40);
    return tag + id + cls + (label ? ' "' + label + '"' : '');
  }
  function isSecret(el) {
    if ((el.type||'').toLowerCase() === 'password') return true;
    return SECRET.test((el.name||'') + ' ' + (el.id||'') + ' ' + ((el.getAttribute && el.getAttribute('autocomplete'))||''));
  }

  document.addEventListener('click', function(e){
    var t = (e.target.closest && e.target.closest('button,a,[role=button],input,select,label,summary')) || e.target;
    say('app', 'click ' + describe(t));
  }, true);
  document.addEventListener('change', function(e){
    var t = e.target, k = (t.type||'').toLowerCase();
    var v = isSecret(t) ? '(hidden)' : (k==='checkbox'||k==='radio') ? String(t.checked) : String(t.value||'').slice(0,40);
    say('app', 'change ' + describe(t) + ' -> ' + v);
  }, true);
  document.addEventListener('submit', function(e){ say('app', 'submit ' + describe(e.target)); }, true);

  window.addEventListener('error', function(e){
    say('app', 'ERROR ' + (e.message||'script error') + (e.filename ? ' (' + e.filename + ':' + e.lineno + ')' : ''));
  });
  window.addEventListener('unhandledrejection', function(e){
    var r = e.reason;
    say('app', 'UNHANDLED PROMISE ' + ((r && (r.message || (r.toString && r.toString()))) || 'rejected'));
  });

  ['log','warn','error'].forEach(function(level){
    var original = console[level];
    console[level] = function(){
      try {
        say(level === 'log' ? 'console' : 'console ' + level,
            Array.prototype.map.call(arguments, function(a){
              try { return typeof a === 'string' ? a : JSON.stringify(a); } catch (e) { return String(a); }
            }).join(' '));
      } catch (e) {}
      return original.apply(console, arguments);
    };
  });

  say('page', 'opened ' + location.pathname);
})();</scr` + `ipt>`;

function serveStatic(projectDir, port) {
  const server = http.createServer((req, res) => {
    let reqPath = decodeURIComponent(req.url.split('?')[0]);
    if (reqPath === '/') reqPath = '/index.html';
    const filePath = path.join(projectDir, reqPath);
    if (!filePath.startsWith(projectDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const noCache = {
        // This is a dev tool: never let the embedded browser serve a stale
        // copy of a file you just changed.
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      };

      if (ext === '.md' || ext === '.markdown') {
        const html = renderMarkdown(data.toString('utf8'), path.basename(filePath));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...noCache });
        res.end(html);
        return;
      }

      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        ...noCache,
      });
      res.end(data);
    });
  });
  server.listen(port, '127.0.0.1');
  return server;
}

// ---------------------------------------------------------------------------
// Process control
// ---------------------------------------------------------------------------

function stopRunningApp(opts = {}) {
  stopWatching();
  stopPhonePreview();
  stopNativeProgram({ wait: opts.wait });
  for (const p of runningProcs) {
    if (p.child && p.child.pid) killTree(p.child.pid, opts.wait);
  }
  runningProcs = [];
  sendProcs();
  if (runningStaticServer) {
    try {
      runningStaticServer.close();
    } catch (e) {
      /* ignore */
    }
    runningStaticServer = null;
  }
}

function cleanProjectArtifacts(projectDir) {
  try {
    fs.rmSync(path.join(projectDir, 'node_modules'), { recursive: true, force: true });
  } catch (e) {
    sendLog(`[Benchdrop] (couldn't fully remove node_modules: ${e.message})\n`);
  }
  for (const f of ['package-lock.json', 'npm-shrinkwrap.json']) {
    try {
      fs.rmSync(path.join(projectDir, f), { force: true });
    } catch (e) {
      /* ignore */
    }
  }
}

function runNpmInstall(nodeExe, projectDir) {
  return new Promise((resolve) => {
    sendStatus('installing');
    sendLog(`\n$ npm install\n`);
    const install = spawn(nodeExe, [npmCliPath(), 'install', '--no-audit', '--no-fund'], {
      cwd: projectDir,
      env: childEnv(nodeExe),
      windowsHide: true,
    });
    runningProcs.push({ id: 'install', name: 'install', child: install });
    sendProcs();

    install.stdout.on('data', (d) => sendLog(d, 'install'));
    install.stderr.on('data', (d) => sendLog(d, 'install'));
    install.on('error', (err) => resolve({ ok: false, message: `Failed to launch npm install: ${err.message}` }));
    install.on('exit', (code) => {
      runningProcs = runningProcs.filter((p) => p.id !== 'install');
      sendProcs();
      resolve(code === 0 ? { ok: true } : { ok: false, message: `npm install exited with code ${code}.` });
    });
  });
}

async function startProject(projectDir, scriptNames, opts = {}) {
  const healAttempted = !!opts.healAttempted;
  currentProjectDir = projectDir;
  currentScriptNames = scriptNames;

  stopRunningApp();

  let nodeExe;
  try {
    nodeExe = await resolveNodeRuntime();
  } catch (err) {
    sendStatus('error', {
      message:
        `Couldn't get a Node.js runtime: ${err.message}. Check your connection, ` +
        'or install Node.js 20.19+ from nodejs.org.',
    });
    return;
  }

  if (!opts.skipInstall) {
    const res = await runNpmInstall(nodeExe, projectDir);
    if (!res.ok) {
      sendStatus('error', { message: `${res.message} Check the log above.` });
      return;
    }
  }

  sendStatus('starting');

  let urlSent = false;
  let healing = false;
  let fallbackUrl = null; // a URL seen from a backend script, held in reserve
  let fallbackTimer = null;
  const hasFrontendScript = scriptNames.some((s) => !isBackendScriptName(s));
  const suggestedCommands = new Set();
  const reportedPorts = new Set();

  for (const scriptName of scriptNames) {
    const isBackend = isBackendScriptName(scriptName);
    sendLog(`\n$ npm run ${scriptName}\n`);
    const child = spawn(nodeExe, [npmCliPath(), 'run', scriptName], {
      cwd: projectDir,
      env: childEnv(nodeExe, { BROWSER: 'none', CI: 'false', NO_COLOR: '1', FORCE_COLOR: '0' }),
      windowsHide: true,
    });

    const entry = { id: `${scriptName}-${Date.now()}`, name: scriptName, child, buffer: '' };
    runningProcs.push(entry);
    sendProcs();

    const onData = (d) => {
      const text = stripAnsi(d.toString());
      sendLog(text, scriptName);
      entry.buffer = (entry.buffer + text).slice(-20000);

      if (!urlSent) {
        const url = findServedUrl(text);
        if (url) {
          if (!isBackend) {
            // The app's own script — this is the real one, load it now.
            urlSent = true;
            if (fallbackTimer) clearTimeout(fallbackTimer);
            sendStatus('ready', { url, projectDir });
          } else if (!fallbackUrl) {
            // A backend script printed a local URL (its own admin/API
            // address, e.g. Convex's http://127.0.0.1:3210) — that's not
            // the app. Hold onto it only as a last resort, and only if
            // nothing else here is expected to serve the app at all.
            fallbackUrl = url;
            if (!hasFrontendScript && !fallbackTimer) {
              fallbackTimer = setTimeout(() => {
                if (!urlSent && fallbackUrl) {
                  urlSent = true;
                  sendStatus('ready', { url: fallbackUrl, projectDir });
                }
              }, 4000);
            }
          }
        }
      }
      const authUrl = findAuthUrl(text);
      if (authUrl) sendStatus('auth-url', { url: authUrl, script: scriptName });

      const hint = findSetupHint(text);
      if (hint && !suggestedCommands.has(hint.command)) {
        suggestedCommands.add(hint.command);
        sendStatus('suggest-command', { command: hint.command, reason: hint.reason });
      }

      const busyPort = findPortConflict(text);
      if (busyPort && !reportedPorts.has(busyPort)) {
        reportedPorts.add(busyPort);
        findPidsOnPort(busyPort).then((pids) => {
          sendStatus('port-conflict', { port: busyPort, pids, script: scriptName, moved: /trying another/i.test(text) });
        });
      }
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => sendLog(`[Benchdrop] ${scriptName} failed to launch: ${err.message}\n`, scriptName));

    child.on('exit', (code) => {
      runningProcs = runningProcs.filter((p) => p.id !== entry.id);
      sendProcs();
      sendLog(`\n[Benchdrop] "${scriptName}" exited (code ${code}).\n`, scriptName);

      if (!healAttempted && !healing && !urlSent && NATIVE_BINDING_FAILURE_RE.test(entry.buffer)) {
        healing = true;
        sendLog(
          '\n[Benchdrop] That looks like the known npm bug with platform-specific optional ' +
            'dependencies. Doing a clean reinstall and retrying...\n'
        );
        cleanProjectArtifacts(projectDir);
        startProject(projectDir, scriptNames, { healAttempted: true });
        return;
      }
      if (!urlSent && runningProcs.length === 0 && !healing) {
        sendStatus('error', {
          message: 'Everything exited before a local URL appeared. Check the log above.',
        });
      }
    });
  }

  setTimeout(() => {
    if (!urlSent && runningProcs.length) {
      sendLog('\n[Benchdrop] Still waiting for a local URL to appear in the output...\n');
      sendStatus('stalled');
    }
  }, 90000);
}

async function startPythonProject(projectDir, entryFile, entryArgs = '', opts = {}) {
  currentProjectDir = projectDir;
  stopRunningApp();

  const py = await resolvePythonRuntime();
  if (!py) {
    sendStatus('python-missing');
    return;
  }

  const [pyCmd, ...pyPrefix] = py;

  if (opts.installRequirements) {
    sendStatus('installing');
    sendLog('\n$ pip install -r requirements.txt\n');
    const ok = await new Promise((resolve) => {
      const child = spawn(pyCmd, [...pyPrefix, '-m', 'pip', 'install', '-r', 'requirements.txt'], {
        cwd: projectDir,
        env: { ...process.env, PYTHONUNBUFFERED: '1', NO_COLOR: '1' },
        windowsHide: true,
        shell: process.platform === 'win32',
      });
      runningProcs.push({ id: 'pip', name: 'pip', child });
      sendProcs();
      child.stdout.on('data', (d) => sendLog(d, 'pip'));
      child.stderr.on('data', (d) => sendLog(d, 'pip'));
      child.on('error', (err) => {
        sendLog(`[Benchdrop] pip failed to start: ${err.message}\n`, 'pip');
        resolve(false);
      });
      child.on('exit', (code) => {
        runningProcs = runningProcs.filter((p) => p.id !== 'pip');
        sendProcs();
        if (code !== 0) sendLog(`[Benchdrop] pip exited with code ${code}.\n`, 'pip');
        resolve(code === 0);
      });
    });
    if (!ok) {
      sendStatus('error', { message: 'Installing Python dependencies failed. Check the log above.' });
      return;
    }
  }

  sendStatus('starting');
  const argList = entryArgs.trim() ? entryArgs.trim().split(/\s+/) : [];
  sendLog(`\n$ python ${entryFile} ${entryArgs}\n`.replace(/\s+$/, '\n'));

  // PYTHONUNBUFFERED matters: without it Python buffers stdout when piped,
  // so output would only appear once the process ended.
  const child = spawn(pyCmd, [...pyPrefix, entryFile, ...argList], {
    cwd: projectDir,
    env: { ...process.env, PYTHONUNBUFFERED: '1', NO_COLOR: '1' },
    windowsHide: true,
    shell: process.platform === 'win32',
  });

  const entry = { id: `py-${Date.now()}`, name: 'python', child, buffer: '' };
  runningProcs.push(entry);
  sendProcs();

  let urlSent = false;
  const reportedPorts = new Set();
  const onData = (d) => {
    const text = stripAnsi(d.toString());
    sendLog(text, 'python');
    entry.buffer = (entry.buffer + text).slice(-20000);
    if (!urlSent) {
      const url = findServedUrl(text);
      if (url) {
        urlSent = true;
        sendStatus('ready', { url, projectDir });
        startWatching(projectDir);
      }
    }
    const busyPort = findPortConflict(text);
    if (busyPort && !reportedPorts.has(busyPort)) {
      reportedPorts.add(busyPort);
      findPidsOnPort(busyPort).then((pids) => {
        sendStatus('port-conflict', { port: busyPort, pids, script: 'python' });
      });
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);

  child.on('error', (err) => {
    sendStatus('error', { message: `Couldn't run Python: ${err.message}` });
  });
  child.on('exit', (code) => {
    runningProcs = runningProcs.filter((p) => p.id !== entry.id);
    sendProcs();
    sendLog(`\n[Benchdrop] Finished (exit code ${code}).\n`, 'python');
    if (!urlSent) sendStatus('script-finished', { code });
    else sendStatus('stopped');
  });
}

async function startRuntimeProject(projectDir, command, opts = {}) {
  currentProjectDir = projectDir;
  stopRunningApp();

  // Commands that serve something need a port; the rest just run.
  let resolved = command;
  let knownUrl = null;
  if (command.includes('{port}')) {
    const port = await resolveServePort();
    resolved = command.replace(/\{port\}/g, String(port));
    knownUrl = `http://localhost:${port}/`;
  }

  sendStatus('starting');
  sendLog(`\n$ ${resolved}\n`);

  const child = spawn(resolved, {
    cwd: projectDir,
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', PYTHONUNBUFFERED: '1' },
    shell: true,
    windowsHide: true,
  });

  const entry = { id: `rt-${Date.now()}`, name: opts.runtimeLabel || 'run', child, buffer: '' };
  runningProcs.push(entry);
  sendProcs();

  let urlSent = false;
  const ready = (url) => {
    if (urlSent) return;
    urlSent = true;
    sendStatus('ready', { url, projectDir });
    startWatching(projectDir);
  };

  const onData = (d) => {
    const text = stripAnsi(d.toString());
    sendLog(text, entry.name);
    entry.buffer = (entry.buffer + text).slice(-20000);
    const url = findServedUrl(text);
    if (url) ready(url);
    const busyPort = findPortConflict(text);
    if (busyPort) {
      findPidsOnPort(busyPort).then((pids) =>
        sendStatus('port-conflict', { port: busyPort, pids, script: entry.name })
      );
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);

  child.on('error', (err) => {
    sendStatus('error', { message: `Couldn't run that command: ${err.message}` });
  });
  child.on('exit', (code) => {
    runningProcs = runningProcs.filter((p) => p.id !== entry.id);
    sendProcs();
    sendLog(`\n[Benchdrop] Finished (exit code ${code}).\n`, entry.name);
    if (!urlSent) sendStatus('script-finished', { code });
    else sendStatus('stopped');
  });

  // Servers of this kind often print nothing useful, so if we already know
  // the address, show it once the process has had a moment to bind.
  if (knownUrl && !opts.oneShot) {
    setTimeout(() => {
      if (!urlSent && runningProcs.some((p) => p.id === entry.id)) ready(knownUrl);
    }, 1200);
  }
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

ipcMain.handle('pick-zip', async (_e, opts = {}) => {
  const wantFolder = opts && opts.folder;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: wantFolder ? 'Choose a project folder' : 'Choose a project',
    properties: [wantFolder ? 'openDirectory' : 'openFile'],
    filters: wantFolder
      ? undefined
      : [
          { name: 'Projects', extensions: ['zip', 'html', 'htm', 'py', 'exe'] },
          { name: 'Zip archives', extensions: ['zip'] },
          { name: 'Programs', extensions: ['exe'] },
          { name: 'Web pages', extensions: ['html', 'htm'] },
          { name: 'Python scripts', extensions: ['py'] },
          { name: 'All files', extensions: ['*'] },
        ],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

async function loadProjectFromPath(zipPath, forceFresh) {
  stopRunningApp();
  currentZipPath = zipPath;

  let isDir = false;
  try {
    isDir = fs.statSync(zipPath).isDirectory();
  } catch (e) {
    sendStatus('error', { message: `Couldn't read "${zipPath}".` });
    return { ok: false };
  }
  sendLog(
    isDir
      ? `Opening folder ${path.basename(zipPath)} ...\n`
      : /\.zip$/i.test(zipPath)
        ? `Unpacking ${path.basename(zipPath)} ...\n`
        : `Loading ${path.basename(zipPath)} ...\n`
  );

  let prepared;
  try {
    prepared = prepareProjectFromPath(zipPath, { forceFresh });
  } catch (err) {
    sendStatus('error', { message: err.message });
    return { ok: false };
  }

  const { projectDir, reused, updated } = prepared;
  const info = prepared.exe
    ? { type: 'native', name: prepared.exe.replace(/\.exe$/i, ''), exes: [prepared.exe], preselect: prepared.exe }
    : detectProject(projectDir);
  currentProjectType = info.type;
  currentProjectDir = projectDir;
  sendLog(`Project folder: ${projectDir}\n`);
  sendLog(`Detected type: ${info.type}\n`);

  if (info.type === 'static') {
    const entryFile = (info.htmlEntries && info.htmlEntries[0]) || 'index.html';
    try {
      const port = await resolveServePort();
      runningStaticServer = serveStatic(projectDir, port);
      const url = `http://localhost:${port}/${entryFile}`;
      sendLog(`Serving ${entryFile} at ${url}\n`);
      if (info.htmlEntries && info.htmlEntries.length > 1) {
        sendLog(`[Benchdrop] Other pages here: ${info.htmlEntries.slice(1).join(', ')}\n`);
      }
      sendStatus('ready', { url, projectDir });
      startWatching(projectDir);
    } catch (err) {
      sendStatus('error', { message: `Couldn't start static server: ${err.message}` });
    }
    return { ok: true, info, projectDir, reused, updated };
  }

  if (info.type === 'mixed') {
    const pythonPath = await resolvePythonRuntime();
    info.python.pythonAvailable = !!pythonPath;
    sendLog(
      `[Benchdrop] This project has both a web page (${info.htmlEntries[0]}) and Python ` +
        'scripts. Pick which one to run.\n'
    );
    return { ok: true, info, projectDir, reused, updated, needsModeChoice: true };
  }

  if (info.type === 'node') {
    return { ok: true, info, projectDir, reused, updated, needsScriptChoice: true };
  }

  if (info.type === 'native') {
    sendLog(
      `[Benchdrop] Found ${info.exes.length} program${info.exes.length === 1 ? '' : 's'}: ` +
        `${info.exes.slice(0, 6).join(', ')}${info.exes.length > 6 ? ', …' : ''}\n`
    );
    return { ok: true, info, projectDir, reused, updated, needsNativeChoice: true };
  }

  if (info.type === 'runtime') {
    const rt = RUNTIMES.find((r) => r.id === info.runtimeId);
    const version = rt ? await probeRuntimeVersion(rt.probe[0], rt.probe[1]) : null;
    info.available = !!version;
    info.version = version;

    // A project can also just have a page worth opening.
    info.options = [
      ...info.commands,
      ...(info.htmlEntries || []).slice(0, 2).map((f) => ({
        label: `Open ${f} as a static page`,
        static: f,
      })),
    ];

    sendLog(
      version
        ? `[Benchdrop] ${info.runtimeLabel} project — using ${version}\n`
        : `[Benchdrop] ${info.runtimeLabel} project, but ${info.runtimeLabel} isn't installed on this machine.\n`
    );
    return { ok: true, info, projectDir, reused, updated, needsRuntimeChoice: true };
  }

  if (info.type === 'python') {
    const pythonPath = await resolvePythonRuntime();
    info.pythonAvailable = !!pythonPath;
    if (info.servesUI) {
      sendLog(
        `[Benchdrop] Python project (looks like it uses ${info.frameworks.join(', ')}), ` +
          'so it should serve a page once it starts.\n'
      );
    } else {
      sendLog(
        '[Benchdrop] Python project with no web framework detected — this looks like a ' +
          'command-line tool, so there is no UI to display. Output appears in this log.\n'
      );
    }
    if (!pythonPath) {
      sendLog('[Benchdrop] Python was not found on this machine.\n');
    }
    return { ok: true, info, projectDir, reused, updated, needsPythonChoice: true };
  }

  // Nothing runnable — say what this looks like, not just what's absent.
  sendLog(
    '[Benchdrop] No web UI detected: there is no package.json (Node app) and no ' +
      'index.html (static site) here.\n'
  );
  if (info.topLevel && info.topLevel.length) {
    sendLog(`[Benchdrop] The folder contains: ${info.topLevel.join(', ')}\n`);
  }
  sendLog(
    '[Benchdrop] Opening in command-only mode — the project folder is loaded, so you can ' +
      'run commands against it from the bar above and read the output here.\n'
  );
  return { ok: true, info, projectDir, reused, updated, commandOnly: true };
}

ipcMain.handle('load-zip', async (_event, { zipPath, forceFresh }) => {
  const result = await loadProjectFromPath(zipPath, forceFresh);
  if (result && result.ok && result.info) {
    rememberRecent({
      path: zipPath,
      name: result.info.name || path.basename(zipPath),
      type: result.info.type,
      source: 'local',
    });
  }
  return result;
});

ipcMain.handle('load-url', async (_event, { url }) => {
  stopRunningApp();
  const fetched = await fetchProjectFromUrl(url);
  if (!fetched.ok) {
    sendStatus('error', { message: fetched.message });
    return { ok: false };
  }
  const result = await loadProjectFromPath(fetched.zipPath, false);
  if (result && result.ok && result.info) {
    rememberRecent({
      path: fetched.zipPath,
      name: fetched.label || result.info.name,
      type: result.info.type,
      source: 'url',
      url,
    });
  }
  return result;
});

ipcMain.handle('get-recents', async () => {
  // Flag anything whose file has since been deleted, rather than failing later.
  return readRecents().map((r) => ({ ...r, missing: !fs.existsSync(r.path) }));
});

ipcMain.handle('remove-recent', async (_e, { path: p }) => {
  writeRecents(readRecents().filter((r) => r.path !== p));
  return true;
});

ipcMain.handle('run-scripts', async (_e, { projectDir, scriptNames }) => {
  await startProject(projectDir, scriptNames);
  return true;
});

ipcMain.handle('serve-html', async (_e, { projectDir, entryFile }) => {
  stopRunningApp();
  currentProjectDir = projectDir;
  try {
    const port = await resolveServePort();
    runningStaticServer = serveStatic(projectDir, port);
    const url = `http://localhost:${port}/${entryFile}`;
    sendLog(`Serving ${entryFile} at ${url}\n`);
    sendStatus('ready', { url, projectDir });
    startWatching(projectDir);
    return true;
  } catch (err) {
    sendStatus('error', { message: `Couldn't start static server: ${err.message}` });
    return false;
  }
});

ipcMain.handle('run-runtime', async (_e, { projectDir, command, runtimeLabel, oneShot }) => {
  await startRuntimeProject(projectDir, command, { runtimeLabel, oneShot });
  return true;
});

ipcMain.handle('run-python', async (_e, { projectDir, entryFile, entryArgs, installRequirements }) => {
  await startPythonProject(projectDir, entryFile, entryArgs || '', { installRequirements });
  return true;
});

ipcMain.handle('stop-app', async () => {
  stopRunningApp();
  sendStatus('stopped');
  return true;
});

ipcMain.handle('clean-reinstall', async () => {
  if (!currentProjectDir || !currentScriptNames.length) return false;
  stopRunningApp();
  sendLog('\n[Benchdrop] Forcing a clean reinstall (removing node_modules + lockfile)...\n');
  cleanProjectArtifacts(currentProjectDir);
  startProject(currentProjectDir, currentScriptNames, { healAttempted: true });
  return true;
});

ipcMain.handle('reset-project', async () => {
  if (!currentZipPath) return false;
  stopRunningApp();
  const dir = stableDirForZip(currentZipPath);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    sendLog('[Benchdrop] Project folder deleted. Drop the zip again for a fresh copy.\n');
  } catch (e) {
    sendLog(`[Benchdrop] Couldn't delete the project folder: ${e.message}\n`);
  }
  sendStatus('reset');
  return true;
});

// Send a line to a running process's stdin, so CLIs that ask questions can
// be answered from the log pane. This is a pipe, not a real terminal.
ipcMain.handle('send-input', async (_e, { procId, text }) => {
  const target = runningProcs.find((p) => p.id === procId) || runningProcs[0];
  if (!target || !target.child || !target.child.stdin || target.child.stdin.destroyed) {
    sendLog('[Benchdrop] Nothing is running that can accept input right now.\n');
    return false;
  }
  try {
    target.child.stdin.write(text + '\n');
    sendLog(`> ${text}\n`, target.name);
    return true;
  } catch (err) {
    sendLog(`[Benchdrop] Couldn't send that input: ${err.message}\n`);
    return false;
  }
});

// Run a one-off command in the project folder — the escape hatch for
// setup steps that aren't in any npm script (e.g. `npx @convex-dev/auth`).
// The command is whatever the user typed or accepted from a suggestion; it
// runs with the same Node on PATH as everything else Benchdrop spawns.
ipcMain.handle('run-command', async (_e, { command }) => {
  if (!currentProjectDir) {
    sendLog('[Benchdrop] Load a project first.\n');
    return false;
  }
  const trimmed = String(command || '').trim();
  if (!trimmed) return false;

  let nodeExe;
  try {
    nodeExe = await resolveNodeRuntime();
  } catch (err) {
    sendLog(`[Benchdrop] Couldn't get a Node runtime: ${err.message}\n`);
    return false;
  }

  sendStatus('command-running', { command: trimmed });
  sendLog(`\n$ ${trimmed}\n`, 'command');

  const child = spawn(trimmed, {
    cwd: currentProjectDir,
    env: childEnv(nodeExe, { NO_COLOR: '1', FORCE_COLOR: '0' }),
    shell: true,
    windowsHide: true,
  });

  const entry = { id: `cmd-${Date.now()}`, name: 'command', child };
  runningProcs.push(entry);
  sendProcs();

  child.stdout.on('data', (d) => sendLog(d, 'command'));
  child.stderr.on('data', (d) => sendLog(d, 'command'));
  child.on('error', (err) => {
    sendLog(`[Benchdrop] Command failed to start: ${err.message}\n`, 'command');
    runningProcs = runningProcs.filter((p) => p.id !== entry.id);
    sendProcs();
    sendStatus('command-done', { command: trimmed, success: false });
  });
  child.on('exit', (code) => {
    runningProcs = runningProcs.filter((p) => p.id !== entry.id);
    sendProcs();
    sendLog(`\n[Benchdrop] Command finished (exit code ${code}).\n`, 'command');
    sendStatus('command-done', { command: trimmed, success: code === 0 });
  });

  return true;
});

// Kill whatever is listening on a port, then optionally start the project
// again. Only ever called from the user pressing the button on the banner.
ipcMain.handle('free-port', async (_e, { port, retry }) => {
  const pids = await findPidsOnPort(port);
  if (!pids.length) {
    sendLog(`[Benchdrop] Nothing seems to be listening on port ${port} anymore.\n`);
  } else {
    sendLog(`[Benchdrop] Stopping leftover process${pids.length > 1 ? 'es' : ''} on port ${port}: ${pids.join(', ')}\n`);
    for (const pid of pids) {
      await new Promise((resolve) => {
        treeKill(pid, 'SIGKILL', (err) => {
          if (err) sendLog(`[Benchdrop] Couldn't stop PID ${pid}: ${err.message}\n`);
          resolve();
        });
      });
    }
    // Give the OS a moment to actually release the socket.
    await new Promise((r) => setTimeout(r, 1200));
    sendLog(`[Benchdrop] Port ${port} freed.\n`);
  }

  if (retry && currentProjectDir && currentScriptNames.length) {
    sendLog('[Benchdrop] Starting the project again...\n');
    startProject(currentProjectDir, currentScriptNames, { skipInstall: true });
  }
  return true;
});

// Clears the app view's browser-level cache — HTTP cache, cookies, local
// storage, service workers. Separate from Reset project / Clean reinstall,
// which touch files on disk; this only touches the embedded browser, so a
// dev server that's serving stale cached assets can be forced to start
// clean without losing any project setup.
ipcMain.handle('clear-cache', async () => {
  try {
    const ses = session.fromPartition(APP_PARTITION);
    await ses.clearCache();
    await ses.clearStorageData();
    sendLog("[Benchdrop] Cleared the app view's cache, cookies, and local storage.\n");
    return true;
  } catch (err) {
    sendLog(`[Benchdrop] Couldn't clear the cache: ${err.message}\n`);
    return false;
  }
});

// ---------------------------------------------------------------------------
// Screenshots
//
// Two different techniques are needed here:
//   * Visible area / region — webContents.capturePage(), which only ever
//     captures what's on screen.
//   * Full page including scrolled-away content — capturePage can't do this
//     (electron/electron#17834), so we drive the Chrome DevTools Protocol:
//     ask Page.getLayoutMetrics for the real content size, then
//     Page.captureScreenshot with captureBeyondViewport.
// ---------------------------------------------------------------------------

const MAX_CAPTURE_PX = 16000; // Chrome won't render a texture taller than ~16k

function shotsDir() {
  const dir = path.join(app.getPath('userData'), 'screenshots');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function shotFileName(kind) {
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
  const base = currentProjectDir ? sanitizeName(path.basename(currentProjectDir)) : 'capture';
  return path.join(shotsDir(), `${base}_${kind}_${stamp}.png`);
}

// Capture the whole page, including anything you'd have to scroll to see.
//
// History, because this took three attempts:
//   1. Page.captureScreenshot with captureBeyondViewport — tiled the
//      viewport, so the page came back repeated.
//   2. Emulation.setDeviceMetricsOverride to grow the viewport first — also
//      tiled, because a <webview>'s compositor surface is pinned to the size
//      of the element on screen and doesn't grow with the override.
//   3. What's here now: scroll down a screenful at a time, take an ordinary
//      viewport screenshot of each, and stitch them into one tall image.
//      Every capture is exactly the size of the real surface, so there's
//      nothing for the compositor to tile.
//
// Stitching is done on raw BGRA bitmaps via nativeImage, so it needs no
// image library and no canvas.
async function captureFullPage(wc) {
  const metrics = await wc.executeJavaScript(`(() => ({
    scrollHeight: Math.max(
      document.body ? document.body.scrollHeight : 0,
      document.documentElement.scrollHeight
    ),
    viewportWidth: document.documentElement.clientWidth,
    viewportHeight: window.innerHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY
  }))()`);

  const vw = Math.round(metrics.viewportWidth);
  const vh = Math.round(metrics.viewportHeight);
  const originalScrollY = metrics.scrollY;
  const fullHeight = Math.min(Math.ceil(metrics.scrollHeight), MAX_CAPTURE_PX);

  // Already fits — a plain capture is exact, no stitching needed.
  if (fullHeight <= vh + 2) {
    const img = await wc.capturePage();
    const s = img.getSize();
    return { buffer: img.toPNG(), width: s.width, height: s.height, fitted: true, tiles: 1 };
  }

  if (Math.ceil(metrics.scrollHeight) > MAX_CAPTURE_PX) {
    sendLog(
      `[Benchdrop] Page is ${Math.ceil(metrics.scrollHeight)}px tall; capturing the top ` +
        `${MAX_CAPTURE_PX}px.\n`
    );
  }

  // Turn off smooth scrolling and hide anything pinned to the viewport, so
  // sticky headers don't reappear in the middle of the stitched image.
  await wc.executeJavaScript(`(() => {
    const s = document.createElement('style');
    s.id = '__devbox_capture_style';
    s.textContent = 'html,body{scroll-behavior:auto !important}';
    document.head.appendChild(s);
    window.__devboxPinned = [];
    const vh = window.innerHeight;
    document.querySelectorAll('*').forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') return;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      // A bar pinned to the BOTTOM of the window would be captured at the
      // foot of the first screenful, which becomes the middle of the
      // stitched image. Those get hidden from the very first tile; things
      // pinned to the top (headers) are fine in the first tile and hidden
      // after it.
      const low = (cs.bottom !== 'auto' && cs.top === 'auto') || r.top > vh * 0.55;
      window.__devboxPinned.push([el, el.style.visibility, low]);
    });
    window.__devboxHideLow = () => {
      (window.__devboxPinned || []).forEach(([el, , low]) => {
        if (low) el.style.visibility = 'hidden';
      });
      return (window.__devboxPinned || []).filter((p) => p[2]).length;
    };
    return window.__devboxPinned.length;
  })()`);

  const out = Buffer.alloc(vw * fullHeight * 4);
  let tiles = 0;

  try {
    const hiddenLow = await wc
      .executeJavaScript('window.__devboxHideLow ? window.__devboxHideLow() : 0')
      .catch(() => 0);
    if (hiddenLow) {
      sendLog(
        `[Benchdrop] Hid ${hiddenLow} bar${hiddenLow > 1 ? 's' : ''} pinned to the bottom of the ` +
          "window, so they don't get stamped across the middle of the image.\n"
      );
    }

    for (let y = 0; y < fullHeight; y += vh) {
      // After the first screenful, hide the remaining pinned elements (the
      // top-anchored ones) so a sticky header appears once, at the top.
      if (y > 0 && tiles === 1) {
        await wc.executeJavaScript(
          `(() => { (window.__devboxPinned || []).forEach(([el]) => { el.style.visibility = 'hidden'; }); return true; })()`
        );
      }

      const actualY = await wc.executeJavaScript(
        `(() => { window.scrollTo(0, ${y}); return window.scrollY; })()`
      );
      // Let the page paint at the new offset before grabbing it.
      await new Promise((r) => setTimeout(r, 220));

      const img = await wc.capturePage();
      // Normalise to CSS pixels so every tile has identical row length,
      // regardless of the display's scale factor.
      const normalised = img.resize({ width: vw, height: vh, quality: 'best' });
      const bmp = normalised.toBitmap();
      tiles++;

      const rowBytes = vw * 4;
      const availableRows = Math.min(vh, Math.floor(bmp.length / rowBytes));
      for (let row = 0; row < availableRows; row++) {
        const destY = Math.round(actualY) + row;
        if (destY < 0 || destY >= fullHeight) continue;
        bmp.copy(out, destY * rowBytes, row * rowBytes, (row + 1) * rowBytes);
      }

      // Reached the bottom (scroll clamped) — nothing more to grab.
      if (Math.round(actualY) + vh >= fullHeight) break;
    }
  } finally {
    await wc
      .executeJavaScript(
        `(() => {
          (window.__devboxPinned || []).forEach(([el, v]) => { el.style.visibility = v || ''; });
          window.__devboxPinned = [];
          const s = document.getElementById('__devbox_capture_style');
          if (s) s.remove();
          window.scrollTo(0, ${originalScrollY});
          return true;
        })()`
      )
      .catch(() => {});
  }

  const stitched = nativeImage.createFromBitmap(out, { width: vw, height: fullHeight });
  return { buffer: stitched.toPNG(), width: vw, height: fullHeight, fitted: false, tiles };
}

ipcMain.handle('capture', async (_e, { webContentsId, mode, rect }) => {
  const wc = webContentsId != null ? webContents.fromId(webContentsId) : null;
  if (!wc || wc.isDestroyed()) {
    sendLog('[Benchdrop] Nothing is loaded in the app pane to capture.\n');
    return null;
  }

  try {
    let buffer;
    let note;

    if (mode === 'full') {
      try {
        const shot = await captureFullPage(wc);
        buffer = shot.buffer;
        note = shot.fitted
          ? `whole page (${shot.width}x${shot.height}) — it already fit on screen`
          : `whole page (${shot.width}x${shot.height}, stitched from ${shot.tiles} screens)`;
      } catch (err) {
        // Fall back rather than failing outright — a viewport shot is still
        // better than nothing, but say clearly that's what happened.
        sendLog(
          `[Benchdrop] Couldn't capture the full page (${err.message}). ` +
            'Falling back to the visible area — closing the app devtools may fix this.\n'
        );
        const img = await wc.capturePage();
        buffer = img.toPNG();
        note = 'visible area (full-page capture failed)';
      }
    } else if (mode === 'region' && rect) {
      const r = {
        x: Math.max(0, Math.round(rect.x)),
        y: Math.max(0, Math.round(rect.y)),
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
      };
      const img = await wc.capturePage(r);
      buffer = img.toPNG();
      note = `region (${r.width}x${r.height})`;
    } else {
      const img = await wc.capturePage();
      buffer = img.toPNG();
      const s = img.getSize();
      note = `visible area (${s.width}x${s.height})`;
    }

    const file = shotFileName(mode);
    fs.writeFileSync(file, buffer);

    // Put it on the clipboard too, so it can be pasted straight into a
    // message or issue without hunting for the file.
    try {
      clipboard.writeImage(nativeImage.createFromBuffer(buffer));
    } catch (e) {
      /* clipboard is a nicety, not a requirement */
    }

    // A small preview for the on-screen confirmation, so you can see at a
    // glance that the right thing was captured without opening the file.
    let thumb = null;
    try {
      thumb = nativeImage.createFromBuffer(buffer).resize({ width: 240 }).toDataURL();
    } catch (e) {
      /* preview is optional */
    }

    sendLog(`[Benchdrop] Screenshot saved — ${note}. Copied to clipboard.\n${file}\n`);
    sendStatus('capture-done', { file, note, thumb, name: path.basename(file) });
    return { file, note };
  } catch (err) {
    sendLog(`[Benchdrop] Screenshot failed: ${err.message}\n`);
    sendStatus('error', { message: `Screenshot failed: ${err.message}` });
    return null;
  }
});

// Copy arbitrary text (the log) to the system clipboard. Done in the main
// process so it works regardless of renderer clipboard permissions.
ipcMain.handle('phone-preview', async (_e, { url }) => {
  try {
    return await startPhonePreview(url);
  } catch (err) {
    sendLog(`[Benchdrop] Couldn't start phone preview: ${err.message}\n`);
    return { ok: false, message: err.message };
  }
});

ipcMain.handle('stop-phone-preview', async () => {
  stopPhonePreview();
  sendLog('[Benchdrop] Phone preview stopped.\n');
  return true;
});

ipcMain.handle('get-settings', async () => {
  const st = readSettings();
  return {
    liveReload: st.liveReload !== false,
    trace: st.trace !== false,
    theme: st.theme === 'light' ? 'light' : 'dark',
    port: st.port || PREFERRED_PORT,
    fixedPort: st.fixedPort !== false,
  };
});

ipcMain.handle('set-live-reload', async (_e, { enabled }) => {
  writeSettings({ liveReload: !!enabled });
  if (enabled) {
    if (currentProjectDir) startWatching(currentProjectDir);
    sendLog('[Benchdrop] Live reload on — edits to this project will refresh the page.\n');
  } else {
    stopWatching();
    sendLog('[Benchdrop] Live reload off.\n');
  }
  return true;
});

ipcMain.handle('copy-text', async (_e, { text }) => {
  try {
    clipboard.writeText(String(text || ''));
    return true;
  } catch (err) {
    sendLog(`[Benchdrop] Couldn't copy to clipboard: ${err.message}\n`);
    return false;
  }
});

ipcMain.handle('open-shots-folder', async () => {
  shell.openPath(shotsDir());
  return true;
});

ipcMain.handle('open-external', async (_e, url) => {
  shell.openExternal(url);
});

ipcMain.handle('open-project-folder', async () => {
  if (currentProjectDir) shell.openPath(currentProjectDir);
});

// ===========================================================================
// Native Windows programs
//
// Everything else Benchdrop runs is shown in a web view, which is what makes
// Trace, Capture and Autotest possible: they look inside the page. A native
// .exe has no page, so each feature gets a native source instead:
//
//   run / stop / log     the process tree is tracked like any other project;
//                        console output streams into the log
//   crashes              the exit code is decoded (access violation, stack
//                        overflow, unhandled .NET exception...) and Windows'
//                        Application event log is asked for the faulting module
//   trace                window opened/closed, title changes, "not responding",
//                        child processes, focus moving between controls,
//                        file writes, and network traffic through a local proxy
//   capture              the program's own window, at its real size
//   live view            the window mirrored into the pane, or the real window
//                        docked inside it
//   autotest             Windows UI Automation lists the program's controls and
//                        presses them - the native equivalent of the DOM
//
// The Windows-specific parts go through native/bdwin.ps1, a PowerShell helper
// that ships with Benchdrop, so no native Node module is needed. On other
// platforms a program still runs and logs; the Windows-only parts say so.
// ===========================================================================

const { EventEmitter } = require('events');
const { desktopCapturer, screen } = require('electron');
const netMod = require('net');
const IS_WIN = process.platform === 'win32';

// --- the helper process -----------------------------------------------------
class WinHelper {
  constructor() {
    this.proc = null;
    this.pending = new Map();
    this.seq = 0;
    this.buf = '';
    this.readyInfo = null;
    this.lastError = '';
  }

  scriptPath() {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'native', 'bdwin.ps1')
      : path.join(__dirname, 'native', 'bdwin.ps1');
  }

  available() {
    return IS_WIN;
  }

  start() {
    if (this.proc || !this.available()) return;
    const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    this.proc = spawn(
      fs.existsSync(ps) ? ps : 'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath()],
      { windowsHide: true }
    );
    this.proc.stdout.on('data', (d) => this.onData(d));
    this.proc.stderr.on('data', (d) => {
      this.lastError = (this.lastError + d.toString()).slice(-2000);
    });
    this.proc.on('exit', (code) => {
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error(`the Windows helper stopped (code ${code})${this.lastError ? ': ' + this.lastError.trim().split('\n').pop() : ''}`));
      }
      this.pending.clear();
      this.proc = null;
    });
    this.proc.on('error', (err) => {
      this.lastError = err.message;
    });
  }

  onData(d) {
    this.buf += d.toString('utf8');
    let nl;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch (e) {
        continue; // PowerShell noise, not a reply
      }
      if (msg.id === 0 && msg.ready) {
        this.readyInfo = msg;
        continue;
      }
      const p = this.pending.get(msg.id);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(msg.id);
        p.resolve(msg);
      }
    }
  }

  call(cmd, args = {}, timeoutMs = 10000) {
    if (!this.available()) return Promise.reject(new Error('this needs Windows'));
    this.start();
    if (!this.proc) return Promise.reject(new Error(`couldn't start the Windows helper: ${this.lastError}`));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`the Windows helper didn't answer "${cmd}" within ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ id, cmd, ...args }) + '\n');
    });
  }

  stop() {
    if (!this.proc) return;
    try {
      this.proc.stdin.write(JSON.stringify({ id: ++this.seq, cmd: 'quit' }) + '\n');
    } catch (e) {
      /* ignore */
    }
    const p = this.proc;
    setTimeout(() => {
      try {
        p.kill();
      } catch (e) {
        /* ignore */
      }
    }, 800);
    this.proc = null;
  }
}

const winHelper = new WinHelper();
// A second helper just for the 1.5s monitor ('info', plain Win32). The helper
// answers one request at a time, and UI Automation calls - focus, snapshots,
// presses - wait on a hung program for as long as it's hung; sharing one
// helper would hold up exactly the check that reports the hang.
const winMonitor = new WinHelper();

// --- exit codes -----------------------------------------------------------------
// Windows reports a crash as an NTSTATUS in the exit code. "-1073741819" means
// nothing to most people; "access violation" does.
const NTSTATUS = {
  0xC0000005: ['access violation', 'it read or wrote memory it doesn\'t own — a crash in the program or a DLL it loaded'],
  0xC00000FD: ['stack overflow', 'usually runaway recursion'],
  0xC0000409: ['stack buffer overrun / fail-fast', 'the program or a library deliberately terminated after detecting corruption'],
  0xC0000374: ['heap corruption', 'memory was damaged, often by a write past the end of a buffer'],
  0xC0000094: ['integer divide by zero', ''],
  0xC0000017: ['out of memory', ''],
  0xC0000135: ['DLL not found', 'a DLL it needs isn\'t installed or isn\'t next to the .exe'],
  0xC0000139: ['entry point not found', 'a DLL is present but the wrong version'],
  0xC0000142: ['DLL initialisation failed', ''],
  0xC000007B: ['bad image format', 'usually a 32-bit/64-bit mismatch between the .exe and a DLL'],
  0xE0434352: ['unhandled .NET exception', 'the event log entry below usually names it'],
  0x80000003: ['breakpoint', 'a debug assertion or explicit breakpoint was hit'],
  0xC000013A: ['stopped with Ctrl+C', ''],
  0x40010004: ['terminated', 'another process ended it'],
};

function describeExitCode(code) {
  if (code == null) return { code, hex: '', name: 'no exit code', meaning: '', crashed: false };
  const u = code >>> 0;
  const hex = '0x' + u.toString(16).toUpperCase().padStart(8, '0');
  const known = NTSTATUS[u];
  if (known) {
    return { code, hex, name: known[0], meaning: known[1], crashed: u >= 0xC0000000 || u === 0xE0434352 || u === 0x80000003 };
  }
  if (code === 0) return { code, hex, name: 'exited normally', meaning: '', crashed: false };
  return { code, hex, name: `exit code ${code}`, meaning: '', crashed: u >= 0xC0000000 };
}

// --- a local proxy so the program's traffic can be seen --------------------------
// Programs that honour HTTP_PROXY / HTTPS_PROXY (.NET, Python, Go, curl and
// most CLI tools do) route through this. Plain HTTP is logged in full; HTTPS
// stays encrypted end to end, so only the host, timing and size are visible -
// the proxy never decrypts anything. Programs that only use the system proxy
// settings won't appear.
function startNativeProxy(onEvent) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const started = Date.now();
      let target;
      try {
        target = new URL(req.url);
      } catch (e) {
        res.writeHead(400);
        res.end();
        return;
      }
      const up = http.request(
        {
          hostname: target.hostname,
          port: target.port || 80,
          path: target.pathname + target.search,
          method: req.method,
          headers: req.headers,
        },
        (ur) => {
          res.writeHead(ur.statusCode || 502, ur.headers);
          ur.pipe(res);
          ur.on('end', () => onEvent({ kind: 'http', method: req.method, url: req.url, status: ur.statusCode, ms: Date.now() - started }));
        }
      );
      up.on('error', (err) => {
        onEvent({ kind: 'fail', method: req.method, url: req.url, error: err.message });
        try {
          res.writeHead(502);
          res.end();
        } catch (e) {
          /* ignore */
        }
      });
      req.pipe(up);
    });

    server.on('connect', (req, clientSocket, head) => {
      const started = Date.now();
      const [host, portStr] = String(req.url).split(':');
      let sent = 0;
      let received = 0;
      let finished = false;
      const finish = (err) => {
        if (finished) return;
        finished = true;
        onEvent(err
          ? { kind: 'fail', method: 'CONNECT', url: req.url, error: err.message }
          : { kind: 'tunnel', url: req.url, sent, received, ms: Date.now() - started });
      };
      const upstream = netMod.connect(Number(portStr) || 443, host, () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head && head.length) upstream.write(head);
        // Count only after the tunnel is up, so nothing is read too early.
        upstream.on('data', (d) => (received += d.length));
        clientSocket.on('data', (d) => (sent += d.length));
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      });
      upstream.on('error', (e) => {
        finish(e);
        clientSocket.destroy();
      });
      upstream.on('close', () => finish());
      clientSocket.on('error', () => upstream.destroy());
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, stop: () => server.close() }));
  });
}

function fmtBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

// Split an argument string the way a shell would, honouring quotes.
function splitArgs(s) {
  const out = [];
  let cur = '';
  let quote = null;
  let any = false;
  for (const ch of String(s || '')) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      any = true;
    } else if (/\s/.test(ch)) {
      if (cur || any) out.push(cur);
      cur = '';
      any = false;
    } else {
      cur += ch;
      any = true;
    }
  }
  if (cur || any) out.push(cur);
  return out;
}

// --- finding programs --------------------------------------------------------------
const EXE_SKIP = /^(unins\d*|uninstall|setup|install|crashpad_handler|vc_?redist.*|dxsetup|elevate|notification_helper|squirrel|update)\.exe$/i;

function findExes(dir) {
  const found = [];
  const look = (d, rel, depth) => {
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isFile() && /\.exe$/i.test(e.name) && !EXE_SKIP.test(e.name)) found.push(r);
      // Common build-output folders, a couple of levels deep.
      if (e.isDirectory() && depth < 3 && /^(bin|build|dist|out|release|debug|x64|x86|win-x64|win-x86|publish|net\d.*|target)$/i.test(e.name)) {
        look(full, r, depth + 1);
      }
    }
  };
  look(dir, '', 0);
  // Release builds before debug, shallow before deep.
  return found
    .sort((a, b) => {
      const score = (p) => (/debug/i.test(p) ? 10 : 0) + p.split('/').length;
      return score(a) - score(b) || a.localeCompare(b);
    })
    .slice(0, 40);
}

// --- the running program --------------------------------------------------------------
let nativeSession = null;
const ERROR_WORDS = /\b(error|exception|failed|failure|fatal|crash(ed)?|unhandled|not responding|stopped working|access denied)\b/i;

const CHROMIUM_A11Y = '--force-renderer-accessibility';
const CHROMIUM_UIA = '--enable-features=UiaProvider';
// Chromium's own files sit beside the program in Electron apps and most
// Chromium-based ones. A single-file (portable) build unpacks itself first,
// so nothing gives it away until its window opens - then it's remembered
// (settings.json `chromiumPrograms`) and gets the switch from the next start.
function isChromiumProgram(exePath) {
  const dir = path.dirname(exePath);
  const known = readSettings().chromiumPrograms;
  if (Array.isArray(known) && known.some((p) => String(p).toLowerCase() === exePath.toLowerCase())) return true;
  return ['chrome_100_percent.pak', 'LICENSES.chromium.html', path.join('resources', 'app.asar')]
    .some((f) => fs.existsSync(path.join(dir, f)));
}

function noteChromiumWindow(s, w) {
  if (s.a11y || s.chromiumNoted || !/^Chrome_WidgetWin/.test(w.cls || '')) return;
  s.chromiumNoted = true;
  const known = Array.isArray(readSettings().chromiumPrograms) ? readSettings().chromiumPrograms : [];
  if (!known.some((p) => String(p).toLowerCase() === s.exePath.toLowerCase())) {
    writeSettings({ chromiumPrograms: [...known, s.exePath].slice(-50) });
  }
  sendLog(`[Benchdrop] ${s.exe} is built on Chromium (Electron or similar). Its buttons and fields stay hidden from Trace and Autotest unless it's started with ${CHROMIUM_A11Y}, which Benchdrop will now do every time. Press Restart to apply it now.\n`);
}

async function startNativeProgram(projectDir, exeRel, argsStr, opts = {}) {
  const exePath = path.isAbsolute(exeRel) ? exeRel : path.join(projectDir, exeRel);
  currentProjectDir = projectDir;
  stopRunningApp();
  currentProjectType = 'native';

  if (!fs.existsSync(exePath)) {
    sendStatus('error', { message: `Couldn't find ${exeRel}.` });
    return;
  }
  const exe = path.basename(exePath);
  const tag = exe.replace(/\.exe$/i, '');

  const s = {
    exe, exePath, tag, projectDir, args: argsStr || '',
    pid: null, child: null, started: Date.now(), since: new Date().toISOString(),
    exited: false, primaryHwnd: 0, windows: new Map(), procs: new Map(),
    responding: true, lastFocus: '', lastTitle: '', docked: false, dockParent: null,
    timers: [], watchers: [], proxy: null, events: new EventEmitter(), restarting: false,
  };
  s.events.setMaxListeners(20);
  nativeSession = s;

  try {
    s.proxy = await startNativeProxy((ev) => onNativeNet(s, ev));
  } catch (e) {
    sendLog(`[Benchdrop] Couldn't start the traffic monitor (${e.message}); the program will run without it.\n`);
  }

  const env = { ...process.env };
  if (s.proxy) {
    const url = `http://127.0.0.1:${s.proxy.port}`;
    for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']) env[k] = url;
  }

  sendStatus('starting');
  sendLog(`\n$ ${exe}${argsStr ? ' ' + argsStr : ''}\n`);

  // An Electron (or other Chromium-based) program only shows its page's
  // buttons and fields to UI Automation when accessibility is on; otherwise
  // Trace sees its menu bar and nothing else, and Autotest has nothing to press.
  // Chromium's own UI Automation provider (CHROMIUM_UIA) makes reading the page
  // about a hundred times faster than the old bridge it uses by default
  // (CORE's main screen: 0.4s instead of 53s). A program that sets its own
  // --enable-features keeps them; it then gets accessibility, just slower.
  const args = splitArgs(argsStr);
  s.a11y = args.includes(CHROMIUM_A11Y);
  if (IS_WIN && !s.a11y && isChromiumProgram(exePath)) {
    const added = [CHROMIUM_A11Y];
    if (!args.some((a) => a.startsWith('--enable-features'))) added.push(CHROMIUM_UIA);
    args.unshift(...added);
    s.a11y = true;
    sendLog(`[Benchdrop] ${exe} is built on Chromium (Electron or similar), so it was started with ${added.join(' ')}: that lets Trace and Autotest see its buttons and fields.\n`);
  }

  let child;
  try {
    child = spawn(exePath, args, { cwd: path.dirname(exePath), env, windowsHide: false });
  } catch (err) {
    sendStatus('error', { message: `Couldn't start ${exe}: ${err.message}` });
    return;
  }
  s.child = child;
  s.pid = child.pid;

  const entry = { id: `native-${Date.now()}`, name: tag, child, buffer: '' };
  runningProcs.push(entry);
  sendProcs();

  const onOut = (isErr) => (d) => {
    const text = stripAnsi(d.toString());
    sendLog(text, tag);
    entry.buffer = (entry.buffer + text).slice(-20000);
    if (isErr) {
      for (const line of text.split('\n')) {
        if (ERROR_WORDS.test(line)) s.events.emit('stderr-error', line.trim().slice(0, 300));
      }
    }
    const busy = findPortConflict(text);
    if (busy) findPidsOnPort(busy).then((pids) => sendStatus('port-conflict', { port: busy, pids, script: tag }));
  };
  child.stdout.on('data', onOut(false));
  child.stderr.on('data', onOut(true));

  child.on('error', (err) => {
    const why = /UNKNOWN|ENOEXEC/.test(err.code || '')
      ? 'Windows refused to start it — it may be blocked, need administrator rights, or be built for a different architecture.'
      : err.message;
    sendStatus('error', { message: `Couldn't run ${exe}: ${why}` });
  });

  child.on('exit', (code) => onNativeExit(s, code, entry));

  sendStatus('native-started', {
    exe, pid: s.pid, path: exePath, args: argsStr || '',
    windows: winHelper.available(),
    proxy: !!s.proxy,
  });
  sendLog(`[Benchdrop] Started ${exe} (process ${s.pid}).` +
    (s.proxy ? ' Its network traffic is routed through Benchdrop so it can be logged.' : '') + '\n');

  if (winHelper.available()) {
    winHelper.start();
    winMonitor.start();
    const poll = setInterval(() => nativeMonitorTick(s).catch(() => {}), 1500);
    const focus = setInterval(() => nativeFocusTick(s).catch(() => {}), 900);
    s.timers.push(poll, focus);
    nativeMonitorTick(s).catch(() => {});
  } else {
    sendLog('[Benchdrop] Window tracking, live view, docking and Autotest for native programs need Windows. ' +
      'The program is running, and its output and exit are being logged.\n');
  }
  startNativeFileWatch(s);
  watchExeForRebuild(s);
}

function cleanupNative(s) {
  for (const t of s.timers) clearInterval(t);
  s.timers = [];
  for (const w of s.watchers) {
    try {
      w.close();
    } catch (e) {
      /* ignore */
    }
  }
  s.watchers = [];
  if (s.proxy) {
    try {
      s.proxy.stop();
    } catch (e) {
      /* ignore */
    }
    s.proxy = null;
  }
}

async function onNativeExit(s, code, entry) {
  s.exited = true;
  runningProcs = runningProcs.filter((p) => p.id !== entry.id);
  sendProcs();
  if (s.docked && s.primaryHwnd) {
    // The window's gone with the process; just forget the dock.
    s.docked = false;
  }
  cleanupNative(s);
  if (s.restarting || s.stoppedByUser) return;

  const info = describeExitCode(code);
  const ran = Math.round((Date.now() - s.started) / 1000);
  sendLog(`${info.crashed ? '' : '[Benchdrop] '}${s.exe} ${info.crashed ? 'CRASHED' : 'exited'} after ${ran}s — ${info.name}` +
    (info.hex && code !== 0 ? ` (${info.hex})` : '') + (info.meaning ? `: ${info.meaning}` : '') + '.\n',
    info.crashed ? 'bug' : undefined);
  s.events.emit('exit', info);
  sendStatus('native-exited', { exe: s.exe, ...info });

  // Windows writes crash details to the Application log a moment later.
  if (info.crashed && winHelper.available()) {
    await sleep(2500);
    try {
      const r = await winHelper.call('events', { since: s.since, exe: s.exe }, 15000);
      for (const ev of (r.events || [])) {
        const m = String(ev.message || '');
        const pick = (re) => { const x = re.exec(m); return x ? x[1].trim() : ''; };
        const module = pick(/Faulting module name:\s*([^,\r\n]+)/i);
        const exception = pick(/Exception code:\s*(\S+)/i) || pick(/Exception Info:\s*([^\r\n]+)/i);
        sendLog(`Windows event log (${ev.provider}): ` +
          (module ? `faulting module ${module}` : '') +
          (exception ? `${module ? ', ' : ''}exception ${exception}` : '') +
          (!module && !exception ? m.split('\n').slice(0, 4).join(' ').slice(0, 400) : '') + '\n', 'bug');
        s.events.emit('crash-detail', { module, exception, message: m });
      }
      if (!(r.events || []).length) {
        sendLog('[Benchdrop] Windows didn\'t record details for this crash in the Application log.\n');
      }
    } catch (e) {
      /* the log lookup is a bonus */
    }
  }
}

async function nativeMonitorTick(s) {
  if (s.exited || !s.pid) return;
  const r = await winMonitor.call('info', { pid: s.pid }, 8000);
  if (!r.ok) return;

  // Processes the program started (or that ended).
  const nowProcs = new Map((r.procs || []).map((p) => [p.pid, p]));
  for (const [pid, p] of nowProcs) {
    if (pid !== s.pid && !s.procs.has(pid)) traceLog(`page · ${s.tag}`, `started child process ${p.name} (${pid})`);
  }
  for (const [pid, p] of s.procs) {
    if (pid !== s.pid && !nowProcs.has(pid)) traceLog(`page · ${s.tag}`, `child process ${p.name} (${pid}) ended`);
  }
  s.procs = nowProcs;

  // Hangs: Windows marks a window "not responding" when it stops pumping messages.
  const root = nowProcs.get(s.pid);
  const responding = [...nowProcs.values()].every((p) => p.responding !== false);
  if (responding !== s.responding) {
    s.responding = responding;
    if (!responding) {
      sendLog(`${s.exe} is NOT RESPONDING.\n`, 'bug');
      s.events.emit('hang');
    } else {
      sendLog(`[Benchdrop] ${s.exe} is responding again.\n`);
    }
  }

  // Windows opening and closing, and the main window appearing.
  const nowWins = new Map((r.windows || []).map((w) => [w.hwnd, w]));
  for (const [hwnd, w] of nowWins) {
    if (!s.windows.has(hwnd)) {
      traceLog(`page · ${s.tag}`, `window opened: "${w.title || '(untitled)'}"`);
      noteChromiumWindow(s, w);
      if (s.primaryHwnd && hwnd !== s.primaryHwnd) inspectNewWindow(s, w).catch(() => {});
    }
  }
  for (const [hwnd, w] of s.windows) {
    if (!nowWins.has(hwnd)) {
      traceLog(`page · ${s.tag}`, `window closed: "${w.title || '(untitled)'}"`);
      if (s.inspected) s.inspected.delete(hwnd);
    }
  }
  s.windows = nowWins;

  if (!s.primaryHwnd || !nowWins.has(s.primaryHwnd)) {
    const main = (root && root.hwnd && nowWins.get(root.hwnd)) || [...nowWins.values()][0];
    if (main && main.hwnd !== s.primaryHwnd) {
      s.primaryHwnd = main.hwnd;
      sendStatus('native-window', { hwnd: main.hwnd, title: main.title });
    }
  }
  const primary = nowWins.get(s.primaryHwnd);
  if (primary && primary.title !== s.lastTitle) {
    if (s.lastTitle) traceLog(`page · ${s.tag}`, `title changed to "${primary.title}"`);
    s.lastTitle = primary.title;
  }

  const mem = [...nowProcs.values()].reduce((n, p) => n + (p.mem || 0), 0);
  sendStatus('native-info', {
    title: primary ? primary.title : '',
    responding, mem, windows: nowWins.size, procs: nowProcs.size,
    hasWindow: !!primary, docked: s.docked,
  });
}

// A new window after the main one is often a dialog - and an error dialog
// is exactly what a tester wants to hear about.
// Called by the monitor and by Autotest's snapshots - a dialog that opens and
// closes between two polls would otherwise go unseen - so each window is only
// read once.
async function inspectNewWindow(s, w, helper = winHelper) {
  if (!s.inspected) s.inspected = new Set();
  if (s.inspected.has(w.hwnd)) return;
  s.inspected.add(w.hwnd);
  const r = await helper.call('wintext', { hwnd: w.hwnd }, 6000);
  const text = `${r.title || ''} ${r.text || ''}`.trim();
  if (text && ERROR_WORDS.test(text)) {
    sendLog(`${s.exe} showed an error: "${text.slice(0, 300)}"\n`, 'bug');
    s.events.emit('dialog', { title: r.title, text: text.slice(0, 300) });
  } else if (text) {
    traceLog(`page · ${s.tag}`, `dialog says: "${text.slice(0, 200)}"`);
  }
}

async function nativeFocusTick(s) {
  if (!traceEnabled || s.exited || !s.pid) return;
  const r = await winHelper.call('focus', { pid: s.pid }, 5000);
  if (!r.ok || !r.focus) return;
  const f = r.focus;
  const key = `${f.type}|${f.label}`;
  if (key === s.lastFocus) return;
  s.lastFocus = key;
  traceLog(`app · ${s.tag}`, `focus ${f.type} "${f.secret ? '(hidden)' : f.label}"`);
}

function onNativeNet(s, ev) {
  s.events.emit('net', ev);
  if (!traceEnabled) return;
  const who = `net · ${s.tag}`;
  if (ev.kind === 'http') {
    traceLog(who, `${ev.status >= 400 ? '✗' : '←'} ${ev.status} ${ev.method} ${shortUrl(ev.url)} ${ev.ms}ms`);
  } else if (ev.kind === 'tunnel') {
    traceLog(who, `⇄ ${ev.url} (encrypted) ↑${fmtBytes(ev.sent)} ↓${fmtBytes(ev.received)} ${ev.ms}ms`);
  } else {
    traceLog(who, `✗ ${ev.method} ${shortUrl(ev.url)} — ${ev.error}`);
  }
}

// Files the program writes: its own folder, and a folder of its name in
// AppData, which is where most programs keep settings.
function startNativeFileWatch(s) {
  const dirs = [path.dirname(s.exePath)];
  const base = s.tag.toLowerCase();
  for (const root of [process.env.APPDATA, process.env.LOCALAPPDATA].filter(Boolean)) {
    try {
      for (const d of fs.readdirSync(root, { withFileTypes: true })) {
        if (d.isDirectory() && d.name.toLowerCase() === base) dirs.push(path.join(root, d.name));
      }
    } catch (e) {
      /* ignore */
    }
  }
  const recent = new Map();
  for (const dir of dirs) {
    try {
      const w = fs.watch(dir, { recursive: true }, (_evt, file) => {
        if (!traceEnabled || !file) return;
        const rel = String(file);
        if (/(^|[\\/])(\.git|node_modules)([\\/]|$)/.test(rel)) return;
        const key = path.join(dir, rel);
        const now = Date.now();
        if (now - (recent.get(key) || 0) < 1000) return;
        recent.set(key, now);
        const where = dir === path.dirname(s.exePath) ? '' : ` (in ${path.basename(path.dirname(dir))}\\${path.basename(dir)})`;
        traceLog(`file · ${s.tag}`, `changed ${rel}${where}`);
      });
      s.watchers.push(w);
    } catch (e) {
      /* a folder we can't watch just isn't watched */
    }
  }
}

// Rebuilding the .exe restarts it when Live is on. Windows locks a running
// .exe, so most builds need Stop first - but tools that replace the file by
// renaming (and builds to a copy) do trigger this.
function watchExeForRebuild(s) {
  let timer = null;
  try {
    const w = fs.watch(path.dirname(s.exePath), (_evt, file) => {
      if (!file || String(file).toLowerCase() !== s.exe.toLowerCase()) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (nativeSession !== s) return;
        if (liveReloadEnabled()) {
          sendLog(`[Benchdrop] ${s.exe} was rebuilt — restarting it.\n`);
          restartNativeProgram();
        } else {
          sendLog(`[Benchdrop] ${s.exe} was rebuilt. Press Restart to run the new version.\n`);
        }
      }, 1500);
    });
    s.watchers.push(w);
  } catch (e) {
    /* ignore */
  }
}

function stopNativeProgram(opts = {}) {
  const s = nativeSession;
  if (!s) return;
  s.stoppedByUser = !opts.keepSession;
  if (s.docked && s.primaryHwnd && winHelper.available()) {
    winHelper.call('undock', { hwnd: s.primaryHwnd }, 4000).catch(() => {});
    s.docked = false;
  }
  cleanupNative(s);
  if (s.child && s.child.pid && !s.exited) killTree(s.child.pid, opts.wait);
}

// End a process and everything it started. `wait` (used on quit) blocks until
// taskkill has finished, since Benchdrop is about to exit.
function killTree(pid, wait) {
  if (wait && process.platform === 'win32') {
    try {
      require('child_process').spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, timeout: 8000 });
    } catch (e) {
      /* already gone */
    }
    return;
  }
  try {
    treeKill(pid);
  } catch (e) {
    /* ignore */
  }
}

async function restartNativeProgram() {
  const s = nativeSession;
  if (!s) return false;
  s.restarting = true;
  stopNativeProgram({ keepSession: true });
  await sleep(700);
  await startNativeProgram(s.projectDir, s.exePath, s.args);
  return true;
}

// --- capture -------------------------------------------------------------------------
function parentHwnd() {
  const buf = mainWindow.getNativeWindowHandle();
  return buf.length >= 8 ? Number(buf.readBigInt64LE(0)) : buf.readInt32LE(0);
}

async function findWindowSource(hwnd, size) {
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: size || { width: 1, height: 1 },
    fetchWindowIcons: false,
  });
  return sources.find((src) => src.id.startsWith(`window:${hwnd}:`)) || null;
}

// An image of the program's window at its real size. Docked or not, it's a
// window of its own, so it's captured directly.
async function captureNativeImage(s) {
  if (!s || !s.primaryHwnd) throw new Error('the program has no window to capture yet');
  const w = s.windows.get(s.primaryHwnd) || {};
  const size = { width: Math.max(320, w.w || 1920), height: Math.max(240, w.h || 1080) };
  const src = await findWindowSource(s.primaryHwnd, size);
  if (!src) throw new Error("couldn't find the program's window — it may be minimised, or not responding");
  return src.thumbnail;
}

ipcMain.handle('native-capture', async (_e, { rect } = {}) => {
  const s = nativeSession;
  try {
    let img = await captureNativeImage(s);
    let note = `${s.exe} window`;
    if (rect) {
      const sz = img.getSize();
      const r = {
        x: Math.max(0, Math.round(rect.x * sz.width)),
        y: Math.max(0, Math.round(rect.y * sz.height)),
        width: Math.max(1, Math.round(rect.width * sz.width)),
        height: Math.max(1, Math.round(rect.height * sz.height)),
      };
      img = img.crop(r);
      note = `region of the ${s.exe} window (${r.width}x${r.height})`;
    } else {
      const sz = img.getSize();
      note += ` (${sz.width}x${sz.height})`;
    }
    const buffer = img.toPNG();
    const file = shotFileName(rect ? 'region' : 'window');
    fs.writeFileSync(file, buffer);
    try {
      clipboard.writeImage(img);
    } catch (e) {
      /* optional */
    }
    let thumb = null;
    try {
      thumb = img.resize({ width: 240 }).toDataURL();
    } catch (e) {
      /* optional */
    }
    sendLog(`[Benchdrop] Screenshot saved — ${note}. Copied to clipboard.\n${file}\n`);
    sendStatus('capture-done', { file, note, thumb, name: path.basename(file) });
    return { file, note };
  } catch (err) {
    sendLog(`[Benchdrop] Screenshot failed: ${err.message}\n`);
    return null;
  }
});

// One frame of the window, for picking a region or as a fallback live view.
ipcMain.handle('native-frame', async () => {
  try {
    const img = await captureNativeImage(nativeSession);
    const sz = img.getSize();
    return { dataUrl: img.toDataURL(), width: sz.width, height: sz.height };
  } catch (e) {
    return null;
  }
});

// The id the page needs to show a live view of the window.
ipcMain.handle('native-source', async () => {
  const s = nativeSession;
  if (!s || !s.primaryHwnd || s.exited) return null;
  try {
    const src = await findWindowSource(s.primaryHwnd);
    return src ? src.id : null;
  } catch (e) {
    return null;
  }
});

// --- docking -------------------------------------------------------------------------
// The pane's rectangle on screen, in physical pixels. The page starts below
// Electron's menu bar, which only the content bounds account for.
function dockScreenRect(b) {
  const c = mainWindow.getContentBounds();
  const at = { x: Math.round(c.x + b.x), y: Math.round(c.y + b.y) };
  const p = screen.dipToScreenPoint(at);
  const scale = screen.getDisplayNearestPoint(at).scaleFactor || 1;
  return { x: p.x, y: p.y, w: Math.round(b.w * scale), h: Math.round(b.h * scale) };
}

ipcMain.handle('native-dock', async (_e, { bounds }) => {
  const s = nativeSession;
  if (!s || !s.primaryHwnd || s.exited) return { ok: false, message: 'There is no program window to dock yet.' };
  try {
    const px = dockScreenRect(bounds);
    const r = await winHelper.call('dock', { hwnd: s.primaryHwnd, parent: parentHwnd(), ...px }, 6000);
    if (!r.ok) return { ok: false, message: r.error };
    s.docked = true;
    s.dockBounds = bounds;
    sendLog(`[Benchdrop] Docked ${s.exe} inside Benchdrop. Undock returns it to its own window.\n`);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

// Moves arrive in bursts while a window is dragged; send one at a time and
// always finish on the latest position.
let dockMoving = false;
let dockMoveAgain = false;
async function moveDocked(s) {
  if (dockMoving) {
    dockMoveAgain = true;
    return;
  }
  dockMoving = true;
  do {
    dockMoveAgain = false;
    await winHelper.call('move', { hwnd: s.primaryHwnd, parent: parentHwnd(), ...dockScreenRect(s.dockBounds) }, 4000).catch(() => {});
  } while (dockMoveAgain && s.docked);
  dockMoving = false;
}

ipcMain.handle('native-move', async (_e, { bounds }) => {
  const s = nativeSession;
  if (!s || !s.docked) return false;
  s.dockBounds = bounds;
  await moveDocked(s);
  return true;
});

ipcMain.handle('native-show', async (_e, { visible, front }) => {
  const s = nativeSession;
  if (!s || !s.primaryHwnd) return false;
  await winHelper.call('show', { hwnd: s.primaryHwnd, visible: !!visible, front: !!front }, 4000).catch(() => {});
  return true;
});

ipcMain.handle('native-undock', async () => {
  const s = nativeSession;
  if (!s || !s.docked) return false;
  await winHelper.call('undock', { hwnd: s.primaryHwnd }, 6000).catch(() => {});
  s.docked = false;
  sendLog(`[Benchdrop] ${s.exe} is back in its own window.\n`);
  return true;
});

ipcMain.handle('native-restart', async () => restartNativeProgram());

ipcMain.handle('run-native', async (_e, { projectDir, exe, args }) => {
  await startNativeProgram(projectDir, exe, args || '');
  return true;
});

// A quick health check of the Windows-specific parts, runnable from the Help
// menu - so if something doesn't work on a given machine, the log says which
// piece and why rather than a feature silently doing nothing.
async function nativeSelfCheck() {
  sendLog('[Benchdrop] Checking native program support…\n');
  if (!IS_WIN) {
    sendLog('[Benchdrop]   ✗ Native programs need Windows; this is ' + process.platform + '.\n');
    return;
  }
  const line = (ok, text) => sendLog(`[Benchdrop]   ${ok ? '✓' : '✗'} ${text}\n`);
  line(fs.existsSync(winHelper.scriptPath()), `helper script at ${winHelper.scriptPath()}`);
  try {
    const r = await winHelper.call('ping', {}, 20000);
    line(r.ok && r.proxies !== false, `PowerShell helper running (PowerShell ${r.ps})` +
      (r.proxies === false ? ', but UI Automation\'s support for standard Windows controls didn\'t load' : ''));
  } catch (e) {
    line(false, `PowerShell helper: ${e.message}`);
    return;
  }
  try {
    const r = await winMonitor.call('info', { pid: process.pid }, 15000);
    line(r.ok, `process and window tracking (found ${(r.windows || []).length} Benchdrop window${(r.windows || []).length === 1 ? '' : 's'})`);
  } catch (e) {
    line(false, `process tracking: ${e.message}`);
  }
  try {
    const r = await winHelper.call('snapshot', { pid: process.pid }, 20000);
    const n = (r.elements || []).length;
    line(r.ok && n > 0, `UI Automation (listed ${n} control${n === 1 ? '' : 's'} in Benchdrop itself)`);
  } catch (e) {
    line(false, `UI Automation: ${e.message}`);
  }
  try {
    const src = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1, height: 1 } });
    line(src.length > 0, `window capture (${src.length} windows visible)`);
  } catch (e) {
    line(false, `window capture: ${e.message}`);
  }
  sendLog('[Benchdrop] Check finished.\n');
}

ipcMain.handle('native-self-check', async () => {
  await nativeSelfCheck();
  return true;
});

// ===========================================================================
// Claude connector
// ---------------------------------------------------------------------------
// Claude (Desktop or Code) drives Benchdrop through mcp/benchdrop-mcp.js, an
// MCP server Claude starts. That script holds no logic: it forwards each tool
// call here, to a small HTTP endpoint on 127.0.0.1 guarded by a random token
// written to connector.json. Every action goes through the same drivers and
// the same vetChoice() rules as Autotest, and is logged with [claude], so the
// person can see exactly what Claude did.
// ===========================================================================

function connectorScriptPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'mcp', 'benchdrop-mcp.js')
    : path.join(__dirname, 'mcp', 'benchdrop-mcp.js');
}
function connectorFile() {
  return path.join(app.getPath('userData'), 'connector.json');
}

let connector = null;   // { server, port, token }
let claudeSnap = null;  // the last snapshot Claude was given; ids refer to it

// --- asking the window -------------------------------------------------------
// Opening and running a project go through the renderer, exactly as if the
// person had dropped it and pressed Run, so Claude gets the same pickers,
// defaults and setup notes.
const rendererAsks = new Map();
let rendererAskSeq = 0;
function askRenderer(op, args = {}, timeoutMs = 20000) {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.reject(new Error('Benchdrop has no window open'));
  const id = ++rendererAskSeq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      rendererAsks.delete(id);
      reject(new Error(`Benchdrop's window didn't answer "${op}"`));
    }, timeoutMs);
    rendererAsks.set(id, { resolve, reject, timer });
    mainWindow.webContents.send('connector-request', { id, op, args });
  });
}
ipcMain.handle('connector-reply', async (_e, { id, result, error }) => {
  const p = rendererAsks.get(id);
  if (!p) return false;
  clearTimeout(p.timer);
  rendererAsks.delete(id);
  if (error) p.reject(new Error(error));
  else p.resolve(result);
  return true;
});

function claudeLog(line) {
  sendLog(`${line}\n`, 'claude');
}

// --- the tools -----------------------------------------------------------------
const toolText = (t) => ({ content: [{ type: 'text', text: t }] });
const toolRefusal = (t) => ({ content: [{ type: 'text', text: t }], isError: true });

async function currentTestDriver() {
  const s = nativeSession;
  if (s && !s.exited && s.pid) {
    const r = testDriver({ native: true });
    if (r.driver) return r;
  }
  const id = await askRenderer('appview');
  if (id == null) return { message: 'Nothing is running — open and run a project first (benchdrop_open, then benchdrop_run).' };
  return testDriver({ webContentsId: id });
}

function describePicker(p) {
  switch (p.kind) {
    case 'scripts':
      return 'Choose scripts to run together (benchdrop_run "scripts"):\n' +
        p.scripts.map((x) => `- ${x.name}${x.checked ? ' (pre-selected)' : ''}${x.cmd ? ` — ${x.cmd}` : ''}`).join('\n') +
        (p.note ? `\nSetup note: ${p.note}` : '');
    case 'native':
      return `Programs (benchdrop_run "program"): ${p.programs.join(', ')} — default ${p.selected}.`;
    case 'mode':
      return `It has both a web page and Python scripts (benchdrop_run "entry"): ${[...p.pages, 'python'].join(', ')}.`;
    case 'runtime':
      return `${p.runtime} project${p.available ? '' : ` — ${p.runtime} is NOT installed on this computer, so it can't run until the person installs it`}. ` +
        `Run options (benchdrop_run "option"): ${p.options.map((o) => `"${o}"`).join(', ')}.`;
    case 'python':
      return `Python ${p.available ? '' : '(NOT installed on this computer) '}— scripts (benchdrop_run "entry"): ${p.entries.join(', ')}` +
        `${p.hasRequirements ? '; it has requirements.txt (install_requirements)' : ''}.`;
    default:
      return '';
  }
}

function describeState(st) {
  const L = [];
  const s = nativeSession;
  if (st.picker) {
    L.push(`Project: ${st.project || '(open)'} — ready to run.`);
    L.push(describePicker(st.picker));
  } else if (s && st.native) {
    L.push(`Program: ${s.exe} (process ${s.pid}) — ${s.exited ? 'exited' : s.responding === false ? 'NOT RESPONDING' : 'running'}` +
      `${s.docked ? ', docked in the pane' : ''}.`);
    const wins = [...s.windows.values()].map((w) => `"${w.title || '(untitled)'}"`);
    if (wins.length) L.push(`Windows: ${wins.join(', ')}`);
  } else if (st.url) {
    L.push(`Project: ${st.project || '(open)'} — running at ${st.url}.`);
  } else {
    L.push(st.project ? `Project: ${st.project} — not running.` : 'Nothing is open.');
  }
  L.push(`Benchdrop says: ${st.indicator}`);
  if (autotest && autotest.running) L.push(`An autotest is running (step ${autotest.steps.length} of ${autotest.maxSteps}).`);
  return L.join('\n');
}

function describeSnapshot(snap) {
  const L = [`Screen: ${snap.url}${snap.title && snap.title !== snap.url ? ` — ${snap.title}` : ''}`];
  if (snap.text) L.push(`Visible text: ${String(snap.text).slice(0, 1500)}`);
  L.push('Controls:');
  for (const e of snap.elements.slice(0, 150)) {
    const flags = [e.disabled && 'disabled', e.risky && 'risky', e.secret && 'secret', e.external && 'external']
      .filter(Boolean).join(', ');
    L.push(`  ${e.id}  ${e.kind}  "${e.label}"${flags ? `  [${flags}]` : ''}`);
  }
  if (!snap.elements.length) L.push('  (none it can use)');
  return L.join('\n');
}

const TOOL_HANDLERS = {
  async _ping() {
    return toolText('ok');
  },

  async benchdrop_open({ path: target }) {
    if (!target || typeof target !== 'string') return toolRefusal('Give a path or a link to open.');
    // Opening clears the log, as a drop does, so say so afterwards.
    const st = await askRenderer('open', { target }, 10 * 60 * 1000);
    claudeLog(`opened ${target}`);
    claudeSnap = null;
    return toolText(describeState(st));
  },

  async benchdrop_run(args) {
    const st0 = await askRenderer('state');
    if (!st0.picker) {
      return toolRefusal(st0.url || (nativeSession && !nativeSession.exited)
        ? 'It is already running. Use benchdrop_stop first to run it differently.'
        : 'Open a project first (benchdrop_open).');
    }
    const picked = await askRenderer('run', args || {});
    if (picked && picked.refused) return toolRefusal(picked.refused);
    claudeLog(`run ${(picked && picked.describe) || ''}`);
    claudeSnap = null;
    // Wait for it to come up: a page in the pane, a program window, or an end.
    const t0 = Date.now();
    let st = st0;
    while (Date.now() - t0 < 180000) {
      await sleep(1000);
      st = await askRenderer('state');
      const s = nativeSession;
      if (st.url || (s && (s.primaryHwnd || s.exited)) || st.settled) break;
    }
    const showing = st.url || (nativeSession && nativeSession.primaryHwnd);
    return toolText(describeState(st) + (showing ? '' : '\nIt has not shown anything yet — check benchdrop_log for what it is doing.'));
  },

  async benchdrop_status() {
    return toolText(describeState(await askRenderer('state')));
  },

  async benchdrop_snapshot() {
    const { driver, message } = await currentTestDriver();
    if (!driver) return toolRefusal(message);
    claudeSnap = await driver.snapshot();
    return toolText(describeSnapshot(claudeSnap));
  },

  async benchdrop_act(args = {}) {
    if (autotest && autotest.running) return toolRefusal('An autotest is running; wait for it to finish.');
    const { driver, message } = await currentTestDriver();
    if (!driver) return toolRefusal(message);
    const snap = claudeSnap || (claudeSnap = await driver.snapshot());
    const at = newTestSession(driver, { allowRisky: false });
    at.canGoBack = driver.canGoBack(snap);
    at.lastUrl = snap.url;
    const choice = vetChoice(at, snap, args);
    if (choice.refused) {
      claudeLog(`refused: ${choice.refused}`);
      return toolRefusal(`Refused: ${choice.refused}.`);
    }
    if (driver.kind === 'native') choice.native = true;
    const describe = describeAction(choice, null);
    claudeLog(`${describe}`);
    at.steps.push({ describe, url: snap.url, at: 0 });
    driver.attach(at);
    try {
      if (choice.action === 'back') await driver.back(at);
      else {
        const r = await Promise.resolve(driver.act(choice)).catch((e) => ({ ok: false, why: e.message }));
        if (!r || !r.ok) return toolRefusal(`Couldn't ${describe}: ${r ? (r.why || r.error) : 'no response'}`);
      }
      await settle(at);
      // For a program, a new dialog is read as part of a snapshot; take one
      // now so an error box that just opened is reported with this action.
      claudeSnap = driver.kind === 'native' ? await driver.snapshot().catch(() => null) : null;
    } finally {
      driver.detach();
    }
    const found = at.issues.map((i) => `- [${i.severity}] ${i.type}: ${i.message}`);
    return toolText(`Done: ${describe}.\n` +
      (found.length ? `Detected afterwards:\n${found.join('\n')}` : 'Nothing went wrong that Benchdrop could detect.') +
      '\nTake a new snapshot before the next action.');
  },

  async benchdrop_screenshot() {
    const { driver, message } = await currentTestDriver();
    if (!driver) return toolRefusal(message);
    const png = await driver.screenshot().catch(() => null);
    if (!png || !png.length) return toolRefusal("Benchdrop couldn't take a picture right now — the program may be minimised or not responding.");
    return { content: [{ type: 'image', data: Buffer.from(png).toString('base64'), mimeType: 'image/png' }] };
  },

  async benchdrop_log({ lines } = {}) {
    const n = Math.max(1, Math.min(2000, Number(lines) || 150));
    const log = await askRenderer('log', { lines: n });
    return toolText(log || '(the log is empty)');
  },

  async benchdrop_autotest({ max_steps: maxSteps } = {}) {
    const { driver, message } = await currentTestDriver();
    if (!driver) return toolRefusal(message);
    claudeLog('start an autotest');
    const r = startAutotest(driver.kind === 'native'
      ? { native: true, maxSteps, allowRisky: false }
      : { webContentsId: await askRenderer('appview'), maxSteps, allowRisky: false });
    if (!r.ok) return toolRefusal(r.message);
    const report = await r.done;
    claudeSnap = null;
    if (!report) return toolRefusal('The autotest stopped with an error — see benchdrop_log.');
    return toolText(fs.readFileSync(report, 'utf8'));
  },

  async benchdrop_stop() {
    claudeLog('stop');
    await askRenderer('stop');
    claudeSnap = null;
    return toolText('Stopped.');
  },
};

async function runConnectorTool(name, args) {
  const fn = TOOL_HANDLERS[name];
  if (!fn) throw new Error(`unknown tool ${name}`);
  return fn(args || {});
}

// --- the endpoint -------------------------------------------------------------
function startConnector() {
  if (readSettings().connector === false) return;
  const token = crypto.randomBytes(24).toString('hex');
  const server = http.createServer((req, res) => {
    const answer = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    // Only the connector script, never a web page: browsers send an Origin.
    if (req.headers.origin || req.method !== 'POST' || req.url !== '/tool') return answer(404, { ok: false });
    if (req.headers.authorization !== `Bearer ${token}`) return answer(401, { ok: false, error: 'not authorised' });
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (d) => {
      body += d;
      if (body.length > 1e6) req.destroy();
    });
    req.on('end', async () => {
      let call;
      try {
        call = JSON.parse(body);
      } catch (e) {
        return answer(400, { ok: false, error: 'bad request' });
      }
      try {
        answer(200, { ok: true, result: await runConnectorTool(call.name, call.arguments) });
      } catch (err) {
        answer(200, { ok: true, result: toolRefusal(`Benchdrop couldn't do that: ${err.message}`) });
      }
    });
  });
  server.on('error', (err) => sendLog(`[Benchdrop] The Claude connector couldn't start: ${err.message}\n`));
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    connector = { server, port, token };
    const launch = app.isPackaged
      ? { command: process.execPath, args: [] }
      : { command: process.execPath, args: [app.getAppPath()], cwd: app.getAppPath() };
    fs.writeFileSync(connectorFile(), JSON.stringify({ port, token, pid: process.pid, version: app.getVersion(), launch }, null, 2),
      { encoding: 'utf8', mode: 0o600 });
  });
}

function stopConnector() {
  if (!connector) return;
  try {
    connector.server.close();
  } catch (e) {
    /* ignore */
  }
  // Drop the port and token, but keep how to start Benchdrop: the Claude
  // Desktop extension runs from Claude's own folder, so this record is the
  // only way it can find a Benchdrop installed somewhere other than the default.
  try {
    const cur = JSON.parse(fs.readFileSync(connectorFile(), 'utf8'));
    if (cur.pid === process.pid) {
      fs.writeFileSync(connectorFile(), JSON.stringify({ version: cur.version, launch: cur.launch }, null, 2), 'utf8');
    }
  } catch (e) {
    /* already gone */
  }
  connector = null;
}

// How to add the connector to each Claude app, with this install's paths.
// Claude Code runs the script with Benchdrop's own executable acting as
// Node, so nothing else has to be installed.
function connectorSetup() {
  const q = (p) => `"${p}"`;
  return {
    on: !!connector,
    mcpb: app.isPackaged
      ? path.join(process.resourcesPath, 'mcp', 'benchdrop.mcpb')
      : path.join(__dirname, 'mcp', 'benchdrop.mcpb'),
    claudeCode: `claude mcp add benchdrop --scope user --env ELECTRON_RUN_AS_NODE=1 -- ${q(process.execPath)} ${q(connectorScriptPath())}`,
  };
}

ipcMain.handle('connector-setup', async () => {
  const s = connectorSetup();
  return { ...s, mcpbExists: fs.existsSync(s.mcpb) };
});
ipcMain.handle('connector-install-desktop', async () => {
  const s = connectorSetup();
  if (!fs.existsSync(s.mcpb)) return { ok: false, message: 'The Claude Desktop extension file is missing from this install.' };
  // Opening the file isn't enough: the Microsoft Store build of Claude Desktop
  // doesn't claim .mcpb files, so Windows just asks which app to use. Dragging
  // the file onto Claude Desktop's Settings → Extensions page always works.
  shell.showItemInFolder(s.mcpb);
  return { ok: true };
});
ipcMain.handle('connector-copy', async (_e, { value }) => {
  clipboard.writeText(String(value || ''));
  return true;
});
