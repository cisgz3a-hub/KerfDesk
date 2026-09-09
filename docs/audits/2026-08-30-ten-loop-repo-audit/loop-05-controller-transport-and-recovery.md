# Loop 5 — controller transport, operation ownership, and recovery

Status: complete

Audited tree: `claude/vcarve-stamp-subcell` at `9209fcb33f4807ebfc1f7a55780069b6a7b0e23c`, including the inherited working-tree changes.

## Audit design

This loop used a state-machine and race audit. The auditors enumerated serial-session epochs, transport writes, terminal-response ownership, status observations, Frame permits, active machine operations, streamer states, pause/resume owners, tool-change holds, and recovery capsules. They then challenged transitions at every asynchronous boundary: before a write settles, after reconnect, while a setup motion is active, across a controller error, and after an interruption.

The primary and blind auditors worked independently. The adversarial verifier reran the strongest interleavings against production state functions and challenged the recovery and Web Serial claims against the current GRBL and Web Serial primary specifications. No controller or machine was operated.

## Research and verification base

Repository authorities:

- the standing Frame-only guard contract in `CLAUDE.md`, `PROJECT.md`, and ADR-228/230/232
- current controller drivers, streamer, Web Serial adapter, connection lifecycle, acknowledgement ledger, tool-change, Frame, pause/resume, and recovery source/tests cited per finding

External primary sources:

