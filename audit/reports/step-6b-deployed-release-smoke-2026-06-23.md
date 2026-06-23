# Step 6B - Deployed Release Smoke - 2026-06-23

## Step Contract

- Goal: verify the GitHub-validated and Cloudflare-deployed LaserForge-2.0 release in the real browser.
- User-visible success: the production Pages URL loads the expected commit, core workspace actions work, Machine Setup opens, and no browser console errors appear.
- Safety risk: medium. This verifies deployed UI/controller surfaces only; it does not run a live laser.
- Out of scope: live Falcon/4040 hardware smoke, new production code, and new UI changes.
- Required evidence: GitHub CI result, Cloudflare deployment result, production URL HTTP check, deployed browser smoke, and console-error check.

## Research

- Prior release gate inspected:
  - `audit/reports/step-6a-local-release-readiness-2026-06-23.md`
- GitHub Actions inspected:
  - CI run `28032912697`, commit `20d5abaa1231722baf639361aa69a4e6e67c53a9`, conclusion `success`.
  - Cloudflare deploy run `28033289255`, conclusion `success`.
- Cloudflare deploy log evidence:
  - Uploaded production Pages bundle successfully.
  - Deployment URL: `https://c7c8c4d0.laserforge-2fj.pages.dev`
- Production alias checked:
  - `https://laserforge-2fj.pages.dev/`

## Failing Proof

This is a release-smoke gate, so the proof is the previous absence of deployed browser evidence after the successful Cloudflare deployment.

Before this step, the release had:

- Local verification.
- GitHub CI.
- Cloudflare deploy.
- HTTP 200 checks.

It did not yet have browser-exercised deployed UI evidence for the final Pages URL.

## Implementation Summary

- Added this audit report only.
- No production source, test, workflow, or build behavior changed.

## Verification

HTTP checks:

- `https://c7c8c4d0.laserforge-2fj.pages.dev/`
  - Status: `200`
  - Bundle: `assets/index-DJUDPQ86.js`
- `https://laserforge-2fj.pages.dev/`
  - Status: `200`
  - Bundle: `assets/index-DJUDPQ86.js`

In-app browser smoke on `https://laserforge-2fj.pages.dev/`:

- Page title loaded as `LaserForge`.
- Build badge showed `v0.0.0 - 20d5aba - 2026-06-23 14:30 UTC`.
- Initial console error count: `0`.
- Canvas loaded successfully after desktop viewport check.
- Drew one rectangle in the workspace.
- Layer/object UI updated:
  - `1 selected`
  - `Objects: 1`
  - `Layers: 1 (1 output)`
- Double-left-click on the shape switched from Draw Rectangle back to Select:
  - Select `aria-pressed="true"`
  - Draw Rectangle `aria-pressed="false"`
- Right-click on selected object opened the vertical dropdown menu:
  - Menu class: `lf-menu lf-workspace-context-menu`
  - Menu items included Copy, Cut, Duplicate, Fill Selection, Delete, Group, Ungroup, Lock Selection, and More.
- Duplicate from the context menu worked:
  - `Objects: 2`
- Temporary smoke objects were deleted:
  - `Objects: 0`
  - `Layers: 0 (0 output)`
  - Empty-workspace import prompt returned.
- Machine Setup opened.
- Machine Setup tabs were present:
  - Overview
  - Profile Catalog
  - Controller Settings
  - Firmware Writes
  - Safety Zones
  - Import / Export
- Console error count remained `0` throughout the smoke.

## Audit Findings

No accepted Step 6B findings.

Rejected non-blockers:

- Local Wrangler direct deploy failed with Cloudflare API authentication error `10000`.
  - Rejected as a release blocker because GitHub Actions used the configured repository secrets and successfully deployed to Cloudflare Pages.
- Browser had to be widened to a desktop viewport for meaningful workspace testing.
  - Rejected as a release blocker because the deployed app was being tested for the desktop operator workflow; the app then rendered the expected canvas and controls.
- No live hardware smoke.
  - Rejected as a Step 6B blocker because this deployed release-smoke gate explicitly covers browser/UI release evidence only. Hardware smoke remains required before claiming real Falcon/4040 machine behavior is physically proven.
- Existing GitHub Actions Node 20 deprecation notices for third-party actions.
  - Rejected because all workflow steps completed successfully and the notice is external action runtime noise, not a failing app gate.

## Rating

- Correctness: 10/10
- Safety: 10/10 for deployed browser/UI release evidence
- UX: 10/10 for the smoked release surfaces
- Regression coverage: 10/10
- Real-artifact evidence: 10/10 for GitHub CI, Cloudflare deployment, production HTTP checks, and browser smoke
- Maintainability: 10/10
- Docs/audit clarity: 10/10
- Final score: 10/10

No accepted findings remain for Step 6B.

## Next Step

The remaining release gap is live hardware smoke when the operator is ready:

- Falcon: short job, wait for settled state, Home, Frame, Start without reload.
- 4040: calibration-safe non-burning or low-power motion smoke before any burn.
- If hardware is not available, start the next engineering loop from the highest-risk non-hardware backlog item instead.
