## ADR-481 Amendment 1 - An adaptive pocket's Entry & travel summary names its helix (2026-09-28)

**Status:** Accepted; software-verified through a layer-card component test and a compile check;
compiled output unchanged. | **Date:** 2026-09-28

Amends decision 7, which has each closed CNC section name its state, gives Entry & travel as
`Climb · Plunge` and names **Circular ramp** when it is enabled. The Frame-first Start contract
(ADR-228, PROJECT.md non-negotiable 21) is unchanged: nothing here adds a guard, a refusal or a
warning, and no motion, G-code or Job Review text changes.

### Context

The summary built its entry from the stored Ramp entry angle: `Ramp 5°` when one is set, `Plunge`
otherwise. It already left the circular ramp out for adaptive pockets, but not the angle. Adaptive
clearing never reads it. `passesForCncLayerWithEvidence` returns the passes
`specializedPassesForLayer` plans before `applyRampEntry` runs. Roughing enters each depth on the
planner's own helix (`HELIX_ANGLE_DEG` in `adaptive-pocket-operation.ts`), and the finishing rings
then plunge onto the level that roughing has just cleared. So an adaptive pocket read
`Climb · Ramp 5°` with a 5 degree angle stored and `Climb · Plunge` without one, and neither is how
its bit enters the stock. ADR-273 Amendment 2 (PR #987) found this while taking the same claim out
of the compiled groups and qualifying it in Job Review (`ramp entry 5° (not used by adaptive
clearing)`).

The angle still does something on such an operation. Relief roughing reads it on every cut type
(ADR-424), so it ramps the roughing of any relief the operation carries, and without it that
roughing plunges.

### Decision

1. **An adaptive pocket names its helix.** Entry & travel reads `Adaptive helix` after the cut
   direction, for example `Climb · Adaptive helix`, with or without a stored angle.
2. **On an operation that carries reliefs, the angle is named as theirs:**
   `Climb · Adaptive helix · Relief ramp 5°`, or `Climb · Adaptive helix · Relief plunge` with no
   angle. The card already knows whether the operation carries reliefs
   (`useLayerHasReliefObjects`), and `CncEntryFields` now takes that as a required prop.
3. **Everything else is unchanged.** Offset and raster pockets, a helical pocket (`Circular
   ramp`), profiles, engraves and V-carves keep their summaries, with or without reliefs. On an
   adaptive pocket the Ramp entry row stays and keeps its value, and nothing clears the stored
   angle.

### Alternatives rejected

- **`Helix 3°`.** The planner rounds each depth up to whole turns, so the helix descends at 3
  degrees at most and less when a depth is not a whole number of turns. The angle is not an
  operator setting either. The summary names the entry, as `Circular ramp` does.
- **`Adaptive entry`** (Codex PR #981). It is true, but it does not say how the bit enters.
- **Qualifying the ramp on every adaptive pocket** (`Ramp 5° unused`). Without reliefs the angle
  changes nothing, and the summary would still lead with a ramp that is never cut.
- **Hiding the Ramp entry row on adaptive pockets.** It still sets the relief ramp (ADR-424), as
  ADR-273 Amendment 2 notes.

### Consequences

- The closed summary no longer claims a ramp or a plunge that an adaptive pocket never cuts, and
  it matches Job Review's `(not used by adaptive clearing)` once ADR-273 Amendment 2 lands.
- Found, not changed: the Ramp entry field's tooltip still says it descends along the path at this
  angle on an adaptive pocket. PR #981 rewrites that tooltip.

### Verification

- `CncEntryFields.test.tsx` renders the whole layer card. An adaptive pocket reads
  `Climb · Adaptive helix` with a 5 degree angle stored, while the row still shows 5, and without
  one. With a relief it reads `… · Relief ramp 5°`, or `… · Relief plunge` with no angle. Switching
  Fill method from Offset rings to Adaptive clearing and back changes `Climb · Ramp 5°` to
  `Climb · Adaptive helix` and back, and keeps the angle. Seven other operations keep their
  summaries. Against main's component (0bbb5ba78) the four adaptive cases fail (`Climb · Ramp 5°`,
  and `Climb · Plunge` with no angle). The seven others and the compile check below pass on both.
- The same file compiles a 20 mm adaptive pocket, 3 mm deep in 1.5 mm steps, with and without a
  5 degree angle. The passes are identical, and roughing starts on a helix at both depths.
- No hardware run was made. Motion is unchanged.
