# V-carve G-code compilation performance

Worktree: `D:/LaserForge/gcode-compile-performance-20260927`

Base: `1b12a71ce` (`origin/main` when work began)

Decision: [ADR-444](../decisions/ADR-444-vcarve-compilation-work-reuse.md)

The reported operation was CNC V-carve, with the preview displaying "Merging ordered
regions". The original project was not available as a reproducible fixture. Measurements
below use dense synthetic geometry and the existing four-artwork Dancing Script project.

## Findings and changes

- **Repeated source preparation:** planning and final assembly each collected, transformed
  and merged the same source contours. The bound compilation now retains its own prepared
  contours until assembly. A regression failed with two collections before the fix and now
  requires one. Later project edits create separate preparation state.
- **All-pairs nesting:** source-layout discovery repeatedly scanned contour coordinates and
  rebuilt edge indexes. It now prepares bounds once, uses the tracer's inclusive spatial
  index, and builds each required edge index once. Whole-contour predicates are unchanged.
- **All-pairs region assignment:** merge ranking and clearing-ring assignment evaluated
  unrelated source outlines. They now query the same kind of spatial index and restore
  the original candidate order before applying existing depth and source-order rules.
- **Repeated coverage calculations:** source-boundary measurement recalculated chord radii
  and constants for every witness. It now prepares unique represented chords once and
  conservatively rejects distant sweeps. Sampling and output precision are unchanged.
- **Repeated pass checks:** compaction recalculated the same endpoint membership for each
  candidate span. It now reuses that result within one synchronous compaction call, keeping
  all chord-clearance and swept-coverage checks. A two-breakpoint calculation also avoids
  repeated Set construction and sorting.
- **Incomplete benchmark:** the connected-script timing helper omitted source-boundary
  coverage, although real region workers execute it. The helper now includes that stage.

## Measured evidence

The unchanged connected-script program contains 1,083,336 UTF-8 bytes, SHA-256
`e211745f82754855ebd20683a3c19f256e877488282b2df34c60a7c84ea26740`.

### Connected-script compilation

The final sequential comparison measured **31.89 seconds before and 17.31 seconds after**:
45.7% less time, or a 1.84x speedup for this fixture, with identical emitted G-code.
Both revisions use the corrected timing helper, including source-boundary coverage.

| Stage | Before | After |
| --- | ---: | ---: |
| Preparation before region tasks | 0.188 s | 0.215 s |
| Region geometry | 5.700 s | 5.656 s |
| Region passes | 24.048 s | 10.296 s |
| Source-boundary coverage | 1.305 s | 0.519 s |
| Final assembly | 0.037 s | 0.011 s |
| G-code emission | 0.607 s | 0.609 s |
| **Total** | **31.887 s** | **17.307 s** |

These are one measured run per revision, performed sequentially after this task's other
build and test processes finished. Other applications and tasks remained running. The
synchronous fixture measures summed region work, not browser worker-pool wall time. Earlier
runs under concurrent verification load measured 30.53 seconds before and 24.56 seconds after;
the timing variation is why deterministic work counts and exact output comparisons also matter.

Reproduction uses the same installed dependencies and command in the baseline and changed
worktrees:

```powershell
node node_modules/vitest/vitest.mjs run src/io/gcode/connected-script-compile-performance.test.ts --maxWorkers=1 --disableConsoleIntercept --silent=false
```

The baseline worktree is `D:/LaserForge/gcode-compile-baseline-20260927`, detached at
`1b12a71ce`, with only the corrected test timing helper copied in. Its production code is
unchanged. Raw results are in `connected-script-baseline-sequential.txt`,
`connected-script-after-sequential.txt` and `sequential-summary.json` in the evidence directory.

### Dense geometry and repeated work

The old-reference probes preserve identical layouts, ranking, ownership, coverage and paths.

| Fixture / work | Before | After |
| --- | ---: | ---: |
| 600 disconnected dense contours: merge-ranking polygon tests | 360,000 | 600 |
| Same contours: clearing-ring assignment polygon tests | 180,300 | 600 |
| 64 nested contours: boundary-index builds | 2,016 | 63 |
| 64 represented chords / 128 witnesses: envelope calculations | 8,192 | 64 |
| Same coverage fixture: XYZ representations | 384 | 195 |
| V-carve source collection per bound compilation | 2 | 1 |

In the integrated run, the 600-contour nesting probe fell from 1,266 ms to 14 ms; merge
ranking fell from 773 ms to 14 ms; ring assignment fell from 296 ms to 2.5 ms. These are
stage-specific measurements, not whole-job speed claims.

A separate V8 sampling profile of the largest connected-script region recorded pass work
falling from 5.02 to 1.09 seconds of inclusive samples, including compaction falling from
3.66 to 0.54 seconds. This is CPU sampling evidence, not a wall-clock benchmark. Its saved
pass output remained exactly 339,637 bytes with SHA-256
`faab5d200ac46dbdd6994469079139b104a54ad432b0c0360a2a26335cc4aae0`.

Detailed measurements and profiles are retained locally under
`D:/LaserForge/gcode-compile-evidence-20260927`.

## Verification

- The integrated CNC/G-code, output preparation and worker protocol/pool suites covered
  174 files: 1,258 tests passed, three hit their time limits, and one opt-in benchmark was
  skipped. There were no assertion failures.
- The tapered-ball layout file passed when rerun with one worker. The adaptive-pocket and
  relief-roughing coverage files still encountered local timeouts under shared-machine load;
  all 18 tests passed with `CI=true --maxWorkers=1 --testTimeout=30000`. The curved adaptive
  pocket uses its existing 60-second CI allowance. No test source or repository timeout was
  changed to accommodate these runs. The modified compaction regression also passed again.
- Focused tests compare frozen original algorithms against the changes, including touching
  and crossing contours, holes, islands, source-order ties, boundary rounding, invalid and
  extreme coordinates, duplicate chords, changing envelopes, later project edits and empty
  V-carve plans. Deterministic call counts verify that repeated work was actually removed.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, production `vite build` (including PWA
  generation), ADR numbering, file-size policy, index-export policy and `git diff --check`
  passed. The build emitted bundle-size advisories.
- Independent review found no actionable issues in numeric equivalence, cache lifetime,
  device-coordinate reuse, operation identity or worker ownership.

## Verification boundary

These are local software measurements and output-equivalence checks. The user's exact
design and physical machine operation have not been measured. These measurements do not
establish hosted deployment; publication requires separate CI and served-build evidence.
