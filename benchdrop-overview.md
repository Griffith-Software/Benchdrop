# Benchdrop

A Windows desktop app for running and testing projects. Drop in a zip, a
folder, a single file, or a GitHub link; Benchdrop works out what it is,
installs what it needs, runs it, and shows it in its own window — with a log
of everything that happened on both sides.

It is a **universal runner**, not a better IDE. The point isn't to be the best
tool for any one stack; it's to be the one tool that will run almost anything
you hand it without setup.

Current version: **4.5.3**. Windows 10 (22H2) or 11, x64.

---

## Contents

- [What it's for](#what-its-for)
- [Getting a project in](#getting-a-project-in)
- [What it can run](#what-it-can-run)
- [What it does once it's running](#what-it-does-once-its-running)
- [How it works](#how-it-works)
- [Where it keeps things](#where-it-keeps-things)
- [Settings](#settings)
- [Limits worth knowing before you rely on it](#limits-worth-knowing-before-you-rely-on-it)
- [Troubleshooting](#troubleshooting)
- [Building from source](#building-from-source)

---

## What it's for

The usual way to try a project is: unzip it, open a terminal, work out whether
it's npm or pip or cargo, install the right runtime, run the right command,
find the URL, open a browser, and keep three windows visible. Benchdrop
collapses that into dropping the thing on a window.

It's most useful when you are:

- testing builds of your own projects repeatedly, where the setup cost is paid
  over and over;
- trying something someone else wrote, where you don't yet know what it needs;
- working across several unrelated stacks and don't want a specialised tool per
  language;
- debugging something that misbehaves in ways a terminal doesn't show you
  (what the page requested, what the user clicked, what the console said).

---

## Getting a project in

| Input | What happens |
|---|---|
| **.zip** | Unpacked into its own folder and run |
| **A folder** | Used where it sits, so your editor's changes apply directly |
| **A single `.html`** | Served on its own — good for single-file apps |
| **A single `.py`** | Run with a script picker and an arguments box |
| **A `.md` file** | Rendered as a readable page |
| **A Windows program (`.exe`)** | Run from where it sits, so the files beside it are found |
| **An Android app** (a project folder or `.apk`) | Built, installed on a phone or emulator, started, and shown in the pane |
| **A GitHub link** | `github.com/owner/repo`, or `.../tree/branch`, downloaded and opened |
| **A direct `.zip` link** | Downloaded and opened |
| **Recent list** | The last dozen projects, one click to reopen |

Drop a rebuilt zip with the same filename and Benchdrop notices the contents
changed and unpacks the new version. It compares a hash of the file, not its
name — so "I updated it but I'm still seeing the old one" doesn't happen.

---

## What it can run

| Project | Recognised by | Runs with |
|---|---|---|
| Node / npm | `package.json` | your `dev`/`start` scripts, several at once if needed |
| Static site | any `.html` file | Benchdrop's own server |
| Markdown | `.md` | rendered as a page |
| Python | `.py`, `requirements.txt` | your chosen script, optional `pip install` first |
| PHP | `composer.json`, `artisan`, `.php` | Laravel's dev server or PHP's built-in server |
| Go | `go.mod`, `main.go` | `go run .` |
| Rust | `Cargo.toml` | `cargo run` |
| Ruby | `Gemfile`, `config.ru`, `.rb` | Rails, Rack, or a plain script |
| .NET | `.csproj`, `.sln` | `dotnet run` |
| Java | `pom.xml`, `build.gradle`, `.jar` | Maven, Gradle, or `java -jar` |
| Windows program | `.exe` | run directly, with its folder as the working directory |
| Android app | Android Studio project, `.apk` | built with its Gradle wrapper, installed and started on a phone or emulator through adb |

**Node.js is the only runtime Benchdrop installs for you.** If you don't have
it, it downloads an official build once and keeps it. Every other language must
already be on the machine; Benchdrop checks, and if it's missing says so and
links to the download rather than failing with something cryptic.

A project with both a web page and a runtime (say, a Python tool that also
ships an HTML version) offers both rather than guessing.

---

## What it does once it's running

### The log

Two streams in one pane, every line timestamped:

```
17:52:40 [Benchdrop] Installing dependencies...
17:52:44 [dev]   ➜  Local:   http://localhost:5173/
17:53:14 [app]  click button "Settings"
17:53:14 [net]  ← 200 /api/instruments 86ms
17:53:17 [console warn] slow render
```

- `[Benchdrop]` — what the app itself is doing
- `[dev]`, `[convex]`, `[test]` … — raw output from each script you ran, tagged
  by script so concurrent processes stay readable
- `[app]`, `[net]`, `[console]`, `[page]` — what the **project** is doing:
  clicks, typing, every request and its status, console output, uncaught
  errors, navigation, crashes

That second group is **Trace**, toggled above the log and on by default.
**Copy log** puts the whole thing on the clipboard as plain text.

Passwords — and anything whose name suggests a secret (`token`, `key`, `auth`,
`card`, `cvv`, `ssn`, `otp`, `pin`) — are logged as `(hidden)`. A field's value
is never used as its label, for the same reason.

### Live reload

Benchdrop watches the project folder and refreshes the page when a file
changes. `node_modules`, `.git`, `dist`, `build`, `__pycache__` and editor
scratch files are ignored, and saves are debounced so one Ctrl+S doesn't fire
five reloads.

For Node projects it deliberately does **not** force a reload — Vite and
similar push their own updates and usually preserve state; forcing a refresh
would throw that away. It notes the change instead.

### Phone preview

Serves the running project over **HTTPS** on your local network and shows a QR
code. HTTPS is the point: geolocation, camera and service workers only work in
a secure context, and `localhost` counts while a plain `http://192.168.x.x`
does not. The certificate is generated on your machine and names your current
LAN address, so the phone shows a warning the first time — that's expected.

With Trace on, **what you do on the phone comes back to the log**, tagged by
device:

```
18:31:26 [net · iPhone 192.168.86.42] ← 200 /api/thing 86ms
18:31:29 [app · iPhone 192.168.86.42] click button "Start"
```

### Android apps

The device's screen shows in the pane (Android screenshots, a few a second);
clicks, drags, the wheel and typing are sent to the device as taps, swipes and
keys, with Back, Home and Recents buttons above it. The log is the app's
logcat (Info and above); crashes are caught with their exception and stack,
and an ANR is reported as "not responding". Autotest and the Claude connector
read the screen through UI Automator. The Phone button puts the app on a real
phone: pair it over Wi-Fi from a QR code (then it runs there like on the
emulator), or let the phone download the APK from another QR code. Benchdrop needs the Android SDK
(Android Studio includes it) and, to build, a JDK; it finds both itself or
lets you choose the folders, and never installs them. See the README's
"Android apps" section.

### Windows programs

A native program can't be drawn inside a web view, so each feature has a
native equivalent. The pane shows a live mirror of the program's window, or
**Dock here** puts the real window inside the pane. Its console output goes to
the log and Stop ends it and everything it started. A crash is decoded from
its exit code, with the faulting module pulled from Windows' event log.

With Trace on you also see windows opening and closing, title changes, *not
responding*, child processes, focus moving between controls, files written in
its folder and AppData folder, and network traffic through a local proxy.
Capture takes its window at real size. Autotest drives it through **Windows UI
Automation** — the accessibility layer screen readers use — and catches
crashes, hangs and error dialogs.

### Autotest

The **Autotest** button lets Benchdrop test the app the way a person would:
clicking every control it can reach, filling in forms, following the app's own
navigation, and logging anything that breaks. It ends with a report listing
each problem, the steps that led to it, and a screenshot.

It tries every reachable control, fields before buttons. What it reports is
what the harness detects directly — console errors, uncaught exceptions,
4xx/5xx and failed requests, crashes — so it's reliable.

Destructive-looking controls — delete, reset, log out, pay, send, revoke —
are skipped unless you allow them, and listed in the report. External links
are never followed and secret fields are never typed into. Those rules are
enforced in code, so a model choosing a risky button is overridden.

### Claude connector

**Help → Connect to Claude…** lets Claude use Benchdrop from Claude Desktop (an
extension file dragged onto Settings → Extensions) or Claude Code (a one-line `claude mcp add`), with the
person's own Claude account. Claude can open and run projects, read the screen,
click and type, take screenshots, read the log, run Autotest and stop. Benchdrop
refuses risky controls, secret fields and external links whoever asks, offers no
way to run commands, and logs every Claude action as `[claude]`.

### Code view

The **Code** button switches the pane between the running app and its source.
Browse and filter the project's files, edit with syntax colouring and line
numbers, **Ctrl+S** to save. With live reload on, saving refreshes the page
immediately. **Export…** writes the whole project, including your edits, to a
zip.

Syntax colouring covers HTML, CSS, JS, JSX, TypeScript, JSON, Python, PHP, Go,
Rust, Ruby, Java, C#, YAML, Markdown and shell — and a single-file app is
coloured properly throughout, with the CSS inside `<style>` and the JavaScript
inside `<script>` treated as CSS and JavaScript.

### Screenshots

Three modes: the visible area, a region you drag a box around, or **the whole
page including everything you'd have to scroll to see**. Each shot is saved and
copied to the clipboard, with a flash and a thumbnail so you know it worked.

### Command bar

Runs any command in the project folder — `npx @convex-dev/auth`,
`npx prisma migrate dev`, `pip install -r requirements.txt`. Output goes to the
log. This is the escape hatch for setup steps that aren't in any script.

Benchdrop also watches for known "you skipped a setup step" errors and offers
the command that fixes them. It never runs one on its own.

### Everything else

- **Stable address.** Projects serve on `http://localhost:5599` when free,
  rather than a new random port each run — which matters the moment an API
  allow-lists an origin or redirect URI.
- **Port conflicts.** If a leftover server holds a port, Benchdrop identifies
  the process and offers to stop it and retry.
- **Clear cache.** Clears the embedded browser's cache, cookies and storage
  without touching disk.
- **Right-click** works everywhere: cut/copy/paste, copy a link or image,
  search selected text, inspect element.
- **Themes.** View → Appearance switches between a dark workshop and a
  whitewashed one.

---

## How it works

Three files, no framework:

- **`main.js`** — the Electron main process. Unpacking, runtime detection,
  spawning and supervising processes, the static server, the file watcher, the
  HTTPS phone proxy, screenshots, Autotest, and all file access.
- **`preload.js`** — the bridge. The window can only call the specific
  operations listed here; it has no direct file or process access.
- **`renderer/`** — the window itself: layout, buttons, the log pane, the code
  editor.

### Running a project

1. **Unpack.** Each zip maps to a stable folder keyed by its path, so anything
   the project sets up on first run — `node_modules`, `.env.local`, generated
   code — survives the next run. Whether that folder is *reused* depends on a
   hash of the zip's contents.
2. **Detect.** Look for `package.json`, then other runtimes, then HTML, then
   Python, then fall back to "no UI detected" with a list of what's actually in
   the folder.
3. **Resolve a runtime.** For Node: one it downloaded before → one already
   installed (if new enough) → otherwise download an official build. For
   everything else: check what's installed and report honestly.
4. **Run.** Spawn the chosen scripts, streaming stdout and stderr into the log
   with the terminal colour codes stripped.
5. **Find the address.** Watch the output for a local URL. Output from a
   backend script is deliberately ignored here, so a database's own admin port
   isn't mistaken for the app.
6. **Show it.** Load that URL into an embedded browser view.

### How Trace works

- **Clicks and typing** — a small script is injected into the page that reports
  through `console.debug` with a marker, so no privileged bridge is exposed to
  the page.
- **Console and errors** — the view's own events.
- **Network** — hooks on the browser session, which see `fetch`, XHR and asset
  loads alike without attaching a debugger.
- **From a phone** — the phone's requests already pass through Benchdrop's
  proxy, so those are logged as they go by; the same reporter is injected into
  HTML on the way past to capture taps and console output. It is never written
  into your project.

### How native programs are handled

The Windows-specific parts go through `native\bdwin.ps1`, a PowerShell script
that ships with Benchdrop and runs as one long-lived helper process. Benchdrop
sends it one JSON request per line and it answers the same way: list the
program's process tree and windows, snapshot its controls, press or type into
one, read a dialog's text, look up a crash in the event log, or dock and
undock the window. Using the PowerShell that ships with Windows means no
native Node module has to be built or installed.

Autotest talks to programs and pages through the same small interface — take a
snapshot, act, go back, take a picture — so the explorer, the Claude
connector, the safety rules and the report are shared. For a program, "go back" closes the
dialog on top with Esc, and "exit" and "quit" join the risky list because they
would end the session.

### How Autotest works

Each step is perceive → decide → act → verify:

1. **Perceive.** A script in the page lists every visible, actionable element
   with a readable label and tags it so it can be found again. Risky, disabled,
   external and secret elements are flagged.
2. **Decide.** The explorer picks the first control not yet tried (fields
   first), stepping back when a screen is exhausted.
3. **Act.** Clicks and typing are dispatched in the page. Typing uses the
   native value setter so React and Vue register it.
4. **Verify.** The same console, crash and network hooks Trace uses report
   problems as they happen; each distinct problem is recorded once.

A coverage map — a hash of each screen's URL and controls — tells it which
screens are new and stops it clicking the same button forever.

### Whole-page screenshots

A `<webview>`'s compositor surface is pinned to its on-screen size, so asking
Chrome to capture beyond it just repeats the viewport. Benchdrop instead
scrolls a screenful at a time, takes ordinary screenshots, and stitches them on
raw bitmaps. Anything pinned to the window is handled so it doesn't repeat: a
sticky header is kept for the first screenful, and a bar pinned to the bottom
is left out entirely, since it would otherwise be stamped across the middle of
the finished image.

---

## Where it keeps things

```
%APPDATA%\benchdrop\
  projects\        unpacked projects, one folder per zip
  downloads\       archives fetched from links
  screenshots\     captures
  node-runtime\    Node, if Benchdrop had to fetch it
  certs\           the phone preview's certificate
  reports\         Autotest reports
  connector.json   the Claude connector's local port and token, while open
  settings.json    preferences
  recents.json     the recent projects list
```

**Help → Project folder / Screenshots folder / Settings file** jumps to each.

---

## Settings

`%APPDATA%\benchdrop\settings.json`:

| Key | Effect |
|---|---|
| `{"theme": "light"}` | Start in the whitewashed theme |
| `{"port": 1234}` | Serve on a different fixed port |
| `{"fixedPort": false}` | Go back to a random port each run |
| `{"liveReload": false}` | Don't reload on file changes |
| `{"trace": false}` | Start with Trace off |
| `{"connector": false}` | Turn off the Claude connector |

---

## Limits worth knowing before you rely on it

**Processes stop when Benchdrop closes.** Every child process is killed when
the window closes or the app quits. If you need a server to outlive your
session — start a long job, walk away, check it from your phone later — run it
from a terminal instead. Benchdrop is a workbench, not a host.

**Live reload reloads the page, not your process.** Saving a file refreshes the
browser view; it does not restart the server, so a job running server-side
keeps going. Two caveats: if your framework has its own reloader (Flask's debug
mode, `nodemon`), *that* will restart the process on file change and Benchdrop
has no say in it; and if the work is happening in the page rather than on the
server, reloading the page will discard it. Turn live reload off while
something long is running.

**Python is whatever you already have.** Benchdrop does not download or bundle
Python. It uses your installed interpreter — `py -3`, then `python`, then
`python3` — so anything you `pip install`ed system-wide is visible exactly as
it would be from a terminal. (It downloads Node because there's a clean
official build to fetch; Python's embeddable build ships without pip, which
would fail confusingly rather than helpfully.)

**It won't complete someone else's setup.** If a project needs an account, API
keys, or a cloud backend, you sign in yourself. Benchdrop surfaces the link,
runs the command you choose, and keeps the result — but it doesn't handle your
credentials.

**Native programs are only as testable as they are accessible.** Standard
Windows, WinForms and WPF interfaces expose their controls to UI Automation
well; custom-drawn ones (games, some cross-platform toolkits) expose little,
and Autotest says so rather than guessing. Network logging only sees programs
that honour `HTTP_PROXY`/`HTTPS_PROXY`, and HTTPS is shown as host, size and
timing — never decrypted. Docking is a known-quirky Windows technique that
some programs resist; the mirror is the safe default. Windows locks a running
`.exe`, so rebuilding usually needs Stop first.

**Autotest drives the app with DOM events, not real input.** That covers
almost every web app; something that insists on trusted OS events (file
drag-and-drop, some anti-automation checks) won't respond to it. It also only
tests what's reachable by clicking and typing from the page it starts on.

**Private repositories** must be downloaded by hand; Benchdrop doesn't ask for
your GitHub credentials.

**Interactive CLIs may not prompt.** The input box under the log writes to a
running process's stdin, but it's a pipe, not a real terminal. A CLI that
insists on a TTY may refuse to ask its question. Use the command bar or a real
terminal for those.

**Native modules that compile from source** can fail without a full build
toolchain. Benchdrop handles the common case, including npm's optional-
dependency bug, where a project's lockfile was built on another OS.

---

## Troubleshooting

| What you see | What it means |
|---|---|
| "No web UI detected" | No `package.json` and no `.html`. It still opens in command-only mode, so the command bar works. |
| "Port 3210 is already in use" | A server from an earlier run is still holding it. The banner names the process and offers to stop it. |
| `Missing environment variable JWT_PRIVATE_KEY` | A one-time setup step was never run. Benchdrop offers the command. |
| A language "isn't installed on this computer" | Install it and reopen the project; only Node is fetched automatically. |
| The app pane is blank | Check the address bar in the toolbar — if it's a backend's port rather than the app's, use Stop and run only the app script. |
| Edits aren't showing | Check **Live** is on, or use **Clear cache** — that clears the embedded browser without touching your files. |
| A Windows feature does nothing | **Help → Check native program support** tests each part and names the one that failed. |
| Autotest finds no controls in a program | Its interface is custom-drawn and doesn't expose itself to UI Automation. |
| Log fills with `ws://` connection errors | A dev server was stopped while its page was still open. Fixed in 3.7.2; if you see it, reload. |

---

## Building from source

The source zip contains everything. With Node.js installed:

```
npm install     # build tools
npm start       # run without installing
npm run dist    # build an installer into release/
```

Worth knowing where things live:

- `renderer/style.css` — the entire look; both themes' palettes are CSS
  variables at the top of the file.
- `build/make-wood.py` — regenerates the wood textures (`wood.png` dark,
  `wood-light.png` whitewashed). Plank size, grain and tone are parameters.
- `build/make-icon.js` — regenerates the app icon and the 1024 px master (`npm run build:icon`).
- `native/bdwin.ps1` — the Windows helper for native programs.
- `renderer/vendor/prism.js` — syntax colouring, bundled locally so nothing is
  fetched from the internet.

Building the Windows installer works natively on Windows, and on Linux/macOS if
wine is installed.
