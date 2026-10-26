// SPDX-License-Identifier: LicenseRef-Apache-2.0-with-Commons-Clause
// Copyright (c) 2026 Richard Griffith (d/b/a Griffith Software) — https://griffith.software
// Tests that need a real browser window or a real child process.
// Run with `npm run test:electron` (on Linux, `xvfb-run -a npm run test:electron`).
//
// Three parts:
//   A  Autotest against a real page with known bugs, through the web driver
//   B  Autotest against a simulated native program, through the native driver
//   C  The native launcher for real: output, traffic proxy, exit reporting
//
// What this cannot cover: anything that needs Windows itself - UI Automation,
// window capture, the live mirror, docking. Those are exercised on a Windows
// machine by Help > Check native program support.
const { app, BrowserWindow, session, webContents, shell, nativeImage, clipboard } = require('electron');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const treeKill = require('tree-kill');
const { source } = require('./_load');

const src = source();
const netPart = (() => {
  const a = src.indexOf('const ROUTINE_NET');
  const b = src.indexOf('\n}\n', src.indexOf('function installNetworkHooks')) + 3;
  return src.slice(a, b);
})();
const atBlock = src.slice(src.indexOf('let autotest = null;'), src.indexOf('// The state of one test session.'));
// The native driver reads new dialogs as it snapshots.
const inspectPart = src.slice(src.indexOf('const ERROR_WORDS'), src.indexOf('\n', src.indexOf('const ERROR_WORDS'))) + '\n' +
  src.slice(src.indexOf('async function inspectNewWindow'), src.indexOf('async function nativeFocusTick'));
const startHandler = src.slice(src.indexOf('// The state of one test session.'), src.indexOf("ipcMain.handle('autotest-stop'"));
const nativeBlock = src.slice(src.indexOf("const { EventEmitter } = require('events');"));

