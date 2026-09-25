## ADR-381 - Material Test axes and placement, and presets from operations and burned cells (2026-09-24)

**Status:** Accepted. | **Date:** 2026-09-24

This extends ADR-044 (the Material Test generator) and ADR-093 (the material preset wizard). It
adds no Start guard. Every generated test is an ordinary scene that is compiled, framed and
reviewed like any other job (rule 7 / ADR-228).

### Context

1. **The Material Test tested one pair of settings.** ADR-044 varied speed by row and power by
   column, in Fill mode only. LightBurn's Material Test lets each axis test Power, Speed, Interval
   or Passes. Each axis has its own count and range, and the test has its own label and border
   settings, each of which can be turned off
   (https://docs.lightburnsoftware.com/2.1/Reference/MaterialTest/).
2. **Generate replaced the open design.** The command asked to save the project and then replaced
   the whole scene with the grid. To test a material for a job, the operator had to save the job,
   burn the test, then reopen the job.
3. **Tuned settings could not become a preset in one step.** ADR-093 made the wizard the only
   authoring path. It kept "New from current layer" as an optional prefill that was never built,
   and noted that turning a test swatch into a calibrated preset "can be reintroduced later
   through the wizard". LightBurn's library has **Create new from layer** and **Duplicate**
   (https://docs.lightburnsoftware.com/2.1/Reference/MaterialLibrary/).

### Decision

1. **Each Material Test axis varies power, speed, interval or passes.**
   - Each axis has a start, an end and a count of 1-20. The two axes must vary different settings,
     and interval needs Fill or Image mode. Settings neither axis varies are set once for every
     cell, and so is air assist.
   - The test burns in Line, Fill, or Image mode. Image mode is dithered (Floyd-Steinberg) or
     grayscale, and each image cell burns a five-band gray ramp, so one cell shows how the
     setting renders light and dark tones.
   - Every value is clamped to what the machine and compiler accept:
     - power 0-100 %;
     - speed at least 1 mm/min, with the profile ceiling disclosed and the burned speed labels
       showing the effective feed;
     - passes 1-100;
     - Fill interval 0.05-10 mm, Image interval 0.04-0.2 mm (the 5-25 lines/mm the raster
       compiler accepts).
     A passes axis holds one step per whole pass. The dialog shows the resulting cell count.
   - One axis becomes operations, one per value. The other axis rides on each cell: power as the
     cell's power scale, anything else as the cell's own operation settings (the schema-v5
     per-operation override). Rows are the operation axis unless rows vary power, so a test uses
     at most 20 operations plus labels and border.
   - With a power axis, each cell's power scale steps down from the axis maximum. No S word can
     exceed the profile's range.
   - Labels and border are each an optional operation of their own. The operator edits their
     settings after generating, where LightBurn edits them inside the dialog.
   - **Burn order:** lowest risk first on both axes, as ADR-044 did: fastest speed, lowest power,
     fewest passes, widest interval. LightBurn's page says the lowest interval runs first. A
     narrower interval puts more energy into the material, so KerfDesk starts from the widest.
   - The dialog's defaults are ADR-044's test: speed rows 3000 to 1000 and power columns 10 to 40,
     10 x 10, in Fill with labels on and border off. With them, the generator produces ADR-044's
     scene and G-code byte for byte.
2. **Generate adds the test to the open design, or opens it as a new project.** The operator
   chooses in the dialog, and the choice is remembered with the other settings. The stored draft
   moves to `materialTestDraft.v2`, and a pre-ADR-381 draft carries over.
   - **Add to the current design** (the default):
     - The test gets its own ids (`material-test-N-...`) and operation colors that the project does
       not use. It is grouped as "Material test N" and selected, and one undo removes it.
     - It is placed in the free bed area nearest the machine origin, 5 mm clear of existing
       artwork and of enabled no-go zones.
     - If nothing fits, it goes to the origin corner and a warning says why: no free space, or
       larger than the bed.
     - A test that would take the project past 256 operations or 10,000 objects is refused with
       that reason, and the dialog stays open.
     - The notice suggests **Selected artwork only** for burning just the test.
   - **Open as a new project:** Generate runs the ordinary save prompt, then opens the test by
     itself, at the position ADR-044 used.
   - **Tools → Material Test** no longer asks to save before the dialog opens.
   - As in LightBurn, where the burn lands on the machine follows the job's Start From placement.
3. **Presets start from an operation or a copy of a preset.**
   - **New preset from this operation...** in the artwork inspector opens the ADR-093 wizard
     prefilled with every recipe field of the settings the selected artwork burns with, its own
     overrides included. It is disabled for a mixed selection.
   - **New preset from these settings...** in Cut Settings does the same with the dialog's current
     values, applied or not.
   - The description starts as the operation's name. The operator names the material and
     thickness and steps through the wizard, and nothing is saved before **Save**. A wizard started
     from the canvas with no library open creates "<machine> Library".
   - Material presets hold laser settings only. For a CNC operation the same button saves a CNC
     feeds preset (feed, plunge, spindle, depth per pass, stepover).
   - Sub-layers are not captured, and the wizard says so. LightBurn's "Create new from layer"
     keeps them. Multi-step recipes are separate work.
   - **Duplicate...** in the Materials rail opens the wizard prefilled from the selected preset.
     The description ends in "(copy)", and provenance and qualification come along. Save adds a
     new entry and leaves the original unchanged. LightBurn copies the entry at once. Here the
     wizard opens first, because a duplicate is nearly always edited for another thickness or
     material.
4. **The best burned cell becomes a preset, or goes to an operation.**
   - Selecting a test shows **Pick the best cell...** in the inspector. The dialog draws the grid
     with the row and column values, each cell shaded by the energy it put into the material. The
     operator picks a cell by clicking it or with the arrow keys.
   - **New preset from this cell...** opens the wizard with the cell's burned settings, at the
     effective feed. The preset is marked calibrated, with provenance naming the test, the cell,
     the settings, the machine and the date, and with the machine's head metadata.
   - **Apply to operation** writes power, speed, passes and air assist into one of the design's
     operations. The interval is written too when that operation has the test's mode: Fill line
     interval, or Image lines/mm and dither. The operation keeps its mode and every setting the
     test did not vary. The test's own operations are not offered, and the change is one undo
     step.
   - Tests generated before this ADR use the same ids, so they are found too. LightBurn's Material
     Test stops at the burned grid.

### Consequences

- An operator can calibrate beside the job they are about to run, compare interval or passes as
  well as speed and power, and carry the winning cell into a preset or an operation without
  retyping.
- A second or third test in one project gets its own prefix, name and colors.
- With the defaults, the cells, their settings and their burn order are ADR-044's. Opened as a
  new project, the test is ADR-044's scene exactly. Added to a design, only its position and, when
  the design already uses them, its operation colors differ.
- The Interval Test and Scan Offset Test still replace the scene after the save prompt. The
  Material Test's interval axis covers the Interval Test's comparison inside the open design.
- LightBurn's Frequency and Q-pulse axes are not offered. KerfDesk's controllers have no such
  settings.

### Evidence and limits

- `material-test-grid.byte-identity.test.ts` keeps a frozen copy of the ADR-044 generator and
  compares the scene, the cells and the GRBL output for six option sets and the dialog defaults.
  `MaterialTestDialog.test.tsx` checks that an untouched dialog requests that same grid.
- `material-test-axes.test.ts` and `material-test-axes-grid.test.ts` pin the value lists, labels,
  clamps, risk order, the passes axis's repeated passes, per-cell overrides and power range. S
  words stay within `maxPowerS` for out-of-range input in every mode.
- `material-test-insertion.test.ts` pins placement around artwork and no-go zones, the fallback
  notice, unique ids and colors, and refusal at the project limits.
  `CalibrationGridDialogs.material.test.tsx` covers adding the test (with a project save and
  reload), opening it as a new project, cancelling the save prompt, and refusal.
- `material-test-cells.test.ts`, `MaterialTestResultsDialog.test.tsx`,
  `MaterialPresetWizard.seed.test.tsx` and `NewPresetFromOperation.test.tsx` pin reading tests
  back, cell to preset, applying a cell, and prefill through every wizard step for Line, Fill and
  Image.
- No hardware was operated. Whether the default placement margin, the image ramp and the energy
  shading read well on a real burn is unverified until a test is burned on scrap.
