# KerfDesk machining path efficiency and quality audit

Follow-up: [machining stress tests](2026-10-13-machining-stress/README.md) passed
937 existing tests and exposed a reproducible planning-time limit with 50,000
coincident paths. The report retains the timeout cases separately from passes.

KerfDesk already reduces unnecessary motion and protects important machining
dependencies, but it does not yet choose the minimum-time path across supported
machines. Reproducible examples show avoidable laser travel, CNC travel and tool
changes without changing the programmed cuts. Its timing model also loses axis
limits and communication latency, so estimated time alone cannot currently
establish which candidate will finish fastest on a particular machine.

The target is the shortest complete job that meets the required dimensions,
surface finish and process constraints. Increasing feed, removing finishing
passes or relaxing geometric tolerances is not a substitute for that target.
Identical programmed cuts do not prove identical material results: changing order
can change heat accumulation, workholding and chip evacuation.

Audited on 13 October 2026 at `c700863a14dfbed71a49e32182ec3b75b989ebb1`,
the fetched `origin/main`. Branch: `codex/quality-first-path-audit`.
This audit adds three reproducible probes and corrects an unsupported source
comment. Production machining behaviour, profiles and controller settings are
unchanged. There was no hardware operation, deployment or publication.

## Findings and priority

| Priority | Finding | Consequence | Recommended change |
| --- | --- | --- | --- |
| 1 | Timing uses scalar motion limits and omits acknowledgement latency | Candidate rankings can be wrong for asymmetric axes, slow Z and dense streamed jobs | Preserve per-axis limits and qualify transport/planner timing before using ETA to choose routes |
| 1 | Relief raster spacing alone does not bound finish on steep slopes | A requested flat scallop does not guarantee that surface quality everywhere | Evaluate slope and cutter contact; use the existing raster plus waterline strategy where appropriate |
| 2 | Laser ordering is greedy and restarts its planning seed across groups | Extra rapid travel, even with only a few contours | Carry the actual exit into subsequent route evaluation and compare bounded alternative orders, including the finish position |
| 2 | CNC retains source-part order | Independent parts can cause repeated bed crossings | Add an explicit CNC option to reorder independent complete part packets while retaining machining dependencies |
| 2 | Tool scheduling restarts at the clearing/profile phase boundary | An already-loaded tool may be changed away and then loaded again | Prefer the loaded tool among eligible next sections without breaking phase or stage dependencies |
| 3 | Fill gap splitting and strategy choices use fixed heuristics | Shortest path or highest requested feed may not yield shortest time | Compare legal scan/strategy candidates using calibrated timing and fixed quality constraints |

The ordering findings are capability limitations, not proof of corrupt output.
ADR-163 explicitly defines a greedy laser planner. CNC source order is deliberate
under ADR-270/276, with clearing and profile dependencies retained. These policies
need an explicit design change and regression evidence before replacement.

## Reproducible route measurements

All figures below are synthetic emitted-program estimates. They include the
program's travel and return moves; they are not measured machine cycle times or
expected percentages for arbitrary customer jobs.

| Fixture | Current total estimate | Comparison total | Estimated reduction | Cut equivalence |
| --- | ---: | ---: | ---: | --- |
| Laser, two groups with the first ending near the far side | 31.426 s | 24.230 s | 22.9% | Same group order, cut geometry, direction, power, feed and passes |
| Laser, six separate 1 mm squares | 7.490 s | 6.715 s | 10.3% | Same starts, directions and square outlines |
| CNC, ten separate 5 mm profiles | 112.392 s | 67.014 s | 40.4% | Same 200 mm of lateral cutting, depths, feed and spindle commands |
| CNC, two tools across clearing and profiling | 35.845 s | 31.064 s | 13.3% | Same 80 mm of cutting; clearing remains before profiling |

The laser two-group example reduces emitted rapid distance from 1110.003 to
392.074 mm by reversing only the order of the second group's two cuts. The
six-square example exhaustively compares all 720 fixed-entry permutations;
rapid distance falls from 415.413 to 337.930 mm. This disproves the former source
comment that small jobs are effectively optimal. The exhaustive result concerns
this small distance problem, not universal minimum cycle time.

The CNC profile example retains the current compiler and changes only the input
order of disjoint part contours. Emitted rapid XY distance falls from 3588.325
to 1321.671 mm. It uses one depth pass, no tabs and on-path profiles; it does not
qualify arbitrary nested, multi-depth or tabbed work for reordering.

The tool example currently emits `A pocket, B pocket, A profile, B profile`.
For these independent parts, `A pocket, B pocket, B profile, A profile` retains
clearing-first order and reduces emitted tool-change holds from three to two.
The estimates exclude the operator's manual tool-change and zeroing time, so
there is no assumed duration attached to that saved tool change.

