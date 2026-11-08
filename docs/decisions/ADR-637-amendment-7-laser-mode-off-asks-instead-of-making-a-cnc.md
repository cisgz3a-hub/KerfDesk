## ADR-637 Amendment 7 - A laser with laser mode off is asked to turn it on, never made a CNC

**Status:** Accepted (new-user experience audit U8, finding U8-P2-1 raised to P1 by the
coordinator, and U8-P3-5, both confirmed by an independent refuter on a fake GRBL; the
maintainer's standing instruction to fix confirmed audit findings and to copy LightBurn's
behaviour). Replaces ADR-420 rule 5's "machine type from `$32`" and extends Amendment 1 item 1
(a listed machine keeps its type) to every machine. It adds no Start guard (rule 7 / ADR-228) and
writes no controller setting without the operator's click, a saved backup and a confirm. |
**Date:** 2026-11-03

### Context

- Stock GRBL ships with laser mode off: every default block of gnea/grbl v1.1h `defaults.h`
  has `#define DEFAULT_LASER_MODE 0`. Many diode kits arrive that way.
- On the first Connect, the automatic fill (ADR-420 rule 5) took an unlisted draft's type from
  `$32`, so the generic laser starter became a CNC. The card said only "Machine type set to CNC:
  laser mode is off ($32=0)" and the window became "CNC Machine Setup". Nothing told a laser owner
  to press Undo, and the line stayed after they chose Laser again (U8-P3-5).
- Saved as a CNC, Start sent `M3 S12000`, a 3 s `G4 P3` dwell and rapids without `S0`. On a diode
  that is full power held still for 3 s, then burned travel lines. Every warning on that path
  spoke of a spindle and bits; none said the laser would fire.
- Back on Laser, the `$32=1` write sat in Review's collapsed "Controller settings · Optional". A
  listed laser chosen before Connect copied `$32=0` into the profile, so Review said "Laser mode
  Off" and offered no `$32=1` at all. Job Review's laser row ("Enable GRBL laser mode ($32=1)")
  had no button, while its router twin offered **Send $32=0** (ADR-180 Amendment 6).
- With laser mode off, GRBL "will briefly pause upon any spindle speed or state change"
  (gnea/grbl v1.1h `laser_mode.md`): each power change in a Fill or Image stops the head with
  the beam lit, burning dots.
- LightBurn's page for GRBL lasers tells the user to type `$32=1` in the Console to "Remove the
  pause when power output changes" (docs.lightburnsoftware.com 2.1, CNCBasedLasers). It never
  changes the device type from `$32`.

### Decision

1. **`$32` never sets the machine type.** It cannot tell a stock-GRBL laser from a router. The
   fill keeps the type the draft has: the laser starter, a listed machine, or the operator's
   choice, in both directions (a router reporting `$32=1` stays a router, and Job Review's
   **Send $32=0** is its fix). The card's "Machine type set to …" line is gone, which also ends
   U8-P3-5's stale line.
2. **A laser keeps expecting laser mode on.** When a laser-head draft adopts the controller's
   values (the fill or **Use detected values**), a reported `$32=0` does not clear the profile's
   laser-mode expectation. A reported `$32=1` is still copied. So Review's firmware comparison
   offers `$32` 0 → 1, and Job Review's live row shows the mismatch. A CNC head still ignores the
   reported laser mode, as before.
