# Post-Frame Start block audit (2026-09-24)

**Question (maintainer):** "I don't understand why we have blocks again after a frame. We had a
clear rule that if a job can frame it's safe and the job can start no matter what. I need you to
audit all the blocks again." Follow-up: "change the set up & frame button to start. grey it out
until a frame is complete. if a frame finishes without hitting a limit switch start can fire."

**Rule audited against:** PROJECT.md non-negotiable 21, ADR-228/230/232/237 and CLAUDE.md
rule 7. A completed Frame of the exact job is the only Start policy gate. The only other
refusals allowed are factual:

- **T (transport):** the controller cannot accept work now.
- **P (program):** an executable program cannot be produced or streamed.
- **H (handoff):** the reviewed artifact cannot be handed off consistently.

**Scope:** every refusal on the ordinary path, from pressing Frame to the first program byte.
That covers the refusals that stop a Frame from earning its permit, what expires a permit, and
what can refuse Start once a permit exists. The audit covers `main` at `7fbbfdfb8` plus the
branch that carries ADR-372. Recovery, replay and resume keep their own integrity gates, which
were outside the 2026-07-17 mandate, and are not covered here.

## The block in the maintainer's screenshot

The two messages were `FRAME_TRACE_PROGRAM_REFUSED_MESSAGE` and `STALE_START_PREPARATION_MESSAGE`.
This was not a policy gate. A factual check was given a false fact:

1. The split Frame (ADR-353) traces the outline while the exact program is still compiling.
2. The preparation owner (`src/ui/laser/start-preparation-owner.ts`) cancelled that compile when
   the status report differed from the one taken at the Frame press, comparing state and MPos/WPos
   exactly.
3. The trace moves the head, so its first status report cancelled the compile. No permit could
   follow.

It reproduced every time for any job slow enough to be split. The primary button then read
**Set up & Frame**, ran the Frame itself, and filed the failure under "Last Start attempt
blocked".

**Fixed by #901** (merged as `67851490c`), which binds the preparation to the exact Frame
operation that owns the motion. This branch's regression test, a trace that reports the head
moving, passes against it. This branch (ADR-372) changes the primary button: it reads **Start**,
stays greyed out until a clean Frame, and never runs a Frame itself.

## The block after homing (second screenshot)

After homing, Frame job was refused: "Absolute Coordinates requires the custom work origin to be
cleared. Reset origin first, or choose User Origin." The maintainer had set no origin:

1. Homing does not clear a work offset stored in the controller.
2. Any status report whose WCO is not zero marks a custom origin active.
3. Absolute refused that, although Save already compensated the same offset.
4. The advice pointed at **Reset origin**, which is disabled for an origin KerfDesk did not set.

**Fixed by #852** (ADR-343 Amendment 1, merged as `6b6250b52` on 2026-09-24), not by this
branch:

- Absolute compensates the reported offset without sending G92/G10.
- Frame waits for the post-Home offset.
- It refuses only while the controller has not reported its offset yet.

This branch makes the blocker notice say "Last Frame attempt blocked" when Frame job was the
button pressed.

## Inventory

### 1. Before the permit: what stops a Frame from issuing one

