# Karpathy Stage 1A Serial Safety Evidence - 2026-06-02

Repository verified:

- Worktree: `C:\Users\Asus\LaserForge-2.0`
- Remote: `https://github.com/cisgz3a-hub/LaserForge-2.0.git`
- Branch: `codex/main-working`

Purpose: close Stage 1A findings for serial write truth, streamer races, and active Disconnect behavior.

## Findings Covered

- `KF-001`: app Disconnect during an active job must not use the idle close path.
- `KF-011`: an early GRBL `ok` during the initial job write must not be dropped.
- `KF-012`: an ack-triggered follow-up write failure must not leave the streamer pretending the bytes are in flight.
- `LF-AUDIT-001`: older serial write truth finding mapped to the current Stage 1A findings.

## Red Tests Observed

### Active Disconnect

Test added:

- `src/ui/state/laser-store.test.ts`
- `sends soft reset before disconnecting an active job`

Initial failure:

- Expected `RT_SOFT_RESET` to be written before close.
- Actual write call count was 0.

### Fast Initial Ack

Test added:

- `src/ui/state/laser-store.test.ts`
- `keeps an initial job ack that arrives before the first write resolves`

Initial failure:

- Expected streamer `completed` to be 1.
- Actual streamer `completed` was 0.

### Ack-Triggered Follow-Up Write Failure

Test added:

- `src/ui/state/laser-line-handler.test.ts`
- `marks the streamer disconnected if an ack-triggered follow-up write fails`

Initial failure:

- Expected streamer status `disconnected`.
- Actual streamer status was `streaming`.

## Implementation Summary

- `src/ui/state/laser-store.ts`
  - Added `isActiveJob` helper.
  - `disconnect()` now writes GRBL `RT_SOFT_RESET` before teardown when the streamer is `streaming` or `paused`.
  - `startJob()` now installs the initial streamer state before the first serial write so fast `ok` replies can be accounted for.
  - If the initial write rejects, `startJob()` rolls streamer state back to `null` and rethrows.

- `src/ui/state/laser-line-handler.ts`
  - If an ack-triggered follow-up write rejects, the streamer moves to `disconnected` based on the last acknowledged state instead of leaving failed outbound bytes marked as delivered.

## Commands Run

### Formatting

Command:

```powershell
corepack pnpm exec prettier --write src/ui/state/laser-store.ts src/ui/state/laser-store.test.ts src/ui/state/laser-line-handler.ts src/ui/state/laser-line-handler.test.ts
```

Result:

- Pass.
- All four files unchanged by Prettier.

### Focused Stage 1A tests

Command:

```powershell
corepack pnpm test src/ui/state/laser-store.test.ts src/ui/state/laser-line-handler.test.ts
```

Result:

- Pass.
- 2 test files passed.
- 10 tests passed.

### TypeScript typecheck

Command:

```powershell
corepack pnpm run typecheck
```

Result:

- Pass.
- `tsc --noEmit` exited 0.

## Safety Note

This does not claim software can stop a machine after USB is already lost. It only fixes host behavior while the serial link is still available:

- App Disconnect during an active job now attempts GRBL soft reset before close.
- Cable yank / OS disconnect can still leave buffered firmware motion running.
- Physical E-stop or power cutoff remains the required stop method when the machine is unsafe.

## Remaining Required Proof

- Hardware proof is still required before treating the safety lane as fully machine-proven:
  - supervised low-power job,
  - app Disconnect during running job,
  - separate supervised USB-pull recovery test.
