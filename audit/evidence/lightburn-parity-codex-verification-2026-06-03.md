# LightBurn Parity Codex Verification Evidence - 2026-06-03

## Repository Identity

Commands:

```powershell
Test-Path 'C:\Users\Asus\LaserForge-2.0'
git status --short --branch
git remote -v
```

Observed:

- `C:\Users\Asus\LaserForge-2.0` exists.
- Branch is `codex/main-working...origin/codex/main-working`.
- Remote was previously verified as `https://github.com/cisgz3a-hub/LaserForge-2.0.git`.

## Source Claims Checked

### Path optimization

Checked:

```powershell
rg -n "optimizePaths|nearest|raster|MAX_NEAREST|contain|inside" src/core/job/optimize-paths.ts
```

Result:

- Current optimizer is nearest-neighbor for cut groups.
- Raster groups pass through.
- No containment/inside-first ordering found.

Audit conclusion: confirmed.

### Raster duration estimate

Checked:

```powershell
rg -n "estimateJobDuration|jobWithRasterSweeps|rasterAsFillSweepGroup|rasterActiveSweepSegments|if \\(group.kind === 'raster'\\)" src/core/job/planner.ts src/core/job/estimate-duration.ts src/core/job/estimate-duration.test.ts
```

Result:

- `planner.ts` skips raw raster groups.
- `estimateJobDuration` calls `estimateWithPlanner(jobWithRasterSweeps(job), device)`.
- Raster groups are converted into fill sweep groups before public duration estimation.

Audit conclusion: original raster-undercount claim is stale/overbroad in current tree.

### Laser-off travel invariant

Checked:

```powershell
rg -n "findLaserOnTravelIssues|runPreflight|emitGcode|findOutOfBoundsCoords" src/core src/io src/ui
```

Result:

- `findLaserOnTravelIssues` exists in invariants and tests.
- `runPreflight` imports bounds checking, not the laser-on-travel predicate.
- Current GRBL output strategy emits `S0` on `G0`.

Audit conclusion: static invariant is not wired into preflight; current emitter behavior is safer than the missing gate alone implies.

### Pause/feed-hold behavior

Checked:

```powershell
rg -n "RT_HOLD|RT_SOFT_RESET|pauseJob|stopJob|disconnect" src/core/controllers/grbl/commands.ts src/ui/state/laser-store.ts
```

Result:

- `RT_HOLD = '!'`.
- `pauseJob` sends `RT_HOLD` only.
- `stopJob` sends `RT_SOFT_RESET`.
- Running-job disconnect path sends `RT_SOFT_RESET` before disconnect.

Audit conclusion: pause semantics need a safety decision and tests.

### Job origin

Checked:

```powershell
rg -n "JobStartMode|JobOriginAnchor|USER_ORIGIN_JOB_PLACEMENT|applyJobOrigin|jobOrigin" src/core/job/job-origin.ts src/ui/laser/start-job-readiness.ts
```

Result:

- Core has 9 anchors.
- Default absolute/user-origin placement constants use front-left.
- Start readiness uses `USER_ORIGIN_JOB_PLACEMENT`.

Audit conclusion: 9-anchor math exists, UI/workflow parity does not.

### Raster image settings

Checked:

```powershell
rg -n "DitherAlgorithm|LayerDitherAlgorithm|threshold|floyd|grayscale|jarvis|stucki|ordered|atkinson" src/core/raster src/core/scene src/ui/layers src/core/trace
```

Result:

- Raster layer dither supports threshold, Floyd-Steinberg, grayscale.
- Trace dither supports a broader 13-mode set.

Audit conclusion: raster engrave path is much thinner than LightBurn image modes.

### SVG import

Checked:

```powershell
rg -n "parseViewBox|parseTransform|presentationStateFor|querySelectorAll|href|symbol|use|parseFloat" src/io/svg/parse-svg.ts src/io/svg/shape-to-polylines.ts
```

Result:

- Recursive presentation state and transform parsing exist.
- Width/height use `Number.parseFloat`.
- No confirmed `<use>`/`<symbol>` expansion found.

Audit conclusion: reject stale "no transforms" claim; keep unit/use/symbol residual finding.

### Scope boundaries

Checked:

```powershell
rg -n "Out of scope|Boolean|node|offset|kerf|tabs|bridges|lead|DXF|PDF|variable text|LightBurn feature parity" PROJECT.md DECISIONS.md
```

Result:

- Boolean ops, node editing, offset/kerf, tabs/bridges, lead-in/out, DXF/PDF, camera, rotary, and variable text are not authorized scope.
- `DECISIONS.md` says LightBurn parity guidance is behavior guidance, not automatic scope expansion.

Audit conclusion: advanced editing parity must not be silently added to implementation queue.

## External Documentation Claims Checked

### LightBurn Optimization Settings

URL: https://docs.lightburnsoftware.com/latest/Reference/OptimizationSettings/

Relevant checks:

- Order By Layer follows the Cuts/Layers list.
- Order By Priority exists.
- Cut Inner Shapes First is documented to avoid pieces falling out before internal cuts complete.

### LightBurn Image Mode

URL: https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/ImageMode/

Relevant checks:

- Image modes include Threshold, Ordered, Dither, Atkinson, Stucki, Jarvis, Newsprint, Halftone, Sketch, Grayscale, and Passthrough.
- Image settings include overscanning, line interval/DPI, and image adjustments.

### LightBurn Shared Settings

URL: https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/SharedSettings/

Relevant checks:

- Shared settings expose Speed, Max Power, and Min Power.
- Min Power requires firmware-aware interpretation.

### LightBurn Coordinates and Job Origin

URL: https://docs.lightburnsoftware.com/latest/Reference/CoordinatesOrigin/

Relevant checks:

- Start From choices include Absolute Coords, Current Position, User Origin, and Stored Position.
- Job Origin is a 9-dot selector.

### LightBurn Job Control

URL: https://docs.lightburnsoftware.com/latest/GetStarted/JobControl/

Relevant checks:

- Stop cancels the job.
- Pause pauses the job so it can resume.
- Software Stop is a convenience; a physical emergency stop remains required.

### GRBL v1.1 Commands

URL: https://github.com/gnea/grbl/wiki/Grbl-v1.1-Commands

Relevant checks:

- `!` is feed hold.
- `~` is cycle start.
- Ctrl-X is soft reset.
- Feed hold pauses motion but does not disable spindle/coolant.

