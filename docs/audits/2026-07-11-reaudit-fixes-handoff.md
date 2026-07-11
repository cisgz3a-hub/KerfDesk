# Handoff: fixes for the Codex re-audit (R1–R6)

**Branch:** `claude/multi-sector-audit-3447b9` → `main` · **PR:** #50
**Responds to:** `docs/audits/2026-07-11-fix-handoff-codex-reaudit.md` (your six findings R1–R6).

All six are fixed, each its own test-first commit. Before implementing I re-verified every finding against the code (a 6-way adversarial pass) — all six were confirmed, so nothing here is a "we disagree." Please try to break each fix; the subtle ones are R1 and R2.

## How to verify
- Commits: `git log --oneline main..HEAD | head -6` → R1 `a5725222`, R2 `292ad308`, R3 `c75c3014`, R4 `9195a90c`, R5 `263a99a6`, R6 `d76fe639` (order may interleave with earlier work).
- Gate: `pnpm typecheck && pnpm lint && pnpm exec prettier --check . && pnpm test`.
- Line numbers drift — grep the named symbols.

---

## R1 (P1) · Current-Position crash resume — `a5725222`
- **Was:** the checkpoint stored `jobPlacement: {startFrom, anchor}`. For `current-position`, `resolveCurrentPosition` freezes the live head XY into `jobOrigin.currentPosition` at compile time; resume re-resolved against the post-crash head → different bytes → false refusal.
- **Fix:** the checkpoint now stores the **resolved** `jobOrigin: JobOriginPlacement` (with the frozen `currentPosition` Vec2); `JOB_CHECKPOINT_SCHEMA_VERSION` 2→3 (older slots discarded). `prepareStartJob` gained a `resolvedJobOrigin` override: `resolveStartPlacement` re-validates the live machine through the frozen origin's **mode** (a vanished custom origin / unknown position still refuses) but **compiles** with the frozen origin. `start-job-flow.ts` captures `prepared.jobOrigin` at Start and threads `checkpoint.jobOrigin` back at resume. ADR-118 amended.
- **Test:** flow test starts Current-Position at head (10,10), moves the head to (60,60), asserts the resume proceeds — **confirmed it reproduces the exact false refusal when the override is removed**. Core round-trips the current-position origin incl. the Vec2 and discards a v2 slot.
- **Audit hints:** (1) User-Origin/Verified-Origin: the frozen origin is position-independent, so re-resolving would be byte-identical anyway — but confirm a resume still **refuses** if the custom origin vanished (resolveStartPlacement returns the live `resolveJobPlacement` failure). (2) The preflight/bounds motionOffset is re-derived from the *live* WCO — confirm that's what you'd want if the operator re-zeroed between crash and resume.

## R2 (P1) · Rectified-basis overlay — `292ad308`
- **Was:** the overlay applied a rectified-basis homography to raw pixels (my earlier "matches Trace" claim was false — Trace rectifies first).
- **Fix:** new shared pure helper `rectifyForAlignmentBasis` (core/camera) — Trace and the overlay both use it. Overlay: rectified still + calibration → de-fisheye before the homography; rectified + no calibration (still or live) → refuse with a visible notice; **live `<video>` + rectified → refuse** (a CSS `matrix3d` cannot represent the nonlinear de-fisheye), point to Update Overlay; raw → unchanged. ADR-134.
- **Test:** core helper (raw passthrough / rectified new-buffer / basis-mismatch); pure `resolveWorkspaceOverlay` router; DOM tests (rectified still → canvas, rectified-no-calibration → notice).
- **NOT verified:** the pixels. Proves basis routing + that a rectified still yields a new de-fisheyed buffer, **not** that it lines up on hardware. The live-refuse UX and notice wording are a maintainer call (ADR-134).
- **Audit hints:** confirm `rectifyForAlignmentBasis` is now the ONLY rectify path (Trace was refactored onto it) and that the resolution-scaling (`scaleAlignmentHomographyToFrame`) still applies after rectify (the still keeps its dimensions, so the homography scale is unchanged).

