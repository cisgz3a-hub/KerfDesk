## ADR-631 - Canvas text lays out in a text worker, reusing a parsed font only where that is provably identical

**Status:** Accepted; measured in Node on the maintainer's PC, Chromium covered by an e2e spec, packaged-desktop qualification pending. | **Date:** 2026-10-18

### Context

ADR-609 moved the costly vector commands into a worker and named text rendering as the next
candidate. Canvas text editing re-renders the text 60 ms after each pause in typing
(`useCanvasTextDraft`). Each render ran `renderTextGeometry` on the UI thread: HarfBuzz shaping
for complex scripts (`prepareTextShaping`), then `textToPolylines`, which parses the whole font
file with `opentype.parse` on every call. The text-frame preview and the variable-row preview
repeat that render, Save and Add Text render once more, and the missing-glyph check
(`useMissingCharacters`) parses the font again 300 ms after the characters change.

Measured in Node 25 on the maintainer's PC with an esbuild bundle of the real modules (median of
seven runs, moderate load), split into the parse and the rest:

| Font (file size) | Text | `opentype.parse` | Whole render on the UI thread |
| --- | --- | ---: | ---: |
| Roboto (0.5 MB) | Latin, 11 characters | 49 ms | 51 ms |
| Roboto | Latin, 450 characters | 23 ms | 121 ms |
| Noto Sans Arabic (0.2 MB) | Arabic, 13 characters | 9 ms | 10 ms |
| DengXian (16 MB, TrueType CJK) | CJK, 4 characters | 217 ms | 223 ms |
| DengXian | CJK, 450 characters | 210 ms | 370 ms |
| Noto Sans SC (18 MB, variable) | CJK, 4 characters | 404 ms | 399 ms |
| Noto Sans SC | CJK, 450 characters | 425 ms | 564 ms |

Parsing dominates for large fonts and short text, and layout for long text, so caching the
parse alone would leave long text blocking the UI thread.

Two further findings shaped the decision.

1. **A parsed opentype.js Font is not safe to reuse in general.** opentype.js 2.0.0 completes a
   Font lazily while it draws, and some of that state feeds later layouts:
   - `parseCFFCharstring` sets `glyph.advanceWidth` from the charstring width once a CFF glyph's
     outline is read, replacing the hmtx advance an earlier measurement used.
   - `VariationManager.getTransform` rewrites `glyph.advanceWidth` and `leftSideBearing` on every
     draw in a font with HVAR.
   - `SVGImageManager` decodes SVG colour glyphs asynchronously. Once decoded, `Glyph.getPath`
     returns an image layer, and `Font.getPath` leaves the glyph out of the outline.
   - `buildPath` skips a composite component that is already being resolved, so composite glyphs
     that include each other resolve differently depending on which was drawn first.
   A render that parses its own Font never meets any of this, because it lays out synchronously
   after a fresh parse. A reused Font can.
2. **Structured-cloning a render result costs about as much as computing it.** V8 rebuilds every
   object on the receiving thread. 450 characters of Roboto (50,604 points, 8,217 curve segments)
   took 83 ms to deserialize; Great Vibes (235,461 points) took 374 ms.

### Decision

1. **A text worker lays canvas text out.** `src/ui/text/text-render-worker.ts` runs the outline and
   stroke-font routes of `renderTextGeometry`, HarfBuzz included, and the missing-glyph check
   (`computeTextGeometry` in `text-geometry-compute.ts`, `text-render-worker-runtime.ts`). The
   canvas draft, the text-frame preview, the variable-row preview and the missing-glyph check
   each own one session for their lifetime (`useTextWorkerSession`). Save and Add Text each use a
   session of their own for their one render (`renderTextGeometryOffThread`). Only the fields the
   layout reads are posted, never whole dialog values with embedded fonts or guide paths.
2. **The font file crosses once per worker.** The UI thread still loads the file through the font
   loader and names it by buffer identity; the worker holds the last file it was sent, so later
   requests post only their settings. The file is copied rather than transferred, because the UI
   thread keeps using it.
3. **The worker reuses one parse only where reuse is provably identical.**
   `reusableOutlineFont` (`src/core/text/reusable-outline-font.ts`) reads the table directory and
   the glyf composites directly. A font is reusable only when it is plain TrueType (not WOFF or
   a collection), has no `CFF `, `CFF2`, `SVG `, `COLR` or `fvar` table, and its composite glyphs
   form no cycle and name only existing glyphs. Each excluded case is one of the hazards above,
   with COLR excluded conservatively. Every other font is parsed again for each request, as before.
   All bundled outline fonts qualify except Dancing Script, which is a variable font. HarfBuzz
   already kept one shaping font per file (`text-shaping.ts`), and the worker passes it the same
   held buffer every time.
