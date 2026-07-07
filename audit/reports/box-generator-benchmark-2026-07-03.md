# Box generator (Phase K, ADR-106) — build + verification report, 2026-07-03

Parametric finger-joint box generator, laser + CNC router, built S0–S6 on
`claude/relaxed-liskov-0df88b` in six individually CI-green commits.

## What shipped

- **Pure core `src/core/box/`** — claim-model joinery: ONE alternating
  sequence per cube edge (odd cells; complementarity by construction),
  Z > Y > X corner-cube claims, battlement outline walk on shared float
  expressions, clearance as a uniform contour offset (δ = c/4; see
  "Deviations"), F-CNC26 corner-overcut reliefs at full bit radius after
  the offset, 3-column sheet layout, `generateBox` orchestrator returning
  values (never throwing, never partial).
- **UI** — `tools.box-generator` command (Tools menu, both machine kinds),
  `BoxGeneratorDialog` (calibration-dialog conventions, live core
  validation, machine-aware CNC defaults: stock thickness, active tool,
  0.15 mm glue fit), canvas sheet preview with panel names, insertion as
  one undo step on the auto-created black cut layer with every panel
  selected, success toast.

## The benchmark (seeded, reproducible)

`pnpm exec vitest run src/core/box/box-benchmark.test.ts`
(seed 0x1057b0c5; 48 swept specs + 6 hard cases → 54 valid specs):

| Category | Checks | Score |
|---|---|---|
| assembly-exact (referee: zero collision/void, size exact) | 54/54 | 100% |
| assembly-clearance (uniform play == c, zero interference) | 54/54 | 100% |
| structure (simple rectilinear rings, area exact vs claims) | 299/299 | 100% |
| fit-relief (full-radius overcuts; laser bit-identical) | 598/598 | 100% |
| determinism (JSON-identical double generation) | 54/54 | 100% |
| sabotage-detection (referee catches all 4 broken-math classes) | 4/4 | 100% |
| **OVERALL** | **1063/1063** | **100%** |

Plus the standing suites: assembly referee at 100 fresh-seed fuzz runs per
run (nominal + clearance), outline structure property (100 runs),
perceptual sheet fixture (laser IoU **1.0000** vs an independent
claim-rectangle mask; CNC IoU 0.969 with precision 1.0 — fit only removes
material), and full repo gates green: **3042 tests, lint, typecheck**.

## Deviations from the approved plan (flagged for review)

1. **Clearance offset is −c/4, not the plan's −c/2.** A uniform inward
   offset δ narrows a tab by 2δ AND widens the mating notch by 2δ, so
   joint play = 4δ. The plan's own contract ("total joint play = c")
   wins; −c/2 would have doubled it. ADR-106 §fit and F-K3 amended;
   measured play == c pinned by tests.
2. **Panel names don't reach the scene** — `SceneObject` has no name
   field; names show in the dialog preview only. F-K1 wording trued up.
3. **`CalibrationNumberField` gained `step: 'any'`** (additive): native
   step validation blocked form submission for legitimate values
   (e.g. 6.35 mm stock); core validation is the authority.

## NOT verified (stated plainly)

- **Physical fit.** No box has been cut or assembled. The virtual referee
  proves the 2D math encodes the 3D assembly; it cannot prove real kerf,
  material springback, or bit runout. **Pending named check: cut a
  60×40×30 mm T=3 box — Falcon (laser, layer kerf comp set) and 4040
  (router, 0.15 mm clearance + 1/8 in relief tool) — and assemble both.**
- **Live in-app walk.** Menu → dialog → Generate → undo was not driven
  against the live dev-server scene (CLAUDE.md rule 4, side-effect-free);
  it is covered by component tests (dialog), mutation tests (insertion,
  undo, layer reuse), and the command-registry/help/a11y contract suites.
- Kerf-compensated laser output relies on the shipped ADR-052 pipeline
  (unchanged here); the press-fit contract at kerf ≠ 0 is inherited, not
  re-proven.

---

# K.2 broad-tool pack (ADR-116, V0–V3) — addendum, 2026-07-07

Built on top of the v1 generator in four commits (V0 docs, V1 cutouts,
V2 dividers, V3 slide lid). The benchmark grew three categories and the
corpus now scores **1104/1104 (100%)**: assembly-exact 54, clearance 54,
structure 299, fit-relief 598, determinism 54, cutouts 6, dividers 25,
slide-lid 10, sabotage-detection 4.

Deviations recorded in ADR-116 at build time: the slide-lid channel
stops one thickness INSIDE the wall body (the drafted to-the-body-end
channel left a zero-width neck that the fit offset severed — the referee
caught it); the lid therefore stops against the in-wall post and
measures outer depth − 2T.

NOT verified: physical cuts (named checks in AUDIT.md — a divider
organizer and a slide-lid box), and the live in-app walk (component +
insertion + command suites cover the dialog path; side-effect-free rule
unchanged).
