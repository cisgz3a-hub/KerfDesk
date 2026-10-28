## ADR-322 Amendment 3 - The Falcon A1 Pro preset homes, and its contract reads `$$` without writing (2026-10-28)

**Status:** Accepted on 2026-10-28; the homing default awaits the maintainer's read-only check of
the maintainer's own A1 Pro (below) |
**Amends:** ADR-322 decision 4 (the Falcon A1 Pro contract's settings-fetch ban) and the A1 Pro
preset's inherited homing. ADR-370 Amendment 2 restates its own item 5 to match. It adds no Start
guard (rule 7 / ADR-228).

### Context

Rolling audit v6, report K3 (`docs/audits/2026-10-28-rolling-v6/K3-falcon-a1-pro-truth.md`),
compared the A1 Pro preset with two published A1 Pro `$I`/`$$` transcripts: barebaric/rayforge
PR #461 (merged 2026-09-26) and LightBurn forum topic 177926, post 3 (2025-08-19). An independent
refuter confirmed every finding below, and the coordinator confirmed them on main.

- **K3-P2-1: the firmware homes, the preset said it does not.**
  - Both dumps read `$22=43`: grblHAL's "Enable", "Enable single axis commands", "Set machine
    origin to 0" and "Allow manual", with "Homing on startup required" clear
    ([settings.c L480 @ 04a5edcf](https://github.com/grblHAL/core/blob/04a5edcf8353f7294167d12d32e4b073d9be9ce4/settings.c#L480)).
    Both `$I` list `HOME` in `[NEWOPT:…]`, which grblHAL prints only with homing enabled. `$23=3`
    homes X and Y toward their minimum: the front left.
  - Creality's own LightBurn device has a Home macro `$HX` then `$HY`, and Creality describes a
    normal job as "homing, preview, running engraving".
  - The preset inherited `homing: { enabled: false }` from the generic default. So
    `resolveNativeBedFrame` never applied the A1 Pro's own bed frame, which exists only for this
    contract. Every A1 Pro job got a size-only preflight, Absolute included; an enabled no-go
    zone refused every Start; jogs had no bed limits; Home read **Set up homing**; the default
    flow led with Release motors (`$SLP`), which the factory `$62=0` refuses; and camera
    calibration said the machine "has no homing".
- **K3-P3-1: the settings-fetch ban rests on a LightBurn preference.** Decision 4 took "disables
  settings fetch" from the `.lbdev`'s `AllowSettingsFetch: false`, a LightBurn connect setting.
  - In grblHAL, `$$`, `$I` and `$ES` are reports
    ([system.c L203-L262 @ 04a5edcf](https://github.com/grblHAL/core/blob/04a5edcf8353f7294167d12d32e4b073d9be9ce4/system.c#L203-L262)).
    `$I` can rewrite only a corrupt free-text build label; `$#` can rewrite a corrupt work-offset
    record, and on one A1 Pro LightBurn's connect-time `$#` drew `error:7`.
  - Two units answered `$$` and `$I` in full. Creality lists LaserGRBL for live control, and
    LaserGRBL reads both at every connect (`GrblCore.cs` @ `1f9337b3`).
  - The ban left Start's `$30`/`$32` confirmation unanswerable on the A1 Pro, even after a typed
    `$$`, and hid `$22`, `$62`, `$10` and `$384`.
- **K3-P3-2: the preset's evidence notes were stale.** They said `$110`/`$111` cannot be read, the
  firmware build is not established, and the banner is not recorded.

### Decision

1. **The A1 Pro preset homes at the front left.** `homing: { enabled: true, direction:
   'front-left' }`, with catalog version 2026-10-28. Home still sends `$HX` then `$HY`, each line
   owning its acknowledgement (decision 4). With a Home this session, the vendor frame
   (native 0..358 x 0..268, no offset) applies, and with it Absolute preflight, no-go zone checks,
   jog and click-to-position limits, the Home button, Print and Cut and the camera's "Home the
   machine before engraving the target" note. The default Start from becomes Absolute.
2. **A saved copy that still has homing off is named, not changed.** Job Review names it and
   Machine Setup offers **Use homing on at the front left** (Amendments 1 and 2). A copy saved
   without kinematics gets the same treatment for CoreXY (ADR-675).
3. **The contract reads `$$` at connect and writes nothing.** A new settings capability,
   `grbl-dollar-read`, means "the GRBL `$$` dump, read as the GRBL family reads it, with no
   `$N=` writes beyond the driver's own list". The Falcon contract uses it and keeps grblHAL's
   `$$` query, so the connect handshake, Find my machine and the Machine Settings panel read it as
   they do on any grblHAL.
   - Start's `$30`/`$32` check can now pass, Pause checks laser mode, and Release motors is
     disabled with "`$62=0`" when the read says so.
   - Writes stay refused: the Settings panel's writes need `grbl-dollar`, and the Console lists no
     write on grblHAL (ADR-370 Amendment 1). The firmware setup panel stays off.
   - "Use detected values" is unchanged (ADR-637 Amendment 2 decision 5): it shows the
     controller's 363 x 273 travel against the listed 358 x 268 before it copies anything, and the
     automatic fill keeps the listed work area.
4. **`$I` is the Super Console's firmware report, not a connect query.** `firmwareReportQuery`
   gives `$I` for this contract. The stock-GRBL `$I` parser at connect takes exactly a VER and an
   OPT line, and grblHAL prints more, so `buildInfoQuery` stays null. `$ES` is not sent: nothing in
   KerfDesk reads it now that the A1 Pro gets no setting write. KerfDesk never sends `$#` on its
   own on this contract.
5. **The evidence notes cite both reads.** Banner `GrblHAL 1.1f`, `[VER:1.1f.20231005:]`,
   `[Firmware:Version v1.0.4]` (builds 20260706154934 and 20250618205542), `[FIRMWARE:grblHAL]`,
   `[BOARD:A1 Pro Laser Master]`, `[KINEMATICS:CoreXY v2.02]`, `$110=$111=36000`,
   `$120=$121=1000`, `$130=363`, `$131=273`. It is Creality's own grblHAL build, not stock core
   `04a5edcf`. The maintainer's own unit is still unread.

### Awaiting confirmation

The maintainer owns an A1 Pro. The report's read-only checklist (K3, "Maintainer read-only
checklist") can confirm this on the maintainer's unit without any write, motion or laser command: step 0
watches whether it homes at power-on, and `$I` and `$$`, typed in KerfDesk's Console on this
preset, show `$22`, `KINEMATICS` and the build. If that unit reads `$22` with bit 0 clear, the
homing default should be revisited.

### Consequences

- A1 Pro owners see Home, not Set up homing, and the first connect toasts that settings were
  read. Machine Setup lists the 363 x 273 travel and the firmware's 1000 mm/s² as differences.
- A unit that does not home itself at power-on needs a Home before an Absolute or camera-placed
  job, as LightBurn's Absolute does.

### Verification

- `falcon-a1-pro-preset-homing.test.ts`: the preset's homing and kinematics; the vendor frame, jog limits
  and Absolute preflight with a confirmed Home; the default Start from; the corrections offered to
  an old copy (`preset-corrections.test.ts`).
- `falcon-command-contract` tests: `$$` is the settings query, the capability is
  `grbl-dollar-read`, the Console still refuses every `$N=` on grblHAL, and `$I` is the firmware
  report.
- No machine was operated.
