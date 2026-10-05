# Third-party notices

Benchdrop 4.3.3 is © 2026 Griffith.Software and MIT licensed (see `LICENSE`).
It ships the following third-party software. Each package's own license file
is shipped with it, at the path given. No GPL or other copyleft code is
shipped.

Generated from `package-lock.json` (runtime dependencies only) and the built
`dist/win-unpacked/` folder on 2026-10-05.

## Runtime and application framework

| Component | Version | License | Notice shipped at |
|---|---|---|---|
| Electron | 34.5.8 | MIT | `LICENSE.electron.txt` |
| Chromium (inside Electron), with ffmpeg, ANGLE (`libEGL.dll`, `libGLESv2.dll`), SwiftShader, Vulkan loader and the other components it lists | 132 | BSD-3-Clause and the licenses listed in the file | `LICENSES.chromium.html` |
| Node.js (inside Electron) | 20.19.1 | MIT and the licenses listed in `LICENSES.chromium.html` | `LICENSES.chromium.html` |
| npm, with its 174 bundled packages | 10.9.9 | Artistic-2.0 (npm); bundled packages ISC, MIT, Apache-2.0, BlueOak-1.0.0, BSD-2-Clause, BSD-3-Clause, CC-BY-3.0 (`spdx-exceptions`), CC0-1.0 (`spdx-license-ids`) | `resources/npm-cli/LICENSE` and each package's folder under `resources/npm-cli/node_modules/` |
| Prism (syntax colouring) | bundled build | MIT | `resources/app.asar` → `renderer/vendor/prism-LICENSE.txt` |
| `resources/elevate.exe`, from electron-builder | 24.13.3 | MIT | No separate notice file; this entry |
| NSIS, the installer and uninstaller runtime | 3.0.4.1 | zlib/libpng | No separate notice file; this entry |

## Node packages inside `resources/app.asar`

Each package's license file is in `resources/app.asar` → `node_modules/<name>/`.

| Package | Version | License |
|---|---|---|
| @noble/hashes | 1.4.0 | MIT |
| @peculiar/asn1-cms | 2.9.4 | MIT |
| @peculiar/asn1-csr | 2.9.4 | MIT |
| @peculiar/asn1-ecc | 2.9.4 | MIT |
| @peculiar/asn1-pfx | 2.9.4 | MIT |
| @peculiar/asn1-pkcs8 | 2.9.4 | MIT |
| @peculiar/asn1-pkcs9 | 2.9.4 | MIT |
| @peculiar/asn1-rsa | 2.9.4 | MIT |
| @peculiar/asn1-schema | 2.9.4 | MIT |
| @peculiar/asn1-x509 | 2.9.4 | MIT |
| @peculiar/asn1-x509-attr | 2.9.4 | MIT |
| @peculiar/utils | 2.0.3 | MIT |
| @peculiar/x509 | 1.14.3 | MIT |
| adm-zip | 0.5.18 | MIT |
| ansi-regex | 5.0.1 | MIT |
| ansi-styles | 4.3.0 | MIT |
| asn1js | 3.0.10 | BSD-3-Clause |
| bytestreamjs | 2.0.1 | BSD-3-Clause |
| camelcase | 5.3.1 | MIT |
| cliui | 6.0.0 | ISC |
| color-convert | 2.0.1 | MIT |
| color-name | 1.1.4 | MIT |
| decamelize | 1.2.0 | MIT |
| dijkstrajs | 1.0.3 | MIT |
| emoji-regex | 8.0.0 | MIT |
| find-up | 4.1.0 | MIT |
| get-caller-file | 2.0.5 | ISC |
| is-fullwidth-code-point | 3.0.0 | MIT |
| locate-path | 5.0.0 | MIT |
| p-limit | 2.3.0 | MIT |
| p-locate | 4.1.0 | MIT |
| p-try | 2.2.0 | MIT |
| path-exists | 4.0.0 | MIT |
| pkijs | 3.4.0 | BSD-3-Clause |
| pngjs | 5.0.0 | MIT |
| pvtsutils | 1.3.6 | MIT |
| pvutils | 1.2.0 | MIT |
| qrcode | 1.5.4 | MIT |
| reflect-metadata | 0.2.2 | Apache-2.0 |
| require-directory | 2.1.1 | MIT |
| require-main-filename | 2.0.0 | ISC |
| selfsigned | 5.5.0 | MIT |
| set-blocking | 2.0.0 | ISC |
| string-width | 4.2.3 | MIT |
| strip-ansi | 6.0.1 | MIT |
| tree-kill | 1.2.2 | MIT |
| tslib | 2.8.1 and 1.14.1 | 0BSD |
| tsyringe | 4.10.0 | MIT |
| which-module | 2.0.1 | ISC |
| wrap-ansi | 6.2.0 | MIT |
| y18n | 4.0.3 | ISC |
| yargs | 15.4.1 | MIT |
| yargs-parser | 18.1.3 | ISC |

## Downloaded at run time, not shipped

Node.js for running projects is downloaded from nodejs.org when a project
needs it (MIT; its license is inside the download). Projects' own dependencies
are installed by their own tools under their own licenses.

## Windows components used, not shipped

Windows PowerShell 5.1 and the .NET Framework UI Automation libraries, which
are part of Windows.
