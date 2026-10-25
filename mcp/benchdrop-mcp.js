#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Griffith.Software — https://griffith.software
// Benchdrop's Claude connector: an MCP server that Claude Desktop or Claude
// Code starts, speaking MCP over stdio. It holds no logic of its own - each
// tool call is passed to the running Benchdrop, which does the work and
// enforces the safety rules. If Benchdrop isn't running, it's started.
//
// Benchdrop listens on 127.0.0.1 only, and writes the port and a random token
// to %APPDATA%\benchdrop\connector.json each time it starts; a call without
// that token is refused.
//
// No dependencies, so it runs under Claude Desktop's own Node, or under
// Benchdrop.exe itself with ELECTRON_RUN_AS_NODE=1 (how Claude Code runs it).

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const VERSION = '4.5.3';

// The tools Claude sees. Benchdrop reads this same list, so the two can't drift.
const TOOLS = [
  {
    name: 'benchdrop_open',
    description:
      'Open a project in Benchdrop, the same as dropping it on the window: a .zip, a folder, a single .html/.py/.md file, ' +
      'a Windows program (.exe), an Android app (.apk) or Android Studio project, a GitHub repository link, or a direct .zip link. ' +
      'Returns what Benchdrop detected and the ' +
      'choices for running it (which scripts, which program, which entry file). Some projects start straight away.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Full path on this computer, or a GitHub / .zip URL' } },
      required: ['path'],
    },
  },
  {
    name: 'benchdrop_run',
    description:
      'Run the project that is open, using the choices benchdrop_open returned. Leave a choice out to use Benchdrop\'s default ' +
      '(the scripts it pre-selected, the first program, the first phone or emulator, and so on). An Android app is built, installed ' +
      'and started on the device (an emulator can take a minute or two to start). Waits until the app is showing or the program has a window, ' +
      'then returns the status.',
    inputSchema: {
      type: 'object',
      properties: {
        scripts: { type: 'array', items: { type: 'string' }, description: 'Node projects: package.json scripts to run together' },
        program: { type: 'string', description: 'Windows programs: which .exe' },
        arguments: { type: 'string', description: 'Command-line arguments for a program or Python script' },
        entry: { type: 'string', description: 'Python: the script to run; mixed projects: the .html file to open, or "python"' },
        option: { type: 'string', description: 'Other runtimes (Go, Rust, .NET, Java, PHP, Ruby): the label of the run option' },
        install_requirements: { type: 'boolean', description: 'Python: pip install -r requirements.txt first' },
        device: { type: 'string', description: 'Android: which phone or emulator (as benchdrop_open listed it, a serial such as emulator-5554, or an emulator name)' },
        build: { type: 'boolean', description: 'Android projects: build with Gradle first (default true; false installs the last build)' },
      },
    },
  },
  {
    name: 'benchdrop_status',
    description: 'What Benchdrop has open and running: the project, the app\'s address or the program and its windows, whether it is responding, and whether an autotest is running.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'benchdrop_snapshot',
    description:
      'Read the current screen of the running app or program: its address or window title, visible text, and every control ' +
      'that can be used, each with an id for benchdrop_act. Controls are flagged risky, disabled, secret or external; ' +
      'Benchdrop refuses to act on those. Take a new snapshot after anything changes the screen.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'benchdrop_act',
    description:
      'Use one control from the latest snapshot, the way a person would: click it, type into it, or change a selection; or go ' +
      'back (a page back, or close the dialog on top). Returns what happened afterwards: console errors, failed requests, error ' +
      'dialogs, crashes. Risky controls (delete, pay, send, log out...), password and secret fields, and links out of the app ' +
      'are refused - ask the person to do those themselves.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['click', 'type', 'select', 'back'] },
        target: { type: 'string', description: 'The control id from benchdrop_snapshot (not needed for back)' },
        value: { type: 'string', description: 'Text to type, for "type"' },
      },
      required: ['action'],
    },
  },
  {
    name: 'benchdrop_screenshot',
    description: 'A picture of the running app or program as it is right now.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'benchdrop_log',
    description:
      'Benchdrop\'s log: what Benchdrop did, the output of every script or program it started, and (with Trace on) every click, ' +
      'request, console message and error in the app. Passwords and secrets are already masked.',
    inputSchema: {
      type: 'object',
      properties: { lines: { type: 'number', description: 'How many of the most recent lines (default 150, up to 2000)' } },
    },
  },
  {
    name: 'benchdrop_autotest',
    description:
      'Run Benchdrop\'s explorer over the app: it tries every reachable control, fields before buttons, and records anything ' +
      'that breaks. Waits for it to finish and returns the report, with the steps leading to each problem. Risky controls are skipped.',
    inputSchema: {
      type: 'object',
      properties: { max_steps: { type: 'number', description: 'Stop after this many steps (default 40, up to 300)' } },
    },
  },
  {
    name: 'benchdrop_stop',
    description: 'Stop the running app or program, and everything it started.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const dataDir = () => path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'benchdrop');
const connectorFile = () => path.join(dataDir(), 'connector.json');
const readConnector = () => {
  try {
    return JSON.parse(fs.readFileSync(connectorFile(), 'utf8'));
  } catch (e) {
    return null;
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function post(info, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        host: '127.0.0.1', port: info.port, path: '/tool', method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': data.length, authorization: `Bearer ${info.token}` },
        timeout: timeoutMs,
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (d) => (text += d));
        res.on('end', () => {
          try {
            resolve(JSON.parse(text));
          } catch (e) {
            reject(new Error(`Benchdrop sent back something unreadable (${res.statusCode})`));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('Benchdrop took too long to answer')));
    req.on('error', reject);
    req.end(data);
  });
}

// Is the Benchdrop described by connector.json actually there?
async function reachable(info) {
  if (!info || !info.port) return false;
  try {
    const r = await post(info, { name: '_ping', arguments: {} }, 3000);
    return !!(r && r.ok);
  } catch (e) {
    return false;
  }
}

// While Benchdrop is being installed or updated, the installer leaves a flag
// in %ProgramData%\Benchdrop. Starting Benchdrop then would put back the very
// files the installer is replacing. A flag older than 15 minutes is left over
// from a cancelled install and is ignored.
function updating() {
  try {
    const flag = path.join(process.env.ProgramData || process.env.PROGRAMDATA || 'C:\\ProgramData', 'Benchdrop', 'updating');
    return Date.now() - fs.statSync(flag).mtimeMs < 15 * 60 * 1000;
  } catch (e) {
    return false;
  }
}
const UPDATING = 'Benchdrop is being installed or updated right now. Try again in a minute.';

// Start Benchdrop: the way it was last started (Benchdrop keeps that in
// connector.json even after it quits), or failing that the install this
// script came with, or Benchdrop's two standard install folders.
function launchBenchdrop(info) {
  let command = info && info.launch && info.launch.command;
  let args = (info && info.launch && info.launch.args) || [];
  if (!command || !fs.existsSync(command)) {
    const candidates = [
      path.resolve(__dirname, '..', '..', 'Benchdrop.exe'),   // resources\mcp -> install folder (Claude Code)
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Benchdrop', 'Benchdrop.exe'),
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Benchdrop', 'Benchdrop.exe'),
    ];
    command = candidates.find((p) => p && fs.existsSync(p));
    args = [];
  }
  if (!command) return false;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;   // or Benchdrop.exe would start as Node again
  const child = spawn(command, args, { detached: true, stdio: 'ignore', env, cwd: (info && info.launch && info.launch.cwd) || undefined });
  child.unref();
  return true;
}

async function connect() {
  let info = readConnector();
  if (await reachable(info)) return info;
  if (updating()) throw new Error(UPDATING);
  if (!launchBenchdrop(info)) {
    throw new Error("Benchdrop isn't running and couldn't be found. Open Benchdrop, then try again.");
  }
  const t0 = Date.now();
  while (Date.now() - t0 < 45000) {
    await sleep(700);
    info = readConnector();
    if (await reachable(info)) return info;
  }
  throw new Error('Benchdrop was started but didn\'t come up within 45 seconds.');
}

async function callTool(name, args) {
  const info = await connect();
  // Running or testing an app can take minutes; reading the screen doesn't.
  const long = name === 'benchdrop_autotest' || name === 'benchdrop_run' || name === 'benchdrop_open';
  const r = await post(info, { name, arguments: args || {} }, long ? 15 * 60 * 1000 : 120 * 1000);
  if (!r || !r.ok) throw new Error((r && r.error) || 'Benchdrop refused the request');
  return r.result;   // { content: [...], isError? }
}

// --- MCP over stdio: one JSON-RPC message per line --------------------------
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined || id === null) return;   // a notification; nothing to answer
  switch (method) {
    case 'initialize': {
      const asked = params && params.protocolVersion;
      reply(id, {
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'benchdrop', version: VERSION },
        instructions:
          'Benchdrop runs and tests software on this Windows computer and shows it in its own window. Open a project, run it, ' +
          'then read the screen with benchdrop_snapshot and use it with benchdrop_act, checking benchdrop_log and screenshots ' +
          'as you go. Benchdrop refuses risky actions, secret fields and external links; when it does, tell the person rather ' +
          'than looking for a way round it.',
      });
      return;
    }
    case 'ping':
      reply(id, {});
      return;
    case 'tools/list':
      reply(id, { tools: TOOLS });
      return;
    case 'tools/call': {
      const name = params && params.name;
      if (!TOOLS.some((t) => t.name === name)) {
        fail(id, -32602, `Unknown tool: ${name}`);
        return;
      }
      try {
        reply(id, await callTool(name, params.arguments));
      } catch (err) {
        reply(id, { content: [{ type: 'text', text: err.message }], isError: true });
      }
      return;
    }
    default:
      fail(id, -32601, `Method not found: ${method}`);
  }
}

function serve() {
  let buf = '';
  const inflight = new Set();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch (e) {
        fail(null, -32700, 'Parse error');
        continue;
      }
      const p = handle(msg).catch((err) => fail(msg.id ?? null, -32603, err.message));
      inflight.add(p);
      p.finally(() => inflight.delete(p));
    }
  });
  // The client closing stdin means it's done; answer what's in hand first.
  process.stdin.on('end', () => Promise.allSettled([...inflight]).then(() => process.exit(0)));
}

if (require.main === module) {
  // Under Claude Code this script runs on Benchdrop.exe itself, which keeps
  // that file in use; during an update, step aside rather than block it.
  if (updating() && /benchdrop\.exe$/i.test(process.execPath)) {
    process.stderr.write(`${UPDATING}\n`);
    process.exit(1);
  }
  serve();
}
module.exports = { TOOLS, VERSION };
