// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Griffith.Software — https://griffith.software
// Android apps: build, install, run and test them on an emulator or a phone.
//
// Everything goes through the Android SDK's own tools - adb for the device,
// the emulator for virtual phones, Gradle (the project's wrapper) to build,
// aapt2 to read an APK. Benchdrop never installs the SDK or a JDK: it finds
// them (settings, the project's local.properties, ANDROID_HOME, Android
// Studio's usual folders) and says plainly what's missing.
//
// While an app runs, it's an "Android session": its log comes from logcat
// (filtered to its process), crashes and ANRs from the crash and system
// logs, the picture from screencap, and Autotest's view of the screen from
// a uiautomator dump. Clicks in Benchdrop's picture become taps on the device.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');

const IS_WIN = process.platform === 'win32';
const EXE = IS_WIN ? '.exe' : '';
const STUDIO_URL = 'https://developer.android.com/studio';

// ---------------------------------------------------------------------------
// Pure helpers (tested in tests/unit.test.js)
// ---------------------------------------------------------------------------

// local.properties escapes ':' and '\' (sdk.dir=C\:\\Users\\...).
function parseLocalProperties(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const m = /^([^=:\s]+)\s*[=:]\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/\\(.)/g, '$1');
  }
  return out;
}

// `adb devices -l`
function parseDevices(text) {
  const list = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^(\S+)\s+(device|offline|unauthorized|no permissions|recovery|sideload|bootloader)\b(.*)$/.exec(line.trim());
    if (!m || line.startsWith('List of devices')) continue;
    const props = {};
    for (const kv of m[3].trim().split(/\s+/)) {
      const i = kv.indexOf(':');
      if (i > 0) props[kv.slice(0, i)] = kv.slice(i + 1);
    }
    list.push({ serial: m[1], state: m[2], model: props.model || '', product: props.product || '', emulator: /^emulator-\d+$/.test(m[1]) });
  }
  return list;
}

// `adb mdns services`: "<name>\t<type>\t<host>:<port>" per line.
function parseMdnsServices(text) {
  const list = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^(\S+)\s+(_adb[\w-]*\._tcp)\.?\s+([\d.]+|\[[0-9a-f:]+\]):(\d+)\s*$/i.exec(line.trim());
    if (m) list.push({ name: m[1], type: m[2], host: m[3].replace(/^\[|\]$/g, ''), port: Number(m[4]) });
  }
  return list;
}

// `aapt2 dump badging`
function parseBadging(text) {
  const t = String(text);
  const pkg = /^package: name='([^']+)'/m.exec(t);
  const act = /^launchable-activity: name='([^']+)'/m.exec(t);
  const label = /^application-label:'([^']*)'/m.exec(t);
  return { pkg: pkg ? pkg[1] : null, activity: act ? act[1] : null, label: label ? label[1] : null };
}

// What an Android project's app module is, from its build file.
function readApplicationId(buildText) {
  const m = /applicationId\s*[=(]?\s*["']([\w.]+)["']/.exec(buildText) || /namespace\s*[=(]?\s*["']([\w.]+)["']/.exec(buildText);
  return m ? m[1] : null;
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function xmlText(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return XML_ENTITIES[e] != null ? XML_ENTITIES[e] : all;
  });
}

// A uiautomator dump, turned into the controls Autotest and Claude can use.
// Compose draws a button as a clickable View whose words are in child text
// nodes, so a control without its own text is named by the text inside it.
function parseUiDump(xml, screen = { w: 1080, h: 2400 }) {
  const nodes = [];
  const stack = [];
  const re = /<node\b([^>]*?)(\/?)>|<\/node>/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[0] === '</node>') { stack.pop(); continue; }
    const a = {};
    m[1].replace(/([\w-]+)="([^"]*)"/g, (_x, k, v) => { a[k] = xmlText(v); return ''; });
    const b = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(a.bounds || '');
    const node = {
      text: a.text || '', desc: a['content-desc'] || '', rid: a['resource-id'] || '', cls: a.class || '',
      pkg: a.package || '',
      clickable: a.clickable === 'true' || a['long-clickable'] === 'true', checkable: a.checkable === 'true',
      checked: a.checked === 'true', enabled: a.enabled !== 'false', password: a.password === 'true',
      bounds: b ? { x1: +b[1], y1: +b[2], x2: +b[3], y2: +b[4] } : null,
      parent: stack.length ? stack[stack.length - 1] : null, kids: [],
    };
    if (node.parent) node.parent.kids.push(node);
    nodes.push(node);
    if (m[2] !== '/') stack.push(node);
  }
  const words = (n, out = [], depth = 0) => {
    if (depth > 8 || out.length >= 4) return out;
    for (const k of n.kids) {
      if (k.text || k.desc) out.push(k.text || k.desc);
      if (out.length >= 4) break;
      words(k, out, depth + 1);
    }
    return out;
  };
  const visible = (n) => n.bounds && n.bounds.x2 > n.bounds.x1 && n.bounds.y2 > n.bounds.y1 &&
    n.bounds.x2 > 0 && n.bounds.y2 > 0 && n.bounds.x1 < screen.w && n.bounds.y1 < screen.h;
  const elements = [];
  const texts = [];
  for (const n of nodes) {
    if (!visible(n)) continue;
    const isField = /EditText|AutoCompleteTextView/.test(n.cls);
    const kind = isField ? 'field'
      : /Spinner/.test(n.cls) ? 'select'
        : n.checkable ? 'toggle'
          : n.clickable ? 'button' : null;
    if (!kind) {
      if (n.text) texts.push(n.text);
      else if (n.desc && !n.kids.length) texts.push(n.desc);
      continue;
    }
    let label = (isField ? (n.desc || n.rid.split('/').pop()) : '') || n.text || n.desc || words(n).join(' ') ||
      n.rid.split('/').pop() || n.cls.split('.').pop();
    label = String(label).replace(/\s+/g, ' ').trim().slice(0, 60);
    const b = n.bounds;
    elements.push({
      id: `a${elements.length + 1}`, kind, type: n.cls.split('.').pop(), label,
      disabled: !n.enabled, secret: kind === 'field' && n.password,
      checked: n.checkable ? n.checked : undefined,
      value: isField && !n.password ? n.text : undefined,
      x: Math.round((b.x1 + b.x2) / 2), y: Math.round((b.y1 + b.y2) / 2),
      automationId: n.rid,
    });
  }
  const root = nodes.find((n) => n.pkg);
  return { elements, text: texts.join(' ').slice(0, 1200), pkg: root ? root.pkg : '' };
}

