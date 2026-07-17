# Rolling audit — no-homing User-Origin preview/render family (#254, #258)

- **When:** 2026-07-17 10:30 (+08)
- **Tree:** `origin/main` @ `58cb3ae2` (audit branch rebased onto it).
- **Scope:** cycle-2 sweep of the newest merges in the maintainer's core no-homing workflow — #254 (preview User-Origin jobs before the origin is set) and #258 (render origin-anchored starts artwork-relative when the bed position is unverified) — plus the placement-resolver seam they share (`src/ui/job-placement.ts`).
- **Method:** static read + resolver/caller tracing + test-pin verification. **Not verified:** no live canvas render; no hardware.
- **Report-only** per CLAUDE.md collaboration rule 1.

---

## Findings

None at P1/P2/P3. Second consecutive zero-finding iteration on fresh maintainer-driven merges.

---

## Verified clean (checked, no finding)

- **#254 changes exactly one case:** for `user-origin` placement the preview resolves via `resolveExportJobPlacement`, whose fallback yields the **same** `jobOrigin` object shape the live resolution produces (`{startFrom: 'user-origin', anchor}` — [job-placement.ts:119-120,195-199](../../src/ui/job-placement.ts)), so pre-origin preview geometry is byte-equivalent to what Start will emit once the origin is set; only `preflightMotionOffset` is dropped, degrading preflight to the size-only relative mode Verified-Origin already uses (ADR-053, documented at the fallback).
- **No guard was weakened:** Start still resolves through the strict `resolveJobPlacement` ([start-job-preparation.ts:76-77](../../src/ui/laser/start-job-preparation.ts)) and still refuses without an active custom origin — pinned by [job-placement.test.ts:117](../../src/ui/job-placement.test.ts); the preview side is pinned by #254's own test. Both halves of the "preview may, Start may not" contract are under test.
- **No guard was added** (ADR-206): #254 removes a preview refusal (guard-narrowing = normal bug-fix work per rule 7); #258 is render-only.
- **#258's evidence bar is exactly Absolute placement's:** `bedPositionVerified` = `device.homing.enabled && homingState === 'confirmed'` — the canvas draws origin-anchored starts artwork-relative unless bed coordinates are actually trustworthy, fixing the offset-ghost route the maintainer live-reproduced; the change touches only `canvasCoordinateFrame`, no emission/streaming surface.
- **Rebuild keying stays sane:** the preview keys on the resolved placement, and the pre-origin fallback is static — no per-poll rebuild churn was introduced.
- **The `current-position` mode correctly keeps its live-machine requirement** in both resolvers (its bytes bake in the head position), so #254 could not leak a stale-position preview for that mode.

## Not verified

- No rendered-canvas comparison of the pre-origin preview against a post-origin burn (the equivalence is proven at the resolver level, not perceptually).
- #261 (rail order re-land), #253 (fonts), #266 (palette) remain unaudited — lower stakes; future iterations.

## Note on cadence

Cycle 1 (iterations 1–9) found 22 defects in pre-existing code; every fix has landed. Cycle 2's first two iterations, auditing fresh maintainer-driven merges, found zero. The static-audit well is running dry on new code; the remaining unverified surface is the kind CLAUDE.md rule 2 names — perceptual fidelity and WORKFLOW.md flow-content vs the shipped UI — which needs rendered output, not code reading.
