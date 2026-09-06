> Historical audit of the saved source at `9209fcb33f4807ebfc1f7a55780069b6a7b0e23c`, before remediation. See [README.md](README.md) for the included fixes and current verification limits. External research links are retained. References to the large local evidence corpus are identifiers rather than broken repository links.

# Image tracing: detailed technical audit

KerfDesk / LaserForge | Prepared for the project owner | 6 September 2026

## The engine is worth improving

The evidence supports keeping the custom tracing architecture and repairing its specific failures. Its raw distance and topology primitives passed strong, independent tests. Most consequential defects occur when settings become effective, geometry is finished, asynchronous work reaches the document, or traced regions reach fill and preview consumers. No matched external-tracer experiment establishes that replacing the engine would improve this product. Accepted synthesis (local evidence: `evidence/stage-7/stage-7-report.md`)

**20 confirmed findings: 17 P2 and 3 P3.** P2 identifies a substantive correctness or responsiveness defect in a demonstrated scenario; P3 identifies a narrower defect. This audit has not established a P0/P1 incident, universal failure rate or physical machine outcome. All findings describe the source before fixes. Accepted findings and closure criteria (local evidence: `evidence/stage-7/consolidated-findings.md`)

The first correction should prevent an abandoned trace from changing the document after Escape. Next, repair stale image revisions and the camera import lifetime, followed by filled-region and raster-preview consistency. Geometry and settings repairs remain required even where ordinary examples look good. Worker scheduling and synchronous fallback need separate fixes: the measured queue recovered after about 30.5 seconds, while a deliberately activated fallback blocked the main thread for about 19.2 seconds. Lifecycle evidence (local evidence: `evidence/stage-4/stage-4-report.md`), output evidence (local evidence: `evidence/stage-5/stage-5-report.md`), performance evidence (local evidence: `evidence/stage-6/stage-6-report.md`)

## What this report covers

All five presets, the screenshot's settings and actions, Crop/Enhance, source editing and retracing, camera and multi-file entry, editable vectors and raster scan, Scanline/Follow Shape/Island Fill, worker behavior, physical placement, and software output consumers are represented in 45 coverage rows. The screenshot is UI evidence. The original **213501.jpg** was unavailable, so this audit cannot judge that exact artwork's fidelity. Inventory (local evidence: `evidence/stage-1/stage-1-report.md`), coverage reconciliation (local evidence: `evidence/stage-7/coverage-reconciliation.md`)

The source is the saved checkout at **9209fcb33f4807ebfc1f7a55780069b6a7b0e23c**, branch **claude/vcarve-stamp-subcell**. Its 11 inherited tracked modifications were retained. The manager's final Stage 7 integrity check found no changes in all **3,709** fingerprinted source/configuration/instruction files. The delegate's older execution worktree was not the source baseline. Independent integrity record (local evidence: `evidence/manager/stage-7-independent-integrity.json`)

## How to use the report

The next pages explain architecture, research, positive evidence, performance and correction order. Twenty short dossiers preserve each finding's trigger, consequence and closure test. The final coverage register shows both tested behavior and limits. Detailed fixtures, exact source lines, failed hypotheses and evidence hashes remain linked beside the claims.

<!-- PAGE -->

# What the current tracers actually do

The UI routes all five presets to custom code. Potrace was removed under ADR-123; ImageTracerJS remains an API-only route. Installed ImageTracerJS 1.2.6 and clipper2-ts 2.0.1-17 were verified. A historical backend name or a passed-through legacy option is not evidence that a current UI preset consumes it. Engine and option inventory (local evidence: `evidence/stage-1/stage-1-report.md`), version and research reconciliation (local evidence: `evidence/stage-7/research-reconciliation.md`)

| Preset         | Current method and output                                                              | Important behavior                                                                                          |
| -------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Line Art       | Prepared binary ink mask, custom closed contours                                       | Initial laser preset; automatic pale-detail recovery; displayed Ignore 2 conceals initial ink cleanup 12.   |
| Smooth         | Prepared mask, custom contours with smoothing                                          | Initial CNC preset; untouched brightness uses Otsu despite displayed 0/128.                                 |
| Sharp          | Prepared mask, custom contours with sharper defaults                                   | Untouched Otsu; no automatic scale-up flags; a useful fast native control.                                  |
| Centerline     | Distance field, ordered thinning, stroke graph, pruning, joining and finishing         | Open strokes and closed rings; output contact and endpoint integrity require checks after graph processing. |
| Edge Detection | Local-contrast ink plus dark ink, shared closed-contour finishing and length filtering | Produces ink outlines; it is not a current Canny route and can miss internal dark-to-dark transitions.      |

The processing boundary is: **decode and source identity -> options and mask -> working scale -> contours or skeleton graph -> finished geometry -> preview/commit -> placed output consumers**. Each boundary needs its own invariant. A sound raw mask cannot prevent a later self-crossing, changed fill rule or stale commit. Stage 2 preprocessing (local evidence: `evidence/stage-2/stage-2-report.md`), Stage 3 geometry (local evidence: `evidence/stage-3/stage-3-report.md`)

## Controls and flows

Cutoff and Threshold select brightness; Ignore removes small ink components and, in contour routes, small loops. Smoothness and Optimize affect finishing; Optimize 0 does not turn all fitting off. Edge exposes Sensitivity, Detail and Minimum line, with quantized internal mappings. Across presets the inventory contains **21 numeric control instances**, not 21 unique settings. Alpha and Force Sketch are conditional controls. Reset clears overrides for the selected preset. Exact ranges and displayed defaults (local evidence: `evidence/stage-1/stage-1-report.md`)

The normal decoder caps the trace grid's longest edge at 2048. Internal 4/6 MP budgets control optional upscaling, not a blanket native-input ceiling. Exposed pixel units refer to the decoded tracing grid; further internal scale conversion must preserve that contract. Crop restores coordinates to the full trace grid. Enhance replaces eligible interior paths while preserving crossing or margin paths. Scale evidence (local evidence: `evidence/stage-6/benchmark-summary.json`), region evidence (local evidence: `evidence/stage-4/stage-4-report.md`)

Editable vectors commit placed geometry. Raster scan creates binary artwork used by the image-motion pipeline. Fill style then selects Scanline, Follow Shape or Island Fill where applicable. Fade Image and Show Points affect preview only. Image Studio Apply & Trace is a fresh trace; Re-trace Original replaces an existing trace when its retained source can be resolved. Multi-File Trace uses Line Art and standalone SVG output without the per-image dialog. Entry and consumer map (local evidence: `evidence/stage-1/stage-1-report.md`)

<!-- PAGE -->

# Research implications for this engine

## Keep segmentation, topology and fitting separate

