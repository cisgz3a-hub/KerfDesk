# O7 `text-and-font-truth` — Oracle audit O1, batch 3

**Area:** `src/core/text/`: HarfBuzz shaping, opentype.js parsing and the basic-Latin layout, bidi and script runs, glyph coverage and missing-glyph reports, text boxes, text on path, Bend, weld, outline conversion, single-line and SVG stroke fonts, font collections. Also the path from typed text to burned geometry (`src/io/text/prepare-text-shaping.ts`, the per-object nonzero fill rule in `src/core/job/`).
**Read at:** `origin/main` 93c880722 (2026-11-12). The P2 code was re-read at aad6efd64, which has no changes under `src/core/text/`. Method, severity and rules: [AREAS.md](AREAS.md).
**Fix PRs:**
- [#1798](https://github.com/cisgz3a-hub/KerfDesk/pull/1798): O7-P2-1, ADR-591 Amendment 4.
- [#1800](https://github.com/cisgz3a-hub/KerfDesk/pull/1800): O7-P2-2.

## Headline

Text is mostly placed where the font and Unicode say:

- **Bidi:** KerfDesk's bidi layer passes all 45,831 applicable cases of Unicode's `BidiCharacterTest.txt`, with 0 level errors and 0 order errors.
- **Arabic:** Arabic with harakat, lam-alef and brackets shapes exactly as raw HarfBuzz does.
- **Size:** Size is the em, as ADR-682 documents.
- **Weld:** welding keeps every counter.

Two defects are real:

- **O7-P2-1: Basic-Latin kerning.** Basic-Latin text is laid out by opentype.js, and opentype.js 2.0.0 kerns against OpenType's rules:
  - It reads kerning from the `DFLT` script instead of `latn`, and then skips the legacy `kern` table. Liberation Sans gets **no kerning at all**: "AVATAR" at Size 10 burns 2.97 mm too wide.
  - It stops at the first kerning lookup. Pinyon Script loses 234 pairs and Pacifico 262.
  - #1798 computes kerning from the GPOS table as OpenType defines it. It matches HarfBuzz on every printable-ASCII pair of the 21 bundled fonts.
- **O7-P2-2: Bend and path text.** Both moved only the ends of straight strokes, so a straight stroke stayed a chord across the arc. A Size 50 "HI" bent 180° sat **3.55 mm** off its arc. #1800 subdivides the strokes before mapping them.

Six P3s are listed for the maintainer. Fixing any of them moves existing text or needs a change of text engine. Among them, Pacifico's contextual alternates are not applied, and the HarfBuzz build ignores legacy `kern` tables.

| Raised | Refuted | Contradicted (research) | P1 | P2 | P3 |
|---|---|---|---|---|---|
| 10 (6 auditor, 4 refuter; 2 merged into others) | 0 | 0 | 0 | 2 | 6 |

## Oracle plan

This plan was written before the code was read closely, from the file list only. It is kept as written (session notes `O7-oracle-plan.md`).

| # | Claim | Oracle |
|---|---|---|
| M1 | Size maps to glyphs by Size/unitsPerEm (em) or by cap height, as documented | OpenType `head.unitsPerEm`, `OS/2.sCapHeight`; LightBurn Text docs |
| M2 | Line spacing uses one documented metric set | OpenType OS/2 fsSelection bit 7, `hhea` |
| M3–M5 | One y flip; quadratic and cubic outlines kept exactly; composite glyphs at their offsets | OpenType `glyf`/CFF |
| S1–S2 | Latin glyph ids and advances (kerning, ligatures) equal HarfBuzz for the same font and string | HarfBuzz; OpenType GPOS/GSUB |
| S3–S4 | Arabic joining and mark positioning, and combining marks, match HarfBuzz; one grapheme stays one cluster | HarfBuzz; UAX #29 |
| S5 | Supplementary-plane characters iterate by code point (cmap format 12) | OpenType `cmap` |
| B1–B4 | Visual order follows UAX #9; mirrored brackets; Common/Inherited join neighbouring runs; paragraph direction from the first strong character | UAX #9 + `BidiCharacterTest.txt`; UAX #24 |
| G1–G3 | Missing glyphs are reported, by code point, ignoring default-ignorables; limits never split a grapheme | OpenType `.notdef`; Unicode DerivedCoreProperties; UAX #29 |
| L1–L6 | Alignment uses shaped advances; path text keeps arc length; Bend keeps the middle line's length; weld keeps counters; polylines stay closed | properties |
| F1–F5 | Stroke fonts share the size meaning; SVG path grammar; stroke glyphs stay open; TTC face extraction; variable fonts use the default instance or say so | SVG 1.1 §8.3; OpenType Font Collections, `fvar` |

## Method as run

- **Auditor (this session).** Scratch Vitest probes ran on the real modules:
  - The 21 bundled fonts plus Liberation Sans on a 7-string corpus. Each string went through the opentype.js route, the KerfDesk HarfBuzz route and raw harfbuzzjs.
  - `BidiCharacterTest.txt`, fetched from unicode.org, through `bidiCharacters` → `bidiLineCharacters` → `visualBidiRuns`.
  - Arabic strings compared with raw HarfBuzz.
  - `Café` in every font.
  - The bend chord error against `bendPointMapper` itself.
  - Weld contour and area counts.
  - Size checks on single-line fonts, and supplementary characters.
- **Refuter (fresh subagent).** It used different methods:
  - a 95×95 printable-ASCII pair sweep of 25 fonts;
  - a hand-decoded `kern` table;
  - a font with its GPOS table removed;
  - an independent GPOS emulator;
  - the bend error derived from the arc formula;
  - a 64× subdivision comparison;
  - a scanline nonzero-area check;
  - text-box wrapping of mixed RTL paragraphs.
- **Research verifier (fresh subagent, web).** It fetched primary sources for 15 outside facts and marked all 15 **VERIFIED**: Microsoft OpenType spec pages (chapter2, features_ae/ko, kern, cmap, head, os2, otff), HarfBuzz `hb-config.hh`, `hb-ot-shape.cc` and `hb-ot-shape-normalize.cc`, the harfbuzzjs README and `config-override.h`, UAX #9 and #24, the LightBurn 2.2 Text reference, CSS Text 3, and SVG 1.1 paths.
- **Owner re-check.** This session read both P2s at aad6efd64:
  - `src/core/text/shaped-run-width.ts`, `text-glyph-geometry.ts` and `text-to-polylines.ts` (`SHAPING_OPTIONS`, `measureLineWidth`);
  - opentype.js 2.0.0 `Position.prototype.getKerningValue`, `getDefaultScriptName` and `Font.prototype.forEachGlyph`;
  - `src/core/text/text-bend.ts` and `text-on-path.ts`.

## Findings

### O7-P2-1 — Basic-Latin text kerns against OpenType's rules (wrong script, first lookup only)

**Where:** Text that needs no shaping (`needsTextShaping` is false) is laid out by opentype.js, through `font.forEachGlyph` with `{ kerning: true }`. That call is in `text-glyph-geometry.ts`, `text-to-polylines.ts` (`measureLineWidth`) and `shaped-run-width.ts`. opentype.js 2.0.0 has three kerning errors:

1. **Wrong script.** `getDefaultScriptName()` returns `DFLT` whenever the font has a `DFLT` script, even for Latin text.
2. **Legacy table skipped.** When `DFLT` has no `kern` feature, the lookup list is empty but still truthy. The legacy `kern` table is then never read.
3. **First lookup only.** `Position.getKerningValue` returns from the first lookup whose subtable covers the left glyph, so later lookups never apply.

**Reproduction** (Size 10, units per em in brackets):

| Font | Text | opentype.js | HarfBuzz | Effect |
|---|---|---|---|---|
| Liberation Sans Regular (2048) | AVATAR | 8194 | 7586 | 2.97 mm too wide: no kerning at all |
| Liberation Sans, 4 styles | ASCII pairs | 89–96 pairs differ | — | the same as HarfBuzz with `-kern` |
| Pinyon Script (2048) | " V", " Y", " W", " L" | 0 | +150, +70, −50, −30 | up to 0.73 mm per pair; 234 pairs differ |
| Pacifico (1000) | e.g. "(H" | 0 | −50 | 262 pairs differ |

The 18 other bundled fonts differ on no pair.

**Oracles:**
- OpenType Layout Common Table Formats ([chapter2](https://learn.microsoft.com/en-us/typography/opentype/spec/chapter2)), ScriptList. A client "should use a DFLT script table if there is not a script table associated with the specific script". Under Lookup table, a matching subtable finishes only its own lookup, and every lookup of a feature runs in LookupList order. **VERIFIED.**
- HarfBuzz as a reference implementation. The refuter's independent GPOS emulator gave 0 differences from HarfBuzz on every GPOS font.
- `hb-ot-shape.cc` uses the legacy `kern` table when GPOS has no `kern` feature. **VERIFIED.**
- `kern` is on by default ([features_ko](https://learn.microsoft.com/en-us/typography/opentype/spec/features_ko)). **VERIFIED.**

**Severity: P2.** A standard is broken in a way ordinary users hit. Any embedded font built like Liberation Sans burns with no kerning at all. Liberation Sans is the usual Arial substitute on Linux, and many FontForge-built fonts are built the same way. Two bundled fonts also lose pairs. It is not P1: the preview shows the same spacing before anything burns.

**Refuter:** CONFIRMED, and wider than reported: it also found the Pacifico pairs and all four Liberation styles. It found that `script: 'latn'` alone fixes Liberation, but not Pinyon or Pacifico.

**Fix (#1798, ADR-591 Amendment 4):**
- `src/core/text/outline-kerning.ts` computes pair kerning from the parsed GPOS table:
  - It uses the `latn` default language system, or `DFLT` when the font has no `latn` table.
  - It applies every `kern` lookup in LookupList order, including pair lookups inside extension lookups. In each lookup, the first matching subtable is used.
  - It falls back to the legacy `kern` table, as HarfBuzz does.
- opentype.js still selects the glyphs, ligatures included.
- Measuring and drawing share one sum.

On every printable-ASCII pair, the new kerning equals HarfBuzz for all 21 bundled fonts and Liberation Sans. There are two exceptions:

- **Stardos Stencil**, where harfbuzzjs itself is wrong (O7-P3-2).
- **"11" in Liberation.** Two digits alone are Common script, so HarfBuzz picks `DFLT`. KerfDesk's own shaped route treats them as Latin, as the new code does.

`outline-kerning.test.ts` fails on `origin/main`, with Liberation 2.969 mm off and Pinyon 0.146 mm off. It also holds every bundled font except Pacifico and Stardos to HarfBuzz's layout.

**What moves:** existing text in Pinyon Script and Pacifico moves by the missed pairs. The other 19 bundled fonts are unchanged.

### O7-P2-2 — Bend and path text map only the ends of straight strokes, leaving chords

**Where:**
- `src/core/text/text-bend.ts` (`bendColoredPath`, `mapSegment`).
- `src/core/text/text-on-path.ts` (`mapColoredPath`, `mapSegment`).
- Both maps are non-affine. `bendPointMapper` is documented as "every point keeps its distance along and across the text's middle line, wrapped onto the arc". Path text maps x to arc length along the guide.
- Only `line` endpoints and cubic control points were mapped, and the sampled polylines hold only a straight segment's two ends.

**Reproduction:** the distance of each straight segment's midpoint, mapped by the documented map, from the bent outline. Roboto:

| Text | Size | Bend | Miss |
|---|---|---|---|
| HI | 50 | 180° | 3.55 mm |
| TEXT | 20 | 90° | 0.63 mm |
| HELLO | 10 | 180° | 0.38 mm |
| EST. 2026 | 8 | 120° | 0.17 mm |
| WELCOME HOME | 15 | 60° | 0.07 mm |

Path text, "HELLO WORLD" on a circle of radius 30 mm, at Size 5 / 8 / 12:

| Guide | Miss |
|---|---|
| 64-segment circle | 0.14 / 0.24 / 0.37 mm |
| 256-segment circle | 0.04 / 0.09 / 0.18 mm |
| 16-segment circle | up to 1.17 mm |

A straight stroke across a guide corner missed by **6.87 mm**. Compilation does not hide any of this: flattening at 0.025 mm keeps the chords.

**Oracles:**
- Mathematical property: the documented point map, and the arc formula (sagitta = L²/8R). The refuter got the same 3.552 mm from L = 17.920 mm and R = 15.437 mm.
- LightBurn's Text reference documents Bend with an option that warps the characters ("Distort"). Glyph warping is expected behaviour. **VERIFIED.**

**Severity: P2.** Geometry departs from the documented map by millimetres at ordinary settings: a 180° arc on a short word, or large text on a tumbler or badge. It is not P1, because the preview shows the chords before the burn.

**Refuter:** CONFIRMED. All three figures were reproduced independently and two more cases were added.

**Fix (#1800):** `src/core/text/warp-subdivision.ts` splits segments and polyline edges before mapping:
- **Bend:** into pieces that turn at most 1° on the arc.
- **Path text:** straight edges break at every guide vertex, where the map stops being affine, so they follow the guide exactly. Curves are cut into 0.5 mm pieces.

Contour counts are kept. 2,000 characters on a 40,000-point guide place in about 0.2 s. `warp-subdivision.test.ts` fails on `origin/main`, missing by 3.55 mm and 6.87 mm. Two tests that indexed polyline points by position now locate the same points.

### O7-P3-1 — Pacifico's contextual alternates (`calt`) are not applied on the Latin route (listed)

**Where:** opentype.js applies only `liga` and `rlig` to Latin text (`updateFeatures` filters its default list). Pacifico relies on `calt` for its word-final forms.

**Reproduction:** glyph ids differ from HarfBuzz in 6 of 7 corpus strings, and line widths by 0.3–1.7 %. With `-calt`, HarfBuzz matches opentype.js on 9/9 words and 4,056/4,056 lowercase trigrams.

**Oracle:** for `calt`, "This feature should be active by default" ([features_ae](https://learn.microsoft.com/en-us/typography/opentype/spec/features_ae)). **VERIFIED.**

**Severity: P3.** The glyphs are the font's own and are legible; only the contextual forms are missing. **Listed, not fixed:** it needs HarfBuzz for Latin text, and that changes every existing Pacifico text.

### O7-P3-2 — The bundled HarfBuzz ignores legacy `kern` tables, so shaped text in such fonts loses kerning (listed)

**Where:** harfbuzzjs is compiled with `-DHB_TINY`. HB_TINY sets HB_MINI, HB_MINI sets HB_NO_LEGACY, and HB_NO_LEGACY sets HB_NO_OT_KERN. harfbuzzjs's `config-override.h` does not re-enable it. Text that needs shaping in a font that kerns only through a `kern` table loses all kerning.

**Reproduction:**
- Stardos Stencil (bundled; `kern` table only, no GPOS): "AVATAR" is 7477 units shaped and 6777 on the Latin route. 75 ASCII pairs differ.
- Adding one character that needs shaping re-spaces the whole line. The refuter's example: "Café" loses the kerning that "Café" keeps.
- The refuter decoded the `kern` table by hand and it is valid. A Liberation copy with its GPOS table removed also gets no kerning from harfbuzzjs.

**Oracles:**
- [kern](https://learn.microsoft.com/en-us/typography/opentype/spec/kern), format 0 with horizontal coverage. **VERIFIED.**
- `hb-config.hh` and the harfbuzzjs README. **VERIFIED.**
- `hb-ot-shape.cc`, where full HarfBuzz applies the table. **VERIFIED.**

**Severity: P3.** It needs a kern-table-only font and a character that needs shaping. **Listed:** the fix adds the `kern` pairs after shaping, as #1798 already does for the Latin route, and moves existing shaped text in such fonts.

### O7-P3-3 — False missing-glyph warnings for decomposed accents, and boxes for precomposed letters the font could build (listed)

**Where:** `missingCharacters` (`glyph-coverage.ts`) checks each code point against the cmap. HarfBuzz instead composes a base and a mark into a precomposed glyph the font has.

**Reproduction:**
- "Café" warns "has no U+0301" in Cinzel Decorative, Courier Prime, Parisienne, Poppins, Special Elite and Stardos Stencil. In all six it shapes with no `.notdef`.
- Poppins "Ș" warns about U+0326 but draws U+0218.
- NFD text is common in names that come from macOS.
- Conversely, a typed precomposed letter the font lacks (such as Ǎ) takes the Latin route and burns `.notdef`, though the font has its base and mark. This affects 3–115 characters per font.

**Oracle:** `hb-ot-shape-normalize.cc` decomposes, then recomposes only into characters the font supports. **VERIFIED.**

**Severity: P3.** The warning is a false alarm and the burn is correct, or the box is reported. **Listed:** the refuter showed that an NFC-based check would create new false warnings (U+1EB9; U+0218 in Special Elite). A correct fix reads glyph 0 from HarfBuzz's own output on every warning route, including output preparation, the text worker and the remote route.

### O7-P3-4 — Letter spacing opens gaps inside joined Arabic words (listed)

**Where:** `text-shaping.ts` adds tracking between every cluster, including inside a cursive word.

**Reproduction:** Noto Sans Arabic at Size 10, spacing 0.2. "محمد" goes from 1 piece to 4 pieces with 1.50 mm gaps; "مرحبا" from 1 to 5; the width of "مرحبا بالعالم" from 47.5 to 71.5 mm.

**Oracle:** CSS Text 3 §7.2.1 Cursive Scripts: if the UA cannot space without breaking cursive joins, it "must not apply spacing" between those letters. **VERIFIED.**

**Severity: P3. Listed:** fixing it changes existing spaced Arabic text.

### O7-P3-5 — A space after a closing bracket takes the script from inside the brackets (listed)

**Where:** `text-script-runs.ts` resolves the bracket pair first. The space after it then inherits the bracketed script.

**Reproduction:** in "x [αβ] y", the space after "]" resolves to Grek instead of Latn. That adds a run boundary, which can drop a kerning pair across it (Pinyon kerns pairs that start with a space).

**Oracle:** UAX #24 §5.1 calls the Common rule a heuristic. Paired punctuation should match the enclosing text. **VERIFIED** as guidance, not a rule.

**Severity: P3** (shaped route only, rare). **Listed.**

### O7-P3-6 — opentype.js does not parse GPOS extension lookups (listed, not verified on a real font)

**Where:** The refuter found that opentype.js 2.0.0 returns an error object for a GPOS lookup of type 9 (extension). A font that wraps its kerning in extension lookups would get no Latin kerning, even after #1798. #1798 reads extension subtables when opentype.js parses them.

**Severity: P3.** No bundled or repo font uses GPOS extension lookups, so this is **not verified** on a real font. **Listed.**

## Refuted

None.

## Verified clean

- **Bidi (UAX #9).** 45,831 cases from `BidiCharacterTest.txt` give 0 level errors and 0 order errors. The cases are every auto-direction line, plus each explicit line whose auto paragraph level equals the given one. Lines with segment or paragraph separators were skipped, because `textForLayout` turns tabs into spaces and splits at line feeds.
  - The refuter wrapped 3 mixed Hebrew/Latin paragraphs at 3 widths each: all 34 lines matched its own reordering.
  - All 11 supplementary characters it tried keep their bidi class.
  - The test file itself has no supplementary characters. Proxies for Cypriot, Adlam and mathematical digits gave the same levels as BMP stand-ins.
- **Arabic shaping.** KerfDesk's shaped line equals raw HarfBuzz on 15 strings: harakat, every lam-alef form, shadda in both orders, tatweel, ZWNJ/ZWJ, U+FDFA, brackets. The one difference ("كتب ١٢٣") is KerfDesk being right: raw HarfBuzz without bidi reverses the Arabic-Indic digits.
- **Size is the em (ADR-682).** At Size 10: Roboto H 7.109 mm = 1456/2048 × 10, Tinos 6.548, Anton 8.594. Single-line fonts: Relief 6.800, EMS Nixish 6.585, EMS Decorous Script 6.778, EMS Casual Hand 8.754 mm. ADR-682 rounds Decorous to "6.80"; 6.78 would be exact. LightBurn calls Height "generally the height of a capital letter X" ([Text reference](https://docs.lightburnsoftware.com/latest/Reference/Text/)) and says it is not exact, and ADR-682's measurements show it scales by the em. **VERIFIED.**
- **Weld keeps counters.** "o e A B 8 g" in Roboto, Pacifico and Anton keeps the same contours and holes, with net area within 0.03 mm². On DancingScript, a variable font with 3.13 mm² of overlapping contours, the weld equals a nonzero fill to 0.0001 mm² and leaves no self-overlap. Text fills per object under nonzero (`layer-fill.ts`).
- **cmap format 12 and surrogates.** Roboto's U+1F16A/B draw glyphs 1857/1858. An unsupported supplementary character draws one `.notdef` and is reported once. A lone surrogate is refused. **VERIFIED** ([cmap](https://learn.microsoft.com/en-us/typography/opentype/spec/cmap) format 12).
- **Quadratic outlines.** `Q` is converted to a cubic exactly (control points at 2/3). Contours stay closed (`text-outline-path.ts`).
- **SVG stroke fonts.** `svg-stroke-font.ts` follows SVG 1.1 §8.3: a relative first `m` is absolute, extra pairs after a moveto are linetos, `S` reflects the previous control point, and closepath returns to the subpath start. **VERIFIED.**
- **Font collections.** `font-collection.ts` reads the TTC header and copies one face's tables. It recomputes `checkSumAdjustment` = 0xB1B0AFBA − sum and checks `fsType` on the extracted face. **VERIFIED** ([otff](https://learn.microsoft.com/en-us/typography/opentype/spec/otff)).
- **Script runs (UAX #24).** "abc (שלום) 123", Greek/Latin mixes, emoji ZWJ sequences, a leading mark and Katakana with ー all itemise as expected. The one exception is O7-P3-5.
- **Bundled fonts agree.** Leaving aside Pacifico, Pinyon and Stardos, the opentype.js route equals HarfBuzz in glyph ids and positions for the 18 other bundled fonts, on every printable-ASCII pair.

## Not verified

- **Variable fonts.** DancingScript has `fvar`. Both engines draw the default instance; axes are never applied. No other variable font was tried.
- **GPOS extension lookups** (O7-P3-6) were not tried on a real font.
- **No fallback mark positioning.** The HB_TINY build also sets HB_NO_OT_SHAPE_FALLBACK. Marks in fonts without a GPOS `mark` feature (such as "q̃" in Courier Prime) are not placed by fallback rules. This was not measured.
- **Hardware.** No laser or machine was used; geometry was checked in software only.

## For the maintainer

These are listed rather than fixed, because each one moves existing text or needs a decision about the text engine:

1. **One engine for all outline text.** Shaping basic-Latin text with HarfBuzz too (with #1798's kerning supplement for legacy `kern` tables) would fix O7-P3-1 and O7-P3-2, and the two routes could no longer disagree.
   - Cost: Pacifico text changes shape, and every text then needs the WASM runtime.
2. **O7-P3-3:** compute missing glyphs from HarfBuzz's output on every warning route.
3. **O7-P3-4:** no tracking inside joined Arabic words.
4. **O7-P3-5:** a space after a closing bracket takes the outer script.
