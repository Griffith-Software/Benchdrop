// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Griffith.Software — https://griffith.software
const $ = (id) => document.getElementById(id);

const dropzone = $('dropzone');
const scriptPicker = $('script-picker');
const scriptPickerSub = $('script-picker-sub');
const scriptList = $('script-list');
const setupNote = $('setup-note');
const btnRun = $('btn-run');
const btnSelectAll = $('btn-select-all');
const btnChoose = $('btn-choose');
const btnChooseFolder = $('btn-choose-folder');
const urlInput = $('url-input');
const btnLoadUrl = $('btn-load-url');
const recents = $('recents');
const recentsList = $('recents-list');
const btnNew = $('btn-new');
const btnCleanReinstall = $('btn-clean-reinstall');
const btnReset = $('btn-reset');
const btnFolder = $('btn-folder');
const btnToggleLog = $('btn-toggle-log');
const btnStop = $('btn-stop');
const btnReload = $('btn-reload');
const btnViewToggle = $('btn-view-toggle');
const codeView = $('code-view');
const codeFiles = $('code-files');
const codeSearch = $('code-search');
const codeCount = $('code-count');
const codePath = $('code-path');
const codeDirty = $('code-dirty');
const codeEditor = $('code-editor');
const codeGutter = $('code-gutter');
const codeHighlight = $('code-highlight');
const codeHighlightInner = $('code-highlight-inner');
const codeStatus = $('code-status');
const btnCodeSave = $('btn-code-save');
const btnCodeRevert = $('btn-code-revert');
const btnCodeExport = $('btn-code-export');
const btnAutotest = $('btn-autotest');
const nativePicker = $('native-picker');
const nativePickerSub = $('native-picker-sub');
const nativeExe = $('native-exe');
const nativeArgs = $('native-args');
const btnRunNative = $('btn-run-native');
const nativeView = $('native-view');
const nativeName = $('native-name');
const nativeMeta = $('native-meta');
const nativeState = $('native-state');
const btnNativeFront = $('btn-native-front');
const btnNativeDock = $('btn-native-dock');
const btnNativeRestart = $('btn-native-restart');
const nativeStage = $('native-stage');
const nativeMirror = $('native-mirror');
const nativeStill = $('native-still');
const nativeHint = $('native-hint');
const nativeRegion = $('native-region');
const nativeRegionBox = $('native-region-box');
const nativePlaceholder = $('native-placeholder');
const nativePlaceholderTitle = $('native-placeholder-title');
const nativePlaceholderText = $('native-placeholder-text');
const autotestPanel = $('autotest-panel');
const btnAutotestClose = $('btn-autotest-close');
const autotestSteps = $('autotest-steps');
const autotestRisky = $('autotest-risky');
const btnAutotestGo = $('btn-autotest-go');
const autotestBanner = $('autotest-banner');
const autotestBannerTitle = $('autotest-banner-title');
const autotestBannerText = $('autotest-banner-text');
const btnAutotestReport = $('btn-autotest-report');
const btnAutotestDismiss = $('btn-autotest-dismiss');
const btnClearCache = $('btn-clear-cache');
const btnLiveReload = $('btn-live-reload');
const btnTrace = $('btn-trace');
const btnPhone = $('btn-phone');
const phonePanel = $('phone-panel');
const phoneQr = $('phone-qr');
const phoneUrlEl = $('phone-url');
const phoneAlts = $('phone-alts');
const btnPhoneClose = $('btn-phone-close');
const btnCapture = $('btn-capture');
const captureMenu = $('capture-menu');
const regionOverlay = $('region-overlay');
const regionBox = $('region-box');
const shotFlash = $('shot-flash');
const shotToast = $('shot-toast');
const shotThumb = $('shot-thumb');
const shotNote = $('shot-note');
const shotName = $('shot-name');
const btnShotFolder = $('btn-shot-folder');
const btnShotDismiss = $('btn-shot-dismiss');
const btnOpenBrowser = $('btn-open-browser');
const btnDevtools = $('btn-devtools');
const runControls = $('run-controls');
const runUrl = $('run-url');
const appview = $('appview');
const logpanel = $('logpanel');
const logEl = $('log');
const divider = $('divider');
const btnCopyLog = $('btn-copy-log');
const btnClearLog = $('btn-clear-log');
const dragShield = $('drag-shield');
const procTarget = $('proc-target');
const inputLine = $('input-line');
const btnSend = $('btn-send');
const authBanner = $('auth-banner');
const authBannerText = $('auth-banner-text');
const btnAuthOpen = $('btn-auth-open');
const btnAuthDismiss = $('btn-auth-dismiss');
const commandLine = $('command-line');
const btnRunCommand = $('btn-run-command');
const suggestBanner = $('suggest-banner');
const suggestReason = $('suggest-reason');
const suggestCommand = $('suggest-command');
const btnSuggestRun = $('btn-suggest-run');
const btnSuggestDismiss = $('btn-suggest-dismiss');
const portBanner = $('port-banner');
const portTitle = $('port-title');
const portReason = $('port-reason');
const btnPortFree = $('btn-port-free');
const btnPortDismiss = $('btn-port-dismiss');
const statusPill = $('status-pill');
const statusLabel = $('status-label');
const pythonPicker = $('python-picker');
const pythonSub = $('python-sub');
const pythonWarning = $('python-warning');
const pythonEntry = $('python-entry');
const pythonArgs = $('python-args');
const pythonReqRow = $('python-req-row');
const pythonInstallReq = $('python-install-req');
const btnRunPython = $('btn-run-python');
const noUiPanel = $('no-ui-panel');
const noUiTitle = $('no-ui-title');
const noUiText = $('no-ui-text');
const noUiContents = $('no-ui-contents');
const modePicker = $('mode-picker');
const modeSub = $('mode-sub');
const modeOptions = $('mode-options');
const runtimePicker = $('runtime-picker');
const runtimeTitle = $('runtime-title');
const runtimeSub = $('runtime-sub');
const runtimeWarning = $('runtime-warning');
const runtimeList = $('runtime-list');
const runtimeArgs = $('runtime-args');
const btnRunRuntime = $('btn-run-runtime');

let currentProjectDir = null;
let currentUrl = null;
let devtoolsOpen = false;
let lastAuthUrl = null;

// --- Logging -------------------------------------------------------------
const URL_RE = /(https?:\/\/[^\s'"<>]+)/g;

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Output arrives in chunks that may split mid-line, so the timestamp is
// stamped when a line actually begins rather than per chunk.
let logAtLineStart = true;

function timeStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function log(text, source) {
  const prefix = source && source !== 'install' ? `[${source}] ` : '';
  const pieces = String(text).split('\n');
  let html = '';

  pieces.forEach((piece, i) => {
    if (i > 0) {
      html += '\n';
      logAtLineStart = true;
    }
    if (!piece) return;                       // don't stamp a blank line
    if (logAtLineStart) {
      html += `<span class="ts">${timeStamp()}</span> `;
      if (i === 0 && prefix) html += escapeHtml(prefix);
      logAtLineStart = false;
    }
    html += escapeHtml(piece).replace(URL_RE, (m) => `<a href="#" data-url="${m}">${m}</a>`);
  });

  if (source === 'bug' && html) html = `<span class="log-bug">${html}</span>`;
  logEl.insertAdjacentHTML('beforeend', html);
  logEl.scrollTop = logEl.scrollHeight;
}

function setIndicator(mode, label) {
  statusPill.className = mode;
  statusLabel.textContent = label;
  // The logo's arrow animates whenever work is in flight.
  const brand = document.getElementById('brand');
  if (brand) brand.classList.toggle('loading', mode === 'busy' || mode === 'stalled');
}

// Buttons that kick off work and shouldn't be clicked again mid-flight.
// Stop/Reset/Folder/Load-another stay enabled — those are meant to work
// even while something else is running.
const busyButtons = [btnRun, btnCleanReinstall, btnRunCommand, btnSuggestRun, btnPortFree];
function setAppBusy(isBusy) {
  for (const b of busyButtons) b.disabled = isBusy;
}

logEl.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-url]');
  if (!a) return;
  e.preventDefault();
  window.benchdrop.openExternal(a.dataset.url);
});

// --- View switching ------------------------------------------------------
function resetToDropzone() {
  // Unload the page rather than just hiding it. A dev-server page (Vite and
  // friends) keeps a hot-reload socket open and retries forever, which fills
  // the log with connection errors long after the server has stopped.
  try {
    if (appview.getAttribute('src')) appview.setAttribute('src', 'about:blank');
  } catch (e) {
    /* nothing loaded */
  }
  exitNativeMode();
  nativePicker.classList.add('hidden');
  dropzone.classList.remove('hidden');
  scriptPicker.classList.add('hidden');
  appview.classList.add('hidden');
  runControls.classList.add('hidden');
  authBanner.classList.add('hidden');
  phonePanel.classList.add('hidden');
  autotestPanel.classList.add('hidden');
  autotestBanner.classList.add('hidden');
  suggestBanner.classList.add('hidden');
  portBanner.classList.add('hidden');
  pythonPicker.classList.add('hidden');
  noUiPanel.classList.add('hidden');
  modePicker.classList.add('hidden');
  runtimePicker.classList.add('hidden');
  btnCleanReinstall.classList.add('hidden');
  btnViewToggle.classList.add('hidden');
  codeView.classList.add('hidden');
  codeMode = false;
  codeEdits.clear();
  codeCurrent = null;
  btnReset.classList.add('hidden');
  btnFolder.classList.add('hidden');
  currentUrl = null;
  currentProjectDir = null;
  setIndicator('idle', 'Idle');
  setAppBusy(false);
  refreshRecents();
}

