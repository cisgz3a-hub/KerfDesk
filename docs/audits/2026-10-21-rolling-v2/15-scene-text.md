# Rolling audit v2 — Scene model and text

- **When:** 2026-10-21 17:50 +0800   **Tree:** origin/main @ `2c8d988db` (worktree HEAD
  `e9b06331b`, which adds only audit docs). Re-checked against origin/main @ `c708073a7`:
  `git diff --stat HEAD origin/main` over every audited path is empty, so no audited file changed.
- **Scope:** `src/core/scene/**`, `src/core/text/**`, `src/ui/text/**`, `src/core/variables/**`.
  Twins were followed into `src/io/gcode/variable-text-anchor.ts`,
  `src/io/gcode/prepare-output-snapshot.ts`, `src/io/text/prepare-text-shaping.ts`,
  `src/core/geometry/kerf-offset.ts` and `stroke-transform.ts`, `src/core/job/layer-fill.ts`,
  `src/ui/workspace/object-display.ts`, and the opentype.js 2.0.0 and harfbuzzjs 1.6.3 packages.

  Governing documents:
  - ADR-012, ADR-164 and ADR-628 (fonts, embedded fonts, system fonts)
  - ADR-150 and its Amendment 1, ADR-279, F-D6 (variable data, copy offsets, arrays)
  - ADR-286, ADR-319 and ADR-321 (non-zero glyph regions, transformed stroke pens, weld)
  - ADR-320 (canvas text drafts), ADR-643 (text worker), ADR-591 / WORKFLOW "Other text
    controls" (multilingual shaping)
  - Commit `80c25cf62` (text styles: bold, italic, upper case, right-to-left, max width,
    undistorted bend; "LightBurn parity D022, D023 and D026")
- **Lenses run:** L1, L2, L3, L4 and L7 as separate passes. L6 was run on the text worker,
  the bold offset and output materialisation. L5 was run only as far as embedded fonts reach
  opentype.js and HarfBuzz; `.lf2` validation is area 13.
- **Method:** focused Vitest repros through the real core functions (`textToPolylines`,
  `createTextShaping`, `styledBentRender`, `styleTextRender`, `weldTextRender`,
  `bendTextRender`, `placeTextOnPath`, `materializeVariableText`), plus Node scripts that read
  the bundled TTFs directly (name, OS/2, kern, GSUB/GPOS and composite bounding boxes). The
  repro tests are archived in this session's scratchpad (`…/scratchpad/a15/repros-15/`). They
  were deleted from the repo.
- **Counts:** 5 raised → refuter: 5 CONFIRMED, 0 PLAUSIBLE, 0 REFUTED → P1 0 / P2 1 / P3 4
  (+ 1 KNOWN not re-raised). The refuter changed no severity.

## Headline

The text pipeline is robust against adversarial input. 32 hostile cases (empty, CRLF, lone
surrogates, zalgo, bidi, emoji, ZWJ, soft hyphens, zero and negative sizes, zero-width frames)
rendered without a throw or a non-finite point, and missing glyphs were always reported. Glyph
winding, counters, composite accents and the non-zero fill rule hold in every bundled font, and
the worker's font hand-off has no race.

The one P2 is in the newest code, the October text styles. **Max width** squeezes the
geometry but leaves the render's alignment anchor where it was before the squeeze. Variable text
uses that anchor to place each record, so a centred or right-aligned name tag with Max width
lands every record off its designed position: +7.5 mm for short names and −19 mm for a long
centred one in the repro, and up to −39 mm for a right-aligned one. LightBurn's own docs give
Max width exactly this job, keeping variable text inside a width.

The P3s:
- Bold and italic shift variable records by fractions of a millimetre.
- Bold normalises glyphs even-odd, which punches holes where script letters overlap.
- The basic-Latin route (opentype.js) and the multilingual route (HarfBuzz) lay out the same
  Latin text differently in 3 of 21 bundled fonts. One invisible character switches the route.
- The distorting bend and path text map straight glyph edges as chords, up to 0.39 mm off.

## Findings

