// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Griffith.Software — https://griffith.software
// main.js is one file that runs inside Electron, so its internals can't be
// required directly. These helpers lift named pieces out of it and evaluate
// them with stand-ins for the Electron bits, which lets the real shipping
// code be tested rather than a copy that can drift away from it.
//
// If a test suddenly fails with "cannot find X in main.js", a function was
// renamed - update the slice markers here, don't delete the test.
const fs = require('fs');
const path = require('path');

const MAIN = path.join(__dirname, '..', 'main.js');

// Line endings are normalised: a Windows checkout (core.autocrlf, as on the
// GitHub runner) gives CRLF, and the slice markers are written with \n.
function source() {
  return fs.readFileSync(MAIN, 'utf8').replace(/\r\n/g, '\n');
}

// The text of one top-level function declaration, braces balanced.
function fn(name, src = source()) {
  const start = src.search(new RegExp('^(async )?function ' + name + '\\(', 'm'));
  if (start < 0) throw new Error(`cannot find function ${name} in main.js`);
  let depth = 0;
  let i = src.indexOf('{', start);
  const from = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces reading ${name}`);
}

// The text of one top-level const/let declaration.
function decl(name, src = source()) {
  const re = new RegExp('^(const|let) ' + name + ' =[^]*?;$', 'm');
  const m = re.exec(src);
  if (!m) throw new Error(`cannot find declaration ${name} in main.js`);
  return m[0];
}

// Everything between two markers, inclusive of the first.
function between(startMark, endMark, src = source()) {
  const a = src.indexOf(startMark);
  const b = src.indexOf(endMark, a + 1);
  if (a < 0 || b < 0) throw new Error(`cannot slice ${startMark} .. ${endMark}`);
  return src.slice(a, b);
}

// Evaluate pieces of main.js with the given stand-ins in scope and return the
// named values.
function build(code, env = {}, exportNames = []) {
  const keys = Object.keys(env);
  const body = `
    ${keys.length ? `const { ${keys.join(', ')} } = __env;` : ''}
    ${code}
    return { ${exportNames.join(', ')} };
  `;
  return new Function('__env', body)(env);
}

module.exports = { source, fn, decl, between, build, MAIN };
