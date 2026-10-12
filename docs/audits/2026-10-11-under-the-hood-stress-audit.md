# Under-the-hood stress audit — quality, speed, ease of use (2026-10-11)

Checkout: `22868ee92` (detached; 3 commits behind `origin/main` at writing, none touching the
code below). Machine: i9-13900H, 20 logical CPUs, 32 GB, Windows 10.0.26200, Node 24.15.0.
The machine was shared with other work during parts of the run, so absolute times are upper
bounds; comparisons were interleaved. Browser numbers come from the Vite dev server in headless
Chromium, not a production build. No hardware was operated.

Evidence: `D:\LaserForge\stress-audit-evidence-20261011\` (logs, JSON, CPU profiles,
screenshots). Harness: `scripts/stress-audit/`, `e2e/stress-audit-walkthrough.e2e.ts`,
`e2e/stress-audit-topo-profile.e2e.ts` (diagnostics, not release gates; untracked).

## Summary

The core is solid: all 31,073 unit tests pass, no importer threw an unexpected exception or hung
in 7,000 fuzzed inputs, the GRBL streamer held its invariants across 6.8 million randomized
operations, and a 200-cycle soak shows no memory leak. Most pipeline stages scale linearly.

Two problems need fixing first:

1. **Line cuts of nested contours (topographic maps, mandalas, concentric designs) freeze the
   UI.** Contour containment costs O(rings² × vertices²) and runs on the main thread for the live
   estimate and preview. A 20-ring × 500-vertex map froze the browser for 4.1 s after import and
   4.3 s on Preview; 800 rings took 178 s in Node.
2. **A LightBurn file with a corrupt coordinate imports, and the project then cannot be saved.**
   The LightBurn importer accepts NaN, ±Infinity and 1e308 coordinates that the SVG importer
   already refuses. (Correction: an earlier draft said the save succeeds and the file then fails
   to reopen. In-app Save validates through `prepareProjectForPersistence` and refuses instead;
   only the raw serializer the probe called writes the unreadable file.)

All findings except the observations (8, 9) are fixed on `devin/stress-audit-fixes`; see
"Fix status" at the end.

## Findings

### 1. High — nested-contour Line compile is quadratic in both rings and vertices, on the UI thread

- `properContourAncestors` (`src/core/job/proper-contour-containment.ts`) tests every
  bounding-box-containing pair with `wholeOutlineInside`, which calls
  `segmentContainedInPolygon` once per target edge, and each call scans every container edge
  several times (`insideOrOn` twice, `addBoundaryTimes`, midpoint checks). Nested rings all
  contain each other's boxes, so the spatial index prunes nothing: cost ≈ R²·V².
- `lineTopologyCollections` (`src/core/job/compile-line-topology.ts:30,48`) runs it twice, once
  on the inputs and once on the kerfed survivors, even when kerf is 0 and the survivors are the
  same contours.
- The live estimate's gate (`costlyCanvasPreparation`, raw budget 100,000 segments in
  `src/core/job/preparation-complexity.ts:27`) measures input size only. A 10,000-point topo map
  is far under budget, so `estimateLiveJob` (`src/ui/laser/live-job-estimate.ts:75-84`) compiles
  it synchronously. The browser CPU profile attributes the long tasks to
  `estimateLiveJob → prepareOutput → compileJob → lineTopologyCollections → properContourAncestors`
  and to `prepareSnapshot`.

| Case (Line mode)                 | Points | Compile    |
| -------------------------------- | ------ | ---------- |
| topo 20 rings × 250              | 5,000  | 1.5 s      |
| topo 20 rings × 500              | 10,000 | 6.4 s      |
| topo 40 rings × 500              | 20,000 | 22.1 s     |
| rings sweep, 400 rings           | —      | 44.0 s     |
| rings sweep, 800 rings           | —      | 177.8 s    |
| Browser, 20 × 500, after import  | 10,000 | 4.1 s long task (8.2 s total) |
| Browser, 20 × 500, Preview       | 10,000 | 4.3 s long task |

The same rings in Fill mode take 3.7 s at 200 rings vs 10.4 s for Line, so this is specific to the
Line topology pass.

Recommended direction, in order of payoff:
1. Make one containment test per pair near-linear. For simple closed rings: if no edge of A
   crosses an edge of B (checked with an edge grid or sweep, not all pairs), one point-in-polygon
   test decides containment. Fall back to the current exact interval test only when edges
   actually touch or cross.
2. Skip the second `properContourDepths` when the survivors are the input contours unchanged.
3. Add a containment-cost term (Σ Va·Vb over box-containing pairs) to the preparation gate so
   scenes like this route to the existing preparation worker instead of the UI thread.

### 2. High — LightBurn import accepts non-finite and extreme coordinates; the project cannot then be saved

- Fuzzing 1,000 mutated `.lbrn2` files: 20 were accepted with NaN/Infinity points, and 102 of the
  233 accepted files that were compiled threw downstream.
- Reproduced on cases #27, #93 and #118 (`scripts/stress-audit/probe-lbrn-roundtrip.mjs`):
  import ok → `serializeProject` ok → `deserializeProject` returns
  ``invalid: missing or invalid `scene.objects[0].bounds.minX` ``. In the app, Save runs that
  same validation first and refuses, so the project, including any good objects and later
  work, cannot be saved until the damaged objects are deleted.
- Compile fails with "Canonical curve flattening exceeded the JavaScript safe-integer budget."
  (`src/core/job/compilation-polylines.ts:28-30`). The message blames a budget; the real cause is
  the geometry. Case #778 (62 points, coordinates around 1e308) spends about 60 s flattening
  curves, 35 % of it in GC, before throwing. The estimate gate counts only 62 points, so on the
  UI thread this would freeze the app for that long; that last step was not run in the browser.
- The SVG importer already refuses such input (`isSvgImportCoordinate`,
  `src/io/svg/svg-import-budget.ts:59-68`).

Recommended: apply the same finite and magnitude check to LightBurn geometry at import.

### 3. Medium — binary STL accepts NaN/Infinity vertices

- Both binary paths copy floats unchecked: `parseBinaryStl` (`src/io/stl/parse-stl-binary.ts:49-59`)
  and the app's worker path `parseBinaryBlob` (`src/io/stl/parse-stl-blob.ts:69-75`). The ASCII
  path rejects them (`parse-stl-blob.ts:125`).
- `meshToHeightmap` checks only the X/Y extents (`src/core/relief/mesh-to-heightmap.ts:97`).
- Reproduced through `prepareParsedStlImport`: a single NaN Z makes 1,275 of 2,500 heightmap
  cells NaN, and an Infinity Z makes all 2,500 non-finite. Import reports success.
  (Repro: `evidence/repro/stress-audit-stl-nan.test.ts`.)
- Not verified: whether output later refuses the job, and whether such a relief survives
  save/reopen.

Recommended: reject non-finite vertices in both binary paths, with the same message the ASCII
path uses.

### 4. Medium — editing latency on large single imports

The browser walkthrough measured a 2,000-rectangle SVG imported as one object:

- arrow-key nudge: 189–231 ms each, every press a long task;
- undo: 150–174 ms.

With 10,000 rectangles, nudges took 149–191 ms. Wheel zoom stays smooth (40–64 ms, no long
tasks), and Preview opened in 154 ms. A nudge near 200 ms is at the edge of what feels immediate,
so it is worth profiling the nudge commit path.

### 5. Medium (ease of use) — import progress toasts outlive the import

`createImportWorkerControls` (`src/ui/app/import-worker-controls.ts:24-33`) pushes a new toast
per phase ("queued", "reading", "parsing"), and `dispose()` does not dismiss them. Each info toast
stays up 8 s (`toast-store.ts:17-18`). After a 0.5 s import, three stacked toasts still say
"Press Esc to cancel" after Esc has stopped doing anything, and they cover the Preview scrubber
(screenshots `04-machine-panel.png`, `05-laptop-1024.png`). The first and only import in a fresh
session also reported "queued behind 1 import(s)".

Recommended: update a single toast in place, and dismiss it when the import settles.

### 6. Low — quick-nest scales about cubically

4,000 contours took 0.32 s, 8,000 took 1.8 s, and 16,000 took 13.8 s (growth exponent ≈ 3). The
dialog runs nesting in a worker, so this affects only very large part counts.

### 7. Low — job streamer does not guard GRBL realtime characters in comments

Stock GRBL acts on `!`, `~` and `?` anywhere in the byte stream, including inside comments. The
console refuses them (`src/core/controllers/grbl/console-command.ts:161`), but the job streamer
sends trailing `;` and `( )` comments verbatim (`streamer.ts:139-150`). KerfDesk's own output is
not affected: it writes only full-line `;` comments, which the streamer never sends. The risk is
latent and applies only if a third-party program is ever streamed as-is; I did not find a path
that does that today.

### 8. Observation — memory on large fills and rasters

Fill over 800 nested rings peaked near 2.4 GB of heap (20 s). Grayscale raster at 2000² took
12.5 s and 660 MB. Raster emit scales linearly in pixel count (exponent ≈ 2 in edge length, as
expected).

### 9. Developer speed

- Unit suite: 46.7 min for 31,102 tests in 3,851 files. Slowest files:
  `trace-downscale-area.test.ts` 86 s, `ring-detect.test.ts` 63 s, `vcarve-floor-depth.test.ts`
  49 s.
- `pnpm lint`: 10 min 52 s. `pnpm typecheck`: 4 min 31 s.

## What held up well

- **Correctness baseline:** 31,073 passed, 0 failed, 29 skipped. Typecheck and lint are clean.
- **Fuzzing:** 7,000 inputs across SVG, DXF, HPGL, G-code, STL, project and LightBurn produced 0
  unexpected exceptions, 0 hangs and 0 worker crashes. Refusals carry specific reasons, and the
  project loader names the exact invalid field.
- **Streaming:** 20,000 randomized protocol sessions (6.8 million operations) gave 0 invariant
  violations. Throughput is ≥ 193,000 lines/s in the worst case (short lines, 4 KB RX window),
  orders of magnitude beyond a serial link.
- **Soak:** 200 import → compile → stream → save cycles; heap slope −42 KB/cycle (30.6 → 30.3 MB),
  so no leak.
- **Scaling:** dense-path emit, serialize and stream are linear. 800,000 points emit in 7.1 s.
- **Large-file benchmark vs 2026-10-07 (`4165bb6fe`), interleaved, same fixtures:** 50,000-path
  SVG import took 2.8–3.0 s vs 6.2–7.5 s (about 2.3× faster) with an identical output hash. Line
  Art trace on the sparse 4096 page is unchanged within noise.
- **Accessibility:** of 154 visible controls on the first screen (191 after import), none is
  unnamed. All of the first 60 Tab stops show a visible focus style. The disabled Start explains
  itself ("Start unlocks after a clean Frame of this footprint and placement."). 44–54 controls are
  smaller than 24 px in one dimension (for example the Undo-list chevron at 16×26 and the jog
  selects at 19 px tall), worth a pass against WCAG 2.2 target size.

## Limitations

- Shared machine; Node timings are upper bounds. Browser timings come from the dev server, not
  the production bundle, so cold load (4.3 s, 249 script requests) is not representative.
- Finding 2's UI-thread freeze for case #778 is inferred from the gate and the Node profile, not
  measured in the browser.
- STL downstream behaviour (output refusal, save/reopen) was not traced.
- No air-cut, material or hardware qualification.

## Fix status (branch `devin/stress-audit-fixes`, from `origin/main` `416091469`)

| # | Fix | Measured after |
| - | --- | -------------- |
| 1 | `properContourAncestors` finds outline pairs whose boundaries approach each other in one indexed pass (`outline-boundary-contacts.ts`). Pairs that never approach are decided by one indexed point-in-polygon test; touching pairs keep the exact test, against an edge index (`polygon-edge-index.ts`). Small inputs keep the original scan. A differential test checks the results match the old all-pairs code exactly. | 100 rings 7.5 s → 0.12 s; 400 rings 44 s → 0.63 s; 800 rings 178 s → 1.8 s. Browser, 20 × 500 topo: longest task after import 4,091 → 112 ms, Preview 4,289 → 184 ms. |
| 2 | The LightBurn importer leaves out any shape with a coordinate, control point or arc radius that is not finite or lies beyond ±1,000,000 mm (the SVG/DXF cap) and names it in the import report; if nothing is left, the refusal says why. | Fuzz: non-finite accepted 20 → 0; downstream compile failures 102 → 0; slowest compile 39.8 s → 0.13 s. |
| 3 | Both binary STL paths refuse a NaN or infinite vertex coordinate, naming the triangle. | Fuzz: all 250 poisoned binary STLs refused; 0 non-finite accepted. |
| 4 | `CncPreparationStatus` hashes machining inputs only in CNC mode. `RunAgainControl` skips the replay signature when no completed job is on offer. Edits made with Preview open coalesce into one rebuild 200 ms after the last edit (entering Preview still builds at once). | 2,000-object nudge 189–231 → 66–100 ms, undo 150–174 → 72–86 ms, no long tasks; 10,000-object nudge 149–191 → 51–85 ms. |
| 5 | One keyed progress toast per import, updated in place and dismissed when the import settles (SVG/DXF/STL/HPGL/height-map and Import Image). The worker clients start a request before reporting the queue, so an import with nothing ahead of it is no longer reported as queued. | Unit-tested. |
| 6 | Quick Nest prunes only the newly split free rectangles. A differential test checks the result, order included, matches the old all-pairs prune. | 16,000 parts 13.8 s → 0.32 s. |
| 7 | No change. Only KerfDesk's own programs are streamed (external G-code is preview-only), its only trailing comment is a constant, and #1161 already strips realtime characters from exported comments. | — |

Observations 8 and 9 are not defects and were not changed.

Verification: full unit suite 31,223 passed, 0 failed (29 skipped); `src/ui` and `src/__fixtures__`
re-run after the Preview change, 16,237 passed; `pnpm typecheck`, ESLint and Prettier clean on
every changed file; `e2e/workbench.e2e.ts` and `e2e/performance.spec.ts` pass (12 tests).
