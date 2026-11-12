## ADR-591 Amendment 4 - Basic-Latin text kerns as OpenType says (2026-11-12)

**Status:** Accepted; software-verified against HarfBuzz on every printable-ASCII pair of the
bundled fonts and of Liberation Sans. Not tested on a machine.
| **Date:** 2026-11-12

Amends the Decision's "Keep ordinary Latin … behavior compatible". Fixes oracle audit O7-P2-1
(`docs/audits/2026-11-11-oracle-o1/O7-text-and-font-truth.md`). Adds no Frame or Start gate
(ADR-565).

### Context

Basic-Latin text is laid out by opentype.js 2.0.0; text that needs shaping is laid out by
HarfBuzz. The oracle audit shaped the same strings with HarfBuzz and found opentype.js's
kerning broke the OpenType Layout rules in two ways:

- **It kerned from the wrong script.** It reads GPOS kerning from the `DFLT` script whenever a
  font has one, even for Latin text. OpenType's ScriptList says a client uses the text's own
  script table and `DFLT` only when there is none. Liberation Sans registers `kern` under `latn`
  only, so all four styles burned with no kerning at all: "AVATAR" at Size 10 came out 2.97 mm
  wider than the font says. Its legacy `kern` table (908 pairs) was skipped as well.
- **It stopped at the first kerning lookup.** OpenType applies every lookup a feature names, in
  LookupList order; within one lookup, the first matching subtable ends that lookup only.
  opentype.js returned from the first lookup that covered the left glyph. Pinyon Script lost
  234 pairs (a space before a capital, up to 150/2048 em: 0.73 mm at Size 10) and Pacifico 262
  (mostly punctuation, e.g. "(H" by 50/1000 em).

### Decision

1. **Basic-Latin kerning is computed by KerfDesk from the parsed GPOS table**
   (`src/core/text/outline-kerning.ts`): the `latn` script's default language system, else
   `DFLT`; every `kern` lookup (pair adjustment, also inside extension lookups) in LookupList
   order, the first matching subtable of each; the legacy `kern` table when that script has no
   GPOS `kern` feature, as HarfBuzz does. opentype.js still selects the glyphs (ligatures).
2. **Measuring and drawing share one sum** (`shaped-run-width.ts`): the line is measured and its
   glyphs placed from the same advances and kerning, so alignment and text frames match the ink.
3. **Text moves only where the font was misread.** On every printable-ASCII pair, the new kerning
   equals HarfBuzz for all 21 bundled fonts except Stardos Stencil, whose `kern` table HarfBuzz's
   build leaves out (see Consequences). Existing text in Pinyon Script and Pacifico moves by the
   missed pairs; the other bundled fonts lay out exactly as before. Embedded fonts built like
   Liberation Sans now kern.

### Consequences

- Pacifico's contextual alternates (`calt`) are still not applied on the Latin route, and the
  HarfBuzz build (HB_TINY) still ignores legacy `kern` tables on the shaped route. Both are listed
  for the maintainer in the O7 report (O7-P3-1, O7-P3-2): fixing either moves existing text.
- A test holds every bundled font's Latin layout to HarfBuzz's (`outline-kerning.test.ts`).
