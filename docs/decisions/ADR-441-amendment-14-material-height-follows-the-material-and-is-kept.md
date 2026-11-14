## ADR-441 Amendment 14 - The camera's Material height follows the job material and is kept between sessions (2026-11-14)

**Status:** Accepted (the maintainer's choice on camera audit v2 K2-P2-1: "Follow material, save it
(Recommended)", relayed by the audit coordinator). Revises Amendment 2, Decision 5 ("Not saved")
for the Material height; height areas stay as Decision 5 has them. Keeps Amendment 13's warnings. |
**Date:** 2026-11-14

### Context

The camera picture is drawn at the overlay's Material height. It started at 0 mm in every session
and ignored the project's job material (ADR-496), which names its thickness. A camera that starts
by itself draws without the Camera panel ever opening, so on 6 mm stock its picture was 5 mm off at
the front corners, and on 18 mm stock 16 mm. Amendment 13 made Job Review say so; the maintainer
chose that the height should also follow the material and be kept.

### Decision

1. **At start**, the Material height is the job material's thickness when the project names one,
   else the height kept from the last session.
2. **When the job material's thickness changes** (a material picked, a project opened), the height
   follows it, except while a rotary applies: a part on a rotary has its own top, and Amendment 13
   says so in Job Review.
3. **A height set by hand is kept and saved** until the material changes again. Amendment 13 still
   says in Job Review, and under the control, when it differs from the material.
4. The height is kept on this computer (browser storage); height areas stay unsaved.

### Consequences

- An auto-started camera draws at the stock's top without the panel being opened, whenever the job
  names its material.
- A height set for one piece stays for the next session when the project names no material.
- Code and synthetic evidence only.

### Verification

`src/ui/camera/helpers/material-height.test.ts`:
- the height starts at the job material's thickness and follows a new material;
- a height set by hand is kept into the next session, until the material changes;
- the height is left alone while a rotary applies.
