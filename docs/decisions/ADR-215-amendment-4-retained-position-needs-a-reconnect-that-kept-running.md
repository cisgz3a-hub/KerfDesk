## ADR-215 Amendment 4 - Retained position needs a reconnect that shows the board kept running, and a held bit change caps the default (2026-11-13)

**Status:** Accepted. | **Date:** 2026-11-13
**Fixes:** CNC audit v3 N5r-P1-1 (P1, found by the refuter), N5-P2-1 (P2), N5r-P3-1 and N5-P3-1
(P3) (`docs/audits/2026-11-13-cnc-v3/N5-cnc-machine-run.md`). Amends ADR-215 decision 2,
Amendment 1, ADR-398 Amendment 3 (which left CNC records out of the reconnect verdict) and
ADR-676 Amendment 5's advice for CNC jobs. The laser twin is rolling audit v12 X1-P1-1 (ADR-341
Amendment 13).

### Context

**N5r-P1-1.** An Arduino-class board resets when its port opens, and one powered from USB stops
when the cable is pulled (ADR-398 Amendment 3). Without homing, GRBL boots with machine position
zero wherever the head stands, while its saved G54 still matches the offset archived at Start. The
retained-position check refused only a reboot recorded during the job, and
`link-loss-restart-tracking.ts` skipped CNC records, so after a cable pull and a reconnect the
wizard still offered "Position retained". In the refuter's repro the "retract" became a 9.19 mm
rapid down into the stock, the spindle started buried, and the cut ran 16.5 mm deep and 350 mm off
in Y.

**N5-P2-1.** The default recovery pass never rewinds across a tool-change M0 that was acknowledged.
KerfDesk never sends that M0: the stream holds in front of it (`streamer.ts`). After an Abort at a
hold the M0 was not among the acknowledged lines, so the planner reserve rewound across it into
the previous bit's operation (43 raw lines in the refuter's job), and the RX-buffer upper bound ran
past it, marking the new bit's never-sent first pass "?".

### Decision

1. **Every reconnect is recorded for a CNC run.** The tracker gives a saved CNC record, once per
   connection, the sign that connection showed first: `boot-banner`, `alarm`, `kept-running` or
   `unknown` (ADR-398 Amendments 3 and 4 decide the sign). It applies to a record whose run was
   live as the link dropped and to any record saved before the connection began, an Abort's
   included. The record keeps it as `JobInterruption.controllerRestart`. Any sign but
   `kept-running` sticks: a later reconnect cannot give back a position a restart zeroed. CNC
   records still take no planner backlog or message change; pass recovery keeps its own reserve.
2. **"Position retained" needs a board that kept running.** The retained check refuses a record
   whose recorded sign is anything but `kept-running`, and a lost link that no reconnect has
   settled yet: "A reconnect after the stop did not show that the controller kept running. A board
   that resets when its port opens, or that lost USB power, restarts with its machine position
   zeroed wherever the head stands … Home the machine if it has homing, re-establish the XY/Z zero,
   then choose the re-zeroed option." Re-zeroed recovery stays open.
3. **A drained hold caps the default.** An Abort asked for while the stream held at a tool-change
   M0, drained to a fresh Idle with nothing in flight, records `heldAtToolChange` on the stop
   request and the saved interruption. Pass recovery then counts that M0 as run, so the default is
   the new bit's first pass. Without a drained hold (an Abort during the park move) the planner
   reserve applies as before.
4. **Nothing past a held M0 is "uncertain".** The upper bound stops in front of any tool-change M0,
   and the wizard marks a pass uncertain only when its first line may have run, so a pass after a
   bit change, or after any gap between passes, reads as pending.
5. **Recovery does not call the cut operations empty layers** (N5r-P3-1). A recovery job leaves
   out the operations already cut, so its emit preflight read each as a layer whose "shapes produced
   no toolpaths — usually the bit is too wide". Pass and supervised recovery drop that
   `cnc-layer-empty` finding from the recovery job's preflight; the sealed job passed the same check
   at its own Start.
6. **A CNC window stream names the spindle** (N5-P3-1). Job Review's window-stream warning says the
   spindle keeps turning in the stopped cut, so the bit rubs, heats and can scorch the stock or
   break, and to keep a hand on the E-stop. It gives no M4 or GRBL Dynamic advice: the CNC emitter
   always writes M3, and M4 turns a spindle backwards.

### Consequences

- A CNC run interrupted by a lost link recovers only through the re-zeroed path unless the first
  status after the reconnect showed Run or Hold. A machine without homing must be re-zeroed after
  any reconnect that may have reset it.
- An in-session reset that is not a reconnect (a reset button pressed after an Abort) is still
  judged by the work offset alone; noted as a follow-up.
- Regression tests: `src/ui/laser/cnc-recovery-after-reset.simulator.test.tsx` (the cable pull with
  a board reset on reopen, and the default after an Abort at a hold, both failing on main),
  `cnc-resume-point.test.ts`, `link-loss-restart.test.ts`, `window-stream-lit-stop-warnings.test.ts`.
- Not hardware-tested.
