; electron-builder 26.16.1 registers an unquoted executable in the open verb.
; Windows can interpret a space in the installation path as the end of its name.
; customInstall runs after registerFileAssociations. Keep the existing per-user
; or per-machine SHELL_CONTEXT, class registration and uninstall ownership.
!macro customInstall
  WriteRegStr SHELL_CONTEXT "Software\Classes\KerfDesk.Project\shell\open\command" "" '"$appExe" "%1"'
  !insertmacro UPDATEFILEASSOC
!macroend

; KerfDesk installs for the current user only (ADR-545). The assisted installer
; otherwise offers "Anyone who uses this computer", an untested mode whose
; updates would need administrator approval that shop accounts often lack.
; electron-builder calls this before its install-mode page and skips the page.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; A running KerfDesk may be streaming a job to a laser or router, so the
; installer and uninstaller never end it (ADR-555). electron-builder's own check
; offers OK to close KerfDesk (also the silent default) and then force-ends it,
; which skips the job's Abort handoff and the unsaved-changes question. During
; an update KerfDesk is already quitting through that handoff, so this waits
; for it and, if it is still open after a minute, stops and leaves the update
; for the next time KerfDesk closes. Otherwise it asks the operator to close
; KerfDesk themselves, and Cancel (the silent answer) stops the installer. Both
; stops exit with error level 1, so a silent or managed install reports failure.
!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
  ${If} ${isUpdated}
    StrCpy $R1 0
    ${DoWhile} $R0 == 0
      ${If} $R1 >= 60
        DetailPrint `${PRODUCT_NAME} is still open; the update waits until it next closes.`
        SetErrorLevel 1
        Quit
      ${EndIf}
      Sleep 1000
      IntOp $R1 $R1 + 1
      !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
    ${Loop}
  ${Else}
    ${DoWhile} $R0 == 0
      ${IfNot} ${Cmd} `MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "${PRODUCT_NAME} is open. Close it yourself first: closing ${PRODUCT_NAME} stops a running job and asks about unsaved work.$\r$\n$\r$\nThen click Retry." /SD IDCANCEL IDRETRY`
        SetErrorLevel 1
        Quit
      ${EndIf}
      !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
    ${Loop}
  ${EndIf}
!macroend
