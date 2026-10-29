## ADR-637 Amendment 4 - On grblHAL the reported work area is the homed envelope, not the raw travel (2026-10-29)

**Status:** Accepted (rolling audit v8 finding N2-P2-1, confirmed by an independent refuter; the
maintainer's standing instruction to fix confirmed audit findings). Amends ADR-420 rule 5 (what
`$130`/`$131` map to), Amendment 2 decision 5 of this ADR, ADR-322 Amendment 3 decision 3 (its
last bullet) and ADR-375 Amendment 4 decision 2 (the frame under a vendor command set). It adds
no Start guard (rule 7 / ADR-228). | **Date:** 2026-10-29

### Context

Rolling audit v8, report N2 (`docs/audits/2026-10-29-rolling-v8/N2-fix-a1-pro.md`), checked
#1499, which made the Falcon A1 Pro read `$$` at every connect (ADR-322 Amendment 3).

- **The offer.** Both published A1 Pro dumps read `$130=363 $131=273`. The `$$` collector mapped
  them straight to the bed, so every connect offered **Bed width 358 → 363** and **Bed height
  268 → 273** beside the correct **Acceleration 500 → 1000**. ADR-611 Amendment 2 ("updates
  always announce") toasted it at every connect.
- **The firmware's own envelope is smaller.** grblHAL sets the homed envelope in
  `limits_set_work_envelope`
  ([machine_limits.c L114-L139 @ f8f10aec](https://github.com/grblHAL/core/blob/f8f10aecdf05943e3a02b1ac3c691b666a811495/machine_limits.c#L114-L139)).
  With hard limits on, the pull-off comes off the far edge; without "Set machine origin to 0"
  (`$22` bit 3) it comes off the homing edge too. With the A1 Pro's `$21=1 $22=43 $23=3 $27=5`
  that is X 0..358 and Y 0..268: Creality's listed 358 x 268 mm area. Stock GRBL's homed envelope
  is the whole travel (the switch sits on its edge), so the stock mapping was right.
- **Accepting it moved everything past the envelope.** **Use detected values** made the vendor
  frame, jog and click-to-position limits and Absolute preflight 0..363 x 0..273. Move laser
  here sent `G1 X363.000`, 368 mm from the X switch. The firmware does not stop it: `$20=0`, and
  the Falcon contract jogs with plain `G1`, so `$40=1`'s `$J=` clamp never applies. Under a
  command set the jog limits skipped the grblHAL inset (`manual-motion-limits.ts`), so nothing
  else stopped it either.
- **The warning pointed the wrong way.** Job Review's travel fact compared `$130`/`$131` with the
  profile bed. It showed a warning tone at every Start on the correct 358 x 268 preset and went
  quiet once the bed was widened.

### Decision

1. **The reported work area is the homed envelope's size.** The profile values a `$$` offers
   (`detectedProfilePatch`) take their bed from `reportedWorkArea`
   (`core/controllers/grbl/reported-work-area.ts`): `$130` x `$131`, except on grblHAL with homing
   on and hard limits on, where it is the envelope's width and height from the same model as the
   grblHAL hold clamp (`jogTravelLimits`, no rounding margin). The family comes from the profile's
   driver and the banner, as the hold clamp's does, whatever the command set.
   - The A1 Pro's 363 x 273 gives 358 x 268, so a connect on the preset offers no bed change and
     still offers the acceleration. A bed already widened to 363 x 273 is offered 358 x 268 back.
   - A grblHAL dump that leaves out `$21`, `$27` or force origin (a COMPATIBILITY_LEVEL 2 build
     prints `$22` as 0 or 1) keeps the raw travel rather than guess the inset.
   - Stock GRBL, FluidNC and the other families keep `$130` x `$131`.
   - The controller snapshot keeps the raw travel: the hold clamp, the stock bed frame and the
     settings table read it.
2. **The automatic fill and Use detected values take that area.** ADR-420 rule 5's mapping and
   Amendment 2 decision 5 now mean the homed area on grblHAL. A listed machine still keeps its
   listed area in the automatic fill (Amendment 2 decision 1).
3. **Machine Setup names both.** The found-machine list reads, for example, "Travel 363 × 273 mm,
   a 358 × 268 mm work area after the homing pull-off", and the kept-area note gives the
   `$130 × $131` travel with the same clause. The catalog's reason reads "Controller's configured
   travel gives a W x H mm work area".
4. **Job Review compares the profile bed with the homed area.** The **Travel $130 × $131** fact
   shows the travel, adds "homed area W × H mm" when the two differ, and warns only when the
   homed area differs from the profile bed. The A1 Pro preset reads "363 × 273 mm, homed area
   358 × 268 mm" in the plain tone; a widened bed warns.
5. **grblHAL's envelope pulls in a frame under a vendor command set** (amends ADR-375
   Amendment 4 decision 2 for the frame). With a verified frame, the jog and click-to-position
   limits intersect it with grblHAL's homed envelope from this session's `$$` even under the
   Falcon contract, since that envelope bounds the machine whatever command moves it. With
   `$20=0` there is no rounding margin, so the preset's 0..358 x 0..268 is unchanged and a bed
   widened on 1.0.28 stops at 358 x 268. Stock GRBL's `$J=` homing-edge inset still does not apply
   to a vendor contract, and without a frame a vendor contract still gets no firmware box.

No controller setting is written, and nothing new gates Start.

### Consequences

- An A1 Pro owner on the preset no longer sees a bed change at connect, and Start's travel fact
  is plain. The acceleration update still announces at every connect while it differs (ADR-611
  Amendment 2).
- A profile that took 363 x 273 on 1.0.28 is offered 358 x 268 at the next connect, warns in Job
  Review, and jogs no further than the envelope. Its frame and preflight still use the saved bed
  until the operator takes the offer.
- Any other grblHAL with homing and hard limits on is offered its homed area, a pull-off (or two
  without force origin) short of `$130`/`$131`.
- The firmware-settings comparison in Machine Setup's Review (`device-setup-firmware-diff.ts`)
  still compares `$130`/`$131` with the bed, read only, as Amendment 2 says.

### Verification

- `reported-work-area.test.ts`: the A1 Pro dump gives 358 x 268; grblHAL without force origin
  takes the pull-off off both edges; hard limits off, homing off, a level 2 dump and a missing
  `$27` keep the travel; stock GRBL keeps the travel; the family from profile and banner.
- `falcon-a1-pro-connect-home.simulator.test.ts`: a fake port with the published `GrblHAL 1.1f`
  banner and all 107 rows of the published `$$` (rayforge PR #461). Connect sends no `$N=`, `$#`,
  `$SLP` or `$RST`; the offer has Acceleration and no bed row and still announces; the travel
  fact is plain; Home through the driver (`$HX`, `$HY`, settle) gives the 0..358 x 0..268 frame
  and limits; Use detected values keeps 358 x 268. A bed widened to 363 x 273 is offered
  358 x 268, warns, keeps its 0..363 frame but 0..358 limits, and Move laser here at its far
  edge sends `G1 X358.000`. This also closes N2-P3-5's simulator gap.
- `manual-motion-limits.test.ts`, `job-review-live-rows.test.ts`,
  `DeviceSetupWizard.detected-values.test.tsx` and `profile-suggestions.test.ts` cover the limits,
  the travel fact and the wording. The Falcon wizard e2e (`production-workflows.spec.ts`) now also
  checks the saved homing and kinematics (N2-P3-5).
- No hardware was operated. Whether the head can physically reach 363 x 273 after a Home is not
  verified; the decision follows the firmware's envelope and Creality's listed area.
