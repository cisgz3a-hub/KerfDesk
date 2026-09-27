## ADR-459 Amendment 1 - An exhausted fill estimate is unknown, not a large job (2026-09-27)

**Status:** Accepted; software-verified through unit tests. | **Date:** 2026-09-27

Amends ADR-459 item 2. The Frame-first Start contract (ADR-228) is unchanged. The "Large job"
message is a Job Review advisory (ADR-241) and stays one.

### Context

ADR-459 bounded the fill estimate with a shared one-million edge/scan budget. The legacy numeric
wrapper returns Infinity when that budget runs out, and `scenePreparationTooComplex` compared
Infinity with the 20,000-span budget, so an exhausted estimate read as "too large". A dense
outline exhausts the budget without being a large job: one 10 mm circle with 12,000 vertices at
0.1 mm hatch has about 100 spans. Job Review then showed the "Large job" advisory for ordinary
traced logos and filled text.

### Decision

1. `scenePreparationSize(scene)` returns `within-budget`, `over-budget` or `unknown`. Raw vector
   segments over 100,000, or a counted fill over 20,000 spans, is `over-budget`. A fill estimate
   that ran out of budget, or met invalid input, is `unknown`.
   `scenePreparationTooComplex` is true only for `over-budget`.
2. At Start the compiled job is available. For an `unknown` scene the advisory counts the compiled
   job's actual Fill spans, stopping once past 20,000, and warns only when they exceed the budget.
   Without a compiled job an `unknown` scene stays silent.
3. Worker routing is unchanged: an unknown estimate still sends Preview and ETA preparation to
   the worker, which is the conservative lane and changes no output.

### Verification

`src/core/job/preparation-complexity.test.ts` shows the 90,000-vertex circle is `unknown` and not
too complex, and that counted fills classify as `within-budget` and `over-budget`.
`src/ui/laser/start-job-readiness-policy.test.ts` shows a 12,000-vertex 10 mm circle fill gives no
advisory before compile or with 100 compiled spans, and gives the advisory with 20,001 compiled
spans.
