## ADR-637 Amendment 5 - A grblHAL bed widened to the travel is offered back by name, and warned at Frame and Start

**Status:** Accepted (rolling audit v9 finding R6-P2-3, confirmed by an independent refuter; the
maintainer's standing instruction to fix confirmed audit findings). Amends Amendment 4's
Consequences. It adds no Start guard (rule 7 / ADR-228) and writes no controller setting. |
**Date:** 2026-11-02

### Context

- 1.0.28 offered `$130` × `$131` as the bed. A Falcon A1 Pro profile that took it with **Use
  detected values** keeps 363 × 273 mm; grblHAL's homed envelope is 0..358 × 0..268
  ([machine_limits.c L114-L139 @ f8f10aec](https://github.com/grblHAL/core/blob/f8f10aecdf05943e3a02b1ac3c691b666a811495/machine_limits.c#L114-L139)).
- Amendment 4 offers 358 × 268 back in Machine Setup's rows, behind a generic connect toast, and
  stops jog and Move laser here at X 358. Its Consequences accepted that "frame and preflight
  still use the saved bed until the operator takes the offer". The refuter showed Frame sending
  `G1 X362.000` and an Absolute job to X 362 passing preflight. With `$20=0` the firmware stops
  neither.
- Repairing the bed silently is not safe. On the A1 Pro's front-left origin machine Y is measured
  from the bed's far edge, so a 268 mm bed moves every placed object 5 mm in machine Y against
  where the operator put it on the 273 mm canvas.

### Decision

1. **Connect names the correction once.** When this session's `$$` gives grblHAL a homed area
   smaller than a profile bed that equals `$130` × `$131`, the machine toolbar says so with both
   sizes and what the change moves, for example: "This profile's bed is 363 × 273 mm, the
   controller's whole travel. After the homing pull-off its homed area is 358 × 268 mm, and
   nothing stops a Frame or a job past it. Correct the bed from 363 × 273 mm to 358 × 268 mm?
   Artwork already placed moves 5 mm in machine Y." **Correct bed to 358 × 268 mm** writes only
   the profile bed, through the same path as **Use detected values**; **Not now** keeps it. Once
   answered it is not asked again in this run for that profile and pair of sizes.
2. **Until it is taken, Frame and Start warn by name.** After this session's Home, a Frame whose
   route (approach, outline and return) leaves grblHAL's homed envelope (the jog model without its
   rounding margin) warns as it is sent, naming the farthest point, the envelope and the profile
   bed: "The Frame reaches X 362 on the bed, past the controller's homed area (X 0 to 358, Y 0 to
   268 mm after the homing pull-off). This profile's bed is 363 × 273 mm, the controller's whole
   travel; correct it to 358 × 268 mm in Machine Setup. …". The Frame is sent unchanged. Like a
   no-go zone crossing (ADR-232 Amendment 1), a project Frame's candidate carries the warning into
   Start's Job Review. Laser frames trace the job's whole emitted envelope, so Start's job is
   inside the route that was compared.
3. **Stock GRBL, FluidNC and the other families are unchanged.** Only grblHAL's homed envelope is
   compared, and only through a verified native-to-bed frame; a bed that fits the homed area is
   offered and warned nothing.

### Consequences

- Amendment 4's "Its frame and preflight still use the saved bed until the operator takes the
  offer" stays true of the motion, which is unchanged, but a Frame or Start past the envelope now
  says so by name. Preflight's bed check is unchanged.
- Machine Setup's rows (Bed width 363 → 358, Bed height 273 → 268) and Job Review's travel fact
  still show the same offer and warning.
- A generic grblHAL whose bed equals its travel with hard limits on (rolling audit v9 R6-P3-1)
  gets the same named offer at connect. It has no verified frame, so it gets no Frame warning.
- `homed-area-bed.ts` (`bedWiderThanHomedArea`, `grblHalHomedEnvelope`, `bedCorrectionShift`),
  `frame-homed-area-warning.ts` and `HomedBedCorrectionOffer.tsx`; `frameRouteNoGoWarnings` returns
  the homed-area warning beside the zones.

### Verification

- `falcon-a1-pro-connect-home.simulator.test.ts` loads the last-machine document the real 1.0.28
  code (`33bc394c6`) saved after **Use detected values** on the published dump
  (`src/__fixtures__/returning-user/1.0.28-a1-pro-widened-last-machine.json`), connects to the
  published banner and `$$`, and checks the named offer, the Frame warning at X 362, the
  candidate that carries it to Job Review, silence inside the homed area, and that Correct writes
  358 × 268 and no controller setting.
- `homed-area-bed.test.ts`: stock GRBL, FluidNC, the preset bed, hard limits off and an earlier
  session give nothing; the shift for each origin. `HomedBedCorrectionOffer.test.tsx`: the wording,
  Correct, Not now asked once, the preset bed and a stock GRBL connection.
- No hardware was operated. Whether the head can physically reach 363 × 273 after a Home is still
  not verified.