4. **Results return packed.** `text-render-result-transfer.ts` sends each path's vertices and
   curve segments in transferred typed arrays, using the ADR-346 path packer. A path is packed
   only when it has exactly the shape the unpacker rebuilds (ending in `polylines` then
   `curves`, `{points, closed}`, `{start, segments, closed}`, line or cubic segments and `{x, y}`
   points, in that key order); any other path travels in the ordinary clone. The rebuilt result
   equals the in-thread one, key order and negative zero included.
5. **Newer work supersedes older work, as in ADR-609.** A request that arrives while the session's
   worker is busy terminates it and starts in a fresh worker. A caller that aborts (the draft does
   on every keystroke) only stops waiting: a render that finishes before the next request leaves
   an idle worker that keeps its parsed font. A request superseded while its font file was loading
   is never posted.
6. **No silent fallback onto the UI thread.** Only SSR and Vitest compute in process. In a real
   browser, a worker that cannot start or cannot be handed the work is `unavailable`. A module
   worker whose script cannot be fetched or evaluated still constructs and reports that later
   through `onerror`, so the worker posts `ready` once its script has run, and an error before
   that counts as `unavailable` too. The previews say so, while Save and Add Text, which the
   operator chose, lay the text out on the UI thread as they did before. Work that started and
   failed is reported and never rerun in thread. Every failure retires the worker. When the
   missing-glyph check's worker fails, the hint says the check did not run rather than reporting
   full coverage. A font that cannot load stays with the dialog's own font check, as before. The
   variable-row preview stops at the first `unavailable` row and shows that message on the rest,
   instead of starting and retiring a worker for every row.
7. **The Add/Edit Text dialog locks while it renders.** The UI thread now stays responsive while
   Add or Save renders, but the submission commits the values it started with. The dialog's
   fields therefore sit in a disabled fieldset until the render settles, as the canvas editor's
   fields already did while saving. Cancel stays available. Closing the dialog, by Cancel, Escape
   or a new project, aborts the render: its one-shot worker is terminated at once, and nothing
   after the layout (placement, styling, weld) runs. A second submission waits for the first.
8. **Output keeps the UI-thread path.** `renderTextGeometry` is unchanged and still serves
   variable text at output, DXF export, remote control and the registration jig. No G-code,
   Frame, Start, machine output or licence behaviour changes.
9. **Desktop.** The worker is a same-origin Vite module worker. HarfBuzz loads its WASM with
   `fetch(new URL('harfbuzz.wasm', import.meta.url))` and `WebAssembly.instantiateStreaming`, both
   allowed in the worker by the renderer CSP that main applies to every app:// response
   (`worker-src 'self' data: blob:`, `script-src 'self' 'wasm-unsafe-eval'`, `connect-src 'self'`).
   No CSP or Electron change is made.

### Consequences

UI-thread time per debounced edit, measured in one run on a lighter-loaded PC (Node, median of
seven). "After" is posting the request, receiving the reply with its buffers transferred, and
rebuilding the result. The receiving cost is an upper bound, since Node's `structuredClone`
serializes and deserializes on one thread.

| Font | Text | Before, UI thread | After, UI thread | After, first edit (font posted) | Worker, first render | Worker, later edits |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Roboto | Latin, 11 characters | 15.9 ms | 0.1 ms | 0.8 ms | 14.9 ms | 0.8 ms |
| Roboto | Latin, 450 characters | 39.1 ms | 0.9 ms | 1.8 ms | 46.3 ms | 25.0 ms |
| Great Vibes | Latin, 450 characters | 40.1 ms | 11.5 ms | 8.7 ms | 73.4 ms | 37.8 ms |
| Noto Sans Arabic | Arabic, 13 characters | 4.2 ms | 0.1 ms | 0.3 ms | 4.9 ms | 0.3 ms |
| DengXian | CJK, 4 characters | 98.0 ms | 0.1 ms | 7.0 ms | 88.5 ms | 0.4 ms |
| DengXian | CJK, 450 characters | 117.7 ms | 3.3 ms | 16.2 ms | 136.0 ms | 31.6 ms |
| Noto Sans SC (variable) | CJK, 4 characters | 157.4 ms | 0.1 ms | 6.9 ms | 158.2 ms | 149.0 ms |
| Noto Sans SC (variable) | CJK, 450 characters | 175.4 ms | 10.2 ms | 10.8 ms | 203.5 ms | 180.4 ms |

