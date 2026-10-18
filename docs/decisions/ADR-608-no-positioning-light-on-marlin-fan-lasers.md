## ADR-608 - No positioning light on Marlin fan-mosfet lasers

**Status:** Accepted by the maintainer's explicit instruction on 2026-10-18. Amends ADR-603 and ADR-605. Software verification only; no controller or accessory was operated.

**Context.** A positioning light (ADR-603) is switched by accessory M-codes the operator enters. With ADR-605 a clean Frame can send the light's on command automatically. On a Marlin profile using the *Marlin Fan-mosfet* dialect the laser itself is wired to the part-cooling fan output and is fired with `M106 S<n>` and stopped with `M107`. A light mapping that reaches the laser's fan would fire the beam at full power with the head stopped. Refusing particular commands leaves room for wiring KerfDesk cannot see, so the maintainer chose to remove the feature from those profiles.

**Decision.** A profile whose G-code dialect is `marlin-fan` has no positioning light:

- Machine Setup hides Positioning LED / crosshair (with its **Centre & LED after Frame** option), and the jog pad hides **Centre & LED**, **Set up LED** and **LED off**.
- The validator refuses any light mapping on that dialect, whatever its commands. Loading a project or machine profile drops a saved light (machine profiles add the "Positioning light removed" review note); an interactive edit that switches a profile to that dialect drops its light.
- At runtime the light action, the Frame-after chain and Disconnect's best-effort light-off send nothing on that dialect, not even an off command captured before the profile changed.

Every other profile keeps the feature unchanged, including the refusal of `M106`/`M107` without a non-zero `P` fan index on non-Smoothieware controllers, since fan 0 can be a fan-wired laser.

**Verification.** Unit tests cover the validator refusing every mapping on `marlin-fan` and accepting the same mappings elsewhere; project and machine-profile import dropping the light; a dialect switch dropping it; the Frame-after chain declining; the jog pad and Machine Setup hiding the controls only on `marlin-fan`; and the light action writing nothing there, including a captured off command.
