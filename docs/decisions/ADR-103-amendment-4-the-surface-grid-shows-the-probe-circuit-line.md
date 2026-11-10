## ADR-103 Amendment 4 - The surface grid shows the probe circuit line (2026-11-10)

**Status:** Accepted. | **Date:** 2026-11-10
**Follows:** Amendment 3 (the surface grid tests the probe circuit too), finishing meta audit
M7-P2-1 for the height-map probe.

### Context

Amendment 3 made Measure grid wait for touch-off's test touch and use it up, so no `G38.2` is
written before the probe input has shown closed and then open again. The surface dialog showed
only the refusal text ("Test the probe first: …"), which disappears once the touch lands. So the
operator holding the plate saw no "closed" reading to aim for, and nothing said "tested" when the
grid became ready. Touch-off's live **Probe circuit** line (Amendment 2) gives both.

### Decision

1. **One line, two hosts.** The live line moves out of `ProbeControls.tsx` into
   `src/ui/laser/ProbeCircuitLine.tsx`. Both touch-off and the surface dialog render it. It reads
   `probeCircuitCheck` and is shown while connected and no probe cycle runs.
2. **The tested line names the next step.** Touch-off keeps "Place the plate, then Run probe.";
   the surface dialog says "Measure grid once the region is clear."
3. The surface dialog keeps the refusal paragraph under the line, because that carries the `$6`
   inverted-input and grblHAL `$10` pin-report hints. The gate, the latch and the G-code are
   unchanged.

### Consequences

- Regression test: `SurfaceProbeDialog.test.tsx` walks the line through not tested, closed and
  tested, and checks that Measure grid enables only when it reads tested. `ProbePanel.test.tsx`
  still covers touch-off's line.
- Not hardware-tested.
