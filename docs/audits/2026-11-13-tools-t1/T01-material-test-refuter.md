# T01 Material Test — refuter report
Tree: origin/main @ 8d92bd143 (`C:\Users\stolk\kd-t1\t01-main`). Command id: `tools.material-test`.
Own scratch: `C:\Users\stolk\kd-t1\zz-t01r` (script `r01-units.test.tsx`, config `vitest.config.mts`, log `r01-units.log`). The auditor's scripts were read, not run.

Method (different from the auditor's field-label read): render each calibration dialog in jsdom with Settings → Units = Inches, walk the whole DOM (every visible text run outside the field labels, every `title` and `aria-label`, the preview SVG), and run a unit census of every typed box in Material Test, Interval Test, Scan Offset Test, Tone Calibration (wedge step) and Focus Test. Render the layer Speed box beside them as the inch reference. Then type inch-sized numbers into Material Test and record what the dialog echoes back before Generate, what Generate produces, and what the Artwork panel names the layers.

## Verdicts

| Claim | Verdict |
|---|---|
| T01-P2-1 Material Test ignores Inches and shows no unit on any field | **SEVERITY CHANGED, P2 → P3.** The fields carry no unit: confirmed (11 of 11 boxes). Using mm/min and mm is by design (ADR-629 decision 5), not a defect. The missing per-box `mm` label breaks ADR-629 decision 3, but the dialog names the unit next to the values the operator types, in three places. The project has rated the same kind of ADR-629 gap P3 before. |

## Evidence

### 1. Does the dialog state the unit anywhere? Yes, in three visible places. The fields themselves do not.
`r01-units.log`, Material Test section:
- **Field labels, aria and tooltips:** all 11 boxes say no unit (`Min speed`, `Max speed`, `Min power`, `Max power`, `Hatch spacing`, `Cell width`, `Cell height`, `Gap`; the count boxes are Rows, Columns and Passes). Tooltip: `Set min speed for this generated test pattern.` This part of the claim is confirmed.
- **Preview header**, directly under the fields: `↓ Speed (mm/min)` and `→ Power (%)` (`MaterialTestPreview.tsx:213-215`, `material-test-preview.ts:52-55`).
- **Preview note:** `Cells: 5 × 5 mm. Cell proportions shown; spacing is schematic.` (`MaterialTestPreview.tsx:58`).
- **Feed note** (`role="status"`): `Requested 1,000–3,000 mm/min; effective 1,000–3,000 mm/min with the active profile ceiling of 6,000 mm/min.`
- **Every preview cell's hover title** names the unit, for example `Speed 3000 mm/min, power 10%`. So does the preview's `aria-label`.
- After typing the inch-meant values Min speed 40, Max speed 120 and cell 0.5 × 0.5, all of these repeat the numbers with mm units **before Generate**:
  - Feed note: `Requested 40–120 mm/min; effective 40–120 mm/min …`
  - Preview: `rows vary speed from 120 to 40 mm/min … Cells: 0.5 × 0.5 mm`
  - Header: still `↓ Speed (mm/min)`.
- **After Generate**, the Artwork panel's layer names say `Material test 120 requested / 120 effective mm/min`. The same layer's Speed box reads in/min: the reference render shows a stored 1500 mm/min as `59.1` with `in/min 0.99 in/s`. The operator gets one more mm/min cue before Start.
- **Placeholders:** none.
- **Burned card:** cannot carry a unit, because the calibration label font is seven-segment digits only (`calibration-labels.ts`).

### 2. Is "treats typed numbers as mm/min and mm" a defect? No, it is the design.
- `docs/decisions/ADR-629-inch-display-units.md` has no amendments.
- **Decision 5** limits the first increment to the selection boxes, rulers and status bar, Measure, the Machine panel, the laser Speed field and four CNC fields. It continues: "Everything else (dialogs, wizards, Machine Setup, the material library, Job Review) keeps showing millimetres in this increment and says so with its own `mm` label."
- **Decision 3:** "a field that has not moved to the preference yet still honestly says `mm`."
- **WORKFLOW.md F-A6j item 3:** "Every other box keeps its own `mm` label in this first increment."
- WORKFLOW F-A7f (Material Test) and ADR-497 say nothing about units.
- **Conclusion:** calibration dialogs stay metric by design, and every box must say so. The defect is only the missing `mm` / `mm/min` / `%` label on the boxes. The "ignores Inches" half of the title is by design.

### 3. Sibling dialogs and the layer Speed box under Inches: a shared gap in three dialogs

Unit census from `r01-units.log`. Count boxes (Rows, Columns, Steps, Passes, Patches, Samples) are left out.

| Dialog | Boxes that hold a length, speed or power | Without a unit | Where the labels come from |
|---|---|---|---|
| Material Test | 8 | **8**: Min/Max speed, Min/Max power, Hatch spacing, Cell width, Cell height, Gap | `material-test-draft.ts:82-116,199-215` through `CalibrationNumberField.tsx:16-24` |
| Interval Test (T02) | 6 | **6**: Speed, Power, Min interval, Max interval, Swatch size, Gap | `IntervalTestDialog.tsx:45-51` |
| Scan Offset Test (T04) | 8 | **6**: Power, Swatch width, Swatch height, Line interval, Overscan, Gap. Min/Max speed say `(mm/min)` | `ScanOffsetCalibrationDialog.tsx:43-51` |
| Tone Calibration (T03) | 5 | 0: `Patch size (mm)`, `Gap (mm)`, `Power (%)`, `Speed (mm/min)`, `DPI` | `ToneWedgeStep.tsx:21-26` |
| Focus Test (T05) | 7 | 0: every one says `(mm)`, `(mm/min)` or `(%)` | `FocusTestDialog.tsx:27-33` |
| Layer Speed box (reference) | 1 | 0: converts, shows `in/min` and an in/s reading | `LayerSpeedInput.tsx:61-115` |

- The convention exists and two calibration dialogs follow it.
- Material Test, Interval Test and part of Scan Offset do not. **20 boxes** in all lack a unit.
- All three build their boxes from bare label strings. Material Test and Interval Test share `CalibrationNumberField`.
- Interval Test, like Material Test, states mm/min only in its feed note. Its preview is not checked here.

### 4. Severity under AREAS.md

- **P1:** ruled out. The burn matches what the dialog states: the feed note and preview repeat the operator's numbers as mm/min and mm before Generate.
- **P2** ("a wrong result the user is likely to notice … or a missing warning"): not met.
  - Nothing is computed wrongly, and no warning is missing: the unit is stated, just not on each box.
  - A 25.4× slow burn needs an inch operator to read past three adjacent mm/min statements: the header, the feed note and the cell titles.
  - The defaults also hint at the unit: 1000–3000 would be about 25–76 m/min if read as in/min, and the "Use cut starting ranges" tooltip says "60 to 600 mm/min".
- **P3** ("wording … with no defect found behind it"): the defect behind it is wording — the per-box unit ADR-629 decision 3 requires.
- **Precedent for this same ADR clause:**
  - **C8-P3-3** (`docs/audits/2026-10-22-controller-v2/C8-ctl-machine-ui.md:380-404`): bare mm numbers beside an inch DRO, against ADR-629 decision 3. Refuter confirmed it at P3.
  - **U8-P3-4** (`docs/audits/2026-11-03-ux-u1/U8-lightburn-beginner-path.md:286`): "A mm/s recipe is silently read as mm/min, 60× too slow". Kept at P3 because a unit reading sits beside the box.
- **Counter-argument for the coordinator:** ADR-629's Consequences rely on "every box keeps its own unit label" as the guard for mixed screens. Fixed together, these 20 boxes in three dialogs are one fix in two files' label strings.
- **Recommendation:** P3. Sweep it with the T02 and T04 boxes as one item. Fix: append `(mm/min)`, `(mm)` and `(%)` to the labels, as Focus Test and Tone Calibration already do.

## Extra findings

### T01R-P3-1: Unit labels are missing in three calibration dialogs, not only Material Test
- **Severity:** P3, as above. This is the scope note the claim asked for: 20 boxes across Material Test (8), Interval Test (6) and Scan Offset Test (6). Focus Test and Tone Calibration already comply.
- **Where:** `material-test-draft.ts:82-116,199-215`, `IntervalTestDialog.tsx:45-51`, `ScanOffsetCalibrationDialog.tsx:43-51`.
- **Repro:** `zz-t01r/r01-units.test.tsx`, log `r01-units.log` (census table above).
- **Oracle:** ADR-629 decision 3 and decision 5; WORKFLOW F-A6j item 3.
- **Fix:** put the unit in each label string.

### T01R-P3-2: Calibration boxes refuse a typed unit and inch-fraction sizes
- **Severity:** P3. The refusal is visible and has a workaround. A twin of the known L2-P3-5 pattern (Design Studio boxes dropping `1/8in`), on a different surface.
- **Where:**
  - `CalibrationNumberField.tsx:19` is `type="number"`.
  - `calibration-draft-validation.ts:22-26` enforces exact steps.
  - `material-test-draft.ts:88-90` sets cell and gap step to 0.1 mm.
- **Repro** (`r01-units.log`):
  - Cell width `0.25in` → input value `""` → `Cell width: enter a number.`
  - Cell width `6.35` (¼ in) → `Cell width: use increments of 0.1 from 0.1.`
  - Gap `3.175` (⅛ in) → `Gap: use increments of 0.1 from 0.`
- **Oracle:**
  - ADR-629 context: typing `1in` or `3/4"` works in numeric boxes (LBG-F12), and decision 3 says a typed unit always wins.
  - The core accepts any positive cell size: the auditor generated 0.5 mm cells.
  - `CalibrationNumberField`'s own comment says free-form mm fields should use `step: 'any'`, as Tone Calibration does.
- **Fix:** use `step: 'any'` for cell, gap and swatch sizes. Later, parse through `dimensionEntry` so `0.25in` enters 6.35 mm.

### T01R-P3-3: A speed range above the ceiling burns duplicate rows; auditor's T01-P3-4 now reproduced
- **Severity:** P3. The feed note discloses the effective range, and the preview shows the repeated labels.
- **Where:** `MaterialTestDialog.tsx:205-206` (unfloored note); axis values are capped after spacing (`material-test-axes.ts`).
- **Repro** (`r01-units.log`, last section): ceiling 1234.9 with speeds 1000–3000 over 10 rows.
  - Feed note: `effective 1,000–1,234.9 mm/min`.
  - Preview row labels, which are the burned values: `1234,1234,1234,1234,1234,1234,1234,1234,1222,1000`.
  - So the auditor's READ ONLY T01-P3-4 (note says 1,234.9, card burns 1234) is now **reproduced**.
  - Also, 8 of 10 rows burn identical settings with no explicit warning. Scan Offset Test, by contrast, warns "exceeds the profile ceiling … will use the effective capped feed" (`ScanOffsetCalibrationDialog.tsx:246`).
- **Oracle:** `effectiveGcodeFeedMmPerMin(1234.9)` = 1234; evenly spaced 1000…3000 over 10 rows puts 8 above the ceiling.
- **Fix:**
  - Floor the note through `effectiveCalibrationSpeed`.
  - Either warn when two or more rows collapse to the ceiling, or spread the axis over the effective range.

## Totals
Verdicts: T01-P2-1 SEVERITY CHANGED P2 → P3. Extra raised 3: P1 0, P2 0, P3 3 (T01R-P3-3 also reproduces auditor T01-P3-4); known 0. T01R-P3-2 is a twin of L2-P3-5's pattern on a different surface.
