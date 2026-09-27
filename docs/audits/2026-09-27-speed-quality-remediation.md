# Speed and quality remediation, 27 September 2026

The audit was reconciled against `c81504fcda188b71652f9fe32597d8c435c5bc54`, the
refreshed main branch at the start of this implementation. That version is newer
than the original audit checkout, `a37082457b76d56b8c9ba92be27db027b5a92cb0`.
Existing repairs were revalidated before further changes were made.

Implementation lives on `codex/speed-quality-remediation-20260927`, in the isolated
worktree `D:\LaserForge\speed-quality-remediation-20260927`. The original dirty
checkout was preserved. This document records software changes and their limits;
it does not identify these changes as deployed or physically qualified.

## What changed

- Dense vector Fill uses lossless modal spelling on the existing compatible
  dialects. The representative 20,000-burn file falls from 932,023 to 366,203 bytes
  (60.7 percent), with identical burn geometry, power, feed and line counts.
- FluidNC uses one acknowledged line at a time, following its upstream channel
  contract. Old saved profiles are normalized, and the active controller rule is
  enforced at the final streaming boundary.
- Scan quality advice uses compiled row spacing, represented feed, horizontal
  pixel pitch, and explicitly labelled saved acceleration/spot assumptions.
- CNC stages can retain separate cutter-bound feed, plunge, RPM and depth-pass
  values. The calculator shows nominal chipload after applicable feed limits.
  Surfacing exposes those cutting values and uses the selected cutter/material
  for its labelled starting values.
- Dense preparation is routed to workers earlier; the classifier has its own
  work budget. Preview and ETA reuse bounded emitted source, invisible vector
  artwork avoids repaint work, and paged-asset ownership checks are coalesced.
- CNC stage values compose with main's current relief raster, waterline and
  flat-finishing planners. These planners supersede the initial planar-link
  prototype, which was removed before publication. Its historical speed figures
  and cost filter do not describe the final planner.

The decisions and detailed contracts are in
[ADR-456](../decisions/ADR-456-fluidnc-acknowledged-line-streaming.md),
[ADR-457](../decisions/ADR-457-independent-cnc-stage-cutting-recipes.md),
[ADR-458](../decisions/ADR-458-scan-quality-advisories-use-output-geometry.md),
[ADR-459](../decisions/ADR-459-bounded-interactive-preparation-and-scene-work.md), and
[ADR-460](../decisions/ADR-460-lossless-fill-motion-compaction.md). The
[detailed CNC record](2026-09-27-cnc-speed-quality-remediation.md) includes the
stage contracts, current planner integration and historical prototype evidence.

## Every audit finding

