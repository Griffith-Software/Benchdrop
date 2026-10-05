# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Griffith.Software - https://griffith.software
# bdwin.ps1 - Benchdrop's Windows helper.
#
# Benchdrop's testing features were built for web pages, where the DOM says
# what's on screen. A native Windows program has no DOM, but Windows has an
# equivalent: UI Automation, the accessibility layer screen readers use. It
# lists a program's windows, buttons, fields and menus, and can press them.
#
# This script runs as one long-lived process and answers requests from
# Benchdrop, one JSON object per line in, one per line out:
#
#   ping       - is the helper alive, which PowerShell is it
#   info       - the program's process tree: windows, titles, hung or not, memory
#   snapshot   - everything actionable in the program's windows (for Autotest)
#   act        - press / type into / toggle / select an element from the last snapshot
#   focus      - which control currently has focus (for Trace)
#   wintext    - the text inside one window (to read an error dialog)
#   events     - Windows Application log entries about a crash
#   dock/undock/move/show - put the real window inside Benchdrop's pane and back
#
# Written for Windows PowerShell 5.1, which ships with every supported
# version of Windows, so nothing has to be installed.

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding  = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8

Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

$uiaRefs = @(
  [System.Windows.Automation.AutomationElement].Assembly.Location,
  [System.Windows.Automation.ControlType].Assembly.Location,
  [System.Windows.Rect].Assembly.Location
)

Add-Type -ReferencedAssemblies $uiaRefs -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Text;
using System.Threading;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Windows.Automation;

public static class BdWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern IntPtr SetParent(IntPtr child, IntPtr parent);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hgt, bool repaint);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int idx);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW")] public static extern IntPtr SetWindowLongPtr(IntPtr h, int idx, IntPtr v);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool IsHungAppWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hgt, uint flags);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);

  // The program's visible top-level windows - its dialogs included, since an
  // owned window is top-level to Win32 - bottom of the z-order first, so the
  // newest dialog is last. Plain Win32 only: UI Automation waits on a hung
  // window for as long as it's hung, and none of these calls do, so this
  // still answers while the program isn't responding.
  public static List<object[]> TopWindows(int[] pids) {
    HashSet<uint> want = new HashSet<uint>();
    foreach (int p in pids) want.Add((uint)p);
    List<object[]> list = new List<object[]>();
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      uint pid;
      GetWindowThreadProcessId(h, out pid);
      if (!want.Contains(pid) || !IsWindowVisible(h)) return true;
      RECT r;
      GetWindowRect(h, out r);
      int w = r.Right - r.Left, ht = r.Bottom - r.Top;
      if (w <= 0 || ht <= 0) return true;
      StringBuilder cls = new StringBuilder(256);
      GetClassName(h, cls, 256);
      string c = cls.ToString();
      if (c == "tooltips_class32" || c == "IME" || c == "MSCTFIME UI") return true;
      StringBuilder title = new StringBuilder(512);
      GetWindowText(h, title, 512);
      list.Insert(0, new object[] { h.ToInt64(), title.ToString(), c, (int)pid, w, ht });
      return true;
    }, IntPtr.Zero);
    return list;
  }

  public static void Click(int x, int y) {
    SetCursorPos(x, y);
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);   // left down
    mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);   // left up
  }

  // InvokePattern.Invoke() blocks until the handler returns - and a button
  // that opens a modal dialog doesn't return until the dialog closes. Doing
  // it on a worker thread keeps the helper answering while the dialog is up.
  public static void InvokeAsync(AutomationElement el) {
    ThreadPool.QueueUserWorkItem(delegate {
      try {
        object p;
        if (el.TryGetCurrentPattern(InvokePattern.Pattern, out p)) ((InvokePattern)p).Invoke();
      } catch { }
    });
  }

  // Standard Windows controls only show up as Button, Edit and so on through
  // UI Automation's client-side proxies, which load on first use. The loader
  // walks the stack to find its caller; from PowerShell that caller is a
  // dynamic method with no type, so it throws, never retries, and every
  // control reads as a bare Pane. Loading them here, from compiled code, before
  // any other UI Automation call, avoids that. NoInlining keeps this frame on
  // the stack for the loader to find.
  [MethodImpl(MethodImplOptions.NoInlining)]
  public static void LoadProxies() {
    ClientSettings.RegisterClientSideProviders(new ClientSideProviderDescription[0]);
  }
}
"@