### P2-1 — Max width leaves the alignment anchor unsqueezed, so variable records land off their designed position

- **Where:**
  - `src/core/text/text-style.ts:55-59`: Max width maps the paths with
    `{ a: k, e: minX·(1−k) }`.
  - `text-style.ts:80`: `mapped()` returns `{ ...rendered, paths, bounds }`. The `anchor` that
    `textToPolylines` reported is carried over unchanged, in the unsqueezed frame. The same
    applies to italic (`:60-63`); see P3-3.
  - `src/ui/text/render-variable-text.ts:44`: output renders each record through
    `styledBentRender`, so the record's anchor is stale too.
  - `src/io/gcode/prepare-output-snapshot.ts:163-171` → `variable-text-anchor.ts:51-60`: the
    record is moved so that `record.anchor` lands on `placed.anchor`, the stale anchor of the
    design's own squeezed render.
- **Anchor:**
  - Contract: `TextRenderResult.anchor` (`text-to-polylines.ts:95-102`) is "in the same frame
    as `paths`", and variable output uses it "to keep a changing value where the operator
    placed it". `variable-text-anchor.ts:1-7` states the same: a centred name must not drift
    with its width.
  - Ground truth: LightBurn's Shape Properties docs say Max Width exists so variable text output
    does not exceed a width after its expression is evaluated
    (<https://docs.lightburnsoftware.com/2.1/Reference/VariableText/>). Max width was added for
    "LightBurn parity" (`80c25cf62`).
- **Scenario:**
  1. A name tag with Roboto 10 mm, template `{{csv:name}}`, **centred**, **Max width 40 mm**,
     at X 100. The template renders 55.6 mm wide, so the design itself is squeezed to 40 mm.
  2. Output places every record's ink centre away from the design's ink centre:
     - `Al` +7.48 mm, `Ann` +7.52, `Jay` +7.86. These short names are not squeezed, but the
       design's anchor is stale.
     - `Alexander` +5.69. `Maximilian Alexander`, squeezed to 40 mm, lands at −19.14 mm.
  3. **Right-aligned**, the right edge misses by +15.1 mm (short names) and −38.8 mm (the long
     name).
  4. Control: the same tag without Max width stays within −0.31 to +0.35 mm. That residue is
     the difference between ink and advance.
  5. The canvas shows the template where the operator centred it, because variable text draws
     its template. Only the output preview and the Frame outline show the shift. In a batch or
     a production run, every tag is engraved off-centre.
- **Evidence:** REPRO. `node ../../../node_modules/vitest/vitest.mjs run
  src/io/gcode/zz-15-style-anchor.test.ts` (archived as `src_io_gcode_zz-15-style-anchor.test.ts`).
  It builds the design exactly as `buildTextObject` does (render, then `styledBentRender`) and
  materialises each CSV record with the real `materializeVariableText` and
  `anchoredVariableTextTransform`. Output excerpt:
  - `maxWidth 40 center (design w=40.00 …): Al: … ref-off=7.480 … Maximilian Alexander:
    w=40.00 ref-off=-19.138`
  - `maxWidth 40 right …: Al: … ref-off=15.137 … Maximilian Alexander: … ref-off=-38.789`
  - `plain center …: Al: … ref-off=-0.305 … Maximilian Alexander: … ref-off=0.347`

  Novelty: no audit or open PR names text styles or `variable-text-anchor`. LBG-F09 (2026-09-26)
  only listed Max width as missing. The anchor tests (`variable-text-anchor.test.ts`) use
  unstyled text only.
- **Refuter:** CONFIRMED, P2 kept.
  - **Own repro through emitted G-code.** The refuter used its own text: Poppins 8 mm
    `{{csv:name}}` at X 120 with Max width 35. It ran `buildTextObject`, then
    `prepareOutputSnapshot(renderVariableText)`, then `emitPreparedGcode`, and measured the X
    range of the G1 burn moves.
    - Centred: each record's burn centre missed the design's by +8.66 mm (`Bo`, `Eve`),
      +2.91 mm (`Christopher`) and −23.79 mm (`Christopher Montgomery`, squeezed).
    - Right-aligned: the right edge missed by +17.55 mm and −47.08 mm.
    - Left-aligned: no extra shift, because the squeeze pivots on the left edge.
    - Control, without Max width: −0.50 to +0.73 mm.
  - **LightBurn docs.** The 2.1 VariableText page gives Max Width the job of keeping variable
    output within a width. The Text page says Align X "determines the horizontal anchor
    position of the text". No LightBurn page and no ADR chooses an off-anchor landing.
  - **Severity.** The Frame and the output preview use the prepared job, so they show the
    shift. That keeps this out of P1. P3 does not fit either: the canvas shows the template
    where it was placed, and every record lands somewhere different.
- **Fix direction:**
  - Map the anchor through the same affine in `mapped()`, for squeeze and italic, as the paths
    are mapped.
  - Add a styled-text case to `variable-text-anchor.test.ts`: centre and right, Max width
    shorter than the template.

### P3-1 — The basic-Latin route (opentype.js) and the multilingual route (HarfBuzz) lay out the same Latin text differently; one invisible character switches between them

- **Where:**
  - `src/core/text/text-shaping-required.ts:4`: any mark, any `Cf` character (U+00AD soft
    hyphen, U+200B, U+FEFF, LRM) or any non-Latin/Common letter sends the **whole object**
    through HarfBuzz (`prepare-text-shaping.ts:17`).
  - Otherwise `text-to-polylines.ts:309,381` lays it out with opentype.js `getPath`, using
    `kerning: true` and `liga`/`rlig` only.
- **Anchor:**
  - Twin: the two routes must agree on Latin text. WORKFLOW "Other text controls" says
    existing basic Latin "keep[s] their established geometry".
  - Ground truth, part 1: the OpenType feature registry says `calt` "should be active by
    default" (<https://learn.microsoft.com/en-us/typography/opentype/spec/features_ae>).
    opentype.js 2.0 applies only `liga`/`rlig` for `latn`.
  - Ground truth, part 2: `Position.getKerningValue` (`opentype.mjs:9846-9872`) returns the
    first subtable hit across all `kern` lookups, where OpenType applies every lookup.
  - Ground truth, part 3: harfbuzzjs builds with `-DHB_TINY` (its Makefile).
    `hb-config.hh` says `HB_TINY` → `HB_MINI` → `HB_NO_LEGACY` → `HB_NO_OT_KERN`, so the
    HarfBuzz route ignores a legacy `kern` table. harfbuzzjs's `config-override.h` does not
    undo this.
- **Scenario:** 10 mm text; widths are of the same visible glyphs.
  - Stardos Stencil (bundled, `kern` table only): `AVATAR` is 33.149 mm. `AVATAR` + U+00AD,
    which looks identical, is 36.567 mm (+3.4 mm, all kerning lost). `WAVE TO` gains +2.1 mm.
  - Pacifico: `yours truly` is 48.570 mm on the Latin route without contextual alternates, and
    46.000 mm with them on HarfBuzz. Glyph ids differ: final `r`/`s` forms, the `o` after `T`,
    and `fi`/`fl` stop ligating once `calt` has run.
  - Pinyon Script: `To Ta Te Yo` differs by 0.34 mm. Its `kern` feature has two lookups
    (`[2,1]`); opentype.js uses one.
  - The other 18 bundled fonts are identical on 10 sample strings.
  - Trigger: a soft hyphen or zero-width space pasted from Word or the web, a CSV record with
    one Greek or Cyrillic letter, or an emoji variation selector. The text, or that variable
    record, then changes spacing and letterforms. Preview equals output, so nothing is hidden.
- **Evidence:** REPRO and SOURCE.
  - `zz-15-route-twin.test.ts`: `StardosStencil-Regular.ttf "AVATAR": opentype w=33.149mm …
    | +U+00AD harfbuzz w=36.567mm … | diff 3.418mm`; `Pacifico-Regular.ttf "yours truly": …
    diff -2.570mm`; Roboto `diff 0.000mm`.
  - `zz-15-kern-twin.test.ts`: per-font glyph ids and advances for both engines.
  - Font tables were dumped from the TTFs (`kern.mjs`, `gpos.mjs`).
  - The only parity test (`text-shaping.test.ts` "preserves existing Latin kerning/ligatures")
    checks Roboto alone, which happens to agree.
- **Refuter:** CONFIRMED.
  - `needsTextShaping` matches `\p{Cf}`, so a soft hyphen or a zero-width space makes
    `prepareTextShaping` return a HarfBuzz shaper.
  - Repro through `renderTextGeometry`:
    - Stardos Stencil `AVATAR`: 33.149 mm. With a soft hyphen mid-word: 36.567 mm.
    - Stardos Stencil `WAVE TO`: 39.316 mm. With a zero-width space: 41.445 mm.
    - Pacifico `yours truly`: 48.570 mm on the Latin route, 46.000 mm on HarfBuzz.
    - Poppins control: identical on both routes.
  - The `HB_TINY` and `calt` source chain was not re-checked.
- **Fix direction:**
  - Shape all outline text with one engine. HarfBuzz is the reference, but it then needs a
    harfbuzzjs build without `HB_NO_OT_KERN` (or legacy `kern` applied separately).
  - Or at least make the opentype.js route apply `calt` and sum `kern` lookups.
  - Add a cross-engine parity test over every bundled font.

### P3-2 — Bold normalises glyph outlines even-odd, punching holes where script letters overlap; a failed offset silently drops every glyph

- **Where:**
  - `src/core/text/text-style.ts:83-94`: `emboldened` calls
    `offsetClosedPolylinesWithRoundJoins`.
  - That function runs `normalizeClosedPolylineTreeEvenOddChecked` (`kerf-offset.ts:64`), and
    `contoursOrEmpty` (`:52-56`) turns any engine error into `[]`. `emboldened` then keeps only
    the open polylines.
- **Anchor:**
  - Contract: ADR-286 Context says OpenType glyph interiors are non-zero, and overlap is how
    connected scripts join. ADR-319 item 1 says font contours retain non-zero winding. ADR-321
    says weld's non-zero union keeps joins solid.
  - L6: the error is swallowed. Contrast the `…Checked` twin at `kerf-offset.ts:43-48`.
- **Scenario:**
  1. Pacifico "Hello" at 20 mm with **Bold**.
  2. 204 sample points (0.05 mm grid, about 0.5 mm²) that the font fills by non-zero (overlap
     lenses at the letter joins) become holes after Bold.
  3. Weld, which runs after the style, keeps them, because the even-odd result is wound as a
     hole.
  4. Fill leaves unburnt islands at the joins. Cut-out lettering on a Line layer cuts a small
     loop at each join, and that loop falls out.
  5. Dancing Script, Great Vibes and Roboto show 0 such points at 20 mm: their lenses are
     thinner than the 0.6 mm bold offset.
  6. The canvas shows the holes, so the result is visible. The error path is latent.
- **Evidence:** REPRO. `zz-15-bold-overlap.test.ts`: `Pacifico-Regular.ttf "Hello" 20mm: …
  overlap-lens samples 3375; lens samples unfilled after Bold 204; after Weld 0; any ink sample
  unfilled after Bold 204`. Here "after Weld 0" means weld alone, without Bold. The
  `contoursOrEmpty` path is READ only.
- **Refuter:** CONFIRMED.
  - The refuter wrote its own non-zero winding sampler and ran it over the output of
    `styleTextRender` with Bold.
    - Pacifico `Hello` at 20 mm loses 204 ink samples (about 0.51 mm²).
    - Pacifico `mum` at 15 mm loses 145.
    - Great Vibes `Hello` loses 0.
  - Code reading confirms the even-odd normalisation (`kerf-offset.ts:64`). It also confirms
    that `contoursOrEmpty` swallows the error, which is latent.
- **Fix direction:**
  - Union the glyph contours non-zero (as `weldTextRender` does) before the offset, or offset
    with `FillRule.NonZero`.
  - Use the checked offset and surface its error instead of emptying the text.

### P3-3 — Bold and italic shift each variable record by a fraction of a millimetre (stale anchor frame)

- **Where:**
  - `src/io/gcode/variable-text-anchor.ts:56-59` adds `text.bounds.minX/minY` to the shift.
    Bold renders have bounds starting at −offset (`text-style.ts:93`), which makes the shift
    wrong by that offset.
  - Italic slants about the ink bottom (`text-style.ts:60-63`). That pivot moves with
    descenders, and the anchor is not slanted (same root as P2-1).
- **Anchor:** Contract: the same anchor contract as P2-1.
- **Scenario:**
  - Roboto 10 mm, left-aligned `{{csv:name}}`, Bold: every record lands 0.30 mm left of and
    0.30 mm above the unstyled control (`ref-off -0.476` against `-0.176`).
  - Italic: `Jay`, which has a descender, lands 0.93 mm right of `Al`/`Ann`
    (`+0.754` against `-0.176`).
  - Small, but a batch of tags does not line up.
- **Evidence:** REPRO (same test as P2-1): `bold left: Al … ref-off=-0.476`;
  `italic left: Al … ref-off=-0.176 … Jay … ref-off=0.754`.
- **Refuter:** CONFIRMED, using the refuter's own G-code repro (Poppins 8 mm, left-aligned).
  - Bold: every record lands a further 0.24 mm left of the design than the unstyled control
    (−0.464 against −0.224). That equals the 3% bold offset.
  - Italic: a record with a descender (`Christopher`, +0.469) lands 0.68 mm right of one
    without (`Bo`, −0.208).
- **Fix direction:**
  - Keep the anchor frame and the bounds frame identical: map the anchor with the style, and
    drop the `bounds.min` term or apply it to both sides.
  - Pivot italic on the first baseline, not the ink bottom.

### P3-4 — Distorting bend and path text map straight glyph edges as chords and cubic control points directly; outlines leave the bent shape by up to 0.39 mm

- **Where:**
  - `src/core/text/text-bend.ts:30-42,66-77`: `mapSegment` maps a `line` segment's end
    point only, and maps a cubic's control points through the non-linear arc map.
  - `src/core/text/text-on-path.ts:35-42,144-155` does the same along the guide.
  - Compile and canvas both read these `curves` (`compilation-polylines.ts:24`,
    `object-display.ts:265`), so preview and output agree. Both differ from the bend.
- **Anchor:**
  - Ground truth: the bend is defined as the point map `bendPointMapper`. A straight edge
    under that map is an arc, and a cubic's control points are not on the mapped curve.
  - Twin: the same render's `polylines`, which are mapped sample points, differ from its
    `curves`.
- **Scenario:**
  - 10 mm Roboto `OHMS` bent 180° (radius 8.8 mm): the crossbar and stem ends are cut as
    chords, up to **0.39 mm** inside the arc. At 90° the error is 0.20 mm; `KerfDesk Laser` at
    120° gives 0.10 mm.
  - Control-point mapping error is 0.02 mm normally and 0.46 mm in the extreme (30 mm `O`
    bent 180°).
  - Path text on a 30 mm-radius circle: 0.05 mm.
  - "Don't distort when bent" (rigid glyphs) avoids it.
- **Evidence:** REPRO. `zz-15-bend-twin.test.ts`: `OHMS 10mm bend 180: radius 8.82mm, max
  curve-vs-exact 0.0231mm, max straight-segment chord error 0.3897mm`;
  `O 30mm bend 180: … 0.4649mm`; `path text r=30 8mm: … 0.0536mm`.
- **Refuter:** CONFIRMED.
  - Code reading: `mapSegment` maps only a line's end point (`text-bend.ts:66-67`, and the
    same in `text-on-path.ts`). Compile flattens these curves (`compilation-polylines.ts`).
  - The refuter wrote its own sampler, applying the exact bend map to Roboto 10 mm text:
    - `OHMS` bent 180°: 0.382 mm off the chord.
    - `TEST` bent 120°: 0.451 mm.
    - `HELLO` bent 90°: 0.163 mm.
    - The bent render keeps every line segment unsplit.
  - Path text was not re-measured.
