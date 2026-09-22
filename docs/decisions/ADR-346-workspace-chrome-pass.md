## ADR-346 - Workspace chrome pass: menu-bar Undo, one rail width, tutorials only on tools, zoom-aware rulers, hover size (2026-09-22)

**Status:** Accepted. | **Date:** 2026-09-22

### Context

One session of maintainer feedback on the workspace, all of it the same
complaint in five places: the chrome moves when it should not, and the facts an
operator wants are not where they are looking.

1. **Undo had no visible home.** `Ctrl+Z` and **Edit → Undo** were the only
   ways to take an edit back — fine once you know them, invisible while you are
   dragging artwork around the bed, which is exactly when a misplaced drag
   needs undoing.
2. **Switching the Artwork / Operations rail to Run order resized the rail.**
   ADR-225's 2026-09-19 amendment said "Run order continues to widen the
   Artwork / Operations panel" — Spacious 300 px → 400 px, Compact's clamp
   ceiling 400 px → 430 px. Choosing a *view* is not a request to resize the
   window: the canvas jumps sideways mid-task, and the widened inline width
   also overwrote whatever width the operator had dragged the rail to, because
   the React style attribute wins on the next render.
3. **The tutorial book was everywhere.** Every menu row, every dialog header,
   every rail section header, and dozens of individual settings rows carried
   the same small book icon. At that density it stopped reading as help and
   started reading as noise on top of every control.
4. **The rulers ticked every 10 mm and labelled every 50 mm at every zoom.**
   Zoomed out that is a grey smear with labels crowding each other; zoomed in
   on a 2 mm detail the nearest label can be off-screen, so the strip says
   nothing about where you are. Nothing tracked the pointer, either.
5. **Size was only readable once artwork was selected** — from the numeric bar,
   or by dragging a handle and watching the drag chip. "How wide is that one?"
   required changing the selection to find out.

### Decision

1. **The menu bar carries an Undo / Redo pair** (`MenuBarHistoryControls`),
   immediately after Help, before the build version. It renders the registry's
   own `edit.undo` / `edit.redo` commands — same enablement, same titles, same
   handlers — so the buttons, the Edit menu and the shortcuts cannot disagree
   about whether there is anything to undo. Each button is disabled when its
   own history is empty rather than hidden, so the pair never reflows. It sits
   OUTSIDE the `role="menubar"` nav (a menubar takes menuitems only) but inside
   a shared wrapping row, so a narrow window wraps the pair with the menus
   instead of stranding it on a line of its own.
   *The pair was first built as a canvas overlay at top-left; the maintainer
   moved it to the menu bar.*
2. **The rail has one width for every view.** ADR-225's amendment clause is
   superseded: Run order, Settings and Materials all render at the rail's
   current width, and the operator's own horizontal resize survives a view
   switch. The Run order cards were already built to shrink — `min-width: 0`,
   ellipsised identity lines, `overflow-wrap: anywhere` summaries — so the
   narrower rail costs wrapping, not overflow.
3. **Tutorial buttons survive only on tool surfaces**: Registration jig,
   Camera (panel and wizard), Place board, Trace, Image Studio and Design
   Studio (their top bar), plus the labelled **Learn** destination in the
   toolbar. Every other instance is removed — the per-menu-row button, its
   `CommandTutorialButton` component and the `COMMAND_TUTORIALS` map it read, the `Dialog` / `RailSection` /
   `RailPanelHeading` header buttons and their now-dead `tutorialId` props, the
   machine rail panels (Jog, Origin, Console, Connection, Frame & Start,
   Probe), and the per-settings-row buttons (holding tabs, dogbone, offset,
   relief, materials, text, cut settings, run order, operations). **The
   tutorial catalog itself is untouched**: every lesson is still reachable from
   Learn, and lessons keep their ids.
4. **Ruler ticks and labels follow the zoom** (`ruler-steps.ts`): the labelled
   step is the smallest 1-2-5-per-decade number whose labels stay ≥62 px apart,
   and minor ticks subdivide it by 10/5/4/2 while they stay ≥5 px apart, with a
   taller half-step tick so a division can be halved by eye. Labels are
   formatted without trailing zeros, so sub-millimetre zooms read "0.5", not
   "0.50".
5. **The pointer is marked on both ruler strips** (`RulerCursorOverlay`), and
   **hovering artwork reports its size** (`HoverSizeReadout`: name, W × H mm,
   and X/Y of its top-left). Both are DOM overlays, not canvas paint, and both
   are `pointer-events: none`. The hover readout hit-tests on a 140 ms dwell,
   never per mouse-move, and only in the select tool with no drag in progress.

### Consequences

- Undo is reachable without opening a menu or knowing the shortcut, which is
  what a pointer-first operator at the machine actually has.
- Switching to Run order no longer gains ~100 px of rail. That width was real:
  Run order cards are denser than the Settings form. They stay legible at the
  narrower width, and an operator who wants the old width can drag the rail
  there once and keep it, which they could not do before.
- Help is now a destination (Learn) plus a handful of tool panels, rather than
  an icon on every control. The cost is real: a lesson that used to be one
  click from the control it explains is now two, via Learn.
- The rulers stay readable across the whole zoom range instead of at one zoom.
- Two new per-mouse-move React renders (ruler mark, hover dwell). Neither
  touches the canvas draw path: the scene redraw does not depend on `cursorMm`,
  and painting either into the rulers would have meant redrawing every object
  in the project on every mouse-move.
- None of this adds or removes a machine gate: a completed Frame for the
  reviewed job remains the sole ordinary Start policy gate (ADR-228/230/232/237).

### Verification

- `MenuBarHistoryControls.test.tsx`: each button runs its command once per
  click and carries the shortcut in its tooltip; a disabled button states why
  and cannot dispatch; the group renders after the menubar and outside it.
- `ruler-steps.test.ts`: the labelled step at nine scales from 0.05 to 700
  px/mm, the ≥62 px label and ≥5 px minor-tick contracts, integer nesting of
  minor ticks inside the labelled step, degenerate scales (0, negative, NaN,
  Infinity), and label formatting.
- `draw-rulers.test.ts` (unchanged) still proves a ruler-labelled coordinate
  lands where the pointer hit-tests it, after zoom and pan, on a CSS-scaled
  canvas.
- `HoverSizeReadout.test.tsx`: reports the hovered object's size and position
  after the dwell; silent over empty bed, after the pointer leaves, while
  disabled, and before the dwell elapses.
- Live in the dev server: the rail measured 300 px in both Settings and Run
  order at 1600×900 Spacious, a hand-set 380 px survived a view switch, and a
  Run order card reported `clientWidth === scrollWidth` at the narrower rail;
  Undo removed a drawn rectangle and Redo restored it; the rulers labelled
  every 20 mm at 381 % and every 100 mm at 51 %; hovering a rectangle showed
  "Rectangle · 140.6 × 105.5 mm · X 70.6, Y 65.7".
- The tutorial sweep broke 14 test files that pinned the removed buttons. Each
  was re-pointed at the contract that still exists (focus trap wraps to the
  first control; a lesson opened from inside a dialog still does not submit or
  reset it) or deleted where its subject is gone.
- **NOT verified:** on hardware, and not perceptually at every breakpoint.
