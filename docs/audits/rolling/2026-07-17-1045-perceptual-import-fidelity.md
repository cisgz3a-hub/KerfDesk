# Rolling audit — perceptual pass 1: SVG import fidelity (rendered proof)

- **When:** 2026-07-17 10:45 (+08)
- **Tree:** `origin/main` @ `58cb3ae2`.
- **Mode change:** maintainer redirected cycle 2 to perceptual verification ("audit perceptual"). This iteration renders actual pipeline output and compares it to ground truth, per CLAUDE.md rule 2 — no static-only claims.
- **Method:** (a) ran every shipped perceptual suite; (b) a TEMPORARY probe test through `importSvgPolylines` (the real `parseSvg` pipeline) against the harness's analytic `ring-annulus` truth, with `PERCEPTUAL_ARTIFACTS=1` PNG dumps; probe deleted after harvest, working tree clean. Rendered side-by-sides for the maintainer's eyes: **https://claude.ai/code/artifact/cce1df1f-d29c-4ff8-8348-3e677089f4b0**
- Rule-4 compliance: everything ran in the test harness on throwaway masks; no dev-server canvas was touched.

---

## Findings

None. All 16 perceptual assertions green (12 shipped + 4 new probe cases), and the rendered diffs show no displacement, no spurious ink clusters, no missed contours.

---

## Measured results (rendered, not inferred)

| Case | Metric | Result |
|---|---|---|
| SVGO `z m` ring vs absolute-encoded ring (the #262 P1 class) | pixel IoU | **1.0000 — fp 0, fn 0, pixel-identical** |
| SVGO `z m` ring vs analytic annulus truth | IoU | 0.9944 (residue = 1-px hard-edge rasterization rim, no red/blue clusters in the diff) |
| Absolute ring vs analytic annulus (reference sanity) | IoU | ≥ 0.95 floor passed |
| Coincident-endpoint arc spliced into the ring vs clean ring | IoU | **1.0 exactly** — the degenerate arc is omitted with zero geometric residue |
| Shipped suites (import circle, trace fixtures, v-carve) | 111 + 16 assertions | all green; harness PNGs re-dumped into the gallery |

The first row is the perceptual closure of iteration 3's P1: before #262, this exact input class displaced every post-`z m` contour (the inner circle of the ring would have landed ~24 mm off, cratering the IoU); at main's tip the two encodings import **pixel-identically**.

## Not verified (the honest remainder for future perceptual iterations)

- **Fill/raster burn coverage:** no emitter-level perceptual pass exists — rasterizing emitted G-code sweeps against the source shape mask would perceptually verify fill hatching, overscan, and the #263 power-mode fix's geometry. Suggested as perceptual pass 2.
- **Trace fidelity on real photos/logos** beyond the analytic fixtures (the harness's own scope note).
- **On-screen canvas rendering** (the drawn preview vs these masks) and hardware output.
- The corpus still contains no `z m` SVG fixture — the probe was temporary by design (report-only); a committed fixture needs a normal PR if wanted.