| Finding | Disposition on the implementation baseline |
| --- | --- |
| LQ-01, transformed curve tolerance | Already repaired: physical-space flattening scales local tolerance by the largest absolute axis scale; CNC and laser share it. Curve/compiler tests revalidated. |
| LQ-02, native raster power units | Already repaired: fractional native power survives the compilation boundary; Smoothieware and Marlin transformations apply their power scales once. Existing public-output regressions revalidated. |
| LQ-03, minification fidelity | Already repaired for tone modes through shared area reduction, including streamed and rotated paths. Threshold keeps its documented centre sampling and warning to preserve its distinct semantics. |
| LQ-04, high-speed scan runways | Existing image/Fill overscan controls retained. New Job Review advice compares compiled feed with the saved acceleration model and available runway. No guessed acceleration or silent feed/power change. |
| LQ-05, dense Fill bandwidth | Fixed by exact modal compaction, with independent burn and motion-manifest equivalence, micro-detail, native/conservative dialect and every-line restart checks. |
| LQ-06, dot correction erasing detail | Existing content-aware Image Studio analysis retained; new cheap Job Review checks cover horizontal pitch, anisotropic images and coordinate-collapse risk without reading a streaming row provider. |
| LQ-07, energy assumptions and recipes | Existing frozen operation recipes revalidated. New advice uses compiled row density and represented feeds and distinguishes nominal optical spot from measured material burn width. Actual coupon results still require a machine. |
| LQ-08, travel/thermal ordering | Existing indexed inside-first/source-order/island ordering revalidated. Unmeasured thermal sequencing or generic 2-opt is not silently applied: it can change release order and heat exposure. These remain optional future algorithms rather than a demonstrated correctness defect. |
| C1, one-step peck dropped | Already repaired on main; drill/emitter regression retained. |
| C2, tool sections breaking global operation order | Already repaired on main; global clearing-before-profile and part-order regressions retained. |
| C3, finishing-only shallow relief | Already repaired on main; a missing roughing group does not remove finishing. |
| C4, scallop stride rounding upward | Already repaired: conservative row stride and finer compiler grid retained. This bounds the sampled model, not unmeasured surface finish. |
| C5, transformed CNC curve/cutter geometry | Already repaired through shared physical curve tolerance and machine-space relief compensation; revalidated with mirrored/nonuniform transform fixtures. |
| C6, chart versus programmed chipload | Fixed: separate chart starting value from the nominal chipload actually represented by the machine-aware feed/RPM. Physical chip thickness remains engagement-dependent. |
| C7, shared values across different stages | Fixed with optional, persisted cutter-bound stage recipes and explicit stage output/review provenance. Old projects keep their shared values. Separate values remain manual when material changes. |
| C8, redundant V finish after clearing | Already repaired by clearing-aware finishing and source-containment checks; retained. |
| C9, redundant relief retracts | Main's linked raster/roughing, waterline and flat-finishing planners (ADRs 421, 423 and 450) supersede the initial planar shortcut. Preserve those planners and stage values; remove the prototype and its private cost/prefix metadata. Historical prototype timing is not a final-planner speed claim. |
| C10, repeated diagnostic planning and missing evidence | Current compilation sidecars already carry actual relief/offset/stepover evidence. Fixed the remaining duplicate work in dropped-vector diagnostics by consuming compiled groups before collection or planning. |
| C11, shallow surfacing silently deepened | Core depth preservation already repaired on main. Added visible feed, plunge, RPM and stepdown controls with cutter/material starting values; tests follow these fields through saved output and its exact final depth. |
| APP-01, expensive fill classification | Bounded independently of compilation. A 90,000-vertex classifier fixture previously took 3,188.76 ms to count spans. The final classifier immediately returns an explicit unknown estimate and routes the unchanged job to a worker (seven samples, 0.005–0.036 ms). This avoids the count rather than speeding up full compilation. |
| APP-02, inconsistent routing/pass amplification | Existing shared routing retained; interactive vector threshold lowered to 20,000 estimated work units including passes/depth. Classification includes the sum of primary and independent CNC depth ladders. Scoped output and effective operation settings remain accounted for. |
| APP-03, repeated preparation/worker queues | Existing bounded latest-request worker queue, cancellation, exact Frame-to-Start artifact and no heavy synchronous failure fallback retained. Worker Preview and ETA share bounded emitted source; large/row-provider previews use the existing full route without optional re-emission. Complete Start strings/manifests remain proportional to job size. |
| APP-04, Inspector work on UI thread | Current main already receives heavy analysis from workers and uses shared routing. Relevant Inspector/preparation regressions retained. |
| BREADTH-01, startup delay | Existing removal of the artificial hold retained. Splash now waits for a successful workspace draw, with crash and timeout fallbacks. |
| BREADTH-02, obsolete trace work | Current main already retires superseded workers; existing cancellation/replacement behavior retained. |
| BREADTH-03, editor redraw cost | Conservative viewport rejection avoids resolving and painting offscreen vector artwork; bounds cache follows immutable geometry, and visible curves/selection/diagnostics remain available. This does not turn every editor operation into constant-time work. |
| BREADTH-04, ownership/history/autosave cost | Existing asynchronous durable autosave retained. Unchanged ownership graphs avoid rescans, immutable object lists are weakly cached, and transition drains coalesce with retry/race coverage. |
| Controller research gap, FluidNC flow control | Closed in software by the shared acknowledged-line contract, profile normalization and real-store synthetic transport test. Throughput qualification still depends on the actual controller/channel. |

## Family coverage and quality boundary

The changes follow shared capabilities and output dialects across the catalogue.
GRBL and grblHAL keep evidence-bounded buffered streaming. FluidNC, Marlin and
Smoothieware use acknowledged-line streaming. Conservative dialects and native
power adapters retain their own text/scale contracts. Ruida remains its existing
binary/file-export path; this work does not invent serial, galvo, industrial CNC,
or other hardware support. Machine-brand presets continue through their selected
shared controller/dialect contract.

No nominal maximum speed is promoted to a recommended quality setting. There is
no global feed increase, laser geometry simplification, reduced engraving resolution,
automatic power increase, or relaxation of the completed-Frame policy. A completed
Frame for the exact reviewed artifact remains the sole ordinary Start policy gate;
quality and configuration findings remain warnings.

The code cannot manufacture material measurements. Focus, burn width, kerf,
scan-direction offset, true acceleration, cutter runout, spindle power, chip
evacuation, workholding, and material variation still need controlled coupons or
cuts on each physical setup. Unknown fixtures and subcell relief detail are not
qualified by the sampled relief model. Main's relief path reduction permits up
to 0.002 mm extra stock relative to its unreduced sampled path; that allowance
is distinct from the lossless laser Fill text compaction.

## Initial implementation verification

The original SHA-256 manifest, `remediation-source-before-final-checks.json`,
covers 98 changed source and test files. Integration required four additional
test/snapshot corrections and hover explanations on two CNC controls in
`CncStageRecipeFields.tsx`. The latter change affects title text only; output,
transport, geometry and handler behavior remain unchanged. The final build and
CNC/production browser checks include it. The final 102-file manifest is
`remediation-source-final.json`. Documentation is recorded separately. At the end
of this initial verification, the candidate was local and uncommitted on the
branch above, based on `c81504fcda188b71652f9fe32597d8c435c5bc54`.

