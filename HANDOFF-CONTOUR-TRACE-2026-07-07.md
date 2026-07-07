# HANDOFF — Contour trace backend + open-source prep (2026-07-07)

> Cross-device continuation notes for branch `claude/contour-trace-backend`.
> **Internal doc — delete before the repo goes public** (same pruning policy
> as the other handoff files removed in the ADR-120 cleanup).

## Why this work exists

The maintainer is open-sourcing the repo under MIT (ADR-120, supersedes
ADR-018). The one release blocker: `src/core/trace/potrace-*.ts` (~2,369
source lines) carries GPL-2 potrace implementation fingerprints with no
provenance record (old audit finding H11) — it cannot ship under MIT unless
replaced or cleared. Chosen exit: replace it with a **contour backend built
on the maintainer's own clean centerline engine** (fingerprint-audited:
zero potrace identifiers/imports in `src/core/trace/centerline/`).

## What is on this branch

1. **Open-source prep** (also open as PR #30 on `claude/nostalgic-ramanujan-446d22`):
   LICENSE → MIT, ADR-120, EULA → License & Safety Notice, THIRD_PARTY
   rewording, README rewrite, Rayforge references removed (audit confirmed
   no code was ever copied), 238 internal docs pruned. Note: DECISIONS.md
   here also fixes a ~4,900-line duplicated ADR block a bad merge left on
   main, and renumbers the open-source ADR 118→120 (main published 118/119
   first).
2. **Contour backend** (commits `96fff9f`, `3aac05e`, `ffe16b7`):
   - `src/core/trace/contour-boundary.ts` — clean-room lattice boundary
     walker (holes = opposite-orientation loops; saddle = right-turn).
   - `src/core/trace/contour-trace.ts` — finishes loops with the centerline
     engine's stages: mid-crack → raw Taubin pre-smooth → corner rebuild
     (only for loops ≤ 4096 dense points; above that it costs seconds for
     no measurable gain) → curvature evening → Douglas-Peucker →
     oscillation-gated wobble flattener → Catmull-Rom resample.
   - `src/core/trace/flatten-straight-runs.ts` — wobble flattener. OFF at
     the dialog's Smoothness default (drawn-art waviness and edge noise
     have the same amplitude); Smoothness > 1 maps to up to ~2px erase.
   - `fix(centerline)`: `curve-fit.ts` closed ring with exactly ONE corner
     collapsed to an EMPTY polyline (killed the HOUSE "O" counter).
     Failing-test-first regression in `curve-fit.test.ts`.
3. **Temporary A/B state (working tree, committed on this branch only):**
   - `src/core/trace/trace-to-paths.ts` routes the binary filled-contours
     lane (Line Art / Smooth / Sharp) to the contour backend instead of
     potrace. Marked TEMPORARY in a comment; **do not ship without an ADR**.
   - Because of the swap, ONE test is intentionally red:
     `potrace-trace.test.ts > uses the Potrace backend for Line Art` (a
     routing pin, accurately reporting the changed routing).
   - `src/__fixtures__/perceptual/_contour-hole-debug.test.ts` — scratch
     stage-timing / sharpen-A/B probes (TRACE_AUDIT-gated). Delete at
     adoption.

## Measured state (defaults, TRACE_AUDIT harness)

| arch-house 1024² | potrace | contour |
|---|---|---|
| whole-image IoU | 0.9550 | **0.9632** |
| precision | 0.976 | **0.982** |
| LANGEBAAN band IoU | 0.9190 | **0.9377** |
| vertices | 12,009 | **9,856** |
| time | ~800ms | **~550ms** |

Synthetic fixtures: equal or better everywhere; disc radial RMS 0.106px vs
potrace 0.521px. Hole candidates 52 vs 51 (all letter counters present).
Known deltas: two 1px hairline slits trace slightly larger than potrace;
tiny 2px speck loop potrace's turd filter drops.

## Open items (in order)

1. **Maintainer visual sign-off** — O counter fixed and straights improved;
   the wobbly-H case should be re-tested with Smoothness raised past 1
   (screenshot-grade sources). If default-strength wobble is still
   unacceptable, tune `flatten-straight-runs.ts` constants or the
   Smoothness mapping in `contour-trace.ts`.
2. **ADR for the backend switch** (new number — check main first, numbers
   race; 118/119/120 are taken).
3. Rewrite the potrace routing-pin test for the new routing.
4. Delete `potrace-*.ts` (+ their tests), drop the potrace exports from
   `src/core/trace/index.ts`, update `_sharp-candidates.test.ts` (imports
   potrace internals), and re-run the full benchmark loop.
5. Edge Detection still uses potrace geometry (`edge-trace.ts` imports
   `potraceBitmapToPolylines`, ADR-115) — route it through the contour
   finisher or the centerline chainer before deleting potrace files.
6. Then the MIT publish: flip repo public (maintainer decided AGAINST a
   fresh-history repo — publish as-is), delete this handoff, merge PR #30
   first.

## Commands

```bash
pnpm install
pnpm vitest run src/core/trace            # 1 intentional red (routing pin)
TRACE_AUDIT=1 pnpm vitest run src/__fixtures__/perceptual/_contour-vs-potrace-audit.test.ts
TRACE_AUDIT=1 PERCEPTUAL_ARTIFACTS=1 ...  # + side-by-side PNGs in perceptual-artifacts/
pnpm dev:web                              # A/B test in the dialog (Line Art preset)
```
