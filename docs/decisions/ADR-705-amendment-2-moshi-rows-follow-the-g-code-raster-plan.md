## ADR-705 Amendment 2 - Moshi raster rows follow the G-code raster plan (2026-11-11)

**Status:** Accepted. Amends ADR-705 decision 3 (Image groups). Fixes code quality audit C2
D1-P1-1 and D1-P1-2, and D1-P3-1 (a failed Connect leaves the USB device claimed; ADR-702).
**Simulator-tested only; not qualified on hardware.** | **Date:** 2026-11-11

### Context

ADR-705 promised horizontal cuts across dark pixels only. The Moshi raster planner had its own
row walker, and the audit found it wrong in two ways:

1. **The runway burned (D1-P1-1).** A row moved laser-off to the overscan entry point and then
   cut from there to the first run's end. So the first cut started at the entry point, not at the
   first dark pixel. A default Image layer (5 mm overscan) burned 5 mm outside the art on every
   row, at the machine's full dial power, on the entering side. With two-way scanning that is both
   sides of the image.
2. **Two calibrations were dropped (D1-P1-2).** The planner ignored the layer's Dot width
   correction and the bidirectional scan offset (the layer's own value, else the machine's
   scanning-offset table). The G-code raster applies both (`grbl-strategy.ts`). The Moshi bytes
   were identical with or without them.

### Decision

1. **One row plan for both routes.** The Moshi planner now takes each row from
   `planRasterRowSweeps`, the planner `emit-raster.ts` uses. It walks each sweep the way
   `emit-raster-sweep.ts` does:
   - a laser-off move to the runway start (the overscan before the ink, or a point shared with
     the neighbouring island);
   - a laser-off move to the first dark pixel's edge;
   - the planned runs, burning only where a run has power;
   - the laser-off exit runway.

   A Moshi row therefore burns where a G-code row burns: the same ink islands, split runways,
   Dot width correction (each burned line comes in by the correction at both ends) and two-way
   order.
2. **Scan offset as on G-code.** A reversed row is shifted by
   `-(layer bidirectionalScanOffsetMm ?? offsetForSpeed(device.scanningOffsets, layer speed))`,
   as `grbl-strategy.ts` resolves it.
3. **Every raster move stays on one axis.** A row starts with a vertical move from the previous
   row, then horizontal moves only, as MeerK40t's raster mode requires (`driver.py`
   `_goto_absolute` L817-845).
4. **A failed Connect releases the device.** When the CH341 opens but its first status read
   fails, the Moshi store closes the link. When WebUSB's `selectConfiguration` fails after
   `open`, the platform link closes the device, as a failed claim already did. Another program
   can then take the board.

### Evidence

- `moshi-raster-plan.test.ts` decodes the program bytes. With 2 mm overscan, rows burn exactly
  the dark pixels both ways, while the head still enters 2 mm before the art. A 0.2 mm Dot width
  correction gives 1.6 mm burns inside the art. A 0.3 mm scan offset, from the layer or from the
  machine table, shifts only the reversed row.
- The ADR-705 raster golden (overscan 0) decodes to the same moves as before.
- `moshi-usb-store.test.ts`: a status read that throws on Connect closes the link once.
  `web-usb-link.test.ts`: a failed `selectConfiguration` closes the device and claims nothing.
