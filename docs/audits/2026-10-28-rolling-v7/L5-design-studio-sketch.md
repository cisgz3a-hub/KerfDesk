# Rolling audit v7 — L5 Design Studio and constrained sketches

- **When:** 2026-10-28, about 17:00–18:10 +0800.
- **Tree:** origin/main @ `47ff19d8d` (#1500), fetched at the start.
  - **Repros ran on the scratchpad copy `…\scratchpad\j7-main\`** (main `6e388bb56`). `git diff --stat 6e388bb56 origin/main -- src` touches only laser streaming, controllers, network serial and Job Review files; no file under L5's scope changed.
  - **Tree check.** 716 files were compared with `git show origin/main:<path> | cmp - j7-main/<path>`, all byte-identical: `src/core/sketch-constraints/**`, `src/core/design/**`, `src/ui/design-studio/**`, `src/ui/layers/**`, `src/core/shapes/**`, `src/io/project/**`, `constrained-sketch-actions.ts`, `constrained-sketch-bindings.ts`, `design-apply-mutation.ts`, `design-apply-record.ts`, `object-insert-actions.ts`, `collect-line-segments.ts` and `selection-transform.ts`.
  - **fflate alias.** The junctioned `node_modules` has no top-level `fflate`, so every repro used a temporary `zz-l5-vitest.config.ts`: the repo config plus one alias to `.pnpm/fflate@0.8.3/…/esm/browser.js`, with `maxWorkers: 1`.
  - **Command,** from `j7-main`, one file at a time: `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=3072" node node_modules/vitest/vitest.mjs run <file> --config zz-l5-vitest.config.ts --silent=false --disableConsoleIntercept`.
  - **Pro.** Design Studio and the constrained sketch are Pro surfaces (`DesignStudioButton.tsx:16` `requestProFeature('design-studio', …)`). Every repro imports the modules directly, so no `--mode desktop` build was needed.
- **Scope:**
  - **Constraint solver** (`src/core/sketch-constraints/*`): damped least squares (`solve-constrained-sketch.ts`), analytic Jacobian, rank and nullspace, validation, parameters and the solve summary. Its editor is the **Create / Edit constrained sketch…** dialog (`src/ui/layers/ConstrainedSketch*.tsx`, `Sketch*.tsx`) and the store actions in `constrained-sketch-actions.ts`. Governing decision: ADR-573 (retained design); there is no separate sketch ADR.
  - **Design Studio** (ADR-272 and Amds 1–4, ADR-590): the entities and their geometry; fillet, chamfer and extend; snap; sketch bounds; materialisation (`to-scene-object.ts`) and Apply (`design-apply-mutation.ts`); the Shape Inspector fields and their unit entry; design history and Undo; session storage and recovery (`design-session-storage.ts`, `design-recovery-*`, `use-design-session-persistence.ts`); layers; the project document and its reconciliation (`project-design-session.ts`).
  - **Not repeated:** arrange, scale, stretch, translate and the 90° transforms (covered by L4, all exact); the fillet and chamfer option boxes' unit entry (L2-P3-5).
- **Lenses run:**
  - **L2 ground truth:** analytic rectangles, a 30-40-50 triangle, conflicting and degenerate systems, 60° and 90° fillets and chamfers, ray–circle, ray–ellipse and ray–rounded-corner contacts. Each was checked against the solved geometry, the materialised scene object and `compileJob` + `grblStrategy.emit` G-code.
  - **L3 twins:**
    - constrained-sketch dialog against workspace transform against G-code;
    - Design Studio canvas against main canvas against G-code;
    - Design Studio against workspace edits;
    - `.lf2` round trip;
    - recovery draft against autosave.
  - **L4 adversarial:** zero-length starts, coincident points with a distance, horizontal plus vertical on one line, two values for one coordinate, near-tolerance conflicts (60 against 60.00001…60.001), collinear and mirrored starts, a 20-step drag of an under-constrained sketch, a chamfer equal to half a side, a fillet larger than the corner.
  - **L7 test truth:** existing tests were read for each finding.
  - **L9 parity:** Design Studio has no remote/MCP entry (no reference in `src/ui/remote-control` or `electron/mcp`). Remote transforms of applied parts reach the same workspace twins.
- **Counts:** 10 raised → 0 refuted (refuter: 10 confirmed; L5-P3-2 narrowed, its rounded-rectangle half refuted as deliberate) → P1 2 / P2 1 / P3 7 (+ 3 KNOWN re-observed).
- **Refuter (fresh context, 2026-10-28 ~18:00–18:40 +0800).** `git diff --stat 6e388bb56 origin/main` (main `47ff19d8d`) touches no L5 file: only laser streaming, controllers, network serial, Job Review and one `main.tsx` wiring line. Own repros ran in `j7-main` as `zz-l5r-*` files with a `zz-l5r-vitest.config.ts` (`fflate` alias, one worker), one file at a time, then deleted. They drove the real **Edit constrained sketch…** dialog and the real `NumericEditsBar` (React root), the real Design Studio store and persistence hook, `emitGcode` and the workspace painter. Open PRs: #1502 (L2 shape sizes) bakes a resize into a **rounded `shape` rectangle** only (`rectangle-resize.ts`), so it does not touch constrained sketches, generated parts or Studio entities; #1501 and #1478 do not touch L5 files.

## Headline

The solver and the Design Studio geometry are accurate. The solved coordinates match analytic answers to about 1e-6 mm (the refuter saw up to 2.2e-6 mm on a 72.5 × 18.25 rectangle, inside the 1e-5 residual tolerance). Conflicts are reported by constraint and are never applied. Fillets, chamfers and extends land on the exact analytic points, and typed Inspector values reach the G-code unchanged. Undo and Redo are exact across 18 states of 20 operations, and a `.lf2` round trip keeps every applied entity kind.

The defects are in the joins between the sketch and the rest of the app.

- **L5-P1-1.** A constrained sketch that was resized on the canvas keeps that scale. Every dimension typed later in the sketch dialog then burns at that scale, while the dialog shows the typed value and its own "Size" readout. In the repro the canvas W went 60 → 120. The operator then typed width 80 and hole Ø6, and the dialog reported "Size 80.000 × 30.000 mm, fully-constrained". The G-code cut 160 × 60 with Ø12 holes, and nothing warned.
- **L5-P1-2.** An unapplied Design Studio drawing is discarded whenever the Studio opens on a project whose recovery key differs from the one the drawing was saved under. Its saved copy is then overwritten. Two everyday cases trigger it: opening the Studio on the blank start-up project before restoring the autosave, and an autosave a few seconds older than the drawing (any object added or removed, or an Apply, in the last 30 s before a crash). Both were reproduced: 3 entities saved, then 0 restored and 0 stored.
- **L5-P2-1.** A closed polyline or chamfered rectangle from the Studio burns closed, but the desktop main canvas draws it without its closing edge. The Studio's own 2D and 3D views and the phone preview draw it closed.

## Accuracy

Solver rows come from `solveConstrainedSketch`. Design Studio rows go through `applyDesignSketch` → `compileJob(DEFAULT_DEVICE_PROFILE)` → `grblStrategy.emit`, which flips Y on the 400 mm bed.

| Sketch | Constraint | Expected | Solved | Materialised | Output (G-code) | Verdict |
|---|---|---|---|---|---|---|
| Rectangle, skewed start | A fixed, 4 × H/V, AB 60, AD 30 | (0,0) (60,0) (60,30) (0,30) | (0,0) (60.000001,0) (60.000001,30.000001) (0,30.000001); fully, DOF 0, residual 4.6e-7 | — | — | exact (1e-6) |
| Same, B started at x −40 / D started below | unsigned distances | a valid rectangle | mirrored branch (B at −60 / D at −30), fully | — | — | valid; the review preview shows the branch |
| Same, right vertical removed | 3 × H/V | 1 free DOF | under-constrained, DOF 1 (C free in x) | — | — | reported |
| Default bracket, width 75 | parameter expressions `width/4`, `3*width/4`, `height/2` | B (75,0); holes (18.75,15), (56.25,15), Ø4 | exact; fully; 3 redundant | at width 60: 60 × 30, Ø4 | 60 × 30, Ø4 × 4 | exact |
| Triangle | A fixed, B on y=0, AB 50, AC 30, BC 40 | C (18, ±24) | (18, 24) from (20,20), (0,0), (−30,5), collinear; (18, −24) from (18, ±0.5), (25,0), (60,0) | — | — | exact; side follows the start |
| Triangle 30 / 10 / 10 | impossible | conflict | over-constrained; ab, ac, bc 3.333 mm | not built | Apply refused | reported |
| Triangle 20 / 10 / 10 | collinear (degenerate) | C (10, 0) | (10, 0.003836); fully; residual 7.4e-7 | — | — | within the 1e-5 residual tolerance (3.8 µm bump) |
| Rectangle, top width 70 against bottom 60 | conflict | conflict | over-constrained; w, w2, lv, rv 2.5 mm | not built | refused | reported |
| Top 60.00001 / 60.00002 against 60 | inside tolerance | accepted | fully; residual 2.5e-6 / 5e-6 | — | — | accepted (0.00001 mm) |
| Top 60.0001 / 60.001 against 60 | outside tolerance | conflict | over-constrained; residual 2.5e-5 / 2.5e-4 | not built | refused | reported |
| Equal (bottom = left) with 60 × 30 | conflict | conflict | over-constrained; eq, w, h 10 mm | — | refused | reported |
| One line horizontal **and** vertical, length 10 | conflict | conflict | over-constrained; h 1.97, v 4.60, len 5.00 | — | refused | reported |
| Coincident + distance 10 | conflict | conflict | over-constrained; co 4.60, d 5.00 | — | refused | reported |
| Point x = 10 and x = 12 | conflict | conflict | over-constrained; x1, x2 1.0 | — | refused | reported |
| Zero-length start, horizontal (vertical), distance 10 | — | B (15,5) / (5,15) | exact; residual 4.6e-13 | — | — | exact |
| Free rectangle, C dragged 20 × (+5, +5) | H/V + 60 × 30, no position | rigid motion | every step under-constrained, DOF 2, w 60.00000, h 30.00000 | — | — | stable |
| Constrained circle | diameter 200 | r 100 | r 100 | curves: two exact 180° arcs; compatibility polyline a 64-gon (0.120 mm sag) | compile flattens the curves (`compilation-polylines.ts:20-32`) | exact |
| **Bracket after canvas W × 2, then typed width 80, hole Ø6** | dialog parameters | 80 × 30, Ø6 | 80 × 30, Ø6; dialog "Size 80.000 × 30.000 mm" | `transform.scaleX/Y` 2 kept | **160 × 60, Ø12** | **L5-P1-1** |
| Studio rect 40 × 20, fillet 5 | parametric radius | corner arcs r 5 | `cornerRadiusMm` 5 | `createRectangle` spec | box 40 × 20; corner radius error 0.0013 | KNOWN L2-P3-1 (cubic) |
| Studio rect 40 × 20, chamfer 5 | setback along both legs | 8 vertices; 45° edges 7.0711 | (20,35) (25,30) (55,30) (60,35) (60,45) (55,50) (25,50) (20,45) | closed polyline, no seam vertex | 1 closed cut: 7.0711, 30, 7.0711, 10 ×2 | burn exact; **main canvas drops the (20,45)→(20,35) edge (L5-P2-1)** |
| Path, 90° corner, fillet 8 | — | centre (32,8); tangents (32,0), (40,8) | exact (radius error 3.6e-15) | baked chords | — | exact (chords: L5-P3-3) |
| Path, 60° corner, fillet 5 | — | centre (8.660254, 5); tangent (4.330127, 7.5) | (8.6603, 5), (4.330127, 7.5) | — | — | exact |
| Path, 60° corner, chamfer 5 | — | (2.5, 4.330127), (5, 0) | same | — | — | exact |
| Rect 10 × 40, chamfer 5 | half the short side | 6 distinct vertices | 8 points, two doubled: (5,0) ×2, (5,40) ×2 | — | — | L5-P3-6 |
| Studio circle r 25 | Radius field 25 | Ø50 | — | ellipse spec 50 × 50 | box 50 × 50; radius 24.9998–25.0068 | KNOWN L2-P3-1 |
| Studio arc r 20, sweep 90 | fields | arc length 31.4159, chord 28.2843 | fields exact | baked at 0.05 mm chords | box 20 × 20 | exact (chords: L5-P3-3) |
| Arc length typed 50 at sweep 90 | — | r 31.830989 | 31.830988618 | — | — | exact |
| Line 50 at 30° | — | 50 | — | baked | 49.9998 (3-decimal G-code) | exact |
| Extend line y = 3 to circle (50,0) r 10 / rounded corner r 5 / ellipse 12 × 6 / arc | — | x 40.460608 / 40.417424 / 39.607695 / 40.460608 | 40.46061 / 40.41742 / 39.6077 / 40.46061 | outline 0.0476 / 0.0083 / 0.0351 mm away (chords) | — | exact to the analytic shape |

## Findings

### L5-P1-1 — A constrained sketch resized on the canvas keeps that scale: every dimension typed later in the sketch dialog burns at that scale, while the dialog shows the typed value and its own "Size" readout

- **Where:**
  - `src/ui/state/constrained-sketch-actions.ts:91-106`. An edit spreads the existing object (`...(source ?? {…, transform: IDENTITY_TRANSFORM})`), so `transform.scaleX/Y` survive regeneration. Only a new sketch gets the identity transform.
  - `src/ui/layers/SketchSolveReview.tsx:34-41`. "Size … mm" is `review.object.bounds`, the unscaled local box.
  - `src/core/sketch-constraints/materialize-constrained-sketch.ts:63-78`. `sketchGeometryMatches` compares only local paths, so `replacesManualGeometry` stays false.
  - **Sibling (READ):** `src/core/parts/regenerate-part-generator.ts:26-31` (`...object`) does the same for **Create parametric part**.
- **Anchor:**
  - **Contract: ADR-573.** "retained design editors must disclose a materialized mismatch and offer reviewed reapply or bake rather than silently replace those edits"; and "Verify analytical dimensions".
  - **Contract: `prepare-dimensioned-vector.ts:9`.** "Stage dimensioned artwork at its authored size". `constrained-sketch-regeneration.test.ts:100-102` pins `scaleX` 1 for a new sketch.
  - **Round precedent (LEDGER).** A typed value that burns differently while still shown is P1, and the canvas is not a warning.
- **Scenario:**
  1. Create the default constrained bracket (60 × 30, two Ø4 holes) and apply it.
  2. Resize it on the canvas to W 120. The toolbar and the handles scale `transform.scaleX/Y` (`selection-transform.ts:312-328`, from L2), and nothing stops a retained sketch being resized.
  3. Open **Edit constrained sketch…**. The parameters still read width 60 and hole_diameter 4.
  4. Type width 80 and hole_diameter 6, then **Review solved geometry**. The dialog shows "fully-constrained … Size 80.000 × 30.000 mm" and no manual-edit alert.
  5. **Apply reviewed sketch** → the G-code cuts **160 × 60 with Ø12 holes**.
- **Evidence:** REPRO, `src/ui/state/zz-l5-twins.test.ts` T1, through the real store actions:
  - `T1-applied {"transform":{…"scaleX":1…},"burn":[{"w":60,"h":30},{"w":4,"h":4},{"w":4,"h":4}]}`.
  - `T1-after-resize {"transform":{…"scaleX":2,"scaleY":2…},"burn":[{"w":120,"h":60},{"w":8,"h":7.956},…]}`.
  - `T1-review {"dialogSize":[80,30],"replacesManualGeometry":false,"status":"fully-constrained","transform":{…"scaleX":2…}}`.
  - `T1-after-edit-burn (typed width 80, hole 6) [{"w":160,"h":60},{"w":12,"h":12},{"w":12,"h":12}]`.
- **Severity:** P1. Every typed dimension burns 2× (or at any canvas scale, non-uniform too) while the dialog, its Size readout and its status all show the typed value. No message names the scale. The canvas W is not a warning (round precedent).
- **Refuter:** CONFIRMED, P1 kept. Reproduced end to end through the rendered dialog and the rendered toolbar (`zz-l5r-scale.test.tsx`):
  - **Uniform.** Create the bracket in the dialog and apply it, then type toolbar W 120 and H 60 (`scaleX/Y` 2). **Edit constrained sketch…** opens on width 60, height 30, hole_diameter 4, with no mention of the scale. Typing width 80 and hole 6, then Review, shows `fully-constrained`, "Size 80.000 × 30.000 mm" and no alert. After Apply the dialog closes and the G-code cuts **160 × 60 with Ø12 holes**. The toolbar then reads W 160, but no hole size is shown anywhere.
  - **W only** (scaleX 2, scaleY 1). The same review reads 80 × 30, and the burn is **160 × 30 with 12 × 6 elliptical "Ø6" holes**.
  - **Generated-part sibling, now REPRO.** Make a Panel, then type toolbar H 80 (scaleY 2). Preparing width 80 and hole 6 previews bounds 80 × 40 and keeps scaleY 2, so the burn is an 80 × 80 outline with 6 × 12 holes.
  - **No ADR decides it.** ADR-573 is silent on scale. "Manual path changes … must disclose a materialized mismatch" covers path edits, and a transform scale leaves `sketchGeometryMatches` true. The regeneration test pins only that the transform object is kept (`constrained-sketch-regeneration.test.ts:85`), and that test uses the identity transform. `prepare-dimensioned-vector.ts:9` ("Stage dimensioned artwork at its authored size") is verified. Nothing guards a resize of a retained sketch: `ConstrainedSketchControls`, `SelectedObjectProperties.tsx:112` and the toolbar have no scale notice.
  - **No overlap with #1502.**
- **Fix direction:** On review, either reset the scale to 1, keeping the placement anchor, and say so; or show the effective size (local bounds × scale) together with a mismatch notice that offers Bake or Reset scale. Apply the same treatment to the part generator.

### L5-P1-2 — An unapplied Design Studio drawing is discarded, and its saved copy overwritten, when the Studio opens on a project whose recovery key differs: the blank start-up project, or an autosave a few seconds older than the drawing

- **Where:**
  - `src/ui/design-studio/design-studio-store.ts:397-419`. `restoredOwnedSession` restores the saved draft only when `saved.projectOwner` equals the current project's key; otherwise it falls back to `restoreProjectDesignSession(project)` (applied state only, or blank).
  - `:366-372`. The fallback session is published.
  - `use-design-session-persistence.ts:51` (subscribe → `scheduleSave`) and `:80-105`. The fallback is then written over the single slot `laserforge.design-studio-session.v1` (`design-session-storage.ts:21`).
  - `design-recovery-owner.ts:9-21`. The key hashes the Studio document, the active sheet and every object's id and kind, so adding or removing any object, or an Apply, changes it.
  - `autosave.ts:24`. `AUTOSAVE_INTERVAL_MS = 30_000`. A crash fires no `beforeunload`, and large projects already recover the last interval snapshot (`use-autosave.ts:6-8`).
  - Nothing outside `src/ui/design-studio` reads `dirtySinceApply`, so no unsaved-work prompt covers an unapplied drawing.
- **Anchor:**
  - **Contract: ADR-272 Amd 3.** The amendment exists because "a refresh, a crash, or a closed tab discarded the drawing outright"; "The durable slice is written to `localStorage`"; precedence "the in-memory stash first …, then the saved drawing, then blank".
  - **Contract: ADR-590.** Protects only against "an unrelated local recovery draft". In route 1 the draft belongs to the same document.
  - **Contract: AREAS v7.** "Losing design work also counts."
- **Scenario:**
  1. **Stale autosave (same document).** Project with one object; the autosave holds it. Draw three entities in the Studio and close it without applying (Close stashes and never prompts). Within 30 s, add any object on the main canvas; the app crashes. On restart, restore the autosave and open the Studio: the drawing is gone, and the stored draft is overwritten.
  2. **Blank start-up first.** After a crash or a normal restart, KerfDesk starts on a blank project and offers autosave recovery without blocking. If the operator opens Design Studio first, the draft is replaced by an empty one. Restoring the autosave afterwards brings nothing back.
  3. **Another project (READ, same code path as route 2).** Opening the Studio on any other project or sheet replaces the single slot. Reopening the first project then restores only its last Apply.
- **Evidence:** REPRO, `src/ui/design-studio/zz-l5-recovery.test.tsx`, with the real persistence hook (React root, fake timers) and real `serializeProject`/`deserializeProject`:
  - `R-saved-after-draw {"entities":3,"owner":"sha256:2"}`, then after the workspace add `{"entities":3,"owner":"sha256:9"}`.
  - **Control** (autosave current): `R1-control {"restoredEntities":["l1","l2","c1"],"storedAfterOpen":3}`.
  - **Route 1:** `R1-lag {"restoredEntities":[],"storedAfterOpen":0}`.
  - **Route 2:** `R2-blank-open {"epoch":0,"entities":0,"storedAfterBlankOpen":0}`, then `R2-after-restoring-autosave {"restoredEntities":0}`.
- **Severity:** P1. Design work is lost silently and permanently (the only copy is overwritten), on an ordinary restart path. The existing persistence test covers only a current save and reopen (`design-session-persistence.test.tsx:55-95`).
- **Refuter:** CONFIRMED, P1 kept. Reproduced with the real persistence hook (React root, fake timers), `createAutosaveProjectSnapshot` + `serializeProject`/`deserializeProject`, `setProject` (the restore call `runAutosaveRecovery` makes), and a restart that keeps `localStorage` (`zz-l5r-recovery.test.tsx`):
  - **Control:** current autosave → `["l1","l2","c1"]` restored, 3 stored.
  - **Route 1, workspace add after the last autosave:** saved owner `f9a2…` → `4828…` after the add; restore the older autosave and open → **0 entities, stored 0**, no toast.
  - **Route 1b, Apply after the last autosave** (real `applyDesignSketch` + `markApplied`, one more line drawn): 4 entities stored → open after restore → **0, stored 0**.
  - **Route 2, Studio first on the blank start-up project (epoch 0), then a *current* autosave restored:** blank open stores 0 (no owner); the later restore brings back **0**. Control without the early open: all 3 restored.
  - **No other copy.** `laserforge.design-studio-session.v1` is the only slot (`design-session-storage.ts:21`); the stash is memory only; `designStudioDocument` is written only by Apply (`design-apply-mutation.ts:122`); the autosave carries the project only. **No warning:** no toast or prompt on the open path; the unsaved-changes guard reads only `dirty` (`use-unsaved-changes-guard.ts:39-41`); the Studio's **Close** tooltip even promises "your drawing is kept without applying it" (`DesignTopBar.tsx:96`).
  - **Correction (L7).** The tests do more than cover a current reopen: they **pin the overwrite** for a replacement project (`design-session-persistence.test.tsx:97-122` asserts the stored draft becomes `[]`) and pin no recovery for a changed revision (`project-design-session.test.ts:90-136`). Not restoring a foreign draft is deliberate (ADR-590: "an unrelated local recovery draft cannot replace it"). But no ADR decides to *destroy* it. ADR-272 Amd 3 item 4 keeps "the saved drawing" ahead of blank, and in routes 1/1b the draft is the same document's. A fix must change those tests.
  - **Reach.** Route 2 needs no crash: any restart where the operator opens the Studio before File > Open of the saved `.lf2` takes the same `restoredOwnedSession` path (READ).
- **Fix direction:**
  - Never overwrite a draft whose owner differs. Keep drafts per owner, or keep the last foreign draft until it is restored or explicitly discarded.
  - When the key does not match, offer the draft ("A Design Studio drawing from another session is available") instead of dropping it.
  - Consider counting unapplied Studio work in the unsaved-changes prompt.

### L5-P2-1 — A closed polyline or chamfered rectangle from Design Studio burns closed, but the main canvas draws it open (the closing edge is missing)

- **Where:**
  - `src/core/design/entity-geometry.ts:98-101`. `pathPolyline` strips the seam vertex ("closure in its flag").
  - `src/core/design/to-scene-object.ts:127-137`. The baked `imported-svg` carries those polylines and no `curves`.
  - `src/ui/workspace/draw-vector-strokes.ts:9-26`. `strokePolylinesBatched` only does moveTo/lineTo and never closes.
  - `object-display.ts:164-166` and `draw-scene.ts:420-428` reach it.
  - Producers: closing a polyline (`design-point-pointer.ts:128-133`) and chamfering a rectangle (`design-corner-apply.ts:86-104`).
  - The Studio closes the path itself (`design-canvas-draw.ts:186`; `viewport3d/viewport-overlay.ts:132`). Compile closes it (`collect-line-segments.ts:189`).
- **Anchor:**
  - **Twin.** Studio 2D/3D view and G-code (closed) against main canvas (open).
  - **Contract: `sketch-path-geometry.ts:47-49`.** "The stroke renderer does not closePath; a closed profile needs its closing edge as an explicit final segment" — the constrained-sketch materialiser already applies this fix.
- **Scenario:** Chamfer a 40 × 20 rectangle (5 mm) in the Studio and Apply. The main canvas shows seven of its eight edges; the 10 mm left edge (20,45)→(20,35) is missing, yet the laser cuts it. A polygon drawn by clicking back on its first point shows the same gap.
- **Evidence:** REPRO, `src/ui/state/zz-l5-design-output.test.ts` D2:
  - `D2-rect-chamfer-gcode {…"cuts":1,"closingGapMm":0,"edges":[7.0711,30,7.0711,10,7.0711,30,7.0711,10]}`.
  - `D2-rect-chamfer-canvas {"objectKind":"imported-svg","paints":["stroke"],"calls":["moveTo(20,35)","lineTo(25,30)",…,"lineTo(20,45)","stroke"]}`, recorded from the real `resolveObjectDisplay` and `paintObjectDisplay`, which `draw-scene.ts` uses.
- **Severity:** P2. Visible wrong display of a burned edge. The burn is correct and matches the Studio. The phone preview resolves the same display polylines (`remote-control/scene-projection.ts:158`, READ).
- **Refuter:** CONFIRMED, P2 kept. `zz-l5r-closed.test.ts`, through the real `setChamferDistanceMm` + `applyCorner` on the Studio store, then `applyDesignSketch`, `resolveObjectDisplay`/`paintObjectDisplay` with a recording context, and `emitGcode`:
  - **Chamfered 40 × 20.** The canvas calls are `moveTo(20,35)` … `lineTo(20,45)`, `stroke`, with no `closePath` (7 edges). The G-code makes 1 cut with edges `[7.0711,30,7.0711,10,7.0711,30,7.0711,10]` and ends at its start.
  - **Closed Studio triangle.** The canvas strokes 2 of 3 edges (`moveTo(10,10) lineTo(60,10) lineTo(35,50)`), while the G-code cuts all 3 `[50,47.1699,47.1699]`.
  - **Correction.** The phone preview does **not** show the gap. `scene-projection.ts:166-168` forwards `closed`, and the phone renderer appends `Z` (`services/remote-control/app/src/core/scene.ts:54`). Only the desktop main canvas, which paints through `strokePolylinesBatched`, draws it open.
  - **Severity.** Not raised to P1: the burn is what the operator drew, and the Studio shows the same closed shape.
- **Fix direction:** Apply `withClosingPoint` in `bakedObject`, as `sketch-path-geometry.ts` does, or close closed polylines in `strokePolylinesBatched`.

### L5-P3-1 — Moving an applied Studio part 1 mm on the main canvas silently removes it from the Studio drawing, along with any unapplied Studio edits to it and the Studio Undo history

- **Where:** `src/ui/design-studio/project-design-session.ts:44-75`, with `geometrySignature` (`:78-92`) including `transform.x/y`. When any entity is detached, the history is rebuilt with `createDesignHistory` (`:64`). The store calls it on every open, from the stash too (`design-studio-store.ts:361`). Nothing tells the operator.
- **Anchor:** **Contract: ADR-590.** "Existing artwork modified outside Studio takes precedence over stale sketch geometry … only unchanged owned entities are restored". The precedence is decided; the silence and the loss of unapplied edits are not. ADR-272 clause 9: operations that cannot apply "surface a message".
- **Scenario:** Apply a plate and a hole, then nudge the plate 1 mm on the main canvas and reopen the Studio. The plate is gone from the drawing and only the hole remains. Any unapplied change to the plate made before closing is lost too.
- **Evidence:** REPRO, `zz-l5-twins.test.ts` T2: `T2-reopen-after-1mm-move {"entities":["hole"],"applied":["obj-hole"]}`. Control: `.lf2` round trip unchanged `["plate","hole"]`.
- **Severity:** P3. The burn keeps the workspace object, so no output is wrong. The cost is lost editability and surprise.
- **Refuter:** CONFIRMED, P3 kept. `zz-l5r-spot.test.ts`:
  - **Repro.** Apply a plate and a hole. Make an *unapplied* plate width edit (60 → 70) and close the Studio. Move the plate +1 mm with `applySelectionTransforms`, then reopen. The result is `{"entities":["hole"],"applied":["obj-hole"],"canUndo":0}`, so the unapplied width edit and the Studio Undo history are gone, with no notice.
  - **Why P3.** ADR-590 decides the precedence ("only unchanged owned entities are restored as editable sketch primitives").
  - **For the coordinator.** That ADR calls the sketch geometry "stale", and an unapplied edit made after the Apply is not stale. A 1 mm bed-placement nudge is ordinary. P2 is arguable if the ADR is read as covering only the applied state.
- **Fix direction:** Show a notice naming the detached parts. Re-place a part that was only translated instead of detaching it.

### L5-P3-2 — Snap targets off the outline: a rounded rectangle offers "endpoint" snaps at its sharp virtual corners, 2.07 mm off the burned outline at r 5; a closed path has no snap at the midpoint of its closing edge

- **Where:** `src/core/design/snap/entity-snap-points.ts:99-125` (corners regardless of `cornerRadiusMm`) and `:127-139` (midpoints only for `index + 1 < points.length`).
- **Anchor:** **Twin.** `sketch-bounds.ts:3-4` says the Studio measures "MATERIALIZED geometry … exactly what gets cut". Snapping to the endpoint should land on the cut geometry.
- **Evidence:** REPRO, `src/core/design/snap/zz-l5-snap.test.ts` S1: `S1-rounded-rect-corner {"snap":{"kind":"endpoint","atMm":{"x":0,"y":0}},"distanceFromOutlineMm":2.0711}` (r(√2 − 1)); `S1-closed-path-closing-edge-midpoint null`.
- **Severity:** P3. The snapped result is shown on the canvas.
- **Refuter:** CONFIRMED, **narrowed**. `zz-l5r-spot.test.ts`:
  - **Closing-edge midpoint: confirmed.** For a closed triangle (0,0) (40,0) (0,30) the midpoints are `(20,0)` and `(20,15)`; `(0,15)` is missing. The point-on-line snap does include the closing edge (`snap-segments.ts:31`), so only the midpoint target is missing.
  - **Rounded-rectangle corners: deliberate, moved to Refuted.** `entity-snap-points.ts:118-120` says: "The nominal corners stay available even on a rounded rectangle: they are what the operator dimensioned, and the arc … is still reachable through the point-on-line snap". This is the CAD virtual-sharp convention.
- **Fix direction:** For rounded rectangles, offer the tangent points of each corner arc (or its midpoint). Add the closing-edge midpoint for closed paths.

### L5-P3-3 — Studio arcs and path fillets are baked at the 0.05 mm import chord tolerance, twice the 0.025 mm machine tolerance its circles and every curve path use

- **Where:** `src/core/design/entity-geometry.ts:49-57` and `ops/fillet-corner.ts:84`, through `sampleArcPoints` with `ARC_CHORD_TOLERANCE_MM = 0.05` (`core/geometry/arc-sampling.ts:9`). Curves compile at `DEFAULT_MACHINE_CURVE_TOLERANCE_MM = 0.025` (`curve-path.ts:14`).
- **Anchor:** **Twin.** A Studio circle (an ellipse spec flattened at 0.025) against a Studio arc or fillet of the same radius. The `fillet-corner.ts:3-5` comment justifies the import tolerance ("no coarser than an imported one"). ADR-272 Consequences accepts arcs as polylines, but not at what tolerance.
- **Evidence:** REPRO, `zz-l5-snap.test.ts` E1: the extend contact on the analytic r 10 circle is 0.0476 mm from the materialised arc chords (0.0351 mm for the 12 × 6 ellipse). By analysis, r ≥ 20 reaches the full 0.05 mm; a r 5 fillet uses the 15° cap (sag 0.043 mm).
- **Severity:** P3. Inside every arc, up to 0.05 mm, and below a typical kerf.
- **Refuter:** CONFIRMED, P3.
  - **Constants read.** `ARC_CHORD_TOLERANCE_MM = 0.05` (`arc-sampling.ts:9`) and `DEFAULT_MACHINE_CURVE_TOLERANCE_MM = 0.025` (`curve-path.ts:14`).
  - **Own run.** A 90° r 8 fillet is sampled with 8 chords (9 arc points). That is a sag of 8(1 − cos 5.625°) = 0.0385 mm, above the 0.025 the Studio circle gets.
  - **Deliberate in a code comment only.** `fillet-corner.ts:3-5` chooses the import tolerance on purpose. ADR-272 Amd 4 item 3 mentions only "the sampled tolerance" for a stretched arc and fixes no value.
- **Fix direction:** Bake Studio arcs as `elliptical-arc` curves (exact, flattened at machine tolerance, G2/G3-ready). Otherwise sample at 0.025.

### L5-P3-4 — Re-Apply silently resets cut type, depth and bit that were changed on the main canvas; ADR-272 Amd 1 names only the fresh layer

- **Where:** `src/ui/state/design-apply-mutation.ts:288` pushes reused operations into `carveOperations`, and `:218-245` restamps `cutType`, `depthMm`, `toolId` and `vClearToolId`. `design-apply-reapply.test.ts:66-67` states the intent: "only the carve fields the Studio owns are restated".
- **Anchor:** **Contract: ADR-272 Amd 1 item 2.** "patches that **fresh** layer's `cnc` block". **Twin:** the workspace operation editor against the Studio layer card, with no sync back.
- **Scenario (READ):** Apply a carve layer at depth 3, change the operation's depth to 5 on the main canvas, then move a hole in the Studio and Apply. The depth returns to 3 with no message. After Apply the field shows 3, so the display matches the burn.
- **Severity:** P3. The overwrite is not disclosed.
- **Refuter:** CONFIRMED (now REPRO), P3 kept.
  - **Repro** (`zz-l5r-spot.test.ts`, store `applyDesignSketch`). A design layer pocket at depth 3 applies as pocket 3. The workspace operation is then set to profile-outside at depth 5. Re-Apply of a widened rectangle gives **pocket 3** again.
  - **ADR text.** The ADR-272 Amd 1 item 2 quote ("patches that fresh layer's `cnc` block") is verified in `DECISIONS.md:14685-14688`.
  - **Code intent.** The code's WYSIWYG intent ("the 3D preview showed this cut type, depth, and bit", `design-apply-mutation.ts:212-216`) treats the Studio card as the authority for these fields.
  - **Why P3.** After Apply, the workspace field and the Studio card both show the burned value. This is doc/code drift plus an undisclosed overwrite.
- **Fix direction:** Record the decision in an ADR amendment and tell the operator. Alternatively, read workspace changes back into the Studio layer before re-Apply.

### L5-P3-5 — A drag or resize interrupted by `pointercancel` never ends: the moved geometry stays with no Undo step

- **Where:** `src/ui/design-studio/DesignCanvas.tsx:80-84` wires `onPointerUp` and `onPointerLeave` but no `onPointerCancel` or `onLostPointerCapture`. `use-design-pointer.ts:102-112` ends gestures only on button-0 pointerup. `updateSessionMove` and `updateSessionResize` replace the present without a step (`design-session-mutations.ts:128-140`, `design-resize-session.ts:26-37`).
- **Anchor:** **Contract: ADR-272.** One history step per gesture (`design-history.ts:44-46`). The 2026-09-05 feature audit listed "real pointer-device cancellation" as an open runtime gap.
- **Scenario (READ):** A pen or touch drag is cancelled by the OS (palm rejection, system gesture). The next press starts a new move from the moved state, so Undo cannot return the shape to where it was.
- **Severity:** P3. Rare on a mouse.
- **Refuter:** CONFIRMED, P3 kept.
  - **Both surfaces affected.** The default 3D viewport (`viewport3d/DesignViewport3D.tsx:44-48`) also wires no `onPointerCancel` or `onLostPointerCapture`, as well as the 2D canvas. No Studio test drives a cancel.
  - **Store-level replay of the handler sequence** (`zz-l5r-spot.test.ts`): `beginMove`, `updateMove` to +20, then a cancel (no `endMove`). The move stays open. A later button-less pointer move, such as a pen hover, keeps dragging the shape (+30), because `advanceGesture` (`use-design-pointer.ts:180-185`) checks no buttons. After the next gesture, Undo stops at 30, and the shape's original position 0 cannot be reached.
- **Fix direction:** End (or cancel back to `beforeSketch`) on `pointercancel` and `lostpointercapture`, and on Escape.

### L5-P3-6 — Chamfering a rectangle by exactly half its short side leaves doubled vertices (zero-length edges)

- **Where:** `src/ui/design-studio/design-corner-apply.ts:67-81`. `cornerSetback` accepts a setback equal to the leg (`corner-geometry.ts:51` uses `>`), so the second chamfer on that edge lands on the first one's point.
- **Evidence:** REPRO, D2: `D2-rect-chamfer-half-side [[0,5],[5,0],[5,0],[10,5],[10,35],[5,40],[5,40],[0,35]]`.
- **Severity:** P3. The burn shape is right. Later corner operations refuse those vertices ("a doubled vertex"), and the node count reads 8, not 6.
- **Refuter:** CONFIRMED, P3. Through the store (`setChamferDistanceMm(5)` + `applyCorner` on a 10 × 40 rectangle) the result is `[[0,5],[5,0],[5,0],[10,5],[10,35],[5,40],[5,40],[0,35]]`, identical to D2.
- **Fix direction:** Merge coincident consecutive points after a chamfer.

### L5-P3-7 — Test gaps (L7)

- No test resizes a retained constrained sketch or generated part on the canvas and then regenerates it (L5-P1-1). The one `scaleX` assertion (`constrained-sketch-regeneration.test.ts:100-102`) covers only a new sketch.
- No recovery test opens the Studio on a project key that differs from the draft (blank start-up, stale autosave) and asserts the draft survives (L5-P1-2).
- No workspace display test strokes a Design Studio closed path (L5-P2-1). `display-polylines.test.ts:89` uses a seam vertex.
- No test drives a cancelled pointer gesture (L5-P3-5).
- **Refuter:** CONFIRMED, with corrections.
  - `part-generator-actions.test.ts:68` is a second `scaleX` assertion, and it too covers only a new part.
  - Two recovery tests pin the **opposite** of the L5-P1-2 fix, so the fix must change them:
    - `design-session-persistence.test.tsx:115-118`: the draft is overwritten with `[]` after opening on a replacement project;
    - `project-design-session.test.ts:117-135`: no draft is recovered for a changed revision.
  - No workspace display test bakes a Studio closed path. No Studio test, 2D or 3D, sends `pointercancel`.

## KNOWN re-observed

- **L2-P3-1 (cubic circles):** the Studio circle r 25 burns radius 24.9998–25.0068 (`D3-circle-r25`), and the Studio rectangle fillet r 5 has a corner error of 0.0013 mm (`D1-rect-fillet`). The `sketch-entity.ts:55-57` comment ("keeps … its exact G-code arcs") overstates it.
- **L2-P3-4 (stored radius clamp), Design Studio twin:** 40 × 40 r 10 → Width 10 stores r 5 → Width 40 keeps r 5 (`D3-rect-radius-after-narrow-wide`), through `sanitizeEntity` (`sketch-entity.ts:189`). The field shows the stored value. The same fix direction applies. *Refuter:* open PR #1502 fixes only the workspace rectangle (`rectangle-resize.ts`, `SelectedShapeGeometryFields.tsx`). It does not touch `sketch-entity.ts`, so this Studio twin stays open after #1502.
- **L2-P3-5 (Studio option boxes):** the Studio fillet and chamfer boxes go through `parseFieldNumber`. The Inspector rows use `evaluateNumericEntry` after `.replace(',', '.')` (`ShapeInspectorField.tsx:35`), and an unreadable entry is dropped silently. Not re-raised.

## Refuted

- **"The solver silently best-fits conflicting dimensions."** An over-constrained result builds no paths (`materialize-constrained-sketch.ts:22`), the review refuses with "Conflicting dimensions remain…" (`constrained-sketch-actions.ts:205-217`), and the conflicts are listed by constraint id (A3 rows).
- **"Fillet or chamfer silently does nothing on a corner too small."** The options-bar tooltip says so: "a corner too short for this radius is left alone" (`DesignOptionsBar.tsx:28`). The tool hints also state that a rectangle rounds or chamfers all four corners.
- **"Studio X/Y differ from the workspace X/Y."** Both are scene millimetres. The rectangle transform is `origin` (`to-scene-object.ts:97`); the toolbar shows the scene position too (`NumericEditsBar.tsx`).
- **"The Studio ignores the Inches preference."** ADR-629 item 5 limits the first increment and requires other boxes to keep their own `mm` label, which the Studio rows do (`ShapeInspectorField.tsx:83`).
- **"Applied parts detach after save and reopen."** All seven kinds survive one and two `.lf2` round trips (T3).
- **"A triangle flips while dragging."** Distance constraints are unsigned. The solver keeps the side of the start, and the review preview shows the result before Apply (A2).
- **L5-P3-2, rounded-rectangle half (refuter).** The "endpoint" snaps at a rounded rectangle's sharp virtual corners are deliberate. `entity-snap-points.ts:118-120`: the nominal corners "are what the operator dimensioned", and the arc stays reachable through the point-on-line snap. This is the CAD virtual-sharp convention. The closing-edge-midpoint half of L5-P3-2 stands.

## Verified clean

- **Solver.**
  - Accurate to 1e-6 mm on every analytic case.
  - Status, DOF and redundancy are correct.
  - The residual tolerance is 1e-5 mm, so 60 against 60.0001 is refused and 60.00002 is accepted.
  - The zero-length start and the stationary escape both work.
  - A 20-step drag of an under-constrained sketch keeps 60 × 30 exactly.
  - Parameters reject cycles, unit mismatches and unknown names with a message.
  - Templates (plate, rectangle, circle) solve fully constrained.
- **Constrained-circle materialisation.** Exact arcs are compiled; the 64-gon polyline is only a compatibility copy (0.120 mm sag at Ø200, never compiled).
- **Fillet and chamfer geometry.** Setback r/tan(θ/2), centre r/sin(θ/2), exact tangent points (90° and 60°). The rectangle fillet stays parametric; the chamfer is exact straight geometry.
- **Extend.** Exact contacts on lines, circles, ellipses, arcs and rounded corners (E1).
- **Inspector edits.** Width grows from the origin; length along the line's direction; arc length solves the radius; diameter is twice the radius. Each edit is one step. Values below 0.01 mm are refused unchanged (U2).
- **Undo and Redo.** 20 operations: every geometry-changing operation is exactly one step, and selection is none. Undo and Redo across 18 states are byte-exact (U1).
- **Apply.** Re-Apply replaces its own objects and makes one project Undo entry (existing tests). A `.lf2` round trip keeps every entity kind (T3).
- **Recovery** when the project key matches: R1 control restores all entities.
- **Refuter spot-check of the accuracy headline** (`zz-l5r-spot.test.ts`). Every value holds; the solver figure is "within about 2e-6 mm" rather than 1e-6, still inside the 1e-5 residual tolerance.

  | Check | Input | Result |
  |---|---|---|
  | Solver, rectangle | Skewed start, A fixed at (10, 20), H/V, AB 72.5, AD 18.25 | Fully constrained, DOF 0, residual 7.9e-7. B (82.500002, 20.000001), C (82.500002, 38.250001), D (10.000001, 38.250001) |
  | Solver, triangle | 5-12-13, hypotenuse given by a parameter | C (12, 5) exactly, residual 1.4e-12 |
  | Fillet, 90° r 8 | One corner | Centre (32, 8), tangents (32, 0) and (40, 8). Every arc point lies at r 8 ± 4e-15 |
  | Fillet, 60° r 5 | One corner | Centre (8.660254, 5), tangents (8.660254, 0) and (4.330127, 7.5) |
  | Chamfer 5 | 60° corner / 90° corner | (5, 0) (2.5, 4.330127) / (35, 0) (40, 5) |
  | Undo / Redo | Four store operations: draw rectangle, width field 55.5, nudge (1.25, −3), chamfer 4 | 5 distinct states; every Undo and every Redo byte-exact (JSON) |

## Not verified

- **Canvas pixels and real pointer devices.** jsdom only. L5-P2-1 was shown through the real painter calls; L5-P3-5 is READ.
- **The dialogs and the toolbar were not rendered.** The repros used the store actions the dialogs and `NumericEditsBar` call (`reviewConstrainedSketch`, `applyConstrainedSketch`, `applySelectionTransforms`).
- **Siblings read but not run:** the part-generator twin of L5-P1-1 and route 3 of L5-P1-2.
- **The constraint set itself.** It has no perpendicular, parallel, tangent, angle or arc constraint (`constrained-sketch.ts:7-39`), so the brief's "tangent to a zero-radius arc" and perpendicular-conflict cases cannot be expressed. Tangent arc–line chains exist only as Studio fillets (exact).
- **Photos workspace** (ADR-590) and the 3D viewport (WebGL): read only.
- **Large-project unload autosave** (`use-autosave.ts:6-8`): read only, as a further trigger for L5-P1-2 route 1.

## Repro files

All were created under `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\j7-main\` and deleted individually after the run. No repo file other than this report was touched.

| File (under `j7-main\`) | Purpose |
|---|---|
| `zz-l5-vitest.config.ts` | Repo vitest config plus the `fflate` alias, one worker |
| `src\core\sketch-constraints\zz-l5-solver.test.ts` | A1–A5: analytic rectangles and triangles, conflicts, degenerate cases, drag stability, default bracket, constrained circle materialisation |
| `src\ui\state\zz-l5-design-output.test.ts` | D1–D3: Studio fillet, chamfer, circle, arc and line through Apply → compile → G-code; main-canvas stroke calls; field edits |
| `src\ui\state\zz-l5-twins.test.ts` | T1 (L5-P1-1), T2 (L5-P3-1), T3 (`.lf2` round trip) |
| `src\ui\design-studio\zz-l5-recovery.test.tsx` | R1 and R2 (L5-P1-2) with the real persistence hook |
| `src\ui\design-studio\zz-l5-undo.test.ts` | U1 and U2: one step per operation, exact Undo/Redo, refused sizes |
| `src\core\design\snap\zz-l5-snap.test.ts` | S1 (L5-P3-2), E1 (extend contacts, L5-P3-3 chord distance) |

Refuter files, created in the same tree and deleted individually afterwards. The `j7-main` junction target was not touched, and no `zz-l6r*` file was opened or changed.

| File (under `j7-main\`) | Purpose |
|---|---|
| `zz-l5r-vitest.config.ts` | Repo vitest config plus the `fflate` alias, one worker |
| `src\ui\layers\zz-l5r-scale.test.tsx` | L5-P1-1 through the rendered sketch dialog and `NumericEditsBar` (uniform and W-only), generated-part sibling, G-code |
| `src\ui\design-studio\zz-l5r-recovery.test.tsx` | L5-P1-2 routes 1, 1b (Apply) and 2 plus controls, real persistence hook |
| `src\ui\state\zz-l5r-closed.test.ts` | L5-P2-1 chamfered rectangle and closed triangle: painter calls and G-code |
| `src\ui\state\zz-l5r-spot.test.ts` | Solver, fillet, chamfer and Undo/Redo spot checks; L5-P3-1, P3-2, P3-4, P3-5 and P3-6 |

```json
[
  {"id":"L5-P1-1","severity":"P1","area":"design-studio-sketch","file":"src/ui/state/constrained-sketch-actions.ts","line":94,"anchor":"Contract: ADR-573 'retained design editors must disclose a materialized mismatch'; prepare-dimensioned-vector.ts:9 'Stage dimensioned artwork at its authored size'; LEDGER v7 precedent (typed value burns differently while shown = P1, canvas is not a warning)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Regenerating a constrained sketch keeps the object's transform scale; after a canvas resize to W 120, typing width 80 and hole 6 in the sketch dialog shows 'Size 80.000 x 30.000 mm, fully-constrained' with no mismatch alert, but the G-code cuts 160 x 60 with 12 mm holes. Part generator regeneration (...object) has the same twin (refuter REPRO: toolbar H 80 then width 80 / hole 6 burns 80 x 80 with 6 x 12 holes); refuter also reproduced through the rendered dialog and toolbar, W-only scale burns 12 x 6 elliptical holes"},
  {"id":"L5-P1-2","severity":"P1","area":"design-studio-sketch","file":"src/ui/design-studio/design-studio-store.ts","line":397,"anchor":"Contract: ADR-272 Amd 3 (drawing survives reload/crash; saved drawing before blank); ADR-590 protects only against an unrelated draft; AREAS v7 'Losing design work also counts'","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"The single localStorage draft is restored only when its owner key equals the open project's; otherwise the Studio opens on the applied state or blank and the persistence hook overwrites the draft. Repro: 3 unapplied entities saved; a workspace object added within the 30 s autosave window then reload from the autosave restores 0 and stores 0; opening the Studio on the blank start-up project first stores 0 and the later autosave restore brings back nothing. Refuter reproduced routes 1, 1b (Apply) and 2 (with a current autosave); no other copy, no warning; existing tests pin the overwrite for a replacement project, no ADR decides destroying the draft"},
  {"id":"L5-P2-1","severity":"P2","area":"design-studio-sketch","file":"src/core/design/entity-geometry.ts","line":99,"anchor":"Twin: Studio 2D/3D view and compiled G-code close the path; main canvas strokePolylinesBatched does not; sketch-path-geometry.ts:47-49 documents the renderer needs an explicit closing edge","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Closed Studio paths (closed polyline, chamfered rectangle) are baked without the seam vertex; G-code cuts all 8 edges of a chamfered 40 x 20 rectangle but the main canvas strokes only 7 (moveTo(20,35) ... lineTo(20,45), no return); refuter: a closed Studio triangle strokes 2 of 3; the phone preview closes it (Z), so only the desktop main canvas is affected"},
  {"id":"L5-P3-1","severity":"P3","area":"design-studio-sketch","file":"src/ui/design-studio/project-design-session.ts","line":44,"anchor":"Contract: ADR-590 (workspace edits take precedence) plus ADR-272 clause 9 (surface a message)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"A 1 mm workspace move of an applied Studio part detaches it: on reopen the entity is gone from the drawing (with any unapplied edits and the Studio Undo history), with no notice"},
  {"id":"L5-P3-2","severity":"P3","area":"design-studio-sketch","file":"src/core/design/snap/entity-snap-points.ts","line":99,"anchor":"Twin: sketch-bounds.ts measures materialized geometry 'exactly what gets cut'","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Narrowed by refuter: closed paths offer no closing-edge midpoint snap. The rounded-rectangle virtual-corner endpoint snaps (2.0711 mm off the r 5 outline) are deliberate (entity-snap-points.ts:118-120) and moved to Refuted"},
  {"id":"L5-P3-3","severity":"P3","area":"design-studio-sketch","file":"src/core/geometry/arc-sampling.ts","line":9,"anchor":"Twin: Studio circles and canonical curves compile at DEFAULT_MACHINE_CURVE_TOLERANCE_MM 0.025 (curve-path.ts:14)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Studio arcs and path fillets are baked through sampleArcPoints at 0.05 mm chords; the analytic r 10 contact is 0.0476 mm from the burned arc"},
  {"id":"L5-P3-4","severity":"P3","area":"design-studio-sketch","file":"src/ui/state/design-apply-mutation.ts","line":288,"anchor":"Contract: ADR-272 Amd 1 item 2 patches the fresh layer only; Twin: workspace operation editor vs Studio layer card","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Re-Apply restamps cutType, depth and bit onto the reused operation, silently undoing workspace edits to those fields (intent stated only in design-apply-reapply.test.ts:66-67)"},
  {"id":"L5-P3-5","severity":"P3","area":"design-studio-sketch","file":"src/ui/design-studio/DesignCanvas.tsx","line":82,"anchor":"Contract: one history step per gesture (design-history.ts:44-46)","evidence":"REPRO","verdict":"CONFIRMED","known":"adjacent: 2026-09-05 features-08-14 lists pointer cancellation as an open runtime gap","summary":"No pointercancel/lostpointercapture handling on the 2D canvas or the default 3D viewport; a cancelled move or resize stays open (a button-less hover keeps dragging), keeps the moved geometry with no Undo step, and the original position becomes unreachable by Undo (refuter store-level replay)"},
  {"id":"L5-P3-6","severity":"P3","area":"design-studio-sketch","file":"src/ui/design-studio/design-corner-apply.ts","line":75,"anchor":"Ground truth: a 10 x 40 rectangle chamfered 5 has 6 distinct vertices","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Chamfer equal to half the short side leaves (5,0) and (5,40) doubled; later corner ops refuse them and the node count reads 8"},
  {"id":"L5-P3-7","severity":"P3","area":"design-studio-sketch","file":"src/ui/state/constrained-sketch-regeneration.test.ts","line":100,"anchor":"METHOD L7","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"No test for regenerating a canvas-scaled retained sketch or part, for a recovery draft under a different project key, for stroking a Studio closed path on the main canvas, or for a cancelled pointer gesture"},
  {"id":"L2-P3-1","severity":"P3","area":"design-studio-sketch","file":"src/core/design/to-scene-object.ts","line":105,"anchor":"Twin (as L2)","evidence":"REPRO","verdict":"KNOWN","known":"v7 L2-P3-1","summary":"Studio circle r 25 burns radius 24.9998-25.0068; Studio rectangle fillet r 5 corner error 0.0013 mm"},
  {"id":"L2-P3-4","severity":"P3","area":"design-studio-sketch","file":"src/core/design/sketch-entity.ts","line":189,"anchor":"Twin (as L2)","evidence":"REPRO","verdict":"KNOWN","known":"v7 L2-P3-4 (Design Studio twin)","summary":"Studio 40 x 40 r 10 -> width 10 stores r 5 -> width 40 keeps r 5"},
  {"id":"L2-P3-5","severity":"P3","area":"design-studio-sketch","file":"src/ui/design-studio/ShapeInspectorField.tsx","line":35,"anchor":"Twin (as L2)","evidence":"READ","verdict":"KNOWN","known":"v7 L2-P3-5","summary":"Studio entry quirks (comma replace, silent drop of unreadable entries) as recorded by L2"}
]
```
