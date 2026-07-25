# CNC trace-preset chatter audit — why Smooth cut clean and the others didn't

2026-07-25 · measured on the real trace pipeline at `main` ancestry `9e237552` ·
instrument: temporary vitest spec (not retained), 6 deterministic fixtures × 5
presets · scale: verified app default **0.1 mm/px** (254 DPI,
`src/ui/common/image-import.ts`)

> **Status.** The preferred fix shipped the same day as **ADR-260 / PR #422**
> (`main` squash `53cea2c2`): CNC trace commits are refaired in physical units
> (`fairToolpathPolylines`, `src/core/geometry/fair-toolpath-polylines.ts`;
> policy in `src/ui/trace/cnc-trace-fairing.ts`). End-to-end verification is at
> the bottom of this document. **No hardware verification exists** — the
> maintainer has no machine available as of 2026-07-25; the coupon protocol in
> the candidate-fixes section is the acceptance test for whenever one exists.

## Executive answer

Smooth does not cut cleaner because of its wobble flattener — **Line Art runs
the exact same flattener at the exact same strength**
(`flattenStrengthFromSmoothness`: Line Art `smoothness: 1` → 1.0; Smooth unset
→ default 1 → 1.0; `contour-trace.ts`). The measured difference is in **how
many direction changes per millimetre each preset leaves in the final
polyline, and how sharp they are** — controlled by the simplify tolerance and
what the output resampler is allowed to even out:

| Knob | Line Art | Smooth | Sharp | Effect |
| --- | --- | --- | --- | --- |
| `lineTolerance` → DP ε (`0.45 × tol` px) | 0.45 px | **0.90 px** | 0.225 px | ε is also the spline's deviation cap (`curve-refine.ts`): the resample "may smooth within ε of each chord but must not bow further". Half the ε = half the permission to remove quantization facets. |
| Wobble flattener + arc evening | ON (1.0) | ON (1.0) | **OFF (0.0)** — `0.55 → max(0, 6s−5) = 0` | Only separates Sharp. Straight runs only; arcs are deliberately protected by its side-balance/model gates, so it never fixes curved-boundary jitter for anyone. |
| Pre-threshold cleanup | none (fixed 0–128 band) | blur r1/Δ20 + auto-median + despeckle 24 | none, despeckle 4 | Fewer boundary defects reach the tracer at all on Smooth. |

Every final trace vertex becomes one G1 endpoint — traced "curves" are line
segments (`polylineToCurveSubpath`, `curve-path.ts`), and the CNC compiler
consumes them verbatim (`motion-polish.ts` reverses/rotates/ramps, never
resamples XY).

## The measurements (px units; ÷10 for mm at default import scale)

Fixtures: `stem-rough` (jittered straight bar), `disc-crisp` (clean circle
r=100), `disc-rough` (±0.45px edge noise), `disc-aa` (antialiased circle),
`ring-stroke` (drawn 3px circle outline), `disc-small` (r=15). Key columns:
mean/p05 segment length, p95 turn angle at a vertex, turns ≥15° per 100
vertices.

```
fixture     preset          loops verts  meanSeg p05Seg fr<1px p95Turn t≥15/100 t≥45/100
stem-rough  Line Art          1     21   28.57   0.29   0.14   90.0    15.0     15.0
stem-rough  Smooth            1     21   28.57   0.29   0.14   90.0    15.0     15.0
stem-rough  Sharp             1     21   28.57   0.29   0.14   90.0    15.0     15.0
stem-rough  Centerline        1      2  260.33 260.33   0.00    0.0     0.0      0.0
disc-crisp  Line Art          1    193    3.27   0.23   0.17   22.3     9.9      0.0
disc-crisp  Smooth            1    129    4.89   4.16   0.01    3.9     0.0      0.0
disc-crisp  Sharp             1    485    1.30   0.40   0.65   10.4     0.0      0.0
disc-rough  Line Art          1    121    5.22   0.56   0.10   15.0     5.0      0.0
disc-rough  Smooth            1    165    3.85   0.50   0.16   20.8     9.8      0.0
disc-rough  Sharp             1    841    0.77   0.18   0.81   25.8    14.3      1.4
disc-rough  Centerline        6    186    3.18   0.32   0.27   29.2     9.2      5.2
disc-aa     LineArt/Smooth/   1   ~460    1.36   1.3    0.00    0.9     0.0      0.0
            Sharp (identical class)
ring-stroke Line Art          2   2032    0.63   0.40   1.00   17.9    14.7     0.0
ring-stroke Smooth            2   2066    0.62   0.39   1.00   19.7    21.8     0.0
ring-stroke Sharp             2    874    1.44   0.54   0.61   11.1     0.0      0.0
ring-stroke Centerline        1    165    3.81   2.07   0.01    3.9     0.0      0.0
ring-stroke Edge Detection    2   2043    0.63   0.35   1.00   17.1     7.7      0.0
disc-small  Line Art          1     65    1.47   1.00   0.05    7.5     0.0      0.0
disc-small  Smooth            1     49    1.94   1.43   0.02   10.5     0.0      0.0
```

