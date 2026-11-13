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

### Amendment 1 - A Process switch inside Cut Settings reseeds as the inspector's does (2026-10-22)

Rolling audit 2026-10-21 finding 06-P2-3: §6 ran only when the edit held the mode and nothing else.
The inspector's Line / Fill / Image switch is such an edit; the Process select in Cut Settings
sent the whole form, so a cut switched to Fill there kept 90 % / 400 mm/min and its cut preset
link, and Job Review then named the cut preset on a Fill card.

1. **Eligibility is the operation before the edit.** An edit that switches the mode of an
   operation still exactly as its linked recipe left it takes the new mode's recipe, whatever
   else the edit holds (`sceneWithModeSwitchRecipe`). The edit's other fields are explicit and
   apply on top of the recipe, as if made after the switch. A mode-only edit behaves as before.
2. **Cut Settings shows the switch before Apply.** On the operation (not on artwork that owns its
   settings, which no recipe links), changing Process before any other field reloads the dialog
   with the operation as the switch alone would leave it: the same function the store runs.
   Apply with nothing else edited sends `{ mode }`, the inspector's own edit, so both give the
   same settings, link and undo step. Fields edited after the switch apply on top of the recipe.
3. **Edits made before the switch are kept.** If another field was already edited, the dialog
   does not reload, so nothing typed is lost; Apply writes the values it shows and, by point 1,
   links the new mode's preset, marked as edited.

Verification: `CutSettingsDialog.process-reseed.test.tsx` drives the inspector's More cut settings:
the switch shows and applies 35 % / 3000 mm/min linked to the Fill preset, equal to the inspector
switch and emitting `S350 F3000`; an edit after the switch stays on top of the recipe in one undo
step; edits before the switch keep the shown values; switching back restores the stored values.

### Amendment 2 - Fill Selection switches as the inspector does and keeps a tuned Fill (2026-11-13)

Tools audit T1, tool T06 (Fill Selection), findings T06-P1-1 and T06-P2-1.

- **T06-P1-1.** When the selected artwork owns its operation, Fill Selection switched that operation
  to Fill in place with a bare mode change, so §6 never ran. A drawn shape linked to the job
  material's cut recipe was hatched at the cut recipe's power, speed and passes (with real LightBurn
  libraries, 11.7× to 24.7× the energy of the engrave recipe) and stayed linked to the cut preset,
  with no warning before Start.
- **T06-P2-1.** When the selection shared a tuned Fill with unselected artwork, the separated copy
  was seeded as a new operation under §4 (defaults, then the best recipe), so its tuned settings
  were lost: 25 % / 3000 mm/min / 0.2 mm / 45° became 30 % / 1500 mm/min / 0.1 mm / 0°, about 4.8×
  the energy. The tool's own in-place path and Make unique both keep those settings.

1. **The in-place switch is §6's switch.** Fill Selection on an operation that only the selection
   uses switches it through `sceneWithModeSwitchRecipe`, as the inspector's Fill switch does: an
   operation still as its linked recipe left it takes the best Fill recipe and its link; an edited
   one keeps its settings.
2. **A Fill is copied, not reseeded.** When the selection burns through exactly one Fill operation
   (with no sub-layers), the separated operation copies that Fill's settings and recipe link under a
   new id and colour, as Make unique does. Otherwise it is created and seeded as §4 says.
3. Fill Selection still moves the selection to that one Fill operation alone, as its tooltip says.

Verification: `fill-selection-recipe.test.ts`: a drawn shape linked to the cut recipe becomes
35 % / 3000 mm/min / 1 pass linked to the engrave preset, equal to the inspector switch; an edited
cut keeps its power and speed; one of two artworks sharing a tuned Fill keeps 25 % / 3000 mm/min /
0.2 mm / 45°. Three of its four cases fail before this amendment.
