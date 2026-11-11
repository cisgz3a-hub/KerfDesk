## ADR-705 Amendment 2 - Moshi raster rows follow the G-code raster plan (2026-11-11)

**Status:** Accepted. Amends ADR-705 decision 3 (Image groups). Fixes code quality audit C2
D1-P1-1 and D1-P1-2, D1-P3-1 (a failed Connect leaves the USB device claimed; ADR-702), and
rolling audit v14 Z4-P2-1 (rotary rows on the mil grid; extends ADR-315 Amendments 1-3).
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
2. **Scan offset as on G-code.** The offset is the layer's `bidirectionalScanOffsetMm`, else
   `offsetForSpeed(device.scanningOffsets, layer speed)`, as `grbl-strategy.ts` resolves it. Every
   row of a two-way scan moves half of it along its own travel (`rasterRowShiftX`, ADR-052
   Amendment 2), forward rows one way and reversed rows the other, exactly as the G-code raster.
3. **Every raster move stays on one axis.** A row starts with a vertical move from the previous
   row, then horizontal moves only, as MeerK40t's raster mode requires (`driver.py`
   `_goto_absolute` L817-845).
4. **A failed Connect releases the device.** When the CH341 opens but its first status read
   fails, the Moshi store closes the link. When WebUSB's `selectConfiguration` fails after
   `open`, the platform link closes the device, as a failed claim already did. Another program
   can then take the board.
5. **Rotary rows are checked on the mil grid (Z4-P2-1).** A Moshiboard places every coordinate
   on a whole mil of machine Y. On a Y-port chuck one mil turns the part 0.0254 / k mm: 0.16 mm
   with 40 mm per turn on Ø80 glass. A 0.1 mm Fill or Image interval therefore lands rows on
   shared mils, and those rows burn twice. The audit counted 74 of 200 rows. The Moshi job now
   runs Job Review's rotary row check (ADR-315 Amendments 1-3) on that grid
   (`detectRotaryRowGridWarnings` with 1/0.0254 positions per mm). Its warning, with the
   intervals that land evenly, is added to the job's advisories, which show from the Frame on.
   The check is a disclosure: the bytes do not change. It models the rows as G-code writes them
   (three decimals, then the step). The Moshi encoder rounds straight to mils, so a row within
   0.0005 mm of a half mil can be counted on the other side.

### Evidence

- `moshi-raster-plan.test.ts` decodes the program bytes. With 2 mm overscan, rows burn exactly
  the dark pixels both ways, while the head still enters 2 mm before the art. A 0.2 mm Dot width
  correction gives 1.6 mm burns inside the art. A 0.3 mm scan offset, from the layer or from the
  machine table, moves each row 0.15 mm along its travel.
- The ADR-705 raster golden (overscan 0) decodes to the same moves as before.
- `moshi-usb-store.test.ts`: a status read that throws on Connect closes the link once.
  `web-usb-link.test.ts`: a failed `selectConfiguration` closes the device and claims nothing.
- `moshi-usb-job-rotary-rows.test.ts`: a 0.1 mm Fill on the 40 mm/turn chuck, Ø80, run through
  the real `prepareMoshiUsbJob`. Its decoded rows share mils, and the job carries the row warning
  naming the 0.1596 mm step. On a flat bed every row has its own mil and nothing warns.
  `rotary-row-step-warnings.test.ts` still passes unchanged.
