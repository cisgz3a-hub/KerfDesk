# Rolling audit — CNC GRBL G-code emitter (router output)

- **When:** 2026-07-17 11:24 (+08)
- **Tree:** `origin/main` @ `b8f773e5` (audit branch rebased onto it).
- **Scope:** the CNC counterpart to iteration 5's laser emitter — `src/core/output/cnc-grbl-{strategy,transitions,emit-head,helical,coolant,job-groups}.ts` + `cnc-pass-spans.ts`. Depth passes, plunge/safe-Z discipline, spindle/coolant/tool-change sequencing, arc (G2/G3) + helical + path3d emission, the ADR-215 pass-span sidecar.
- **Method:** static read of the full module to ground truth, then a **6-dimension adversarial review** (motion-safety, geometry, sequencing, CLAUDE.md rules, dead-code/drift, test-coverage) run as a workflow: each dimension found independently, then **every one of the 21 raised findings was adversarially verified against the tree** (try-to-refute, default to REFUTED/DOWNGRADED if not airtight). 20 survived verification (all P3, heavily duplicated across dimensions → 6 distinct), 1 refuted.
- **Report-only** per CLAUDE.md collaboration rule 1 — nothing was fixed.

---

## Headline

**Zero P1/P2. No dimension — including the motion-safety pass that specifically hunted for plunge/drag/rapid-through-stock scenarios — raised a single correctness or safety defect that survived (or was even raised).** For an emitter that drives a spinning cutter into real stock, the safe-Z-before-XY, plunge-always-G1, and no-rapid-below-safe invariants hold by construction and under adversarial scrutiny. The six findings below are all P3 polish: one latent defense-in-depth asymmetry (itself preflight-mitigated), plus duplication, a comment nit, a size-guidance note, a magic-number nit, and a bundle of test-coverage gaps.

---

## P3-1 — Arc pass guards `zMm` finiteness but not `start`/`end`/`center` XY (latent, preflight-mitigated)

`appendArcPass` explicitly aborts on a non-finite `zMm` ([cnc-grbl-strategy.ts:311](../../src/core/output/cnc-grbl-strategy.ts)) but has **no** matching guard on `pass.start`/`end`/`center`. Traced chain (each link verified): a non-finite arc XY makes `circularArcGeometry` return `invalid` → `sampleCircularArcPoints` falls back to `linePoints(start, end)`, which returns the verbatim `[start, end]` (the `NaN <= eps` single-point collapse is skipped because `distance` is NaN) → `polyline[0]` is the non-finite start → `fmt(NaN) === "NaN"` → the emitter would write `G0 XNaN YNaN` / `G1 ZNaN`. This is **asymmetric** with the helical and path3d paths, which return early on invalid geometry.

The post-emit motion invariant does *not* catch it: `findPlungedTravelIssues`' axis regex `\b[XYZ](-?\d+…)` (`core/invariants/cnc-motion.ts:117`) does not match `NaN`, so the line is invisible to it.

**Why it's P3, not higher:** the separate preflight scanner `findNonFiniteCoords` (`core/preflight/preflight.ts:429`, `non-finite-coords.ts`) *does* match `XNaN`/`XInfinity` on any G0–G3 line and raises a blocking issue **before file write** — the same last-line-of-defense verified in iteration 5. And no in-tree producer builds a `CncArcPass` with non-finite start/end/center. So this is a defense-in-depth gap in the emitter's own guard discipline, not a machine-reachable defect. Fix direction (if pursued): mirror the helical/path3d early-return by aborting the arc pass when any of start/end/center is non-finite.

---

## P3-2 — Copy-paste duplication: `cnc-grbl-helical.ts` re-declares `fmt`/`DECIMAL_PLACES` that `emit-head` exports

[cnc-grbl-helical.ts:4,46-48](../../src/core/output/cnc-grbl-helical.ts) re-declares a local `const DECIMAL_PLACES = 3` and a private `fmt(value) => value.toFixed(DECIMAL_PLACES)` that are byte-identical to the exported `fmt` in [cnc-grbl-emit-head.ts:6,17](../../src/core/output/cnc-grbl-emit-head.ts) — which this module already imports from for nothing else. CLAUDE.md's "copy-paste duplication" anti-pattern; the fix is a one-line `import { fmt } from './cnc-grbl-emit-head'`. Behaviorally harmless (identical output).

---

## P3-3 — "drop loudly" comment contradicts the silent `break` for laser groups

[cnc-grbl-job-groups.ts:23-24](../../src/core/output/cnc-grbl-job-groups.ts): the cut/fill/raster arm's comment reads "Reaching here means a pipeline bug — **drop loudly**," but the code is a bare `break;` with no console, throw, or logger (none is passed in). The **silence is correct** — pure core cannot `console.*` or throw for control flow (CLAUDE.md), and a true unknown variant still hits `assertNever` in the default arm — so the code is right and the word "loudly" is stale. (Found independently by 5 of the 6 review dimensions.) Reword to "silently skipped (routing to grblStrategy happens upstream; pure core cannot log)."

---

## P3-4 — `cnc-grbl-strategy.ts` exceeds the 250 counted-line soft limit (340 counted / 429 raw)