## R3 (P1, split) · Bridge origin allowlist — `c75c3014`
- **Fixed (mechanical):** `isTrustedHostedAppOrigin` compared `url.hostname` (port-blind), so `https://kerfdesk.com:444` was accepted. Now compares `url.origin` against a set of full origins — a non-default port or wrong scheme refuses. Test-first.
- **Documented, NOT closed (by design):** hosted-origin access to the loopback bridge is deliberate (ADR-121 — the deployed site is a bridge client), so a compromise/XSS of an exact trusted origin can still drive discover/probe/frame against RFC1918/ULA cameras. Recorded as an accepted residual in the ADR-133 amendment with per-session token as the deferred mitigation — **please treat R3 as "port fixed + residual documented," not "closed."**

## R4 (Major) · DEV-06 asymmetric + object overrides — `9195a90c`
- **Was:** compared the fastest output-**layer** speed against a scalar `maxFeed` (the greater of $110/$111). Missed asymmetric axes and object `operationOverride.speed`.
- **Fix:** `parse-settings` retains raw `maxFeedX/maxFeedY` on the snapshot (extra fields, not DeviceProfile keys — `maxFeed` stays collapsed for the planner). The advisory compares the emitted feed against the **lesser** reported axis rate and folds object overrides on output layers into the emitted-speed scan. Advisory only (conservative over-warn is acceptable).
- **Test:** asymmetric + object-override cases that are silent today; negative twins (symmetric-under, profile-clamped-override) stay silent; parse-settings retains the per-axis rates.
- **Audit hints:** object→layer matching is by `sceneObjectUsesLayerColor` on any output-on layer — confirm a hidden-output-layer object can't trigger a phantom warning.

## R5 (P2) · Name the bit at the hold — `263a99a6`
- **Was:** the next bit was emitted only as a G-code comment (stripped by the streamer); the UI showed a generic "Load the next bit."
- **Fix:** emitter + a pure `extractToolChangeLabels` share `TOOL_CHANGE_LOAD_PREFIX`. `startJob` extracts the CNC labels; each tool-change entry (in `startJob`'s synchronous first step, or `advanceStream` for later holds) consumes the head into a new `pendingToolLabel`; `RunningControls` names the bit. Threaded through the **store**, not the streamer (no streamer-mock churn); **G-code byte-identical** (prefix → const; snapshot suite green).
- **Audit hints:** confirm the label index stays aligned across multiple M0s — labels are consumed head-first from `toolChangeLabels`, and both entry paths (startJob step + advanceStream) consume exactly once. An imported `.nc` / resume tail with a bare M0 correctly shows the generic prompt (`?? null`).

## R6 (P2) · Remaining clipper boundaries — `d76fe639`
- **Fix:** `kerf-offset.ts` `inflatePathsD` and `panel-fit.ts` `differenceD` are now wrapped in `tryVectorOp`, converting a clipper throw to each caller's **existing** contract — the kerf offset returns its empty "no usable contours" array (all 13 callers already handle empty); `applyPanelFit` returns the `degenerate` result. No signature change.
- **Test:** clipper mocked to throw at each site → empty / degenerate, not a propagated throw.
- **Exhaustive check:** these were the only two unwrapped entry points; every union/difference/intersect/xor/inflate call now sits inside `tryVectorOp` (difference/intersect/xor via `runBooleanOp` under a wrap).

---

## Standing caveats (unchanged)
- **No hardware / no perceptual check.** R1 (resume), R2 (overlay pixels), R4/R5 (CNC) are unit/simulator-proven only. R2's overlay alignment and any CNC tool-change/resume behaviour on metal remain unverified.
- **R3's hosted-origin residual and the per-session token are a maintainer decision**, not a bug I can close.

## Suggested adversarial focus
1. **R1** — a resume where the operator re-zeroed (WCO changed) between crash and resume: does the frozen-origin compile + live-offset preflight do the right thing?
2. **R2** — is there any overlay path (network/machine still) that still reaches a raw-pixel warp with a rectified alignment?
3. **R5** — label/M0 alignment when a resume tail re-streams part of a multi-tool job.
