# Completed-job interface audit

Scope: the finished-run display, Done, repeat, archive and the completion boundary. Starting source: `377e692baf26a9f66ba3877f157213095c54b92f` (2026-09-21). No controller hardware was connected or operated.

## Findings

| Surface | Verified behaviour | Disposition |
| --- | --- | --- |
| Stream progress | `use-live-stream-progress.ts` holds a fully acknowledged `done` stream at 99%. `JobControls.tsx` and `LiveMotionBar.tsx` describe finishing and keep the live controls available. | Preserved. An acknowledgement counter is not proof that buffered motion has stopped. |
| Completion | `laser-post-job-settle.ts` sends the active driver's settlement marker and waits for two fresh Idle reports. It clears the streamer and marks `liveCanvasRun.timing` complete. `live-canvas-run.ts` can mark the route lifecycle `finished` at an earlier Idle report. | Done requires both the finished lifecycle and complete timing, plus no streamer, owned operation, unknown/non-Idle state, or retained controller fault. It does not perform settlement itself. |
| Finished-run display | The live canvas run is retained after completion. `use-canvas-motion-overlay.ts` removes stale terminal runs after a changed or empty project, but no explicit acknowledgement removed an unchanged completed run. | Added **Job complete / Done** to the job-actions dock. Done removes only the completed run display. It keeps the design and current preview inputs. |
| Repeat | `RunAgainControl.tsx` reads the immutable `lastCompletedReceipt`, checks current execution inputs, and delegates a fresh compilation, fingerprint comparison and Job Review. It never derives replay authority from the visible canvas trail. | Preserved. Done does not discard the receipt or alter the existing repeat/Frame contract. |
| Archive and recovery | `ExecutionArchivePanel.tsx` reads sealed stored artifacts. Interrupted-job recovery has its own capsule and controls. | Preserved. Done makes no repository, archive, recovery, project, controller or command call. Interrupted runs have no Done acknowledgement. |

The design is deliberately retained after a successful run. Finishing a physical job does not imply that its editable artwork should be deleted. A new or cleared project remains a separate deliberate editing action.

## Implementation

- `CompletedJobNotice.tsx` is an in-flow grid card inside the persistent job-actions dock. It remains available with the compact Artwork tab, stays within the sidebar, and does not introduce an overlay or resize the canvas. The dock is intentionally hidden when the sidebar is collapsed.
- The completion card uses compact copy and spacing so its explanation stays within one or two lines on the narrow rail. With a 640 × 450 window and the unresolved imported-machine disclosure, the available dock height cannot contain every action at once; the dock's local scroll fallback keeps Done, Frame and Start reachable without hiding the disclosure or tutorial.
- `completed-job-display.ts` checks current state and the displayed run's immutable plan plus start stamp atomically at click time. A stale button cannot clear a newer run. Trailing status samples for the same completed run do not make the button stale.
- The only mutation is `{ liveCanvasRun: null }`. The ordinary Start permit, compatibility Frame proof, compiled/reviewed artifact, artwork, selection, undo history, dirty state, archive, completion receipt and recovery capsule are untouched.
- Live Motion retains the exclusive Pause/Resume/Continue/Abort controls. A finishing, active, interrupted, errored or uncertain run does not expose Done.

## Verification

- New component tests cover successful dismissal, full remaining machine-state and nonempty artwork preservation, retained archive retrieval and repeat callback, remount and next-run behaviour, every active/interrupted stream and run lifecycle, settlement phases, operation ownership, controller faults and stale run identities.
- A new real-store GRBL simulator test runs a job through handshake, streaming and settlement, confirms the normal success state exposes Done, then verifies dismissal writes no additional controller bytes.
- `pnpm exec vitest run src/ui/laser/CompletedJobNotice.test.tsx src/ui/laser/CompletedJobNotice.simulator.test.tsx`: **2 suites, 30 tests passed**.
- Existing `LiveMotionBar.test.tsx`, `RunAgainControl.test.tsx` and `laser-post-job-settle.test.ts` also passed in the initial focused run. The initial simulator teardown timed out with fake timers still enabled; restoring real timers before disconnect fixed the harness and the rerun passed.
- Scoped ESLint and Prettier checks passed for every new TypeScript/TSX file.
- Application-wide checks and final visual inspection at 640 × 450 and 1366 × 768 are recorded in the main interface audit.

This is software and simulator evidence. It does not qualify controller firmware, an air cut, a material result, or a hardware safety function.
