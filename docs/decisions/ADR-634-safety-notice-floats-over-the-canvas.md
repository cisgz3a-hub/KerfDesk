## ADR-634 - The machine-safety notice floats over the canvas instead of pushing the workspace down (2026-10-19)

**Status:** Accepted. | **Date:** 2026-10-19

This changes only where the machine-safety notice (P0-B, `SafetyNoticeBanner`) is drawn. What
raises it, its titles and copy, its Reconnect and Reset offers, and the rule that only **I made
the machine safe** clears it are unchanged. No guard is added (ADR-228).

### Context

The notice rendered as the first row of the machine toolbar. When a controller write failed
("Controller write failed"), or any other safety notice was raised, that row made the top bar
taller and pushed the canvas and both rails down. The maintainer asked for it to behave like a
toast that does not affect the rest of the screen.

The normal toast stack (`Toasts`) is not suitable: its toasts expire after a few seconds,
ignore pointer input apart from their close button, and carry no action buttons. A safety
notice must stay until acknowledged and must keep its recovery actions.

### Decision

1. The notice is a card at the **top centre of the canvas** (`WorkspaceSafetyNotice`, among the
   canvas accessories). It is absolutely positioned, so raising or clearing it never changes the
   size or position of the top bar, the canvas or the rails.
2. On a canvas narrower than the card (a phone with a side panel open, where the canvas can be
   74 px wide) it would shrink to an unreadable column, so it spans the window from the top of
   the canvas instead (a CSS container query on the canvas width). Only then does it cover part
   of a panel, and only its top: Frame job and Start stay clear.
3. Otherwise it never covers the rails, which hold the job controls. The top right corner stays
   with the machine setup card, the registration jig panel and the G-code bar; normal toasts and
   zoom stay at the bottom. It shares the top centre with the update card and is drawn above it:
   a safety incident outranks an available update. For the same reason it is drawn above the
   in-canvas hints (the run-order numbering prompt at the top centre, and the trace, tab, trim
   and warp hints that reach up from the bottom left of a short canvas). The menu bar, popovers,
   modal dialogs and the Live Motion popup stay above it. While the Live Motion popup is up (a
   job, jog or Frame), the notice measures it, as the toast stack does, and ends above it, so the
   popup never hides the notice's buttons on a short window.
4. It keeps its current behaviour: `role="alert"`, the same Reconnect controller…, Reset
   controller and **I made the machine safe** actions, and no timeout or close button. It is at
   most 420 px wide and scrolls inside itself on a short canvas. Clicks beside it still reach the
   drawing.
5. The toolbar and the notice share one reconnect action (`useControllerReconnect`), so both
   still check at click time that a reconnect is recommended and use the profile's connect
   options (ADR-334).

### Evidence and limits

`WorkspaceSafetyNotice.test.tsx` pins that a failed write appears over the canvas and not in
the machine toolbar, that its layer is above the in-canvas hints and below modal dialogs, and
that it stops above the Live Motion popup while that is open. `e2e/safety-notice-toast.spec.ts`
raises a write-failed notice at several window sizes (1920 to 360 px) and checks that the top
bar, canvas and rails keep their positions, that the notice sits inside the canvas or spans the
window when the canvas is too narrow, and that it never overlaps Frame job or Start. Rendered and
unit-tested only; no machine was operated.
