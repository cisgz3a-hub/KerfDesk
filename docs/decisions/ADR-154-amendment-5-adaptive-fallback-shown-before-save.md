## ADR-154 Amendment 5 - An adaptive pocket that falls back says so before Save, and names why (2026-11-05)

**Status:** Accepted; software-verified through verifier, compile, Preview and Job Review tests,
with G-code byte-identical to main. | **Date:** 2026-11-05

Amends ADR-154's disclosure rule (failures "block preflight instead of falling back silently") and
Amendment 3's verifier. It fixes the output-identical part of performance audit S8-P2-1 and the
first half of S8-P3-2 (`docs/audits/2026-11-02-performance-s1/S8-cnc-toolpaths.md`). Nothing here
changes a toolpath, adds a guard, a Start refusal or a Save refusal (ADR-228 rule 7, PROJECT.md
non-negotiable 21).

### Context

Amendment 3 recorded that one entry helix cannot open a pocket longer than it is wide: the first
ring past the helix disk is a full slot, and the verifier refuses it. The S8 refuter measured how
little "longer" means with a 6 mm end mill at the default engagement: 100 x 98 mm passes, 100 x 96
mm is refused, at every Radial engagement below the 50% cap. The refused layer is then cut as an
ordinary offset pocket, byte for byte the program Offset rings writes.

The operator learnt that only after the file was written:

- Preview showed the offset rings and said nothing.
- Job Review's operation line still read "adaptive pocket".
- Save wrote the file and then toasted "Offset pocket fallback: Adaptive verification simulated
  radial engagement above the configured limit. Adjust Radial engagement or choose another fill
  method." Start listed the same text as a warning. The advice cannot help.
- The verifier, having found the slot on the first ring, simulated every remaining ring before
  refusing: about 32 s of a 270 x 170 mm recess's Preview on an idle PC, and as long again on Save.

Stock-aware rest machining without a usable stock model (it clears the whole pocket with the
finishing bit) and a V-carve whose requested ramp entry was not applied took the same silent path:
the compile knew, Preview did not say.

### Decision

1. **The compile keeps what it cut instead.** The compiled job's CNC sidecar gains
   `strategyFallbacks`, one entry per operation that cuts another strategy than it asks for:
   `adaptive-offset` (adaptive refused by its planner or verifier) and `rest-full-pocket`
   (stock-aware rest's full offset-pocket fallback), each with its reason. It is absent when no
   operation fell back. Recovery keeps the entries for the layers a derived job still cuts.
2. **Preview, Job Review and the advisory say it in the same words**
   (`cnc-strategy-fallback-notice.ts`):
   - Preview shows a warning banner, "Operations cut differently", one line per operation, from the
     sidecar and from each V-carve's recorded entry fallback.
   - Job Review's operation line names the cut: "offset rings (adaptive fell back)" or "whole pocket
     (rest machining fell back)", instead of the strategy asked for.
   - The Save and Start advisory (`cnc-adaptive-clearing-invalid`, still advisory) carries the same
     notice. Its "Adjust Radial engagement" advice is dropped for fallbacks.
   - The layer panel's adaptive note says that a pocket one entry cannot open cuts offset rings, and
     that Preview and Job Review say when.
3. **The verifier names the opening.** A ring over the engagement limit that is the first ring of
   its sequence is refused as "Adaptive can't open this pocket from its entry", and the notice reads
   "Adaptive can't open this pocket from one entry, so it will cut offset rings instead (full-width
   first pass). Choose Offset rings to remove this notice." A later ring over the limit keeps the
   old reason.
4. **The verifier stops at the first ring over the limit.** Engagement is its first verdict, so the
   refusal is certain there. Every refused plan gets the same verdict as before; only the
   unread `maxSimulatedEngagementMm` of a refused plan and the reason's wording change.

### Consequences

- G-code is unchanged: the fallback programs keep main's hashes (40 x 20 mm `141a145c18dda7c8`,
  270 x 170 mm `891b673353fb41e8`), equal Offset rings byte for byte, and the accepted 40 x 40 mm
  pocket keeps `cc06816c27214137`.
- A refused rectangle verifies in a fraction of the time: the refuter's prototype measured x 0.017
  on 270 x 170 mm. Accepted pockets are as slow as before; stamping only the new crescent of each
  disk (S8-P3-2's other half) is still open.
- Save still writes first and notices after, as rule 7 asks; Preview and Job Review now show the
  same notice before it.
- Emit preflight still resolves the adaptive and rest operations again (S8-P3-1). It now reports
  the same notice the compile recorded.

### Open: opening long pockets is a maintainer decision

The refusal itself is Amendment 3's. Two ways to cut these pockets adaptively change toolpaths and
need their own amendment:

- **A centred entry.** `maximumClearancePoint` keeps the first of equally good grid points (strict
  `>`), so the helix lands at one end of a thin ridge. Taking the middle of the tied run opens
  rectangles up to about 4 mm out of square with a 6 mm bit, and moves the entry of accepted
  pockets whose leaf ring has ties.
- **An opening strategy for long pockets:** more entries along the medial line, or a slot at a
  reduced feed along it before the adaptive rings.