// `adb shell input text` runs through the device's sh: quote it, and spaces
// travel as %s.
function inputTextArg(s) {
  return "'" + String(s).replace(/ /g, '%s').replace(/'/g, "'\\''") + "'";
}

// Keys from Benchdrop's window to Android key codes.
const KEYCODES = {
  Enter: 66, Backspace: 67, Delete: 112, Tab: 61, Escape: 111,
  ArrowUp: 19, ArrowDown: 20, ArrowLeft: 21, ArrowRight: 22, Home: 122, End: 123,
  back: 4, home: 3, recents: 187,
};

// ---------------------------------------------------------------------------
// Project detection
// ---------------------------------------------------------------------------

const BUILD_FILES = ['build.gradle.kts', 'build.gradle'];
function readBuildFile(dir) {
  for (const f of BUILD_FILES) {
    const p = path.join(dir, f);
    if (fs.existsSync(p)) {
      try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; }
    }
  }
  return null;
}

// An Android app project: a Gradle build with a module applying the
// com.android.application plugin (usually app/).
function detectAndroidProject(dir) {
  const isGradle = ['settings.gradle', 'settings.gradle.kts', ...BUILD_FILES].some((f) => fs.existsSync(path.join(dir, f)));
  if (!isGradle) return null;
  const isApp = (text) => text && /com\.android\.application|android\.application\b/.test(text);
  const candidates = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { /* ignore */ }
  const preferred = entries.filter((e) => e.isDirectory() && e.name === 'app');
  for (const e of [...preferred, ...entries.filter((x) => x.isDirectory() && x.name !== 'app' && !x.name.startsWith('.') && x.name !== 'build')]) {
    const text = readBuildFile(path.join(dir, e.name));
    if (isApp(text)) candidates.push({ module: e.name, text });
  }
  const rootText = readBuildFile(dir);
  if (!candidates.length && isApp(rootText)) candidates.push({ module: '', text: rootText });
  if (!candidates.length) return null;
  const main = candidates[0];
  return {
    type: 'android',
    name: path.basename(dir),
    module: main.module,
    modules: candidates.map((c) => c.module),
    applicationId: readApplicationId(main.text),
    gradlew: fs.existsSync(path.join(dir, IS_WIN ? 'gradlew.bat' : 'gradlew')),
  };
}

// ---------------------------------------------------------------------------
// The Android support itself
// ---------------------------------------------------------------------------

