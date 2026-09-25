## ADR-387 - Low-power Fire and camera bed alignment leave Labs (2026-09-24)

**Status:** Accepted. | **Date:** 2026-09-24

This amends ADR-161 (Labs gates) and ADR-162 (low-power Fire). It follows the pattern ADR-315 used
when rotary left Labs. Every Fire safety rule in ADR-162 stays. It adds no Start guard: Job Review
stays advisory (ADR-228).

### Context

The 2026-09-24 LightBurn gap work (owner direction: build the gaps and do better than LightBurn)
moves two features out of Tools > Labs.

1. **Fire was hard to reach and hid its reasons.**
   - Before this change, the button appeared only when four gates agreed:
     - the workstation's Labs switch;
     - the controller capability;
     - the catalog `low-power-fire` capability on the profile;
     - the profile's `fireControl.enabled`.
   - Only the two Falcon presets carried the catalog capability, so no other profile could even
     show the opt-in row.
   - When any gate failed, the button vanished and nothing said why.
   - LightBurn puts **Enable Laser Fire Button** on the device itself (Device Settings > Basic
     Settings, GCode devices). It adds a Fire button and power setting to the Move window. It "should
     only be used for diode lasers ... never ... for a CO2 laser, which has an invisible beam that
     could blind you or start a fire".
     https://docs.lightburnsoftware.com/2.1/Reference/DeviceSettings/BasicSettings/
2. **Align to bed waited for a Labs switch, not for what it needs.**
   - LightBurn calibrates the lens first, then runs alignment.
     https://docs.lightburnsoftware.com/2.1/Reference/Cameras/Alignment/
   - KerfDesk's wizard already de-fisheyes with the saved calibration. It also refuses a
     calibration that is bound to another camera or capture shape. Without a calibration it
     produced a raw-basis alignment that is less accurate across the bed.
3. **The laser-9 hardware protocol said otherwise.**
   `docs/hardware/laser-9-acceptance-protocol.md` let a feature leave Labs only in a PR carrying its
   hardware evidence bundle. This change moves both features without that evidence, by the owner's
   direction, and amends the protocol to match. Neither feature is hardware-qualified here.

### Decision

1. **Labs holds only Print and Cut.**
   - The storage key is unchanged. Stored `lowPowerFire` and `cameraAlignmentV2` values are ignored
     on read and dropped on the next write, as ADR-315 did for the rotary keys.
   - Nothing is migrated, because neither feature needs anything Labs stored. The Fire consent is
     the profile's own opt-in, and the lens calibration is on the profile.
   - A profile that had Fire enabled under the Labs switch keeps working with no new clicks.
2. **Fire is a per-machine opt-in, off by default.**
   - The opt-in lives in Machine Setup > Essentials > Air assist and test fire. It has two fields:
     - **Enable Fire button**;
     - **Fire power**, 0.1-5% in 0.1 steps, default 1%.
   - The row shows the S word a press sends, for example `% = S10 of S1000`. It flags a power that
     rounds to S0 on the machine's scale.
   - `fireOfferIssue` (core, `fire-availability.ts`) offers the opt-in only when all three hold:
     1. the profile has laser output;
     2. its controller driver declares `lowPowerFire` (GRBL v1.1, grblHAL, FluidNC and the Falcon
        contract);
     3. the profile does not declare a CO2 or fiber source.
   - LightBurn only warns about invisible beams; KerfDesk refuses. A profile with unknown or
     undeclared technology keeps the opt-in, and the row says it is for diode lasers only.
   - Marlin, Smoothieware and Ruida drivers have no Fire command contract here, so their row says
     why instead of offering a checkbox.
   - The catalog `low-power-fire` capability no longer gates anything. It stays in the catalog as
     metadata, and no profile data changes.
3. **ADR-162's rules are unchanged, and one function now owns them.**
   - Unchanged:
     - the absolute 5% ceiling and the configured cap (`cappedFirePowerS`);
     - hold-to-fire;
     - `G1 F<feed> M3 S<n>` on and `M5` off;
     - only an accepted `M5` clears the on latch;
     - every laser-off path: release, leave, cancel, button blur, window blur, visibility loss,
       unmount, error and disconnect.
   - `fireActivationBlock` (`laser-fire-readiness.ts`) decides both the button face and the Fire
     action's refusal. It refuses in this order:
     1. an unready setup;
     2. disconnected;
     3. no controller capability;
     4. MPG;
     5. alarm;
     6. no status report;
     7. not Idle;
     8. no trusted position;
     9. a job;
     10. jog or Frame motion;
     11. a controller operation;
     12. auto-focus;
     13. probing;
     14. an unacknowledged command.
   - After the `M3` write, the action checks again and sends a compensating `M5` if anything
     changed. That includes the opt-in being withdrawn mid-press.