- **Fix direction:** before mapping, subdivide `line` segments and split cubics to a tolerance
  (0.025 mm, as compile uses), or map a flattened polyline and refit it.

## KNOWN (not re-raised)

- **02-P3-4** (remote text edit on Pro-bound artwork reports `ok`) touches
  `src/ui/remote-control/text-edit.ts`, which shares the text builders. It was not re-verified.
- No other ledger or open-PR item touches this scope. There are two open PRs, #1339 and #1280,
  and neither touches it.

## Refuted

The refuter refuted no finding. The auditor dropped these candidates:

- **Variable text shows its `{{…}}` template on the canvas, not the current value.** This is
  by design and matches LightBurn: its Variable Text window's "Test" shows the output, and the
  workspace keeps the codes. Barcodes differ by ADR-386 Amendment 2.
- **The process-wide `loadFont` cache is keyed by embedded-font key, so two documents could
  share stale bytes.** Keys are `embedded:${crypto.randomUUID()}`, and personal-artwork
  inserts re-key (`personal-artwork-model.ts:193-196`). A collision needs a hand-edited file.
- **`nextProjectVariableSequence` filters `layer.mode !== 'image'` while compile uses the
  effective (override) mode.** No UI path that sets an Image process on vector artwork was
  found, so this is not shown reachable.
