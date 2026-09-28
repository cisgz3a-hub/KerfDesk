## ADR-501 - The burn preview shades by energy (2026-09-28)

**Status:** Accepted. Amends ADR-487. | **Date:** 2026-09-28

The preview is advisory (ADR-228), and the G-code is unchanged.

### Context

ADR-487's burn preview shades each move by its power alone, as LightBurn's preview does, so a job
that shades by speed at one power shows one tone, and a fast photo engrave looks as dark as a slow
cut. An uncalibrated energy model can distinguish these moves using power, speed and spot size.

### Decision

1. **Energy per square millimetre.** A move puts `W × p ÷ (v × b)` joules into each mm² its beam
   covers: `W` the head's optical power from the machine profile, `p` its share of full power (S
   over `$30`), `v` its programmed feed in mm/s and `b` the beam width (the head's spot, or 0.1
   mm). A head that states no optical power is taken as 10 W, and the note says so.
2. **Against the material.** Each burn material has a dose that burns it fully (leaves 8% of its
   light): wood 2 J/mm², MDF 1.5, acrylic 4, anodised aluminium 1.2, laminate 1.5; flat grey and
   the burn map burn as wood. A pass at a share of that dose darkens as a pass at that share of
   full power did (the optical density `-ln(1 - 0.92 × share)`), past it down to 2% of the light,
   and passes add their densities as before. At 10 W, 0.1 mm and 3000 mm/min this is exactly
   ADR-487's shading on wood.
3. **Shade by** in the Burn readouts: **Energy (power and speed)**, the default, or **Power only**,
   ADR-487's shading, LightBurn's. By power the material does not change the burn.
4. **What it counts, said.** Shading by energy, the note reads the formula with this machine's
   watts and beam, the chosen material's full dose and the least and most energy the program's
   burning moves put in, over a strip from bare to past the full burn with the program's range
   and the full burn marked. It ends: "Uncalibrated: it shows which parts burn darker, not the
   exact colour."

Power-only shading stays one click away; the note gives
the program's own energy range against the material, so an engrave that cannot reach a full burn
or a cut far past it shows before anything burns; and it keeps ADR-487's playback, rotary wrap
and 3D materials.

### Consequences

- **The doses are round figures**, from typical diode results, not measurements; they rank the
  parts of a job, they do not predict a colour. A material test grid remains the calibration.
- **Programmed feed, not achieved speed.** With `M4` (GRBL laser mode, KerfDesk's default for
  laser output) the controller scales power with the speed it reaches, so the dose along a move
  is its programmed dose. With `M3`, corners and short moves that never reach their feed burn
  darker on the machine than here.
- A move with no feed (a file that never set one) puts no energy in and draws no burn by energy;
  by power it burns as before.
- Changing the material or the shading starts the burn again from the program's start, as a new
  rotary wrap does; it then catches up with the playhead.

### Verification

- Unit tests (`burn-energy.test.ts`): 10 W, 0.1 mm, 3000 mm/min puts 2 J/mm² in at full power and
  1 at half or at twice the speed; nothing with the laser off, no feed or no beam; on wood it
  matches the power shading at 3000 mm/min; slower burns darker, twice the power at twice the
  speed the same; past the full dose it keeps darkening to 2%; passes add; acrylic needs more
  than wood and MDF less. (`burn-grid.test.ts`) the energy shading burns full and half power as
  the power shading does where the dose follows the power, 6000 mm/min leaves 77% of the light
  where power alone leaves 54%, acrylic's dose halves the darkness, no feed burns nothing, and
  the program's energy range is read from its burning moves only. (`burn-worker-client.test.ts`)
  the worker gets its own copy of the feeds. (`gcode-inspection-source.test.ts`) a head's
  optical power reaches the Inspector. (`InspectorBurnControl.test.tsx`) the note's formula,
  material, range and scale; the taken 10 W; switching to power alone.
- Browser (`e2e/gcode-viewer-burn.e2e.ts`): the two-square program reads "this program puts in
  0.6 J/mm² to 2 J/mm²" on the default machine with 10 W taken; Power only reads "S 1000
  darkest"; the burn on wood and laminate as before.
- Not compared with a real burn.
