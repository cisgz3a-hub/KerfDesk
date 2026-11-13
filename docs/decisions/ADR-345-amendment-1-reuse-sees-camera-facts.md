## ADR-345 Amendment 1 - Job Review's reuse sees the camera facts its compile read (2026-11-12)

**Status:** Accepted; unit tests with the real stores. No hardware or browser run. | **Date:** 2026-11-12

Follows code quality verification C2 finding E3-P2-1
(`docs/audits/2026-11-12-c2-verify/E3-guards-tests-ci.md`), first raised as suspected in PR #1829.
Amends the "reuse the displayed compile" rule of this ADR's Decision.

### Context

At Confirm, Job Review reuses the compile it displayed when every input the compile read is
unchanged. The machine-inputs check built both of its keys from the live camera store, so camera
facts cancelled out. They include camera placement on or off, a confirmed camera position, the
"camera may have moved" warning and the camera's calibration (`start-machine-snapshot.ts`).

Turning camera placement on, or confirming a camera position, while the review was open did not
force a recompile. Confirm then bound a bundle without the camera warnings that a fresh compile
gives: 4 warnings where a fresh compile had 5. These facts only produce warnings, so the G-code
bytes were the same.

The phone review already compared the key its compile was prepared with against a fresh live key.

### Decision

1. A reviewed bundle carries `preparedMachineInputsKey`: the machine-inputs key taken just before its
   compile, from the controller and camera state that compile read. The Start review's first
   compile (`prepareFramedStartReview`) and every recompile in the gate record it.
2. Confirm reuses the displayed compile only while that stored key equals
   `startMachineInputsKey(project, live controller, live camera)`. A bundle without a stored key is
   recompiled.
3. A carried-over compile keeps the key it was prepared with.

### Consequences

- A camera change during the review recompiles at Confirm. Its warnings reach the review, and
  Confirm needs a new click when they change the model.
- A Frame permit's own earlier compile (transient camera jobs) has no key, so it is recompiled at
  Confirm rather than reused.
- The desktop review now publishes its read-only snapshot to the phone from its first display,
  because that bundle has a key. The phone still re-checks the key against the live state before
  using it.
- `job-review-gate.recompile.test.ts` has a row for camera placement and for a confirmed camera
  position.
