## ADR-700 Amendment 2 - The PostScript import's work and time are bounded (2026-11-12)

**Status:** Accepted. Amends ADR-700 (EPS and Illustrator 3–8 import). Code quality audit C2,
area D5 (input boundaries). | **Date:** 2026-11-12

### Context

ADR-700's reader runs on the window thread. Its only limit was a count of executed steps, and some
kinds of work could cost less than they took. An imported file could therefore keep the window busy
far longer than the budget intends. DXF had a related, lower-risk case: its ellipse sweep helpers wrap
the parameter difference with a loop.

### Decision

1. **Every unit of work is counted.** Each procedure call costs a step as well as each object it runs,
   and building a large array or string, or taking a large interval, costs its size in steps.
2. **Each run has a time limit.** Besides the 20,000,000-step budget, a run that passes
   `PS_LIMITS.milliseconds` (5 s) ends with the same "takes too long to draw" error. The clock is read
   every 4,096 steps, so the check costs nothing measurable. This bound holds whatever any operator
   costs, so a future gap in step accounting cannot hang the window either.
3. **The DXF ellipse sweep is computed, not looped.** `normalizedSweep` (`dxf-curve-sampling.ts`, now
   shared by `dxf-entities.ts`) wraps any parameter difference in one step. Its result equals the
   former loop's for every ordinary input.

### Consequences

- An imported file ends in at most about five seconds of window work. Ordinary EPS files take
  milliseconds and are unaffected; the bound tests end in about 100 ms.
- Moving the reader into a worker with a Cancel control is still open, as for SVG and DXF imports. The
  time limit makes it a responsiveness improvement, not a safety one.

### Verification

- `src/io/postscript/convert-postscript.test.ts` ("bounds every run in work and time") ends six kinds
  of program with the budget error well inside the time limit. It also ends a step-cheap but slow run
  with the time limit, using a scripted clock.
- `src/io/dxf/dxf-curve-sampling.test.ts` checks that `normalizedSweep` matches the former loop on
  ordinary parameters, and that any parameters give a sweep in (0, 2π].
