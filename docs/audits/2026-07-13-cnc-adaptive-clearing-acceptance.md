# CNC Adaptive Clearing Acceptance

Date: 2026-07-13

## Accepted Contract

- Adaptive clearing is available for end mills on one or more closed, island-free pockets.
- Optimal load defaults to 10% of tool diameter and is capped at 50%.
- The planner emits deterministic roughing rings with a native helical-contour entry, followed by conventional cleanup contours.
- An independent stock-removal verifier must confirm bounded engagement and at least 98.5% stock coverage before compilation.
- Verification refuses jobs exceeding its 1,000,000-cell simulation budget instead of reducing resolution silently.
- Pockets containing islands are blocked with a dedicated preflight message until a true medial-axis trochoidal planner is available.

## Automated Evidence

- Planner tests cover square pockets, deterministic disconnected pockets, invalid settings, and the explicit island refusal.
- Verifier tests cover bounded engagement, synthetic full-slot rejection, disconnected-pocket coverage, and simulation-budget refusal.
- Compiler tests confirm native `helical-contour` roughing, conventional cleanup, deterministic output, and `G3` arc output.
- Preflight and project tests cover valid settings, invalid load, island refusal, round-trip serialization, and malformed-value removal.
- `pnpm release:check` passed in 448.3 seconds, including repository guards, type checking, lint, formatting, license and dependency checks, unit tests, Playwright, web and Electron builds, and file-size limits.

## Browser Acceptance

Tested at `http://127.0.0.1:5179/` with a 3.175 mm end mill:

1. Created a closed rectangle and switched the application to CNC.
2. Changed the layer to Pocket and enabled advanced cut settings.
3. Selected Adaptive clearing; Stepover was removed and Optimal load appeared as `0.3175 mm`.
4. Resized the pocket to 30 x 30 mm and opened Preview.
5. Preview produced a visible multi-pass route and populated cut, travel, plunge, total-distance, and time statistics.
6. Browser console inspection returned no warnings or errors.

The original 215.2 x 227.7 mm trial exceeded the verifier's fixed simulation budget and was refused. This is expected fail-closed behavior, not accepted large-pocket coverage.

## Score Impact

This closes the missing adaptive-clearing workflow for bounded island-free pockets and materially strengthens the CNC 2D/2.5D sector. It does not by itself justify a score above 9.0 because island-aware adaptive clearing remains deliberately unsupported. The competitive score should move only after the stacked PR is merged and the sector audit is rerun from observed behavior.
