; SPDX-License-Identifier: MIT
; Copyright (c) 2026 Griffith.Software — https://griffith.software
; Benchdrop's additions to the electron-builder NSIS installer.
;
; Close Benchdrop automatically before installing, updating or uninstalling,
; so its files are never in use.
;
; Where it runs matters. electron-builder runs its app-running check in the
; install section only when the installer is NOT the elevated copy - and an
; install to Program Files restarts the installer elevated, so the check never
; ran there and the old version's uninstaller hit "cannot be closed". So it
; runs in both places: the install section (per-user installs) and the
; elevated copy's init (per-machine installs), and in the uninstaller.
;
; How it closes: a flag in %ProgramData%\Benchdrop tells Claude's connector
; not to start Benchdrop during the update; every Benchdrop.exe is asked to
; close normally (it stops what it started and tidies up) and given five
; seconds; then whatever is left is ended - repeatedly for a while, in case
; something starts it again. That includes Claude Code's connector, which runs
; as Benchdrop.exe. Only if something still can't be ended is the person asked.
; customInstall clears the flag; a flag left by a cancelled install expires.

!macro BENCHDROP_RUNNING _OUT
  nsExec::Exec `$SYSDIR\cmd.exe /c tasklist /fi "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /nh | find /i "${APP_EXECUTABLE_FILENAME}"`
  Pop ${_OUT}
!macroend

!macro BENCHDROP_UPDATING_FLAG _ON
  ReadEnvStr $R3 PROGRAMDATA
  ${If} $R3 != ""
    ${If} ${_ON} == 1
      CreateDirectory "$R3\Benchdrop"
      ClearErrors
      FileOpen $R2 "$R3\Benchdrop\updating" w
      ${IfNot} ${Errors}
        FileWrite $R2 "Benchdrop is being installed or updated."
        FileClose $R2
      ${EndIf}
    ${Else}
      Delete "$R3\Benchdrop\updating"
      RMDir "$R3\Benchdrop"
    ${EndIf}
  ${EndIf}
!macroend

!macro BENCHDROP_CLOSE_ALL
  !insertmacro BENCHDROP_UPDATING_FLAG 1
  !insertmacro BENCHDROP_RUNNING $R0
  ${If} $R0 == 0
    DetailPrint `Closing ${PRODUCT_NAME}...`
    nsExec::Exec `$SYSDIR\taskkill.exe /im "${APP_EXECUTABLE_FILENAME}"`
    Pop $R1
    StrCpy $R1 0
    ${Do}
      Sleep 500
      IntOp $R1 $R1 + 1
      !insertmacro BENCHDROP_RUNNING $R0
      ${If} $R0 != 0
        ${ExitDo}
      ${EndIf}
    ${LoopUntil} $R1 >= 10

    ; End what's left - more than once, in case something starts it again.
    StrCpy $R1 0
    ${Do}
      !insertmacro BENCHDROP_RUNNING $R0
      ${If} $R0 != 0
        ${ExitDo}
      ${EndIf}
      nsExec::Exec `$SYSDIR\taskkill.exe /f /t /im "${APP_EXECUTABLE_FILENAME}"`
      Pop $R2
      Sleep 1000
      IntOp $R1 $R1 + 1
    ${LoopUntil} $R1 >= 10

    ${Do}
      !insertmacro BENCHDROP_RUNNING $R0
      ${If} $R0 != 0
        ${ExitDo}
      ${EndIf}
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY +2
      Quit
    ${Loop}
  ${EndIf}
!macroend

; Install section (per-user installs) and the uninstaller.
!macro customCheckAppRunning
  !insertmacro BENCHDROP_CLOSE_ALL
!macroend

; First install only: electron-builder finds the per-user folder with
; SHGetKnownFolderPath and then copies NSIS_MAX_STRLEN characters out of
; the short string it returns - reading past the end of it, which crashed the
; installer (0xC0000005 in System.dll) on about half of first starts. With
; the folder already recorded where it looks first, that lookup never runs.
!macro preInit
  SetShellVarContext current
  ReadRegStr $R0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $R0 == ""
    WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\${APP_FILENAME}"
  ${EndIf}
!macroend

; The elevated copy that does a per-machine install skips the check above.
!macro customInit
  ${If} ${UAC_IsInnerInstance}
    !insertmacro BENCHDROP_CLOSE_ALL
  ${EndIf}
!macroend

; Files are in place: Benchdrop may be started again.
!macro customInstall
  !insertmacro BENCHDROP_UPDATING_FLAG 0
  ; Installed apps: the website as the about link, the support page as help.
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "URLInfoAbout" "https://griffith.software"
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "HelpLink" "https://griffith.software/feedback.html"
!macroend

; The installer's and uninstaller's own version resource: electron-builder
; fills in the rest but leaves OriginalFilename out.
!macro customHeader
  !ifdef BUILD_UNINSTALLER
    VIAddVersionKey /LANG=1033 "OriginalFilename" "Uninstall Benchdrop.exe"
    VIAddVersionKey /LANG=1033 "InternalName" "Uninstall Benchdrop"
  !else
    VIAddVersionKey /LANG=1033 "OriginalFilename" "Benchdrop_v${VERSION}_win-x64_setup.exe"
    VIAddVersionKey /LANG=1033 "InternalName" "Benchdrop Setup"
  !endif
!macroend

; Per-user only: Benchdrop never needs administrator rights, so the
; "for all users" choice (and its admin prompt) is not offered.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; The finish page: "Run Benchdrop" (electron-builder's own, reproduced here)
; plus "Create a desktop shortcut", unticked by default. electron-builder
; declares its pages before customHeader runs, so the page is replaced
; whole through customFinishPage.
!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd
  Function BenchdropDesktopShortcut
    CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
  FunctionEnd
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !define MUI_FINISHPAGE_SHOWREADME ""
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Create a desktop shortcut"
  !define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION BenchdropDesktopShortcut
  !insertmacro MUI_PAGE_FINISH
!macroend

; Uninstall: remove the optional desktop shortcut, and ask - keep by default -
; whether to delete Benchdrop's data (projects, settings, screenshots, the
; downloaded Node.js). Silent uninstalls and updates always keep it.
!macro customUnInstall
  ; The closing step raised the updating flag; lower it, or Claude's
  ; connector would refuse to start Benchdrop for the next 15 minutes.
  !insertmacro BENCHDROP_UPDATING_FLAG 0
  Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete Benchdrop's data - your unpacked projects, settings, screenshots and the Node.js it downloaded?$\r$\n$\r$\nChoose No to keep it for a later install." /SD IDNO IDNO benchdropKeepData
      SetShellVarContext current
      RMDir /r "$APPDATA\benchdrop"
    benchdropKeepData:
  ${endIf}
!macroend
