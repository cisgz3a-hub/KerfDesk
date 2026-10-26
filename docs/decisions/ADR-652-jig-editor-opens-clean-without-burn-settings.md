## ADR-652 - The jig editor opens on a clean canvas, without burn settings (2026-10-21)

**Status:** Accepted. | **Date:** 2026-10-21

This amends the dedicated jig editor amendment of ADR-057 (2026-10-17) and ADR-606. It keeps
the dedicated editor and its layout; jig mode and a full-page jig stay rejected (#1297). Output
modes, the outline-then-artwork sequence, Job Review, Frame (ADR-565), Start, the safety notice,
Stop and alarms do not change. No guard is added or removed (ADR-228).

### Context

The maintainer asked for a simpler Registration Jig editor:

- "I want a clean canvas when I open it. things shouldnt copy on from the normal canvas." The
  editor's draft was a copy of the whole main project, so every piece of main-canvas artwork
  appeared on the jig canvas, could be selected, moved, deleted and centred into the jig, and the
  main canvas's selection was handed to the editor on opening.
- "I dont want power settings in the registration jig. keep it basic. easy to use." The editor
  showed **Jig outline laser settings** (power, speed, passes, air assist and advanced outline
  settings) on **Jig layout**, and **Line / Fill settings** (burn mode, power, speed, passes, line
  interval, scan angle, fill style and cross-hatch) on **Artwork**.

### Decision

- **The jig canvas shows only the jig.** On opening, the editor works out which main-canvas
  objects belong to the jig: its outlines, the artwork the jig's copies and parts are linked to,
  and artwork whose centre lies inside an outline's own rectangle or ellipse (after its rotation)
  and that is no larger than the outline, measured in the outline's own frame (artwork imported into an outline carries no jig link
  until it is copied; a bigger design that merely covers the jig is not the jig's). The jig is
  then closed over, until nothing changes: whole groups, including overlapping ones; the image
  masks, path-text guides, trace sources and relief-authoring links its artwork uses; and any other
  artwork that shares or links to one of those, so no edit in the editor can reach artwork it hides. Before a jig exists nothing
  belongs to it, so a new jig opens with just its first outline.
- **Everything else stays out of reach.** Other main-canvas artwork is never drawn, selected,
  moved, deleted, nudged, centred or copied in the editor; Ctrl+A and box selection skip it. It
  stays in the draft untouched, so **Save to canvas** still merges one whole project as one
  undoable edit (ADR-606 Amendment 1), and that artwork keeps its place and stacking.
- **No selection hand-off.** The editor opens with nothing from the main canvas selected (a new
  jig selects only its own first outline). The main canvas's selection is
  no longer carried in, so main-canvas artwork can no longer be centred and copied into the jig;
  artwork reaches the jig through **Import artwork…**, dropped files, text and the tracer, as
  before. Everything added or changed in the editor stays visible until it closes. The editor's
  own selection stays in the editor: **Save to canvas** gives the main canvas back the selection it
  had (less anything that no longer exists), because that selection also scopes **Selected artwork
  only** output.
- **No burn settings in the editor.** Both settings sections are removed. Jig burns use the
  operation settings the artwork already gets elsewhere in KerfDesk:
  - Outlines burn with the reserved **Registration jig** Line operation, created with the standard
    operation defaults (`LAYER_DEFAULTS`: 30 % power, 1500 mm/min, one pass, air assist off).
  - Imported, traced and typed artwork gets its operations exactly as on the main canvas: a new
    operation with the same standard defaults (`createArtworkOperation`), in the mode the kind of
    artwork asks for (`freshArtworkMode`: images Image, centreline and edge traces Line, other
    traces Fill, other vectors Line), plus any operation settings the artwork itself carries.
  - Settings saved with an existing jig are kept as they are. Job Review shows the exact
    settings of the prepared output before every Start, as before, and its **Edit** on an
    operation card (the outline's card included) changes power, speed, passes and air assist and
    saves them to the project. That is the route for a material that needs other settings; the
    main canvas offers no editor for the locked outlines' operation.

### Consequences

Both editor tabs say in one line that each burn uses its operation's current settings, starting
at the standard ones for new artwork, which Job Review shows and edits after Frame, before the job
starts. The Registration Jig tutorial runs Preview and Frame first, then uses Job Review's
**Edit** for the outline and artwork settings before **Start job**, and adds the design by reopening **Edit jig** and importing it inside the
editor. Advanced outline settings (Cut Settings) are no longer reachable for the outline. The
draft model, rebasing on save, output modes and compilation are unchanged. Main-canvas artwork
that is not part of the jig still follows the project's output mode, as before.

### Verification

Scope tests cover a new jig hiding all main-canvas artwork; an existing jig showing its outlines,
linked copies and artwork on an outline while hiding the rest, including a larger design that
covers the outline; whole groups; and folding a canvas edit back into the whole draft. Session
tests cover opening without the main canvas's selection and giving it back on save, refusing to select hidden artwork, and
reopening a saved jig with its own artwork while the rest stays untouched on save. Editor tests
cover a main-canvas selection not carrying in, Ctrl+A leaving hidden artwork out, saving that
leaves main-canvas artwork exactly as it was, and the absence of every burn setting on both tabs.
The registration-jig browser test opens the editor over selected main-canvas artwork, finds
nothing to select and no burn settings, and saves an outline without touching that artwork.
Scope tests also cover overlapping groups in either order, a mask shared with hidden artwork, a
retained relief authored from jig artwork, artwork larger than a rotated outline whose bounding
box would hold it, and a
circular and a rotated outline. A workspace audit test checks that the editor has no outline
settings and that Job Review's outline card edits the outline's air assist and saves it.
