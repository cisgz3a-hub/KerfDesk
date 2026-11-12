# T08 Close Fill Contours with Tolerance — auditor report
Tree: origin/main @ 856cb3ae1. Command id: `tools.close-fill-contours-with-tolerance`.

## Map
- Menu: Tools → Fill repair → **Close Fill Contours With Tolerance...** (`src/ui/commands/fill-repair-commands.ts:56-73`). Enabled when `openFill.openCount > 0` (`src/ui/commands/use-app-commands.ts:170`), which also counts contours that cannot be repaired. Disabled reason: "Select open Fill contours on an output Fill layer." Runs `requestCloseOpenFillContoursWithTolerance` (`tool-command-context.ts:121`), which opens the dialog (`CommandShell.tsx:118`).
- Dialog: `src/ui/commands/CloseOpenFillContoursDialog.tsx`. `type="number"`, `min=0.5`, `step=0.1`, default 1 mm, mm only. `parseTolerance` accepts any finite value > 0. Counts come from `selectedOpenFillContourRepairSummary` (`src/ui/common/fill-diagnostics.ts:65-81`): open, "can use the 0.5 mm quick close" (always measured at 0.5), "additional contours will close after review", "will remain open". There is no canvas preview and no gap size. The form goes through `Dialog`'s `checkedSubmit` (`src/ui/kit/form-validity.ts`), which refuses `rangeUnderflow` (below 0.5) with the browser bubble but ignores the step. Apply → `CloseOpenFillContoursPanel` (`CommandShell.tsx:249-266`) → `closeSelectedOpenFillContoursWithTolerance(tol)`, then a toast: `Closed Fill contours within ${tol} mm.`
- Handler: `src/ui/state/close-open-fill-contours-actions.ts:46-75` guards `!Number.isFinite(tol) || tol <= 0`, then works exactly like T07: `openFillContours` → `isCloseableOpenFillPolyline(contour, transform, tol)` (`src/core/job/open-fill-contours.ts:85-102`: ≥3 points, world gap after `applyTransform`, `gap <= tol`, inclusive, no epsilon) → `closeOpenPaths` adds one straight line from each contour's own last point to its own first point. Locked objects, boolean compounds and unrepairable groups are skipped. One undo step.
- Governing: ADR-480 Amendment 1 ("the explicitly reviewed tolerance") and Amendment 2; WORKFLOW.md "Open Fill contours omitted" (~line 4973); ADR-629 (display units: dialogs stay in mm in this increment); ADR-690 (`checkedSubmit`).
- Changes since 2026-10-16: the dialog and core are unchanged. `close-open-fill-contours-actions.ts` / `fill-diagnostics.ts` were touched only by `7449c6362` (S2-P3-3 one-scan counts) and `ab3226fd1` (shared helpers). `fill-repair-commands.ts` was touched by Leave White Unburned (PR #1617, `7e67e13e4`). `CommandShell.tsx` changes (ADR-707, PR #1752) do not touch this panel.

## October register re-check
Row #55 ("explicit finite positive tolerance"; the vector audit, line 105, adds "invalid/zero/nonfinite tolerance guard and above/below gap cases").
- Finite positive guard: **still fixed.** Script B, store action with gaps 0.4 and 30 mm in one selection. 0, -0, -1, NaN, Infinity and -Infinity cause no change and add no undo step. 1e-300 and 5e-324 are valid but close nothing. 1e308 and Number.MAX_VALUE close both contours. The dialog never passes non-positive values (Apply is disabled), and non-finite text becomes an empty value.
- Above/below gap: **still correct.** Script A: gap 1 with tol 1 closes (inclusive); 1.0001 is refused; 0.9999 closes; 5 / 5.000001 behave the same way.
- World mm frame: **still correct.** Rotated 37°, mirrored X, scale 2×0.5: a local X gap of 0.6 (world 1.200) is refused at 1 and 1.19 and closes at 1.2. A local Y gap of 2.4 (world 1.19999999999999800) closes at 1.2. Hatch area is 200.008 / 200.006 mm² against a grid oracle of 200.000.
- Undo exact: **still fixed** (script F, below).
- Existing suites: 6 files / 30 tests pass (`CloseOpenFillContoursDialog`, `close-open-fill-contours-actions`, `-curves`, `close-path-preserve-geometry`, `command-close-open-fill-contours`, `open-fill-contours-boolean-integration`).

## Checks run
Scripts are in `C:\Users\stolk\kd-t1\zz-t08\`: `t08-burn.test.ts` (real store action → `prepareOutput` → `emitPreparedGcode` → decoded lit Fill moves; the area oracle is T06's independent scanline grid in `zz-t07\decode.ts`) and `t08-dialog.test.tsx` (jsdom render of the real dialog plus a submit through `checkedSubmit`). Logs: `t08-burn.log`, `t08-dialog.log`. Run with `--config ../zz-t08/vitest.config.mts --maxWorkers=1`.

| Check | Method | Result |
|---|---|---|
| Inclusive threshold, identity | script A | gap = tol closes; tol + 1e-4 / tol + 1e-6 refused |
| Nominal-equal gap through a transform | script A, 20 valid cases of local gap × scale = 1.000 | 3 of 20 refused at tol 1 (world gap 1.0000000000000284 / ...071 / ...009): T08-P3-5 |
| World mm after rotate + mirror + non-uniform scale | script A | correct; area 200.008 vs 200.000 |
| 0, -0, -1, NaN, ±Infinity, 1e-300, MIN_VALUE, 1e308, MAX_VALUE on the action | script B | guard holds; huge values close everything in the selection |
| Dialog: "", "abc", "0,5", "0.5in", "Infinity", "0", "-1", "0.2", "0.5", "0.75", "1.25", "3", "1e308" | script dialog (jsdom) | invalid text becomes "" and Apply is disabled with no message; 0 / -1 Apply disabled; 0.2 Apply enabled but submit refused (rangeUnderflow); 0.75 / 1.25 accepted (step ignored, good); 1e308 accepted. Counts contradict themselves: T08-P3-2; units/commas: T08-P3-3 |
| Large tolerance on an open 180° arc (ends 40 mm apart) | script C | at tol 50 the dialog says "1 additional contour will close"; burn changes from 0 to a half-disc of 628.186 mm² (oracle 628.210). Straight 40 mm chord: T08-P3-1 |
| 300° arc, tol 25 | script C | fills 1219.848 vs oracle 1219.887 (chord closure, as designed) |
| Split outline: circle r 20 drawn as 3 arcs in one path | script D | counts read 0 closable up to tol 34 and 3 at 35. At tol 40 each arc closes onto its own start: hatch 736.850 = oracle 736.926 for three own-chord segments, against an intended disc of 1255.741; the 519.6 mm² centre triangle is never filled. The same with 0.63 mm neighbour gaps: 708.870 vs 1255.741. Never joins the wrong pair: T08-P3-1 |
| Two objects whose ends nearly touch (0.2 mm), tol 30 | script E | never bridged: each closes onto itself (two triangles 398.044 vs oracle 399.980, not the 400 mm² square) |
| Undo / Redo / save-reopen, locked object | script F (rot 33°, 1.3×0.7, mirror X; gaps 2 / 0.3 / locked 2; tol 3) | summary open 3 / safe 1 / reviewed 1 / remaining 1 (the locked one). One undo step; Undo serialization == before; Redo == after; reopened G-code identical; locked object untouched; a second Apply makes no change and adds no undo step |
| Cancel | script dialog | onCancel only, onApply not called; the dialog writes nothing to the store (READ: no store access in the component). Escape lives on the shared `Dialog` backdrop (covered by `Dialog.test.tsx:121`) |
| Result message | READ `CommandShell.tsx:262` | fixed "Closed Fill contours within X mm.", with no count and no remaining count: same as T07-P3-4 |
| Shared Fill + Line path | READ (same `closeFillPaths` as T07) | the Line cut closes too: same as T07-P3-1 |
| Unrepairable-only selection | READ (`use-app-commands.ts:170` enables on `openCount`) | dialog opens with 0 closable and no reason: same as T07-P3-3 |
| LightBurn reference | docs.lightburnsoftware.com `Reference/CloseSelectedPathsWithTolerance/` and `AutoJoinSelectedShapes/` | LightBurn closes each shape on its own (it "cannot connect fully separate paths"), with a Join-with-Line or Move-Ends-Together option. Its dialog shows open found / closed / remaining with no preview. Auto-Join joins separate segments at a fixed 0.05 mm. KerfDesk matches on closure (Join with Line only; Move Ends exists in the general Close Paths With Tolerance) |
| Test coverage of the guard | grep of the tool's suites | no NaN / Infinity / 0 / negative test on the action, `isCloseableOpenFillPolyline` or the dialog: T08-P3-6 |

## Findings

### T08-P3-1: The "review" shows only counts, so a large tolerance can fill a region the artwork never enclosed with nothing saying how far apart the joined ends are
- Severity: P3. The tool does what it says, and this matches LightBurn's Close Selected Paths with Tolerance (each path closes on its own; counts only). The canvas shows the closed result and one Undo restores it. But the dialog's only feedback is a count. A user who raises the tolerance until it reads "0 contours will remain open" gets long chords: an open 180° arc becomes a half-disc. A circle split into three arcs (a common broken import) closes into three segments with the centre triangle unfilled, 59% of the intended area, and there is no hint that Join Paths is the right tool. This tool never joins ends of different contours or objects.
- Where: `src/ui/commands/CloseOpenFillContoursDialog.tsx:58-65`; `src/ui/common/fill-diagnostics.ts:65-81`.
- Repro: `zz-t08\t08-burn.test.ts` C and D. Arc tol 50: 0 → 628.186 mm² (oracle 628.210). Three arcs tol 40: 736.850 mm² burned vs intended disc 1255.741 (own-chord oracle 736.926). With 0.63 mm neighbour gaps: 708.870 vs 1255.741.
- Oracle: independent even-odd scanline grid on the world contours.
- Suggested fix: show "widest gap closed: X mm" next to the counts and highlight the contours that will close. When a contour's end lies nearer another contour's start than its own, say "These look like pieces of one outline; use Join Paths."

### T08-P3-2: The dialog's counts contradict themselves when the field is empty, invalid or below 0.5 mm, and a disabled Apply gives no reason
- Severity: P3 (wording, no wrong burn).
- Where: `CloseOpenFillContoursDialog.tsx:19-31` (summary computed with `toleranceMm ?? 0`); `fill-diagnostics.ts:72-79` (`safeCount` is always measured at 0.5 mm, whatever the field says).
- Repro: `zz-t08\t08-dialog.test.tsx`, 3 contours with gaps 0.3 / 0.75 / 3. Field "", "abc", "0", "-1", "Infinity" or "0.2" shows "3 open Fill contours selected. 1 can use the 0.5 mm quick close. 0 additional contours will close after review. 3 contours will remain open." That is 4 contours of 3. For ""/abc/0/-1 Apply is disabled with no message. For 0.2 Apply is enabled, then the browser bubble refuses (min 0.5).
- Suggested fix: when the field is invalid, show "Enter a tolerance of 0.5 mm or more" in place of the counts, and measure `safeCount` at min(0.5, tolerance).

### T08-P3-3: The tolerance box does not take typed units or comma decimals, and has no upper bound
- Severity: P3. ADR-629 says typing `1in` already works in the numeric boxes (LBG-F12); this one is a bare `type="number"`, so `0.5in` and `0,5` become empty (Apply disabled, no message). `1e308` is accepted, closes every open contour in the selection, and the toast reads "within 1e+308 mm".
- Where: `CloseOpenFillContoursDialog.tsx:45-55,74-77`.
- Repro: `t08-dialog.test.tsx` (jsdom value sanitization; real Chromium likewise rejects letters in a number box, READ for comma locales); script B for 1e308 (closes 30 mm gaps).
- Suggested fix: use the app's unit-aware numeric input, and cap or warn above a sensible value (for example "larger than the selection").

### T08-P3-4: Result toast has no count and no remaining count — same as T07-P3-4 (KNOWN)
- Where: `src/ui/commands/CommandShell.tsx:262`. READ ONLY. The toast fires a fixed "Closed Fill contours within X mm." It cannot say how many closed or that locked or unrepairable contours remain open.

### T08-P3-5: A gap equal to the typed tolerance can be refused by floating-point error
- Severity: P3. The dialog never shows the gap, so this bites only someone who measured it and typed the same number; the remaining count shows it and 0.01 more closes it.
- Where: `src/core/job/open-fill-contours.ts:101` (`gapMm <= toleranceMm`, no epsilon; `CLOSURE_EPS_MM` exists).
- Repro: script A. 3 of 20 cases with a nominal world gap of exactly 1.000 mm (local 0.2 × scale 5 at (-7.7, 33.1); local 1.1 × 10/11 at two origins) compute to 1.0000000000000284 / ...071 / ...009 and stay open at tol 1.
- Suggested fix: compare against `toleranceMm + CLOSURE_EPS_MM`.

### T08-P3-6: Test gap: the invalid-tolerance guard and the dialog's invalid states are untested
- Severity: P3. The behaviour is correct today (script B, dialog script), but no test in the tool's suites passes 0, a negative value, NaN or Infinity to `closeSelectedOpenFillContoursWithTolerance` or `isCloseableOpenFillPolyline`. The dialog test covers only the happy path ("3").
- Suggested fix: add script B's table and the dialog sweep ("", "0", "0.2", "1e308") as tests.

### Known repeats
- Closing a Fill contour also closes its shared Line cut: same as T07-P3-1 (same `closeFillPaths`; READ ONLY here).
- An unrepairable-only selection: the command is enabled (it gates on `openCount`), the dialog shows 0 closable and gives no reason: same as T07-P3-3 (READ ONLY).

## Not a defect / limits
- Each contour is closed onto its own start, never onto another contour or object (scripts D and E). This is by design per ADR-480 Amendment 1 and matches LightBurn's Close Selected Paths with Tolerance; joining pieces is Join Paths (T30).
- Values below 0.5 are refused by `min=0.5` through `checkedSubmit`. The quick-close command covers that range, so this is deliberate.
- The step is ignored on submit (ADR-690): 0.75 and 1.25 apply correctly.
- mm-only labelling is by design in ADR-629's first increment (dialogs say `mm`).
- Locked contours count as "will remain open" and are left untouched (script F).
- Not checked: a browser run (memory gate: about 2.9 GB free, and the brief said no browser run), keyboard focus order in a real browser, many-contour performance of the live-count recompute on each keystroke, text objects (T07 covered them).

## Totals
Raised 8; P1 0; P2 0; P3 8; known 3 (T08-P3-4 = T07-P3-4; shared Line cut = T07-P3-1; unrepairable reason = T07-P3-3).
