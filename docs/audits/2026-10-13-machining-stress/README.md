# Machining stress test results

This is the original, pre-repair evidence. The subsequent coincident-entry
repair and fresh verification are recorded in [the repair report](fix/README.md).

The software checks passed, but the large-path stress run exposed a planning
performance limit for many coincident paths. This is preparation time in the
path optimiser, not measured machine cutting time.

Tested on 13 October 2026 against
`c700863a14dfbed71a49e32182ec3b75b989ebb1`. Production machining behaviour was
unchanged. The earlier audit's edit to `optimize-paths.ts` changes comments only.
No controller, hardware, provider or deployment state was changed.

## Existing correctness and performance tests

**937 tests passed across 107 distinct files. No failures remain in these
cohorts.** The opt-in dense coverage benchmark was run separately; the tests
filtered out of that invocation had already passed in the main performance run.

| Cohort | Files | Tests passed |
| --- | ---: | ---: |
| Laser geometry, raster, topology and placement | 18 | 132 |
| CNC motion, relief, ramps, tabs and containment | 25 | 232 |
| Controller transport, power and timing | 50 | 475 |
| Ruida controller and binary protocol | 5 | 51 |
| Ruida file output and preflight | 3 | 20 |
| Large-job and performance fixtures | 6 | 26 |
| Opt-in dense coverage benchmark, same file as above | 0 additional | 1 |

The CNC cohort included 2,724 documented property cases; the controller cohort
included 1,600 fast-check samples with seed 20261013, plus ACK chunking seeds
1 through 60. Those samples are internal cases within the tests above, not extra
test-file totals. The controller fixtures included a 200,000-line job and
Ruida's complete 256 by 256 byte-swizzle space.

The connected-script CNC fixture compiled and emitted 1,100,098 bytes in about
7.53 seconds on this run, with the expected exact output SHA-256:
`6213711b652de729c1d4c57f905817bf39eab2ef86e8d8a1627f37ba20a6dbc6`.
The 1,000-object laser workflow stayed within all existing phase budgets; its
100,000-line software streaming phase took about 64 ms. That streaming figure
measures the fixture's software work, not transmitting or machining those lines.

Tests used one worker per cohort. Correctness cohorts overlapped; the performance
cohort and new route stress ran separately from other audit test processes.
Existing assertions, fuzz counts and performance limits were not weakened.
[Counts and runtime environment](test-summary.json),
[CNC reproduction manifest](cnc-correctness-manifest.json), and
[controller reproduction summary](transport-summary.json) retain the details.
The `.txt` logs preserve complete test output alongside the JSON reports.

## New large-path stress

The new runner exercised 1,000, 10,000 and 50,000 paths; grid, clustered,
coincident and four-level nested layouts; seeds 17, 491 and 20261013; and both
preserved direction and permitted open-path reversal.

**33 of 36 fixtures passed, with 66 fully checked route cases. Three fixtures
timed out, leaving six route cases incomplete.** All timeouts were 50,000-path
coincident layouts, one at each seed. Completed cases preserved cut geometry,
segment multiplicity, direction rules, power/feed/pass settings and input
immutability. Repeated ordering was deterministic. Nested parents followed
their children. A separate small exhaustive nearest-neighbour oracle checked
entry selection without using the production spatial index.

The 30-second limit applies to the entire fixture worker: setup, both direction
modes, repeated calls and verification. A timeout does not establish that one
optimiser call alone took 30 seconds, and it does not qualify the unfinished
geometry checks as passes. The worker's V8 old-generation limit was 768 MiB;
recorded heap snapshots are not peak process memory measurements.

| Paths | Layout | Observed first optimiser call range |
| --- | --- | ---: |
| 10,000 | Grid | 0.029–0.075 s |
| 10,000 | Clustered | 0.089–0.289 s |
| 10,000 | Coincident | 0.769–3.269 s |
| 10,000 | Nested | 0.065–0.158 s |
| 50,000 | Grid | 0.213–0.435 s |
| 50,000 | Clustered | 1.136–3.954 s |
| 50,000 | Nested | 0.352–1.505 s |
| 50,000 | Coincident | Full fixture exceeded 30 s at all three seeds |

These ranges include both direction modes across the three seeds. They describe
this local run, not universal performance guarantees.
[Full event log](large-paths-results.jsonl) and
[aggregate metrics](large-paths-summary.json) preserve the results.

An independent review then added explicit checks that the result and repeated
result contain exactly one group. The strengthened runner passed a separate
64-path smoke run: 12 fixtures and 24 route cases. The full run above used the
earlier runner; exact copies of both versions and their SHA-256 values are
retained. The stronger smoke checks are not retroactively claimed for the full
run. [Version hashes](large-paths-sha256.json) and
[reviewed smoke results](large-paths-reviewed-smoke.jsonl).

Source snapshots carry `.mjs.txt` suffixes to preserve their bytes as evidence,
without treating them as executable copies. The original local hash manifest
is retained in `large-paths-sha256-original.txt`; the JSON manifest uses the
publication paths. JSON reports were whitespace-formatted for the PR only.

The separate single-call diagnostic reproduced the bottleneck with 50,000
coincident paths, seed 17, preserved direction, and no repeat or small oracle.
Setup reached the optimiser after 1.334 seconds; the first optimiser call did
not return before the unchanged 30-second whole-worker deadline. Thus setup and
repeated verification alone do not explain the full-run timeouts.
[Diagnostic event log](large-paths-coincident-single-call.jsonl).

Reproduce from the repository with the current reviewed runner:

```powershell
node scripts/stress-quality-first-paths.mjs
node scripts/stress-quality-first-paths.mjs --smoke
node scripts/stress-quality-first-paths.mjs --diagnose-coincident
```

Exit code 1 records an invariant failure or timeout; consult the JSON events to
distinguish them. The saved runner copies are source snapshots, not entrypoints
to execute from this evidence folder. [Recorded commands](large-paths-command.txt).
The reviewed runner passed ESLint and formatting; repository file-size policy
and `git diff --check` also passed.

## Performance finding

The nearest-entry index places many coincident endpoints in the same spatial
bucket. Each selection scans the remaining live entries in that bucket. With
many identical entry coordinates, the total work can approach quadratic growth
despite the grid. This agrees with the measured slowdown from 1,000 to 10,000
coincident paths and the 50,000-path timeouts.

The next focused repair is to handle identical entry coordinates efficiently
while retaining the exact distance/index/direction/start-vertex tie rules.
It must preserve repeated cuts; deleting duplicate geometry would change job
semantics. Re-run these cases and the independent entry oracle after that change.

This stress run does not establish minimum job time or physical cut quality.
The timing and route-selection limitations in the
[machining audit](../2026-10-13-quality-first-machining-path-audit.md) still apply.