- Official Grbl, [interface protocol](https://github.com/gnea/grbl/blob/master/doc/markdown/interface.md): terminal responses, realtime commands, simple and character-counted streaming, RX/planner buffering, error handling, and synchronization.
- Official Grbl, [commands](https://github.com/gnea/grbl/blob/master/doc/markdown/commands.md): realtime hold/resume/reset/status behavior.
- WICG, [Web Serial API](https://wicg.github.io/serial/): recoverable versus fatal readable-stream errors, the outer reader-acquisition loop, writer backpressure, and close behavior.

The GRBL interface explicitly says an `ok` may mean a command is set to execute and that several commands can be queued before motion begins. The Web Serial specification distinguishes recoverable buffer/break/framing/parity errors from fatal disconnection and recommends reacquiring a reader while `port.readable` remains non-null. Those facts bound the findings below; they do not establish hardware timing or physical outcome.

## Focused executable checks

The broad controller/transport sample passed 19 files and 183 tests (exit 0), including streamer/backpressure/tool-change, Web Serial, connection epochs, untracked acknowledgements, Frame races, motion identity, pause/resume, CNC refill ownership, start evidence, and recovery mapping.

The cross-seam recovery/transport sample passed 6 files and 62 tests (exit 0):

```text
pnpm vitest run src/ui/laser/laser-recovery-flow.test.ts src/ui/laser/LaserRecoveryReviewDialog.test.tsx src/ui/state/laser-active-job-write-containment.test.ts src/ui/state/laser-safe-write-epoch.test.ts src/platform/web/web-serial.test.ts src/ui/state/laser-store-tool-change.test.ts
```

The tool-change/ack baseline passed 4 files and 41 tests (exit 0):

```text
pnpm exec vitest run src/ui/state/setup-blocking-gate.test.ts src/ui/state/laser-store-tool-change.test.ts src/ui/state/laser-store-untracked-ack-guard.test.ts src/ui/state/laser-active-job-write-containment.test.ts --reporter=verbose
```

Passing tests establish current expectations. None combines a setup jog's reserved response with Continue, or an old job-write catch with a replacement active stream.

## Independent semantic probes

All probes loaded current production modules in memory, wrote no product file, and exited 0.

CNC tool-change Continue while a jog response remained reserved:

```json
{
  "continueBlock": null,
  "jogAckAttributedTo": "stream",
  "pendingUntrackedAcks": 1,
  "streamCompletedBefore": 2,
  "streamCompletedAfterJogOk": 3,
  "streamInFlightAfterJogOk": 0
}
```

Old serial-epoch job write settling after a replacement stream starts:

```json
{
  "before": "streaming",
  "after": "errored",
  "error": "Serial session changed before the write completed. Command result is invalid.",
  "notice": "write-failed"
}
```

Unresolved realtime status writes after 12 captured interval ticks:

```json
{
  "newWrites": 3,
  "heldPollWrites": 3,
  "pendingTransportWrites": 3,
  "pendingUntrackedAcks": 0
}
```

Intentional disconnect returned the poll-probe counters to zero; resolving all old writes afterward did not mutate the disconnected replacement epoch.

## Reconciled findings

### L5-01 — Continue can resume a CNC stream while setup jog still owns the next response

- State: **Confirmed — independently reproduced and verifier-retained**
- Severity: **P1**
- Trigger: a drained, fresh-Idle CNC tool-change hold has current Work-Z evidence; the operator starts an allowed setup jog and presses Continue before that jog's transport/terminal response settles.
- Mechanism: `src/ui/state/laser-store-helpers.ts:67-88` intentionally permits setup motion during a ready tool-change hold. `src/ui/state/laser-status-line.ts:188-198` latches `toolChangeIdleSeen` and does not clear it when a later jog begins. `src/ui/state/laser-store-helpers.ts:119-144` and `src/ui/state/laser-job-actions.ts:391-433` make Continue depend on the old Idle latch and Work-Z/tool identity, but not on `motionOperation`, `pendingTransportWrites`, or `pendingUntrackedAcks`.
- Response corruption: once Continue installs new job in-flight lines, `src/ui/state/laser-stream-ack.ts:24-48` gives the next terminal response to the unsettled stream before the already-reserved untracked jog ledger. The production probe advanced the resumed stream on the jog `ok` and left the jog reservation outstanding.
- UI reach: `src/ui/laser/LiveMotionBar.tsx:74-120` disables Continue only for `toolChangeContinueBlockMessage`; the active setup jog is not represented in that message.
- Impact: the app loses one-command/one-response ownership, reports the CNC stream one line ahead, and can begin later settle/refill work on the wrong causal response. The exact controller and physical consequence was not hardware-qualified, so this is not classified P0.

### L5-02 — a stale job-write catch can error and quarantine a replacement session

- State: **Confirmed — independently reproduced and verifier-retained**
- Severity: **P1**
- Trigger: a job write remains pending, disconnect/reconnect advances `writeEpoch`, a fresh job starts, and the old adapter promise then settles.
- Mechanism: `src/ui/state/laser-safe-write.ts:81-100,115-117` correctly rejects the old completion when its captured write epoch no longer matches. The asynchronous catches at `src/ui/state/laser-job-actions.ts:161-173,426-433` and `src/ui/state/laser-stream-ack.ts:81-90` then call `containActiveStreamWriteFailure` without the originating epoch, stream identity, or connection.
- Wrong owner: `src/ui/state/laser-stream-heartbeat-containment.ts:54-75` inspects the current store snapshot, marks whichever stream is active as errored, and begins quarantine against the current `refs.connection`.
- Reproduction: an old epoch-10 write rejected after refs had moved to epoch 11 and a new streaming state; the new stream became `errored` with a write-failed notice. A production-shaped verifier probe independently reproduced it.
- Contrast: pause/resume failure handling carries and checks its transition owner; this generic job-write path does not.
- Impact: a late result from a dead serial session can abort and reset/close a valid replacement job, spoiling work and violating exact session ownership. No unintended motion was established.

### L5-03 — laser recovery automatically derives a physical restart boundary from transport acknowledgements

- State: **Confirmed source contradiction; supervised warning does not correct the boundary**
- Severity: **P1**
- Trigger: a laser job is interrupted with commands acknowledged but not physically executed, or commands buffered/executed without their acknowledgements reaching the app.
- Mechanism: `src/core/recovery/job-checkpoint.ts:48-55` stores acknowledged sendable-line count and explicitly says acknowledgement is not execution. `src/ui/laser/laser-recovery-flow.ts:66-96` nevertheless converts that count directly with `rawResumeLine`, builds the tail, and offers only that restart program.
- Primary-source conflict: the official GRBL interface says `ok` means parsed and executed **or set to be executed**, and documents both RX and planner queues. Therefore app loss can leave unacknowledged commands that later execute, while controller power loss can erase acknowledged commands that had not executed.
- UI limit: `src/ui/laser/LaserRecoveryReviewDialog.tsx:93-108` accurately warns that acknowledgements do not prove completed marks. `src/ui/laser/resume-confirmation.ts` names the computed line but gives no way to select or conservatively rewind the physical boundary.
- Internal contrast: `src/core/recovery/cnc-resume-point.ts:1-15,72-87` already models both uncertainty directions for supervised CNC pass recovery.
- Impact: recovery can skip an unburned portion or replay an already-burned portion. The operator can decline recovery, but the offered automatic boundary itself is not supported by the evidence the UI displays.

### L5-04 — unresolved realtime status writes accumulate without single-flight ownership

- State: **Confirmed — production-store probe; teardown held**
- Severity: **P2**
- Trigger: `SerialConnection.write('?')` remains unresolved while the status interval continues.
- Mechanism: `src/ui/state/laser-connection-actions.ts:410-445` starts a 250 ms interval and launches realtime `safeWrite` calls without checking an earlier status write. `src/ui/state/laser-safe-write.ts:81-99` increments `pendingTransportWrites` before awaiting each transport and decrements only on settlement.
- Reproduction: 12 idle/Alarm ticks created three new held queries and `pendingTransportWrites: 3`; no terminal acknowledgement was reserved because `?` is realtime.
- Primary-source support: the Web Serial specification says `writer.write()` returns a backpressure promise and recommends awaiting it before generating too many chunks to avoid excessive buffering.
- Narrow impact: promises, queued writer chunks, and the transport counter grow while queue-fenced operations remain unavailable. Intentional disconnect stopped the interval, cleared the counter, and epoch-fenced late settlement correctly.
- Qualification: this is an availability/resource finding from a fake transport, not evidence of motion or a real USB stall.

### L5-05 — recoverable Web Serial read errors are treated as fatal disconnects

- State: **Confirmed source/spec mismatch; no physical-port reproduction**
- Severity: **P2**
- Trigger: Web Serial rejects a read with a recoverable `BufferOverrunError`, `BreakError`, `FramingError`, or `ParityError` while the port remains open.
- Mechanism: `src/platform/web/web-serial.ts:131-160` acquires one reader. `runReadLoop` at `:279-299` calls the dropped-connection handler after every reader exception, which closes streams and fires the store's `onClose` path.
- Primary-source conflict: the current Web Serial specification keeps `readFatal` false for those errors, creates a replacement `port.readable`, and demonstrates an outer `while (port.readable)` loop that releases the failed reader and acquires the next. Only physical disconnect sets `readFatal` and makes the readable permanently null.
- Coverage gap: `src/platform/web/web-serial.test.ts` covers subscriber exceptions and hard close paths, but not a recoverable reader rejection followed by a replacement readable stream.
- Impact: a recoverable line error becomes a full application disconnect/interrupted-job capsule. Because corrupted serial input may itself require operator attention, this audit records recovery/parity drift rather than claiming that continuing any specific machine job would be safe.

### L5-06 — a rejected Start queue fence expires a current Frame permit before job bytes

- State: **Confirmed by existing integration test and source trace**
- Severity: **P2**
- Trigger: the pre-Start synchronization line, such as `G4 P0.01`, returns a controller error after an exact current Frame was completed.
- Mechanism: `src/ui/state/laser-job-actions.ts:119-162,183-205` sends the queue fence before consuming the permit or creating the stream. Global error handling in `src/ui/state/laser-error-line.ts:24-45` clears both Frame artifacts for every controller rejection, regardless of whether any motion or origin state changed.
- Existing proof: `src/ui/state/laser-store-tool-change.test.ts:243-257` confirms an `error:20` leaves the wire at the fence line and creates no streamer. `src/ui/state/laser-error-line.test.ts:315-335` separately pins permit expiration on controller errors.
- Guard-law conflict: the factual controller rejection may prevent this Start attempt, but it does not establish that the already-completed exact Frame became false. Forcing another Frame after a non-motion fence error expands the one Start guard instead of preserving its evidence.
- Impact: the operator must repeat physical Frame after resolving a synchronization/dialect issue even though no job byte, motion command, origin mutation, or reset invalidated the permit.

## Correctly rejected controller candidates

- Old connection line and close callbacks are identity-fenced before mutating the store.
- Teardown advances the write epoch and cancels session-scoped lifecycle owners; ordinary late write settlement cannot decrement the replacement counters.
- Pause/resume transitions carry unique ownership and bounded liveness deadlines across asynchronous writes and status observations.
- GRBL stream errors stop refill and issue realtime reset/beam-off containment; the official character-count reservation about already-buffered lines is not silently ignored.
- CNC pass recovery does not equate acknowledged lines with physically completed motion; it conservatively rewinds by controller reserve and shows uncertainty bounds.
- M0 is intentionally swallowed host-side, and ordinary Continue correctly requires a drained pre-M0 tail, fresh Idle, and current Work-Z/tool identity. L5-01 is specifically the missing exclusion of a **later** setup motion.

## Limitations

- The audited branch is not current `main`; it is the exact dirty working tree fingerprinted above.
- No Chromium serial emulator, physical serial port, controller, laser, spindle, cutter, stock, or E-stop was used.
- Application-state probes establish ownership transitions, not the exact firmware response or physical movement after those transitions.
- The recoverable Web Serial finding is source/spec evidence only.
- No source fix was implemented.

## Loop decision

Loop 5 closes with six canonical findings: two independently reproduced cross-owner races, one evidence-invalid laser recovery boundary, one bounded polling-resource defect, one Web Serial recovery mismatch, and one overbroad Frame-permit invalidation. The ordinary session epoch, Frame race, pause/resume, stream-error, and conservative CNC recovery contracts held. Loop 6 starts the hostile-input and parser-boundary audit.
