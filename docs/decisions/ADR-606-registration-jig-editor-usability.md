## ADR-606 - Registration jig editor usability

**Status:** Accepted. Amends ADR-057 (dedicated jig editor amendment of 2026-10-17).

## Context

An audit of the dedicated jig editor in the running app found several ways to lose or misplace work:

- Escape, the usual way to clear a selection, closed the editor and discarded every draft edit without asking. Initial focus also landed on **Close without saving**, so an Enter on arrival did the same.
- Growing the default outline into a grid extended it right and down from the first outline. A 2 x 4 grid of 80 x 40 mm outlines on a 400 mm bed ran past the bed edge, and the canvas stayed zoomed on the first outline, so the overflow was off screen.
- **Save to canvas** with no edits still added an undo step and marked the project unsaved.
- Reopening a jig after the outline burn (Artwork only) left the outlines draggable, so one stray drag misplaced the artwork against the burned outlines.
- Importing several files stacked them all on one outline. Files could not be dropped on the jig canvas. **Import artwork** was hidden in a collapsed section, and **Centre + copy** sat below the tracer, often out of view.

## Decision

- **Leaving the editor asks first.** Escape in a field only leaves the field. Otherwise Escape first clears the selection, as on the main canvas. Escape with nothing selected, or **Close without saving**, closes at once when the draft is unchanged; otherwise it asks **Save jig changes?** with **Save to canvas**, **Discard changes** and **Keep editing**. Un-applied layout fields count as unsaved. The editor opens with focus on itself, not on a button, and its footer shows **Unsaved changes**.
- **Saving nothing changes nothing.** Saving an existing jig with no edits closes the editor without an undo step or a dirty project. A new jig still saves its first outline.
- **Grids stay on the bed.** Replacing the grid keeps the first outline's corner for a jig that was already saved, because its outlines may be burned, and keeps a never-saved jig centred where it was. Either way, a grid that would cross the bed edge moves back just far enough to fit; one larger than the bed starts at the bed origin. The jig canvas refits whenever the layout is rebuilt.
- **Burned outlines start locked.** When the jig is in **Artwork only**, the editor opens with its outlines locked and explains why. **Unlock outlines** is an explicit, undoable draft edit. Saving still locks outlines on the main canvas, as before.
- **Import fills the jig.** **Import artwork…** is a visible button, and SVG or image files can be dropped on the jig canvas. Files fit into the outline they were dropped on, else the selected outline, else the outline holding the selected artwork, else the first. Each further file in the same batch goes into the next outline in grid order, wrapping round. The Artwork tab lists the ways to add artwork first (import, text, a collapsible tracer), then **Centre + copy**, then the shared size and Line / Fill settings. *Amended by ADR-652: the Line / Fill settings are gone and the canvas shows only the jig.* *Amended by ADR-633: the tracer starts open and can trace an image already on the jig.*

## Consequences

These are editor and scene-layout changes only. Output modes, the outline-then-artwork sequence, Job Review, Frame (ADR-565) and Start are unchanged. The grid's on-bed adjustment applies to every jig-set replacement and moves a grid only when it would otherwise cross the bed edge.

## Verification

Component tests cover the close prompt (Keep editing, Discard changes, Save from the prompt), Escape clearing the selection before asking, initial focus, closing without an undo step when nothing changed, and locked outlines in Artwork only with Unlock and Undo. Canvas tests cover refitting once per layout rebuild without chasing ordinary edits, and dropped files reaching the editor with the outline under the drop. State tests cover the on-bed shift, centring an unsaved grid, batch placement across outlines, and anchoring on the outline that holds the selected artwork.

### Amendment 1 - Keep the draft when the main project changes behind the editor (2026-10-18)

#### Context

**Save to canvas** refused the draft whenever the main project had changed since the editor opened, apart from the switch to **Artwork only** that a finished outline run makes. The editor is a full-screen modal, so such changes come from automation, such as variable text advancing after a job. The operator then had to discard every jig edit and reopen the editor, even when the change had nothing to do with the jig.