The first table's run, under heavier load, measured the same renders at two to three times these
"before" figures. What stays on the UI thread grows with the size of the result, not with parsing
or layout. The missing-glyph check, which parsed the whole font on the UI thread, now costs it
nothing beyond the request.

The worker columns are preview latency, not UI time. A reusable font's later edits skip the parse
(DengXian, 4 characters: 88 ms first, 0.4 ms after). A variable or otherwise excluded font is
parsed for every edit, in the worker, as it was on the UI thread before. While the operator keeps
typing faster than a render finishes, supersede restarts the work in a fresh worker, so a large
font's preview waits for a pause in typing rather than freezing the input.

Each session's worker holds its own copy of the font file and, for a reusable font, its parsed
font, until the owner unmounts. Bending, path placement and text styles still run on the UI
thread after the layout; a 90° bend of 450 Roboto characters measured 16 ms.

### Verification

- `src/ui/text/text-render-worker-runtime.test.ts` sends every case through the full worker round
  trip without a Worker: the request is structured-cloned, the runtime lays it out, and the
  packed reply is cloned with transfer and rebuilt. Each result must equal a direct, uncached
  `textToPolylines` call (with its own `prepareTextShaping`) by `toStrictEqual` and by
  `JSON.stringify`. Each outline font runs its cases in order and again in reverse, so later
  renders meet a font that has already drawn other text. Coverage: Roboto, Tinos, Great Vibes,
  Pacifico, Inconsolata, Anton, UnifrakturMaguntia and Stardos Stencil (each parsed exactly once),
  Dancing Script (parsed for every render), Arabic and mixed-direction text through HarfBuzz, a
  combining mark, missing glyphs, blank text, left, centred and right alignment, positive and
  negative letter spacing, line height, shrink-to-fit and overflowing text frames, and three
  single-line CNC fonts.
- `src/ui/text/text-worker-session.test.ts` builds bent, tracked, welded text through a session
  and through `renderTextGeometry` and requires identical objects. It covers the font file posted
  once, a font change, supersede terminating busy work, a request superseded while its font
  loaded, stale reply ids, an aborted caller leaving a warm worker, a newer request retiring a
  worker still busy with aborted work, release, failed layouts, crashed workers and unreadable
  or mismatched replies (never rerun in thread), an unpostable request, a worker whose script
  never loads, and a browser without workers (previews report it; explicit actions lay out in
  thread). `FontUsageHint.test.tsx` shows a failed missing-glyph check as unchecked and keeps
  font-load errors silent. `VariableRowsPreview.test.tsx` tries an unavailable worker once for a
  page of rows. `AddTextDialog.ownership.test.tsx` checks that every field is locked while the
  dialog renders, and that each way of closing it aborts the render.
- `src/core/text/reusable-outline-font.test.ts` covers the bundled and fixture fonts, each
  excluded table, WOFF, WOFF2, CFF and collection signatures, truncated files, composite records
  that run past their own glyph, and synthetic fonts with acyclic composites, two- and three-glyph cycles, a self-reference and a missing
  component.
- `src/ui/text/text-render-result-transfer.test.ts` checks the packed round trip and that paths of
  any other shape travel unchanged.
- `e2e/text-render-worker.spec.ts` runs the real module worker in Chromium. HarfBuzz starts inside
  the worker for Arabic, and Roboto, Great Vibes and a stroke font paragraph match the UI-thread
  render byte for byte, with the page still free at the next task. A newer request supersedes an
  older one.
- The desktop build (`vite build --mode desktop`) emits the worker as its own module chunk
  (`text-render-worker-isolated-*.js`), whose lazy HarfBuzz chunk loads the same hashed
  `harfbuzz-*.wasm` asset as the UI thread. That build, served over HTTP with the exact CSP and
  isolation headers `electron/main.ts` sets (the page reported `crossOriginIsolated`), drew
  canvas text typed in Latin and Greek. Posting a Greek request straight to the built worker
  returned a packed `rendered` reply, so HarfBuzz started inside the worker: 52 ms cold, then
  2 ms for the next edit on the held, parsed font. No CSP violation was reported. The packaged
  app over app:// was not run.
