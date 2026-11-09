# Rolling audit v12 — X3 Fix verification: design, text and import

- **When:** 2026-11-09, 15:20–16:00 +0800   **Tree:** origin/main @ `be671b158`. Repros ran on the scratchpad export `j15-main` (`be671b158`, `node_modules` a junction).
  - Before/after trees: `j13-main` is the parent of #1635 (`d89e305be`); a hash check of its 4,495 files under `src/io/svg`, `src/core`, `src/ui/library` and `src/ui/state` found 2 differing files, both line endings in library SVGs. The pre-#1602 base64 loops were taken from `a5cfc3fca^1` with `git show`.
- **Scope:** the seven merged PRs below, on fresh imports and edits on main (X2 owns the returning-user side of #1617 and #1635).
  - #1614 `8e7cca0ea` Cut last checks each part (V7-P2-3, ADR-480 Amd 3).
  - #1617 `3688c68e2` white knock-out: see-through/gradient/masked white is ink, Re-import keeps settings (V7-P2-1/2, ADR-686 Amd 1 and 3; Amd 2 is X2's).
  - #1601 `258f853e6` text on a path and bent text at any length; no spread into `Math.min`/`Math.max` (S7-P2-3, ADR-691).
  - #1602 `a5cfc3fca` variable copies in slices, Cancel, embedded fonts encoded in bulk (S7-P2-1/2, ADR-307 Amd 4, ADR-628 Amd 2).
  - #1592 `829078da4` remote and jig text edits laid out in the text worker (N4-P3-2, ADR-643 Amd 1).
  - #1635 `af1573c77` SVG CSS transforms read as a browser does (14-P3-1, ADR-574 Amd 1).
  - #1636 `0cefa7723` DXF noise bulges and huge SVG arcs import straight; DXF/HPGL refuse drawings past the project limit (W5-P1-1, W5-P2-1/2, ADR-159 Amd 3, ADR-307 Amd 5).
- **Lenses run:**
  - **L10:** each fix on the case it targets.
  - **L3:** twin routes: compiled job against the prepared job Job Review, Save and Start read; text worker against the UI thread; old base64 loops against the shared codec; parent parser against main on every SVG in the tree; DXF LWPOLYLINE, heavy POLYLINE and block INSERTs; HPGL; the Design Library route.
  - **L4:** malformed base64, scaled and mirrored INSERTs, unit-scaled DXF, a remote `update_text` racing a desktop edit, Cancel and design changes during variable copies, positions and sizes past the loader's limit.
  - **L12:** main's CI history for each merge.
  - Not run: L2 beyond the ADRs' own Chromium measurements (no browser run, see Not verified), L5, L6. No hardware.
- **Counts:** 2 raised → refuter pending → P1 0 / P2 1 / P3 1 (+ 2 KNOWN: 13-P3-1, still open and the cause of X3-P3-1; X2-P3-3, Re-import moves CSS-only transformed parts).

## Headline

**Six of the seven fixes hold on the case they target and on every sibling route tried.** The exception is a route #1614 never reached.

- **#1614 (Cut last):** it warns for two coasters, a grid and nested cuts on the compiled job. Job Review, Save G-code and Start read the **prepared** job, and preparation turns a led contour into an open burn. So **any cut with a lead-in or lead-out silences the warning** (X3-P2-1): one coaster, two coasters and a round coaster all compile to cut-then-fill with no advisory. The gap is older than #1614 (Amd 2 had the same `segment.closed` filter), but the each-part fix and its tests never met it.
- **#1636:** noise bulges are straight on LWPOLYLINE, heavy POLYLINE, rotated, scaled, non-uniform and mirrored INSERTs, and SVG arcs under rotation, ellipse radii and group scale. Every such import saves. Unit-scaled DXF, HPGL and SVG past 1,000,000 mm are refused or skipped.
  - ADR-307 Amd 5 promises that a project reaching the limit "by another route" gets a recovery copy that opens. That is false for the known route, a position or size typed past the limit (13-P3-1). The refusal says "cannot be stored (missing or invalid `scene.objects[1].transform.x`)", and the raw copy is refused on reopen (X3-P3-1).
- **Byte identity holds where it should:**
  - **#1592:** text-worker layout equals the UI thread on 7 of 7 cases, including frames and stroke fonts.
  - **#1602:** the shared base64 codec equals the old loops on 802 of 802 encode/decode cases, with and without the engine's native base64, malformed text included.
  - **#1635:** the parent and main parse all 27 SVGs in the tree identically. Exporter-style transform lists are identical too; only the invalid ones change, and main warns about those.
- **#1601:** text of 2,000 characters in Special Elite (3.5 M points) lays out on a 40,000-point guide and bends.
- **L12:** #1636 has **no completed unit-test CI run on any main commit that contains it**. CI on `0cefa7723` and on all five later main commits was cancelled. Its Browser smoke failed only on the known relief stock-compare spec (#1646's), and the Desktop package check on `be671b158` failed in the Linux AppImage build. Its PR head passed CI 9/9. Local Vitest on `be671b158` passed 16 files and 653 tests for the seven PRs.

## Matrix

"Same" means byte-identical output or geometry. "Holds" means the fix's behaviour was reproduced on that route.

| PR | Route / twin | Result |
|---|---|---|
| #1614 | `compileJob` → `cutsBeforeEngraving` (the tests' route): 1 and 2 coasters, round coaster, overcut, kerf, leads | warns in every case |
| #1614 | **prepared job → `detectMachineJobWarnings`** (Job Review, Save G-code, Start), plain cut / overcut 2 mm / kerf 0.1 mm | warns (holds) |
| #1614 | **prepared job, lead-in, lead-out or both**, on 1 coaster, 2 coasters and a round coaster | **silent, X3-P2-1** |
| #1617 | fresh import routes: file and drag-drop (`importSvgFragment`), Remote `add_svg`, Design Studio (both commit through `importSvgFragment`/`reimportSvgFragment`, READ) | same store action as the tested route |
| #1617 | Design Library (`importSvgObject`, Line artwork) | no knock-out by design (Line). `laser-in-use.svg` and `flower.svg` hold white, and their file import knocks it out. Not raised: ADR-686 scopes paper to fills |
| #1617 | Re-import of 1.0.29 logos, copies | X2 (X2-P1-1, X2-P3-1..3); not re-audited |
| #1601 | long text on a path and bent: 100 / 600 / 2,000 characters (177 k / 1.05 M / 3.5 M points), 40,000-point guide | holds (161 ms / 646 ms / 2.6 s) |
| #1601 | remaining spreads: `String.fromCharCode(...x)` (camera nonce 32 B, project seal hash, font name records, PNG chunk types) and text `push(...)` (per glyph or per line) | bounded; `push` is announced as not covered by ADR-691 D3 |
| #1602 | embedded-font and depth-map base64, old loops vs shared codec, native `toBase64`/`setFromBase64` present and removed | 802/802 same, both paths |
| #1602 | variable copies: Cancel, design change during the slices | `isCurrent` compares the project object (Array dialog `:199-200`, Edit Array `R139-140`), so any edit cancels (READ) |
| #1592 | worker (`createTextWorkerRuntime().respond` + `structuredClone` + `unpackTextRenderResult`) vs UI-thread `renderTextGeometry` | 7/7 same: Roboto, spacing + centre + 2 lines, Dancing Script, Special Elite 300 characters, shrink-wrap frame, Relief and EMS stroke fonts |
| #1592 | remote `update_text` racing a desktop edit | `commit` re-asserts `expectedRevision` (`adapter.ts:257-260,293-294`); the jig drops a stale result on any project change (`JigTextControls.tsx:62-66`). Holds (READ) |
| #1635 | parent (`d89e305be`) vs main on all 27 SVGs in the tree, library included | 27/27 same |
| #1635 | exporter spellings: Inkscape matrix, Illustrator chains, `rotate(a cx cy)`, skews, exponents, packed numbers, separators, `<use>`, nested `<svg>`, `style="transform:none"` | 14/18 same |
| #1635 | trailing comma, trailing `;`, `Translate(…)` | voided **with** the ADR D9 warning (D7, browser behaviour) |
| #1635 | `transform-origin="5 5"` presentation attribute | now applied, no note (D5, browser behaviour) |
| #1635 | clip shapes with a CSS transform | refused with a message (`svg-clip-presentation.ts:80-84`) |
| #1636 | DXF bulge 1e-17/1e-18: LWPOLYLINE, heavy POLYLINE, block INSERT ×2 rotated 30°, non-uniform 2×1, mirrored −1 | 4 lines each, true size, Save ok |
| #1636 | SVG `A1e17`: plain, rotated 30°, ellipse 1e17×5e16, inside a filled plate, relative under `scale(3)` | straight, true size, Save ok |
| #1636 | SVG `A1e17` large-arc | refused ("extreme coordinates"), as ADR-159 Amd 3 D4 says |
| #1636 | limit: DXF inches 39,000 in / 40,000 in, metres 1,001 m, mm 999,999; HPGL 1,000,001 mm; HPGL `AA` far centre; SVG 1,000,001 mm | in-range ones import and save; past-limit ones are skipped, refused or throw |
| #1636 | limit by another route (numeric X / W past the limit) | **X3-P3-1**, root cause KNOWN 13-P3-1 |

## Findings

### X3-P2-1 — A cut with a lead-in or lead-out never gets the "Cut runs before the engraving inside it" warning in Job Review, Save G-code or Start

- **Where (be671b158):**
  - `src/core/cut-before-engraving.ts:122-124` (`closedOutlines`): only `segment.closed` segments are outlines. `:71` registers them.
  - `src/core/job/apply-laser-leads.ts:8` ("A closed contour of a Line cut group whose operation asks for leads becomes one open burn"), `:153` and `:441` (`closed: false, leadContour`). Preparation runs this, so the prepared job's led contours are open.
  - `src/ui/laser/machine-job-warnings.ts:48` (`const job = prepared?.job`) and `:80`; `src/ui/laser/job-intent-warnings.ts:67`. Every production caller passes the prepared job:
    - Job Review: `output-preparation.ts:69` (prepare).
    - Save G-code: `:123` and `save-gcode-emission.ts:172`.
    - Start: `start-job-warnings.ts:22`.
  - Tests use `compileJob` only (`cut-before-engraving.test.ts:99`; `cut-order-warnings.test.tsx:85` compiles inside `detectJobIntentWarnings`), so no test meets a lead.
- **Anchor:**
  - **Contract:**
    - ADR-480 Amendment 3 Decision 2: "Only a closed Line contour is an outline (tabs and perforation hold the part)". A led contour is a closed contour that frees the part; a lead holds nothing.
    - Decision 4: "What is warned besides one coaster: two coasters on one operation, a grid…".
  - **Twin:** the compiled job warns, but the prepared job, which is the one the operator sees, does not. The amendment's Status says "Tested on the compiled job".
  - **Lens:** L3.
- **Scenario:** a maker cuts coasters out of plywood with a 2 mm lead-in so the pierce mark lands in the scrap (ADR-626, the LightBurn-style lead option on a Line operation). The outline operation sits above the name's Fill in the list, as U3's beginner drew it.
  - Job Review shows no "Cut runs before the engraving inside it" row and no Cut last button.
  - The program cuts every coaster free, then engraves each name. On a honeycomb bed a freed part can drop or shift before its name is burned (U3-P2-4, V7-P2-3).
  - Without the lead, the same project is warned.
- **Evidence:** REPRO, `zz-x3\cut1.mjs`. Main's `prepareOutputSnapshot` → `detectMachineJobWarnings(prepared)`, filtered with `isCutBeforeEngravingWarning`. Each case is an 80 mm outline (Line, 100 %, 300 mm/min) holding a 20 mm Fill name.

  | Case | `compileJob` finds | Prepared job finds | Job Review / Save / Start warning | Prepared cut segments closed | Burn order |
  |---|---|---|---|---|---|
  | 1 coaster, plain cut | 1 | 1 | 1 | `[true]` | cut, then fill |
  | 2 coasters, plain cut | 1 | 1 | 1 | `[true, true]` | cut, then fill |
  | 1 coaster, overcut 2 mm | 1 | 1 | 1 | `[true]` | cut, then fill |
  | 1 coaster, kerf 0.1 mm | 1 | 1 | 1 | `[true]` | cut, then fill |
  | **1 coaster, lead-in** | 1 | **0** | **0** | `[false]` | `; layer cut … leads in arc 2.000 mm`, then fill |
  | **1 coaster, lead-out** | 1 | **0** | **0** | `[false]` | cut, then fill |
  | **1 coaster, lead-in + out** | 1 | **0** | **0** | `[false]` | cut, then fill |
  | **2 coasters, lead-in + out** | 1 | **0** | **0** | `[false, false]` | cut, then fill |
  | **round coaster, lead-in + out** | 1 | **0** | **0** | `[false]` | cut, then fill |

- **Severity:** P2.
  - **For P2:**
    - The precedents rate the same harm P2: V7-P2-3 (two coasters, the case #1614 fixes) and U3-P2-4.
    - It is an advisory that goes missing on an ordinary option, and nothing else tells the operator.
    - The harm is the part dropping before its engraving.
  - **For P1:** the output is the order the operator set. The warning is the only safeguard, and P1 needs silently wrong physical output.
  - **Against P2:** leads are off by default (no preset enables them: `grep leadInEnabled: true` finds none), so reach is opt-in.
- **Announced?** No. ADR-480 Amd 3's "What stays quiet" list (Decision 3) names neither leads nor the prepared job. ADR-626 says every output reads the led burn, but not that advisories lose the ring.
- **Novelty:** new. `git grep -i "lead.?in|leads"` in `docs/audits` finds no cut-before-engraving case. No open PR touches `cut-before-engraving*`, `cut-order-warnings` or `apply-laser-leads`.
  - It is older than #1614: `8e7cca0ea^1:src/core/cut-before-engraving.ts:79` had the same filter, and leads arrived in October (`66972d140`, 2026-10-20).
- **Fix direction:**
  - In `closedOutlines`, treat a segment with `leadContour` as its closed ring `polyline.slice(from, to + 1)`. Or run the check on the job before leads are applied.
  - Add a lead-in case to `cut-before-engraving.test.ts` and to `cut-order-warnings.test.tsx` through `prepareOutputSnapshot`.
- **Refuter:** PENDING.

### X3-P3-1 — ADR-307 Amd 5 promises that a project over the limit "by another route" gets a recovery copy that opens; for a position or size typed past the limit, the copy is refused on reopen and Save's refusal names a field path

- **Where (be671b158):**
  - `src/io/project/refused-scene-object.ts:25-29` (`sceneObjectCoordinatesInRange`) checks bounds and imported path points only, never `transform.x/y` or scale.
  - `src/ui/app/recovery-copy-plan.ts:27` uses it, so the plan leaves nothing out.
  - `refused-scene-object.ts:61` then words the loader's refusal as "cannot be stored (missing or invalid `…transform.x`)".
  - The loader refuses `|transform.x| > 1,000,000` and `|scale| > 100,000` (`project-shape-validator.ts` `validateTransform`; `project-shape-primitives.ts:2,4,51,58`).
  - The route: `positionSelection` and `resizeSelection` (`src/core/scene/selection-transform.ts:149-167`) check finiteness only (KNOWN 13-P3-1).
- **Anchor:**
  - **Contract:** ADR-307 Amendment 5 Consequences (`:63-64`): "A project that still reaches the limit by another route names the object at Save and autosave, and its recovery copy opens."
  - **Twin:** `sceneObjectCoordinatesInRange` against the loader's `validateTransform`.
- **Scenario:**
  - A slip of zeros in the X field (1,200,000) or W field moves a part past the limit.
  - Save and autosave both say "object 2 (traced image) cannot be stored (missing or invalid `scene.objects[1].transform.x`)".
  - The salvage prompt offers a **raw** copy ("may need repair"), and that copy is refused on reopen for the same field.
  - The ADR's "names the object … and its recovery copy opens" holds only for imported path points.
- **Evidence:** REPRO, `zz-x3\range2.mjs`. Main's store `applySelectionTransforms` with `buildSelectionTransformEdit`, then `prepareProjectForPersistence`, `prepareProjectForAutosave`, `planRecoveryCopy`, `serializeProject` and `deserializeProject`:

  | Edit | Save / autosave | Copy leaves out | Copy reopens |
  |---|---|---|---|
  | X = 1,200,000 | "object 2 (traced image) cannot be stored (missing or invalid `scene.objects[1].transform.x`)" | nothing | **no**, same field |
  | W = 4,500,000 (scale 112,500) | the same (x past limit after the anchor) | nothing | **no** |
  | X = 999,000 (control) | saved | — | yes |

- **Severity:** P3.
  - Nothing is lost while the session is open: Undo recovers, the prompt says the raw copy "may need repair", and the object is named by index and kind.
  - What is wrong is the ADR's claim and the unhelpful reason: it neither says "past the 1,000,000 mm a project file can hold" nor what to do.
  - Autosave says "Autosave cannot keep a recovery copy, and Save will refuse it too", so the operator is warned that the session is the only copy.
- **Announced?** Partly. Amd 5 Decision 4 says a project with no out-of-range object keeps the raw copy "with its 'may need repair' wording". Its Consequences, however, claim the other routes are covered.
- **Novelty:**
  - The route is KNOWN: 13-P3-1 (`docs/audits/2026-10-21-rolling-v2/13-project-io.md`, "Numeric X/Y and W/H edits have no ceiling"), still reproducible on main.
  - New: #1636's naming and recovery plan miss it, and the ADR overstates. No open PR touches these files.
- **Fix direction:**
  - Make `sceneObjectCoordinatesInRange` check the object's transform against `MAX_PROJECT_COORDINATE_MAGNITUDE_MM` and `MAX_PROJECT_TRANSFORM_SCALE`, so the copy leaves the object out and the refusal says it is past the limit.
  - Better, close 13-P3-1 at the command.
  - Or narrow the Consequences sentence to imported coordinates.
- **Refuter:** PENDING.

## Refuted

Candidates the auditor dropped:

- **"Remote `update_text` now commits over a desktop edit made during the worker layout (#1592 frees the window)."** The commit callback re-runs `assertCurrent`, which refuses on any revision change (`adapter.ts:257-260,293-294`). The jig drops a stale result when the project changes (`JigTextControls.tsx:62-66`). `update_text` is not a batch command, so the synchronous batch runner (`design-batch.ts:233-258`) never sees it.
- **"Variable copies render over many turns now, so an edit mid-batch places copies of the old design (#1602)."** Both dialogs' `isCurrent` compares the store's project object to the captured one (`ArrayDialogHost.tsx:199-200`, `RetainedArraysButton.tsx:139-140`), so any edit cancels before placement.
- **"The DXF range check runs before unit scaling, so an inches drawing past the limit imports."** The per-entity gate sees the scaled value. 40,000 in and 1,001 m are skipped ("LINE skipped: unreadable or out-of-range coordinate value"), and 39,000 in (990,600 mm) imports and saves (`range1.mjs`).
- **"A near-straight bulge inside a scaled or non-uniform INSERT bends again."** The test is the sagitta per chord, which scaling preserves. All INSERT variants gave 4 lines at the true size (`arc1.mjs`).
- **"Library SVGs move under #1635's strict attribute reader."** All 8 openclipart assets parse identically to the parent, with no transform note (`css1.mjs`, `lib1.mjs`).
- **"`String.fromCharCode(...bytes)` remains an ADR-691-class overflow."** Every remaining site is bounded: 32-byte nonce and HMAC, font name records, 4-byte chunk types, or already chunked (`view-reference.ts:62`, `qualified-png-raster.ts:188`, `paged-raster-hydration.ts:139`).

## Verified clean

- **#1614** on the compiled job and on the prepared job without leads: 1 and 2 coasters, round coaster, overcut, kerf (table above). The repo's `cut-before-engraving` and `cut-order-warnings` tests pass.
- **#1617:**
  - Every fresh-import route the ADR names commits through `importSvgFragment` or `reimportSvgFragment`: file and drag-drop (`import-dispatch.ts:226`), Remote (`design-imports.ts:62`) and Design Studio (`apply-studio-snapshot.ts:80-81`).
  - `svg-white-fill-knockout-v10.integration.test.ts` passes.
- **#1601:**
  - 2,000 characters in Special Elite (3,509,951 points) placed on a 40,000-point guide in 2.6 s; the 30° bend is sane (bounds 5,157.5 × 343.2 mm).
  - The lint rule covers `Math.min`/`Math.max` spreads in `src`. `push(...)` is excluded by ADR-691 Decision 3, which is honest.
- **#1602:**
  - 802/802 identical encode/decode results against the pre-#1602 loops, with the engine's native base64 and without it. The cases were 60 random byte strings plus a 70 kB one. Malformed inputs covered: no padding, trailing newline, leading space, truncated, base64url, `=` inside, non-Latin-1, embedded space, `====`, CRLF.
  - Cancel and staleness hold (Refuted).
- **#1592:**
  - Worker round trip equals the UI thread 7/7 (`text1.mjs`). Both carry the same fields (`textGeometryRequest` keeps everything `renderTextGeometry` reads).
  - Abort and staleness hold (Refuted).
- **#1635:**
  - 27/27 tree SVGs and 14 exporter spellings identical to the parent. The four changes are the ones ADR-574 Amd 1 D5 and D7 name, and three of them carry the D9 warning.
  - Clip shapes with CSS transforms are refused, not misplaced.
  - The 16 focused test files pass, including the CSS-transform routes for main thread, worker text and worker stream.
- **#1636:**
  - Every DXF and SVG near-straight case in the Matrix, every limit case, and Save of each import.
  - Large-arc and far-centre cases behave as ADR-159 Amd 3 D4 says.
  - The "Not covered" lists are honest, except for X3-P3-1. PDF/AI against the limit is stated as not measured.
- **Local Vitest** (`zz-x3\vt-focused.txt`): 16 files and 653 tests passed on `be671b158`, in `j15-main` with one worker and `--no-experimental-webstorage`, launched at 3,991 MB free.
  - Files: `cut-before-engraving`, `cut-order-warnings`, `dxf-near-straight-bulge`, `imported-artwork-range`, `out-of-range-object-save`, `parse-svg-css-transforms`, `parse-svg-transform-origin`, `render-styled-text-worker`, `spread-free`, `text-on-path`, `text-bend`, `base64-codec`, `variable-copy-slices`, `svg-white-fill-knockout-v10.integration`, `dxf-noise-bulge-burn` and `flatten-curves-near-straight-arc`.

### CI on the merged results (L12)

Main's push runs per merge commit (`gh api …/actions/runs?head_sha=`). The PR heads all show CI 9/9, Browser smoke and Desktop package passing (`gh pr view --json statusCheckRollup`).

| PR | Merge commit | CI / Browser smoke / Desktop package on the merge | First later main commit where each passed |
|---|---|---|---|
| #1602 | `a5cfc3fca` (11-06) | failure / failure / failure in every job (the billing lock; nothing ran) | `82458c902` (#1612, 11-08): all three passed |
| #1601 | `258f853e6` | cancelled ×3 | CI: `2826e2932` (#1621). Browser: `c70612b58` (#1615). Desktop: `87b9ad1c1` (#1610) |
| #1592 | `829078da4` | cancelled ×3 | the same three commits as #1601 |
| #1614 | `8e7cca0ea` | success / cancelled / success | Browser: `9d446e01f` (#1611) |
| #1617 | `3688c68e2` | cancelled ×3 | `a3965a77d` (#1619): all three passed |
| #1635 | `af1573c77` | success / **failure** / success | Browser smoke has failed on main since `743d37bc4` (#1622's relief stock compare, fixed by #1646, X6/X7) |
| #1636 | `0cefa7723` | **cancelled** / failure (shard 2/4: `gcode-viewer-stock.e2e.ts:421`, the #1622 relief spec) / success | **none yet.** CI was cancelled on `287007670`, `be671b158`, `b0507a547`, `637fd6a22` and `7fcdd81b4`, and Desktop package **failed** on `be671b158` ("Build the Linux AppImage and .deb from the Preview config"). `59d66bb86` was queued at 15:45. The local Vitest above stands in |

## Not verified

- **Browser:** no rendered UI and no Chromium ground truth of my own. The memory gate was 0.95 GB at the start of the text run, then 4 GB. The CSS-transform geometry relies on ADR-574 Amd 1's 160 Chromium boxes, which its tests carry. The Job Review row for X3-P2-1 was read from `detectMachineJobWarnings`, the function that builds it, and not rendered.
- **HarfBuzz shaping in the worker parity run:** the esbuild bundle lacks `harfbuzz.wasm`, so the Arabic case did not run. It is covered by the repo's worker parity tests, not by this audit.
- **PDF/AI imports** against the limit and the knock-out: not run (both ADRs list them as not covered).
- **Save .rd (Ruida export):** shows no machine or job warnings at all (`save-rd-action.ts`), so it carries no Cut last advisory either. This is older than these PRs and outside them; not raised.
- **The 1.0.30 notes:** X2 owns them. X3-P2-1 needs none; X3-P3-1 needs none.
- **Hardware:** none, by instruction.

## Repro files

All files are in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-x3\`. Nothing in the repo was touched except this report.

| File | What it does |
|---|---|
| `build.mjs`, `entry-*.ts`, `bundles\` | esbuild bundles of `j15-main` (`main`, `text`, `save`, `svg15`) and `j13-main` (`svg13`) |
| `h.mjs`, `dom.mjs`, `register.mjs`, `ts-resolve.mjs` | harness (from X2 and W4) |
| `cut1.mjs` | X3-P2-1: compiled vs prepared job, leads, overcut, kerf |
| `range2.mjs` | X3-P3-1: X/W past the limit, Save, autosave, recovery copy reopen |
| `arc1.mjs` | #1636 near-straight arcs on DXF/SVG routes, compile and Save |
| `range1.mjs` | #1636 limit on DXF units, HPGL, SVG |
| `text1.mjs` | #1592 worker vs UI thread; #1601 long text on a path and bent |
| `b64.mts`, `old1602\` | #1602 old loops vs shared codec (run with `node --import ./register.mjs b64.mts`) |
| `css1.mjs` | #1635 parent vs main on tree SVGs and spellings |
| `lib1.mjs` | Design Library assets on main: whites, transform notes, library vs file import |
| `vt-focused.txt` | focused Vitest output |

```json
{
  "area": "X3",
  "id": "fix-design-text-import",
  "tree": "be671b158",
  "raised": 2,
  "findings": [
    {"id": "X3-P2-1", "severity": "P2", "area": "X3", "file": "src/core/cut-before-engraving.ts", "line": 124, "anchor": "Contract ADR-480 Amd 3 D2/D4; twin: compileJob vs prepared job (apply-laser-leads.ts:441 closed:false)", "evidence": "REPRO", "verdict": "PENDING", "known": false, "summary": "A Line cut with a lead-in or lead-out is an open burn in the prepared job, so Job Review, Save G-code and Start never show 'Cut runs before the engraving inside it' for led cuts (1 or 2 coasters, round coaster); compileJob still warns. Pre-dates #1614."},
    {"id": "X3-P3-1", "severity": "P3", "area": "X3", "file": "src/io/project/refused-scene-object.ts", "line": 25, "anchor": "Contract ADR-307 Amd 5 Consequences ('its recovery copy opens'); twin: sceneObjectCoordinatesInRange vs loader validateTransform", "evidence": "REPRO", "verdict": "PENDING", "known": false, "summary": "A position/size typed past the loader limit (KNOWN 13-P3-1) is not seen by the #1636 range check: Save says 'cannot be stored (missing or invalid scene.objects[1].transform.x)', the recovery copy leaves nothing out and is refused on reopen, contrary to the ADR"}
  ]
}
```

## Refuter (2026-11-09)

I am a fresh refuter in a separate context and raised none of these findings.

- **Code:** the scratchpad export `j15-main`. 18 cited files hash-equal `be671b158` (`git rev-parse be671b158:<path>` = `git hash-object`).
- **Later main:** main has moved to `a468f7bea`. Its changes under `src/ui/laser/` (Abort origin, rotary camera) touch none of the cited files.
- **Own tooling:** I built my own esbuild bundles (`zz-x3r\bundles\`) and wrote my own scripts and inputs. I reused none of the auditor's bundles, scripts or scenes.
  - The pre-#1602 codec came straight from `git show a5cfc3fca^1:…` into `zz-x3r\old1602\`.
  - HarfBuzz ran: I copied the local `harfbuzzjs@1.6.3/dist/harfbuzz.wasm` from `node_modules` next to the bundle.
- **Runs:** Node only, on main's real modules, with 3.3–3.4 GB free. I ran no Vitest and no browser. No hardware was used.

### Verdicts

**X3-P2-1: CONFIRMED, P2 kept (P1 weighed and rejected).**

- **What would make it false:**
  - some production route checks the compiled job, not the prepared one;
  - another warning or notice tells the operator that the cut runs first;
  - preparation keeps a led contour closed.

  None holds.
- **Every production caller passes the prepared job (READ, be671b158):**
  - Job Review's `prepare` request: `output-preparation.ts:69`.
  - Save, worker route: `output-preparation.ts:123`. Save, direct route: `save-gcode-emission.ts:172`.
  - Tiled Save: `tiled-output-preparation.ts:68`.
  - Start: `start-job-readiness.ts:365` → `start-job-warnings.ts:22`. Job Review then shows `prepared.warnings` (`job-review-model.ts:123,214`).
  - `detectJobIntentWarnings` falls back to `compileJob` only when no job is passed (`job-intent-warnings.ts:54`), and no production caller does that.
  - `isCutBeforeEngravingWarning` is read only by Job Review's row and button (`JobReviewWarnings.tsx:124,157`) and by the rank (`review-note-rank.ts:23`). No other cut-order notice exists in `src/`.
- **REPRO by other routes and inputs** (`zz-x3r\cut-r.mjs` → `cut-r.out.txt`).
  - **Routes:** I called the real `prepareOutputRequest` with `kind: 'prepare'` (Job Review) and `kind: 'save'` (Save G-code; I counted the warning text in the result). For Start I called the real `prepareStartJob` with a Falcon A1 Pro grblHAL snapshot (homed, Idle, laser mode on).
  - **Artwork:** `imported-svg` objects, as a file import makes them. The name is a filled "O" (an outer ring and a hole) inside an 80 mm square or an 80 mm, 360-point disc. Line is 90 % at 400 mm/min; Fill is 30 % at 3,000 mm/min.

  | Case | `compileJob` | Job Review | Save G-code | Start | Prepared cut segments closed |
  |---|---|---|---|---|---|
  | control, no lead | 1 | 1 | 1 | 1 | `[true]` |
  | lead-in (operation) | 1 | **0** | **0** | **0** | `[false]` |
  | lead-in, 3 passes | 1 | **0** | **0** | **0** | `[false]` |
  | lead-in + overcut 2 mm | 1 | **0** | **0** | **0** | `[false]` |
  | lead-in, line style, 5 mm | 1 | **0** | **0** | **0** | `[false]` |
  | lead-in 500 mm (capped to 20 mm in the G-code) | 1 | **0** | **0** | **0** | `[false]` |
  | disc, lead-out | 1 | **0** | **0** | **0** | `[false]` |
  | **per-artwork override** `leadInEnabled` on the outline only; the operation has no leads | 1 | **0** | **0** | **0** | `[false]` |
  | 2 coasters, override leads on both | 1 | **0** | **0** | **0** | `[false, false]` |
  | 2 coasters, override lead on one only | 1 | 1 | 1 | 1 | `[false, true]` |

  - **New since the auditor's run:** the per-artwork override route also silences the warning. So does Start, which the auditor read but did not run.
  - **Partial coverage:** one coaster without a lead keeps the warning for the job, because one held piece is enough (ADR-480 Amd 3 D1).
  - **What the operator sees:** Start's warnings carry no lead or cut-order note at all. The only trace is the G-code comment `; layer cut … leads in arc 2.000 mm at 90 deg`.
- **Is there any other warning?** No.
  - The Run order list and the preview show the order. A visible order on the canvas is not a warning (METHOD §3, G6 spirit).
  - Lead-fit diagnostics appear only when a lead is shortened or dropped, and they say nothing about cut order.
- **Reach (for the record; it does not change severity):**
  - Leads are off by default. `cut-settings-draft.ts:278-279` sets `false`, and no preset in `src/` or `public/` enables them.
  - They can be switched on per operation (`LineLeadFields.tsx:61-74`) or per artwork (`object-properties-actions.ts:338-339`).
- **P1 or P2:**
  - The output is the order the operator set, exactly as burned. Nothing about power, position, depth or scale differs from what was asked, so this is not "silently wrong physical output".
  - The harm is the missing advisory: a part may drop before its engraving. The same harm without leads is V7-P2-3 / U3-P2-4, and both were rated P2. P2 kept.
- **Age:** the warning came in with #1561 (`81f8ebb04`, 2026-11-03). Leads predate it: `625f300db` (2026-10-18) added `apply-laser-leads.ts`. So the warning has never covered leads.
  - Minor correction: the auditor dated leads to `66972d140` (2026-10-20). That commit is a later lead change; the leads themselves landed on 2026-10-18.
- **KNOWN?**
  - `git grep` over `docs/audits` (origin/main), the pro-loop v1–v3 folders and v12 finds no lead × cut-before-engraving case.
  - No open PR (#1623, #1638, #1639, #1642, #1643, #1649–#1652) touches `cut-before-engraving*`, `cut-order-warnings*` or `apply-laser-leads.ts`.
- **Notes side effect:** #1638's line says "Cut last for each part". That is true only for parts cut without a lead. If the fix does not land before 1.0.30, the line overclaims.
- **ADR quotes:** the auditor's quotes of ADR-480 Amd 3 D2 and D4 match `docs/decisions/ADR-480-amendment-3-…md` at `be671b158`. Every `file:line` in Where matches the tree.

**X3-P3-1: CONFIRMED, P3 kept (P2 weighed and rejected).**

- **REPRO with other inputs** (`zz-x3r\range-r.mjs` → `range-r.out.txt`). Real store, `buildSelectionTransformEdit`, `applySelectionTransforms`, Save, autosave, `planRecoveryCopy`, serialize, reopen, then `undo`.

  | Edit | Save / autosave | `sceneObjectCoordinatesInRange` | Copy leaves out | Copy reopens | After Undo |
  |---|---|---|---|---|---|
  | **imported-svg** "logo.svg", **Y = −1,200,000** | "object 2 (imported from “logo.svg”) cannot be stored (missing or invalid `scene.objects[1].transform.y`)" | true | nothing | **no**, same field | saves |
  | **0.5 mm mark, W = 60,000** (scale 120,000, past the 100,000 scale limit) | the same wording, naming `transform.x` (the centre pivot pushed x to −1,229,990) | true | nothing | **no** | saves |
  | two objects moved together, X = 1,000,010 | saved (transforms stay at 999,945; only the drawn extent passes 1,000,000) | true | — | yes | — |
  | control, X = 999,000 | saved | true | — | yes | — |

  - Source imports get the same wording, so this is not limited to traced images.
  - `sceneObjectCoordinatesInRange` (`refused-scene-object.ts:25-29`) never looks at the transform, as the auditor says.
  - The loader limits are confirmed at `project-shape-primitives.ts:2,4`.
- **ADR quote:** ADR-307 Amendment 5, Consequences (`docs/decisions/ADR-307-amendment-5-…md:63-64` at `be671b158`): "A project that still reaches the limit by another route names the object at Save and autosave, and its recovery copy opens." It matches, and the repro contradicts its second half.
- **Does it lose work?** Not without a warning.
  - Undo restores a saveable project (above).
  - Autosave failure returns before the commit, so the previous snapshot stays (`autosave-durable.ts:261-267`). It warns once with the refusal (`use-autosave.ts:63-74`).
  - The raw copy is disclosed as "may need repair" (`ProjectSaveDialog.tsx:21`).
  - Only work done after that warning, while the bad object is still there, is at risk on a crash.
- **Why not P2:** W5-P2-1 was P2 because a **silent** import made the project unsaveable. Here the operator typed the value, and the object visibly leaves the bed. That route is KNOWN 13-P3-1 (P3, re-confirmed in rolling v7 L2).
  - What is new is the ADR's overclaim and the unhelpful field-path wording. That is doc/code drift: P3.
- **KNOWN status:** 13-P3-1 is still open on main. `selection-transform.ts:149-167` checks finiteness only. The UI field adds no ceiling: `NumericEditsBar.tsx:383-392` passes no min or max to `evaluateNumericEntry`.

### Challenges to "Verified clean"

Each fix got at least one input the auditor did not try. None broke.

- **#1614:** covered by X3-P2-1 above. The control cases (no lead) warn on all three routes.
- **#1617** (`white-r.mjs`, 11 spellings: a black square under a white diamond, imported through the store with the repo's `white-fill-burn` fixture):
  - Treated as translucent ink, kept, on their own operation: `fill-opacity` as a percentage (in `style` and as an attribute), group `opacity="50%"`, `#fff8`, `rgb(255 255 255 / 0.5)`, and a nested `<svg opacity=".5">`.
  - Treated as paper and knocked out (the black square gains a hole): `#FFFF` (opaque 4-digit) and `hsl(0,0%,100%)`.
  - `fill-opacity="0"` white is dropped at parse, the same as a transparent red. Neither burns, so the black square stays whole.
  - Holds.
- **#1601** (`text-r.mjs`):
  - 3,000 characters of Roboto (270,300 points) placed on a **closed** 120,000-point circle: `ok` in 0.9 s.
  - 5,000 characters (450,500 points) bent −120: finite bounds (9,212 × 2,661 mm) in 2.2 s.
  - `grep` finds `Math.min/max(...` only in `*.test-support.ts`, and no `.apply`/`.call`/`Reflect.apply` on `Math.min/max` in `src/`, `electron/` or `services/`.
  - Holds.
- **#1602** (`b64r.mts`): 182/182 identical with the native base64 present and 182/182 with `toBase64`, `setFromBase64` and `fromBase64` deleted.
  - Encode: every length 0–64, 1,000 × 0x00, 1,001 × 0xFF and a 3,000,003-byte font.
  - Decode inputs new to this run: `=`, `A`, whitespace-only, tab, `AA=A`, `AAAA====AAAA`, `-_-_`, NBSP inside, non-zero pad bits (`QR==`), `QUI`, a BOM prefix, a 4,004-character body and lowercase.
  - The 3 MB font round-trips.
  - Holds.
- **#1592** (`text-r.mjs`, worker round trip vs UI thread): 8/8 identical.
  - Cases: empty text; whitespace + tab + CRLF; emoji + CJK (missing glyphs reported identically); negative spacing, right-aligned; 0.5 mm; a stroke font with a missing `Ω`; a frame wrapping one long word.
  - **Arabic + Latin with HarfBuzz loaded.** This is the case the auditor could not run. Roboto here has no Arabic glyphs, so it checks the shaping path and the missing-glyph report, not Arabic outlines.
  - Holds.
- **#1635** (`css-r.mjs`): 8/8 match hand-computed CSS Transforms geometry to 0.01 mm, with no warnings.
  - Cases: `rotate(0.25turn)`; `transform-box: fill-box` with `transform-origin: center`; the individual `translate`/`rotate`/`scale` properties in CSS order; a `<style>` class rule beating a `transform` attribute; `translate(1in, 1cm)`; a fill-box origin of `0% 100%` with `scaleY(-1)`; inline `!important`; uppercase `TRANSLATE(5PX, 0)`.
  - The geometry is my arithmetic from ADR-574 Amd 1 D1–D6, not a Chromium measurement.
  - Holds.
- **#1636** (`arc-r.mjs`, `arcnote-r.mjs`): 40 × 30 mm plate, compiled and saved.
  - **Burned at 40 × 30, Save ok, no G2/G3:** LWPOLYLINE bulge −1e-17 (negative noise), 2e-9 (at the threshold), 3e-9, 1e-8 and 1e-6 (above it).
  - **Control:** bulge 0.1 bows to 41.5 × 30.
  - **SVG** `A1e9` (sagitta/chord 6e-9, kept as an arc) and `A1e10` (straight) both burn 40 × 30. `A1e17` inside a `<use>` with `translate(40 0) rotate(45)` burns 49.497 × 49.497 = (40 + 30)/√2.
  - **DXF ARC entity, r = 1e8**, centre at y −99,999,950: skipped with the note "ARC skipped: unreadable or out-of-range coordinate value" and `skippedSummary` "1 ARC". That is the per-entity gate, which ADR-307 Amd 5 lists as not changed. Not raised.
  - Holds.
- **L12 CI claim:** holds, re-checked at 16:00 +0800 with `gh run list --branch main` and `gh api …/actions/runs?head_sha=`.
  - `0cefa7723`: CI cancelled with no jobs, Browser smoke failed (shard 2/4, `gcode-viewer-stock.e2e.ts`, the #1622 relief spec, "1 failed"), Desktop package passed.
  - CI was cancelled on `287007670`, `be671b158`, `b0507a547`, `637fd6a22` and `7fcdd81b4`. CI on `59d66bb86` is queued and on `a468f7bea` pending.
  - So no completed unit-test run on main contains #1636 yet.
  - **The Desktop package failure on `be671b158` (run 42576861859) is the known flake.** The "Package, install and launch the Linux AppImage and .deb" job failed in "Build the Linux AppImage and .deb from the Preview config" with `⨯ Response code 504 (Gateway Time-out) failedTask=build`, right after `downloaded label=electron progress=100%`. That is the known 504 / Electron-fetch flake, not a code failure. The other packaging jobs that ran passed (launch check, commercial Linux rehearsal).
- **Local Vitest (653 tests):** not re-run by me. My Node runs used the same modules.

### New findings

None. The per-artwork lead override route and the Start route widen X3-P2-1's scenario but do not change its cause or fix, so they are recorded in its verdict. The #1638 "Cut last for each part" overclaim follows from X3-P2-1 and is a notes item, not a separate finding.

### Not verified

- **Browser:** no rendered Job Review row and no Chromium measurement. The CSS geometry is hand-computed.
- **Burn test:** none. I did not burn-test whether a led coaster drops before its name; the harm is taken from the V7-P2-3 / U3-P2-4 precedent.
- **Other export routes:** Save .rd and Print & Cut against X3-P2-1 were not run. The auditor notes .rd carries no machine warnings.
- **Push spreads:** a single text line long enough to overflow the remaining `push(...)` spreads (stroke-font contours, per-glyph ids) was not tried. ADR-691 D3 excludes them.
- **Not run:** PDF/AI imports, and Vitest.
- **Hardware:** none, by instruction.

### Repro files

All files are in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-x3r\`. Each script's output is the `.out.txt` file of the same name.

| File | What it does |
|---|---|
| `build.mjs`, `entry-r.ts`, `entry-t.ts`, `bundles\` (with `harfbuzz.wasm`) | My bundles of `j15-main` |
| `dom.mjs`, `register.mjs`, `ts-resolve.mjs` | jsdom globals; Node TS loader (from W4) |
| `cut-r.mjs` | X3-P2-1 on the Job Review `prepare` request, the Save request and `prepareStartJob` |
| `range-r.mjs` | X3-P3-1: Y on an imported SVG, a scale-only edit, a group move, Undo |
| `white-r.mjs` | #1617 white spellings |
| `css-r.mjs` | #1635 CSS transforms against hand geometry |
| `arc-r.mjs`, `arcnote-r.mjs` | #1636 threshold bulges, SVG arcs, the DXF ARC entity |
| `b64r.mts`, `old1602\` | #1602 old loops (`git show a5cfc3fca^1`) vs the shared codec |
| `text-r.mjs` | #1592 worker parity; #1601 closed guide and a 5,000-character bend |

```json
[
  {"id":"X3-P2-1","severity":"P2","verdict":"CONFIRMED (P1 weighed, rejected)","file":"src/core/cut-before-engraving.ts","line":124,"evidence":"REPRO (refuter: real prepareOutputRequest prepare/save and prepareStartJob; imported-svg coaster with a filled O; lead-in/out, passes, overcut, line style, per-artwork override all give 0 warnings on every route while compileJob finds 1; control warns 1/1/1) + READ (every production caller passes the prepared job)","known":false,"summary":"Led cuts are open burns after preparation, so Job Review, Save G-code and Start never show the cut-before-engraving warning; per-artwork lead override too; predates #1614 (leads 2026-10-18, warning 2026-11-03)"},
  {"id":"X3-P3-1","severity":"P3","verdict":"CONFIRMED (P2 weighed, rejected)","file":"src/io/project/refused-scene-object.ts","line":25,"evidence":"REPRO (refuter: imported-svg Y -1,200,000 and a scale-only W 60,000 give field-path refusals, an empty leave-out list and a copy refused on reopen; Undo restores Save)","known":"root cause 13-P3-1","summary":"ADR-307 Amd 5's 'recovery copy opens' is false for typed transforms past the loader limit; recovery plan never checks the transform"}
]
```

Refuter counts: raised 2, refuted 0, P1 0, P2 1, P3 1, known 0
