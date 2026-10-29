# Rolling audit v8 — N5 Design Studio, sketch and design I/O fixes (#1509, #1505)

- **When:** 2026-10-29, evening +0800   **Tree:** origin/main @ `4f71f1f41` (`git fetch origin main` at the start).
  - Merge commits: #1505 `a486c9192` (squash, parent `59a1ac49e`); #1509 `0fcbe8e99` (merge, first parent `a486c9192`). Desktop 1.0.28 is `33bc394c6`. The commits after it (#1514–#1517) touch constant-power advice, the Marlin worker and the tracer only. `git diff --stat 0fcbe8e99 origin/main` over every file the two PRs touched shows only #1511's `Placed` type change in `draw-vector-strokes.ts` (no behaviour change) and #1507's schema bump in `project.ts`.
  - **Repros ran on main's tree, not the worktree,** in the scratchpad copy `…\scratchpad\j7-main\`.
    - All 4,415 tracked files under `src/ui/{design-studio,state,layers,workspace,app,commands}`, `src/io/{svg,vector-formats,dxf,lightburn}`, `src/core/{sketch-constraints,parts,scene,job,cnc}` and `electron/` hash-match `origin/main` (`git ls-tree` blob ids against `git hash-object`).
    - ADR text was read from `origin/main` itself, because `j7-main` has no `docs/decisions` amendment files.
  - **Command,** from `j7-main`, one file at a time: `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=2048" node node_modules/vitest/vitest.mjs run <file> --config zz-n5-vitest.config.ts --silent=false --disableConsoleIntercept`. The config is the repo's `vitest.config.ts` plus an `fflate` alias and one worker.
  - **Test truth.** `N5_STUB=1505|1509` swaps in the parent-commit version of each changed source file through a Vitest alias. The swapped files are listed under "Repro files".
- **Scope:** fix verification (L10) and entry-point parity (L9) of:
  - **#1509**, ADR-573 Amd 1 and ADR-590 Amd 1. Findings fixed: v7 L5-P1-1, L5-P1-2, L5-P2-1, and the optional L5-P3-5.
  - **#1505**, ADR-681, plus ADR-468 Amd 2 and the ADR-431 amendment. Findings fixed: v7 L7-P1-1, L7-P1-2, L7-P2-1.
  - Their interactions with #1502 (tight bounds), #1504 (group typed rotation), #1507/#1508 (text) and #1511 (Fill canvas pooling).
  - A spot check of #1509's window and worker teardown, for the 1.0.28 release run that exited non-zero.
- **Lenses run:**
  - **L10:** every original repro through the real store, the toolbar's transform builder (`buildSelectionTransformEdit`), the real exporters, parsers, store import and paste, `compileJob` / `compileCncJob` and `emitGcode`. Then siblings, regressions, each ADR against the code, and test truth.
  - **L9:** toolbar typed W/H (locked and unlocked), rotation, flip, group resize and group rotation; Paste, Paste in Place, Cut and Paste, Duplicate, Saved Artwork, and laser → CNC paste; SVG, DXF and the painted formats (PDF, AI, EPS, GeoJSON); LightBurn `.lbrn` import.
  - **L2:** LightBurn 1.7's colour import rule, for the colour round trip.
  - **Not run:** real pointer devices, the packaged desktop app, and LightBurn itself.
- **Counts:** 7 raised → 0 refuted → **P1 1 / P2 1 / P3 5** after the refuter (raised as P1 0 / P2 2 / P3 5), + 5 KNOWN re-observed.
  - **Refuter (fresh context, 2026-10-29):** 7 CONFIRMED, 0 PLAUSIBLE, 0 REFUTED, 0 found KNOWN.
  - **N5-P2-2 is raised to P1.** Design work that survived the crash is overwritten. The recovery offer gives no warning that names it, and there is no route that keeps it.
  - **N5-P2-1 stays P2,** but it reaches further than reported. Any sub-millimetre change to a dialog rectangle's width or height trips it, with ratio errors up to 4.0e-8 (40× the tolerance). See "Refuter method".

## Headline

**Both PRs fix what they name, and every original repro now gives the right burn.**
- **L5-P1-1.** A sketch resized to W 120, then typed to width 80 and hole Ø6, now burns 80 × 60 with Ø6 holes at scale 1, in the same place. Before the fix it burned 160 × 60 with Ø12 holes.
- **L5-P1-2.** An unapplied Studio drawing that meets another recovery key is kept. It comes back with its project, or the Studio offers it.
- **L5-P2-1.** The desktop canvas draws all 8 edges of the chamfered rectangle.
- **L7-P1-1.** A plate with a separate inner circle burns 999.7 mm² before and after an SVG round trip. Three-deep nesting gives 2300 / 2300, and overlapping circles 382 / 382.
- **L7-P1-2.** A hand-placed tab survives cross-project paste, Cut and Paste, Duplicate and laser → CNC paste.
- **L7-P2-1.** Three drawn operations export as three colours.

Every regression test that was run on the parent code fails there.

**Two sibling gaps, both raised as P2. The refuter raises N5-P2-2 to P1:**
- **N5-P2-1.** An even resize typed as two fields (W 120, then H 60, with the aspect lock off, the default) on a sketch solved by distance constraints leaves the factors 1.25e-9 apart. That is just above the fold's 1e-9 tolerance. The editor then calls the sketch "stretched (width 200%, height 200%)" and does not fold the resize. Apply returns the part from 120 × 60 to 60 × 30. The alert does say so before Apply.
- **N5-P2-2.** The kept-drawings rule keeps only drawings with unapplied work. So a Studio drawing applied in the last 30 s before a crash is still lost when the older autosave is restored. That is the pure-Apply form of L5-P1-2's route "restoring one older than an Apply". ADR-590 Amd 1 item 1 assumes "its project's own document holds it", and after that restore it does not.

#1509 changed no file under `electron/`, and nothing in its renderer teardown can make the app exit non-zero (see "Verified clean").

## Fix matrix

