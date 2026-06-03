# Karpathy Stage 1D Web Serial Cleanup Evidence - 2026-06-03

Repository verified:

- Worktree: `C:\Users\Asus\LaserForge-2.0`
- Remote: `https://github.com/cisgz3a-hub/LaserForge-2.0.git`
- Branch: `codex/main-working`

Purpose: close Stage 1D finding for Web Serial cable-yank resource cleanup.

## Finding Covered

- `KF-033`: Web Serial cable-yank path must release reader/writer locks without revoking permission.

## Red Tests Observed

Test file added:

- `src/platform/web/web-serial.test.ts`

Initial failures:

- `releases reader and writer locks on cable-yank without forgetting the port`
  - Expected `reader.cancel()` / `reader.releaseLock()` / `writer.close()` / `writer.releaseLock()`.
  - Actual lock cleanup calls were 0.

- `releases reader and writer locks when the read loop ends without forgetting the port`
  - Expected cleanup on the read-loop-finally path.
  - Current adapter did not share stream cleanup with that path.

Existing behavior proven:

- `calls forget only on explicit user close`
  - Explicit `conn.close()` called stream cleanup, `port.close()`, and `port.forget()`.

## Implementation Summary

- `src/platform/web/web-serial.ts`
  - Added idempotent `closeStreamsOnce()` around reader/writer cleanup.
  - Added `handleDroppedConnection()` for both hardware `disconnect` events and read-loop end.
  - Cable-yank/read-loop-end now release reader/writer locks and notify close subscribers.
  - Explicit `close()` remains the only path that calls `port.close()` and `port.forget()`.

## Commands Run

### Initial red test

Command:

```powershell
corepack pnpm test src/platform/web/web-serial.test.ts
```

Result:

- Failed as expected before implementation.
- 2 failures matched missing cable-yank/read-loop cleanup.
- Explicit close/forget test already passed.

### Focused Stage 1D verification

Command:

```powershell
corepack pnpm test src/platform/web/web-serial.test.ts
```

Result:

- Pass.
- 1 test file passed.
- 3 tests passed.

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

This is resource recovery, not physical machine stopping. If USB is physically lost during a buffered GRBL job, the firmware may continue executing already-buffered motion. This fix prevents stale browser stream locks from poisoning reconnect after cable-yank.

## Browser Smoke

Not run in this lane. A real browser reconnect smoke needs a physical Web Serial device and should be supervised separately from unit tests.
