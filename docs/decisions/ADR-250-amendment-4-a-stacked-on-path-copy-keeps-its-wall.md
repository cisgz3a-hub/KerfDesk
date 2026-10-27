## ADR-250 Amendment 4 - A stacked On path copy keeps its part's wall (2026-10-27)

**Status:** Accepted; software-verified through emitted G-code and an independent cutter-disk
model, hardware qualification pending. | **Date:** 2026-10-27

This amends ADR-250 Amendment 3 Decision 1. It changes emitted motion in one case only: a lead
that would reach an On path part drawn as two or more exact copies now falls back to the straight
plunge it already took beside one copy. What each operation cuts is unchanged: an On path
operation still cuts every copy (ADR-359 Amendment 3 Decision 3). The Frame-first Start contract
(ADR-565, PROJECT.md non-negotiable 21) is unchanged, and every warning involved stays advisory.

### Context

Rolling audit v3, finding G5-P1-1 (`docs/audits/2026-10-27-rolling-v3/G5-cnc-delta.md`), was
confirmed by the auditor, a refuter with its own G-code walker and disk check, and the coordinator,
on main `9a2bf6b13` and again on `a59f74ff9`.

Amendment 3 Decision 1 builds every operation's kept walls with
`normalizeClosedPolylineTreeEvenOddChecked`, "normalised even-odd as the offset normalises them".
That holds for Outside and Inside paths, whose kerf offset fills the outlines even-odd. An On path
cut does not fill anything: it follows each outline. ADR-359 Amendment 3 merges exact copies only
on the cut types that fill (`cutTypeFillsClosedOutlines`), so an On path operation's copies reach
the wall model unmerged. Filled even-odd, two identical rings enclose nothing, so the part had no
wall at all. Copies come from Duplicate without moving, a second import, a DXF with doubled
entities, a reversed copy, or a deliberate spring pass. On path is the default CNC cut type
(`machine.ts`, ADR-256).

Measured through `emitGcode`, with a 40 x 30 mm Outside part A beside a 20 x 10 mm On path part B,
3 mm deep at 1.5 mm per pass, judged against B's line inset by B's cutter radius:

- 1/8" bits, 2.5 mm gap, two copies of B: A kept its arc lead (`G0 X38.413 Y383.175`) and the
  cutter reached 0.675 mm into B at `G1 Z-1.500` and `G1 Z-3.000`. Preflight reported nothing. One
  copy drops the lead and says so (`cnc-profile-lead-plunge`). Three copies (an odd count) brought
  the wall back.
- A on a 1/4" bit, B on a 1/8" bit, two copies: at a 5 mm gap A's lead reached 2.94 mm into B; at
  a 4 mm gap A's own profile reached 0.76 mm into B and the ADR-433 Amendment 3 line one copy
  gives (`cnc-profile-cuts-kept-part`) was gone too, because that check reads the same walls.
- The same with the copy reversed and starting at another vertex, and with one path listing the
  ring twice.

### Decision

1. **An On path operation's walls count each stacked copy once.** `profileLeadKeptWalls`
   (`profile-lead-kept-walls.ts`) drops exact closed copies before the even-odd normalisation for
   every cut type that does not fill its outlines, which among the profile types is On path. It
   reuses ADR-359 Amendment 3's matcher (`withoutStackedClosedCopies` in
   `cnc-stacked-copies.ts`): the same ring on the 0.001 mm grid the emitter and the boolean engine
   round to, from any start and either way round. The fill rule does not matter here, because
   any two coincident rings cancel even-odd.
2. **Outside and Inside paths are unchanged.** Their copies were already merged when their
   contours were collected, so their walls keep reading exactly the contours their kerf offset
   reads. A wall is never invented where the offset cuts nothing.
3. **Both readers follow.** The lead check (Amendment 3) and the cross-operation check (ADR-433
   Amendment 3) read these walls, so both see the copied part again.
4. `EMITTER_REVISION` advances to `cnc-on-path-copy-walls-20261027-v34`, carrying forward
   `cnc-artwork-anchor-20261027-v33` (ADR-327 Amendment 1).

Not chosen:

- **The narrow-feature check's `StackedOutlines`** (`min-feature/stacked-outlines.ts`). It
  compares raw coordinates. Two rings a fraction of 0.001 mm apart still cancel in the boolean
  engine, which rounds to three decimals, so the CNC matcher on that grid is the one that
  matches the cancellation.
- **Merging On path copies in the cut.** ADR-359 Amendment 3 keeps them deliberately as a spring
  pass.
- **Modelling an On path cut as walls of every face its lines bound.** Overlapping (not identical)
  On path outlines are still read even-odd. That is outside this finding and needs its own
  evidence.

### Consequences

- Beside a copied On path part, a lead is checked against that part as it is beside one copy, at
  any copy count. Job Review shows the same lines for one, two or three copies.
- Limits, found and not changed:
  - Near copies (more than 0.001 mm apart) still cancel each other almost entirely, leaving no
    useful wall. ADR-359 Amendment 3 lists near copies as a follow-up.
  - Engrave, drill, pocket, V-carve and the rest are still not walls (Amendment 3 Consequences).

### Verification

- `emit-gcode-cnc-lead-stacked-on-path.test.ts` compiles through `emitGcode` and judges each bit's
  section of the program at that bit's radius with `cnc-cutter-clearance.test-support.ts`, against
  A's outline and B's line inset by B's radius. It covers two copies at 2.5 and 3 mm (1/8"), a
  reversed copy, one path listing the ring twice, three copies, the 1/4" lead at 5 mm, and the 1/4"
  profile at 4 mm (0.7625 mm by the independent model, and named). Each compares the preflight lines
  with the one-copy layout, and one checks that every copy is still cut. On main, the five lead and
  reach cases fail with the audit's figures (-0.675 mm, -2.9375 mm, and the lead plunging inside
  B at 4 mm).
- `profile-lead-kept-walls.test.ts` pins the wall model: two, three, reversed and sub-0.001 mm
  copies give one wall; a hole is kept; an Outside pair is left as the offset reads it.
- `cnc-part-size-review.test.ts` runs the real Start path (`prepareCurrentStartJob`) and Job
  Review model with a part 2.5 mm off each side of a plate, one and two copies each, and expects
  the same Job Review warnings, including the plate's lead-plunge line.
- No hardware run was made. The change is verified in emitted G-code only.
