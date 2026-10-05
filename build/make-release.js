// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Griffith.Software — https://griffith.software
// Builds the release archive next to the project folder:
//
//   ../Benchdrop_vX.Y.Z.zip
//     Benchdrop_vX.Y.Z_win-x64_setup.exe  the installer (run npm run dist first)
//     START-HERE.txt                  points at the installer first
//     benchdrop-source-vX.Y.Z.zip     the source, without node_modules or builds,
//                                     plus this version's release/vX.Y.Z/ folder
//                                     (audit, release manifest, website drafts)
//
//   node build/make-release.js
//
// It only writes files on this computer; nothing is uploaded anywhere.

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const root = path.join(__dirname, '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const installer = path.join(root, 'dist', `Benchdrop_v${version}_win-x64_setup.exe`);
if (!fs.existsSync(installer)) {
  console.error(`No installer for ${version} - run npm run dist first.`);
  process.exit(1);
}

// The source: everything except what's installed or generated. Of release/,
// only this version's folder, without the installer (it's beside the source).
const SKIP = /^(node_modules|release|dist|archive|\.git)(\/|$)|^mcp\/[^/]+\.mcpb$|^build\/wood\.b64$|\.log$|(^|\/)(\.DS_Store|Thumbs\.db)$/;
const keepRelease = (rel) => rel === 'release' || rel === `release/v${version}` || rel.startsWith(`release/v${version}/`);
const source = new AdmZip();
let files = 0;
(function walk(dir) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (SKIP.test(rel) && !keepRelease(rel)) continue;
    if (rel.startsWith(`release/v${version}/`) && rel.endsWith('.exe')) continue;
    if (e.isDirectory()) walk(rel);
    else {
      source.addLocalFile(path.join(root, rel), `benchdrop/${path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel)}`);
      files++;
    }
  }
})('');

const startHere = fs.readFileSync(path.join(__dirname, 'START-HERE.txt'), 'utf8').replace(/\{VERSION\}/g, version);

const release = new AdmZip();
release.addLocalFile(installer);
release.addFile('START-HERE.txt', Buffer.from(startHere.replace(/\r?\n/g, '\r\n')));
release.addFile(`benchdrop-source-v${version}.zip`, source.toBuffer());
const out = path.join(root, '..', `Benchdrop_v${version}.zip`);
release.writeZip(out);
console.log(`wrote ${out} (source: ${files} files)`);
