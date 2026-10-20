## ADR-641 - Registration jig mode: lay out, place and burn on one page (2026-10-19)

**Status:** Accepted. | **Date:** 2026-10-19

This amends ADR-057 (the 2026-10-17 dedicated jig editor amendment) and ADR-606, including its
Amendment 1. Frame stays the only ordinary Start gate (ADR-565); no Start check is added
(ADR-228). Compilation, transport, Job Review and machine authorization do not change.

### Context

The jig editor was a full-screen layer over the whole app that edited a draft copy of the project.
To burn, the operator saved the draft to the canvas, left the editor, used Frame and Start on the
main canvas, then reopened the editor for the artwork. The maintainer asked for the whole job, from
the first outline to the last artwork burn, to happen on the jig page, in steps that cannot be
mixed up.

Putting Frame and Start inside that editor would have burned a project other than the one Frame,
recovery and the outline-run completion know. Frame evidence (ADR-565) belongs to the open
project's exact footprint and placement. `armRegistrationJigCompletion` selects Artwork only only
for a job that matches the open project. Resume after a lost connection continues from the
project, as ADR-341 Amendment 8 notes for a painted second pass. A burn from an unsaved draft
could therefore burn something other than what is on screen, and **Discard changes** after an
outline burn would leave burned outlines the project does not hold. The editor also sat at
z-index 1010, above the app's dialogs (`--lf-z-dialog`, 1000), so Job Review and alarm recovery
would open behind it. It covered the machine panel and suspended the app's shortcuts as a modal.

### Decision

1. **Jig mode is a full page beside the machine panel.** Registration Jig and **Edit jig** open
   the jig page over the whole window except the machine panel, which stays docked beside it with
   all its controls. The app menu bar, the toolbar, the object/placement bar, the tool strip, the
   Artwork panel, the canvas context bar and the status bar are not shown, and the main canvas is
   not mounted, so the page reads as a page of its own, not a different canvas. The page's header
   stands in for the bars: a primary **Done** with a back arrow, the title **Registration jig** and
   its tutorial, the step indicator (the three steps of item 4, the current one marked), the
   project's Undo and Redo, and the workspace's own machine connection (Connect, the machine
   picker and the safety notice), moved from the top bar rather than copied, so there is still
   one of each. **Done** restores the workspace exactly as it was when the page opened: the bars,
   the panels, the main canvas's zoom and pan, and the selection (less anything deleted on the
   page; a project opened meanwhile keeps its own). Dialogs (Job Review among them), alarms and
   the live motion bar stack above the page as they do over the main canvas, and the machine
   panel keeps Stop, the alarm banner and jogging in view. The page is not a modal, so machine
   shortcuts work. The main canvas's tool, edit and view shortcuts and the command search
   (Ctrl+K) stand down while the page handles its own canvas keys; file shortcuts such as Save
   still work. Undo and Redo stay the project's own. The jig page has its own artwork and laser
   settings, and the Artwork panel would offer a second way to change them.
   **The menu bar is hidden, not reduced.** Every menu acts on the main canvas or opens a tool of
   its own, and a reduced menu would be a second, smaller copy of the header. What the page needs
   from it is in the header (Done, Undo, Redo, the tutorial) or on the keyboard (Save, Open). On
   macOS the system menu bar keeps its standard App, File, Edit and Window roles.
2. **Edits go straight into the open project.** There is no draft, so **Save to canvas**,
   **Close without saving**, the **Save jig changes?** prompt, the unsaved-changes footer and the
   ADR-606 Amendment 1 rebase are removed. Each jig edit is one ordinary undoable project edit.
   A selection change adds no undo step, and an edit that changes nothing is not recorded.
   **Done** returns to the workspace as item 1 describes (leaving any other way, such as the
   Registration Jig command, does the same); either way the outlines leave the selection,
   which the main canvas cannot edit. Escape only clears the
   selection; it never leaves jig mode. Opening another project leaves jig mode.