- **Embedded fonts can collide in the worker token map.** Tokens are per ArrayBuffer identity,
  and every per-key buffer is stable.

## Verified clean

- **Glyph winding and counters.** The non-zero/even-odd probe over `oe8BÅéø@` in all 21
  bundled outline fonts found that every disagreement is an overlap the font fills (script
  joins, Tinos `Å` ring on the apex, Stardos kerned overlaps), never a counter. `o`, `e`, `8`,
  `B` and `ø` keep holes under non-zero. Text fill resolves non-zero per object in laser fill
  (`layer-fill.ts:231`), canvas (`object-display.ts:216`), bitmap assembly and V-carve. Convert
  to Path stamps `fillRule: 'nonzero'` (`vector-path-tools.ts:84-86`).
- **Composite accents.** The bounds of opentype.js composite glyphs match each glyf header
  bbox within 14 units/2048 (≤0.07 mm at 10 mm) across 10,000+ composites in all bundled fonts,
  so no component is misplaced. Decomposed `á ë` renders identically to precomposed.
- **Adversarial input (32 cases)** through `textToPolylines` and bend: no throw, all points
  finite. Missing glyphs are reported (lone surrogate, Arabic in Roboto, emoji).
  CR/TAB/BOM/soft hyphen/ZWSP are handled. Wrapping in a 0.0001 mm frame terminates and reports
  overflow. RTL and mixed bidi order is correct (existing oracle tests also pass).
