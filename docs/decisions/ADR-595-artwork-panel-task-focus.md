## ADR-595 - Give artwork panels distinct tasks

Date: 2026-10-13. Status: accepted for local implementation.

### Context

The design hierarchy appeared below operation settings, with permanent drag instructions,
a root drop target and rows wider than the rail. Materials mixed applying a preset with
library administration and recipe authoring. Run order repeated cutting settings on every card.

The maintainer requested research, removal of clutter and a visual upgrade for these panels.
LightBurn documents separate cut editing and reusable material-library tasks. Inkscape places
object organisation in its Layers and Objects dialog. Nielsen Norman Group recommends
progressive disclosure for advanced or infrequent tasks.

### Decision

- Settings retains the selected artwork/operation editor and secondary All operations list.
- The rail header's Objects button opens an accessible organiser dialog. Group navigation,
  naming, selection and keyboard Move remain available. Root drop targets appear during dragging.
- Run order prioritises numbered runs. Search/jump and repeated cutting settings are optional;
  actual output steps and excluded-output status remain visible. Virtualisation uses the same
  compact/detailed row heights as the CSS.
- Materials prioritises finding a preset, choosing a named target operation, reviewing and
  applying it. Library management, experiments, automatic job presets, multi-step recipes,
  authoring and link/delete controls are secondary disclosures. CNC keeps its process library.
- Use existing theme tokens, compact typography and wrapping controls. Preserve existing
  editing, undo, output, Frame, licence and machine contracts.

### Sources

- https://docs.lightburnsoftware.com/2.0/Reference/CutsLayersWindow/
- https://docs.lightburnsoftware.com/2.0/Reference/MaterialLibrary/
- https://wiki.inkscape.org/wiki/Release_notes/1.2
- https://www.nngroup.com/articles/progressive-disclosure/

### Verification

Component regression coverage checks organiser separation, focus restoration and unchanged
project state. Browser coverage checks real laser/CNC edits and narrow-rail layout. These are
software checks; no hardware operation or publication is part of this change.
