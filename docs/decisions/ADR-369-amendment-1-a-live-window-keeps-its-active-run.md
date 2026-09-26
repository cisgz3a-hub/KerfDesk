## ADR-369 Amendment 1 - A window that opens while another streams leaves the live run alone (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

### Context

ADR-369 said that "a second window no longer turns a live Start into a false 'Interrupted job'
card". That holds only for the seconds-long `pendingStart` handoff. Every window also runs
`promoteStaleActiveRun` when it initializes, and that step turned any `activeRun` into an
`unknown` recovery capsule. `ActiveRunRecord` carries no owner, so a run another window was still
streaming was promoted too. Electron runs one window, so this affected the browser only.

After that, the streaming window's writes fell on nothing:

- its progress writes found no active run;
- `completeRun` failed;
- a later real interruption returned early, because a capsule for the run already existed.

A finished job therefore kept an "Interrupted job saved" card at the line count from when the
second tab opened, and Review → Start re-burned lines that had already run. The 2026-09-25 audit
of PRs #845-#904 found this (REC-1).

### Decision

1. The window that arms or activates a run takes an exclusive Web Lock named for that run first,
   before the run is written. It keeps the lock while the run is pending or active in its own
   snapshot, and drops it once the run is neither. This follows the autosave session lock.
2. Initialization promotes an active run only while holding that lock, obtained with
   `ifAvailable`. When a live window holds it, the run is left active and nothing is written.
   The promotion is also bound to the run the probe checked.
3. The browser releases a window's locks when the window closes, reloads or crashes. A run left by
   a dead window is therefore promoted exactly as before. Where Web Locks are unavailable,
   promotion also runs as before.
4. The `pendingStart` lease and its renewal (items 1 to 5) are unchanged.

### Consequences

- Opening a second KerfDesk tab during a job no longer interrupts that job's recovery tracking.
  The streaming tab still completes or interrupts its own run.
- A window whose tab is frozen but still open keeps its run. A later window cannot promote that
  run until the tab is closed.
- Verified with in-process repositories that share one storage backend and one lock table, not in
  a browser with real tabs.
