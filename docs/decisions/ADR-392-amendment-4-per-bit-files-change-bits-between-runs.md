## ADR-392 Amendment 4 - Run G-code file treats the gap between per-bit files as a bit change (2026-10-27)

**Status:** Accepted. | **Date:** 2026-10-27
**Fixes:** rolling audit v4 H3-P2-2 (P2) and H3-P3-1 (P3), confirmed by an independent refuter.
The Frame-first contract (PROJECT.md non-negotiable 21, ADR-565) is unchanged: Frame's existing
Work Z requirement does the refusing, and no new Start gate is added.

### Context

Amendment 3 made the setup package write one file per bit by default, each headed
`; bit N of M: <bit>`; Amendment 2 does the same for a tile that needs several bits
(`; bit N of M for this tile: <bit>`). The bit change now falls between two Run G-code file runs,
and nothing treated it as one:

- Run G-code file's CNC Frame accepted the previous bit's Work Z, so the next bit could cut at the
  old bit's Z zero.
- Set origin, Reset origin and the XYZ corner probe stayed open between the files, so the later
  bits could cut on another X/Y zero.

Start's `M0` hold does both: it voids the previous bit's Work Z, waits for the new bit's zero and
refuses every X/Y origin change (ADR-375 Amendment 3).

Save as of a multi-bit job writes one file with an `M0` before each later bit and said nothing
about where those stops work (H3-P3-1). The setup sheet's single-file mode says so in a note.

### Decision

1. **The header is read from the file as opened** (`src/core/external-program/kerfdesk-bit-file.ts`),
   since the bytes an external run sends carry no comments, and travels with the run to `startJob`.
2. **A bit file's Work Z ends with its run.** The store records the per-bit file an external run
   streams. Where its streamer is released (completed, stopped or failed), Work Z goes and its
   reference epoch moves on, as at a hold's entry (`src/ui/state/bit-file-sequence.ts`). The next
   file's CNC Frame then offers Zero Z or refuses, as it does with no Work Z. The last file's
   Work Z goes too: every file's header says to zero Z before it runs.
3. **The X/Y origin holds between the files.** While later bits of the set remain, every X/Y
   origin writer the hold refuses is refused too (`toolChangeXyOriginBlockMessage`), naming the
   bit that ran. Zero Z and the Z probe stay open.
4. **The set ends** when its last file has run, when the controller session ends, or when the
   operator chooses **End bit sequence** in the machine panel's notice, which says which bit ran
   and that the next one needs its zero. A file with no bit header leaves Work Z and the X/Y
   origin as before.
5. **Save as notes M0 bit changes.** Save as of a CNC job with more than one bit adds an info note:
   change bits at those stops only by starting the job from the project or in a sender that holds
   at the `M0` itself, and for Run G-code file save one file per bit from the setup sheet.

### Consequences

- An operator running a package's files can no longer frame bit 2 on bit 1's zero or move the X/Y
  zero between bits without first ending the set.
- Regression tests: `kerfdesk-bit-file.test.ts`, `external-run-bit-files.simulator.test.ts` (real
  store, external Frame and Start, GRBL simulator) and `CncSetupDocumentExport.test.tsx` (Save as
  note).
- The Console is not held: a typed `G92 X`/`G10 L20 X` is the operator's own command, and it already
  drops the X/Y origin record.
- Not hardware-tested.
