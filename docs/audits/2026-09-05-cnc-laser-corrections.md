# CNC and laser change-audit corrections

Scope: four authorized corrective findings, implemented from exact main
`c7681e3af152ed4c1162ef20ae45793552fd1503` in isolated branch
`codex/cnc-laser-audit-fixes-20260905`. Original and prior audit worktrees are not implementation
targets. Astra implementation/review evidence is distinct from physical qualification.

## Corrections

| Finding | Correction | Acceptance evidence |
|---|---|---|
| Marlin fan image output could saturate a compiled half-power raster | Convert original compiled raster S units to 255 fan units lazily, preserving vector percentage precision and original provider storage | Public black image at S maxima 255/1000/100 emits half duty; zero/partial/full, inline, Line/Fill, and repeated/provider ordering tests |
| Inward CNC leads could cross retained nested islands | Include opposite-winding descendants in lead obstacle clearance; retain existing ordinary-entry fallback | Shallow and deep-tab regressions, translated/reversed geometry, unchanged clear leads and rough/finish contours |
| LightBurn Scan overscan enable switch was mistaken for a percentage | Read `overscan` boolean independently from `overscanPercent`; resolve percentage times imported mm/s to fixed mm | Export-shaped XML, decimal/disabled/zero/incomplete data and import-to-compiled-setting tests |
| Diagnostics and assisted measurement conversion were not reachable in production setup | Mount diagnostics in the Options/calibration wizard with draft-bound updates; invalidate measurements on owner changes | Actual dialog-host Save/Cancel/Undo/New/Open tests, head/controller/bed changes, cosmetic rename and precision preservation |

Red-first checks reproduced the Marlin saturation, six nested-island failures, nine LightBurn
mapping failures, and nine UI reachability/ownership failures before the corresponding fixes.
The independent UI pass additionally caught collapse/reopen data loss; the editor now mounts
lazily once and retains unapplied measurements when its disclosure closes.

## Operator workflow

Machine Setup → Options & calibration → Raster scan-offset calibration → Raster Diagnostics and
assisted conversion. This shows effective scan diagnostics and local override notices for the
setup draft. All Apply and provenance actions remain local until final Save; Cancel discards them.
The saved setup change is undoable. New/Open initializes a new wizard draft even for an identical
profile. Cosmetic names/notes do not discard measurements. Save before generating verification.

## Boundaries that remain

- No controller connection, firmware write, spindle/laser action, installer execution, or physical
  coupon is part of this correction. The reported physical circle drift and bidirectional
  misalignment are **not proved solved** by these software regressions.
- CNC coverage demonstrates retained-island collision fallback, not exhaustive nested topology or
  cutter clearance on every machine. Existing parent-containment behavior remains unchanged.
- LightBurn import now stores the correct setting; the existing generic emitted-runway policy
  still substitutes its minimum for zero and bounds larger distances. Thus stored/compiled zero
  or 10 mm does not prove emitted zero or 10 mm. No complete LightBurn motion-parity claim is made.
- LightBurn Initial Offset and `.lbso` import are not represented by the assisted converter.
  Sign, absolute placement, and raster/vector alignment still require an operator coupon.
- No new Start, Frame, import, preview, or output guard is introduced. Existing fallback and
  calibration validation policy are not widened.

## Verification and publication

Focused tests and independent Astra reviews passed before combined release validation. Exact
full-gate counts, browser screenshots, PR-head checks and merge identity belong to the PR evidence
and final completion report, so this source record cannot become stale by claiming a future merge.

Primary semantics checked during remediation:

- [Marlin M106](https://marlinfw.org/docs/gcode/M106.html): 0–255 fan duty, 128 approximately half.
- [LightBurn cut-setting field types](https://forum.lightburnsoftware.com/t/could-i-get-some-input-on-the-parameter-types-for-the-project-file-cut-settings-attributes/12911): enable boolean and percentage float are separate.
- [LightBurn overscanning](https://docs.lightburnsoftware.com/2.0/Explainers/Overscanning/): distance depends on speed and percentage.
