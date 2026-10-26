# Benchdrop

**A desktop workbench for running and testing software.**

Drop in a project — a zip, a folder, a single file, a link, or a Windows
program — and Benchdrop works out what it is, installs what it needs, runs it,
and shows it in its own window, with a full record of what happened.

Version 4.5.4 · Windows 10 (22H2) or 11, x64

---

## What it's for

Trying a piece of software normally means unpacking it, opening a terminal,
working out which toolchain it wants, installing that, running the right
command, finding the address it's serving on, opening a browser, and keeping
several windows in view at once.

Benchdrop collapses all of that into dropping the thing onto a window. It then
stays useful while the software runs: it records what the software does, lets
you edit it in place, puts it on your phone, takes evidence-quality
screenshots, and can test it on its own.

It's a **universal runner and test bench** rather than a better editor. The aim
isn't to be the best tool for any single language; it's to be the one tool that
will run almost anything you hand it without preparation.

---

## Getting something in

| What you drop | What happens |
|---|---|
| **A .zip** | Unpacked into its own folder and run |
| **A folder** | Used where it sits, so edits in your own editor apply directly |
| **A Windows program (.exe)** | Run from where it sits, so the files beside it are found |
| **An Android app** (a project folder or `.apk`) | Built, installed on a phone or emulator, started, and shown in the pane |
| **A single .html file** | Served on its own — ideal for single-file apps |
| **A single .py script** | Run, with a script picker and an arguments box |
| **A .md file** | Rendered as a readable page |
| **A GitHub link** | Downloaded and opened, from a repository or a specific branch |
| **A direct .zip link** | Downloaded and opened |
| **A recent project** | The last dozen you opened, reopened in one click |

Drop an updated build with the same filename and Benchdrop notices the contents
changed and unpacks the new version, while keeping anything the project set up
on its first run. It compares the file's contents rather than its name, so
"I rebuilt it but I'm still seeing the old one" doesn't happen.

---

## What it can run

| Project type | Recognised by | Runs with |
|---|---|---|
| Node / npm | `package.json` | your own dev and start scripts, several at once if needed |
| Static site | any `.html` file | Benchdrop's own server |
| Markdown | `.md` | rendered as a page |
| Python | `.py`, `requirements.txt` | your chosen script, with dependencies installed first if you like |
| PHP | `composer.json`, `artisan`, `.php` | Laravel's dev server or PHP's built-in server |
| Go | `go.mod`, `main.go` | `go run .` |
| Rust | `Cargo.toml` | `cargo run` |
| Ruby | `Gemfile`, `config.ru`, `.rb` | Rails, Rack, or a plain script |
| .NET | `.csproj`, `.sln` | `dotnet run` |
| Java | `pom.xml`, `build.gradle`, `.jar` | Maven, Gradle, or `java -jar` |
| Windows program | `.exe` | run directly, with its own folder as the working directory |
| Android app | Android Studio project, `.apk` | built with its Gradle wrapper, installed and started on a phone or emulator through adb |

Node.js is fetched automatically if the machine doesn't have it. Other
languages use what's already installed; if one is missing, Benchdrop says so
and links to the download rather than failing with a cryptic error.

A project that has both a web page and a script offers both rather than
guessing which you meant.

---

## What it does while software is running

### The log

Everything that happens, in one timestamped stream: what Benchdrop is doing,
the raw output of each script it started (tagged by script, so several running
at once stay readable), and — with **Trace** on — what the software itself is
doing.

Trace reports the things that usually require a separate window to see:

- **every click and keystroke** in the app, naming the button or field
- **its console output**
- **every network request** with status codes and timings, failures marked
- **navigation, uncaught errors, and crashes**

Passwords and anything that looks like a secret are recorded as `(hidden)`, so
a log stays safe to copy and share. **Copy log** puts the whole thing on the
clipboard as plain text.

### Live reload

Benchdrop watches the project's files and refreshes the page when one changes,
so editing in your own editor shows the result immediately. Dependency and
build folders are ignored, and saving several files at once causes one refresh
rather than five.

### Testing on a phone

One button serves the running project over **HTTPS** on your local network and
shows a QR code to scan. The HTTPS part matters: location, camera and other
device features only work on a secure address, so this is the difference
between being able to test them on a real phone and not.

