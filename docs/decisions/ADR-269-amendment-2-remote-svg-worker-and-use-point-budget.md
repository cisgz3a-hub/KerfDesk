## ADR-269 Amendment 2 - Remote SVG import uses the document import worker, and the SVG `<use>` budget counts points (2026-10-27)

**Status:** Accepted. | **Date:** 2026-10-27

### Context

Amendment 1 moved the remote DXF import onto the desktop's worker parse. The remote SVG entry points
did not move with it. These are `add_svg`, `import_file` with `image/svg+xml`, and `add_svg` inside
`apply_edits` (ADR-584), which the phone's Import sheet and MCP clients use. They called `parseSvg`
themselves. The desktop File > Import passes the file to `parseSvgOffThread` in the document import
worker (item 7), which follows the import's cancellation (item 5).

ADR-268 Amendment 1 bounds `<use>` expansion by counting the elements it instantiates. Its DXF twin,
Amendment 1's block budget, counts the points that placing blocks creates. An instantiated `<path>`
can carry many points, so counting elements does not bound the points that `<use>` copies place.

### Decision

1. **Remote SVG import uses the desktop's worker parse.** All three remote SVG entry points make the
   request File > Import makes: `parseSvgOffThread` on a Blob of the SVG, carrying the remote
   request's abort signal.
   - **Cancellation:** a cancelled request cancels the worker request as item 5 describes, and the
     receipt is `cancelled`. This holds inside `apply_edits` as well, where each `add_svg` item is
     prepared before the batch is applied.
   - **No worker:** if the document import worker cannot be constructed, the command answers
     `unavailable`, as the remote DXF import does. The desktop's disclosed fallback stays for
     desktop imports only.
   - **The worker's sanitiser:** the worker's sanitiser and geometry walk (item 7) now prepare remote
     SVG, as they prepare File > Import's.
   - **The same bytes:** `import_file` passes the file's bytes, not text decoded on the way. So an
     SVG that is not valid UTF-8 now imports as it does from File > Import, where before it was
     refused.
2. **The SVG `<use>` budget also counts points.**
   - **What counts:** every point that an element instantiated through `<use>` places, at any
     nesting. It is counted as each instantiated element's geometry is read, in the import walk and
     in the object-bounding-box walk that `clipPathUnits="objectBoundingBox"` uses. ADR-268
     Amendment 1's element count stays as it is, so elements that draw nothing still count.
   - **The limit:** a file may place 500,000 points through `<use>`, or one per character of its
     markup (attribute values and text) if that is more. This is Amendment 1's limit for DXF blocks.
   - **The message:** past the budget the import stops with "SVG `<use>` references place more than
     N points, far more than the file holds; such files are refused because they expand without
     bound (for example, uses of uses of uses). To import the drawing, convert its clones to paths
     in the drawing program first."
   - **Where it shows:** a desktop import shows it as the import's error toast. A remote command
     inserts nothing and answers as it does for any SVG the parser refuses.
   - **Where it applies:** in the shared geometry walk, so the worker parse and the main-thread
     parser (the desktop fallback, library entries and page artwork) all enforce it.
   - **Why the ratio:** writing a point in path data takes at least three characters (`1 1`), so one
     placed point per character of markup is several times what the file could draw without
     `<use>`.
   - **What does not count:** geometry the file draws without `<use>`. The file itself bounds it,
     as ADR-268 item 4 says of the size advisories, which stay advisory.

### What changes in earlier decisions

- **ADR-269:** item 7's worker route for file-backed SVG now also serves the remote SVG commands.
  Amendment 1's Consequence that every DXF import route parses in the import worker now holds for
  SVG as well, in the document import worker.
- **ADR-584:** in its table, `add_svg` and the SVG case of `import_file` now read "`parseSvgOffThread`
  (the document import worker, which sanitises scripts, foreign content and external references)"
  in place of `parseSvg` and "the ordinary SVG parser".
- **ADR-268 Amendment 1:** its element budget is joined by this amendment's point budget. Its floor,
  ratio and message are unchanged.

### Consequences

- Every SVG and DXF import route, desktop and remote, parses in an import worker. Remote requests
  are queued with the desktop's imports and are cancelled the same way.
- An SVG that places more than the budget through `<use>` is refused instead of imported, on every
  route, and the message names the remedy. Ordinary icons, glyph text and repeated parts stay
  below it.
  For example, a thousand copies of a 600-point outline place 600,000 points, which is past the
  floor unless the file's own markup holds more than 600,000 characters, so such a file must have
  its clones converted to paths first.
- This amendment does not change the remote import's notices (parser notes, bed fit) or its sizing.
- No controller, firmware, Frame/Start, G-code or physical-output behaviour changes.

### Verification

- Vitest:
  - `src/io/svg/svg-use-expansion.test.ts`: the point floor equals the DXF block budget's floor,
    points placed through `<use>` are refused past the floor with the message, the file's own
    points are not counted, and the limit grows with the file's markup.
  - `src/io/svg/parse-svg-structure.test.ts`: through both the main-thread parser and the worker's
    streamed parser, a few `<use>` copies of a 1,000-point path import, and 501 copies are refused
    with the message.
  - `src/ui/remote-control/import-svg-worker.test.ts`: `add_svg`, `import_file` SVG and an
    `add_svg` inside `apply_edits` parse in the document import worker and are cancelled with their
    request (the worker ends, nothing is inserted). `add_svg` answers `unavailable` without a
    worker and inserts nothing past the point budget.
  - The existing remote import tests (`design-control`, `import-asset-ownership`,
    `import-desktop-parity`, `import-width`, `import-dxf-worker`) now run with the import workers'
    jsdom transport, `src/ui/import/import-workers.test-support.ts`, which runs the real DXF and
    SVG worker parsers. They still pass.
- NOT verified: real drawing-program exports near the budget, the production worker bundle in a
  browser or in Electron, or hardware.
