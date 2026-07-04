# Trace fidelity fixes — implementation plan (revised)

**Author:** Fable planning session, 2026-07-04. Revision of the prior session's handoff
(original lives uncommitted in the `nice-hamilton-eb2ad4` worktree). Two substantive
corrections are marked **[REVISED]** below; everything else preserves the original's
confirmed findings.
**Branch:** `claude/relaxed-dhawan-7393fc` (off `main`, up to date as of 2026-07-04).
**Status:** both defects **reproduced in this worktree** (see §2 baselines). No fixes applied yet.

---

## 0. Ground rules

- Read `CLAUDE.md` first. Test-first bug-fix workflow: failing test → fix → verify.
- Green unit tests are NOT proof — this subsystem's history is "green tests, wrong
  output." Every fix must be verified perceptually (render + eyeball the
  `trace-audit-artifacts/` crops) before it counts.
- One fix per commit on this branch. **No push / no merge** until the maintainer has
  reviewed the rendered output.
- Reproduce and measure with the app's MERGED Edge options (the harness's
  `mergedAppEdgeOptions()`), never the raw preset. `mergeLightBurnTraceSettings`
  spreads the preset then overrides slider-derived fields (verified:
  `src/ui/trace/trace-options.ts:33`), so the upscale opt-in flags survive merging.

## 1. Corrected facts for THIS worktree

| Original doc said | In this tree |
|---|---|
| fixture `audit/fixtures/trace/arch-house-langebaan-source.png` | `src/__fixtures__/perceptual/assets/arch-house-langebaan-source.png` (resolved by `requiredArchHouseFixtureStatus`, `trace-artifact-runner.ts:5-7`) |
| harness "already exists" | copied in from nice-hamilton: `src/__fixtures__/perceptual/_new-problems-audit.test.ts` — run `TRACE_AUDIT=1 pnpm exec vitest run src/__fixtures__/perceptual/_new-problems-audit.test.ts` |
| "add a curve-fit.test.ts" | `src/core/trace/centerline/curve-fit.test.ts` already exists — extend it |

All other file/constant references verified present: `HARD_CORNER_RAD=60°` and
`SAMPLES_PER_SEGMENT=3` (`curve-refine.ts:20,25`), `upscaleBy`/`downscaleTracedPaths`/
`computeUpscaleFactor`/`MAX_UPSCALE_SOURCE_PIXELS=1_500_000` (`auto-upscale.ts`),
`cropRawImageData`/`offsetColoredPaths`/`offsetBounds` (`trace-boundary.ts`),
`traceImageRegion` (`src/ui/trace/trace-region.ts`).

## 2. Reproduced baselines (2026-07-04, this tree)

`trace-audit-artifacts/np-A-counter.txt`:

```
A1(after L):    closedLoops=2  areas=[68, 383]   counter present
A2(1st of AA):  closedLoops=2  areas=[67, 382]   counter present
A3(2nd of AA):  closedLoops=1  areas=[379]       counter DROPPED   ← Defect 1
```

`np-luma-probe.txt`: luma directly below the HOUSE serif feet is 254 (pure white) —
the serif "smile" bulge in `np-house-H.png` is spline overshoot into empty paper,
not a traced edge (← Defect 2, visually confirmed on `np-house-H.png`: red trace
arcs below both flat serif bottoms and clips the top serif flares).

