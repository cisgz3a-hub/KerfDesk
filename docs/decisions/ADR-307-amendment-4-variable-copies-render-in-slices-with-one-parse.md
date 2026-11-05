## ADR-307 Amendment 4 - Variable copies render in slices, with one font parse per batch, and Cancel stops them

**Status:** Accepted. Fixes performance audit finding S7-P2-1 (P2)
(`docs/audits/2026-11-02-performance-s1/S7-text.md`). Builds on Amendment 1 (a request the project
cannot hold is refused before the first render) and ADR-643 decision 3 (a parsed font is reused only
where `reusableOutlineFont` proves the reuse identical). Burn, G-code, Frame, Start and licences are
unchanged. | **Date:** 2026-11-05

### Context

With **Advance variables per copy**, the Array dialog and **Edit Array** render every copy's
variable text before placing any (`prepareVariableArray`). Each record's render settles in
microtasks, so the whole batch was one task on the UI thread, and each render parsed the font file
again. 100 CSV name badges in a 60 × 20 mm shrink-to-fit frame froze the window for 7.3 to 8.3 s,
1,000 for 69 to 79 s at 2.2 GB, and 100 serial numbers for about 2 s. The status said "Preparing
variable copies…" once and never painted again. A click on Cancel 1 s in was handled 18.8 s later,
after all 1,000 copies had been added.

### Decision

1. **One parse per font for the batch.** Both dialogs render through
   `batchVariableTextRenderer()` (`src/ui/text/render-variable-text.ts`). It holds one parse of each
   font file for that batch where `reusableOutlineFont` allows it, as the text worker does, and
   parses any other font (Dancing Script, CFF, colour or variable fonts) for every record, as before.
   The parses are dropped with the batch. Every other caller of `renderVariableText`, output
   included, still parses for every render.
2. **The copies render in slices.** `prepareVariableArray` takes `yieldNow`, and both dialogs pass
   `variableCopySlices()` (`src/ui/state/variable-copy-slices.ts`): after a copy, once 50 ms have
   passed since the last turn, the event loop gets a turn (`setTimeout` 0). The longest block is
   then one slice plus one record.
3. **Progress shows, and Cancel stops the batch.** The status reads "Preparing variable copies… n of
   N". A Cancel click, a closed dialog or a changed design is seen at the next turn by the checks the
   loop already had (`isCurrent`), so the batch stops and adds no copies. Nothing is placed until
   every copy has rendered, as before.

### Consequences

- Each copy's geometry is the same as before: the held parse is the one ADR-643 proves identical
  (`render-variable-text-batch.test.ts` compares every record with `renderVariableText`, plain and
  in a shrink-to-fit frame, and counts one parse for Roboto and one per record for Dancing Script).
- Measured with `prepareVariableArray` itself, Node 25 on this PC under full load, before (origin/main
  `87f0ec583`) and after, 3 runs each, identical results:
  - 100 CSV name badges in a 60 × 20 mm shrink frame: one 16.0 to 27.1 s block before; 2.2 to 6.6 s in
    all after.
  - 1,000 serial numbers: one 115 to 133 s block before (about 0.9 GB); 3.5 to 9.6 s in all after
    (about 0.4 GB).
  - After, the first copy, which loads and parses the font, blocks 0.5 to 1.1 s on this loaded PC;
    every later block was 189 ms or less.
  - Cancel 1 s or 3 s into 1,000 serial numbers: before, ignored until all 1,000 were made; after,
    handled within 30 ms, with no copies added.
- A quiet-PC browser measurement under the audit's rules is still owed: the PC was shared by other
  sessions at 100% CPU.
- Guards: `variable-copy-slices.test.ts` (progress per copy; a Cancel queued as a task stops the
  batch after the first copy; without the yield the batch runs to the end in one task; the slice
  clock) and the dialog's own Cancel tests.