- **Letter spacing and alignment.** opentype.js adds `letterSpacing·size` after every glyph,
  and `measureLineWidth` adds it between glyphs only, so ink and alignment agree. The HarfBuzz
  route counts tracking per cluster.
- **Fonts and licences.** Every bundled TTF's `name` table licence (ID 13/14) matches
  `font-registry.ts` and THIRD_PARTY_NOTICES: 19 OFL-1.1 and 2 Apache-2.0 (Roboto, Special
  Elite; Tinos is OFL in its 2026 build). Every `fsType` is 0 (installable). Reserved Font
  Names are declared and the fonts ship unmodified. All are compatible with paid closed-source
  distribution. A missing font is honest: projects embed fonts (ADR-164/628), an unknown key
  throws "not available. Relink it to edit." (`font-loader.ts:73-74`), personal artwork refuses
  to save without the font, and stored geometry keeps non-variable text output unchanged.
- **Worker races (ADR-643).** `claim()` supersedes before any await. A request whose font is
  still loading is never posted (`run` checks the ticket). An aborted render leaves a warm
  worker that the next claim retires, so only one request is ever in flight. Font tokens follow
  buffer identity. `held` is replaced only by a request that carries a file.
- **Variables.** `advanceVariableSequenceBy` equals repeated Next across ranges, stride and
  wrap (existing exhaustive test plus a review of the BigInt math). Copy offsets, the array
  stride (`copyStride`), one clock per batch (ADR-279 §3), the production manifest allocation,
  scope-filtered advance and the 1–20 serial width are correct. 89/89 tests in
  `src/core/variables` pass. A value longer than its width prints in full.
