## ADR-095 Amendment 1 - The operator states, once, a power scale the firmware does not report (2026-11-11)

**Status:** Accepted on the audit coordinator's task for fix group G5 of user annoyance audit A2
(`docs/audits/2026-11-11-annoyance-a2/`, finding B3-P2-1), under the maintainer's standing
instruction to fix confirmed audit findings. The maintainer has not reviewed the wording or the
statement itself; see "For the maintainer". | **Date:** 2026-11-11

**Amends:** ADR-095 ("Start readiness passes with an explicit power-scale-unverified warning
instead of demanding $30/$32 proof") and, for Smoothieware, ADR-096. ADR-224's laser
acknowledgement and ADR-228's "the `$32` acknowledgement banner" keep their meaning on every
firmware that reports settings. [ADR-237 Amendment 4](ADR-237-amendment-4-run-again-carries-an-operator-stated-review.md)
covers Run again. Nothing here adds a refusal or a gate (ADR-228), and no G-code changes.

### Context

Finding B3-P2-1, reproduced on the Marlin and Smoothieware simulators
(`non-grbl-evidence.simulator.test.ts`):

- A laser Start counts as verified only when this session's settings report agrees with the
  profile. Marlin and Smoothieware drivers declare `settings: 'none'`, so they can never be
  verified, whatever the operator does.
- Every Job Review therefore showed the **Confirm laser settings** banner with GRBL text: the
  "GRBL power scale ($30) or laser mode ($32=1)", and "use the fix Job Review offers (Send
  $32=1 …)". Neither setting exists on these firmwares. A second note said the controller "does
  not report GRBL $-settings".
- Run again (ADR-237 Amendment 3) carries a review only when it asks nothing, so these machines
  never got it.

The audit left FluidNC open. It is **not** affected: FluidNC's `$$` reports `$30` and `$32`
([SettingsDefinitions.cpp `make_proxies` @ v4.0.3](https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/SettingsDefinitions.cpp)),
and the FluidNC simulator verifies.

**What the two firmwares report.** Checked against their sources:

