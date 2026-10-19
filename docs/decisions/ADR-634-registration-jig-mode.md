## ADR-634 - Registration jig mode: lay out, place and burn on one page (2026-10-19)

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

1. **Jig mode replaces the main canvas, not the app.** Registration Jig and **Edit jig** put the
   jig page where the tool strip and the main canvas are. The menu bar, the status bar and the
   machine panel stay. Dialogs, alarms and the live motion bar stack above the page as they do
   over the main canvas. The page is not a modal, so machine shortcuts work. The main canvas's
   tool, edit and view shortcuts stand down while the page handles its own canvas keys. Undo and
   Redo stay the project's own. The side panels show only the machine panel: the jig page has its
   own artwork and laser settings, and the Artwork panel would offer a second way to change them.
2. **Edits go straight into the open project.** There is no draft, so **Save to canvas**,
   **Close without saving**, the **Save jig changes?** prompt, the unsaved-changes footer and the
   ADR-606 Amendment 1 rebase are removed. Each jig edit is one ordinary undoable project edit.
   A selection change adds no undo step, and an edit that changes nothing is not recorded.
   **Done** returns to the main canvas. Escape only clears the selection; it never leaves jig
   mode. Opening another project leaves jig mode.
3. **Outlines stay locked in the project.** Every jig edit locks the outlines again before it
   reaches the project, so a stray drag on the main canvas still cannot move them. The jig page
   shows them unlocked while they may still be moved: until they are burned, or after
   **Unlock outlines**, which now lasts until Done.
4. **Three steps, in the order of the job.** The page's steps are **1 Burn outlines**
   (shape, size, grid and the outline laser settings), **2 Place pieces & artwork** and
   **3 Burn artwork** (the artwork Line / Fill settings). A new jig opens on step 1, and one whose
   outlines are burned opens on step 2. Opening jig mode on a project without a jig creates its
   first outline, in Outline only, as one undoable edit.
5. **Frame and Start live in the burn steps, and only in the step whose run is next.** Steps 1
   and 3 hold the workspace's own Frame and Start. While jig mode is open, the machine panel does
   not show its copy, so there is still exactly one Frame and one Start. The next run is
   read from the outline operation's output: it outputs (Outline only), it does not (Artwork only),
   or it outputs together with artwork, the one-pass mix the two-run jig avoids. When a step's
   run is not next, the step says which run is and offers one explicit switch: **Burn outlines
   again** in step 1, **Outlines are already burned** in step 3, or **Burn only the outlines** /
   **Burn only the artwork** for the mix. A clean, complete outline run already selects Artwork
   only (ADR-057), and jig mode then moves to step 2.
6. **Editing pauses while the machine runs.** While a job, Frame or other machine motion is
   active, the jig canvas only pans and zooms, the step fields are disabled and project edits
   from the page are refused. The run was prepared from the project as it was, and the
   outline-run completion only switches an unchanged project.
7. **The main canvas bar only says what burns next.** It keeps **Edit jig** and drops **Outline
   only** and **Artwork only**; the run is chosen in jig mode. Job Review keeps its alternate-output
   offer.

### Consequences

The jig page always shows what Frame and Start burn. Leaving jig mode, or a lost connection, can
no longer strand a burned outline outside the project. The draft's isolation is gone: a half-done
jig edit is in the project, and Undo is the way back. Grid growth stays centred for a jig created
in this visit of jig mode, and keeps the first outline's corner otherwise (ADR-606).

The browser Free build keeps both hosts inert (`RegistrationJigPanel`, `RegistrationJigWorkspace`).
The jig still needs Pro to open; Frame and Start are never licence-gated.

### Verification

Session tests cover creating a jig as one undoable edit in Outline only, editing the open project
with the outlines kept locked, burned outlines shown locked until unlocked, centred and corner
grid growth, keeping the run and artwork intent on a rebuild, no undo step for a selection or a
no-op, the project Undo, refusing project edits while the machine moves, removing the jig and a
captured board. Component tests cover the steps, Done with no Save or Close without saving,
Frame and Start only in the step whose run is next, moving to step 2 when the outline run selects
Artwork only, editing straight into the project, Escape and Ctrl+A, the paused page while the
machine moves, and leaving jig mode for another project. The side panels test shows only the
machine panel without its job actions in jig mode; the shortcut test shows the canvas keys
standing down while Undo still works. The completion simulator test checks the run phase after a
clean and a rejected outline run. No hardware was run.