function showScriptPicker(info, projectDir, reused, updated) {
  currentProjectDir = projectDir;
  dropzone.classList.add('hidden');
  scriptPicker.classList.remove('hidden');
  btnReset.classList.remove('hidden');
  btnFolder.classList.remove('hidden');

  scriptPickerSub.textContent =
    `"${info.name}"` +
    (updated
      ? ' — new version of this zip unpacked; your installed packages and local settings were kept.'
      : reused
        ? ' — reusing the folder from last time, so any setup you did is still there.'
        : '');

  setupNote.classList.toggle('hidden', !(info.setupNotes && info.setupNotes.length));
  setupNote.textContent = (info.setupNotes || []).join(' ');

  scriptList.innerHTML = '';
  const ordered = [
    ...info.suggestedScripts,
    ...info.allScripts.filter((s) => !info.suggestedScripts.includes(s)),
  ];
  if (!ordered.length) {
    scriptList.innerHTML = '<p class="muted">No scripts found in package.json.</p>';
    btnRun.disabled = true;
    paintSelectAll();
    return;
  }
  btnRun.disabled = false;

  for (const name of ordered) {
    const row = document.createElement('label');
    row.className = 'script-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = name;
    // Pre-tick the ones that look like they make up "running this project".
    cb.checked = info.suggestedScripts.includes(name);
    const text = document.createElement('span');
    text.innerHTML = `<strong>${name}</strong> <span class="muted">${escapeHtml(info.scripts[name] || '')}</span>`;
    row.appendChild(cb);
    row.appendChild(text);
    scriptList.appendChild(row);
  }
  paintSelectAll();
}

let runtimeInfo = null;

function showRuntimePicker(info, projectDir) {
  runtimeInfo = info;
  currentProjectDir = projectDir;
  dropzone.classList.add('hidden');
  pythonPicker.classList.add('hidden');
  noUiPanel.classList.add('hidden');
  runtimePicker.classList.remove('hidden');
  btnReset.classList.remove('hidden');
  btnFolder.classList.remove('hidden');

  runtimeTitle.textContent = `${info.runtimeLabel} project detected`;
  runtimeSub.textContent = info.version
    ? `"${info.name}" — using ${info.version}`
    : `"${info.name}"`;

  runtimeWarning.classList.toggle('hidden', !!info.available);
  if (!info.available) {
    runtimeWarning.innerHTML =
      `<strong>${escapeHtml(info.runtimeLabel)} isn't installed on this computer.</strong> ` +
      `Benchdrop fetches Node.js itself when a project needs it, but not other languages, so install it first, then reopen this project. ` +
      `<a href="#" data-url="${escapeHtml(info.installUrl)}">${escapeHtml(info.installUrl)}</a>`;
  }

  runtimeList.innerHTML = '';
  (info.options || []).forEach((opt, i) => {
    const row = document.createElement('label');
    row.className = 'script-row';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'runtime-option';
    radio.value = String(i);
    if (i === 0) radio.checked = true;
    const text = document.createElement('span');
    text.innerHTML =
      `<strong>${escapeHtml(opt.label)}</strong>` +
      (opt.cmd ? ` <span class="muted">${escapeHtml(opt.cmd)}</span>` : '');
    row.appendChild(radio);
    row.appendChild(text);
    runtimeList.appendChild(row);
  });

  // Only block running if the runtime is missing AND there's no static option.
  const hasStatic = (info.options || []).some((o) => o.static);
  btnRunRuntime.disabled = !info.available && !hasStatic;
}

runtimeWarning.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-url]');
  if (!a) return;
  e.preventDefault();
  window.benchdrop.openExternal(a.dataset.url);
});

btnRunRuntime.addEventListener('click', () => {
  if (!runtimeInfo || !currentProjectDir) return;
  const picked = runtimeList.querySelector('input[type=radio]:checked');
  if (!picked) return;
  const opt = runtimeInfo.options[Number(picked.value)];
  if (!opt) return;

  runtimePicker.classList.add('hidden');
  logpanel.classList.remove('hidden');
  setAppBusy(true);
  setIndicator('busy', 'Starting...');

  if (opt.static) {
    window.benchdrop.serveHtml(currentProjectDir, opt.static);
    return;
  }
  const extra = runtimeArgs.value.trim();
  const cmd = extra ? `${opt.cmd} ${extra}` : opt.cmd;
  window.benchdrop.runRuntime(currentProjectDir, cmd, runtimeInfo.runtimeLabel, !!opt.oneShot);
});

function showModePicker(info, projectDir) {
  currentProjectDir = projectDir;
  dropzone.classList.add('hidden');
  pythonPicker.classList.add('hidden');
  noUiPanel.classList.add('hidden');
  modePicker.classList.remove('hidden');
  btnReset.classList.remove('hidden');
  btnFolder.classList.remove('hidden');

  modeSub.textContent =
    `"${info.name}" contains both a web page and Python scripts. Which would you like to open?`;

  modeOptions.innerHTML = '';
  for (const html of info.htmlEntries) {
    const b = document.createElement('button');
    b.className = 'mode-option';
    b.innerHTML = `<strong>Open ${html}</strong><span class="muted">Serve it and show it in the pane</span>`;
    b.addEventListener('click', () => {
      modePicker.classList.add('hidden');
      setAppBusy(true);
      setIndicator('busy', 'Starting...');
      window.benchdrop.serveHtml(projectDir, html);
    });
    modeOptions.appendChild(b);
  }

  const pb = document.createElement('button');
  pb.className = 'mode-option';
  pb.innerHTML = '<strong>Run a Python script</strong><span class="muted">Command-line output goes to the log</span>';
  pb.addEventListener('click', () => {
    modePicker.classList.add('hidden');
    showPythonPicker({ ...info.python, name: info.name }, projectDir);
  });
  modeOptions.appendChild(pb);
}

function showPythonPicker(info, projectDir) {
  currentProjectDir = projectDir;
  dropzone.classList.add('hidden');
  noUiPanel.classList.add('hidden');
  pythonPicker.classList.remove('hidden');
  btnReset.classList.remove('hidden');
  btnFolder.classList.remove('hidden');

  pythonSub.textContent = info.servesUI
    ? `"${info.name}" looks like a Python web app (${info.frameworks.join(', ')}). It should open in the pane once it starts.`
    : `"${info.name}" is a Python command-line tool — there's no web page to show, so its output appears in the log.`;

  pythonWarning.classList.toggle('hidden', !!info.pythonAvailable);
  if (!info.pythonAvailable) {
    pythonWarning.textContent =
      'Python was not found on this computer. Benchdrop fetches Node.js itself when needed, but not Python, ' +
      'so you need to install Python 3.9 or newer from python.org (tick "Add Python to PATH" ' +
      'during setup), then restart Benchdrop.';
  }
  btnRunPython.disabled = !info.pythonAvailable;

  pythonEntry.innerHTML = '';
  for (const f of info.entryCandidates || []) {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = f;
    pythonEntry.appendChild(opt);
  }
  pythonReqRow.classList.toggle('hidden', !info.hasRequirements);
  pythonInstallReq.checked = !!info.hasRequirements;
}

function showNoUiPanel(info) {
  dropzone.classList.add('hidden');
  pythonPicker.classList.add('hidden');
  noUiPanel.classList.remove('hidden');
  btnReset.classList.remove('hidden');
  btnFolder.classList.remove('hidden');
  noUiTitle.textContent = 'No web UI detected';
  noUiText.textContent =
    `Benchdrop couldn't find a way to show "${info.name}" as a page: there's no package.json ` +
    "(a Node app) and no index.html (a static site).";
  noUiContents.textContent =
    info.topLevel && info.topLevel.length ? `The folder contains: ${info.topLevel.join(', ')}` : '';
}

function showApp(url) {
  const cleanUrl = String(url).replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').trim();
  currentUrl = cleanUrl;
  scriptPicker.classList.add('hidden');
  dropzone.classList.add('hidden');
  appview.classList.remove('hidden');
  runControls.classList.remove('hidden');
  runUrl.textContent = cleanUrl;
  btnViewToggle.classList.remove('hidden');
  setCodeMode(false);   // a freshly started project always opens on the app
  if (appview.getAttribute('src') !== cleanUrl) {
    appview.setAttribute('src', cleanUrl);
  } else {
    appview.reload();
  }
}

// --- Zip loading ---------------------------------------------------------
async function handleZipPath(zipPath, forceFresh = false) {
  if (!zipPath) return;
  logEl.innerHTML = '';
  logAtLineStart = true;
  logpanel.classList.remove('hidden');
  log(`Loading ${zipPath}\n`);
  const result = await window.benchdrop.loadZip(zipPath, forceFresh);
  if (!result) return;
  routeLoadResult(result);
  refreshRecents();
}

function routeLoadResult(result) {
  if (result.needsNativeChoice) showNativePicker(result.info, result.projectDir);
  else if (result.needsScriptChoice) showScriptPicker(result.info, result.projectDir, result.reused, result.updated);
  else if (result.needsModeChoice) showModePicker(result.info, result.projectDir);
  else if (result.needsRuntimeChoice) showRuntimePicker(result.info, result.projectDir);
  else if (result.needsPythonChoice) showPythonPicker(result.info, result.projectDir);
  else if (result.commandOnly) {
    currentProjectDir = result.projectDir;
    showNoUiPanel(result.info);
    setIndicator('idle', 'Command-only');
  } else if (result.projectDir) {
    currentProjectDir = result.projectDir;
    btnReset.classList.remove('hidden');
    btnFolder.classList.remove('hidden');
  }
}

['dragenter', 'dragover'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  })
);
['dragleave', 'drop'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
  })
);
const ACCEPTED = /\.(zip|html?|py|md|txt|json|js|css|svg)$/i;

dropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const droppedPath = window.benchdrop.pathForFile(file);
  // A dropped folder has no extension and no file type — let the main
  // process decide, since only it can stat the path.
  const looksLikeFolder = !file.type && !/\.[a-z0-9]{1,6}$/i.test(file.name);
  if (!looksLikeFolder && !ACCEPTED.test(file.name)) {
    log(
      `[Benchdrop] "${file.name}" isn't something Benchdrop can run. ` +
        'Drop a .zip, a folder, or a single .html, .py or .md file — or paste a GitHub link.\n'
    );
    return;
  }
  handleZipPath(droppedPath);
});

// --- Load from a URL -----------------------------------------------------
async function loadFromUrl() {
  const url = urlInput.value.trim();
  if (!url) return;
  logEl.innerHTML = '';
  logAtLineStart = true;
  logpanel.classList.remove('hidden');
  setAppBusy(true);
  setIndicator('busy', 'Downloading...');
  const result = await window.benchdrop.loadUrl(url);
  setAppBusy(false);
  if (!result || !result.ok) {
    setIndicator('error', 'Download failed');
    return;
  }
  urlInput.value = '';
  routeLoadResult(result);
  refreshRecents();
}
btnLoadUrl.addEventListener('click', loadFromUrl);
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadFromUrl();
});

// --- Recent projects -----------------------------------------------------
function timeAgo(ts) {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

async function refreshRecents() {
  let list = [];
  try {
    list = await window.benchdrop.getRecents();
  } catch (e) {
    /* no recents yet */
  }
  recents.classList.toggle('hidden', !list.length);
  recentsList.innerHTML = '';

  for (const item of list) {
    const row = document.createElement('div');
    row.className = 'recent-row' + (item.missing ? ' missing' : '');

    const main = document.createElement('button');
    main.className = 'recent-open';
    main.innerHTML =
      `<strong>${escapeHtml(item.name || '(unnamed)')}</strong>` +
      `<span class="muted">${escapeHtml(item.type || '')}` +
      `${item.source === 'url' ? ' · from a link' : ''} · ${timeAgo(item.opened)}` +
      `${item.missing ? ' · file no longer there' : ''}</span>`;
    main.title = item.path;
    main.addEventListener('click', () => {
      if (item.missing) return;
      handleZipPath(item.path);
    });
    if (item.missing) main.disabled = true;

    const del = document.createElement('button');
    del.className = 'recent-remove';
    del.textContent = '✕';
    del.title = 'Remove from this list';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.benchdrop.removeRecent(item.path);
      refreshRecents();
    });

    row.appendChild(main);
    row.appendChild(del);
    recentsList.appendChild(row);
  }
}

// --- Buttons -------------------------------------------------------------
btnChoose.addEventListener('click', async () => handleZipPath(await window.benchdrop.pickZip()));
btnChooseFolder.addEventListener('click', async () =>
  handleZipPath(await window.benchdrop.pickZip({ folder: true }))
);

// Reflects what pressing it will do, so it reads as a toggle rather than a
// button that sometimes does nothing.
function paintSelectAll() {
  const boxes = [...scriptList.querySelectorAll('input[type=checkbox]')];
  const allOn = boxes.length > 0 && boxes.every((b) => b.checked);
  btnSelectAll.textContent = allOn ? 'Select none' : 'Select all';
  btnSelectAll.disabled = boxes.length === 0;
}

btnSelectAll.addEventListener('click', () => {
  const boxes = [...scriptList.querySelectorAll('input[type=checkbox]')];
  const allOn = boxes.length > 0 && boxes.every((b) => b.checked);
  boxes.forEach((b) => { b.checked = !allOn; });
  paintSelectAll();
});

scriptList.addEventListener('change', paintSelectAll);

btnRun.addEventListener('click', () => {
  const names = [...scriptList.querySelectorAll('input[type=checkbox]')]
    .filter((cb) => cb.checked)
    .map((cb) => cb.value);
  if (!names.length || !currentProjectDir) {
    log('[Benchdrop] Pick at least one script to run.\n');
    return;
  }
  scriptPicker.classList.add('hidden');
  logpanel.classList.remove('hidden');
  btnCleanReinstall.classList.remove('hidden');
  setAppBusy(true);
  setIndicator('busy', 'Starting...');
  window.benchdrop.runScripts(currentProjectDir, names);
});

btnRunPython.addEventListener('click', () => {
  if (!currentProjectDir || !pythonEntry.value) return;
  pythonPicker.classList.add('hidden');
  logpanel.classList.remove('hidden');
  setAppBusy(true);
  setIndicator('busy', 'Starting...');
  window.benchdrop.runPython(
    currentProjectDir,
    pythonEntry.value,
    pythonArgs.value,
    pythonInstallReq.checked && !pythonReqRow.classList.contains('hidden')
  );
});

btnNew.addEventListener('click', async () => {
  await window.benchdrop.stopApp();
  resetToDropzone();
  logEl.innerHTML = '';
});

btnStop.addEventListener('click', async () => {
  await window.benchdrop.stopApp();
  resetToDropzone();
});

btnCleanReinstall.addEventListener('click', async () => {
  logpanel.classList.remove('hidden');
  setAppBusy(true);
  setIndicator('busy', 'Reinstalling...');
  await window.benchdrop.forceCleanReinstall();
});

btnReset.addEventListener('click', async () => {
  await window.benchdrop.resetProject();
  resetToDropzone();
});

btnFolder.addEventListener('click', () => window.benchdrop.openProjectFolder());
btnToggleLog.addEventListener('click', () => logpanel.classList.toggle('hidden'));
btnReload.addEventListener('click', () => currentUrl && appview.reload());
btnOpenBrowser.addEventListener('click', () => currentUrl && window.benchdrop.openExternal(currentUrl));

btnClearCache.addEventListener('click', async () => {
  btnClearCache.disabled = true;
  log('\n[Benchdrop] Clearing app view cache...\n');
  const ok = await window.benchdrop.clearCache();
  if (ok && currentUrl) {
    // Electron's webview.reloadIgnoringCache() has known edge cases (some
    // requests still come back served from cache). Forcing a real
    // navigation away and back is a more reliable way to guarantee the
    // page actually reloads against the now-empty cache/storage.
    const url = currentUrl;
    appview.setAttribute('src', 'about:blank');
    setTimeout(() => appview.setAttribute('src', url), 50);
  }
  btnClearCache.disabled = false;
});

btnDevtools.addEventListener('click', () => {
  if (!appview.getAttribute('src')) return;
  devtoolsOpen ? appview.closeDevTools() : appview.openDevTools();
  devtoolsOpen = !devtoolsOpen;
});

btnAuthOpen.addEventListener('click', () => {
  if (lastAuthUrl) window.benchdrop.openExternal(lastAuthUrl);
});
btnAuthDismiss.addEventListener('click', () => authBanner.classList.add('hidden'));

// --- Running a one-off command in the project folder ---------------------
function runTypedCommand() {
  const cmd = commandLine.value.trim();
  if (!cmd) return;
  logpanel.classList.remove('hidden');
  window.benchdrop.runCommand(cmd);
  commandLine.value = '';
}
btnRunCommand.addEventListener('click', runTypedCommand);
commandLine.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runTypedCommand();
});

btnSuggestRun.addEventListener('click', () => {
  const cmd = suggestCommand.textContent;
  suggestBanner.classList.add('hidden');
  logpanel.classList.remove('hidden');
  if (cmd) window.benchdrop.runCommand(cmd);
});
btnSuggestDismiss.addEventListener('click', () => suggestBanner.classList.add('hidden'));

let conflictPort = null;
btnPortFree.addEventListener('click', () => {
  portBanner.classList.add('hidden');
  logpanel.classList.remove('hidden');
  setAppBusy(true);
  setIndicator('busy', 'Freeing port...');
  if (conflictPort) window.benchdrop.freePort(conflictPort, true);
});
btnPortDismiss.addEventListener('click', () => portBanner.classList.add('hidden'));

// --- Sending input to a running process ----------------------------------
function sendCurrentInput() {
  const text = inputLine.value;
  if (!text.trim()) return;
  window.benchdrop.sendInput(procTarget.value, text);
  inputLine.value = '';
}
btnSend.addEventListener('click', sendCurrentInput);
inputLine.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendCurrentInput();
});

// --- External links open in the real browser -----------------------------
// Without this, a target="_blank" link (e.g. "Open video") spawns a bare
// Electron popup with no address bar or controls. Sending it to the default
// browser is both more useful and less confusing.
appview.addEventListener('new-window', (e) => {
  e.preventDefault();
  if (e.url && /^https?:/i.test(e.url)) {
    log(`[Benchdrop] Opening ${e.url} in your browser.\n`);
    window.benchdrop.openExternal(e.url);
  }
});

// Same for a link that tries to navigate the whole pane away to another site —
// keep the project in the pane, send the outside world to the browser.
appview.addEventListener('will-navigate', (e) => {
  if (!currentUrl || !e.url) return;
  try {
    const here = new URL(currentUrl);
    const target = new URL(e.url);
    if (target.origin !== here.origin) {
      window.benchdrop.openExternal(e.url);
      log(`[Benchdrop] Opening ${e.url} in your browser.\n`);
      appview.stop();
      appview.setAttribute('src', currentUrl);
    }
  } catch (err) {
    /* ignore malformed URLs */
  }
});

// --- Phone preview -------------------------------------------------------
btnPhone.addEventListener('click', async () => {
  if (!currentUrl) {
    log('[Benchdrop] Load a project first — there is nothing to open on a phone yet.\n');
    return;
  }
  btnPhone.disabled = true;
  setIndicator('busy', 'Starting phone preview...');
  const res = await window.benchdrop.phonePreview(currentUrl);
  btnPhone.disabled = false;
  setIndicator(currentUrl ? 'ready' : 'idle', currentUrl ? 'Running' : 'Idle');

  if (!res || !res.ok) {
    log(`[Benchdrop] ${(res && res.message) || 'Could not start phone preview.'}\n`);
    return;
  }
  phoneQr.src = res.qr;
  phoneUrlEl.textContent = res.url;
  phoneAlts.textContent =
    res.addresses && res.addresses.length > 1
      ? `Other addresses on this machine: ${res.addresses.slice(1).join('  ·  ')}`
      : `Sharing over ${res.interfaceName}`;
  phonePanel.classList.remove('hidden');
});

