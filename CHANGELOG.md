# Changelog

All notable changes to Benchdrop. Versions follow semantic versioning.
History before 4.1.2 was not recorded in this form.

## 4.5.4 - 2026-10-26

### Changed
- License change: from this version, Benchdrop is licensed under Apache
  License 2.0 with the Commons Clause (source-available: free to use, modify
  and share, not to sell). Versions 4.5.3 and earlier remain under MIT.

## 4.5.3 - 2026-10-24

### Fixed
- After a project moved to another port, the log said "Still waiting for a
  local URL" a minute and a half later although the app was running: a timer
  from the first try went off. It now stands down when the project restarts.

### Changed
- The Open on your phone window says what to check when the phone shows
  "This site can't be reached": the same WiFi, not mobile data, and on an
  iPhone the browser's Local Network permission, which a browser update can
  turn off.

## 4.5.2 - 2026-10-24

### Changed
- When a project's server can't start because its port is taken - by a
  leftover server, or one Benchdrop isn't allowed to stop - Benchdrop now starts
  it again on the next free port (8174 taken: 8175) through the standard `PORT`
  setting, and the banner says which port it moved to. Free it and retry still
  stops the holder and goes back to the usual port. A server that doesn't read
  `PORT` gets the old banner, which now says why it couldn't move.

## 4.5.1 - 2026-10-18

### Fixed
- In a window narrower than full screen, the toolbar's buttons were cut off
  (the address shrank to "ht" and Stop disappeared). The toolbar now fits more
  in one row - the logo without the word, tighter buttons - and wraps onto a
  second row when it has to. The program bar above a Windows program or an
  Android app's screen wraps the same way.

## 4.5.0 - 2026-10-17 (not published)

### Added
- Android apps on your own phone, from the Phone button: pair the phone over
  Wi-Fi by scanning a QR code (Android 11 or later, Wireless debugging), then
  run the app on it with its screen, log, crashes, Autotest and Claude - or
  scan a second QR code to download the app and install it.

## 4.4.0 - 2026-10-17 (not published)

### Added
- Android apps. Drop an Android Studio project folder or an `.apk`: Benchdrop
  builds it with the project's Gradle wrapper, installs it on a phone or
  emulator (starting the emulator if needed), starts it and shows the
  device's screen in the pane, where clicks, drags, the wheel and typing work
  the app. Its log, crashes (with the exception) and "not responding" go into
  the log; Capture, Trace, Restart, Autotest and the Claude connector work on
  it. Benchdrop finds the Android SDK, a JDK and the emulators itself, and
  says what's missing rather than installing anything.
- The Claude connector's run tool takes `device` (which phone or emulator)
  and `build` (build the project first).

### Fixed
- The install no longer contains an unused update file (`app-update.yml`).

## 4.3.3 - 2026-10-05

### Fixed
- Closing Benchdrop left a project's servers running (and holding their
  ports, so the next run said "Port 5173 busy"). It now waits for them to end
  before it closes.
- If Benchdrop is ended from Task Manager or crashes, the next start ends the
  servers that session left running, and says so in the log.
- A server that moves to another port because its usual one is taken (Vite
  does) is no longer shown as an error: the status says Running, and the
  banner says which process holds the port and offers to free it.

## 4.3.2 - 2026-10-05 (not published)

### Fixed
- Electron and Chromium programs: reading the screen took up to a minute
  (53s for CORE's main screen), so Autotest was unusable. Benchdrop now also
  turns on Chromium's own UI Automation support (`--enable-features=UiaProvider`)
  and reads the whole screen in one request: 0.1-0.4s for CORE.
- Web list rows that hold a button or link are no longer listed as an extra,
  nameless "ListItem" control.

## 4.3.1 - 2026-10-05 (not published)

### Fixed
- Electron and other Chromium-based programs: Trace and Autotest saw only
  their menu bar. Benchdrop now starts them with Chromium's
  `--force-renderer-accessibility`, found by Chromium's files beside the
  `.exe` or, for a single-file build, noticed when its window opens (Restart
  applies it, and it's remembered). Each page control is listed once, not twice.
- The undocked pane looked like the program but was a live picture: clicks
  went nowhere and the program's own pointer showed as a second one. It now
  says so, and clicking it brings the program's window forward.

## 4.3.0 - 2026-10-05 (not published)

### Added
- Help → About Benchdrop: the version, © 2026 Griffith.Software, the license
  and a link to the website.
- The installer shows the license, offers a desktop shortcut (unticked) on its
  last page, and the uninstaller asks whether to delete Benchdrop's data
  (default: keep).
- Installed apps links to the website and the support page.
- Requirements stated: Windows 10 (22H2) or Windows 11, x64.
- A line in the Connect dialog and the README saying Benchdrop is independent
  of Anthropic.

### Changed
- Installs for the current user only, in `%LOCALAPPDATA%\Programs\Benchdrop`,
  with no administrator prompt. **This is a new installer identity**: it
  installs beside an earlier Benchdrop rather than upgrading it, so uninstall
  the earlier version from Installed apps.
- Installer file name is now `Benchdrop_v4.3.0_win-x64_setup.exe`.
- Publisher, copyright and version information now read Griffith Software.
- npm is shipped once instead of twice (it was also inside `app.asar`).
- Wording: Benchdrop downloads Node.js when a project needs it (it said
  "bundles").

### Fixed
- The Node.js download is checked against nodejs.org's SHA-256 list before it
  is unpacked; a mismatch is deleted and reported.
- The uninstaller no longer leaves the installer's "updating" flag behind,
  which stopped the Claude connector starting Benchdrop for 15 minutes.
- The installer could crash when started for the first time on a computer.

## 4.2.5 - 2026-10-04

### Fixed
- Installing to Program Files now closes a running Benchdrop as well (the
  elevated installer skipped the check, and the old uninstaller then said
  Benchdrop couldn't be closed).

## 4.2.4 - 2026-10-04

### Changed
- The installer closes Benchdrop itself before installing or uninstalling,
  including Claude Code's connector, and the connector doesn't restart it
  during the update.
- Risky actions are judged by what a control does, not by any word in its
  label: "Jobs & pay rules" is opened, "Pay now" is still skipped.

## 4.2.3 - 2026-10-04

### Changed
- Only one copy of an installed Benchdrop runs at a time; opening it again
  brings the running window forward.

## 4.2.2 - 2026-10-04

### Fixed
- Quitting kept the Claude Desktop extension from starting a closed Benchdrop
  installed outside the default folder.

## 4.2.1 - 2026-10-04

### Fixed
- Help → Connect to Claude: the Claude Desktop step shows the extension file
  to drag onto Settings → Extensions (the Microsoft Store build doesn't open
  `.mcpb` files), the Claude Code command uses this install's paths, and the
  dialog says Claude Code connections don't appear on Claude Desktop's
  Extensions page.

## 4.2.0 - 2026-10-04

### Added
- The Claude connector: Claude Desktop or Claude Code can open, run, read,
  click through and test projects in Benchdrop with the user's own Claude
  account. Benchdrop refuses risky, disabled, external and secret targets
  itself and logs every action.

### Removed
- Autotest's "With Claude" mode and the API key it needed. A key left by an
  earlier version is deleted.

## 4.1.2 - 2026-10-04

### Fixed
- The first full Windows pass on the native-program features: controls of
  Windows programs are read correctly, dialogs owned by the program are seen,
  a hung program is reported while it is hung, docking shows the program in
  the pane, and several Autotest problems with WPF dialogs and read-only fields.
