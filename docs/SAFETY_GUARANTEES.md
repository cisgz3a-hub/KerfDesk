# Safety guarantees

Audit 5A Required Priority 9: entitlement state must never affect safety
controls. A user whose license has expired, been revoked, or is in
`verification_failed` state in the middle of a running job must still be
able to stop the machine, kill the laser, disconnect, and recover.

## Controls that MUST work regardless of entitlement state

The following actions must complete without consulting `hasPro`,
`canUseFeature`, `assertFeature`, `EntitlementState.status`, or any
other entitlement signal:

| Method / handler | Module | What it does |
|---|---|---|
| `MachineService.stopAndEnsureLaserOff` | `src/app/MachineService.ts` | Stops the running job and soft-resets the controller (laser off as part of the reset sequence). |
| `MachineService.pause` | `src/app/MachineService.ts` | Sends GRBL feed-hold + emits explicit M5 (T1-23). |
| `MachineService.resume` | `src/app/MachineService.ts` | Re-asserts spindle modal (T1-23) and sends cycle-start. |
| `MachineService.disconnect` | `src/app/MachineService.ts` | Tears down the transport, releases the port, clears job state. |
| `GrblController.emergencyStop` | `src/controllers/grbl/GrblController.ts` | Realtime soft-reset (0x18) and disconnect (T1-4). |
| `GrblController.safetyOff` | `src/controllers/grbl/GrblController.ts` | Two-stage M5 critical-write → soft-reset fallback (T1-22). |
| `ExecutionCoordinator.runFrame` | `src/app/ExecutionCoordinator.ts` | Frame motion safety scope (T1-21 try/finally). |
| Job log save / view | `src/app/JobLog.ts`, `src/ui/components/JobLogViewer.tsx` | Post-job diagnosis must remain available for support cases. |
| Connection wizard | `src/ui/components/connection/*` | Reconnecting to a stuck machine is a recovery action. |
| `$X` unlock | command pathway in `MachineService.sendCommand` with `'system'` source | Clearing an alarm to disconnect cleanly. |

## Why this matters

If an entitlement check ever lands inside one of those methods, the
specific user-trust failure the audit flags becomes possible: a paid
user mid-burn whose Gumroad license validation failed transiently
loses the ability to stop their machine. That's both a safety incident
and a legal liability.

## How this is enforced

Pinned by `tests/safety-controls-bypass-entitlement.test.ts`:

1. **Behavioral checks** — exercise each safety method against three
   entitlement states (`free`, `verification_failed`, `revoked`) and
   assert each method completes without throwing an entitlement-related
   error.

2. **Static guard** — scan the safety-critical files listed below for
   any import of `entitlements/` or any call to `requireFeature` /
   `assertFeature` / `canUseFeature` / `hasPro()`. Any match fails the
   test with the file + line for review.

The static-guard files are:

- `src/app/MachineService.ts`
- `src/app/ExecutionCoordinator.ts`
- `src/controllers/grbl/GrblController.ts`
- `src/communication/SerialPort.ts`
- `src/communication/WebSerialPort.ts`

If a future commit needs to gate a non-safety feature on entitlement
in one of those files (very unlikely), update this document with the
exception and the rationale before adding the import. The static
guard reads its allow-list from this paragraph at lint time — keep
the section heading text stable so the parser finds it.

## Allow-list

(none)

## Audit reference

Audit 5A user-trust failure mode + Required Priority 9. T1-78 already
removed the only entitlement consumer that lived inside a safety file
(see comment at `src/app/MachineService.ts:8`). T2-97 makes the
guarantee permanent.
