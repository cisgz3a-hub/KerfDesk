## ADR-620 - Artwork rests in ink; operation colours pulse on hover (2026-10-18)

**Status:** Accepted; the pulse's timing, strength, glow and edge (decision 2) amended by ADR-632; its drawing cost (decision 8) by ADR-632 Amendment 1 and ADR-620 Amendment 1 (only pieces in view; rests while the view moves). | **Date:** 2026-10-18

### Context

Every new artwork gets its own operation, and each operation a distinct colour from
`OPERATION_PALETTE` (black, then blue, red, green and so on). The workspace painted every path in
its operation colour, Fill artwork as solid blocks of it. The maintainer likes that the colours
show which pieces have different settings, but found the canvas restless and disorienting: the
colour follows import order rather than meaning, pieces with identical settings still look
different, and imported artwork stops looking like itself. They ruled out an on/off toggle and
asked for a way to keep the idea, then chose this design from a brainstorm and an interactive
mock-up, with a 1400 ms pulse.

### Decision

1. **Ink at rest.** In Design and Wireframe views, artwork that an operation owns is drawn in the
   canvas artwork ink (`canvasTheme.artworkInk`, which follows the light/dark canvas theme).
   Colours that no operation owns still draw as themselves, so stray artwork stays visible. The
   Preview underlay, raster and relief bitmaps, Design Studio and remote-control views keep their
   current colours, and so does the Registration Jig editor, which has no hover pulse or Alt peek.
   `resolveObjectDisplay` takes the palette as a parameter that defaults to operation colours;
   only the workspace asks for ink. Its sprite style key records which paths survived visibility,
   since in ink every path paints alike. The pulse follows Wireframe View (Fill artwork pulses as
   outlines) and repaints when the canvas theme changes.
2. **One pulse on hover.** With the Select tool at rest, when the pointer settles (90 ms) on a
   piece, that piece and every piece whose operation has the same settings pulse once in the
   hovered piece's operation colour: a quick rise, a short hold, a fade over 1400 ms in all, with
   a glow that blooms outward. Every artwork has its own operation colour, so pulsing each piece
   in its own colour would flash a same-settings group as a rainbow; one colour says "these share
   the settings you point at". The pulse ripples outward from the hovered piece (at most 420 ms of
   stagger). A piece already mid-pulse finishes its pulse rather than restarting, and a click or
   drag on the hovered piece pauses the hover without starting a second pulse. While the pointer
   stays, a soft colour edge remains; it fades when the pointer leaves the piece's box. Locked
   artwork pulses too: the hover is display only, and the piece under a locked one must not answer
   for it (`hitTest` takes `includeLocked` for this; selection still skips locked artwork). An
   edit during a hover, such as Paste settings on the hovered row, regroups the pieces without a
   second pulse.
3. **Same settings** means what output would do, not how settings are stored
   (`pulse-settings-match.ts`). For a laser project: `layerOperationSettingsEqual` after an
   optional setting an older operation never stored takes the value output uses when it is absent
   (perforation off, count tabs, no overcut and so on; the power mode and bidirectional scan offset
   stay machine-dependent), plus sub-operations compared by their enabled state and settings, not their
   ids or labels. For a CNC project: equal CNC settings, where an operation with no CNC block counts
   as the CNC defaults as it does in output, compared with object keys sorted. Name, colour and
   visibility do not count. Per-artwork setting overrides are not considered.
4. **Operation rows.** Resting the pointer (90 ms) on an operation row in the Artwork panel pulses
   that operation's artwork and its same-settings siblings in the row's colour, sweeping left to
   right. Passing over rows without settling pulses nothing. Keyboard focus settling within a row
   does the same and ends when focus leaves the row, so the pulse is not pointer-only (2026-10-20
   audit fix).
5. **Hold Alt to peek.** Holding Alt (Option on a Mac) alone for 150 ms draws every operation
   colour, as before this decision; releasing returns to ink. Any other key during the hold
   (Alt+W, Alt+arrow alignment) cancels it, a quick tap does nothing, and losing window focus ends
   it. A peek suppresses the browser's menu focus on release. Alt held while focus is in a text
   field (an editable target) is typing and never peeks (2026-10-20 audit fix).
6. **Reduced motion.** With the operating system's reduced-motion setting, the colour and edge
   show while the pointer rests, without the pulse or glow.
7. **The first operation is blue.** Black moves to the end of `OPERATION_PALETTE`: a black
   operation would pulse invisibly against the ink. Black stays in the palette, so the exported
   palette keeps the same 13 colours. Existing projects keep their colours; a black operation
   pulses with a dark glow only.
8. **Drawing cost.** The pulse is painted on its own pointer-transparent canvas above the
   workspace, so it never redraws the scene. Each piece's colour geometry is rendered once into a
   small bitmap per hover; frames only blit it and a blurred outline copy (canvas shadow) for the
   glow and edge. Frames run only while a pulse or edge fade is in flight.

### Alternatives

- **An on/off toggle for operation colours.** Rejected by the maintainer.
- **Colour only when settings differ, kept on the canvas at rest.** Kept the colours visible but
  still recoloured artwork; superseded by the hover design, whose same-settings group carries the
  same idea.
- **A colour chip or outline tag on each piece.** Adds permanent marks to the canvas.
- **Pulse through a full scene redraw.** Dense traces cost hundreds of milliseconds per repaint
  (ADR-346); a separate layer keeps the pulse independent of scene size.

### Consequences

- Operation colours on the canvas need a hover or Alt. The Artwork panel rows still show them.
- Wireframe View outlines Fill artwork in ink rather than in its operation colour.
- Tests that assumed a black first operation now expect blue.
- Display only: G-code, Preview, Frame, Start, saved projects and export are unchanged.

### Verification

`src/ui/workspace/artwork-pulse.test.ts` covers the pulse shape, settings grouping, ripple and
sweep offsets, one pulse per hover, edge fade and reduced motion. `object-display.test.ts` covers
ink at rest, orphan and Preview colours and the sprite style key. The Alt peek and operation row
hover have component tests. The look was checked in the browser build; no hardware is involved.
