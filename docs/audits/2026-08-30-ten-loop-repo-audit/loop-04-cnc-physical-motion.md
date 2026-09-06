# Loop 4 — CNC physical motion, CAM completeness, and preview fidelity

Status: complete

Audited tree: `claude/vcarve-stamp-subcell` at `9209fcb33f4807ebfc1f7a55780069b6a7b0e23c`, including the inherited working-tree changes.

## Audit design

This loop used a physical-motion hazard audit. Instead of treating CAM data structures as the result, auditors reconstructed the emitted motion phases — tool section, retract, XY rapid, plunge or helix, cutting motion, tool change, and park — and compared that sequence with the requested operation and the preview/removal model. Metamorphic probes varied tool ownership, emit precision, helix revolutions, tool diameter, stepover, and planner termination.

The primary and blind auditors worked independently. The adversarial verifier reran the decisive production functions and narrowed the five-candidate packet to four implementation defects plus one explicit no-partial-output contract conflict. No machine was operated.

## Research and verification base

Repository authorities:

- `PROJECT.md:346-370`, especially the no-partial-output contract
- `WORKFLOW.md:2449-2452` and the CNC compiler/emitter comments that promise clearing before profiles
- current CNC compiler, offset planner, tool-section orderer, preview/removal, emitter, preflight, and focused tests cited per finding

External primary sources:

