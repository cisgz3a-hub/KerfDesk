## ADR-671 Amendment 1 - Every image Gamma field states which way it moves the midtones (2026-11-12)

**Status:** Accepted. Amends ADR-671 Decision 1 (the `1/gamma` convention). Fixes Oracle audit O1
finding O6-P2-1 (P2). The tone curve, compile, preview, G-code and every saved project are
unchanged. | **Date:** 2026-11-12

### Context

The engrave-stage tone curve (`core/raster/luma-adjust.ts`) raises each level to `1/gamma`, so a
higher gamma **lightens** the midtones. Photoshop and GIMP Levels use the same direction. GIMP's
Levels operation computes `pow(value, 1/gamma)`, and its manual describes the midtone slider in the
same sense.

LightBurn's Shape Properties document the opposite. Their Image section says of Gamma: "Lower
values lighten the mid-tones, and higher values darken them"
(<https://docs.lightburnsoftware.com/2.1/Reference/ShapeProperties/>). ADR-242 says KerfDesk keeps
"LightBurn's UX shape (Adjust Image semantics …)". A user who copies a gamma from a LightBurn guide,
for example 1.5 to darken the midtones on slate, gets lighter midtones from KerfDesk. Only the
Photo engraving dialog said which way the field works, and only one of the three Gamma fields said
it. Adjust Image and the Shape properties panel said nothing.

### Decision

1. **The convention stays.** Higher gamma keeps lightening. Reversing it would change the burn of
   every saved project with a gamma other than 1, and of every Auto tones result (ADR-685).
   Migrating stored values (`gamma → 1/gamma`) would also leave the range: 0.1 maps to 10, beyond the
   control's maximum of 5. The maintainer may still choose LightBurn's direction. That is a
   separate decision with its own migration.
2. **Every field says which way it goes, and that LightBurn differs.** One shared sentence
   (`ui/raster/gamma-direction.ts`) appears in three places. Adjust Image shows it as a visible line
   under Gamma and as the field's tooltip. The Shape properties Gamma field has it as its tooltip.
   The Photo engraving dialog's midtone hint uses it too.

### Consequences

- A gamma typed from a LightBurn guide is no longer applied the wrong way without warning.
- No burned output changes. Tests pin the direction (`luma-adjust.test.ts`) and the text
  (`AdjustImageDialog.test.tsx`, `SelectedImageAdjustments.small-audit.test.tsx`).
