## ADR-257 Amendment 2 - Constant-power fills are advised as images and Line cuts are (2026-10-29)

**Status:** Accepted. | **Date:** 2026-10-29

Amends ADR-257 Amendment 1, Decision 1. `grbl-compatible` keeps M3 for fills, and no dialect
changes its power word. What changes is that a fill relying on that default is now advised before
it is burned, as Amendment 1 already advises images and Line cuts.

### Context

Rolling audit v8 finding N8-P2-5 (raised to P1 by the coordinator, as Q1-P2-1 and Q6-K1 were)
re-measured the #1491 fix and found its Fill half missing.

- GRBL Compatible sets `fillPowerMode: 'constant'` (`src/core/devices/gcode-dialects.ts`), but
  `constantPowerWarnings` built advice for `raster` and `cut` groups only, so Fill groups got none.
- A Scan Line fill sweep is one G1 per ink span and one S0 G1 per gap between spans
  (`grbl-fill-emission.ts`). Small text is therefore the image's case: many short moves, which
  GRBL's 15-block look-ahead holds below the feed, while M3 keeps full power.
- The audit's stand-in for small text, 0.3 mm strokes 0.3 mm apart at 6000 mm/min and 500 mm/s²,
  got 1.46x its dose (1.44x under Automatic overscan). The refuter's own planner model gave 1.462x;
  0.5 mm strokes 1.19x and 1.2 mm strokes 1.05x. M4 kept 1.00x.
- The only notice was the runway advisory at the default 5 mm overscan. It is about row ends, it
  fires the same under M4, and with Automatic overscan it does not fire at all. The dialect's
  description is Machine Setup hover text, not a notice before output.
- Q6 recorded the same gap as Q6-K1 and counted fills as advised because of that runway advisory.

LightBurn's position is unchanged from Amendment 1: GRBL 1.1f and newer use M4 ("Machines using
GRBL 1.1f or later will support the M4 variable power command"), and its Shared Settings page says
"It's generally best to stick with the default of Variable Power mode".

### Decision

1. **Scan Line and island fills** get Amendment 1's image test, measured on the fill's own moves.
   From the start of each burn move the planner sees that move and the next `N - 2`, so the speed
   it can hold there is `v = sqrt(2·a·D)`, where `D` is the length of those `N - 1` moves (ink and
   gaps) and `a` is the saved acceleration along that sweep (`lookAheadSpeedMmPerSec`, the image
   rule's helper, with the window's mean move). Only windows inside one sweep count: a window that
   runs past a sweep's last span reaches its exit runway, and row ends belong to Overscan and its
   advisory (ADR-495). The advice fires when the feed exceeds the slowest window's speed, quotes
   that window's mean move and speed, says small text and thin strokes can burn darker than wider
   areas of the same fill, and gives that speed as the fallback. Sweeps come from
   `planFillSweeps`, the plan that output, Preview and timing share.
2. **Offset fills** burn their rings as contours (`emitOffsetFillGroup`), so they get Amendment 1's
   Line corner advice, worded for a fill. A fill has no Lead-in / Lead-out, so the fallback is to
   lower the speed and test on scrap.
3. **Remedy**, as Amendment 1: on GRBL Compatible, choose GRBL Dynamic if the firmware is GRBL 1.1f
   or newer (grblHAL; FluidNC with a Laser spindle), otherwise lower the speed. Any other dialect
   with constant-power fills would be told to set the operation's Power mode to Dynamic (M4). None
   exists today: GRBL Dynamic, GRBL Raster and Neotronics 4040 Safe all fill with M4. Job Review's
   `$I` sharpening (Amendment 1, Decision 2) applies unchanged.
4. GRBL Compatible's description adds small filled text to what burns darker.
5. As before: GRBL-family output only, an operation set to Constant or Dynamic by hand gets no
   advice, and it is advice only, never a Start guard (ADR-565).

### Consequences

- A GRBL Compatible fill above its look-ahead speed now carries one advisory per operation at Save,
  Start and Job Review, whatever the overscan. At the default 1500 mm/min, 15 blocks at 500 mm/s²
  hold moves averaging 0.045 mm and longer, so ordinary text stays quiet; the advice appears when
  the speed is raised, as the image advice does.
- grblHAL's 100-block planner sees past a whole row of most small text, so such rows stay quiet;
  their ends remain the runway advisory's.
- The model is the saved profile's, not a measurement, and the text says so.

### Verification

- `src/ui/laser/constant-power-warnings.test.ts`: 0.3 mm strokes 0.3 mm apart at 6000 mm/min on
  GRBL Compatible give the advice through `detectJobIntentWarnings` with the default overscan and
  with Automatic overscan (11 mm), holding the rows to 3888 mm/min; none under GRBL Dynamic (either
  overscan) or on the 4040; none at 3800 mm/min, for 1.2 mm strokes or for strokes 2.4 mm apart;
  none for an operation set by hand or on grblHAL's deeper planner; an offset fill gets the corner
  advice without Lead-in / Lead-out, and none under GRBL Dynamic.
- Code and test evidence only. Nothing was burned.