- **Scene invariants.** Object, group and copy ids are UUIDs. Copy closures remap the path-text
  guide and mask ids. Load rejects duplicate object, layer and group ids, dangling group
  members and dangling scoped-override ids (`project-scene-integrity-validator.ts`). Dangling
  object `operationIds` were not checked at load (area 13). `orderedArtworkObjects` ignores
  dangling `artworkOrder` ids. `removeLayer` prunes overrides, and dangling `operationIds` only
  unbind (nothing crashes). For ADR-319 pens, `materializedStrokeFields` composes the object
  linear map as M = Outer·Inner and matches `applyTransform` (scale → mirror → rotate). The CNC
  stroke outline is built in local coordinates and then transformed, so the pen scales with the
  object.
- **Twin: canvas and output** for ordinary text. Both flatten the same `curves`; draft and
  commit use the same builder; the worker result equals the in-thread one by test.

## Not verified

- Browser and packaged-desktop rendering: Chromium shaping of the same fonts was not compared;
  HarfBuzz in Node stands in.
- Remote text editing (area 01 and 02-P3-4) and `.lf2` font validation (area 13).
- SHX or other imported single-line formats; only the four bundled stroke fonts were checked.
- Whether any UI path can set an Image process on vector artwork (see Refuted, third item).
- Text box + Max width + centre alignment: the squeeze pivots on the ink left edge inside a
  frame. Seen in code, not measured.
