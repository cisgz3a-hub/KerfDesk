## ADR-650 - Place Board is a compact movable canvas panel

**Status:** Accepted under the maintainer's explicit request for a small movable floating Place Board panel, 2026-10-21. Amends ADR-124's floating-panel presentation.

**Context.** The maintainer wants a compact toast-like tool on the canvas that can be moved out of the way on a small laptop screen.

**Decision.** Place Board remains a nonmodal canvas accessory, takes no layout space and starts at the top-right. Its expanded width is 260 px and its height is limited to 340 px or the available canvas height. Only the body scrolls. Its title bar is a pointer-capturing drag handle and supports arrow-key movement, larger Shift steps and Home to reset its position. Movement is clamped to keep the whole card inside the canvas; resizing or expanding the card rechecks those bounds. Position survives closing and reopening for the current workspace session.

Collapsing leaves a small horizontal title strip and keeps captured points and unfinished fields mounted. Capture-session ownership and busy-close behaviour stay in the existing panel gate. Collapse is unavailable during active capture, motion, verification or correction. Selecting a canvas verification marker expands the panel and scrolls its active check into view. The panel and verification overlay remain sibling accessories, preserving the overlay's canvas coordinate box. Pointer input on the card cannot fall through to motion-triggering canvas markers; keyboard movement cannot reach artwork nudge shortcuts.

**Boundaries.** This changes layout only. Existing controller commands, position identity checks, captured-board ownership, Frame/Start policy and licence behaviour remain unchanged. Software and rendered-layout checks do not qualify hardware registration.

**Verification.** Existing capture, motion-safety, correction, session and idle-render regressions remain applicable. Browser checks cover dragging, keyboard movement, resizing, compact bounds, unchanged canvas dimensions, preserved capture input, fixed headers, usable canvas zoom and matching verification-overlay bounds at laptop sizes. All machine inputs in those checks are simulated.
