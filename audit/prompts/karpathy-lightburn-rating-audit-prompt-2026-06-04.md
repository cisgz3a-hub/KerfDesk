# Karpathy LightBurn Whole-Repo Rating Audit Prompt

Date: 2026-06-04

Repo: `C:\Users\Asus\LaserForge-2.0`

Purpose: produce a 0-10 engineering rating for LaserForge by checking the real
code, real commands, real workflow behavior, and current reference docs. Do not
patch production code during this audit.

## Operating Rules

1. Verify repo identity before judging anything.
   - `git status --short --branch --untracked-files=all`
   - `git remote -v`
   - `npm run guard:repo`
2. Read local sources of truth before scanning code.
   - `CLAUDE.md`
   - `WORKFLOW.md`
   - `PROJECT.md`
   - `DECISIONS.md`
   - `AUDIT.md`
   - current roadmap and audit reports under `docs/` and `audit/reports/`
3. Use LightBurn as the workflow reference, not as a mandate to clone every
   feature.
4. Every accepted finding needs:
   - path and module/function/component
   - trigger path
   - failure mode
   - operator or release consequence
   - severity
   - confidence
   - concrete fix
   - verified source or command evidence
5. Reject stale findings after checking current code and tests.
6. Give a score only after false positives are removed.
7. Treat hardware-safety claims as unproven unless there is command, fixture,
   exported G-code, or supervised burn evidence.

## Reference Research

Use current official docs where possible:

- LightBurn Trace Image:
  https://docs.lightburnsoftware.com/latest/Reference/TraceImage/
- LightBurn Convert to Bitmap:
  https://docs.lightburnsoftware.com/latest/Reference/ConvertToBitmap/
- LightBurn Layer Modes:
  https://docs.lightburnsoftware.com/latest/Explainers/LayerModes/
- LightBurn Image Mode:
  https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/ImageMode/
- LightBurn Coordinates and Job Origin:
  https://docs.lightburnsoftware.com/latest/Reference/CoordinatesOrigin/
- LightBurn Overscanning:
  https://docs.lightburnsoftware.com/2.0/Explainers/Overscanning/
- LightBurn Job Control:
  https://docs.lightburnsoftware.com/2.0/GetStarted/JobControl/
- GRBL streaming:
  https://github-wiki-see.page/m/grbl/grbl/wiki/Interfacing-with-Grbl
- GRBL realtime commands:
  https://github-wiki-see.page/m/gnea/grbl/wiki/Grbl-v1.1-Commands
- MDN Canvas `toDataURL`:
  https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toDataURL
- Electron security:
  https://www.electronjs.org/docs/latest/tutorial/security

## Workflow Lanes To Audit

1. Repo/deploy identity
   - wrong-repo guard
   - branch and remote
   - CI/deploy commands
2. Import and trace workflow
   - image import
   - trace source provenance
   - worker/fallback behavior
   - LightBurn Trace Image control parity
3. Convert to Bitmap and raster engraving
   - render type, DPI, luma convention
   - pixel budget before heavy work
   - main-thread freeze risk
   - preview/output/start consistency
4. SVG/vector/text import
   - filled geometry
   - stroke geometry
   - transforms
   - physical units
   - `<use>` and local symbol reuse
5. Output and GRBL
   - preflight
   - prepare-output shared truth
   - laser-off travel
   - GRBL buffer and error handling
   - disconnect warnings and recovery
6. Operator workflow parity
   - Cuts/Layers controls
   - Start From and Job Origin
   - Frame, Preview, Start, Save G-code
   - dirty-file behavior
7. Security and platform
   - SVG sanitization
   - Electron preload/main boundaries
   - Web Serial permissions
   - Cloudflare headers/routing
8. Tests and process
   - typecheck, lint, format, unit suite, build
   - license and dependency audit
   - hardware verification ledger

## Rating Rubric

- 9-10: production-grade for the scoped hardware workflow, clean CI, hardware
  proof for safety-critical paths, and LightBurn-critical workflows present.
- 8-8.9: strong architecture and tests, only moderate feature gaps or
  non-blocking proof gaps.
- 7-7.9: usable and improving, but blocked by at least one release gate or
  several LightBurn-critical workflow gaps.
- 6-6.9: important functional areas still unreliable or unproven.
- below 6: unsafe, unshippable, or unable to run core workflows.

Score the current checkout, not the intended roadmap.
