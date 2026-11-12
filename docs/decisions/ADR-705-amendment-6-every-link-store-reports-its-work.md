## ADR-705 Amendment 6 - Every link store reports its work (2026-11-12)

**Status:** Accepted. Amends ADR-705 Amendment 3 (link jobs count as machine work) and ADR-703
(Lihuiyu USB). Keeps PROJECT.md non-negotiable 9. Fixes code quality audit C2 D4-P1-1,
D4-P2-1, D4-P2-2, D4-P2-3 and D4-P3-1. **Simulator-tested only.** | **Date:** 2026-11-12

### Context

Amendment 3 gave the Moshi and Ruida network stores a boot-side registry that every "a job is
running" guard reads. The Lihuiyu (K40) USB store merged minutes earlier and never reported to
it. During a K40 job:

- `Ctrl+.` did nothing, and the link Live Motion bar was absent;
- close, Update and session end sent no reset;
- project drop and Machine Setup Save went ahead;
- a native `confirm` could freeze the packet stream.

Three guards still read only the laser store:

- the keep-awake lock, so a Moshi or K40 job could be cut off by sleep;
- the crash screen's ABORT, which was hidden during a link job;
- the unsaved-work prompt, which offered "Stay" after the unload stop had already stopped the
  job.

A K40 link that failed during a transfer also stayed claimed.

### Decision

1. **One list of link sources.** `LINK_MACHINE_SOURCES` (`moshi-usb`, `lihuiyu-usb`,
   `ruida-network`) types the registry and orders `activeLinkMachineWork`.
   `link-machine-work-sources.test.ts` reads every `*-usb` and `*-network` store under
   `ui/state`. It fails when one does not report, or when the list names a source no store
   reports, so a new link store cannot be missed again.
2. **The K40 store reports its work** from Home, Jog, Frame, Start, Pause and Stop. Its stop is
   the store's Abort, which sends the board reset. The bar names the K40 and shows jogging and
   homing too.
3. **The remaining guards read link work.**
   - The keep-awake lock follows `anyMachineJobActive()`, subscribed to both stores.
   - The crash screen's `isMotionLive` counts link work. Its trigger sends the link's own stop
     when the laser store runs nothing, as `Ctrl+.` picks it.
   - The unsaved-work prompt treats a link job as an active job, so it no longer asks.
4. **A failed K40 link releases the device** when it closes after a thrown transfer, at Connect,
   Frame or mid-job, or on an unplug. A reason that ends its own sentence no longer gets a
   second full stop.

### Evidence

- `lihuiyu-usb-store.test.ts`:
  - a running K40 job on the simulator is reported with its warnings;
  - the real capture-phase `Ctrl+.` resets the board, and the registry empties;
  - an unplugged link closes its session;
  - the closed-link message has one full stop.
- `link-machine-work-sources.test.ts` matches the stores to the list.
- `use-active-job-wake-lock.test.ts`: a K40 job takes the lock, and the lock is let go after it.
- `crash-recovery-link-work.test.ts`: ABORT shows, and the link stop is sent.
- `use-unsaved-changes-guard.test.ts`: no prompt while a link job runs.