# Must run before any other UI Automation call - see LoadProxies above.
$script:proxies = $true
try { [BdWin]::LoadProxies() } catch { $script:proxies = $false }

$AE     = [System.Windows.Automation.AutomationElement]
$Scope  = [System.Windows.Automation.TreeScope]
$Walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker

$script:els      = @{}   # id -> AutomationElement, from the last snapshot
$script:winHandles = @{} # hwnds the last snapshot visited as windows
$script:winOff   = $false # the window being visited is disabled (a modal is up)
$script:docked   = @{}   # hwnd -> original style and position
$script:count    = 0

function Send-Reply($obj) {
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $obj -Compress -Depth 6))
  [Console]::Out.Flush()
}

# --- process tree ----------------------------------------------------------
function Get-ProcessTree([int]$rootPid) {
  $all = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name)
  $ids = New-Object System.Collections.Generic.List[int]
  $ids.Add($rootPid)
  $i = 0
  while ($i -lt $ids.Count) {
    foreach ($p in $all) {
      if ([int]$p.ParentProcessId -eq $ids[$i] -and -not $ids.Contains([int]$p.ProcessId)) {
        $ids.Add([int]$p.ProcessId)
      }
    }
    $i++
  }
  return ,$ids
}

# The program's windows as UI Automation elements. They're found through
# Win32 rather than UIA's tree: there, a dialog sits under the window that
# owns it, and a docked program under Benchdrop. Bottom of the z-order first,
# so the newest dialog is last.
function Get-TopWindows($pids) {
  $list = New-Object System.Collections.ArrayList
  foreach ($w in [BdWin]::TopWindows([int[]]@($pids))) {
    try { $list.Add($AE::FromHandle([IntPtr]([int64]$w[0]))) | Out-Null } catch { }
  }
  return @($list)
}

function Cmd-Info($a) {
  $ids = Get-ProcessTree ([int]$a.pid)
  $procs = @()
  foreach ($id in $ids) {
    $p = Get-Process -Id $id -ErrorAction SilentlyContinue
    if ($p) {
      # Not Process.Responding: it waits up to 5s on a window that's about to hang.
      $h = $p.MainWindowHandle
      $procs += @{
        pid = $p.Id; name = $p.ProcessName; title = $p.MainWindowTitle
        hwnd = [int64]$h; responding = -not ($h -ne [IntPtr]::Zero -and [BdWin]::IsHungAppWindow($h))
        mem = [int64]$p.WorkingSet64
      }
    }
  }
  $wins = @()
  foreach ($w in [BdWin]::TopWindows([int[]]$ids.ToArray())) {
    $wins += @{ hwnd = [int64]$w[0]; title = [string]$w[1]; cls = [string]$w[2]; pid = [int]$w[3]; w = [int]$w[4]; h = [int]$w[5] }
  }
  Send-Reply @{ id = $a.id; ok = $true; procs = $procs; windows = $wins }
}

# --- snapshot: everything actionable, labelled ------------------------------
$KindOf = @{
  'Button' = 'button'; 'SplitButton' = 'button'; 'MenuItem' = 'button'; 'TabItem' = 'button'
  'ListItem' = 'button'; 'TreeItem' = 'button'; 'DataItem' = 'button'
  'Hyperlink' = 'link'
  'Edit' = 'field'
  'CheckBox' = 'toggle'; 'RadioButton' = 'toggle'
  'ComboBox' = 'select'
}

