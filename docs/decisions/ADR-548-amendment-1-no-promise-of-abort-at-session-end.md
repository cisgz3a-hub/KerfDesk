## ADR-548 Amendment 1 - Windows can end KerfDesk before its Abort leaves, so the notice never promises one (2026-09-29)

**Status:** Accepted. Unit-tested; not yet tried on Windows with a machine attached. | **Date:**
2026-09-29 | **Amends:** ADR-548 items 2 and 3

### Context

ADR-548 had the window send the close handoff's Abort once Windows was ending the session, and its
notice told the operator "If Windows restarts anyway, KerfDesk sends Abort first" and then
"KerfDesk sent Abort". A re-audit before the desktop app merged found that this cannot be relied
on. The window owns the serial port, so the main process can only ask it, asynchronously, to send
Abort. Windows may end a process once it has returned from `WM_ENDSESSION`, and Electron 44.4.5
ends its own process right after the `session-end` handlers run, unless the app is already quitting
(`shell/browser/native_window_views_win.cc`, `WM_ENDSESSION`, whose comment notes that the OS kills
the process and its children right after that message returns). The window's Abort then never
leaves. A forced session end
(`ENDSESSION_CRITICAL` on `query-session-end`) leaves the window only the moment until
`WM_ENDSESSION` arrives. Only asking Windows to wait, while no restart is forced, is reliable.

The machine behaves as it did before ADR-548 in those cases, but the operator was told a job
would be aborted when it may not be.

### Decision

1. The notice while Windows waits says: let the job finish or Abort it before you restart; if
   Windows restarts anyway, it can close KerfDesk before an Abort reaches the machine, and a
   spindle or constant-power laser can stay on until the controller is reset.
2. When Windows ends the session anyway, or forces it, the window still tries the close handoff's
   Abort, and the notice says KerfDesk is sending Abort but Windows can close KerfDesk first, and
   names the physical E-stop and power cutoff.
3. The support log says "trying to send Abort, which Windows can cut off" instead of "sending
   Abort", and the support playbook asks whether the spindle or laser stayed on.
4. KerfDesk does not send Abort merely because Windows asks. An operator who cancels the restart
   keeps the job; one who restarts anyway was told what happens.

### Alternatives rejected

- **Abort as soon as Windows asks, even when it can still be refused.** The machine would stop
  safely before any restart, but every restart request during a job, including one the operator
  would cancel on Windows' own screen, would end the job. A request that is not forced usually
  comes from someone at the computer, and the notice now tells them the risk.
- **Holding the main process in `session-end` until the window reports the Abort written.** The
  main process cannot see the serial write, and how long Windows and Electron wait there is not
  documented; it cannot be tested without Windows and a machine.

### Consequences

- The notices and the log no longer claim an Abort that may not have happened.
- A forced restart during a job can still leave the spindle or laser on, as before ADR-548. The
  connection guide's advice (Active hours for Windows Update) and the physical E-stop remain the
  protection.
- `src/ui/app/desktop-session-end.test.tsx` pins that neither notice promises the Abort, and
  `electron/session-end-guard.test.ts` pins the log wording.
