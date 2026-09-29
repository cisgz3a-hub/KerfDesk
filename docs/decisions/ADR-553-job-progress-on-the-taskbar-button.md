## ADR-553 - The desktop app shows a running job on its taskbar button (2026-09-29)

**Status:** Accepted. Unit-tested; not yet seen on a Windows taskbar. | **Date:** 2026-09-29 |
**Builds on:** ADR-548 (the window's job reports to the main process)

### Context

The desktop gap audit of 2026-09-29 (item 16) found that the taskbar shows nothing about a
running job, and nothing draws attention when a job ends while the operator works in another
program. Windows programs that run long tasks fill their taskbar button (`ITaskbarList3`, which
Electron's `BrowserWindow.setProgressBar` drives) and flash it when they need attention
(`flashFrame`). ADR-548 already has the window tell the main process whether a job runs.

### Decision

1. **The job report carries progress.** Besides `busy`, the window's report to
   `POST app://app/api/desktop/activity` carries `job: { progress, state }` while a streamed job
   runs: the share of its lines the controller acknowledged, from 0 to 1, and `running`,
   `paused` (paused or at a tool change) or `error` (the streamer stopped on an error). The route
   accepts exactly those fields and only with `busy: true`. A latched Fire stays `busy` with no
   `job`.
2. **Changes go at once, progress at most once a second.** The window sends a report when
   whether a job runs or its state changes, and when the progress moves by a whole percent, at
   most once a second, so a fast job costs a few dozen local requests.
3. **Main draws it.** `electron/taskbar-job-progress.ts` sets the taskbar fill in Windows' normal,
   paused (yellow) or error (red) mode, clears it when the job ends and, when KerfDesk is not in
   front then, flashes the button until KerfDesk is focused. macOS shows the fill on the Dock
   icon. A page that reloads or crashes counts as no job, as in ADR-548, so the fill clears.

### Consequences

- The operator sees a job's progress and a finished or stopped job from any program.
- The fill is the acknowledged share of lines, as the in-app progress is, not machine time.
- No new route or renderer capability: the report keeps its route, header and origin checks.

### Tests

`electron/taskbar-job-progress.test.ts` covers the fill, its modes, the flash in the background
and none in front, a latched Fire and a closed window. `electron/session-end-guard.test.ts`
covers the report's fields and the refused shapes, and `src/ui/app/desktop-session-end.test.tsx`
the window's reports, the once-a-second progress and an errored job.
