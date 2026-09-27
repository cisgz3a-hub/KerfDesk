## ADR-444 - Reuse exact geometry work during V-carve compilation (2026-09-27)

**Date:** 2026-09-27
**Status:** Implemented; software verification recorded below. Deployment and hardware qualification require separate evidence.

## Context

V-carve compilation can spend a long time preparing and merging detailed artwork. The
"Merging ordered regions" progress phase includes source-region ranking and final CNC
assembly. The tracer already speeds up comparable workloads by preparing immutable geometry
once, rejecting disjoint candidates through spatial indexes, and retaining the exact geometric
predicates and observable order.

The compiler repeated source contour collection and text union between planning and assembly.
Its source-layout nesting also recalculated bounds and rebuilt the same contour's edge index
for each possible pair. Region assignment scanned unrelated outlines. Coverage and pass
certification repeated calculations for the same represented chords and endpoints.

## Decision

1. A bound CNC compilation retains its collected V-carve source contours and resolved
   polylines by operation index. Final assembly uses those same values after task identities
   have been validated. The data belongs to that compilation only; it is not a cache shared
   across edits, projects, tools or placement changes.
2. Source nesting prepares contour bounds and finite-coordinate metadata once. It reuses the
   tracer's inclusive box index to find candidates and lazily constructs each candidate's
   boundary index once. The existing whole-boundary touching, crossing and containment
   predicates remain authoritative.
3. Source-region assignment excludes unrelated bounds before evaluating containment, while
   preserving deepest-region selection and the original source-order tie rules.
4. Source-boundary coverage prepares each unique represented chord once. Conservative bounds
   reject only distance calculations that cannot improve the current result. Sampling limits,
   chord order, duplicate replacement, rounding and early-exit behaviour stay unchanged.
5. Pass compaction reuses repeated endpoint membership within its synchronous operation.
   Exact clearance and coverage checks, depth laws, output precision and quality budgets remain
   unchanged.
6. The connected-script performance fixture measures the source-boundary coverage stage that
   real region workers execute. Performance checks combine old-reference equality, work counts
   and unchanged emitted G-code hashes. Timings describe specific local fixtures, not a
   universal speed guarantee.

Frame remains the sole ordinary Start policy gate under ADR-228, ADR-230, ADR-232 and ADR-237.
No worker capacity, cancellation, transport, controller, emission or hardware policy changes.

## Verification

Verification results and measured before/after timings are recorded in
`docs/audits/2026-09-27-gcode-compilation-performance.md`.