3. **The card asks in plain words.** While a laser-only draft's controller reports `$32=0`,
   the Connect card and Review's header show: "Your controller has laser mode off ($32=0).
   Lasers need it on, or the beam pauses and burns dots at every power change. Turn it on now?"
   - **Turn on laser mode ($32=1)** first opens the save dialog for a backup of the controller
     settings (the same file as Machine Settings' Export). Without a saved backup nothing is
     written. It then confirms the write, naming the backup and the effect, and calls Machine
     Settings' `writeGrblSetting(32, '1')`. That applies every write rule unchanged: a `$`-setting
     driver, an Idle controller read this session, no operation running, the machine-kind rule
     (only exact `$32=1` on a laser project), and a `$$` read-back that must show the value. A
     toast reports the result, and the question leaves once the controller reports `$32=1`.
   - While the open project is a CNC project, the button is disabled and says to save the setup
     first and use Job Review's **Send $32=1**, because a router project never writes laser mode
     on (ADR-180 Amendment 6 item 3).
   - **This is a CNC router** is the only way the answer becomes CNC. It sets the type, and when
     the fill had applied the controller's values it applies them again so the router head gets
     the reported max feed, as the old fill did.
4. **Job Review's laser row gets Send $32=1.** The `$32=0` row now reads "Laser mode is off
   ($32=0): the laser stops with the beam on at every power change, which burns dots and slows the
   job. Send $32=1 to turn laser mode on." It opens its detail at once, ranks with the beginner's
   before-the-burn notes (ADR-687), and carries **Send $32=1**: the twin of **Send $32=0**, with
   a confirm that names the effect and the same guarded write. A driver that sends no `$` setting
   writes gets no button.
   - Job Review also rebuilds when a controller operation ends. The write's `$` read-back
     reaches the store while the write still holds its operation, and preparation refuses during
     an operation, so before this the review stuck on "A controller operation is active" with the
     fixed row still shown. That was true of **Send $32=0** as well, whose Amendment 6 promised
     that the warning clears. Both rows now clear after a verified write.
5. **Other firmwares.**
   - grblHAL writes `$32` exactly as GRBL does.
   - FluidNC's `$32` follows the spindle type in its YAML configuration and cannot be written.
     The card says to set the spindle to Laser in the FluidNC config file, and Job Review keeps
     its FluidNC wording with no button.
   - The Falcon contract reads `$$` and writes nothing (ADR-322 Amendment 3), so the card tells
     the operator to use the maker's tools.
   - Marlin, Smoothieware and Ruida report no `$32`, so nothing is asked.
   - Web and desktop share the flow. The backup uses the platform's save dialog, as Export does.

### Consequences

- A generic diode with stock GRBL stays a laser from its first Connect and is one click (plus the
  backup and the confirm) from laser mode on. A new Connect can no longer reach the CNC output
  path from `$32` alone.
  - **Corrected by Amendment 8 (2026-11-08).** This first read "The CNC output path cannot be
    reached from `$32` alone", which was false for every machine 1.0.29 had already saved this
    way: such a machine restored as a CNC and Start sent `M3 S12000`, `G4 P3.000` and rapids with
    no `S0` (rolling audit v10 V2-P2-2). Amendment 8 asks those machines before Start.
- A router with `$32=0` that a beginner set up as a laser is turned into a CNC only by their own
  answer.
- G-code is unchanged: the profile's laser-mode expectation feeds only the setup's comparison and
  Job Review's row, never the emitted program, so a correctly set-up machine's output is
  byte-identical.
- Job Review's laser-mode acknowledgement no longer tells the operator to re-read the controller,
  which cannot change `$32`. It points at the fix Job Review offers.

### Verification

- `device-setup-auto-fill.test.ts`: the laser starter at `$32=0` stays a laser that expects laser
  mode on; a router chosen before Connect stays a router at `$32=0` and `$32=1`; a Laser + CNC
  draft keeps both; a listed laser keeps its type and expectation.
- `device-setup-accept-detected.test.ts`: a router chosen first, and **This is a CNC router** after
  the fill, both put the reported max feed on the CNC head.
- `DeviceSetupWizard.laser-mode-off.test.tsx` (rendered wizard on a stock-GRBL `$32=0` report):
  the card asks, saves a backup, confirms and writes `$32=1` once, then leaves; no backup or no
  confirm writes nothing; a listed Sculpfun S30 chosen before Connect is asked too and keeps
  laser mode expected on; **This is a CNC router** makes it a CNC; a CNC project shows no card;
  FluidNC is told where its laser mode lives.
- `JobReviewWarnings.test.tsx`: the laser row opens with **Send $32=1**, writes `$32=1` after the
  confirm, writes nothing when declined, reports a refusal, and shows no button for FluidNC or a
  driver without `$` setting writes.
- `use-job-review-rebuild.test.tsx`: the end of a controller operation requests a rebuild.
- A production build driven on the U8 refuter's fake GRBL (stock `$32=0`): the first Connect keeps
  "Machine Setup" and Laser, the card's one click saves the backup, confirms, sends `$32=1` then
  `$`, and leaves; saved without it, Job Review's row offers **Send $32=1**, which sends
  `$32=1` then `$`.
- `grbl-strategy.laser-mode-expectation.test.ts`: the same job emits the same bytes whether the
  profile expects laser mode on or off.