| Check | Result |
| --- | --- |
| Full repository unit suite | Completed in 2,070.31 seconds: 2,783 files passed, 14 skipped and 5 failed; 20,799 tests passed, 24 skipped and 6 failed. Every reported failure was corrected. |
| Final rerun of every failed file | All 22 tests across the 5 affected files passed together in 10.57 seconds, after the full run completed. There was no second complete-suite rerun. |
| Final output and snapshot integration | 57 tests across 5 files passed. Three shipped-pipeline snapshots were updated and reviewed: all 90 changed motion lines retain the same words and numeric values with compact spelling. |
| Browser startup | 5 cases passed, including successful draw, reduced motion, pending decorative artwork, root error and timeout fallback. |
| CNC browser workflow | Final edit, compile, Save As, reopen and disable-stage flow passed; no machine connection. Laptop layout inspected. |
| Production browser | Hashed production bundle, script-font editing and the packaged outline worker passed with no failed assets or page errors. |
| Type checking | Web TypeScript check in `pnpm build:web`, plus `pnpm typecheck:e2e`, passed. |
| Static checks | Full `pnpm lint` and `pnpm format:check` passed before the final test/help-text corrections; targeted checks cover those corrections. ADR uniqueness, file-size backstop, export-count ratchet and `git diff --check` passed. |
| Build | `pnpm build:web` and `pnpm build:electron-main` passed. The web build still reports chunks over 750 kB; no initial-bundle reduction or network-startup performance claim is made. |
| Independent reviews | Laser output/FluidNC contract, CNC sampled connector geometry, the final connector cost filter, and CNC stage persistence/Frame/recovery ownership reviewed. Findings were resolved before freeze. |

Earlier integration runs caught obsolete verbose-Fill assertions, three expected
Fill snapshots, the prior schema expectation, and lint complexity/formatting
issues. They were corrected. The initial whole-suite run was superseded after
the final CNC cost and stage-routing changes; it is not counted as a passing run.
Focused lane runs overlap and are not added together as a distinct-test total.

The integrated run then exposed two further power-mode test assertions whose
word-boundary expressions could not read compact words, one additional expected
Fill snapshot, and an existing tool-change test-device race. The power-mode
oracle now reads G-code words and tracks modal motion; the additional snapshot's
10 motion lines change only spelling. The simulated device now repeats its last
Alarm/Idle status on polling instead of inventing Idle during Alarm. Forced polls
before unlock and after its acknowledgement reproduce and cover that race. No
production behavior was changed to accommodate these tests. These three files
passed together in the final focused run: 15 tests in 14.57 seconds. A separate
whole-UI hover audit identified two missing CNC stage-control explanations; those
were added, and that audit passed. The rebuilt web app, CNC edit/save/reopen flow,
and production-bundle browser smoke then passed again.

The last failure was the old new-project expectation of schema version 10. It
now explicitly expects version 11, which persists the optional CNC stage recipes.
The new-project and stage-migration checks passed together (13 tests), including
compatibility with version 10 input. The final five-file rerun above covers every
failure reported by the completed full suite; none remains unresolved. Its log
is `remediation-failed-files-final-rerun.log`. The original full-run log retains
its failed result instead of being relabelled as a clean run.

| Paired software evidence | Result and practical limit |
| --- | --- |
| Dense Fill, 20,000 burns | 932,023 to 366,203 bytes, 60.7% less; all burns and the complete motion manifest preserved. Text line count stays 40,210. This is not a physical cycle-time measurement. |
| Classifier, 90,000-vertex circle | Previous full estimate: 3,188.76 ms. Final bounded estimate: explicit unknown in 0.005–0.036 ms, followed by worker routing. These tiny timer observations are not a general speed multiplier. |
| Historical superseded relief prototype, F1000/plunge200 | 21 original rows preserved; safe-Z commands 22 to 9; software estimate 63.561 to 36.271 seconds. This removed prototype does not establish current-planner performance. |
| Historical superseded relief prototype, F100/plunge1000 | Its cost filter retained the original entries and 138.870-second estimate. That filter is not part of the final planner. |
| Original laser quality probes | Enlarged 100 mm cubic maximum emitted error 0.0186805 mm; opposite-phase checkerboards both retain mean luma 128; Smoothieware native S ranges 1, 100 and 1000 preserve the tested 30/50/100% levels. These revalidate existing baseline repairs. |

Focused evidence, logs, independent reviews and paired benchmark scripts are stored in
`D:\LaserForge\audits\2026-09-27-speed-quality` alongside the original report.
The benchmarks are host-specific software measurements, not material or controller
runtime promises. This initial verification did not include publication or
hardware operation. The later publication follow-through integrates main's
V-carve geometry reuse (`c75ba261e`, ADR-444), the current relief planners from
PR #939, and renumbers this remediation's
decisions to ADR-456 through ADR-460. It preserves both the upstream geometry
cache and independent stage settings while removing superseded prototype links.
The V-carve integration selection passed 61 tests across 12 files (one existing
benchmark skipped); relief reconciliation passed 149 distinct tests across
13 files, including stage values with X/Y raster, waterlines and flat finishing.
Exact release checks, PR/main/deploy
identities, and served-build evidence are recorded separately in the audit
directory. The user confirmed that no physical machine was available, so material
qualification remains not run; the accompanying trial pack records that limit.
