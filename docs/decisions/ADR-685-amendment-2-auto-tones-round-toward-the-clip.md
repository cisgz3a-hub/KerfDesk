## ADR-685 Amendment 2 - Auto tones round toward the clip (2026-11-12)

**Status:** Accepted. Amends ADR-685 Decision 1 (Auto tones). Fixes Oracle audit O1 finding
O6-P3-2 (P3). Tested in `portrait-auto-tones.test.ts`. Not burn-tested. Saved projects keep the
tones they store. | **Date:** 2026-11-12

### Context

Auto tones turn the darkest 0.5% of a photo solid and the lightest 0.5% blank by choosing a
brightness and a contrast. Then a gamma returns the median tone to where it was. The controls hold
a tenth, so both values were rounded to the nearest tenth. That rounding could leave the 0.5% level
up to about a quarter of a level above 0. Near black, the midtone gamma (`v^(1/gamma)`, up to 5)
lifts such a level a long way. The audit's refuter measured 10 levels on an ordinary two-tone
portrait (level 111 → 10). When half the photo was one dark backdrop level, it measured 51
(113 → 51), so the backdrop burned grey instead of solid.

### Decision

Brightness rounds **down** and contrast rounds **up** to their tenth, with contrast still capped at
the control's 100. Both move the 0.5% level to or below 0, where the brightness and contrast
stages clamp it to solid. The gamma then has nothing to lift. Before the gamma, the lightest 0.5%
level sits at most about half a level below 255, so it still reads 254 or 255. The midtone hold is computed from the
rounded values, as before.

### Consequences

- Auto tones keep their ADR-685 promise: the darkest 0.5% is solid. A dark backdrop that fills half
  the photo is solid too, rather than a grey that depended on rounding.
- Only a new press of Auto tones changes. Stored tones, compile and every saved project are
  unchanged.
