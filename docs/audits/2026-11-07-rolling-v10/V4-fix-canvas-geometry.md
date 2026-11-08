# Rolling audit v10 — V4 Fix: canvas and geometry

- **When:** 2026-11-08 +0800   **Tree:** origin/main @ `5f09e1110`. Repros ran on the scratchpad tree `j10-main`; the audit worktree's `src` is identical to `5f09e1110`. 1.0.29 comparisons used the read-only export `zz-v2/old29` (`df2279e26`).
- **Scope:**
  - #1551 (ADR-683 Amd 3): Fill pools planned once, batched, and dense pools drawn from rasters.
  - #1552 (ADR-346 Amd 1, ADR-620 Amd 1): moving frames stroke thin, and the hover pulse is bounded to the view.
  - #1593: objects on the canvas keep their resolved display while the view pans.
  - #1582 (ADR-609 Amd 2, ADR-690): the Weld check runs in the worker, and a step mismatch never blocks a form.
  - #1583 (ADR-410 Amd 5): nested-selection depths and painting grow with the rings.
  - Original findings: S2-P2-1..4, S2-P3-2, S2-P3-4, S6-P2-1/2, S6-P3-1, N3-P3-1 (`docs/audits/2026-11-02-performance-s1/`).
- **Lenses run:** L10 (all five steps), L3 (the key lens), L4, and L12 only in part.
  - L12: the PRs' own and related unit suites ran on main (31 files, 318 tests, all pass). No e2e spec, browser measurement or desktop build ran. Available memory was 1.3–1.8 GB all session, under the 3 GB browser gate.
  - **Memory gate breach, disclosed.** Two focused Vitest runs started just under the 1.5 GB Vitest gate: the mutation run at 1,334 MB and the last pool-cache run at 1,385 MB. Both finished normally, and nothing else was running.
