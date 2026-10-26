// SPDX-License-Identifier: LicenseRef-Apache-2.0-with-Commons-Clause
// Copyright (c) 2026 Richard Griffith (d/b/a Griffith Software) — https://griffith.software
//
// Finishes Benchdrop.exe's version resource. This is NOT a signing step -
// Benchdrop releases are unsigned (see RELEASE.md). electron-builder runs the
// `win.sign` hook right after it writes each executable's version resource,
// which is the only point where the fields it gets wrong for our release
// rules can be corrected:
//
//   ProductVersion  3-part display version (electron-builder writes 4 parts)
//   OriginalFilename  the program's file name (electron-builder blanks it)
//
// FileVersion is already 4-part from `buildNumber: "0"` in package.json.
// Every other executable passing through (installer, uninstaller) is left
// alone; the installer's fields come from build/installer.nsh.

const path = require('path');
const { executeAppBuilder } = require('builder-util');
const { version } = require('../package.json');

exports.default = async function versionResource(configuration) {
  if (path.basename(configuration.path).toLowerCase() !== 'benchdrop.exe') return;
  await executeAppBuilder(['rcedit', '--args', JSON.stringify([
    configuration.path,
    '--set-product-version', version,
    '--set-version-string', 'ProductVersion', version,
    '--set-version-string', 'OriginalFilename', 'Benchdrop.exe',
  ])]);
};
