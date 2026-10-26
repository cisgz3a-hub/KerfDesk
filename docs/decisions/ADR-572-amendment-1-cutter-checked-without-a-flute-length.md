## ADR-572 Amendment 1 - A bit with no flute length still has its cutter checked against fixtures (2026-10-26)

**Status:** Accepted. Amends ADR-572 (tool flute, shank, stickout and holder checks against fixture prisms). | **Date:** 2026-10-26
**Fixes:** CNC audit v1 finding F7-P2-1, and the review-gate part of F7-P3-1.

### Context

- The fixture check in `src/core/cnc/cnc-tool-reach.ts` modelled the cutter only when the bit had a flute length. The shank needs one too, so only a holder envelope was checked without it. No starter or catalog bit records a flute length, so for every shipped bit the clamp check never looked at the cutter.
- The audit placed Machine Setup's default clamp (20 × 20 mm, Z 0 to 15) where a G0 at the 3.81 mm safe Z crossed it, with the default 1/8" end mill. Job Review listed ten warnings and none named the clamp. The only related line read "Unknown flute length, stickout, shank diameter, holder envelope; assembly clearance is incomplete." It did not say that the cutter itself had gone unchecked. Typing a 12 mm flute length made "Cutter envelope intersects fixture Clamp 1 along the supplied path." appear.
- Fixtures (`project.cncSetup.fixtures`, G54 program coordinates) and no-go zones (`device.noGoZones`, machine XY) are separate data, so the no-go scan does not see a clamp.
- The review ran whenever any bit in the library carried assembly data. The starter V-bits carry a shank diameter, so every CNC job showed the reach lines, even with no fixtures and a bit with no reach data (F7-P3-1).

### Decision

1. **The cutter's width is always checked.** When the flute length is unknown, the cutter is a cylinder of its recorded diameter, rising from the tip past the highest fixture top. A fixture that the tip passes through or under is contact, and it is reported like any other contact: "Cutter envelope intersects fixture … along the supplied path." No dimension is invented. The cylinder needs only the diameter and the tip position, and the program fixes the tip.
   - **Why a column and not the cut depth.** A cylinder only as long as the cut misses a raised clamp arm. With a 3 mm cut, a tip at 3.81 mm passing under an arm at Z 10 to 15 would get no warning, yet every real assembly (flute, shank, collet) fills that space.
   - **When the column over-reports.** If the shank is at least as wide as the cutter, which is true of most router bits, the real tool fills the column and every contact is real. A wide cutter on a narrower shank, such as a surfacing bit or a large V-bit, can be reported touching a fixture that its shank would clear. That is the conservative side, which ADR-572 asks for. A recorded flute length replaces the column with the flute cylinder, as before.
2. **The unknown-geometry line says what was checked.** It names the unknown fields. When fixtures exist, it also says the cutter was checked only as that column, and names what each unchecked part needs. The shank needs a flute length, stickout and shank diameter. The holder needs a holder envelope: its segments are measured from the tip, so it does not need a flute length. For the default 1/8" end mill with a clamp:
   > Unknown flute length, stickout, shank diameter, holder envelope. Fixtures were checked against the cutter's 3.175 mm width only, as a column from its tip up past every fixture top. Not checked against fixtures: the shank (needs flute length, stickout, shank diameter) and the holder (needs a holder envelope). Assembly clearance is incomplete.

   With no fixtures, the line stays short: "Unknown …. Assembly clearance is incomplete."
3. **The review opens on the job's own bits.** Given the job's tool plan, the review runs only when there are fixtures or when a bit the job uses records reach data. Library entries the job does not use no longer open it. A job with no fixtures and no reach data on its bits gets no reach lines. Without a plan, the review still reads the whole library.
4. **No catalog flute lengths in this change.** Most catalog entries are `family-reference` nominal envelopes, whose flute length differs from product to product. Giving them one would invent machining data, which AGENTS.md forbids. An `exact-product` entry could carry a flute length later, with its vendor source.

### Consequences

- Every result stays advisory. Neither a missing description nor a predicted contact refuses Start or Save (ADR-572, ADR-565, PROJECT.md rule 21).
- A bit with unknown geometry still reports incomplete coverage (`complete: false`).
- A shank wider than the cutter, and any holder without an envelope, remain unchecked and are named as such.
- The other F7-P3-1 points stand: the method disclosures repeat on every review, and the unknown initial approach still marks path coverage incomplete.
