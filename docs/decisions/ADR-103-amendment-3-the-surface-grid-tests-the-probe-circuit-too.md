## ADR-103 Amendment 3 - The surface grid tests the probe circuit too (2026-10-27)

**Status:** Accepted. | **Date:** 2026-10-27
**Fixes:** rolling audit v4 H3-P2-3 (P2), confirmed by an independent refuter.

### Context

Amendment 2 made each touch-off wait for a test touch: a status report showing the probe input
closed, then open again. Its item 7 left the surface (height-map) probe out. That probe seeks
`G38.2 Z-<Maximum downward travel>`, 10 mm by default, at every grid point
(`src/ui/state/laser-surface-probe-actions.ts`). GRBL stops it only on contact, so a lead that is
not clipped on drives the bit into the stock at the first point. The dialog's "the probe is
connected" tick is the operator's statement, not a reading.

### Decision

1. **The grid needs a test touch.** `surfaceProbeBlockReason` ends with touch-off's
   `probeCircuitBlockReason`, after every other check, so Measure grid stays disabled and the
   dialog shows "Test the probe first: …" until a test touch shows; a closed input is refused with
   touch-off's words.
2. **Each grid uses the touch up.** Reserving the grid clears it, as a touch-off does. The grid's
   own contacts do not count, because the grid holds `probeBusy` while it runs.
3. Item 7 of Amendment 2 is replaced for the surface probe; the grid's G-code is unchanged.

### Consequences

- Regression tests: `laser-surface-probe-actions.test.ts` (refused with no touch and no writes;
  the touch is spent) and `SurfaceProbeDialog.test.tsx`. The surface simulator now sends a test
  touch unless a test asks it not to.
- Not hardware-tested.