3. **Outlines stay locked in the project.** Every jig edit locks the outlines again before it
   reaches the project, so a stray drag on the main canvas still cannot move them. The jig page
   shows them unlocked while they may still be moved: until they are burned, or after
   **Unlock outlines**, which now lasts until Done. While the page shows them locked, their
   layout is locked too: shape, size, grid, **Apply layout** and **Remove** are disabled, and the
   project refuses a rebuild or removal, so a new grid never moves a burned outline.
4. **Three steps, in the order of the job.** The page's steps are **1 Burn outlines**
   (shape, size, grid and the outline laser settings), **2 Place pieces & artwork** and
   **3 Burn artwork** (the artwork Line / Fill settings). A new jig opens on step 1, and one whose
   outlines are burned opens on step 2. Opening jig mode on a project without a jig creates its
   first outline, in Outline only, as one undoable edit. A layout applied to a project without
   outlines, after **Remove** or when jig mode opened while the machine moved, also creates the
   jig in Outline only.
5. **Frame and Start live in the burn steps, and only in the step whose run is next.** Steps 1
   and 3 hold the workspace's own Frame and Start. While jig mode is open, the machine panel does
   not show its copy, so there is still exactly one Frame and one Start. When the page has no burn
   panel to hold them (a captured board, no outline, or outlines and artwork set to burn
   together), the machine panel keeps its copy instead. The next run is
   read from the outline operation's output: it outputs (Outline only), it does not (Artwork only),
   or it outputs together with artwork, the one-pass mix the two-run jig avoids. When a step's
   run is not next, the step says which run is and offers one explicit switch: **Burn outlines
   again** in step 1, **Outlines are already burned** in step 3, or **Burn only the outlines** /
   **Burn only the artwork** for the mix. A clean, complete outline run already selects Artwork
   only (ADR-057), and jig mode then moves to step 2.
6. **Editing pauses while the machine runs.** While a job, Frame or other machine motion is
   active, the jig canvas only pans and zooms, the step fields are disabled and project edits
   from the page are refused. The run was prepared from the project as it was, and the
   outline-run completion only switches an unchanged project. An import, trace or text that is
   ready only once the machine moves is not added: the import toast, the tracer or the text form
   says why instead of reporting success.
7. **The main canvas bar only says what burns next.** It keeps **Edit jig** and drops **Outline
   only** and **Artwork only**; the run is chosen in jig mode. Job Review keeps its alternate-output
   offer.

### Consequences

The jig page always shows what Frame and Start burn. Leaving jig mode, or a lost connection, can
no longer strand a burned outline outside the project. The draft's isolation is gone: a half-done
jig edit is in the project, and Undo is the way back. Grid growth stays centred for a jig created
in this visit of jig mode until it is burned (a job ran, or Artwork only was selected), and keeps
the first outline's corner otherwise (ADR-606).

The browser Free build keeps both hosts inert (`RegistrationJigPanel`, `RegistrationJigWorkspace`).
The jig still needs Pro to open; Frame and Start are never licence-gated.

### Verification

Session tests cover creating a jig as one undoable edit in Outline only, editing the open project
with the outlines kept locked, burned outlines shown locked until unlocked, centred and corner
grid growth, keeping the run and artwork intent on a rebuild, no undo step for a selection or a
no-op, the project Undo, refusing project edits while the machine moves, removing the jig and a
captured board, refusing to rebuild or remove burned outlines, corner growth for a burned jig
this visit created, and Outline only for a jig a layout creates. Component tests cover the steps,
Done with no Save or Close without saving, Frame and Start only in the step whose run is next,
moving to step 2 when the outline run selects Artwork only, editing straight into the project,
Escape and Ctrl+A, the paused page while the machine moves, refusing late artwork, the layout
locked with burned outlines and kept in place after Burn outlines again, and leaving jig mode
for another project or by the Tools menu with the outlines dropped from the selection. The side
panels test keeps the machine panel's job actions when the jig page has no burn panel, and
otherwise shows only the
machine panel without its job actions in jig mode; the shortcut test shows the canvas keys
standing down while Undo still works. The full-page test mounts the app and checks, for the jig
page and Place Board, that the menu bar, toolbar, tool strip, Artwork panel and status bar are
gone while the machine panel stays, that the header holds the title, three steps with one
current, a primary Done, Undo and the only machine connection, that the live motion bar still
shows, that Ctrl+K and the view keys stand down, and that Done brings back the bars, the zoom,
the pan and the selection. A jig page test switches the outline shape between rectangle and
circle and checks the project's outlines change each time. The completion simulator test checks the run phase after a
clean and a rejected outline run. No hardware was run.

