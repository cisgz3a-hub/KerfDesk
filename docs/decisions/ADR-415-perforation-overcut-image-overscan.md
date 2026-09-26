## ADR-415 - Perforation, overcut and per-operation image overscan, LightBurn gap batch 4 (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

Builds LBG-C01, LBG-C02 and LBG-C03 from `docs/audits/2026-09-26-lightburn-gap-audit.md`. Amends the
fixed image overscan of ADR-020 and the last consequence of ADR-238 Amendment 2. Laser only: the CNC
compiler never reads these settings and the CNC inspector never shows them (ADR-101).

### Context

The maintainer asked to "build all from the gap and make better than lightburn". LightBurn's Cut
Settings Editor, read on 2026-09-26:

- **Perforation Mode** (`Reference/CutSettingsEditor/LineMode/`): "specify a distance to Cut,
  followed by a distance to Skip", in millimetres, for tear-off parts and fold lines.
- **Overcut** (same page): "extend a cut by a specified amount past the end of closed shapes", on the
  final pass, so the seam where the beam started and stopped is cut through.
- **Overscanning** (`Reference/CutSettingsEditor/ImageMode/`): a switch plus a size "calculated as a
  percentage of Speed".

KerfDesk had none of the three. Every image engraved with a fixed 5 mm run-up (`DEFAULT_OVERSCAN_MM`,
ADR-020), which is too short for a fast head (100 mm/s at 500 mm/s² needs 10 mm) and wasteful on a
slow one.

### Decision

1. **Five optional operation settings.** `perforationEnabled`, `perforationCutMm`,
   `perforationSkipMm`, `overcutMm` and `imageOverscanMm` join `LayerOperationSettings`, artwork
   overrides and sub-operations. Absent means off (perforation, overcut) or 5 mm (image overscan),
   which compiles byte-identically to the output before them. They are captured only when set, so
   saved process recipes written before them still match their key set. Copy and Paste settings
   carries them and clears them when the copied operation never set them. Material presets do not
   store them: perforation and overcut are design choices, and applying a preset keeps whatever the
   operation has. Cut Settings shows them; the material wizard does not.
2. **Perforation** splits every Line path into dashes of the cut length separated by gaps of the
   skip length, measured along the path from its start (`core/geometry/perforation.ts`).
   - It runs after kerf and tabs, so tab gaps stay gaps and the kerf-offset path is what gets dashed.
   - Better than a plain repeating pattern: every dash is at most the cut length and every gap at
     least the skip length. On a closed shape the pattern stops a full gap short of the start point,
     so the last dash never joins the first across the seam into a longer cut. A shape too short to
     hold one gap is left uncut, as tabs already leave a shape they would swallow.
   - Dashes are ordinary open segments, so GRBL, Marlin, Smoothieware, Ruida, Preview, Frame bounds
     and the time estimate need no change. On the 4040-safe profile each dash gets the ADR-239
     laser-off entry like any other contour, which is what keeps short dashes evenly burned.
3. **Overcut** runs a closed contour on past its start for the overcut distance on the **final pass
   only**, retracing its own first edges (`core/geometry/overcut.ts`). An overcut longer than the
   shape goes round once more and no further. The compiled group records `finalPassOvercutMm`; the
   G-code emitter, the Ruida motion plan and the preview route all take the final pass's segments
   from one helper (`core/job/cut-pass-segments.ts`), so they cannot disagree. Earlier passes are
   unchanged, so a multi-pass cut does not burn the seam region twice per pass. Shapes opened by tabs
   or perforation are not overcut. The group comment says `overcut N mm on final pass`.
4. **Image overscan** is set per operation (and per artwork override), 0 to 25 mm, the same ceiling
   as Scan Line fill (ADR-238 Amendment 3). Preflight's allowance for marked laser-off runs uses the
   largest overscan an output image actually gets. Better than LightBurn's percentage: the field
   shows the run-up this machine needs to reach the operation's speed, `v² / 2a` from the profile's
   acceleration, and says when that is more than 25 mm.
5. **Project schema 10.** An older build would ignore perforation and cut straight through, so the
   version rises as the precedent in `migrations.ts` requires. The 9 → 10 step changes nothing.

### Alternatives

- **Perforation as laser-off `G1 S0` moves inside one segment.** Rejected: no output format carries
  per-point power, so every emitter, the estimator and Ruida would need a new segment shape, and
  preflight flags blank G1 moves over 5 mm.
- **Overcut on every pass.** Rejected: the seam region would burn twice per pass. LightBurn applies
  it on the final pass, and so does this.
- **Split a multi-pass group into "all but last" and "last with overcut" at compile time.**
  Rejected: path optimisation would reorder the final pass from the previous pass's end, re-cutting
  the last shape immediately, and the G-code would read "pass 1 of 1" for the final pass.
- **Reuse `fillOverscanMm` for images.** Rejected: it already serves Fill and the Line contour entry
  and defaults vary per project, so existing image output would change.
- **Store the new settings in material presets.** Deferred: the preset format, its wizard and linked
  binding drift checks would all grow for settings that describe the design rather than the
  material.

### Consequences

- Output changes only for operations that turn a setting on, so no snapshot changes.
- Saved projects are schema 10; older KerfDesk builds refuse them with the existing "newer version"
  message.
- Perforated shapes compile to open dashes, so inside-first ordering no longer holds them back for
  their inner shapes, as with tabs. A perforated part stays attached, so nothing falls early.
- LightBurn `.lbrn` and `.clb` imports do not map LightBurn's perforation, overcut or image
  overscan fields yet.

### Verification

- `src/core/geometry/perforation.test.ts` and `overcut.test.ts`: dash lengths, the seam gap, vertices
  kept, degenerate input, retrace round corners, the one-loop limit.
- `src/core/job/line-cut-extras.test.ts`: byte-identical output when off, dashes after tabs, overcut on
  the final pass only in G-code, and the same overcut in Preview and the Ruida plan.
- `src/core/job/image-overscan.test.ts`: default 5 mm byte-identical, the 25 mm cap, artwork
  overrides, the preflight allowance, the run-up formula.
- `src/io/project/project-cut-extras.test.ts`: project round trip with overrides, invalid values
  rejected, schema 9 migration, recipe key sets, a perforated process recipe round trip.
- `src/ui/layers/CutSettingsDialog.cut-extras.test.tsx`, `src/ui/state/layer-settings-clipboard.test.ts`
  and `src/ui/laser/job-review/job-review-detail-facts.test.ts`: the fields apply, stored uneven values
  never block Apply, paste clears unset values, Job Review shows what is set.