function createAndroid(ctx) {
  // ctx: { sendLog, sendStatus, traceLog, readSettings, writeSettings, isRiskyLabel,
  //        recordIssue, sleep, trackProc, untrackProc }
  const sleep = ctx.sleep;
  let session = null;      // the app that's running
  let emulator = null;     // { child, avd } - an emulator Benchdrop started
  let dumpQueue = Promise.resolve();

  // --- finding the tools ---------------------------------------------------
  const isSdk = (d) => !!d && fs.existsSync(path.join(d, 'platform-tools', 'adb' + EXE));
  const isJdk = (d) => !!d && fs.existsSync(path.join(d, 'bin', 'java' + EXE));

  function sdkCandidates(projectDir) {
    const s = ctx.readSettings();
    const list = [];
    if (s.androidSdk) list.push(['Benchdrop setting', s.androidSdk]);
    // The project's local.properties - or, for an APK inside a project's
    // build folder, the one a few folders up.
    for (let d = projectDir, i = 0; d && i < 7; i++, d = path.dirname(d)) {
      try {
        const lp = parseLocalProperties(fs.readFileSync(path.join(d, 'local.properties'), 'utf8'));
        if (lp['sdk.dir']) { list.push(["the project's local.properties", lp['sdk.dir']]); break; }
      } catch (e) { /* none here */ }
      if (path.dirname(d) === d) break;
    }
    if (process.env.ANDROID_HOME) list.push(['ANDROID_HOME', process.env.ANDROID_HOME]);
    if (process.env.ANDROID_SDK_ROOT) list.push(['ANDROID_SDK_ROOT', process.env.ANDROID_SDK_ROOT]);
    if (process.env.LOCALAPPDATA) list.push(["Android Studio's usual folder", path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk')]);
    list.push(["Android Studio's usual folder", path.join(os.homedir(), 'Android', 'Sdk')]);
    if (s.androidSdkSeen) list.push(['an earlier Android project', s.androidSdkSeen]);
    return list;
  }

  function jdkCandidates(projectDir, sdk) {
    const s = ctx.readSettings();
    const list = [];
    if (s.javaHome) list.push(['Benchdrop setting', s.javaHome]);
    if (projectDir) {
      try {
        const gp = parseLocalProperties(fs.readFileSync(path.join(projectDir, 'gradle.properties'), 'utf8'));
        if (gp['org.gradle.java.home']) list.push(["the project's gradle.properties", gp['org.gradle.java.home']]);
      } catch (e) { /* none */ }
    }
    if (process.env.JAVA_HOME) list.push(['JAVA_HOME', process.env.JAVA_HOME]);
    for (const base of [process.env.ProgramFiles, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean)) {
      list.push(["Android Studio's own JDK", path.join(base, 'Android', 'Android Studio', 'jbr')]);
      list.push(["Android Studio's own JDK", path.join(base, 'Android Studio', 'jbr')]);
    }
    // A JDK kept beside the SDK (a tools folder with both side by side).
    if (sdk) {
      try {
        const parent = path.dirname(sdk);
        for (const e of fs.readdirSync(parent)) if (/^(jdk|openjdk|java)/i.test(e)) list.push(['a JDK beside the SDK', path.join(parent, e)]);
      } catch (e) { /* ignore */ }
    }
    return list;
  }

  function avdHomeCandidates(sdk) {
    const s = ctx.readSettings();
    const list = [];
    if (s.androidAvdHome) list.push(s.androidAvdHome);
    if (process.env.ANDROID_AVD_HOME) list.push(process.env.ANDROID_AVD_HOME);
    if (sdk) for (const n of ['android-avd', 'avd']) list.push(path.join(path.dirname(sdk), n));
    list.push(path.join(process.env.ANDROID_USER_HOME || path.join(os.homedir(), '.android'), 'avd'));
    return list;
  }

  function resolveTools(projectDir) {
    const sdkHit = sdkCandidates(projectDir).find(([, d]) => isSdk(d));
    const sdk = sdkHit ? sdkHit[1] : null;
    // Remember an SDK a project pointed to, for APKs and projects that don't say.
    if (sdk && sdkHit[0] === "the project's local.properties" && ctx.readSettings().androidSdkSeen !== sdk) {
      try { ctx.writeSettings({ androidSdkSeen: sdk }); } catch (e) { /* best effort */ }
    }
    const jdkHit = jdkCandidates(projectDir, sdk).find(([, d]) => isJdk(d));
    const avdHome = avdHomeCandidates(sdk).find((d) => {
      try { return fs.readdirSync(d).some((f) => /\.ini$/i.test(f)); } catch (e) { return false; }
    }) || null;
    let aapt2 = null;
    if (sdk) {
      try {
        const versions = fs.readdirSync(path.join(sdk, 'build-tools')).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        for (const v of versions) {
          const p = path.join(sdk, 'build-tools', v, 'aapt2' + EXE);
          if (fs.existsSync(p)) { aapt2 = p; break; }
        }
      } catch (e) { /* none */ }
    }
    return {
      sdk, sdkFrom: sdkHit ? sdkHit[0] : null,
      adb: sdk ? path.join(sdk, 'platform-tools', 'adb' + EXE) : null,
      emulator: sdk && fs.existsSync(path.join(sdk, 'emulator', 'emulator' + EXE)) ? path.join(sdk, 'emulator', 'emulator' + EXE) : null,
      aapt2,
      jdk: jdkHit ? jdkHit[1] : null, jdkFrom: jdkHit ? jdkHit[0] : null,
      avdHome,
    };
  }

  function toolEnv(t) {
    const env = { ...process.env };
    if (t.sdk) { env.ANDROID_HOME = t.sdk; env.ANDROID_SDK_ROOT = t.sdk; }
    if (t.jdk) {
      // Windows spells it Path; a second "PATH" beside it confuses the child.
      const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
      env.JAVA_HOME = t.jdk;
      env[key] = path.join(t.jdk, 'bin') + path.delimiter + (env[key] || '');
    }
    if (t.avdHome) env.ANDROID_AVD_HOME = t.avdHome;
    delete env.ELECTRON_RUN_AS_NODE;
    return env;
  }

  // --- running the tools -----------------------------------------------------
  function run(file, args, { timeout = 60000, env, input } = {}) {
    return new Promise((resolve) => {
      const child = execFile(file, args, { timeout, windowsHide: true, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, env },
        (err, stdout, stderr) => resolve({ code: err ? (err.code || 1) : 0, stdout: stdout || Buffer.alloc(0), stderr: stderr || Buffer.alloc(0), error: err }));
      if (input != null) { child.stdin.end(input); }
    });
  }
  const text = (r) => r.stdout.toString('utf8');
  const adb = (t, serial, args, opts) => run(t.adb, serial ? ['-s', serial, ...args] : args, { env: toolEnv(t), ...opts });

  async function devices(t) {
    const r = await adb(t, null, ['devices', '-l'], { timeout: 15000 });
    const list = parseDevices(text(r));
    for (const d of list) {
      if (d.emulator && d.state === 'device') {
        const n = await adb(t, d.serial, ['emu', 'avd', 'name'], { timeout: 5000 });
        d.avd = text(n).split(/\r?\n/)[0].trim() || null;
      }
    }
    return list;
  }

  function listAvds(t) {
    if (!t.avdHome) return [];
    try {
      return fs.readdirSync(t.avdHome).filter((f) => /\.ini$/i.test(f)).map((f) => f.replace(/\.ini$/i, '')).sort();
    } catch (e) { return []; }
  }

  // What the app could run on: phones and emulators that are on, then
  // emulators that could be started.
  async function targets(projectDir) {
    const t = resolveTools(projectDir);
    if (!t.adb) return { tools: t, targets: [] };
    const devs = await devices(t);
    const running = new Set(devs.filter((d) => d.avd).map((d) => d.avd));
    const list = devs.map((d) => ({
      kind: 'device', serial: d.serial, state: d.state,
      label: d.emulator ? `Emulator ${d.avd || ''} (${d.serial})`.replace('  ', ' ') : `${(d.model || 'Phone').replace(/_/g, ' ')} (${d.serial})`,
      ready: d.state === 'device',
      note: d.state === 'unauthorized' ? 'allow USB debugging on the phone' : d.state !== 'device' ? d.state : '',
    }));
    if (t.emulator) {
      for (const avd of listAvds(t)) {
        if (!running.has(avd)) list.push({ kind: 'avd', avd, label: `Start the emulator ${avd}`, ready: true });
      }
    }
    return { tools: t, targets: list };
  }

  // --- the emulator ----------------------------------------------------------
  async function startEmulator(t, avd) {
    const before = new Set((await devices(t)).map((d) => d.serial));
    ctx.sendLog(`[Benchdrop] Starting the emulator ${avd}. A first start can take a minute or two.\n`);
    const child = spawn(t.emulator, ['-avd', avd], { env: toolEnv(t), windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'] });
    emulator = { child, avd };
    const onOut = (d) => {
      for (const line of d.toString().split(/\r?\n/)) if (/\b(ERROR|FATAL|PANIC)\b/.test(line)) ctx.sendLog(`${line.trim()}\n`, 'emulator');
    };
    child.stdout.on('data', onOut);
    child.stderr.on('data', onOut);
    child.on('exit', (code) => {
      if (emulator && emulator.child === child) emulator = null;
      ctx.sendLog(`[Benchdrop] The emulator ${avd} closed${code ? ` (code ${code})` : ''}.\n`);
    });
    // Its adb serial appears first; the system is ready when boot completes.
    let serial = null;
    const t0 = Date.now();
    while (!serial && Date.now() - t0 < 180000) {
      if (!emulator || emulator.child !== child) throw new Error(`the emulator ${avd} closed while starting`);
      await sleep(2000);
      const fresh = (await devices(t)).find((d) => d.emulator && !before.has(d.serial));
      if (fresh) serial = fresh.serial;
    }
    if (!serial) throw new Error(`the emulator ${avd} didn't appear to adb within 3 minutes`);
    emulator.serial = serial;
    return serial;
  }

  async function waitForBoot(t, serial) {
    const t0 = Date.now();
    let said = false;
    while (Date.now() - t0 < 300000) {
      const r = await adb(t, serial, ['shell', 'getprop', 'sys.boot_completed'], { timeout: 10000 });
      if (text(r).trim() === '1') return;
      if (!said && Date.now() - t0 > 15000) { ctx.sendLog('[Benchdrop] Waiting for Android to finish starting…\n'); said = true; }
      await sleep(2000);
    }
    throw new Error(`${serial} didn't finish starting within 5 minutes`);
  }

  // --- building --------------------------------------------------------------
  function gradleBuild(t, projectDir, info) {
    return new Promise((resolve, reject) => {
      const task = `${info.module ? `:${info.module}` : ''}:assembleDebug`;
      if (!info.gradlew) return reject(new Error('this project has no Gradle wrapper (gradlew), so Benchdrop can\'t build it. Build it in Android Studio and drop the .apk instead.'));
      if (!t.jdk) return reject(new Error('building needs a JDK, and none was found (see the Android panel to choose one)'));
      ctx.sendLog(`\n$ gradlew ${task}\n`);
      const dir = path.resolve(projectDir);
      // cmd runs the wrapper by its full path (the project folder can have spaces).
      const child = IS_WIN
        ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${path.join(dir, 'gradlew.bat')}" ${task} --console=plain"`],
          { cwd: dir, env: toolEnv(t), windowsHide: true, windowsVerbatimArguments: true })
        : spawn('./gradlew', [task, '--console=plain'], { cwd: dir, env: toolEnv(t) });
      ctx.trackProc(child, 'build');
      const out = (d) => ctx.sendLog(d.toString(), 'build');
      child.stdout.on('data', out);
      child.stderr.on('data', out);
      child.on('error', (e) => { ctx.untrackProc(child); reject(e); });
      child.on('exit', (code) => {
        ctx.untrackProc(child);
        if (code === 0) resolve();
        else reject(new Error(code == null ? 'the build was stopped' : `the build failed (exit code ${code}) - the log above says why`));
      });
    });
  }

  function findBuiltApk(projectDir, info) {
    const dir = path.join(projectDir, info.module || '', 'build', 'outputs', 'apk', 'debug');
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'output-metadata.json'), 'utf8'));
      const f = meta.elements && meta.elements[0] && meta.elements[0].outputFile;
      if (f && fs.existsSync(path.join(dir, f))) return path.join(dir, f);
    } catch (e) { /* fall back */ }
    try {
      const apks = fs.readdirSync(dir).filter((f) => /\.apk$/i.test(f))
        .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.m - a.m);
      if (apks.length) return path.join(dir, apks[0].f);
    } catch (e) { /* none */ }
    return null;
  }

  async function apkInfo(t, apk) {
    if (!t.aapt2) return {};
    const r = await run(t.aapt2, ['dump', 'badging', apk], { timeout: 30000 });
    return parseBadging(text(r));
  }

  // --- the running app -------------------------------------------------------
  async function pidOf(t, s) {
    const r = await adb(t, s.serial, ['shell', 'pidof', s.pkg], { timeout: 8000 });
    const pid = Number(text(r).trim().split(/\s+/)[0]);
    return pid > 0 ? pid : null;
  }

  async function launch(t, s) {
    await adb(t, s.serial, ['shell', 'am', 'force-stop', s.pkg], { timeout: 15000 });
    const comp = s.activity ? `${s.pkg}/${s.activity.startsWith('.') ? s.activity : s.activity.replace(`${s.pkg}.`, '.')}` : null;
    const r = comp
      ? await adb(t, s.serial, ['shell', 'am', 'start', '-W', '-n', comp, '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER'], { timeout: 60000 })
      : await adb(t, s.serial, ['shell', 'monkey', '-p', s.pkg, '-c', 'android.intent.category.LAUNCHER', '1'], { timeout: 60000 });
    const out = text(r) + r.stderr.toString();
    if (/Error|Exception|No activities found/i.test(out) && !/Status: ok/.test(out)) throw new Error(`Android wouldn't start it: ${out.trim().split(/\r?\n/).slice(-2).join(' ')}`);
    let pid = null;
    for (let i = 0; i < 20 && !pid; i++) { pid = await pidOf(t, s); if (!pid) await sleep(250); }
    if (!pid) throw new Error('the app started but closed straight away - the log may say why');
    s.pid = pid;
    s.exited = false;
    s.crash = null;
    s.started = Date.now();
    s.events.emit('started', pid);
    startLogcat(t, s);
  }

  function stopWatchers(s) {
    for (const c of s.watchers.splice(0)) { try { c.kill(); } catch (e) { /* gone */ } }
  }

  function startLogcat(t, s) {
    stopWatchers(s);
    const tag = s.label || s.pkg;
    // The app's own log.
    // Info and above: Android's debug and verbose lines (frame timings, the
    // compiler) would bury everything else.
    const app = spawn(t.adb, ['-s', s.serial, 'logcat', '-v', 'brief', `--pid=${s.pid}`, '-T', '1', '*:I'], { env: toolEnv(t), windowsHide: true });
    let buf = '';
    app.stdout.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim() || line.startsWith('---------')) continue;
        ctx.sendLog(`${line}\n`, tag);
        if (/^[EF]\//.test(line)) s.events.emit('error-log', line.slice(0, 300));
      }
    });
    s.watchers.push(app);
    // Crashes and "not responding", which Android writes in its own logs.
    const sys = spawn(t.adb, ['-s', s.serial, 'logcat', '-v', 'brief', '-b', 'crash', '-b', 'system', '-T', '1',
      'AndroidRuntime:E', 'ActivityManager:E', '*:S'], { env: toolEnv(t), windowsHide: true });
    let sbuf = '';
    let fatal = null;
    sys.stdout.on('data', (d) => {
      sbuf += d.toString();
      const lines = sbuf.split(/\r?\n/);
      sbuf = lines.pop();
      for (const line of lines) {
        if (/FATAL EXCEPTION/.test(line)) { fatal = { lines: [], ours: false }; continue; }
        if (fatal) {
          if (new RegExp(`Process: ${s.pkg.replace(/\./g, '\\.')}\\b`).test(line)) { fatal.ours = true; continue; }
          if (fatal.ours) {
            fatal.lines.push(line.replace(/^\w\/AndroidRuntime\(\s*\d+\):\s*/, ''));
            if (fatal.lines.length === 1) {
              s.crash = { message: fatal.lines[0], at: Date.now() };
              ctx.sendLog(`${s.label || s.pkg} CRASHED: ${fatal.lines[0]}\n`, 'bug');
              s.events.emit('crash', s.crash);
            } else if (fatal.lines.length <= 6) {
              ctx.sendLog(`  ${fatal.lines[fatal.lines.length - 1]}\n`, 'bug');
            } else fatal = null;
          }
        }
        const anr = new RegExp(`ANR in ${s.pkg.replace(/\./g, '\\.')}\\b(.*)`).exec(line);
        if (anr) {
          ctx.sendLog(`${s.label || s.pkg} is NOT RESPONDING (Android: ANR${anr[1].trim() ? ' ' + anr[1].trim() : ''}).\n`, 'bug');
          s.events.emit('anr', line);
        }
      }
    });
    s.watchers.push(sys);
  }

  async function monitorTick(t, s) {
    if (s !== session || s.stopping) return;
    const pid = await pidOf(t, s).catch(() => null);
    if (s !== session || s.stopping) return;
    if (!pid && !s.exited) {
      s.exited = true;
      stopWatchers(s);
      const crashed = !!(s.crash && Date.now() - s.crash.at < 15000);
      s.events.emit('exit', { crashed });
      const exception = crashed ? s.crash.message.split(':')[0].split('.').pop() : '';
      ctx.sendStatus('native-exited', {
        exe: s.label || s.pkg, crashed, name: crashed ? (exception || 'an exception') : 'closed',
        meaning: crashed ? s.crash.message : 'The app is no longer running on the device',
      });
      return;
    }
    if (pid && pid !== s.pid) {
      // It was started again (from the device, or after a crash).
      s.pid = pid;
      s.exited = false;
      startLogcat(t, s);
      ctx.sendLog(`[Benchdrop] ${s.label || s.pkg} is running again (process ${pid}).\n`);
    }
    if (pid) {
      const r = await adb(t, s.serial, ['shell', 'dumpsys', 'activity', 'activities'], { timeout: 10000 }).catch(() => null);
      const m = r && /(?:topResumedActivity|mResumedActivity)[^\n]*?\s([\w.]+)\/([\w.$]+)/.exec(text(r));
      const top = m ? (m[1] === s.pkg ? m[2] : `${m[1]}/${m[2]}`) : '';
      if (top && top !== s.top) {
        s.top = top;
        ctx.traceLog(`page · ${s.short}`, m[1] === s.pkg ? `screen: ${top}` : `left the app - now showing ${m[1]}`);
      }
      ctx.sendStatus('native-info', { responding: true, hasWindow: true, title: m && m[1] === s.pkg ? top.replace(/^\./, '') : 'in the background', procs: 1, windows: 1 });
    }
  }

  // Build (if it's a project), get a device, install, launch.
  async function runApp({ projectDir, info, target, build = true }) {
    await stop();
    const t = resolveTools(projectDir);
    if (!t.sdk) throw Object.assign(new Error('The Android SDK wasn\'t found on this computer.'), { missing: 'sdk' });
    const s = {
      projectDir, info, serial: null, pkg: null, activity: null, label: info.name, short: info.name,
      pid: null, exited: false, crash: null, top: '', watchers: [], events: new EventEmitter(), stopping: false,
      device: '', timer: null,
    };
    s.events.setMaxListeners(30);
    session = s;
    ctx.sendStatus('starting');

    // Start the emulator (if asked) while the app builds: both take a while.
    let serialP;
    if (target && target.kind === 'avd') serialP = startEmulator(t, target.avd);
    else if (target && target.serial) serialP = Promise.resolve(target.serial);
    else {
      const ready = (await devices(t)).find((d) => d.state === 'device');
      if (!ready) throw new Error('No phone or emulator is connected. Pick an emulator to start, or plug in a phone with USB debugging on.');
      serialP = Promise.resolve(ready.serial);
    }
    serialP.catch(() => {});

    let apk = info.apk ? path.join(projectDir, info.apk) : null;
    if (!apk) {
      if (build) {
        await gradleBuild(t, projectDir, info);
        if (s !== session) return null;
      }
      apk = findBuiltApk(projectDir, info);
      if (!apk) throw new Error(build ? 'the build finished but no debug APK was found' : 'no built APK was found - tick "Build it first"');
    }
    const meta = await apkInfo(t, apk);
    s.pkg = meta.pkg || info.applicationId;
    s.activity = meta.activity;
    if (meta.label) { s.label = meta.label; s.short = meta.label; }
    if (!s.pkg) throw new Error("Benchdrop couldn't read the app's package name from the APK");

    s.serial = await serialP;
    if (s !== session) return null;
    await waitForBoot(t, s.serial);
    const devs = await devices(t);
    const d = devs.find((x) => x.serial === s.serial);
    s.device = d ? (d.emulator ? `emulator ${d.avd || s.serial}` : `${(d.model || 'phone').replace(/_/g, ' ')}`) : s.serial;

    ctx.sendLog(`[Benchdrop] Installing ${path.basename(apk)} on ${s.device}…\n`);
    const inst = await adb(t, s.serial, ['install', '-r', '-t', apk], { timeout: 300000 });
    const instOut = (text(inst) + inst.stderr.toString()).trim();
    if (!/Success/.test(instOut)) throw new Error(`installing failed: ${instOut.split(/\r?\n/).slice(-2).join(' ')}`);

    ctx.sendLog(`[Benchdrop] Starting ${s.label} (${s.pkg}).\n`);
    await launch(t, s);
    ctx.sendStatus('native-started', {
      exe: s.label, pid: s.pid, path: projectDir, args: `on ${s.device}`, windows: true,
      android: true, device: s.device, pkg: s.pkg, hasEmulatorWindow: (s.hasEmulatorWindow = !!(d && d.emulator)),
    });
    ctx.sendStatus('native-window', { hwnd: 0, title: s.label });
    s.timer = setInterval(() => monitorTick(t, s).catch(() => {}), 2000);
    s.tools = t;
    return s;
  }

  async function restart() {
    const s = session;
    if (!s || !s.tools) return false;
    s.stopping = true;
    stopWatchers(s);
    await launch(s.tools, s);
    s.stopping = false;
    ctx.sendStatus('native-started', {
      exe: s.label, pid: s.pid, path: s.projectDir, args: `on ${s.device}`, windows: true,
      android: true, device: s.device, pkg: s.pkg, hasEmulatorWindow: s.hasEmulatorWindow,
    });
    ctx.sendStatus('native-window', { hwnd: 0, title: s.label });
    return true;
  }

  // Stop ends the app on the device. An emulator Benchdrop started stays
  // open (starting one is slow) until Benchdrop quits.
  async function stop({ wait = false } = {}) {
    const s = session;
    if (!s) return;
    s.stopping = true;
    session = null;
    clearInterval(s.timer);
    stopWatchers(s);
    if (s.tools && s.serial && s.pkg) {
      const p = adb(s.tools, s.serial, ['shell', 'am', 'force-stop', s.pkg], { timeout: 8000 });
      if (wait) await p;
    }
    s.events.emit('exit', { stopped: true });
  }

  function shutdown() {
    if (emulator && emulator.child && emulator.child.pid) {
      try {
        if (IS_WIN) require('child_process').spawnSync('taskkill', ['/pid', String(emulator.child.pid), '/T', '/F'], { windowsHide: true, timeout: 8000 });
        else emulator.child.kill();
      } catch (e) { /* gone */ }
    }
    emulator = null;
  }

  // --- the picture and input -------------------------------------------------
  async function frame() {
    const s = session;
    if (!s || !s.tools || !s.serial) return null;
    const r = await adb(s.tools, s.serial, ['exec-out', 'screencap', '-p'], { timeout: 10000 });
    if (r.code !== 0 || r.stdout.length < 100) return null;
    return r.stdout;
  }

  async function input(ev = {}) {
    const s = session;
    if (!s || !s.tools || !s.serial) return { ok: false };
    const sh = (args) => adb(s.tools, s.serial, ['shell', 'input', ...args], { timeout: 15000 });
    const n = (v) => String(Math.max(0, Math.round(Number(v) || 0)));
    let what = '';
    if (ev.type === 'tap') { await sh(['tap', n(ev.x), n(ev.y)]); what = `tap at ${n(ev.x)},${n(ev.y)}`; }
    else if (ev.type === 'swipe') { await sh(['swipe', n(ev.x), n(ev.y), n(ev.x2), n(ev.y2), n(ev.ms || 250)]); what = `swipe ${n(ev.x)},${n(ev.y)} → ${n(ev.x2)},${n(ev.y2)}`; }
    else if (ev.type === 'text' && ev.text) { await sh(['text', inputTextArg(ev.text)]); what = 'typed text'; }
    else if (ev.type === 'key' && KEYCODES[ev.key] != null) { await sh(['keyevent', String(KEYCODES[ev.key])]); what = `key ${ev.key}`; }
    else return { ok: false };
    if (ev.type !== 'text') ctx.traceLog(`app · ${s.short}`, what);
    return { ok: true };
  }

  // --- the Autotest / Claude driver -----------------------------------------
  function dump(s) {
    const job = dumpQueue.then(async () => {
      const r = await adb(s.tools, s.serial, ['exec-out', 'uiautomator', 'dump', '/dev/tty'], { timeout: 30000 });
      const out = text(r);
      const end = out.lastIndexOf('</hierarchy>');
      if (end < 0) throw new Error((out + r.stderr.toString()).trim().split(/\r?\n/).pop() || 'the screen could not be read');
      return out.slice(out.indexOf('<?xml') >= 0 ? out.indexOf('<?xml') : 0, end + '</hierarchy>'.length);
    });
    dumpQueue = job.catch(() => {});
    return job;
  }

  async function screenSize(s) {
    if (s.size) return s.size;
    const r = await adb(s.tools, s.serial, ['shell', 'wm', 'size'], { timeout: 8000 });
    const m = /(\d+)x(\d+)\s*$/m.exec(text(r));
    s.size = m ? { w: +m[1], h: +m[2] } : { w: 1080, h: 2400 };
    return s.size;
  }

  function makeDriver() {
    const s = session;
    const handlers = {};
    let lastSnap = null;
    const tap = (x, y) => adb(s.tools, s.serial, ['shell', 'input', 'tap', String(x), String(y)], { timeout: 15000 });
    const relaunch = () => launch(s.tools, s).catch(() => {});
    return {
      kind: 'native',
      android: true,
      startUrl: s.pkg,
      alive: () => session === s && !s.exited,
      async snapshot() {
        const size = await screenSize(s);
        let ui = parseUiDump(await dump(s), size);
        // Back on the first screen leaves the app: bring it back rather than
        // exploring the home screen.
        if (ui.pkg && ui.pkg !== s.pkg) {
          await relaunch();
          await sleep(1200);
          ui = parseUiDump(await dump(s), size);
        }
        const screen = (s.top || s.label).replace(/^\./, '');
        lastSnap = {
          url: screen, title: s.label, text: ui.text, windows: [],
          elements: ui.elements.map((e) => ({ ...e, risky: ctx.isRiskyLabel(e.label, true), external: false, inputType: e.kind === 'field' ? 'text' : undefined })),
        };
        return lastSnap;
      },
      canGoBack: () => true,
      async act(choice) {
        const el = choice.el && lastSnap && lastSnap.elements.find((e) => e.id === choice.el.id);
        if (!el) return { ok: false, why: 'that control is no longer on the screen' };
        await tap(el.x, el.y);
        if (choice.action === 'type') {
          await sleep(350);
          const n = Math.min(80, (el.value || '').length);
          if (n) await adb(s.tools, s.serial, ['shell', 'input', 'keyevent', '123', ...Array(n).fill('67')], { timeout: 15000 });
          if (choice.value) await adb(s.tools, s.serial, ['shell', 'input', 'text', inputTextArg(choice.value)], { timeout: 15000 });
          return { ok: true, how: 'typed' };
        }
        return { ok: true, how: 'tap' };
      },
      back: () => adb(s.tools, s.serial, ['shell', 'input', 'keyevent', '4'], { timeout: 8000 }),
      home: () => relaunch(),
      screenshot: async () => (await frame()) || Buffer.alloc(0),
      settle: async () => { await sleep(900); },
      attach(at) {
        handlers.crash = (c) => ctx.recordIssue(at, { type: 'app crashed', severity: 'critical', message: `${s.label} — ${c.message}`, source: 'detected' });
        handlers.anr = () => ctx.recordIssue(at, { type: 'not responding', severity: 'high', message: `${s.label} stopped responding (Android ANR)`, source: 'detected' });
        handlers.exit = (e) => { if (!e.stopped && !e.crashed) ctx.recordIssue(at, { type: 'app closed', severity: 'high', message: `${s.label} is no longer running`, source: 'detected' }); };
        handlers.error = (line) => ctx.recordIssue(at, { type: 'error output', severity: 'medium', message: line, source: 'detected' });
        s.events.on('crash', handlers.crash);
        s.events.on('anr', handlers.anr);
        s.events.on('exit', handlers.exit);
        s.events.on('error-log', handlers.error);
      },
      detach() {
        s.events.removeListener('crash', handlers.crash);
        s.events.removeListener('anr', handlers.anr);
        s.events.removeListener('exit', handlers.exit);
        s.events.removeListener('error-log', handlers.error);
      },
    };
  }

  // Bring the emulator's own window forward (best effort, Windows only).
  function emulatorPid() {
    return emulator && emulator.child ? emulator.child.pid : null;
  }

  // --- a real phone over Wi-Fi ----------------------------------------------
  // Pairing: Android 11+ (Developer options > Wireless debugging > Pair device
  // with QR code) scans a WIFI:T:ADB code, then advertises a pairing service
  // under that name; adb pairs with the code's password and connects.
  // Installing only: a QR code that downloads the APK from this computer.
  let phone = null;   // { name, pwd, timer, server, url, done }

  function stopPhone() {
    if (!phone) return;
    clearTimeout(phone.timer);
    phone.cancelled = true;
    if (phone.server) { try { phone.server.close(); } catch (e) { /* closed */ } }
    phone = null;
  }

  async function phoneStart({ projectDir, info, lan }) {
    stopPhone();
    const t = resolveTools(projectDir);
    if (!t.adb) throw new Error("the Android SDK wasn't found, so Benchdrop can't talk to a phone");
    const rnd = (n, set) => Array.from({ length: n }, () => set[Math.floor(Math.random() * set.length)]).join('');
    const p = {
      name: `benchdrop-${rnd(6, 'abcdefghijkmnpqrstuvwxyz23456789')}`,
      pwd: rnd(10, 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'),
      started: Date.now(), cancelled: false,
    };
    phone = p;
    const result = { pairText: `WIFI:T:ADB;S:${p.name};P:${p.pwd};;`, pairName: p.name };

    // The APK, served to the Wi-Fi network while this is open.
    const apk = info.apk ? path.join(projectDir, info.apk) : findBuiltApk(projectDir, info);
    if (apk && lan && lan.length) {
      const http = require('http');
      const fileName = path.basename(apk).replace(/[^\w.-]/g, '_');
      const label = (info.name || 'app').replace(/[^\w.-]/g, '_');
      const serveAs = /^app-(debug|release)\.apk$/i.test(fileName) ? `${label}.apk` : fileName;
      p.server = http.createServer((req, res) => {
        if (req.url.split('?')[0] !== `/${serveAs}`) { res.writeHead(404); res.end('Not found'); return; }
        let size = 0;
        try { size = fs.statSync(apk).size; } catch (e) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, {
          'Content-Type': 'application/vnd.android.package-archive',
          'Content-Length': size,
          'Content-Disposition': `attachment; filename="${serveAs}"`,
        });
        fs.createReadStream(apk).pipe(res);
        ctx.sendLog(`[Benchdrop] ${serveAs} was downloaded by ${String(req.socket.remoteAddress || '').replace(/^::ffff:/, '')}.\n`);
      });
      await new Promise((resolve, reject) => { p.server.once('error', reject); p.server.listen(0, '0.0.0.0', resolve); });
      const port = p.server.address().port;
      result.apkUrl = `http://${lan[0].address}:${port}/${serveAs}`;
      result.apkName = serveAs;
      result.apkBuilt = new Date(fs.statSync(apk).mtimeMs).toLocaleString();
    } else if (!apk) {
      result.apkMissing = true;
    }

    // Watch for the phone's pairing service.
    const say = (stage, message, extra = {}) => { if (phone === p) ctx.sendStatus('android-pair', { stage, message, ...extra }); };
    const services = async () => parseMdnsServices(text(await adb(t, null, ['mdns', 'services'], { timeout: 10000 })));
    const tick = async () => {
      if (phone !== p || p.cancelled) return;
      if (Date.now() - p.started > 10 * 60 * 1000) { say('expired', 'The pairing code expired. Close this and open it again for a new one.'); return; }
      try {
        const pairing = (await services()).find((s) => s.type === '_adb-tls-pairing._tcp' && s.name === p.name);
        if (pairing) {
          say('pairing', `Found the phone at ${pairing.host}. Pairing…`);
          const r = await adb(t, null, ['pair', `${pairing.host}:${pairing.port}`, p.pwd], { timeout: 30000 });
          const out = (text(r) + r.stderr.toString()).trim();
          if (!/Successfully paired/i.test(out)) { say('failed', `Pairing didn't work: ${out.split(/\r?\n/).pop()}. Try scanning again.`); p.timer = setTimeout(tick, 2000); return; }
          say('connecting', 'Paired. Connecting…');
          // Its debugging service has the same address; adb usually connects
          // by itself, otherwise connect to it directly.
          let serial = null;
          for (let i = 0; i < 20 && !serial && phone === p; i++) {
            const devs = await devices(t);
            const hit = devs.find((d) => d.state === 'device' && d.serial.includes(pairing.host)) ||
              devs.find((d) => d.state === 'device' && /_adb-tls-connect/.test(d.serial));
            if (hit) { serial = hit.serial; break; }
            const conn = (await services()).find((s) => s.type === '_adb-tls-connect._tcp' && s.host === pairing.host);
            if (conn) await adb(t, null, ['connect', `${conn.host}:${conn.port}`], { timeout: 15000 });
            await sleep(1500);
          }
          if (!serial) { say('failed', 'Paired, but the phone did not connect. Check that Wireless debugging is still on, then press Refresh devices.'); return; }
          const d = (await devices(t)).find((x) => x.serial === serial);
          const label = `${(d && d.model ? d.model : 'Phone').replace(/_/g, ' ')} (Wi-Fi)`;
          ctx.sendLog(`[Benchdrop] Paired and connected to ${label}.\n`);
          say('paired', `Connected to ${label}.`, { serial, label });
          return;
        }
      } catch (e) { /* adb busy; try again */ }
      p.timer = setTimeout(tick, 1500);
    };
    p.timer = setTimeout(tick, 1000);
    return result;
  }

  return {
    get session() { return session; },
    resolveTools, targets, runApp, restart, stop, shutdown, frame, input, makeDriver, emulatorPid,
    phoneStart, phoneStop: stopPhone,
    studioUrl: STUDIO_URL, isSdk, isJdk,
  };
}

module.exports = {
  createAndroid, detectAndroidProject,
  parseLocalProperties, parseDevices, parseBadging, parseUiDump, parseMdnsServices, readApplicationId, inputTextArg, KEYCODES,
};
