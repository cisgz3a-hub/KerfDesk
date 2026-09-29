## ADR-548 - Windows ending the session during a job: ask it to wait, or send Abort first (2026-09-29)

**Status:** Accepted. Unit-tested; not yet tried on Windows with a machine attached. | **Date:**
2026-09-29 | **Builds on:** ADR-117 (keep-awake during jobs), ADR-546 (the desktop support log)

### Context

The desktop gap audit of 2026-09-29 (item 8) found that a Windows restart for updates, a shutdown
or a sign-out during a job ends KerfDesk with no warning, no clean stop and no record. Windows does
not close the window the ordinary way then, so the close handoff that sends Abort when KerfDesk
closes mid-job (`electron/window-close-guard.ts`, `src/ui/app/desktop-close-runtime.ts`) never
runs. A stream cut off mid-job leaves the controller with its buffered moves, and a spindle or a
constant-power laser can stay on until the controller is reset.

On Windows, Electron 44 emits two window events with the reasons Windows gives (`shutdown`,
`close-app`, `critical`, `logoff`): `query-session-end` when Windows asks whether the session may
end, where `preventDefault()` asks Windows to wait, and `session-end` once it is ending, which
cannot be stopped. The main process cannot ask the window a question in time, because Windows
wants the answer at once, so it has to know beforehand whether a job runs.

### Decision

1. **The window reports whether a job runs.** A running job or a latched Fire, the same things the
   close handoff stops, counts. Each change goes to the main process through a same-origin
   `POST app://app/api/desktop/activity` with `{ "busy": true }` or `{ "busy": false }` and the
   `X-KerfDesk-Desktop` header, under the same checks as the licensing and support routes. A page
   that reloads or crashes counts as no job. ADR-553 adds the running job's progress to the
   report, for the taskbar button.
2. **Windows is asked to wait.** When Windows asks to end the session while a job runs, KerfDesk
   asks it to wait, and Windows shows its own screen saying KerfDesk is preventing the restart,
   shutdown or sign-out. The app shows a notice: let the job finish or Abort it first, and if
   Windows goes ahead anyway, KerfDesk sends Abort first. Without a job, KerfDesk never delays
   Windows; autosave (every 30 seconds) keeps unsaved work.
3. **Abort when Windows will not wait.** When the session is ending anyway, or Windows marks the
   request critical, the window sends the same Abort as closing KerfDesk mid-job, turning a
   latched Fire off first. Recovery records it as the app closing. The notice says that a sent
   Abort does not confirm the machine stopped and names the physical E-stop.
4. **Everything goes to the support log.** The main process writes each request and what KerfDesk
   did, so support can see why a job ended.
5. Help's connection guide gains "Disconnects during a job": USB selective suspend, Active hours
   for Windows Update, and cable routing.

### Consequences

- A Windows restart for updates no longer silently cuts off a long job while someone is at the
  computer, and a forced one gets Abort instead of an abandoned stream.
- Windows decides how long it waits. An unattended update restart can still go ahead; the job then
  ends with Abort, and the support log says why.
- Sleep is unchanged: ADR-117 keeps the computer awake during a job, and a forced sleep still ends
  the connection as before.
- This decision sends no command of its own. The Abort is the existing close handoff's, and only
  when Windows is ending the session during a job.

### Tests

`electron/session-end-guard.test.ts` covers waiting, never delaying without a job, critical and
final session ends, the page reset and the route's checks. `src/platform/electron/job-activity.test.ts`
covers the report, and `src/ui/app/desktop-session-end.test.tsx` the window side: reports, the
notice and the Abort, driven by the script the main process runs.
