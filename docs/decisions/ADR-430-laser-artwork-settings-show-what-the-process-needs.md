## ADR-430 - The laser Artwork settings show what the process needs, and Cut Settings holds the rest (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

Maintainer direction, 2026-09-26, with a screenshot of the Artwork panel's Settings tab in Laser
mode: "this whole section becomes weird and cluttered and non understandable. We should be at easy
to navigate understand and use. remove settings or stuff that shouldn't be there. make sure first".

This amends ADR-351 rule 2 for the laser inspector: secondary laser options leave the inspector
for Cut Settings instead of sitting in mounted disclosures. Rules 1, 2 and 8 below also apply in
CNC mode, since both heads share the header, name and footer; the CNC fields are unchanged. Settings
storage, the effective-operation and override rules (DECISIONS.md, schema v5 scoped overrides) and
compiled output do not change. No new guard is added (ADR-228).

### Context

Before this change, the Settings tab for one selected rectangle stacked, top to bottom: the
artwork name squeezed beside an Operation | Artwork switch; a process dropdown whose labels were
cut off ("Line · cut or score o…"); Power, Speed and Passes with "Passes times" wrapping; a
"Line options" card; an "About this process" disclosure; Air assist with a help paragraph; a
full-width Advanced cut settings button; the operation's name and colour; Show on canvas and
Include in output; "Affects 1 artwork."; and an Add operation button. Fill and Image added a
paragraph-length Scan both ways row and option cards holding up to eight more fields.

Every control was checked against Cut Settings (`CutSettingsDialog`) before anything left the
inspector, so the move loses no setting:

| Left the inspector | Where it is now |
|---|---|
| Line: Contour entry | Cut Settings → Line detail |
| Fill: Overscan | Cut Settings → Fill detail |
| Image: DPI, Dot width, Invert brightness, Use original pixels | Cut Settings → Image detail |
| About this process | Each process button's tooltip |
| Air assist and Scan both ways help paragraphs | Each switch's tooltip |
| Power scale hint (Artwork tab) | The field's tooltip |
| "Affects 1 artwork.", "Editing settings for N artworks." | Removed; the scope line says who an edit reaches |

Air assist, Scan both ways, Show on canvas and Include in output stay in the inspector. Air
assist has no Cut Settings field.

### Decision

1. The artwork's name takes the full width of the inspector header, with the Operation | Artwork
   switch as a full-width row under it.
2. The operation leads the editor: its drawing colour and editable name. One scope line follows
   only when an edit reaches more than this artwork ("Shared by N artworks. Edits apply to all of
   them.") or when the artwork has its own settings, with Make unique beside it when other
   artworks share the operation.
3. The process is three labelled buttons (Line, Fill, Image), a radio group named `Mode for …`.
   A mixed selection checks none of them and says so. Cut Settings keeps its dropdown.
4. Power, Speed and Passes share one row of three equal columns with one-line labels.
5. Only the settings that matter for the process follow: Fill shows Line spacing and Angle, and
   Image shows Dither, Line interval and, for Grayscale, Min power. Line shows none.
6. Scan both ways (Fill and Image) and Air assist are one-line switches.
7. A quiet **More cut settings** row opens Cut Settings and names what it holds for the current
   process.
8. The footer holds Include in output, Show on canvas and Add operation. While an artwork has its
   own settings and shares the operation, the footer says output and visibility still apply to
   every artwork using it.
9. Tabs in the Artwork panel keep their words on one line, and drop their icons when the rail
   is narrower than 320 px.

### Consequences

- Tests and tutorials refer to **More cut settings**; the inline-only tests for the moved fields
  now exercise them in Cut Settings.
- The Registration Jig panel still uses the shared Line fields, with its Contour entry option.
- The CNC half of the inspector is next. It waits for the open 3D relief work to finish changing
  the same CNC field files.
