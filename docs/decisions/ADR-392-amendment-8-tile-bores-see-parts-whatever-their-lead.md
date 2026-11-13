## ADR-392 Amendment 8 - Tile registration bores see a part whatever its lead, tabs or ramp (2026-11-14)

**Status:** Accepted. | **Date:** 2026-11-14
**Fixes:** CNC audit v3 verification **N7-P1-1** (P1; `docs/audits/2026-11-13-cnc-v3/N7-cnc-fix-verify.md`,
confirmed by its refuter). It is the gap left in the N4-P1-1 fix (Amendment 7, AC-5).

### Context

Amendment 7 Decision 1 kept bores "outside every closed cut loop". The placement read a loop only
from a pass marked `closed`, or from a ramped `path3d`. An Outside or Inside profile with the
default arc lead (ADR-250) compiles to one open `path3d`: the lead in, the ring, then the lead out.
Nothing marked it closed, so the part inside it was invisible. A bore needed only to keep its
distance from the cut line, so it could land anywhere inside the part. The refuter measured:

| Job | Bores in the part |
|---|---|
| 600 × 300 panel in 3 × 2 tiles | 11 of 14 |
| 520 × 260 tabletop | 6 of 8 |
| Ø320 disc | 5 of 8 |
| Frame | 2, in its rim |
| Coaster sheet | 1, 3.65 mm inside a coaster |

The tests behind Amendment 7 turned leads off, so they never met this case. The tiled save's
listing also said each bore was "clear of every part and cut", although only toolpaths and
closed passes were checked.

### Decision

1. **A ring is read from the path, not from a flag** (`ringsOf`,
   `src/core/cnc/tile-registration-placement.ts`).
   - A pass not marked closed counts as going round a ring when its path returns to a vertex it
     has already passed. The stretch in between (at least three vertices, with non-zero area) is
     the ring.
   - Every closed cut does this whatever it compiles to. A lead's arc ends on the ring's start
     vertex, and the lead-out leaves from that same vertex. A tabbed ring and a ramped ring both
     come back to their start.
   - An open cut never returns to a vertex. A zig-zag ramp's back-and-forth encloses no area.
   - So a lead-in profile, a tabbed profile and a ramped profile all keep their part, pocket or
     hole out of the search. No compile flag is trusted for this.
2. **The listing claims only what was checked.** The tiled save now says each bore is placed at
   least the cutter's radius, the hole's radius and 2 mm from every toolpath, outside every outline
   the toolpaths go round, and on the stock. It adds that a part drawn as an open outline is not
   known as a part, and asks the operator to check the bores against the parts and fixture.
   Preview's summary and the no-fit seam warning use the same terms.

### Consequences

- With default leads, seams that cross only a part now get no bore and a named warning, as the
  same jobs with leads off already did. Bores land in the waste or the stock margin, or nowhere.
- A part whose drawn outline is open is still not known as a part. The listing now says so.

### Verification

`src/core/cnc/tile-registration-lead-in.test.ts` compiles each job with the default arc lead. It
reads the written tile programs with the independent reader from Amendment 7. The cases are:

- a 600 × 300 panel in 3 × 2 tiles, tabs off and on;
- a Ø320 disc in 2 × 2 tiles;
- eight Ø90 coasters.

Every case drills at least one bore, and every bore lies at least the cutter's width plus the
hole's radius outside the part. All four fail on the code before this amendment. A wording test
checks that the listing no longer claims "clear of every part".