function Visit-Tree($el, [int]$depth, $list, $texts) {
  if ($script:count -ge 400 -or $depth -gt 25) { return }
  $child = $null
  try { $child = $Walker.GetFirstChild($el) } catch { return }
  while ($child -ne $null -and $script:count -lt 400) {
    $script:count++
    try {
      $c = $child.Current
      $type = $c.ControlType.ProgrammaticName -replace '^ControlType\.', ''
      # Chromium (Electron programs) shows the same page through two routes in
      # the tree, with different ids - so a control is the same one when its
      # type, name and place on screen are.
      $seenKey = "$type|$($c.Name)|$($c.BoundingRectangle)"
      $dupe = $script:seen.ContainsKey($seenKey)
      $script:seen[$seenKey] = $true
      # The title bar's own buttons (minimise, maximise, close) aren't the
      # program's controls, so its whole subtree is skipped. So is a dialog
      # inside its owner's subtree: it's visited as a window of its own.
      $ownWindow = ($type -eq 'Window' -and $script:winHandles.ContainsKey([int64]$c.NativeWindowHandle))
      if ($type -ne 'TitleBar' -and -not $ownWindow) {
        if (-not $c.IsOffscreen -and -not $dupe) {
          $kind = $KindOf[$type]
          # A read-only field (a status bar pane, a display box) is text to
          # read, not something a person can type into.
          if ($kind -eq 'field') {
            $vp = Try-Pattern $child ([System.Windows.Automation.ValuePattern]::Pattern)
            if ($vp -and $vp.Current.IsReadOnly) {
              $kind = $null
              if ($vp.Current.Value) { $texts.Add($vp.Current.Value) | Out-Null }
            }
          }
          if ($kind) {
            $label = $c.Name
            if (-not $label) { $label = $c.AutomationId }
            if (-not $label) { $label = $c.HelpText }
            if (-not $label) { $label = $type }
            $id = 'w' + ($list.Count + 1)
            $script:els[$id] = $child
            $list.Add(@{
              id = $id; kind = $kind; type = $type
              label = ([string]$label).Trim().Substring(0, [Math]::Min(60, ([string]$label).Trim().Length))
              disabled = (-not $c.IsEnabled) -or $script:winOff
              secret = ($kind -eq 'field' -and $c.IsPassword)
              automationId = $c.AutomationId
            }) | Out-Null
          } elseif ($type -eq 'Text' -and $c.Name) {
            $texts.Add($c.Name) | Out-Null
          }
        }
        # A combo box is one control; its arrow and list are its own parts.
        if ($type -ne 'ComboBox') { Visit-Tree $child ($depth + 1) $list $texts }
      }
    } catch { }
    try { $child = $Walker.GetNextSibling($child) } catch { $child = $null }
  }
}

# --- Chromium windows: the whole tree in one read ------------------------------
# Electron and other Chromium programs answer every UI Automation property as a
# separate cross-process call, so walking a page one property at a time took
# 30s and still ran out of nodes. A cache request fetches the subtree and the
# properties below in one go; the walk then reads only the cached copy.
function New-TreeCache {
  $cr = New-Object System.Windows.Automation.CacheRequest
  $cr.TreeScope = $Scope::Subtree
  $cr.TreeFilter = [System.Windows.Automation.Automation]::ControlViewCondition
  $vp = [System.Windows.Automation.ValuePattern]
  foreach ($p in @($AE::NameProperty, $AE::ControlTypeProperty, $AE::BoundingRectangleProperty,
                   $AE::IsOffscreenProperty, $AE::IsEnabledProperty, $AE::AutomationIdProperty,
                   $AE::HelpTextProperty, $AE::IsPasswordProperty, $AE::NativeWindowHandleProperty,
                   $AE::IsValuePatternAvailableProperty, $vp::IsReadOnlyProperty, $vp::ValueProperty)) {
    $cr.Add($p)
  }
  return $cr
}

function Cached-Type($el) { return ($el.Cached.ControlType.ProgrammaticName -replace '^ControlType\.', '') }

# A web list row (<li>) that holds a named control is left out - the control
# is listed instead. A row with no name of its own is named by its text.
function Has-NamedControl($el, [int]$depth) {
  if ($depth -gt 6) { return $false }
  foreach ($k in $el.CachedChildren) {
    try {
      if ($KindOf[(Cached-Type $k)] -and $k.Cached.Name) { return $true }
      if (Has-NamedControl $k ($depth + 1)) { return $true }
    } catch { }
  }
  return $false
}

function Cached-Text($el, [int]$depth, $out) {
  if ($depth -gt 6) { return }
  foreach ($k in $el.CachedChildren) {
    if ($out.Count -ge 4) { return }
    try {
      if ((Cached-Type $k) -eq 'Text' -and $k.Cached.Name) { $out.Add($k.Cached.Name) | Out-Null }
      Cached-Text $k ($depth + 1) $out
    } catch { }
  }
}