let pass = 0;
let fail = 0;
const lines = [];
const check = (label, ok) => { (ok ? pass++ : fail++); lines.push(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadAutotest(tmp, extra = {}) {
  const logs = [], statuses = [];
  const env = {
    app, session, webContents, shell, path, fs, crypto, nativeImage,
    APP_PARTITION: 'persist:bdtest', TRACE_MARK: '@@bdtrace@@',
    netStarted: new Map(), currentProjectDir: '/tmp/test-app',
    traceLog: () => {},
    shortUrl: (u) => String(u).split('?')[0].replace(/^http:\/\/127\.0\.0\.1:\d+/, ''),
    sendLog: (t, s) => logs.push((s ? `[${s}] ` : '') + t),
    sendStatus: (s, p) => statuses.push([s, p]),
    readSettings: () => ({}),
    sanitizeName: (n) => n.replace(/[^a-z0-9-_]+/gi, '-'),
    shotsDir: () => path.join(tmp, 'screenshots'),
    ipcMain: { handle: (n, fn) => { env.handlers[n] = fn; } },
    handlers: {},
    ...extra,
  };
  const code = `
    let traceEnabled = false, netHooksInstalled = false;
    const netStarted = __env.netStarted;
    const { app, session, webContents, shell, path, fs, crypto, APP_PARTITION, TRACE_MARK,
            traceLog, shortUrl, sendLog, sendStatus, readSettings, sanitizeName, shotsDir, ipcMain } = __env;
    let currentProjectDir = __env.currentProjectDir;
    let nativeSession = __env.nativeSession || null;
    const winHelper = __env.winHelper || { available: () => false };
    const captureNativeImage = async () => __env.nativeImage.createEmpty();
    ${netPart}
    ${inspectPart}
    ${atBlock}
    ${startHandler}
    __env.api = { makeNativeDriver, runAutotest };
  `;
  new Function('__env', code)(env);
  return { env, logs, statuses };
}

// A stand-in for a native program, answering what bdwin.ps1 answers.
function fakeProgram() {
  const s = { exe: 'Ledger.exe', pid: 4242, exited: false, events: new EventEmitter(), primaryHwnd: 100 };
  let settingsOpen = false;
  const pressed = [];
  let ids = {};
  const helper = {
    pressed,
    async call(cmd, args) {
      if (cmd === 'snapshot') {
        ids = {};
        const el = (id, kind, label, extra = {}) => { ids[id] = label; return { id, kind, type: kind, label, disabled: false, secret: false, ...extra }; };
        const main = [
          el('w1', 'field', 'Name'), el('w2', 'field', 'Password', { secret: true }),
          el('w3', 'button', 'Save'), el('w4', 'button', 'Open settings'),
          el('w5', 'button', 'Delete all records'), el('w6', 'button', 'Exit'),
          el('w7', 'button', 'Generate report'),
        ];
        const dialog = [el('w8', 'toggle', 'Dark mode'), el('w9', 'button', 'Apply')];
        const windows = [{ hwnd: 100, title: 'Ledger' }];
        if (settingsOpen) windows.push({ hwnd: 200, title: 'Settings' });
        return { ok: true, windows, elements: settingsOpen ? dialog : main, text: '' };
      }
      if (cmd === 'act') {
        if (args.action === 'escape') { settingsOpen = false; pressed.push('ESC'); return { ok: true }; }
        const label = ids[args.target];
        pressed.push(label);
        if (label === 'Open settings') settingsOpen = true;
        if (label === 'Apply') setTimeout(() => s.events.emit('dialog', { title: 'Error', text: 'Error: could not write settings.ini (access denied)' }), 40);
        if (label === 'Generate report') setTimeout(() => {
          s.exited = true;
          s.events.emit('exit', { code: -1073741819, hex: '0xC0000005', name: 'access violation', meaning: 'bad memory', crashed: true });
          s.events.emit('crash-detail', { module: 'reportgen.dll', exception: '0xc0000005' });
        }, 40);
        return { ok: true };
      }
      return { ok: false, error: 'unknown' };
    },
  };
  return { s, helper };
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-tests-'));
  app.setPath('userData', tmp);
  fs.mkdirSync(path.join(tmp, 'screenshots'), { recursive: true });

  // ===================== A. web driver =====================
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    const json = (c) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end('{}'); };
    if (req.url === '/favicon.ico') { res.writeHead(404); return res.end(); }
    if (req.url === '/api/data') return json(200);
    if (req.url === '/api/stats') return json(500);
    if (req.url === '/api/export') return json(404);
    if (req.url === '/api/profile') return json(200);
    if (req.url === '/api/delete') return json(200);
    const page = (t, b) => `<!doctype html><html><head><title>${t}</title></head><body>${b}</body></html>`;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (req.url.startsWith('/settings')) return res.end(page('Settings', `<button onclick="fetch('/api/export')">Export CSV</button><a href="/">Home</a>`));
    res.end(page('Home', `<nav><a href="/settings">Settings</a> <a href="https://example.com/docs">External docs</a></nav>
      <button onclick="fetch('/api/data')">Load data</button>
      <button onclick="fetch('/api/stats')">Refresh stats</button>
      <button onclick="null.name">Show profile</button>
      <button onclick="fetch('/api/delete',{method:'POST'})">Delete account</button>
      <form onsubmit="event.preventDefault(); fetch('/api/profile',{method:'POST'})">
        <input name="fullname" placeholder="Your name"><input type="password" placeholder="Password">
        <button type="submit">Save profile</button></form>`));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;

  const web = loadAutotest(tmp);
  const host = new BrowserWindow({ width: 1000, height: 760, show: false,
    webPreferences: { webviewTag: true, nodeIntegration: true, contextIsolation: false } });
  await host.loadURL('data:text/html,' + encodeURIComponent(
    `<html><body style="margin:0"><webview id="v" src="${base}" partition="persist:bdtest" style="width:100%;height:100vh"></webview></body></html>`));
  await sleep(2500);
  const gid = await host.webContents.executeJavaScript(`document.getElementById('v').getWebContentsId()`);
  await web.env.handlers['autotest-start'](null, { webContentsId: gid, mode: 'explore', maxSteps: 40 });
  let t0 = Date.now();
  while (!web.statuses.some(([s]) => s === 'autotest-done') && Date.now() - t0 < 120000) await sleep(300);
  const wdone = web.statuses.find(([s]) => s === 'autotest-done')[1];
  const wbugs = web.logs.filter((l) => l.startsWith('[bug]')).join('');
  const wreport = fs.readFileSync(wdone.report, 'utf8');

  lines.push('--- A. web page ---');
  check('finds a 500 response', /api\/stats → 500/.test(wbugs));
  check('finds a 404 on a second page', /api\/export → 404/.test(wbugs));
  check('finds an uncaught exception', /uncaught exception/i.test(wbugs));
  check('never clicks "Delete account"', !hits.some((h) => h.includes('/api/delete')));
  check('never follows an external link', !/External docs/.test(web.logs.join('')));
  check('fills a form before submitting it', hits.includes('POST /api/profile'));
  check('lists skipped risky controls', /skipped as risky[\s\S]*Delete account/.test(wreport));
  check('ignores the browser favicon request', !/favicon/.test(wbugs));
  check('report includes repro steps', /Steps leading up to it/.test(wreport));

  // ===================== B. native driver =====================
  const { s: prog, helper } = fakeProgram();
  const nat = loadAutotest(tmp);
  const drv = nat.env.api.makeNativeDriver(prog, helper);
  const at = {
    running: true, stopRequested: false, driver: drv, mode: 'explore', goal: '',
    maxSteps: 40, allowRisky: false, projectDir: '/tmp/Ledger', startUrl: drv.startUrl, startPath: '',
    stamp: 'native-test', steps: [], issues: [], issueSigs: new Set(), screens: new Map(),
    tried: new Set(), skipped: new Set(), inflight: new Set(), sinceLast: [],
    backs: 0, returnedHome: false, canGoBack: false, shots: 0, pendingShot: false,
    tokensIn: 0, tokensOut: 0, lastUrl: '',
  };
  const nreport = fs.readFileSync(await nat.env.api.runAutotest(at), 'utf8');
  const p = helper.pressed;

  lines.push('', '--- B. native program (simulated) ---');
  check('types into a normal field', p.includes('Name'));
  check('never types into a password field', !p.includes('Password'));
  check('opens a dialog and explores inside it', p.includes('Open settings') && p.includes('Apply'));
  check('closes the dialog to carry on', p.includes('ESC'));
  check('catches an error dialog', at.issues.some((i) => i.type === 'error dialog'));
  check('catches a crash with the code decoded', at.issues.some((i) => /access violation/.test(i.message)));
  check('names the faulting module', at.issues.some((i) => /reportgen\.dll/.test(i.message)));
  check('stops when the program dies', /the program closed/.test(nreport));
  check('never presses a destructive button', !p.includes('Delete all records'));
  check('never presses Exit', !p.includes('Exit'));
  check('lists both as skipped', /skipped as risky[\s\S]*Delete all records[\s\S]*Exit/.test(nreport));

  // ===================== C. the native launcher, for real =====================
  const upstream = http.createServer((req, res) => { res.writeHead(req.url === '/missing' ? 404 : 200); res.end('ok'); });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  const up = `http://127.0.0.1:${upstream.address().port}`;

  const runLogs = [], runStatuses = [];
  const fakeSettings = {};
  const nenv = {
    require, app, fs, path, http, spawn, treeKill, nativeImage, clipboard,
    sendLog: (t, s) => runLogs.push((s ? `[${s}] ` : '') + t),
    sendStatus: (s, p2) => runStatuses.push([s, p2]),
    traceLog: (k, t) => runLogs.push(`[${k}] ${t}\n`),
    shortUrl: (u) => String(u).split('?')[0],
    stripAnsi: (t) => t, findPortConflict: () => null, findPidsOnPort: async () => [],
    liveReloadEnabled: () => false, shotFileName: () => path.join(tmp, 'x.png'),
    ipcMain: { handle: () => {} },
    readSettings: () => fakeSettings, writeSettings: (p2) => Object.assign(fakeSettings, p2),
    __dirname: path.join(__dirname, '..'),   // where main.js finds native/bdwin.ps1
  };
  new Function('__env', `
    const { require, app, fs, path, http, spawn, treeKill, nativeImage, clipboard,
            sendLog, sendStatus, traceLog, shortUrl, stripAnsi, findPortConflict, findPidsOnPort,
            liveReloadEnabled, shotFileName, ipcMain, readSettings, writeSettings, __dirname } = __env;
    let traceEnabled = true, runningProcs = [], currentProjectDir = null, currentProjectType = null, mainWindow = null;
    const sendProcs = () => {}; const stopRunningApp = () => {};
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    ${nativeBlock}
    __env.api = { startNativeProgram, isChromiumProgram, noteChromiumWindow, get session() { return nativeSession; } };
  `)(nenv);

  // Chromium-based programs get the accessibility switch: found by Chromium's
  // files beside them, or remembered once one of their windows is seen.
  const cdir = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-chromium-'));
  const cexe = path.join(cdir, 'Shell.exe'), pexe = path.join(cdir, 'Portable.exe');
  fs.writeFileSync(cexe, ''); fs.writeFileSync(pexe, '');
  check('a plain program is not taken for Chromium', !nenv.api.isChromiumProgram(cexe));
  fs.writeFileSync(path.join(cdir, 'chrome_100_percent.pak'), '');
  check('Chromium files beside a program mark it', nenv.api.isChromiumProgram(cexe));
  fs.rmSync(path.join(cdir, 'chrome_100_percent.pak'));
  const notes = [];
  const fakeS = { exe: 'Portable.exe', exePath: pexe, a11y: false };
  const logBefore = runLogs.length;
  nenv.api.noteChromiumWindow(fakeS, { cls: 'WindowsForms10.Window.8.app' });
  nenv.api.noteChromiumWindow(fakeS, { cls: 'Chrome_WidgetWin_1' });
  nenv.api.noteChromiumWindow(fakeS, { cls: 'Chrome_WidgetWin_1' });
  notes.push(...runLogs.slice(logBefore).filter((l) => /built on Chromium/.test(l)));
  check('a Chromium window is noticed once, and says to restart', notes.length === 1 && /Restart/.test(notes[0]));
  check('and the program is remembered for next time', nenv.api.isChromiumProgram(pexe));
  fs.rmSync(cdir, { recursive: true, force: true });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-prog-'));
  const progName = 'Tool.exe';
  if (process.platform === 'win32') {
    // Benchdrop only ever runs real .exe files (and Node refuses to spawn a
    // .cmd without a shell), so build one with the C# compiler that ships with
    // Windows. It goes through HTTP_PROXY by hand: .NET's own web client
    // never proxies 127.0.0.1.
    const fw = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET');
    const csc = ['Framework64', 'Framework'].map((d) => path.join(fw, d, 'v4.0.30319', 'csc.exe')).find((p) => fs.existsSync(p));
    if (csc) {
      const srcFile = path.join(tmp, 'Tool.cs');
      fs.writeFileSync(srcFile, `using System; using System.IO; using System.Net.Sockets; using System.Text;
class Tool {
  static void Get(string url) {
    string proxy = Environment.GetEnvironmentVariable("HTTP_PROXY");
    Uri target = new Uri(url), via = new Uri(proxy ?? url);
    using (TcpClient c = new TcpClient(via.Host, via.Port)) {
      NetworkStream s = c.GetStream();
      byte[] req = Encoding.ASCII.GetBytes("GET " + (proxy != null ? url : target.PathAndQuery) +
        " HTTP/1.1\\r\\nHost: " + target.Authority + "\\r\\nConnection: close\\r\\n\\r\\n");
      s.Write(req, 0, req.Length);
      new StreamReader(s).ReadToEnd();
    }
  }
  static int Main(string[] args) {
    Console.WriteLine("Tool starting with args: " + string.Join(" ", args));
    Get("${up}/data");
    Get("${up}/missing");
    File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "settings.ini"), "saved");
    Console.Error.WriteLine("ERROR: could not open cache");
    return 3;
  }
}
`);
      require('child_process').execFileSync(csc, ['-nologo', `-out:${path.join(dir, progName)}`, srcFile]);
    }
  } else {
    fs.writeFileSync(path.join(dir, progName),
      `#!/bin/sh\necho "Tool starting with args: $@"\ncurl -s -o /dev/null "${up}/data"\ncurl -s -o /dev/null "${up}/missing"\necho "saved" > "${dir}/settings.ini"\necho "ERROR: could not open cache" >&2\nexit 3\n`);
    fs.chmodSync(path.join(dir, progName), 0o755);
  }
  const haveProg = fs.existsSync(path.join(dir, progName));

  if (haveProg) await nenv.api.startNativeProgram(dir, progName, '--mode "quick test"');
  lines.push('', '--- C. running a real program ---');
  if (!haveProg) {
    lines.push('SKIP  no C# compiler (csc.exe) to build a test program with');
  } else {
    const sess = nenv.api.session;
    const errs = [];
    const exits = [];
    sess.events.on('stderr-error', (l) => errs.push(l));
    sess.events.on('exit', (i) => exits.push(i));
    t0 = Date.now();
    while (!sess.exited && Date.now() - t0 < 25000) await sleep(200);
    await sleep(500);
    const all = runLogs.join('');

    check('reports that it started', runStatuses.some(([st]) => st === 'native-started'));
    check('passes quoted arguments through', /args: --mode quick test/.test(all));
    check('puts its output in the log, tagged', /\[Tool\] Tool starting/.test(all));
    check('logs a request with its status', /← 200 GET .*\/data/.test(all));
    check('marks a failed request', /✗ 404 GET .*\/missing/.test(all));
    check('logs a file it wrote', /changed settings\.ini/.test(all));
    check('raises error output as an event', errs.some((l) => /could not open cache/.test(l)));
    check('reports the exit code', exits.length === 1 && exits[0].code === 3);
    check('shuts the traffic proxy down afterwards', sess.proxy === null);
  }

  console.log(lines.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`);
  server.close();
  upstream.close();
  fs.rmSync(dir, { recursive: true, force: true });
  app.exit(fail ? 1 : 0);
}).catch((err) => {
  // Without this an exception leaves the window open and the run hangs.
  console.log(lines.join('\n'));
  console.error('\nThe suite stopped with an error:', err);
  app.exit(1);
});
