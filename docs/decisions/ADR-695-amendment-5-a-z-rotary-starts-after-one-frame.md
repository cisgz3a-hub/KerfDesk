## ADR-695 Amendment 5 - A Z rotary starts after one Frame (2026-11-12)

**Status:** Accepted; GRBL simulator tests. No hardware. | **Date:** 2026-11-12

Follows code quality verification C2 finding E3-P3-3
(`docs/audits/2026-11-12-c2-verify/E3-guards-tests-ci.md`), first seen in PR #1829. Extends
Amendment 2's rule for a Frame on a rotary that turns on Z.

### Context

A Frame on a Z rotary opens with `G92 Z0` at the part's current turn. Amendment 2 made the Frame's
completion leave Z out of its before-and-after comparison, so that Frame completes and issues its
permit.

Start still refused it. The Frame's verification record (`frameVerification`, ADR-228) holds the
work offset from before the Frame ran. Job Review's Frame-first check at Confirm compared that with
the live offset, which the Frame's own `G92 Z0` had moved. After any turn of the part, the first
Start showed "The framed coordinates or machine setup changed during review. Frame the job again."
and revoked the permit; a second Frame then worked. Reproduced on the stock GRBL simulator with
`$13=0` and `$13=1`. Without a turn, one Frame was enough.

### Decision

1. For a job whose rotary turns on Z (`framesZRotary`), the Frame-first check
   (`requiredFrameIssueFromPrepared`, used by Job Review and the Start readiness check) compares the
   recorded and live work offsets with Z left out.
2. X, Y, the origin flag and the bounds signature stay compared, as do the session, report units
   and every identity the permit's own checks hold.
3. Every other job, a rotary on A included, is checked exactly as before.

### Consequences

- The first Start after turning a Z-rotary part runs on the Frame the operator just made.
- The job's own program opens with `G92 Z0` too, so the Z offset places nothing on such a job.
  Leaving it out of this check loses no placement evidence.
- `rotary-axis-restart.simulator.test.tsx` starts after one Frame of a turned part.
  `rotary-axis-abort.simulator.test.tsx` no longer frames twice.