function Visit-Cached($el, [int]$depth, $list, $texts) {
  if ($script:count -ge 3000 -or $depth -gt 40) { return }
  foreach ($child in $el.CachedChildren) {
    if ($script:count -ge 3000) { return }
    $script:count++
    try {
      $c = $child.Cached
      $type = Cached-Type $child
      # Chromium can show the same page through two routes, with different ids:
      # a control or text already listed isn't listed again. (Containers aren't
      # compared - nested panels often share their parent's place and no name.)
      $seenKey = "$type|$($c.Name)|$($c.BoundingRectangle)"
      $dupe = $script:seen.ContainsKey($seenKey)
      $script:seen[$seenKey] = $true
      if ($type -eq 'TitleBar') { continue }
      if ($type -eq 'Window' -and $script:winHandles.ContainsKey([int64]$c.NativeWindowHandle)) { continue }
      if (-not $c.IsOffscreen -and -not $dupe) {
        $kind = $KindOf[$type]
        if ($kind -eq 'field' -and $child.GetCachedPropertyValue($AE::IsValuePatternAvailableProperty) -eq $true -and
            $child.GetCachedPropertyValue([System.Windows.Automation.ValuePattern]::IsReadOnlyProperty) -eq $true) {
          $kind = $null
          $v = $child.GetCachedPropertyValue([System.Windows.Automation.ValuePattern]::ValueProperty)
          if ($v -is [string] -and $v) { $texts.Add($v) | Out-Null }
        }
        $label = $c.Name
        if ($kind -and $type -eq 'ListItem') {
          if (Has-NamedControl $child 0) { $kind = $null }
          elseif (-not $label) {
            $words = New-Object System.Collections.ArrayList
            Cached-Text $child 0 $words
            $label = ($words -join ' ')
          }
        }
        if ($kind) {
          if (-not $label) { $label = $c.AutomationId }
          if (-not $label) { $label = $c.HelpText }
          if (-not $label) { $label = $type }
          $id = 'w' + ($list.Count + 1)
          $script:els[$id] = $child
          $list.Add(@{
            id = $id; kind = $kind; type = $type
            label = ([string]$label).Trim().Substring(0, [Math]::Min(60, ([string]$label).Trim().Length))
            disabled = (-not $c.IsEnabled) -or $script:winOff
            secret = ($kind -eq 'field' -and $c.IsPassword)
            automationId = $c.AutomationId
          }) | Out-Null
        } elseif ($type -eq 'Text' -and $c.Name) {
          $texts.Add($c.Name) | Out-Null
        }
      }
      if ($type -ne 'ComboBox') { Visit-Cached $child ($depth + 1) $list $texts }
    } catch { }
  }
}

function Cmd-Snapshot($a) {
  $ids = Get-ProcessTree ([int]$a.pid)
  $script:els = @{}
  $script:seen = @{}
  $script:count = 0
  $list  = New-Object System.Collections.ArrayList
  $texts = New-Object System.Collections.ArrayList
  $wins  = @()
  $top   = @(Get-TopWindows $ids)
  $script:winHandles = @{}
  foreach ($w in $top) { try { $script:winHandles[[int64]$w.Current.NativeWindowHandle] = $true } catch { } }
  foreach ($w in $top) {
    try {
      $wc = $w.Current
      $wins += @{ hwnd = [int64]$wc.NativeWindowHandle; title = $wc.Name; cls = $wc.ClassName }
      # A modal dialog disables the window behind it, but WPF and others still
      # report that window's controls as enabled - and UI Automation will press
      # them anyway. A person can't, so neither should Autotest.
      $script:winOff = -not [BdWin]::IsWindowEnabled([IntPtr]([int64]$wc.NativeWindowHandle))
      if ($wc.ClassName -like 'Chrome_WidgetWin*') {
        $script:count = 0
        Visit-Cached ($w.GetUpdatedCache((New-TreeCache))) 0 $list $texts
      } else {
        Visit-Tree $w 0 $list $texts
      }
    } catch { }
  }
  $text = ($texts -join ' ')
  if ($text.Length -gt 1200) { $text = $text.Substring(0, 1200) }
  Send-Reply @{ id = $a.id; ok = $true; windows = $wins; elements = @($list); text = $text }
}