btnPhoneClose.addEventListener('click', async () => {
  phonePanel.classList.add('hidden');
  await window.benchdrop.stopPhonePreview();
});

phoneUrlEl.addEventListener('click', () => {
  const text = phoneUrlEl.textContent;
  if (text) {
    window.benchdrop.copyText(text);
    phoneUrlEl.classList.add('copied');
    setTimeout(() => phoneUrlEl.classList.remove('copied'), 1200);
  }
});

// --- Trace toggle --------------------------------------------------------
let traceOn = true;   // default on; the toggle remembers your choice

function paintTrace() {
  btnTrace.classList.toggle('active', traceOn);
  btnTrace.title = traceOn
    ? 'Trace is on — the app\'s clicks, console output and network requests appear in the log'
    : 'Also log what the app itself is doing: clicks, console output, network requests and errors';
}

function appViewId() {
  try {
    return appview.getAttribute('src') ? appview.getWebContentsId() : null;
  } catch (e) {
    return null;
  }
}

btnTrace.addEventListener('click', async () => {
  traceOn = !traceOn;
  paintTrace();
  logpanel.classList.remove('hidden');
  await window.benchdrop.setTrace(traceOn, appViewId(), true);
});

// Re-arm after each load, since a fresh page has none of the listeners.
appview.addEventListener('did-finish-load', () => {
  if (traceOn) window.benchdrop.setTrace(true, appViewId());
});

// --- Live reload toggle --------------------------------------------------
let liveReloadOn = true;

function paintLiveReload() {
  btnLiveReload.classList.toggle('active', liveReloadOn);
  btnLiveReload.title = liveReloadOn
    ? 'Live reload is on — edits to project files refresh the page'
    : 'Live reload is off — click to refresh automatically on file changes';
}

btnLiveReload.addEventListener('click', async () => {
  liveReloadOn = !liveReloadOn;
  paintLiveReload();
  await window.benchdrop.setLiveReload(liveReloadOn);
});

// Reflect the saved preference at startup.
(async () => {
  try {
    const st = await window.benchdrop.getSettings();
    liveReloadOn = st.liveReload !== false;
    traceOn = st.trace !== false;
    applyTheme(st.theme);
  } catch (e) {
    /* keep the defaults */
  }
  paintLiveReload();
  paintTrace();
})();

refreshRecents();

// --- Code view -----------------------------------------------------------
// Browse and edit the running project's source. Edits are held in memory
// until saved; saving writes to the project folder, which (with live reload
// on) refreshes the page straight away.
let codeMode = false;          // false = the running app, true = its source
let codeAllFiles = [];
let codeCurrent = null;        // { path, saved } for the open file
const codeEdits = new Map();   // path -> edited text not yet written

function setCodeMode(on) {
  codeMode = on;
  codeView.classList.toggle('hidden', !on);
  btnViewToggle.textContent = on ? 'App' : 'Code';
  btnViewToggle.title = on
    ? 'Back to the running app'
    : 'Switch between the running app and its source';
  btnViewToggle.classList.toggle('active', on);
  if (on) loadFileList();
  if (nativeMode) setDockHidden('code', on);
}

btnViewToggle.addEventListener('click', () => setCodeMode(!codeMode));

async function loadFileList() {
  const res = await window.benchdrop.codeList();
  if (!res || !res.ok) {
    codeFiles.innerHTML = `<p class="muted small">${escapeHtml((res && res.message) || 'Nothing to show.')}</p>`;
    return;
  }
  codeAllFiles = res.files || [];
  renderFileList();
}

function renderFileList() {
  const needle = codeSearch.value.trim().toLowerCase();
  const shown = needle
    ? codeAllFiles.filter((f) => f.path.toLowerCase().includes(needle))
    : codeAllFiles;

  codeFiles.innerHTML = '';
  for (const f of shown.slice(0, 800)) {
    const row = document.createElement('button');
    row.className = 'code-file' + (codeCurrent && codeCurrent.path === f.path ? ' current' : '');
    const edited = codeEdits.has(f.path);
    const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/') + 1) : '';
    const name = f.path.slice(dir.length);
    row.innerHTML =
      (dir ? `<span class="muted">${escapeHtml(dir)}</span>` : '') +
      `<strong>${escapeHtml(name)}</strong>` +
      (edited ? '<span class="edited">●</span>' : '');
    row.title = f.path + (f.tooBig ? ' (too big to open)' : '');
    row.addEventListener('click', () => openFile(f.path));
    codeFiles.appendChild(row);
  }
  codeCount.textContent = needle
    ? `${shown.length} of ${codeAllFiles.length} files`
    : `${codeAllFiles.length} files`;
}

codeSearch.addEventListener('input', renderFileList);

async function openFile(rel) {
  // Keep whatever was typed in the file we're leaving.
  stashCurrentEdit();

  const pending = codeEdits.get(rel);
  if (pending !== undefined) {
    codeCurrent = { path: rel, saved: pending.saved };
    setEditorText(pending.text);
  } else {
    const res = await window.benchdrop.codeRead(rel);
    if (!res || !res.ok) {
      codeStatus.textContent = (res && res.message) || 'Could not open that file.';
      return;
    }
    codeCurrent = { path: rel, saved: res.content };
    setEditorText(res.content);
  }
  codeLang = languageFor(rel);
  codePath.textContent = rel;
  codeEditor.disabled = false;
  setEditorText(codeEditor.value);
  updateDirty();
  renderFileList();
  codeStatus.textContent = '';
}

// Which Prism grammar to use for a given file. A .html file is highlighted
// as markup, and Prism's markup grammar colours embedded <style> and
// <script> blocks as CSS and JavaScript — which is exactly what a
// single-file app needs.
const CODE_LANGS = {
  html: 'markup', htm: 'markup', xml: 'markup', svg: 'markup', vue: 'markup',
  css: 'css', scss: 'css', less: 'css',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  jsx: 'jsx', ts: 'typescript', tsx: 'jsx',
  json: 'json', py: 'python', sh: 'bash', bash: 'bash',
  php: 'php', go: 'go', rs: 'rust', rb: 'ruby',
  java: 'java', cs: 'csharp', yml: 'yaml', yaml: 'yaml',
  md: 'markdown', markdown: 'markdown',
};

// Above this size, colouring every keystroke costs more than it's worth.
const HIGHLIGHT_MAX_CHARS = 300000;
let codeLang = null;
let highlightTimer = null;

function languageFor(rel) {
  const ext = (rel.split('.').pop() || '').toLowerCase();
  return CODE_LANGS[ext] || null;
}

function paintHighlight() {
  const text = codeEditor.value;
  if (!codeLang || text.length > HIGHLIGHT_MAX_CHARS || !window.Prism) {
    // Fall back to plain text: still correct, just uncoloured.
    codeHighlightInner.textContent = text;
    return;
  }
  const grammar = window.Prism.languages[codeLang];
  if (!grammar) {
    codeHighlightInner.textContent = text;
    return;
  }
  // The trailing newline keeps the last line's height when the file ends
  // with one, so the overlay and the textarea stay aligned.
  codeHighlightInner.innerHTML = window.Prism.highlight(text + '\n', grammar, codeLang);
}

function queueHighlight() {
  clearTimeout(highlightTimer);
  highlightTimer = setTimeout(paintHighlight, 90);
}

function syncEditorScroll() {
  codeGutter.scrollTop = codeEditor.scrollTop;
  codeHighlight.scrollTop = codeEditor.scrollTop;
  codeHighlight.scrollLeft = codeEditor.scrollLeft;
}

function setEditorText(text) {
  codeEditor.value = text;
  paintGutter();
  paintHighlight();
  syncEditorScroll();
}

function paintGutter() {
  const lines = codeEditor.value.split('\n').length;
  codeGutter.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
  codeGutter.scrollTop = codeEditor.scrollTop;
}

function stashCurrentEdit() {
  if (!codeCurrent) return;
  if (codeEditor.value !== codeCurrent.saved) {
    codeEdits.set(codeCurrent.path, { text: codeEditor.value, saved: codeCurrent.saved });
  } else {
    codeEdits.delete(codeCurrent.path);
  }
}

function updateDirty() {
  const dirty = !!codeCurrent && codeEditor.value !== codeCurrent.saved;
  codeDirty.classList.toggle('hidden', !dirty);
  btnCodeSave.disabled = !dirty;
  btnCodeRevert.disabled = !dirty;
  btnCodeExport.classList.toggle('primary', codeEdits.size > 0 || dirty);
}

codeEditor.addEventListener('input', () => {
  paintGutter();
  queueHighlight();
  stashCurrentEdit();
  updateDirty();
  renderFileList();
});
codeEditor.addEventListener('scroll', syncEditorScroll);

// Tab should indent rather than jump to the next control.
codeEditor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = codeEditor.selectionStart;
    const end = codeEditor.selectionEnd;
    codeEditor.value = codeEditor.value.slice(0, start) + '  ' + codeEditor.value.slice(end);
    codeEditor.selectionStart = codeEditor.selectionEnd = start + 2;
    paintGutter();
    queueHighlight();
    stashCurrentEdit();
    updateDirty();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveCurrentFile();
  }
});

