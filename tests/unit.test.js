// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Griffith.Software — https://griffith.software
// Plain-node tests for the decision-making parts of Benchdrop: what it
// recognises, what it refuses, and how it describes things. No Electron, no
// window - run with `npm run test:unit`.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { source, fn, decl, between, build } = require('./_load');

let pass = 0;
let fail = 0;
const results = [];
function check(group, label, ok) {
  (ok ? pass++ : fail++);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${group} · ${label}`);
}
function section(name) {
  results.push('', `--- ${name} ---`);
}

const src = source();

// ---------------------------------------------------------------------------
section('exit codes');
const exits = build(
  [decl('NTSTATUS', src), fn('describeExitCode', src)].join('\n'),
  {},
  ['describeExitCode']
);
for (const [code, want, crashed] of [
  [0, 'exited normally', false],
  [-1073741819, 'access violation', true],
  [3221225477, 'access violation', true],
  [-1073741571, 'stack overflow', true],
  [-532462766, 'unhandled .NET exception', true],
  [-1073741515, 'DLL not found', true],
  [-1073741701, 'bad image format', true],
  [3, 'exit code 3', false],
]) {
  const d = exits.describeExitCode(code);
  check('exit code', `${code} → ${d.name}`, d.name === want && d.crashed === crashed);
}

// ---------------------------------------------------------------------------
section('argument splitting');
const args = build(fn('splitArgs', src), {}, ['splitArgs']);
check('args', 'quotes keep spaces together',
  JSON.stringify(args.splitArgs('--in "C:\\My Files\\a.txt" -v')) === JSON.stringify(['--in', 'C:\\My Files\\a.txt', '-v']));
check('args', 'empty quoted argument survives',
  JSON.stringify(args.splitArgs('--name ""')) === JSON.stringify(['--name', '']));
check('args', 'no arguments is an empty list', args.splitArgs('   ').length === 0);

// ---------------------------------------------------------------------------
section('finding programs');
const exesEnv = { fs, path };
const exesApi = build([decl('EXE_SKIP', src), fn('findExes', src)].join('\n'), exesEnv, ['findExes']);
const exeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-exes-'));
for (const f of ['Ledger.exe', 'unins000.exe', 'vc_redist.x64.exe', 'notes.txt',
  'bin/Debug/Ledger.exe', 'bin/Release/Ledger.exe', 'assets/tool.exe']) {
  fs.mkdirSync(path.dirname(path.join(exeDir, f)), { recursive: true });
  fs.writeFileSync(path.join(exeDir, f), '');
}
const found = exesApi.findExes(exeDir);
check('programs', 'top-level program comes first', found[0] === 'Ledger.exe');
check('programs', 'uninstallers and redistributables ignored', !found.some((f) => /unins|redist/i.test(f)));
check('programs', 'Release ranked above Debug',
  found.indexOf('bin/Release/Ledger.exe') < found.indexOf('bin/Debug/Ledger.exe'));
check('programs', 'unrelated folders not searched', !found.includes('assets/tool.exe'));
fs.rmSync(exeDir, { recursive: true, force: true });

// ---------------------------------------------------------------------------
section('port conflicts');
const ports = build(
  [decl('PORT_CONFLICT_RES', src), fn('findPortConflict', src)].join('\n'),
  {},
  ['findPortConflict']
);
for (const [line, want] of [
  ['  Version 0.3.0 is answering on port 5000.', 5000],
  ['A local backend is still running on port 3210.', 3210],
  ['Error: listen EADDRINUSE: address already in use :::5173', 5173],
  ['Port 3000 is already in use', 3000],
  ['listen tcp 0.0.0.0:8080: bind: address already in use', 8080],
  ['another instance already running on port 4000', 4000],
  ['  Local:   http://localhost:5173/', null],
  ['added 115 packages in 21s', null],
]) {
  check('ports', `${want === null ? 'ignores' : 'spots ' + want}: ${line.trim().slice(0, 40)}`,
    ports.findPortConflict(line) === want);
}

// ---------------------------------------------------------------------------
section('project links');
const urls = build(
  [fn('sanitizeName', src), fn('parseProjectUrl', src)].join('\n'),
  { path },
  ['parseProjectUrl']
);
check('links', 'repo link tries main then master', (() => {
  const r = urls.parseProjectUrl('https://github.com/facebook/react');
  return r.name === 'react' && /refs\/heads\/main$/.test(r.candidates[0]) && /refs\/heads\/master$/.test(r.candidates[1]);
})());
check('links', 'branch link pins that branch', (() => {
  const r = urls.parseProjectUrl('https://github.com/user/repo/tree/feature/new-ui');
  return r.candidates.length === 1 && r.candidates[0].endsWith('/refs/heads/feature/new-ui');
})());
check('links', '.git suffix handled', urls.parseProjectUrl('https://github.com/user/repo.git').name === 'repo');
check('links', 'direct zip accepted', urls.parseProjectUrl('https://example.com/build/app.zip').kind === 'zip');
for (const bad of ['not a url', 'ftp://example.com/x.zip', 'https://github.com/', 'https://gitlab.com/u/r']) {
  check('links', `rejects ${JSON.stringify(bad)}`, !!urls.parseProjectUrl(bad).error);
}

// ---------------------------------------------------------------------------
section('live reload: what is watched');
const WATCH_IGNORE = eval(decl('WATCH_IGNORE', src).replace(/^const WATCH_IGNORE = /, '').replace(/;$/, ''));
const WATCH_IGNORE_FILES = eval(decl('WATCH_IGNORE_FILES', src).replace(/^const WATCH_IGNORE_FILES = /, '').replace(/;$/, ''));
const ignored = (f) => WATCH_IGNORE.test(f) || WATCH_IGNORE_FILES.test(f);
for (const [file, want] of [
  ['index.html', false], ['src/app.js', false], ['src/components/Button.jsx', false],
  ['node_modules/react/index.js', true], ['.git/HEAD', true], ['dist/bundle.js', true],
  ['__pycache__/mod.pyc', true], ['npm-debug.log', true], ['.index.html.swp', true],
]) {
  check('watch', `${want ? 'ignores' : 'reloads on'} ${file}`, ignored(file) === want);
}

// ---------------------------------------------------------------------------
section('code view stays inside the project');
// safeProjectPath reads currentProjectDir from module scope; give it one.
const scoped = new Function('path', 'currentProjectDir', `
  ${fn('safeProjectPath', src)}
  return safeProjectPath;
`)(path, path.join(os.tmpdir(), 'bd-project'));
for (const [rel, allowed] of [
  ['index.html', true], ['src/app.js', true],
  ['../secrets.txt', false], ['../../etc/passwd', false],
  ['src/../../secrets.txt', false], [path.resolve('/etc/passwd'), false],
]) {
  let ok = true;
  try { scoped(rel); } catch (e) { ok = false; }
  check('scope', `${allowed ? 'allows' : 'blocks'} ${rel}`, ok === allowed);
}

// ---------------------------------------------------------------------------
section('connector: what Claude is allowed to do');
const vet = build(
  [fn('sampleInputFor', src), fn('elementKey', src), fn('vetChoice', src)].join('\n'),
  {},
  ['vetChoice']
);
const snap = { url: '/settings', elements: [
  { id: 'bd1', kind: 'button', label: 'Save', disabled: false, risky: false },
  { id: 'bd2', kind: 'button', label: 'Remove stored key', disabled: false, risky: true },
  { id: 'bd3', kind: 'field', label: 'API key', secret: true },
  { id: 'bd4', kind: 'field', label: 'Your name', secret: false, inputType: 'text' },
  { id: 'bd5', kind: 'button', label: 'Analyze', disabled: true },
  { id: 'bd6', kind: 'link', label: 'Docs', external: true },
]};
const at = { allowRisky: false, canGoBack: true };
for (const [label, req, want] of [
  ['ordinary button allowed', { action: 'click', target: 'bd1' }, 'click'],
  ['risky button refused', { action: 'click', target: 'bd2' }, null],
  ['secret field refused', { action: 'type', target: 'bd3', value: 'x' }, null],
  ['normal field allowed', { action: 'type', target: 'bd4', value: 'Sam' }, 'type'],
  ['disabled control refused', { action: 'click', target: 'bd5' }, null],
  ['external link refused', { action: 'click', target: 'bd6' }, null],
  ['invented element refused', { action: 'click', target: 'bd99' }, null],
  ['back allowed', { action: 'back' }, 'back'],
]) {
  const v = vet.vetChoice(at, snap, req);
  check('connector', label, (v.refused ? null : v.action) === want);
}
check('connector', 'a refusal says why', /destructive/.test(vet.vetChoice(at, snap, { action: 'click', target: 'bd2' }).refused || ''));
check('connector', 'back refused with nowhere to go', !!vet.vetChoice({ ...at, canGoBack: false }, snap, { action: 'back' }).refused);
check('connector', 'typed text is what Claude asked for', vet.vetChoice(at, snap, { action: 'type', target: 'bd4', value: 'Ada' }).value === 'Ada');

// The Node.js download is checked against nodejs.org's SHASUMS256.txt.
const sums = build(fn('expectedSha256', src), {}, ['expectedSha256']).expectedSha256;
const LIST = 'aa'.repeat(32) + '  node-v24.0.0-win-x64.7z\n' + 'BB'.repeat(32) + '  node-v24.0.0-win-x64.zip\n' + 'cc'.repeat(32) + '  node-v24.0.0-win-x64.zip.sig';
check('node', 'finds the zip\'s published hash', sums(LIST, 'node-v24.0.0-win-x64.zip') === 'bb'.repeat(32));
check('node', 'a file not on the list has no hash', sums(LIST, 'node-v24.0.0-win-arm64.zip') === null);
check('node', 'a near-miss name is not accepted', sums(LIST, 'node-v24.0.0-win-x64') === null);
check('node', 'the download is checked before it is unpacked',
  src.indexOf('expectedSha256(await httpsGetText') > 0 &&
  src.indexOf('expectedSha256(await httpsGetText') < src.indexOf('new AdmZip(zipPath).extractAllTo(destDir, true)'));

// What counts as risky: the action, not a word that merely describes.
const rules = between('const RISKY_FIRST', '\n// Runs in the page', src);
const riskyMain = build(rules, {}, ['isRiskyLabel']).isRiskyLabel;
// The page gets its own copy inside the snapshot script; evaluate that too.
const pageBit = between('  const RISKY_FIRST = new RegExp', '  const FIELD_TYPES', src);
const riskyPage = build(`${rules}\nconst PAGE = \`${pageBit}\`;\nconst isRiskyPage = new Function(PAGE + 'return isRisky;')();`, {}, ['isRiskyPage']).isRiskyPage;
for (const [label, want] of [
  ['Pay now', true], ['Delete all records', true], ['Yes, delete it', true], ['Remove stored key', true],
  ['Log out', true], ['Place order', true], ['Close my account', true], ['🗑 Delete', true], ['Checkout', true],
  ['Jobs & pay rules', false], ['Paychecks', false], ['Payment history', false], ['Sent messages', false], ['Send invoice', true],
  ['Save', false], ['Recalculate', false], ['Reset password', true], ['Clear all', true], ['Clear filters', false],
]) {
  check('risky', `"${label}" ${want ? 'is' : 'is not'} risky`, riskyMain(label) === want && riskyPage(label) === want);
}
check('risky', 'programs add Exit and Quit', riskyMain('Exit', true) && riskyMain('Quit', true) && !riskyMain('Exit'));

