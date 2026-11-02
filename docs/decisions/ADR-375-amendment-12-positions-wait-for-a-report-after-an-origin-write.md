## ADR-375 Amendment 12 - A position is read only from a status report sent after the last origin write (2026-11-02)

**Status:** Accepted; software-verified through the real store, the real Frame, Start and jog
paths and the repo's GRBL, grblHAL (Falcon A1 Pro `$$`), Marlin and Smoothieware simulators. Not
hardware-tested. | **Date:** 2026-11-02

Follows rolling audit v9 finding R8-P1-1 (P1), confirmed by an independent refuter
(`docs/audits/2026-11-02-rolling-v9/R8-cross-fix-journeys.md`). No hardware was operated.

### Context

- **The stored report outlives an origin write.** Set origin, Reset origin, Restore origin and Place
  Board's corner origin write a `G92` or `G10` through one transaction (`laser-origin-transaction.ts`).
  The store keeps the last status report until the next one arrives, and the idle poll runs about
  once a second. A report read before the write describes the old work frame: its `WPos` is
  measured from the old offset, and its `WCO` is the old offset. Only `MPos` is the same in both.
- **Frame read it.** `reportedWorkPositionMm` prefers the report's own `WCO` over the cache, and
  `currentWorkPosition` returns a `WPos` directly. Within about a second of Set origin, the Frame's
  return point came from the old frame. In the simulator the head returned to machine (200, 160)
  instead of (100, 80), beam off, and Frame then refused with "did not return". On `$10=0` (`WPos`
  only) nothing refused: a permit was issued and a Current Position job burned 100 × 80 mm from
  the head. Reset origin displaced an unhomed Absolute trace the same way.
- **Stock GRBL and grblHAL.** Both print `WCO` on one idle report in ten and on the first report
  after an offset change (`REPORT_WCO_REFRESH_IDLE_COUNT 10`, `system_flag_wco_change`). So with
  `MPos` the window opens when the last report before the write carried `WCO`. With `WPos` it opens
  on every write.
- **The twin.** Frame's own Set origin offer already waited for a report taken after its repair
  (`waitForPostRepairPosition`, `frame-blocker-repair.ts`), and its comment named this defect. A
  plain click on Frame skipped it.
- **Firmware order.** GRBL answers `ok` only after `gc_execute_line` has run the line, and writes
  its replies in order
  ([protocol.c L102-L104](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L102-L104)),
  so a report read after the origin line's `ok` shows the new origin.

### Decision

1. **The origin write records a fence.** After each line it writes, the origin transaction records
   the store's status sequence at the controller's acknowledgement (`originStatusFence`). A report
   at or before the fence predates the write (`origin-status-fence.ts`).
2. **A report that predates the fence keeps only its `MPos`.** When the write's success patch lands
   and the stored report still predates the fence, its `WPos` and `WCO` are dropped. Every reader
   then takes the work position from `MPos` and the offset the write recorded, or finds no position
   (`WPos`-only reports) and waits or refuses as it already does. The transaction then asks for a
   status report at once, so the next one arrives within one round trip.
3. **Frame waits for a report after the fence.** The plain Frame, its in-place offers and the
   camera's transient Frame wait up to 3 s for one (`waitForStatusAfterOriginChange`), sending
   realtime status queries where the driver has them and otherwise waiting for the poll. If none
   comes, Frame refuses before any motion: "The controller has not reported its position since the
   work origin changed, so Frame cannot tell where the head is in the new origin. Wait for a status
   report, then Frame again." This is a factual refusal (the position is not known), not a policy
   one.
4. **Manual motion asks again.** A cached Idle report that predates the fence no longer counts as
   fresh for jog, Move laser here or the other manual motions (`manual-motion-fresh-idle.ts`), so
   they send a status query first. On `$10=0`, Move laser here right after Set origin had landed
   100 mm short.
5. **Start is covered by the Frame.** Every origin write clears the Frame permit, so Start after
   one needs a new Frame, which waits as above.

### Consequences

- A Frame pressed right after an origin write waits for one status round trip, usually well under
  100 ms. A controller that stops answering gets the refusal above rather than a wrong move.
- For up to that round trip, readouts that take a work position from the store show none on a
  `WPos`-only controller, instead of the old frame's numbers.
- Marlin and Smoothieware go through the same transaction; their simulators return to the right
  point before and after this change.
- **Tests:** `frame-after-origin-write.simulator.test.ts` holds the simulator's reports back after
  the write to open the window on every run, and reshapes them to model stock cadence, `$10=0` and
  `$10=2`. It covers Set origin on stock GRBL (every report, stock cadence, `$10=0`, `$10=2`) and
  the Falcon A1 Pro, Reset origin, Restore origin, Place Board's corner origin, the refusal when no
  report comes, Start at Current Position on `$10=0`, Move laser here and a jog, with Marlin and
  Smoothieware as controls. Before this change, 10 of its 17 cases failed as the audit describes.
- **Not covered:** a probe cycle's `G10` and a Console `G92` keep their own handling. The probe
  waits for its own idle reports, and a Console coordinate command already clears the stored report.
- No new Start guard, account, licence or entitlement check is added.
