## ADR-682 - Text Size is the font's em, and variable records keep their baseline

**Status:** Accepted; unit- and UI-tested against emitted G-code, not hardware-tested. |
**Date:** 2026-10-28

Fixes rolling audit v7 L3-P1-1, L3-P2-1, L3-P1-2, L3-P2-5 and L3-P3-1
(`docs/audits/2026-10-28-rolling-v7/L3-text-typography.md`). Changes how ADR-226's single-line
fonts are scaled. Path text alignment (ADR-480) and text frames (ADR-570) are unchanged for
ordinary text; only variable records placed by them move. The Frame-first Start contract
(PROJECT.md non-negotiable 21, ADR-565) is unchanged, and nothing here adds or removes a Start
guard.

### Context

**What Size meant.** No decision said. Outline fonts scaled Size as the em: the font's design
square, as CSS `font-size` does. A Size 10 Roboto capital burns 7.109 mm (`OS/2` cap height
1456 of 2048). The four single-line fonts scaled Size by the SVG source's `cap-height`
attribute instead. For Relief SingleLine that is its real capital height (680 of 1000), so its
capitals burned 10.000 mm. The three EMS sources all declare `cap-height="500"`, a placeholder
their glyphs never follow: their H rises 639–910 units of a 1000-unit em. A Size 10 capital
burned 12.7–17.5 mm, and two lines of EMS Casual Hand collided at the default line height. The
field's tooltip said "Text height in millimeters."