- **Marlin** ([1cd56c4c](https://github.com/MarlinFirmware/Marlin/tree/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d)).
  - `M115` prints a presence flag, `Cap:LASER:1` or `Cap:SPINDLE:1`, and nothing about the power
    unit or its top value
    ([M115.cpp](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/gcode/host/M115.cpp)).
  - `M503` (`MarlinSettings::report`) has no cutter line
    ([settings.cpp](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/module/settings.cpp)).
  - The unit is a build option: `CUTTER_POWER_UNIT` PWM255 (S0-S255, the default), PERCENT
    (S0-S100), RPM or SERVO, with `SPEED_POWER_MAX` as the top of the RPM range
    ([Configuration_adv.h](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/Configuration_adv.h)).
- **Smoothieware** ([38e2cc08](https://github.com/Smoothieware/Smoothieware/tree/38e2cc083db0e4f768535a9bf2d32cdf104ea980)).
  - The Laser module reads `laser_module_maximum_s_value` from the config file at boot, default
    1, and no G- or M-code prints it. `M221` reports the power percentage, the auto-power flag
    and the PWM frequency
    ([Laser.cpp](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/tools/laser/Laser.cpp)).
  - The shell's `config-get` can read the file, but it answers without an `ok`, and KerfDesk's
    Console refuses it for that reason. It is not asked at connect.
- **KerfDesk reads no build identity from either.** `M115` and Smoothieware's `version` are
  Console commands the operator can send; KerfDesk does not ask them at connect and keeps no
  answer, so it cannot tell that a board was reflashed or reconfigured.

So on these machines the scale rests on the profile, and only the operator can check it.

### Decision

1. **Their own wording.** A laser on a Marlin or Smoothieware profile whose session has no
   settings report gets text that names the firmware, says what KerfDesk cannot check, and says
   what to check once (`power-scale-statement.ts`):
   - Marlin inline: that the firmware's laser power unit tops out at the profile's Full-power S
     (PWM255, PERCENT, or RPM up to `SPEED_POWER_MAX`);
   - Marlin fan wiring: that the laser is on the fan output, which takes `M106` S0 to S255;
   - Smoothieware: that `laser_module_maximum_s_value` in the config file equals Full-power S.

   This replaces both the acknowledgement prompt and the readiness note. Neither names a GRBL
   setting. The G-code Inspector's own run prompt gets the same treatment for these firmwares.
   Other families without a settings report (Ruida, Moshi) keep the general note, now without
   "GRBL $-settings"; the CNC note says "spindle speed scale".
2. **The operator can record the check, once per machine profile.** Machine Setup shows
   **Power scale check** under Full-power S on Marlin and Smoothieware profiles only: a tick box
   "I have checked this: full power is S*n* on this machine", with the same instruction beside
   it. Ticking stores `operatorPowerScaleStatement` on the profile: the Full-power S, the
   controller family, the output dialect and the time.
3. **What voids it.** The statement describes one Full-power S on one controller family and one
   output dialect.
   - An edit to any of them removes it (`deviceProfileWithInteractivePatch`), and putting the
     old value back does not bring it back.
   - A statement that does not describe the profile it sits in stands for nothing
     (`standingPowerScaleStatement`), so a hand-edited or imported file cannot revive one. A
     malformed statement is dropped on load.
   - **Firmware identity is not a trigger, because KerfDesk cannot observe it** on these
     firmwares. The texts say to check again after changing the firmware or its configuration.
4. **What it changes at Start.** With a standing statement, on a session whose driver reports
   no settings:
   - Job Review shows one plain note, not the warning banner and not a warning: "Power scale:
     operator-stated. You recorded on *date* that full power is S*n* on this machine. KerfDesk
     has not checked it, because *firmware* does not report it. Check again after changing the
     firmware or its configuration."
   - Nothing is clicked for it, and the readiness note is not shown. The "Laser mode verified"
     chip is **not** shown: nothing was verified.
   - The Start evidence carries `operatorStatedPowerScale` with `unverifiedAcknowledged: false`.
     The wire boundary accepts unverified evidence that was acknowledged, or that carries a
     statement for the expected Full-power S on a no-settings session; anything else is refused
     as before (`laserModeStartEvidenceIssue`). This is the existing handoff-consistency check,
     not a new gate.
5. **What it never covers.**
   - A firmware that reports settings. There the report is the evidence: a mismatch, laser mode
     off and a failed read keep the acknowledgement, statement or not.
   - A program KerfDesk did not build (G-code Inspector run): its S words need not use the
     profile's scale, so that run still asks.
   - CNC. The spindle note and the CNC setup attestation are unchanged.
6. **It is recorded as the operator's word, everywhere.**
   - The review model's acknowledgement is `laser-operator-stated`, a kind of its own, with the
     fact line the operator saw.
   - The run's archive keeps that kind and the statement. The validator accepts the kind only
     with a statement that covers the Start, and a statement only under that kind; it is never
     archived as `laser-verified`.
   - The phone and MCP remote review receives it as `laser-unverified` with the fact line as
     its text, because deployed clients know three kinds and KerfDesk has not verified it. No
     Worker change is needed.
7. **Storage.** The field is optional on the device profile, in machine profile files and in
   projects. There is no schema bump: an older build ignores the field.

### Consequences

- A Marlin or Smoothieware owner is asked in words that apply to their machine, and can stop
  the question with one tick after checking. Until then Job Review asks on every Start, as
  before.
- The statement is in the project, so making or clearing it is a profile edit like any other:
  it needs a fresh Frame, and Run again of a run made before the edit is refused as changed.
- An archive written with `laser-operator-stated` is not readable as a valid run record by an
  older build, which knows three kinds.
- A reflashed board keeps its statement until the operator clears it. The fact line says so on
  every Job Review.

### For the maintainer

- This lets an operator's own statement stand where a click was required at every Start. No
  ADR was found that forbids it, and ADR-095 already said these firmwares start "instead of
  demanding $30/$32 proof". If the per-Start click should stay, removing the Machine Setup row
  restores it and leaves the wording.
- Reading `M115` and Smoothieware's `version` at connect would give a firmware identity that
  could void the statement. That is new connect traffic on firmware no hardware has qualified,
  so it was not added.
- Ruida and Moshi also report no power scale, but their power is not an S word. Their note was
  left general.

### Evidence

Tests and simulators only. No machine was operated, and no Marlin or Smoothieware board was
connected.

- `power-scale-statement.test.ts`: who can state, what a statement stands for, each voiding
  edit, malformed statements, and the wording.
- `laser-mode-start-acknowledgement.operator-stated.test.ts`: both firmwares before and after
  the statement, the evidence, the wire boundary, and what the statement does not cover.
- `controller-readiness.unreported-scale.test.ts`: the readiness note per firmware.
- `run-again-review-carry.operator-stated.test.ts`: the real Start flow, review gate and
  recovery repository on a Marlin laser, including the archive and byte-identical G-code.
- `non-grbl-evidence.simulator.test.ts`: the Marlin, Smoothieware and FluidNC simulators.
- `execution-operator-stated-validation.test.ts`, `machine-profile-power-scale-statement.test.ts`,
  `PowerScaleStatementRow.test.tsx`, `operator-stated-surfaces.test.tsx`.
