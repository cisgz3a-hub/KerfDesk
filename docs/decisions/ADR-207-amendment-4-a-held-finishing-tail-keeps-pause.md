## ADR-207 Amendment 4 - A door or feed hold in the finishing tail keeps Pause (2026-11-09)

**Status:** Accepted |
**Amends:** ADR-207's "one live-motion bar owns Pause, Resume, tool-change Continue and software
Abort while a job is active", for a stream whose every line has been sent. It fixes rolling
audit v12 finding X5-P2-1 (`docs/audits/2026-11-09-rolling-v12/X5-fix-ux-sweep.md`). G-code,
Start guards and controller commands are unchanged.

### Context

#1595 (UX audit U4-P3-2) worded a controller door hold as "Press Pause and then Resume here, or
the machine's cycle-start button if it has one". Most hobby lasers have no cycle-start button.
That route works while the job is still streaming. The bar offered Pause only while lines were
still being sent, or when every line had been sent (`done`) and the controller reported Run.

In the **finishing tail** (every line sent, the planner still moving) a door hold leaves the
controller in Door, so the bar showed the sentence with ABORT JOB alone. In the simulator the
job stayed at "47 / 47 lines · 99%" until it was aborted. With Sort cuts last, that tail is
usually the slow cut-out. The store's own Pause already handles a `done` stream
(`streamer.ts` `pause`: "it must remain pausable while the controller still reports Run"), and
calling it in the tail paused, and Resume then finished the job.

### Decision

1. While a sent job's controller reports **Door** or **Hold**, the bar offers **Pause** as it
   does for Run. Pause makes the hold the app's own, and the app's Resume releases it, with the
   same ADR-180 accessory proof as any app-owned pause.
2. Nothing else changes. There is still no Resume for a hold the app never requested, and
   ABORT JOB and `Ctrl+.` act as before.

### Verification

`src/ui/laser/door-hold-tail.simulator.test.tsx` drives the real store and the real bar
against the GRBL simulator. It opens the door after the last line was sent while the planner
still holds motion. The bar shows "Press Pause and then Resume here" with **Pause**, and Pause
then Resume finishes the job with the planner empty. With the old condition the same test finds
no Pause button.
