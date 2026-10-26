## ADR-400 Amendment 2 - An Auto-focus probe carries its own slow feed, and G30 is not a focus command (2026-10-22)

**Status:** Accepted. | **Date:** 2026-10-22

### Context

Amendment 1 rule 1 accepted "a Z-only probe: `G38.2`–`G38.5` with a Z target and an optional
feed" and "`G30` on Marlin and Smoothieware". Controller audit v3, area D2 (Focus and Z), showed
three problems with those forms. The report is `docs/audits/2026-10-22-controller-v3/D2-ctl-focus-z.md`
on the rolling audit branch.

- **D2-P3-3, re-rated P2 by the refuter: an F-less probe runs at the last job's feed.** F is modal.
  gnea/grbl `gcode.c:418-421` gives a block with no F the last feed that was set ("Push last state
  feed rate"). Only after power-up or a reset is that feed 0, which fails with `error:22`
  (`:44`, `:664`). Program end keeps F (`:1092-1095`), and a `$J=` jog does not change it
  (`:848-866`). grblHAL does the same (`gcode.c:2418`).
  - A KerfDesk fill at 6000 mm/min ends with `G1 … F6000 S0`. The next `G38.2 Z-10` press then
    probes toward the bed at up to `$112` (`planner.c:389`).
  - Contact starts a decelerating stop (`probe.c:59-65`), so the head overruns contact by v²/2a.
    With GRBL's generic defaults (`$112` = 500 mm/min, `$122` = 10 mm/s²), that is about 3.5 mm.
    At the in-app example F100 it is about 0.14 mm.
  - The rule accepted `G38.2 Z-10`, `G38.2 Z-10 F100000` and `G38.3 Z-500`. KerfDesk's own
    probes always write F on the probe line (`core/controllers/grbl/probe.ts`,
    `ui/state/laser-surface-probe-actions.ts`).
  - The refuter added: `G38.3` and `G38.5` stop without an error when they reach the target
    without a contact change. On stock GRBL the probe pin always exists and reads untriggered
    when nothing is wired. So `G38.3 Z-50` on a laser without a probe is the plain Z move that
    Amendment 1 refuses as `G1 Z`, and KerfDesk reports "Auto-focus complete".
- **D2-P3-4: `G30` does not focus.**
  - Smoothieware's zprobe documentation says bare `G30` probes, reports the distance and returns
    to where it started. `G30 Z<n>` stays at contact and sets Z to n, which is a `G92` write.
  - Marlin 2.1.x `G30` probes with `probe_relative`. The nozzle moves by the probe's XY offset,
    then `move_z_after_probing()` lifts it (`probe.cpp:894-897`). bugfix-2.1.x moves back
    afterwards.
  - Neither firmware leaves the head at a focal height, yet both report "Auto-focus complete".
    Marlin's XY move is one rule 1 forbids.
- **D2-P3-1: wrong `error:9` hint.** The editor and the toast said `error:9` means "no probe pin".
  On GRBL, grblHAL and FluidNC `error:9` means "G-code commands are locked out during alarm or jog
  state" (gnea/grbl `error_codes_en_US.csv` row 9). A missing probe input answers `error:20`
  (grblHAL `gcode.c:1574-1575`, FluidNC `GCode.cpp:606-610`).

### Decision

This replaces the probe and `G30` bullets of Amendment 1 rule 1. The rest of Amendment 1 stands.

1. **A probe needs its own feed, at most 150 mm/min.** An accepted `G38` line carries `F` with
   0 < F ≤ 150 (`MAX_AUTOFOCUS_PROBE_FEED_MM_PER_MIN` in `core/devices/autofocus-command.ts`).
   - A probe with no F is refused with: "A G38 probe needs its own feed, for example
     G38.2 Z-10 F100. Without F the controller probes at the speed the last job left set."
   - An F above the cap, or not above 0, is refused with the limit and its source.
   - **Where 150 comes from:** `DEFAULT_Z_PROBE_PARAMS.seekFeedMmPerMin` = 150 in
     `core/controllers/grbl/probe.ts`. It is the feed KerfDesk's own Z touch plate and Surface
     Probe first touch at, before a 25 mm/min re-touch; the Surface Probe dialog's default seek
     feed is the same 150. An Auto-focus probe touches once, so its one touch gets no more speed
     than KerfDesk's own first touch. A test pins the two constants together.
   - With GRBL's generic defaults, 150 mm/min overruns contact by about 0.3 mm, against about
     3.5 mm at the inherited `$112`.
   - **Not used:** the 10,000 mm/min limit in `ui/state/laser-probe-policy.ts` and
     `core/controllers/grbl/surface-grid-probe.ts`. It bounds what an operator may type there,
     and is not a contact speed.
2. **Only the probes that alarm when they miss.** `G38.2` (toward contact) and `G38.4` (away
   until contact is lost) are accepted. `G38.3` and `G38.5` are refused: they end silently at
   the target when nothing triggers, so a missed or unwired probe would end as a plain Z move that
   KerfDesk would report as focused. `G38.2` instead raises an alarm, and Auto-focus reports the
   alarm.
3. **`G30` is refused on every controller, including when no controller is known (the load
   check).** The decision is to drop it rather than describe it differently. Bare `G30`
   measures and moves away (Smoothieware) or moves XY and lifts (Marlin). Smoothieware's
   `G30 Z<n>` is a probe plus a `G92` coordinate write, and the rule already refuses `G92` on
   its own line. Marlin and Smoothieware machines with a probe can use `G38.2 Z… F…` where
   their firmware supports it. GRBL-family `G30` (go to a stored position) was already
   refused. The reason names all three.
4. **The Z target stays a work coordinate, and the line stays one command.** The rule does not
   bound |Z|. Under `G90` (every KerfDesk job and every reset leaves `G90`), Z is a
   work-coordinate position, so a number limit does not bound travel. `G38.2` alarms if it
   reaches the target without contact. A leading `G90`/`G91` on the line stays refused: Auto-focus
   sends one line and nothing restores `G90`, so a `G91` would leave the controller relative. The
   editor now says the target is a work-coordinate position (G90), not a distance, and names the
   feed limit.
5. **Error hints say what the firmware means.** The editor and toast say `error:9` means the
   controller was in Alarm or Jog, so clear the alarm or let the jog finish. `error:20` means no
   probe input, or a command the firmware does not support.

Load, profile import and restore, Machine Setup and the press all use the same rule
(`autofocusCommandIssue`), so items 1 to 3 apply everywhere Amendment 1 does. The added checks do
not depend on the controller, so the load rule still cannot make Save rewrite a value (ADR-204).

### Consequences

- A saved `G38.2 Z-10`, `G38.3 …`, a fast probe or a `G30` stops working. A project file clears it
  on load, so Auto-focus shows **Set up auto-focus**. A machine profile import or restore clears it
  with a review note that gives the reason. Machine Setup shows the reason beside the editor.
- No catalogue profile or preset ships a `G38` or `G30`, so the Falcon `$HZ1` preset and grblHAL
  or FluidNC `$HZ` are unchanged.
- An operator who wants a faster seek followed by a slow touch runs that sequence from the
  Console, as ADR-092's 2026-08-02 amendment already says for multi-line probe sequences.
- No G-code emitter, Frame, Start or job behaviour changes.

### Verification

- `core/devices/autofocus-command.test.ts`:
  - an F-less probe is refused on every controller and with none;
  - F6000, F100000, F150.001 and F0 are refused, and F150 is accepted;
  - `G38.3` and `G38.5` are refused, and `G38.4` with F is accepted;
  - `G30` and `G30 Z1.5` are refused on every controller;
  - the cap equals `DEFAULT_Z_PROBE_PARAMS.seekFeedMmPerMin`;
  - Machine Setup validation refuses an F-less probe.
- `io/project/project-autofocus-command.test.ts`: load clears the F-less, fast and silent probes
  and `G30`. A machine profile import clears an F-less probe with a note saying it needs its own
  feed.
- `ui/state/laser-store-autofocus-ownership.test.ts`: on a stock GRBL link, a press with
  `G38.2 Z-10` is refused and writes nothing.
- `ui/laser/AutofocusEditor.test.tsx` and `ui/state/autofocus-action.test.ts`: the `error:9` and
  `error:20` texts, the feed limit in the hint, and the alert for an F-less probe.
- Not verified on hardware or on a controller simulator: the overtravel figures come from GRBL
  source and its generic defaults.
