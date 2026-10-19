## ADR-629 - Show and enter lengths in inches

**Status:** Accepted by the maintainer's explicit instruction on 2026-10-18 ("inch display"). Clarifies PROJECT.md non-negotiable 6 (Units honest) and replaces the "Inch display units" deliberate difference in the LightBurn gap audit.

## Context

Every length in KerfDesk is shown in millimetres and every speed in mm/min. Typing `1in` or `3/4"` already works in the numeric boxes (LBG-F12), but the answer comes back in millimetres. Many of the machines the README names (Shapeoko, X-Carve, Onefinity, LongMill) are sold in the United States, where operators measure stock in inches, buy ¼" and ⅛" bits and quote feeds in inches per minute. LightBurn has a units switch; KerfDesk has none.

Non-negotiable 6 says the internal model is millimetres and inches are accepted only at the import boundary through an explicit conversion. Its purpose is to keep one unit inside the pipeline so nothing is converted twice or rounded by accident. A display preference does not touch the pipeline: it converts at the edge of the screen, the way a typed `1in` already does.

## Decision

1. **One preference.** **Settings → Units** offers **Millimetres** (the default) and **Inches**. It is a per-computer preference saved with the other workspace settings, not part of the project. Changing it never changes the project, the undo history or the output.
2. **The model stays in millimetres.** Projects, machine profiles, libraries, G-code (`G21`) and every core calculation keep millimetres. The conversion `1 in = 25.4 mm` happens only where a number is shown or typed. Non-negotiable 6 reads: the internal model is mm; inches are converted explicitly at the import boundary or at the display boundary, never inside the pipeline.
3. **What changes with Inches.** Lengths show in inches (`in`) and feeds in inches per minute (`in/min`). Values show up to four decimals, trailing zeros removed. A box shows the unit it is using next to it, so a field that has not moved to the preference yet still honestly says `mm`. A typed unit always wins: `10mm` in an inch box enters ten millimetres.
4. **No drift.** Showing a value in inches never writes it back. Only a value the operator types and commits is converted, once, from what they typed. Leaving a box without editing it, or switching units, leaves the stored millimetres untouched.
5. **First increment.** The surfaces operators use on every job:
   - the selection **X / Y / Width / Height** boxes,
   - the rulers, the cursor position in the status bar, and the hover size readout,
   - the Measure tool readout,
   - the Machine panel's position readout and jog step,
   - the laser operation **Speed** and the CNC operation **Cut depth**, **Depth per pass**, **Feed** and **Plunge** fields.

   Everything else (dialogs, wizards, Machine Setup, the material library, Job Review) keeps showing millimetres in this increment and says so with its own `mm` label. Later increments move them one surface at a time, with the same rules.

## Consequences

- An inch operator sees inches where they work most, and never sees a wrong unit label.
- Mixed screens are possible during the rollout, which is why every box keeps its own unit label.
- No G-code, Frame, Start, project format or controller behaviour changes. A G-code file still uses `G21` millimetres.

## Verification

Unit tests cover the conversion and formatting helpers (round trips, four-decimal display, negative and zero values, typed unit suffixes overriding the preference), and that showing a value or switching units commits nothing. Component tests cover the transform boxes, the speed and CNC fields, the status bar (bed and selection) and the Machine panel's position and origin readout in both units, and the rulers' inch steps. A unit test of the display-units store covers the preference's storage and its default; the Settings control itself has no component test.
