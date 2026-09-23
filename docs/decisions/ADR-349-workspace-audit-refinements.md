## ADR-349 - Keep workspace essentials visible and image processing truthful (2026-09-23)

**Status:** Accepted. | **Date:** 2026-09-23

The September workspace audit found keyboard input escaping open menus, unreadable
pressed toolbar states, hidden operation essentials, overlapping start labels,
preview controls covering artwork, ambiguous save state and inconsistent naming.
It also reproduced incorrect rounded-rectangle area and Pass-through processing
that changed the source pixel pattern in preview and emitted output.

### Decision

1. An open application menu owns ordinary keyboard input and focuses its first
   enabled item when opened by pointer. Dismissal preserves the canvas selection.
   Existing emergency Abort routing remains available. The internal artwork
   clipboard and text-field editing outside menus retain their existing owners.
2. The Artwork inspector leads with the selected operation's essential laser or
   CNC fields. Secondary explanations and tool options use mounted disclosures,
   preserving numeric drafts, shared/mixed operation scope and cutter bindings.
   The destination is consistently named Machine Setup; the output-order dialog
   and command are both Cut Planner. Auto-focus profiles are not labelled manual.
3. Frame start and Job start remain visible by default. A blue hollow diamond and
   purple triangle distinguish them, with opaque title-case labels and leader
   lines. Collision placement prefers blank space outside visible artwork and
   selection handles as well as avoiding the other label and both start glyphs.
   It moves labels, never the represented coordinates. Retained previous plans
   explicitly say Updating while preparation is pending.
4. Preview controls occupy a bounded, scrollable dock below the drawing stage.
   Canvas bitmaps, camera overlays and board-verification coordinates measure the
   same remaining stage. Details are expandable; playback, view state and
   selection survive the layout transition.
5. File status is explicit text derived from the existing save tracking:
   Not saved to file, Unsaved changes, or File up to date. It does not claim an
   autosave or recovery write succeeded. The empty drawing area stays clear,
   without an introductory card. Drawing tools, Import and the design library
   remain available through their existing controls.
   Copper remains the action accent; keyboard focus uses a separate blue token.
6. Pass-through keeps source density and luminance, skipping stored brightness,
   contrast, gamma, negative and dither settings in the compiler, processed
   bitmap/export and Adjust Image preview. Stored settings resume when it is
   turned off. Placement, orientation, masks, dot-width correction and the selected
   power range still apply. Materialized and streamed compilation share the same
   processing rule.
7. Rounded-rectangle area is `width × height − (4 − π) × radius²`, using the same
   clamped effective radius as its geometry. Node mode explains primitive
   conversion and invokes the existing undoable Convert to Path action only
   when the user chooses it.

### Boundaries

This decision changes software presentation and the stated Pass-through output
contract. It does not alter controller settings, Frame completion, Start policy
or hardware state. PROJECT non-negotiable 21 and ADRs 228, 230, 232 and 237 still
govern the exact reviewed job. The cancelled live test sequence is not hardware
qualification, a release check or evidence of deployment.
