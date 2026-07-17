# Rolling audit — perceptual pass 3: raster/image-mode emitter fidelity

- **When:** 2026-07-17 10:50 (+08)
- **Tree:** `origin/main` @ `5ab41815` (rebased; unchanged upstream at audit time).
- **Scope:** the last output mode with no perceptual coverage — `emitRasterGroup` (`src/core/raster/emit-raster.ts`), the per-pixel S-modulation engraver, exercised with bidirectional snake rows, overscan, and gap blanking.
- **Method:** TEMPORARY probe (deleted after harvest, tree clean): a known 64×32 S-grid — left gradient (S 29..800), 4 px S=0 gap, solid S=600 block containing a 12×12 S=0 hole — emitted through the real emitter, then reconstructed from the emitted G-code by a modal parser (burn iff G1, armed, modal S > 0, painting pixel centers crossed by each move with that move's S). Gallery updated: **https://claude.ai/code/artifact/cce1df1f-d29c-4ff8-8348-3e677089f4b0**
- **Report-only**; rule-4 compliant.

---

## Findings

None. The raster emitter reproduces the commanded grid **exactly** — the strongest result of the three perceptual passes.

---

## Measured results (rendered, not inferred)

| Check | Result |
|---|---|
| Coverage: reconstructed burn footprint vs commanded footprint | **IoU 1.0000 — fp 0, fn 0** |
| Per-pixel S values (all 1,776 burn pixels, forward AND reverse snake rows) | **100% exact, max ΔS = 0** |
| S=0 hole inside the solid block | **0 ink pixels** |
| 4 px inter-island S=0 gap (below the 5 mm rapid threshold → blanked at feed) | **0 ink pixels** |

What this pins perceptually: run-length compression emits correct span boundaries; snake-direction reversal does not mirror or off-by-one the pixel order; overscan leads contribute no burn; sub-threshold gaps cross at S0 exactly; per-pixel dynamic power lands on the exact commanded values at the exact commanded positions.

## Not verified (remaining perceptual surface)

- Dot-width correction and scan-offset compensation were set to 0 (their nonzero geometry intentionally shifts runs; verifying them needs expected-shift-aware truth).
- The dither stage upstream of the emitter (image → sValues) — this pass starts at the S-grid, so grayscale/dither fidelity on real images is still open.
- Angled/offset fill styles, drawn preview vs masks, hardware output.