# --- act ----------------------------------------------------------------------
function Escape-Keys([string]$s) {
  return ($s -replace '([+^%~(){}\[\]])', '{$1}')
}

function Try-Pattern($el, $pattern) {
  $p = $null
  if ($el.TryGetCurrentPattern($pattern, [ref]$p)) { return $p }
  return $null
}

function Press-Element($el) {
  if (Try-Pattern $el ([System.Windows.Automation.InvokePattern]::Pattern)) { [BdWin]::InvokeAsync($el); return 'invoke' }
  $p = Try-Pattern $el ([System.Windows.Automation.TogglePattern]::Pattern)
  if ($p) { $p.Toggle(); return 'toggle' }
  $p = Try-Pattern $el ([System.Windows.Automation.SelectionItemPattern]::Pattern)
  if ($p) { $p.Select(); return 'select' }
  $p = Try-Pattern $el ([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
  if ($p) { $p.Expand(); return 'expand' }
  # Last resort: a real mouse click in the middle of it.
  $r = $el.Current.BoundingRectangle
  [BdWin]::Click([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2))
  return 'click'
}

function Cmd-Act($a) {
  $el = $script:els[[string]$a.target]
  if ($a.action -ne 'escape' -and $null -eq $el) {
    Send-Reply @{ id = $a.id; ok = $false; error = 'element is gone' }
    return
  }
  $how = ''
  switch ([string]$a.action) {
    'type' {
      $vp = Try-Pattern $el ([System.Windows.Automation.ValuePattern]::Pattern)
      if ($vp -and -not $vp.Current.IsReadOnly) {
        # Some fields refuse SetValue ("operation cannot be performed") but
        # take keystrokes, so fall back to typing.
        try { $vp.SetValue([string]$a.value); $how = 'value' } catch { $how = '' }
      }
      if (-not $how) { $el.SetFocus(); [System.Windows.Forms.SendKeys]::SendWait((Escape-Keys ([string]$a.value))); $how = 'keys' }
    }
    'select' {
      $ec = Try-Pattern $el ([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
      if ($ec) { $ec.Expand(); Start-Sleep -Milliseconds 150 }
      $items = $el.FindAll($Scope::Descendants,
        (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::ListItem)))
      $picked = $false
      foreach ($it in $items) {
        $si = Try-Pattern $it ([System.Windows.Automation.SelectionItemPattern]::Pattern)
        if ($si -and -not $si.Current.IsSelected) { $si.Select(); $picked = $true; break }
      }
      if ($ec) { try { $ec.Collapse() } catch { } }
      $how = if ($picked) { 'selected next item' } else { 'no other item' }
    }
    'escape' {
      # Close the dialog, the way a person would: prefer the innermost window
      # that says it's modal, otherwise the most recently listed one.
      $wins = @(Get-TopWindows (Get-ProcessTree ([int]$a.pid)))
      $how = 'escape'
      if ($wins.Count -gt 0) {
        $target = $wins[$wins.Count - 1]
        foreach ($w in $wins) {
          $wp = Try-Pattern $w ([System.Windows.Automation.WindowPattern]::Pattern)
          if ($wp -and $wp.Current.IsModal) { $target = $w }
        }
        $h = [IntPtr]([int64]$target.Current.NativeWindowHandle)
        [BdWin]::SetForegroundWindow($h) | Out-Null
        Start-Sleep -Milliseconds 80
        [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
        # Plenty of dialogs ignore Esc; a person would then use the close
        # button. Never on the main window, which would end the program.
        Start-Sleep -Milliseconds 300
        if ($wins.Count -gt 1 -and $h -ne [IntPtr]([int64]$wins[0].Current.NativeWindowHandle) -and [BdWin]::IsWindow($h)) {
          $wp = Try-Pattern $target ([System.Windows.Automation.WindowPattern]::Pattern)
          if ($wp) { try { $wp.Close(); $how = 'close' } catch { } }
        }
      }
    }
    default { $how = Press-Element $el }
  }
  Send-Reply @{ id = $a.id; ok = $true; how = $how }
}

# --- trace: who has focus ----------------------------------------------------
function Cmd-Focus($a) {
  $f = $null
  try { $f = $AE::FocusedElement } catch { }
  if ($null -eq $f) { Send-Reply @{ id = $a.id; ok = $true; focus = $null }; return }
  $c = $f.Current
  $ids = Get-ProcessTree ([int]$a.pid)
  if (-not $ids.Contains([int]$c.ProcessId)) { Send-Reply @{ id = $a.id; ok = $true; focus = $null }; return }
  $label = $c.Name
  if (-not $label) { $label = $c.AutomationId }
  Send-Reply @{ id = $a.id; ok = $true; focus = @{
    type = ($c.ControlType.ProgrammaticName -replace '^ControlType\.', '')
    label = [string]$label
    secret = [bool]$c.IsPassword
  } }
}

function Cmd-WinText($a) {
  $h = [IntPtr]([int64]$a.hwnd)
  $el = $AE::FromHandle($h)
  $texts = @()
  $all = $el.FindAll($Scope::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $n = 0
  foreach ($x in $all) {
    if ($n -ge 60) { break }
    $n++
    try {
      $t = $x.Current.ControlType.ProgrammaticName
      if (($t -eq 'ControlType.Text' -or $t -eq 'ControlType.Document') -and $x.Current.Name) { $texts += $x.Current.Name }
    } catch { }
  }
  Send-Reply @{ id = $a.id; ok = $true; title = $el.Current.Name; text = ($texts -join ' ') }
}

# --- crash details from the Application event log -----------------------------
function Cmd-Events($a) {
  $since = [datetime]::Parse([string]$a.since)
  $out = @()
  $evs = Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = $since } -MaxEvents 80 -ErrorAction SilentlyContinue
  foreach ($e in $evs) {
    if ($out.Count -ge 3) { break }
    $isCrash = ($e.ProviderName -eq 'Application Error' -or $e.ProviderName -eq '.NET Runtime' -or
                $e.ProviderName -eq 'Windows Error Reporting')
    if ($isCrash -and $e.Message -and $e.Message.IndexOf([string]$a.exe, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
      $m = $e.Message
      if ($m.Length -gt 1500) { $m = $m.Substring(0, 1500) }
      $out += @{ provider = $e.ProviderName; eventId = $e.Id; time = $e.TimeCreated.ToString('o'); message = $m }
    }
  }
  Send-Reply @{ id = $a.id; ok = $true; events = $out }
}

# --- docking: the real window inside Benchdrop's pane --------------------------
# Not a child window: Chromium presents its page through the GPU on top of
# every child window, whatever their z-order, so a program parented into
# Benchdrop's window is there but never seen. Instead the program becomes a
# borderless window *owned* by Benchdrop - always above it, minimised with it -
# laid exactly over the pane. It stays a top-level window, so tracking,
# capture and Autotest carry on working while it's docked.
$GWL_STYLE   = -16
$GWL_EXSTYLE = -20
$GWLP_OWNER  = -8
$WS_POPUP    = [int64]2147483648
$WS_STRIP    = [int64]1640235008   # WS_CHILD | WS_CAPTION | WS_THICKFRAME | WS_MINIMIZE | WS_MAXIMIZE
$WS_EX_APPWINDOW = [int64]262144   # would give it its own taskbar button

# x/y/w/h are the pane on screen, in physical pixels (Benchdrop works them out).
function Place-Docked($h, $a) {
  # SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW
  [BdWin]::SetWindowPos($h, [IntPtr]::Zero, [int]$a.x, [int]$a.y, [int]$a.w, [int]$a.h, 0x0070) | Out-Null
}

function Cmd-Dock($a) {
  $h = [IntPtr]([int64]$a.hwnd)
  $parent = [IntPtr]([int64]$a.parent)
  if (-not [BdWin]::IsWindow($h)) { Send-Reply @{ id = $a.id; ok = $false; error = 'that window no longer exists' }; return }
  $key = [string]([int64]$a.hwnd)
  if (-not $script:docked.ContainsKey($key)) {
    [BdWin]::ShowWindow($h, 9) | Out-Null   # SW_RESTORE: out of maximised/minimised first
    $r = New-Object BdWin+RECT
    [BdWin]::GetWindowRect($h, [ref]$r) | Out-Null
    $script:docked[$key] = @{
      style = [BdWin]::GetWindowLongPtr($h, $GWL_STYLE).ToInt64()
      exstyle = [BdWin]::GetWindowLongPtr($h, $GWL_EXSTYLE).ToInt64()
      owner = [BdWin]::GetWindowLongPtr($h, $GWLP_OWNER).ToInt64()
      rect = $r
    }
  }
  $saved = $script:docked[$key]
  [BdWin]::SetWindowLongPtr($h, $GWL_STYLE, [IntPtr](($saved.style -band (-bnot $WS_STRIP)) -bor $WS_POPUP)) | Out-Null
  [BdWin]::SetWindowLongPtr($h, $GWL_EXSTYLE, [IntPtr]($saved.exstyle -band (-bnot $WS_EX_APPWINDOW))) | Out-Null
  [BdWin]::SetWindowLongPtr($h, $GWLP_OWNER, $parent) | Out-Null
  Place-Docked $h $a
  Send-Reply @{ id = $a.id; ok = $true }
}

function Cmd-Move($a) {
  $h = [IntPtr]([int64]$a.hwnd)
  Place-Docked $h $a
  Send-Reply @{ id = $a.id; ok = $true }
}

function Cmd-Show($a) {
  $h = [IntPtr]([int64]$a.hwnd)
  $cmd = if ($a.visible) { 5 } else { 0 }
  [BdWin]::ShowWindow($h, $cmd) | Out-Null
  if ($a.front) { [BdWin]::SetForegroundWindow($h) | Out-Null }
  Send-Reply @{ id = $a.id; ok = $true }
}

function Cmd-Undock($a) {
  $h = [IntPtr]([int64]$a.hwnd)
  $key = [string]([int64]$a.hwnd)
  if ($script:docked.ContainsKey($key) -and [BdWin]::IsWindow($h)) {
    $saved = $script:docked[$key]
    [BdWin]::SetWindowLongPtr($h, $GWLP_OWNER, [IntPtr]$saved.owner) | Out-Null
    [BdWin]::SetWindowLongPtr($h, $GWL_STYLE, [IntPtr]$saved.style) | Out-Null
    [BdWin]::SetWindowLongPtr($h, $GWL_EXSTYLE, [IntPtr]$saved.exstyle) | Out-Null
    $r = $saved.rect
    # SWP_NOZORDER | SWP_FRAMECHANGED | SWP_SHOWWINDOW
    [BdWin]::SetWindowPos($h, [IntPtr]::Zero, $r.Left, $r.Top, ($r.Right - $r.Left), ($r.Bottom - $r.Top), 0x0064) | Out-Null
  }
  $script:docked.Remove($key)
  Send-Reply @{ id = $a.id; ok = $true }
}

# --- main loop -----------------------------------------------------------------
Send-Reply @{ id = 0; ok = $true; ready = $true; ps = $PSVersionTable.PSVersion.ToString() }

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if (-not $line.Trim()) { continue }
  $a = $null
  try {
    $a = $line | ConvertFrom-Json
    switch ([string]$a.cmd) {
      'ping'     { Send-Reply @{ id = $a.id; ok = $true; ps = $PSVersionTable.PSVersion.ToString(); proxies = $script:proxies } }
      'info'     { Cmd-Info $a }
      'snapshot' { Cmd-Snapshot $a }
      'act'      { Cmd-Act $a }
      'focus'    { Cmd-Focus $a }
      'wintext'  { Cmd-WinText $a }
      'events'   { Cmd-Events $a }
      'dock'     { Cmd-Dock $a }
      'move'     { Cmd-Move $a }
      'show'     { Cmd-Show $a }
      'undock'   { Cmd-Undock $a }
      'quit'     { Send-Reply @{ id = $a.id; ok = $true }; exit 0 }
      default    { Send-Reply @{ id = $a.id; ok = $false; error = "unknown command: $($a.cmd)" } }
    }
  } catch {
    $rid = 0
    if ($a -and $a.id) { $rid = $a.id }
    Send-Reply @{ id = $rid; ok = $false; error = $_.Exception.Message }
  }
}