Root causes (confirmed by the prior session, mechanism verified against this tree's code):

- **Defect 1**: the ~67px² counter sits at Canny's detection floor at native size.
  Whole-image auto-upscale can't help: `shouldUpscaleSmallSource` gates on
  `max(w,h) < SMALL_SOURCE_EDGE_PX = 100` (`auto-upscale.ts:82-86`) and the logo is 1024px.
- **Defect 2**: `fitSmoothCurve`'s centripetal Catmull-Rom (`curve-fit.ts`) flows through
  serif corners that turn < the 60° pin threshold and bows outward past the control
  polygon. Not apex-snap; disabling the resample makes serifs hug. Regression scope:
  the even-curvature smoothing from commit `a7387ce` (which fixed bowl faceting — keep it).

## 3. Fix B — bound the curve-fit against outward overshoot (DO FIRST)

**Target:** `src/core/trace/centerline/curve-fit.ts` (`appendRun`/`centripetalPoint`).

**[REVISED — the original's concrete clamp rule is geometrically unsound.]** The
original said: clamp any sample whose perpendicular offset from the `p1–p2` chord
exceeds the offset of neighbours `p0`/`p3` on that side, claiming "smooth bowls stay
inside their control polygon." They don't. For four points on a circle, `p0`/`p3` sit
on the *opposite* side of the `p1–p2` chord from the arc's legitimate bulge — the
exact signature of the serif overshoot. That rule clamps every convex arc to its
chord, re-facets discs, and fails the 0.12px disc-RMS gate.

The intent stands: the spline may smooth but must not invent geometry. Corrected
mechanisms, in order of preference:

1. **Simplification-tolerance deviation cap (recommended).** Douglas-Peucker
   guarantees the dense chain lies within its tolerance ε of each simplified chord.
   Therefore ANY sample deviating more than ~ε (small safety factor allowed)
   perpendicular from the `p1–p2` chord — on either side — is invention, arc or
   corner alike. Legitimate arc sagitta between simplified vertices is ≤ ε by the
   same guarantee, so discs keep their smoothing. Locate the ε actually used
   upstream of `refineChainForOutput` (edge and centerline pipelines may differ —
   read the code, do not guess); plumb it in as a parameter (pure core, no globals).
2. **Turn-scaled sagitta bound.** Outward deviation ≤ `(chord/2)·tan(θ/4)` with θ the
   smaller endpoint turn — the deviation a genuine circular arc with those turns
   would have. Use if ε is impractical to plumb.
3. **Fallback (riskier, original's alternative):** adaptive corner pinning below 60°.
   Only if 1–2 prove insufficient; re-check bowl faceting hard.

**Test-first** in `curve-fit.test.ts` (confirm each fails before fixing):
- Corner case: two straight legs meeting at ~45–50° (below the 60° pin) — no
  resampled point may deviate outward beyond the legs by more than the cap.
  Encode the serif-foot shape: flat chord with steep neighbours; assert no sample
  drops below the chord beyond the cap.
- Arc-preservation case: a gently-sampled circular arc must still bulge outside its
  chords (deviation strictly > 0 at midpoints) — guards against "fixing" by flattening.

**Acceptance:** new tests pass; `np-house-H.png` serif feet hug the grey (eyeball it);
ALL §6 gates green. Commit as `fix(trace): ...` (test + fix together).

## 4. Fix A — region-upscale re-trace ("Enhance region")

**[REVISED — venue.]** The original proposed a new canvas tool and did not know the
existing machinery. This tree already has the full loop:

- `retraceOriginalAction` (`src/ui/commands/image-command-actions.ts:33`) — select a
  committed traced-image → reopens `ImportImageDialog` with the retained source
  raster (`traceSourceId`) and `replaceTraceId` so commit replaces the old trace.
- Boundary-box UX in the dialog (`ImportImageDialog.tsx:88,153-154`,
  `TracePreview`, `use-trace-preview`) feeding `traceImageRegion` — today this is
  LightBurn-style **Boundary crop**: the result contains ONLY the region's paths.

So A1 = a second boundary mode, not a new tool. User flow for the broken A:
select trace → Re-trace original → box the AA pair → **Enhance region** → preview
shows the full trace with the region re-traced at 2× and patched in → commit.

### A1-core (pure, `src/core/trace/`, new file — new concept gets a new file)

`region-enhance.ts` (name at implementer's discretion, follow kebab-case):
- `computeRegionUpscaleFactor(crop)`: returns 2 (the mkbitmap sweet spot — 3×+
  "invents detail") unless `cropPixels × 4 > MAX_UPSCALE_SOURCE_PIXELS`, then 1.
  Integer factors only (`upscaleBy` is integer bilinear).
- `replacePathsInRegion(existing, region, replacement)`: pure merge — drop only
  polylines **fully contained** in the region (every point inside); polylines
  crossing the boundary (e.g. a large outline passing through the box) must
  survive. Merge replacement paths by colour key.
- Unit tests + an extension of the reproduction harness: crop the AA band from the
  real logo → 2× → trace merged options → downscale+offset → counter census must
  report **2 loops for BOTH A's**. That is Fix A's acceptance, measured end-to-end.

### A1-ui (`src/ui/trace/`)

- Orchestration (new small module or extension of `trace-region.ts` if it stays
  one-responsibility): crop source → `upscaleBy(factor)` → `traceImageWithFallback`
  → `downscaleTracedPaths(factor)` → `offsetColoredPaths` → `replacePathsInRegion`
  against the full-image trace.
- Dialog: boundary mode toggle — `'crop'` (existing behaviour, stays the default;
  LightBurn parity) vs `'enhance'` (new). Discriminated union, not a boolean prop.
  Component tests for both modes; the worker path must handle the upscaled crop.
- Docs: **ADR-113** (verified next free; 054–091 and 092–112 are taken) — one-pager:
  region-enhance re-trace, why 2×, why dialog-venue, LightBurn divergence is
  maintainer-sanctioned. WORKFLOW.md: the enhance-region flow's four states
  (success / error / empty-boundary / degenerate-tiny-boundary).

Commits: `feat(trace): region-enhance core` then `feat(trace): enhance-region dialog mode`.

### A2 (stretch — diagnosis only this session)
With the harness, determine whether A3's counter appears as an **open** chain that
`edgeMinLengthPx` filters (then better tiny-loop closure is the future fix) or is
never detected (then only upscaling recovers it). Report; change no thresholds.

## 5. Explicit don'ts

- Don't revert `a7387ce` / the Catmull-Rom smoothing; don't lower `HARD_CORNER_RAD`
  as the primary fix; don't touch `MAX_SLIVER_AREA_PX2` (the counter is 67px², far
  above the 4px² sliver drop — unrelated).
- Don't loosen any §6 gate to pass. Don't change the Sharp preset's no-upscale policy.
- Don't run the dev-server preview against the maintainer's live scene for
  verification; the harness renders are the perceptual check for this session.
- Don't commit `trace-audit-artifacts/` or `perceptual-artifacts/` (gitignored).

## 6. Gates — all must stay green (run before every commit)

`pnpm exec vitest run src/core/trace src/__fixtures__/perceptual` plus
`pnpm typecheck`, `pnpm lint`, `pnpm exec prettier --check .`, `pnpm check:file-size`:

- Disc radial RMS ≤ 0.12px (`edge-trace.test.ts` soft-disc smoothness)
- Star apex ≤ 1.0/1.6px (`potrace-apex.test.ts`, edge-trace star)
- Ring closure invariant; edge-trace determinism (bit-identical)
- Arch-house benchmark (`trace-benchmark-loop.test.ts`): `nearlyClosedOpenCount=0`,
  `langebaanExcessTurnPer100Px ≤ 12`, `aggregateArchCoverageRatio ≥ 0.95`,
  `smallClosedPolylineCount ≤ 4`
- Clean-B facet ≤ 0.6% @100px; small-letter facet B@40/E@40 not regressed (~3.5%/2.1%)
- `auto-upscale.test.ts`: Sharp un-upscaled, large sources un-upscaled
- File-size policy: 250 counted / 400 max code lines, 600 raw physical

Known-flaky (timing-only, not caused by this work): 2 camera optimization tests +
1 centerline perf-budget test.

## 7. Order

1. Fix B → gates → harness render → eyeball → commit.
2. A1-core → gates + AA-census acceptance → commit.
3. A1-ui + ADR-113 + WORKFLOW.md → gates → commit.
4. A2 diagnosis note (no code). Final full-suite run + perceptual report.
