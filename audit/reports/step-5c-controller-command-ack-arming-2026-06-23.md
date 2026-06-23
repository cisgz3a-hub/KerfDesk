# Step 5C: Controller Command ACK Arming Audit

Date: 2026-06-23
Repo: `C:\Users\Asus\LaserForge-2.0`
Step: Step 5 from the LaserForge 10/10 loop
Scope: Interactive controller command lifecycle for Home, post-job settle, guarded settings writes, and future one-command operations.

## Locked Goal

Prevent stale controller acknowledgements from completing the next controller operation before LaserForge has confirmed that the new command was written to the serial connection.

Success criteria:

- A late or stray `ok` cannot advance post-job settle before the internal `G4 P0.01` marker write has resolved.
- Home and guarded firmware writes still complete after their real ACKs.
- Existing post-job settle, Home, recovery, console, frame/jog, sleep/alarm recovery, progress, and GRBL streamer tests remain green.
- Full repo tests, typecheck, lint, file-size policy, build, and whitespace checks pass.

Out of scope:

- Hardware smoke on a live Falcon or 4040 from this Codex environment.
- Streaming protocol changes.
- New UI states or copy.
- Exported G-code changes.

## Research Evidence

LaserForge source inspected:

- `src/ui/state/laser-interactive-command.ts`
- `src/ui/state/laser-controller-lifecycle.test.ts`
- `src/ui/state/laser-store.test.ts`
- `src/ui/state/laser-store-machine-settings.test.ts`
- `src/ui/state/laser-line-handler.ts`
- `src/ui/state/laser-store.ts`
- `src/platform/web/web-serial.ts`
- Existing Step 5 audit reports for controller stall watchdog and profile streaming options.

Useful prior Step 5 lesson:

- Treat job streaming, controller commands, status reports, and operation completion as separate lifecycle states. A response line should not be allowed to complete the wrong lifecycle stage.

No Rayforge code was copied.

## Failing Proof

Red test added before the implementation fix:

```powershell
pnpm exec vitest run src/ui/state/laser-controller-lifecycle.test.ts
```

Failure:

- Test: `ignores a stray ok before the post-job settle marker write is confirmed`
- Expected `controllerOperation.phase` to remain `dwell`
- Received `awaiting-idle`

Trigger path:

1. A job finishes streaming and LaserForge starts post-job settle.
2. LaserForge dispatches the internal `G4 P0.01` settle marker.
3. The serial write promise has not resolved yet.
4. A stale `ok` arrives.
5. Old behavior consumed that stale `ok` as the settle-marker acknowledgement and advanced to fresh-Idle wait.

Failure mode:

- The next controller operation could be advanced by an acknowledgement that belongs to an earlier command or stale controller state.

Consequence:

- Controls can appear ready too early after a job, Home, or guarded setting operation.
- A later real ACK can arrive when no command is waiting, making the controller lifecycle harder to reason about after jobs.

## Implementation Summary

Changed files:

- `src/ui/state/laser-interactive-command.ts`
  - Added `acceptingResponses` to each controller command request.
  - New controller commands start with response acceptance disabled.
  - Response acceptance is enabled only after the command write promise resolves and the same request is still current.
  - `ok`, `error`, and `ALARM` responses are ignored by the command helper until that point, so stale responses continue through the normal line handler path.

- `src/ui/state/laser-controller-lifecycle.test.ts`
  - Added the stale-ACK red/green regression proof.
  - Increased microtask flushing in the simulator helper so tests emit ACKs after writes are armed.

- `src/ui/state/laser-store.test.ts`
- `src/ui/state/laser-store-machine-settings.test.ts`
  - Updated simulator flush helpers to respect the new command-arming contract.

## Verification

Targeted controller lifecycle suite:

```powershell
pnpm exec vitest run src/ui/state/laser-controller-lifecycle.test.ts src/ui/state/laser-store-active-job-command-guard.test.ts src/ui/state/laser-store.test.ts src/ui/state/laser-store-motion-operation.test.ts src/ui/state/laser-store-console.test.ts src/ui/state/laser-store-machine-settings.test.ts src/ui/state/laser-store-grbl-setup.test.ts src/ui/laser/LaserWindow-sleep-recovery.test.tsx src/ui/laser/LaserWindow-alarm-recovery.test.tsx src/ui/laser/JobControls.progress.test.tsx src/core/controllers/grbl/streamer.test.ts
```

Passed: 11 files, 95 tests.

Repo gates:

- `pnpm typecheck` passed.
- `pnpm lint` passed. Existing boundaries legacy-selector warning remains unchanged.
- `pnpm check:file-size` passed.
- `pnpm test` passed: 343 files, 2125 tests.
- `pnpm build` passed. Existing large bundle warning remains unchanged.
- `git diff --check` passed.

Hardware smoke:

- Not run from Codex; no live laser controller was available in this environment. This code slice is simulator-verified and should still receive operator hardware smoke before being treated as physically proven on the Falcon or 4040.

## Audit Findings

No accepted findings.

Rejected false positives:

- "This could ignore a real controller ACK forever." Rejected for the current implementation because the ACK is accepted immediately after `writer.write(...)` resolves. A real GRBL acknowledgement cannot be produced before the controller receives the command; the simulator test intentionally proves that only pre-write stale responses are ignored.
- "The command timeout should start only after write resolution." Rejected as out of scope for this bug. The previous behavior already timed from command creation, and normal Web Serial writes should resolve quickly; write failures are still rejected through the existing catch path.
- "Browser smoke is required." Rejected for this slice because there is no new visible UI surface. The affected workflow is controller-state handling and is covered by simulated controller tests.

## Rating

Correctness: 10/10
Safety: 10/10
UX: 10/10
Regression coverage: 10/10
Real-artifact evidence: 10/10 for simulator and build artifacts; hardware smoke remains operator follow-up.
Maintainability: 10/10
Docs/audit clarity: 10/10

Overall Step Rating: 10/10 for the software lifecycle slice.
