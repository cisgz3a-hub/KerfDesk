## ADR-268 Amendment 2 - Readers match their text in linear time (2026-10-28)

**Status:** Accepted | **Date:** 2026-10-28 | **Amends:** ADR-268 item 4

### Context

Item 4 rests on every import loop being bounded by its input. The SVG and LightBurn readers read
numbers, lengths, paints, transform lists and keywords with regular expressions, and those are part
of the same loops. Several of them could match one run of digits, letters or spaces in more than one
way. For example, `\d+\.?\d*` can split a whole number between its two digit runs at any point, and
`\s*([a-zA-Z]*)\s*$` can split a run of spaces between its two space runs when there is no unit. A
pattern like that is not linear in its text. This amendment is parser hardening: the patterns change,
but no value is read differently.

### Decision

1. **A numeral matches one way.** Number patterns use `\d+(?:\.\d*)?|\.\d+`, as
   `hpgl-tokenizer.ts` already did. This covers the SVG `stroke-width` reader
   (`svg-presentation.ts`), the SVG artwork-origin metadata (`svg-artwork-origin.ts`), LightBurn
   `<VertList>` coordinates and handles (`lbrn-vertex-list.ts`), and the Auto-focus command check
   (`autofocus-command.ts`).
2. **Optional parts carry their own spaces.**
   - An SVG length (`svg-units.ts`) reads `number (spaces unit)? spaces`, so the spaces before a unit
     and the spaces at the end are never the same run. Both length readers share the pattern.
   - A `url()` paint (`svg-paint.ts`) gives each reference form its own trailing spaces, and an
     empty `url()` has none.
3. **`!important` is removed without a leading space run.** The SVG presentation readers removed it
   with `\s*!important$` and then trimmed. They now remove `!important` (or, for paint,
   `!\s*important`) and let the trim that already follows take the spaces before it.
4. **Transform lists are scanned once.** `svgTransformFunctions` (`svg-transform-attribute.ts`)
   lists the `name(arguments)` of a transform list for both the general transform reader and the
   strict clip-path reader. A name starts only where no letter precedes it, and the scan ends at the
   last `)`. The matches are exactly those of the old `/([a-zA-Z]+)\s*\(([^)]*)\)/g`, which also
   started each name at its first letter and could not close a function after the last `)`.
5. **Short values have a length cap.** A `stroke-width` or artwork-origin value longer than 256
   characters is unreadable: the inherited stroke width applies, or the standard SVG mapping. No
   writer produces either at that length. A `<VertList>` is legitimately long and has no cap; its
   pattern is linear.

### Consequences

- Every accepted and refused form is unchanged. `svg-value-forms.test.ts`, the stroke-width case in
  `parse-svg-structure.test.ts` and the numeral cases in `lbrn-vertex-list.test.ts` list them.
- A new reader pattern keeps this property: no two neighbouring quantifiers that can match the same
  characters, and no unanchored pattern that begins with a quantified run before a fixed character.
