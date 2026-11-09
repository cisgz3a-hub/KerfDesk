# Rolling audit v12 — X4 Fix verification: the performance sweep

- **When:** 2026-11-09, 16:05–17:05 +0800   **Tree:** origin/main @ `a468f7bea`. Repros ran on the scratchpad export `j16-main` (`a468f7bea`, `node_modules` a junction), through esbuild bundles of main's real modules.
  - **Before/after method.** None of the files these seven PRs changed has changed on main since they merged (`git diff <merge> a468f7bea -- <PR files>` is empty for all seven, except `import-toasts.ts`, which #1617 touched later). So "main minus the PR" is main with exactly that PR's files taken from its parent with `git show`, overlaid at bundle time (`zz-x4\old\`). This isolates each PR on today's main.
  - **#1594** was compared against a full `git archive` of its parent `6b0d480b2` (`zz-x4\p1594\`). Between the PR and main, `src/core/trace` changed only by #1601's `Math.min`/`Math.max` spread rewrites. The ADR's own base `790b95c4a` was exported too (`zz-x4\b790\`) for the speed claim.
- **Scope:** the seven merged PRs below, on burn identity, staleness, the boot bundle, their speed claims and main's CI.
  - #1593 `6b0d480b2` objects keep their resolved display while the view pans (S2-P3-2).
  - #1594 `fe995cca6` tracer speed round, "the same paths" (ADR-530 Amd 15).
  - #1597 `e483d4685` large selections stop rebuilding panel state on each drag step (S2-P3-3).
  - #1606 `ca1f02ca1` adaptive verification stops at the first move over the limit (S8-P3-2).
  - #1607 `dd5e2d919` rest and adaptive pockets are planned once per output (S8-P3-1).
  - #1608 `968c7b749` Fill-pool groups are kept for the last two plans only (S9-P3-3).
  - #1611 `9d446e01f` worker-only libraries leave the boot bundle, and a byte guard keeps them out (S9-P3-2).
- **Lenses run:**
  - **Burn identity** (the performance audit's rule: "A speed fix may not change the burn"): traced paths and CNC G-code, main against main minus the PR (or the parent tree), byte for byte.
  - **L10:** each fix on the case it targets, plus edits, Undo, layer, scheme, tool and stock changes between frames and outputs.
  - **L3:** twins the PRs created: `selectionUnitCount` against `selectionUnits().length`; the memoised resolvers against fresh ones; the early verdict against the full simulation; on-canvas reuse against a fresh resolve; kept pool groups against a fresh module.
  - **L12:** main's CI history for each merge (`gh run list --branch main`, `gh api …/actions/runs?head_sha=`, `gh run view --job … --log`).
  - Not run: L2, L5, L6. No browser run (see Not verified). No hardware.
- **Counts:** 1 raised → refuter pending → P1 0 / P2 0 / P3 1 (+ 0 KNOWN).

## Headline

**All seven fixes keep the burn byte-identical, and none serves stale data in any sequence tried.**

- **Burn identity:**
  - **#1594:** 588 traces have the same SHA-256 on the parent and on main. They cover the 40 Q5 pages, the 5 full-size assets, 27 edge inputs and a 2048 × 1536 photo-like page with all 8 presets, plus a 4096² page with 4 presets. The edge inputs include 1 × 1 ink, paper, transparent and grey; 1-pixel lines; all-ink and all-paper; alpha, semi-alpha and white-on-clear; odd 997 × 13 sizes; and a 1-pixel checker.
  - **#1606 and #1607:** CNC G-code and the advisory text match across main, main − #1606, main − #1607 and main − both. That covers 15 cases, a 26-step adaptive load sweep, and two edit sequences of 22 and 13 outputs. The verifier's verdict also matches at its limit ±1e-9 mm on 4 plans.
- **Staleness:**
  - **#1593:** 38 frames of pans, zooms across tolerance buckets, an edit, Undo to the same object, recolour, hide, mode change, wireframe, ink palette and a dark-scheme switch while panning. The reused display equals a fresh resolve on every frame.
  - **#1607:** the memo never reused a plan across a same-id tool diameter or kind change, a stock change, depth, stepover, load or rough tool. Undo to the same project reused it correctly.
  - **#1608:** 56 frames over two canvases, including a pool deleted for four plans and then undone, and a drag of the evicted pool's anchor. The plan equals both the pre-#1608 plan and a fresh module's plan on every frame.
- **Boot bundle (#1611):** the guard ran on main's CI at `a3965a77d` (2,218 KiB) and `af1573c77` (2,223 KiB), both within 2 % of the 2,212 KiB baseline, with no worker-only package in a boot chunk. Every remaining importer of the worker-side parsers is a worker or a type-only import.
- **Speed claims hold** where measured:
  - pan of a 50,000-path object: 46.7 ms → ~0 ms per frame;
  - refused 150 × 100 adaptive recess: 8.1 s → 0.25 s (× 0.031);
  - rest and adaptive exports: × 0.59 and × 0.56;
  - Line Art on Q5: × 0.83–0.86.
  - **The exception is ADR-530 Amd 15's Sharp rows (X4-P3-1).** They are measured against a base without #1586. Against its own parent the round gives Sharp × 0.96–0.98, and #1586 accounts for about × 0.80.
- **L12:** #1593 and #1594 merged into the billing lock: every job failed on their merge commits, so nothing ran. The other five merged with CI cancelled on most merge commits. Every PR head passed all required checks, and each merged result has since passed CI, Browser smoke and Desktop package on a later main commit (table below). Local Vitest: 13 files, 61 tests passed.

## Matrix

"Same" means byte-identical output (SHA-256 of the G-code or of the traced paths' JSON, plus the advisory text for CNC). "Holds" means the fix's behaviour was reproduced.

| PR | Check | Result |
|---|---|---|
| #1593 | `placeObjects` on main vs main − #1593 vs a fresh `resolveObjectDisplay` per frame, 38 frames: pans in and off the canvas edge, zoom 3.2 / 3.9 / 4.0 / 4.1 / 7.99 / 8 / 2.01 / 2 / 1.99 / 0.25, edit, Undo to the same object, recolour, hide, Line mode, output off, wireframe, ink palette, dark scheme mid-pan, a far object brought on | same 38/38 (`placed-id.mjs`) |
| #1593 | speed: one object of 50,000 paths, 30 pan frames, alternating | 46.65 ms → 0.00 ms per frame, same display (holds) |
| #1594 | parent `6b0d480b2` vs main: Q5 40 × 8 presets, assets 5 × 8, edge 27 × 8, 2048 × 1536 photo × 8, 4096² logo × 4 | **same 588/588**, no errors (`trace-id.mjs`, `cmp.txt`) |
| #1594 | speed, alternating, median of 3 after one dropped | Line Art Q5 sum × 0.83–0.86, median × 0.85–0.96; Sharp × 0.96–0.98 (**X4-P3-1**); Smooth inconclusive (calibration drifted 37 → 64 ms) |
| #1597 | `selectionUnitCount` vs `selectionUnits().length`, 3,000 random scenes with overlapping, nested and missing-member groups and duplicate selection entries | 0 mismatches (`units-id.mts`) |
| #1597 | cached artwork names: empty, blank, dot-file, 600-character, Unicode, `data:` sources, then 5,000 more sources past the 4,096 limit | stable, equal to uncached |
| #1597 | `drawSecondarySelectionBox` without its own save/restore | always inside `drawObjects`' per-object `ctx.save()`/`ctx.restore()` (`draw-scene.ts:363,373,381`) and the last thing drawn there (READ) |
| #1597 | kept power rows (`AdvancedArtworkSettings.tsx:108-141`) | `powerResults` reads no transform (`artworkOutputRuns`, `effectiveObjectPowerPercent`); the `drag-reuse` test passes (READ + Vitest) |
| #1606 | G-code: 15 cases, a 26-step load sweep (0.5–2.4 mm on 60 × 40 and 40 × 30), 22 + 13 sequence steps; main vs main − #1606 | same, every row (`cnc-id.mjs`) |
| #1606 | verdict at the ceiling (`M − cell·√2` + {−1e-3, −1e-9, 0, +1e-9, +1e-3}) on 60 × 40 / 40 × 30 / island / circle plans | 20/20 same verdict and reason |
| #1606 | speed: refused 150 × 100 recess, export | 8,130 → 253 ms (× 0.031), same G-code (holds) |
| #1607 | G-code as above; main vs main − #1607 vs main − both | same, every row |
| #1607 | staleness, one process, as the window and worker do: rough end6 diameter 6 → 5 under the same id, finish end2 → 1.5, end6 kind → ball-nose, stock thickness and size, depth, stepover, load, rough tool, transform, origin, and back to the same object | every step equals the no-memo engine (`seq`, `seq2`) |
| #1607 | retention after the caller drops everything (S8's `rest-ord`, `adaptsq-ord`) | ≤ 1 MB more than without the memo (`cnc-retain.mjs`) |
| #1607 | speed: rest 120 × 80 / adaptive 60 × 40, export | × 0.59 / × 0.56, same G-code (holds) |
| #1608 | `planPools`, 56 frames: canvases A and B in turn, anchor drags, an operation deleted for four plans and undone to the same objects, a drag of the evicted pool's anchor, recolour and back, 30 one-object operations in turn | main = pre-#1608 = fresh module, 56/56 (`pools-id.mjs`) |
| #1608 | guard: keys kept after 30 operations drawn in turn | 2 (holds) |
| #1611 | `scripts/check-boot-bundle.test.mjs` | 5/5 pass |
| #1611 | CI step `pnpm check:boot-bundle` on main | `a3965a77d`: "2218 KiB boot total (12 files) … within 2 % of 2212 KiB"; `af1573c77`: 2,223 KiB, same verdict |
| #1611 | remaining importers of `io/svg` barrel, `io/xml`, `io/tiff`, `batch-raster-pixels`, saxes, fflate | worker modules or `import type` only (READ) |
| All | Local Vitest, the PRs' 11 test files + `selection-units` + `adaptive-pocket-verifier` | 13 files, 61 tests pass (`out\vt-focused.txt`) |

## Findings

### X4-P3-1 — ADR-530 Amendment 15 credits the tracer speed round with Sharp × 0.74 (Q5) and × 0.71 (logo), but its base predates #1586; against its own parent the round gives Sharp × 0.96–0.98

- **Where (a468f7bea):** `docs/decisions/ADR-530-contours-reach-the-scene-as-compact-curves.md:1263-1278`, the **Measured** table, rows "Q5, Sharp: sum" and "Logo, Sharp / Smooth". The paths and the burn are unaffected.
- **Anchor:**
  - **Contract:** ADR-530 Amendment 15, Measured: "Base `790b95c4a`, this branch and 1.0.28 `33bc394c6` alternate round by round in one process."
    - The table row reads `| Q5, Sharp: sum | 0.74 | 1.06 |` under "This / base".
    - The amendment says "S5-P3-1, Sharp preparing its source twice, was fixed separately by #1586", and "again after merging #1586" (Identity).
  - **History:** #1586 (`4e5047437`) is not an ancestor of `790b95c4a`. It is an ancestor of the PR's parent `6b0d480b2`.
  - **Lens:** L10 (measure the speed claim).
- **Scenario:** the performance ledger, a release note or the next speed round reads the Sharp rows as what Amendment 15 bought. Most of that Sharp gain is #1586's: Sharp skips the clean-art check's second preparation. The round itself adds a few percent. The next round would then start from a wrong picture of where Sharp's time went. The "What remains" list does say that Sharp on large pages is still above 1.0.28.
- **Evidence:** REPRO, `zz-x4\trace-speed3.mjs` → `out\trace-speed.txt`.
  - Bundles of `traceImageToColoredPaths` from three trees alternate round by round in one process: `790b95c4a` (the ADR's base), `6b0d480b2` (#1594's parent, with #1586) and main.
  - One round is dropped, then the median of three. Calibration read 65 → 66 ms, against about 36 ms quiet, so only the ratios hold.

  | Sharp | base `790b95c4a` | parent `6b0d480b2` | main | main / base | main / parent |
  |---|---|---|---|---|---|
  | Q5 (40), sum | 6,604 ms | 5,275 ms | 5,060 ms | **0.77** (ADR: 0.74) | **0.96** |
  | Q5, median | 74 ms | 62 ms | 58 ms | 0.79 | 0.94 |
  | Q5 `logo-clean` (480 × 264) | 68 ms | 58 ms | 53 ms | 0.78 | 0.91 |

  - An earlier two-tree set (parent and main only, calibration 78 → 68 ms) gave Sharp Q5 sum × 0.98 and logo × 0.89.
  - **Line Art reproduces the ADR's ratio against either base:** × 0.84 against the ADR's base (ADR 0.87) and × 0.83–0.86 against the parent.
  - The ADR's own "logo" is S5's 1024 px everyday logo, which is not in the tree. The Q5 logo stands in.
- **Severity:** P3.
  - **For P3:** doc/code drift in a measured claim. The burn is not involved: all 588 traces are byte-identical.
  - **Against anything higher:** no output, warning or user-facing number depends on it.
  - **Against raising it at all:** the amendment names #1586 as separate and tags the 4096 rows "(with #1586)". Whether the Q5 and logo Sharp rows were measured before or after the branch took #1586 is not recorded. Either way, they do not describe what the merged round adds over its parent.
- **Announced?** Partly. The text says #1586 was separate, but the table's base contains neither #1586 nor any label saying so on the Q5 and logo Sharp rows.
- **Novelty:** new. `git grep` over `docs/audits` (origin/main), the pro-loop v1–v3 folders and v12 finds no audit of #1594's measurements. The performance ledger (`LEDGER.md:62`) says only "first trace speed round merged (#1594)". No open PR touches ADR-530.
- **Fix direction:** in Amendment 15's Measured table, either:
  - re-measure the Sharp rows against `6b0d480b2`; or
  - label them "(base without #1586; #1586 alone ≈ × 0.80 on Q5)".
- **Refuter:** PENDING.

## Refuted

Candidates the auditor dropped:

- **"#1606's early stop uses a different limit from the verdict."** Both use `engagementCeilingMm(grid, plan.optimalLoadMm)` (`adaptive-pocket-verifier.ts:59` and `:87` → `:111`). Finishing and seed rings were never measured, so stopping after the first roughing move over the ceiling cannot change the verdict. The 20/20 verdicts at ±1e-9 mm of the ceiling match. The refusal now lacks `coverageRatio`, but no production code reads a refusal's numbers (`grep coverageRatio|maxSimulatedEngagementMm` in `src`).
- **"#1607's memo can serve a plan after a tool or stock change."** The key is every argument (contours, the layer's CNC settings, and the tool or the whole machine config, which carries tools and stock), compared leaf by leaf (`same-input-memo.ts:37-60`). Both resolvers read nothing else: no clock, no `globalThis`, no signal (`grep` over `adaptive-pocket*`, `rest-pocket*`, `cnc-rest*`, `cnc-pocket*`). A same-id tool edit changes `config.tools` and so misses. Both sequences show it.
- **"A shared memo result is mutated by one consumer and burns differently in the next."** `enforceCutDirection` maps to new polylines (`motion-polish.ts:67-75`), and `adaptivePocketPasses` and the rest group copy. A layer pair with identical settings, which shares one result, emits the same G-code as the no-memo engine (`twin-layers-identical-settings`).
- **"#1607's module-level memo keeps large plans alive in the window after the project closes."** It is bounded at 4 per resolver. After S8's `rest-ord` (21,057 lines) and `adaptsq-ord` (14,080 lines) it held ≤ 1 MB more than the no-memo engine.
- **"#1608's eviction can change which overlap groups a later plan draws."** An evicted key only forces a full sweep (`groupsFor` with `cached === undefined`). `regroupMoved` builds the same components as `overlappingGroups`: the same inclusive `boxesOverlap` rule, and both sort members and groups. 56/56 frames equal a fresh module's plan.
- **"#1593 reuses a display whose paint depends on something the key misses."** `resolveObjectDisplay` reads the object, `layerByColor` (built from `layers`, which is keyed), the view only through `displayCurveToleranceMm` (keyed), the cache, mode and palette (all keyed), and the colour scheme through `canvasVectorDisplayColor` and `canvasTheme.artworkInk` (keyed as `scheme`). 38/38 frames match.
- **"#1597's unit count differs from Align's units when a unit has no box."** `combinedBBox` is null only for an empty list (`hit-test.ts:415-430`), and a unit is never empty. 3,000 random scenes give 0 mismatches.
- **"Removing `drawSecondarySelectionBox`'s save/restore leaks a dash or stroke into the next object."** Its only caller runs inside the per-object save/restore and draws nothing after it (`draw-scene.ts:363-381`).
- **"A desktop or browser entry still pulls linkedom, saxes, tiff or fflate at boot."** For the web build, CI's guard found no worker-only package in the 12 boot chunks. For the code, the remaining importers are workers (`document-import-source.ts`, `document-import-parse.ts`, `tiff-import.worker.ts`, `import-worker.ts`) or `import type` (`import-worker-client.ts:10`, `import-worker-protocol.ts:27`, `tiff-artwork-source.ts:1`). The desktop-only Pro bodies import none of them.
- **"The lazy TIFF fallback fails offline."** It runs only where no Worker exists (`batch-raster-decode.ts:46`). The PWA precache globs every `.js` up to 8 MB (`vite.config.ts:134-136,196`).

## Verified clean

- **#1593:** reuse equals a fresh resolve through every view, edit, layer, mode, palette and scheme change tried. Pan speed holds (46.65 ms → ~0 ms per frame at 50,000 paths). `placed-objects-display-reuse.test.ts` passes.
- **#1594:** 588/588 traces byte-identical to the parent, including every edge input and both large pages. The 256-entry grey table is filled by the same expression it replaces, and `lumaAt` has no caller outside `src/core/trace`. The upscaler is used only by trace. Line Art's speed ratio reproduces. `trace-speed-round.test.ts` and `bilinear-rows.test.ts` pass.
- **#1597:** the unit count, the open-Fill counts (one scan, the same two reductions as `selectedOpenFillContourCount` and `selectedCloseableOpenFillContourCount`), the name cache and the selection box all match their twins. Its four test files pass.
- **#1606:** verdicts, reasons and G-code identical. The speed claim holds (× 0.031 on a refused 150 × 100 recess; P3-SWEEP says × 0.026 on 270 × 170).
- **#1607:** G-code identical over 76 outputs, no staleness, no retention. Speed holds (× 0.56–0.59; P3-SWEEP says emit × 0.03–0.1 on S8's cases, where planning dominates more). Its test files pass. Corroborated by X2: 1.0.29 and main emit the same CNC programs.
- **#1608:** plans identical; the bound holds (2 keys).
- **#1611:** the guard is wired into CI after `build:web` (`.github/workflows/ci.yml`) and into `release:check`, and its tests pass. It has measured main at 2,218–2,223 KiB.

### CI on the merged results (L12)

Main's push runs per merge commit (`zz-x4\ci-main.txt`). Each PR head passed every required check (`gh pr view --json statusCheckRollup`): lint/typecheck/test/build, unit tests 1–4/4, Chrome UX smoke, "Package, check and launch the desktop app", and for #1611 also the Linux AppImage/.deb and the commercial Linux rehearsal.

| PR | Merge commit | CI / Browser smoke / Desktop package on the merge | First later main commit where each passed |
|---|---|---|---|
| #1593 | `6b0d480b2` (11-06 07:20) | failure ×3 (billing lock: every job failed, nothing ran) | `5f09e1110` (#1598, 07:27): all three passed |
| #1594 | `fe995cca6` (07:21) | failure ×3 (same) | `5f09e1110`: all three |
| #1597 | `e483d4685` (11-08 19:32) | cancelled / success / cancelled | CI `2826e2932` (#1621); Desktop `42c23e777` (#1605) |
| #1606 | `ca1f02ca1` (19:33) | cancelled ×3 | CI `2826e2932`; Browser `c70612b58` (#1615); Desktop `42c23e777` |
| #1608 | `968c7b749` (21:01) | **success** / cancelled / cancelled | Browser `9d446e01f` (#1611); Desktop `8e7cca0ea` (#1614) |
| #1607 | `dd5e2d919` (21:10) | cancelled ×3 | CI and Desktop `8e7cca0ea`; Browser `9d446e01f` |
| #1611 | `9d446e01f` (21:45) | cancelled / success / cancelled | CI and Desktop `a3965a77d` (#1619); the boot-bundle step there passed at 2,218 KiB |

- `281ace097` (11-09 11:19) is the last main commit with all three passing.
- From `743d37bc4` on, Browser smoke fails on #1622's relief stock-compare spec. That is KNOWN (X3; fixed by #1646, X6/X7).
- `a468f7bea` was pending at 16:58.
- No merge in this area is untested on main.

## Not verified

- **Browser:** no rendered canvas, panels or pan timing in Chromium. Memory was 2.7–3.6 GB, so the gate was met; I chose Node runs of the real modules because the claims are about outputs and counts. The #1597 panel times (105 → 60 ms per drag step at 5,000 objects) were not re-measured, because they need React rendering. The kept rows were read and their test run instead.
- **The boot guard on a local build:** `build:web` needs a 6 GB heap and was not run. The guard's result comes from main's CI logs, and its logic from its unit tests.
- **Desktop renderer bundle:** the guard measures only the browser-Free build, in which the Pro entries are stubbed (`scripts/browser-free-build.ts:92-93`). The desktop renderer keeps the Pro bodies and has no byte guard. By READ, no desktop-only module imports a worker-only package. Not raised: S9-P3-2 concerns the web first download.
- **ADR-530 Amd 15's logo row:** S5's 1024 px logo is not in the tree. The Q5 logo (480 × 264) stands in.
- **Smooth speed:** the three-tree set's calibration drifted 37 → 64 ms (over 15 %), so it was discarded.
- **Adaptive `cutDirection: 'climb'`:** on an accepted 20 × 20 plan, climb gives the same G-code as unset. It does so on the no-memo engine too, so it is not #1607's doing, and it lies outside this area.
- **Hardware:** none, by instruction.

## Repro files

All files are in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-x4\`. Outputs are in `out\`. Nothing in the repo was touched except this report.

| File | What it does |
|---|---|
| `old\` | pre-PR files from `git show <merge>^1:<path>`: the verifier, both resolvers, `fill-pools.ts`, `placed-objects.ts`, `object-display.ts` |
| `build-cnc.mjs` → `cnc-{main,no1606,no1607,none}.mjs` | main's CNC output path with zero, one or both PRs overlaid away |
| `cnc-id.mjs` (`cases`, `seq`, `seq2`, `sweep`, `verdict`) | #1606/#1607 G-code identity, staleness sequences, the load sweep, the verdict at its ceiling |
| `cnc-speed.mjs`, `cnc-retain.mjs` | #1606/#1607 speed (alternating, calibrated); memory left after an export |
| `build-trace.mjs` → `tr-{main,p1594,b790}.mjs`; `p1594\`, `b790\` | trace entry of main, #1594's parent, and the ADR's base |
| `trace-id.mjs` (`q5`, `edge`, `assets`, `huge`, `photo`) | #1594 path identity |
| `trace-speed.mjs`, `trace-speed3.mjs` | #1594 speed, two and three trees (X4-P3-1) |
| `build-ui.mjs` → `ui-{main,old1593,old1608}.mjs` | canvas planning modules with each PR overlaid away |
| `placed-id.mjs`, `pan-speed.mjs` | #1593 staleness and pan speed |
| `pools-id.mjs` | #1608 plan identity over 56 frames |
| `units-id.mts` | #1597 unit count and name cache twins (run with `node --import ../zz-w4/register.mjs`) |
| `cmp.mjs` → `out\cmp.txt` | the row-by-row comparisons quoted above |
| `ci-main.txt`, `mainlog.txt` | main's push runs per commit since `8f988b6de` |
| `out\vt-focused.txt`, `out\boot-guard-test.txt` | local Vitest (13 files, 61 tests) and the guard's node tests |
| `p1606\`, `p1607\` | parent exports made for a fallback method; unused, because the overlay isolates each PR on main |

```json
{
  "area": "X4",
  "id": "fix-perf-sweep",
  "tree": "a468f7bea",
  "raised": 1,
  "findings": [
    {"id": "X4-P3-1", "severity": "P3", "area": "X4", "file": "docs/decisions/ADR-530-contours-reach-the-scene-as-compact-curves.md", "line": 1273, "anchor": "Contract ADR-530 Amd 15 Measured ('Base 790b95c4a …'); history: #1586 (4e5047437) not in 790b95c4a, in #1594's parent 6b0d480b2; lens L10", "evidence": "REPRO", "verdict": "PENDING", "known": false, "summary": "Amd 15's Sharp rows (Q5 sum 0.74, logo 0.71) are measured against a base without #1586; three trees alternating: base→main 0.77, parent→main 0.96 (logo 0.91); #1586 alone ~0.80. Paths and burn unaffected (588/588 identical)."}
  ]
}
```

## Refuter (2026-11-09)

- **When:** 2026-11-09, evening +0800. **Tree:** origin/main @ `a468f7bea`, through the scratchpad export `j16-main`.
- **Method:** Node runs of main's real modules. I reused the auditor's esbuild bundles (`zz-x4\cnc-*.mjs`, `tr-*.mjs`, `ui-*.mjs`) and built three of my own: `ui-main`/`ui-old1593` with `createDisplayPolylineCache` exported, `tr-r790` (see X4-P3-1), and a metafile-only graph of the desktop renderer.
- **Not run:** Vitest and the browser. Free memory was 2.1–5.9 GB, so the gates were met, but every question here is about outputs or the import graph.
- **Not touched:** anything in the repo except this section.

### Verdicts

#### X4-P3-1: CONFIRMED, P3

The measurement reproduces. I added one tree the auditor did not have, which rules out the most charitable reading.

- **The question.** The amendment says the branch was checked "again after merging #1586". So the Q5 and logo Sharp rows might have been measured before that merge, as the round alone against `790b95c4a`. If so, 0.74 would be honest for its time.
- **The new tree, `r790`.** I exported `790b95c4a` and applied #1594's `src` diff to it (`pr1594-src.diff`).
  - One hunk had to be ported by hand. #1586 had refactored `forEachCrack` in `staircase-source.ts`, so the hunk was rebuilt with the same `rowInk` reader and the same `crackCount` arithmetic.
  - `r790` traces the 40 Q5 pages × 8 presets byte-identically to `790b95c4a`: 320/320 (`out\r790-id.txt`).
- **Speed.** `b790`, `r790`, `p1594` and `main` alternate round by round in one process. That is `trace-speed4.mjs`, the auditor's harness with a fourth tree. Sharp, three runs of 4 rounds each, first round dropped, median.

  | Sharp, Q5 sum | r790 / b790 (round alone, ADR's base) | p1594 / b790 (#1586 alone) | main / p1594 (round as merged) | main / b790 (what the ADR row compares) |
  |---|---|---|---|---|
  | run 1 | 0.97 | 0.89 | 1.00 | 0.89 |
  | run 2 | 0.91 | 0.78 | 0.93 | 0.73 |
  | run 3 | 0.93 | 0.83 | 0.96 | 0.80 |

- **Noise.** Calibration read 77–154 ms, against about 36 ms quiet, and drifted more than 15 % within each run. So only the ranges hold.
- **What the ranges show:**
  - The round alone gives Sharp × 0.91–0.97, whether it sits on the ADR's base or on its parent.
  - The ADR's 0.74 appears only as main / `790b95c4a`, which is the round plus #1586.
  - So whenever the rows were measured, they credit #1586's gain to Amendment 15. This agrees with the auditor's × 0.96–0.98 and × 0.77.
- **Severity.** P3 kept. It is doc drift in a measured claim. Paths are byte-identical (588 + 720 traces, below), and no output, warning or user-facing number reads the table.
  - Against refuting it: the table's header names `790b95c4a` as "base" with no caveat on those rows.

### Challenges to "Verified clean"

Every challenge below failed to break a claim. All comparisons are byte for byte.

#### #1594, 720 new traces

`trace-r.mjs` → `out\trace-{main,p1594}-{small,big}.jsonl`, compared by `cmp-trace.mjs`. Result: **720/720 identical** between `6b0d480b2` and main, with no errors.

- **Inputs the auditor's 588 did not cover.** Decoding is outside `src/core/trace` and #1594 did not touch it, so each format is given as the RGBA it decodes to.
  - Noise at the threshold edges: 126–130 around 128, ±1 around 127–129, and a mid-grey photo with ±15 noise.
  - A 16-colour palette image with an ordered dither, and a 2-colour palette logo.
  - A 16-bit ramp reduced to 8 bits.
  - A CMYK→RGB rich black on off-white, with chroma noise.
  - An EXIF rotate-90 and an EXIF mirror of the logo.
  - Strips 1 × 2048, 2048 × 1, 2 × 1500 and 3 × 99.
  - The small-source upscale edges, 99 and 100 px.
  - Thin 1-pixel lines, and alpha at 127, 128 and 129.
- **Budget boundaries:**
  - 1224² and 1225² (the 1.5 MP upscale budget);
  - 1060 × 1061 and 1061² (the 4.5 MP contour-supersample budget after ×2);
  - the 2048-edge trace cap, noisy at the threshold (2048 × 1365).
- **Settings.** Every small input ran 8 presets × 5 dialog variants:
  - default;
  - `thresholdLuma` 127;
  - `thresholdLuma` 129 with `invert`;
  - "raw": ignore 0, smoothness 0, optimize 0, despeckle 0, no pinhole fill;
  - `traceTransparency` with no sketch and `cutoffLuma` 128.

  The variants are not inert: 307 distinct outputs in 680 rows. The large inputs ran 8 presets each, at default.

#### #1606 and #1607, 30 new outputs

`cnc-r.mjs` → `out\cnc-{main,none,no1607,main-fresh}.jsonl`. Result: **30/30 identical** (G-code SHA-256 plus advisory text) across four engines:

- main in one session, as the window and the worker reuse their memos;
- main with a fresh process per step;
- main − #1607;
- main − both.

The sequence:

- **Rest machining with three tools on one shape:** end6 → end3, end3 → end1 and end6 → end1, with an island. Then a same-id end3 diameter edit, Undo, and re-pointing one rest layer's rough tool, then Undo.
- **Adaptive with tabs and leads:** tabs, an arc lead, a ramp, finish allowance and lift-between-rings. All of these are inert for adaptive: same G-code as the base.
- **Adaptive cut direction and entry:** climb, conventional, conventional on a front-right origin, and `helixEntry`.
- **Several outputs sharing end6:** adaptive at two depths on one object, rest roughing, and a plain pocket. Then a same-id end6 diameter edit, and Undo.
- **Project switch:**
  - project B with the same layer and object ids but different geometry;
  - back to A;
  - File > Open of a copy with a different object id.
- **Memo pressure:** six distinct adaptive outputs (more than the capacity of 4), then back to the first.

Every adaptive plan here was accepted, so the memo-hit path ran. No step took the offset fallback.

#### #1608, 49 new frames

`pools-r.mjs` → `out\pools-r.txt`. Result: **49/49 frames identical** across main (session), main − #1608 (session) and a fresh module per frame. The guard held: 1–3 keys kept.

- **Two pools in alternation:** 8 plans, each dragging the anchor plus a middle member.
- **A three-canvas cycle, in which every plan evicts.** Drags of 1, 5, 33 and 40 members, the last two over `MAX_MOVED_MEMBERS` (32).
- **20 random drags on a dense 60-member pool:** 1–34 members at a time, which exercises `regroupMoved` against a full sweep.
- **Undo across an eviction:**
  - delete R, then three plans elsewhere;
  - Undo to the very same R objects;
  - drag R's anchor, drag it back, then Undo by identity.

#### #1593, 19 new frames

`placed-r.mjs` → `out\placed-r.txt`. Result: **19/19 frames identical** across main, main − #1593 and a fresh resolve.

- **The cache.** These runs use the app's real `DisplayPolylineCache` (`createDisplayPolylineCache`). The auditor ran with `undefined`.
- **Frames:**
  - a Re-import mid-pan (same id, new paths and curves);
  - a font change on a `text` object mid-pan (same id, new glyph paths);
  - a re-import that keeps the `paths` array but changes scale;
  - curves replaced with polylines kept;
  - an operation move;
  - zooms across the 6.1 / 6.2 / 12.5 buckets, with pans between.
- **By READ:**
  - The key is object identity (a WeakMap) plus layers, cache, mode, palette, scheme and tolerance bucket.
  - `layerByColor` is a pure function of `project.scene.layers` (`draw-scene.ts:330`).
  - Text paths are baked into the object, so a font load reaches the canvas only as a new object.
  - No production code mutates `obj.paths` in place (`grep`).

#### #1597, by READ

Undo mid-drag cannot serve stale rows.

- `sameApartFromTransforms` keeps rows only when every key except `transform` is identical by `===`. The key count must match too.
- An Undo that restores other objects (other ids, power scale or operations) changes a non-transform key or the length, and so recomputes.
- `powerResults` reads no transform:
  - `artworkOutputRuns`, `effectiveOperationForObject` and `objectPowerScalePercent` read `powerScale` only (`effective-output.ts:48-54`);
  - `artworkOperationName` reads `source` and kind.
- The name cache is keyed by the `source` string, and the result is a pure function of it.

#### #1611, desktop renderer bundle

The read-only claim now has a REPRO: `desktop-graph.mjs` → `out\desktop-graph.txt`.

- **Graph.** An esbuild metafile of `src/ui/app/browser-entry.ts` with **no browser-Free stubs**, so the Pro bodies are kept, as on desktop. The walk follows the boot closure: static imports, plus the `./main` dynamic import and its static imports.
- **Result.** 4,811 files, including all the Pro entries:
  - `DesignStudioHost`, `BoxGeneratorHost`, `RegistrationJigPanel`, `BoardCapturePanel`, `WorkspaceCameraOverlay`;
  - the `vcarve-medial*` and `compile-cnc-relief*` modules.
- **Worker-only packages.** None of linkedom, saxes, tiff or fflate is imported statically or dynamically from any file in that closure. The only importers are `parse-svg-worker.ts`, `read-xml-document-from-blob.ts`, `document-import-parse.ts` and the `tiff-*` modules. All of them are reached only through Vite worker or lazy imports.
- **Caveat.** esbuild's graph is not Vite/Rollup's chunking. It shows what is reachable, not chunk bytes. So the "no byte guard on the desktop renderer" gap in the auditor's Not verified stands, but no worker-only package is in reach at boot.

### The climb observation: KNOWN (F2-P3-1), not new

The auditor saw climb give the same G-code as unset. Both are correct as designed, because the planner's native winding realises climb on that frame.

- **The question asked.** Is the user's cut-direction choice ignored for adaptive?
- **What follows the setting.** On an accepted 20 × 20 adaptive pocket (rear-left benchmark frame), Conventional flips the helix (12 `G2` → 12 `G3`) and reverses the finishing ring (3,168 → 3,161 lines).
- **What does not.** The roughing chain does not reverse. The 1,556-line `G1` run is **byte-identical** between climb and conventional (`out\main-adapt_climb.nc`, `out\main-adapt_conventional.nc`). The same holds on a front-right origin. So "Conventional" still roughs nearly all the material climb.
- **The UI.** It offers the choice for adaptive pockets. `MotionPolishRows` shows Cut direction for every `pocket` (`CncLayerToolFields.tsx:80-103`), with no adaptive caveat.
- **Already raised.** **F2-P3-1** in `docs/audits/2026-10-23-cnc-v1/F2-cnc-pocket-adaptive.md:296`, CONFIRMED P3 by its refuter, and still unfixed at `a468f7bea`. It predates all seven PRs, and the no-memo engines give the same output.
  - DECISIONS.md ADR-312 item 4 (`DECISIONS.md:19540-19544` at `a468f7bea`) states "the planned open adaptive engagement chain is not reversed", so this is drift between the setting and what is documented, not an undocumented behaviour.
- **Severity.** I keep P3. Engagement is capped at 10 % of the diameter by default, which bounds the pull-in that climb causes on a machine with backlash. The setting itself is respected wherever ADR-312 says it applies. Not re-raised.

### New findings

None.

### Not verified

- **Browser:** canvas, panels and React rendering, including #1597's 105 → 60 ms per drag step. Not run; Node runs of the modules instead.
- **Real decoder outputs.** Palette, 16-bit, CMYK and EXIF files were not decoded by the browser. Their RGBA was synthesised, because decoding is outside #1594's diff.
- **X4-P3-1 timing.** The PC was never quiet, and calibration drifted more than 15 % in every run, so only the ranges hold. The `r790` hand-port of the `staircase-source.ts` hunk was checked for identity (320/320), not for being the exact code the branch had before it merged #1586.
- **Desktop byte size** (Vite chunking) and a local `build:web`: not run.
- **Hardware:** none.

### Repro files

All files are in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-x4r\`. Outputs are in `out\`.

| File | What it does |
|---|---|
| `cnc-r.mjs` | #1606/#1607: the 30-step sequence; `node cnc-r.mjs <main\|none\|no1607> [step]` |
| `pools-r.mjs` | #1608: the 49 frames |
| `build-ui-r.mjs` → `ui-main.mjs`, `ui-old1593.mjs`; `placed-r.mjs` | #1593 with the real display cache |
| `trace-r.mjs <main\|p1594> <small\|big>`, `cmp-trace.mjs` → `out\cmp-trace.txt` | #1594: the 720 new traces |
| `r790\`, `pr1594-src.diff`, `build-trace-r.mjs` → `tr-r790.mjs`, `r790-id.mjs`, `trace-speed4.mjs` → `out\trace-speed4.txt` | X4-P3-1: the round on the ADR's base, its identity, and the four-tree Sharp speed |
| `desktop-graph.mjs` → `out\desktop-graph.txt` | #1611: the desktop boot-closure graph |

```json
{"refuter": "X4", "verdicts": [{"id": "X4-P3-1", "verdict": "CONFIRMED", "severity": "P3", "evidence": "REPRO: four trees; the round alone on 790b95c4a gives Sharp Q5 sum x0.91-0.97, #1586 alone x0.78-0.89, main/790b95c4a x0.73-0.89"}], "new": [], "known_touched": ["F2-P3-1 (cnc-v1): adaptive roughing chain ignores Cut direction; still open on a468f7bea, predates X4's PRs"]}
```

Refuter counts: raised 0, refuted 0, P1 0, P2 0, P3 1, known 1