async function saveCurrentFile() {
  if (!codeCurrent) return;
  const text = codeEditor.value;
  const res = await window.benchdrop.codeWrite(codeCurrent.path, text);
  if (!res || !res.ok) {
    codeStatus.textContent = (res && res.message) || 'Could not save.';
    return;
  }
  codeCurrent.saved = text;
  codeEdits.delete(codeCurrent.path);
  updateDirty();
  renderFileList();
  codeStatus.textContent = `Saved ${codeCurrent.path}` +
    (liveReloadOn ? ' — the page will reload.' : '');
}

btnCodeSave.addEventListener('click', saveCurrentFile);

btnCodeRevert.addEventListener('click', () => {
  if (!codeCurrent) return;
  setEditorText(codeCurrent.saved);
  codeEdits.delete(codeCurrent.path);
  updateDirty();
  renderFileList();
  codeStatus.textContent = 'Reverted to the last saved version.';
});

btnCodeExport.addEventListener('click', async () => {
  const unsaved = codeEdits.size + (codeCurrent && codeEditor.value !== codeCurrent.saved ? 1 : 0);
  if (unsaved) {
    codeStatus.textContent =
      'Heads up: unsaved changes are not included — save them first, then export.';
  }
  const res = await window.benchdrop.codeExport();
  if (!res) return;
  if (res.canceled) return;
  codeStatus.textContent = res.ok
    ? `Exported ${res.count} files to ${res.file}`
    : `Export failed: ${res.message}`;
});

// --- Native programs -----------------------------------------------------
// A Windows program can't be drawn inside a web view, so the pane shows a
// live mirror of its window - or, docked, the real window itself sits in the
// pane. Everything else (log, Trace, Capture, Autotest, Stop) works as usual.
let nativeMode = false;
let nativeInfo = null;       // from native-started
let nativeDocked = false;
let nativeHasWindow = false;
let nativeRunning = false;   // false once it exits, until it's started again
let mirrorStream = null;
let mirrorPoll = null;
const dockHiddenFor = new Set();

function showNativePicker(info, projectDir) {
  currentProjectDir = projectDir;
  dropzone.classList.add('hidden');
  nativePicker.classList.remove('hidden');
  btnReset.classList.remove('hidden');
  btnFolder.classList.remove('hidden');
  nativePickerSub.textContent = info.exes.length > 1
    ? `"${info.name}" has ${info.exes.length} programs in it. Pick the one to test.`
    : `"${info.name}"`;
  nativeExe.innerHTML = '';
  for (const e of info.exes) {
    const o = document.createElement('option');
    o.value = e;
    o.textContent = e;
    nativeExe.appendChild(o);
  }
  if (info.preselect) nativeExe.value = info.preselect;
  nativeArgs.value = '';
  setIndicator('idle', 'Ready to run');
}

btnRunNative.addEventListener('click', () => {
  if (!currentProjectDir || !nativeExe.value) return;
  nativePicker.classList.add('hidden');
  logpanel.classList.remove('hidden');
  setAppBusy(true);
  setIndicator('busy', 'Starting...');
  window.benchdrop.runNative(currentProjectDir, nativeExe.value, nativeArgs.value);
});

function stageBounds() {
  const r = nativeStage.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

function setPlaceholder(title, text) {
  nativePlaceholderTitle.textContent = title;
  nativePlaceholderText.textContent = text || '';
  nativePlaceholder.classList.remove('hidden');
}

function enterNativeMode(p) {
  nativeMode = true;
  nativeRunning = true;
  nativeInfo = p;
  nativeDocked = false;
  nativeHasWindow = false;
  document.body.classList.add('native-mode');
  dropzone.classList.add('hidden');
  nativePicker.classList.add('hidden');
  appview.classList.add('hidden');
  nativeView.classList.remove('hidden');
  runControls.classList.remove('hidden');
  runUrl.textContent = p.path;
  runUrl.title = p.path;
  btnViewToggle.classList.remove('hidden');
  btnReset.classList.remove('hidden');
  btnFolder.classList.remove('hidden');
  nativeName.textContent = p.exe;
  nativeMeta.textContent = `process ${p.pid}${p.args ? ' · ' + p.args : ''}`;
  nativeState.textContent = 'Running';
  nativeState.className = 'native-state ok';
  btnNativeDock.textContent = 'Dock here';
  btnNativeDock.disabled = true;
  btnNativeFront.disabled = true;
  btnNativeDock.classList.toggle('hidden', !p.windows);
  btnNativeFront.classList.toggle('hidden', !p.windows);
  if (p.windows) {
    setPlaceholder('Waiting for the program to open a window…', 'Its output appears in the log as it runs.');
  } else {
    setPlaceholder('The program is running.',
      'Live view, docking, window capture and Autotest for native programs need Windows. Its output, network traffic and exit are in the log.');
  }
  setAppBusy(false);
  setIndicator('ready', 'Running');
}

function exitNativeMode() {
  if (!nativeMode) return;
  stopMirror();
  nativeMode = false;
  nativeRunning = false;
  nativeDocked = false;
  nativeHasWindow = false;
  dockHiddenFor.clear();
  document.body.classList.remove('native-mode');
  nativeView.classList.add('hidden');
  cancelNativeRegion();
}

async function startMirror() {
  stopMirror();
  if (nativeDocked) return;
  const id = await window.benchdrop.nativeSource();
  if (id) {
    try {
      mirrorStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: id, maxWidth: 3840, maxHeight: 2160, maxFrameRate: 30 } },
      });
      nativeMirror.srcObject = mirrorStream;
      nativeMirror.classList.remove('hidden');
      nativeStill.classList.add('hidden');
      nativePlaceholder.classList.add('hidden');
      nativeHint.classList.remove('hidden');
      return;
    } catch (e) {
      /* fall back to still frames below */
    }
  }
  // Fallback: refresh a still image of the window about once a second.
  const tick = async () => {
    const f = await window.benchdrop.nativeFrame();
    if (!f || !nativeMode || nativeDocked) return;
    nativeStill.src = f.dataUrl;
    nativeStill.classList.remove('hidden');
    nativePlaceholder.classList.add('hidden');
    nativeHint.classList.remove('hidden');
  };
  await tick();
  mirrorPoll = setInterval(tick, 1100);
}

function stopMirror() {
  if (mirrorStream) {
    for (const t of mirrorStream.getTracks()) t.stop();
    mirrorStream = null;
  }
  clearInterval(mirrorPoll);
  mirrorPoll = null;
  nativeMirror.srcObject = null;
  nativeMirror.classList.add('hidden');
  nativeStill.classList.add('hidden');
  nativeHint.classList.add('hidden');
}

// The mirror is a picture (with the program's own pointer drawn into it), not
// the program: a click brings the real window forward instead of going nowhere.
for (const el of [nativeMirror, nativeStill]) {
  el.addEventListener('click', () => {
    if (!nativeMode || nativeDocked || !nativeRegion.classList.contains('hidden')) return;
    window.benchdrop.nativeShow(true, true);
  });
}

// A docked window is a real Windows child window, drawn above Benchdrop's
// own page - so anything Benchdrop shows over the pane (a menu, a panel, the
// code view) would be hidden behind it. Those hide the docked window while
// they're open.
async function setDockHidden(reason, hidden) {
  if (hidden) dockHiddenFor.add(reason);
  else dockHiddenFor.delete(reason);
  if (!nativeMode || !nativeDocked) return;
  await window.benchdrop.nativeShow(dockHiddenFor.size === 0, false);
}

btnNativeDock.addEventListener('click', async () => {
  if (!nativeDocked) {
    stopMirror();
    const res = await window.benchdrop.nativeDock(stageBounds());
    if (!res || !res.ok) {
      log(`[Benchdrop] Couldn't dock it: ${(res && res.message) || 'unknown error'}\n`);
      startMirror();
      return;
    }
    nativeDocked = true;
    nativePlaceholder.classList.add('hidden');
    btnNativeDock.textContent = 'Undock';
    btnNativeFront.classList.add('hidden');
  } else {
    await window.benchdrop.nativeUndock();
    nativeDocked = false;
    btnNativeDock.textContent = 'Dock here';
    btnNativeFront.classList.remove('hidden');
    startMirror();
  }
});

btnNativeFront.addEventListener('click', () => window.benchdrop.nativeShow(true, true));
btnNativeRestart.addEventListener('click', async () => {
  stopMirror();
  setIndicator('busy', 'Restarting...');
  await window.benchdrop.nativeRestart();
});

// Keep a docked window fitted to the pane as Benchdrop is resized.
let dockMoveTimer = null;
new ResizeObserver(() => {
  if (!nativeMode || !nativeDocked) return;
  clearTimeout(dockMoveTimer);
  dockMoveTimer = setTimeout(() => window.benchdrop.nativeMove(stageBounds()), 60);
}).observe(nativeStage);

// --- capture for a native program ---
async function handleNativeCapture(mode) {
  if (!nativeHasWindow) {
    log('[Benchdrop] The program has no window to capture.\n');
    return;
  }
  if (mode === 'region') {
    startNativeRegion();
    return;
  }
  setIndicator('busy', 'Capturing...');
  await window.benchdrop.nativeCapture(null);
  setIndicator('ready', 'Running');
}

// Region select works on a still frame, so it behaves the same whether the
// window is mirrored or docked.
let nativeRegionStart = null;
async function startNativeRegion() {
  const f = await window.benchdrop.nativeFrame();
  if (!f) {
    log("[Benchdrop] Couldn't get a picture of the window to select from.\n");
    return;
  }
  await setDockHidden('region', true);
  nativeMirror.classList.add('hidden');
  nativeStill.src = f.dataUrl;
  nativeStill.classList.remove('hidden');
  nativeRegion.classList.remove('hidden');
  nativeRegionBox.classList.add('hidden');
  nativeRegionStart = null;
}

function cancelNativeRegion() {
  nativeRegion.classList.add('hidden');
  nativeRegionBox.classList.add('hidden');
  nativeRegionStart = null;
  if (dockHiddenFor.has('region')) setDockHidden('region', false);
  if (nativeMode && !nativeDocked && mirrorStream) {
    nativeStill.classList.add('hidden');
    nativeMirror.classList.remove('hidden');
  }
}

