# T07 Close Open Fill Contours — auditor report
Tree: origin/main @ 856cb3ae1. Command id: `tools.close-open-fill-contours`.

## Map
- Menu: Tools → Fill repair → **Close Open Fill Contours** (`src/ui/commands/fill-repair-commands.ts:16`). Enabled when `openFill.closeableCount > 0` (`src/ui/commands/use-app-commands.ts:169`, counts from `selectedOpenFillContourCounts`, `src/ui/common/fill-diagnostics.ts`). Disabled reason: "Select open Fill contours with endpoints within 0.5 mm." No dialog; runs `app.closeSelectedOpenFillContours` (`src/ui/commands/tool-command-context.ts:120`).
- Handler: `src/ui/state/close-open-fill-contours-actions.ts` → `openFillContours(scene, selected)` (`src/core/job/open-fill-contours.ts:41`) picks paths that use an enabled output Fill operation after `effectiveOperationForObject` (object overrides, sub-operations, path-level operation ids) and finds open canonical contours (curves flattened with `compilationPolylines`). Eligibility `isCloseableOpenFillPolyline`: ≥3 points, ends not within `CLOSURE_EPS_MM` (1e-4 mm), world gap after `applyTransform` ≤ 0.5 mm (inclusive). Closing: `closeOpenPaths` (`src/core/geometry/path-direction-edits.ts:48`) adds one straight line from the last point to the first on both the curve and its paired compatibility polyline; pen shapes are re-synced via `synchronizePolylineShapeGeometry`. Locked objects, boolean compounds and curve/polyline count mismatches are skipped. One undo step (`pushUndo`), none when nothing changes.
- Governing: ADR-480 decision 6 and Amendment 1 (tolerance Fill closure edits canonical geometry); WORKFLOW.md "Open Fill contours omitted" (around line 4973). LightBurn parity: Close Path (0.5 mm).
- Changes since 2026-10-16 on these files: `ab3226fd1` (shared helpers, C2-P3-1), `7449c6362` (one-scan menu counts, S2-P3-3), plus Leave White Unburned edits to `fill-repair-commands.ts` (`6af46c61a`, `7e67e13e4`, PR #1617). The closing logic is unchanged.

## October register re-check
Row #54 ("eligible Fill contours and world gap"; vector audit line 104: only selected qualifying Fill contours, finite positive tolerance, canonical/transform seams).
- World-frame gap: **still fixed.** Script A: local 0.3 mm gap with scaleY 3 (world 0.9) is refused; local 1.6 mm with scale 0.25 (world 0.4) closes; gap along X with scale 2×0.5 (local 0.3, world 0.6) is refused while the same local gap along Y would close. Rotated 37° + mirrored + 2×0.5 closes and fills 200.008 mm² vs oracle 200.000.
- Only selected, unlocked, Fill contours: **still fixed** (script D: unselected object identical by reference; locked gives closeable 0; Line-only path in the same object unchanged, script B "mixed object").
- Exact Undo restored eligibility: **still fixed** (script D, serialized project and G-code identical after Undo; Redo identical; second run adds no undo step).
- Existing suite: 6 files / 32 tests pass (`close-open-fill-contours-actions`, `-curves`, command test, `open-fill-contours`, its boolean integration test, `close-path-preserve-geometry`).

## Checks run
Script: `C:\Users\stolk\kd-t1\zz-t07\t07-burn.test.ts` (real store action → `prepareOutput` → `emitPreparedGcode` → decoded lit moves; area oracle is an independent scanline grid on the world polygon, `zz-t07\decode.ts` from T06). Log: `C:\Users\stolk\kd-t1\zz-t07\t07-burn.log`.

| Check | Method | Result |
|---|---|---|
| Gap 0.3 / 0.5 / 0.6 mm, identity | script A, hatch area vs grid oracle | 0.3 and 0.5 close (200.000 = 200.000 mm²); 0.6 refused, no undo |
| Gap in world frame under scale, non-uniform scale, rotate+mirror | script A | correct in every case (see register re-check) |
| Gap 1e-5 (already closed enough) / 2e-4 | script A | 1e-5 not counted, fills before; 2e-4 counted and closed, area exact |
| Closing segment = straight join of the two ends | read + script C | appended `{kind:'line', to: start}`; no other ends ever joined |
| Curves keep exact shape | script C/G (4-cubic open circle R10, ×1.5, rot 15°) | original cubic segments byte-identical, one closing line appended; G-code byte-identical to the same shape authored closed |
| Filled area of curved result | script C/G | 705.557 mm² vs dense-cubic grid 707.056 (same 0.2 % for the authored-closed control, so it is the Fill engine's sampling, not this tool) |
| Self-crossing (open bowtie), closing line crossing an edge, out-and-back sliver, 0.8 mm contour | script E | areas match even-odd oracle (300.000/300.000, 98.025/98.020, 0.640/0.640; sliver 2.5 vs 3.0 is row sampling of a 0.2 mm sliver) |
| Path shared by Fill and Line | script B | cut changes too: see T07-P3-1 |
| Mixed object (Fill path + Line path) | script B | only the Fill path closes |
| Object override turns Line op into Fill | script B | counted and closeable (1/1) |
| Output-off Fill op | script D | not counted (0) |
| Undo / Redo / save-reopen | script D (rot 33°, 1.3×0.7, mirrorX) | exact; G-code identical after reopen |
| Pen (polyline) shape | script F | closes, but node count grows: T07-P3-2 |
| Unrepairable shapes (two-subpath pen shape) | script F | open 2, closeable 0 → command disabled with a misleading reason: T07-P3-3 |
| Text object | script F | pre-rendered glyph paths close (READ: re-rendering the text later rebuilds from the font and drops the closure) |
| Result feedback | read `close-open-fill-contours-actions.ts`, `path-cleanup-actions.ts:55` | silent: T07-P3-4 |
| LightBurn reference | docs: Close Path (ends within 0.5 mm), Close Selected Paths with Tolerance (adds a line between the ends or moves them together); Fill needs closed loops | KerfDesk matches: 0.5 mm, straight join, larger gaps through the tolerance tool (T08) |

## Findings

### T07-P3-1: Closing a Fill contour also changes the Line cut on the same path (closing segment, kerf offset and tabs now apply) without saying so
- Severity: P3. The change follows the user's own Line settings for a now-closed shape, as LightBurn's Close Path would; but the tool and its tooltip ("Close selected Fill contours…", "Close selected near-closed Fill contours") speak only of Fill, and nothing warns that the cut moves. Harm only where an open cut gap was deliberate (a hold-in bridge).
- Where: `src/ui/state/close-open-fill-contours-actions.ts:99-120` edits the shared `ColoredPath`; `src/ui/help/command-help-topics.ts:210-213`.
- Repro: script B. Object on ops [Fill, Line], 20×10 open square, gap 0.4 mm. Line kerf 0, no tabs: cut 59.600 mm → 60.000 mm (closing segment added). Kerf 0.2: cut box [100,100]-[120,110] → [99.8,99.8]-[120.2,110.2] (now offset outward 0.2 mm). Tabs on (4 × 1 mm): cut 59.6 mm in 4 moves → 56.0 mm in 9 moves.
- Oracle: decoded G-code of the Line operation before and after.
- Suggested fix: tooltip/help and a result toast that say "N contours closed; their Line cuts close too".

### T07-P3-2: Closing a pen drawing replaces its few editable nodes with the flattened points
- Severity: P3 (editability; burn geometry unchanged — curves keep their exact cubics).
- Where: `src/ui/state/path-node-shape-sync.ts:24-31` (`materializedPolylineToSpecPoints` on the flattened compatibility polyline).
- Repro: script F. Pen shape with 6 points, gap 0.28 mm: after closing `spec.points` has 18 points, `closed: true`. Existing test `close-open-fill-contours-curves.test.ts:209` asserts this on purpose.
- Suggested fix: append the closing to the original spec points (keep authored nodes) when the curve is the pen's own fairing.

### T07-P3-3: Disabled reason is wrong when the near-closed contour cannot be repaired
- Severity: P3 (wording).
- Where: `src/ui/commands/fill-repair-commands.ts:26-31`; eligibility drops `repairable: false` groups in `fill-diagnostics.ts` `closeableCount`.
- Repro: script F, a pen shape with two subpaths, gaps 0.28 mm: `openCount 2, closeableCount 0`, so the menu says "Select open Fill contours with endpoints within 0.5 mm." although they are within 0.5 mm. Same for curve/polyline count mismatches and boolean compounds.
- Suggested fix: when open contours exist but none are repairable, say "These contours cannot be closed automatically; use Convert to Path first."

### T07-P3-4: No result message; contours left open in the selection go unreported
- Severity: P3. General Close Path reports count and widest gap (`path-cleanup-actions.ts:55,242`); this one is silent, and in a mixed selection the contours over 0.5 mm still do not fill with no word.
- Where: `src/ui/state/close-open-fill-contours-actions.ts:37-44`.
- Repro: READ ONLY, plus script A (0.6 mm case: no change, no undo, no message; command is disabled there, so the silent case is the mixed selection).
- Suggested fix: toast "Closed N Fill contours (widest gap X mm); M remain open — Close Fill Contours With Tolerance…".

### T07-P3-5: Test gap — no test for non-uniform scale direction, rotation/mirror, or the shared Line path
- Severity: P3. The tool's own tests use only uniform scale (`close-open-fill-contours-curves.test.ts:282`); behaviour is correct today (script A/B), but a regression to local-frame gaps or to an anisotropic shortcut would pass.
- Suggested fix: add script A's "scale2x0.5 local0.3x → refused / local0.4y rot37 mirror → closes, area 200" and script B's shared-cut case.

## Not a defect / limits
- Straight-line closure joining the path's own first and last point is by design (ADR-480 Amd 1; matches LightBurn Close Path). It cannot join ends of different subpaths, so it never joins the wrong ends; a closing line that crosses an edge fills by even-odd exactly as the oracle says.
- 0.5 mm inclusive limit and no tolerance field are by design; larger gaps go to T08.
- Contours on a hidden (`visible: false`) Fill op still count; not checked whether compile skips them (no burn harm either way).
- With only open Fill artwork, `prepareOutput` returned ok with no lit Fill and no entry in `advisories` (the open-Fill warning lives elsewhere; T06-P3-3 covers the job-time message). Not this tool.
- Text: closure is stored on pre-rendered glyph paths, so editing the text re-renders from the font and the gap returns (READ ONLY; expected).
- Not checked: group selection resolution, many-contour performance, dialog/keyboard in a browser (no dialog; memory gate respected, no browser run), inch display (the reason text hardcodes "0.5 mm").

## Totals
Raised 5; P1 0; P2 0; P3 5; known 0.
