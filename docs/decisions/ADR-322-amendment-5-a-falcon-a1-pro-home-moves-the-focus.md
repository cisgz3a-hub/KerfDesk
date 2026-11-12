## ADR-322 Amendment 5 - A Falcon A1 Pro's Home moves the focus height, and KerfDesk says so

**Status:** Accepted by the maintainer on 2026-11-12, "Yes, add the reminder", after their own test. **Date:** 2026-11-12

Numbered 5 because PR #1767 adds Amendment 4 (a homed grblHAL maps the bed).

### Context

The maintainer reported that homing made their Falcon A1 Pro lose its Auto-focus height. KerfDesk's Home for the A1 Pro command set sends only `$HX`, then `$HY`, then the `G4 P0.01` settle marker ([Amendment 3](ADR-322-amendment-3-falcon-a1-pro-homes-and-reads-settings.md) decision 1), the same as Creality's own LightBurn device. A laser Frame sends no Z (the Z retract is CNC-only), ordinary laser G-code carries no Z, and KerfDesk keeps no record of the focus height, so nothing in KerfDesk itself moves or forgets it.

On 2026-11-12 the maintainer typed `$HX` then `$HY` in the Console on their A1 Pro, and Z moved. The firmware re-references Z while it homes X and Y. The A1 Pro's Auto-focus is itself a Z homing command (`$HZ1`, ADR-400 Amendments 1 and 2), which makes this plausible; Creality has not documented it. LightBurn with Creality's device sends the same lines and would behave the same.

So every Home on an A1 Pro, including the Home that Frame offers after an alarm and "Home, then restore origin" after an Abort, leaves the height wrong for the next burn, with nothing on screen to say so.

### Decision

1. **A Home on a command set known to move Z marks the focus height as moved.** Today that is the Falcon A1 Pro command set only, the one with evidence. Another machine is added only with evidence. The mark is set as the Home starts, because Z can move from the first homing line, so a Home that then fails still counts.
2. **After a completed Home, one warning toast says so:** "Home moved the laser's height: this machine's homing also moves Z. Move the head over your material and run Auto-focus again before you burn." It is keyed, so repeated Homes do not stack it.
3. **Job Review warns on a laser job while the mark stands:** "The laser's height has not been set since the last Home, and this machine's homing moves Z. Move the head over your material and run Auto-focus, or set the height by hand, before starting." It is a warning only and never gates Frame or Start (ADR-228, ADR-565). A CNC job is left to its own Work Z checks.
4. **A successful Auto-focus clears the mark, and so does a Z jog**, which is how a height is set by hand. The mark belongs to the controller session that homed, so a reconnect starts clean.
5. **KerfDesk does not re-run Auto-focus by itself after Home.** After Home the head sits at the front-left corner, which may not be over the material, so an automatic Auto-focus could measure the wrong surface.

### Consequences

- An A1 Pro user learns at Home, and again in Job Review, that the focus must be set again, instead of finding out from a soft burn.
- Because the warning changes the review's warning set, a Run again after a Home opens Job Review instead of carrying the earlier review (ADR-237 Amendment 3).
- A Z jog clears the mark whether or not the user actually focused; KerfDesk cannot tell a focusing jog from any other Z jog.
- The firmware behaviour is from one machine and one test by the maintainer, with no vendor documentation. Not verified on other A1 Pro units or firmware versions.

### Evidence

- `src/ui/state/home-moved-focus.ts` and its test; the Home action (`laser-home-action.ts`), the Auto-focus completion (`laser-autofocus-actions.ts`), the jog start (`jog-held-frame.ts`), the Start snapshot and the Job Review policy.
- `src/ui/state/falcon-a1-pro-connect-home.simulator.test.ts`: a Home through the A1 Pro driver sends `$HX`, `$HY` and no Z word, then shows the reminder and raises the Job Review warning.