// Where the picture actually sits inside the <img> (it's letterboxed).
function stillContentRect() {
  const r = nativeStill.getBoundingClientRect();
  const iw = nativeStill.naturalWidth || 1;
  const ih = nativeStill.naturalHeight || 1;
  const scale = Math.min(r.width / iw, r.height / ih);
  const w = iw * scale;
  const h = ih * scale;
  return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h };
}

nativeRegion.addEventListener('mousedown', (e) => {
  nativeRegionStart = { x: e.clientX, y: e.clientY };
  nativeRegionBox.classList.remove('hidden');
  const o = nativeRegion.getBoundingClientRect();
  Object.assign(nativeRegionBox.style, { left: `${e.clientX - o.left}px`, top: `${e.clientY - o.top}px`, width: '0px', height: '0px' });
  e.preventDefault();
});
nativeRegion.addEventListener('mousemove', (e) => {
  if (!nativeRegionStart) return;
  const o = nativeRegion.getBoundingClientRect();
  Object.assign(nativeRegionBox.style, {
    left: `${Math.min(e.clientX, nativeRegionStart.x) - o.left}px`,
    top: `${Math.min(e.clientY, nativeRegionStart.y) - o.top}px`,
    width: `${Math.abs(e.clientX - nativeRegionStart.x)}px`,
    height: `${Math.abs(e.clientY - nativeRegionStart.y)}px`,
  });
});
nativeRegion.addEventListener('mouseup', async (e) => {
  if (!nativeRegionStart) return;
  const c = stillContentRect();
  const x1 = Math.max(c.left, Math.min(e.clientX, nativeRegionStart.x));
  const y1 = Math.max(c.top, Math.min(e.clientY, nativeRegionStart.y));
  const x2 = Math.min(c.left + c.width, Math.max(e.clientX, nativeRegionStart.x));
  const y2 = Math.min(c.top + c.height, Math.max(e.clientY, nativeRegionStart.y));
  cancelNativeRegion();
  if (x2 - x1 < 5 || y2 - y1 < 5) {
    log('[Benchdrop] Selection was too small — nothing captured.\n');
    return;
  }
  // Proportions of the window, so the crop is exact at its real resolution.
  const rect = {
    x: (x1 - c.left) / c.width, y: (y1 - c.top) / c.height,
    width: (x2 - x1) / c.width, height: (y2 - y1) / c.height,
  };
  setIndicator('busy', 'Capturing...');
  await window.benchdrop.nativeCapture(rect);
  setIndicator('ready', 'Running');
});

function fmtMem(bytes) {
  if (!bytes) return '';
  return bytes > 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

// --- Autotest ------------------------------------------------------------
let autotestRunning = false;
let autotestReport = null;

function paintAutotestButton() {
  btnAutotest.textContent = autotestRunning ? 'Stop test' : 'Autotest';
  btnAutotest.classList.toggle('active', autotestRunning);
}

btnAutotest.addEventListener('click', async () => {
  if (autotestRunning) {
    await window.benchdrop.autotestStop();
    log('[Benchdrop] Stopping the autotest after the current step…\n');
    return;
  }
  if (!currentUrl && !nativeMode) {
    log('[Benchdrop] Start a project first — the autotest needs something running to test.\n');
    return;
  }
  autotestBanner.classList.add('hidden');
  autotestPanel.classList.remove('hidden');
  setDockHidden('autotest', true);
});

btnAutotestClose.addEventListener('click', () => {
  autotestPanel.classList.add('hidden');
  setDockHidden('autotest', false);
});

btnAutotestGo.addEventListener('click', async () => {
  if (nativeMode) {
    autotestPanel.classList.add('hidden');
    setDockHidden('autotest', false);
    logpanel.classList.remove('hidden');
    const r = await window.benchdrop.autotestStart({
      native: true,
      maxSteps: Number(autotestSteps.value) || 40,
      allowRisky: autotestRisky.checked,
    });
    if (!r || !r.ok) log(`[Benchdrop] ${(r && r.message) || 'Could not start the autotest.'}\n`);
    return;
  }
  const id = appViewId();
  if (id == null) {
    log('[Benchdrop] Nothing is showing in the app pane to test.\n');
    return;
  }
  // The explorer drives the app view, so make sure that's what's showing.
  if (typeof setCodeMode === 'function' && codeMode) setCodeMode(false);
  autotestPanel.classList.add('hidden');
  logpanel.classList.remove('hidden');
  const res = await window.benchdrop.autotestStart({
    webContentsId: id,
    maxSteps: Number(autotestSteps.value) || 40,
    allowRisky: autotestRisky.checked,
  });
  if (!res || !res.ok) {
    log(`[Benchdrop] ${(res && res.message) || 'Could not start the autotest.'}\n`);
  }
});

btnAutotestReport.addEventListener('click', () => {
  if (autotestReport) window.benchdrop.openPath(autotestReport);
});
btnAutotestDismiss.addEventListener('click', () => autotestBanner.classList.add('hidden'));

// --- Capture feedback ----------------------------------------------------
// A camera-shutter flash over the app pane plus a short-lived card, so a
// capture is obviously confirmed without having to read the log.
let shotToastTimer = null;

function flashShutter() {
  shotFlash.classList.remove('hidden');
  // Restart the animation even if a previous flash is still running.
  shotFlash.style.animation = 'none';
  void shotFlash.offsetWidth;
  shotFlash.style.animation = '';
  setTimeout(() => shotFlash.classList.add('hidden'), 360);
}

function showShotToast(payload) {
  if (payload.thumb) {
    shotThumb.src = payload.thumb;
    shotThumb.classList.remove('hidden');
  } else {
    shotThumb.classList.add('hidden');
  }
  shotNote.textContent = payload.note || '';
  shotName.textContent = payload.name || '';
  shotToast.classList.remove('hidden');
  clearTimeout(shotToastTimer);
  shotToastTimer = setTimeout(() => shotToast.classList.add('hidden'), 4500);
}

btnShotFolder.addEventListener('click', () => {
  window.benchdrop.openShotsFolder();
  shotToast.classList.add('hidden');
});
btnShotDismiss.addEventListener('click', () => {
  clearTimeout(shotToastTimer);
  shotToast.classList.add('hidden');
});

// --- Log copy / clear ----------------------------------------------------
btnCopyLog.addEventListener('click', async () => {
  // innerText (not textContent) so the rendered line breaks are preserved
  // and the linkified URLs come through as plain text.
  const text = logEl.innerText;
  if (!text.trim()) {
    btnCopyLog.textContent = 'Nothing yet';
    setTimeout(() => (btnCopyLog.textContent = 'Copy log'), 1200);
    return;
  }
  const ok = await window.benchdrop.copyText(text);
  const lines = text.split('\n').length;
  btnCopyLog.textContent = ok ? `Copied ${lines} lines` : 'Copy failed';
  btnCopyLog.classList.toggle('ok', ok);
  setTimeout(() => {
    btnCopyLog.textContent = 'Copy log';
    btnCopyLog.classList.remove('ok');
  }, 1600);
});

btnClearLog.addEventListener('click', () => {
  logEl.innerHTML = '';
  logAtLineStart = true;
});

// --- Screenshots ---------------------------------------------------------
function closeCaptureMenu() {
  captureMenu.classList.add('hidden');
  if (typeof setDockHidden === 'function') setDockHidden('menu', false);
}

btnCapture.addEventListener('click', (e) => {
  e.stopPropagation();
  const willShow = captureMenu.classList.contains('hidden');
  if (willShow) {
    // Anchor the fixed-position menu under the button, nudged left if it
    // would run off the right edge of the window.
    const r = btnCapture.getBoundingClientRect();
    const width = 268;
    const left = Math.min(r.left, window.innerWidth - width - 12);
    captureMenu.style.left = `${Math.max(8, left)}px`;
    captureMenu.style.top = `${r.bottom + 6}px`;
  }
  captureMenu.classList.toggle('hidden');
  setDockHidden('menu', !captureMenu.classList.contains('hidden'));
});

// Click anywhere else closes the menu.
document.addEventListener('click', (e) => {
  if (!captureMenu.classList.contains('hidden') && !e.target.closest('#capture-wrap')) {
    closeCaptureMenu();
  }
});

captureMenu.addEventListener('click', async (e) => {
  const opt = e.target.closest('.capture-opt');
  if (!opt) return;
  const mode = opt.dataset.mode;
  closeCaptureMenu();

  if (mode === 'folder') {
    window.benchdrop.openShotsFolder();
    return;
  }
  if (nativeMode) {
    handleNativeCapture(mode);
    return;
  }
  if (!currentUrl) {
    log('[Benchdrop] Load a project first — there is nothing in the app pane to capture.\n');
    return;
  }
  if (mode === 'region') {
    startRegionSelect();
    return;
  }
  setIndicator('busy', mode === 'full' ? 'Capturing page...' : 'Capturing...');
  await window.benchdrop.capture(appview.getWebContentsId(), mode, null);
  setIndicator(currentUrl ? 'ready' : 'idle', currentUrl ? 'Running' : 'Idle');
});

// --- Drag-to-select region ----------------------------------------------
let regionStart = null;

function startRegionSelect() {
  regionOverlay.classList.remove('hidden');
  regionBox.classList.add('hidden');
  regionStart = null;
}

function cancelRegionSelect() {
  regionOverlay.classList.add('hidden');
  regionBox.classList.add('hidden');
  regionStart = null;
}

regionOverlay.addEventListener('mousedown', (e) => {
  const r = regionOverlay.getBoundingClientRect();
  regionStart = { x: e.clientX - r.left, y: e.clientY - r.top };
  regionBox.classList.remove('hidden');
  regionBox.style.left = regionStart.x + 'px';
  regionBox.style.top = regionStart.y + 'px';
  regionBox.style.width = '0px';
  regionBox.style.height = '0px';
  e.preventDefault();
});

regionOverlay.addEventListener('mousemove', (e) => {
  if (!regionStart) return;
  const r = regionOverlay.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  regionBox.style.left = Math.min(x, regionStart.x) + 'px';
  regionBox.style.top = Math.min(y, regionStart.y) + 'px';
  regionBox.style.width = Math.abs(x - regionStart.x) + 'px';
  regionBox.style.height = Math.abs(y - regionStart.y) + 'px';
});

regionOverlay.addEventListener('mouseup', async (e) => {
  if (!regionStart) return;
  const r = regionOverlay.getBoundingClientRect();
  const x2 = e.clientX - r.left;
  const y2 = e.clientY - r.top;
  const rect = {
    x: Math.min(regionStart.x, x2),
    y: Math.min(regionStart.y, y2),
    width: Math.abs(x2 - regionStart.x),
    height: Math.abs(y2 - regionStart.y),
  };
  cancelRegionSelect();

  if (rect.width < 5 || rect.height < 5) {
    log('[Benchdrop] Selection was too small — nothing captured.\n');
    return;
  }
  setIndicator('busy', 'Capturing...');
  await window.benchdrop.capture(appview.getWebContentsId(), 'region', rect);
  setIndicator(currentUrl ? 'ready' : 'idle', currentUrl ? 'Running' : 'Idle');
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!regionOverlay.classList.contains('hidden')) cancelRegionSelect();
    if (!nativeRegion.classList.contains('hidden')) cancelNativeRegion();
    closeCaptureMenu();
  }
});