- Official Grbl, [`gcode.h`](https://github.com/gnea/grbl/blob/master/grbl/gcode.h) and [`gcode.c`](https://github.com/gnea/grbl/blob/master/grbl/gcode.c): G0/G1/G2/G3 motion modes, G17/G54/G90/G94 modal groups, M0 program pause, and X/Y/Z/I/J/F/S word parsing.
- Official Grbl, [commands](https://github.com/gnea/grbl/blob/master/doc/markdown/commands.md): the active modal-state contract used to check the generated preamble and transitions.
- LinuxCNC, [G-code quick reference](https://linuxcnc.org/docs/html/gcode.html): G0 rapid, G1 linear, G2/G3 arc, and G4 dwell semantics.

These sources establish what the emitted bytes mean; they do not establish physical controller timing, cutter load, stock removal, or dimensional accuracy.

## Focused executable checks

The broad CNC compiler/emitter/preflight sample passed 15 files and 135 tests (exit 0), covering compile order, automatic/manual tabs, retract passes, V-carve clearance and fine detail, relief finishing, rest-pocket ladders, surfacing, GRBL output, pass spans, tool geometry, and prepared-output integrity.

The cross-seam sample passed 5 files and 45 tests (exit 0):

```text
pnpm vitest run src/core/cnc/cnc-multi-tool.test.ts src/core/job/toolpath-cnc.test.ts src/ui/laser/cnc-offset-ladder-warnings.test.ts src/core/cnc/vcarve-ladder-thin-detail.test.ts src/core/cnc/rest-pocket-offset-ladder.test.ts
```

The adversarial verifier's independent five-file sample passed 84 tests (exit 0) across multi-tool order, CNC toolpath preview, GRBL output, offset ladders, and CNC preflight. Passing tests establish current expectations; the exact relations below are absent from their generators.

## Independent semantic probes

All coordinating probes loaded current production modules in memory and exited 0.

Tool-section order:

```json
{"input":["A-clear","B-clear","A-profile","B-profile"],"output":["A-clear","A-profile","B-clear","B-profile"]}
```

Full project, tiny imported-SVG engrave `(1,1) → (1.0004,1.0004)`, depth 2 mm:

```json
{
  "preflight":{"ok":true,"issues":[]},
  "motion":["G0 X1.000 Y399.000","G1 Z-2.000 F300"]
}
```

There is no emitted XY `G1` for that operation.

Two-revolution helix:

```text
emitted: G3 ... Z-1.000; G3 ... Z-2.000; then final-depth contour
preview: one sampled circle plus contour, z={from:0,to:-2}, zs=null
```

Pocket cap fixture — 100×100 mm closed square, 0.1 mm end mill, 10% stepover:

```json
{
  "groups":1,
  "passes":4096,
  "diagnostics":[],
  "gcodeLines":32788,
  "gcodeBytes":639379,
  "innermostRing":{"minX":41,"maxX":59,"minY":41,"maxY":59}
}
```

The 0.05 mm cutter radius therefore leaves approximately a 17.9×17.9 mm centre region unvisited.

## Reconciled findings

### L4-01 — tool bucketing can move a profile ahead of remaining clearing work

- State: **Confirmed — independently reproduced and verifier-retained**
- Severity: **P1**
- Trigger: at least two tools each own both clearing and profile operations.
- Mechanism: `src/core/cnc/compile-cnc-job.ts:62-121` constructs all clearing groups before all profile groups. `src/core/cnc/cnc-tool-sections.ts:15-36` then buckets every group by tool and flattens each whole bucket. When every section contains a profile, stable section order no longer preserves the global phase boundary.
- Reproduction: `A-clear, B-clear, A-profile, B-profile` became `A-clear, A-profile, B-clear, B-profile` in the production orderer and emitted group comments.
- Contract conflict: `WORKFLOW.md:2449-2452` and `compile-cnc-job.ts:3-7` promise that pockets/engraves run before profiles so released parts are not machined later.
- Coverage gap: `src/core/cnc/cnc-multi-tool.test.ts:117-139` gives only one tool section a profile.
- Impact: one tool can release a part before another tool performs its remaining pocket, engrave, or other clearing work.

### L4-02 — helical output and preview/removal model different routes and depth histories

- State: **Confirmed — independently reproduced and verifier-retained**
- Severity: **P2**
- Trigger: a helical-contour pass contains more than one revolution.
- Mechanism: `src/core/output/cnc-grbl-helical.ts:15-43` emits one full descending G2/G3 block per revolution. `src/core/job/job.ts:175-187` and `src/core/job/toolpath-cnc.ts:167-180` represent only one sampled circle followed by the contour, while attaching the all-revolution length and a single endpoint Z span with no vertex Z values. `src/core/sim/stamp-toolpath.ts:121-152` spreads that depth span over the unrelated represented polyline.
- Reproduction: a two-revolution pass emitted two complete descending arcs and then a constant-depth contour. The preview contained one circle plus the contour and `zs: null`; its removal model therefore continued changing depth across the link/contour rather than reaching final depth at the end of the second arc.
- Runtime reach: `src/ui/workspace/draw-preview.ts:231-269` builds the returned canvas/removal toolpath from this legacy representation. Exact-plan parity can flag it but does not substitute a corrected route.
- Coverage gap: `src/core/job/toolpath-cnc.test.ts:119-140` checks only total length and endpoint Z span, not route/revolution/Z parity.
- Impact: emitted machine motion is correct for the tested helix, but 2D route, scrubber timing allocation, 3D removal, and depth evidence can misrepresent what the tool will do.

### L4-03 — emit-precision collapse turns a tiny engrave into a stationary full-depth plunge

- State: **Confirmed — full scene-to-preflight reproduction and verifier-retained**
- Severity: **P1**
- Trigger: an otherwise valid CNC contour has at least two points whose XY coordinates become identical at the emitter's 0.001 mm precision.
- Mechanism: `src/core/cnc/collect-cnc-contours.ts:55-80` and `src/core/cnc/compile-cnc-job.ts:354-360` accept the finite two-point engrave. `src/core/output/cnc-grbl-emit-head.ts:6-18` formats at three decimals. `src/core/output/cnc-grbl-strategy.ts:281-311` positions and plunges before `:431-444` discovers that every XY cut move is zero-length and skips it.
- Reproduction: the real project emitted `G0 X1.000 Y399.000` and `G1 Z-2.000 F300`, no XY cut, with `{ ok: true, issues: [] }`.
- Preflight gap: `src/core/preflight/cnc-preflight.ts:112-120` treats any `G1` as nonempty, so the plunge alone satisfies it.
- Coverage gap: emitter tests cover fewer than two path3d points, not a contour that collapses only after formatting.
- Impact: the requested engrave is missing and the cutter instead performs a stationary 2 mm plunge.

### L4-04 — capped concentric Pocket output loses its completion state and silently leaves a centre core

- State: **Confirmed Pocket defect; Relief sibling source-confirmed but runtime-unqualified**
- Severity: **P1**
- Trigger: a valid Pocket needs more than 4,096 concentric offsets, reachable with a 100×100 mm pocket, accepted 0.1 mm cutter, and 10% stepover.
- Mechanism: `src/core/geometry/offset-ladder.ts:17-29,42-54` reports `capped: true` when the final permitted step still has geometry. `src/core/cnc/pocket-paths.ts:34-40,54-71` exposes only `offsetFailed` and discards `ladder.capped`; its deepest-core completion path also declines when all 4,096 slots were used (`:81-90`). `src/core/cnc/cnc-offset-ladder-diagnostics.ts:132-152` consequently tests only engine failure.
- Reproduction: compilation emitted 4,096 passes and 639,379 bytes with no diagnostic. The innermost cutter-centre ring was an 18 mm square, leaving approximately a 17.9 mm square core outside the 0.05 mm cutter radius.
- Impact: a normal-looking, fully emitted Pocket under-clears the requested region without even the pass-limit warning used by other CNC planners.
- Source-only sibling: `src/core/relief/relief-roughing.ts:30,41-47,110-131` drops the same shared `capped` state per waterline level, and `src/core/cnc/compile-cnc-relief.ts:203-212` observes only `offsetFailed`. A bounded Relief runtime fixture did not complete, so reachability and severity are not claimed separately.

### L4-05 — detected rest/V-carve planner exhaustion still produces executable partial machining

- State: **Confirmed contract conflict; not silent and not a separate hidden mechanism**
- Severity: **P1**
- Trigger: a rest-machining or V-carve ladder hits an offset failure, ring budget, emitted-profile precision limit, or thin-detail limit while usable requested geometry remains.
- Mechanism: `src/core/cnc/rest-pocket.ts:120-154` and `src/core/cnc/vcarve-ladder.ts:149-180,218-223` retain already-generated paths and mark incomplete completion. `src/core/cnc/cnc-offset-ladder-diagnostics.ts:61-91,158-181` detects the condition; `src/ui/laser/cnc-offset-ladder-warnings.ts:47-75` explicitly says generated passes still cut while requested material/detail remains.
- Reproduction: a valid 1-degree V-bit, 2 mm square, and 0.05 mm depth produced `passLimited: true`, 499 passes, 3,514 G-code lines, and CNC preflight `{ ok: true, issues: [] }`.
- Narrow disposition: the condition is not silent; Job Review warns correctly. It nevertheless conflicts with `PROJECT.md:364-366`, which states that a pipeline failure or partial result writes no file and sends no stream.
- Guard-law boundary: this audit does not propose a new policy guard. It records a compile-integrity/contract conflict and preserves the standing rule that any product response requires maintainer adjudication.

## Correctly rejected CNC candidates

- Ordinary preamble, retract, spindle-start, tool-change, and final-park ordering held: no spindle-before-clearance, rapid plunge, or missing final retract was reproduced.
- The core surfacing minimum that maps a direct 0.010 mm request to 0.050 mm is not reachable through the sole production panel, whose Total depth input clamps to at least 0.1 mm.
- Open paths are outside the closed-region V-carve contract; the correct open-centreline operation is Engrave/on-path. The current dirty tree also carries an explicit V-carve open-path note.
- Offset-engine failure is not generally silent; existing Pocket/V-carve/rest diagnostics propagate it. L4-04 is specifically the lost budget-exhaustion state.

## Limitations

- The audited branch is 209 commits behind and 36 commits ahead of the then-local `origin/main`; findings describe the exact dirty working tree.
- No controller received these programs, no spindle or cutter moved, no stock was cut, and no physical dimensions or surface finish were measured.
- The helix finding is a preview/removal mismatch, not evidence that the tested emitted helix is wrong.
- Relief cap reachability remains source-only; no separate Relief finding is counted.
- No source fix was implemented.

## Loop decision

Loop 4 closes with four canonical implementation findings and one explicit partial-output contract conflict. The direct machine-output priorities are the multi-tool phase inversion, plunge-only precision collapse, and silent Pocket centre core; the helix defect affects preview/removal evidence. Loop 5 starts the controller/transport state-machine audit.