(Edge Detection is byte-identical to Line Art on binary sources — shared
finisher, same ε — rows elided where equal.)

### What the numbers say, per preset

- **Smooth (clean filled art — the winning case):** on `disc-crisp` it emits
  **zero vertices turning ≥15°** (p95 turn 3.9°), minimum segment 0.42 mm. The
  toolpath is a genuinely even polygon; the bit never receives a lateral
  impulse. This is the geometry class the bench "doesn't wobble" verdict
  matches.
- **Line Art (clean filled art):** 1 vertex in 10 turns ≥15° (p95 22.3°),
  segments down to 0.023 mm. At F300 (5 mm/s) and 0.33 mm mean spacing, that
  is a **~15 Hz train of lateral velocity steps up to `v·sinθ ≈ 1.9 mm/s`** —
  mechanical excitation, felt as wobble/witness marks. Same flattener as
  Smooth; the difference is purely ε and the spline cap it implies.
- **Sharp:** flattener off + ε 0.225 px. On rough edges: 841 vertices on one
  circle, **81% of segments under 0.1 mm**, p95 turn 25.8°. Worst filled
  preset on real-world (rough) edges.
- **Centerline:** cleanest possible output on an ideal stroke (`ring-stroke`:
  **one** loop, 165 verts, p95 3.9° — vs 2 loops / ~2050 verts / 100%
  sub-0.1mm segments for every filled preset). But on anything rough or solid
  it **fragments**: 6 separate chains on one rough disc, with 5.2/100 turns
  ≥45°. Each fragment is a retract→reposition→plunge cycle, and ≥45–60° turns
  are the only class the GRBL junction limiter actually brakes for — pecking
  plus direction slams. On real variable-width strokes the medial axis also
  oscillates laterally — documented in-tree as the reason Centerline opts out
  of the upscale path (`trace-presets.ts`).
- **Edge Detection:** identical geometry class to Line Art, plus open-chain
  ends on real photos → extra stop/start events.

### The inversion nobody expected

On **thin-stroke art** (`ring-stroke`), Smooth is just as pathological as Line
Art: both produce two concentric loops totalling ~2050 vertices with **100% of
segments under 0.1 mm** and 15–22° heading jitter — an ~80 Hz impulse train at
F300, and the stroke is cut twice. Centerline is the _only_ clean preset
there. The bench result "Smooth is the only one that doesn't wobble" therefore
implies the bench art was **filled/outline art, not thin single strokes**.
Without the ADR-260 fairing, a thin-stroke source traced with Smooth would
chatter too.

## The physics, with the verified GRBL model

