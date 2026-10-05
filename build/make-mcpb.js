// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Griffith.Software — https://griffith.software
// Builds mcp/benchdrop.mcpb: the Claude Desktop extension for the Claude
// connector. It's a zip of a manifest and mcp/benchdrop-mcp.js, which Claude
// Desktop runs with its own Node. The tool list comes from that script, so
// the extension always describes exactly what Benchdrop offers.
//
//   node build/make-mcpb.js        (npm run dist runs it first)

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const serverFile = path.join(root, 'mcp', 'benchdrop-mcp.js');
const { TOOLS, VERSION } = require(serverFile);

if (VERSION !== pkg.version) {
  console.error(`mcp/benchdrop-mcp.js says ${VERSION} but package.json is ${pkg.version} - bump both together.`);
  process.exit(1);
}

const manifest = {
  manifest_version: '0.2',
  name: 'benchdrop',
  display_name: 'Benchdrop',
  version: pkg.version,
  description: 'Let Claude open, run and test projects in Benchdrop on this computer.',
  long_description:
    'Benchdrop runs and tests software on Windows: zips, folders, single files, GitHub links and Windows programs. ' +
    'With this extension Claude can open a project in Benchdrop, run it, read its screen, click and type, take ' +
    'screenshots, read the log and run Autotest. Benchdrop must be installed. It refuses anything that looks ' +
    'destructive, never types into password fields for Claude, never follows links out of the app, and shows every ' +
    'action in its log.',
  author: { name: pkg.author || 'Benchdrop' },
  license: pkg.license,
  icon: 'icon.png',
  server: {
    type: 'node',
    entry_point: 'server/benchdrop-mcp.js',
    mcp_config: { command: 'node', args: ['${__dirname}/server/benchdrop-mcp.js'] },
  },
  tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
  compatibility: { platforms: ['win32'], runtimes: { node: '>=16.0.0' } },
};

const zip = new AdmZip();
zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
zip.addLocalFile(serverFile, 'server');
zip.addLocalFile(path.join(__dirname, 'icon.png'));
const out = path.join(root, 'mcp', 'benchdrop.mcpb');
zip.writeZip(out);
console.log(`wrote ${path.relative(root, out)} (${TOOLS.length} tools, v${pkg.version})`);