Selinger's 2003 Potrace paper separates bitmap boundary extraction, polygon construction, corner treatment and curve optimization. The useful lesson here is to test each transition. It does not establish Potrace as a better implementation for this product. The official mkbitmap manual also treats filtering, scaling and thresholding as explicit preprocessing choices. **Engineering inference:** make automatic thresholding and cleanup visible, then judge geometry against the actual prepared mask. [Potrace paper](https://www.mathstat.dal.ca/~selinger/potrace/potrace.pdf), [mkbitmap manual](https://potrace.sourceforge.net/mkbitmap.1.html)

Felzenszwalb and Huttenlocher's 2012 distance-transform work provides a relevant algorithmic reference; the local implementation received its own independent oracle. Pudney's 1998 thinning abstract concerns distance-ordered homotopic thinning in a different, 3D chamfer setting. It cannot certify this 2D graph and finisher. Schneider's original FitCurves companion source similarly motivates fitting-error checks without guaranteeing later resampling topology. **Engineering inference:** preserve components, holes, attachments and valid tips through every finishing operation. [Distance transforms](https://theoryofcomputing.org/articles/v008a019/), [Pudney abstract](https://www.sciencedirect.com/science/article/pii/S1077314298906804), [FitCurves source](https://github.com/erich666/GraphicsGems/blob/master/gems/FitCurves.c)

## Alternatives answer different questions

AutoTrace documents outline and centerline capabilities. ImageTracerJS documents color quantization and tracing options; its API is still callable locally. VTracer documents a color-vectorization approach, but its README example and claims are not matched runtime evidence. LightBurn's current Trace Image guide is useful for control semantics and user expectations; the legacy guide remains historical context. None was run as an external quality comparator in this audit. [AutoTrace](https://github.com/autotrace/autotrace), [ImageTracerJS options](https://github.com/jankovicsandras/imagetracerjs/blob/master/options.md), [VTracer](https://github.com/visioncortex/vtracer), [current LightBurn guide](https://docs.lightburnsoftware.com/latest/Reference/TraceImage/)