Run from the repository:

```powershell
node scripts/audit-quality-first-laser-paths.mjs
node scripts/audit-quality-first-cnc-paths.mjs
node scripts/audit-quality-first-timing.mjs
```

The laser probe asserts equal segment and emitted cutting-command multisets.
The CNC probe compares a digest of emitted lateral-cut endpoints, depths, feeds
and spindle values. These checks establish programmed cut equivalence for the
fixtures, not physical quality equivalence.

Source anchors: [laser group orchestration](../../src/core/job/optimize-paths.ts),
[greedy segment ordering](../../src/core/job/segment-order.ts),
[CNC part ordering](../../src/core/cnc/profile-ordering.ts), and
[tool sections](../../src/core/cnc/cnc-tool-sections.ts).

## Timing must account for the machine

The GRBL settings importer reduces XY rates to their maximum and XY acceleration
to their minimum. The timing planner then uses scalar limits for XYZ. Captured
Z rate and acceleration do not become independent timing constraints.

| Hypothetical machine move | Current scalar estimate | Independent axis-limited calculation |
| --- | ---: | ---: |
| Y 100 mm, X maximum 10000 and Y maximum 1000 mm/min, acceleration 500 mm/s² | 0.933 s | 6.033 s |
| Z 20 mm, scalar 10000 mm/min and 500 mm/s², actual Z 600 mm/min and 50 mm/s² | 0.400 s | 2.200 s |