### Amendment 1 - Fewer controls, and Clear canvas (2026-10-19)

#### Context

Even in jig mode, each step still showed about 30 controls. Several did the same job twice: two
size editors with two proportion locks (**AR locked** and **Keep proportions**), three Apply
steps (**Apply layout**, **Apply size to all N**, **Add text**), a **Centre + copy** after every
import, and a **Select all outlines** button beside Ctrl+A and box selection. The maintainer also
asked for a way to clear the jig canvas.

#### Decision

1. **One design goes on every piece by itself.** A single imported file, a trace and new text are
   centred in the first outline and copied into every other one, in the same undoable edit. The
   copies keep the artwork's size; a design larger than an outline still shrinks to fit. Several
   files imported together still fill one outline each (ADR-606), a file dropped on one outline
   goes on that piece only, and editing one copy of text changes only that copy, so each piece
   can carry its own name or design. The sidebar's **Centre + copy**
   becomes **Centre on every piece** (**Centre in outline** for one outline), shown with the
   selection, to re-centre artwork that was moved.
2. **Layout applies without Apply layout.** Shape, size, grid and gap apply on Enter, when the
   shape is picked, or when focus leaves the fields, so values typed together rebuild the grid
   once. Escape returns the fields to the outlines as they are. An invalid value says why and goes
   back. The "layout not applied" marker and the burn panel's wait for it are removed. Shrinking
   the grid keeps the artwork of removed pieces as ordinary artwork (the old default) and offers
   **Remove them** instead of asking beforehand. A jig with no outlines shows **Create outlines**.
3. **One size control, applied on Enter or leave.** **Size on every piece** has no Apply button.
   The ADR-057 (2026-08-25) aspect lock stays an explicit toggle, now the same lock icon,
   **Keep proportions**, that the selection fields use.
4. **The selection's position and size sit on a bar above the jig canvas.** It shows only while
   something is selected and carries X, Y, W, H, the proportions lock, rotation and **Centre on
   every piece**.
5. **Settings fold away.** Step 2 adds artwork from one row: **Import…**, **Text** and **Trace
   image**. The text form opens on **Text** or when a text is selected, and the tracer stays loaded
   while hidden. The outline and artwork laser settings keep power, speed and passes in view.
   Air assist and **Advanced outline settings**, and the Fill-only spacing, angle, style and
   cross-hatch, sit under **More outline settings** and **More settings**.
6. **Ctrl+A follows the step.** In step 1 it selects the movable outlines; elsewhere it selects
   the artwork. **Select all outlines** is removed.
7. **Clear canvas.** The jig canvas footer, beside **Fit jig** and **Fit bed**, offers **Clear
   canvas**. It removes the artwork in the jig's pieces: every copy that belongs to an outline, and
   any other unlocked, visible artwork whose centre sits inside one. The outlines and every design
   outside them stay. It is one undoable edit, disabled when there is nothing to clear or while
   the machine runs, and a notice says how many objects went.

#### Consequences

With nothing selected, step 2 shows about ten controls instead of about thirty, and the Apply,
Centre + copy and Save to canvas clicks are gone from the job. Nothing about output, Frame, Start,
compilation or machine authorization changes.

#### Verification

Unit tests cover a single import and new text copied to every outline (text at its own size),
several files filling one outline each, editing one text copy, and Clear canvas keeping the
outlines and an outside design. Layout tests cover applying on leave and Enter, Escape, invalid
grids, leftover artwork and Create outlines. Size tests cover applying on leave and Enter, the
lock, and no undo step for an unchanged size. Jig page tests cover Ctrl+A per step, Clear canvas
with Undo, and the selection bar appearing only with a selection.