// The tools Claude is shown and the ones Benchdrop answers are the same list.
const mcp = require(path.join(__dirname, '..', 'mcp', 'benchdrop-mcp.js'));
const handlerBlock = between('const TOOL_HANDLERS = {', 'async function runConnectorTool', src);
const handled = [...handlerBlock.matchAll(/^  async (\w+)\(/gm)].map((m) => m[1]).filter((n) => !n.startsWith('_'));
const offered = mcp.TOOLS.map((t) => t.name);
check('connector', 'every tool offered has a handler', offered.every((n) => handled.includes(n)));
check('connector', 'every handler is offered', handled.every((n) => offered.includes(n)));
check('connector', 'version matches package.json',
  mcp.VERSION === JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version);
check('connector', 'only one installed Benchdrop runs at a time',
  /if \(app\.isPackaged && !app\.requestSingleInstanceLock\(\)\)/.test(src) && /app\.on\('second-instance'/.test(src));
check('connector', 'endpoint listens on this machine only', /server\.listen\(0, '127\.0\.0\.1'/.test(src));
check('connector', 'endpoint refuses web pages and wrong tokens',
  /if \(req\.headers\.origin/.test(src) && /authorization !== `Bearer \$\{token\}`/.test(src));

// The real connector script, spoken to over stdio the way Claude does. Its
// profile, install and ProgramData folders point somewhere empty, so it can't
// find (or start) Benchdrop - including the copy installed on the machine
// running the tests.
const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-mcp-'));
const rpc = (id, method, params) => JSON.stringify({ jsonrpc: '2.0', id, method, params });
// Windows variable names ignore case, and a second spelling doesn't replace
// the first, so drop every spelling before setting them. Windows also
// re-derives ProgramFiles for a 64-bit process from ProgramW6432.
const isolated = (programData) => Object.assign(
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(appdata|localappdata|programfiles|programw6432|programdata)$/i.test(k))),
  { APPDATA: empty, LOCALAPPDATA: empty, ProgramFiles: empty, ProgramW6432: empty, ProgramData: programData }
);
const talk = (messages, programData) => {
  const r = require('child_process').spawnSync(process.execPath, [path.join(__dirname, '..', 'mcp', 'benchdrop-mcp.js')], {
    input: messages.join('\n') + '\n', env: isolated(programData), encoding: 'utf8', timeout: 20000,
  });
  return Object.fromEntries((r.stdout || '').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((m) => [m.id, m]));
};
const init = rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
const replies = talk([
  init,
  JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  rpc(2, 'tools/list', {}),
  rpc(3, 'tools/call', { name: 'benchdrop_status', arguments: {} }),
  rpc(4, 'tools/call', { name: 'rm_rf', arguments: {} }),
], empty);
check('mcp', 'answers initialize', !!(replies[1] && replies[1].result && replies[1].result.serverInfo.name === 'benchdrop'));
check('mcp', 'agrees the protocol version', !!(replies[1] && replies[1].result.protocolVersion === '2025-06-18'));
check('mcp', 'lists the tools', !!(replies[2] && replies[2].result.tools.length === mcp.TOOLS.length));
check('mcp', 'says plainly when Benchdrop is missing',
  !!(replies[3] && replies[3].result && replies[3].result.isError && /couldn't be found/.test(replies[3].result.content[0].text)));
check('mcp', 'refuses an unknown tool', !!(replies[4] && replies[4].error));
check('mcp', 'ignores notifications', Object.keys(replies).length === 4);

// While the installer's "updating" flag is up, it must not start Benchdrop.
const programData = path.join(empty, 'ProgramData');
fs.mkdirSync(path.join(programData, 'Benchdrop'), { recursive: true });
const flag = path.join(programData, 'Benchdrop', 'updating');
fs.writeFileSync(flag, 'updating');
const during = talk([init, rpc(2, 'tools/call', { name: 'benchdrop_status', arguments: {} })], programData);
check('mcp', 'waits while Benchdrop is being updated',
  !!(during[2] && during[2].result.isError && /being installed or updated/.test(during[2].result.content[0].text)));
const old = new Date(Date.now() - 20 * 60 * 1000);
fs.utimesSync(flag, old, old);
const stale = talk([init, rpc(2, 'tools/call', { name: 'benchdrop_status', arguments: {} })], programData);
check('mcp', 'ignores a flag left by a cancelled install',
  !!(stale[2] && /couldn't be found/.test(stale[2].result.content[0].text)));
fs.rmSync(empty, { recursive: true, force: true });

// ---------------------------------------------------------------------------
section('secrets are masked in traces');
const injected = between('const TRACE_INJECT = `', '// Electron allows only ONE listener', src);
check('masking', 'password and token names are masked', /SECRET\s*=\s*\/pass\|pwd\|secret\|token\|key\|auth\|card\|cvv\|ssn\|otp\|pin\/i/.test(injected));
check('masking', 'a field value is never used as its label', /Never fall back to a field's value/.test(injected));

// ---------------------------------------------------------------------------
console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
