# Rolling audit v11 — Relief and design generators (W6 `relief-generators`)

- **When:** 2026-11-09   **Tree:** main @ `a3965a77d` (repro tree: scratchpad `j11-main`, an export of that SHA).
- **Scope:**
  - **Relief CAM:** `src/core/relief/**`, `src/core/heightfield/**`, `src/core/cnc/compile-cnc-relief*.ts`, `cnc-relief-group.ts`, `relief-machine-space*.ts`. Also the projection operation (`compile-cnc-relief-projection.ts`, `src/core/relief/relief-projection-plan.ts`), the editable-relief commit path (`src/ui/state/relief-authoring-actions.ts`, `relief-param-actions.ts`, `relief-heightfield-param-patch.ts`) and the relief notes in Job Review (`src/ui/laser/cnc-relief-planning-warnings.ts`, `cnc-relief-projection-order-warnings.ts`, `cnc-compiled-depth-warnings.ts`, `cnc-through-cut-tab-warnings.ts`, `cnc-z-travel-warnings.ts`).
  - **Design generators:**
    - Box Generator and Box Fit Test (`src/core/box/**`, `src/ui/box/**`, `src/ui/state/box-insert-mutation.ts`, `object-insert-actions.ts`).
    - Barcodes and QR (`src/core/barcode/**`, `src/ui/barcode/**`).
    - Part generators: panel, bracket, hole grid, fixture (`src/core/parts/**`).
    - Design Studio carve preview (`src/core/design-carve/**`, read only).
    - Prepare Stamp (`src/ui/commands/StampPreparationDialog.tsx`, read only).
  - **Generators that do not exist:** no gear, living-hinge, puzzle or nameplate generator exists on this SHA (`git ls-tree` search for gear, hinge, puzzle and nameplate found none).
  - **Governing ADRs:**
    - Relief: ADR-412 and Amds 1–2, ADR-413, ADR-421 and Amd 1, ADR-422 and Amd 1, ADR-424 and Amd 1, ADR-450, ADR-484, ADR-488, ADR-489 Amd 1, ADR-572, ADR-575 and Amd 1, ADR-580 and Amd 1, ADR-368 Amd 2.
    - Generators: ADR-106 and Amds 1–2, ADR-116, ADR-119, ADR-386 and Amds 1–2, ADR-486 and Amd 1, ADR-573 and Amds 1–4.
    - The leaders plan R06 (`docs/audits/2026-10-08-cnc-leaders/IMPLEMENTATION.md:212-218`).
  - **L8 (merged since 2026-10-21 in these paths):**
    - #1452 (`9a2bf6b13`, ADR-412 Amd 2, footprint wall);
    - `1deb6fab5` (ADR-580 Amd 1 two-sided follows the stock, ADR-575 Amd 1 curved rails; #1420);
    - `7e7b11975` (Pro ask on barcode edits);
    - `427a0c404` (shared base64 codec, used by depth maps);
    - `59069ea1c` and `416d4e82d` (spread-free `appendAll`/`minOf`/`maxOf` in barcode, box, relief);
    - `7763eece0` (viewer CSS only);
    - the Design Studio commits `938fa8d5f`, `98bc9a0e1` and `28768335c`, which were audited in v7 L5 and v8 N5 and not re-audited here.
- **KNOWN, not audited (per the brief):** open PR #1622 (ADR-580 Amd 2: height maps carve their pixel-centre surface; 3D rest paths keep one G1 per stretch), and the open PRs #1623–#1626.
- **Lenses run:**
  - **L1 (contracts):** each generator against its ADR; projection against R06; relief stages against ADR-412/421/368.
  - **L3 (twins):**
    - the canvas QR path against an independent decoder;
    - the layer fields on screen against what the projection compiles;
    - roughing reach against finishing load;
    - the earlier box, barcode and relief twins.
  - **L4 (extremes):** projection depth, groove width against the roughing bit, Kerf Offset against finger width, box thickness and spacing, barcode and part-generator field bounds.
  - **L8:** as listed in Scope.
  - **L2:** no new source was fetched. Ground-truth claims reuse earlier reports' pinned sources, or are marked UNVERIFIED.
  - **L5:** only for the depth-map base64 codec (L8).
  - **L7:** light.
- **Repros:** Node 25 with the real TypeScript modules through the esbuild transform hook (`zz-w6/register.mjs`, `ts-resolve.mjs`, copied from `zz-w5r`).
  - Run from scratchpad `zz-w6/` with `node --import ./register.mjs <script>.mts [args]`.
  - Scripts and their outputs:
    - `proj.mts` → `proj.out.txt`
    - `engage.mts` → `engage.out.txt`, plus `dump.mts`, which wrote `groove-*.nc`
    - `box.mts` → `box.out.txt`
    - `qr.mts` → `qr.out.txt` (it uses `qr-decoder-v2.mjs`, rolling v2's independent decoder with its Code 128 table stubbed out)
    - `cap.mts` → `cap.out.txt`
    - `b64.mts` → `b64.out.txt`
  - Focused Vitest ran in `j11-main` with `--maxWorkers=1` at 2.4–2.5 GB available:
    - `relief-rail-arcs.test.ts` and `emit-gcode-cnc-relief-footprint.test.ts`: 16 passed.
    - `src/core/barcode`, `src/core/box` and `src/core/parts`: 32 files, 465 passed.
  - No browser was run.
- **Counts:** 3 raised → 0 refuted (auditor; refuter PENDING) → P1 0 / P2 2 / P3 1. KNOWN: 26 earlier findings, listed in the status table (13 still open, 4 fixed). No security finding.

## Headline

**The core holds:**

- **QR:** an independent decoder read 120 QR symbols back from the materialized canvas path with no failure. That covers levels L–H, normal and inverted, and quiet zones of 0, 2 and 4 modules. The quiet zones were light.
- **Box:** the box bit-seeding P2 from rolling v2 (25-P2-1) is fixed.
- **Relief:** the reliefs-on-one-layer cut (16 K-2, ADR-412 Amd 2), the two-sided stock freeze (F6-P1-1) and the curved-rail refusal (F6-P3-3) are all fixed. Their tests pass on main.

**The two new P2s are both about cutter load, not geometry:**

- **W6-P2-1 (projection).** A relief projection cuts its whole "Vertical depth" in one pass. The layer still shows Cut depth, Depth per pass and Tabs, and the projection ignores all three. The stock-bottom advisory then judges the ignored Cut depth:
  - A 3 mm projection goes to Z −7.407 in 6.35 mm stock with no warning.
  - A stale Cut depth of 8 mm reports a spoilboard cut that does not happen.
- **W6-P2-2 (roughing reach).** When the relief roughing bit cannot enter part of a relief, roughing silently leaves that part at full stock. The finishing bit then cuts it at full depth.
  - Example: a 1/4" end mill roughing an 8 mm × 5 mm channel emits no roughing at all.
  - The 1/8" ball's first finishing row then slots the channel 5 mm deep across its full width at 1000 mm/min.
  - That is 13.85 mm² of cross-section, against 4.80 mm² for a 1/8" roughing pass on the same layer. Job Review says nothing.

## Findings

### W6-P2-1 — A relief projection cuts its whole Vertical depth in one pass and ignores the layer's Cut depth, Depth per pass and Tabs, which stay on screen; the spoilboard check reads the ignored Cut depth

- **Severity: P2.**
  - Why not P1: the emitted depth is the one the operator typed in Vertical depth, and Job Review names that depth. The geometry is not wrong. The harm is cutter load: one pass of 3 mm or more, plus a spoilboard advisory that is missing in one case and false in another.
  - Why P2:
    - The layer card shows three settings that do nothing: Cut depth, Depth per pass (minimum 0.05, default 1.5) and the Tab fields.
    - Every other engrave or profile operation honours them.
    - So an ordinary user who sets 1 mm per pass for a 1/8" bit gets one full-depth pass.
  - Precedents:
    - 09-29 P2-relief-rough-2 (a ball roughing up to about twice the Depth per pass) was P2.
    - The stock-bottom half is the F7-P3-3 class (the inlay pocket depth missed by the spoilboard check, P3). Here it also gives a false warning.
- **Where (pinned at `a3965a77d`):**
  - `src/core/relief/relief-projection-plan.ts:75`: `nominal = sampleSurface(map, p.x, p.y) - depthMm`. Each vector becomes one `path3d` pass at that depth (`:83-88`), with no Z ladder.
  - `src/core/cnc/compile-cnc-relief-projection.ts:109`: one `reliefGroup` per layer.
  - `src/core/cnc/cnc-relief-group.ts:31`: `includeDepthPerPass: cutType === 'relief-rough'`. `src/io/gcode/prepare-relief-projection-integration.test.ts` asserts that the projected group has no `depthPerPassMm`.
  - `src/core/cnc/compile-cnc-job.ts:237`: a layer with `reliefProjection` goes to `compileCncProjectedOperation`, which has no depth passes and no tabs.
  - `src/ui/layers/CncLayerFields.tsx:92` and `:121`: `CncDepthFields` (Cut depth, Depth per pass, "Set to stock thickness") and the Tab fields render whatever the projection setting is.
  - `src/ui/layers/ReliefAdvancedCncControls.tsx:142-151`: Vertical depth has `positiveOnly` and no upper bound.
  - `src/ui/laser/cnc-through-cut-tab-warnings.ts:86`: the spoilboard check reads `settings.depthMm`.
  - `src/ui/laser/cnc-compiled-depth-warnings.ts:31`: the compiled-depth check covers only `relief-rough` and `relief-finish`. The projected `engrave` and `profile-on-path` groups are judged by neither check on their compiled depth.
- **Anchor:**
  - **Twin.** Engrave and profile-on-path operations without a projection step to depth by Depth per pass, and their spoilboard check matches the emitted depth (F7 "Verified clean: Spoilboard warning … `settings.depthMm` is the compiled depth there"). Relief roughing honours Depth per pass, and ADR-368 Amd 2 item 4 says "Each level removes at most one" depth per pass. V-carve and relief depths are judged on compiled depth (`cnc-compiled-depth-warnings.ts`).
  - **Contract.** The R06 acceptance (`IMPLEMENTATION.md:218`) asks that "output remains within the supported three-axis contract".
  - **Ground truth.** Vectric's projected toolpaths keep their own pass depths. This is UNVERIFIED: no source was fetched.
- **Scenario and evidence:** REPRO (`proj.mts` → `proj.out.txt`).
  - **Setup:**
    - A 30 × 20 mm depth-map ramp, 5 mm deep (0.5 mm pixels), on an output relief layer (roughing, 1.5 mm per pass).
    - A 26 mm line on a second layer with `reliefProjection` (sample spacing 0.2), the default 1/8" end mill, Depth per pass 1, Cut depth 1.
    - Stock 6.35 mm.
  - **Results:**

    | Vertical depth, cut type, stock, Cut depth | Projected passes | Deepest emitted Z | Stock-bottom advisory |
    |---|---|---|---|
    | 0.5, engrave, 6.35, 1 | 1 | −4.907 | none (correct) |
    | 3, engrave, 6.35, 1 | **1** | **−7.407** (1.06 mm past the bottom) | **none** |
    | 3, profile-on-path, 6.35, 1 | **1** | **−7.407** | **none** |
    | 2, engrave, target relief not output, 6.35, 1 | 1 | −6.407 | none |
    | 0.5, profile-on-path, 5.3, Cut depth 8 | 1 | −4.907 (inside the stock) | **"Layer proj cuts 8 mm into 5.3 mm stock — 2.70 mm past the bottom, into the spoilboard."** (false) |

  - **One-pass load (READ, not measured):** with the surface prepared by roughing only, the projected cut sits up to Vertical depth + 0.5 mm allowance + one roughing step below the stock that is actually there.
- **User-visible effect:**
  - The operator sets Depth per pass to 1 mm and sees it on the layer.
  - A 3 mm projected profile is then cut in one pass with a 1/8" bit, into the spoilboard here, with no advisory.
  - On another layer a stale Cut depth produces a spoilboard warning for a cut that stays inside the stock.
  - Job Review's projection note names the vertical depth, but not that it is one pass.
- **Novelty:**
  - New. The CNC v1 F6 audit and pro loop v2 T14 measured projection depth accuracy only (T14: "0 raised").
  - F7-P3-3 is the same spoilboard class for inlay pockets, and its fix direction ("compiled group depth for every non-relief cut type") would cover the stock-bottom half.
  - No open PR touches `relief-projection-plan.ts`, `compile-cnc-relief-projection.ts` or `CncLayerFields.tsx`. #1622 changes `relief-object-to-heightmap.ts`, which projection reads, but not the pass structure.
- **Fix direction:**
  - Step projected cuts down by the layer's Depth per pass, as a ladder of surface offsets. Or hide Cut depth, Depth per pass and Tabs on a projected layer and say "one pass".
  - Judge projected groups on their compiled depth (`cncGroupMaximumDepth`) in the stock-bottom advisory.
- **Refuter:** PENDING.

### W6-P2-2 — Where the relief roughing bit cannot enter, roughing silently leaves full stock, and the finishing bit then cuts it full-depth (a 1/8" ball slots 5 mm deep at full feed); Job Review says nothing

- **Severity: P2.**
  - Why not P1: no surface is gouged and no depth is exceeded. The result is cutter overload, with a likely broken bit or a torn wall, and no wrong geometry.
  - Why P2:
    - It is an ordinary setup: a 1/4" roughing bit, a 1/8" ball finish and a relief with a narrow deep feature such as lettering strokes, a channel or a border groove.
    - The plan looks complete: both operations appear, and the roughing plan is listed in the compiled evidence.
    - Nothing says the roughing bit missed a region.
  - Precedents:
    - CNC v1 F3-P2-1 was P2: a profile finish allowance of a bit diameter gave "99.8 % engagement over a 6.35 mm deep pass" and "nothing warned". ADR-140 Amd 2 then added a warning and a stepped finish.
    - 09-29 P2-relief-rough-2 (relief roughing over the depth per pass) was also P2.
- **Where (pinned at `a3965a77d`):**
  - `src/core/cnc/compile-cnc-relief.ts:109-114`: the roughing group is pushed only `if (passes.length > 0)`. Finishing (`reliefFinishingGroup`) and rest run regardless, and no evidence records that roughing reached nothing, or only part of the relief.
  - `src/core/relief/relief-finishing.ts`: finishing rows ride the dilated surface with no engagement or step-down limit. The only Z-feed change is the descent cap (`lateralFeed: 'z-rate-capped'`, seen as F300–F361 on descents).
  - `src/ui/laser/cnc-relief-planning-warnings.ts:76-95`: the compiled relief notes are the grid size, the scallop, rest and projection, plus the generic swept-volume note. None of them says that roughing left a region.
- **Anchor:**
  - **Twin (KerfDesk's own rule for 2D):** ADR-140 Amd 2 (F3-P2-1): "From a = D/2 the finishing cutter has half its width or more in stock at full depth". KerfDesk now warns, and steps the finishing pass down, for profiles (`cnc-finish-allowance-warnings.ts`). Relief finishing has neither.
  - **Contract:** ADR-368 Amd 2 item 4: "Each level removes at most one" depth per pass, for relief roughing. The finishing pass that replaces the missing roughing removes 5 mm at once.
  - **Ground truth:** UNVERIFIED (no source fetched) on whether Vectric's 3D roughing reports regions its tool cannot enter.
- **Scenario and evidence:** REPRO (`engage.mts` → `engage.out.txt`; G-code in `groove-8-em-6350-bn-3175.nc` and `groove-16-em-6350-bn-3175.nc`).
  - **Setup:** a 30 × 20 mm 16-bit depth map with a flat top and one straight channel along Y, 5 mm deep. Roughing at 1.5 mm per pass, finishing with a ball (default 0.025 mm scallop), stock 6.35 mm.
  - **Oracle:** independent of KerfDesk's planner. It parses the emitted G-code, maps machine coordinates back with `toSceneCoords`, and sweeps each operation's own cutter (flat or ball profile) in 0.025 mm steps over a 0.05 mm stock grid. The cross-section is the stock removed per mm by a level lateral move.

    | Channel | Roughing / finishing | Roughing groups emitted | Max cross-section, roughing | Max cross-section, finishing | Roughing-reach note |
    |---|---|---|---|---|---|
    | 16 mm | 1/4" end mill / 1/8" ball | 3 levels | 9.53 mm² (6.35 × 1.5) | 5.01 mm² | none needed |
    | 8 mm | 1/8" end mill / 1/8" ball | 3 levels | 4.80 mm² (3.175 × 1.5) | 4.67 mm² | none needed |
    | **8 mm** | **1/4" end mill / 1/8" ball** | **none** | — | **13.85 mm²** at Z −5.000, F1000 (line 96) | **none** |
    | **8 mm** | **1/4" end mill / 1/16" ball** | **none** | — | 7.63 mm², 4.40 mm axial (2.8 × D) | **none** |

  - **Why roughing is empty:** the 8 mm channel is wider than the 1/4" bit plus twice the 0.5 mm allowance (7.35 mm). It is still refused, because the 0.79 mm roughing cell (tool / 8) and the ADR-412 Amd 2 contour clearance leave no level region. At 10 mm, only 2 of the 3 levels are emitted (a debug run whose output was not kept; rerun with `engage.mts 10 em-6350 bn-3175`).
  - **What the finishing does:** in the 8 mm / 1/4" case the first finishing row descends to Z −5 at the channel wall (F300) and then runs 3.9 mm across fresh stock at Z −5 and F1000. That is a full-width slot 1.6 × D deep for a 1/8" ball, with the layer set to 1.5 mm per pass.
  - **Job Review:** `detectMachineJobWarnings` returns the stock-placement, starter-feed and generic finishing notes only. No note mentions roughing reach or finishing load.
- **User-visible effect:** the operator picks a sensible roughing bit and a fine finishing ball. The program then has the fine ball plunge into and slot the narrow features at finishing feed, which is the usual way to snap a small ball nose. The Cut 3D preview shows the uncut channel after roughing, but under METHOD §3 a visible result is not a warning.
- **Novelty:**
  - New. The July 2026-07-13 cutting-mechanics research notes in general that "Pocket and relief paths are geometric offsets rather than engagement-controlled paths".
  - No audit ledger raises finishing load in regions roughing could not reach. Rolling v2 16 and CNC v1 F6 measured gouge and leftover only; pro loop v1 L6 measured surface quality.
  - #1622 does not touch roughing reach or finishing load.
- **Fix direction:**
  - Record per relief the area or volume roughing could not reach (the plan already knows its level regions).
  - In Job Review, name the regions where finishing will cut more than the depth per pass, and suggest rest roughing with a smaller bit, or a smaller roughing bit.
  - Optionally step the finishing pass down there, as ADR-140 Amd 2 does for profiles.
- **Refuter:** PENDING.

### W6-P3-1 — A Kerf Offset of at least half the finger notch fills a box's finger joints with no note when the parts are spaced wider than the kerf

- **Severity: P3.** Only an absurd Kerf Offset reaches it (≥ 4.5 mm with the default 3 mm stock and 9 mm fingers). The field accepts −10 to 10 mm (`CutSettingsCommonFields.tsx:140-141`). At the default part spacing the min-feature check fires first.
- **Where:**
  - `src/core/job/kerf-closed-up.ts` (ADR-486 Amd 1) counts shrinking contours (holes) only.
  - A notch in a growing outline that the offset fills is not a hole. ADR-486 Amd 1's Limits already concede the similar "dumbbell neck" case.
  - The min-feature check (`src/ui/laser/job-review/min-feature-warnings.ts:184`) reports gaps between shapes, not notches inside one outline.
- **Anchor:**
  - **Contract:** ADR-106's fit contract puts burn in layer kerf.
  - **Twin:** ADR-486 Amd 1 reports holes the kerf closes, so a joint the kerf erases deserves the same note.
- **Scenario and evidence:** REPRO (`box.mts` → `box.out.txt`). A laser box (60 × 40 × 30 inner, T 3, fingers 9) was inserted through the store, and the layer Kerf Offset was then set:

  | Kerf Offset, part spacing | Ring vertices out | Job Review |
  |---|---|---|
  | 0.1, 8 | 29 / 21 | nothing |
  | 6, 8 | **13** on 4 panels (fingers gone) | min-feature: "3 gaps between cut shapes … narrower than the 12 mm kerf" |
  | 6, 20 | **13** on 4 panels | **nothing** (no diagnostic, no min-feature) |

- **User-visible effect:** the four side panels burn as plain rectangles, so the box cannot assemble. This happens only with a Kerf Offset of half a finger or more.
- **Novelty:** new. The brief's "kerf larger than the finger width" case.
- **Fix direction:** extend the closed-up check to growing contours, counting source corners that the offset contour no longer follows. Or let the min-feature check include concave notches narrower than twice the offset.
- **Refuter:** PENDING.

## Earlier findings: status on `a3965a77d`

### Rolling v2 16 (relief)

| ID | Status | Evidence |
|---|---|---|
| 16-P2-1 V-bit/engraver finishing cell (D/10 of the full diameter) gouges edges | STILL OPEN on main; KNOWN fix #1622 | READ `compile-cnc-relief-finishing.ts` unchanged since v2. #1622 (ADR-580 Amd 2) moves unmasked maps ≤ 1024² px onto the pixel surface. By its own description, masked maps and larger maps "keep the old cells", so 16-P2-1 would remain for them after #1622 |
| 16-P3-1 "Keep at stock top" STL blocks only centre-uncovered cells | STILL OPEN | READ `mesh-to-heightmap.ts:177-180` (`uncoveredTop` from `centreMaxZ` only) |
| 16-P3-2 setup mistakes reported as corrupt stored source data | STILL OPEN | READ `src/io/gcode/relief-materialization-failure.ts:13-15`. The callers still pass `layer.name` for setup errors (`compile-cnc-relief-rest.ts:61`, `compile-cnc-relief-projection.ts:46,51,57`) |
| 16-P3-3 pass count below 2^32−1 escapes as "Invalid array length" | STILL OPEN | READ `depth-passes.ts:10,22`. `program-materialization.ts:16-25` still lacks "Invalid array length" |
| 16-P3-4 Relief 3D viewer drops the mirror | STILL OPEN | READ: no `mirror`/`residual` in `src/ui/relief-viewer/**` |
| 16 K-1 ball crease chord on depth maps | STILL OPEN on main; KNOWN fix #1622 (unmasked ≤ 1024² maps) | READ |
| 16 K-2 reliefs on one layer planned alone (bottomless edge) | FIXED | ADR-412 Amd 2, #1452. `emit-gcode-cnc-relief-footprint.test.ts` passes on main (focused Vitest) |
| 16 K-3 non-ball finishing rows 0.4 × D, scallop ignored | STILL OPEN | READ `relief-finishing.ts:57,406-413` |
| 16 K-4 relief Pro gating (02-P2-1, 02-P3-7) | NOT RE-VERIFIED | W1's area. `7e7b11975` addressed 02-P2-1 |
| 16 K-5 simulator ignores Retract between passes | NOT RE-VERIFIED | W7's area |

### CNC v1 F6 (relief and 3D)

| ID | Status | Evidence |
|---|---|---|
| F6-P1-1 two-sided split freezes the stock thickness | FIXED | ADR-580 Amd 1 (`1deb6fab5`). Pro loop v2 T14b re-measured on 2026-11-08: the web stays exactly 1 mm at stock 12.5/14/18 |
| F6-P2-1 depth-map slope stand-off (merged into 16-P2-1) | STILL OPEN on main; KNOWN fix #1622 | Pro loop v1 L6 measured 42° p50 0.154 → 0.016 mm with #1622 |
| F6-P3-1 rest prediction falls back above ~23 mm | STILL OPEN | READ `relief-residual-stock.ts:9` (`MAX_PREDICTION_WORK = 32_000_000`). T14b re-measured the fallback on a 40 mm dome |
| F6-P3-2 rest output not point-reduced | STILL OPEN on main; KNOWN fix #1622 | READ |
| F6-P3-3 curved rails refused at 32 steps | FIXED | ADR-575 Amd 1. `relief-rail-arcs.test.ts` (r10 arcs with 7/9/16/31 chords, the app curve at widths 1–3, a sine rail) passes on main |

### Rolling v2 25 (design generators)

| ID | Status | Evidence |
|---|---|---|
| 25-P2-1 CNC box sized for the active bit but seeded with the starter's 1/8" bit | FIXED | `cutFreshCncOperationsWithActiveBit` (`box-insert-mutation.ts:97-150`, called at `object-insert-actions.ts:235`). REPRO `box.mts`: 4040, no material, active `em-1588` → "Box panels" `toolId: null`, cuts with 1.588 |
| 25-P3-1 box panels take a saved Fill default whole | STILL OPEN | REPRO `box.mts`: black Fill default with apply-to-new on → "Box panels" `mode: "fill"`. `object-insert-actions.ts:228-233` passes `state.layerDefaults` unfiltered |
| 25-P3-2 a canvas-scaled barcode's modules are never re-checked | STILL OPEN | READ `barcode-layout.ts:99-111` reads `spec` only |
| 25-P3-3 no test pins the Code 128 width table | STILL OPEN | READ `src/__fixtures__/barcode/linear-decoders.ts:6` still imports `CODE128_WIDTHS` |
| 25 K-1 barcode edit commits via raw `setState` | FIXED | `7e7b11975`. No `useStore.setState` in non-test `src/ui/barcode/**` |
| 25 K-2 assembled preview draws one face per part | STILL OPEN | READ `BoxAssembledPreview.tsx:116-125` ("One plate = the panel's outer-surface face") |
| 25 K-3 blank divider fields parse as 0 | STILL OPEN | READ `box-draft.ts:130-141`: dividers absent from `required` |
| 25 K-4 a repeated Generate lands on the previous sheet at (0, 0) | STILL OPEN | READ `layout.ts:24-36` |
| 25 K-5 part spacing is nominal, before kerf or bit offset | STILL OPEN | READ `layout.ts`. W6-P3-1's min-feature line shows the consequence |
| 25 K-6 panels keep no `BoxSpec` | STILL OPEN | READ `box-insert-mutation.ts:233-243` (`panelObject` keeps name, rings and source only) |
| 25 K-7 144 × 144 Data Matrix block order (decided) | UNCHANGED (decided, ADR-386 Amd 2) | READ |

### 2026-10-13 quality-first machining audit and machining stress

- **Item 1** (raster scallop grows across slopes): STILL OPEN as the documented ADR-421 consequence (F6 K-4).
- **Machining stress:** the relief rows in `2026-10-13-machining-stress/README.md` are covered by the rows above. Nothing further was found open.

## KNOWN (from the brief, not raised again)

- **#1622:** depth-map pixel-centre surface and rest G1 reduction. Its diff was not audited.
- **#1623–#1626:** not in this area's paths, except #1624's docs-only T14/T14b reports, which were read for novelty.

## Refuted

Candidates the auditor dropped before raising:

- **"Relief finishing gouges the channel wall by 1.2–2.0 mm vertically."** This was the oracle's own artefact. A vertical wall sampled on a 0.05 mm grid puts the ball's equator on the plateau corner cell. On the same runs, normal penetration stayed within the KNOWN K-1/16-P2-1 half-cell bound, so it was not raised.
- **"Roughing writes no G-code for a relief" (first `engage` run).** This was my parser missing `G1X…` words with no space. After the fix, roughing is present wherever the bit fits, and absent only in W6-P2-2's case.
- **"The barcode caption `minOf` change alters caption size."** No. `minOf([])` is `Infinity` and `Math.min(a, Infinity) = a`, which is identical to the old spread for every input.
- **"An editable relief can compile a stale heightfield after an authoring edit."** No. `relief-authoring-actions.ts:73-74,104-105` writes `reliefAuthoring` and `reliefSource` in one transition. A physical or mapping edit detaches authoring deliberately (`relief-heightfield-param-patch.ts`), as ADR-572 says ("rematerialize matching intent or deliberately detach authoring").
- **"Projection runs into uncarved stock unannounced."** Disclosed. Every projection plan carries "Prepare the named surface before this operation; projection does not verify actual remaining stock" (`cnc-relief-planning-warnings.ts:146`). An out-of-order job also gets the order warning (`cnc-relief-projection-order-warnings.ts`).

## Verified clean

- **QR (L2/L3, independent).**
  - Rolling v2's decoder (written from ISO 18004 and the thonky.com tables, archived at `scratchpad/a25/decoders.mjs`) read back all 120 symbols with no failure, sampled from the **materialized object path** at module centres. The set was 5 data sets (URL, numeric, alphanumeric, UTF-8 with emoji, 300-byte) × L/M/Q/H × normal/inverted × quiet zone 0/2/4.
  - All quiet-zone modules were light as engraved.
  - The barcode core has changed since v2 only by `minOf` and `appendAll` (`416d4e82d`, `59069ea1c`).
- **Barcode captions (text in generators).**
  - EAN-13 `400638133393` gets check digit 1 and the caption `4 | 006381 | 333931`. A wrong check digit (2) is refused with the right digit named.
  - UPC-A gives `0 36000 29145 2`, EAN-8 gives `9638 5074` and UPC-E gives `0 123456 5`.
  - ITF pads to an even count. Code 128 and Code 39 echo their data.
  - Source: `cap.out.txt`. The check digits were worked by hand.
- **Generator tests:** 32 files and 465 tests in `src/core/barcode`, `src/core/box` and `src/core/parts` pass on main.
- **Box validation (L4, READ):**
  - Non-finite and non-positive sizes, thickness and finger width are refused.
  - "Outer … leaves no interior" catches thickness ≥ half the outer size.
  - Clearance is bounded by min(finger cell, T)/2, and a slide lid needs clearance > 0.
  - A relief tool that is not smaller than the finger is refused, with a warning under 2×.
  - Spacing whose doubled value is not finite is refused (`box-spec.ts:120-213`).
- **Part generators (L1/L4, READ):**
  - Dimensions must be finite, positive and ≤ 100 000 mm. Counts are integers from 1 to 32 with ≤ 512 holes.
  - Every hole must be strictly inside the outline, including the bracket's legs, with no overlap or touch (`part-generator-validation.ts`, `part-generator-geometry.ts:124-158`).
  - Holes are exact arcs, with a 64-gon fallback whose radius error is 0.12 % of r.
  - An even canvas resize folds into the lengths (ADR-573 Amd 1), as audited in v7 L5.
- **L8 base64 codec.**
  - `encodeCanonicalBase64` matched Node's `Buffer` on 1,200 random buffers of 0–299 bytes, and decode round-tripped all of them.
  - Non-canonical inputs are refused as `malformed`: bad padding (`QR==`, `Q===`, `QUJD====`), whitespace, URL-safe characters and short strings (`b64.out.txt`).
- **L8 spread-free edits:** `appendAll(chain, hop(…)); appendAll(chain, points)` keeps the old push order (`relief-finishing-skip.ts`). The slide-lid referee's `minOf`/`maxOf` are equivalent.
- **Relief Z range against Z travel:** `cnc-z-travel-warnings.ts` uses compiled `cncGroupMaximumDepthMm` over all CNC groups, so relief, rest and projection depths are included (READ).
- **Relief depth against stock:** compiled relief roughing and finishing depth warns at and below the stock bottom (`cnc-compiled-depth-warnings.ts:59-68`; v2 verified). A relief depth must be positive and match the mapping (`project-shape-validator.ts:264`, `project-relief-heightfield-validator.ts:73`), and `normalizeReliefPatch` drops non-finite or non-positive edits.
- **Relief footprint (ADR-412 Amd 2):** the independent drop-cutter test (`emit-gcode-cnc-relief-footprint.test.ts`) passes on main. In my groove runs no roughing centreline left the footprint. The stock-placement advisory accounts for the cutter radius past the footprint ("Toolpaths span −1.4–31.5 …" for a relief at the bed corner).
- **Tool shapes:** `kernelForTool` (`src/core/sim/tool-kernels.ts:84-130`) builds the dilation from each tool kind's own surface (`surfaceDzAtRadiusForTool`), so end mill, ball, V, engraving and tapered ball are all modelled in roughing, finishing and projection (READ; v2 and F6 measured ball, end mill, V, engraver and tapered ball).

## Not verified

- **Physical output:** nothing was cut, engraved or scanned. No box was assembled and no bit load was measured. W6-P2-2's overload is inferred from cross-section and engagement, not force.
- **Browser:** no browser run. The layer card's exact rendering for a projected layer (W6-P2-1) was read from `CncLayerFields.tsx`, not seen.
- **W6-P2-1's one-pass load below roughed steps:** read, not measured. The measured figures are emitted depth and pass count.
- **Projection on a finished (not only roughed) surface,** and projection with a V-bit or ball (only the default end mill was run).
- **Roughing with a V-bit or engraving bit:** no oracle was run (my oracle models flat and ball profiles only).
- **STL reliefs** in the W6-P2-2 groove case (only depth maps were run). The two-sided paths were taken from pro loop v2 T14b, not re-run.
- **Data Matrix and linear codes** were not independently decoded this round. Linear-code check digits were checked by hand for EAN/UPC only.
- **Prepare Stamp and the Design Studio carve preview:** read only. They produce a grayscale image and a preview surface, and burn through the existing raster and relief paths.
- **Material test and interval-test grids:** they are generators but belong to calibration (pro loop v1 L9/L11, KNOWN in #1622's docs). Not audited here.
- **16 K-4 (Pro gating) and 16 K-5 (simulator retract):** these belong to W1 and W7.
- **The #1622 diff,** per the brief.

```json
[
  {"id":"W6-P2-1","severity":"P2","area":"relief-generators","file":"src/core/relief/relief-projection-plan.ts","line":75,"anchor":"Twin: non-projected engrave/profile step by Depth per pass and are judged on emitted depth (F7 verified clean); relief roughing ADR-368 Amd 2 item 4; Contract: R06 three-axis contract; Ground truth UNVERIFIED (Vectric projected pass depths)","evidence":"REPRO (zz-w6/proj.mts -> proj.out.txt)","verdict":"PENDING","known":false,"summary":"Relief projection emits one pass at the full Vertical depth (no depth ladder, no tabs) while Cut depth, Depth per pass and Tabs stay on the layer card; 3 mm projection reaches Z-7.407 in 6.35 mm stock in one pass with no spoilboard advisory, and a stale Cut depth 8 gives a false spoilboard warning for a cut that stays at Z-4.907"},
  {"id":"W6-P2-2","severity":"P2","area":"relief-generators","file":"src/core/cnc/compile-cnc-relief.ts","line":109,"anchor":"Twin: ADR-140 Amd 2 / F3-P2-1 (profile finishing with half the bit in stock warns and steps down); Contract: ADR-368 Amd 2 item 4 (each relief level removes at most one depth per pass); precedent 09-29 P2-relief-rough-2","evidence":"REPRO (zz-w6/engage.mts -> engage.out.txt, independent stock sim of emitted G-code)","verdict":"PENDING","known":false,"summary":"When the roughing bit cannot enter a relief region, roughing emits nothing there (8 mm x 5 mm channel, 1/4in end mill: no roughing group at all) and the 1/8in ball finish slots it full width 5 mm deep at F1000 (13.85 mm^2 vs 4.80 mm^2 for a 1/8in roughing pass); 1/16in ball 4.4 mm axial; Job Review has no roughing-reach or finishing-load note"},
  {"id":"W6-P3-1","severity":"P3","area":"relief-generators","file":"src/core/job/kerf-closed-up.ts","line":26,"anchor":"Twin: ADR-486 Amd 1 reports holes the kerf closes; Contract: ADR-106 burn in layer kerf","evidence":"REPRO (zz-w6/box.mts -> box.out.txt)","verdict":"PENDING","known":false,"summary":"A Kerf Offset of at least half a finger notch (6 mm on a 3 mm / 9 mm-finger box) fills the four side panels' finger joints (29 -> 13 vertices); with part spacing 20 mm no diagnostic or min-feature note appears"},
  {"id":"16-P2-1","severity":"P2","area":"relief","file":"src/core/cnc/compile-cnc-relief-finishing.ts","line":40,"anchor":"rolling v2 16","evidence":"READ","verdict":"KNOWN","known":"rolling v2 16-P2-1; fix PR #1622 covers unmasked maps <= 1024^2 only","summary":"Still open on main"},
  {"id":"16-P3-1","severity":"P3","area":"relief","file":"src/core/relief/mesh-to-heightmap.ts","line":179,"anchor":"rolling v2 16","evidence":"READ","verdict":"KNOWN","known":"rolling v2 16-P3-1","summary":"Still open"},
  {"id":"16-P3-2","severity":"P3","area":"relief","file":"src/io/gcode/relief-materialization-failure.ts","line":13,"anchor":"rolling v2 16","evidence":"READ","verdict":"KNOWN","known":"rolling v2 16-P3-2","summary":"Still open"},
  {"id":"16-P3-3","severity":"P3","area":"relief","file":"src/core/cnc/depth-passes.ts","line":22,"anchor":"rolling v2 16","evidence":"READ","verdict":"KNOWN","known":"rolling v2 16-P3-3","summary":"Still open"},
  {"id":"16-P3-4","severity":"P3","area":"relief","file":"src/ui/relief-viewer/Relief3DViewerDialog.tsx","line":63,"anchor":"rolling v2 16","evidence":"READ","verdict":"KNOWN","known":"rolling v2 16-P3-4","summary":"Still open"},
  {"id":"16-K-2","severity":"P1","area":"relief","file":"src/core/relief/heightmap-outside-stock.ts","line":1,"anchor":"ADR-412 Amd 2","evidence":"Vitest emit-gcode-cnc-relief-footprint.test.ts passes","verdict":"FIXED","known":"09-29 P2-relief-rough-3 / meta M7-P1-1","summary":"Fixed by #1452"},
  {"id":"F6-P1-1","severity":"P1","area":"relief","file":"src/core/relief/relief-two-sided-stock.ts","line":1,"anchor":"ADR-580 Amd 1","evidence":"pro loop v2 T14b re-measure","verdict":"FIXED","known":"CNC v1 F6-P1-1","summary":"Fixed by 1deb6fab5"},
  {"id":"F6-P3-1","severity":"P3","area":"relief","file":"src/core/relief/relief-residual-stock.ts","line":9,"anchor":"CNC v1 F6","evidence":"READ","verdict":"KNOWN","known":"CNC v1 F6-P3-1","summary":"Still open"},
  {"id":"F6-P3-2","severity":"P3","area":"relief","file":"src/core/relief/relief-rest-passes.ts","line":37,"anchor":"CNC v1 F6","evidence":"READ","verdict":"KNOWN","known":"CNC v1 F6-P3-2; fix PR #1622","summary":"Still open on main"},
  {"id":"F6-P3-3","severity":"P2","area":"relief","file":"src/core/relief/relief-rail-stations.ts","line":1,"anchor":"ADR-575 Amd 1","evidence":"Vitest relief-rail-arcs.test.ts passes","verdict":"FIXED","known":"CNC v1 F6-P3-3","summary":"Fixed by 1deb6fab5"},
  {"id":"25-P2-1","severity":"P2","area":"design-generators","file":"src/ui/state/box-insert-mutation.ts","line":105,"anchor":"ADR-106 Amd 1","evidence":"REPRO box.mts","verdict":"FIXED","known":"rolling v2 25-P2-1","summary":"Box operations now cut with the active bit the reliefs were sized for"},
  {"id":"25-P3-1","severity":"P3","area":"design-generators","file":"src/ui/state/object-insert-actions.ts","line":228,"anchor":"rolling v2 25","evidence":"REPRO box.mts","verdict":"KNOWN","known":"rolling v2 25-P3-1","summary":"Still open: box panels take a black Fill default"},
  {"id":"25-P3-2","severity":"P3","area":"design-generators","file":"src/core/barcode/barcode-layout.ts","line":99,"anchor":"rolling v2 25","evidence":"READ","verdict":"KNOWN","known":"rolling v2 25-P3-2","summary":"Still open"},
  {"id":"25-P3-3","severity":"P3","area":"design-generators","file":"src/__fixtures__/barcode/linear-decoders.ts","line":6,"anchor":"rolling v2 25","evidence":"READ","verdict":"KNOWN","known":"rolling v2 25-P3-3","summary":"Still open"}
]
```

## Refuter (2026-11-09)

Fresh context. Tree: main `a3965a77d` (scratchpad `j11-main`, read only). Every line cited below was read at that SHA.

**How the repros ran.**
- Node 25 with the real modules, from scratchpad `zz-w6r/`: `node --import ./register.mjs <script>.mts [args]`. The loader is the auditor's (`register.mjs`, `ts-resolve.mjs`).
- My own scripts and their saved output:
  - `p1.mts` → `p1.out.txt`: projection G-code, Job Review operation detail (`buildEffectiveOperationReview` + `cncOperationDetail`, as `JobReviewOperations.tsx:175` calls it) and the full `detectMachineJobWarnings` list.
  - `p3.mts` → `p3.out.txt`: a closed projected profile with Tabs on, on a dished plaque.
  - `p2.mts` → `p2.out.txt`, `p2-10.out.txt`, `p2-nowide.out.txt`: a relief with one wide and one narrow channel.
  - `p2sim.mts` → `p2sim.out.txt`: my own stock simulator of the emitted G-code (machine coordinates, flat and ball profiles, 0.05 mm grid).
  - `p4.mts` → `p4.out.txt` (rapids and descents), `p5.mts` → `p5.out.txt` (relief past the bed edge).
  - Re-runs of the auditor's `box.mts` and `qr.mts` (`box.out.txt`, `qr.out.txt`).
- Memory was 2,383–2,506 MB at the gate. Vitest was not needed: every claim below ran on the real modules.

### Verdicts

**W6-P2-1 — CONFIRMED, SEVERITY CHANGE P2 → P1.**
- **What would make it false:**
  - the projection stepping by Depth per pass somewhere downstream;
  - a compiled-depth stock check that covers projected groups;
  - Job Review describing the projected pass truthfully.
- **None holds:**
  - `compile-cnc-relief-projection.ts:109` builds one group with `settings.cutType`, so `cnc-compiled-depth-warnings.ts:31` (relief-rough and relief-finish only) never sees it.
  - `cnc-through-cut-tab-warnings.ts:86` reads `settings.depthMm`.
- **The P1 scenario (REPRO `p3.mts`).** It is in the finding's own claim, "ignores … Tabs", but the auditor did not run it.
  - **Setup:**
    - A 40 × 40 mm depth-map plaque with a 30 × 30 mm floor 5 mm deep, on an output relief layer.
    - A closed 16 × 16 mm square on the floor, on a `profile-on-path` layer.
    - That layer has `reliefProjection` with Vertical depth 2, **Tabs on** (default 4 × 6 × 2 mm), Cut depth 1 and Depth per pass 1.
  - **Results:**

    | Stock | Emitted | Job Review operation detail | Warnings |
    |---|---|---|---|
    | 6.35 | 1 pass, every feed move at **Z−7** (0.65 mm through), no tab | "1 pass · stepover 40% · **tabs 4 per shape (6 × 2 mm)**" | starter feeds, projection note only |
    | 6.0 | 1 pass at **Z−7** (1 mm through), no tab | "**tabs 4 per shape (6 × 2 mm), skipped: the 5 mm floor holds the part**" | the same two notes only |
    | 6.35, Vertical depth 1.5, Cut depth 1.5 | 1 pass at Z−6.5 | "**2 passes** · … · tabs 4 per shape" | the same |

  - **Consequence:** the 16 mm square is cut free in one full-depth pass, with Tabs on and no tab cut. Job Review lists tabs, and on a set stock it states that a floor holds the part. Emit preflight is clean (`[]`), and no through-cut or kept-part note appears.
- **Why P1:**
  - METHOD §3: this is silently wrong physical output. The configured tabs are absent and a part comes free.
  - Precedent: CNC v1 F3-P1-1 was "Kept P1: a loose part beside a running spindle, with tabs on, and no warning" (CNC v1 LEDGER row F3-P1-1).
  - Lowering it needs a clear warning before output. The only projection note (`cnc-relief-planning-warnings.ts:146`) says "Check the 3D preview before running". That is generic and names neither the through-cut nor the missing tabs. Under §3, a visible result in Preview is not a warning.
- **Job Review misreports every projected layer.**
  - `buildEffectiveOperationReview` gives a projected layer no `relief` facts. Its groups are `engrave` or `profile-on-path`, and `job-review-effective-operations.ts:114` keeps only relief cut types.
  - So `cncOperationDetail` treats the layer as plain shapes:
    - `job-review-detail-facts.ts:209,217` → `cncDepthParts`, which counts `zPassDepths(settings.depthMm, settings.depthPerPassMm)` (`job-review-cnc-depth.ts:55`);
    - `:222` → `cncProfileTabsPart`, which reads `settings.tabsEnabled`.
  - REPRO `p1.mts`: Vertical depth 3, Cut depth 3, Depth per pass 1. Job Review says "**3 passes**", and the program cuts 1 pass to Z−7.407. The same holds for `profile-on-path`.
- **The other parts of the finding stand at lower severity on their own:**
  - The open-line, one-full-depth-pass load (Vertical depth 10 → one pass to Z−14.407 with a 1/8" end mill, `p1.out.txt` case C) is the F3-P2-1 class. Meta v1 M6 kept that at P2: "a full-width slot … not a P1 output".
  - The missing and false spoilboard advisory alone is the F7-P3-3 class (P3, the operator typed the depth).
  - The finding takes its severity from its worst reproduced scenario, the part cut free.
- **The app's own depth guidance** (the brief's question):
  - Starter bits carry no flute length and no maximum stepdown (`cnc-tool-starters.ts:8-80`).
  - The only per-bit depth model is the feeds calculator's `DEPTH_FACTOR`: 0.5 × D for softwood and plywood/MDF, 0.4 hardwood, 0.3 acrylic, 0.1 aluminium (`feeds-calculator.ts:56-62`). That is 1.6 mm for a 1/8" bit in MDF.
  - The 3 mm projected pass is 1.9 × that guidance.
  - No warning compares a pass with it.
- **Stock bottom:**
  - Z0 is the stock top: `depthMm` is "Total cut depth below stock top" (`machine.ts:165`), and safe Z is "above stock top" (`:242`).
  - So Z−7.407 in 6.35 mm stock is 1.06 mm into the spoilboard, as reported.
- **Citations re-read and accurate:**
  - `relief-projection-plan.ts:75,83-88`
  - `cnc-relief-group.ts:31`
  - `compile-cnc-job.ts:237`
  - `CncLayerFields.tsx:92,121`
  - `ReliefAdvancedCncControls.tsx:142-151`
  - `cnc-through-cut-tab-warnings.ts:86`
  - `cnc-compiled-depth-warnings.ts:31`
- **Fix direction, added:**
  - Judge projected groups on compiled depth for the through-cut and free-part check, as well as for the spoilboard check.
  - Either cut tabs on closed projected loops or say "no tabs" in Job Review.
  - Give projected layers their own Job Review detail (one pass, vertical depth, no tabs) instead of `cncDepthParts`.

**W6-P2-2 — CONFIRMED, P2 kept (not P1).**
- **What would make it false:**
  - roughing covering the narrow region on a second route;
  - a reach note;
  - the full-width slot being an artefact of the auditor's oracle.
- **Independent repro.** `p2sim.mts` is my own simulator, written separately from `engage.mts`. It runs a 44 × 44 mm relief with one 16 mm channel and one 8 mm channel, both 5 mm deep, a 1/4" end mill for roughing and a 1/8" ball for finishing:

  | Channel orientation | Finishing moves at Z ≤ −4.9 in the 8 mm channel | Cross-section p50 / p90 | Max | Length of moves over 10 mm² |
  |---|---|---|---|---|
  | Along Y (across the finishing rows) | 73 | 3.03 / 3.19 mm² | 13.86 mm² (4.21 mm long, F1000) | 4.2 mm |
  | Along X (parallel to the rows) | 8 | 2.80 / 2.97 mm² | **13.29 mm² over 40.41 mm** at F1000 | **40.4 mm** |

  - The auditor's 13.85 mm² holds, but only for the first row across a Y-oriented channel. After that the ball side-mills about 0.56 mm × 5 mm (≈ 3 mm², 1.57 × D axial) per row.
  - When the channel runs along the raster, the first deep row slots its whole length (40 mm here) full width at 5 mm.
  - A channel that is roughed partly is also left deep. At 10 mm wide, roughing reached only Z−1.5 in the narrow channel (`p2-10.out.txt`), and finishing then cut to Z−5.
- **Job Review is worse than "silent" when roughing reaches part of a relief.**
  - With the wide channel present, the operation detail reads "**relief roughing 3 levels to 4.5 mm**" (`job-review-detail-facts.ts:247`). That implies full roughing, and the narrow channel got none (`p2.out.txt`, deepest roughing Z in the narrow channel: none).
  - Only when roughing is empty everywhere does it say "no relief roughing levels" (`:238`, `p2-nowide.out.txt`). That is a fact on the card, not a reach warning.
  - **A correction to the report:** Start does show `cnc-secondary-tool-feed-retained`, "secondary bit … ball nose shares these layer values … feed 1000 mm/min … Verify them for the secondary bit" (`cnc-secondary-tool-feed.ts:33-37`, an emit-preflight advisory per `blocking-codes.ts`). It is about feeds, not reach, so the finding holds.
- **Why not P1:**
  - The geometry is right: there is no gouge and no leftover stock.
  - The feed is the app's own chart value for a 1/8" bit (`feeds-calculator.ts:48-52`, 0.04–0.06 mm/tooth → about 1,000–1,440 mm/min at 12,000 RPM with 2 flutes).
  - The harm is axial depth, 5 mm or 3.1 × the app's 0.5 × D guidance, cut at full width.
  - CNC v1 F3-P2-1 was the same class at 2 × D, full width, F1000, and meta v1 M6 kept it at P2 ("a full-width slot … not a P1 output"). No flute-length data exists to show the ball is over-reached (`cnc-tool-starters.ts:56-61`).
- **Extra anchor (Twin):**
  - The leaders plan R05 acceptance asks that fixtures "identify the regions a large cutter cannot reach" (`IMPLEMENTATION.md:210`).
  - KerfDesk does that for finish → rest (`relief-residual-stock.ts`), but not for roughing → finish.
- Citations re-read: `compile-cnc-relief.ts:109`, `job-review-effective-operations.ts:97,114`.

**W6-P3-1 — CONFIRMED, P3 kept.**
- Re-run of `box.mts` (`box.out.txt`):
  - Kerf Offset 6 mm: 29 → 13 vertices on the four side panels at both spacings.
  - Spacing 20 mm: no min-feature note and no diagnostic.
- **Scope check:** ADR-486 Amd 1 decision 1 counts only "a contour that shrinks under the offset". Its Limits already accept a partly closed neck. A notch in a growing outline is outside the decided scope but not excluded by it, so it is polish, not a broken contract.
- **Correction:** the threshold is not exactly 4.5 mm. In the same run, Kerf Offset 4.6 still leaves 29 vertices, so the generated finger cell is wider than the 9 mm target. Fingers vanish from about half the actual cell.

### Challenges to "Verified clean"

- **QR:** holds.
  - Re-ran `qr.mts`: 120 decoded, 0 failures.
  - The burn uses the same rule: `materialize-barcode.ts:89` sets `fillRule: 'evenodd'`, and `rasterize-vector-fill.ts:112,161,190` honours each path's `fillRule`.
- **Box limits:** holds (READ `box-spec.ts:120-213`). Not covered: a CNC box with relief `none` and a finger narrower than the cutting bit (see Not verified).
- **Relief G-code against the machine envelope:** holds, with a scope note (REPRO `p5.mts`).
  - Relief at X 369–399: max X 398.923, no issue.
  - At 375–405: `out-of-bed: Line 39: X out of bed: 400.241`.
  - At 385–415: the same issue, at Line 18.
  - The check parses the emitted program (`cnc-preflight.ts:95` → `cnc-motion-bounds-preflight.ts`), so relief, rest and projection are all covered.
  - It is advisory, not refusing (`blocking-codes.ts`, rule 7), and it checks the centreline. The cutter edge past the stock is the stock-placement note the auditor cited.
- **Safe Z and rapids over the stock:** clean.
  - `p4.mts`: relief plus projection, with and without a finishing ball, with the target output and not output. 0 G0 moves below Z0. Every G0 descent ends at safe Z 3.810, and cutting starts with G1.
  - `p2sim.mts`: no rapid removed stock in the two-channel programs.
- **"Relief depth against stock":** holds for relief stages. Rest is emitted as `relief-finish` (`compile-cnc-relief-rest.ts:86`), so it is covered. Projected groups are not covered, which is W6-P2-1.

### New findings

None as separate IDs. The tabs and through-cut scenario and the false Job Review pass and tab text are folded into W6-P2-1, which now carries P1. The partial-reach Job Review text is folded into W6-P2-2.

### Not verified

- **Browser:** no browser run. The Job Review strings came from `cncOperationDetail` called exactly as `JobReviewOperations.tsx:175-183` calls it, not from the rendered card.
- **Physical output:** no cut was made and no bit load was measured. "Part comes free" is inferred from a closed loop cut wholly below the stock bottom.
- **Projection on other cutters:**
  - projection with a ball or V-bit;
  - projection on STL reliefs;
  - a projected loop that crosses a slope, so only part of it goes through.
- **CNC box** with relief `none` and a finger narrower than the cutting bit.
- **Vitest:** not run. It was not needed, since every claim ran on the real modules.

Refuter counts: raised 3, refuted 0, P1 1, P2 1, P3 1, known 26