// --- Divider drag --------------------------------------------------------
let dragging = false;
divider.addEventListener('mousedown', (e) => {
  dragging = true;
  divider.classList.add('dragging');
  dragShield.classList.remove('hidden');
  e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const width = Math.max(240, Math.min(e.clientX, window.innerWidth - 320));
  logpanel.style.flexBasis = `${width}px`;
});
window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  divider.classList.remove('dragging');
  dragShield.classList.add('hidden');
});

// --- Theme ---------------------------------------------------------------
function applyTheme(theme) {
  document.body.classList.toggle('theme-light', theme === 'light');
}

window.benchdrop.onTheme(({ theme }) => applyTheme(theme));

// Menu items that belong to the window rather than the main process.
window.benchdrop.onMenu(({ action }) => {
  if (action === 'toggle-log') logpanel.classList.toggle('hidden');
  if (action === 'open') {
    if (!dropzone.classList.contains('hidden')) btnChoose.click();
    else btnNew.click();
  }
});

// --- Main-process events -------------------------------------------------
window.benchdrop.onLog(({ text, source }) => log(text, source));

window.benchdrop.onProcs((procs) => {
  const previous = procTarget.value;
  procTarget.innerHTML = '';
  for (const p of procs) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    procTarget.appendChild(opt);
  }
  if (procs.some((p) => p.id === previous)) procTarget.value = previous;
  const none = procs.length === 0;
  inputLine.disabled = none;
  btnSend.disabled = none;
  inputLine.placeholder = none
    ? 'Nothing is running'
    : 'Type a reply for a running process, then press Enter';
});

window.benchdrop.onStatus((payload) => {
  switch (payload.status) {
    case 'preparing':
      log('\n[Benchdrop] Preparing the JavaScript runtime...\n');
      setAppBusy(true);
      setIndicator('busy', 'Preparing runtime...');
      break;
    case 'installing':
      log('\n[Benchdrop] Installing dependencies...\n');
      setAppBusy(true);
      setIndicator('busy', 'Installing dependencies...');
      break;
    case 'starting':
      log('\n[Benchdrop] Starting...\n');
      setAppBusy(true);
      setIndicator('busy', 'Starting...');
      break;
    case 'stalled':
      setIndicator('stalled', 'Taking longer than usual...');
      break;
    case 'ready':
      log(`\n[Benchdrop] Ready at ${payload.url}\n`);
      showApp(payload.url);
      if (traceOn) setTimeout(() => window.benchdrop.setTrace(true, appViewId()), 400);
      setAppBusy(false);
      setIndicator('ready', 'Running');
      break;
    case 'auth-url':
      lastAuthUrl = payload.url;
      authBannerText.textContent =
        `"${payload.script}" printed a sign-in link. Open it to authorize with your own account, ` +
        'then come back — it will keep going on its own.';
      authBanner.classList.remove('hidden');
      break;
    case 'suggest-command':
      suggestReason.textContent = payload.reason;
      suggestCommand.textContent = payload.command;
      suggestBanner.classList.remove('hidden');
      break;
    case 'command-running':
      setAppBusy(true);
      setIndicator('busy', 'Running command...');
      break;
    case 'command-done':
      log('\n[Benchdrop] Setup command finished. If it changed the backend, press Stop and run the project again.\n');
      setAppBusy(false);
      setIndicator(currentUrl ? 'ready' : 'idle', currentUrl ? 'Running' : 'Idle');
      break;
    case 'port-conflict': {
      conflictPort = payload.port;
      const who = payload.pids && payload.pids.length
        ? `Found process ${payload.pids.join(', ')} holding it.`
        : 'Could not identify which process is holding it.';
      // Vite (and others) just move to the next port: the app still runs, so
      // this is a note with the option to free the port, not an error.
      if (payload.moved) {
        portTitle.textContent = `Port ${payload.port} was in use, so "${payload.script}" moved to another port.`;
        portReason.textContent =
          `Something else already holds port ${payload.port} - often a server left over from an earlier run, or ` +
          `another script in this project that uses the same port. ${who} ` +
          'The app is running on the new port; freeing it stops that process and starts this project again.';
        portBanner.classList.remove('hidden');
        log(`\n[Benchdrop] Port ${payload.port} was in use, so "${payload.script}" moved to another port.\n`);
        break;
      }
      portTitle.textContent = `Port ${payload.port} is already in use.`;
      portReason.textContent =
        `"${payload.script}" could not start because something else is on port ${payload.port} — ` +
        `usually a server left over from an earlier run. ${who} ` +
        'Freeing it will stop that process and start this project again.';
      portBanner.classList.remove('hidden');
      log(`\n[Benchdrop] Port ${payload.port} is busy.\n`);
      setAppBusy(false);
      setIndicator('error', `Port ${payload.port} busy`);
      break;
    }
    case 'python-missing':
      setAppBusy(false);
      setIndicator('error', 'Python not found');
      log('\n[Benchdrop] Python 3.9+ is required for this project but was not found. ' +
          'Install it from python.org (tick "Add Python to PATH"), then restart Benchdrop.\n');
      break;
    case 'script-finished':
      setAppBusy(false);
      setIndicator(payload.code === 0 ? 'stopped' : 'error',
                   payload.code === 0 ? 'Finished' : `Exited (${payload.code})`);
      break;
    case 'reload-app':
      if (currentUrl) appview.reload();
      break;
    case 'native-started':
      enterNativeMode(payload);
      break;
    case 'native-window':
      if (!nativeMode) break;
      nativeHasWindow = true;
      btnNativeDock.disabled = false;
      btnNativeFront.disabled = false;
      if (!nativeDocked) startMirror();
      break;
    case 'native-info': {
      if (!nativeMode) break;
      const parts = [`process ${nativeInfo.pid}`];
      if (payload.mem) parts.push(fmtMem(payload.mem));
      if (payload.windows > 1) parts.push(`${payload.windows} windows`);
      if (payload.procs > 1) parts.push(`${payload.procs} processes`);
      nativeMeta.textContent = parts.join(' · ');
      if (payload.title) nativeName.textContent = `${nativeInfo.exe} — ${payload.title}`;
      nativeState.textContent = payload.responding ? 'Running' : 'Not responding';
      nativeState.className = `native-state ${payload.responding ? 'ok' : 'bad'}`;
      if (!payload.hasWindow && !nativeDocked && nativeHasWindow) {
        nativeHasWindow = false;
        stopMirror();
        setPlaceholder('The program has no window open right now.', 'It may be minimised to the tray, or between windows.');
      } else if (payload.hasWindow && !nativeHasWindow) {
        nativeHasWindow = true;
        btnNativeDock.disabled = false;
        btnNativeFront.disabled = false;
        if (!nativeDocked) startMirror();
      }
      break;
    }
    case 'native-exited':
      if (!nativeMode) break;
      stopMirror();
      nativeRunning = false;
      nativeDocked = false;
      nativeHasWindow = false;
      btnNativeDock.textContent = 'Dock here';
      btnNativeDock.disabled = true;
      btnNativeFront.disabled = true;
      nativeState.textContent = payload.crashed ? 'Crashed' : 'Exited';
      nativeState.className = `native-state ${payload.crashed ? 'bad' : ''}`;
      setPlaceholder(
        payload.crashed ? `${payload.exe} crashed — ${payload.name}` : `${payload.exe} ${payload.name}`,
        (payload.meaning ? payload.meaning + '. ' : '') + 'The log has the details. Restart runs it again.'
      );
      setIndicator(payload.crashed ? 'error' : 'stopped', payload.crashed ? 'Crashed' : 'Exited');
      break;
    case 'autotest-started':
      autotestRunning = true;
      paintAutotestButton();
      setIndicator('busy', 'Autotest starting…');
      break;
    case 'autotest-progress':
      setIndicator('busy', `Autotest step ${payload.step}/${payload.max}` +
        (payload.issues ? ` · ${payload.issues} issue${payload.issues === 1 ? '' : 's'}` : ''));
      break;
    case 'autotest-done': {
      autotestRunning = false;
      paintAutotestButton();
      // A program that exited has already set it to Exited or Crashed.
      if (!(nativeMode && !nativeRunning)) {
        const live = currentUrl || nativeMode;
        setIndicator(live ? 'ready' : 'idle', live ? 'Running' : 'Idle');
      }
      autotestReport = payload.report || null;
      const c = payload.counts || {};
      const serious = (c.critical || 0) + (c.high || 0);
      autotestBannerTitle.textContent = payload.error
        ? 'Autotest stopped with an error'
        : payload.issues
          ? `Autotest found ${payload.issues} issue${payload.issues === 1 ? '' : 's'}` +
            (serious ? ` (${serious} serious)` : '')
          : 'Autotest found no problems';
      autotestBannerText.textContent = payload.error
        ? payload.error
        : `${payload.steps} steps across ${payload.screens} screen${payload.screens === 1 ? '' : 's'}.`;
      btnAutotestReport.classList.toggle('hidden', !autotestReport);
      autotestBanner.classList.remove('hidden');
      break;
    }
    case 'connect-claude':
      openConnectPanel();
      break;
    case 'capture-done':
      flashShutter();
      showShotToast(payload);
      break;
    case 'stopped':
      log('\n[Benchdrop] Stopped.\n');
      setAppBusy(false);
      setIndicator('stopped', 'Stopped');
      break;
    case 'reset':
      logEl.innerHTML = '';
      setAppBusy(false);
      setIndicator('idle', 'Idle');
      break;
    case 'error':
      log(`\n[Benchdrop] ERROR: ${payload.message}\n`);
      logpanel.classList.remove('hidden');
      setAppBusy(false);
      setIndicator('error', 'Error');
      break;
  }
});

