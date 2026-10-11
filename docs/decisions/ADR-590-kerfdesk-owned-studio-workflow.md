## ADR-590 - Improve KerfDesk's own studio and adapt selected upstream algorithms

Date: 2026-10-11
Status: Implemented locally; rendered and packaged qualification recorded separately
Amends: ADR-588 and ADR-589 replacement direction

The maintainer rejected the hosted full-editor experience and prioritised the
layout and ease of use of KerfDesk's own studio. Development returns to the
existing sketch and image session models. The full native editors are no longer
offered from the Design Studio toolbar. Their project schema and recovery code
remain available for previously created documents, with a collapsed Legacy
editor documents section shown only when the project contains those sources.
This change does not delete or reinterpret that data.

Design Studio uses labelled drawing tools, one docked precision inspector for
both 2D and 3D, a selectable shape list, and an expandable carve-settings section.
Selection layout actions align and distribute geometry with one local Undo step.
Select All and Duplicate have keyboard and visible controls. None of these edits
write into machining artwork until the existing Apply action is used.

Reuse upstream source only when it improves an existing product workflow.
PhotoCraft's MIT-licensed colour-to-alpha math is adapted to TypeScript as
Remove white background in the existing Image Studio Adjust menu, retaining
preview, selection coverage, layer editing and Undo. The pinned source commit,
modifications and full copyright/permission text travel in generated third-party
notices. No Rust runtime, native editor or new dependency is required.

The existing sketch/session persistence, project ownership, Apply, machine,
Frame and Start contracts remain authoritative. This is a local implementation;
no publication, installer update or hardware qualification is implied.

## Unified workspace continuation

Design Studio now contains Vectors and Photos workspaces in the same modal shell.
The existing raster editor renders inside Photos with labelled tools, visible
layers/history, and quick crop, resize, paper cleanup, contrast, levels and
black-and-white actions. The shell owns focus and keyboard routing; the standalone
Image Studio host yields while this shell is open. Apply & Trace closes the shell
before opening the existing tracer. No outside editor process is launched.

Photos are actual scene objects. Import reuses document-owned import and resolves
the fitted object back from the scene before editing. Existing photo cards remain
inert while an import is pending. Late completion cannot open an editor after
leaving the workspace or replacing the project. TIFF page imports remain available
from the main workspace because their separate page dialog is outside this shell.

Switching workspaces stashes photo edits and retains the vector drawing. Each
workspace keeps its existing Apply boundary and local Undo. Apply captures both the output artwork and editable source in the normal project
file. Photo sources retain exact RGBA layer pixels, order, names, visibility,
opacity, blending and the active paint layer. The PNG/luma composite remains the
normal machining source. Old flattened images remain compatible. Saved documents
are validated before allocation (128 layers and 128 MiB of decoded pixels maximum).
Unapplied session edits and editor Undo history remain separate from project Undo.

Vector quarter-turn and mirror actions preserve editable primitives and operate
around the collective bounds. Exact arc bounds prevent repeated rotations from
drifting. Each changed selection is one Undo step.

Testing exposed that image/canvas resize and crop cleared Undo. These now record
UI-owned document snapshots keyed by core history entries, with buffer, selection
and inverse sizes counted against the existing history budget. Ordinary paint
edits retain tile snapshots. Undo/Redo restores pixels, dimensions, physical scale and exact layer structure.
Add/delete/duplicate/text/merge/reorder and layer metadata changes now have complete
snapshots, preserving interleaved paint and dimension history. Revert restores the
saved layered source when reopening a project. No Undo snapshot is persisted in
the project file.

The mixed workflow also exposed a pre-existing Apply bug: a design layer could
overwrite an allocated operation colour with a colour already used by an image
operation, making the project fail validation on Save. Apply now prefers the
design colour only when free, otherwise retaining the reused operation's colour
or choosing a free slot. Explicit operation bindings retain the intended artwork
assignment and existing image settings. Save validation is unchanged.


The shared 2D composition view renders project photos and existing vector artwork
through the production renderers, respecting placement and visibility. The live
sketch replaces its own applied output on this canvas. Selecting a photo or
opening it by double-click enters the embedded photo editor; Back to canvas
retains the drawing and view. The 3D carve view remains available separately.

Vector Apply also records a versioned, project-owned Design Studio document:
exact sketch entities and guides, layer settings, active layer, view preference
and applied output links. Opening a different project restores its own source;
an unrelated local recovery draft cannot replace it. Existing artwork modified
outside Studio takes precedence over stale sketch geometry. The saved output
remains visible on the shared canvas, while only unchanged owned entities are
restored as editable sketch primitives. Reapplying retains the replacement
contract instead of creating duplicate output.
