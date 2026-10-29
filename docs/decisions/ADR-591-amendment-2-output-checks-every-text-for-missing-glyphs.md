## ADR-591 Amendment 2 - Output checks every text for missing glyphs, whichever route made it (2026-10-29)

**Status:** Accepted; software-verified through tests that drive Bake, a production run's open and
capture, the jig text panel, output preparation on the browser thread and in the output worker,
Start, Save and .rd preparation, the SVG, DXF and PDF exports and print, all with bundled fonts.
Not tested on a machine. | **Date:** 2026-10-29

Extends Amendment 1, whose title promises a warning "wherever text is made or burned". Follows
rolling audit v8 findings N4-P1-2 and N4-P1-3 (both P1), which an independent refuter confirmed in
main's code. Lifts Amendment 1's production-run and jig-editor limits. Adds no Frame or Start gate
(ADR-565).

### Context

Amendment 1 checked a text only while it was a variable record, at output, or while the text
dialog was open. Three routes made plain text with no check at all:

- **Bake** keeps a record's geometry as fixed text. Pacifico "Zoë 李" baked to "Zoë" with no 李,
  "李" baked to nothing, and the toast said "Baked 1 object".
- **A production run** materialises each row into plain text when the row is opened or captured.
  Its rows burned the same way, and opening and capturing raised nothing.
- **The registration-jig text editor** had no hint. "Café 李" in Pacifico burned "Café".

In each case Start, Save, Job Review, the exports and print showed nothing, because output read
`missingCharacters` only from the variable records it rendered. The same record as live variable
text warned in all of them.

### Decision

1. **Output checks every text it burns.** Plain text burns the geometry it was made with, so a
   character its font lacks is already missing from it. Preparing output asks the renderer which
   characters each plain text's content needs that its font has no glyph for. A text on an output
   layer inside the output's scope adds a `text-missing-glyphs` advisory: "Text “Café 李”:
   Pacifico has no 李; each engraves as a box, or not at all." Start and Save add these, with the
   variable records' advisories, to their warnings (`textGlyphAdvisories`). The check reads only
   the font's character map: one parse of each outline font, or the CNC face's stroke table, and
   no layout. A text whose font cannot load is not checked, and still burns, as before.
2. **One renderer carries the check.** `VariableTextRenderer` gains an optional
   `missingCharacters`. `outputTextRenderer` (`src/ui/text/output-text-renderer.ts`) is
   `renderVariableText` with that check. Start, Save G-code, .rd and tiled G-code (on the
   browser thread and in the output worker), Bake, the production run, the SVG, DXF, PDF, AI, EPS
   and GeoJSON exports and print use it. A renderer without the check, such as a test stub, leaves
   plain text unchecked.
3. **Output without a snapshot is checked too.** A project with no variable data or Print and Cut
   registration compiles a large job in the output worker, and a small .rd or tiled save on the
   browser thread, without a snapshot. Those compiles pass through `withTextGlyphCheck`, which
   adds the same advisories to the prepared output.
4. **Each route says so as it makes the text.**
   - **Bake** names each record's missing characters in its toast, which becomes a warning. It
     still bakes: a missing character is a policy finding, never a refusal (Amendment 1, point 1).
   - **Opening and capturing a production row** each show a warning toast for every text in the
     row: "Text “Zoë 李” (production row 2): Pacifico has no 李; …". The dialog's toast host shows
     it above the run.
   - **The jig text panel** shows the text dialog's `FontUsageHint` under its font picker while
     the text is typed.
5. **Exports and print say so.** The SVG, DXF and vector-format exports append the advisories to
   their done toast, which becomes a warning. Print shows them as a warning toast as it opens the
   print dialog.

### Consequences

- A character the font lacks is named before every burn of a text, whichever route made it,
  including routes added later, as long as they burn through output.
- Plain text from the main editor, already named by the dialog's hint while it was typed, is now
  named again in Job Review, Start and Save.
- Estimates and canvas previews keep `renderVariableText` and check nothing: they show no
  warnings.
- As in Amendment 1, Job Review lists them with Start's other warnings, and Save G-code, .rd
  and tiled saves show them as warning toasts after the write.

### Limits

- Amendment 1's production-run and jig-editor limits no longer apply. Its other limits stand:
  records not in this output are flagged only by the rows preview, and importing a CSV does not
  check every variable text against it.
