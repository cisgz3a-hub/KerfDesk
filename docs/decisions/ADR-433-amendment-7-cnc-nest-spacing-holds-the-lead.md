## ADR-433 Amendment 7 - CNC nest spacing holds the profile's lead (2026-11-14)

**Status:** Accepted. | **Date:** 2026-11-14
**Fixes:** CNC audit v3 **N4-P3-2** (P3; `docs/audits/2026-11-13-cnc-v3/N4-transforms-tiling-reach.md`).

### Context

Amendment 4 started both nest dialogs at the widest outline-freeing bit plus 1 mm: 4.2 mm for
the 1/8" bit. An Outside profile's default arc lead (ADR-250) plunges in the waste, one lead
radius beyond the cut line. Below about three bit radii (4.76 mm), the lead on the edge facing
the next part would cut into that part. It is refused (ADR-250 Amendment 3), and the bit plunges
on the cut line instead. The audit measured that the lead was refused at 4.2 mm and kept from
4.8 mm.

### Decision

1. **The nest spacing adds the lead's reach** (`src/core/cnc/cnc-nest-spacing.ts`).
   - The reach is how far the lead plunges beyond the cut line:
     - a line lead: its length;
     - an arc lead: radius × (1 − cos sweep). That is one radius for the default quarter turn,
       and two for a half turn.
   - On-path cuts and layers with leads off add nothing.
   - The spacing is the widest bit plus its reach plus 1 mm, rounded up to 0.1 mm. That makes
     5.8 mm for the default 1/8" Outside layer.
2. **The Quick Nest warning names the lead.** It reads: "Closer than the 3.175 mm bit and its
   1.59 mm lead plus 1 mm: the bit that cuts one part out can cut into the next, or plunge on its
   cut line where no lead fits."

### Consequences

New nests of Outside parts start 1.6 mm further apart with the default 1/8" lead. Existing
layouts are not moved. A layer with leads off keeps the former spacing.

### Verification

`src/core/cnc/cnc-nest-spacing.test.ts` covers:
- the default lead (5.8 mm, with a 1.5875 mm reach);
- leads off (4.2 mm);
- a 5 mm line lead (9.2 mm);
- a half-turn arc (8.2 mm).

`src/ui/commands/QuickNestDialog.test.tsx` covers the warning's wording.