- **Counts:** 2 raised → refuter pending → P1 0 / P2 0 / P3 2 (+ 1 KNOWN: S9-P3-3, open PR #1608). The auditor dropped 6 candidates (see Refuted).

## Headline

**No burn-safety defect was found.** Each of the five fixes keeps the burn and the geometry identical to 1.0.29 on every input tried.

- **Weld (#1582).** The review now runs in the worker. On 318 scenes, including one packed 401-object selection, it returned the same union, Apply plan and absorbed-shape warning as 1.0.29's in-thread weld and check, byte for byte.
- **Nesting (#1583).** The new path gave byte-identical regions to 1.0.29 on 4,000 seeded scenes and the concentric-ring fixtures, in both modes:
  - 848 levels took the new "apart" painter;
  - 300 rings took 306 ms against 19.1 s on 1.0.29.
- **Fill pools (#1551) and display reuse (#1593).** One long-lived canvas with warm caches drew exactly what fresh modules drew, at every step of 60. The steps covered pans that carry members off the canvas, a move while panned, zooms within and across a flattening bucket, undo, Fill→Line, Output off, z-order, delete and hide. Every comparable step matched `compileJob`'s hatch, with 0 mismatching points over 54 steps.

Each PR's regression test fails once its fix is switched off.

Two P3s remain, both about tracking:
- **V4-P3-1.** The performance ledger marks S2-P2-2 "fixed", but its own ADR says hovering a fitted 5,000-object design is unchanged at 83–100 ms, and no maintainer decision records it.
- **V4-P3-2.** ADR-683 Amendment 3 says the pool rasters hold at most 12 million pixels together. The drag-preview scratch bitmaps, up to 8 million more, sit outside that budget and are never released.

## Findings

### V4-P3-1 — S2-P2-2 is marked fixed, but its hover row is not, and no decision records the remainder

- **Where (5f09e1110):**
  - `docs/audits/2026-11-02-performance-s1/LEDGER.md:24` (S2-P2-2, status "fixed by #1552") and `:35` ("Fixed: … S2-P2-1 and S2-P2-2 (#1552)").
  - `docs/decisions/ADR-620-amendment-1-pulse-lights-what-is-in-view.md:39-42`, Consequences.
  - `src/ui/workspace/draw-artwork-pulse.ts:143` and `:160`: every same-settings piece in view is drawn. `pieceInView` skips only pieces off the overlay. In a fitted view all 2,500–5,000 pieces are in view, so each frame still blits three bitmaps per piece.
  - `docs/audits/2026-11-02-performance-s1/P3-SWEEP.md:51-75`: "Maintainer decisions" has no entry for the pulse.
- **Anchor:**
  - **Contract (AREAS L10 step 1):** the original repro must be fixed.
  - **ADR-620 Amendment 1, Consequences** (`:39-40`): hovering in the fitted view "stays at 83–100 ms as on main".
  - The performance audit budget is 33 ms a frame at 5,000 objects.
- **Scenario:**
  - What is fixed: on `mix-5000`, pan and zoom over artwork went from 184 to 33 ms and from 183 to 33 ms (ADR-620 Amd 1).
  - What is not: hovering one shape in the fitted view still runs at 83–100 ms p95, about 2.5–3 × the budget. This was the headline of S2-P2-2: "hovering one shape drops the canvas to 10 fps".
  - The ADR explains why: fewer blits would change how the pulse looks. That makes the remainder a product decision, but it was never put in the sweep's decision list. The ledger, and #1596's round-result table ("Dense canvases … dropped frames on drag and hover | fixed by #1551, #1552"), report it as fixed. The next audit would skip it.
  - The click frame of `line-5000` after S2-P2-1 is a different case. It still costs 1–2 s of GPU (ADR-346 Amd 1 `:51-53`), but that ADR records the resting weight as the maintainer's own choice (`:16`). So that remainder is decided, and is not part of this finding.
- **Evidence:** SOURCE and READ.
  - SOURCE: ADR-620 Amd 1 `:39-40` at `5f09e1110`, quoted under Anchor.
  - READ: the painter loop above.
  - Not re-measured: the browser gate was never met.
- **Severity:** P3.
  - It is tracking drift: the ADR is honest, the ledger is not.
  - The remaining cost is 2.5–3 × the frame budget. By the performance severity rules that is a P3 budget miss, not the P2 "over three times".
  - It is display-only and touches no output.
- **Novelty:** new. The S2 report, the P3 sweep and the open PRs (#1596, #1597, #1608) do not mention it.
- **Fix direction:** mark S2-P2-2 "partly fixed" in the ledger. Add a maintainer-decision entry to the sweep: shared-ripple bitmaps for hover at fit view, or accept 83–100 ms.
- **Refuter:** PENDING.

### V4-P3-2 — The drag-preview scratch bitmaps sit outside the pool rasters' 12-million-pixel budget and are kept for the session

- **Where (5f09e1110):**
  - `src/ui/workspace/fill-pool-raster-preview.ts:42`: a module-level `scratch`.
  - `:151-167` (`scratchLayers`): two canvases are created once and resized to each preview, up to `MAX_RASTER_PIXELS` (`:19`, 4,000,000) each, as checked at `:119-125`. They are never released; only `resetPreviewScratchForTests` clears them.
  - `src/ui/workspace/fill-pool-raster.ts:58` and `:243-257` (`makeRoom`): the 12,000,000 total counts only `rasters`, not `scratch`.
- **Anchor:** **Contract, ADR-683 Amendment 3 Decision 7** (`docs/decisions/ADR-683-amendment-3-fill-pools-are-planned-once-and-painted-from-batches-and-rasters.md:78`): "a raster's layer holds at most 4 million pixels and all rasters 12 million together".
- **Scenario:**
  1. Drag one member of a dense Fill pool (S2-P2-3's 5,000 overlapping circles) while zoomed in, so the preview frame nears 4 Mpx.
  2. The finished rasters take up to 12 Mpx.
  3. The scratch pair takes another 8 Mpx, about 32 MB of canvas memory, for the rest of the session, even after the pool is deleted.
- **Evidence:** READ. S9's one-hour session saw "detached canvases 3–6, no trend" (PR #1596, S9 report), which fits a fixed extra pair, not a leak.
- **Severity:** P3. It is doc/code drift with a bounded cost, about 2 % of the 1.5 GB app budget, and it is display-only.
- **Novelty:** new. S9-P3-3 (#1608) covers `lastGroups`, not the raster scratch.
- **Fix direction:** either count the scratch pair in `makeRoom`'s total and release it once no preview has been drawn for a settle period, or amend Decision 7 to say the preview scratch adds up to 8 Mpx.
- **Refuter:** PENDING.

## KNOWN re-observed

- **S9-P3-3** (PR #1596's S9 report; fix open in **#1608**). `lastGroups` in `src/ui/workspace/fill-pools.ts:255`, added by #1551, is never pruned. It keeps every past pool's objects alive for the session. Re-read here: still unpruned at `5f09e1110`. Display memory only; the plan and the burn are unaffected.

## Refuted (by the auditor, before the refuter)

- **"#1583's deepest-first depth search can give a different depth than 1.0.29's full search."** It cannot. The old code took max(own, depth(R)+1) over enclosing larger rings R of another batch. The new code tries the same visited set by level, deepest first, down to `own`, so the first hit is that maximum (`vector-path-nesting.ts:148-164`). The fuzz agrees.
- **"#1582 changes what Apply commits."** It does not. On 318 fixtures (the S6 plate-and-circles shapes, the bridge, absorbed shapes, identical copies, two operations, random rotated, scaled and mirrored scenes, and a packed 401-object scalloped plate), the plan's object and layers and the `{changed, absorbedIds}` change matched 1.0.29 byte for byte.
- **"ADR-690's `noValidate` lets a fractional count reach the burn."** It does not.
  - Cut Settings and the material wizard floor passes and tab counts (`cut-settings-draft.ts:71-74, 172-175`).
  - Array floors rows, columns and copies (`array-dialog-form.ts:252`). Copy Along Path floors its count (`CopyAlongPathDialog.tsx:119`).
  - The box generator refuses fractional dividers (`core/box/box-spec.ts:213-215`), and the fit test refuses fractional rungs (`core/box/fit-coupon.ts:97`). Tone calibration refuses fractions (`tone-calibration-draft.ts:135`).
  - Adjust Image clamps interval and DPI through `NumberField`'s `normalize`.
- **"A raster preview can show a stale pool after a non-drag edit."**
  - Any change of member objects is carried exactly in the fill by the xor diff (`fill-pool-raster-preview.ts:63-83`).
  - An empty diff with new contours happens only when the same objects change flattening bucket at a zoom. That is the documented zoom placeholder, repainted exactly once the pool is quiet for 150 ms.
  - A base taken from another cluster of the same key gives antialiasing ghosts for at most the settle time. That is cosmetic and inside Decision 7's "preview" allowance.
- **"Batched small pools of one key can overlap, so one even-odd fill would cancel them."** They cannot. Pools of one key are separate overlap clusters of that key's members, so their boxes, and therefore their regions, are disjoint (`fill-pools.ts:240-250`, `fill-pool-paint.ts:62-68`). Split parts and dimmed pools never join a batch.
- **"ADR-609 Amd 2's plain `weld` task is still used by other callers."** Only tests use it now (`vector-op-worker-runtime.test.ts:126`, `vector-op-prepared.test.ts:174-196`). The ADR wording is loose, but nothing behaves wrongly, so it is not raised.

## Verified clean

### #1551 — Fill pools planned once, batched and drawn from rasters (ADR-683 Amd 3)

- **L3, canvas against burn, with warm caches (REPRO).** `zz-v4\zz-v4-pool-cache.test.ts` (Vitest in jsdom; copied into `j10-main` for the run, then removed). Log: `zz-v4\pool-cache-log.txt`.
  - **Setup.** One `drawScene` module stays loaded with a persistent display cache and a canvas of 800 × 600, so objects really leave the canvas.
  - **Scenes:**
    - rotated plate, rotated window and an island, plus a second plate mirrored and scaled 1.5 × that overlaps the first, plus a far cluster;
    - Line+Fill on one circle, plus a plate, a Line square and a second Fill circle;
    - three overlapping ellipses, one rotated and scaled, plus a rotated square.
  - **Steps:** 20 per scene: four partial pans at zoom 6–14 ×, a move while panned, pan back, zoom within and across a flattening bucket, undo of the move, Fill→Line and undo, Output off and undo, z-order swap and undo, delete a member and undo, hide the operation, and show it again while panned.
  - **Warm against cold.** Each step is also drawn by a fresh module instance (`vi.resetModules`), which is equivalent to 1.0.29's uncached plan. 60 of 60 steps gave identical ink at every sample point.
  - **Against the burn.** 54 of 54 comparable steps matched `compileJob`'s hatch at every grid point away from an edge, with 0 mismatches (up to 34,097 points a step). The other 6 steps are Output off or hidden, where "shown, not burned" is the known rule.
- **Plan-cache key complete (READ).** `planPools` reads, for each entry: the object, its run, the display's `fillDisplay`, `fillRule`, `paint.kind` and `fillOperations`, and the bitmap box. All of these are in `planSignature` (`fill-pool-plan-cache.ts:41-62`). Hover, alpha and hairline are painter-time inputs.
- **Pool geometry and rasters key on identity (READ).** Pool geometry is keyed by the member objects and sources (`fill-pool-geometry.ts:50-66`). The rasters are keyed by `pool.contours` identity, scale, colour and width (`fill-pool-raster.ts:121-185`). Undo re-plans to new contours and previews from the nearest finished raster.
- **`regroupMoved` equals a full sweep (READ).** Moved-against-moved pairs are covered because each moved box sees the earlier moved ones (`fill-pool-clusters.ts:184-225`). The existing random-box test passes.
- **ADR text matches the code.** 2 plan slots, 32 moved members, 4,000-segment batch sprite, 20,000-segment preview, 150 ms settle, 60,000 row-crossings a frame, 4 Mpx per layer and 12 Mpx total for rasters. The one exception is V4-P3-2.
- **L10 step 5, test truth (REPRO).** `zz-v4\vitest-mutants.txt`: with the plan cache bypassed, `draw-scene-fill-pool-work.test.ts` "plans the pools once…" fails.

### #1593 — Resolved display kept while the view pans

- **Display inputs (READ).** `resolveObjectDisplay` depends on:
  - the object;
  - the layers (and the lookup derived from them);
  - the tolerance bucket;
  - the display cache;
  - the mode and palette;
  - the colour scheme, through `canvasVectorDisplayColor` and `canvasTheme.artworkInk`.

  All of these are in `sameInputs` plus the tolerance check (`placed-objects.ts:110-131`). Scene objects are immutable, so an edit is a new object.
- **Warm against cold (REPRO, above).** Pans, a move while panned and zoom within a bucket gave identical ink.
- **Test truth (REPRO).** With `currentDisplay` forced to resolve, `placed-objects-display-reuse.test.ts` fails.

### #1552 — Moving frames thin; pulse bounded to the view (ADR-346 Amd 1, ADR-620 Amd 1)

- **Display only (READ).** `src/core` imports none of `canvas-motion.ts`, `draw-complexity.ts` or the pulse modules.
- **Constants match the ADRs.** Settle 150 ms (`SPRITE_SETTLE_MS`), threshold 20,000, pulse settle 140 ms, pulse budget 1.5 Mpx and 6 ms.
- **Behaviour matches the ADRs (READ).** A held drag does not settle between steps (`canvas-motion.ts:29-52`). Sprites and rasters keep their own width (`fill-pool-paint.ts:136-221`). Pulse pieces are re-rendered when their object, layer, lookup, mode or scheme changes (`draw-artwork-pulse.ts:293-302`).
- **Test truth (REPRO).** With `movingFrameDrawsHairlines` forced false, three tests in `draw-scene-moving-hairline.test.ts` fail.
- **Remainders:** S2-P2-1's is the maintainer's choice (ADR-346 Amd 1). S2-P2-2's hover row is open: V4-P3-1.

### #1582 — Weld check in the worker (ADR-609 Amd 2) and ADR-690

- **L3, Weld on main against 1.0.29 (REPRO).** `zz-v4\weld-twin.mjs`, output `weld-out.txt`.
  - Main path: `prepareWeldSelection` → pack `[operands, sources]` → `structuredClone` → unpack → `vectorOpResponse` → clone → `vectorOpResult`.
  - 1.0.29 path: `weldVectorObjects(operands)` plus `describeWeldChange(sources, union)` in thread.
  - Result: 318 of 318 identical. This includes `plate+60`, where 12 circles are absorbed; `edge400`, which used the packed transfer and absorbed 236 shapes; the bridge (no absorbed shape); and `apart` (`changed: false`, "Nothing to weld").
- **UI-thread share at 2,000 shapes (Node, `weld-ui-time.txt`).** `prepareWeldSelection` takes 9.5–18 ms. Packing both arrays takes 16–35 ms. Decoding the reply takes 0.1–0.5 ms. The 455–555 ms check now runs in the worker.
- **ADR-690 (READ and REPRO).**
  - Every `<form>` sets `noValidate` and uses `checkedSubmit`, `clampsEveryValue` or the listed bare `noValidate`.
  - The kit sweep (`form-validity.test.tsx`) and `ArrayDialog.test.tsx` (the 110.923 mm grid) pass on main.
  - The count fields keep their own rounding or refusal (see Refuted).
- **Test truth (READ).** `BooleanDialogHost.weld-worker.test.tsx:145-147` requires the task kind `weld-review` and no `describeWeldChange` call before the reply. Before the fix the task kind was `weld` and the check ran in the dialog, so the test fails there.

### #1583 — Nested selection grows with its rings (ADR-410 Amd 5)

- **L3 against 1.0.29 (REPRO).** `zz-v4\nest-fuzz.mjs`, `nest-rings.mjs`, `nest-edge.mjs`; output `nest-out.txt`. `nestedSelectionRegion` on main and on 1.0.29, in both modes.
  - **Fuzz:** 4,400 seeded scenes and 8,800 comparisons, all byte-identical.
    - Scene types: concentric polygons and circles; rings 3.9–6 µm apart at the 4 µm line; batches with their own holes; plates with windows and islands; decorations across an edge; self-intersecting stars; copies; groups side by side; coordinates near 1,000 mm.
    - 848 levels took the new `paintApart` path. That count comes from a patched copy of the main bundle with a counter added.
  - **Concentric rings:** 100, 300, 60 turned, and 40 at 5 µm and at 3 µm, all identical. 300 rings, nested: 306 ms on main against 19,120 ms on 1.0.29. Outer only: 15 ms against 1,519 ms.
  - **Edge inputs:** zero-area, NaN, Infinity, duplicate points, coordinates near 1,000,000 mm, an island with the same box, a touching corner. All give identical results or errors.
- **Callers.** `offset-shapes.ts:202` (Offset Shapes) and `vector-path-booleans.ts:158` (the Offset outlines row) consume this function unchanged, so their output is unchanged.
- **Test truth (REPRO).** With the apart painter disabled, "feeds clipper each ring a bounded number of times" fails.

### L12 — related unit suites on main

31 files, 318 tests, all pass (`zz-v4\vitest-related.txt`). They cover:
- pools, rasters, the moving hairline, the pulse, `canvas-motion` and burn parity;
- offset and nesting, weld and weld change;
- the Boolean, Array and Offset dialogs, the vector worker client, entry and runtime;
- `Dialog` and `form-validity`.

## Not verified

- **No e2e spec ran.** Memory stayed at 1.3–1.8 GB, under the 3 GB gate. Owed for L12 (#1593 merged without CI on main): `e2e/array-grid-tenths.e2e.ts`, `tools-vector-audit.e2e.ts`, `dense-trace-canvas-navigation.e2e.ts`, `canvas-text-weld.spec.ts`, `numeric-input-app-audit.spec.ts`, `production-bundle.spec.ts`, and the desktop build.
- **No browser re-run of the original repros.** That covers S2-P2-1..4 (frame intervals, the 40-step drag hang), S6-P2-1 (the 5.2 s block) and S6-P2-2 (Create array in Chrome). The PRs' own measurements stand unconfirmed here.
- **The raster and preview paths were not drawn.** The recording canvas in jsdom is not an `HTMLCanvasElement`, so `drawLargeFillPool`, the xor preview, the bands and the batch and pool sprites were checked by reading only. Their geometry inputs (pool contours) are the ones verified above.
- **The pulse overlay** was checked by reading only, beyond its own tests.
- **ADR-690** was not swept field by field: 9 count fields in 7 dialogs were spot-checked.

```json
[
  {"id":"V4-P3-1","severity":"P3","area":"V4","file":"docs/audits/2026-11-02-performance-s1/LEDGER.md","line":24,"anchor":"Contract (L10 step 1; ADR-620 Amendment 1 Consequences :39-40)","evidence":"SOURCE+READ","verdict":"PENDING","known":false,"summary":"S2-P2-2 is marked fixed by #1552, but its own ADR says hover in the fitted 5,000-object view stays at 83-100 ms as on main; no maintainer decision records the remainder"},
  {"id":"V4-P3-2","severity":"P3","area":"V4","file":"src/ui/workspace/fill-pool-raster-preview.ts","line":151,"anchor":"Contract (ADR-683 Amendment 3 Decision 7, :78)","evidence":"READ","verdict":"PENDING","known":false,"summary":"The drag-preview scratch bitmaps (up to 2 x 4 Mpx) are outside makeRoom's 12 Mpx raster budget and are never released"},
  {"id":"S9-P3-3","severity":"P3","area":"V4","file":"src/ui/workspace/fill-pools.ts","line":255,"anchor":"Contract (S9 heap slope)","evidence":"READ","verdict":"KNOWN","known":true,"summary":"lastGroups from #1551 is never pruned; fix open in #1608"}
]
```

## Refuter (2026-11-08)

- **Tree:** origin/main @ `5f09e1110` (scratchpad `j10-main`); 1.0.29 from `zz-v2/old29` (`df2279e26`). Refuter files in scratchpad `zz-v4r\`.
- **Memory:** available memory was 1.2–1.55 GB all session. The 1.5 GB Vitest gate was met only briefly while the harness was still being written, and a 6-minute wait for it ended at 1,241 MB. So no Vitest and no browser ran. Node repros and reading only.

### Verdicts

**V4-P3-1: CONFIRMED, P3.**
- *Would be false if* (a) a decision already records the hover remainder, (b) the remainder were over three times its budget (P2), or (c) a ledger or open PR already marks it partly fixed.
- (a) `docs/audits/2026-11-02-performance-s1/P3-SWEEP.md:51-79` (Maintainer decisions) has no pulse entry. `:62` only lists hover among the nightly GPU frame intervals it proposes.
- (b) `ADR-620-amendment-1-pulse-lights-what-is-in-view.md:40` says "stays at 83–100 ms as on main". The budget is 33 ms a frame (`performance-s1/AREAS.md:23`). Frame intervals are whole vsyncs, so 100 ms is exactly 3 × 33.3 ms. That is not "over three times" (`AREAS.md:35`), so P3 under `:36`.
- (c) `gh pr diff 1596` repeats "fixed by #1551, #1552" for "dropped frames on drag and hover" (its round-result row). `gh pr diff 1608` touches only `lastGroups`. Neither mentions the hover row. The ledger at `5f09e1110` still says "fixed by #1552" (`LEDGER.md:24`, `:35`).
- **Addition.** S2-P2-2's click-select row is also still over its own budget. ADR-620 Amd 1 `:38` gives 112–115 ms after the fix against the 100 ms response budget (`AREAS.md:22`). The ADR calls this "within the spread" of main's 102–175 ms. The ledger fix should name both rows.

**V4-P3-2: CONFIRMED, P3** (READ, two independent lines of evidence).
- *Would be false if* the scratch pair were released or counted somewhere the auditor missed.
- At `5f09e1110`, `scratch` is assigned in exactly two places: `fill-pool-raster-preview.ts:156` (create) and `:45` (`resetPreviewScratchForTests`). Its only caller is `resetFillPoolRastersForTests` (`fill-pool-raster.ts:95-103`), and no non-test source calls that function (`grep`). `scratchLayers` (`fill-pool-raster-preview.ts:151-167`) only resizes. A canvas keeps its last preview size, up to `MAX_RASTER_PIXELS` (`:19`, checked at `:119-125`) per layer.
- `makeRoom` (`fill-pool-raster.ts:243-257`) sums `held(raster)` over `rasters` only, against `TOTAL_RASTER_PIXELS` (`:58`).
- The contract text is `ADR-683-amendment-3-…md:78`: "all rasters 12 million together".
- One nuance does not change the severity: the scratch is a preview buffer, not a "raster", so the ADR can be read as silent rather than contradicted. Either way the drift is doc/code and display-only.
- Not reproduced: jsdom has no canvas backend (the setup stub returns no-op contexts), and the browser gate was never met.

### New findings

None. No P1 or P2 was found on the inputs below.

### Challenges to "Verified clean"

**#1583 nesting, degenerate rings (REPRO, Node).**
- `zz-v4r\nest-degenerate.mjs` compares `nestedSelectionRegion` on main (the auditor's probe bundle, which counts levels painted apart) with 1.0.29, in both modes, on 26 scenes. Most are an 8-level concentric stack with a degenerate ring added. 52 of 52 comparisons were byte-identical.
- The degenerate rings covered:
  - a duplicate ring in another batch;
  - a duplicate ring in the same batch;
  - a reversed duplicate;
  - two rings sharing an edge;
  - a ring sharing an edge with a level ring;
  - a vertex touch;
  - a figure-eight island;
  - a bow-tie outer ring;
  - a zero-area collinear ring;
  - a 2-point batch;
  - empty batches;
  - gaps of exactly 4 µm, 4.1 µm and 3.9 µm (squares turned 37°, and 96-gons);
  - two stacks side by side, one with a duplicate;
  - many units in one level, touching and apart;
  - a hole batch with an island, and a hole duplicated by another batch;
  - collinear overlapping strips;
  - a spike ring;
  - NaN (the same error on both);
  - a 2 µm ring at the deepest level;
  - a stack at 100,000 mm.
- Six scenes took the apart painter (4–9 levels each), including `dupRingSameBatch`, `zeroAreaInside`, `twoPointBatch`, `spikeRing` and `hugeCoordsApart`. Every touching, duplicate, crossing or under-4 µm case fell back to whole-region painting, as ADR-410 Amd 5 Decision 2 requires.
- Why degenerate input cannot reach the painter raw: rings come from a clipper union per batch, and rings with fewer than 3 points are dropped (`vector-path-nesting.ts:86-104`). So 2-point and self-crossing input reaches `ringsApart` already normalized (`vector-path-nesting-paint.ts:134-161`).

**#1582 Weld in the worker (READ).**
- **Edit or second Weld while the worker runs.**
  - The dialog reviews `session.project`. Any store change makes `unchanged` false, which disables Apply and shows "The project or selection changed…" (`BooleanDialogHost.tsx:147-151`, `:335`). Apply re-checks `booleanSessionIsCurrent` (`:157`, `:194-204`).
  - A new request supersedes the old one: it terminates the busy worker and starts a fresh one (`vector-op-worker-client.ts:89-92`).
  - `current` is keyed on the exact `sources`/`task` identity (`use-vector-op-preview.ts:67-70`). So a stale union reply can never be finished as a weld plan.
- **Cancel or closing the dialog.** These unmount it, `session.release()` runs, and the worker is terminated (`use-vector-op-preview.ts:49`, client `:109-130`).
- **Closing the project mid-Weld.** The same "changed" state applies. Nothing is committed.
- **Worker failure.** `onerror` after `ready`, a `fatal` reply, or an unreadable reply (including `weld-review` without `weldChange`, runtime `:125-128`) each settle as `failed`, with "The background geometry work stopped unexpectedly." or "…reply could not be read."
  - Apply stays disabled (`previewStatus`, `:281-306`), and the selection is untouched.
  - A worker that cannot start is `unavailable`. Apply then runs in the thread without the absorbed warning, the same as 1.0.29 (`git diff` against `old29` shows that path unchanged).
- **ADR-690: can a decimal step let an invalid value through to output?** The auditor's 9 fields were extended to every form in `src/ui` with a whole-number-step count or a field without a step (the default step is 1):
  - Focus Test `steps` is refused unless it is an integer from 2 to 101 (`core/job/focus-test.ts:31,49-50`).
  - Interval Test and Material Test run `calibrationDraftIssues`, which re-applies the step check in the app (`calibration-draft-validation.ts:22-25`).
  - Scan Offset calibration refuses a non-integer `steps` (`ScanOffsetCalibrationDialog.tsx:252`).
  - Cut Settings floors `passes`, `tabsPerShape` and `tabMaxPerShape` (`cut-settings-draft.ts:73,174,224`). Array floors its counts and truncates the seed (`array-dialog-form.ts:120,252`).
  - Every other form number field is a continuous millimetre, degree or percent value: Quick Nest, Print and Cut, Print Artwork, Select Circles, Dock, Join, Fillet, Close Paths, Close Open Fill, Shear, Barcode (`step="any"`), Photo Engraving (`step="any"` with clamps), and Overlap Removal.
  - `refusesSubmit` (`kit/form-validity.ts:26-38`) still refuses on bad input, range, required, pattern, length, type and custom errors. The console command form (`ConsoleCommandDeck.tsx`) keeps those refusals.
  - No invalid count reaches output.
- **One behaviour change, not raised because ADR-690 decides it.** A fractional count is now silently floored where 1.0.29's browser refused it at the field. Example: 2.5 passes is saved as 2 (`CutSettingsCommonFields.tsx:47`, `min={1} step={1}`). ADR-690 `:31`, `:38` and `:65` state it.

**#1551 / #1593 canvas vs burn, cached plans and rasters (READ; the REPRO harness was written but not run, see Not verified).**
- **Plan key and identity.**
  - `planSignature` (`fill-pool-plan-cache.ts:41-62`) takes object identity, run, `fillDisplay`, `fillRule`, paint kind and `(operationId, color, output)` per path.
  - Groups are id lists (`{id, name, objectIds}`), not transforms. So moving, mirroring or turning a group writes new member objects and invalidates every cache (`fill-pool-geometry.ts:30-45` keys on the object and the source contours).
  - Runs differ only for separately compiled jig instances, and are keyed on `scene.objects` and `scene.layers` (`core/scene/fill-operations.ts:94-108`).
- **Fill angle, interval or a preset change.** These change `scene.layers` identity, so the displays re-resolve (`placed-objects.ts:123-131`). None of them changes a pool's region, which is fixed by the parity of the contours and not by the hatch parameters, so the same plan is correct.
- **Offset fill.** It also resolves the contours even-odd (`core/job/offset-fill.ts:29-31`), so the pool's parity is what it burns.
- **Converted text.** Non-zero paths are resolved per object, then unioned, as `layer-fill.ts` does. The cache key includes the rules string and every `fillDisplay` (`fill-pool-regions.ts:104-122`).
- **An edit while a raster is painted in bands.**
  - The target is found by `pool.contours` identity (`fill-pool-raster.ts:121-134`). `remember` releases an unfinished raster of the same key that shares members (`:226-241`).
  - A preview base must be finished, and it is marked used before `makeRoom` can drop it (`:144-151`, `:243-257`).
  - The only path that keeps showing a base's pixels for a new pool is an empty member diff (`fill-pool-raster-preview.ts:96-99`). That needs the same objects at the same key and colour. I found no layer-only change that alters a member's contours without changing its object, its key or its colour.
- **Dense threshold.** Crossing 4,000 segments and back (undo) re-plans, because the contours array is new each time.
  - `previewBase` does not compare `widthPx` (`:324-334`). A drag that carries a pool across 20,000 segments therefore previews the base outline at the old width until the 150 ms settle. This is cosmetic and inside Decision 7's preview allowance, so it is not raised.
- **Batching.** Pools of one key in one batch are separate box-overlap components, so their regions are disjoint. Any other drawing flushes the queue first (`fill-pool-paint.ts:57-77`, `draw-scene.ts:362`).

**#1552 thin strokes and the bounded glow (READ).**
- Thinning reaches only the artwork strokes and pool outlines painted directly (`object-display.ts:185-201`, `fill-pool-paint.ts:166,219`), at most 1 device px (`draw-complexity.ts:61-63`).
- Selection chrome is drawn by `drawObjectSelectionOverlay` and the selection-set overlay, which have no `hairline` input (`draw-scene.ts:373-390`). Non-output layers already draw at 0.75 px, which is unchanged.
- The cancelled-copy outline still shows at 1 px while the scene moves.
- The pulse is a hover cue. It rests during motion plus 140 ms (ADR-620 Amd 1 Decision 2), and an edit without a drag keeps it.
- No selected or error state depends on the 1.5 px width or on the glow. No finding.

### Not verified (refuter)

- **`zz-v4r\zz-v4r-pool.test.ts` and `zz-v4r\vitest.refuter.config.ts` were not run** (memory under the Vitest gate). The test extends the auditor's warm/cold/burn harness to three new scene types: converted text with non-zero rules (same-direction counters, an overlapping serif and a mirrored glyph), traced-style art with holes and islands, and an object whose second path also burns under a second Fill operation. Each scene runs 21 steps:
  - interval 0.5 → 0.25 mm, and a preset-style speed, power and passes change;
  - a hatch angle of 30° (warm against cold only);
  - a stacked duplicate, and an array copy;
  - a mirrored group, and a mirrored and turned group;
  - 110 overlapping circles that take a pool past 4,000 segments, then undo, redo and undo again;
  - output off on the second operation.

  The test runs from its own folder against `j10-main` with `--config`, and writes nothing in `j10-main`.
- Raster, preview and band drawing, and the scratch pair, need a real canvas: not drawn.
- No browser or e2e (gate 3 GB never met). L12 e2e owed as the auditor lists.

Refuter counts: raised 2, refuted 0, P1 0, P2 0, P3 2, known 1