GRBL planner (`gnea/grbl` `planner.c`, fetched 2026-07-25): junction speed
`v² = a·δ·s/(1−s)`, `s = √(½(1−cosθ_j))` with the segment dot product
**negated** — i.e. `s = cos(θ/2)` for heading change θ; a straight-through
junction is unlimited. Consequences (at assumed a=500 mm/s², δ=$11=0.01 mm —
the 4040's real values are not in the tree; limits scale ∝ √(a·δ)):

- θ = 4° (Smooth, clean art): limit ≈ 5400 mm/min — never engages.
- θ = 22° (Line Art, clean art): limit ≈ 980 mm/min — **still above F300; the
  planner does not slow down.**
- θ ≥ ~60°: limit falls below 300 mm/min — brakes engage (Centerline
  fragments, glyph corners).

So for the 15–25° jitter class the machine runs **full feed through every
micro-bend**: the chatter is not planner deceleration, it is the machine's
structure absorbing a lateral velocity step `v·sinθ` at every vertex, at
frequency `feed ÷ segment length` — ~15 Hz (Line Art on a clean circle) to
~80 Hz (any filled preset on a thin stroke). Streaming/planner starvation is
unlikely to contribute at F300: worst case ~83 blocks/s ≈ 2.5 kB/s against the
115200-baud ≈ 11.5 kB/s ceiling (arithmetic, no GRBL throughput claim).

## Root cause, stated once

**The trace pipeline's output stage has no notion of a machine.** Its
tolerances are in _pixels_ (`SIMPLIFY_EPSILON_PX = 0.45`,
`SAMPLE_STEP_PX = 1.5`, spline cap = ε) and were tuned for _visual_ fidelity
at engrave scale. At the verified 0.1 mm/px import default, "1.5 px" means
"0.15 mm G1 segments" and "ε 0.45 px" means "keep every heading defect above
45 µm". Smooth was accidentally the machinable preset: its 2× ε and
pre-threshold cleanup happened to prune most of the impulse train. Nothing
guaranteed that — and on thin strokes it stopped being true.

## Candidate fixes

1. **Machine-aware finishing pass at the trace boundary** — **SHIPPED as
   ADR-260 / #422** (`main` `53cea2c2`). When `machineKind === 'cnc'`, commit
   refaires the polylines in mm: corner-pinned smoothing (0.05 mm clamp), then
   even-arclength resample to 0.4 mm chords; windowed 60° corners with
   arclength non-max suppression; curves rebuilt (the CNC compiler flattens
   curves). Laser untouched.
2. Denominate ε / `SAMPLE_STEP_PX` in mm via import DPI — not built; changes
   laser output and re-tunes every preset baseline; likely moot after fix 1.
3. Centerline: weld/prune skeleton fragments below a length floor before
   output — **not built**; kills the 6-fragment pecking independently of
   fix 1.
4. Bench coupon — **blocked: no machine available (2026-07-25)**. When one
   exists: same feed, cut (a) clean filled art traced Line Art vs Smooth;
   (b) a thin-stroke source traced Smooth. Pre-ADR-260 the model predicts
   wobble on (a)-LineArt and (b); post-ADR-260 it predicts neither chatters.
   (The 2026-07-24 finding that one "wobble" was RPM-dependent spindle EMI
   makes a geometry-only A/B worth the stock.)

## End-to-end verification of ADR-260 (2026-07-25, software ceiling)

With no machine available, the strongest possible check was run instead: the
same traced 40 mm jittered circle compiled through the **real CNC pipeline**
(`TracedImage` → `collect-cnc-contours` (flattens curves) → `compileCncJob`
contour pass), raw vs faired, measured in **machine millimetres** — the
geometry the streamer would send:

| contour pass (machine mm) | raw (pre-ADR-260) | faired |
| --- | --- | --- |
| vertices | 501 | 315 |
| min / mean segment | 0.251 / 0.254 mm | **0.400 / 0.400 mm** |
| p95 heading change | **25.9°** | **4.8°** |
| turns ≥15° per 100 vertices | **31.1** | **0** |

Rendered A/B (full toolpath + 3 mm window at ×100, every dot a G1 endpoint):
[`2026-07-25-cnc-trace-chatter-ab.svg`](2026-07-25-cnc-trace-chatter-ab.svg).

In the verified GRBL model this replaces a ~20 Hz train of up-to-26° lateral
impulses with ≤5° bends — ~5× smaller impulse per event and none in the ≥15°
class. **What remains unproven, and can only be proven on hardware:** that
this geometry class was the bench chatter and that the 4040 cuts the faired
path clean.

## Verified / not verified

**Verified:** every code line cited above read in-tree on 2026-07-25; GRBL
junction formula fetched from `gnea/grbl` source; 254 DPI import default read
in-tree; all geometry numbers measured by running the real
`traceImageToColoredPaths` (audit table) and the real `compileCncJob`
(end-to-end table) on deterministic fixtures.
**Not verified:** no hardware cut (no machine available); 4040
accel/junction-deviation values unknown (assumed 500 mm/s² / 0.01 mm, stated
where used); fixtures are synthetic, not the original bench art.