A future comparison needs identical image bytes, the same intended output (filled region, outline or one-stroke centerline), matched preprocessing and physical scale, and both quality and resource measurements. Optional Boundary IoU and clDice ideas may help evaluate boundaries and centerline overlap. Only primary abstracts were accessible; neither metric nor its theorem was implemented or validated here. [Boundary IoU abstract](https://openaccess.thecvf.com/content/CVPR2021/html/Cheng_Boundary_IoU_Improving_Object-Centric_Image_Segmentation_Evaluation_CVPR_2021_paper.html), [clDice abstract](https://openaccess.thecvf.com/content/CVPR2021/html/Shit_clDice_-_A_Novel_Topology-Preserving_Loss_Function_for_Tubular_Structure_CVPR_2021_paper.html)

## Apply contracts at consumers

SVG defines different nonzero and even-odd regions. ClipperOffset documents winding and intersection preconditions. These support investigating region preparation, but do not prove the local offset chain repaired: normalization alone still failed. WHATWG worker and event-loop rules support retiring obsolete execution and using genuinely cooperative fallback; an async wrapper alone does not interrupt synchronous computation. [SVG fill rules](https://www.w3.org/TR/SVG2/painting.html#FillRuleProperty), [ClipperOffset](https://www.angusj.com/clipper2/Docs/Units/Clipper.Offset/Classes/ClipperOffset/_Body.htm), [worker termination](https://html.spec.whatwg.org/multipage/workers.html#terminate-a-worker), [event loop](https://html.spec.whatwg.org/multipage/webappapis.html#event-loop-processing-model)

The research ledger reconciles 21 sources with exact local needs, access limits and competing explanations. Broad discovery stopped once the consequential diagnoses had evidence; another comparator README would not resolve the demonstrated bugs. Complete claim-to-source reconciliation (local evidence: `evidence/stage-7/research-reconciliation.md`)

<!-- PAGE -->

# What passed, and what those passes mean

## Independent foundations

The distance implementation matched an independent oracle on **66,237 masks / 1,093,684 pixels**, with zero mismatches. Raw thinning and contour reconstruction passed **66,132 masks / 1,059,848 pixels**, with zero recorded topology, reconstruction or immutability violations. The domains include enumerated 3x3 and 4x4 masks plus documented narrow, rectangular and generated cases. These are strong bounded primitive results; finished paths can still fail later. Distance oracle (local evidence: `evidence/manager/distance-oracle-result.json`), topology oracle (local evidence: `evidence/manager/topology-oracle-result.json`)

Two fairing investigations remain distinct. The manager's **60 checks across 12 polylines and five placements** passed a symmetric analytic capsule radius of **0.05000001 mm**, using double precision, 1e-8 mm radius slack and 1e-12 interval merging. Separately, the delegate's **28 measurements across seven fixtures and four placements** gave a maximum sampled lower bound of **0.0500000000000 mm** and continuous upper bound of **0.0500199976118 mm**, at 0.00002 mm enclosure resolution. The latter is not an exact hard 0.05 mm result or physical precision. Neither proves all multi-chain contacts. Manager continuous checks (local evidence: `evidence/manager/stage-5-continuous-fairing-observations.json`), delegate enclosures (local evidence: `evidence/stage-5/cnc-conditioning-results.json`)

## Working behavior was retained as evidence

The audit recorded valid numeric extremes, opaque-alpha fallback, source-copy integrity, fresh-worker recovery, placement and grouped undo, actual preset commits, and truthful partial-save behavior for generated multi-file input. In the raster polarity case, the generated bitmap, compiler and emitted software power agreed; the shaded preview was wrong. Positive controls and limits (local evidence: `evidence/stage-7/strengths-tradeoffs-gaps.md`)

**593 distinct test cases have passing evidence: 449 existing-source cases and 144 audit cases.** Independent accounting parsed 40 retained executions and removed 24 repeated cross-stage memberships. Stage totals are 155, 111, 135, 203 and 13 for Stages 2-6. They must not be added without deduplication. A failed normalization-only hypothesis is excluded. The corrected alpha test passed in a later focused execution; this was not a new all-13-green run. Manager tests, browser checks, benchmarks and exhaustive oracle cases are separate counts. Independent test accounting (local evidence: `evidence/manager/cross-stage-test-accounting.json`)

## Evidence boundaries

Browser evidence used production components, hooks and actual Workers inside development harnesses, with generated inputs. It did not exercise every full-App menu, OS picker, production bundle or packaged runtime. Camera input was generated; multi-file writes used an audit sink. The 36 preview/G-code comparisons are a subset of the 83 Stage 5 audit tests, not additional cases. The accepted output oracle measured software geometry and encoded power, not controller streaming or a burn. Stage 4 browser scope (local evidence: `evidence/stage-4/stage-4-report.md`), Stage 5 output scope (local evidence: `evidence/stage-5/stage-5-report.md`)

Hosted CI, deployment, packaged runtime, external comparator/reference CAM, original-image fidelity, air-cut, material and hardware qualification remain unrun. A source-only observation that synthetic CNC finishing opened a 0.013122 mm contact remains unranked because current-trace reachability was not established. Existing Frame-first policy remains unchanged. Retained gaps (local evidence: `evidence/stage-7/strengths-tradeoffs-gaps.md`)

<!-- PAGE -->

# Performance: measured costs and responsiveness

The corpus contains **53 child records, 48 distinct configurations, 52 completed records and one censored record**. There are **67 completed uninstrumented trace samples**, including 15 warm samples, plus three instrumented samples. Runs were serial, on a shared i9-13900H host using Node 24.15 and an unminified development bundle; child processes used a 2 GB audit old-space limit. Timings describe those workloads and conditions. Benchmark summary (local evidence: `evidence/stage-6/benchmark-summary.json`), independent count verification (local evidence: `evidence/manager/stage-6-independent-integrity.json`)

| Generated workload                                 | Trace time                     | Interpretation                                                                                                               |
| -------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Noisy RGB 192x192, Edge, working 384x384           | 20,644.98 ms                   | 44,843 vertices and 612,922 SVG bytes; three warm repeats remained about 20.20-20.56 seconds with identical geometry hashes. |
| Same noisy source, Smooth / Line Art / Sharp       | 14,619.54 / 313.69 / 234.45 ms | Different preset contracts and scale plans; these timings are not equal-quality comparisons.                                 |
| Noisy 192x192, Centerline                          | Censored at about 30 seconds   | External wall-clock bound includes startup; no completed duration or infinite-loop claim.                                    |
| Different noisy 96x96, Centerline profile          | 15,536.44 ms                   | 15,127.78 ms inside spur pruning; separate from the censored case.                                                           |
| Dense color 1224x1224, Line Art, working 2448x2448 | 12,330.93 ms                   | 1,128,754 vertices; 16,894,122 SVG bytes; 129,287,512 geometry-JSON bytes.                                                   |

The Edge profile spent **20,711.65 ms of 20,977.71 ms** inclusively in 17 calls to `sharpenChainBends`. This identifies a useful optimization target. Inclusive profile scopes overlap and must not be summed. The adjacent 1225x1225 dense input selected a smaller working grid and completed in 1,706.11 ms, but its pixels differ; that pair is not an identical-input timing counterfactual. Profiles and scale plans (local evidence: `evidence/stage-6/benchmark-summary.json`)

## The current preview can wait behind obsolete work

With a real decoded 192x192 PNG, production controls and the actual 300 ms debounce, Edge Minimum line changes 12 -> 13 -> 14 at 350 ms intervals followed by Sharp left Sharp waiting for obsolete work. Its pre-start watchdog terminated the worker after **30,000.7 ms**; it became ready **30,538.5 ms after the last UI choice**. This is queue delay, not a 30-second main-thread freeze. The run injected no worker failure or artificial compute delay. Browser output matched options, vertex count and SVG byte count, but no full browser geometry hash was captured. Queue timeline (local evidence: `evidence/manager/stage-6-queue-timeline.json`)

An explicit Worker-construction fault activated the existing small-input fallback on the expensive Edge image: **19,168 ms computation, 19,180.8 ms frame gap and a 19,184 ms overlapping Long Task**. Natural worker-failure frequency is unknown. A corrected interval-overlap calculation retained a task that began 0.3 ms before the call. Both this mechanism and the queue must close under TR-020. Failure-boundary evidence (local evidence: `evidence/stage-6/browser-boundaries.json`)

Peak Node process RSS and later serialization/consumer work must not be described as browser trace heap. Maximum sampled RSS was 1,376.71 MiB; process maxRSS was 1,678.98 MiB. Geometry-JSON timing includes metric traversal, and worker clone cost was not isolated. [Exact-version memory units](https://nodejs.org/download/release/v24.15.0/docs/api/process.html#processmemoryusage), measurement limits (local evidence: `evidence/stage-7/evaluation-plan.md`)

<!-- PAGE -->

# Correction sequence and completion criteria

These are integration milestones. The delegate will receive small, reviewable changes within each group, and the manager will inspect the diff and evidence before assigning the next. Group order reflects dependency and user impact; it does not downgrade geometry failures. Accepted priority and dependency plan (local evidence: `evidence/stage-7/remediation-batches.md`)

| Order | Integration milestone                                          | Findings in implementation order                       |
| ----- | -------------------------------------------------------------- | ------------------------------------------------------ |
| B01   | Document, source revision and entry lifetime                   | TR-013, TR-014, TR-012                                 |
| B02   | Filled-region semantics and effective raster preview           | TR-017, TR-018, TR-019                                 |
| B03   | Preview completion, worker responsiveness and focus            | TR-016, TR-020/QUEUE, TR-020/INLINE, TR-015            |
| B04   | Visible options, alpha intent, detail recovery and scale units | TR-001, TR-002, TR-003, TR-004, TR-005, TR-009, TR-006 |
| B05   | Finished geometry and surviving graph contracts                | TR-007, TR-008, TR-010, TR-011                         |

B02-B04 depend on the stable lifetime boundary in B01. B05 also depends on corrected scale units in B04. Each parent ID has one authoritative record. **TR-020 stays open until both mechanisms pass.** Required repairs include all 20 parent findings, including the three P3 items. Consolidated ledger (local evidence: `evidence/stage-7/consolidated-findings.md`)

## What will count as fixed

Each substantive change must reproduce the accepted failure, pass a regression through the actual affected contract and preserve a meaningful positive control. Geometry changes require finished-path topology and boundary checks; filled output requires intended-region checks; lifecycle changes require actual state and asynchronous schedule checks. UI changes also need rendered verification of the changed interaction. Green tests that merely restate the patch do not close a finding. Evaluation plan (local evidence: `evidence/stage-7/evaluation-plan.md`)

For the exact accepted foreground worker fixture, the proposed engineering targets are a latest-job started acknowledgement within **1,000 ms of post** and ready within **1,500 ms**, with a full geometry hash against a direct current-options control. The fallback target is no attributable main-thread task or foreground frame gap above **100 ms**, using interval overlap. These are local engineering targets, not standards or achieved results. W3C Long Tasks uses a 50 ms measurement threshold; it does not supply this product's latency objective. Mechanism criteria (local evidence: `evidence/stage-7/consolidated-findings.md`), [Long Tasks specification](https://www.w3.org/TR/longtasks-1/)

## Preserve useful behavior

Keep automatic thresholding where it is explicit and useful; preserve compatible deliberate edits, text counters, holes, source placement and undo. Normalize filled regions under their actual contract and validate the entire offset chain. Fix responsiveness with scheduling and genuinely cooperative work or qualified recovery. Retain the existing 159,600 / 160,000 / 160,400-pixel boundary controls. Adding input caps, delayed actions, disabled controls or another Start guard does not satisfy these repairs. Accepted criteria and counterfactual limits (local evidence: `evidence/stage-7/consolidated-findings.md`)

Profile-guided corner/pruning optimization, representation/cache changes and matched external-comparator work are optional follow-on investigations. They are not substitutes for correctness or responsiveness closure. Local fixes and verification are authorized after the final audit review; commits, PRs, merges, publication, deployment and hardware operations are outside this phase. Optional work and limits (local evidence: `evidence/stage-7/strengths-tradeoffs-gaps.md`)

<!-- PAGE -->

# Findings 01-02: effective settings

## TR-001 | P2 | Identical displayed numbers can trace differently

**Trigger and result.** Untouched Smooth, Sharp and Centerline show Cutoff 0 / Threshold 128 while using Otsu. On two gray-180 rectangles, the initial result retains 1,008 ink pixels and two paths. Editing the displayed threshold or cutoff away and back produces no ink or paths. Line Art also displays Ignore 2 while initial ink cleanup is 12; explicitly setting 2 restores a 9-pixel dot. These were executed option-merge consequences, not claimed browser edit sequences.

**Cause and consequence.** Automatic state and cleanup stages are hidden behind manual-looking numbers. Even a manually supplied threshold differs at equality depending on whether Cutoff 0 was explicitly entered. A user cannot reliably recreate output from the visible settings.

**Required correction.** Show automatic/manual mode and effective cleanup explicitly. Identical explicit brightness values must select one history-independent band. Preserve intentional Otsu behavior.

**Close when.** Actual controls pass edit-away/edit-back cases for Threshold, Cutoff and Ignore; gray 128 equality, gray 180 art and 2-12-pixel components agree with displayed intent. Detailed source and fixtures: TR-001 evidence (local evidence: `evidence/stage-2/stage-2-report.md`), accepted closure criteria (local evidence: `evidence/stage-7/consolidated-findings.md`).

## TR-002 | P2 | Hidden overrides survive preset changes

**Trigger and result.** Force Sketch set in Smooth remains active after switching to Line Art, where its checkbox is hidden. A 70x70 solid black square falls from 4,900 to 1,984 ink pixels. Smoothness/Optimize edited in Smooth also affect Edge after their controls disappear: an otherwise identical visible Edge setup produces 160 rather than 132 vertices and different bounds/hash.

**Cause and consequence.** Preset selection changes the preset while merging the same override object afterward. The visible control set does not reveal all active processing state.

**Required correction.** Define compatible persistence, expose active inherited values or retain mode-specific overrides with a clear reset. Preserve deliberate edits where their meaning remains compatible.

**Close when.** All ordered preset transitions cover defaults, edited values, reset and reopening. The forced-Sketch and hidden-finishing reproductions must agree with visible state. Transition evidence (local evidence: `evidence/stage-2/stage-2-report.md`), TR-002 closure criteria (local evidence: `evidence/stage-7/consolidated-findings.md`)

<!-- PAGE -->

# Findings 03-04: foreground intent

## TR-003 | P2 | Crop and Enhance can lose alpha-mask intent

**Trigger and result.** A transparent 128x128 image contains an opaque white 20x20 square. Alpha tracing returns one full-image contour, no contour for the exact opaque crop, and one when the crop includes a one-pixel transparent margin. Related Enhance cases can insert an unintended RGB-derived hole.

**Cause and consequence.** The UI decides alpha availability from the whole source. The cropped buffer is then reclassified as opaque and falls back to luminance. A boundary selection changes the meaning of foreground, so intended artwork disappears or changes topology.

**Required correction.** Resolve alpha intent against the full source and carry it through Crop and Enhance. Keep luminance fallback for sources that were originally opaque.

**Close when.** Full image, tight ROI, transparent margin, partial/empty alpha and Enhance preserve intended foreground and restored coordinates. Include the alternate opaque white region with black RGB detail and preview/commit parity. The initial Stage 6 wrong-key probe is retained history; corrected alpha execution supplies the passing evidence. Original and region evidence (local evidence: `evidence/stage-4/stage-4-report.md`), corrected adversarial evidence (local evidence: `evidence/stage-6/adversarial-results.json`), closure criteria (local evidence: `evidence/stage-7/consolidated-findings.md`)

## TR-004 | P2 | Automatic pale-detail recovery hollows dark solids

**Trigger and result.** In a 128x128 Line Art fixture, changing a separate qualifying colored patch from 32 to 33 pixels activates global automatic Sketch processing. An unchanged 40x40 black square drops from 1,600 to 1,024 ink pixels, loses 576 interior pixels and gains an inner traced boundary. An independent 40/41-pixel variant also reproduced the loss.

**Cause and consequence.** A global promotion decision applies local-threshold behavior to already confident dark ink. Remote color detail can turn a solid logo feature into a hollow region. The changed actual mask and traced hole establish the defect; a threshold discontinuity alone would not.

**Required correction.** Preserve confident dark interiors when automatic detail recovery activates, while keeping explicitly chosen Sketch semantics distinct.

**Close when.** Both threshold-crossing fixtures preserve the unchanged solid region. Measure pale-detail recovery separately and retain uneven-illumination and deliberate-Sketch controls. Mask and contour evidence (local evidence: `evidence/stage-2/stage-2-report.md`), TR-004 closure criteria (local evidence: `evidence/stage-7/consolidated-findings.md`)

<!-- PAGE -->

# Findings 05-06: units and promises

## TR-005 | P2 | Downsampling changes Ignore's area units

**Trigger and result.** A dense 1601x1000 colored alpha fixture contains twelve isolated 5x5 targets, all larger than Ignore 20. The working grid becomes 1415x884. An unscaled area threshold of 20 then means 25.5984 source pixels and leaves only four targets. Applying the measured area ratio to the same resampled pixels retains all twelve. A non-square alternate fixture independently confirms the mechanism.

**Cause and consequence.** Fractional scale information is sanitized to 1 for these cleanup controls. Resolution policy therefore changes the physical meaning of a visible area setting and deletes features that should survive it.

**Required correction.** Define decoded-source pixel units, then convert length and area controls once using the actual working scales. Keep the intended resolution policy.

**Close when.** The identical-working-pixel counterfactual retains all twelve targets with the correct area threshold. Test both sides of scale-policy boundaries, non-square rounding, and separate length, area and dimensionless controls. Scale-unit reproduction (local evidence: `evidence/stage-2/stage-2-report.md`), TR-005 closure criteria (local evidence: `evidence/stage-7/consolidated-findings.md`)

## TR-006 | P3 | Edge help overstates the current edge contract

**Trigger and result.** Adjacent gray-64 and gray-112 halves inside a white background contain a clear internal brightness transition. The current Edge mask combines local contrast with all sufficiently dark ink; both halves become one 4,800-pixel region and return one outer contour, with no internal transition path.

**Cause and consequence.** Help promises single lines along brightness edges, while the implementation is a closed ink-outline route. Closed paths are not inherently wrong for edges; the missing dark-to-dark transition demonstrates the narrower contract.

**Required correction.** Describe current ink-outline behavior and its dark-on-dark limit accurately. Developing a different general edge algorithm is optional work, not required to repair this help defect.

**Close when.** Help and preset examples agree with the gray-split fixture, while retaining useful local-contrast and closed-outline examples. Current route and fixture (local evidence: `evidence/stage-2/stage-2-report.md`), TR-006 closure criteria (local evidence: `evidence/stage-7/consolidated-findings.md`)

<!-- PAGE -->

# Findings 07-08: finished topology

## TR-007 | P2 | Final contour refinement introduces crossings

**Trigger and result.** Narrow notches and nearby separate squares pass earlier contour stages without crossings. Final refinement creates one proper notch self-crossing in default Line Art, two in Smooth and one in Edge; default Smooth also creates two cross-loop intersections between separate squares. Sharp reproduces at high settings. The manager independently verified all 15 recorded crossing witnesses with exact predicates on the returned coordinates.

**Cause and consequence.** Shared final resampling changes geometry after earlier validity checks. It can break simple loops, separation and downstream filled-region assumptions.

**Required correction.** Preserve simple-loop topology and separation through the output finisher while measuring boundary and corner fidelity. A sampled fitting tolerance is insufficient.

**Close when.** Notch and separated-square cases have no unintended proper crossings across relevant minima, defaults and maxima. Keep genuine small positive gaps distinct from intersections; preserve holes and rerun all three fill consumers. Geometry causality (local evidence: `evidence/stage-3/stage-3-report.md`), downstream consequences (local evidence: `evidence/stage-5/stage-5-report.md`), closure criteria (local evidence: `evidence/stage-7/consolidated-findings.md`)

## TR-008 | P2 | Finishing detaches welded Centerline junctions

**Trigger and result.** Default Centerline Y and ring-plus-branch fixtures are exactly connected after welding and sharpening. Curvature smoothing separates their chains; final gaps are approximately 0.3479 and 0.2382 source pixels. Both finish as two geometric components despite their earlier shared attachment.

**Cause and consequence.** Independent chain finishing loses attachment identity. A valid skeleton graph does not guarantee connected final vector segments.

**Required correction.** Carry the shared attachment through smoothing and final representation. Avoid indiscriminate distance welding that would join intentional gaps or nearby parallel paths.

**Close when.** Actual finished segments remain connected within a declared numerical tolerance and retain branch coverage under rotation, reflection and unequal placement scale. Include intentional crossings, parallel paths and real gaps. This is a trace-finisher defect; the separate synthetic CNC contact observation is not a proven CNC-specific cause. Centerline and alternate-fixture evidence (local evidence: `evidence/stage-3/stage-3-report.md`), TR-008 closure criteria (local evidence: `evidence/stage-7/consolidated-findings.md`)

<!-- PAGE -->

# Findings 09-10: Centerline graph contracts

## TR-009 | P2 | Automatic upscaling weakens gap recovery

**Trigger and result.** A narrow-stroke fixture joins natively but splits under the actual 2x preset policy, leaving a 1.0235-source-pixel finished gap. The wrapper supplies scale 2 while assembly still receives join gap 3 working pixels. Using 6 on identical 2x preprocessing restores one path. A separate broad bar can switch the automatic scale policy and change the unchanged narrow feature's join result.

**Cause and consequence.** A distance option is not converted with the working scale. Remote content therefore changes gap recovery through scale selection.

**Required correction.** Give joining a stable decoded-source distance contract and retain the existing tangent and graph constraints.

**Close when.** Below/at/above-threshold gaps behave consistently on identical working rasters after conversion. Preserve branches, opposing tangents, intentional gaps and disconnected parallel paths. The join-gap override was an audit counterfactual, not a completed repair. Scale and join causality (local evidence: `evidence/stage-3/stage-3-report.md`), TR-009 closure criteria (local evidence: `evidence/stage-7/consolidated-findings.md`)

## TR-010 | P2 | Stale junction labels suppress true-tip extension

**Trigger and result.** Default Centerline on a flat-ended 17-pixel-wide bar returns only 75 pixels of a 92-pixel span, ending 8.5 pixels short at both caps. A five-pixel bar is 2.5 pixels short at each end. Variable-width examples also fail. Surviving degree-one nodes retain historical junction roles; reclassifying only those obsolete roles greatly reduces the cap error in the retained graph.

**Cause and consequence.** Spur pruning changes connectivity without updating all node identities used by endpoint extension. A current terminal is excluded as though it were still a live junction.

**Required correction.** Make post-prune node roles agree with the surviving graph before assembly and extension. The diagnostic reclassification still needs broader qualification.

**Close when.** Measure both caps on five-pixel, 17-pixel and variable-width strokes in both orientations. Keep T/Y/X branches and through-strokes from extending across genuine junctions, and retain the last valid chain. Graph and cap evidence (local evidence: `evidence/stage-3/stage-3-report.md`), TR-010 closure criteria (local evidence: `evidence/stage-7/consolidated-findings.md`)

<!-- PAGE -->

# Findings 11-12: retained detail and camera entry

## TR-011 | P3 | Simplification discards tiny retained loops

**Trigger and result.** Native Line Art and Smooth with Ignore 0 retain prepared areas of 3,600, 36, 16, 9, 4 and 1 pixels, but their final output loses a loop even at Optimize 0. More disappear at Optimize 2. A one-pixel loop has nonzero area after raw smoothing, then Douglas-Peucker reduction leaves only two points and the finisher drops it. Sharp retains all six at Optimize 0/0.2, demonstrating that a valid representation is possible.

**Cause and consequence.** Geometric simplification silently removes a whole component that cleanup intentionally kept. Ignore 0 does not communicate this later deletion.

**Required correction.** Retain a valid small closed representation when cleanup has not removed the component, while preventing overshoot and crossings.

**Close when.** Areas 1, 4, 9, 16 and 36 survive the accepted native-grid context across relevant defaults and maximum Optimize. Measure area and boundary error, and distinguish intentional removal by a larger Ignore value. Tiny-loop evidence (local evidence: `evidence/stage-3/stage-3-report.md`), TR-011 closure criteria (local evidence: `evidence/stage-7/consolidated-findings.md`)

## TR-012 | P2 | Camera tracing cannot commit its transient source

**Trigger and result.** The actual Trace from camera button prepares a source with valid generated binding and bed alignment, reaches a ready preview, then commit reports that the camera source changed or was removed. No trace or raster is inserted and the dialog remains open.

**Cause and consequence.** Camera capture supplies an import-like transient raster. Commit requires that source ID to already exist in the scene. The builder and preview can work while the reachable workflow cannot finish.

**Required correction.** Give camera capture an appropriate import lifetime and registered placement, then commit coherently without requiring a nonexistent scene image.

**Close when.** The actual camera-button route commits placed artwork; Cancel leaves the document unchanged. Cover source-deletion choice and undo. The generated fixture does not qualify real capture, calibration or physical registration. Rendered button-to-commit evidence (local evidence: `evidence/stage-4/stage-4-report.md`), TR-012 closure criteria (local evidence: `evidence/stage-7/consolidated-findings.md`)

<!-- PAGE -->

# Findings 13-14: document and source lifetime

## TR-013 | P2 | Escape can be followed by insertion and source deletion

**Trigger and result.** With Delete Image After trace selected, change a setting and press Enter before preview finishes. Press Escape while commit is pending, then allow the native reply to return. The dialog closes first, but a trace is inserted and its source raster is deleted afterward. Grouped undo can restore the result; abandonment still failed to prevent document effects.

**Cause and consequence.** Asynchronous commit is not sufficiently bound to the active dialog/source/document lifetime. Closing the workflow does not abandon its later mutation.

**Required correction.** Tie commit effects to the current lifetime and discard effects when it ends. Preserve Escape and ordinary cancellation.

**Close when.** The accepted Enter/Escape/reply schedule causes no insertion, deletion or closure of a later dialog, with source deletion both on and off. Include new dialog/document, ordinary ready commit, transforms and undo. Disabling Escape or adding confirmation does not repair lifetime ownership. Actual asynchronous schedule (local evidence: `evidence/stage-4/stage-4-report.md`), TR-013 closure criteria (local evidence: `evidence/stage-7/consolidated-findings.md`)

## TR-014 | P2 | Apply & Trace reads the original paged asset

**Trigger and result.** Import a qualifying page-backed PNG, invert it in Image Studio, then Apply & Trace. The baked edit begins with a black pixel, but Trace reads the retained original asset beginning with white and commits its geometry. The browser reproduction used a real 256x128 PNG with roughly 26 MiB of text padding to enter the paged route; this is not a large-pixel-grid performance claim. The manager independently reproduced the stale-asset mechanism on another fixture.

**Cause and consequence.** Current image data and retained sourceAssetId/thumbnail describe different revisions. Downstream readers prefer the original asset even after edits have been applied.

**Required correction.** Make asset identity, current pixels, thumbnail and luma describe the same revision, while retaining assets reachable through undo.

**Close when.** The actual paged import/edit route and alternate store fixture use edited content in preview, reopening and trace input. Check ordinary and paged images, copies and undo/redo; do not delete historical assets still in use. Paged-source reproduction (local evidence: `evidence/stage-4/stage-4-report.md`), TR-014 closure criteria (local evidence: `evidence/stage-7/consolidated-findings.md`)

<!-- PAGE -->

# Findings 15-16: dialog completion

## TR-015 | P3 | Clear Boundary loses focus and Escape

**Trigger and result.** Draw a boundary, focus and activate Clear Boundary, then press Escape. Clearing removes the focused button, focus falls to BODY and Escape leaves the dialog open. Cancel still works.

**Cause and consequence.** Focus is not restored when a conditional control disappears, placing the keyboard outside the dialog's handler. This is a concrete component failure, not a complete accessibility-conformance assessment.

**Required correction.** Restore focus to a useful existing control within the dialog when the focused control unmounts. The WAI-ARIA modal-dialog pattern supplies relevant focus and Escape guidance. [Modal-dialog guidance](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)

**Close when.** Clear Boundary followed by Escape and Tab behaves correctly, with focus restored after close. Check related preset/control disappearance and in-flight states while preserving Escape. Rendered focus evidence (local evidence: `evidence/stage-4/stage-4-report.md`), TR-015 closure criteria (local evidence: `evidence/stage-7/consolidated-findings.md`)

## TR-016 | P2 | An early empty commit leaves the preview stuck tracing

**Trigger and result.** Open a blank image and press Enter before its preview finishes. Commit correctly produces no paths. After every posted request has replied, Trace is enabled again but the preview still says Tracing. Changing Threshold starts another request and restores readiness. An independent alternate-size fixture reproduced this.

**Cause and consequence.** Early commit supersedes preview ownership without settling every empty-result path. A finished unsuccessful attempt leaves stale busy presentation until another edit.

**Required correction.** Settle preview state after empty or failed commit while preserving current-result ownership and retry behavior. Prepared geometry may be shared where its identity is correct.

**Close when.** The accepted blank/early-Enter schedule displays the empty result and stops tracing after all native replies, without another edit. Cover successful early commit, failure, Enhance, retry and rapid changes; stale replies must not replace current output. Preview-state reproduction (local evidence: `evidence/stage-4/stage-4-report.md`), TR-016 closure criteria (local evidence: `evidence/stage-7/consolidated-findings.md`)

<!-- PAGE -->

# Findings 17-18: intended filled regions

## TR-017 | P2 | Follow Shape loses or leaves overlapping regions

**Trigger and result.** Actual Sharp traces are duplicated, shifted and rebound to one Follow Shape operation at 0.5 mm spacing. Although output reports complete, 2,076 of 4,220 sampled interior points are more than 0.425 mm from every powered offset contour; the maximum is 10.721 mm. An overlapping-square control also changes to 50 mm of powered path outside the unchanged even-odd region when only a contour seam moves.

**Cause and consequence.** Endpoint-based orientation and offset preparation do not preserve the intended overlapping region through the complete chain. Coverage can disappear or powered software paths can leave that region.

**Required correction.** Prepare the actual filled region before offsetting, and preserve it through cleanup and filtering. Normalization alone still failed. A better direct-port counterfactual also bypassed cleanup/filtering, so it is not winding-only proof or a finished fix.

**Close when.** Actual rebound traces and alternate squares retain finite-spacing coverage and keep powered segments inside the intended region. Cyclic seam changes must not change the region; retain holes and components. Treat finite sample coverage and physical output as separate limits. Offset and counterfactual evidence (local evidence: `evidence/stage-5/stage-5-report.md`), TR-017 closure criteria (local evidence: `evidence/stage-7/consolidated-findings.md`)

## TR-018 | P2 | Distant text changes existing traces' fill

**Trigger and result.** Bind a real generated Roboto I, placed far away, to an operation containing two unchanged overlapping Sharp traces. The operation's rule flips from even-odd to nonzero. Local powered Scanline grows from 792.785426 to 1,001.234639 mm, adding 208.449213 mm inside previously blank overlaps. Removing the text restores the original region.

**Cause and consequence.** A bucket-wide predicate lets one object's type reinterpret other objects' region semantics. The manager confirmed the mechanism independently with a cached I-shaped glyph and actual store/rebind/compiler code; that separate probe did not load a font or exercise Add Text.

**Required correction.** Preserve constituent region semantics, including ADR-029 cross-object even-odd intent and text counters. A blind union or global nonzero rule is insufficient.

**Close when.** Actual remote text and rebind leave local trace output unchanged. Cover mixed text counters, nested holes, overlapping traces, multiple operations and correctly wound single traces. Actual-font and region evidence (local evidence: `evidence/stage-5/stage-5-report.md`), TR-018 closure criteria (local evidence: `evidence/stage-7/consolidated-findings.md`)

<!-- PAGE -->

# Findings 19-20: preview truth and responsiveness

## TR-019 | P2 | Raster preview ignores the trace's negative-image override

**Trigger and result.** Trace Sharp to Raster scan from an Image operation with Negative Image enabled. The new trace correctly stores negativeImage:false, but shaded preview still uses the parent true value. All 35,358 preview pixels invert relative to the trace. Compiled pixels and emitted software power agree with the intended trace. Changing only the parent corrects preview with byte-identical G-code.

**Cause and consequence.** Preview processing and cache identity use unresolved operation settings. The user sees misleading polarity; the evidence does not show an inverted burn.

**Required correction and closure.** Use effective object settings in preview and its cache key. Compare every pixel in the accepted case before/after parent-only changes while preserving emitted bytes. Exercise suboperations, Pass Through, density and source exclusion. Pixel and emitted-output evidence (local evidence: `evidence/stage-5/stage-5-report.md`), TR-019 criteria (local evidence: `evidence/stage-7/consolidated-findings.md`)

## TR-020 | P2 | Obsolete work and inline fallback each impair responsiveness

**QUEUE.** Real Edge changes followed by Sharp queue behind obsolete synchronous worker work. Sharp becomes ready 30,538.5 ms after selection and receives no started acknowledgement before its pre-start watchdog. This was a normal computed schedule, without injected worker failure. Retire or coalesce obsolete execution while preserving the latest result. On the accepted foreground fixture, target started within 1,000 ms of post and ready within 1,500 ms; capture full browser geometry-hash parity with a direct control. Measured queue (local evidence: `evidence/manager/stage-6-queue-timeline.json`)

**INLINE.** An explicit construction fault on the same expensive 192x192 Edge image activates the existing fallback and causes a 19,180.8 ms frame gap. The expensive computation is real; natural failure incidence is unmeasured. Qualify recovery and genuinely cooperative processing where fallback remains necessary. Target no attributable main-thread task or frame gap over 100 ms using interval overlap, with successful unchanged geometry or a truthful existing error/retry where that path already applies. Do not newly refuse this supported input. Fallback evidence (local evidence: `evidence/stage-6/browser-boundaries.json`)

**Close both mechanisms.** Targets are proposed local engineering criteria, not standards or measured fix performance. Preserve cold start, typed supersession, source-copy integrity, truthful errors and fresh-worker recovery. Recheck construction/runtime failures and existing pixel boundaries. An async wrapper is insufficient, and worker retirement alone does not close INLINE. Complete TR-020 criteria (local evidence: `evidence/stage-7/consolidated-findings.md`)

<!-- PAGE -->

# Coverage 1-8: Presets and brightness controls

Each row records an observed control or a specific limit. An empty defect entry means no confirmed finding for that row, not universal correctness. The complete evidence links and original row history are in the accepted coverage register (local evidence: `evidence/stage-7/coverage-reconciliation.md`).

## C01 | Preset: Line Art

**Findings:** TR-001, TR-002, TR-004, TR-005, TR-007, TR-011. Explicit masks, settings and binding controls; synthetic inputs only. Original image unavailable.

## C02 | Preset: Smooth

**Findings:** TR-001, TR-007, TR-011. Valid extremes and bounded geometry tested; no general artistic-quality conclusion.

## C03 | Preset: Sharp

**Findings:** TR-001, TR-007, TR-011. Fast native and repeated-output controls; synthetic inputs only.

## C04 | Preset: Centerline

**Findings:** TR-001, TR-008, TR-009, TR-010. Distance/topology and attachment controls; noisy 192x192 run censored at 30 seconds.

## C05 | Preset: Edge Detection

**Findings:** TR-002, TR-006, TR-007, TR-020. Control sweeps and latest-result recovery; outline help and worker responsiveness require repairs.

## C06 | Trace Cutoff

**Findings:** TR-001. Band endpoints tested; displayed versus effective mode requires repair.

## C07 | Trace Threshold

**Findings:** TR-001. Otsu/manual and inclusive/strict comparisons; not every value/image combination tested.

## C08 | Trace Ignore Less Than

**Findings:** TR-001, TR-005, TR-011. Ink and loop-area controls on identical grids; scale units and retained components need repairs.

<!-- PAGE -->

# Coverage 9-16: Finishing, alpha and preset history

Each row records an observed control or a specific limit. An empty defect entry means no confirmed finding for that row, not universal correctness. The complete evidence links and original row history are in the accepted coverage register (local evidence: `evidence/stage-7/coverage-reconciliation.md`).

## C09 | Trace Smoothness

**Findings:** TR-002, TR-007. Range and notch/corner controls; successful raw geometry does not certify finishing.

## C10 | Trace Optimize

**Findings:** TR-002, TR-007, TR-011. Tolerance and valid-extreme sweeps; zero does not disable all fitting.

## C11 | Trace Sensitivity

**Findings:** None confirmed. All 101 settings mapped to actual quantized deltas; measured output changes.

## C12 | Trace Detail

**Findings:** None confirmed. All 101 settings mapped to actual quantized radii; measured output changes.

## C13 | Trace Minimum line

**Findings:** None confirmed. Length/area distinctions and zero, maximum and ordinary values tested.

## C14 | Trace alpha mask: available, opaque, crop and Enhance

**Findings:** TR-003. Opaque fallback and alternate Enhance/RGB controls; cropped-source alpha intent needs repair.

## C15 | Force Sketch Trace and automatic Line Art promotion

**Findings:** TR-002, TR-004. Explicit/automatic, color and median controls; artistic sketch quality not generalized.

## C16 | Preset switch, hidden overrides, Reset trace settings

**Findings:** TR-001, TR-002. Reset and hidden-state round trips tested; full-App persisted history not exercised.

<!-- PAGE -->

# Coverage 17-24: Dialog actions and region selection

Each row records an observed control or a specific limit. An empty defect entry means no confirmed finding for that row, not universal correctness. The complete evidence links and original row history are in the accepted coverage register (local evidence: `evidence/stage-7/coverage-reconciliation.md`).

## C17 | Output selection and hidden fill-style state

**Findings:** None confirmed. Real dialog/commit vector-raster choice and conditional visibility; no saved-session reload.

## C18 | Fade Image

**Findings:** None confirmed. Rendered opacity changes observed in a bounded browser harness.

## C19 | Show Points

**Findings:** None confirmed. Rendered point markers toggled and sampled; not every vertex counted.

## C20 | Delete Image After trace, undo and source provenance

**Findings:** TR-013. Actual deletion and grouped undo; pending Escape still permits unwanted later mutation.

## C21 | Trace submit: ready reuse, early submit and empty result

**Findings:** TR-016. Prepared/full/crop/Enhance parity and truthful empty commit; empty early-preview state defective.

## C22 | Cancel, Escape, close/reopen, focus and file replacement

**Findings:** TR-013, TR-015. Decode/result ownership and reopen controls; Escape lifetime and conditional focus fail.

## C23 | Boundary drag and Clear Boundary

**Findings:** TR-015. Rendered selection and clearing; keyboard-only drawing is a source-documented gap.

## C24 | Crop region and source-to-working coordinates

**Findings:** TR-003. Grid conversion, placement and prepared/fallback parity; opaque ROI alpha intent defective.

<!-- PAGE -->

# Coverage 25-32: Entry flows and output choices

Each row records an observed control or a specific limit. An empty defect entry means no confirmed finding for that row, not universal correctness. The complete evidence links and original row history are in the accepted coverage register (local evidence: `evidence/stage-7/coverage-reconciliation.md`).

## C25 | Enhance region, full-image merge and border-crossing preservation

**Findings:** TR-003. Contained/crossing paths and metadata checked; alternate RGB-hole reproduction confirms TR-003.

## C26 | Raster file import and selected-image Tools/toolbar/context/palette routes

**Findings:** None confirmed. Command convergence and selected-image/paged flow; not every full-App menu or OS picker clicked.

## C27 | Image Studio Apply & Trace: inline and paged

**Findings:** TR-014. Inline edit and paged negative control; paged content still traces the original asset.

## C28 | Re-trace Original and kept/deleted source

**Findings:** None confirmed. Same-ID replacement, order, provenance and missing-source behavior; broader epoch cases unranked.

## C29 | Trace from camera

**Findings:** TR-012. Actual button and generated aligned source; commit fails. Physical capture/calibration unqualified.

## C30 | Multi-File Trace entry, decode, SVG export, cancellation and empty input

**Findings:** None confirmed. Three generated Files, names, canceled save and blank error; audit sink, not OS dialogs. Large batches unmeasured.

## C31 | Editable vectors: fresh operations and kept source

**Findings:** None confirmed. Five presets through actual store/commit and consumers; full-App save/reload unrun.

## C32 | Raster scan output: five presets, alpha, bitmap and effective settings

**Findings:** TR-019. Browser PNG/luma, compiler and encoded power agree; shaded-preview polarity is defective.

<!-- PAGE -->

# Coverage 33-40: Fill consumers, placement and workers

Each row records an observed control or a specific limit. An empty defect entry means no confirmed finding for that row, not universal correctness. The complete evidence links and original row history are in the accepted coverage register (local evidence: `evidence/stage-7/coverage-reconciliation.md`).

## C33 | Scanline fill

**Findings:** TR-018. Single-trace and binding controls with powered-region oracles; cross-object intent is ADR-029.

## C34 | Follow Shape fill

**Findings:** TR-007, TR-017, TR-018. Rectangle/seam and alternate region controls; offset counterfactual also bypassed cleanup/filtering.

## C35 | Island Fill

**Findings:** TR-018. Region, spacing and binding controls; finite spacing can miss narrow features.

## C36 | Physical placement, natural dimensions, rotation/reflection/unequal scaling

**Findings:** None confirmed. Placement, undo, SVG size and grid transforms tested; no skew or physical registration claim.

## C37 | CNC tracing: defaults, conditioning and compilation

**Findings:** TR-008. Single-chain fairing and physical-unit checks; TR-008 is incoming trace contact. Synthetic CNC contact issue unranked.

## C38 | Laser compiler, prepared preview, G-code and encoded power

**Findings:** TR-007, TR-017, TR-018, TR-019. 36 preview/output comparisons are within 83 Stage 5 audit tests; no controller streaming or material test.

## C39 | Worker lifecycle, debounce, supersession and latest-result recovery

**Findings:** TR-020/QUEUE. Actual debounce, typed supersession and recovery; development harness, not production startup qualification.

## C40 | Inline 160,000-pixel boundary, construction/runtime error and recovery

**Findings:** TR-020/INLINE. Existing pixel boundaries and recovery tested; injected construction fault exposes real 19.2-second inline freeze.

<!-- PAGE -->

# Coverage 41-45: Scale, serialization and qualification

Each row records an observed control or a specific limit. An empty defect entry means no confirmed finding for that row, not universal correctness. The complete evidence links and original row history are in the accepted coverage register (local evidence: `evidence/stage-7/coverage-reconciliation.md`).

## C41 | Decode cap and core native/upscaled/downscaled routes

**Findings:** TR-005, TR-009. 2048-edge decode and native/up/downscale routes; adjacent-size timings are not identical-pixel counterfactuals.

## C42 | API-only ImageTracerJS and hidden legacy options

**Findings:** None confirmed. Installed API call-through and bounded color execution; outside the five UI presets and no general fidelity claim.

## C43 | SVG serialization, canonical metadata and consumer expansion

**Findings:** None confirmed. Three profile/control hashes agree; SVG/JSON amplification measured. Worker clone cost not isolated.

## C44 | Full App, hosted CI, deployment, packaged runtime, reference CAM and hardware

**Findings:** None confirmed. All listed qualification lanes remain unrun. Component/source evidence does not certify them.

## C45 | Original 213501.jpg fidelity

**Findings:** None confirmed. Only the supplied screenshot is available; original pixels, dimensions and exact fidelity cannot be concluded.

The canonical findings ledger retains 20 stable parent IDs, exact source anchors and testable criteria. Later implementation status belongs in the remediation ledger, preserving this report as the audited before-state. Findings (local evidence: `evidence/stage-7/consolidated-findings.md`), source anchors (local evidence: `evidence/stage-7/source-anchors.json`), manager acceptance (local evidence: `evidence/manager/stage-7-acceptance.json`)
