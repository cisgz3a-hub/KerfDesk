## ADR-591 Amendment 3 - Text notices share one toast per output, and single-line fonts say Right-to-left is not supported (2026-11-02)

**Status:** Accepted; software-verified through tests of output preparation, Save G-code's toast
order, .rd, the SVG export, the remote review projection and the text dialog. Not tested on a machine.
| **Date:** 2026-11-02

Extends Amendment 2. Fixes rolling audit v9 R4-P2-3 and R4-P2-4 (both P2)
(`docs/audits/2026-11-02-rolling-v9/R4-fix-text-frames.md`). Adds no Frame or Start gate (ADR-565).

### Context

- **Text warnings crowded out the others.** Amendment 2 raised one advisory per text. Save G-code
  raised one toast for each, after its other warnings, and only the newest three toasts render
  (`Toasts.tsx`). All the timers run for the same 8 s, so older toasts expired unseen. Three or more
  texts pushed out earlier warnings such as `out-of-bed`. Removing repeats would not have been enough:
  three different texts do the same.
- **Right-to-left drew two extra characters.** `styledTextContent` wraps each line in U+202B and
  U+202C. Outline fonts consume them while shaping. A single-line font has no bidi layout and no such
  glyphs, so it drew `?` at each end of every line and did not reverse the order. "Straße" in Relief
  grew from 28.83 to 38.69 mm, and the warning read "Relief SingleLine has no U+202B U+202C; each
  engraves as ?", naming two characters the user never typed.

### Decision

1. **One issue per kind of notice, per output** (`mergeTextNotices`). Missing characters, overflow
   (ADR-682 Amendment 2) and Right-to-left each merge separately, for Job Review, Start, Save, .rd,
   tiled G-code, the exports, print, Bake and production rows.
   - One text keeps its sentence, unchanged.
   - Copies count: "Text “Café 李” (200 copies): Pacifico has no 李; …".
   - Different texts share a list: "Missing characters in 3 texts: “Café 李” (Pacifico: 李), “Zoë 東”
     ×2 (Pacifico: 東). Each engraves as the font’s box or ?, or not at all."
   - The list names five texts and then "and N more". One text names twelve characters and then "and
     N more".
2. **Other findings stay on screen.**
   - Save G-code now toasts in order of importance: notes first, then text notices, then its machine
     warnings, then the preflight's findings last, so they are the newest.
   - Prepared output lists merged text notices before its other advisories, so .rd and tiled saves,
     which toast in that order, leave the newest places to those findings.
3. **Single-line fonts never receive bidi controls.** `renderStrokeFontText` and the single-line
   glyph check drop U+061C, U+200E, U+200F, U+202A to U+202E and U+2066 to U+2069, whether Right-to-left
   added them or they were pasted. No `?` is drawn for them, and they are not named as missing. Text
   burns left to right. Reversing it is not attempted: that needs a real bidi layout.
4. **It says so plainly.**
   - A `text-rtl-unsupported` advisory: "Text “Straße”: Right-to-left isn’t supported on Relief
     SingleLine, so it burns left to right."
   - The dialog's checkbox reads "Right-to-left (not on single-line fonts)" and is disabled on those
     fonts. The saved choice stays, and works again when the font changes to an outline font.
5. **Older text says what it still holds.** Plain text burns its stored geometry, and an older build
   stored the `?`. Opening a project does not redraw it, so the canvas and the burn keep agreeing, and
   the next edit removes it. Output compares the stored width with a fresh render, and the advisory
   adds: "Saved by an older build, it also burns a ? at each end of every line until you edit it."
   Text on a path is placed in world space and has no such comparison, so it gets the plain sentence.
   Only a single-line text with Right-to-left on pays for that render.

### Consequences

- Save G-code's "assumes GRBL $30" note appears before the warnings rather than after, and expires
  first when the list is long.
- More than three preflight findings can still push each other out. This amendment stops text notices
  doing so; it does not change the three-toast limit.

### Verification

- `src/ui/text/text-output-notices.test.ts`: 200 copies, three different texts, both caps, one text's
  sentence, .rd's order, Save's warnings and on-screen toasts with a job off the bed, the SVG export's
  toast, the remote review projection; Right-to-left's ink, several lines, pasted marks, the advisory
  on plain text and variable records, and outline fonts as the control.
- `src/ui/text/variable-text-frame-older-project.test.ts`: Relief text saved with Right-to-left by the real
  1.0.28 (`33bc394c6`) names the `?` it still holds.
- `src/ui/text/TextStyleFields.test.tsx`: the checkbox's words and state.
