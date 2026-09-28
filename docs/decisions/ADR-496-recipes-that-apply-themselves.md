## ADR-496 - Recipes that apply themselves (2026-09-28)

**Status:** Accepted. | **Date:** 2026-09-28

Builds item 4 of the Rayforge comparison's build list, under the owner's direction of 2026-09-27 to
build everything Rayforge does better and make it better than theirs. Nothing changes until the
operator picks a job material. No new guard or refusal (ADR-228).

### Context

KerfDesk's material library already ranks presets against the machine (ADR-093, ADR-164): the
machine's own profile before its family, laser model and head, and calibrated before imported
before starter. It links a preset to an operation so Cut Settings and Job Review can say when the
library has changed it. But every preset was applied by hand, one operation at a time. The project
had no laser material at all; only CNC stock had one (ADR-112).

Rayforge applies a recipe to each new step from the workpiece's material and thickness. It matches
engraving recipes on thickness as strictly as cuts, and the recipe it applies is a copy with no
record of where it came from.

### Decision

1. **A job material.** `jobSetup.laserMaterial` (optional) holds the material's name, an optional
   thickness, and `autoApplyRecipes`. It is saved with the project and undoable. It is validated
   when set; absent means no material. There is no schema bump: an older build ignores it.
2. **Material Library → Job material.** The Material Library panel lists the library's materials.
   Once one is picked it shows that material's thicknesses, a **Take the best recipe** switch for
   new operations (on when a material is first picked), and **Apply to all operations**.
3. **Which recipe** (`core/material-library/auto-recipe.ts`). A recipe qualifies only for the same
   material, ignoring case, and the operation's own mode, so applying it never changes what the
   operation does. Unsupported recipes never qualify.
   - A cut (Line) takes only a recipe for the job's thickness, or one for any thickness. A cut
     recipe for another thickness would not cut through, or would burn more than it should.
   - An engraving or image prefers the job's thickness but takes another, because a surface
     process does not depend on the sheet.
   - A Line prefers a cut recipe over a score recipe; an Image prefers an image recipe over an
     engrave recipe.
   - Among those left, the existing ranking decides.
4. **When.** Every new laser operation takes it, as it is created:
   - import, re-import, text, drawn shapes, box panels, Design Studio and barcodes (after Make
     Default, like the CNC stock seeding);
   - image import and trace;
   - Add layer and Fill selection separately.
   Pasted and cloned operations keep the settings they carry. An operation with no matching recipe
   keeps its defaults.
5. **Linked, not copied.** The recipe is linked, as Link to layer does, so the operation names its
   preset. Refresh and the stale-preset notice work as for a hand-linked preset.
6. **A mode switch.** When an operation still exactly as its linked recipe left it is switched to
   another mode, it takes the best recipe for the new mode. So a cut switched to Fill does not
   engrave at cutting power. With no recipe for the new mode, it keeps its settings and loses the
   link, which no longer describes it. An operation edited since its recipe keeps its settings.
7. **Apply to all operations** links every output operation to its best recipe as one undo step.
   It reports how many changed, how many already had theirs, and names those with no recipe.

### Alternatives

- **Thickness ranges on presets, as Rayforge has.** Not now: it changes the library format, and
  exact thickness for cuts with any thickness for engravings covers the common case. A later
  decision can add ranges.
- **Apply by copying, as Rayforge does.** Rejected: a copied recipe cannot tell the operator it is
  stale or which preset it came from.
- **Apply to every operation whenever the material changes.** Rejected: operations the operator
  tuned by hand would change without being asked. The button does it on request.

### Consequences

- An operation made while the job has a material comes out with that material's settings. One made
  without a match keeps Make Default's settings as before.
- The job material lives in the project, so reopening a job restores it; a different library may
  not have a recipe for it, and then nothing is applied.
- CNC is unchanged; it keeps its stock material (ADR-112).

### Verification

- `auto-recipe.test.ts`:
  - The recipe per mode, and never another thickness for a cut.
  - Another thickness for an engraving.
  - Never another mode or material.
  - This machine's recipes first, then calibrated.
  - Cut before score, and no unsupported recipes.
  - The materials and thicknesses listed.
- `laser-recipe-seeding.test.ts`:
  - Nothing without a job material, and a linked recipe on a new shape.
  - Nothing with the switch off or no match, and an image recipe for a new image.
  - A mode switch on an untouched operation and on an edited one.
  - Apply to all as one undo step, and the operations named with no recipe.
  - The project round trip and undo, and a malformed file refused.
- `JobMaterialControls.test.tsx`: the controls set the material, thickness and switch, and the
  button reports what it did.
- Not tried on a machine: the recipes are the library's.
