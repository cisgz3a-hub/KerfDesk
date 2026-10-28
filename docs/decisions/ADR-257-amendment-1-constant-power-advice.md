## ADR-257 Amendment 1 - Constant-power output says what it does to the burn (2026-10-28)

**Status:** Accepted. | **Date:** 2026-10-28

Amends ADR-257's two exclusions. `grbl-compatible` keeps M3 for cuts, fills and images, and
`neotronics-4040-safe` keeps M3 for Line cuts pending its hardware pass. Neither power word
changes. What changes is that output relying on them is now advised before it is burned.

### Context

Quality audit Q1 (2026-10-28) found that under the default dynamic power (M4) both rasters and
vectors burn at 0.99-1.00x the intended dose, but the constant-power (M3) dialects over-dose with
no advice. Auditors and independent refuters confirmed both with their own GRBL planner models on
the emitted bytes.

- **Q1-P2-1 (P1).** GRBL Compatible burns images with M3, which ADR-257 never recorded: it
  discussed cuts only. A dithered row is about one G1 per pixel. Stock 8-bit GRBL plans 15 blocks
  and must be able to stop inside them (planner.h, planner.c), so at 500 mm/s² it holds 0.1 mm
  moves to about 37 mm/s. At 6000 mm/min a photo then gets about 1.8x its dose and a 50% dither
  row 2.6x, while the Preview shows the intended tones. M4 keeps 0.99x.
- **Q6-P2-1 (P2).** The 4040 and GRBL Compatible burn Line cuts with M3. At the default
  1500 mm/min, 90° corners got 3.4x the line dose, logo corners a median of 3.1x, 3 mm text 1.5x
  overall, and path ends 1.6-5.3x. M4 kept 1.19-1.30x. ADR-239 Amendment 2 adds the 4040's exit;
  corners remain.
- Job Review said only "each contour starts burning from rest", and the dialect description
  promised constant power for "vector cuts" only. It was not shown anywhere.

What LightBurn does, which the maintainer's standing rule says to copy:

- Its GRBL configuration guide (2.1): "Machines using GRBL 1.1f or later will support the M4
  variable power command"; "GRBL 1.1e or older ... must use the GRBL-M3 device". Without variable
  power, it says, corners get over-burnt while long straight lines end up lighter.
- Its Shared Settings page (2.0): "It's generally best to stick with the default of Variable
  Power mode"; Constant Power is an opt-in.
- GRBL's own changelog adds M4 in 1.1e and first allows it on builds that drive enable from the
  spindle-direction pin in 1.1f. ADR-257's "1.1e and older, where M4 does not exist" is therefore
  approximate; LightBurn's 1.1f line is the one followed here.

### Decision

1. `constantPowerWarnings` (`src/ui/laser/constant-power-warnings.ts`) joins the job-intent
   advisories, so Save, Start and Job Review show it. It covers GRBL-family output (GRBL, grblHAL,
   FluidNC) where the dialect's default, not an operation the operator set to Constant by hand,
   burns with M3:
   - **Images:** when the feed exceeds what the look-ahead sustains for one move per pixel,
     `v = sqrt(2·a·(N-1)·pixel)` with the saved acceleration along the scan and the controller
     family's planner depth (ADR-525's model and defaults: GRBL 15, grblHAL 100, FluidNC 15), it
     says dithered and shaded areas can burn darker than the Preview and gives that speed.
   - **Line cuts:** it gives GRBL's square-corner junction speed from the saved acceleration and
     junction deviation, `v = sqrt(a·δ·(2+√2))`, against the line speed, and names what burns
     darker: corners, plus path starts and ends where no runway covers them (none on GRBL
     Compatible; skipped on the 4040 when the bed position is unknown, which it then explains).
   - **Remedy, as LightBurn:** on GRBL Compatible, choose GRBL Dynamic in Machine Setup if the
     firmware is GRBL 1.1f or newer (grblHAL; FluidNC with a Laser spindle), otherwise lower the
     speed (images: to the computed speed; lines: or move the ends off the part with Lead-in /
     Lead-out). On the 4040, set the Line operation's Power mode to Dynamic (M4), its fills and
     images already run M4 on that firmware, or lower the speed.
2. Job Review sharpens it with the controller's own `$I` version when one is current for this
   session: 1.1f or newer names the switch; 1.1e or older says to keep constant power and lower the
   speed (LightBurn's GRBL-M3 rule).
3. GRBL Compatible's description says it burns cuts, fills and images with M3 and what that does,
   and Machine Setup shows each dialect's description as the option's hover text.
4. Advice only, never a Start guard (ADR-565). No dialect changes power word.

### Consequences

- GRBL Compatible image jobs above the look-ahead speed, every GRBL Compatible Line cut and every
  4040 Line cut on its default Power mode now carry one advisory per operation.
- The model is the saved profile's, not a measurement: a controller with more acceleration, a
  deeper planner or longer runs of equal pixels burns closer to 1x than the advice says. The text
  says so, as the runway advisory does.

### Verification

- `src/ui/laser/constant-power-warnings.test.ts`: the audit's 37.4 mm/s and 4.13 mm/s; advice for
  GRBL Compatible images (not below the look-ahead speed), GRBL Compatible and 4040 Line cuts, the
  skipped-runway wording; none for GRBL Dynamic, GRBL Raster, 4040 images, an operation set by
  hand, CNC, Marlin or Smoothieware; it reaches `detectJobIntentWarnings`.
- `src/ui/laser/job-review/constant-power-firmware-warnings.test.ts`: 1.1h and 1.1f, the 4040
  remedy, 1.1e, and no line without current `$I` or without advice.
- Code and test evidence only. Nothing was burned.
