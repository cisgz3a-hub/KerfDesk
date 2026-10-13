# Coincident path planning repair

The repair retains every intended cut. It groups exact coordinate locations
inside the nearest-entry lookup and keeps all original entries in deterministic
queues. Selecting the next eligible entry no longer rescans every remaining
coincident path. Coordinates are not rounded and geometry is not deduplicated.

This changes preparation speed, not cutting feeds, passes or machining time.
The planner remains greedy nearest-neighbour; this repair does not claim a
globally shortest route or certify physical surface quality.

## Stress result

**36 of 36 fixtures passed, covering 72 route cases, with zero failures or
timeouts.** This reruns 1,000, 10,000 and 50,000 paths, four layouts, three seeds
and both direction policies with the original deadline. Every case retains cut
geometry and multiplicity, settings and immutable input; repeat ordering is
deterministic. Nested fixtures verify child-before-parent precedence.

| Paths | Layout | Before: first call | After: first call |
| --- | --- | ---: | ---: |
| 10,000 | Grid | 0.029–0.075 s | 0.041–0.050 s |
| 10,000 | Clustered | 0.089–0.289 s | 0.122–0.269 s |
| 10,000 | Coincident | 0.769–3.269 s | 0.014–0.024 s |
| 10,000 | Nested | 0.065–0.158 s | 0.064–0.078 s |
| 50,000 | Grid | 0.213–0.435 s | 0.203–0.271 s |
| 50,000 | Clustered | 1.136–3.954 s | 1.726–2.729 s |
| 50,000 | Coincident | Not completed within fixture deadline | 0.079–0.288 s |
| 50,000 | Nested | 0.352–1.505 s | 0.321–0.381 s |

The original 50,000-path coincident fixture timed out at all three seeds.
These ranges cover both directions and all three seeds, not paired medians or
universal guarantees. Smaller and non-coincident cases show ordinary timing
variation; this is a targeted coincident-path improvement.

The separate single-call diagnostic, seed 17 and preserved direction, returned
in **90.599 ms** after 1.303 seconds of setup. The original diagnostic reached
the optimiser after 1.334 seconds and never returned before the same 30-second
whole-worker deadline. Full-run and diagnostic JSONL logs retain exact metrics.
Timed runs were sequential, after all other audit test processes finished.

## Source and regression evidence

Baseline: `c700863a14dfbed71a49e32182ec3b75b989ebb1`.
Final index SHA-256:
`1df529d90f94efc0373a24237ef6a86d9731bd206dce79ca09e738c6bfc6bd06`.

Production logic changes only in `src/core/job/segment-entry-index.ts`.
The earlier `optimize-paths.ts` edit corrects its explanatory comment.
`segment-entry-index-coincident.test.ts` adds ten substantive regressions.
ADR-163 Amendment 1 records the lookup contract and its limits.

Against the original source, two 4,096-path work-bound tests fail: 8,394,752
availability checks at one location and 8,398,848 at two locations, against
bounds of 32,768 and 65,536. All ten pass against the repair. These count actual
lookup work, rather than relying on noisy elapsed-time assertions.

The tests retain object identity, stable segment/direction/start-vertex ties,
signed-zero handling, one-ULP-distinct coordinates, non-consuming queries,
monotone retirement and immutable input. Three seeded duplicate-heavy cases
compare with an independent exhaustive oracle.

The saved baseline loader and source reproduce the original failure. The loader
now pins the baseline commit so it remains usable after merge; the historical
`coincident-regression-evidence.txt` describes its original HEAD-based version.
The baseline failure is expected evidence and is excluded from passing totals.

## Output preservation

The final source matched the original on **192 complete ordered jobs and 1,152
emitted programs**, byte for byte, across GRBL, grblHAL, FluidNC, Marlin,
Smoothieware and Ruida binary encoding. Cases exercise both open-path direction
policies and all three closed-shape start policies. Another 3,660 direct
queries per version match an exhaustive oracle across duplicate, shuffled,
signed-zero, subnormal, underflow and very large finite coordinates.

See `entry-index-comparison-final.txt`. `compare-entry-index.mjs` pins the
baseline commit and independently loads each source in a separate Vite server.
The earlier `entry-index-comparison.json` records the first repair before a
lint-only dense-array iteration cleanup; the final comparison verifies that
cleanup too. No feed, power, pass, tool or process setting is traded for speed.

## Verification and reproduction

**1,025 distinct tests passed across 117 files, with no failures or untested
skips after combining the benchmark runs.** This includes the original 937-test
stress cohort, ten new coincident-entry regressions and 78 additional planner
tests. Repeated focused runs are counted once. All six performance files and
the opt-in dense coverage benchmark passed their unchanged checks.

Fresh reports retain the original test assertions, seeds and time limits.
CNC/transport commands and per-run source hashes are in
`cnc-transport-summary.json`. Early cohorts used the first repair hash; later
ones and the final focused tests use the final hash after the equivalent
`points.entries()` loop cleanup. No production change followed that cleanup.

`verification-summary.json` deduplicates test cases by file, declaration index
and full name, and reconciles the opt-in benchmark with its main file run.
It also checks that travel distances match all 66 completed pre-repair cases.
The stronger reviewed stress runner additionally verifies exact group count.

`commands.ps1` records reproduction commands. Run performance commands
sequentially after other audit tests finish. The large-path runner retains its
30-second whole-worker deadline and 768 MiB V8 old-generation limit. That is
not a whole-process memory limit, and its heap snapshots are not peak memory.
Archived runner and index copies use `.mjs.txt` and `.ts.txt` suffixes; they are
byte-preserved evidence snapshots, not alternate project entrypoints.
`sha256.json` records the publication-file hashes. `sha256-original.txt` retains
the original local manifest. JSON report whitespace was formatted for the PR;
test results and source snapshots were unchanged. Runnable evidence helpers
now explicitly import their Node globals for the repository lint rules.

TypeScript checking, changed-source ESLint and formatting, ADR numbering,
file-size policy and whitespace validation passed. Original failing stress
reports remain in the parent directory. No hardware was operated, and these
local changes have not been packaged or deployed.
