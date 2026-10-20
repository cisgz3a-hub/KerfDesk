## ADR-642 - Controller recovery opens over the canvas, the machine rail never overlaps its tabs, and hand-set origins burn over the artwork (2026-10-19)

**Status:** Accepted at the maintainer's request. | **Date:** 2026-10-19

Amends ADR-611 (where controller recovery is announced), ADR-327 item 7 and ADR-343 (the
canvas frame of origin-anchored jobs on a homed machine). Builds on ADR-634, which floats the
safety notice over the canvas. No Frame or Start gate changes (ADR-565), and nothing here sends a
command to the machine.

### Context

The maintainer reported three problems while running jobs:

1. When the controller ran into a problem, the safety notice popped up over the canvas, but the
   controller recovery (**Retry reading controller settings**, **Reconnect controller**) was
   hidden. Since ADR-611 every new failure started closed. The only sign was a "Controller is not
   responding" line in a 28 px slot beside the Laser/CNC switch. It was cut short with an
   ellipsis, disappeared after six seconds, and appeared only if the controller had also
   stopped answering. A reconnect that ownership needed showed nothing at all.
2. During a live job, the orange line "Pause is feed hold only. Use ABORT JOB or the physical
   E-stop if unsafe." was drawn over the Origin, Placement and Console tabs. In the fixed-height
   machine rail every row refused to shrink except the tabs box (`min-height: 0`). When a job
   added its safety line, overrides and progress bar, that box collapsed below its 30 px tabs.
   The tabs overflowed, and the rows that followed were drawn on top of them.
3. With a traced image on the canvas, the operator moved the head, pressed **Set origin**, and
   started the job. The canvas then showed the artwork and a second, burning copy beside it. On a
   homed machine `canvasCoordinateFrame` drew User Origin and Current Position jobs in the machine
   frame, at the bed position where the origin sits. The job burns the artwork relative to that
   origin, not where the artwork sits on the canvas.

### Decision

1. **Recovery opens by itself.** A failed settings read on a controller that stopped answering
   status queries opens the recovery card at the top centre of the canvas, in the same floating
   stack as the safety notice and below it (`controllerRecoveryKey`). That rule is re-read on
   every store write and once a second, as the connection bar's **Not responding** is (ADR-611
   Amendment 1), because a status write stuck in a wedged transport stops the store writes. A
   read that failed while status replies keep arriving stays in Controller info, even when a
   reply still owed (one `ok` lost on a settings read) makes Reconnect the recommendation there:
   Reconnect ends any paused job, and ADR-611 and #1235 keep such reads from popping up. The
   card has Retry and Reconnect, and it does not take keyboard focus. Its close button folds it
   into one
   **Controller needs recovery** row. That row stays at the top of the canvas until the
   controller recovers. A new failure (new epoch or message) opens the card again. The six-second
   toolbar line is removed, and the toolbar keeps an empty spacer so its controls do not move.
   ADR-611 still applies to routine reads: reading settings after a reset, and a failed read on a
   controller that still answers, raise nothing. Controller info in the connection menu is
   unchanged.
2. **The rail scrolls before anything overlaps.** The job controls and the utility tabs box keep
   their content height as a floor (`min-height: auto`). The open utility dropdown has
   `contain: size`, so only its own 80 px minimum, not its content, sets that floor. With room
   to spare, an open Console, Origin or Placement utility still fills the rail and scrolls inside
   itself, as before. When the rail is too short, the whole rail scrolls instead of drawing rows
   over the tabs. On a short panel (`max-height: 440px`), where the whole rail already scrolls,
   containment is lifted so an open utility still shows all of itself.
3. **Hand-set origins draw over the artwork.** User Origin and Current Position jobs use the
   artwork-relative frame on every machine. The planned route, live burn, head marker, approach
   line, Frame outline and start markers all land on the artwork the operator sees. When the bed
   position is known, the frame keeps it (`bed`). The idle badge does not call such a plan
   "bed position unverified". With the camera overlay on, whose picture shows the real bed, the
   idle badge says **Drawn over artwork — burns at your origin** instead, because the route on
   that picture is not where the job burns. The camera job watch (ADR-490) shifts the route back
   by the constant offset between the two frames (`artworkToBedShift`), so it still photographs
   where the job really burns. Absolute Coords jobs keep the machine frame, which matches the canvas.
   Verified Origin and unknown bed positions keep their existing relative view and label.

### Evidence and limits

- `WorkspaceControllerRecovery.test.tsx`: the card opens over the canvas when the controller
  stops answering, including when only the one-second re-check sees the silence, and does not
  take focus. It stays quiet for a read that failed while the controller answers, also when a
  reply is still owed and Reconnect is recommended, and during post-reset reads. It folds into a row that keeps the same
  failure folded, reopens for a new failure, stacks under the safety notice, and reconnects
  through the store. `ConnectionBar-info-recovery.test.tsx` now pins that the toolbar never
  announces a failed read, and that Controller info still works from the menu.
  `e2e/controller-recovery-toast.spec.ts` checks at eight window sizes that the card floats over
  the canvas without moving the toolbar.
- `canvas-motion-plan.test.ts` pins Absolute on a homed machine in the machine frame, and homed
  User Origin and Current Position jobs over the artwork with their bed frame and shift.
  `canvas-motion-badge-camera.test.tsx` pins the idle label with the camera overlay on and off.
  `job-burn-route.test.ts` pins that the job watch looks at the same bed region and masks for
  both frames.
- `e2e/machine-rail-live-job.spec.ts` simulates a streaming job in the rail and checks, with the
  Console utility closed and open, that the tabs box stays as tall as its tabs and that no row
  starts inside the previous one. A height sweep with the old rules injected reproduced the bug
  only where the rail neither fits nor falls back to whole-rail scrolling: at 1280x720 the tabs
  box was 18 px for 30 px tabs, with or without the Console open. With this change it is 30 px
  closed and 115 px open, and the rail scrolls. Rendered and unit-tested only; no machine was
  operated.