// --- Claude connector ----------------------------------------------------
// Claude's requests arrive from main.js. Opening and running go through the
// same functions as the drop zone and the Run buttons, so Claude gets exactly
// what a person would: the same pickers, defaults and setup notes.
const connectPanel = $('connect-panel');
const btnConnectClose = $('btn-connect-close');
const btnConnectDesktop = $('btn-connect-desktop');
const connectDesktopNote = $('connect-desktop-note');
const connectCmd = $('connect-cmd');
const btnConnectCopy = $('btn-connect-copy');
const connectState = $('connect-state');

const shown = (el) => !el.classList.contains('hidden');

function connectorPicker() {
  if (shown(scriptPicker)) {
    return {
      kind: 'scripts',
      scripts: [...scriptList.querySelectorAll('input[type=checkbox]')].map((cb) => {
        const cmd = cb.parentElement.querySelector('.muted');
        return { name: cb.value, checked: cb.checked, cmd: cmd ? cmd.textContent : '' };
      }),
      note: shown(setupNote) ? setupNote.textContent : '',
    };
  }
  if (shown(nativePicker)) {
    return { kind: 'native', programs: [...nativeExe.options].map((o) => o.value), selected: nativeExe.value };
  }
  if (shown(modePicker)) {
    const pages = [...modeOptions.querySelectorAll('button')].slice(0, -1)
      .map((b) => b.querySelector('strong').textContent.replace(/^Open /, ''));
    return { kind: 'mode', pages };
  }
  if (shown(runtimePicker)) {
    return {
      kind: 'runtime',
      runtime: runtimeInfo ? runtimeInfo.runtimeLabel : '',
      available: !!(runtimeInfo && runtimeInfo.available),
      options: ((runtimeInfo && runtimeInfo.options) || []).map((o) => o.label),
    };
  }
  if (shown(pythonPicker)) {
    return {
      kind: 'python',
      entries: [...pythonEntry.options].map((o) => o.value),
      available: !btnRunPython.disabled,
      hasRequirements: shown(pythonReqRow),
    };
  }
  return null;
}

function connectorState() {
  return {
    project: currentProjectDir ? currentProjectDir.split(/[\\/]/).filter(Boolean).pop() : null,
    picker: connectorPicker(),
    url: currentUrl,
    native: nativeMode,
    indicator: statusLabel.textContent,
    settled: ['error', 'stopped'].includes(statusPill.className) || shown(noUiPanel),
  };
}

async function connectorOpen({ target }) {
  if (/^https?:\/\//i.test(target)) {
    urlInput.value = target;
    await loadFromUrl();
  } else {
    await handleZipPath(target);
  }
  return connectorState();
}

function connectorRun(a) {
  if (shown(scriptPicker)) {
    const boxes = [...scriptList.querySelectorAll('input[type=checkbox]')];
    if (a.scripts && a.scripts.length) {
      const unknown = a.scripts.filter((n) => !boxes.some((b) => b.value === n));
      if (unknown.length) return { refused: `There's no script called ${unknown.join(', ')} in package.json.` };
      boxes.forEach((b) => { b.checked = a.scripts.includes(b.value); });
    }
    const chosen = boxes.filter((b) => b.checked).map((b) => b.value);
    if (!chosen.length) return { refused: 'No scripts are selected to run.' };
    btnRun.click();
    return { describe: chosen.join(' + ') };
  }
  if (shown(nativePicker)) {
    if (a.program) {
      if (![...nativeExe.options].some((o) => o.value === a.program)) return { refused: `There's no program called ${a.program} here.` };
      nativeExe.value = a.program;
    }
    if (a.arguments != null) nativeArgs.value = String(a.arguments);
    btnRunNative.click();
    return { describe: nativeExe.value + (nativeArgs.value ? ` ${nativeArgs.value}` : '') };
  }
  if (shown(modePicker)) {
    const buttons = [...modeOptions.querySelectorAll('button')];
    const want = a.entry || '';
    const b = !want ? buttons[0]
      : want === 'python' ? buttons[buttons.length - 1]
        : buttons.find((x) => x.querySelector('strong').textContent === `Open ${want}`);
    if (!b) return { refused: `"${want}" isn't one of the choices.` };
    b.click();
    // "python" leads to the Python picker; run that with its defaults.
    if (want === 'python') return connectorRun({ arguments: a.arguments, install_requirements: a.install_requirements });
    return { describe: want || 'the page' };
  }
  if (shown(runtimePicker)) {
    if (!runtimeInfo || !runtimeInfo.available) {
      return { refused: `${runtimeInfo ? runtimeInfo.runtimeLabel : 'Its language'} isn't installed on this computer. The person needs to install it, then reopen the project.` };
    }
    let i = 0;
    if (a.option) {
      i = runtimeInfo.options.findIndex((o) => o.label === a.option);
      if (i < 0) return { refused: `"${a.option}" isn't one of the run options.` };
    }
    const radio = runtimeList.querySelector(`input[value="${i}"]`);
    if (radio) radio.checked = true;
    btnRunRuntime.click();
    return { describe: runtimeInfo.options[i] ? runtimeInfo.options[i].label : '' };
  }
  if (shown(pythonPicker)) {
    if (btnRunPython.disabled) return { refused: "Python isn't installed on this computer. The person needs to install it, then restart Benchdrop." };
    if (a.entry) {
      if (![...pythonEntry.options].some((o) => o.value === a.entry)) return { refused: `There's no script called ${a.entry} here.` };
      pythonEntry.value = a.entry;
    }
    if (a.arguments != null) pythonArgs.value = String(a.arguments);
    if (a.install_requirements != null) pythonInstallReq.checked = !!a.install_requirements;
    btnRunPython.click();
    return { describe: pythonEntry.value + (pythonArgs.value ? ` ${pythonArgs.value}` : '') };
  }
  return { refused: 'There is nothing waiting to be run.' };
}

const CONNECTOR_OPS = {
  open: connectorOpen,
  run: connectorRun,
  state: connectorState,
  appview: () => (currentUrl && !nativeMode ? appViewId() : null),
  log: ({ lines }) => logEl.innerText.split('\n').slice(-(lines || 150)).join('\n'),
  stop: async () => {
    btnStop.click();
    await new Promise((r) => setTimeout(r, 1200));
    return true;
  },
};

window.benchdrop.onConnectorRequest(async ({ id, op, args }) => {
  try {
    const fn = CONNECTOR_OPS[op];
    if (!fn) throw new Error(`unknown request ${op}`);
    window.benchdrop.connectorReply(id, await fn(args || {}));
  } catch (e) {
    window.benchdrop.connectorReply(id, undefined, e.message);
  }
});

// --- Connect to Claude dialog ---
async function openConnectPanel() {
  const s = await window.benchdrop.connectorSetup();
  connectCmd.textContent = s.claudeCode;
  btnConnectDesktop.disabled = !s.mcpbExists;
  connectDesktopNote.classList.toggle('hidden', s.mcpbExists);
  connectDesktopNote.textContent = s.mcpbExists ? '' : 'The extension file is only included in the installed app.';
  connectState.textContent = s.on
    ? 'The connector is on: Claude can reach Benchdrop while it is open, and will start it if it is closed.'
    : 'The connector is turned off in settings ("connector": false).';
  connectPanel.classList.remove('hidden');
  setDockHidden('connect', true);
}

function closeConnectPanel() {
  connectPanel.classList.add('hidden');
  setDockHidden('connect', false);
}

btnConnectClose.addEventListener('click', closeConnectPanel);
connectPanel.addEventListener('click', (e) => {
  if (e.target === connectPanel) closeConnectPanel();
});
btnConnectDesktop.addEventListener('click', async () => {
  const r = await window.benchdrop.connectorInstallDesktop();
  connectDesktopNote.classList.remove('hidden');
  connectDesktopNote.textContent = r.ok
    ? 'benchdrop.mcpb is selected in File Explorer — drag it onto Claude Desktop\'s Settings → Extensions page.'
    : r.message;
});
btnConnectCopy.addEventListener('click', async () => {
  await window.benchdrop.connectorCopy(connectCmd.textContent);
  btnConnectCopy.textContent = 'Copied';
  setTimeout(() => { btnConnectCopy.textContent = 'Copy'; }, 1500);
});
