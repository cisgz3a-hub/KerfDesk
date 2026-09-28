## ADR-503 - Swappable laser modules and published rotary presets (2026-09-28)

**Status:** Accepted. | **Date:** 2026-09-28

Builds item 6 of the Rayforge comparison's build list, under the owner's direction of 2026-09-27 to
build everything Rayforge does better and make it better than theirs. No new guard or refusal
(ADR-228): nothing here blocks, gates or asks before an action, and the G-code is unchanged.

### Context

The Falcon A1 Pro takes a 20 W blue diode module and an optional 2 W infrared module that swap on
the same carriage; only one is fitted at a time. KerfDesk's Falcon A1 Pro preset had no laser head
at all, so recipes could not match a head, the burn preview took a 0.1 mm beam and the spot-size
checks fell back to defaults. Rayforge lists both modules as two heads with a tool number each and
a 36 mm Creality roller, but the modules cannot both be fitted, and neither its roller diameter nor
its 363 × 273 mm bed matches a published figure (Creality's LightBurn bundle gives 358 × 268 mm; a
Creality forum measurement gives a 17 mm roller).

### Decision

1. **The fitted module is the profile's laser head.** `core/devices/laser-modules.ts` lists the
   modules a catalog machine takes one at a time. The Falcon A1 Pro preset ships with the blue
   module fitted (catalog version 2026-09-28):
   - 20 W blue: 455 nm, 0.08 × 0.1 mm spot, built-in air (Creality's product page; the Tom's
     Hardware review for the spot).
   - 2 W infrared: 1064 nm, 0.03 mm spot (Creality's product page). Creality does not say what
     kind of source it is or whether the air nozzle serves it, so both stay "unknown".
2. **Laser module** in the machine rail, under the status readout, on a laser machine whose
   profile lists more than one module: a list naming each by power and colour ("20 W blue (455
   nm)", "2 W infrared (1064 nm)"). Picking one replaces the profile's laser head with it, as an
   undoable machine change. Recipes, the beam the spot-size checks and tracing use, and the burn
   preview's beam and watts (ADR-501) follow it. A Falcon saved before it had a head shows "Pick
   the fitted module" until one is picked.
3. **Job Review names the module** the job was prepared for, "20 W blue (455 nm) · prepared for
   this one; check it is fitted", because KerfDesk cannot see which module is on the carriage. A
   Falcon with no module picked reads "Not chosen" as a warning row. Neither stops Start.
4. **Published rotary presets.** `core/devices/rotary-presets.ts` holds rotaries whose maker
   publishes settings, by machine family. Rotary Setup shows **Rotary preset** when the machine's
   family has one; picking it fills in the type and motion per turn, keeps the work's diameter
   and the toggles, and shows where the figures come from. The one entry: the Creality Rotary
   Kit Pro as a chuck at 40 mm per rotation, from its manual, which says the value may vary with
   the setup. No roller preset: Creality publishes no roller diameter or motion per turn, so the
   roller keeps the measured setup (ADR-373) and Test rotation.

Better than Rayforge's: the list matches the machine (one module at a time, no tool numbers the
controller would ignore), the review names the module before a job runs, every figure has a
source, and nothing unsourced is shipped as a preset.

### Consequences

- The Falcon A1 Pro preset now carries a head, so its spot size reaches the fill interval and
  minimum-feature checks, the trace, recipe matching and the burn preview, where a 0.1 mm default
  or nothing stood before. Saved profiles keep whatever head they have.
- Swapping the module changes nothing in the G-code: the same `$30`, commands and air. A job
  prepared for one module can be run with the other fitted; the review line is the reminder.
- Module lists live in the catalog, not in saved profiles, so a custom machine cannot list its
  own modules yet.
- Not tried on a machine or on either module.

### Verification

- Unit tests (`laser-modules.test.ts`): the Falcon A1 Pro lists blue then infrared, ships blue
  fitted, finds either by model, and none for a head from elsewhere or no head; sourced figures;
  labels; the preset still validates. (`profile-catalog-content.test.ts`,
  `profile-catalog.test.ts`) the new catalog version and hash. (`LaserModuleRow.test.tsx`)
  swapping to infrared changes only the head and undoes; a Falcon without a head asks for one
  and the review warns; nothing on a single-laser machine or a CNC.
  (`RotarySetupDialog.preset.test.tsx`) the Creality preset is offered for a Falcon only, fills
  in a 40 mm chuck, keeps the work, cites its manual, and no row shows without presets.