#### Decision

- **Saving rebases the draft.** It merges three ways: the project the editor opened, the current main project and the draft. Main-project changes to artwork, operations and project fields the draft did not touch are carried over; the draft's own edits win for what it changed. Artwork the main project added is kept, after the draft's artwork, and run and presentation order lists merge the same way. Operations merge setting by setting.
- **A finished outline run still selects Artwork only.** When the main project's output mode changed while the editor was open, the saved draft adopts that mode, as before. Output flags alone never cause a refusal.
- **Only overlapping changes are refused.** The editor keeps the existing refusals for another opened document and for a captured-board outline. It also refuses when the jig outlines changed in the main project (they may be burned, and the draft holds the whole layout), when artwork, a group or an order list the draft changed was changed or removed there, when the same operation setting was changed differently on both sides, when artwork in the merge uses an operation one side removed, and when a project field the editor does not own was changed differently on both sides. Each refusal shows its own message. The operator still recovers with **Close without saving**, **Discard changes**, and reopening the editor.

#### Consequences

A save after a rebase is still one undoable edit; Undo restores the main project as it was just before the save, including the changes that arrived while the editor was open. Selected items the main project removed are dropped from the saved selection. Stacking follows the draft: a main-project change that only restacks existing artwork is not carried over. Outlines, output modes, Job Review, Frame (ADR-565) and Start are unchanged.

#### Verification

Session tests cover an unrelated object added in the main project, a variable-text advance after a job, an outline moved in the main project (refused), the same artwork edited on both sides (refused) beside different artwork edited on each side (merged), operation settings merged by field and refused on the same field, the existing switch to Artwork only, and the new-document and captured-board refusals. Editor component tests save a draft over a variable setting changed behind the editor and show the new-document message.

### Amendment 2 - Direct manipulation on the jig canvas (2026-10-18)

The jig canvas could only select by click and Shift-click and move by dragging. Resizing and rotating needed the numeric fields, there was no box selection or Select all, and a file drag gave no sign of which outline would receive the files.

- **Handles on the selection bounds.** The editable part of the selection shows eight resize handles and a rotate handle on its combined bounds, drawn and hit-tested by the main canvas's multi-selection helpers, without its centre move handle. A corner resizes proportionally about the opposite corner; Shift resizes freely; an edge handle stretches one side. The grabbed handle follows the pointer's travel, so a click on a handle changes nothing. The resize uses the same core group resize as the numeric fields, so a free stretch of artwork turned at an angle is refused, and the canvas footer says why. The rotate handle turns the selection about the centre of its bounds; Shift snaps to 15 degree steps.
- **One edit per drag.** Like moving, a resize or rotation previews on the canvas and commits one draft edit on release. A cancelled drag, or one that changes nothing, adds no undo step.
- **Box selection and Select all.** Dragging on empty canvas draws a marquee with the main canvas's direction rule: left to right selects what it encloses, right to left what it touches. It selects whole editable groups, and Shift adds to the selection. A press that travels less than 3 pixels is a click. Ctrl+A (Cmd+A) selects all the selectable artwork, except while a text field has focus; it leaves outlines out, since Jig layout has its own **Select all outlines**. Locked or hidden objects, including locked burned outlines, are never selected.
- **Drop target.** While files are dragged over the canvas, the outline under the pointer, which a drop would import into, is highlighted across the bounds that decide the drop.

These are editor interaction changes only; the draft model, saving and output are unchanged. Canvas tests cover one commit per resize and rotate drag, Shift resizing, a click on the rotate handle, marquee selection with Shift and the click threshold, and the drop highlight. Selection tests cover the marquee rules, Select all, handle hit-testing, proportional, free and refused resizing, and single and multiple rotation; editor tests cover Ctrl+A leaving an editable outline out and doing nothing in a field.
