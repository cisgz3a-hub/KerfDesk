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
