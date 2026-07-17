# Rolling audit — perceptual pass 2: emitter-level fill burn coverage

- **When:** 2026-07-17 11:10 (+08)
- **Tree:** `origin/main` @ `5ab41815`.
- **Approved scope:** the maintainer approved this pass verbatim ("let the next loop iteration build perceptual pass 2 — an emitter-level burn-coverage probe").
- **Method:** TEMPORARY probe (deleted after harvest, tree clean) running the **full production chain** — SVG text → `parseSvg` → `compileJob` (real fill hatching) → `grblStrategy.emit` (real emitter) → emitted G-code → modal burn extraction (a move burns iff G1, laser armed via M3/M4, modal S > 0) → beam-stamped mask (0.6 px radius ≈ half the 1 mm hatch spacing) → compared against the ADR-025 analytic truths. Machine→scene Y-flip (bed height) handled in the extractor. Rendered side-by-sides added to the gallery: **https://claude.ai/code/artifact/cce1df1f-d29c-4ff8-8348-3e677089f4b0**
- **Report-only**; rule-4 compliant (throwaway masks, no dev-server surface).

---

## Findings

None. Three new perceptual assertions, all green, closing the audit's biggest unlit area (fill output had zero perceptual coverage before this pass).

---

## Measured results (rendered, not inferred)

| Case | Metric | Result |
|---|---|---|
| Emitted fill of an imported circle vs analytic disc | burn recall / precision | **1.0000** / 0.9739 (the 2.6% extra ink is the beam-stamp radius bleeding 1 px over the hard analytic edge) |
| Emitted fill of an imported annulus vs analytic ring | burn recall / precision | **1.0000** / 0.9484 |
| **Beam-on ink strictly inside the hole** (1.5 px margin) | pixel count | **0** — the S0 gap-crossing sweep leaves the hole completely dark on rendered output (PROJECT.md #3, perceptually) |
| Two-pass fill vs one-pass fill | mask IoU | **1.0 exactly** — a second pass burns the identical footprint (the #263 re-arm territory: no drift, no doubled edges) |

Notes for anyone repeating this: the emitter produces **machine coordinates** (Y flipped over `device.bedHeight`) — the first probe run scored recall 0.0000 until the extractor mapped back to scene space; and overscan leads are correctly emitted as `G0` (laser off), so they contribute no burn ink, which the precision numbers confirm.

## Not verified (remaining perceptual surface)

- **Raster/image-mode burn coverage** (per-pixel S modulation through `emit-raster.ts`) — next natural target.
- Offset-fill style, angled hatching (probe used 0°), and Island Fill runway behavior.
- Trace fidelity on real photos/logos; drawn preview vs these masks; hardware output.
- The probes remain temporary by design (report-only). If the maintainer wants burn-coverage as a permanent suite, that is a small PR — the probe code is reproducible from this report and the memory notes.
