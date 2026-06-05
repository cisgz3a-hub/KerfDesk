# Karpathy Stage 1C Autofocus Lifecycle Evidence - 2026-06-02

Repository verified:

- Worktree: `C:\Users\Asus\LaserForge-2.0`
- Remote: `https://github.com/cisgz3a-hub/LaserForge-2.0.git`
- Branch: `codex/main-working`

Purpose: close Stage 1C finding for autofocus operation lifecycle and competing machine-motion controls.

## Finding Covered

- `KF-032`: autofocus must be represented as an active operation, block competing motion/safety-affecting actions, and surface timeout recovery honestly.

## Red Tests Observed

### Second Autofocus

Test added:

- `src/ui/state/laser-store.test.ts`
- `refuses a second autofocus while one is already pending`

Initial failure:

- Expected second autofocus to return `preflight-failed`.
- Actual result was `{ kind: 'ok' }`.

### Jog During Autofocus

Test added:

- `src/ui/state/laser-store.test.ts`
- `refuses jog commands while autofocus is pending`

Initial failure:

- Expected jog to reject while autofocus was pending.
- Actual jog resolved successfully.

### Timeout Recovery Copy

Test added:

- `src/ui/state/autofocus-action.test.ts`
- timeout mapping must mention the machine may still be moving and physical stop/power.

Initial failure:

- Existing message only said: `Check the log for the last response.`

## Implementation Summary

- `src/ui/state/laser-store.ts`
  - Added `autofocusBusy` to `LaserState`.
  - `autofocus()` now sets a busy lease while `runAutofocus()` is pending, clears it in `finally`, and refuses a second autofocus while active.
  - Home, Jog, Frame, Start, Set Origin, Reset Origin, and Disconnect now reject while autofocus is active.

- `src/ui/laser/start-job-readiness.ts`
  - Start readiness now blocks when `autofocusBusy` is true.

- `src/ui/laser/LaserWindow.tsx`
  - Disconnect, JogPad, and JobControls receive disabled state while autofocus is active.

- `src/ui/state/autofocus-action.ts`
  - Timeout copy now says the machine may still be moving and tells the operator to use physical stop or power cutoff if unsafe.

## Commands Run

### Initial autofocus lifecycle red test

Command:

```powershell
corepack pnpm test src/ui/state/laser-store.test.ts
```

Result:

- Failed as expected before implementation.
- 2 failures matched missing busy lease behavior.

### Timeout copy red test

Command:

```powershell
corepack pnpm test src/ui/state/autofocus-action.test.ts
```

Result:

- Failed as expected before copy update.
- Timeout message did not mention moving machine or physical stop/power.

### Focused Stage 1C verification

Command:

```powershell
corepack pnpm test src/ui/state/autofocus-action.test.ts src/ui/state/laser-store.test.ts src/ui/laser/start-job-readiness.test.ts src/ui/laser/LaserWindow.test.tsx
```

Result:

- Pass.
- 4 test files passed.
- 45 tests passed.

### TypeScript typecheck

Command:

```powershell
corepack pnpm run typecheck
```

Result:

- Pass.
- `tsc --noEmit` exited 0.

### Root lint

Command:

```powershell
corepack pnpm run lint
```

Result:

- Pass.
- Remaining output is the known boundaries plugin v6 legacy-selector warning, not a lint failure.

## Safety Note

This is host-side operation gating. It prevents LaserForge from sending new host commands while autofocus is pending. It does not prove a timed-out autofocus command physically stopped; the timeout copy now states that honestly and points the operator to physical stop or power cutoff if unsafe.

## Remaining Required Proof

- Hardware proof is still required before calling the autofocus lane machine-proven:
  - supervised low-power/dry autofocus command,
  - verify Jog/Frame/Start/Origin/Disconnect remain unavailable during the command,
  - verify timeout warning wording if a timeout can be induced safely.