What you do on the phone comes back into the log as well — taps, typing,
console output, and every request it makes — tagged with the device it came
from, so a phone, a tablet and the desktop never get mixed together.

### Screenshots

Three kinds: the visible area, a region you drag a box around, or **the whole
page including everything you'd have to scroll to see**. Each one is saved and
copied to the clipboard, ready to paste into a bug report or a message.

### Code view

Switch the pane between the running software and its source. Browse and filter
the project's files, edit them with syntax colouring and line numbers, and save
with Ctrl+S — with live reload on, the running app updates immediately.
**Export** writes the whole project, including your edits, to a zip.

### Autotest

Benchdrop can test the software by itself: clicking every control it can reach,
filling in forms, following the app's own navigation, and recording anything
that breaks. It finishes with a report listing each problem, the steps that led
to it, and a screenshot.

It needs no setup. What it reports — console errors, uncaught exceptions,
failed requests, crashes — is seen directly by the harness, so it's reliable.

### Working with Claude

Claude can use Benchdrop itself, from a conversation in Claude Desktop or Claude
Code, with your own Claude account — no API key. Ask it to open your project,
run it, try the checkout flow, or run an autotest and fix what it finds; it
works through Benchdrop's window, sees what you would see, and reads the log.
**Help → Connect to Claude…** sets it up in one step.

Benchdrop keeps the same rules for Claude as for its own explorer: nothing that
looks destructive, no typing into password fields, no following links out of
the app, no running commands. Everything Claude does appears in the log.

Anything that looks destructive is skipped by default and listed in the report:
delete, reset, log out, pay, send, revoke. Links that leave the app are never
followed, and password fields are never typed into. These are enforced rules,
not suggestions.

### Windows programs

A native program can't be drawn inside a web view, so every feature has a
native equivalent:

| | For a Windows program |
|---|---|
| **Pane** | a live mirror of its window, or the real window docked inside the pane |
| **Log** | its console output |
| **Stop** | ends it and everything it started |
| **Crashes** | the exit code translated into plain terms — access violation, stack overflow, unhandled .NET exception, missing DLL — plus the faulting component from Windows' own event log |
| **Trace** | windows opening and closing, "not responding", child processes, focus moving between controls, files it writes, and its network traffic |
| **Capture** | its window at full resolution, or a region of it |
| **Autotest** | drives it through Windows' accessibility layer: pressing buttons, filling fields, opening dialogs, and catching crashes, hangs and error dialogs |

### Everything else

- **A stable address.** Projects are served on the same port each run rather
  than a random one, which matters the moment an API restricts which addresses
  may call it.
- **Port conflicts resolved.** If a leftover process is holding a port,
  Benchdrop identifies it and offers to stop it and try again.
- **A command bar** for anything a project needs that isn't in a script —
  setup commands, migrations, one-off tools — with the output in the log.
- **Setup suggestions.** When a project fails because a one-time setup step was
  never run, Benchdrop recognises the error and offers the command. It never
  runs one on its own.
- **Light and dark.** A dark workshop and a whitewashed one, switched from the
  View menu.

---

## What it deliberately doesn't do

- **It doesn't keep software running after you close it.** Everything it starts
  is stopped when Benchdrop closes. It's a workbench, not a host.
- **It doesn't handle your credentials.** If a project needs an account or API
  keys, you sign in yourself. Benchdrop surfaces the link and keeps the result.
- **It doesn't install language toolchains behind your back.** Node.js is the
  one exception, because there's a clean official build to fetch.
- **It doesn't decrypt anything.** When it logs a program's HTTPS traffic, it
  records the host, size and timing — never the contents.

---

## Where things are kept

Unpacked projects, downloads, screenshots, test reports and settings live in
Benchdrop's own folder, well away from your source. A project you point it at
directly is used where it is and never copied. The Help menu jumps straight to
each location.

---

## What it needs

Windows 10 (22H2) or Windows 11, 64-bit, and nothing else. Node.js is
downloaded automatically if it isn't present, and checked against the SHA-256
that nodejs.org publishes. Other languages are used if installed. Working with
Claude needs Claude Desktop or Claude Code and a Claude account.

Benchdrop is an independent project. It is not made by, endorsed by, or
affiliated with Anthropic, and the Claude name belongs to its owner.

© 2026 Richard Griffith (d/b/a Griffith Software) · https://griffith.software
