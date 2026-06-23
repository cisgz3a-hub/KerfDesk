# Step 5A: Controller Stall Watchdog Audit

Date: 2026-06-23
Repo: `C:\Users\Asus\LaserForge-2.0`
Step: Step 5A from the LaserForge 10/10 loop
Scope: Simulated GRBL controller lifecycle, progress/stall warning behavior, and operator-facing safety notice copy.

## Locked Goal

Fix the false "Command may not have sent" warning that can appear while a GRBL controller is legitimately still running a long move.

Success criteria:

- A job with in-flight commands and no fresh acknowledgements still raises a stall warning when there is no known `Run` status.
- A job whose last known controller state is `Run` gets a longer watchdog window so slow moves do not look like dead USB.
- The warning still fires after that longer running-state window.
- Existing post-job settle, Home, recovery, console, frame/jog, and progress tests remain green.
- Operator copy no longer hardcodes `10 seconds` for every stall case.

Out of scope:

- Hardware smoke on a live Falcon or 4040.
- A new ping-pong/simple streaming mode.
- GRBL `Bf:` planner/RX buffer parsing.
- Per-command physical execution estimates.
- Any generated G-code changes.

## Research Evidence

LaserForge source inspected:

- `src/ui/state/laser-store-helpers.ts`
- `src/ui/state/laser-store-helpers.test.ts`
- `src/ui/state/laser-line-handler.ts`
- `src/ui/state/laser-controller-lifecycle.test.ts`
- `src/ui/state/laser-post-job-settle.ts`
- `src/ui/state/laser-home-action.ts`
- `src/ui/state/laser-controller-recovery-actions.ts`
- `src/ui/laser/JobControls.tsx`
- `src/ui/laser/JobControls.progress.test.tsx`
- `src/ui/laser/SafetyNoticeBanner.tsx`
- `src/core/controllers/grbl/streamer.ts`

LaserForge docs inspected:

- `CLAUDE.md`
- `PROJECT.md`
- `WORKFLOW.md`
- `DECISIONS.md`

Rayforge reference inspected in study-only mode:

- `C:\Users\Asus\Rayforge\CHANGELOG.md`
  - line 62: simple GRBL serial driver with ping-pong protocol.
  - line 68: deadlock detection toggle in GRBL serial/telnet driver settings.
  - line 92: buffer stall recovery aborting jobs during slow moves was fixed upstream.
  - line 212: RX buffer size override option.
  - line 338: GRBL buffer overflow on devices with smaller RX buffers.

- `C:\Users\Asus\Rayforge\website\docs\reference\firmware.md`
  - line 100: GRBL Serial Simple Driver.
  - line 103: simple driver is for false alarms or communication errors in the buffer-counting driver.
  - line 107: ping-pong protocol sends one line and waits for `ok`.
  - line 109: no deadlock detection or stall recovery.
  - line 114: use it when a device gets false buffer stall alarms.

Useful Rayforge lesson:

- Buffer-counted streaming is fast, but false stall alarms on slow moves are a known class of bug. A slower fallback streaming mode is a future design option, but this slice only fixes LaserForge's immediate false warning.

No Rayforge code was copied.

## Failing Proof

Red test added before the implementation fix:

```powershell
pnpm test src/ui/state/laser-store-helpers.test.ts
```

Failure:

- Test: `allows a longer watchdog window while the controller is still running`
- Expected: `second.stalled === false`
- Received: `true`

Trigger path:

1. A job is active with a streamer in `streaming` state and at least one in-flight command.
2. No `ok` acknowledgement arrives for `STREAM_STALL_TIMEOUT_MS`.
3. The last known controller status is still `Run`.
4. The old watchdog treated this exactly like a silent controller and raised the safety notice after 10 seconds.

Failure mode:

- A slow physical move, full planner buffer, or controller that does not emit fresh status while executing could trip the stall notice even though the machine was still doing the job.

Consequence:

- The operator sees "Command may not have sent" while the laser is still moving.
- The progress/ready story becomes confusing.
- The prominent "Recover controller" action could encourage a soft reset during a legitimate job.

## Implementation

Changed files:

- `src/ui/state/laser-store-helpers.ts`
  - Added `STREAM_STALL_RUNNING_TIMEOUT_MS = 90_000`.
  - `detectStreamStall()` now uses the longer timeout while the last known controller status is `Run`.
  - The original `10_000` ms timeout still applies when there is no known Run state.
  - Feed hold and door still reset the watchdog.

- `src/ui/state/laser-store-helpers.test.ts`
  - Split the old generic stall test into:
    - no Run status still stalls at 10 seconds;
    - stale Run status does not stall at 10 seconds;
    - stale Run status still stalls after the longer running-state window.

- `src/ui/state/laser-safety-notice.ts`
  - Updated the stream-stalled copy to say "longer than the watchdog window" instead of hardcoding "10 seconds."

## Verification

Red proof:

```powershell
pnpm test src/ui/state/laser-store-helpers.test.ts
```

Result before implementation:

- Failed: 1 test.

Focused green:

```powershell
pnpm test src/ui/state/laser-store-helpers.test.ts
```

Result:

- Passed: 1 file, 6 tests.

Controller/progress focused slice:

```powershell
pnpm test src/ui/laser/SafetyNoticeBanner.test.tsx src/ui/state/laser-line-handler.test.ts src/ui/state/laser-controller-lifecycle.test.ts src/ui/laser/JobControls.progress.test.tsx
```

Result:

- Passed: 4 files, 19 tests.

Broader controller slice:

```powershell
pnpm test src/ui/state/laser-controller-lifecycle.test.ts src/ui/state/laser-store.test.ts src/ui/state/laser-store-helpers.test.ts src/ui/state/laser-line-handler.test.ts src/ui/state/laser-store-motion-operation.test.ts src/ui/state/laser-store-console.test.ts src/ui/state/laser-store-active-job-command-guard.test.ts src/ui/state/laser-store-sleep-recovery.test.ts src/ui/laser/SafetyNoticeBanner.test.tsx src/ui/laser/JobControls.progress.test.tsx src/ui/laser/JobControls.test.tsx src/ui/laser/LaserWindow.test.tsx
```

Result:

- Passed: 12 files, 96 tests.

GRBL core slice:

```powershell
pnpm test src/core/controllers/grbl/streamer.test.ts src/core/controllers/grbl/status-parser.test.ts src/core/controllers/grbl/response.test.ts src/core/preflight/controller-readiness.test.ts
```

Result:

- Passed: 4 files, 60 tests.

Formatting:

```powershell
pnpm exec prettier --check src/ui/state/laser-store-helpers.ts src/ui/state/laser-store-helpers.test.ts src/ui/state/laser-safety-notice.ts
```

Result:

- Passed.

Typecheck:

```powershell
pnpm typecheck
```

Result:

- Passed.

Lint:

```powershell
pnpm lint
```

Result:

- Passed.
- Existing `boundaries/dependencies` legacy selector warning remains a green lint warning, not a Step 5A regression.

Full suite:

```powershell
pnpm test
```

Result:

- Passed: 341 files, 2108 tests.
- Existing jsdom `act(...)` warnings remain in `use-canvas-bitmap-size.test.tsx`; they are not from this change.

Local server smoke:

```powershell
Invoke-WebRequest -UseBasicParsing -Uri http://127.0.0.1:5173/ -TimeoutSec 10
```

Result:

- `HTTP 200 OK`
- Returned `LaserForge 2.0` document HTML.

In-app browser automation note:

- Attempted a non-destructive in-app browser reload/smoke.
- Browser runtime returned `ERR_ABORTED (-3) loading 'about:blank'` before page inspection.
- This is recorded as an automation/runtime issue, not a LaserForge failure, because shell HTTP smoke and the full test suite passed and the locked Step 5A change is covered by unit tests.

## Accepted Finding

### STEP-5A-001: Stall Watchdog Raised False Warning During Legitimate Run State

Severity: Medium
Confidence: High
Status: Fixed

Function/module:

- `src/ui/state/laser-store-helpers.ts`
- `detectStreamStall`
- `streamStalledNotice`

Trigger:

- Active GRBL job.
- Streamer has in-flight commands.
- No acknowledgement arrives for 10 seconds.
- Last known controller status is `Run`.

Failure mode:

- The watchdog treated slow legitimate controller execution the same as a silent controller.

Consequence:

- False "Command may not have sent" warning while the laser is still moving.
- Operator confusion about whether the job completed, stalled, or should be recovered.

Concrete fix:

- Keep the 10-second watchdog for unknown/non-running status.
- Use a 90-second watchdog while the last known controller state is `Run`.
- Keep the warning enabled after the longer window.
- Adjust warning copy to describe the watchdog window instead of a fixed 10 seconds.

Proof:

- Red test failed before implementation.
- Test passes after implementation.
- Broader controller and full repo suites pass.

## Rejected Findings / Non-Issues

### This Does Not Change Job Completion Semantics

Rejected as a risk for this slice.

Reason:

- `JobControls` already caps a fully acknowledged but still-running job at "Machine finishing" and 99%.
- Post-job settle still requires the internal dwell marker and stable Idle before clearing the job lock.
- This change only adjusts when a stall notice appears during in-flight streaming.

### Longer Run Window Hides Every Dead Stream

Rejected as stated, but recorded as a tradeoff.

Reason:

- The watchdog still fires after 90 seconds in stale Run.
- No Run status still fires at 10 seconds.
- Disconnect, write failure, GRBL error, Alarm, Sleep, Stop, and recovery paths are unchanged.
- A future streaming-mode/profile setting can add ping-pong fallback for devices with repeated false buffer-stall behavior.

### Browser Runtime Failure Blocks Step 5A

Rejected as a Step 5A blocker.

Reason:

- In-app browser automation failed before inspecting the app due to an `about:blank` navigation abort.
- The local dev server itself returned HTTP 200.
- The changed behavior is pure store/watchdog logic with direct regression tests and full-suite coverage.
- No canvas, layout, or operator workflow interaction was changed.

### Existing Lint Warning

Rejected as a Step 5A finding.

Reason:

- `pnpm lint` exits green.
- The legacy selector warning predates this slice.

### Existing jsdom `act(...)` Warnings

Rejected as a Step 5A finding.

Reason:

- Full suite passes.
- The warnings are in an unrelated canvas-size test and predate this change.

## Rating

Rubric score is the minimum of all categories:

- Correctness: 10/10
- Safety: 10/10
- UX: 10/10 for the locked false-stall slice.
- Regression coverage: 10/10
- Real-artifact evidence: 10/10 for simulated controller evidence; live hardware is out of scope for Step 5A.
- Maintainability: 10/10
- Docs/audit clarity: 10/10

Final Step 5A rating: 10/10

No accepted findings remain for this locked slice.

## Next Step

Proceed to Step 5B: streaming-mode hardening.

Candidate scope:

- Add data-driven profile control for `char-counted` versus `ping-pong` streaming.
- Add RX buffer size profile override.
- Consider parsing GRBL `Bf:` where available.
- Keep the fast buffer-counted default, but give problem controllers a conservative mode like Rayforge's GRBL Serial Simple lesson.
