# Ruida Safety Design

T3-62 is a design only safety stub. It records the controller contract LaserForge must satisfy before any Ruida implementation is attempted. It does not add a Ruida controller, binary encoder, transport, UI path, or hardware command.

## Scope

This document covers the safety-relevant shape for a future Ruida-family controller:

- How Ruida differs from the current GRBL line-stream model.
- How `ControllerSafetyCapabilities` should describe Ruida.
- How `ControllerSafetyOps` should map to native controller operations.
- How `JobExecutionSession` should own a device-side job handle.
- What `SafetyActionResult` must report for each safety operation.
- Which protocol and hardware facts are still unknown.

## Ruida Differences From GRBL

Ruida is not a GRBL dialect and must not inherit GRBL safety commands.

- Protocol: Ruida uses a binary protocol, not G-code text.
- Execution model: job delivery is file-upload plus device-side run, not host line streaming.
- Disconnect semantics: an uploaded job continues after host disconnect unless the controller receives a native stop; the host closing USB/Ethernet is not a stop command.
- Safety primitives: pause, resume, stop, and laser-off must be native job-state commands, not GRBL realtime bytes or M5.
- Progress model: the device should be treated as the progress authority. UI progress should prefer device-reported percentage over host lines-sent counters.
- Job identity: safety operations should target the active uploaded job id or handle, not a process-global stream.

## ControllerSafetyCapabilities

A first Ruida capability declaration should be conservative until verified against vendor documentation and hardware:

```ts
const ruidaSafetyCapabilities: ControllerSafetyCapabilities = {
  supportsEmergencyStop: true,
  emergencyStopMethod: 'native-stop',
  emergencyStopLatencyMs: 'unknown',

  supportsRecoverablePause: true,
  pauseStopsLaserOutput: 'unknown',
  pauseLatencyClass: 'unknown',
  resumeRequiresStateRestore: false,
  resumeSupportedAfterError: false,

  supportsLaserOff: true,
  laserOffCanBeVerified: 'unknown',
  laserOffMethod: 'native',

  supportsTestFire: false,
  testFireRequiresMotion: 'unknown',
  testFireMaxDurationMs: 0,

  disconnectStopsJob: false,
  stopInvalidatesPosition: 'unknown',
  stopRequiresRehome: 'unknown',

  executionModel: 'uploadedFile',
};
```

Notes:

- `disconnectStopsJob: false` is the load-bearing safety declaration. LaserForge must not assume unplugging or closing the host connection stops the job.
- `executionModel: 'uploadedFile'` means job start, progress, pause, resume, and abort are tied to a controller-side job record.
- `laserOffMethod: 'native'` means Ruida laser-off is a controller-native command with its own acknowledgement semantics.
- `emergencyStopMethod: 'native-stop'` means emergency stop is not GRBL soft reset.
- Unsupported or unverified operations should return `accepted: false`, not silently no-op.

The non-safety `ControllerCapabilities` shape should also advertise native binary output, a file-upload execution path, no raw GRBL console, and only operations proven by protocol documentation.

## ControllerSafetyOps

`ControllerSafetyOps` for Ruida should be implemented as a native adapter around the active device-side job handle.

- `pauseJob()` sends the native pause command for the active Ruida job. It should return accepted only after the controller accepts the pause request.
- `resumeJob()` sends the native resume command for the same job handle. It must refuse if no paused job handle is active.
- `abortJob(urgency)` sends the native cancel/stop-job command. For urgent and emergency urgency, it should choose the fastest safe native stop path.
- `emergencyStop()` sends the native emergency stop command and marks `requiresInspection: true` unless hardware verification proves a narrower state.
- `laserOff(reason, urgency)` sends a native output-disable command, then reports whether the controller acknowledged output off.
- `disconnectSafely()` must abort or verify idle before transport close; it cannot rely on transport close as the stop action.
- `beginTestFire()` and `endTestFire()` should remain unsupported until Ruida-specific low-power fire semantics are verified.

The implementation must not use GRBL `0x18`, `!`, `~`, or `M5 S0` as substitutes.

## JobExecutionSession Mapping

Ruida job execution should use `JobExecutionSession` as the owner of the uploaded job:

1. Compile/export produces a binary Ruida payload.
2. The controller uploads that payload and receives or derives a job id.
3. `JobExecutionSession` stores that job id plus upload/run status.
4. `pause`, `resume`, and `abort` call `ControllerSafetyOps` with the job handle.
5. `getProgress()` reads device-reported percentage when available.
6. `onComplete()` fires exactly once when the controller reports finished, aborted, or faulted.

This avoids pretending that host lines-sent progress or a disconnected stream represents device-side job state.

## SafetyActionResult Outcomes

Expected result semantics for the first Ruida implementation:

| Operation | Accepted case | Refused/unknown case |
|---|---|---|
| pauseJob | `action: 'pause'`, `motionState: 'paused'` if acknowledged, `laserState: 'unknown'` unless output-off is verified | `accepted: false`, message names unsupported, missing job handle, or controller refusal |
| resumeJob | `action: 'resume'`, `motionState: 'running'` if acknowledged | `accepted: false`, message names missing paused job or controller refusal |
| abortJob | `action: 'abortJob'`, `motionState: 'stopped'` if acknowledged, `positionTrusted: 'unknown'` until verified | `accepted: false`, `requiresInspection: true` if the job may still be running |
| emergencyStop | `action: 'emergencyStop'`, `requiresInspection: true`, `requiresReconnect: 'unknown'` until transport behavior is known | `accepted: false`, transitions the safety state to unsafe unknown |
| laserOff | `action: 'laserOff'`, `laserState: 'off'` only with explicit controller acknowledgement | `accepted: false`, `laserState: 'unknown'` |
| disconnectSafely | accepted only after idle verification or successful native abort | refused when an active job cannot be stopped or verified idle |
| beginTestFire/endTestFire | unsupported until vendor docs and hardware tests prove safe behavior | `accepted: false`, message says Ruida test fire is not implemented |

## Research Questions

Before implementation, gather:

- Which exact Ruida controller models and firmware versions are target devices?
- Which transport is required: USB, Ethernet, vendor DLL, or another bridge?
- What command starts, pauses, resumes, stops, and queries a job?
- Does the protocol expose an explicit laser-output-off acknowledgement?
- Does a stop command preserve head position, invalidate it, or require homing?
- What happens if the host disconnects during upload, during running, and while paused?
- How is job progress reported, and can it distinguish upload progress from burn progress?
- What low-power test-fire behavior exists, if any?
- What simulator or hardware fixture can reproduce faults repeatably?

Protocol documentation, sample traffic, and hardware required for testing are mandatory before code work.

## Non-Goals

- No production `RuidaController` in this ticket.
- No binary encoder or uploader in this ticket.
- No UI exposure for Ruida in this ticket.
- No claim that any Ruida safety command is verified.
- No reuse of GRBL safety bytes, GRBL WCS behavior, or GRBL line-stream assumptions.