| Refusal | Where | Class | Verdict |
| --- | --- | --- | --- |
| Owed controller reply not answered ("disconnect and reconnect") | `frame-controller-readiness.ts:24` `frameControllerQueueIssue` | T | Keep |
| Could not select G54 before Frame | `frame-controller-readiness.ts` `normalizeFrameWorkCoordinateSystem` | T | Keep |
| CNC: no work-Z zero, with a zero-here offer | `use-frame-action.ts` `prepareFrameLaser` | P (the Frame's Z moves need the reference) | Keep |
| User or Verified Origin with no origin set, with a Set-origin offer; Current Position with no live position | `job-placement.ts` `resolveJobPlacement` via `resolveStartPlacement` | P (compile input) | Keep |
| **Absolute with a reported work offset** ("requires the custom work origin to be cleared") | `job-placement.ts` `resolveAbsolute` | Presented as P | **Defect: not factual, and a dead end. Fixed by #852 (`6b6250b52`).** Export already compensated the known offset. The advice pointed at **Reset origin**, which is disabled for an offset KerfDesk did not set. It fired right after homing on the maintainer's machine. |
| Job active, jog/frame active, controller operation, auto-focus, alarm, no status, not Idle | `start-job-input.ts:56` `findMachineStartIssues` | T | Keep |
| Compile failed, compile-integrity preflight codes, nothing sendable, line longer than RX buffer, worker unavailable | `start-job-readiness.ts:294` `finalizeStartPreparation`, `start-job-readiness-policy.ts`, `start-job-source.ts` | P | Keep |
| **Inputs changed during preparation** | `start-preparation-owner.ts:27` | H | **Defect: fired on the Frame's own motion. Fixed by #901 (`67851490c`)** |
| Inputs changed between press and trace dispatch | `frame-trace-flow.ts:133` `traceFrameOutline`, `use-frame-action.ts` `dispatchPreparedFrame` | H | Keep |
| No usable work position; motion not dispatched | `frame-dispatch-support.ts` | T | Keep |
| Frame cancelled, alarm (limit switch), error, reset or disconnect before the clean Idle | `waitForFrameOutcome`, `laser-frame-status.ts` | Frame did not complete | Keep. This is the one gate |
| Setup changed during the Frame, or the head did not return within 0.001 mm | `framed-run.ts:233` `framedRunCompletionIssue` | H | Keep |
| Split Frame: program refused, program envelope differs from the traced one, trace expired before the program arrived | `frame-trace-flow.ts:225` `bindExactProgramToTrace`, `:257` `claimTraceAsPermit` | P / H | Keep |
| Nothing to frame (no output layer) | `frame-candidate.ts:16` | P | Keep |

### 2. What expires a permit (Start greys out again, and the reason is shown)

`framed-run-invalidation.ts:40` `expireStalePermit` and `framed-run-readiness.ts:32`
`framedRunDriftReason`:

| Trigger | Why it is factual |
| --- | --- |
| Artwork, output selection, placement or registration edited | The permit names exact bytes, so an edited job is a different job |
| Any jog, Home, probe, auto-focus or other owned motion | The Frame is the spatial proof, and the head left the framed position |
| Alarm, Sleep, reset, disconnect, or a new controller session | Position trust is void, so the Frame no longer proves where the head is |
| WCO, work origin active/source, trusted-position epoch, or work-Z reference changed | The coordinate frame the bytes were compiled for changed |
| Status not Idle, or MPG active | Another owner has the machine |

Advisory controller evidence (`$30`, `$32`, `$I`) does not expire a permit. It stays a Job Review
warning (ADR-232).

### 3. After a clean Frame: pressing Start

| Refusal | Where | Class | Verdict |
| --- | --- | --- | --- |
| Permit expired as the click landed | `start-job-flow.ts:73` `runFreshFramedJobFlow` | Same as section 2 | Keep. Now a message only; Start never runs a Frame |
| Job Review: Cancel; permit lost during review; in-review edit changed the framed job | `framed-run-start-review.ts:24` | H | Keep. Review warns and never refuses on policy |
| Job Review: in-dialog rebuild refused (for example an alarm while the review was open) | `job-review-gate.ts` `rebuildCurrentStart`, `:419` `frameFirstRefusal` | T / H | Keep |
| Same permit already being handed over (double press) | `start-job-flow.ts:99` `runFramedPermitStart` | H | Keep |
| Permit claim, job signature or controller changed while Start was prepared | `start-job-authorization.ts:37` `currentLaserForAuthorizedStartNow` | H | Keep |
| Another Start or run holds the recovery handoff (another window) | `start-handoff-arming.ts:26` | H | Keep. A crashed session's leftover run is promoted to recovery at startup, so it cannot hold a fresh Start |
| Empty program; auto-focus, job or motion active; owed reply; driver cannot run CNC; CNC MPG; CNC settle fence | `laser-job-actions.ts:130` `runStartJob`, `:206` `prepareStartBoundary` | T / P | Keep |
| Final laser status query: no query possible, not Idle, session changed, head moved or origin changed after the Frame | `laser-live-start-readiness.ts:32` | T / H | Keep |
| Reviewed laser-mode or CNC attestation no longer binds these bytes; setup epoch changed while arming | `laser-start-program-assertions.ts`, `laser-job-actions.ts:406` | H | Keep |
| Line longer than RX buffer; FluidNC 127-byte line limit | `laser-start-program-assertions.ts` | P | Keep |

**Result:** two refusals were defects, both before the permit: the split Frame cancelling its
own program (#901) and Absolute refusing a reported work offset (#852). After a clean
Frame, no policy refusal remains. Every refusal in section 3 is either
a live transport fact or a check that the exact framed bytes are what will be sent. Section 2 is
the Frame no longer describing the machine or the job.

## Also checked

- **Job Review accepts split-Frame permits.** Its Frame-first check,
  `requiredFrameIssueFromPrepared`, accepts the permit a split Frame issues, including after a
  trace that reported motion (test in `use-frame-action.split-frame.test.ts`).
- **Recovery leftovers cannot hold a fresh Start.** A leftover `activeRun` from a crashed session
  is promoted to recovery at startup (`recovery-repository.ts` `promoteStaleActiveRun`).

## Open items (not changed here)

1. **Falcon standby.** A controller that reports Sleep clears the permit, because Sleep voids
   position trust. If the Falcon's `$152` standby reports Sleep, a pause of more than 30 s after
   a Frame would grey Start out again. This is unverified without hardware. The in-app advice
   remains `$152=100`.
2. **Recompile at Confirm.** Job Review's Confirm recompiles when a controller setting was
   refreshed between opening the review and Confirm (`job-review-gate.ts:284`
   `preparedStartReusable` does not ignore advisory evidence). This adds a delay on dense jobs.
   It never refuses: the permit's own bytes are what stream.
3. **Wording.** `assertStartReservation` says "CNC Start lost its exclusive controller/setup
   reservation…" for laser Starts too.
