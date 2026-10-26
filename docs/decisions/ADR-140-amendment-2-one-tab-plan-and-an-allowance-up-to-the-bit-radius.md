## ADR-140 Amendment 2 - One tab plan for roughing and finishing, and an allowance up to the bit radius (2026-10-23)

**Status:** Accepted; software-verified through unit tests, hardware qualification pending. |
**Date:** 2026-10-23

Amends ADR-140's "Holding tabs" item and its single full-depth finishing pass. ADR-140
Amendment 1 (finish-only features follow the depth ladder) stands. The Frame-first Start contract
(ADR-228, ADR-565) is unchanged: nothing here adds a guard or a refusal.

### Context

CNC audit v1, area F3 (`docs/audits/2026-10-23-cnc-v1/F3-cnc-profile-entry.md`), found two
defects in profile cuts with a finish allowance. An independent refuter and the audit coordinator
confirmed both.

**F3-P1-1 (P1): parts came free despite tabs.** Roughing offsets each part by the cutter radius
plus the allowance, finishing by the radius alone. Parts spaced between one cut width D and D plus
twice the allowance a therefore share one merged roughing ring but keep separate finishing rings.
`bucketFinishAllowanceParts` gives a merged ring to one part only, by nearest centre. ADR-140
placed each finishing pass's bridges by projecting that part's own roughing tabs, so the other
parts' finishing tabs were spaced on their own rings, and the merged ring's tabs sat wherever its
even spacing put them. Each pass's slot cut through the other pass's bridges. With a 1/8 in bit and
a 0.5 mm allowance, two 40 x 30 mm parts 3.3 to 4.1 mm apart came free on the merged ring's
Z-6.35 pass. A 3 x 2 grid of 30 mm squares 3.5 mm apart came off the sheet in one piece, an inside
shape with a 3.6 mm neck lost a slug, and a 0.1 mm allowance did the same. The same layouts
without an allowance, at 3.1, 4.3 and 5.2 mm, and a single part all stayed held. Nothing warned.

**F3-P2-1: an allowance of a bit diameter or more was never flagged.** ADR-140's single finishing
pass assumes the allowance is a thin skin. The finishing slot spans 0 to D from the wall and the
roughing slot spans a to a + D. From a = D/2 the finishing cutter has half its width or more in
stock at full depth. From a = D the two slots no longer meet, and the ring of stock between them is
left standing loose. A 4 mm allowance with a 1/8 in bit gave 99.8 % engagement over a 6.35 mm deep
pass and left a 152 mm² ring. The field accepts 0 to 10 mm, a loaded file has no upper limit, and
nothing warned.

### Decision

1. **The finishing rings carry the tab plan.** Each finishing ring is the toolpath the same layer
   cuts without an allowance, and it keeps exactly those bridges: persisted anchors (ADR-156) where
   the operator placed them, otherwise even spacing. It no longer projects roughing's tabs.
2. **Every roughing ring rises beside each of those bridges.** A roughing ring rises at the nearest
   point to every finishing bridge centre within one cut width of it, whichever part's ring that
   is (`roughingTabCentersBesideFinishTabs`, `src/core/cnc/finish-allowance-tabs.ts`). Each slot
   reaches half a cut width from its ring, so a roughing ring farther than one cut width from a
   bridge cannot cut into it. A merged ring thus rises beside the bridges of every part it goes
   round, and does not rise for a bridge on the far side of another part. A roughing ring with no
   bridge in reach keeps its persisted anchors or even spacing, as before; those tabs hold waste
   only.
3. **The allowance cut is at most the cutter radius.** `profileFinishAllowanceMm` returns the
   smaller of the layer's allowance and half the cut width at full depth (ADR-368 Amendment 2).
   The roughing slot then always overlaps the finishing slot, so no ring of stock is stranded.
4. **At the radius, the finishing pass follows the depth ladder.** When the allowance cut is the
   radius, every finishing path is cut at the layer's depth per pass, as ADR-140 Amendment 1 does
   for features roughing never reached. A Wall finishing recipe keeps its own depth per pass.
5. **Job Review names it.** `detectCncFinishAllowanceWarnings` warns for each output profile
   layer whose allowance is at least the bit's radius. The warning gives the allowance, the radius
   and bit, what is roughed instead and the finishing step depth, and adds the loose-ring hazard
   from one cut width up. It is advisory only.
6. The emitter revision advances to `cnc-finish-allowance-tabs-20261023-v26`.

### Consequences

- Every tabbed profile with an allowance emits different G-code. A single part's bridges move from
  roughing's even spacing to the finishing ring's, which is where the same layer puts them without
  an allowance. Roughing and finishing still bridge at the same places.
- In every layout tested, a layout held without an allowance is also held with one. A part
  entirely surrounded by other parts closer than two cut widths still has no bridge to the sheet,
  with or without an allowance. That was already so and this amendment does not change it.
- Allowances of the bit radius or more are roughed at the radius and finished in stepped passes,
  which is slower. The field keeps its 0 to 10 mm range because the radius depends on the bit;
  its tooltip says to stay under half the bit.
- Not addressed here (audit P3s): bridges on curves come out narrower than the requested width,
  a hole's finishing pass still runs after the outer roughing has cut its part free on tabs, the
  tab-height tooltip and tutorial wording, and a helical entry refused in a pocket it fits.

### Verification

`src/core/cnc/finish-allowance-tab-hold.test.ts` compiles each layout, emits GRBL G-code, and
checks it with `src/core/cnc/through-cut-hold.test-support.ts`, which does not use the planner.
That checker stamps every full-depth cutter position from the G-code on a 0.1 mm grid, counting a
touched cell as cut. It then flood-fills the bottom layer of stock from the sheet border and
reports every piece the fill cannot reach. With a 1/8 in bit, a 6.35 mm cut and four 6 mm tabs,
nothing is loose in these layouts:

- two 40 x 30 mm parts 3.3, 3.6 and 4.1 mm apart with a 0.5 mm allowance;
- two parts 3.25 mm apart with a 0.1 mm allowance;
- the 3 x 2 grid;
- the inside dumbbell with a 3.6 mm neck;
- the controls (no allowance, a 5.2 mm gap, a single part).

With tabs off the checker reports both parts loose, so it does detect loose stock. A single part
with a 4 mm allowance and no tabs leaves only the part loose, with no ring. Before the fix, seven
of the nine cases failed. The grid came off as one 5,487 mm² piece and the dumbbell lost a
157 mm² slug.

`src/core/cnc/finish-allowance-ladder.test.ts` checks the 4 mm allowance: roughing is 46.35 mm
across (one cut width out), and finishing is cut at Z-2, -4, -6 and -6.35. A 1.5 mm allowance
keeps one full-depth finishing pass. `src/ui/laser/cnc-finish-allowance-warnings.test.ts` covers
the warning. No hardware result is claimed.
