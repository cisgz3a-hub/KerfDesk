## ADR-700 Amendment 3 - The PostScript import runs in the import worker, with every limit counted (2026-11-12)

**Status:** Accepted. Amends ADR-700 and its Amendment 2. Code quality audit C2 fix verification,
area E1. | **Date:** 2026-11-12

### Context

Amendment 2 bounded the reader with a step budget and a 5 s time limit, read on the window thread.
Verification found the bound weaker than it looked. Some single steps still did work that grew with the
file, so the clock could go unread for a long time, and painted or copied output was not capped. A
legitimate very large EPS also came close to the 5 s limit on an ordinary PC, where a slower PC would
refuse it as a file that "may loop forever".

### Decision

1. **The reader runs in the import worker.** `importPostscriptFile` sends the file to the import
   worker (`kind: 'postscript'`), as DXF, HPGL and G-code already are. The window stays responsive and
   Esc cancels. The window also stops waiting after `POSTSCRIPT_HANG_GUARD_MS` (45 s) and retires the
   worker, whatever the reader is doing, then says the file was still being read. Only when no worker
   can start does the reader run on the window thread, with the usual "processing on the main thread"
   advisory and its 5 s limit.
2. **Every operator pays for its work.** Each operator that walks, copies or builds something in
   proportion to a path, array, string or dictionary charges that size against the step budget
   (`ps-budget.ts`). The clock is therefore read in proportion to real work.
3. **Output has caps.** Painted points are capped at 4,000,000, so a large path can be both filled and
   stroked. Points copied by saving the graphics state are capped at 8,000,000 in total, and one
   dictionary at 100,000 entries, as arrays and strings already were.
4. **Each limit says which limit it is.** The step budget says the file needs more work than KerfDesk
   allows. The time limit names its seconds: 30 s in the worker, 5 s on the window thread. The painted
   and copied caps each have their own message.
5. **The SVG step stays bounded.** The worker returns SVG text whose size the painted-point cap bounds.
   The SVG import that follows keeps its own worker and limits; DOMParser cannot run in a worker
   (ADR-017), so that step stays where it is.

### Consequences

- An imported EPS, PS or AI file can no longer hold the window. In the worker, the window keeps
  painting and streaming, and the guard ends a stuck conversion.
- Large legitimate files get 30 s instead of 5 s. A 1,000,000-point path filled and then stroked
  imports in about a second.
- The worker loads the reader on its first PostScript request, so the boot bundle is unchanged.

### Verification

- `src/io/postscript/convert-postscript.test.ts` ("bounds every run in work and time"): six programs
  end with the step limit and nine size-bound programs end with a limit, all well inside 5 s. Also
  covered: the dictionary cap; a large fill-and-stroke still importing; and each time limit giving its
  own message under a scripted clock.
- `src/ui/app/postscript-import-action.test.ts`: the conversion goes through the import worker with no
  fallback. The guard retires a worker that never answers and imports nothing. The window-thread
  fallback says so.