Measured 340 counted code lines and 429 raw physical ([cnc-grbl-strategy.ts](../../src/core/output/cnc-grbl-strategy.ts)) — over the 250 soft limit but **under** the 400 counted hard cap (`eslint.config.mjs:115`, `skipComments`/`skipBlankLines`) and the 600 raw backstop (`scripts/check-file-size-policy.mjs:4`). **Correction to how this was first framed:** the soft limit is a CLAUDE.md review convention only — there is *no configured ESLint warning tier* for 250, so this is guidance-only and does not even surface as a lint warning, let alone a CI failure. If split, the four cutting-pass emitters (contour/arc/path3d/helical) are the natural extraction, matching the ADR-015 pattern already used for transitions/emit-head/coolant.

---

## P3-5 — Magic-number literal `2` in polyline-length guards (borderline; idiomatic across the tree)

`pass.polyline.length < 2` / `pass.points.length < 2` ([cnc-grbl-strategy.ts:281,314,366](../../src/core/output/cnc-grbl-strategy.ts); [cnc-grbl-helical.ts:20](../../src/core/output/cnc-grbl-helical.ts)) uses the literal `2`, which is outside CLAUDE.md's allowed inline set (`0, 1, -1, ''`, bounded array indices). By the letter of the magic-numbers rule this is a violation (a `MIN_SEGMENT_POINTS = 2` would document "need a start plus at least one destination"). Flagged for completeness — the same literal-2 guard is idiomatic throughout the emitter tree, so this is a house-style call, not a defect.

---

## P3-6 — Test-coverage gaps (six emitter behaviors with no assertion)

`cnc-grbl-strategy.test.ts` (387 lines) and `cnc-pass-spans.test.ts` (216 lines) cover the common paths well, but these branches are exercised by no test (each verified absent):

1. **Full-circle arc** — the native G2/G3 branch reachable only via `isCircularArcFullCircle` when start===end ([strategy.ts:335](../../src/core/output/cnc-grbl-strategy.ts)); arc tests use only an open arc + an invalid-geometry fallback.
2. **`maxSafeZ` fold** — the postamble/tool-change retract to the *highest* safe-Z across groups ([transitions.ts:42](../../src/core/output/cnc-grbl-transitions.ts)); every test uses a uniform `safeZMm` (3.81), so a regression that retracted to the *last* group's safe-Z instead of the max would pass the whole suite.
3. **Helical null path** — `appendHelicalContourPass` emitting nothing when `prepareHelicalMotion` returns null ([strategy.ts:225](../../src/core/output/cnc-grbl-strategy.ts)).
4. **Arc non-finite `zMm` guard** — the early return at [strategy.ts:311](../../src/core/output/cnc-grbl-strategy.ts) (the path3d and contour <2-point guards *are* tested; the arc guard's twin is not).
5. **Spindle no-dwell** — the `spinupSec <= 0` branch that omits `G4` ([transitions.ts:96](../../src/core/output/cnc-grbl-transitions.ts)); every test uses spinup 3.
6. **emit-head clamps** — `fmtFeed`'s `Math.max(1, …)` and `appendRetract`'s `Math.max(0, safeZMm)` ([emit-head.ts:23,28](../../src/core/output/cnc-grbl-emit-head.ts)); no test supplies a negative safe-Z or a sub-1 feed, so removing either clamp would pass the suite.

The `maxSafeZ` gap (#2) is the highest-value one — it guards a real safety property (final retract clears the tallest fixture/safe-Z used) with no test.

---

## Verified clean (checked hard, no defect)

- **Motion-safety invariants all hold** under adversarial review: every XY rapid is preceded by a safe-Z retract (`appendRetract` before every `G0 X Y`); plunges are always `G1 Z … F<plunge>`, never rapids; no `G0 Z` ever targets below `Math.max(0, safeZ)`; and the postamble retracts to `maxSafeZ` ≥ every group's safe-Z.
- **The successive-depth same-XY optimization is safe:** it skips the retract+rapid only when the head is *already* at the pass start XY (closed-contour depth passes), then changes Z at that same XY — no lateral drag through stock.
- **M0 tool-change sequence is correct:** retract → M5 → park → M0 → **void head X/Y/Z** → respin with a fresh safe-Z retract before M3. The head-void forces the next pass to re-emit its repositioning `G0 X Y` even when it starts at the park XY (the F23 fix), so the new bit never plunges at the touch-off location.
- **Arc I/J origin matches the plunge XY:** `sampleCircularArcPoints` forces `points[0] = arc.start` ([circular-arc.ts:64](../../src/core/geometry/circular-arc.ts)), so the plunge target (`fmt(first.x)`) and the G2/G3 `I/J = center − start` share the same origin (my own cross-check; a seed concern, refuted).
- **`Head` type is consistently `string|null`** (fmt-formatted) across all paths including helical (`head.z = prepared.finalZ`, a string) — no number/string comparison hazard.
- **Coolant machine-wide, spindle-after-safe-Z, WCS pinned to G54** — all match the documented contract and the Easel post ordering (lift before M3).
- **`_device` parameter is NOT dead** (a raised finding, **refuted**): `emitJob` must satisfy `OutputStrategy.emit(job, device, options)`; the CNC emitter legitimately reads all its parameters off the `CncGroup`s rather than the device profile, so threading an unused `_device` is interface conformance, not dead plumbing.

## Not verified

- No G-code was emitted/diffed this iteration (static + adversarial review); a perceptual CNC pass (rasterizing emitted toolpaths vs the source contours, the analog of iterations 12–14) would be the rendered complement.
- Hardware behavior of any emitted program — unchanged, still not hardware-verified.
