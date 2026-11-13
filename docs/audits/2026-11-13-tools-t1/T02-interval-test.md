# T02 Interval Test — auditor report
Tree: origin/main @ 8d92bd143. Command id: `tools.interval-test`.

## Map
- Menu: `src/ui/commands/app-menu-groups.ts:126` → family entry `command-families.ts:265-267` ("Interval Test...") → `IntervalDialog` in `src/ui/commands/CalibrationGridDialogs.tsx:15-35`.
- Dialog: `src/ui/calibration/IntervalTestDialog.tsx` (7 fields, draft persisted in localStorage `laserforge.calibration.intervalTestDraft.v1` on Generate only, `.lftest` presets, feed note). Validation: `calibration-draft-validation.ts` (min / max / exact increments from min).
- Core: `generateIntervalTestGrid` in `src/core/job/interval-test-grid.ts`. One Fill layer per swatch (`hatchSpacingMm` = interpolated interval, six decimals, widest first), one square per swatch, interval labels fitted to the swatch, one effective-speed label, all on a shared calibration-label layer (`calibration-labels.ts`).
- Scene: `replaceSceneWithGeneratedScene` (one Undo step; replaces the design, known T01-P3-2).
- Burn path: `prepareOutput` → `layer-fill.ts` → `fill-hatching.ts` (scanlines on a global grid of multiples of the spacing, floor `MIN_HATCH_SPACING_MM` 0.05) → `emitPreparedGcode` (3-decimal coordinates).
- Governing decisions: ADR-044 (a calibration label names what KerfDesk burns), ADR-497 and Amendment 1 (shared hatch floor, six-decimal values, the Interval Test's label fit), ADR-038 (bidirectional / unidirectional fill), ADR-127 Amd 2 (shared whole-number feed rounding). WORKFLOW.md mentions the tool only at line 5067 (portrait workflow: "use Material Test and Interval Test").
- Changes since 2026-10-16 on these files: `42be8208b` / `c98c7004d` (2026-10-16, October repair: represented-feed labels, six-decimal interval labels), `4fdca81b3` (2026-10-23, ADR-497 Amd 1: hatch floor shared), `ab3226fd1` (2026-11-10, C2-P3-1 shared helpers), `407f83d6a` (2026-11-12, touches a shared calibration file for the box fit ladder). No behaviour change to the Interval Test's output found.

## October register re-check
Row 15 ("repaired represented-feed labels"; register line 116: fractional feeds appear exactly in labels and operation names; interpolated intervals keep six decimals so 0.125 is not labelled 0.13).
- Represented feed: still fixed. Speed 1234.5 → F1234 on every swatch, burned speed label "1234" (`t02-burn.log`). Profile ceiling 1234.9 → layer name "1500 requested / 1234 effective mm/min", burned label "1234" (`t02-dialog.log`). Ceiling 6000 with 9000 requested → F6000, label "6000".
- Six-decimal interval labels: still fixed. Default grid labels 0.20, 0.186667, 0.173333, … 0.08; 0.05–0.12 × 20 labels 0.116316 … 0.053684; every label equals the layer's `hatchSpacingMm` and appears in the layer name.
- The 20-step clamp still holds (21 → 20 swatches).

## Checks run
| Check | Method | Result |
|---|---|---|
| Measured Y step between scan lines per swatch vs label, 27 configurations (default; 0.05–0.12 × 20; reversed, equal, 1 step, 20/21 steps; below floor; huge intervals; 1 mm swatch; NaN/∞ inputs; capped and fractional speed; power 0/100/33.3 at S=255; rear-right and rear-left origin; unidirectional; scan-offset table; layer scan offset; overscan 0; auto overscan; grid origin 3.3,7.7) | Own modal G-code decoder on real `prepareOutput` → `emitPreparedGcode`; lit G1 moves grouped by swatch bounds (`zz-t02/harness.ts`, `t02-burn.test.ts`, log `t02-burn.log`) | Every swatch's mean Y step equals its label to within 0.00001 mm (e.g. 0.133333 → 0.133339 mean); single steps differ from the label only by the 3-decimal coordinate rounding (0.186667 → 0.186/0.187, max phase error 0.0009 mm). All scan lines horizontal and inside the swatch's X span (except the deliberate scan-offset shift, below). One F and one S per swatch equal to the effective feed and power (S300 for 30 % of S1000; S85 for 33.3 % of S255; S1000 for 100 %) |
| Bidirectional scan offset | Forward vs reverse lit X extents (`t02-roundtrip.test.ts`) | Table 0.15 mm @1500: forward rows +0.075, reverse −0.075 (0.15 separation); layer offset 0.3: ±0.15. Y step unchanged (0.200000 / 0.080000). By design (scan-offset.ts) |
| Overscan 0 / 5 mm default / automatic | Same decoder | No lit move outside the swatch's X span in any mode; overscan runs unlit |
| Rotary: chuck 20 mm/rev Ø60 (k 0.1061), roller 40 mm/rev Ø80 obj Ø20 roller (k 0.6366), roller without roller Ø (k 1) | Lit scan lines grouped by machine X, emitted Y step ÷ k = surface step (`t02-rotary.test.ts`, `t02-rotary.log`) | Surface mean step equals the label to within 0.0002 mm on all three (e.g. chuck 0.08 → 0.079968, roller 0.146667 → 0.146666). Line counts unchanged (40 … 100) |
| Save → reopen → G-code | `serializeProject` / `deserializeProject` → emit, 10 and 20 steps | Byte-identical (117,028 and 368,953 bytes); spacings reload exactly |
| Generate / Undo / Redo / Cancel / Escape | Real `IntervalDialog` in jsdom with the real store (`t02-dialog.test.tsx`, `t02-dialog.log`) | One Undo entry; Undo restores the scene exactly; Redo equals the generated scene; Cancel and Escape close with the same project object, no Undo entry, not dirty, no draft written |
| Dialog validation of 14 typed values | Same | See T02-P2-1 and T02-P3-1; steps 21 / 2.5, interval 0.04, speed 1234.5, power 33.3, swatch 6.35 refused with messages |
| Feed note with fractional ceiling | Same | Note says "effective 1,234.9 mm/min"; label and F are 1234 (T02-P3-2) |
| Existing suites (7 files, 31 tests: grid, label bounds, stress, feed, dialog, draft validation, presets) | Vitest on tree | All pass |
| LightBurn reference | docs.lightburnsoftware.com/latest/Reference/IntervalTest/ (2.2 guide) | Speed, Power, Steps, Min/Max Interval (suggests 0.08 and 0.16 mm), Size, Simple Fill or Dithered; text beside each square names its Line Interval; no power/speed label; no stated step limit or interval rounding |

## Findings
### T02-P2-1: The dialog refuses DPI-pitch intervals such as 0.0635, 0.0847, 0.127 and 0.125 mm
- Severity P2: a refusal that should not happen. The core, the burn path, Cut Settings' Line Interval (`step="any"`) and the Material Test's hatch spacing (0.001 increments) all accept these values; only this dialog refuses them. They are the values a user most wants to compare, because they are the line pitches of 400 / 300 / 200 DPI and the line interval they will type into Cut Settings afterwards. No harmful burn results; the user is blocked.
- Where: `src/ui/calibration/IntervalTestDialog.tsx:48-49` (`step: 0.01` for Min and Max interval) with `src/ui/calibration/calibration-draft-validation.ts:22-26` (value must be min + k·step). Compare `src/ui/calibration/material-test-draft.ts:107-115` (0.001) and `src/ui/layers/CutSettingsFillDensityFields.tsx:27` (`step="any"`).
- Repro (ran): `zz-t02/t02-dialog.test.tsx`, log `t02-dialog.log`. Min interval 0.0635 / 0.0847 / 0.0508 and Max interval 0.125 / 0.127 → Generate disabled, alert "Min interval: use increments of 0.01 from 0.05." (resp. Max). 0.07 is accepted. Expected: accepted, as in the two sibling fields.
- Oracle: `generateIntervalTestGrid` accepts any interval ≥ 0.05 and the decoder measured exact burns for six-decimal intervals (0.116316 → mean 0.116316), so nothing downstream needs the 0.01 grid. The October register itself names 0.125 mm as a value labels must keep exactly.
- Suggested fix: `step: 0.001` (match Material Test) or `'any'` for both interval fields; optionally show lines/inch beside them as Cut Settings does.

### T02-P3-1: Max interval has no upper bound; swatches wider-spaced than the swatch burn no lines under their label
- Severity P3: the burn is what the label says (a 10 mm interval cannot fit a line in a 2 mm square), the empty squares are obvious, and no art is harmed; it is an input-domain gap with no warning.
- Where: `IntervalTestDialog.tsx:49` (`max: undefined`), `interval-test-grid.ts:270-272` (`clampInterval` has only a floor). Siblings cap at 10 mm: `material-test-axes.ts:26` (`MAX_TEST_INTERVAL_MM = 10`), `CutSettingsFillDensityFields.tsx:94`.
- Repro (ran): dialog accepts Max interval 20 and 1e9 without an alert (`t02-dialog.log`); 3 steps 3–10 mm on 2 mm swatches burn 0 lines in the "10.00" and "6.50" swatches, 6 mm on 8 mm burns 1 line, 0.9 mm on 1 mm burns 1 line; preflight ok, no warning (`t02-burn.log`).
- Oracle: lines per swatch = ⌈size ÷ interval⌉ on the global scan grid; a reading needs at least two lines.
- Suggested fix: cap Max interval at 10 mm (the shared ceiling) and warn when an interval is more than half the swatch size.

### T02-P3-2: Feed note shows an unfloored "effective" feed under a fractional profile ceiling
- Severity P3: twin of T01-P3-4 / T01R-P3-3 (Material Test) on the Interval Test's own note; labels, layer names and F are correct.
- Where: `IntervalTestDialog.tsx:113` (`Math.min(requested, maxFeed)` instead of `effectiveCalibrationSpeed`).
- Repro (ran): profile `maxFeed` 1234.9 → note "Requested 1,500 mm/min; effective 1,234.9 mm/min … The burned speed label shows effective feed."; burned label and layer name say 1234 (`t02-dialog.log`).
- Oracle: `effectiveGcodeFeedMmPerMin(1234.9)` = 1234; F word emitted is F1234.
- Suggested fix: compute the note through `effectiveCalibrationSpeed` (fix together with T01-P3-4).

## Not a defect / limits
- Per-line Y steps alternate by one emitted thousandth (0.186/0.187 for 0.186667). On a chuck rotary with small mm-per-revolution (k 0.106) one thousandth is 0.0094 mm on the surface, so 0.08 lines alternate 0.0754/0.0848 around a correct mean. Real stepper resolution is coarser than 0.001 mm of emitted Y on such setups, so the G-code rounding is not the limit; not raised.
- Line counts per swatch vary by one with the swatch's phase on the global scan grid (`fill-hatching.ts:130-133`, shared grid avoids seams). Spacing is unaffected.
- Scan offset shifts forward and reverse rows by half the offset each way; this is the shared scan-offset design, not Interval-Test-specific. With no offset table, bidirectional narrow intervals show the machine's lag zipper, as in LightBurn.
- Power 0 is accepted and every swatch burns nothing (S0) while labels still burn: what the field allows, as T01 noted for Material Test.
- Steps 1 with Min ≠ Max burns only the Max interval (linspace starts at the widest); the label names it correctly.
- No power or speed label per swatch: LightBurn's documented test labels only the interval too. One effective-speed label is burned.
- Grid always generated at the scene origin; LightBurn places by Start From / Job Origin. KerfDesk's grid is ordinary art the user can move, and Start From applies at output.
- Known, not re-raised: no unit on the fields and refusal of inch-sized values (T01-P2-1→P3, T01R-P3-1 lists Interval Test's 6 boxes, T01R-P3-2); labels at fixed 20 % / 1500 mm/min (T01-P3-1: the label layer shows "Calibration labels [line 0.1 1500 20]"); Generate replaces the design without notice (T01-P3-2: userArtKept=false). G-code is always mm (G21), so Inches cannot change the burn.
- Not checked: browser run (memory gate met but the jsdom path covers the dialog; not needed for the burn), canvas fill preview vs burn pixel comparison (preview reads the same hatch planner, READ ONLY), physical burn quality.

## Totals
Raised 3; P1 0; P2 1; P3 2; known 5 (T01-P2-1→P3, T01R-P3-1, T01R-P3-2, T01-P3-1, T01-P3-2 apply to this dialog unchanged; T02-P3-2 is a new location of the T01-P3-4 pattern).