**What LightBurn does.** LightBurn 2.1's Text reference
(https://docs.lightburnsoftware.com/2.1/Reference/Text/, read 2026-10-28) says Height "is
generally the height of a capital letter X in the font", is "not exact", and that "every font has
an internal size that is scaled by this Height". Measured LightBurn output follows the em:

- Verdana at Height 25 gave capitals 18.2 mm tall
  (https://forum.lightburnsoftware.com/t/text-height-not-accurate/113545). Verdana's cap height
  is 1489 of 2048 units, so its em was 25 mm.
- LightBurn's Adam Haile describes the value as "the absolute maximum height that the font will
  render" (https://forum.lightburnsoftware.com/t/letter-size-not-the-same/36983).

So KerfDesk's outline fonts already burn what LightBurn burns for the same number.

**Variable records.** Output re-renders each record and moves it so its alignment anchor (a
point on the first baseline) lands on the template's (#1359). Three placements skipped that:

- A bend dropped the anchor, so a centred name bent 60° burned 17–23 mm off centre.
- A text frame puts each record's ink top at its top, so names with and without capitals burned
  on baselines 1.7–2.4 mm apart.
- Path text lays each record's ink bottom on the guide, so "Peggy" sat 2 mm higher than "Anna".

### Decision

1. **Size is the font's em height in millimetres for every font.** Outline fonts are unchanged.
   Single-line fonts scale by their units per em (1000 for all four). At Size 10, an H burns
   7.11 mm in Roboto, 6.80 mm in Relief, 6.59 mm in EMS Nixish, 6.80 mm in EMS Decorous Script
   and 8.75 mm in EMS Casual Hand, whose capitals vary more than most (its X is 6.4 mm).
   - The em is chosen over the capital height for three reasons. LightBurn's output scales by
     it, so one number burns the same in both programs. Every saved outline-font project keeps
     its meaning. Every font has exactly one em, while capital heights differ from letter to
     letter.
2. **The field says so.** The text dialog's field is labelled **Font size**. Its tooltip says
   Size is the font's em height in mm, as in other design apps, and that capitals come out at
   about 0.6 to 0.9 of it. The registration-jig editor's field says the same.
3. **The generator measures the glyphs** (`scripts/generate-cnc-stroke-fonts.mjs`).
   - It records `units-per-em`.
   - It records the capital height as the top of the H.
   - It refuses a `cap-height` attribute that differs from the H by more than 1 % of the em,
     unless the font's entry names that value as a known `placeholderCapHeight`. It also refuses
     a placeholder entry that the source has since fixed.
   - The regenerated data differs only in those two numbers; every glyph is byte-identical.
   - The EMS fairing tolerance (`fair-stroke-font.ts`) is restated against the em, at half the
     old cap-height ratios. The faired curves are bit-identical.
4. **Project schema 19 keeps old single-line text exactly as drawn.** Loading an older file
   converts every text object in a single-line font:
   - Size is multiplied by 1000/680 (Relief) or 2 (EMS);
   - line height and letter spacing, which are multiples of Size, are divided by the same factor;
   - a shrink-to-fit frame's smallest size is multiplied too.
   Stored geometry is untouched, and a re-render draws the same paths (tested to 1e-9 mm).
   - An old EMS project therefore keeps its larger letters, and Size now reads what they are:
     Size 10 becomes 20. Editing the size is how to shrink them.
   - Older builds refuse schema 19, because they would re-render the converted text 1.47 or 2
     times too large on an edit or a variable record.
5. **A bend carries the anchor** (`text-bend.ts`, `text-style.ts`). The distorting bend maps the
   anchor with the point map that bends the glyphs. The rigid bend ("Don't distort") maps it the
   same way; a glyph standing on the anchor lands on it. Bent records then align like unbent ones.
6. **A frame's anchor is its alignment point on the first baseline**: the frame's left edge,
   centre or right edge (`text-box-render.ts`).
   - A variable record laid out at the template's size moves inside the same frame so its first
     baseline is the template's.
   - A record the frame had to shrink keeps the frame's rule, ink top at the frame top, so it
     stays inside the frame. Its size differs anyway.
   - The template and all non-variable framed text are drawn as before.
7. **A path record keeps the template's baseline** (`text-on-path.ts`,
   `render-variable-text.ts`). The guide crosses each record at the same distance from its first
   baseline as it crosses the template. With **Text sits: On top of**, a record with descenders
   hangs them below the template's line. The template itself is placed as before.
8. **Max width in a frame squeezes about the frame's alignment point** (L3-P3-1), so centred or
   right-aligned framed text stays centred or right-aligned. Other text still keeps its ink's
   left edge.

### Consequences

- A Size typed in KerfDesk and a Height typed in LightBurn burn the same outline text. Switching
  between an outline and a single-line font at one Size changes capitals by the font's own
  proportions (0.64–0.91 of the em), not by 41–75 %.
- New single-line text is smaller at the same Size than before: Relief by 32 %, the EMS fonts by
  half. Old projects keep their size through the migration.
- A single-line frame now counts each line's full em height, as outline frames count ascender
  plus descender. A fixed shrink-to-fit frame can therefore choose a slightly smaller size than
  before when its text only just fitted.
- MCP and remote `fontSizeMm` keep their name. For single-line fonts it now means the em too.
- Not changed: editing text in place still keeps its ink top-left (L3-P3-2, ADR-320 item 4), so
  centred text drifts as it is retyped.

### Verification

- `src/ui/text/variable-text-placement.test.ts` measures emitted G-code.
  - **Size:** each font's Size 10 H.
  - **Line spacing:** two Casual Hand lines no longer collide.
  - **Bends:** centred records under bends of ±60° and the rigid bend land within 0.01 mm. The
    defect moved them 17–23 mm.
  - **Frames:** boxed records share one baseline and centre, and a shrunk record stays inside.
  - **Path text:** both records' capitals reach one height above the guide.
  - On main's sources, 10 of its 12 checks fail.
- `src/io/project/migrate-v18-single-line-text-em.test.ts` loads schema-18 text in each
  single-line font. Rendered at the migrated values, it reproduces the old geometry.
- Core unit tests:
  - the generator's measured capital heights (`cnc-stroke-font.test.ts`);
  - the bend and rigid-bend anchors (`text-bend.test.ts`, `text-style.test.ts`);
  - the frame squeeze pivot (`text-style.test.ts`);
  - path text's template baseline (`text-on-path-alignment.test.ts`).
