## ADR-269 Amendment 1 - Remote DXF import uses the import worker, and placing DXF blocks has a budget (2026-10-27)

**Status:** Accepted. | **Date:** 2026-10-27

### Context

Item 5 and item 6's Nested DXF amendment rest on one premise: "Every reachable DXF Blob already
uses the cancellable worker path". The desktop DXF routes (File > Import, drag and drop) parse in
the import worker with `parseDxfOffThread`. The remote `import_file` command (the phone's Import
sheet and MCP, ADR-584) is also a DXF entry point. It called `parseDxf` itself instead, so it did
not use the worker and did not follow the request's cancellation (rolling audit v4 H8-P1-1).

The same amendment kept "no new count limit" for composed MINSERT results. Expansion is limited
only per grid (10,000 instances) and by depth (8), so a chain of blocks multiplies the copies with
no limit on the total (July DXF audit P2-1, rolling audit v2 14 K-4). ADR-268 Amendment 1 bounds the
SVG `<use>` form of the same growth; DXF had no twin.

### Decision

1. **Remote DXF import uses the desktop's worker parse.** `import_file` with `application/dxf`
   makes the same request File > Import makes: `parseDxfOffThread` on a Blob of the decoded bytes,
   carrying the remote request's abort signal. When the request is cancelled, the worker request is
   cancelled as item 5 describes: a queued request is dropped and an active one ends its worker. The
   receipt is then `cancelled`.
   - If the import worker cannot be constructed, the command answers `unavailable`. It does not
     parse on the UI thread. The desktop's disclosed fallback stays for desktop imports only, as
     item 1 already does for the G-code Inspector.
   - The remote route now gives the parser the same bytes as the desktop. A DXF that is not valid
     UTF-8 now imports as it does from File > Import, where before it was refused.
2. **Placing DXF blocks has a budget; past it the import is refused.**
   - **What counts:** every point that placing a block creates counts, at any nesting. So does every
     entity read inside a placed block, so blocks that draw nothing still count. The count is taken
     before the copies are made.
   - **The limit:** a file may place 500,000 points this way, or one per byte of the file if that
     is more.
   - **The message:** past the budget the import stops with "DXF block references expand to more
     than N points, far more than the file holds; such files are refused because they expand
     without bound (for example, blocks of blocks of blocks). To import the drawing, explode its
     blocks in the CAD program first."
   - **Where it shows:** a desktop import shows it as the import's error toast. The remote command
     answers `invalid_arguments` and inserts nothing.
   - **Where it applies:** in the shared entity collector, so the worker parse and the text parser
     (the desktop fallback) both enforce it.
   - **Why the floor:** 500,000 points is 250,000 copies of a two-point line, the same number of
     copies as ADR-268 Amendment 1's floor of 250,000 instantiated elements. The pinned
     150,000-instance regression (300,000 points) stays below it and still imports in full.
   - **What it costs:** measured under Node on 2026-10-27 on a heavily loaded PC, where the pinned
     regression parsed in 8.7 s (3.3 s on an idle dev box, per its test):
     - 249,000 line copies, just under the floor: 23.4 s to parse and 1.3 s to unpack the packed
       result;
     - one copy over the floor: refused in 0.13 s.
     The parse runs in the import worker; only the unpack runs on the UI thread. A 499,000-copy
     drawing, near the 1,000,000 points first considered, took 43.5 s to parse and 3.7 s to unpack
     on the same PC, so the lower floor was chosen.
   - **Why the ratio:** writing a point takes at least ten bytes (`10`, x, `20`, y on four lines),
     so one placed point per byte is ten times what the file could draw without blocks. That is the
     same factor as ADR-268 Amendment 1's ten instantiated elements per element. A large drawing
     whose geometry sits in a block placed once stays within it.
   - **What does not count:** geometry drawn without blocks. The file itself bounds it, as
     ADR-268 item 4 says of the size advisories.

### What changes in ADR-269

In item 6's Nested DXF amendment, "no new count limit or geometry truncation is introduced" now
reads: placing blocks is bounded by this amendment's budget. Within it no geometry is truncated, and
the per-grid and depth diagnostics and the transform order are unchanged. "Every reachable DXF Blob
already uses the cancellable worker path" now also holds for the remote `import_file`.

### Consequences

- Every DXF import route, desktop and remote, parses in the import worker. Remote requests are
  queued with the desktop's imports and are cancelled the same way.
- A drawing that places more than the budget through its blocks is refused instead of imported,
  and the message names the remedy. Drawings that reuse blocks normally stay far below it. A
  drawing that places more than 500,000 points through blocks, and more than one per byte of its
  file, is refused until its blocks are exploded; for example, a sheet of a thousand copies of a
  500-point part block.
- This amendment does not change the remote import's notices (parser notes, bed fit).
- No controller, firmware, Frame/Start, G-code or physical-output behaviour changes.

### Verification

- Vitest:
  - `src/io/dxf/dxf-expansion-budget.test.ts`: the floor and the per-byte limit; a drawing of
    nested grids past the budget is refused with the message, before the outer copies exist; and
    entities of placed blocks that draw nothing are counted.
  - `src/ui/import/parse-dxf-blob.test.ts`: the worker's Blob parser refuses the same drawing.
  - `src/ui/remote-control/import-dxf-worker.test.ts`: the remote `import_file` DXF parses in the
    import worker, is cancelled with its request (the worker ends, nothing is inserted), answers
    `unavailable` without a worker, and inserts nothing past the budget.
  - The existing 150,000-instance regressions (`dxf-nested-insert.test.ts`,
    `parse-dxf-blob.test.ts`, `dxf-import-action.test.ts`) and the remote width tests still pass.
- NOT verified: real CAD exports near the budget, the production worker bundle in a browser or in
  Electron, or hardware.