The independent calculations use acceleration, cruise and deceleration from
rest. The real controller still enforces its own limits: this is an ETA defect,
not evidence that output overrides a controller's axis limits. GRBL's planner
projects each axis limit onto the move direction, which the app's clock should
also represent. [GRBL planner source](https://github.com/gnea/grbl/blob/master/grbl/planner.c)

Serial timing includes an 8N1 byte-transmission floor but not acknowledgement
latency, effective receive window or streaming mode. A 1000-move, 0.001 mm per
move fixture estimates 1.392 seconds at 115200 baud. If a ping-pong link takes
16 ms from each write to its acknowledgement, dispatching the last move alone
takes at least 16 seconds. The 16 ms value is an illustrative assumption; no
machine latency was measured.

Family-default planner capacities also replace session-observed capacities in
the ETA. Keep offline defaults, but use qualified live evidence when present and
disclose uncertainty when it is absent. Multiplying all time by a calibration
factor cannot fully correct direction-dependent limits or per-command latency.

Source anchors: [settings import](../../src/core/controllers/grbl/parse-settings.ts),
[motion blocks](../../src/core/gcode-time/segment-blocks.ts),
[transport clock](../../src/core/gcode-time/program-transport-time.ts), and
[timing options](../../src/core/gcode-time/program-timing-options.ts).

## Quality constraints that optimisation must preserve

Laser output already has active-row skipping, cropped active spans, serpentine
scanning, bounded shared runways, optional acceleration-based overscan and
lossless command compaction. Keep scan-offset compensation, requested line
interval, powered coverage, power and feed, pass counts, start preferences,
inside-first order, tabs and operation boundaries. Assess heat-sensitive order
changes with material trials. Longer acceleration runways can make higher
engraving speeds take longer overall. [LightBurn overscanning](https://docs.lightburnsoftware.com/2.0/Explainers/Overscanning/)

CNC already retains clearing-before-profile order, inner-before-outer machining,
independent stage recipes, bounded ramp/plunge entries, holding tabs, guarded
pocket stay-down links, clearing-aware V finishing and relief contact checks.
Keep these. In particular, do not reverse a climb/conventional pass merely to
enter it from a nearer end, omit a finish pass, or connect across uncut stock
without proving cutter clearance and engagement.

The feeds calculator supplies starting values from material, cutter diameter,
flute count and RPM; it does not solve a global optimum using machine stiffness,
stick-out, runout, chip evacuation and changing engagement. High-efficiency
milling depends on controlled radial engagement and chip thickness, not a
blanket feed increase. [Harvey Performance milling guidance](https://www.harveyperformance.com/in-the-loupe/intro-high-efficiency-milling/)

For reliefs, the default heightfield strategy is raster; STL defaults to raster
plus waterline. A 3.175 mm ball with requested 0.025 mm scallop yields about
0.561249 mm row spacing. On an ideal plane with a 60° slope across those rows,
the same spacing gives about 0.102523 mm surface-normal cusp in the independent
sphere/plane calculation. This is a known raster-only boundary, not an emitted
removal simulation or measured finish. The existing hybrid strategy addresses
steep regions; strategy selection and verification matter more than increasing
stepover. [Relief strategy](../../src/core/relief/relief-finishing-strategy.ts)

Relief path reduction also allows up to 0.002 mm extra stock relative to the
unreduced sampled path. That is an existing bounded geometric approximation,
not lossless simplification or a guarantee of measured surface roughness.
Do not relax it for speed under this requirement.
[Relief reduction](../../src/core/relief/relief-finishing-path.ts)

## Coverage across controller families

| Family | Current relevant route and transport | Audit consequence |
| --- | --- | --- |
| GRBL 1.1 | Laser and CNC; capacity-bounded character-counted streaming available | Use actual axis limits and preserve receive accounting |
| grblHAL | Laser and CNC; larger bounded receive windows | Use reported capacity and planner evidence instead of assuming all boards match defaults |
| FluidNC | Laser and CNC; required ping-pong streaming | Include acknowledgement/transport cost in dense-job timing |
| Marlin | Supported laser dialects; ping-pong streaming | Preserve dialect-specific power behaviour; do not apply GRBL-only optimisations blindly |
| Smoothieware | Supported laser output; ping-pong streaming | Preserve its motion-linked power and output units |
| Ruida | Laser binary job export; controller executes the file | Serial G-code transmission cost is not its machining-time model; CNC remains unsupported |

Equal priority means checking each supported family's real capabilities, rather
than assuming one protocol or machining mode works everywhere. GRBL itself
documents the performance advantage and acknowledgement accounting required for
character-counted streaming. [GRBL interface](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Interface)
Its M3/M4/M5 state changes also impose stops. Existing hard-off travel boundaries
must not be removed as a generic speed optimisation.
[GRBL laser mode](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Laser-Mode)
Marlin inline power has different configuration-dependent behaviour.
[Marlin M3 documentation](https://marlinfw.org/docs/gcode/M003.html)

## Implementation sequence and acceptance

1. Correct machine timing: optional per-axis rates and acceleration, scalar
   legacy fallback, direction-dependent limits, qualified planner capacity and
   transport evidence. Keep generated motion unchanged during this phase.
2. Add bounded route candidate comparisons. Include the preceding exit, final
   return, acceleration, controller stops, Z entries and tool changes. Retain
   the original as a candidate; never discard source-order or start preferences.
3. Add CNC packet eligibility explicitly. Move an entire independent part/stage
   only when containment, clearing, tooling, finish and workholding dependencies
   allow it. Prefer the loaded tool only among eligible sections.
4. Improve strategy selection under fixed quality targets: island versus whole
   fill, scan direction, pocket/adaptive candidates and slope-aware relief
   finishing. State when available evidence cannot distinguish candidates.
5. Qualify representative machine/material pairs with paired physical trials.
   Compare total elapsed time including tool changes and rework, dimensions,
   edge condition, burn/kerf, surface texture, chatter and tool condition. Accept
   a faster recipe only when it meets the same quality criteria.

No new Frame, Start, licence or output gates are proposed. A completed Frame for
the unchanged footprint and placement remains the ordinary Start policy gate;
each Start claims its current exact executable program.

## Verification

Fresh focused checks passed: 23 test files and 190 tests across laser ordering,
overscan, fill/raster compaction, CNC part/tool order, stay-down links, relief
strategy/contact, transport starvation/backpressure, motion timing and the
GRBL, Marlin, Smoothieware and Ruida output paths. All three audit probes ran
successfully. Formatting, script lint and diff checks are recorded with this
audit change. No full release, browser, native-app, air-cut or material-cut
qualification is implied by these focused software checks.

The test cohorts were:

- Laser, 68 tests: `optimize-paths`, `automatic-overscan`, `fill-sweep-plan`,
  `emit-raster-bounded-split`, `emit-raster-compaction`,
  `grbl-fill-compaction-resume`.
- CNC, 40 tests: `profile-ordering`, `cnc-tool-sections`,
  `pocket-stay-down-links`, `relief-finishing-strategy`, `relief-air-floor-proof`.
- Timing and transport, 36 tests: `streamer-planner-starvation`,
  `streamer-planner-backpressure`, `program-planner-window`,
  `program-transport-time`, `program-time-3d`, `controller-streaming-mode`.
- Output families, 46 tests: `smoothieware-raster-power`, `marlin-raster-power`,
  `marlin-fan-raster`, `grbl-strategy-raster-calibration`, `emit-rd`,
  `emit-rd-cnc-refusal`.

Each name identifies its `.test.ts` file under `src`; the cohorts were run with
Vitest. The three audit scripts passed ESLint and Prettier; the comment-only
source change passed Prettier, and `git diff --check` passed.