4. **Two paths are tightened.**
   - A refused press no longer clears the on latch. Before, a refused repeat press set
     `fireActive` false without sending `M5`. That hid LASER OFF and skipped `M5` on release while
     an earlier `M3` could still hold the beam on.
   - When the `M3` write fails with the latch set, the button asks for `M5` at once instead of at
     the next release signal.
5. **The Fire button is always visible on laser projects, and it says why it cannot fire.**
   - Without the opt-in, it reads **Set up** and opens Machine Setup at the Fire row.
   - A machine that cannot offer Fire shows a disabled **Unavailable** button that names the
     reason.
   - An opted-in button that is blocked names the state on its face and the fix in its tooltip.
     The captions are:
     - Not connected;
     - Alarm;
     - Job running;
     - Not idle;
     - Moving;
     - Busy;
     - Focusing;
     - Probing;
     - Waiting;
     - MPG active;
     - No status;
     - No position;
     - Unsupported.
   - The face shows the power as both percent and S, for example `1% · S10`, which is the S the
     press sends.
   - CNC projects have no Fire button.
6. **Align to bed opens whenever the device has a lens calibration.**
   - This applies to every camera source, USB and RTSP or machine cameras alike. Without a
     calibration, the button's tooltip says to calibrate the lens first.
   - Removing the calibration closes an open wizard.
   - Every check on the alignment itself is unchanged:
     - calibration binding to the active camera (source, query fingerprint and capture geometry);
     - marker detection;
     - the degenerate-solve refusal;
     - the marker surface height;
     - the independent marker-spacing check.

### Consequences

- Any GRBL-family laser profile that does not declare an invisible beam can offer Fire, not only the
  Falcon presets.
- **Fire's consent moved from the workstation to the machine profile, as in LightBurn.**
  - The opt-in travels with the profile: in machine-profile files, and in the device a project file
    carries.
  - ADR-161's promise that opening a project cannot arm experimental behaviour therefore no longer
    covers Fire. A project whose device has Fire enabled shows a live Fire button once connected
    and Idle. The button still needs the operator's hold, the 5% cap and every precondition.
  - When the opened machine differs from the current one, the existing machine-change banner offers
    to keep the current machine, and with it the current Fire setting.
- A profile whose Fire was enabled while its workstation's Labs switch was off now shows Fire.
- The wizard no longer produces raw-basis alignments. Saved raw alignments keep working for the
  overlay. Manual 4-corner alignment on the machine-camera preview is unaffected.
- The Labs dialog lists Print and Cut and says where Fire and Align to bed went.

### Evidence and limits

- `fire-availability.test.ts` pins where the opt-in is offered:
  - the Neotronics 4040 without the catalog capability;
  - the Falcon opt-in;
  - off by default;
  - Marlin and CNC-only profiles refused;
  - CO2 and fiber refused, while diode and unknown technology are kept;
  - the S word and the 5% ceiling;
  - the S0 flag.
- `laser-fire-readiness.test.ts` pins the setup states and every machine-state precondition by
  caption and message.
- `laser-fire-actions.test.ts` pins the Fire action:
  - the opt-in gate with no Labs switch;
  - a retired Labs key in storage;
  - the 5% ceiling against a planted 50%;
  - each precondition refusing without a write;
  - the latch kept on a refused repeat press (this test fails on the old code);
  - the compensating `M5` when the opt-in is withdrawn mid-activation.
- `MomentaryFireControl.test.tsx` runs the real Fire action behind the button. It checks that each
  laser-off path puts `M5` on the wire, that the displayed S equals the S sent, and the button's
  reasons and Set up flow. Removing any one release listener fails its case.
- `FireControlRow.test.tsx` covers the Machine Setup opt-in: the one-click flow, the 5% clamp, the S
  display, the S0 warning and a setting saved before this change.
- `experimental-laser-features.test.ts` loads a store written with the retired keys and shows the
  next write drops them.
- `AutoAlignControls.test.tsx` covers Align to bed without Labs. The Playwright camera case was
  updated but not run here, because no browser is installed in this environment.
- No hardware was operated. FAL-08 (Fire) and the CAM series in the laser-9 protocol are still open.
  They now qualify physical claims, as ROT does for rotary, rather than unlocking the features.
