# BLOCKERS

A blocker is anything that prevents a task from being completed honestly.

## Rules

- Do not hide blockers in chat.
- Do not mark a task complete if a blocker exists.
- Do not guess around a blocker.
- Do not replace a failed command with an invented result.
- Record exact error output where possible.

## Blocker Table

| ID | Date | Repo | Step | Blocker | Evidence | Attempted Fix | Next Required Action | Status |
|---|---|---|---|---|---|---|---|---|
| BLK-001 | 2026-05-21 | Rayforge / MeerK40t / bCNC / K40 Whisperer | Build/test toolchain | `python` and `python3` resolve to WindowsApps launchers and did not report a usable version during preflight. | Preflight command output: `python=` and `python3=` blank; `Get-Command` shows WindowsApps stubs. | None; audit must not install toolchains without explicit permission. | Static study can continue; Python build/test claims must remain `NOT RUN - REASON RECORDED` until a usable Python is installed. | OPEN |
| BLK-002 | 2026-05-21 | VisiCut / LibLaserCut / Universal G-Code Sender | Build/test toolchain | Java is not installed or not on PATH. | Preflight command output: `java` not recognized. | None; audit must not install toolchains without explicit permission. | Static study can continue; Java runtime/build claims must remain `NOT RUN - REASON RECORDED` until Java is installed. | OPEN |
| BLK-003 | 2026-05-21 | VisiCut / LibLaserCut / Universal G-Code Sender | Build/test toolchain | Maven is not installed or not on PATH. | Preflight command output: `mvn` not recognized. | None; audit must not install toolchains without explicit permission. | Static study can continue; Maven build/test claims must remain `NOT RUN - REASON RECORDED` until Maven is installed or a wrapper is available in the cloned repo. | OPEN |

