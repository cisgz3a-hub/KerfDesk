## ADR-433 Amendment 1 - A CNC operation's narrow-feature threshold is the width its bit cuts at the operation's depth (2026-09-29)

**Status:** Accepted; software-verified through unit and compile tests, hardware qualification
pending. | **Date:** 2026-09-29

Amends ADR-433 decision 1, "against the operation's bit diameter", for CNC operations. The
findings stay Job Review advisories and the fresh-trace notice; nothing blocks Frame or Start
(ADR-228).

### Context

ADR-433 checks CNC pocket and profile operations against the bit's stored diameter. Since ADR-368
Amendment 3 the compiler lays out a ball nose, V-bit, engraving bit or tapered ball nose by the width
it cuts at the operation's full depth (`cncLayoutCutWidths(...).wallDiameterMm`,
`src/core/cnc/layout-cut-widths.ts`), which is narrower than the stored diameter for any depth short
of the full flute. The second CNC audit (`docs/audits/2026-09-29-cnc-audit-second-pass.md`,
P2-toolpath-4, reproduced) pocketed a 5 mm wide area 2 mm deep with a 90 degree V-bit stored as
6.35 mm: the program cut it at Z-1 and Z-2, while Job Review said it was "narrower than the 6.35 mm
bit ... the bit cannot enter it, so it stays uncut". A tapered ball nose stored as 6.25 mm cuts about
2.8 mm at 6 mm deep, so most detail work drew the same false warning.

### Decision

1. **The threshold is the width the compiler lays the bit out by**: `wallDiameterMm` for the layer's
   bit, depth and depth per pass. For a flat end mill, and for a bit whose shape cannot be modeled,
   that is the stored diameter as before.
2. **The message names the width and the depth** when they differ from the stored diameter, for
   example `1 area narrower than the 4 mm the bit (90° V-bit — 12.7 mm (1/2") cut) cuts at 2 mm
   deep`. The fresh-trace notice says the same.

### Consequences

- A V-bit, ball nose or tapered pocket or profile is warned about exactly the features the compiler
  leaves uncut, and no longer about features it cuts.
- The line-art edge selection of ADR-218 still reads the stored diameter, as the compiler does.

### Verification

`src/core/min-feature/project-check.test.ts` pockets a 5 mm and a 3 mm area 2 mm deep with a
90 degree V-bit (stored 12.7 mm): the threshold is 4 mm, the 5 mm area gets no finding and compiles
to passes, and the 3 mm area gets one and compiles to none. A flat end mill keeps its stored
diameter. `src/ui/laser/job-review/min-feature-warnings.test.ts` checks the wording. Without the
change the threshold stays 12.7 mm and the first test fails. No hardware result is claimed.
