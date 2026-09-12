# Source-ring Offset Fill accuracy proposal

**Status: draft, pending performance and design review.** This preserves an authored accuracy
candidate; it is not an accepted performance tradeoff or a ready-for-adoption change. No new ADR
number or accepted decision is assigned by this proposal.

Current main at `00abb56e151332a85d9f9673ed6a5e0fae3faaef` computes the first inward contour from the
source and each later contour from the previous output. Reusing output also reuses its Clipper
quantization and tiny-segment cleanup. The original analytic witness reproduces accumulated
nominal-radius error on a 2,000-point circle of radius 30 mm at 0.1 mm spacing.

The candidate changes one production expression: each later pass uses the original source at
`-(spacing / 2 + (pass + 1) * spacing)`. It retains the current `OffsetFillResult`, checked offset
errors, accumulated partial contours, 2,000-level limit, final lookahead and failure precedence.
The contracts introduced by [PR498](https://github.com/cisgz3a-hub/KerfDesk/pull/498) and clarified by
[PR501](https://github.com/cisgz3a-hub/KerfDesk/pull/501) remain controlling. Their nine existing
failure/partial/completion/limit/lookahead tests are unchanged.

## Accuracy witness and observed cost

The historical witness retains all of its geometry and thresholds:

- 2,000 source vertices plus an explicit closure, radius 30 mm, spacing 0.1 mm.
- More than 250 returned rings, with complete termination checked through the current result.
- Area-equivalent nominal-radius error below 0.004 mm for nominal radii at least 2 mm.
- Consecutive spacing error below 0.004 mm when the inner area-equivalent radius is at least 2 mm.

Two external observations on 2026-09-06 used exact-main geometry helpers, Node 24.15.0 and Vitest
3.2.6 on Windows. The second reversed candidate/current execution order. They were diagnostic
measurements, not a controlled benchmark or browser latency test.

| Full circular witness | Current cascade | Source-ring candidate |
| --- | ---: | ---: |
| Worst meaningful nominal-radius error | 0.101243 mm | 0.000709 mm |
| Worst meaningful consecutive spacing error | 0.000730 mm | 0.000149 mm |
| Returned contours | 299 | 300 |
| Returned contour points | 190,004 | 366,158 |
| First elapsed time | 0.658 s | 26.392 s |
| Reversed-order elapsed time | 1.078 s | 32.850 s |

The source-ring candidate passes the original numerical thresholds but costs approximately
**30–40 times the runtime and 1.93 times the returned contour points** in this fixture. Returned
point counts are not emitted G-code counts or physical motion measurements. Repeated source
normalization and offset work are visible in the implementation; their individual share of the cost
has not been profiled.

The maintained test computes the full fixture once in `beforeAll`, with an explicit 180-second
allowance sized for CI. It uses the same allowance locally and reads no platform state from the
core test. This provides honest room for the expensive witness without reducing source resolution,
increasing tolerance or substituting a smaller shape. The timeout is a test allowance, not an
application work budget or a performance claim. If it cannot run reliably within that allowance,
preserve the candidate as an unapplied textual draft rather than weakening the witness.

Four additional external orthogonal fixtures (square hole, disjoint squares, concave L and
narrow-neck split) retained current vertex sets and completion; the first two also had independent
expected contour counts. These bounded comparisons do not establish arbitrary curved-hole,
self-intersection or topology behavior. The circular area oracle does not bound maximum radial
error, Preview appearance, emitted paths, material quality or hardware behavior.

## Review required before adoption

Keep this PR draft while deciding how the accuracy objective can meet an acceptable processing
and output-density cost. Any later implementation must retain checked topology, tiny-segment
cleanup, partial-result diagnostics, final lookahead and the existing limit semantics. This draft
does not authorize a broader optimizer rewrite, a new cutoff, a reduced fixture or weaker accuracy
thresholds.

Incomplete-fill diagnostics remain advisory. PROJECT non-negotiable 21 and ADR-228/230/232/237
continue to govern Frame and Start. This proposal adds no guard, controller action, merge,
deployment, hardware operation or physical-output qualification.

## Historical provenance

The source intent and analytic test came from the preserved dirty worktree
`pr391-deep-audit-c8b387`, branch `claude/offset-fill-source-rings`, at HEAD
`488ef3ae4a834aa00916abdf76b1f15b10f59c84`. Raw donor SHA-256 values:

- `src/core/job/offset-fill.ts`:
  `AFEF69D86496C228FFE91119DCC7B2F47C178129938F639733C9A91744E15DA7`
- `src/core/job/offset-fill-ring-accuracy.test.ts`:
  `158F403A8D30933D1A777D6544D59DEB33AB64B468E06E1013035FE414D854A0`

The old array-only API and loop without final lookahead are superseded by current main. They are
not copied into this proposal. The donor's separate `zz-perf-probe.test.ts` explicitly identifies
itself as temporary; it stays outside product tests. Donor files, index, HEAD, branch and status
remain preserved. The external review contains the original hashes, complete per-file
dispositions, timing observations and before/after preservation proof.