| Original finding | Before (parent) | After (main `4f71f1f41`) | Siblings | Verdict |
|---|---|---|---|---|
| **L5-P1-1** canvas-resized sketch burns typed dimensions at the canvas scale | 5 of 6 `retained-source-canvas-resize.test.ts` cases fail on the parent `constrained-sketch-actions.ts` / part files (e.g. transform kept `scaleX: 2`; stretched part burns 80 × 80) | **Fixed.** S1, through the real toolbar builder: locked W 120 → `scale even 2`; the editor opens on `[120, 60, 8]`. Width 80 and hole 6 give dialog size `[80, 60]`, transform `scaleX 1`, and G-code outline 80 × 60 with holes 6 × 5.956 (polygon). The top edge stays at machine Y 215 | Rotate 30° + 2×, mirror + 2×, negative scale −1.5 / 1.5, a group (sketch + rectangle) rotated 30° then scaled 1.5 (#1504's group rotation): each unchanged re-apply moves the outline **0 mm**. Undo returns the scaled project byte-for-byte, and Redo the folded one. Panel part fold: W 90 → 90 × 60 with Ø5 holes. **Two typed fields on a solved sketch read as a stretch (N5-P2-1)** | Holds on the reported path. Sibling P2 |
| **L5-P1-2** unapplied drawing discarded when the key differs | 3 of 7 `design-kept-drawings.test.tsx` cases fail on the parent store and persistence hook (`expected [] to deeply equal [drawing]`) | **Fixed for unapplied work.** K1b (Apply, one more line, crash, older autosave): kept `[applied,l1,l2,l3]`, and the bar offers it. K2 (Studio closed, then File > New): kept, and Restore brings it back. K3 (desktop close inside the 400 ms debounce): the teardown write lands, and the next start opens it with its file | **Pure Apply in the last 30 s before a crash: lost (N5-P2-2).** The hold is silent; two tabs are last-writer-wins (latent) (N5-P3-3). Older kept drawings can be reached only by discarding or applying newer ones (N5-P3-4) | Holds for unapplied drawings. Sibling P1 after the refuter (raised as P2) |
| **L5-P2-1** canvas draws closed Studio shapes open | Both `draw-studio-closed-paths.test.ts` cases fail on the parent `draw-vector-strokes.ts` | **Fixed**, 2/2 pass on main. `strokePolylinesBatched` adds the closing `lineTo` (`draw-vector-strokes.ts:32-36`) | #1511's fill pools stroke through the same function (`fill-pools.ts:135`). The hover pulse closes its path (`pulse-piece-bitmap.ts:232`). The selection overlay closes it (`draw-selection-overlay.ts:105`) | Holds |
| **L7-P1-1** separate Fill shapes lose holes through SVG | 6 of 7 `design-file-round-trip.test.ts` cases fail on the parent exporters (1200 mm²; `#000000`, `#2563eb`, `#2563eb`) | **Fixed.** IO1–IO7 measure the burned hatch area before → after SVG re-import (→ DXF then Fill): ring 999.7 → 999.7; three-deep nesting 2300 → 2300 (2300); overlapping circles 382 → 382 (381.9); an object whose own paths overlap plus a second object 1600 → 1600. A per-object Line override stays a stroke (1200 fill + 1 line → the same). PDF/AI/EPS/GeoJSON write one even-odd item | **A Fill sub-layer under a Line operation is written as strokes only.** After re-import and Fill, the ring burns 1200 (N5-P3-1). CNC pocket operations are mode `line` and pool raw contours even-odd, so the stroke export keeps them | Holds. Sibling P3 |
| **L7-P1-2** paste drops placed tabs (path colour = operation colour) | Both new `laser-tab-actions.test.ts` cases fail on the parent `scene-clipboard-actions.ts` (anchor rewritten to `#2563eb`) | **Fixed.** P1 uses a real `.lbrn` part with path = operation colour `#000000`. Before: `placed 1`, CNC anchors (160,260) (140,240), and the cut starts after the tab at `X141 Y140`. Cross-project Paste in Place, Cut + Paste (the operation is recreated as `#2563eb`) and Duplicate are identical | Laser → CNC project paste (P2): anchors resolve at the same points. The CNC compile puts the tab rises at machine (157.41,140) and (142.59,160), which is anchor ± (tab/2 + tool radius). Saved Artwork insert is covered by the PR test | Holds |
| **L7-P2-1** exports write the stored path colour | See L7-P1-1 (parent fails) | **Fixed.** IO4: three drawn shapes, all with path `#000000`, on `#2563eb`, `#dc2626` (output off) and `#16a34a` export as those three stroke colours. Re-import gives three operations | The output-off operation and the LightBurn T1 tool layer are exported as ordinary artwork (by design, L7 Refuted). **LightBurn layers C08–C29 / T1 / T2 carry hash colours LightBurn does not know (N5-P3-2)** | Holds. Sibling P3 |
| L5-P3-5 (optional) cancelled pointer gestures | — | Read: `pointercancel` ends a move or resize as one step and drops a draft. `lostpointercapture` ends only a move or resize and never drops a draft, so the normal pointerup → lostpointercapture order cannot cancel a polyline in progress (`use-design-pointer.ts:134-159`) | — | Read only |

## Findings

### N5-P2-1 — An even canvas resize typed as two fields (W, then H) on a sketch solved by distance constraints reads as a stretch: the editor reports "stretched (width 200%, height 200%)", does not fold the resize, and Apply returns the part to half size

- **Where:**
  - `src/core/scene/retained-source-scale.ts:19-21,28`. `SCALE_EPSILON = 1e-9` relative. The comment above it says "A typed or dragged even resize can leave the two factors a rounding error apart; neither difference is a resize anyone could see".
  - `src/core/sketch-constraints/solve-constrained-sketch.ts:37`. The solver stops at a residual of `SKETCH_SOLVE_TOLERANCE_MM / 10` (1e-6 mm), so solved bounds are about 1e-7 mm off round values. That is about 2.5e-9 relative on a 60 mm part.
  - `src/ui/commands/NumericEditsBar.tsx:118`. The aspect lock is off by default, so W and H are two separate edits, each divided by its own solved extent.
  - `src/ui/layers/RetainedScaleNotice.tsx:22-31` prints the "stretched" alert. `src/core/sketch-constraints/scale-constrained-sketch.ts:20-25` folds only `even`.
- **Anchor:**
  - **Contract: ADR-573 Amd 1 item 1** (`docs/decisions/ADR-573-amendment-1-…md`). "When a constrained sketch or a generated part has an even scale (the same factor on both axes), Edit constrained sketch… … fold that factor into the values they show".
  - **Twin:** the code comment at `retained-source-scale.ts:19-20` against its own tolerance, and the notice's percentages (equal) against its verdict ("stretched").
- **Scenario:**
  1. Build a 60 × 30 rectangle sketch with distance constraints (AB 60, AD 30, H/V), from any non-exact start, as the dialog does.
  2. Select it and type toolbar W 120, then H 60 (lock off, the default).
  3. Open **Edit constrained sketch…**. The editor opens on the sketch's own 60 × 30 values, with the alert "This sketch is stretched on the canvas (width 200%, height 200%) … applying returns it to the sizes here".
  4. Apply (with or without other edits). The part burns 60 × 30, not the 120 × 60 the canvas showed.
  - The default bracket template (x/y constraints only) solves exactly, so it folds (S2). Generated parts are exact too.
- **Evidence:** REPRO, `src/ui/state/zz-n5-sketch.test.ts`:
  - S8: `localBounds maxX 60.00000014863823 maxY 30.00000013699643`. After W 120 and H 60: `scaleX 1.9999999970270883, scaleY 1.9999999945202451, ratioDiff 1.2534e-9`, giving `scale {"kind":"stretched"}`. The canvas G-code is `w 120 h 60`. The review size is `[60,30]`, and after Apply the G-code is `w 60 h 30`. A locked W 120 on the same sketch gives `{"kind":"even","factor":1.999999997}`.
  - S9, the rendered notice: `role "alert"`, text "This sketch is stretched on the canvas (width 200%, height 200%). Its dimensions keep one scale, so applying returns it to the sizes here and its holes stay round. …"
- **Severity:** P2. The alert reaches the operator before Apply, and the burn then matches the dialog and the canvas, so this is not P1 under §3. It is a misleading notice: it calls an even 200 % × 200 % resize a stretch, and it withholds the fold ADR-573 Amd 1 promises. An operator who trusts "the sizes here" and only retypes a hole gets a part half the size they had on the canvas.
- **Fix direction:** Compare the factors with a tolerance that matches the solver and the display, for example a relative 1e-6. Or fold the mean factor whenever the two agree to the precision the notice prints. Add a test with two typed fields on a distance-solved sketch.
- **Refuter: CONFIRMED, P2 kept. It reaches further than reported.**
  - **Own repro,** `zz-n5r-sketch.test.ts`, using only the dialog's own builders:
    - Custom sketch, then `appendSketchPrimitive('rectangle')`. This adds the width and height distance constraints plus H/V, as the Geometry editor does.
    - A parameter value change, then `reviewConstrainedSketch` and `applyConstrainedSketch`.
    - The toolbar builder `buildSelectionTransformEdit`: W, then H, with the lock off. The lock defaults to `useState(false)` (`NumericEditsBar.tsx:115-118`).
    - Then `compileJob`.
  - **The trigger is any width or height change under about 1 mm.**
    - The loop stops at the first iterate under 1e-6 mm (`solve-constrained-sketch.ts:37`). With damping 1e-6, a sub-mm change stops after one step, leaving the bounds about 1e-6 mm off. For example, 59.5 × 29.5 → 60 × 30 gives 59.999999000 × 29.999999000.
    - 24 of 32 such cases read as stretched (6 of 8 changes × 4 resize factors). Their ratio differences are 3.3e-9 to 4.0e-8, up to 40× the 1e-9 tolerance. This is not a knife edge.
    - Changes of 1 mm or more take a second step and land within about 1e-12. None of 80 cases stretch (5 starts × 4 targets × 4 factors), and none of 32 with the plate and Rectangle templates (x/y constraints).
  - **End to end:** 59.5 × 29.5 → 60 × 30, then W 120 and H 60.
    - Canvas burn 120.000 × 60.000. The kind is `stretched` (2.0000000333, 2.0000000667).
    - The editor's parameters are 60 and 30. The review reads "Size 60.000 × 30.000 mm".
    - The burn after Apply is 60.000 × 30.000, at scale 1.
  - **Why not P1.** Two statements reach the operator before Apply, and both give the result size:
    - The `role="alert"`: "applying returns it to the sizes here" (`RetainedScaleNotice.tsx:23-27`).
    - The review line "Size 60.000 × 30.000 mm" (`SketchSolveReview.tsx:37-40`). Apply does nothing until Review has run (`use-constrained-sketch-draft.ts`, `apply` returns while `review === null`).
    - After Apply, the canvas and the W/H boxes show 60 × 30 before any Start, so the burn matches what the app shows.
    - What remains is a misleading readout (an even 200 % × 200 % called a stretch) and a broken fold under ADR-573 Amd 1 item 1. That is P2.
  - **The fix direction covers it.** A relative tolerance of 1e-6 is 25× above the worst case seen (4.0e-8).
  - **Novelty:** no other audit cites `retained-source-scale` or `SCALE_EPSILON`, and no open PR touches the file.

### N5-P2-2 (P1 after refuter) — A Studio drawing applied in the last 30 s before a crash is still lost: after restoring the older autosave, the Studio opens the project's older drawing and overwrites the only saved copy, because ADR-590 Amd 1 keeps only drawings with unapplied work

- **Where:**
  - `src/ui/design-studio/design-kept-drawings.ts:51-53`. `holdsUnappliedWork` is `entities.length > 0 && dirtySinceApply !== false`.
  - `src/ui/design-studio/design-draft-recovery.ts:101-104`. `setAside` returns without keeping when that is false.
  - `src/ui/design-studio/use-design-session-persistence.ts:97` then writes the opened session over the slot. `autosave.ts:24` sets the 30 s interval.
- **Anchor:**
  - **Contract: ADR-272 Amd 3** (`DECISIONS.md:14757-14778`). The amendment exists because "a crash, or a closed tab discarded the drawing outright". Item 4: "the in-memory stash first (this page's drawing), then the saved drawing, then blank".
  - **Contract (premise): ADR-590 Amd 1 item 1** (`docs/decisions/ADR-590-amendment-1-…md:31`). "A drawing with nothing unapplied is not kept: its project's own document holds it". After an older autosave is restored, the project's document does not hold it.
  - **Ledger:** L5-P1-2's coordinator-confirmed routes include "restoring one older than an Apply". The refuter's repro of that route drew one more line after the Apply, and that variant is now fixed.
- **Scenario:**
  1. Project autosaved with one applied Studio line.
  2. Draw two more lines in the Studio and Apply (the drawing is now applied, `dirtySinceApply` false). Close the Studio.
  3. The app crashes within 30 s, before the next autosave.
  4. Restart, restore the autosave ("Saved N s ago") and open the Studio. It shows the one older line. The saved three-line drawing is overwritten. No kept drawing, bar or toast appears.
- **Evidence:** REPRO, `src/ui/design-studio/zz-n5-kept.test.tsx`, with the real persistence hook, `serializeProject` / `deserializeProject` and the Studio's Apply (`applyDesignSketch` + `markApplied`, as in `use-design-apply.ts:45-55`):
  - K1: `beforeCrash {"slot":["applied","l1","l2"],"slotDirty":false,"kept":[],"workspaceObjects":3}`. After restoring the older autosave: `restoredObjects 1`, `opened ["applied"]`, `after {"slot":["applied"],"kept":[]}`.
  - Control K1b (one more line drawn after the Apply): `kept [["applied","l1","l2","l3"]]`, offered by the bar.
- **Severity:** P2, with a note for the coordinator. The workspace loses the same Apply, as it loses any edit after the last autosave, and the recovery offer discloses the age ("Saved {age}"). The Studio, though, held an intact copy and destroys it, which is what ADR-272 Amd 3 exists to prevent, and nothing names the drawing. Under v7's "Losing design work also counts", and the ledger wording of L5-P1-2, the coordinator may rate it P1.
- **Fix direction:** Keep a saved drawing whose apply record names objects missing from the opened project, or whose owner key differs, even when `dirtySinceApply` is false. Or keep any non-empty drawing that does not match the opened project's own document. Then pin the stale-autosave-after-Apply route in `design-kept-drawings.test.tsx`.
- **Refuter: CONFIRMED, raised to P1.**
  - **Own repro,** `zz-n5r-kept.test.tsx`:
    - Setup: the real persistence hook; the Studio's Apply as `use-design-apply.ts:45-55` does it (`applyDesignSketch`, then `markApplied`); the autosave as a `serializeProject` / `deserializeProject` round trip.
    - **Before the crash:** `{"slot":["applied","l1","l2"],"dirty":false,"kept":0,"objects":3}`.
    - **Restore the older autosave, then open the Studio:** it opens `["applied"]`. One second later: `{"slot":["applied"],"kept":[]}`.
    - **Decline the restore** (Studio opened on the blank start-up project, epoch 0): it opens `[]`, then `{"slot":[],"kept":[]}`. This route loses the drawing too, so no route keeps it.
    - **Control** (autosave taken after the Apply): it opens all three lines.
  - **The 30 s window is real.** `AUTOSAVE_INTERVAL_MS = 30_000` (`autosave.ts:24`) drives the loop in `use-autosave.ts`. A crash fires no `beforeunload`. The Studio slot, by contrast, is written on its 400 ms debounce, so it held the drawing.
  - **What the age tells the operator.** The offer reads "Saved less than a minute ago. Restore it to continue where you left off." (`AutosaveRecoveryControl.tsx:52`, `use-autosave.ts:199-201`). The scenario's "Saved N s ago" should read that way.
    - The label is minute-granular and measured at restart, so it cannot show whether an Apply made seconds before the crash is in the autosave.
    - "Continue where you left off" says nothing is missing.
    - Nothing names the Studio drawing. With no kept drawing, the bar returns null (`DesignKeptDrawingBar.tsx:19`), and there is no toast.
  - **Why P1.** METHOD §3 lets a refuter lower a P1 only by showing the result is not wrong, or that a clear warning reaches the operator first. Neither holds.
    - The drawing existed intact after the crash, and the app overwrote it with no warning. v7's design rule counts that: "Losing design work also counts".
    - ADR-590 Amd 1's own Context lists this route among those the amendment fixes: an "Apply, after the last 30 s autosave". Its item 1 premise, "its project's own document holds it", is false here. So the ADR does not knowingly accept the loss.
    - ADR-272 Amd 3 exists because a crash "discarded the drawing outright".
    - Reach (a crash within 30 s of a Studio Apply) cannot lower a P1 (§3 clarification of 2026-10-23).
  - **The case for P2,** for the coordinator. The lost lines are exactly the workspace edits the same crash loses from the 30 s autosave, as every crash recovery does, so the only extra loss is the Studio's copy. The refuter does not find this decisive: the confirmed L5-P1-2 route 1b counted the same lines as a P1 loss (lines applied after the autosave, plus one unapplied line).
  - **KNOWN check:** not raised anywhere else. It is the pure-Apply residual of v7 L5-P1-2 (route "an Apply, in the last 30 s before a crash"), which #1509 marks fixed. No open PR touches these files (only #1478 is open, CNC and camera).

### N5-P3-1 — A Fill sub-layer under a Line operation is exported as strokes only; ADR-681's compound covers only operations whose own mode is Fill

- **Where:**
  - `src/io/svg/export-fill-compounds.ts:51-56,157`. `exportOperationFills` reads the parent operation's effective mode.
  - The compiler fills every enabled sub-layer: `outputOperationLayers` (`src/core/scene/layer.ts:453-457`) feeds `compileVectorGroupsForLayer` (`compile-job.ts:98-108`), which pools even-odd.
- **Anchor:** **Twin:** the burn of an operation's Fill sub-layer against the exported file. ADR-681 Context says "The burn pools a Fill operation even-odd".
- **Scenario:** A plate and a separate circle on a Line operation with a Fill sub-layer burn a 999.7 mm² ring plus two outlines. SVG export writes two `fill="none"` strokes. The re-import is one stroke object with two paths. When the operator restores Fill, each path is resolved on its own and the paths are unioned, so the burn is a solid 1200 mm².
- **Evidence:** REPRO, `src/ui/app/zz-n5-io.test.ts` IO3: `lpModes ["fill"]`, `lpBefore {"fill":999.7,"lineRuns":2}`, `lpSvgEls ["g id=\"artwork-0\"","fill=\"none\"","g id=\"artwork-1\"","fill=\"none\""]`, `lpAfterAsIs {"fill":0,"lineRuns":2}`, `lpAfterFill {"fill":1200}`. A LightBurn Scan+Cut layer opens as a Fill operation plus a separate Line operation, so its Fill part round-trips: `999.7 → 999.7`.
- **Severity:** P3. Nothing differs until the operator changes the re-imported operation. This is the same class as KNOWN L7-P3-1 (SVG and DXF carry no settings, ADR-350 item 5).
- **Fix direction:** Treat a path as filled when any enabled output layer of its operation (parent or sub-layer) fills, and pool it in that operation's compound.
- **Refuter: CONFIRMED (READ of both sides, plus the auditor's REPRO), P3 kept.**
  - **The export** gates its compounds on `exportOperationFills(exportOperationForPath(…))`. That is the effective mode of the top-level operation only (`export-fill-compounds.ts:51-56,157`).
  - **The compiler** loops over `outputOperationLayers(layer)`, which takes each enabled sub-layer with its own settings (`compile-job.ts:98-108`, `layer.ts:426-438,453-457`).
  - **Reach:** sub-layers are added from the Cuts list (`LayerSubLayers.tsx:63`).
  - **Why P3:** the burn is unchanged until the operator re-sets the re-imported operation, because SVG carries no settings (ADR-350 item 5). Same class as L7-P3-1.

### N5-P3-2 — LightBurn layers C08–C29, T1 and T2 import with hash colours, so ADR-681's "a LightBurn layer stays as authored" re-exports colours LightBurn cannot map back to their layers

- **Where:** `src/io/lightburn/lbrn-geometry.ts:422-436`. `LIGHTBURN_COLORS` lists only C00–C07. Any other cut index gets `#${(index * 2654435761 & 0xffffff)…}`, so T1 (index 30) becomes `#8042be`. `export-fill-compounds.ts:75-98` then keeps that colour.
- **Anchor:**
  - **Ground truth:** LightBurn 1.7 Color Palette, https://docs.lightburnsoftware.com/1.7/Reference/UI/ColorPalette/ (versioned path, fetched 2026-10-29): "Use exact matches for the colors used by LightBurn to ensure layers are assigned properly." The same page gives T1 as `#F36926` and T2 as `#0C96D9`.
  - **Contract:** ADR-681 item 1, "a LightBurn layer stay as authored".
- **Evidence:** REPRO, IO4: `lbLayers ["C00:#000000:out=true","T1:#8042be:out=false"]`; `lbSvgStrokes ["#000000","#8042be"]`. KNOWN check: the July importer audit verified only that the hash is collision-free (`docs/audits/rolling/2026-07-17-1231-lightburn-importers.md:66`). It did not check that the colours match LightBurn's palette.
- **Severity:** P3. It needs LightBurn on the receiving end, and SVG carries no settings anyway. The layer numbers of C08 and above are lost in the round trip.
- **Fix direction:** Fill in LightBurn's full palette (C00–C29, T1, T2) in `colorForCutIndex`, from the Color Palette page.
- **Refuter: CONFIRMED (ground truth re-fetched, plus a code computation), P3 kept.**
  - **Ground truth.** The pinned 1.7 page was fetched again on 2026-10-29. The exact-match sentence quoted in the Anchor is verbatim. The page lists 30 numbered colours (for example, 08 `#B4B4B4` and 29 `#FFDB66`), then T1 `#F36926` and T2 `#0C96D9`. It describes T1/T2 as layers that are never output.
  - **The code.** `LIGHTBURN_COLORS` holds 00–07 only (`lbrn-geometry.ts:422-436`). The hash gives 8 → `#bbcd88`, 30 (T1) → `#8042be` and 31 (T2) → `#b7bc6f`.
  - **Index check.** T1/T2 are CutIndex 30 and 31 (`lbrn-tool-layers.test.ts:5`).
  - **No twin.** No test asserts a colour above index 7, and `src/` has no other copy of the palette.
  - **Why P3:** only a file sent back to LightBurn loses its layer number, and the file carries no settings anyway.

### N5-P3-3 — Two kept-drawing edges are silent: a held slot stops saving the new drawing with no notice, and two pages sharing the slot are last-writer-wins (latent)

- **Where:**
  - `src/ui/design-studio/design-session-storage.ts:53-58,62` (`slotHeld` makes every later write a no-op for the rest of the page) and `design-draft-recovery.ts:103-104`.
  - `use-design-session-persistence.ts:97` writes without checking whose drawing is in the slot.
- **Anchor:**
  - **Contract: ADR-590 Amd 1 item 1** decides the hold ("this page stops saving the Studio rather than write over it"). Nothing decides that the operator is not told. The Close tooltip still says "your drawing is kept without applying it" (`DesignTopBar.tsx:96`).
- **Evidence:** REPRO, `zz-n5-kept.test.tsx`:
  - **K4.** The kept write throws, then the new project's drawing `n1,n2` is drawn: `keptWrites 1`, `slot ["applied","l1","l2"]` (the new drawing is never saved), page text `""`. A crash after that loses the new drawing.
  - **K5.** Another page writes its drawing into the shared slot, and this page's next edit overwrites it: `slot [..,"A4"], kept []`. This is latent. The desktop holds a single-instance lock (`electron/desktop-project-open.ts:59`), and the browser Free build stubs `DesignStudioHost` (`scripts/browser-free-build.ts:10`).
- **Severity:** P3. The hold needs a nearly full `localStorage`, and the two-page case is not reachable today.
- **Fix direction:** Show a one-line Studio notice while the slot is held. Before writing, compare the slot with what this page last wrote, and keep a foreign drawing first.
- **Refuter: CONFIRMED (READ, plus the auditor's REPRO), P3 kept.**
  - **The hold also covers teardown.** `writePersistedSession` returns while `slotHeld` (`design-session-storage.ts:62`). That includes the `pagehide` / unmount flush. So while the slot is held, an unapplied drawing is not saved even on a normal close, despite the Close tooltip.
  - **Why it stays P3.** ADR-590 Amd 1 item 1 decides the hold: this page stops saving the Studio. That decision accepts the unsaved drawing. Only the silence is undecided.
  - **Reach.** The kept write must fail: a `localStorage` quota error, or a slot drawing within about 100 chars of the 2,000,000-char cap. The kept entry adds an id and `keptAt` wrapper and is checked against the same cap (`design-kept-drawings.ts:106`).
  - **The two-page case is latent:** the desktop holds a single-instance lock, and the browser Free build stubs the Studio.

### N5-P3-4 — The kept-drawing bar offers only the newest drawing, and Restore puts the replaced drawing back as the newest, so an older kept drawing can be reached only by discarding or applying the newer ones

- **Where:** `src/ui/design-studio/DesignKeptDrawingBar.tsx:18-21` (`kept[0]` only, plus "N older kept") and `design-kept-drawing-actions.ts:42-44` (`keepDesignDrawing(replaced)` stamps `Date.now()`).
- **Anchor:** **Contract: ADR-590 Amd 1 item 4** ("names the newest kept drawing … with Restore and Discard…"). The bar's own text says older drawings are kept, but there is no way to reach them.
- **Evidence:** REPRO, K6. Kept A (newest), B; the current drawing C is unapplied. Restore three times gives `[["A","C,B"],["C","A,B"],["A","C,B"]]`. B is never offered.
- **Severity:** P3 (an improvement). Nothing is lost while the five-drawing cap is not reached. Reaching B means discarding a newer drawing for good, or applying it.
- **Fix direction:** List the kept drawings (shape count, time) with Restore per entry. Or keep the replaced drawing with its original `keptAt`.
- **Refuter: CONFIRMED (READ, plus the auditor's REPRO), P3 kept.**
  - **The bar** offers only `kept[0]` (`DesignKeptDrawingBar.tsx:18-21`).
  - **Restore re-stamps the replaced drawing.** `restoreKeptDesignDrawing` keeps it with `keepDesignDrawing(replaced)`, whose default `keptAt` is `Date.now()` (`design-kept-drawing-actions.ts:43`). The list sorts newest first (`design-kept-drawings.ts:66`), so the replaced drawing becomes `kept[0]`.
  - **How the older one is reached.** Apply the current drawing (an applied drawing is not kept on Restore), or discard the newer ones. Nothing is lost below the five-drawing cap, because a Restore takes one entry and adds one.

### N5-P3-5 — Test gaps

- No test types W and H as two fields on a distance-solved sketch (N5-P2-1). Every fold test sets `scaleX` and `scaleY` directly to exact values (`retained-source-canvas-resize.test.ts:40-48`).
- No test restores an autosave older than a pure Apply (N5-P2-2). The PR's "older autosave" test draws unapplied work after its Apply (`design-kept-drawings.test.tsx:132-153`).
- No export test covers a Fill sub-layer (N5-P3-1), and none checks the LightBurn palette for indexes ≥ 8 (N5-P3-2).
- **Test truth:**
  - 4 of 7 `design-kept-drawings.test.tsx` cases pass on the parent store. They are unit tests of the new modules: the list, the applied-only rule, the bar, and the restore swap.
  - 1 of 7 `design-file-round-trip.test.ts` cases passes on the parent exporters (imported colours re-export as authored). It guards the second push.
  - 1 of 6 `retained-source-canvas-resize.test.ts` cases passes on the parent (an unscaled part keeps its transform).
  - Each of these is a guard, not a fix test. Every fix test fails on the parent.
- **Refuter: CONFIRMED (READ), P3 kept.** Greps of the tests on main show each gap:
  - No test that calls `buildSelectionTransformEdit` also builds a constrained sketch.
  - `retained-source-canvas-resize.test.ts` sets the scales directly.
  - The older-autosave case in `design-kept-drawings.test.tsx` calls `drawUnappliedWork`.
  - No SVG export or round-trip test has sub-layers.
  - No LightBurn test asserts a colour (`lbrn-tool-layers.test.ts` checks only names and Output).
  - The new gap the refuter found: no test changes a sketch parameter by under 1 mm and then resizes (N5-P2-1's ordinary trigger).

## KNOWN re-observed

- **L7-P3-3 (SVG round trip merges objects).** Re-observed: a Fill compound and its members come back as one imported object (IO1: 4 objects → 1 path). ADR-681 Consequences records it as open.
- **L7-P3-1 (DXF or Line SVG then Fill).** The class behind N5-P3-1. Not re-run for text.
- **L7 "Not verified": laser → CNC paste does not apply the destination's layer defaults.** P2 now shows it at store level: the pasted operation has no `cnc` block (`opCnc "none"`) until it is set by hand. Not raised; outside #1505.
- **L7 Refuted (by design): output-off artwork exports as ordinary.** Re-observed with a disabled operation and a LightBurn T1 tool layer (IO4).
- **L5-P3-1 and L5-P3-4** are listed as "Not done" in #1509. Not re-run.

## Refuter method

- **When:** 2026-10-29, from a fresh context without the auditor's reasoning.
- **Tree:**
  - `git fetch origin main` gives `4f71f1f41`, the audited SHA.
  - Every source file cited by the seven findings in `…\scratchpad\j7-main\` hash-matches `origin/main`.
  - ADR text was read from `origin/main` (`docs/decisions`, `DECISIONS.md`).
- **Repro command,** one file at a time from `j7-main`:

  `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=2048" node node_modules/vitest/vitest.mjs run <file> --config zz-n5r-vitest.config.ts --silent=false --disableConsoleIntercept`

  The config is the repo's `vitest.config.ts`, plus an `fflate` alias to the pnpm store copy and one worker.
- **Files and what each checked** (all deleted at the end):

  | File (under `j7-main\`) | Checked |
  |---|---|
  | `zz-n5r-vitest.config.ts` | The config |
  | `src\ui\state\zz-n5r-sketch.test.ts` | N5-P2-1, through the dialog's own builders (`sketchFromTemplate('custom')`, `appendSketchPrimitive`, a parameter change, `reviewConstrainedSketch` / `applyConstrainedSketch`), the toolbar's `buildSelectionTransformEdit` (lock off) and `compileJob`. Sweeps: 80 changes of 1 mm or more, 32 sub-mm changes, 32 plate and Rectangle template cases. Also one end-to-end case with the review size and the burn after Apply |
  | `src\ui\design-studio\zz-n5r-kept.test.tsx` | N5-P2-2 with the real persistence hook: restore the older autosave; decline the restore (blank start-up); control with a current autosave |
- **Other checks:**
  - **Novelty:** greps of `docs/audits/**` for `retained-source-scale`, `SCALE_EPSILON`, `holdsUnappliedWork`, pure-Apply loss, `colorForCutIndex` and the LightBurn palette. `gh pr list --state open` shows only #1478 (CNC and camera), which touches none of these files.
  - **LightBurn 1.7 Color Palette:** fetched 2026-10-29 from the versioned path (N5-P3-2).
- **Not done:** the packaged desktop app, a real crash, real pointer input, LightBurn itself, and hardware. N5-P3-1, P3-3, P3-4 and P3-5 were confirmed by reading both sides, on top of the auditor's runs.

## Refuted

The refuter refuted none of the seven findings.

One candidate was dropped by the refuter:

- **"Every distance-solved sketch reads as stretched after two typed fields."** No. A width or height change of 1 mm or more converges to about 1e-12 and folds: 0 of 80 cases. The plate and Rectangle templates (x/y constraints) fold in 0 of 32 cases. Only sub-mm changes, which stop after one solver step, trip N5-P2-1.

Candidates the auditor dropped before raising:

- **"The resize-while-open check can never fire, because the dialog passes the live transform."** No. `ConstrainedSketchControls.tsx:30` snapshots `source` into the session at open, and `ParametricPartControls` passes `editing.source`. The PR test drives the refusal.
- **"The fold moves a rotated, mirrored or grouped sketch."** No. Each unchanged re-apply moves the outline 0 mm (S3, S4, S4neg, S5). `applyTransform` scales about the local origin before mirror and rotation (`transform.ts:10-20`), and points scale about that origin.
- **"Scaling mm literals breaks expressions."** No. Only a number followed by `mm` is rewritten. `deg` and bare numbers are kept, and a ratio of two lengths is unchanged. The parser refuses mm × mm (`sketch-parameters.ts:101`).
- **"The compound disagrees with the compiler when objects carry different settings or power (non-uniform buckets)."** No. `ownedFillMaterial` also takes even-odd parity across every contributor (`fill-material-ownership.ts:36`, `cell.contributors.length % 2`), so the region is the same.
- **"An operation that appears in several runs is pooled per run."** No. `artworkOperationRuns` schedules each layer once (`artwork-order.ts:39-46`).
- **"The new beforeunload check can block a desktop close."** No. A native close arms the controller first, and `handleBeforeUnload` returns before the Studio check (`use-unsaved-changes-guard.ts:39`, `desktop-close-controller.ts:196-206`). A reload or navigation now shows the existing Leave/Stay dialog (`window-close-guard.ts:264-266`).
- **"The kept list drops a sixth drawing silently."** This is decided. ADR-590 Amd 1 item 2 says "past five, the oldest is dropped".

## Verified clean

- **ADR text against the code:**
  - ADR-573 Amd 1 items 1–4 match `scale-constrained-sketch.ts`, `scale-part-generator.ts`, `retained-source-scale.ts`, `constrained-sketch-actions.ts:96-112` and `prepare-part-generator.ts:150-159`, including the quoted notice text and the "negative scale keeps its sign" rule (S4neg: −1.5 → −1). The exception is the epsilon (N5-P2-1).
  - ADR-590 Amd 1 items 1–6 match the code, except item 1's premise (N5-P2-2).
  - ADR-681 items 1–4, ADR-468 Amd 2 and the ADR-431 amendment match `export-fill-compounds.ts`, `export-scene-svg.ts`, `export-svg-vector.ts`, `vector-artwork.ts`, `export-dxf.ts`, `import-toasts.ts:28-30` (count at :30) and `scene-clipboard-actions.ts:305-308`. The compound is written right after its first member's own group (`export-scene-svg.ts:78-84`, compound at :81-82). Item 2's "exact" test uses a 0.001 mm² tolerance (`export-fill-compounds.ts:195`).
  - ADR-681's Consequences sentence on the canvas was superseded the same day by ADR-683 (#1511), which cites ADR-681.
- **Compound against compiler:**
  - Per-path rule, then a union per object, then even-odd across objects, as `layer-fill.ts:193-251` does.
  - The traced-image direct path and the normalisation-failure fallback both use raw contours on both sides.
  - Per-object overrides change the bucket on both sides (IO7).
  - Text resolves non-zero on both sides (the PR's glyph cases).
- **Colour plan:** a path keeps its colour only when the colour is unique to its operation and not shared with another operation. Collisions fall back to the operations' own colours. Re-import gives one operation per colour (IO4: 3 → 3).
- **Paste:** no path is recoloured on any paste route. `createArtworkOperation` binds by id (`artwork-operation.ts:45-73`), and `protectUnownedLegacyPathBindings` binds legacy paths by id, so path-colour anchors stay valid (P1, P2).
- **#1509 teardown (exit-code spot check):**
  - #1509 touches no `electron/` file.
  - Its renderer teardown change is the object builder in `saveCurrentSession` (`use-design-session-persistence.ts:97`). `writePersistedSession` catches every storage error.
  - `designStudioHoldsUnappliedDrawing` cannot throw, and returns false at start-up (`documentEpoch` −1).
  - The new `onLostPointerCapture` and `onPointerCancel` handlers only end gestures in the Studio store.
  - Nothing here can change the main process exit code. N7 covers the rest.
- **Regressions against #1502, #1504, #1507/#1508 and #1511:**
  - The toolbar builder with #1502's tight bounds gives exact factors on exact geometry (S1, S2).
  - #1504's group rotation followed by a group scale folds exactly (S5).
  - Text export keeps its non-zero rule.
  - The draw-vector-strokes change from #1511 is type-only.

## Not verified

- **LightBurn's reading of the exported files.** LightBurn 1.7 says it matches imported colours to its palette, and asks for exact matches (N5-P3-2). It does not document how it maps a non-palette colour such as `#2563eb`. So it is unverified whether two KerfDesk operation colours can land on one LightBurn layer. LightBurn was not run.
- **Real pointer devices and the packaged desktop app.** jsdom only. The release run's non-zero exit was not reproduced (N7).
- **Real script fonts in a Fill compound.** The PR's synthetic glyph cases were relied on (#1507/#1508 text not rendered here).
- **CNC compile of a Fill-mode CNC operation holding script text.** CNC pockets read the raw contour pool, while the export writes the laser-resolved region for an object whose own contours overlap. Every CNC operation seen here is mode `line`, so the path is probably unreachable. Not run.

## Repro files

All files were created under `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\j7-main\`, and each was deleted individually after the runs. No `zz-n4*` file was opened or changed. No repo file other than this report was touched.

| File (under `j7-main\`) | What it did |
|---|---|
| `zz-n5-vitest.config.ts` | Repo config, an `fflate` alias and one worker. `N5_STUB=1505\|1509` aliases the parent versions below |
| `src\ui\state\zz-n5-sketch.test.ts` | S1–S9: the original L5-P1-1 repro through `buildSelectionTransformEdit`; two-field resize; rotate, mirror, negative scale, group and #1504 group rotation; Undo/Redo; part fold; the distance-solved sketch (N5-P2-1); the rendered notice |
| `src\ui\design-studio\zz-n5-kept.test.tsx` | K1–K6: pure Apply then stale autosave (N5-P2-2), the K1b control, File > New, desktop teardown flush, the held slot, a second page writing the slot, bar Restore cycling |
| `src\ui\state\zz-n5-paste.test.ts` | P1–P2: `.lbrn` part with a placed laser tab and CNC anchors through cross-project Paste in Place, Cut + Paste and Duplicate; laser → CNC paste with CNC tab rises |
| `src\ui\app\zz-n5-io.test.ts` | IO1–IO7: three-deep nesting, overlapping circles, LightBurn Scan+Cut and KerfDesk sub-layers, colours with a disabled operation and a T1 layer, the painted formats, a CNC operation's mode, an object with overlapping paths, a per-object Line override |
| `src\io\svg\zz-n5-stub5-export-scene-svg.ts`, `zz-n5-stub5-export-svg-vector.ts`, `src\io\vector-formats\zz-n5-stub5-vector-artwork.ts`, `src\io\dxf\zz-n5-stub5-export-dxf.ts`, `src\ui\state\zz-n5-stub5-scene-clipboard-actions.ts` | `git show 59a1ac49e:<file>` (parent of #1505), for test truth |
| `src\ui\state\zz-n5-stub9-constrained-sketch-actions.ts`, `zz-n5-stub9-prepare-part-generator.ts`, `src\core\parts\zz-n5-stub9-regenerate-part-generator.ts`, `src\ui\design-studio\zz-n5-stub9-design-studio-store.ts`, `zz-n5-stub9-use-design-session-persistence.ts`, `src\ui\workspace\zz-n5-stub9-draw-vector-strokes.ts` | `git show a486c9192:<file>` (first parent of #1509), for test truth |

```json
[
  {"id":"N5-P2-1","severity":"P2","area":"fix-studio-io","file":"src/core/scene/retained-source-scale.ts","line":21,"anchor":"Contract: ADR-573 Amd 1 item 1 (an even scale is folded); Twin: retained-source-scale.ts:19-20 comment vs its 1e-9 tolerance and the notice's equal percentages","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Typing W 120 then H 60 (lock off, the default) on a distance-solved 60 x 30 sketch (bounds 60.00000015 x 30.00000014) gives scaleX/scaleY 1.25e-9 apart; the editor shows 'stretched (width 200%, height 200%)', opens on 60 x 30 without folding, and Apply burns 60 x 30 instead of the canvas 120 x 60 (warned by the alert)","refuter":"CONFIRMED, P2 kept, wider reach. Own repro through the dialog builders (custom sketch + appendSketchPrimitive rectangle, parameter change, review/apply) and buildSelectionTransformEdit W then H (lock off by default, NumericEditsBar.tsx:115-118): any width/height change under ~1 mm stops the solver after one step with bounds ~1e-6 mm off; 24 of 32 such cases read 'stretched' with ratio diffs 3.3e-9..4.0e-8 (up to 40x the 1e-9 tolerance); changes >= 1 mm fold (0/80, templates 0/32). End to end 59.5x29.5 -> 60x30, W 120, H 60: canvas 120x60, editor 60/30, review 'Size 60.000 x 30.000 mm', burn after Apply 60x30. Not P1: the role=alert says applying returns it to the sizes here and the review line (required before Apply) prints the result size; the canvas shows 60x30 before Start"},
  {"id":"N5-P2-2","severity":"P1","area":"fix-studio-io","file":"src/ui/design-studio/design-kept-drawings.ts","line":52,"anchor":"Contract: ADR-272 Amd 3 (the drawing survives a crash; stash, then saved drawing, then blank); ADR-590 Amd 1 item 1 premise 'its project's own document holds it' is false after an older autosave; ledger route of L5-P1-2 'restoring one older than an Apply'","evidence":"REPRO","verdict":"CONFIRMED","known":"residual of v7 L5-P1-2 (pure-Apply variant)","summary":"A Studio drawing applied in the last 30 s before a crash: after restoring the older autosave the Studio opens the older drawing and overwrites the saved 3-line copy (slot [applied], kept []), no notice; with one more line drawn after the Apply it is kept. Raised to P1 by the refuter","refuter":"CONFIRMED, raised to P1. Own repro (real persistence hook, Studio Apply as use-design-apply.ts:45-55): slot [applied,l1,l2] dirty false before the crash; restore the older autosave and open -> [applied], slot [applied], kept []; declining the restore (blank start-up) -> [], slot [] - no route keeps it; control with a current autosave opens all three. AUTOSAVE_INTERVAL_MS 30_000 (autosave.ts:24). The offer reads 'Saved less than a minute ago. Restore it to continue where you left off.' (AutosaveRecoveryControl.tsx:52, use-autosave.ts:199-201): minute-granular, measured at restart, implies nothing is missing, never names the Studio drawing; no bar, no toast. Not a clear warning under METHOD 3; v7 'Losing design work also counts'; ADR-590 Amd 1 Context lists 'an Apply, after the last 30 s autosave' as a route it fixes and item 1's premise is false here. Case for P2 (coordinator): the same lines are lost from the workspace by the accepted 30 s autosave window"},
  {"id":"N5-P3-1","severity":"P3","area":"fix-studio-io","file":"src/io/svg/export-fill-compounds.ts","line":55,"anchor":"Twin: compiler fills enabled sub-layers (layer.ts:453-457) vs export reads only the parent operation's mode","evidence":"REPRO","verdict":"CONFIRMED","known":"class of v7 L7-P3-1","summary":"Plate + circle on a Line operation with a Fill sub-layer burn a 999.7 mm2 ring; SVG export writes two strokes; after re-import and setting Fill the burn is 1200 mm2","refuter":"CONFIRMED (READ of both sides + auditor REPRO), P3 kept. planFillCompounds gates on the top-level operation's effective mode (export-fill-compounds.ts:51-56,157); compileJob compiles every enabled sub-layer with its own mode (compile-job.ts:98-108, layer.ts:426-438,453-457); sub-layers are added from the Cuts list (LayerSubLayers.tsx:63). Burn unchanged until the operator re-sets the re-imported operation"},
  {"id":"N5-P3-2","severity":"P3","area":"fix-studio-io","file":"src/io/lightburn/lbrn-geometry.ts","line":422,"anchor":"Ground truth: LightBurn 1.7 Color Palette 'Use exact matches for the colors used by LightBurn to ensure layers are assigned properly' (T1 #F36926); Contract: ADR-681 item 1 'a LightBurn layer stay as authored'","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Only C00-C07 use LightBurn's colours; C08-C29, T1, T2 get hash colours (T1 -> #8042be) that the export keeps, so a LightBurn round trip loses the layer","refuter":"CONFIRMED, P3 kept. LightBurn 1.7 Color Palette re-fetched 2026-10-29 (versioned path): exact-match sentence verbatim; T1 #F36926, T2 #0C96D9, 08 #B4B4B4. colorForCutIndex hashes 8 -> #bbcd88, 30 (T1) -> #8042be, 31 (T2) -> #b7bc6f; T1/T2 = CutIndex 30/31 (lbrn-tool-layers.test.ts:5); no other palette copy in src"},
  {"id":"N5-P3-3","severity":"P3","area":"fix-studio-io","file":"src/ui/design-studio/design-session-storage.ts","line":62,"anchor":"Contract: ADR-590 Amd 1 item 1 decides the hold, not the silence; DesignTopBar.tsx:96 promises the drawing is kept","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"When the kept write fails the slot is held and the new project's drawing is never saved, with no notice; two pages sharing the slot overwrite each other's drawing without keeping it (latent: desktop single instance, no Studio in the browser Free build)","refuter":"CONFIRMED (READ + auditor REPRO), P3 kept. writePersistedSession returns while slotHeld (design-session-storage.ts:62), including the pagehide/unmount flush, so a held page does not save an unapplied drawing even on a normal close; the hold itself is decided by ADR-590 Amd 1 item 1, only the silence is not. Needs a failed kept write (quota, or a drawing within ~100 chars of the 2,000,000-char cap, design-kept-drawings.ts:106); two-page case latent"},
  {"id":"N5-P3-4","severity":"P3","area":"fix-studio-io","file":"src/ui/design-studio/DesignKeptDrawingBar.tsx","line":18,"anchor":"Contract: ADR-590 Amd 1 item 4 (bar names the newest); the bar's own 'N older kept'","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Restore keeps the replaced drawing as newest, so Restore cycles A<->C and an older kept drawing B is reachable only by discarding or applying the newer ones","refuter":"CONFIRMED (READ + auditor REPRO), P3 kept. Bar shows kept[0] only (DesignKeptDrawingBar.tsx:18-21); restore keeps the replaced drawing with keptAt Date.now() (design-kept-drawing-actions.ts:43) and the list sorts newest first (design-kept-drawings.ts:66). Older drawings reachable by applying or discarding newer ones; nothing lost below the cap"},
  {"id":"N5-P3-5","severity":"P3","area":"fix-studio-io","file":"src/ui/state/retained-source-canvas-resize.test.ts","line":40,"anchor":"METHOD L7","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"No test for a two-field resize of a solved sketch, a stale autosave after a pure Apply, a Fill sub-layer export, or LightBurn colours above C07; every fix test fails on the parent commit (guards pass, as expected)","refuter":"CONFIRMED (READ), P3 kept. Greps on main confirm each gap; adds one: no test changes a sketch parameter by under 1 mm and then resizes (N5-P2-1's ordinary trigger)"},
  {"id":"L7-P3-3","severity":"P3","area":"fix-studio-io","file":"src/io/svg/svg-import-entries.ts","line":38,"anchor":"as v7","evidence":"REPRO","verdict":"KNOWN","known":"v7 L7-P3-3","summary":"A Fill compound and its members re-import as one object"},
  {"id":"L7-P3-1","severity":"P3","area":"fix-studio-io","file":"src/io/dxf/dxf-writer.ts","line":314,"anchor":"as v7","evidence":"READ","verdict":"KNOWN","known":"v7 L7-P3-1","summary":"Class of N5-P3-1; not re-run for text"},
  {"id":"L7-NV-cnc-paste","severity":"P3","area":"fix-studio-io","file":"src/ui/state/scene-clipboard-actions.ts","line":233,"anchor":"as v7 Not verified","evidence":"REPRO","verdict":"KNOWN","known":"v7 L7 Not verified (laser -> CNC paste without destination defaults)","summary":"Pasted operation in a CNC project has no cnc block until set by hand; placed CNC tabs themselves land correctly"},
  {"id":"L7-R-output-off","severity":"P3","area":"fix-studio-io","file":"src/io/svg/export-fill-compounds.ts","line":81,"anchor":"ADR-350 item 5 (by design)","evidence":"REPRO","verdict":"KNOWN","known":"v7 L7 Refuted","summary":"Disabled operation and LightBurn T1 tool layer export as ordinary artwork"},
  {"id":"L5-P3-1/L5-P3-4","severity":"P3","area":"fix-studio-io","file":"src/ui/design-studio/project-design-session.ts","line":44,"anchor":"as v7","evidence":"READ","verdict":"KNOWN","known":"v7 L5-P3-1, L5-P3-4 (Not done in #1509)","summary":"Not re-run"}
]
```
