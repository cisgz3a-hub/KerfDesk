## ADR-623 Amendment 1 - An admitted session survives a reload; clock advice names each platform (2026-10-20)

**Status:** Accepted | **Date:** 2026-10-20 | **Amends:** ADR-623 decision 3 and its Consequences, and the clock advice of ADR-523 Amendment 2 and ADR-592

### Context

ADR-623 decision 3 lets the device in once per session: the workspace stays mounted until
KerfDesk closes, and the licence window returns only at the next launch. The renderer held that
latch in its own React state, and the main process remembered Pro only for paid rights. So a
renderer that started again in the same app session forgot it.

An audit traced the case that matters. A trial runs out, or a refund or deactivation ends the
rights, during a long raster job. The renderer then runs out of memory, and the operator chooses
**Reload KerfDesk**, whose prompt (ADR-482) promises the controls back and where a running job
stopped. The reloaded renderer was sent a free status and opened behind **Activate KerfDesk**,
with no workspace. Job recovery, reconnect, soft reset and the autosave were all out of reach.
A window reopened on macOS met the same window.

ADR-613 also ships macOS and Linux packages, but every clock message still said to turn on
**Set time automatically** in Windows' Date & time settings.

### Decision

1. **The main process remembers the admitted session.** The first time a mounted workspace
   acknowledges admission (any tier, a trial included), the session stays admitted until KerfDesk
   quits. Every status sent after that carries `sessionAdmitted`. A renderer reloaded after a
   crash, or a window reopened on macOS, opens straight to its workspace, whatever the rights are
   now. The Pro check still pauses new Pro tool choices (ADR-540 Amendment 2, ADR-592). A new
   launch starts without an admitted session, so the licence window stands as ADR-623 requires.
2. **Services still follow each renderer.** An opening, crashed or closed renderer still stops the
   camera bridge. The bridge starts again only when the new renderer acknowledges its mounted
   workspace, as before. Only an acknowledgement from the current renderer admits the session. A
   Pro status on its own, or a reply to a renderer that has since reloaded, does not.
3. **Clock advice names this computer's own settings.** On Windows it says **Set time
   automatically** in Windows' Date & time settings. On macOS it says **Set time and date
   automatically** in System Settings > General > Date & Time. On Linux, and any other platform,
   it says automatic date and time in your desktop's date and time settings. This applies to the
   clock error, the clock warning after a paid refresh, a trial whose clock moved back, and the
   overdue check-in message.

### Consequences

- The licence check still gates nothing in a running session. Frame, Start, output, Save G-code
  and a running job never read it, and a crash reload now reaches the recovery flow it promises.
- Like the window itself (decision 7), the latch is a convenience and not DRM. It lives only in
  the main process's memory, and nothing is saved.
- `createStartupSignals` sets the latch in `admitWorkspace`, the licensing routes send it beside
  `admissionGeneration`, and `EditionProvider` admits a status that carries it. The desktop
  adapter accepts the field only as a boolean.
- The licensing runtime takes the platform as an option, `process.platform` by default. Tests
  name one, so the same assertions hold on every CI runner.