- Performance of huge CJK fonts in the worker (ADR-643 measured it).
- Hardware: no material was cut or engraved.

```json
[
  {"id":"P2-1","severity":"P2","area":"scene-text","file":"src/core/text/text-style.ts","line":80,"anchor":"Contract: TextRenderResult.anchor 'same frame as paths' + variable-text-anchor.ts keeps a record where the operator placed it; Ground truth: LightBurn Max Width exists for variable text","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Max width squeezes paths but keeps the unsqueezed anchor, so centred/right variable records land off position (+7.5 mm short names, -19 mm long centred, -39 mm right) while the canvas shows the template centred"},
  {"id":"P3-1","severity":"P3","area":"scene-text","file":"src/core/text/text-shaping-required.ts","line":4,"anchor":"Twin: opentype.js Latin route vs HarfBuzz route; Ground truth: OpenType calt default-on, harfbuzzjs HB_TINY => HB_NO_OT_KERN, opentype.js single-lookup kerning","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Same Latin text lays out differently by route (Stardos +3.4 mm on AVATAR, Pacifico -2.6 mm and different glyphs, Pinyon 0.34 mm); one invisible soft hyphen switches the route"},
  {"id":"P3-2","severity":"P3","area":"scene-text","file":"src/core/text/text-style.ts","line":88,"anchor":"Contract: ADR-286/ADR-319 non-zero glyph interiors; L6 swallowed offset error (kerf-offset.ts contoursOrEmpty)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Bold offsets glyphs after even-odd normalisation, punching holes at overlapping script joins (Pacifico ~0.5 mm2 per word at 20 mm); an offset error silently drops all glyphs"},
  {"id":"P3-3","severity":"P3","area":"scene-text","file":"src/io/gcode/variable-text-anchor.ts","line":58,"anchor":"Contract: variable-text anchor keeps each record where the operator placed it","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Bold shifts every variable record 0.3 mm (bounds.min term); italic shifts records with descenders 0.93 mm relative to others"},
  {"id":"P3-4","severity":"P3","area":"scene-text","file":"src/core/text/text-bend.ts","line":66,"anchor":"Ground truth: bendPointMapper defines the bend; Twin: mapped polylines vs control-point-mapped curves","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Distorting bend and path text keep straight glyph edges as chords and map cubic control points directly; up to 0.39 mm off the bent shape (10 mm OHMS at 180 deg)"}
]
```
