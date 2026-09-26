## ADR-450 - Diagonal contacts: the turn policy gets a Trace dialog control (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

This extends ADR-403 (filled traces resolve diagonal pixel contacts with one shared turn policy),
which added `TraceOptions.turnPolicy` with no UI, and ADR-408 (trace settings travel with the
trace). Clean-room constraint (ADR-120, ADR-123) unchanged: Potrace's documented behaviour (its man
page's `-z` turn policies) was the reference; no tracer source was read.

### Context

Where two ink pixels touch only at a corner (a checkerboard contact), a bitmap cannot say whether
the ink or the paper passes through that corner. ADR-403 made the answer one shared decision with
three values, `'auto'` (default; the locally thin colour keeps its diagonal), `'connect-ink'` and
`'connect-paper'` (the historical rule), but nothing in `src/ui` set it. LightBurn exposes the same
choice as "Turn policy" and Potrace as `-z`, so an operator tracing halftones, pixel art or
corner-kissing shapes had no way to override Auto.

### Decision

1. **Control.** The filled-contour presets (Line Art, Smooth, Sharp) show a "Diagonal contacts"
   select in the Trace dialog's advanced Curve finishing section, after Smoothness and Optimize:
   Auto (`'auto'`), Join ink (`'connect-ink'`), Split ink (`'connect-paper'`). Its help text,
   linked with `aria-describedby`, says in plain language what each choice does where two ink
   pixels touch only at a corner. Centerline, Edge Detection, Photo shading and Colour layers
   ignore the policy (ADR-403), so they do not show it. The control lives in its own component,
   `DiagonalContactsControl.tsx`; `TraceSettingsControls.tsx` gains two lines, so the in-flight
   ADR-445 follow-up in that file merges cleanly.
2. **Override.** The choice is an ordinary dialog override, `turnPolicy` in
   `LightBurnTraceSettingOverrides`, merged into the preset's options by
   `mergeLightBurnTraceSettings`. Like the other line-preset overrides it survives preset switches
   (hidden but kept while a preset that ignores it is selected), marks the settings as edited, and
   Reset trace settings clears it back to the preset (Auto).
3. **Re-trace record.** `TRACE_OVERRIDE_RULES` persists `turnPolicy` as a choice of the three
   values. A record written before this decision has no key and restores as Auto, exactly as
   before; an unknown value (a hand edit, or a later build's policy) is dropped, which is also Auto.
   No schema version change: the record already keeps only the overrides it knows.
4. **Multi-File Trace** traces every file with a preset's options and has no override map, so it
   keeps Auto. Giving it per-batch overrides is a separate change (and `claude/tl-multifile-dpi`
   is editing that dialog).
5. **No 'majority' policy.** Potrace documents a majority policy (connect the colour that is more
   common near the corner). It was evaluated as our own 4x4-source-pixel window rule (the same
   window as Auto, the majority colour joins, ties split ink) against Auto, Join ink and Split ink
   on synthetic 300x300 binary fixtures, traced end to end in all three presets; outlines and IoU
   against the input mask:

   | Fixture | Preset | Auto | Join ink | Split ink | Majority |
   |---|---|---|---|---|---|
   | 1-px checkerboard patch | Line Art | 2, 0.050 | 1, 0.510 | 0, 0.000 | 0, 0.000 |
   | 2-px checkerboard patch | Line Art | 1,250, 1.000 | 1,153, 0.981 | 1,250, 1.000 | 1,250, 1.000 |
   | Squares kissing at a corner | Smooth | 2, 0.972 | 1, 1.000 | 2, 0.972 | 2, 0.972 |
   | Halftone dot gradient | Line Art | 1,992, 0.984 | 1,930, 0.963 | 1,930, 0.963 | 1,930, 0.963 |
   | Halftone dot gradient | Smooth | 1,992, 0.984 | 1,090, 0.910 | 1,080, 0.907 | 1,090, 0.910 |
   | Bayer 4x4 dither gradient | Line Art | 2,611, 0.703 | 1,264, 0.679 | 301, 0.591 | 1, 0.589 |
   | Bayer 4x4 dither gradient | Smooth | 2,611, 0.703 | 1,264, 0.685 | 301, 0.592 | 159, 0.595 |
   | 1-px 45° hairline | Line Art | 1, 1.000 | 1, 1.000 | 0, 0.000 | 0, 0.000 |
   | 1-px 45° hairline | Sharp | 1, 1.000 | 1, 1.000 | 100, 1.000 | 100, 1.000 |
   | Hairline into a block corner | Sharp | 1, 1.000 | 1, 1.000 | 81, 1.000 | 81, 1.000 |
   | 1-px paper crack in a block | Line Art | 2, 0.999 | 1, 0.997 | 1, 0.997 | 1, 0.997 |
   | 1-px paper crack in a block | Sharp | 2, 1.000 | 121, 1.000 | 2, 1.000 | 121, 1.000 |

   In no row (all 24 fixture-preset cells were measured; the rest agree) does majority beat the
   best of Auto, Join ink and Split ink; it is never better than Auto on IoU, it reproduces the
   hairline defect ADR-403 fixed (a 1-px diagonal becomes 100 dots in Sharp and vanishes in Line
   Art), welds a crack shut, and collapses a dither to one outline. It is not added. Potrace's
   left, right and random policies are test policies (a fixed turn, or noise) with no operator
   use: skipped. The black and white policies are Join ink and Split ink.

### Consequences

- An operator can force the answer ADR-403's Auto gives only by local evidence: Join ink welds
  corner-kissing shapes into one outline (two squares touching at a corner trace as one), Split
  ink restores the pre-ADR-403 rule (a 1-px diagonal breaks into dots). Auto is still the default
  and nothing changes for a trace that never touches the control.
- Tests: `DiagonalContactsControl.test.tsx` (label, options, help text, focus, which presets show
  it, the choice reaching the engine and changing a corner-contact trace from 2 outlines to 1 and
  back, preset switching, Reset, record round trip, older and unknown records) and
  `ImportImageDialog.diagonal-contacts.test.tsx` (commit, save, load, Re-trace Original reopens on
  the chosen policy; a trace recorded before the control reopens on Auto and previews without a
  policy). `e2e/tracer-ui.spec.ts` changes the select from the keyboard and checks Reset.
- Remaining gap: the 1-px checkerboard patch row above. No policy traces a fine checkerboard
  faithfully (Auto keeps only the rim, Join ink welds it solid); that is a finishing limit of the
  contour tail, not a turn-policy choice.
