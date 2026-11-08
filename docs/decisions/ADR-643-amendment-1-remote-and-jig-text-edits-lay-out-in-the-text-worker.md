## ADR-643 Amendment 1 - Remote and jig text edits lay text out in the text worker (2026-11-05)

**Status:** Accepted. | **Date:** 2026-11-05

### Context

Decision 8 kept `renderTextGeometry` on the UI thread for output (variable text at output, DXF
export) and also for remote control and the registration jig. Remote control's `update_text` and
the jig's text edits are edits, not output: they lay out the text a person changed, through
`renderStyledText` (`src/ui/text/render-styled-text.ts`), and wait for it before committing.

Rolling audit v8 (N4-P3-2) and performance audit S1, area S7 (`S7-text.md`, KNOWN) measured that
layout on N4's frames in Node: 500 characters in a 150 × 30 mm frame 3.8–4.2 s, and 2,000
characters in a 150 × 60 mm frame 23–24 s. In the browser that is the window frozen for the whole
layout, Abort included, on the two routes where the operator may not be at the screen.

### Decision

1. `renderStyledText` lays its text out with `renderTextGeometryOffThread`, the one-shot text
   worker that Add and Save already use (decision 6): its own worker, released when it settles, and
   terminated when the caller's signal aborts.
2. Decision 6's fallback applies: where no worker can start, the layout runs on the UI thread as
   before, so remote and jig edits never fail for want of a worker.
3. Output keeps the UI-thread path, as decision 8 says: variable text at output and DXF export are
   unchanged.

### Consequences

- The outlines are the same: decision 4 packs the worker's result so that it equals the in-thread
  one, key order and negative zero included.
- A remote or jig edit of a long text frame no longer blocks the window. The edit still commits
  when the layout settles, so it takes as long as before (less with the shaping cache of perf audit
  S7-P3-1, #1590).
- Bending (`styledBentRender`) and Weld stay where they were: Weld already runs in its worker, and
  bending is S7-P2-3's area.

### Verification

- `src/ui/text/render-styled-text-worker.test.ts`: a styled edit is laid out through
  `renderTextGeometryOffThread` with the caller's signal, and never through the in-thread
  `renderTextGeometry` while a worker can run.
